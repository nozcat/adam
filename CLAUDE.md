# Development Process
- When there are multiple functions in a file, the more detailed ones, or helper functions, should generally be below those that call them. The exception is tiny helpers which can live at the top of the file like constants would.
- At the end of a task, always run `npm run lint` and fix all linter warnings and errors.
