require('dotenv').config()

const http = require('http')
const { log, getEnvVar } = require('./util')
const { startApiServer } = require('./api')

let apiServerUrl = null

/**
 * Get the API server URL, either from environment variable or by starting a local server
 * @returns {Promise<string>} The API server URL
 */
async function getApiServerUrl () {
  if (apiServerUrl) {
    return apiServerUrl
  }

  const apiServerEnv = getEnvVar('API_SERVER')

  if (apiServerEnv) {
    // Use external API server
    apiServerUrl = apiServerEnv.startsWith('http') ? apiServerEnv : `http://${apiServerEnv}`
    log('🔗', `Using external API server: ${apiServerUrl}`, 'blue')
  } else {
    // Start local API server
    const port = parseInt(getEnvVar('API_PORT')) || 8880
    apiServerUrl = `http://localhost:${port}`

    log('🚀', 'Starting local API server...', 'yellow')
    await startApiServer()
  }

  return apiServerUrl
}

/**
 * Make a request to the API server
 * @param {string} path - The API path
 * @param {object} options - Request options
 * @returns {Promise<object>} The response data
 */
async function apiRequest (path, options = {}) {
  const url = await getApiServerUrl()
  const fullUrl = `${url}${path}`

  return new Promise((resolve, reject) => {
    const req = http.request(fullUrl, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    }, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          resolve(parsed)
        } catch (error) {
          reject(new Error(`Failed to parse API response: ${error.message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    if (options.body) {
      req.write(JSON.stringify(options.body))
    }

    req.end()
  })
}

module.exports = {
  getApiServerUrl,
  apiRequest
}
