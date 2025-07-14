const { LinearClient } = require('@linear/sdk')
const { log, getEnvVar } = require('./util')
const crypto = require('crypto')
const os = require('os')

// Initialize the Linear client.
const linearClient = new LinearClient({ apiKey: getEnvVar('LINEAR_API_KEY') })

// Generate a unique agent identifier for this instance
const agentId = generateAgentId()

/**
 * Generate a unique agent identifier for this Adam instance.
 *
 * @returns {string} A unique identifier for this agent
 */
function generateAgentId () {
  const hostname = os.hostname()
  const processId = process.pid
  const timestamp = Date.now()
  const random = crypto.randomBytes(4).toString('hex')

  return `adam-${hostname}-${processId}-${timestamp}-${random}`
}

/**
 * Generate the agent label name for Linear issues.
 *
 * @param {string} agentId - The agent identifier
 * @returns {string} The label name to use on Linear issues
 */
function getAgentLabelName (agentId) {
  return `agent:${agentId}`
}

/**
 * Poll Linear for assigned issues.
 *
 * @returns {Promise<Array>} A list of issues with the repository information.
 */
async function pollLinear () {
  log('🔄', 'Polling Linear...', 'blue')

  try {
    const issues = await getAssignedIssues()

    const availableIssues = []
    for (const issue of issues) {
      issue.repository = await getRepositoryFromIssue(issue)

      // Check if this issue is already being processed by another agent
      const isLocked = await isIssueLockedByAnotherAgent(issue)
      if (isLocked) {
        log('🔒', `Issue ${issue.identifier} is locked by another agent, skipping`, 'yellow')
        continue
      }

      availableIssues.push(issue)
    }

    return availableIssues
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
 * Get all assigned issues that are Todo, In Progress, or in Review.
 *
 * @returns {Promise<Array>} A list of issues.
 */
async function getAssignedIssues () {
  try {
    const user = await linearClient.viewer

    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: user.id } },
        state: { name: { in: ['Todo', 'In Progress', 'In Review'] } }
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
 * Update an issue to "In Progress" state if it's currently in "Todo" state.
 *
 * @param {Object} issue - The Linear issue object.
 * @returns {Promise<boolean>} True if update was successful or not needed, false if failed.
 */
async function updateIssueToInProgress (issue) {
  try {
    // Check current state
    const currentState = await issue.state
    if (currentState.name !== 'Todo') {
      log('ℹ️', `Issue ${issue.identifier} is already in "${currentState.name}" state, not updating`, 'blue')
      return true
    }

    // Get the "In Progress" state ID
    const inProgressStateId = await getInProgressStateId()
    if (!inProgressStateId) {
      log('❌', 'Could not find "In Progress" state ID', 'red')
      return false
    }

    // Update the issue state
    await linearClient.updateIssue(issue.id, {
      stateId: inProgressStateId
    })

    log('✅', `Updated issue ${issue.identifier} from "Todo" to "In Progress"`, 'green')
    return true
  } catch (error) {
    log('❌', `Failed to update issue ${issue.identifier} to In Progress: ${error.message}`, 'red')
    return false
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
 * Get the ID of the "In Progress" workflow state.
 *
 * @returns {Promise<string|null>} The state ID or null if not found.
 */
async function getInProgressStateId () {
  try {
    const states = await linearClient.workflowStates({
      filter: { name: { eq: 'In Progress' } }
    })

    if (states.nodes.length === 0) {
      log('❌', 'No "In Progress" state found in workflow', 'red')
      return null
    }

    if (states.nodes.length > 1) {
      log('⚠️', `Found ${states.nodes.length} "In Progress" states, using the first one`, 'yellow')
    }

    return states.nodes[0].id
  } catch (error) {
    log('❌', `Error getting In Progress state ID: ${error.message}`, 'red')
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

/**
 * Check if an issue is locked by another agent.
 *
 * @param {Object} issue - The issue to check.
 * @returns {Promise<boolean>} True if locked by another agent, false otherwise.
 */
async function isIssueLockedByAnotherAgent (issue) {
  try {
    const labels = await issue.labels()
    if (!labels || !labels.nodes) {
      return false
    }

    // Look for any agent labels
    for (const label of labels.nodes) {
      if (label.name.startsWith('agent:')) {
        // If it's not our agent ID, then it's locked by another agent
        const currentAgentLabel = getAgentLabelName(agentId)
        if (label.name !== currentAgentLabel) {
          return true
        }
      }
    }

    return false
  } catch (error) {
    log('⚠️', `Error checking if issue ${issue.identifier} is locked: ${error.message}`, 'yellow')
    return false
  }
}

/**
 * Lock an issue by adding our agent label.
 *
 * @param {Object} issue - The issue to lock.
 * @returns {Promise<boolean>} True if successfully locked, false otherwise.
 */
async function lockIssue (issue) {
  try {
    const labelName = getAgentLabelName(agentId)

    // First, check if any agent labels already exist on the issue
    const existingAgentLabels = await checkForExistingAgentLabels(issue)
    if (existingAgentLabels.length > 0) {
      log('🔒', `Issue ${issue.identifier} is already locked by agent: ${existingAgentLabels[0]}`, 'yellow')
      return false
    }

    // Try to find if the label already exists in the organization
    const labelId = await findOrCreateLabel(labelName)
    if (!labelId) {
      return false
    }

    // Add the label to the issue
    await linearClient.updateIssue(issue.id, {
      labelIds: await getLabelIds(issue, [labelId])
    })

    // Immediately check for race conditions - if another agent also added a label, remove ours
    const hasRaceCondition = await checkForRaceCondition(issue)
    if (hasRaceCondition) {
      log('⚠️', `Race condition detected for issue ${issue.identifier}, removing our label`, 'yellow')
      await unlockIssue(issue)
      return false
    }

    log('🔒', `Successfully locked issue ${issue.identifier} with agent label`, 'green')
    return true
  } catch (error) {
    log('❌', `Error locking issue ${issue.identifier}: ${error.message}`, 'red')
    return false
  }
}

/**
 * Unlock an issue by removing our agent label.
 *
 * @param {Object} issue - The issue to unlock.
 * @returns {Promise<boolean>} True if successfully unlocked, false otherwise.
 */
async function unlockIssue (issue) {
  try {
    const labelName = getAgentLabelName(agentId)

    // Get current labels
    const labels = await issue.labels()
    if (!labels || !labels.nodes) {
      return true // No labels to remove
    }

    // Filter out our agent label
    const remainingLabels = labels.nodes
      .filter(label => label.name !== labelName)
      .map(label => label.id)

    // Update the issue with the remaining labels
    await linearClient.updateIssue(issue.id, {
      labelIds: remainingLabels
    })

    log('🔓', `Successfully unlocked issue ${issue.identifier}`, 'green')
    return true
  } catch (error) {
    log('❌', `Error unlocking issue ${issue.identifier}: ${error.message}`, 'red')
    return false
  }
}

/**
 * Check for existing agent labels on an issue.
 *
 * @param {Object} issue - The issue to check.
 * @returns {Promise<Array<string>>} Array of agent label names found on the issue.
 */
async function checkForExistingAgentLabels (issue) {
  try {
    const labels = await issue.labels()
    if (!labels || !labels.nodes) {
      return []
    }

    const agentLabels = labels.nodes
      .filter(label => label.name.startsWith('agent:'))
      .map(label => label.name)

    return agentLabels
  } catch (error) {
    log('⚠️', `Error checking for existing agent labels on issue ${issue.identifier}: ${error.message}`, 'yellow')
    return []
  }
}

/**
 * Check for race conditions by looking for multiple agent labels.
 *
 * @param {Object} issue - The issue to check.
 * @returns {Promise<boolean>} True if race condition detected, false otherwise.
 */
async function checkForRaceCondition (issue) {
  try {
    // Re-fetch the issue to get the latest labels
    const freshIssue = await linearClient.issue(issue.id)
    const labels = await freshIssue.labels()

    if (!labels || !labels.nodes) {
      return false
    }

    const agentLabels = labels.nodes.filter(label => label.name.startsWith('agent:'))

    // If there's more than one agent label, we have a race condition
    if (agentLabels.length > 1) {
      const currentAgentLabel = getAgentLabelName(agentId)

      // Check if our label was added first (by comparing timestamps if available)
      // For simplicity, we'll remove our label if we detect any other agent labels
      const hasOtherAgents = agentLabels.some(label => label.name !== currentAgentLabel)
      return hasOtherAgents
    }

    return false
  } catch (error) {
    log('⚠️', `Error checking for race condition on issue ${issue.identifier}: ${error.message}`, 'yellow')
    return false
  }
}

/**
 * Find or create a label with the given name.
 *
 * @param {string} labelName - The name of the label to find or create.
 * @returns {Promise<string|null>} The label ID if found/created, null otherwise.
 */
async function findOrCreateLabel (labelName) {
  try {
    // First, try to find existing label
    const existingLabels = await linearClient.issueLabels({
      filter: { name: { eq: labelName } }
    })

    if (existingLabels.nodes && existingLabels.nodes.length > 0) {
      return existingLabels.nodes[0].id
    }

    // Create new label if it doesn't exist
    const newLabel = await linearClient.createIssueLabel({
      name: labelName,
      color: '#FF6B6B', // Red color for agent labels
      description: `Temporary label indicating this issue is being processed by ${agentId}`
    })

    return newLabel.issueLabel.id
  } catch (error) {
    log('❌', `Error finding or creating label ${labelName}: ${error.message}`, 'red')
    return null
  }
}

/**
 * Get all label IDs for an issue, including the new ones to add.
 *
 * @param {Object} issue - The issue object.
 * @param {Array<string>} additionalLabelIds - Additional label IDs to add.
 * @returns {Promise<Array<string>>} Array of all label IDs.
 */
async function getLabelIds (issue, additionalLabelIds = []) {
  try {
    const labels = await issue.labels()
    const existingLabelIds = labels && labels.nodes ? labels.nodes.map(label => label.id) : []

    return [...existingLabelIds, ...additionalLabelIds]
  } catch (error) {
    log('⚠️', `Error getting label IDs for issue ${issue.identifier}: ${error.message}`, 'yellow')
    return additionalLabelIds
  }
}

module.exports = {
  pollLinear,
  checkIssueStatus,
  getIssueShortName,
  getIssueComments,
  formatConversationThread,
  updateIssueToInProgress,
  lockIssue,
  unlockIssue,
  agentId
}
