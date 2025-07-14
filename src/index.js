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
 * Main entry point.
 */
async function main () {
  const mode = getMode()

  if (mode === 'adam') {
    await runAdam()
  } else {
    log('❌', `Error: Unknown mode "${mode}"`, 'red')
    console.log('Available modes: adam')
    console.log('Set MODE environment variable to specify mode')
    process.exit(1)
  }
}

main()
