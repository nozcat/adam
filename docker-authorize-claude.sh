#!/bin/bash

# Docker Claude Authorization Helper
# This script provides an easy way to authorize Claude Code in a Docker container

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is available
if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker is not installed or not in PATH"
    exit 1
fi

# Function to check if container is running
check_container() {
    if docker ps --format "table {{.Names}}" | grep -q "^adam-agent$"; then
        return 0
    else
        return 1
    fi
}

# Function to start container if not running
ensure_container_running() {
    if ! check_container; then
        print_info "Adam container is not running. Starting it..."
        if [ -f "docker-compose.yml" ]; then
            docker-compose up -d
            sleep 5
        else
            print_error "docker-compose.yml not found. Please start the Adam container manually."
            exit 1
        fi
    fi
}

# Function to run authorization in container
authorize_in_container() {
    print_info "Running Claude authorization in Docker container..."
    
    # Copy authorization script to container
    docker cp scripts/authorize-claude.sh adam-agent:/tmp/authorize-claude.sh
    
    # Run authorization script
    docker exec -it adam-agent bash -c "chmod +x /tmp/authorize-claude.sh && /tmp/authorize-claude.sh"
    
    return $?
}

# Function to check authentication status
check_auth_status() {
    print_info "Checking Claude authentication status in container..."
    docker exec adam-agent bash -c "/tmp/authorize-claude.sh --check" 2>/dev/null
    return $?
}

# Function to show usage
show_usage() {
    echo "Docker Claude Authorization Helper"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  authorize    Authorize Claude Code in the Docker container (default)"
    echo "  check        Check if Claude is already authorized"
    echo "  status       Show container status and authentication status"
    echo "  help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                # Authorize Claude"
    echo "  $0 check         # Check authentication status"
    echo "  $0 status        # Show detailed status"
    echo ""
    echo "Prerequisites:"
    echo "  - Docker and docker-compose must be installed"
    echo "  - Adam container should be running (will start if not)"
    echo "  - You need access to a web browser for interactive authorization"
    echo ""
}

# Main command handling
case "${1:-authorize}" in
    authorize)
        print_info "Starting Claude authorization process..."
        ensure_container_running
        
        if authorize_in_container; then
            print_success "Claude authorization completed successfully!"
            print_info "You can now use Adam normally. The container is ready."
        else
            print_error "Claude authorization failed. Please check the output above for details."
            exit 1
        fi
        ;;
        
    check)
        ensure_container_running
        if check_auth_status; then
            print_success "Claude is authenticated and ready to use!"
        else
            print_warning "Claude is not authenticated. Run '$0 authorize' to set it up."
            exit 1
        fi
        ;;
        
    status)
        print_info "Checking Docker container status..."
        if check_container; then
            print_success "Adam container is running"
            if check_auth_status >/dev/null 2>&1; then
                print_success "Claude is authenticated"
            else
                print_warning "Claude is not authenticated"
            fi
        else
            print_warning "Adam container is not running"
        fi
        ;;
        
    help)
        show_usage
        ;;
        
    *)
        print_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac