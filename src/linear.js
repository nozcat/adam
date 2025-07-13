const { LinearClient } = require('@linear/sdk')
const { log } = require('./util')

// Initialize the Linear client.
const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })

/**
 * Poll Linear for assigned issues.
 *
 * @returns {Promise<Array>} A list of issues with the repository information.
 */
async function pollLinear () {
  log('🔄', 'Polling Linear...', 'blue')

  try {
    const issues = await getAssignedIssues()

    for (const issue of issues) {
      issue.repository = await getRepositoryFromIssue(issue)
    }

    return issues
  } catch (error) {
    log('❌', `Error polling Linear: ${error.message}`, 'red')
    return []
  }
}

/**
 * Check if an issue is blocked by other issues.
 *
 * @param {Object} issue - The issue to check.
 * @returns {Promise<boolean>} True if the issue is blocked, false otherwise.
 */
async function isIssueBlocked (issue) {
  try {
    // Get all inverse relations (where this issue is the target of a relation)
    const inverseRelations = await issue.inverseRelations()

    // Check if any inverse relation is of type "blocks"
    for (const relation of inverseRelations.nodes || []) {
      if (relation.type === 'blocks') {
        // This issue is blocked by another issue
        // Check if the blocking issue is still open
        const blockingIssue = await relation.issue
        const blockingState = await blockingIssue.state

        // If the blocking issue is not done, this issue is still blocked
        if (blockingState.name !== 'Done') {
          log('🚧', `Issue ${issue.identifier} is blocked by ${blockingIssue.identifier} (${blockingState.name})`, 'yellow')
          return true
        }
      }
    }

    return false
  } catch (error) {
    log('⚠️', `Error checking if issue ${issue.identifier} is blocked: ${error.message}`, 'yellow')
    // If we can't check, err on the side of caution and don't block the issue
    return false
  }
}

/**
 * Get all assigned issues that are Todo or In Progress.
 *
 * @returns {Promise<Array>} A list of issues.
 */
async function getAssignedIssues () {
  try {
    const user = await linearClient.viewer

    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: user.id } },
        state: { name: { in: ['Todo', 'In Progress'] } }
      }
    })

    // Filter out issues that are blocked by other issues
    const unblockedIssues = []
    for (const issue of issues.nodes) {
      const isBlocked = await isIssueBlocked(issue)
      if (!isBlocked) {
        unblockedIssues.push(issue)
      } else {
        log('🛑', `Skipping blocked issue ${issue.identifier}`, 'yellow')
      }
    }

    return unblockedIssues
  } catch (error) {
    log('❌', `Error getting assigned issues: ${error.message}`, 'red')
    return []
  }
}

/**
 * Get the repository from an issue.
 *
 * @param {Object} issue - The issue to get the repository from.
 * @returns {Promise<Object>} The repository information.
 */
async function getRepositoryFromIssue (issue) {
  try {
    const project = await issue.project
    if (!project) {
      log('⚠️', `No project assigned to issue ${issue.identifier}`, 'yellow')
      return null
    }
    const repository = extractRepository(project.content)
    return repository
  } catch (error) {
    log('⚠️', `Error getting repository from issue ${issue.identifier}: ${error.message}`, 'yellow')
    return null
  }
}

/**
 * Extract the repository from an project content.
 *
 * @param {string} content - The project content.
 * @returns {Object} The repository information.
 */
function extractRepository (content) {
  if (!content) return null

  const match = content.match(/REPOSITORY=([^/]+)\/([^\s]+)/)
  if (match) {
    return {
      owner: match[1],
      name: match[2]
    }
  }
  return null
}

/**
 * Re-fetch a single issue to check its current status
 *
 * @param {string} issueId - The Linear issue ID to check
 * @returns {Promise<Object|null>} The issue object or null if not found/error
 */
async function checkIssueStatus (issueId) {
  try {
    const issue = await linearClient.issue(issueId)
    return issue
  } catch (error) {
    log('❌', `Error checking issue status for ${issueId}: ${error.message}`, 'red')
    return null
  }
}

/**
 * Get comments for a Linear issue to include in conversation thread.
 *
 * @param {Object} issue - The Linear issue object.
 * @returns {Promise<Array>} A list of comments for the issue.
 */
async function getIssueComments (issue) {
  try {
    const comments = await linearClient.comments({
      filter: {
        issue: { id: { eq: issue.id } }
      },
      orderBy: 'createdAt'
    })

    return comments.nodes || []
  } catch (error) {
    log('⚠️', `Error getting comments for issue ${issue.identifier}: ${error.message}`, 'yellow')
    return []
  }
}

/**
 * Format comments into a readable conversation thread.
 *
 * @param {Array} comments - Array of comment objects from Linear.
 * @returns {Promise<string>} Formatted conversation thread string.
 */
async function formatConversationThread (comments) {
  if (!comments || comments.length === 0) {
    return ''
  }

  const formattedComments = []

  for (const comment of comments) {
    try {
      const user = await comment.user
      const createdAt = new Date(comment.createdAt).toLocaleString()

      formattedComments.push(`**${user.name}** (${createdAt}):
${comment.body}`)
    } catch (error) {
      log('⚠️', `Error formatting comment: ${error.message}`, 'yellow')
      formattedComments.push(`**Unknown User**:
${comment.body}`)
    }
  }

  return formattedComments.join('\n\n---\n\n')
}

/**
 * Get the short name of an issue for display.
 *
 * @param {Object} issue - The issue to get the short name from.
 * @returns {string} The short name of the issue.
 */
function getIssueShortName (issue) {
  const repository = issue.repository ? `${issue.repository.owner}/${issue.repository.name}` : 'unknown repository'
  return `[${issue.identifier}] ${issue.title} (${repository})`
}

module.exports = {
  pollLinear,
  checkIssueStatus,
  getIssueShortName,
  getIssueComments,
  formatConversationThread
}
