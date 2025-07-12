require('dotenv').config()

const { log } = require('./util')
const { runAdam } = require('./adam')

/**
 * Parse command line arguments and return the mode.
 */
function parseArguments () {
  const args = process.argv.slice(2)
  let mode = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && i + 1 < args.length) {
      mode = args[i + 1]
      break
    }
  }

  return mode
}

/**
 * Main entry point.
 */
async function main () {
  const mode = parseArguments()

  if (!mode) {
    log('❌', 'Error: --mode parameter is required', 'red')
    console.log('Usage: node src/index.js --mode <mode>')
    console.log('Available modes: adam')
    process.exit(1)
  }

  if (mode === 'adam') {
    await runAdam()
  } else {
    log('❌', `Error: Unknown mode "${mode}"`, 'red')
    console.log('Available modes: adam')
    process.exit(1)
  }
}

main()
