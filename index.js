const linearSdk = require('@linear/sdk')
const dotenv = require('dotenv')
const { LinearClient } = linearSdk

dotenv.config()

const LINEAR_API_KEY = process.env.LINEAR_API_KEY

async function main () {
  const linearClient = new LinearClient({
    apiKey: LINEAR_API_KEY
  })

  const user = await linearClient.viewer

  const issues = await linearClient.issues({ filter: { assignee: { id: { eq: user.id } } } })

  for (const issue of issues.nodes) {
    console.log(issue.identifier, issue.title, issue.branchName)
  }
}

main()
