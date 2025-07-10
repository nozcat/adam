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

/**
 * Gets all comments on a pull request (both line-specific and issue comments).
 *
 * @param {number} prNumber - The pull request number
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.owner - Repository owner/organization
 * @param {string} repoInfo.name - Repository name
 * @returns {Promise<Array|null>} - Array of comment objects, or null if failed
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 *
 * @example
 * const comments = await getPRComments(123, {
 *   owner: 'username',
 *   name: 'repo-name'
 * })
 * if (comments) {
 *   console.log(`Found ${comments.length} PR comments`)
 * }
 */
async function getPRComments (prNumber, repoInfo) {
  log('🔍', `Getting comments for PR #${prNumber}`, 'blue')

  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    if (!owner || !repo) {
      log('❌', 'Repository owner and name are required', 'red')
      return null
    }

    // Get line-specific review comments
    const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber
    })

    // Get general issue PR comments (non-line-specific)
    const { data: issueComments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber
    })

    const formattedReviewComments = await Promise.all(reviewComments.map(async comment => ({
      id: comment.id,
      type: 'review',
      user: comment.user.login,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      diff_hunk: comment.diff_hunk,
      in_reply_to_id: comment.in_reply_to_id || null,
      reactions: await getDetailedReactions(comment.id, 'review', owner, repo),
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      html_url: comment.html_url
    })))

    const formattedIssueComments = await Promise.all(issueComments.map(async comment => ({
      id: comment.id,
      type: 'issue',
      user: comment.user.login,
      body: comment.body,
      path: null,
      line: null,
      diff_hunk: null,
      in_reply_to_id: null,
      reactions: await getDetailedReactions(comment.id, 'issue', owner, repo),
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      html_url: comment.html_url
    })))

    const allComments = [...formattedReviewComments, ...formattedIssueComments]

    log('📝', `Found ${allComments.length} PR comments (${reviewComments.length} review, ${issueComments.length} issue) on PR #${prNumber}`, 'blue')

    return allComments
  } catch (error) {
    log('❌', `Failed to get PR comments: ${error.message}`, 'red')
    return null
  }
}

/**
 * Gets detailed reactions for a comment with user information.
 *
 * @param {number} commentId - The comment ID
 * @param {string} commentType - Either 'review' or 'issue'
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Object>} - Object with reactions grouped by emoji type
 */
async function getDetailedReactions (commentId, commentType, owner, repo) {
  try {
    const endpoint = commentType === 'review'
      ? octokit.rest.reactions.listForPullRequestReviewComment
      : octokit.rest.reactions.listForIssueComment

    const { data: reactions } = await endpoint({
      owner,
      repo,
      comment_id: commentId
    })

    // Group reactions by content (emoji type)
    const reactionsByEmoji = reactions.reduce((acc, reaction) => {
      const emoji = reaction.content
      if (!acc[emoji]) {
        acc[emoji] = []
      }
      acc[emoji].push({
        user: reaction.user.login,
        created_at: reaction.created_at
      })
      return acc
    }, {})

    return reactionsByEmoji
  } catch (error) {
    log('⚠️', `Failed to get reactions for comment ${commentId}: ${error.message}`, 'yellow')
    return {}
  }
}

/**
 * Updates an existing pull request by merging main and calling Claude to handle merge conflicts
 * @param {Object} issue - The issue object containing branch information
 * @param {Object} repoInfo - Repository information
 * @param {string} repoInfo.owner - The repository owner
 * @param {string} repoInfo.name - The repository name
 * @returns {Promise<boolean>} True if update was successful, false otherwise
 */
async function updateExistingPR (issue, repoInfo) {
  try {
    const repoPath = `./${repoInfo.name}`
    const git = simpleGit(repoPath)
    const baseBranch = process.env.BASE_BRANCH || 'main'

    // Checkout the PR branch
    await git.checkout(issue.branchName)
    log('🌿', `Checked out branch: ${issue.branchName}`, 'blue')

    // Pull latest changes from remote branch
    await git.pull('origin', issue.branchName)
    log('📥', `Pulled latest changes for branch: ${issue.branchName}`, 'blue')

    // Check if branch is behind main
    await git.fetch()

    const aheadCommits = await git.log([`HEAD..${baseBranch}`])

    if (aheadCommits.all.length > 0) {
      log('🔄', `Branch ${issue.branchName} is behind ${baseBranch}, merging...`, 'yellow')

      // Call Claude to handle the merge
      const mergePrompt = `
        The branch ${issue.branchName} is behind ${baseBranch} and needs to be updated.
        Please merge ${baseBranch} into the current branch and resolve any conflicts.
        
        Original issue context:
        ${issue.identifier}: ${issue.title}
        ${issue.description}
        
        Complete the merge and commit the changes.
      `

      const claudeSuccess = await callClaude(mergePrompt, repoPath, false)
      if (!claudeSuccess) {
        log('❌', `Claude failed to merge ${baseBranch} into ${issue.branchName}`, 'red')
        return false
      }

      // Verify the merge was completed
      const postMergeStatus = await git.status()
      if (postMergeStatus.conflicted.length > 0) {
        log('❌', 'Merge conflicts still exist after Claude processing', 'red')
        return false
      }

      // Push the updated branch
      await git.push('origin', issue.branchName)
      log('📤', `Pushed updated branch ${issue.branchName} to remote`, 'green')

      log('✅', `Successfully updated PR for ${issue.identifier}`, 'green')
      return true
    } else {
      log('✅', `Branch ${issue.branchName} is up to date with ${baseBranch}`, 'green')
      return true
    }
  } catch (error) {
    log('❌', `Failed to update existing PR: ${error.message}`, 'red')
    return false
  }
}

/**
 * Posts a reply comment to a GitHub pull request.
 *
 * @param {number} prNumber - The pull request number
 * @param {string} body - The comment body text
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.owner - Repository owner/organization
 * @param {string} repoInfo.name - Repository name
 * @returns {Promise<Object|null>} - The created comment object, or null if failed
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 *
 * @example
 * const comment = await postPRComment(123, 'Thanks for the feedback!', {
 *   owner: 'username',
 *   name: 'repo-name'
 * })
 */
async function postPRComment (prNumber, body, repoInfo) {
  log('💬', `Posting comment to PR #${prNumber}`, 'blue')

  try {
    const owner = repoInfo?.owner || process.env.GITHUB_OWNER
    const repo = repoInfo?.name || process.env.GITHUB_REPO

    if (!owner || !repo) {
      log('❌', 'Repository owner and name are required', 'red')
      return null
    }

    // Post the comment to the PR
    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body
    })

    log('✅', `Successfully posted comment to PR #${prNumber}`, 'green')
    return comment
  } catch (error) {
    log('❌', `Failed to post comment to PR #${prNumber}: ${error.message}`, 'red')
    return null
  }
}

module.exports = {
  ensureRepositoryExists,
  checkoutBranch,
  createPR,
  findExistingPR,
  updateExistingPR,
  getPRComments,
  getDetailedReactions,
  postPRComment
}
