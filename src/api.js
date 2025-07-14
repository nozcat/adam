require('dotenv').config()

const http = require('http')
const { log, getEnvVar } = require('./util')

/**
 * Start the API server
 * @returns {Promise<http.Server>} The HTTP server instance
 */
async function startApiServer () {
  const port = parseInt(getEnvVar('API_PORT')) || 8880

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', message: 'API server is running' }))
  })

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      log('🌐', `API server started on port ${port}`, 'green')
      resolve(server)
    })

    server.on('error', (error) => {
      log('❌', `Failed to start API server: ${error.message}`, 'red')
      reject(error)
    })
  })
}

/**
 * Main entry point for API mode.
 */
async function runApi () {
  log('🚀', 'Starting API server mode', 'green')

  try {
    const server = await startApiServer()

    // Gracefully handle shutdown
    process.on('SIGINT', () => {
      log('🛑', 'Shutting down API server...', 'yellow')
      server.close(() => {
        log('👋', 'API server stopped', 'green')
        process.exit(0)
      })
    })

    process.on('SIGTERM', () => {
      log('🛑', 'Shutting down API server...', 'yellow')
      server.close(() => {
        log('👋', 'API server stopped', 'green')
        process.exit(0)
      })
    })
  } catch (error) {
    log('❌', `Failed to start API server: ${error.message}`, 'red')
    process.exit(1)
  }
}

module.exports = { runApi, startApiServer }
