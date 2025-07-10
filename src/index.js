require('dotenv').config()

const { callClaude } = require('./claude')
const { log } = require('./util')
const { ensureRepositoryExists, checkoutBranch, createPR, findExistingPR, updateExistingPR, getPRComments, postPRComment, postReviewCommentReply, addCommentReaction } = require('./github')
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
      log('💬', `Found ${conversationThreads.length} conversation thread(s) to process`, 'blue')

      // Process only the first thread
      const firstThread = conversationThreads[0]
      const lastComment = firstThread[firstThread.length - 1]

      // Add eyes reaction to indicate we're processing this comment
      log('👁️', 'Adding eyes reaction to indicate processing...', 'blue')
      await addCommentReaction(lastComment.id, lastComment.type, 'eyes', issue.repository)

      const prompt = generateThreadPrompt(firstThread)

      log('🤖', 'Running Claude to process conversation thread...', 'blue')

      try {
        const claudeResponse = await callClaude(prompt, `./${issue.repository.name}`)

        if (claudeResponse) {
          log('✅', 'Successfully processed conversation thread with Claude', 'green')

          // Determine how to reply based on the last comment in the thread
          const lastComment = firstThread[firstThread.length - 1]
          let comment

          if (lastComment.type === 'review') {
            // Reply directly to the review comment
            comment = await postReviewCommentReply(existingPR.number, lastComment.id, claudeResponse, issue.repository)
          } else {
            // Quote the issue comment and post a new comment
            comment = await postPRComment(existingPR.number, claudeResponse, issue.repository, {
              user: lastComment.user,
              body: lastComment.body
            })
          }

          if (comment) {
            log('💬', `Successfully posted Claude response as ${lastComment.type} ${lastComment.type === 'review' ? 'reply' : 'quoted comment'} to GitHub PR`, 'green')
          } else {
            log('❌', 'Failed to post Claude response to GitHub PR', 'red')
          }
        } else {
          log('❌', 'Claude returned empty response', 'red')
        }
      } catch (error) {
        log('❌', `Failed to process conversation thread: ${error.message}`, 'red')
      }
    }
  }
}

/**
 * Filters comments to find comments written by nozcat or with +1 reactions by nozcat
 * that are the last reply in their thread, and builds conversation threads for each.
 * Excludes comments that already have eyes reactions from our user to prevent double processing.
 *
 * @param {Array} comments - Array of comment objects from getPRComments.
 * @returns {Array} Array of conversation threads, each thread being an array of comments from root to leaf.
 */
function filterRelevantComments (comments) {
  const ourUsername = process.env.GITHUB_USERNAME

  const relevantComments = comments.filter(comment => {
    // Check if comment is written by nozcat or has +1 reaction by nozcat
    const isRelevantComment = comment.user === 'nozcat' ||
      (comment.reactions && comment.reactions['+1'] &&
       comment.reactions['+1'].some(reaction => reaction.user === 'nozcat'))

    if (!isRelevantComment) {
      return false
    }

    // Skip if this comment already has eyes reaction from our user (already processed)
    if (comment.reactions && comment.reactions.eyes &&
        comment.reactions.eyes.some(reaction => reaction.user === ourUsername)) {
      log('👁️', `Skipping comment ${comment.id} - already has eyes reaction from ${ourUsername}`, 'yellow')
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
 * Generates a comprehensive prompt for Claude to process a conversation thread.
 * The prompt includes full context and asks Claude to determine if changes are needed,
 * make them if so, commit them, and provide a response.
 *
 * @param {Array} thread - Array of comments forming the conversation thread, ordered from root to leaf.
 * @returns {string} A formatted prompt string for Claude.
 */
function generateThreadPrompt (thread) {
  const threadContext = thread.map((comment, index) => {
    const isRoot = index === 0
    const prefix = isRoot ? 'ORIGINAL COMMENT' : `REPLY ${index}`

    let context = `${prefix}:\n`
    context += `Author: ${comment.user}\n`
    context += `Body: ${comment.body}\n`

    if (comment.path) {
      context += `File: ${comment.path}\n`
    }

    if (comment.line) {
      context += `Line: ${comment.line}\n`
    }

    if (comment.diff_hunk) {
      context += `Diff Context:\n${comment.diff_hunk}\n`
    }

    if (comment.created_at) {
      context += `Created: ${comment.created_at}\n`
    }

    return context
  }).join('\n---\n\n')

  return `You are Claude, an AI assistant helping with code review and development. Below is a conversation thread from a GitHub pull request that requires your attention. Please analyze the full context and determine if any coding changes are needed.

CONVERSATION THREAD:
${threadContext}

INSTRUCTIONS:
1. Analyze the conversation thread above, paying attention to the full context including:
   - The original comment and all replies
   - File paths, line numbers, and diff context where provided
   - The progression of the conversation and any decisions made

2. Determine if this conversation requires a coding change:
   - If YES: Make the necessary changes to address the feedback/requests in the conversation
   - If NO: Explain why no changes are needed

3. If you make changes:
   - Implement the changes completely
   - Test your changes if applicable
   - Commit your changes with a descriptive commit message

4. Provide a response that summarizes:
   - What you analyzed from the conversation
   - Whether changes were made and what they were
   - Or why no changes were necessary
   - Any additional context that would be helpful

Your response should be suitable as a reply to the conversation thread. It should be friendly, consise, professional, and upbeat.`
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
