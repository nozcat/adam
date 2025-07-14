require('dotenv').config()

const chalk = require('chalk')
const { marked } = require('marked')
const { markedTerminal } = require('marked-terminal')
const fs = require('fs')

const DEBUG = process.env.DEBUG === 'true'

/**
 * Get the mode from environment variable, defaulting to 'adam'.
 * @returns {string} The current mode ('adam' or 'eve')
 */
function getMode () {
  return process.env.MODE || 'adam'
}

/**
 * Gets environment variable with mode-specific suffix (_ADAM or _EVE) if mode is specified,
 * otherwise falls back to the base variable name.
 * @param {string} baseVarName - The base environment variable name
 * @returns {string|undefined} The environment variable value
 */
function getEnvVar (baseVarName) {
  const mode = getMode()
  const modeSpecificVar = `${baseVarName}_${mode.toUpperCase()}`

  return process.env[modeSpecificVar] || process.env[baseVarName]
}

// Configure marked to use terminal renderer
marked.use(markedTerminal())

/**
 * Gets the repository path using the REPOS_DIR environment variable
 * @param {string} repoName - The repository name
 * @returns {string} The full repository path
 */
function getRepoPath (repoName) {
  const reposDir = process.env.REPOS_DIR || './repos'

  // Create the reposDir if it doesn't exist (recursively)
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true })
  }

  return `${reposDir}/${repoName}`
}

/**
 * Logs a message with an emoji prefix and optional color formatting
 * @param {string} emoji - The emoji to prefix the message with
 * @param {string} message - The message to log
 * @param {string} [color] - Optional chalk color name to apply to the message
 */
function log (emoji, message, color) {
  if (color) {
    console.log(chalk[color](`${emoji} ${message}`))
  } else {
    console.log(`${emoji} ${message}`)
  }
  console.log()
}

module.exports = {
  log,
  DEBUG,
  getRepoPath,
  getMode,
  getEnvVar
}
