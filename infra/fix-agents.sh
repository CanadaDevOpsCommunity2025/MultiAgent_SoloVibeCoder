#!/bin/bash

# Fix Agent Services - Restart failed agents
# Based on AWS Console: researcher and product_manager are at 0/1 tasks

CLUSTER_NAME="ai-agents-cluster"
REGION=${AWS_REGION:-us-east-1}

echo "🔧 Fixing Agent Services"
echo "========================"
echo "Cluster: $CLUSTER_NAME"
echo "Region: $REGION"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Services that are currently failing (0/1 tasks)
FAILED_SERVICES=(
    "ai-agents-researcher-production"
    "ai-agents-product_manager-production"
)

echo "🔍 Current status of all services:"
aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services ai-agents-agent-web-production ai-agents-task-router-production ai-agents-researcher-production ai-agents-product_manager-production ai-agents-drawer-production ai-agents-designer-production ai-agents-coder-production \
    --query 'services[*].{Service:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
    --output table 2>/dev/null || echo "Some services may not exist"

echo ""

for service in "${FAILED_SERVICES[@]}"; do
    echo "🚀 Restarting failed service: $service"
    
    # Force new deployment (this recreates tasks)
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$service" \
        --force-new-deployment \
        --region "$REGION" \
        --query 'service.{ServiceName:serviceName,Status:status,RunningCount:runningCount,DesiredCount:desiredCount}' \
        --output table
    
    if [ $? -eq 0 ]; then
        echo "   ✅ Successfully triggered restart for $service"
    else
        echo "   ❌ Failed to restart $service"
    fi
    echo ""
done

echo "⏳ Waiting 60 seconds for services to start..."
sleep 60

echo "📊 Final status check:"
for service in "${FAILED_SERVICES[@]}"; do
    echo "🔍 Status of $service:"
    aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service" \
        --region "$REGION" \
        --query 'services[0].{ServiceName:serviceName,Status:status,RunningCount:runningCount,DesiredCount:desiredCount}' \
        --output table
done

echo ""
echo "🎯 What should happen next:"
echo "1. ✅ Agent-web and task-router are already working (communication verified)"
echo "2. 🔄 Researcher and product_manager should start processing jobs"
echo "3. 📊 Check job progress on your website: http://ai-agents-alb-production-1178691711.us-east-1.elb.amazonaws.com"
echo "4. 🎉 Jobs should progress from 'pending' to 'in_progress' to 'completed'" 