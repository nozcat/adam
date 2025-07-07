const linearSdk = require('@linear/sdk')
const dotenv = require('dotenv')
const { LinearClient } = linearSdk

dotenv.config()

const LINEAR_API_KEY = process.env.LINEAR_API_KEY
const LINEAR_EMAIL = process.env.LINEAR_EMAIL

async function main () {
  const linearClient = new LinearClient({
    apiKey: LINEAR_API_KEY
  })

  const users = await linearClient.users({ filter: { email: { eq: LINEAR_EMAIL } } })
  const user = users.nodes[0]
  if (!user) {
    console.error(`User with email ${LINEAR_EMAIL} not found`)
    return
  }

  const issues = await linearClient.issues({ filter: { assignee: { id: { eq: user.id } } } })
  for (const issue of issues.nodes) {
    console.log(issue.identifier, issue.title)
  }
}

main()
