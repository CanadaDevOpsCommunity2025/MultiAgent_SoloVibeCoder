#!/bin/bash

# Fix ECS Cluster Issue for GitHub Actions
# This script addresses the "ClusterNotFoundException: The referenced cluster was inactive" error

set -e

ENVIRONMENT=${1:-production}
REGION=${AWS_REGION:-us-east-1}

# Configuration
CLUSTER_NAME="ai-agents-cluster"
STACK_NAME="ai-agents-ecs-infrastructure-${ENVIRONMENT}"

echo "🔧 Fixing ECS Cluster Issue for Environment: $ENVIRONMENT"
echo "=========================================================="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Script Version: 2.0"
echo "Environment Variables:"
echo "  ENVIRONMENT: $ENVIRONMENT"
echo "  STACK_NAME: $STACK_NAME"
echo "  CLUSTER_NAME: $CLUSTER_NAME"
echo "  REGION: $REGION"
echo "  AWS_ACCOUNT_ID: ${AWS_ACCOUNT_ID:-'<not set>'}"
echo "  GITHUB_SHA: ${GITHUB_SHA:-'<not set>'}"
echo "  GITHUB_REF: ${GITHUB_REF:-'<not set>'}"
echo ""

# Function to log with timestamp
log() {
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $1"
}

# Function to log AWS CLI version and identity
check_aws_environment() {
    log "🔍 Checking AWS Environment..."
    
    echo "AWS CLI Version:"
    aws --version || echo "  ❌ AWS CLI version check failed"
    
    echo ""
    echo "AWS Identity:"
    aws sts get-caller-identity --output table || echo "  ❌ AWS identity check failed"
    
    echo ""
    echo "AWS Region Configuration:"
    echo "  Current Region: $(aws configure get region || echo 'not configured')"
    echo "  Environment Region: $REGION"
    
    echo ""
    echo "Available Regions:"
    aws ec2 describe-regions --query 'Regions[*].RegionName' --output table 2>/dev/null || echo "  ❌ Cannot list regions"
    
    echo ""
}

# Function to check and fix the cluster
fix_cluster() {
    log "1. 📋 Checking CloudFormation stack status..."
    
    # Check if stack exists first
    log "   Checking if stack exists: $STACK_NAME"
    
    STACK_EXISTS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'length(Stacks)' \
        --output text 2>/dev/null || echo "0")
    
    log "   Stack exists check result: $STACK_EXISTS"
    
    if [[ "$STACK_EXISTS" == "0" ]]; then
        STACK_STATUS="DOES_NOT_EXIST"
        log "   ❌ Stack does not exist"
    else
        STACK_STATUS=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region "$REGION" \
            --query 'Stacks[0].StackStatus' \
            --output text 2>/dev/null || echo "UNKNOWN")
        
        log "   Stack Status: $STACK_STATUS"
        
        # Get additional stack information
        echo "   📊 Stack Details:"
        aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region "$REGION" \
            --query 'Stacks[0].{StackName:StackName,Status:StackStatus,CreationTime:CreationTime,LastUpdatedTime:LastUpdatedTime,StackStatusReason:StackStatusReason}' \
            --output table 2>/dev/null || echo "     ❌ Cannot get stack details"
        
        # Get stack outputs if stack is in good state
        if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
            echo "   📤 Stack Outputs:"
            aws cloudformation describe-stacks \
                --stack-name "$STACK_NAME" \
                --region "$REGION" \
                --query 'Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}' \
                --output table 2>/dev/null || echo "     ❌ Cannot get stack outputs"
        fi
    fi
    
    # Handle different stack states
    case $STACK_STATUS in
        "CREATE_COMPLETE"|"UPDATE_COMPLETE")
            log "   ✅ Stack is in good state"
            ;;
        "CREATE_FAILED"|"ROLLBACK_COMPLETE"|"UPDATE_ROLLBACK_COMPLETE")
            log "   ❌ Stack is in failed state. Getting failure details..."
            
            echo "   🔍 Failed Stack Events (last 10):"
            aws cloudformation describe-stack-events \
                --stack-name "$STACK_NAME" \
                --region "$REGION" \
                --max-items 10 \
                --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[Timestamp,ResourceType,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
                --output table || echo "     ❌ Cannot get stack events"
            
            log "   🗑️  Deleting failed stack..."
            aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
            
            log "   ⏳ Waiting for stack deletion..."
            aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
            log "   ✅ Stack deleted"
            STACK_STATUS="DOES_NOT_EXIST"
            ;;
        "DELETE_IN_PROGRESS")
            log "   ⏳ Stack is being deleted. Waiting for completion..."
            aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
            STACK_STATUS="DOES_NOT_EXIST"
            ;;
        "CREATE_IN_PROGRESS"|"UPDATE_IN_PROGRESS")
            log "   ⏳ Stack operation in progress. Checking current status..."
            
            echo "   📋 Current Stack Events (last 5):"
            aws cloudformation describe-stack-events \
                --stack-name "$STACK_NAME" \
                --region "$REGION" \
                --max-items 5 \
                --query 'StackEvents[*].[Timestamp,ResourceType,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
                --output table || echo "     ❌ Cannot get current events"
            ;;
    esac
    
    log ""
    log "2. 🚀 Checking ECS cluster status..."
    
    # List all clusters in the region first
    log "   📋 All ECS clusters in region $REGION:"
    aws ecs list-clusters \
        --region "$REGION" \
        --query 'clusterArns[*]' \
        --output table || echo "     ❌ Cannot list clusters"
    
    log "   🔍 Checking specific cluster: $CLUSTER_NAME"
    
    # Check cluster status with detailed error handling
    CLUSTER_DESCRIBE_OUTPUT=$(aws ecs describe-clusters \
        --clusters "$CLUSTER_NAME" \
        --region "$REGION" \
        --output json 2>&1) || CLUSTER_DESCRIBE_FAILED=true
    
    if [[ "$CLUSTER_DESCRIBE_FAILED" == "true" ]]; then
        log "   ❌ Failed to describe cluster. Error output:"
        echo "$CLUSTER_DESCRIBE_OUTPUT" | head -10
        CLUSTER_STATUS="NOT_FOUND"
    else
        CLUSTER_STATUS=$(echo "$CLUSTER_DESCRIBE_OUTPUT" | jq -r '.clusters[0].status // "NOT_FOUND"')
        log "   Cluster Status: $CLUSTER_STATUS"
        
        # Show detailed cluster information
        echo "   📊 Cluster Details:"
        echo "$CLUSTER_DESCRIBE_OUTPUT" | jq -r '.clusters[0] | {
            clusterName: .clusterName,
            status: .status,
            runningTasksCount: .runningTasksCount,
            pendingTasksCount: .pendingTasksCount,
            activeServicesCount: .activeServicesCount,
            registeredContainerInstancesCount: .registeredContainerInstancesCount,
            capacityProviders: .capacityProviders,
            defaultCapacityProviderStrategy: .defaultCapacityProviderStrategy
        }' || echo "     ❌ Cannot parse cluster details"
        
        # If cluster exists, check for any services
        if [[ "$CLUSTER_STATUS" != "NOT_FOUND" ]]; then
            echo "   📋 Services in cluster:"
            aws ecs list-services \
                --cluster "$CLUSTER_NAME" \
                --region "$REGION" \
                --query 'serviceArns[*]' \
                --output table || echo "     ❌ Cannot list services"
        fi
    fi
    
    # If cluster is inactive, delete it
    if [[ "$CLUSTER_STATUS" == "INACTIVE" ]]; then
        log "   ❌ Cluster is INACTIVE. Getting more details..."
        
        echo "   🔍 Cluster capacity providers:"
        aws ecs describe-clusters \
            --clusters "$CLUSTER_NAME" \
            --region "$REGION" \
            --include capacityProviders \
            --query 'clusters[0].{CapacityProviders:capacityProviders,DefaultStrategy:defaultCapacityProviderStrategy}' \
            --output table || echo "     ❌ Cannot get capacity providers"
        
        log "   🗑️  Deleting inactive cluster..."
        aws ecs delete-cluster --cluster "$CLUSTER_NAME" --region "$REGION" || {
            log "   ⚠️  Cluster deletion failed - may already be gone or have dependencies"
            
            echo "   🔍 Checking cluster dependencies:"
            aws ecs list-services --cluster "$CLUSTER_NAME" --region "$REGION" --output table || echo "     No services found"
            aws ecs list-tasks --cluster "$CLUSTER_NAME" --region "$REGION" --output table || echo "     No tasks found"
        }
        CLUSTER_STATUS="NOT_FOUND"
    fi
    
    log ""
    log "3. 🏗️  Ensuring infrastructure is deployed..."
    
    # If stack doesn't exist, we need to redeploy
    if [[ "$STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
        log "   📋 Stack doesn't exist. It should be created by the previous GitHub Actions step."
        log "   🚨 This suggests the infrastructure deployment step failed."
        
        echo ""
        log "   💡 Recommended actions:"
        log "   1. Check the 'Deploy CloudFormation Infrastructure' step logs"
        log "   2. Verify AWS credentials and permissions"
        log "   3. Check for resource limits or naming conflicts"
        echo ""
        
        log "   🔄 Attempting to deploy infrastructure now as fallback..."
        
        # Check if template exists
        if [[ -f "./infra/cloudformation/ecs-infrastructure.yml" ]]; then
            log "   ✅ Found CloudFormation template"
            
            # Validate template first
            log "   🔍 Validating CloudFormation template..."
            aws cloudformation validate-template \
                --template-body file://./infra/cloudformation/ecs-infrastructure.yml \
                --region "$REGION" || {
                log "   ❌ Template validation failed"
                return 1
            }
            
            log "   ✅ Template validation passed"
            log "   🚀 Deploying infrastructure stack..."
            
            # Deploy with detailed logging
            aws cloudformation deploy \
                --template-file ./infra/cloudformation/ecs-infrastructure.yml \
                --stack-name "$STACK_NAME" \
                --parameter-overrides \
                    Environment="$ENVIRONMENT" \
                    OpenAIApiKey="${OPENAI_API_KEY:-dummy-key-for-testing}" \
                --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
                --region "$REGION" \
                --no-fail-on-empty-changeset \
                --debug 2>&1 | tee deploy-output.log || {
                
                log "   ❌ Infrastructure deployment failed. Checking events..."
                
                echo "   🔍 Recent CloudFormation events:"
                aws cloudformation describe-stack-events \
                    --stack-name "$STACK_NAME" \
                    --region "$REGION" \
                    --max-items 10 \
                    --query 'StackEvents[*].[Timestamp,ResourceType,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
                    --output table || echo "     ❌ Cannot get events"
                
                return 1
            }
            
            log "   ✅ Infrastructure deployed successfully"
        else
            log "   ❌ CloudFormation template not found at ./infra/cloudformation/ecs-infrastructure.yml"
            echo "   📁 Current directory contents:"
            ls -la . || echo "     ❌ Cannot list directory"
            echo "   📁 Infra directory contents:"
            ls -la ./infra/ || echo "     ❌ Cannot list infra directory"
            echo "   📁 CloudFormation directory contents:"
            ls -la ./infra/cloudformation/ || echo "     ❌ Cannot list cloudformation directory"
            return 1
        fi
    fi
    
    log ""
    log "4. ✅ Verifying cluster is now active..."
    
    # Wait a bit for the cluster to be ready
    log "   ⏳ Waiting 15 seconds for cluster to be ready..."
    sleep 15
    
    # Check final cluster status with retries
    for attempt in {1..3}; do
        log "   🔍 Verification attempt $attempt/3..."
        
        FINAL_CLUSTER_STATUS=$(aws ecs describe-clusters \
            --clusters "$CLUSTER_NAME" \
            --region "$REGION" \
            --query 'clusters[0].status' \
            --output text 2>/dev/null || echo "NOT_FOUND")
        
        log "   Final Cluster Status: $FINAL_CLUSTER_STATUS"
        
        if [[ "$FINAL_CLUSTER_STATUS" == "ACTIVE" ]]; then
            log "   ✅ Cluster is now ACTIVE and ready for service deployment"
            
            # Show detailed cluster information
            echo "   📊 Final Cluster Details:"
            aws ecs describe-clusters \
                --clusters "$CLUSTER_NAME" \
                --region "$REGION" \
                --include capacityProviders \
                --query 'clusters[0].{Name:clusterName,Status:status,RunningTasks:runningTasksCount,PendingTasks:pendingTasksCount,ActiveServices:activeServicesCount,CapacityProviders:capacityProviders}' \
                --output table
            
            return 0
        elif [[ "$attempt" -lt 3 ]]; then
            log "   ⏳ Cluster not ready yet, waiting 10 seconds before next attempt..."
            sleep 10
        fi
    done
    
    log "   ❌ Cluster is still not active after 3 attempts: $FINAL_CLUSTER_STATUS"
    log "   🔍 Checking CloudFormation events for errors..."
    
    aws cloudformation describe-stack-events \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --max-items 10 \
        --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[Timestamp,ResourceType,LogicalResourceId,ResourceStatusReason]' \
        --output table || echo "   No failed events found"
    
    return 1
}

# Function to list all clusters for debugging
debug_clusters() {
    log ""
    log "🔍 Debug: Comprehensive ECS information..."
    
    echo "All ECS clusters in region $REGION:"
    aws ecs list-clusters --region "$REGION" --output table || echo "❌ Cannot list clusters"
    
    echo ""
    echo "ECS account settings:"
    aws ecs list-account-settings --region "$REGION" --output table || echo "❌ Cannot get account settings"
    
    echo ""
    echo "Available capacity providers:"
    aws ecs describe-capacity-providers --region "$REGION" --output table || echo "❌ Cannot list capacity providers"
}

# Function to show comprehensive environment information
show_environment_info() {
    log ""
    log "🌍 Environment Information Summary"
    log "=================================="
    
    echo "System Information:"
    echo "  Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo "  User: $(whoami || echo 'unknown')"
    echo "  Working Directory: $(pwd)"
    echo "  Shell: $SHELL"
    echo ""
    
    echo "AWS Configuration:"
    echo "  Region: $REGION"
    echo "  Stack Name: $STACK_NAME"
    echo "  Cluster Name: $CLUSTER_NAME"
    echo ""
    
    echo "GitHub Context:"
    echo "  Repository: ${GITHUB_REPOSITORY:-'not set'}"
    echo "  Workflow: ${GITHUB_WORKFLOW:-'not set'}"
    echo "  Job: ${GITHUB_JOB:-'not set'}"
    echo "  Run ID: ${GITHUB_RUN_ID:-'not set'}"
    echo "  Run Number: ${GITHUB_RUN_NUMBER:-'not set'}"
    echo ""
}

# Main execution
log "Starting comprehensive cluster fix process..."
show_environment_info
check_aws_environment

if fix_cluster; then
    log ""
    log "🎉 SUCCESS: ECS cluster is ready for service deployment!"
    log "   Cluster Name: $CLUSTER_NAME"
    log "   Region: $REGION"
    log "   Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo ""
    log "You can now proceed with deploying ECS services to this cluster."
else
    log ""
    log "💥 FAILED: Unable to fix the ECS cluster issue"
    log "   Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo ""
    debug_clusters
    echo ""
    log "🛠️  Manual intervention required:"
    log "1. Check AWS console for the CloudFormation stack: $STACK_NAME"
    log "2. Check AWS console for the ECS cluster: $CLUSTER_NAME" 
    log "3. Verify AWS permissions and resource limits"
    log "4. Consider manually deleting failed resources and re-running the deployment"
    
    echo ""
    log "📋 Logs have been enhanced for debugging. Please share this output for further assistance."
    exit 1
fi 