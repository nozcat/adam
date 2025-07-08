const { spawn } = require('child_process')
const chalk = require('chalk')
const { marked } = require('marked')
const { markedTerminal } = require('marked-terminal')
const { log } = require('./util')

// Configure marked to use terminal renderer
marked.use(markedTerminal())

function cleanToolResult(content) {
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

function limitLinesWithMore(content, maxLines = 10) {
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

function logTodoWrite(input) {
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

function displayLine (line, debug) {
  if (line.trim() === '') return

  try {
    const json = JSON.parse(line)

    if (json.type === 'result') {
      if (debug) {
        log('🤖', marked.parse(json.result).trim())
      }
      return json.result
    }

    if (json.type === 'assistant') {
      for (const content of json.message.content) {
        if (content.type === 'text') {
          log('🤖', marked.parse(content.text).trim())
        } else if (content.type === 'tool_use') {
          if (content.name === 'TodoWrite') {
            logTodoWrite(content.input)
          } else {
            log('🔧', chalk.cyan(content.name) + ' ' + JSON.stringify(content.input))
          }
        } else {
          if (debug) {
            log('🔧', JSON.stringify(content), 'cyan')
          }
        }
      }
      return
    }

    if (json.type === 'user') {
      for (const content of json.message.content) {
        if (content.type === 'tool_result') {
          const cleanedContent = cleanToolResult(content.content)
          log('👤', debug ? cleanedContent : limitLinesWithMore(cleanedContent))
        } else {
          if (debug) {
            log('🔧', JSON.stringify(content), 'cyan')
          }
        }
      }
      return
    }

    if (debug) {
      log('🔧', JSON.stringify(json), 'cyan')
    }
  } catch (error) {
    log('❌', `Failed to parse line as JSON: ${error.message}`, 'red')
    log('❌', `Line: ${line}`, 'red')
  }
}

async function callClaude (prompt, dir, debug) {
  return new Promise((resolve, reject) => {
    log('🤖', 'Starting Claude Code...', 'blue')
    log('📝', `Prompt: ${prompt}`, 'yellow')

    const args = ['--print', '--verbose', '--dangerously-skip-permissions', '--output-format=stream-json', prompt]
    const options = { stdio: ['ignore', 'pipe', 'pipe'], cwd: dir }
    const claude = spawn('claude', [...args], options)

    let lineBuffer = ''
    let result = undefined

    // Handle NDJSON (newline-delimited JSON)
    claude.stdout.on('data', (data) => {
      lineBuffer += data.toString()

      // Split by newlines and process complete lines
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || '' // Keep the last incomplete line in buffer
      for (const line of lines) {
        result = result || displayLine(line, debug)
      }
    })

    claude.stderr.on('data', (data) => {
      const chunk = data.toString()
      process.stderr.write(chalk.red(chunk))
    })

    claude.on('close', (code) => {
      result = result || displayLine(lineBuffer, debug)

      if (code === 0) {
        log('✅', 'Claude Code completed successfully', 'green')
        resolve(result)
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

module.exports = { callClaude }
