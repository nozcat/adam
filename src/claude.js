const { spawn } = require('child_process')
const chalk = require('chalk')
const { marked } = require('marked')
const { log, DEBUG } = require('./util')

// Track when Claude permissions were last verified
let lastClaudePermissionsVerified = 0

/**
 * Checks if Claude Code has proper permissions by running a simple command
 * Uses cached result to avoid repeated checks after first success
 * Resets verification after 10 minutes of inactivity
 * @returns {Promise<boolean>} True if Claude has permissions, false otherwise
 */
async function checkClaudePermissions () {
  // Check if 10 minutes have passed since last verification
  const tenMinutesMs = 10 * 60 * 1000
  const now = Date.now()

  if (lastClaudePermissionsVerified > 0 && (now - lastClaudePermissionsVerified) > tenMinutesMs) {
    // Reset verification after 10 minutes of inactivity
    lastClaudePermissionsVerified = 0
  }

  // Return cached result if already verified and within timeout
  if (lastClaudePermissionsVerified > 0) {
    return true
  }

  return new Promise((resolve) => {
    const args = ['--print', "don't do anything"]
    const options = { stdio: ['ignore', 'pipe', 'pipe'] }
    const claude = spawn('claude', args, options)

    claude.on('close', (code) => {
      if (code === 0) {
        lastClaudePermissionsVerified = Date.now()
        resolve(true)
      } else {
        resolve(false)
      }
    })

    claude.on('error', (error) => {
      log('❌', `Failed to check Claude permissions: ${error.message}`, 'red')
      resolve(false)
    })
  })
}

/**
 * Executes Claude Code with the given prompt and returns the result
 * @param {string} prompt - The prompt to send to Claude Code
 * @param {string} dir - The directory to run Claude Code in
 * @returns {Promise<string>} The result from a successful Claude Code run
 */
async function callClaude (prompt, dir) {
  return new Promise((resolve, reject) => {
    log('🤖', 'Starting Claude Code...', 'blue')
    log('📝', `Prompt: ${prompt}`, 'yellow')

    const args = ['--print', '--verbose', '--dangerously-skip-permissions', '--output-format=stream-json', prompt]
    const options = { stdio: ['ignore', 'pipe', 'pipe'], cwd: dir }
    const claude = spawn('claude', [...args], options)

    let lineBuffer = ''
    let result

    // Handle NDJSON (newline-delimited JSON)
    claude.stdout.on('data', (data) => {
      lineBuffer += data.toString()

      // Split by newlines and process complete lines
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || '' // Keep the last incomplete line in buffer
      for (const line of lines) {
        result = result || logLine(line)
      }
    })

    claude.stderr.on('data', (data) => {
      const chunk = data.toString()
      process.stderr.write(chalk.red(chunk))
    })

    claude.on('close', (code) => {
      result = result || logLine(lineBuffer)

      if (code === 0) {
        if (result.is_error) {
          log('❌', `Claude Code failed: ${result.result}`, 'red')
          reject(new Error(`Claude Code failed: ${result.result}`))
        } else {
          log('✅', 'Claude Code completed successfully', 'green')
          // Update timestamp on successful Claude call
          lastClaudePermissionsVerified = Date.now()
          resolve(result.result)
        }
      } else {
        log('❌', `Claude Code failed with exit code: ${code}`, 'red')
        reject(new Error(`Claude Code failed with exit code: ${code}`))
      }
    })

    claude.on('error', (error) => {
      log('❌', `Failed to spawn Claude Code: ${error.message}`, 'red')
      reject(error)
    })
  })
}

/**
 * Processes and logs a single line of NDJSON output from Claude Code
 * @param {string} line - The JSON line to process
 * @returns {Object|undefined} The result object if this was a result line, which includes the result text and is_error flag
 */
function logLine (line) {
  if (line.trim() === '') return

  try {
    const json = JSON.parse(line)

    if (json.type === 'result') {
      return logResult(json)
    } else if (json.type === 'assistant') {
      return logAssistant(json)
    } else if (json.type === 'user') {
      return logUser(json)
    } else if (DEBUG) {
      log('🔧', JSON.stringify(json), 'cyan')
    }
  } catch (error) {
    log('❌', `Failed to parse line as JSON: ${error.message}`, 'red')
    log('❌', `Line: ${line}`, 'red')
  }
}

/**
 * Logs a result message from Claude Code
 * @param {Object} json - The parsed JSON result object
 * @param {string} json.result - The result text to display
 * @returns {string} The result text
 */
function logResult (json) {
  log('🤖', marked.parse(json.result).trim())

  if (DEBUG) {
    log('🔧', JSON.stringify(json), 'cyan')
  }

  return { result: json.result, is_error: json.is_error }
}

/**
 * Logs assistant messages and tool usage
 * @param {Object} json - The parsed JSON assistant message
 * @param {Object} json.message - The message object
 * @param {Array} json.message.content - Array of content objects
 */
function logAssistant (json) {
  for (const content of json.message.content) {
    if (content.type === 'text') {
      log('🤖', marked.parse(content.text).trim())
    }

    if (content.type === 'tool_use') {
      if (content.name === 'TodoWrite') {
        logTodoWrite(content.input)
      } else if (content.name === 'Task') {
        logTaskTool(content.input)
      } else if (content.name === 'Bash') {
        logBashTool(content.input)
      } else if (content.name === 'Read') {
        logReadTool(content.input)
      } else if (content.name === 'LS') {
        logLsTool(content.input)
      } else {
        log('🔧', chalk.cyan(content.name) + ' ' + JSON.stringify(content.input))
      }
    }

    if (DEBUG) {
      log('🔧', JSON.stringify(content), 'cyan')
    }
  }
}

/**
 * Logs TodoWrite tool usage with formatted todo list display
 * @param {Object} input - The TodoWrite tool input
 * @param {Array} input.todos - Array of todo objects
 */
function logTodoWrite (input) {
  if (!input.todos || !Array.isArray(input.todos)) {
    log('📝', 'Todo list updated', 'yellow')
    return
  }

  const todos = input.todos
  const statusCounts = todos.reduce((acc, todo) => {
    acc[todo.status] = (acc[todo.status] || 0) + 1
    return acc
  }, {})

  const statusEmojis = {
    pending: '☐',
    in_progress: '🔄',
    completed: '✅'
  }

  const priorityColors = {
    high: 'yellow',
    medium: 'white',
    low: 'gray'
  }

  // Show summary
  const summary = Object.entries(statusCounts)
    .map(([status, count]) => `${statusEmojis[status]} ${count} ${status}`)
    .join(' | ')

  log('📝', `Todo list updated: ${summary}`, 'blue')

  // Show individual todos
  todos.forEach(todo => {
    const statusEmoji = statusEmojis[todo.status] || '❓'
    const priorityColor = priorityColors[todo.priority] || 'white'
    const content = chalk[priorityColor](todo.content)
    console.log('   ', `${statusEmoji} ${content}`)
  })

  console.log()
}

/**
 * Logs user messages and tool results
 * @param {Object} json - The parsed JSON user message
 * @param {Object} json.message - The message object
 * @param {Array} json.message.content - Array of content objects
 */
function logUser (json) {
  for (const content of json.message.content) {
    if (content.type === 'tool_result') {
      const cleanedContent = cleanToolResult(content.content)
      log('👤', DEBUG ? cleanedContent : limitLinesWithMore(cleanedContent))
    } else {
      if (DEBUG) {
        log('🔧', JSON.stringify(content), 'cyan')
      }
    }
  }
}

/**
 * Logs Task tool usage with formatted description and prompt
 * @param {Object} input - The Task tool input
 * @param {string} input.description - Brief description of the task
 * @param {string} input.prompt - The full task prompt
 */
function logTaskTool (input) {
  if (!input.description || !input.prompt) {
    log('🔧', 'Task started', 'cyan')
    return
  }

  log('🔧', `Task: ${chalk.cyan(input.description)}`, 'cyan')

  // Format the prompt nicely with markdown
  const formattedPrompt = marked.parse(input.prompt).trim()
  console.log(chalk.dim('   Prompt:'))
  console.log(formattedPrompt.split('\n').map(line => `   ${line}`).join('\n'))
  console.log()
}

/**
 * Logs Bash tool usage with command and description
 * @param {Object} input - The Bash tool input
 * @param {string} input.command - The bash command to execute
 * @param {string} input.description - Description of what the command does
 */
function logBashTool (input) {
  log('🔧', `Bash: ${chalk.white(input.command)} ${chalk.green(`# ${input.description}`)}`, 'cyan')
}

/**
 * Logs Read tool usage with file path
 * @param {Object} input - The Read tool input
 * @param {string} input.file_path - The path to the file being read
 */
function logReadTool (input) {
  log('🔧', `Read: ${chalk.white(input.file_path)}`, 'cyan')
}

/**
 * Logs LS tool usage with directory path
 * @param {Object} input - The LS tool input
 * @param {string} input.path - The path to the directory being listed
 */
function logLsTool (input) {
  log('🔧', `LS: ${chalk.white(input.path)}`, 'cyan')
}

/**
 * Cleans tool result content by removing system reminders and trimming empty lines
 * @param {string|*} content - The content to clean
 * @returns {string|*} The cleaned content
 */
function cleanToolResult (content) {
  if (typeof content !== 'string') {
    return content
  }

  // Remove system-reminder tags and their content
  const cleanedContent = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')

  // Trim empty lines at the top and bottom
  const lines = cleanedContent.split('\n')
  let start = 0
  let end = lines.length - 1

  // Find first non-empty line
  while (start < lines.length && lines[start].trim() === '') {
    start++
  }

  // Find last non-empty line
  while (end >= 0 && lines[end].trim() === '') {
    end--
  }

  if (start > end) {
    return ''
  }

  return lines.slice(start, end + 1).join('\n')
}

/**
 * Limits content to a maximum number of lines, showing top and bottom with indicator
 * @param {string|*} content - The content to limit
 * @param {number} maxLines - Maximum number of lines to show (default: 10)
 * @returns {string|*} The limited content with "more" indicator if truncated
 */
function limitLinesWithMore (content, maxLines = 10) {
  if (typeof content !== 'string') {
    return content
  }

  const lines = content.split('\n')
  if (lines.length <= maxLines) {
    return content
  }

  const halfLines = Math.floor(maxLines / 2)
  const topLines = lines.slice(0, halfLines)
  const bottomLines = lines.slice(-halfLines)
  const omittedCount = lines.length - (halfLines * 2)
  const moreIndicator = `... (${omittedCount} more lines)`

  return topLines.join('\n') + '\n' + chalk.dim(moreIndicator) + '\n' + bottomLines.join('\n')
}

module.exports = { callClaude, checkClaudePermissions }
