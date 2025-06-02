#!/bin/bash

# Redeploy Agent-Web Service
# This forces agent-web to restart with the latest environment variables

CLUSTER_NAME="ai-agents-cluster"
SERVICE_NAME="ai-agents-agent-web-production"
REGION=${AWS_REGION:-us-east-1}

echo "🔄 Redeploying Agent-Web Service"
echo "==============================="
echo "Cluster: $CLUSTER_NAME"
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

echo "🔍 Current service status:"
aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --region "$REGION" \
    --query 'services[0].{ServiceName:serviceName,Status:status,RunningCount:runningCount,DesiredCount:desiredCount,TaskDefinition:taskDefinition}' \
    --output table

echo ""
echo "🚀 Forcing new deployment..."
DEPLOYMENT_OUTPUT=$(aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --force-new-deployment \
    --region "$REGION" \
    --output json)

if [ $? -eq 0 ]; then
    echo "✅ Successfully triggered redeployment"
    
    # Extract deployment info
    NEW_DEPLOYMENT_ID=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.service.deployments[0].id // "unknown"')
    echo "📋 Deployment ID: $NEW_DEPLOYMENT_ID"
    
    echo ""
    echo "⏳ Waiting 30 seconds for deployment to start..."
    sleep 30
    
    echo "🔍 Checking deployment status..."
    aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$REGION" \
        --query 'services[0].{ServiceName:serviceName,Status:status,RunningCount:runningCount,DesiredCount:desiredCount,LatestDeployment:deployments[0]}' \
        --output table
        
    echo ""
    echo "🎯 Next Steps:"
    echo "1. Wait 2-3 minutes for agent-web to fully restart"
    echo "2. Test job creation on the website"
    echo "3. Check agent-web logs: ECS Console → ai-agents-cluster → ai-agents-agent-web-production → View logs"
    echo "4. If still failing, check the environment variables were updated correctly"
    
else
    echo "❌ Failed to trigger redeployment"
    echo "Error output: $DEPLOYMENT_OUTPUT"
fi 