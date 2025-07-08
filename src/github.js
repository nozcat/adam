const { Octokit } = require('@octokit/rest')
const simpleGit = require('simple-git')
const { log } = require('./util')

const TARGET_REPO = process.env.TARGET_REPO || process.cwd()
const git = simpleGit(TARGET_REPO)
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

function extractRepositoryFromDescription (description) {
  if (!description) return null

  const match = description.match(/REPOSITORY=([^/]+)\/([^\s]+)/)
  if (match) {
    return {
      owner: match[1],
      name: match[2]
    }
  }
  return null
}

async function ensureRepositoryExists (repoInfo) {
  if (!repoInfo) return false

  const repoPath = `./${repoInfo.name}`
  const fs = require('fs')

  if (fs.existsSync(repoPath)) {
    log('✅', `Repository ${repoInfo.name} already exists`, 'green')
    return true
  }

  try {
    const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.name}.git`
    log('📥', `Cloning repository ${repoInfo.owner}/${repoInfo.name}...`, 'blue')
    await simpleGit().clone(repoUrl, repoPath)
    log('✅', `Successfully cloned repository to ${repoPath}`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to clone repository: ${error.message}`, 'red')
    return false
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

async function createPR (issue, branchName, repoInfo) {
  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
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

async function findExistingBranchAndPR (issue, repoInfo) {
  try {
    const branchName = issue.branchName || `feature/${issue.identifier.toLowerCase()}`

    const branchExists = await checkBranchExists(branchName)

    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branchName}`,
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

async function handlePRFeedback (prNumber, branchName, repoInfo) {
  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber
    })

    const requestedChanges = reviews.filter(review => review.state === 'CHANGES_REQUESTED')

    if (requestedChanges.length > 0) {
      log('🔄', `PR #${prNumber} has requested changes, addressing feedback...`, 'yellow')

      await git.checkout(branchName)

      const feedbackSummary = requestedChanges.map(review =>
        `${review.user.login}: ${review.body}`
      ).join('\n\n')

      return {
        hasFeedback: true,
        feedbackSummary
      }
    }

    return {
      hasFeedback: false,
      feedbackSummary: null
    }
  } catch (error) {
    log('❌', `Error handling PR feedback: ${error.message}`, 'red')
    return {
      hasFeedback: false,
      feedbackSummary: null
    }
  }
}

async function getActivePRs (repoInfo) {
  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open'
    })

    return pulls.filter(pr => pr.body && pr.body.includes('Generated with Claude Code'))
  } catch (error) {
    log('❌', `Error getting active PRs: ${error.message}`, 'red')
    return []
  }
}

async function checkPRApproval (prNumber, repoInfo) {
  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    })

    if (pr.mergeable_state === 'ready' && pr.state === 'open') {
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber
      })

      const approvals = reviews.filter(review => review.state === 'APPROVED')
      const requestedChanges = reviews.filter(review => review.state === 'CHANGES_REQUESTED')

      if (approvals.length > 0 && requestedChanges.length === 0) {
        log('🎯', `PR #${prNumber} is approved, merging...`, 'green')

        await octokit.rest.pulls.merge({
          owner,
          repo,
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

module.exports = {
  extractRepositoryFromDescription,
  ensureRepositoryExists,
  checkBranchExists,
  createBranch,
  createPR,
  findExistingBranchAndPR,
  handlePRFeedback,
  getActivePRs,
  checkPRApproval
}
