import os
from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn
from dotenv import load_dotenv
import signal
import sys
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="Adam API Server")

@app.get("/")
async def root():
    """Root endpoint returning server status"""
    return JSONResponse(content={"status": "ok", "message": "API server is running"})

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return JSONResponse(content={"status": "healthy"})

def get_env_var(key: str, default: str = None) -> str:
    """Get environment variable with optional default"""
    return os.getenv(key, default)

def log(icon: str, message: str, color: str = "default"):
    """Log message with icon (matching Node.js util.log format)"""
    logger.info(f"{icon} {message}")

def run_api():
    """Main entry point for API mode"""
    log("🚀", "Starting API server mode", "green")
    
    port = int(get_env_var("API_PORT", "8880"))
    
    # Set up signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        log("🛑", "Shutting down API server...", "yellow")
        log("👋", "API server stopped", "green")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        log("🌐", f"API server started on port {port}", "green")
        uvicorn.run(app, host="0.0.0.0", port=port)
    except Exception as e:
        log("❌", f"Failed to start API server: {str(e)}", "red")
        sys.exit(1)

if __name__ == "__main__":
    run_api()