require('dotenv').config()

const express = require('express')
const { log, getEnvVar } = require('./util')

const ISSUES = []
let lastUpdateTime = null
const POLLING_INTERVAL = parseInt(getEnvVar('POLLING_INTERVAL') || '30000') // Default 30 seconds

/**
 * Update the ISSUES array with fresh data from Linear
 */
async function updateIssues () {
  try {
    log('🔄', 'Fetching latest issues from Linear...', 'blue')
    const freshIssues = await fetchAllLinearIssues()
    ISSUES.length = 0
    ISSUES.push(...freshIssues)
    lastUpdateTime = new Date()
    log('✅', `Updated ISSUES array with ${ISSUES.length} issues at ${lastUpdateTime.toISOString()}`, 'green')
  } catch (error) {
    log('❌', `Failed to update issues: ${error.message}`, 'red')
  }
}

/**
 * Start the polling loop to periodically update issues
 */
function startPolling () {
  setInterval(async () => {
    const now = new Date()
    const timeSinceLastUpdate = lastUpdateTime ? now - lastUpdateTime : Infinity

    if (timeSinceLastUpdate >= POLLING_INTERVAL) {
      await updateIssues()
    }
  }, POLLING_INTERVAL)

  log('🔄', `Started polling for Linear issues every ${POLLING_INTERVAL / 1000} seconds`, 'blue')
}

/**
 * Fetch all Linear issues in batches
 * @param {number} batchSize - Number of issues to fetch per batch (default: 50)
 * @returns {Promise<Array>} Array of all Linear issues
 */
async function fetchAllLinearIssues (batchSize = 50) {
  const allIssues = []
  let hasNextPage = true
  let endCursor = null

  while (hasNextPage) {
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${getEnvVar('LINEAR_API_KEY')}`
      },
      body: JSON.stringify({
        query: `
          query ($first: Int!, $after: String) {
            issues(
              filter: { state: { name: { in: ["Todo", "In Progress", "In Review"] } } },
              first: $first
              after: $after
            ) {
              nodes {
                id
                identifier
                title
                description
                branchName
                state {
                  name
                }
                labels {
                  nodes {
                    id
                    name
                  }
                }
                project {
                  id
                  name
                  labels {
                    nodes {
                      id
                      name
                    }
                  }
                }
                inverseRelations {
                  nodes {
                    type
                    issue {
                      id
                      identifier
                      title
                      state {
                        name
                      }
                    }
                  }
                }
                comments {
                  nodes {
                    id
                    body
                    createdAt
                    user {
                      id
                      name
                      email
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: {
          first: batchSize,
          after: endCursor
        }
      })
    })

    const json = await resp.json()

    if (json.errors) {
      throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`)
    }

    const issues = json.data.issues
    allIssues.push(...issues.nodes)

    hasNextPage = issues.pageInfo.hasNextPage
    endCursor = issues.pageInfo.endCursor

    log('📋', `Fetched ${allIssues.length} issues so far...`, 'blue')
  }

  log('✅', `Fetched total of ${allIssues.length} issues`, 'green')
  return allIssues
}

/**
 * Start the API server
 * @returns {Promise<http.Server>} The HTTP server instance
 */
async function startApiServer () {
  const port = parseInt(getEnvVar('API_PORT')) || 8880
  const app = express()

  // Initial fetch of issues
  await updateIssues()

  // Start polling for updates
  startPolling()

  // Middleware
  app.use(express.json())

  // Routes
  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API server is running' })
  })

  // Add Linear issues endpoint
  app.get('/linear/issues', async (req, res) => {
    const refresh = req.query.refresh === 'true' || req.query.refresh === '1'

    if (refresh) {
      await updateIssues()
    }

    res.json(ISSUES)
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

module.exports = { runApi, startApiServer, startApiServerIfNecessary, fetchAllLinearIssues }
