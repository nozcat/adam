const { Octokit } = require('@octokit/rest')
const simpleGit = require('simple-git')
const { log, getRepoPath, getEnvVar } = require('./util')
const { callClaude } = require('./claude')

const octokit = new Octokit({ auth: getEnvVar('GITHUB_TOKEN') })

/**
 * Handles intelligent merging of a base branch into current branch using Claude.
 * Preserves the original PR intention while resolving conflicts.
 *
 * @param {Object} git - Simple-git instance
 * @param {string} branchName - The current branch name
 * @param {string} baseBranch - The base branch to merge from (e.g., 'main')
 * @param {Object} issue - Issue object containing PR context
 * @param {string} issue.identifier - Issue identifier
 * @param {string} issue.title - Issue title
 * @param {string} issue.description - Issue description
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<boolean>} True if merge was successful, false otherwise
 */
async function performIntelligentMerge (git, branchName, baseBranch, issue, repoPath) {
  const mergePrompt = `
    The branch ${branchName} is behind ${baseBranch} and needs to be updated before pushing.
    Please merge origin/${baseBranch} into the current branch and resolve any conflicts.
    
    IMPORTANT: Preserve the original goal of this PR while merging:
    ${issue.identifier}: ${issue.title}
    ${issue.description}
    
    Make sure none of the changes being merged in from origin/${baseBranch} conflict with or affect the original goal of this PR.
    If there are conflicts, resolve them in favor of preserving the original PR functionality.
    
    Complete the merge and commit the changes.
  `

  const claudeSuccess = await callClaude(mergePrompt, repoPath, false)
  if (!claudeSuccess) {
    log('❌', `Claude failed to merge ${baseBranch} into ${branchName}`, 'red')
    return false
  }

  // Verify the merge was completed
  const postMergeStatus = await git.status()
  if (postMergeStatus.conflicted.length > 0) {
    log('❌', 'Merge conflicts still exist after Claude processing', 'red')
    return false
  }

  log('✅', `Successfully merged ${baseBranch} into ${branchName}`, 'green')
  return true
}

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

  const repoPath = getRepoPath(repoInfo.name)
  const fs = require('fs')

  if (fs.existsSync(repoPath)) {
    return true
  }

  try {
    const username = getEnvVar('GITHUB_USERNAME')
    const email = getEnvVar('GITHUB_EMAIL')
    const token = getEnvVar('GITHUB_TOKEN')

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
 * Clones all repositories specified in the REPOS environment variable.
 * REPOS should be a comma-separated list of repositories in the format: owner/repo-name
 *
 * @returns {Promise<void>}
 *
 * @example
 * // With REPOS="facebook/react,vuejs/vue"
 * await cloneReposFromEnv() // Clones both react and vue repositories
 */
async function cloneReposFromEnv () {
  const reposEnv = getEnvVar('REPOS')
  if (!reposEnv || reposEnv.trim() === '') {
    log('⚠️', 'No repositories configured in REPOS environment variable', 'yellow')
    return
  }

  const repos = reposEnv.split(',').map(r => r.trim()).filter(r => r)
  log('📦', `Found ${repos.length} repositories to clone from REPOS environment variable`, 'blue')

  for (const repoString of repos) {
    const [owner, name] = repoString.split('/')
    if (!owner || !name) {
      log('⚠️', `Invalid repository format: ${repoString}. Expected format: owner/repo-name`, 'yellow')
      continue
    }

    const repoInfo = { owner, name }
    const success = await ensureRepositoryExists(repoInfo)
    if (!success) {
      log('❌', `Failed to clone repository: ${repoString}`, 'red')
    }
  }

  log('✅', 'Finished processing repositories from REPOS environment variable', 'green')
}

/**
 * Gets the list of allowed repositories from the REPOS environment variable.
 *
 * @returns {Set<string>} A set of repository strings in the format "owner/repo-name"
 */
function getAllowedRepos () {
  const reposEnv = getEnvVar('REPOS')
  if (!reposEnv || reposEnv.trim() === '') {
    return new Set()
  }

  const repos = reposEnv.split(',')
    .map(r => r.trim())
    .filter(r => r && r.includes('/'))

  return new Set(repos)
}

/**
 * Checks if a repository is in the allowed REPOS list.
 *
 * @param {string} owner - Repository owner
 * @param {string} name - Repository name
 * @returns {boolean} True if the repository is allowed, false otherwise
 */
function isRepoAllowed (owner, name) {
  const allowedRepos = getAllowedRepos()
  if (allowedRepos.size === 0) {
    // If REPOS is not configured, allow all repositories (backward compatibility)
    return true
  }

  const repoString = `${owner}/${name}`
  return allowedRepos.has(repoString)
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
 * Detects and clears any incomplete merge state that could interfere with branch operations.
 * This resolves errors like "needs merge" or "you need to resolve your current index first".
 *
 * @param {Object} git - SimpleGit instance
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<boolean>} - True if merge state was cleared, false if none existed
 */
async function clearMergeState (git, repoPath) {
  try {
    const fs = require('fs')
    const path = require('path')

    // Check for merge-related files that indicate an incomplete merge
    const mergeFiles = [
      path.join(repoPath, '.git/MERGE_HEAD'),
      path.join(repoPath, '.git/MERGE_MSG'),
      path.join(repoPath, '.git/CHERRY_PICK_HEAD'),
      path.join(repoPath, '.git/REVERT_HEAD')
    ]

    const mergeInProgress = mergeFiles.some(file => fs.existsSync(file))

    if (mergeInProgress) {
      log('🔄', 'Detected incomplete merge state, clearing...', 'yellow')

      // Abort any in-progress merge operations
      try {
        await git.raw(['merge', '--abort'])
        log('✅', 'Successfully aborted incomplete merge', 'green')
      } catch (error) {
        // If merge --abort fails, try other cleanup methods
        try {
          await git.raw(['cherry-pick', '--abort'])
        } catch (cherryPickError) {
          // Ignore if no cherry-pick in progress
        }

        try {
          await git.raw(['revert', '--abort'])
        } catch (revertError) {
          // Ignore if no revert in progress
        }

        // Reset to a clean state
        await git.reset(['--hard', 'HEAD'])
        log('✅', 'Successfully reset to clean state', 'green')
      }

      return true
    }

    return false
  } catch (error) {
    log('⚠️', `Error clearing merge state: ${error.message}`, 'yellow')
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

    // Clear any incomplete merge state that could interfere with branch operations
    await clearMergeState(git, repoPath)

    const exists = await checkBranchExists(branchName, repoPath)
    if (exists) {
      log('🌿', `Branch ${branchName} already exists, checking out...`, 'yellow')
      await git.checkout(branchName)

      // Fetch latest refs and reset to remote branch
      log('📥', `Fetching latest changes and resetting to remote branch: ${branchName}`, 'blue')
      try {
        // Fetch latest refs from remote
        await git.fetch('origin', branchName)

        // Reset to match remote exactly (discarding any local changes)
        await git.reset(['--hard', `origin/${branchName}`])
        log('✅', `Successfully reset to remote branch: origin/${branchName}`, 'green')
      } catch (resetError) {
        // Check if the error is because the remote branch doesn't exist
        if (resetError.message.includes("couldn't find remote ref") ||
            resetError.message.includes('does not exist')) {
          log('🔄', `Remote branch ${branchName} doesn't exist, resetting to base branch`, 'yellow')
          const baseBranch = process.env.BASE_BRANCH || 'main'
          await git.reset(['--hard', `origin/${baseBranch}`])
          log('✅', `Successfully reset branch ${branchName} to ${baseBranch}`, 'green')
        } else {
          log('⚠️', `Could not reset to remote branch ${branchName}: ${resetError.message}`, 'yellow')
          log('ℹ️', 'This might be expected if the branch only exists locally', 'blue')
        }
      }

      return true
    }

    // Create new branch from base branch
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
 * - BASE_BRANCH: The base branch for PRs (defaults to 'main')
 */
async function createPR (issue, branchName, repoInfo) {
  try {
    const { owner, name: repo } = repoInfo
    const baseBranch = process.env.BASE_BRANCH || 'main'
    const repoPath = getRepoPath(repoInfo.name)

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
You are writing a PR description. Write a concise description based on these recent commits.
Focus on what was changed and why. Do not include any introductory text, preambles, or explanations - start directly with the description content.

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
 * Finds an existing pull request for the given issue's branch (open or merged)
 *
 * @param {Object} issue - The issue object containing branch information
 * @param {string} issue.branchName - The name of the branch to search for
 * @param {Object} repoInfo - Repository information
 * @param {string} repoInfo.owner - The repository owner
 * @param {string} repoInfo.name - The repository name
 * @returns {Promise<Object|null>} The existing PR object if found, null otherwise
 */
async function findExistingPR (issue, repoInfo) {
  try {
    const { owner, name: repo } = repoInfo

    // First check for open PRs
    const { data: openPulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${issue.branchName}`,
      state: 'open'
    })

    if (openPulls.length > 0) {
      return openPulls[0]
    }

    // Check for closed/merged PRs to detect race conditions
    const { data: closedPulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${issue.branchName}`,
      state: 'closed'
    })

    const mergedPR = closedPulls.find(pr => pr.merged)
    if (mergedPR) {
      log('⚠️', `Found previously merged PR for issue ${issue.identifier}: ${mergedPR.html_url}`, 'yellow')
      log('🛑', `Issue ${issue.identifier} appears to have been completed already - skipping work to avoid race condition`, 'yellow')
      // Return a special object to indicate this case
      return { merged: true, url: mergedPR.html_url }
    }

    return null
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
    const { owner, name: repo } = repoInfo

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
    const repoPath = getRepoPath(repoInfo.name)
    const git = simpleGit(repoPath)

    // Checkout the PR branch
    await git.checkout(issue.branchName)
    log('🌿', `Checked out branch: ${issue.branchName}`, 'blue')

    // Pull latest changes from remote branch
    await git.pull('origin', issue.branchName)
    log('📥', `Pulled latest changes for branch: ${issue.branchName}`, 'blue')

    // Use the shared merge helper function
    const mergeResult = await mergeOriginIfNecessary(git, issue.branchName, issue, repoPath)
    if (!mergeResult.success) {
      return false
    }

    // Only push if there were changes (merge occurred)
    if (mergeResult.merged) {
      await git.push('origin', issue.branchName)
      log('📤', `Pushed updated branch ${issue.branchName} to remote`, 'green')
    }

    log('✅', `Successfully updated PR for ${issue.identifier}`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to update existing PR: ${error.message}`, 'red')
    return false
  }
}

/**
 * Posts a reply to a review comment on a GitHub pull request.
 *
 * @param {number} prNumber - The pull request number
 * @param {number} inReplyToId - The review comment ID to reply to
 * @param {string} body - The reply body text
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.owner - Repository owner/organization
 * @param {string} repoInfo.name - Repository name
 * @returns {Promise<Object|null>} - The created reply comment object, or null if failed
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 *
 * @example
 * const reply = await postReviewCommentReply(123, 456, 'Good point!', {
 *   owner: 'username',
 *   name: 'repo-name'
 * })
 */
async function postReviewCommentReply (prNumber, inReplyToId, body, repoInfo) {
  log('💬', `Posting review comment reply to PR #${prNumber}`, 'blue')

  try {
    const { owner, name: repo } = repoInfo

    // Post the reply to the review comment
    const { data: comment } = await octokit.rest.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: prNumber,
      comment_id: inReplyToId,
      body
    })

    log('✅', `Successfully posted review comment reply to PR #${prNumber}`, 'green')
    return comment
  } catch (error) {
    log('❌', `Failed to post review comment reply to PR #${prNumber}: ${error.message}`, 'red')
    return null
  }
}

/**
 * Posts a comment to a GitHub pull request, optionally quoting another comment.
 *
 * @param {number} prNumber - The pull request number
 * @param {string} body - The comment body text
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.owner - Repository owner/organization
 * @param {string} repoInfo.name - Repository name
 * @param {Object} [quotedComment] - Optional comment to quote
 * @param {string} quotedComment.user - The author of the quoted comment
 * @param {string} quotedComment.body - The body of the quoted comment
 * @returns {Promise<Object|null>} - The created comment object, or null if failed
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 *
 * @example
 * const comment = await postPRComment(123, 'Thanks for the feedback!', {
 *   owner: 'username',
 *   name: 'repo-name'
 * }, { user: 'reviewer', body: 'This needs improvement' })
 */
async function postPRComment (prNumber, body, repoInfo, quotedComment = null) {
  log('💬', `Posting comment to PR #${prNumber}`, 'blue')

  try {
    const { owner, name: repo } = repoInfo

    let finalBody = body

    // If quoting a comment, prepend the quote
    if (quotedComment) {
      const quotedText = quotedComment.body
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')

      finalBody = `> **@${quotedComment.user} said:**\n${quotedText}\n\n${body}`
    }

    // Post the comment to the PR
    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: finalBody
    })

    log('✅', `Successfully posted comment to PR #${prNumber}`, 'green')
    return comment
  } catch (error) {
    log('❌', `Failed to post comment to PR #${prNumber}: ${error.message}`, 'red')
    return null
  }
}

/**
 * Adds a reaction to a GitHub comment.
 *
 * @param {number} commentId - The comment ID to react to
 * @param {string} commentType - Either 'review' or 'issue'
 * @param {string} reaction - The reaction emoji (e.g., 'eyes', '+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket')
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.owner - Repository owner/organization
 * @param {string} repoInfo.name - Repository name
 * @returns {Promise<boolean>} - True if reaction was added successfully, false otherwise
 *
 * @requires Environment variables:
 * - GITHUB_TOKEN: GitHub personal access token with repo scope
 *
 * @example
 * const success = await addCommentReaction(123, 'review', 'eyes', {
 *   owner: 'username',
 *   name: 'repo-name'
 * })
 */
async function addCommentReaction (commentId, commentType, reaction, repoInfo) {
  log('👁️', `Adding ${reaction} reaction to ${commentType} comment ${commentId}`, 'blue')

  try {
    const { owner, name: repo } = repoInfo

    if (commentType === 'review') {
      // Add reaction to review comment
      await octokit.rest.reactions.createForPullRequestReviewComment({
        owner,
        repo,
        comment_id: commentId,
        content: reaction
      })
    } else {
      // Add reaction to issue comment
      await octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        content: reaction
      })
    }

    log('✅', `Successfully added ${reaction} reaction to ${commentType} comment ${commentId}`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to add reaction to ${commentType} comment ${commentId}: ${error.message}`, 'red')
    return false
  }
}

/**
 * Pushes the current branch to the remote repository.
 *
 * @param {string} branchName - The name of the branch to push
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.name - Repository name
 * @returns {Promise<boolean>} - True if push was successful, false otherwise
 *
 * @example
 * const success = await pushBranch('feature-branch', {
 *   name: 'my-repo'
 * })
 */
async function pushBranch (branchName, repoInfo) {
  log('📤', `Pushing branch ${branchName} to remote`, 'blue')

  try {
    const repoPath = getRepoPath(repoInfo.name)
    const git = simpleGit(repoPath)

    // Push the branch to origin
    await git.push('origin', branchName)

    log('✅', `Successfully pushed branch ${branchName} to remote`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to push branch ${branchName}: ${error.message}`, 'red')
    return false
  }
}

/**
 * Merges origin base branch into current branch if necessary.
 * Checks if the current branch is behind the base branch and performs intelligent merge if needed.
 *
 * @param {Object} git - Simple-git instance
 * @param {string} branchName - The current branch name
 * @param {Object} issue - The issue object containing PR context for intelligent merging
 * @param {string} issue.identifier - The issue identifier
 * @param {string} issue.title - The issue title
 * @param {string} issue.description - The issue description
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<Object>} - Object with success (boolean) and merged (boolean) indicating if merge occurred
 */
async function mergeOriginIfNecessary (git, branchName, issue, repoPath) {
  const baseBranch = process.env.BASE_BRANCH || 'main'

  // Fetch latest changes
  await git.fetch()

  // Check if we need to merge with base branch
  const behindCommits = await git.log([`HEAD..origin/${baseBranch}`])

  if (behindCommits.all.length > 0) {
    log('🔄', `Branch ${branchName} is behind ${baseBranch} by ${behindCommits.all.length} commits, merging intelligently...`, 'yellow')

    // Use the shared intelligent merge helper
    const mergeSuccess = await performIntelligentMerge(git, branchName, baseBranch, issue, repoPath)
    if (!mergeSuccess) {
      return { success: false, merged: false }
    }
    return { success: true, merged: true }
  } else {
    log('✅', `Branch ${branchName} is up to date with ${baseBranch}`, 'green')
    return { success: true, merged: false }
  }
}

/**
 * Pushes the current branch to remote and merges if push fails due to conflicts.
 * Uses intelligent merging that preserves the original PR intention.
 *
 * @param {string} branchName - The name of the branch to push
 * @param {Object} repoInfo - Repository information object
 * @param {string} repoInfo.name - Repository name
 * @param {Object} issue - The issue object containing PR context for intelligent merging
 * @param {string} issue.identifier - The issue identifier
 * @param {string} issue.title - The issue title
 * @param {string} issue.description - The issue description
 * @returns {Promise<boolean>} - True if push was successful (with or without merge), false otherwise
 */
async function pushBranchAndMergeIfNecessary (branchName, repoInfo, issue) {
  log('📤', `Attempting to push branch ${branchName} to remote`, 'blue')

  try {
    const repoPath = getRepoPath(repoInfo.name)
    const git = simpleGit(repoPath)

    // First, try a simple push
    await git.push('origin', branchName)
    log('✅', `Successfully pushed branch ${branchName} to remote`, 'green')
    return true
  } catch (pushError) {
    log('⚠️', `Push failed: ${pushError.message}`, 'yellow')
    log('🔄', 'Attempting to pull and merge before pushing again...', 'blue')

    try {
      const repoPath = getRepoPath(repoInfo.name)
      const git = simpleGit(repoPath)

      // Use the shared merge helper function
      const mergeResult = await mergeOriginIfNecessary(git, branchName, issue, repoPath)
      if (!mergeResult.success) {
        return false
      }

      // Try pushing again
      await git.push('origin', branchName)
      log('✅', `Successfully pushed branch ${branchName} to remote after merge`, 'green')
      return true
    } catch (mergeError) {
      log('❌', `Failed to merge and push branch ${branchName}: ${mergeError.message}`, 'red')
      return false
    }
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
  postPRComment,
  postReviewCommentReply,
  addCommentReaction,
  pushBranch,
  pushBranchAndMergeIfNecessary,
  cloneReposFromEnv,
  isRepoAllowed
}
