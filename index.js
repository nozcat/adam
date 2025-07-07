require('dotenv').config()

const { LinearClient } = require('@linear/sdk')

async function main () {
  const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })

  const user = await linearClient.viewer

  const issues = await linearClient.issues({ filter: { assignee: { id: { eq: user.id } } } })

  for (const issue of issues.nodes) {
    console.log(issue.identifier, issue.title, issue.branchName)
  }
}

main().catch(console.error)
