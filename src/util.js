const chalk = require('chalk')

function log (emoji, message, color) {
  if (color) {
    console.log(chalk[color](`${emoji} ${message}`))
  } else {
    console.log(`${emoji} ${message}`)
  }
  console.log()
}

module.exports = { log }
