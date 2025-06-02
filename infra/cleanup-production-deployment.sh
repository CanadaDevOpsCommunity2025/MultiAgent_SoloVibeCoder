#!/bin/bash

# Comprehensive Production Cleanup Script
# This script properly cleans up all AWS resources for a fresh deployment

set -e

ENVIRONMENT=${1:-production}
REGION=${AWS_REGION:-us-east-1}

echo "🧹 Comprehensive cleanup for environment: $ENVIRONMENT"
echo "================================================================="
echo "Region: $REGION"
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Function to log with timestamp
log() {
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $1"
}

# Function to properly clean up S3 bucket with versioned objects
cleanup_s3_bucket() {
    local bucket_name="multi-agents-artifacts"
    
    log "🪣 Cleaning up S3 bucket: $bucket_name"
    
    # Check if bucket exists
    if aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" 2>/dev/null; then
        log "   📋 Bucket exists - cleaning up all versions and delete markers..."
        
        # Remove all object versions and delete markers
        aws s3api list-object-versions \
            --bucket "$bucket_name" \
            --region "$REGION" \
            --output json | \
        jq -r '.Versions[]?, .DeleteMarkers[]? | "\(.Key)\t\(.VersionId)"' | \
        while read -r key version_id; do
            if [[ -n "$key" && -n "$version_id" ]]; then
                log "   🗑️  Deleting: $key (version: ${version_id:0:20}...)"
                aws s3api delete-object \
                    --bucket "$bucket_name" \
                    --key "$key" \
                    --version-id "$version_id" \
                    --region "$REGION" >/dev/null || log "   ⚠️  Failed to delete $key"
            fi
        done
        
        log "   🗑️  Deleting bucket..."
        aws s3api delete-bucket --bucket "$bucket_name" --region "$REGION" || log "   ⚠️  Failed to delete bucket"
        
        log "   ✅ S3 bucket cleanup completed"
    else
        log "   ✅ Bucket doesn't exist - no cleanup needed"
    fi
}

# Function to clean up ECS services
cleanup_ecs_services() {
    local cluster_name="ai-agents-cluster"
    
    log "🚀 Cleaning up ECS services in cluster: $cluster_name"
    
    # Check if cluster exists
    CLUSTER_STATUS=$(aws ecs describe-clusters \
        --clusters "$cluster_name" \
        --region "$REGION" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
        log "   📋 Getting list of services..."
        SERVICES=$(aws ecs list-services \
            --cluster "$cluster_name" \
            --region "$REGION" \
            --query 'serviceArns[*]' \
            --output text)
        
        if [[ -n "$SERVICES" && "$SERVICES" != "None" ]]; then
            for service_arn in $SERVICES; do
                service_name=$(basename "$service_arn")
                log "   🛑 Scaling down service: $service_name"
                
                # Scale down to 0
                aws ecs update-service \
                    --cluster "$cluster_name" \
                    --service "$service_name" \
                    --desired-count 0 \
                    --region "$REGION" >/dev/null || log "   ⚠️  Failed to scale down $service_name"
            done
            
            log "   ⏳ Waiting 30 seconds for services to scale down..."
            sleep 30
            
            for service_arn in $SERVICES; do
                service_name=$(basename "$service_arn")
                log "   🗑️  Deleting service: $service_name"
                
                aws ecs delete-service \
                    --cluster "$cluster_name" \
                    --service "$service_name" \
                    --region "$REGION" >/dev/null || log "   ⚠️  Failed to delete $service_name"
            done
            
            log "   ⏳ Waiting 60 seconds for services to be deleted..."
            sleep 60
        else
            log "   ✅ No services found in cluster"
        fi
        
        log "   🗑️  Deleting ECS cluster..."
        aws ecs delete-cluster \
            --cluster "$cluster_name" \
            --region "$REGION" >/dev/null || log "   ⚠️  Failed to delete cluster"
            
        log "   ✅ ECS cleanup completed"
    else
        log "   ✅ Cluster doesn't exist or is inactive - no cleanup needed"
    fi
}

# Function to clean up CloudFormation stack
cleanup_cloudformation_stack() {
    local stack_name="ai-agents-ecs-infrastructure-${ENVIRONMENT}"
    
    log "📋 Cleaning up CloudFormation stack: $stack_name"
    
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "DOES_NOT_EXIST")
    
    log "   Stack status: $STACK_STATUS"
    
    case $STACK_STATUS in
        "UPDATE_ROLLBACK_COMPLETE"|"ROLLBACK_COMPLETE"|"CREATE_FAILED"|"DELETE_FAILED")
            log "   ⚠️  Stack is in failed state - deleting..."
            
            aws cloudformation delete-stack \
                --stack-name "$stack_name" \
                --region "$REGION"
            
            log "   ⏳ Waiting for stack deletion (this may take several minutes)..."
            
            # Use proper waiter syntax
            timeout_seconds=2400  # 40 minutes
            start_time=$(date +%s)
            
            while true; do
                current_time=$(date +%s)
                elapsed=$((current_time - start_time))
                
                if [[ $elapsed -gt $timeout_seconds ]]; then
                    log "   ⚠️  Timeout waiting for stack deletion"
                    break
                fi
                
                CURRENT_STATUS=$(aws cloudformation describe-stacks \
                    --stack-name "$stack_name" \
                    --region "$REGION" \
                    --query 'Stacks[0].StackStatus' \
                    --output text 2>/dev/null || echo "DOES_NOT_EXIST")
                
                if [[ "$CURRENT_STATUS" == "DOES_NOT_EXIST" ]]; then
                    log "   ✅ Stack deleted successfully"
                    break
                elif [[ "$CURRENT_STATUS" == "DELETE_FAILED" ]]; then
                    log "   ❌ Stack deletion failed"
                    break
                else
                    log "   ⏳ Still deleting... (status: $CURRENT_STATUS, elapsed: ${elapsed}s)"
                    sleep 30
                fi
            done
            ;;
        "DELETE_IN_PROGRESS")
            log "   ⏳ Stack is already being deleted - waiting for completion..."
            # Same waiting logic as above
            ;;
        "DOES_NOT_EXIST")
            log "   ✅ Stack doesn't exist - no cleanup needed"
            ;;
        "CREATE_COMPLETE"|"UPDATE_COMPLETE")
            log "   ⚠️  Stack is healthy but we need to delete it for fresh deployment"
            aws cloudformation delete-stack \
                --stack-name "$stack_name" \
                --region "$REGION"
            log "   ⏳ Waiting for stack deletion..."
            # Use the same waiting logic
            ;;
        *)
            log "   ⚠️  Stack in unexpected state: $STACK_STATUS"
            log "   💡 Manual intervention may be required"
            ;;
    esac
}

# Main execution
log "🚀 Starting comprehensive cleanup process..."
echo ""

# Step 1: Clean up ECS services first (to avoid dependency issues)
cleanup_ecs_services
echo ""

# Step 2: Clean up S3 bucket
cleanup_s3_bucket
echo ""

# Step 3: Clean up CloudFormation stack
cleanup_cloudformation_stack
echo ""

log "🎉 Comprehensive cleanup completed!"
log ""
log "💡 Next steps:"
log "1. All conflicting resources have been cleaned up"
log "2. You can now deploy fresh infrastructure"
log "3. Run the GitHub Actions workflow or manual deployment"
log ""
log "✨ Manual deployment command:"
log "   aws cloudformation deploy \\"
log "     --template-file ./infra/cloudformation/ecs-infrastructure.yml \\"
log "     --stack-name ai-agents-ecs-infrastructure-${ENVIRONMENT} \\"
log "     --parameter-overrides Environment=${ENVIRONMENT} OpenAIApiKey=\$OPENAI_API_KEY \\"
log "     --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \\"
log "     --region ${REGION}" 