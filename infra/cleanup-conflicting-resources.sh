#!/bin/bash

# Cleanup Conflicting Resources Script
# This script removes resources that might conflict with CloudFormation deployment

set -e

ENVIRONMENT=${1:-production}
REGION=${AWS_REGION:-us-east-1}

echo "🧹 Cleaning up conflicting resources for environment: $ENVIRONMENT"
echo "================================================================="
echo "Region: $REGION"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Function to log with timestamp
log() {
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $1"
}

# Function to check and clean up S3 bucket
cleanup_s3_bucket() {
    local bucket_name="multi-agents-artifacts"
    
    log "🪣 Checking S3 bucket: $bucket_name"
    
    # Check if bucket exists
    if aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" 2>/dev/null; then
        log "   ✅ Bucket exists - checking if it's ours or conflicting"
        
        # Try to get bucket tags to see if it's ours
        BUCKET_TAGS=$(aws s3api get-bucket-tagging --bucket "$bucket_name" --region "$REGION" 2>/dev/null || echo "NO_TAGS")
        
        if [[ "$BUCKET_TAGS" == "NO_TAGS" ]]; then
            log "   ⚠️  Bucket has no tags - this might be from another account/project"
            log "   💡 We'll use a unique bucket name instead: ai-agents-artifacts-${ENVIRONMENT}-\${AWS::AccountId}"
        else
            echo "   📋 Bucket tags:"
            echo "$BUCKET_TAGS" | jq '.TagSet[]' 2>/dev/null || echo "   Cannot parse tags"
            
            # Check if it's our bucket
            OUR_BUCKET=$(echo "$BUCKET_TAGS" | jq -r '.TagSet[] | select(.Key=="Service" and .Value=="ai-agents") | .Value' 2>/dev/null || echo "")
            
            if [[ "$OUR_BUCKET" == "ai-agents" ]]; then
                log "   ✅ This is our bucket - we can reuse it"
                log "   ⚠️  But CloudFormation expects to create it, so we need to empty and delete it"
                
                log "   🗑️  Emptying bucket contents..."
                aws s3 rm "s3://$bucket_name" --recursive --region "$REGION" || log "   ⚠️  Failed to empty bucket or already empty"
                
                log "   🗑️  Deleting bucket..."
                aws s3api delete-bucket --bucket "$bucket_name" --region "$REGION" || log "   ⚠️  Failed to delete bucket"
                
                log "   ✅ Bucket cleanup completed"
            else
                log "   ⚠️  Bucket belongs to another project - we'll use unique naming"
            fi
        fi
    else
        log "   ✅ Bucket doesn't exist - no cleanup needed"
    fi
}

# Function to check and clean up CloudFormation stack in failed state
cleanup_failed_stack() {
    local stack_name="ai-agents-ecs-infrastructure-${ENVIRONMENT}"
    
    log "📋 Checking CloudFormation stack: $stack_name"
    
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "DOES_NOT_EXIST")
    
    log "   Stack status: $STACK_STATUS"
    
    case $STACK_STATUS in
        "ROLLBACK_COMPLETE"|"CREATE_FAILED"|"DELETE_FAILED"|"UPDATE_ROLLBACK_COMPLETE")
            log "   ⚠️  Stack is in failed state - deleting..."
            
            aws cloudformation delete-stack \
                --stack-name "$stack_name" \
                --region "$REGION"
            
            log "   ⏳ Waiting for stack deletion..."
            aws cloudformation wait stack-delete-complete \
                --stack-name "$stack_name" \
                --region "$REGION" \
                --waiter-config 'Delay=15,MaxAttempts=40'
            
            log "   ✅ Stack deleted successfully"
            ;;
        "DELETE_IN_PROGRESS")
            log "   ⏳ Stack is already being deleted - waiting for completion..."
            aws cloudformation wait stack-delete-complete \
                --stack-name "$stack_name" \
                --region "$REGION" \
                --waiter-config 'Delay=15,MaxAttempts=40'
            log "   ✅ Stack deletion completed"
            ;;
        "DOES_NOT_EXIST")
            log "   ✅ Stack doesn't exist - no cleanup needed"
            ;;
        "CREATE_COMPLETE"|"UPDATE_COMPLETE")
            log "   ✅ Stack is healthy - no cleanup needed"
            ;;
        *)
            log "   ⚠️  Stack in unexpected state: $STACK_STATUS"
            log "   💡 Manual intervention may be required"
            ;;
    esac
}

# Function to check ECS clusters
cleanup_ecs_cluster() {
    local cluster_name="ai-agents-cluster"
    
    log "🚀 Checking ECS cluster: $cluster_name"
    
    CLUSTER_STATUS=$(aws ecs describe-clusters \
        --clusters "$cluster_name" \
        --region "$REGION" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    log "   Cluster status: $CLUSTER_STATUS"
    
    case $CLUSTER_STATUS in
        "INACTIVE")
            log "   ⚠️  Cluster is INACTIVE - deleting..."
            aws ecs delete-cluster \
                --cluster "$cluster_name" \
                --region "$REGION" || log "   ⚠️  Delete failed or already deleted"
            log "   ✅ Cluster deletion initiated"
            ;;
        "ACTIVE")
            log "   ✅ Cluster is active - checking for running services..."
            
            SERVICES=$(aws ecs list-services \
                --cluster "$cluster_name" \
                --region "$REGION" \
                --query 'serviceArns[*]' \
                --output text)
            
            if [[ -n "$SERVICES" && "$SERVICES" != "None" ]]; then
                log "   ⚠️  Cluster has running services - manual cleanup may be needed"
                echo "   Services: $SERVICES"
            else
                log "   ✅ Cluster is active with no services"
            fi
            ;;
        "NOT_FOUND")
            log "   ✅ Cluster doesn't exist - no cleanup needed"
            ;;
        *)
            log "   ⚠️  Cluster in unexpected state: $CLUSTER_STATUS"
            ;;
    esac
}

# Main execution
log "🚀 Starting cleanup process..."
echo ""

cleanup_s3_bucket
echo ""

cleanup_ecs_cluster
echo ""

cleanup_failed_stack
echo ""

log "🎉 Cleanup process completed!"
log ""
log "💡 Next steps:"
log "1. The CloudFormation template now uses unique bucket names"
log "2. Any conflicting resources have been cleaned up"
log "3. You can now redeploy the infrastructure"
log ""
log "✨ Run your GitHub Actions deployment again or manually deploy with:"
log "   aws cloudformation deploy \\"
log "     --template-file ./infra/cloudformation/ecs-infrastructure.yml \\"
log "     --stack-name ai-agents-ecs-infrastructure-${ENVIRONMENT} \\"
log "     --parameter-overrides Environment=${ENVIRONMENT} OpenAIApiKey=\$OPENAI_API_KEY \\"
log "     --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \\"
log "     --region ${REGION}" 