# Use Ubuntu as base image
FROM ubuntu:24.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=24

# Install system dependencies and common developer tools
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    build-essential \
    python3 \
    python3-pip \
    jq \
    unzip \
    zip \
    tree \
    less \
    grep \
    sed \
    gawk \
    make \
    gcc \
    g++ \
    ca-certificates \
    gnupg \
    lsb-release \
    expect \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24+ from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs

# Verify Node.js installation
RUN node --version && npm --version

# Install Docker
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install Rust (as root, globally accessible)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && echo 'source $HOME/.cargo/env' >> $HOME/.bashrc
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Create a non-root user with home directory
RUN groupadd -r appuser && useradd -r -g appuser -m appuser

# Set working directory
WORKDIR /app

# Create a directory for environment configuration
RUN mkdir -p /app/config

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Create repos directory and set permissions for appuser
RUN mkdir -p /app/repos && chown -R appuser:appuser /app/repos

# Change ownership of the app directory to the non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Create a script to handle environment variables, Claude auth, and start the application
RUN echo '#!/bin/bash\n\
# Colors for output\n\
GREEN="\\033[0;32m"\n\
YELLOW="\\033[1;33m"\n\
BLUE="\\033[0;34m"\n\
NC="\\033[0m"\n\
\n\
print_info() {\n\
    echo -e "${BLUE}[INFO]${NC} $1"\n\
}\n\
\n\
print_success() {\n\
    echo -e "${GREEN}[SUCCESS]${NC} $1"\n\
}\n\
\n\
print_warning() {\n\
    echo -e "${YELLOW}[WARNING]${NC} $1"\n\
}\n\
\n\
# Check if .env file exists in mounted volume\n\
if [ -f /app/config/.env ]; then\n\
    cp /app/config/.env /app/.env\n\
    print_success "Environment file copied from mounted volume"\n\
else\n\
    print_info "No .env file found in /app/config/. Using environment variables from Docker Compose or system."\n\
    print_info "If you need to use a .env file, mount it to /app/config/.env"\n\
fi\n\
\n\
# Check Claude authentication\n\
print_info "Checking Claude Code authentication..."\n\
if timeout 10s claude -p "echo test" --json >/dev/null 2>&1; then\n\
    print_success "Claude is authenticated and ready!"\n\
elif [ ! -z "$ANTHROPIC_API_KEY" ]; then\n\
    print_info "Attempting authentication with ANTHROPIC_API_KEY..."\n\
    if timeout 15s claude -p "echo authenticated" --json >/dev/null 2>&1; then\n\
        print_success "Successfully authenticated using ANTHROPIC_API_KEY!"\n\
    else\n\
        print_warning "Environment variable authentication failed"\n\
        print_warning "Manual authentication required. Run: docker exec -it adam-agent /app/scripts/authorize-claude.sh"\n\
    fi\n\
else\n\
    print_warning "Claude is not authenticated and no ANTHROPIC_API_KEY provided"\n\
    print_warning "Manual authentication required. Run: docker exec -it adam-agent /app/scripts/authorize-claude.sh"\n\
fi\n\
\n\
# Start the application\n\
print_info "Starting Adam..."\n\
npm run start' > /app/start.sh && chmod +x /app/start.sh

# Set the default command
CMD ["/app/start.sh"]