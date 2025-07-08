require('dotenv').config()

const { LinearClient } = require('@linear/sdk')
const { Octokit } = require('@octokit/rest')
const simpleGit = require('simple-git')
const { callClaude } = require('./claude')
const { log } = require('./util')

const TARGET_REPO = process.env.TARGET_REPO || process.cwd()
const DEBUG = process.env.DEBUG === 'true'
const git = simpleGit(TARGET_REPO)
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

async function findExistingBranchAndPR (issue) {
  try {
    const branchName = issue.branchName || `feature/${issue.identifier.toLowerCase()}`

    const branchExists = await checkBranchExists(branchName)

    const { data: pulls } = await octokit.rest.pulls.list({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      head: `${process.env.GITHUB_OWNER}:${branchName}`,
      state: 'all'
    })

    const existingPR = pulls.length > 0 ? pulls[0] : null

    return {
      branchName,
      branchExists,
      existingPR
    }
  } catch (error) {
    log('⚠️', `Failed to check existing branch/PR: ${error.message}`, 'yellow')
    return {
      branchName: issue.branchName || `feature/${issue.identifier.toLowerCase()}`,
      branchExists: false,
      existingPR: null
    }
  }
}

async function checkBranchExists (branchName) {
  try {
    const branches = await git.branch(['--all'])
    return branches.all.some(branch =>
      branch.includes(branchName) || branch.includes(`origin/${branchName}`)
    )
  } catch (error) {
    log('⚠️', `Failed to check branch existence: ${error.message}`, 'yellow')
    return false
  }
}

async function createBranch (branchName) {
  try {
    const exists = await checkBranchExists(branchName)
    if (exists) {
      log('🌿', `Branch ${branchName} already exists, checking out...`, 'yellow')
      await git.checkout(branchName)
      return true
    }

    await git.checkout(process.env.BASE_BRANCH || 'main')
    await git.pull()
    await git.checkoutLocalBranch(branchName)
    log('🌿', `Created and switched to branch: ${branchName}`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to create branch: ${error.message}`, 'red')
    return false
  }
}

async function createPR (issue, branchName) {
  try {
    const { data: pr } = await octokit.rest.pulls.create({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      title: `${issue.identifier}: ${issue.title}`,
      head: branchName,
      base: process.env.BASE_BRANCH || 'main',
      body: `Fixes Linear issue: ${issue.identifier}\n\n${issue.description}\n\n🤖 Generated with Claude Code`
    })

    log('📝', `Created PR: ${pr.html_url}`, 'green')
    return pr
  } catch (error) {
    log('❌', `Failed to create PR: ${error.message}`, 'red')
    return null
  }
}

async function isIssueComplete (issue) {
  try {
    const { existingPR } = await findExistingBranchAndPR(issue)

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

  const isComplete = await isIssueComplete(issue)
  if (isComplete) {
    return
  }

  log('🔄', `Processing issue: ${issueId} - ${issue.title}`, 'blue')

  const { branchName, existingPR } = await findExistingBranchAndPR(issue)

  if (existingPR && existingPR.state === 'open') {
    log('📋', `PR already exists for ${issueId}: ${existingPR.html_url}`, 'yellow')
    return
  }

  const branchCreated = await createBranch(branchName)
  if (!branchCreated) {
    return
  }

  const prompt = `Please implement the following issue:\n\nTitle: ${issue.title}\n\nDescription:\n${issue.description}\n\nPlease implement this feature completely and commit your changes when done.`
  const claudeSuccess = await callClaude(prompt, TARGET_REPO, DEBUG)
  if (!claudeSuccess) {
    log('❌', `Claude Code failed for issue: ${issueId}`, 'red')
    return
  }

  const pr = await createPR(issue, branchName)
  if (pr) {
    log('🎉', `Successfully completed issue: ${issueId}`, 'green')
  }
}

async function handlePRFeedback (prNumber, branchName) {
  try {
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      pull_number: prNumber
    })

    const requestedChanges = reviews.filter(review => review.state === 'CHANGES_REQUESTED')

    if (requestedChanges.length > 0) {
      log('🔄', `PR #${prNumber} has requested changes, addressing feedback...`, 'yellow')

      await git.checkout(branchName)

      const feedbackSummary = requestedChanges.map(review =>
        `${review.user.login}: ${review.body}`
      ).join('\n\n')

      const feedbackPrompt = `Please address the following PR feedback:\n\n${feedbackSummary}`
      const claudeSuccess = await callClaude(feedbackPrompt, TARGET_REPO, DEBUG)

      if (claudeSuccess) {
        log('✅', `Successfully addressed feedback for PR #${prNumber}`, 'green')
        return true
      } else {
        log('❌', `Failed to address feedback for PR #${prNumber}`, 'red')
        return false
      }
    }

    return true
  } catch (error) {
    log('❌', `Error handling PR feedback: ${error.message}`, 'red')
    return false
  }
}

async function checkPRApproval (prNumber) {
  try {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      pull_number: prNumber
    })

    if (pr.mergeable_state === 'ready' && pr.state === 'open') {
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        pull_number: prNumber
      })

      const approvals = reviews.filter(review => review.state === 'APPROVED')
      const requestedChanges = reviews.filter(review => review.state === 'CHANGES_REQUESTED')

      if (approvals.length > 0 && requestedChanges.length === 0) {
        log('🎯', `PR #${prNumber} is approved, merging...`, 'green')

        await octokit.rest.pulls.merge({
          owner: process.env.GITHUB_OWNER,
          repo: process.env.GITHUB_REPO,
          pull_number: prNumber,
          merge_method: 'squash'
        })

        log('🎉', `Successfully merged PR #${prNumber}`, 'green')
        return true
      }
    }

    return false
  } catch (error) {
    log('❌', `Error checking PR approval: ${error.message}`, 'red')
    return false
  }
}

async function getActivePRs () {
  try {
    const { data: pulls } = await octokit.rest.pulls.list({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      state: 'open'
    })

    return pulls.filter(pr => pr.body && pr.body.includes('Generated with Claude Code'))
  } catch (error) {
    log('❌', `Error getting active PRs: ${error.message}`, 'red')
    return []
  }
}

async function monitorPRs () {
  try {
    const activePRs = await getActivePRs()

    for (const pr of activePRs) {
      await handlePRFeedback(pr.number, pr.head.ref)
      await checkPRApproval(pr.number)
    }
  } catch (error) {
    log('❌', `Error monitoring PRs: ${error.message}`, 'red')
  }
}

async function pollLinear () {
  log('🔄', 'Polling Linear...', 'blue')

  try {
    const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
    const user = await linearClient.viewer

    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: user.id } },
        state: { name: { nin: ['Done', 'Canceled'] } }
      }
    })

    log('👀', `Found ${issues.nodes.length} assigned issues`, 'blue')

    for (const issue of issues.nodes) {
      await processIssue(issue)
    }
  } catch (error) {
    log('❌', `Error polling Linear: ${error.message}`, 'red')
  }
}

async function main () {
  log('🚀', 'Starting Adam - Linear to GitHub automation agent', 'green')

  // Temporary: describe instruction.rs file
  // const prompt = 'Please describe the instruction.rs file'
  const prompt = 'Please implement the decode add instruction'
  const result = await callClaude(prompt, TARGET_REPO, DEBUG)
  // const { marked } = require('marked')
  // console.log('Claude result:', marked.parse(result).trim())

  /* Original main function - temporarily disabled
  const interval = parseInt(process.env.POLLING_INTERVAL_MS) || 30000
  log('⏰', 'blue', `Checking for things to do every ${interval / 1000} seconds`)

  while (true) {
    const startTime = Date.now()

    await pollLinear()
    await monitorPRs()

    const elapsed = Date.now() - startTime
    const remaining = interval - elapsed
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining))
    }
  }
  */
}

main().catch(console.error)
