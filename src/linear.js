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
 * Get all assigned issues.
 *
 * @returns {Promise<Array>} A list of issues.
 */
async function getAssignedIssues () {
  try {
    const user = await linearClient.viewer

    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: user.id } },
        state: { name: { nin: ['Backlog', 'Done', 'Canceled', 'Duplicate'] } }
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

function getIssueShortName (issue) {
  const repository = issue.repository ? `${issue.repository.owner}/${issue.repository.name}` : 'unknown repository'
  return `[${issue.identifier}] ${issue.title} (${repository})`
}

module.exports = {
  pollLinear,
  getIssueShortName
}
