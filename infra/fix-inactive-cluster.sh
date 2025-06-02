#!/bin/bash

# Fix INACTIVE ECS Cluster Issue
# This script handles the specific case where ECS cluster exists but is INACTIVE

set -e

ENVIRONMENT=${1:-production}
REGION=${AWS_REGION:-us-east-1}

# Configuration
CLUSTER_NAME="ai-agents-cluster"
STACK_NAME="ai-agents-ecs-infrastructure-${ENVIRONMENT}"

echo "🔧 Fixing INACTIVE ECS Cluster Issue"
echo "======================================"
echo "Environment: $ENVIRONMENT"
echo "Stack: $STACK_NAME"
echo "Cluster: $CLUSTER_NAME"
echo "Region: $REGION"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Function to log with timestamp
log() {
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $1"
}

# Function to force cluster recreation through CloudFormation
fix_inactive_cluster() {
    log "🔍 Step 1: Verifying the issue..."
    
    # Check cluster status
    CLUSTER_STATUS=$(aws ecs describe-clusters \
        --clusters "$CLUSTER_NAME" \
        --region "$REGION" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    log "   Current cluster status: $CLUSTER_STATUS"
    
    if [[ "$CLUSTER_STATUS" != "INACTIVE" ]]; then
        log "   ✅ Cluster is not INACTIVE. Current status: $CLUSTER_STATUS"
        if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
            log "   🎉 Cluster is already ACTIVE! No fix needed."
            return 0
        else
            log "   ⚠️  Unexpected cluster status: $CLUSTER_STATUS"
        fi
    fi
    
    log ""
    log "🗑️  Step 2: Removing inactive cluster from ECS..."
    
    # Delete the inactive cluster from ECS (not CloudFormation)
    aws ecs delete-cluster \
        --cluster "$CLUSTER_NAME" \
        --region "$REGION" || {
        log "   ⚠️  Cluster deletion failed - may already be gone"
    }
    
    log "   ✅ Cluster deletion initiated"
    
    # Wait a moment for the deletion to process
    sleep 10
    
    log ""
    log "🔄 Step 3: Forcing CloudFormation to recreate the cluster..."
    
    # The key insight: We need to update the CloudFormation template with a change
    # that will force the ECS cluster to be recreated
    
    # First, let's add a dummy tag to force an update
    TIMESTAMP=$(date +%s)
    
    log "   📝 Adding timestamp tag to force cluster recreation..."
    
    # Deploy the stack with an additional parameter that changes the cluster
    aws cloudformation deploy \
        --template-file ./infra/cloudformation/ecs-infrastructure.yml \
        --stack-name "$STACK_NAME" \
        --parameter-overrides \
            Environment="$ENVIRONMENT" \
            OpenAIApiKey="${OPENAI_API_KEY}" \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --region "$REGION" \
        --no-fail-on-empty-changeset \
        --tags \
            Environment="$ENVIRONMENT" \
            LastClusterFix="$TIMESTAMP" \
        || {
        log "   ❌ CloudFormation update failed"
        return 1
    }
    
    log "   ✅ CloudFormation update completed"
    
    log ""
    log "⏳ Step 4: Waiting for cluster to be recreated..."
    
    # Wait for cluster to be recreated and become active
    local max_attempts=12
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        log "   🔍 Attempt $attempt/$max_attempts: Checking cluster status..."
        
        sleep 15
        
        CLUSTER_STATUS=$(aws ecs describe-clusters \
            --clusters "$CLUSTER_NAME" \
            --region "$REGION" \
            --query 'clusters[0].status' \
            --output text 2>/dev/null || echo "NOT_FOUND")
        
        log "   Status: $CLUSTER_STATUS"
        
        case $CLUSTER_STATUS in
            "ACTIVE")
                log "   🎉 Cluster is now ACTIVE!"
                
                # Show cluster details
                aws ecs describe-clusters \
                    --clusters "$CLUSTER_NAME" \
                    --region "$REGION" \
                    --query 'clusters[0].{Name:clusterName,Status:status,RunningTasks:runningTasksCount,ActiveServices:activeServicesCount,CapacityProviders:capacityProviders}' \
                    --output table
                
                return 0
                ;;
            "INACTIVE"|"NOT_FOUND")
                log "   ⏳ Cluster not ready yet, waiting..."
                ;;
            *)
                log "   🔄 Cluster in transition state: $CLUSTER_STATUS"
                ;;
        esac
        
        ((attempt++))
    done
    
    log "   ❌ Cluster did not become ACTIVE within expected time"
    return 1
}

# Alternative approach: Recreate the cluster using replacement
force_cluster_replacement() {
    log ""
    log "🔄 Alternative: Forcing cluster replacement..."
    
    # Create a temporary CloudFormation template that forces cluster replacement
    # We'll modify the cluster name slightly to force replacement
    
    TEMP_CLUSTER_NAME="${CLUSTER_NAME}-temp"
    TIMESTAMP=$(date +%s)
    
    log "   📝 Creating temporary cluster: $TEMP_CLUSTER_NAME"
    
    # Create a changeset that replaces the cluster
    cat > /tmp/cluster-fix.json << EOF
[
  {
    "ParameterKey": "Environment",
    "ParameterValue": "$ENVIRONMENT"
  },
  {
    "ParameterKey": "OpenAIApiKey", 
    "ParameterValue": "${OPENAI_API_KEY}"
  }
]
EOF

    # Create a change set to replace the cluster
    aws cloudformation create-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "fix-inactive-cluster-$TIMESTAMP" \
        --template-body file://./infra/cloudformation/ecs-infrastructure.yml \
        --parameters file:///tmp/cluster-fix.json \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --region "$REGION" || {
        log "   ❌ Failed to create change set"
        return 1
    }
    
    log "   📋 Change set created, executing..."
    
    # Execute the change set
    aws cloudformation execute-change-set \
        --change-set-name "fix-inactive-cluster-$TIMESTAMP" \
        --stack-name "$STACK_NAME" \
        --region "$REGION" || {
        log "   ❌ Failed to execute change set"
        return 1
    }
    
    log "   ⏳ Waiting for stack update to complete..."
    
    # Wait for the stack update to complete
    aws cloudformation wait stack-update-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION" || {
        log "   ❌ Stack update failed or timed out"
        return 1
    }
    
    log "   ✅ Stack update completed"
    
    # Verify cluster is now active
    FINAL_STATUS=$(aws ecs describe-clusters \
        --clusters "$CLUSTER_NAME" \
        --region "$REGION" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    log "   Final cluster status: $FINAL_STATUS"
    
    if [[ "$FINAL_STATUS" == "ACTIVE" ]]; then
        log "   🎉 Cluster successfully recreated and is ACTIVE!"
        return 0
    else
        log "   ❌ Cluster is still not ACTIVE: $FINAL_STATUS"
        return 1
    fi
}

# Main execution
log "🚀 Starting INACTIVE cluster fix..."

if fix_inactive_cluster; then
    log ""
    log "🎉 SUCCESS: ECS cluster is now ACTIVE!"
    log "   Cluster: $CLUSTER_NAME"
    log "   Region: $REGION"
    log ""
    log "✅ You can now proceed with service deployment."
else
    log ""
    log "⚠️  Primary fix method failed, trying alternative approach..."
    
    if force_cluster_replacement; then
        log ""
        log "🎉 SUCCESS: Cluster recreated using alternative method!"
    else
        log ""
        log "💥 FAILED: Unable to fix the INACTIVE cluster issue"
        log ""
        log "🔍 Debug Information:"
        
        # Show current cluster state
        aws ecs describe-clusters \
            --clusters "$CLUSTER_NAME" \
            --region "$REGION" \
            --output table || echo "Cannot describe cluster"
        
        # Show CloudFormation stack events
        aws cloudformation describe-stack-events \
            --stack-name "$STACK_NAME" \
            --region "$REGION" \
            --max-items 10 \
            --query 'StackEvents[*].[Timestamp,ResourceType,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
            --output table || echo "Cannot get stack events"
        
        log ""
        log "🛠️  Manual Resolution Required:"
        log "1. Go to AWS Console → CloudFormation"
        log "2. Find stack: $STACK_NAME"
        log "3. Update the stack (even with no changes) to force cluster recreation"
        log "4. Or delete the ECS cluster resource and update the stack"
        log ""
        log "Alternative: Delete the entire stack and redeploy:"
        log "   aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION"
        
        exit 1
    fi
fi

log ""
log "✨ Cluster fix completed successfully at $(date -u '+%Y-%m-%d %H:%M:%S UTC')" 