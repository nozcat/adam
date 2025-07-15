# Adam AI - AI Agent Platform

## What is Adam AI?

Adam AI is an AI agent platform that provides multiple AI modes for different development purposes:

### Adam - Developer AI Agent (Default)

Adam is a developer AI agent that automates the software development workflow by:

- **Pulling issues from Linear** - Continuously polls Linear for assigned issues
- **Implementing solutions** - Uses Claude Code to implement code changes based on issue requirements
- **Creating pull requests** - Automatically creates GitHub PRs for implemented changes
- **Responding to feedback** - Processes PR comments and feedback, implements requested changes, and responds to conversation threads
- **Managing Git workflow** - Handles branch creation, commits, and push operations

Adam runs in a continuous loop, checking for new issues and PR feedback at configurable intervals (default: 30 seconds), making it a fully automated development assistant.

### Eve - AI Agent (Coming Soon)

Eve is an AI agent mode that reviews existing PRs and provides comments. It focuses on code review and feedback rather than the automated development workflow that Adam provides.

### API - API Server Mode

The API server provides a single service that talks to external APIs (Linear, Github) to deduplicate requests and not hit rate limits. It runs as a dedicated Express.js server that other Adam components can connect to for centralized API management.

## Architecture

Adam AI is built with a mode-based architecture that allows for extensibility:

- **Adam Mode** (`MODE=adam`): The main developer agent that implements features from Linear in GitHub (default mode)
- **Eve Mode** (`MODE=eve`): An experimental AI agent mode currently under development
- **API Mode** (`MODE=api`): Runs a standalone API server that other agents can connect to
- Additional modes can be added in the future for different workflows

When you run `npm run start`, it automatically starts Adam in the default mode. You can specify a different mode using the `MODE` environment variable:
```bash
MODE=adam npm run start
MODE=eve npm run start
MODE=api npm run start
```

## Starting the Agents

### Requirements

- **Node.js 24+** (latest LTS recommended)
- **Linear API access** - API key with read access to your Linear workspace
- **GitHub access** - Personal access token with repo permissions
- **Claude Code** - Adam uses Claude Code to implement changes
  - Install with: `npm install -g @anthropic-ai/claude-code`
  - Requires authentication with your Anthropic account

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
   MODE=adam              # Application mode (defaults to 'adam')
   BASE_BRANCH=main
   DEBUG=false
   POLL_INTERVAL=30
   REPOS_DIR=./repos
   REPOS=                 # Comma-separated list of allowed repositories (e.g., owner/repo1,owner/repo2)
   API_SERVER=            # External API server URL (e.g., localhost:8880). If not set, agents start their own API server
   API_PORT=8880          # Port for the local API server (defaults to 8880)
   API_MODE=disabled      # Enable API server in Adam/Eve modes ('enabled' or 'disabled', defaults to 'disabled')
   ```

3. **Start an agent**
   
   **Adam (default developer mode):**
   ```bash
   npm run start
   # or
   npm run adam
   ```
   
   **Eve (experimental mode):**
   ```bash
   npm run eve
   ```
   
   **API (server mode):**
   ```bash
   npm run api
   ```

   Adam will begin polling Linear for assigned issues and processing them automatically. Eve currently just logs its startup and exits as it's still under development. API mode starts a dedicated API server.

## API Server

Adam AI includes an API server mode that provides centralized API functionality for agent communication. The API server can be run in two configurations:

### Embedded Mode (Default)
When the `API_SERVER` environment variable is not set, both Adam and Eve agents will automatically start their own embedded API server on startup. This is the simplest setup for single-agent deployments.

### Standalone Mode
For multi-agent deployments or when you want centralized API management:

1. **Start the API server**:
   ```bash
   npm run api
   # or
   MODE=api npm run start
   ```

2. **Configure agents to use the external API server**:
   ```env
   API_SERVER=localhost:8880  # or any host:port where your API server is running
   ```

The API server provides a health check endpoint and will be extended with additional functionality in future releases.

## Docker Setup

Both Adam and Eve modes can be run in Docker containers for easier deployment and isolation.

### Prerequisites

1. **Claude Code Authentication**: Claude Code must be authenticated before running Adam in Docker. This cannot be done inside the Docker container itself.

2. **Environment File**: Create a `.env` file with your configuration (see above for required variables).

### Docker Compose (Recommended)

The easiest way to run Adam with Docker is using Docker Compose. By default, it will start 4 Adam agents (adam1-adam4) and one Eve agent:

**Note on Claude MAX Subscription:** Running 4 Adam agents concurrently works best with a Claude MAX subscription. Each agent requires access to Claude Code, and the MAX subscription provides the necessary request limits to support multiple agents working in parallel. With a standard Claude subscription, you might run out of requests pretty quickly if more than one Adam agent stays busy for a while.

1. **Prepare your environment file**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys and configuration
   ```

2. **Start the agents with Docker Compose**:
   ```bash
   docker-compose up -d
   ```
   This will start:
   - 4 Adam agents (adam1, adam2, adam3, adam4) running continuously
   - 1 Eve agent (eve) which exits immediately (still under development)

3. **Authenticate Claude Code for each Adam agent**:
   Connect to each running Adam container to authenticate:
   ```bash
   docker-compose exec adam1 claude
   # Then type: /login and follow the authentication prompts
   
   docker-compose exec adam2 claude
   # Then type: /login and follow the authentication prompts
   
   docker-compose exec adam3 claude
   # Then type: /login and follow the authentication prompts
   
   docker-compose exec adam4 claude
   # Then type: /login and follow the authentication prompts
   ```

4. **View logs**:
   ```bash
   # View logs for all agents
   docker-compose logs -f
   
   # View logs for specific agents
   docker-compose logs -f adam1
   docker-compose logs -f adam2
   docker-compose logs -f adam3
   docker-compose logs -f adam4
   ```

5. **Stop all agents**:
   ```bash
   docker-compose down
   ```

### Manual Docker Setup

Alternatively, you can run Adam with standard Docker commands:

1. **Prepare your environment file**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys and configuration
   ```

2. **Build the Docker image**:
   ```bash
   docker build -t adam .
   ```

3. **Run the Docker container**:
   ```bash
   docker run -it -v /path/to/your/.env:/app/config/.env adam
   ```

4. **Authenticate Claude Code**:
   Once the container starts, you'll need to authenticate Claude Code:
   ```bash
   # In the container terminal that opens
   claude
   # Then type:
   /login
   # Follow the authentication prompts
   ```

5. **Start Adam**:
   After authentication is complete, Adam will start automatically and begin processing Linear issues.

### Alternative: Interactive Shell

If you need to troubleshoot or work interactively:
```bash
docker run -it -v /path/to/your/.env:/app/config/.env --entrypoint /bin/bash adam
```

Then manually:
1. Copy environment: `cp /app/config/.env /app/.env`
2. Authenticate Claude Code: `claude` then `/login`
3. Start Adam: `npm run start`

### Docker Features

- **Ubuntu-based** with Node.js 24+ and common developer tools
- **Claude Code pre-installed** globally
- **Automatic repository cloning** from GitHub
- **Environment variable handling** via mounted `.env` file
- **Interactive authentication** support for Claude Code

### Important Notes

- **Authentication Requirement**: Claude Code authentication is required and must be done interactively after starting the container
- **Volume Mount**: Your `.env` file must be mounted to `/app/config/.env` in the container
- **Network Access**: The container needs internet access to communicate with Linear, GitHub, and Claude APIs
- **Persistent Data**: Consider mounting a volume for git repositories if you want to persist cloned repos between container restarts

## Workflow for Interacting with Adam

### 1. Repository Configuration

Repository specification can be done in two ways:

1. **Issue Labels (takes priority)**: Add a label to the issue with the format:
   ```
   repo:owner/repo-name
   ```

2. **Project Labels**: If no repository label is found on the issue, Adam will check the issue's project for the same label format.

For example, a label `repo:acme/backend` tells Adam to work with the `backend` repository owned by `acme`. 

**Priority**: If both the issue and its project have repository labels, the issue label takes precedence. This allows for project-wide defaults while still enabling per-issue overrides.

### 2. Issue Assignment

- **Assign issues to Adam** in Linear (assign to the user whose LINEAR_API_KEY is being used)
- **Provide detailed descriptions** - Issues should be well-described with clear requirements
- **Ensure proper status** - Issues should be in an active state (not Backlog, Done, Canceled, or Duplicate)
- **One issue per PR** - Each Linear issue should result in exactly one pull request. If an issue is too large, break it down into smaller sub-issues rather than creating multiple PRs for a single issue

### 3. Automated Implementation

Adam will:
- Detect the assigned issue
- Lock the issue by adding an `agent:` label to prevent multiple agents from working on the same issue
- Clone or update the target repository
- Create a branch for the issue (based on issue identifier)
- Use Claude Code to implement the changes
- Create a pull request with the implementation
- Unlock the issue by removing the agent label when done

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

## Repository Management

### Restricting Repository Access

By default, Adam can work with any repository specified in Linear project configurations. You can restrict Adam to only work with specific repositories using the `REPOS` environment variable:

```env
# Allow only specific repositories
REPOS=facebook/react,vuejs/vue,angular/angular
```

When `REPOS` is configured:
- Adam will automatically clone all specified repositories on startup
- Adam will only process issues for repositories in this list
- Issues for repositories not in the list will throw an error
- Each repository uses the same GitHub credentials configured in the environment

This is useful for:
- **Security** - Limit which repositories Adam can access
- **Multi-tenant setups** - Run separate Adam instances for different repository groups
- **Pre-cloning** - Ensure all required repositories are available before processing issues

### Repository Format

Repositories must be specified in the format `owner/repo-name`:
- ✅ `facebook/react`
- ✅ `microsoft/vscode`
- ❌ `react` (missing owner)
- ❌ `facebook/react.git` (don't include .git)

## Development

### Linting
```bash
npm run lint
```

### Debugging
Set `DEBUG=true` in your `.env` file for verbose logging.