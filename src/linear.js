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

    return issues.nodes
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
  getIssueShortName
}
