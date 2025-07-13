#!/bin/bash

# Claude Authorization Script for Docker
# This script automates the Claude Code authentication process in Docker containers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Function to check if Claude is already authenticated
check_claude_auth() {
    print_info "Checking Claude authentication status..."
    
    # Try to run claude with a simple command to check if authenticated
    if timeout 10s claude -p "echo test" --json >/dev/null 2>&1; then
        print_success "Claude is already authenticated!"
        return 0
    else
        print_info "Claude is not authenticated or timed out"
        return 1
    fi
}

# Function to attempt environment variable authentication
try_env_auth() {
    print_info "Checking for ANTHROPIC_API_KEY environment variable..."
    
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        print_warning "ANTHROPIC_API_KEY environment variable not set"
        return 1
    fi
    
    print_info "ANTHROPIC_API_KEY found, attempting non-interactive authentication..."
    
    # Try to use Claude with the API key
    if timeout 15s claude -p "echo authenticated" --json >/dev/null 2>&1; then
        print_success "Successfully authenticated using ANTHROPIC_API_KEY!"
        return 0
    else
        print_warning "Environment variable authentication failed, falling back to interactive mode"
        return 1
    fi
}

# Function to perform interactive authentication using expect
interactive_auth() {
    print_info "Starting interactive Claude authentication..."
    
    # Check if expect is installed
    if ! command -v expect >/dev/null 2>&1; then
        print_error "expect is not installed. Installing..."
        apt-get update && apt-get install -y expect
    fi
    
    # Create expect script for automation
    cat > /tmp/claude_auth.exp << 'EOF'
#!/usr/bin/expect -f

set timeout 120
log_user 1

# Start claude
spawn claude

# Handle the intro screen
expect {
    "Press Enter to continue" {
        send "\r"
        exp_continue
    }
    "Do you have a Claude account?" {
        send "\r"
        exp_continue
    }
    "account type" {
        send "\r"
        exp_continue
    }
    "Visit this URL" {
        # Extract and display the URL
        expect -re "(https://[^\r\n]+)"
        set url $expect_out(1,string)
        puts "\n\n=== AUTHORIZATION REQUIRED ==="
        puts "Please open this URL in your browser:"
        puts "$url"
        puts "Click 'Authorize' and then copy the authorization code below."
        puts "================================\n"
        exp_continue
    }
    "Enter the authorization code" {
        puts "\n=== WAITING FOR AUTHORIZATION CODE ==="
        puts "Please paste the authorization code from your browser:"
        # Wait for user input
        interact -o "\r" {
            send "\r"
        }
        exp_continue
    }
    "Would you like to enable" {
        # Skip analytics/telemetry questions with default answers
        send "\r"
        exp_continue
    }
    "settings" {
        send "\r"
        exp_continue
    }
    "exit" {
        send "exit\r"
        expect eof
        exit 0
    }
    eof {
        exit 0
    }
    timeout {
        puts "\nTimeout occurred during authentication"
        exit 1
    }
}
EOF
    
    chmod +x /tmp/claude_auth.exp
    
    print_info "Running interactive authentication..."
    print_warning "You will need to manually open the provided URL and enter the authorization code"
    
    if /tmp/claude_auth.exp; then
        print_success "Interactive authentication completed!"
        rm -f /tmp/claude_auth.exp
        return 0
    else
        print_error "Interactive authentication failed"
        rm -f /tmp/claude_auth.exp
        return 1
    fi
}

# Function to verify final authentication
verify_auth() {
    print_info "Verifying authentication..."
    
    if timeout 10s claude -p "echo verification test" --json >/dev/null 2>&1; then
        print_success "Authentication verification successful!"
        return 0
    else
        print_error "Authentication verification failed"
        return 1
    fi
}

# Main function
main() {
    print_info "Starting Claude Code authorization process..."
    
    # Check if already authenticated
    if check_claude_auth; then
        print_success "Claude is already authenticated. No action needed."
        exit 0
    fi
    
    # Try environment variable authentication first
    if try_env_auth; then
        if verify_auth; then
            print_success "Successfully authenticated using environment variable!"
            exit 0
        fi
    fi
    
    # Fall back to interactive authentication
    print_info "Attempting interactive authentication..."
    
    if interactive_auth; then
        if verify_auth; then
            print_success "Successfully authenticated interactively!"
            exit 0
        fi
    fi
    
    print_error "All authentication methods failed"
    exit 1
}

# Help function
show_help() {
    echo "Claude Authorization Script for Docker"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --check        Only check authentication status"
    echo "  --env-only     Only try environment variable authentication"
    echo "  --interactive  Force interactive authentication"
    echo ""
    echo "Environment Variables:"
    echo "  ANTHROPIC_API_KEY  Your Anthropic API key for non-interactive auth"
    echo ""
    echo "Examples:"
    echo "  $0                 # Full authorization process"
    echo "  $0 --check        # Check if already authenticated"
    echo "  $0 --env-only     # Only try API key authentication"
    echo ""
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    --check)
        check_claude_auth
        exit $?
        ;;
    --env-only)
        try_env_auth
        exit $?
        ;;
    --interactive)
        interactive_auth && verify_auth
        exit $?
        ;;
    "")
        main
        ;;
    *)
        print_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac