const linearSdk = require('@linear/sdk')
const dotenv = require('dotenv')
const { LinearClient } = linearSdk

async function main () {
  dotenv.config()

  const linearClient = new LinearClient({
    apiKey: process.env.LINEAR_API_KEY
  })

  const user = await linearClient.viewer
  console.log(user)
}

main()
