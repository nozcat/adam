require('dotenv').config()

const { callClaude } = require('./claude')
const { log } = require('./util')
const { ensureRepositoryExists, checkoutBranch, createPR, findExistingPR, updateExistingPR } = require('./github')
const { pollLinear, getIssueShortName } = require('./linear')

/*
async function monitorPRs (repoInfo) {
  try {
    const activePRs = await getActivePRs(repoInfo)

    for (const pr of activePRs) {
      const feedback = await handlePRFeedback(pr.number, pr.head.ref, repoInfo)

      if (feedback.hasFeedback) {
        const feedbackPrompt = `Please address the following PR feedback:\n\n${feedback.feedbackSummary}`
        const claudeSuccess = await callClaude(feedbackPrompt, repoInfo ? `./${repoInfo.name}` : TARGET_REPO, DEBUG)

        if (claudeSuccess) {
          log('✅', `Successfully addressed feedback for PR #${pr.number}`, 'green')
        } else {
          log('❌', `Failed to address feedback for PR #${pr.number}`, 'red')
        }
      }

      await checkPRApproval(pr.number, repoInfo)
    }
  } catch (error) {
    log('❌', `Error monitoring PRs: ${error.message}`, 'red')
  }
}
*/

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
    log('📋', `PR already exists for issue ${issue.identifier}: ${existingPR.html_url}`, 'yellow')

    // Update the existing PR by merging main
    const updateSuccess = await updateExistingPR(issue, issue.repository)
    if (!updateSuccess) {
      log('❌', `Failed to update existing PR for issue ${issue.identifier}`, 'red')
    }
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
