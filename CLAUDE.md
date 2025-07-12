# Development Process
- When there are multiple functions in a file, the more detailed ones, or helper functions, should generally be below those that call them. The exception is tiny helpers which can live at the top of the file like constants would.
- Avoid overly-nested logic in functions. Extract complex nested sections into separate helper functions to improve readability and maintainability.
- At the end of a task, always run `npm run lint` and fix all linter warnings and errors.
- When making changes that affect how users run or deploy the application, always update the README.md file and any other relevant documentation to reflect the changes.
