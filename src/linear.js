const { LinearClient } = require('@linear/sdk')
const { log } = require('./util')

async function getLinearClient () {
  return new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
}

async function getAssignedIssues () {
  try {
    const linearClient = await getLinearClient()
    const user = await linearClient.viewer

    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: user.id } },
        state: { name: { nin: ['Done', 'Canceled'] } }
      }
    })

    return issues.nodes
  } catch (error) {
    log('❌', `Error getting assigned issues: ${error.message}`, 'red')
    return []
  }
}

async function getIssueProject (issue) {
  try {
    return await issue.project()
  } catch (error) {
    log('⚠️', `Error getting project for issue ${issue.identifier}: ${error.message}`, 'yellow')
    return null
  }
}

async function isIssueComplete (issue, repoInfo, findExistingBranchAndPR) {
  try {
    const { existingPR } = await findExistingBranchAndPR(issue, repoInfo)

    if (existingPR && existingPR.state === 'closed' && existingPR.merged) {
      return true
    }

    return false
  } catch (error) {
    log('⚠️', `Failed to check if issue is complete: ${error.message}`, 'yellow')
    return false
  }
}

async function pollLinear () {
  log('🔄', 'Polling Linear...', 'blue')

  try {
    const issues = await getAssignedIssues()
    log('👀', `Found ${issues.length} assigned issues`, 'blue')

    const issuesWithProjects = []

    for (const issue of issues) {
      const project = await getIssueProject(issue)
      const projectName = project ? project.name : 'No Project'
      const projectDescription = project ? project.description : 'No Description'

      issuesWithProjects.push({
        issue,
        project,
        projectName,
        projectDescription
      })
    }

    return issuesWithProjects
  } catch (error) {
    log('❌', `Error polling Linear: ${error.message}`, 'red')
    return []
  }
}

module.exports = {
  getLinearClient,
  getAssignedIssues,
  getIssueProject,
  isIssueComplete,
  pollLinear
}
