require('dotenv').config()

const { log } = require('./util')
const { runAdam } = require('./adam')

/**
 * Get the mode from environment variable, defaulting to 'adam'.
 */
function getMode () {
  return process.env.MODE || 'adam'
}

/**
 * Run Eve agent.
 */
async function runEve () {
  log('🌙', 'Starting Eve - AI agent mode', 'green')

  // Eve agent doesn't do anything yet, just log and exit
  log('💤', 'Eve agent is not yet implemented. Exiting...', 'blue')

  process.exit(0)
}

/**
 * Main entry point.
 */
async function main () {
  const mode = getMode()

  if (mode === 'adam') {
    await runAdam()
  } else if (mode === 'eve') {
    await runEve()
  } else {
    log('❌', `Error: Unknown mode "${mode}"`, 'red')
    console.log('Available modes: adam, eve')
    console.log('Set MODE environment variable to specify mode')
    process.exit(1)
  }
}

main()
