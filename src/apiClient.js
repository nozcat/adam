require('dotenv').config()

const { log, getEnvVar } = require('./util')

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
    // Use local API server (should be started separately)
    const port = parseInt(getEnvVar('API_PORT')) || 8880
    apiServerUrl = `http://localhost:${port}`
    log('🔗', `Using local API server: ${apiServerUrl}`, 'blue')
  }

  return apiServerUrl
}

/**
 * Make a request to the API server
 * @param {string} path - The API path
 * @param {object} options - Request options
 * @returns {Promise<object>} The response data
 */
async function request (path, options = {}) {
  const url = await getApiServerUrl()
  const fullUrl = `${url}${path}`

  try {
    const response = await fetch(fullUrl, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    throw new Error(`API request failed: ${error.message}`)
  }
}

module.exports = {
  getApiServerUrl,
  request
}
