require('dotenv').config()

const { callClaude } = require('./claude')
const { log } = require('./util')
const {
  extractRepositoryFromDescription,
  ensureRepositoryExists,
  createBranch,
  createPR,
  findExistingBranchAndPR,
  handlePRFeedback,
  getActivePRs,
  checkPRApproval
} = require('./github')
const {
  pollLinear,
  isIssueComplete
} = require('./linear')

const TARGET_REPO = process.env.TARGET_REPO || process.cwd()
const DEBUG = process.env.DEBUG === 'true'

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

async function main () {
  log('🚀', 'Starting Adam - Linear to GitHub automation agent', 'green')

  // Temporary: describe instruction.rs file
  // const prompt = 'Please describe the instruction.rs file'
  const prompt = 'Please implement the decode add instruction'
  const result = await callClaude(prompt, TARGET_REPO, DEBUG)
  // const { marked } = require('marked')

  // Main polling loop
  setInterval(async () => {
    await runPolling()
    // Note: monitorPRs now needs repoInfo, so we'll call it per repository
  }, 30000)

  // Run once immediately
  await runPolling()
}

if (require.main === module) {
  main().catch(error => {
    log('❌', `Application error: ${error.message}`, 'red')
    process.exit(1)
  })
}

module.exports = {
  processIssue,
  monitorPRs,
  runPolling,
  main
}
