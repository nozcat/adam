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

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && echo 'source $HOME/.cargo/env' >> $HOME/.bashrc
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Set working directory
WORKDIR /app

# Create a directory for environment configuration
RUN mkdir -p /app/config

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Create a script to handle environment variables and start the application
RUN echo '#!/bin/bash\n\
# Check if .env file exists in mounted volume\n\
if [ -f /app/config/.env ]; then\n\
    cp /app/config/.env /app/.env\n\
    echo "Environment file copied from mounted volume"\n\
else\n\
    echo "No .env file found in /app/config/. Please mount your .env file to /app/config/.env"\n\
    echo "Example: docker run -v /path/to/your/.env:/app/config/.env adam"\n\
    exit 1\n\
fi\n\
\n\
# Start the application\n\
npm run start' > /app/start.sh && chmod +x /app/start.sh

# Expose any necessary ports (if Adam serves any web interface)
# EXPOSE 3000

# Set the default command
CMD ["/app/start.sh"]