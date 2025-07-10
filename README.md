# Adam - Developer AI Agent

## What is Adam?

Adam is a developer AI agent that automates the software development workflow by:

- **Pulling issues from Linear** - Continuously polls Linear for assigned issues
- **Implementing solutions** - Uses Claude Code to implement code changes based on issue requirements
- **Creating pull requests** - Automatically creates GitHub PRs for implemented changes
- **Responding to feedback** - Processes PR comments and feedback, implements requested changes, and responds to conversation threads
- **Managing Git workflow** - Handles branch creation, commits, and push operations

Adam runs in a continuous loop, checking for new issues and PR feedback every 30 seconds, making it a fully automated development assistant.

## Starting Adam

### Requirements

- **Node.js 24+** (latest LTS recommended)
- **Linear API access** - API key with read access to your Linear workspace
- **GitHub access** - Personal access token with repo permissions
- **Claude Code** - Adam uses Claude Code to implement changes

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   
   Copy the `.env.example` file to `.env` and configure the following variables:
   ```env
   # Required
   LINEAR_API_KEY=your_linear_api_key
   GITHUB_TOKEN=your_github_personal_access_token
   GITHUB_USERNAME=your_github_username
   GITHUB_EMAIL=your_github_email

   # Optional
   BASE_BRANCH=main
   DEBUG=false
   ```

3. **Start Adam**
   ```bash
   npm run start
   ```

Adam will begin polling Linear for assigned issues and processing them automatically.

## Workflow for Interacting with Adam

### 1. Repository Configuration

Each Linear project must specify the target repository in its content using the format:
```
REPOSITORY=owner/repo-name
```

This tells Adam which GitHub repository to work with for issues in that project.

### 2. Issue Assignment

- **Assign issues to Adam** in Linear (assign to the user whose LINEAR_API_KEY is being used)
- **Provide detailed descriptions** - Issues should be well-described with clear requirements
- **Ensure proper status** - Issues should be in an active state (not Backlog, Done, Canceled, or Duplicate)

### 3. Automated Implementation

Adam will:
- Detect the assigned issue
- Clone or update the target repository
- Create a branch for the issue (based on issue identifier)
- Use Claude Code to implement the changes
- Create a pull request with the implementation

### 4. PR Feedback and Iteration

- **Comment on pull requests** - Add comments or code review feedback
- **Interaction rules**:
  - Comments by `nozcat` are automatically processed
  - Comments by others are processed if `nozcat` reacts with 👍 
  - Adam adds 👁️ reactions to indicate it's processing comments
- **Conversation threads** - Adam processes entire conversation threads, not just individual comments
- **Automatic responses** - Adam implements requested changes and responds to feedback

### 5. Merge and Complete

- **Review the implementation** - Check that changes meet requirements
- **Approve and merge** - Complete the PR when satisfied
- **Issue completion** - Adam handles the development workflow; issue status updates may need to be done manually in Linear

## Additional Features

- **Branch management** - Automatically creates and manages feature branches
- **Commit management** - Makes atomic commits with descriptive messages
- **Error handling** - Gracefully handles API failures and retries operations
- **Logging** - Comprehensive logging with colored output for monitoring
- **Continuous operation** - Runs continuously, processing new issues and feedback as they arrive

## Development

### Linting
```bash
npm run lint
```

### Debugging
Set `DEBUG=true` in your `.env` file for verbose logging.