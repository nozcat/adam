require('dotenv').config()

const chalk = require('chalk')
const { marked } = require('marked')
const { markedTerminal } = require('marked-terminal')

const DEBUG = process.env.DEBUG === 'true'

// Configure marked to use terminal renderer
marked.use(markedTerminal())

/**
 * Gets the repository path using the REPOS_DIR environment variable
 * @param {string} repoName - The repository name
 * @returns {string} The full repository path
 */
function getRepoPath (repoName) {
  const reposDir = process.env.REPOS_DIR || './repos'
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

module.exports = { log, DEBUG, getRepoPath }
