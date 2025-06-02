#!/bin/bash

# Test Agent-Web Configuration
# This script tests the environment variables and network connectivity from agent-web

ALB_URL="http://ai-agents-alb-production-1178691711.us-east-1.elb.amazonaws.com"
CLUSTER_NAME="ai-agents-cluster"

echo "🔍 Testing Agent-Web Configuration and Connectivity"
echo "=================================================="
echo "ALB URL: $ALB_URL"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

echo "1. 🏥 Testing if agent-web can reach task-router via load balancer..."
curl -s -w "HTTP_CODE:%{http_code}" "$ALB_URL/health" && echo ""

echo ""
echo "2. 🚀 Testing direct job creation (simulating agent-web call)..."
JOB_PAYLOAD='{"product":"Test Config","audience":"Developers","tone":"technical"}'
curl -s -w "HTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$JOB_PAYLOAD" \
    "$ALB_URL/api/router/jobs" && echo ""

echo ""
echo "3. 📋 Checking agent-web task environment variables..."

# Get the current task ARN for agent-web service
echo "🔍 Finding agent-web task..."
TASK_ARN=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --service-name "ai-agents-agent-web-production" \
    --query 'taskArns[0]' \
    --output text 2>/dev/null)

if [ "$TASK_ARN" != "None" ] && [ -n "$TASK_ARN" ]; then
    echo "✅ Found task: $TASK_ARN"
    
    # Get task definition to see environment variables
    echo "🔍 Getting task definition details..."
    TASK_DEF_ARN=$(aws ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks "$TASK_ARN" \
        --query 'tasks[0].taskDefinitionArn' \
        --output text 2>/dev/null)
    
    if [ -n "$TASK_DEF_ARN" ]; then
        echo "📋 Task Definition: $TASK_DEF_ARN"
        echo ""
        echo "🔧 Environment Variables:"
        aws ecs describe-task-definition \
            --task-definition "$TASK_DEF_ARN" \
            --query 'taskDefinition.containerDefinitions[0].environment[?name==`TASK_ROUTER_API_URL`]' \
            --output table 2>/dev/null || echo "❌ Could not retrieve environment variables"
    else
        echo "❌ Could not get task definition"
    fi
else
    echo "❌ No running agent-web task found"
fi

echo ""
echo "4. 🌐 Testing network connectivity from within VPC..."
echo "   (Note: This is external to the VPC, results may differ)"

echo ""
echo "💡 Diagnosis Help:"
echo "=================="
echo "✅ If test 1 succeeds: Task-router is reachable via load balancer"
echo "✅ If test 2 succeeds: Job creation API is working"
echo "🔧 If environment variable shows wrong URL: Need to redeploy agent-web"
echo "🌐 If network test fails: Security group or routing issue"
echo ""
echo "🎯 Expected TASK_ROUTER_API_URL: $ALB_URL" 