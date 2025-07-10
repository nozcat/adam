require('dotenv').config()

const { callClaude } = require('./claude')
const { log } = require('./util')
const { ensureRepositoryExists, checkoutBranch, createPR, findExistingPR, updateExistingPR, getPRComments } = require('./github')
const { pollLinear, getIssueShortName } = require('./linear')

/**
 * Main entry point.
 */
async function main () {
  log('🚀', 'Starting Adam - Linear to GitHub automation agent', 'green')

  // Main worker loop. We poll for actions every 30 seconds.
  while (true) {
    const start = Date.now()

    try {
      await performActions()
    } catch (error) {
      log('❌', `Error: ${error.message}`, 'red')
    }

    const elapsed = Date.now() - start
    const remaining = 30000 - elapsed

    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining))
    }
  }
}

/**
 * Perform one iteration of actions in the main loop.
 */
async function performActions () {
  const issues = await pollLinear()

  printIssues(issues)

  for (const issue of issues) {
    await processIssue(issue)
  }
}

/**
 * Print the issues to the console.
 *
 * @param {Array} issues - The issues to print.
 */
function printIssues (issues) {
  log('🔍', `Found ${issues.length} assigned open issues`, 'blue')

  for (const issue of issues) {
    console.log(`  - ${getIssueShortName(issue)}`)
  }

  console.log()
}

/**
 * Process an issue.
 *
 * @param {Object} issue - The issue to process.
 */
async function processIssue (issue) {
  log('🔄', `Processing ${getIssueShortName(issue)}`, 'blue')

  // Check we have a known repository for the issue.
  if (!issue.repository) {
    log('⚠️', `No repository found for issue ${issue.identifier}. Skipping...`, 'yellow')
    return
  }

  // Clone the repository if it doesn't exist.
  try {
    await ensureRepositoryExists(issue.repository)
  } catch (error) {
    log('❌', `Failed to ensure repository exists for issue ${issue.identifier}: ${error.message}`, 'red')
    return
  }

  // Checkout the branch for the issue.
  const checkedOutBranch = await checkoutBranch(issue.branchName, issue.repository.name)
  if (!checkedOutBranch) {
    log('❌', `Failed to checkout branch ${issue.branchName} for issue ${issue.identifier}`, 'red')
    return
  }

  // Check if the PR already exists.
  const existingPR = await findExistingPR(issue, issue.repository)
  if (existingPR) {
    await processExistingPR(existingPR, issue)
    return
  }

  // Call Claude to generate the code.
  const prompt = await generatePrompt(issue)
  const claudeSuccess = await callClaude(prompt, `./${issue.repository.name}`)
  if (!claudeSuccess) {
    log('❌', `Claude Code failed for issue: ${issue.identifier}`, 'red')
    return
  }

  // Create a PR for the issue.
  const pr = await createPR(issue, issue.branchName, issue.repository)
  if (pr) {
    log('🎉', `Successfully created PR for issue: ${issue.identifier}`, 'green')
  } else {
    log('❌', `Failed to create PR for issue: ${issue.identifier}`, 'red')
  }
}

/**
 * Process an existing PR by updating it and retrieving comments.
 *
 * @param {Object} existingPR - The existing PR object.
 * @param {Object} issue - The issue object.
 */
async function processExistingPR (existingPR, issue) {
  log('📋', `PR already exists for issue ${issue.identifier}: ${existingPR.html_url}`, 'yellow')

  // Update the existing PR by merging main
  const updateSuccess = await updateExistingPR(issue, issue.repository)
  if (!updateSuccess) {
    log('❌', `Failed to update existing PR for issue ${issue.identifier}`, 'red')
  }

  // Get the comments on the PR.
  const comments = await getPRComments(existingPR.number, issue.repository)
  if (comments) {
    const conversationThreads = filterRelevantComments(comments)
    if (conversationThreads.length > 0) {
      console.log(conversationThreads)
    }
  }
}

/**
 * Filters comments to find comments written by nozcat or with +1 reactions by nozcat
 * that are the last reply in their thread, and builds conversation threads for each.
 *
 * @param {Array} comments - Array of comment objects from getPRComments.
 * @returns {Array} Array of conversation threads, each thread being an array of comments from root to leaf.
 */
function filterRelevantComments (comments) {
  const relevantComments = comments.filter(comment => {
    // Check if comment is written by nozcat or has +1 reaction by nozcat
    const isRelevantComment = comment.user === 'nozcat' ||
      (comment.reactions && comment.reactions['+1'] &&
       comment.reactions['+1'].some(reaction => reaction.user === 'nozcat'))

    if (!isRelevantComment) {
      return false
    }

    // Check if this comment has any replies (other comments replying to it)
    const hasReplies = comments.some(otherComment =>
      otherComment.in_reply_to_id === comment.id
    )

    // Only include if it's the last reply (no other comments replied to it)
    return !hasReplies
  })

  // Build conversation threads for each relevant comment
  return relevantComments.map(comment => buildConversationThread(comment, comments))
}

/**
 * Builds a conversation thread by tracing back through parent comments.
 *
 * @param {Object} comment - The comment to trace back from.
 * @param {Array} allComments - All comments to search through.
 * @returns {Array} Array of comments forming the conversation thread, ordered from root to leaf.
 */
function buildConversationThread (comment, allComments) {
  const thread = []
  let currentComment = comment

  // Trace back to find all parent comments
  while (currentComment) {
    thread.unshift(currentComment) // Add to beginning to maintain order

    if (currentComment.in_reply_to_id) {
      // Find the parent comment
      currentComment = allComments.find(c => c.id === currentComment.in_reply_to_id)
    } else {
      // This is the root comment, stop here
      currentComment = null
    }
  }

  return thread
}

/**
 * Generate a prompt for Claude Code to implement a Linear issue.
 *
 * @param {Object} issue - The Linear issue object
 * @param {string} issue.title - The title of the issue
 * @param {string} [issue.description] - The description of the issue
 * @returns {Promise<string>} A formatted prompt string for Claude Code
 */
async function generatePrompt (issue) {
  return `
    Please implement the following issue:

    Title: ${issue.title}
    Description: ${issue.description || ''}

    Complete this task completely and commit your changes when done.
  `
}

main()
