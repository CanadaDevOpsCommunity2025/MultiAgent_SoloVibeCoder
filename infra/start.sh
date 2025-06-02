#!/bin/bash

# Startup script for local development environment
# This script starts all services using Docker Compose with LocalStack

set -e

echo "🚀 Starting AI Task Agent Local Development Environment"
echo "================================================="

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose >/dev/null 2>&1; then
    echo "❌ docker-compose is not installed. Please install it and try again."
    exit 1
fi

# Create localstack data directory if it doesn't exist
mkdir -p localstack-data

echo "🧹 Cleaning up any existing containers..."
docker-compose down --remove-orphans

echo "🔨 Building Docker images..."
docker-compose build --no-cache

echo "🚀 Starting services..."
docker-compose up -d

echo "⏳ Waiting for services to be healthy..."

# Function to check if a URL is responding
check_service() {
    local url=$1
    local service_name=$2
    local max_attempts=30
    local attempt=1
    
    echo "Checking $service_name at $url..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" >/dev/null 2>&1; then
            echo "✅ $service_name is ready!"
            return 0
        fi
        
        echo "Attempt $attempt/$max_attempts: $service_name not ready yet..."
        sleep 5
        attempt=$((attempt + 1))
    done
    
    echo "❌ $service_name failed to start within timeout"
    return 1
}

# Wait for LocalStack
check_service "http://localhost:4566/_localstack/health" "LocalStack"

# Wait for Task Router
check_service "http://localhost:3001/health" "Task Router"

# Wait for Agent Web
check_service "http://localhost:3000/api/jobs" "Agent Web"

echo ""
echo "🎉 All services are up and running!"
echo ""
echo "🔗 Service URLs:"
echo "   📱 Agent Web Interface: http://localhost:3000"
echo "   🔧 Task Router API: http://localhost:3001"
echo "   ☁️  LocalStack Dashboard: http://localhost:4566"
echo "   📊 Task Router Metrics: http://localhost:9090/metrics"
echo ""
echo "🧪 Test the system:"
echo "   1. Open http://localhost:3000 in your browser"
echo "   2. Fill out the form to create a task"
echo "   3. Check the logs with: docker-compose logs -f"
echo ""
echo "📝 Useful commands:"
echo "   View logs: docker-compose logs -f [service-name]"
echo "   Stop all: docker-compose down"
echo "   Restart: docker-compose restart [service-name]"
echo "   Shell into container: docker-compose exec [service-name] /bin/sh"
echo ""
echo "🔍 AWS Resources (LocalStack):"
echo "   List SQS queues: aws --endpoint-url=http://localhost:4566 sqs list-queues"
echo "   List S3 buckets: aws --endpoint-url=http://localhost:4566 s3 ls" 