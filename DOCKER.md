# Docker Setup for Adam

## Building the Docker Image

Build the Docker image with:
```bash
docker build -t adam .
```

## Running Adam in Docker

### Prerequisites

1. **Claude Code Authentication**: Claude Code must be authenticated before running Adam in Docker. This cannot be done inside the Docker container itself.

2. **Environment File**: Create a `.env` file with your configuration (see README.md for required variables).

### Step-by-Step Setup

1. **Prepare your environment file**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys and configuration
   ```

2. **Run the Docker container**:
   ```bash
   docker run -it -v /path/to/your/.env:/app/config/.env adam
   ```

3. **Authenticate Claude Code**:
   Once the container starts, you'll need to authenticate Claude Code:
   ```bash
   # In the container terminal that opens
   claude
   # Then type:
   /login
   # Follow the authentication prompts
   ```

4. **Start Adam**:
   After authentication is complete, Adam will start automatically and begin processing Linear issues.

### Alternative: Interactive Shell

If you need to troubleshoot or work interactively:
```bash
docker run -it -v /path/to/your/.env:/app/config/.env --entrypoint /bin/bash adam
```

Then manually:
1. Copy environment: `cp /app/config/.env /app/agents/adam/adam/.env`
2. Authenticate Claude Code: `claude` then `/login`
3. Start Adam: `npm run start`

## Important Notes

- **Authentication Requirement**: Claude Code authentication is required and must be done interactively after starting the container
- **Volume Mount**: Your `.env` file must be mounted to `/app/config/.env` in the container
- **Network Access**: The container needs internet access to communicate with Linear, GitHub, and Claude APIs
- **Persistent Data**: Consider mounting a volume for git repositories if you want to persist cloned repos between container restarts

## Troubleshooting

- **Authentication Issues**: If Claude Code fails to authenticate, ensure you have a valid Anthropic account and API access
- **Environment Variables**: Double-check that all required environment variables are set in your `.env` file
- **Network Connectivity**: Ensure the container has access to external APIs (Linear, GitHub, Claude)