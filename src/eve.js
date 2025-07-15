require('dotenv').config()

const { log } = require('./util')
const { cloneReposFromEnv } = require('./github')
const { getApiServerUrl } = require('./apiClient')
const { startApiServerIfNecessary } = require('./api')

/**
 * Main entry point for Eve agent.
 */
async function runEve () {
  log('🌙', 'Starting Eve - AI agent mode', 'green')

  // Start API server if necessary (based on API_SERVER environment variable)
  await startApiServerIfNecessary()

  // Initialize API server connection
  await getApiServerUrl()

  // Clone repositories specified in REPOS environment variable
  await cloneReposFromEnv()

  // Eve agent doesn't do anything yet, just log and exit
  log('💤', 'Eve agent is not yet implemented. Exiting...', 'blue')

  process.exit(0)
}

module.exports = { runEve }
