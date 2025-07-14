require('dotenv').config()

const { callClaude, checkClaudePermissions } = require('./claude')
const { log, getRepoPath } = require('./util')
const { ensureRepositoryExists, checkoutBranch, createPR, findExistingPR, updateExistingPR, getPRComments, postPRComment, postReviewCommentReply, addCommentReaction, pushBranchAndMergeIfNecessary } = require('./github')
const { pollLinear, checkIssueStatus, getIssueShortName, updateIssueToInProgress } = require('./linear')

/**
 * Main entry point for Adam mode.
 */
async function runAdam () {
  log('🚀', 'Starting Adam - Linear to GitHub automation agent', 'green')

  // Get poll interval from environment variable, default to 30 seconds
  const pollIntervalSeconds = parseInt(process.env.POLL_INTERVAL) || 30
  const pollIntervalMs = pollIntervalSeconds * 1000

  log('⏱️', `Poll interval set to ${pollIntervalSeconds} seconds`, 'blue')

  // Main worker loop. We poll for actions at the configured interval.
  while (true) {
    const start = Date.now()

    try {
      await performActions()
    } catch (error) {
      log('❌', `Error: ${error.message}`, 'red')
    }

    const elapsed = Date.now() - start
    const remaining = pollIntervalMs - elapsed

    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining))
    }
  }
}

/**
 * Perform one iteration of actions in the main loop.
 */
async function performActions () {
  // Check Claude permissions before doing anything else
  const hasPermissions = await checkClaudePermissions()
  if (!hasPermissions) {
    log('❌', 'Invalid Claude API key · Please run /login', 'red')
    return
  }

  const issues = await pollLinear()

  printIssues(issues)

  for (const issue of issues) {
    const foundWork = await processIssue(issue)
    if (foundWork) {
      log('🔄', 'Found work to do - restarting to refresh issues', 'blue')
      return
    }
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
 * @returns {Promise<boolean>} True if work was found and processed, false otherwise.
 */
async function processIssue (issue) {
  log('🔄', `Processing ${getIssueShortName(issue)}`, 'blue')

  // Check we have a known repository for the issue.
  if (!issue.repository?.owner || !issue.repository?.name) {
    log('⚠️', `No repository found for issue ${issue.identifier}. Skipping...`, 'yellow')
    return false
  }

  // Clone the repository if it doesn't exist.
  const repoExists = await ensureRepositoryExists(issue.repository)
  if (!repoExists) {
    log('❌', `Failed to ensure repository exists for issue ${issue.identifier}`, 'red')
    return false
  }

  // Checkout the branch for the issue.
  const checkedOutBranch = await checkoutBranch(issue.branchName, getRepoPath(issue.repository.name))
  if (!checkedOutBranch) {
    log('❌', `Failed to checkout branch ${issue.branchName} for issue ${issue.identifier}`, 'red')
    return false
  }

  // Check if the PR already exists.
  const existingPR = await findExistingPR(issue, issue.repository)
  if (existingPR) {
    // Check if this is a merged PR (race condition detected)
    if (existingPR.merged) {
      log('🛑', `Skipping issue ${issue.identifier} - PR was already merged`, 'yellow')
      return false
    }
    const foundWork = await processExistingPR(existingPR, issue)
    return foundWork
  }

  // Mark the issue as "In Progress" if it's currently in "Todo" state
  log('🚀', `Marking issue ${issue.identifier} as In Progress...`, 'blue')
  const updateSuccess = await updateIssueToInProgress(issue)
  if (!updateSuccess) {
    log('❌', `Failed to update issue ${issue.identifier} to In Progress, giving up`, 'red')
    return false
  }

  // Before calling Claude, double-check that the issue is still in Todo, In Progress, or In Review
  log('🔍', `Double-checking issue status before implementing ${issue.identifier}...`, 'blue')
  const currentIssue = await checkIssueStatus(issue.id)
  if (!currentIssue) {
    log('❌', `Failed to check current status for issue ${issue.identifier}`, 'red')
    return false
  }

  const currentState = await currentIssue.state
  if (currentState.name === 'Done') {
    log('🛑', `Issue ${issue.identifier} has been marked as Done - skipping to avoid race condition`, 'yellow')
    return false
  }

  if (!['Todo', 'In Progress', 'In Review'].includes(currentState.name)) {
    log('🛑', `Issue ${issue.identifier} is no longer in Todo, In Progress, or In Review state (current: ${currentState.name}) - skipping`, 'yellow')
    return false
  }

  // Call Claude to generate the code.
  const prompt = await generatePrompt(issue)
  const claudeSuccess = await callClaude(prompt, getRepoPath(issue.repository.name))
  if (!claudeSuccess) {
    log('❌', `Claude Code failed for issue: ${issue.identifier}`, 'red')
    return true // Still counts as finding work even if it failed
  }

  // Before creating PR, do one final check that the issue hasn't been marked as Done
  log('🔍', `Final check before creating PR for ${issue.identifier}...`, 'blue')
  const finalIssue = await checkIssueStatus(issue.id)
  if (finalIssue) {
    const finalState = await finalIssue.state
    if (finalState.name === 'Done') {
      log('🛑', `Issue ${issue.identifier} was marked as Done during implementation - not creating PR to avoid race condition`, 'yellow')
      return true // Still counts as finding work
    }
  }

  // Create a PR for the issue.
  const pr = await createPR(issue, issue.branchName, issue.repository)
  if (pr) {
    log('🎉', `Successfully created PR for issue: ${issue.identifier}`, 'green')
  } else {
    log('❌', `Failed to create PR for issue: ${issue.identifier}`, 'red')
  }

  return true // We found work and processed it
}

/**
 * Process an existing PR by updating it and retrieving comments.
 *
 * @param {Object} existingPR - The existing PR object.
 * @param {Object} issue - The issue object.
 * @returns {Promise<boolean>} True if work was found and processed, false otherwise.
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

      // Process all conversation threads
      await processConversationThreads(conversationThreads, existingPR, issue)
      return true // Found work (conversation threads to process)
    }
  }

  return false // No work found
}

/**
 * Process all conversation threads for a PR.
 *
 * @param {Array} conversationThreads - Array of conversation threads to process.
 * @param {Object} existingPR - The existing PR object.
 * @param {Object} issue - The issue object.
 */
async function processConversationThreads (conversationThreads, existingPR, issue) {
  for (let i = 0; i < conversationThreads.length; i++) {
    const thread = conversationThreads[i]
    const lastComment = thread[thread.length - 1]

    log('🔄', `Processing thread ${i + 1}/${conversationThreads.length}`, 'blue')

    // Add eyes reaction to indicate we're processing this comment
    log('👁️', 'Adding eyes reaction to indicate processing...', 'blue')
    await addCommentReaction(lastComment.id, lastComment.type, 'eyes', issue.repository)

    const prompt = generateThreadPrompt(thread)

    log('🤖', `Running Claude to process conversation thread ${i + 1}...`, 'blue')

    try {
      const claudeResponse = await callClaude(prompt, getRepoPath(issue.repository.name))

      if (claudeResponse) {
        // Verify that changes were committed and retry if needed
        const commitSuccess = await ensureChangesCommitted(issue.repository.name, issue.branchName)
        if (!commitSuccess) {
          log('❌', `Failed to ensure changes were committed for thread ${i + 1}`, 'red')
        }

        await respondToConversationThread(claudeResponse, lastComment, existingPR, issue, i + 1)
      } else {
        log('❌', `Claude returned empty response for thread ${i + 1}`, 'red')
      }
    } catch (error) {
      log('❌', `Failed to process conversation thread ${i + 1}: ${error.message}`, 'red')
    }
  }
}

/**
 * Respond to a conversation thread by posting replies and pushing to remote.
 *
 * @param {string} claudeResponse - The response from Claude.
 * @param {Object} lastComment - The last comment in the thread.
 * @param {Object} existingPR - The existing PR object.
 * @param {Object} issue - The issue object.
 * @param {number} threadNumber - The thread number for logging.
 */
async function respondToConversationThread (claudeResponse, lastComment, existingPR, issue, threadNumber) {
  log('✅', `Successfully responded to conversation thread ${threadNumber}`, 'green')

  // Determine how to reply based on the last comment in the thread
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
    log('💬', `Successfully posted Claude response for thread ${threadNumber} as ${lastComment.type} ${lastComment.type === 'review' ? 'reply' : 'quoted comment'} to GitHub PR`, 'green')

    // Push the branch to remote after making changes, merging if necessary
    const pushSuccess = await pushBranchAndMergeIfNecessary(issue.branchName, issue.repository, issue)
    if (pushSuccess) {
      log('📤', `Successfully pushed changes to remote branch after thread ${threadNumber}`, 'green')
    } else {
      log('❌', `Failed to push changes to remote branch after thread ${threadNumber}`, 'red')
    }
  } else {
    log('❌', `Failed to post Claude response for thread ${threadNumber} to GitHub PR`, 'red')
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
 * Ensures that changes have been committed to the repository after Claude processing.
 * If changes exist but haven't been committed, it will retry up to 3 times with Claude to commit them.
 *
 * @param {string} repoName - The name of the repository
 * @param {string} branchName - The name of the branch
 * @returns {Promise<boolean>} - True if changes are committed or no changes exist, false if failed
 */
async function ensureChangesCommitted (repoName, branchName) {
  const simpleGit = require('simple-git')
  const repoPath = getRepoPath(repoName)
  const git = simpleGit(repoPath)

  const maxRetries = 3
  let retry = 0

  while (retry < maxRetries) {
    try {
      // Check if there are any uncommitted changes
      const status = await git.status()
      const hasUncommittedChanges = status.files.length > 0

      if (!hasUncommittedChanges) {
        log('✅', 'No uncommitted changes found', 'green')
        return true
      }

      log('⚠️', `Found ${status.files.length} uncommitted changes on attempt ${retry + 1}/${maxRetries}`, 'yellow')

      // List the uncommitted files for debugging
      status.files.forEach(file => {
        log('📄', `${file.index}${file.working_dir} ${file.path}`, 'yellow')
      })

      // Generate a commit prompt for Claude
      const commitPrompt = `You have made changes to the codebase but they have not been committed to git yet.

UNCOMMITTED CHANGES:
${status.files.map(file => `${file.index}${file.working_dir} ${file.path}`).join('\n')}

CRITICAL: You must commit these changes now. Please:
1. Use 'git add' to stage all the changed files
2. Create a commit with a descriptive message that explains what was changed
3. Do NOT skip this step - the automation depends on these changes being committed

Please commit these changes immediately.`

      log('🔄', `Attempting to commit changes with Claude (attempt ${retry + 1}/${maxRetries})...`, 'blue')

      const commitSuccess = await callClaude(commitPrompt, repoPath)
      if (!commitSuccess) {
        log('❌', `Claude failed to commit changes on attempt ${retry + 1}`, 'red')
        retry++
        continue
      }

      // Verify the commit was successful
      const newStatus = await git.status()
      if (newStatus.files.length === 0) {
        log('✅', `Successfully committed changes on attempt ${retry + 1}`, 'green')
        return true
      }

      log('⚠️', `Changes still not committed after attempt ${retry + 1}`, 'yellow')
      retry++
    } catch (error) {
      log('❌', `Error checking git status on attempt ${retry + 1}: ${error.message}`, 'red')
      retry++
    }
  }

  log('❌', `Failed to commit changes after ${maxRetries} attempts`, 'red')
  return false
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
   - IMPORTANT: You MUST git add all changed files and commit your changes with a descriptive commit message
   - Do NOT skip the commit step - this is critical for the automation to work properly

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

module.exports = { runAdam }
