#!/bin/bash

# Test ALB Routing Script
# This script tests the routing between agent-web and task-router

ALB_URL="http://ai-agents-alb-production-1178691711.us-east-1.elb.amazonaws.com"

echo "🔍 Testing ALB Routing for Multi-Agent System"
echo "============================================="
echo "ALB URL: $ALB_URL"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Test 1: Main website (should go to agent-web)
echo "1. 🌐 Testing main website (agent-web)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$ALB_URL/")
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Main website: $HTTP_CODE - agent-web is working"
else
    echo "   ❌ Main website: $HTTP_CODE - agent-web has issues"
fi

# Test 2: Task-router health check
echo "2. 🏥 Testing task-router health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" "$ALB_URL/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
RESPONSE_BODY=$(echo "$HEALTH_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Task-router health: $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
else
    echo "   ❌ Task-router health: $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
fi

# Test 3: Task-router API endpoint (GET)
echo "3. 🔌 Testing task-router API endpoint (GET)..."
API_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" "$ALB_URL/api/router/jobs")
HTTP_CODE=$(echo "$API_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
RESPONSE_BODY=$(echo "$API_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Task-router API (GET): $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
else
    echo "   ❌ Task-router API (GET): $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
fi

# Test 4: Test job creation (POST)
echo "4. 🚀 Testing job creation (POST)..."
JOB_PAYLOAD='{"product":"Test Product","audience":"Test Audience","tone":"professional"}'
POST_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$JOB_PAYLOAD" \
    "$ALB_URL/api/router/jobs")

HTTP_CODE=$(echo "$POST_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
RESPONSE_BODY=$(echo "$POST_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Job creation: $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
else
    echo "   ❌ Job creation: $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
fi

# Test 5: Agent-web API (should go to agent-web)
echo "5. 🎯 Testing agent-web API endpoint..."
WEB_API_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" "$ALB_URL/api/jobs")
HTTP_CODE=$(echo "$WEB_API_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
RESPONSE_BODY=$(echo "$WEB_API_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Agent-web API: $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
else
    echo "   ❌ Agent-web API: $HTTP_CODE"
    echo "   📄 Response: $RESPONSE_BODY"
fi

echo ""
echo "📊 Diagnosis Summary:"
echo "====================="
echo "If task-router health (test 2) fails: Task-router target group is unhealthy"
echo "If task-router API (test 3) fails: ALB routing rules are broken"
echo "If job creation (test 4) fails: Task-router API has issues"
echo "If agent-web API (test 5) fails: Agent-web has issues"
echo ""
echo "🔧 Next Steps:"
echo "- If tests 2-4 fail: Check ALB Target Groups in AWS Console"
echo "- If only test 4 fails: Check task-router logs for errors"
echo "- If test 5 fails: Check agent-web logs for errors" 