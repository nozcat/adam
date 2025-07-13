#!/bin/bash

# Repository configuration
REPO_URL="https://github.com/nozcat/adam"
REPO_DIR="/app/adam"
UPDATE_INTERVAL=${AUTO_UPDATE_INTERVAL:-300}  # Default to 5 minutes

echo "🚀 Starting Adam with auto-update functionality"
echo "📍 Repository URL: $REPO_URL"
echo "📁 Repository directory: $REPO_DIR"
echo "⏰ Update check interval: ${UPDATE_INTERVAL} seconds"

# Set up signal handlers for graceful container shutdown
cleanup() {
    echo "📡 Container received shutdown signal, cleaning up..."
    stop_application
    exit 0
}

trap cleanup SIGTERM SIGINT

# Function to clone or update repository
update_repository() {
    echo "🔄 Checking for repository updates..."
    
    if [ ! -d "$REPO_DIR/.git" ]; then
        echo "📥 Cloning repository for the first time..."
        rm -rf "$REPO_DIR"
        git clone "$REPO_URL" "$REPO_DIR"
        if [ $? -eq 0 ]; then
            echo "✅ Repository cloned successfully"
            return 0
        else
            echo "❌ Failed to clone repository"
            return 1
        fi
    else
        echo "🔍 Checking for updates..."
        cd "$REPO_DIR"
        
        # Fetch latest changes
        git fetch origin
        
        # Check if there are new commits
        LOCAL=$(git rev-parse HEAD)
        REMOTE=$(git rev-parse origin/main)
        
        if [ "$LOCAL" != "$REMOTE" ]; then
            echo "📦 New updates found, pulling changes..."
            git pull origin main
            if [ $? -eq 0 ]; then
                echo "✅ Repository updated successfully"
                return 0
            else
                echo "❌ Failed to update repository"
                return 1
            fi
        else
            echo "✅ Repository is up to date"
            return 1  # No update needed
        fi
    fi
}

# Function to setup environment
setup_environment() {
    cd "$REPO_DIR"
    
    # Check if .env file exists in mounted volume and copy it
    if [ -f /app/config/.env ]; then
        cp /app/config/.env "$REPO_DIR/.env"
        echo "📋 Environment file copied from mounted volume"
    else
        echo "ℹ️  No .env file found in /app/config/. Using environment variables from Docker Compose or system."
        echo "ℹ️  If you need to use a .env file, mount it to /app/config/.env"
        echo "ℹ️  Example: docker run -v /path/to/your/.env:/app/config/.env adam"
    fi
    
    # Install/update dependencies if package.json changed
    if [ -f package.json ]; then
        echo "📦 Installing/updating dependencies..."
        npm install
    fi
}

# Function to start the application
start_application() {
    cd "$REPO_DIR"
    echo "🏃 Starting Adam application..."
    npm run start &
    APP_PID=$!
    echo "🆔 Application PID: $APP_PID"
}

# Function to stop the application gracefully
stop_application() {
    if [ ! -z "$APP_PID" ]; then
        echo "🛑 Gracefully stopping application (PID: $APP_PID)..."
        
        # Send SIGTERM for graceful shutdown
        kill -TERM $APP_PID 2>/dev/null
        
        # Wait up to 30 seconds for graceful shutdown
        local timeout=30
        local count=0
        
        while [ $count -lt $timeout ]; do
            if ! kill -0 $APP_PID 2>/dev/null; then
                echo "✅ Application stopped gracefully"
                return 0
            fi
            sleep 1
            count=$((count + 1))
        done
        
        # If still running after timeout, force kill
        echo "⚠️  Application didn't stop gracefully, forcing shutdown..."
        kill -KILL $APP_PID 2>/dev/null
        wait $APP_PID 2>/dev/null
        echo "✅ Application stopped (forced)"
    fi
}

# Function to check if application is running
is_application_running() {
    if [ ! -z "$APP_PID" ]; then
        kill -0 $APP_PID 2>/dev/null
        return $?
    else
        return 1
    fi
}

# Initial setup
update_repository
if [ $? -ne 0 ] && [ ! -d "$REPO_DIR/.git" ]; then
    echo "❌ Failed to initialize repository. Exiting."
    exit 1
fi

setup_environment
start_application

# Main loop for auto-updates
while true; do
    sleep $UPDATE_INTERVAL
    
    # Check if application is still running
    if ! is_application_running; then
        echo "⚠️  Application stopped unexpectedly, restarting..."
        start_application
        continue
    fi
    
    # Check for repository updates
    update_repository
    if [ $? -eq 0 ]; then
        echo "🔄 Code updated, restarting application..."
        stop_application
        setup_environment
        start_application
    fi
done