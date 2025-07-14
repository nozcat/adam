# Development Process
- When there are multiple functions in a file, the more detailed ones, or helper functions, should generally be below those that call them. The exception is tiny helpers which can live at the top of the file like constants would.
- Avoid overly-nested logic in functions. Extract complex nested sections into separate helper functions to improve readability and maintainability.
- Preserve spacing between functions - maintain blank lines to improve code readability and structure.
- Never use two blank lines in a row - use only single blank lines for spacing.
- At the end of a task, always run `npm run lint` and fix all linter warnings and errors.
- When updating package.json, always run `npm install` to ensure package-lock.json is updated.
- When making changes that affect how users run or deploy the application, always update the README.md file and any other relevant documentation to reflect the changes.
- Before merging any changes, review all other files (including README and dockerfiles) to ensure they are up-to-date and reflect any changes made.
