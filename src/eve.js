require('dotenv').config()

const { log } = require('./util')

/**
 * Main entry point for Eve agent.
 */
async function runEve () {
  log('🌙', 'Starting Eve - AI agent mode', 'green')

  // Eve agent doesn't do anything yet, just log and exit
  log('💤', 'Eve agent is not yet implemented. Exiting...', 'blue')

  process.exit(0)
}

module.exports = { runEve }
