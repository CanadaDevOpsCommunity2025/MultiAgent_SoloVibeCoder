#!/bin/bash

# AWS Setup Script for LocalStack
# This script creates all the required SQS queues and S3 buckets for the multi-agent system

echo "🔧 Setting up AWS resources in LocalStack..."

# Set AWS CLI to use LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

# LocalStack endpoint
ENDPOINT_URL="http://localhost:4566"

# Wait for LocalStack to be ready
echo "⏳ Waiting for LocalStack to be ready..."
until curl -s "$ENDPOINT_URL/_localstack/health" > /dev/null; do
  echo "LocalStack not ready yet, waiting..."
  sleep 2
done
echo "✅ LocalStack is ready!"

# Create SQS Queues
echo "📬 Creating SQS queues..."

# Task Router Jobs Queue
aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name task-router-jobs
echo "  ✅ Created task-router-jobs queue"

# Events Queue
aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name task-events
echo "  ✅ Created task-events queue"

# Agent Queues
aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name research-tasks
echo "  ✅ Created research-tasks queue"

aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name product-manager-tasks
echo "  ✅ Created product-manager-tasks queue"

aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name designer-tasks
echo "  ✅ Created designer-tasks queue"

aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name drawer-tasks
echo "  ✅ Created drawer-tasks queue"

aws --endpoint-url=$ENDPOINT_URL sqs create-queue --queue-name coder-tasks
echo "  ✅ Created coder-tasks queue"

# Create S3 Buckets
echo "🪣 Creating S3 buckets..."

aws --endpoint-url=$ENDPOINT_URL s3 mb s3://task-artifacts
echo "  ✅ Created task-artifacts bucket"

# List created resources
echo ""
echo "📋 Created SQS Queues:"
aws --endpoint-url=$ENDPOINT_URL sqs list-queues

echo ""
echo "📋 Created S3 Buckets:"
aws --endpoint-url=$ENDPOINT_URL s3 ls

echo ""
echo "🎉 AWS resources setup completed successfully!" 