require('dotenv').config()

const { log, getMode } = require('./util')
const { runAdam } = require('./adam')
const { runEve } = require('./eve')

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
