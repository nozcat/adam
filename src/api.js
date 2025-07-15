require('dotenv').config()

const express = require('express')
const { log, getEnvVar } = require('./util')

/**
 * Start the API server
 * @returns {Promise<http.Server>} The HTTP server instance
 */
async function startApiServer () {
  const port = parseInt(getEnvVar('API_PORT')) || 8880
  const app = express()

  // Middleware
  app.use(express.json())

  // Routes
  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API server is running' })
  })

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
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
 * Start the API server if API_SERVER is not set (null/empty)
 * @returns {Promise<http.Server|null>} The HTTP server instance if started, null otherwise
 */
async function startApiServerIfNecessary () {
  const apiServer = getEnvVar('API_SERVER')

  if (!apiServer) {
    log('🔧', 'API_SERVER not set, starting local API server...', 'blue')
    try {
      const server = await startApiServer()
      return server
    } catch (error) {
      log('❌', `Failed to start API server: ${error.message}`, 'red')
      throw error
    }
  } else {
    log('🔧', `API_SERVER is set to ${apiServer}, skipping local API server startup`, 'yellow')
    return null
  }
}

/**
 * Main entry point for API mode.
 */
async function runApi () {
  log('🚀', 'Starting API server mode', 'green')

  try {
    await startApiServer()
  } catch (error) {
    log('❌', `Failed to start API server: ${error.message}`, 'red')
    process.exit(1)
  }
}

module.exports = { runApi, startApiServer, startApiServerIfNecessary }
