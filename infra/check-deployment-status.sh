#!/bin/bash

# Check Deployment Status Script
# Usage: ./check-deployment-status.sh [environment]

ENVIRONMENT=${1:-production}
REGION=${AWS_REGION:-us-east-1}

# Configuration
CLUSTER_NAME="ai-agents-cluster"
STACK_NAME="ai-agents-ecs-infrastructure-${ENVIRONMENT}"

echo "🔍 Checking deployment status for environment: $ENVIRONMENT"
echo "----------------------------------------"

# Check CloudFormation Stack
echo "📋 CloudFormation Stack Status:"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].{StackName:StackName,Status:StackStatus,LastUpdated:LastUpdatedTime}' \
    --output table 2>/dev/null || echo "❌ Stack '$STACK_NAME' not found or failed"

echo ""

# Check ECS Cluster
echo "🚀 ECS Cluster Status:"
aws ecs describe-clusters \
    --clusters "$CLUSTER_NAME" \
    --query 'clusters[0].{ClusterName:clusterName,Status:status,ActiveServices:activeServicesCount,RunningTasks:runningTasksCount}' \
    --output table 2>/dev/null || echo "❌ Cluster '$CLUSTER_NAME' not found"

echo ""

# Check ECS Services
echo "📦 ECS Services Status:"
aws ecs list-services \
    --cluster "$CLUSTER_NAME" \
    --query 'serviceArns[*]' \
    --output text 2>/dev/null | while read service_arn; do
    if [ -n "$service_arn" ]; then
        service_name=$(basename "$service_arn")
        aws ecs describe-services \
            --cluster "$CLUSTER_NAME" \
            --services "$service_arn" \
            --query 'services[0].{ServiceName:serviceName,Status:status,DesiredCount:desiredCount,RunningCount:runningCount}' \
            --output table
    fi
done || echo "❌ No services found or cluster inactive"

echo ""
echo "✅ Status check complete!" 