#!/bin/bash

# Cluster Issue Diagnosis and Fix Script
# Usage: ./diagnose-cluster-issue.sh [environment]

set -e

ENVIRONMENT=${1:-production}
REGION=${AWS_REGION:-us-east-1}

# Configuration
CLUSTER_NAME="ai-agents-cluster"
STACK_NAME="ai-agents-ecs-infrastructure-${ENVIRONMENT}"

echo "🔍 Diagnosing ECS Cluster Issue for Environment: $ENVIRONMENT"
echo "==============================================================="
echo "Stack Name: $STACK_NAME"
echo "Cluster Name: $CLUSTER_NAME"
echo "Region: $REGION"
echo ""

# Function to check if AWS CLI is configured
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        echo "❌ AWS CLI is not installed. Please install it first:"
        echo "   curl 'https://awscli.amazonaws.com/AWSCLIV2.pkg' -o 'AWSCLIV2.pkg'"
        echo "   sudo installer -pkg AWSCLIV2.pkg -target /"
        exit 1
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        echo "❌ AWS CLI is not configured or credentials are invalid"
        echo "   Please run: aws configure"
        exit 1
    fi
    
    echo "✅ AWS CLI is configured and working"
}

# Function to check CloudFormation stack status
check_stack_status() {
    echo "📋 Checking CloudFormation Stack Status..."
    
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "DOES_NOT_EXIST")
    
    echo "Stack Status: $STACK_STATUS"
    
    case $STACK_STATUS in
        "CREATE_COMPLETE"|"UPDATE_COMPLETE")
            echo "✅ Stack is in good state"
            return 0
            ;;
        "CREATE_FAILED"|"ROLLBACK_COMPLETE"|"UPDATE_ROLLBACK_COMPLETE")
            echo "❌ Stack is in failed state: $STACK_STATUS"
            echo "💡 Suggested actions:"
            echo "   1. Delete the failed stack: aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION"
            echo "   2. Wait for deletion: aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME --region $REGION"
            echo "   3. Redeploy the stack"
            return 1
            ;;
        "CREATE_IN_PROGRESS"|"UPDATE_IN_PROGRESS")
            echo "⏳ Stack is currently being created/updated"
            echo "💡 Wait for the operation to complete before proceeding"
            return 1
            ;;
        "DELETE_IN_PROGRESS")
            echo "⏳ Stack is being deleted"
            echo "💡 Wait for deletion to complete before redeploying"
            return 1
            ;;
        "DOES_NOT_EXIST")
            echo "❌ Stack does not exist"
            echo "💡 You need to deploy the infrastructure stack first"
            return 1
            ;;
        *)
            echo "❓ Unknown stack status: $STACK_STATUS"
            return 1
            ;;
    esac
}

# Function to check ECS cluster status
check_cluster_status() {
    echo ""
    echo "🚀 Checking ECS Cluster Status..."
    
    CLUSTER_STATUS=$(aws ecs describe-clusters \
        --clusters "$CLUSTER_NAME" \
        --region "$REGION" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    echo "Cluster Status: $CLUSTER_STATUS"
    
    case $CLUSTER_STATUS in
        "ACTIVE")
            echo "✅ Cluster is active and ready"
            
            # Show cluster details
            aws ecs describe-clusters \
                --clusters "$CLUSTER_NAME" \
                --region "$REGION" \
                --query 'clusters[0].{Name:clusterName,Status:status,ActiveServices:activeServicesCount,RunningTasks:runningTasksCount,PendingTasks:pendingTasksCount}' \
                --output table
            return 0
            ;;
        "INACTIVE")
            echo "❌ Cluster exists but is INACTIVE"
            echo "💡 This usually means the cluster was deleted but some resources remain"
            echo "   Try recreating the cluster or delete and redeploy the stack"
            return 1
            ;;
        "NOT_FOUND")
            echo "❌ Cluster not found"
            echo "💡 The cluster was not created or was deleted"
            return 1
            ;;
        *)
            echo "❓ Unknown cluster status: $CLUSTER_STATUS"
            return 1
            ;;
    esac
}

# Function to check recent CloudFormation events
check_stack_events() {
    echo ""
    echo "📅 Recent CloudFormation Events (last 10):"
    
    aws cloudformation describe-stack-events \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --max-items 10 \
        --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED` || ResourceStatus==`DELETE_FAILED`].[Timestamp,ResourceType,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
        --output table 2>/dev/null || echo "No events found or stack doesn't exist"
}

# Function to fix the cluster issue
fix_cluster_issue() {
    echo ""
    echo "🔧 Attempting to Fix Cluster Issue..."
    
    # Check if we need to delete a failed stack
    if [[ "$STACK_STATUS" == "CREATE_FAILED" || "$STACK_STATUS" == "ROLLBACK_COMPLETE" || "$STACK_STATUS" == "UPDATE_ROLLBACK_COMPLETE" ]]; then
        echo "Deleting failed stack..."
        aws cloudformation delete-stack \
            --stack-name "$STACK_NAME" \
            --region "$REGION"
        
        echo "Waiting for stack deletion to complete..."
        aws cloudformation wait stack-delete-complete \
            --stack-name "$STACK_NAME" \
            --region "$REGION" \
            --waiter-config 'Delay=30,MaxAttempts=60'
        
        echo "✅ Stack deleted successfully"
    fi
    
    # If cluster exists but is inactive, delete it manually
    if [[ "$CLUSTER_STATUS" == "INACTIVE" ]]; then
        echo "Deleting inactive cluster..."
        aws ecs delete-cluster \
            --cluster "$CLUSTER_NAME" \
            --region "$REGION" || echo "Cluster deletion failed or already deleted"
    fi
    
    echo ""
    echo "💡 Next Steps:"
    echo "1. Redeploy the CloudFormation stack:"
    echo "   aws cloudformation deploy \\"
    echo "     --template-file ./infra/cloudformation/ecs-infrastructure.yml \\"
    echo "     --stack-name $STACK_NAME \\"
    echo "     --parameter-overrides Environment=$ENVIRONMENT OpenAIApiKey=\$OPENAI_API_KEY \\"
    echo "     --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \\"
    echo "     --region $REGION"
    echo ""
    echo "2. Or trigger the GitHub Actions deployment again"
}

# Function to show cluster capacity providers
check_capacity_providers() {
    echo ""
    echo "⚡ Checking Cluster Capacity Providers..."
    
    if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
        aws ecs describe-clusters \
            --clusters "$CLUSTER_NAME" \
            --region "$REGION" \
            --include capacityProviders \
            --query 'clusters[0].{CapacityProviders:capacityProviders,DefaultStrategy:defaultCapacityProviderStrategy}' \
            --output table
    else
        echo "❌ Cannot check capacity providers - cluster is not active"
    fi
}

# Main execution
main() {
    check_aws_cli
    check_stack_status
    check_cluster_status
    check_stack_events
    check_capacity_providers
    
    # If there are issues, offer to fix them
    if [[ $? -ne 0 || "$STACK_STATUS" != "CREATE_COMPLETE" && "$STACK_STATUS" != "UPDATE_COMPLETE" || "$CLUSTER_STATUS" != "ACTIVE" ]]; then
        echo ""
        echo "🚨 Issues detected with the infrastructure"
        read -p "Would you like to attempt to fix these issues? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            fix_cluster_issue
        else
            echo "💡 Manual intervention required. See the diagnostic information above."
        fi
    else
        echo ""
        echo "✅ Infrastructure appears to be healthy!"
    fi
}

# Run the main function
main 