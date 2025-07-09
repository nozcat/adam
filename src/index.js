require('dotenv').config()

const { callClaude } = require('./claude')
const { log } = require('./util')
const { ensureRepositoryExists, checkoutBranch } = require('./github')
const { pollLinear, getIssueShortName } = require('./linear')

const DEBUG = process.env.DEBUG === 'true'

/*
async function isIssueComplete (issue, repoInfo, findExistingBranchAndPR) {
  try {
    const { existingPR } = await findExistingBranchAndPR(issue, repoInfo)

    if (existingPR && existingPR.state === 'closed' && existingPR.merged) {
      return true
    }

    return false
  } catch (error) {
    log('⚠️', `Failed to check if issue is complete: ${error.message}`, 'yellow')
    return false
  }
}

async function processIssue (issue) {
  const issueId = issue.identifier

  const project = await issue.project()
  const repoInfo = extractRepositoryFromDescription(project?.description)

  if (!repoInfo) {
    log('⚠️', `No repository info found in project description for issue: ${issueId}`, 'yellow')
    return
  }

  const repoExists = await ensureRepositoryExists(repoInfo)
  if (!repoExists) {
    log('❌', `Failed to ensure repository exists for issue: ${issueId}`, 'red')
    return
  }

  const isComplete = await isIssueComplete(issue, repoInfo, findExistingBranchAndPR)
  if (isComplete) {
    return
  }

  log('🔄', `Processing issue: ${issueId} - ${issue.title}`, 'blue')

  const { branchName, existingPR } = await findExistingBranchAndPR(issue, repoInfo)

  if (existingPR && existingPR.state === 'open') {
    log('📋', `PR already exists for ${issueId}: ${existingPR.html_url}`, 'yellow')
    return
  }

  const branchCreated = await createBranch(branchName)
  if (!branchCreated) {
    return
  }

  const prompt = `Please implement the following issue:\n\nTitle: ${issue.title}\n\nDescription:\n${issue.description}\n\nPlease implement this feature completely and commit your changes when done.`
  const claudeSuccess = await callClaude(prompt, `./${repoInfo.name}`, DEBUG)
  if (!claudeSuccess) {
    log('❌', `Claude Code failed for issue: ${issueId}`, 'red')
    return
  }

  const pr = await createPR(issue, branchName, repoInfo)
  if (pr) {
    log('🎉', `Successfully completed issue: ${issueId}`, 'green')
  }
}

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

async function runPolling () {
  const issuesWithProjects = await pollLinear()
  const processedRepos = new Set()

  for (const { issue, project, projectName, projectDescription } of issuesWithProjects) {
    const repoInfo = extractRepositoryFromDescription(projectDescription)
    const repoDisplay = repoInfo ? `${repoInfo.owner}/${repoInfo.name}` : 'No Repository'

    log('📋', `Issue ${issue.identifier}: ${issue.title} (Project: ${projectName} - Repository: ${repoDisplay})`, 'cyan')

    await processIssue(issue)

    // Monitor PRs for each unique repository
    if (repoInfo && !processedRepos.has(`${repoInfo.owner}/${repoInfo.name}`)) {
      processedRepos.add(`${repoInfo.owner}/${repoInfo.name}`)
      await monitorPRs(repoInfo)
    }
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
  }

  // Checkout the branch for the issue.
  if (!await checkoutBranch(issue.branchName, issue.repository.name)) {
    log('❌', `Failed to checkout branch ${issue.branchName} for issue ${issue.identifier}`, 'red')
  }
}

main()
