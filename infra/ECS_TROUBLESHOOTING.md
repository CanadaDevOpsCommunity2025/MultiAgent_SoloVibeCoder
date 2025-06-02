# ECS Cluster Troubleshooting Guide

## Common Issues and Solutions

Based on your logs, here are the key issues and how to fix them:

### 1. INACTIVE Cluster Issue (Your Current Problem)

**Symptoms:**
- CloudFormation stack shows `UPDATE_COMPLETE` or `CREATE_COMPLETE`
- ECS cluster exists but shows status `INACTIVE`
- Service deployment fails with "ClusterNotFoundException: The referenced cluster was inactive"

**Root Cause:**
ECS clusters can become INACTIVE due to:
- AWS account limits exceeded
- Region capacity issues
- Previous failed deployments leaving cluster in bad state
- Network connectivity issues during cluster creation

**Solution:**
The new `fix-inactive-cluster.sh` script addresses this by:
1. Deleting the inactive cluster from ECS
2. Forcing CloudFormation to recreate the cluster resource
3. Waiting for the new cluster to become ACTIVE

**Key Log Indicators:**
```
Cluster Status: INACTIVE
🗑️  Deleting inactive cluster...
🔄 Step 3: Forcing CloudFormation to recreate the cluster...
```

### 2. Stack Not Found Issue

**Symptoms:**
- `Stack Status: DOES_NOT_EXIST`
- Infrastructure deployment step failed

**Solution:**
The general `fix-cluster-for-github-actions.sh` handles this by redeploying the CloudFormation stack.

### 3. Service Creation Failures

**Common Causes:**
1. **Missing Target Groups:** Look for "Target Group ARN not found"
2. **Invalid Subnets:** Check if subnets exist and are in correct AZs
3. **Security Group Issues:** Verify security group allows necessary traffic
4. **Task Definition Problems:** Check image URIs, environment variables

**Key Log Sections to Check:**

#### Cluster Status Verification:
```
🔍 Pre-deployment cluster verification...
Cluster Status: ACTIVE  # Should be ACTIVE
```

#### Task Definition Registration:
```
✅ Registered task definition: arn:aws:ecs:...
```

#### Service Creation:
```
🚀 Creating ECS service...
✅ Service created successfully
```

## Enhanced Logging Features

### New Log Sections Added:

1. **Environment Information:**
   - AWS CLI version
   - AWS identity and permissions
   - GitHub context (repository, workflow, run ID)
   - Current working directory

2. **Detailed Cluster Analysis:**
   - All clusters in region
   - Cluster capacity providers
   - Service and task counts
   - Recent cluster events

3. **Enhanced Error Handling:**
   - JSON validation before API calls
   - Detailed error messages with context
   - Retry logic with exponential backoff
   - Comprehensive debugging information

4. **Step-by-Step Progress Tracking:**
   - Timestamped log entries
   - Clear section headers
   - Progress indicators
   - Success/failure indicators

## Manual Resolution Steps

If automated fixes fail, try these manual steps:

### Option 1: Force Cluster Recreation via AWS Console
1. Go to AWS Console → CloudFormation
2. Find stack: `ai-agents-ecs-infrastructure-production`
3. Click "Update"
4. Use current template, no changes needed
5. This forces resource recreation

### Option 2: Delete and Recreate Stack
```bash
# Delete the stack
aws cloudformation delete-stack --stack-name ai-agents-ecs-infrastructure-production --region us-east-1

# Wait for deletion
aws cloudformation wait stack-delete-complete --stack-name ai-agents-ecs-infrastructure-production --region us-east-1

# Redeploy via GitHub Actions or manually
aws cloudformation deploy \
  --template-file ./infra/cloudformation/ecs-infrastructure.yml \
  --stack-name ai-agents-ecs-infrastructure-production \
  --parameter-overrides Environment=production OpenAIApiKey="$OPENAI_API_KEY" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Option 3: Manual Cluster Recreation
```bash
# Delete inactive cluster
aws ecs delete-cluster --cluster ai-agents-cluster-production --region us-east-1

# Wait and try CloudFormation update
aws cloudformation deploy \
  --template-file ./infra/cloudformation/ecs-infrastructure.yml \
  --stack-name ai-agents-ecs-infrastructure-production \
  --parameter-overrides Environment=production OpenAIApiKey="$OPENAI_API_KEY" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region us-east-1
```

## Monitoring and Prevention

### Health Checks to Add:
1. Monitor cluster status regularly
2. Set up CloudWatch alarms for cluster state changes
3. Implement proper retry logic in deployment scripts
4. Use multiple AZs for better resilience

### Best Practices:
1. Always validate CloudFormation templates before deployment
2. Use consistent naming conventions
3. Implement proper error handling and logging
4. Test deployments in staging environment first
5. Keep deployment scripts idempotent

## Log Analysis Commands

### Check Cluster Status:
```bash
aws ecs describe-clusters --clusters ai-agents-cluster-production --region us-east-1
```

### Check CloudFormation Stack:
```bash
aws cloudformation describe-stacks --stack-name ai-agents-ecs-infrastructure-production --region us-east-1
```

### Check Recent Stack Events:
```bash
aws cloudformation describe-stack-events --stack-name ai-agents-ecs-infrastructure-production --region us-east-1 --max-items 10
```

### Check Services in Cluster:
```bash
aws ecs list-services --cluster ai-agents-cluster-production --region us-east-1
```

## Next Steps

After running the enhanced fix scripts:

1. **Check the logs** for the specific section headers and status indicators
2. **Look for error patterns** in the troubleshooting sections above  
3. **Share relevant log sections** if issues persist
4. **Use the manual resolution steps** if automated fixes fail

The enhanced logging will provide much more detailed information to help diagnose and fix any remaining issues. 