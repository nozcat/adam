require('dotenv').config()

const { log, getMode } = require('./util')
const { runAdam } = require('./adam')
const { runEve } = require('./eve')
const { spawn } = require('child_process')
const path = require('path')

/**
 * Main entry point.
 */
async function main () {
  const mode = getMode()

  if (mode === 'adam') {
    await runAdam()
  } else if (mode === 'eve') {
    await runEve()
  } else if (mode === 'api') {
    // Launch the Python FastAPI server
    const pythonScript = path.join(__dirname, 'api.py')
    const pythonProcess = spawn('python3', [pythonScript], {
      stdio: 'inherit',
      env: process.env
    })

    pythonProcess.on('error', (err) => {
      log('❌', `Failed to start API server: ${err.message}`, 'red')
      process.exit(1)
    })

    pythonProcess.on('exit', (code) => {
      if (code !== 0) {
        log('❌', `API server exited with code ${code}`, 'red')
        process.exit(code)
      }
    })
  } else {
    log('❌', `Error: Unknown mode "${mode}"`, 'red')
    console.log('Available modes: adam, eve, api')
    console.log('Set MODE environment variable to specify mode')
    process.exit(1)
  }
}

main()
