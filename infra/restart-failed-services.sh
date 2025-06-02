#!/bin/bash

# Restart Failed Agent Services
# This fixes the issue where researcher and product_manager services aren't running

CLUSTER_NAME="ai-agents-cluster"
REGION=${AWS_REGION:-us-east-1}

echo "🔧 Restarting Failed Agent Services"
echo "==================================="
echo "Cluster: $CLUSTER_NAME"
echo "Region: $REGION"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Services that are currently failing (0/1 tasks)
FAILED_SERVICES=(
    "ai-agents-researcher-production"
    "ai-agents-product_manager-production"
)

for service in "${FAILED_SERVICES[@]}"; do
    echo "🚀 Restarting service: $service"
    
    # Force new deployment (this recreates tasks)
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$service" \
        --force-new-deployment \
        --region "$REGION" \
        --output table \
        --query 'service.{ServiceName:serviceName,Status:status,RunningCount:runningCount,DesiredCount:desiredCount}'
    
    if [ $? -eq 0 ]; then
        echo "   ✅ Successfully triggered restart for $service"
    else
        echo "   ❌ Failed to restart $service"
    fi
    echo ""
done

echo "⏳ Waiting 30 seconds for services to stabilize..."
sleep 30

echo "📊 Checking service status..."
for service in "${FAILED_SERVICES[@]}"; do
    echo "🔍 Status of $service:"
    aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service" \
        --region "$REGION" \
        --query 'services[0].{ServiceName:serviceName,Status:status,RunningCount:runningCount,DesiredCount:desiredCount,LatestEvent:events[0].message}' \
        --output table
    echo ""
done

echo "🎯 Next Steps:"
echo "- Wait 2-3 minutes for services to fully start"
echo "- Test job processing again on the website"
echo "- If still failing, check ECS Console for detailed error logs" 