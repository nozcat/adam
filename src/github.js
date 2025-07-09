const { Octokit } = require('@octokit/rest')
const simpleGit = require('simple-git')
const { log } = require('./util')
const { callClaude } = require('./claude')

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

/**
 * Ensures a GitHub repository exists locally by cloning it if not present.
 * Authenticates using GitHub token and configures git user credentials for commits.
 *
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.name - Repository name
 * @param {string} repoInfo.owner - Repository owner/organization
 * @returns {Promise<boolean>} - True if repository exists/was cloned successfully, false otherwise
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 * - GITHUB_USERNAME: GitHub username for commit attribution
 * - GITHUB_EMAIL: Email address for commit attribution
 *
 * @example
 * const success = await ensureRepositoryExists({
 *   name: 'my-repo',
 *   owner: 'username'
 * })
 */
async function ensureRepositoryExists (repoInfo) {
  if (!repoInfo) return false

  const repoPath = `./${repoInfo.name}`
  const fs = require('fs')

  if (fs.existsSync(repoPath)) {
    return true
  }

  try {
    const username = process.env.GITHUB_USERNAME
    const email = process.env.GITHUB_EMAIL
    const token = process.env.GITHUB_TOKEN

    if (!username || !email || !token) {
      log('❌', 'GitHub credentials not configured. Please set GITHUB_USERNAME, GITHUB_EMAIL, and GITHUB_TOKEN in your environment.', 'red')
      return false
    }

    const repoUrl = `https://${token}@github.com/${repoInfo.owner}/${repoInfo.name}.git`
    log('📥', `Cloning repository ${repoInfo.owner}/${repoInfo.name}...`, 'blue')

    const git = simpleGit()
    await git.clone(repoUrl, repoPath)

    const repoGit = simpleGit(repoPath)
    await repoGit.addConfig('user.name', username)
    await repoGit.addConfig('user.email', email)

    log('✅', `Successfully cloned repository to ${repoPath} and configured user credentials`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to clone repository: ${error.message}`, 'red')
    return false
  }
}

/**
 * Checks if a Git branch exists in the specified repository.
 * Searches both local and remote branches for the given branch name.
 *
 * @param {string} branchName - The name of the branch to check for existence
 * @param {string} repoPath - The path to the repository directory
 * @returns {Promise<boolean>} - True if the branch exists locally or remotely, false otherwise
 *
 * @example
 * const exists = await checkBranchExists('feature/new-feature', './my-repo')
 * if (exists) {
 *   console.log('Branch exists')
 * }
 */
async function checkBranchExists (branchName, repoPath) {
  try {
    const git = simpleGit(repoPath)
    const branches = await git.branch(['--all'])
    return branches.all.some(branch =>
      branch.includes(branchName) || branch.includes(`origin/${branchName}`)
    )
  } catch (error) {
    log('⚠️', `Failed to check branch existence: ${error.message}`, 'yellow')
    return false
  }
}

/**
 * Checks out an existing Git branch or creates a new one if it doesn't exist.
 * If the branch exists, it switches to it. If not, it creates a new branch from
 * the base branch (main by default) and switches to it.
 *
 * @param {string} branchName - The name of the branch to checkout or create
 * @param {string} repoPath - The path to the repository directory
 * @returns {Promise<boolean>} - True if the branch was successfully checked out or created, false otherwise
 *
 * @requires Environment variables:
 * - BASE_BRANCH (optional): The base branch to create new branches from (defaults to 'main')
 *
 * @example
 * const success = await checkoutBranch('feature/new-feature', './my-repo')
 * if (success) {
 *   console.log('Successfully switched to branch')
 * }
 */
async function checkoutBranch (branchName, repoPath) {
  try {
    const git = simpleGit(repoPath)
    const exists = await checkBranchExists(branchName, repoPath)
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

/**
 * Creates a GitHub pull request with an AI-generated description based on recent commits.
 * Uses Claude to analyze recent commits and generate a meaningful PR description.
 *
 * @param {Object} issue - The issue object containing identifier, title, and description
 * @param {string} issue.identifier - The issue identifier (e.g., "PROJ-123")
 * @param {string} issue.title - The issue title
 * @param {string} issue.description - The issue description
 * @param {string} branchName - The name of the branch to create the PR from
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.owner - Repository owner/organization
 * @param {string} repoInfo.name - Repository name
 * @returns {Promise<Object|null>} - The created PR object from GitHub API, or null if failed
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 * - GITHUB_OWNER: Default repository owner (optional if provided in repoInfo)
 * - GITHUB_REPO: Default repository name (optional if provided in repoInfo)
 * - BASE_BRANCH: The base branch for PRs (defaults to 'main')
 */
async function createPR (issue, branchName, repoInfo) {
  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO
    const baseBranch = process.env.BASE_BRANCH || 'main'
    const repoPath = `./${repoInfo?.name || process.env.GITHUB_REPO}`

    // Push the branch to remote before creating PR
    const git = simpleGit(repoPath)
    await git.push('origin', branchName)
    log('📤', `Pushed branch ${branchName} to remote`, 'blue')

    // Generate the good PR description.
    const prDescription = await generatePRDescription(issue, baseBranch, repoPath)

    // Create the PR.
    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `${issue.identifier}: ${issue.title}`,
      head: branchName,
      base: baseBranch,
      body: prDescription
    })

    log('📝', `Created PR: ${pr.html_url}`, 'green')
    return pr
  } catch (error) {
    log('❌', `Failed to create PR: ${error.message}`, 'red')
    return null
  }
}

/**
 * Generates a PR description using Claude based on recent commits and issue context.
 * Falls back to a default description if Claude fails or no commits are found.
 *
 * @param {Object} issue - The issue object containing identifier, title, and description
 * @param {string} baseBranch - The base branch to compare commits against
 * @param {string} repoPath - The path to the repository directory
 * @returns {Promise<string>} - The generated PR description
 */
async function generatePRDescription (issue, baseBranch, repoPath) {
  const defaultDescription = `Fixes Linear issue: ${issue.identifier}\n\n${issue.description}\n\n🤖 Generated with Claude Code`

  try {
    const git = simpleGit(repoPath)
    const commits = await git.log(['--oneline', `${baseBranch}..HEAD`])

    if (commits.all.length === 0) {
      return defaultDescription
    }

    const commitList = commits.all.map(commit => `- ${commit.hash}`).join('\n')
    const prompt = `
Generate and return a concise PR description based on these recent commits.
Focus on what was changed and why. Return only the description without any preamble or explanation.

Recent commits:
${commitList}

Issue context:
${issue.identifier}: ${issue.title}
${issue.description}`

    const claudeDescription = await callClaude(prompt, repoPath, false)
    if (claudeDescription && claudeDescription.trim()) {
      return claudeDescription.trim()
    }

    return defaultDescription
  } catch (error) {
    log('⚠️', `Failed to generate PR description: ${error.message}`, 'yellow')
    return defaultDescription
  }
}

/**
 * Finds an existing pull request for the given issue's branch
 * @param {Object} issue - The issue object containing branch information
 * @param {string} issue.branchName - The name of the branch to search for
 * @param {Object} repoInfo - Repository information
 * @param {string} repoInfo.owner - The repository owner
 * @param {string} repoInfo.name - The repository name
 * @returns {Promise<Object|null>} The existing PR object if found, null otherwise
 */
async function findExistingPR (issue, repoInfo) {
  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${issue.branchName}`,
      state: 'all'
    })

    const existingPR = pulls.length > 0 ? pulls[0] : null

    return existingPR
  } catch (error) {
    log('⚠️', `Failed to check existing branch/PR: ${error.message}`, 'yellow')
    return null
  }
}

/*

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
*/

module.exports = {
  ensureRepositoryExists,
  checkoutBranch,
  createPR,
  findExistingPR
}
