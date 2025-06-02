# Deployment Guide for Multi-Agent AI System

This guide explains how to deploy the Multi-Agent AI System to AWS ECS using the automated GitHub Actions workflow.

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **GitHub Repository** with the following secrets configured:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_ACCOUNT_ID`
   - `OPENAI_API_KEY`

## AWS Permissions Required

Your AWS IAM user/role needs the following permissions:
- ECS (all operations)
- ECR (all operations)
- CloudFormation (all operations)
- VPC (all operations)
- SQS (all operations)
- S3 (all operations)
- Secrets Manager (all operations)
- IAM (role creation and management)
- CloudWatch Logs (all operations)
- Application Load Balancer (all operations)

## GitHub Secrets Setup

Configure the following secrets in your GitHub repository (`Settings > Secrets and variables > Actions`):

```
AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
AWS_ACCOUNT_ID=<your-12-digit-aws-account-id>
OPENAI_API_KEY=<your-openai-api-key>
```

## Deployment Architecture

The system deploys the following components:

### Infrastructure (CloudFormation)
- **VPC** with public and private subnets
- **ECS Cluster** with Fargate capacity providers
- **Application Load Balancer** for routing
- **SQS Queues** for task coordination
- **S3 Bucket** for artifacts
- **Secrets Manager** for API keys
- **CloudWatch Logs** for monitoring

### Services
- **task-router**: Main API service (port 3000)
- **agent-web**: Frontend web interface (port 3000)
- **researcher**: Research agent
- **product_manager**: Product management agent
- **drawer**: Drawing/visualization agent
- **designer**: Design agent
- **coder**: Code generation agent

## Deployment Process

### Automatic Deployment

The GitHub Actions workflow automatically triggers on:
- Push to `main` branch → Production deployment
- Push to `develop` branch → Staging deployment
- Manual workflow dispatch → Choose environment

### Manual Deployment

1. Go to `Actions` tab in your GitHub repository
2. Select `Deploy AI Agents to AWS ECS (Simplified)`
3. Click `Run workflow`
4. Choose environment: `staging` or `production`
5. Click `Run workflow`

## Deployment Stages

### 1. Build and Test
- Installs dependencies for all services
- Builds all TypeScript/JavaScript code
- Runs tests (if available)

### 2. Build and Push Docker Images
- Builds Docker images for each service
- Pushes images to Amazon ECR
- Creates ECR repositories if they don't exist

### 3. Deploy Infrastructure
- Validates CloudFormation template
- Deploys/updates AWS infrastructure
- Handles failed stacks by cleaning up and retrying

### 4. Deploy Applications
- Generates ECS task definitions
- Creates/updates ECS services
- Configures load balancer routing

## Monitoring and Logs

### CloudWatch Logs
Each service has its own log group:
- `/ecs/ai-agents-task-router`
- `/ecs/ai-agents-agent-web`
- `/ecs/ai-agents-researcher`
- `/ecs/ai-agents-product_manager`
- `/ecs/ai-agents-drawer`
- `/ecs/ai-agents-designer`
- `/ecs/ai-agents-coder`

### ECS Console
Monitor service health and task status in the AWS ECS Console.

### Application Load Balancer
Access the application through the ALB DNS name (output from CloudFormation).

## Environment Variables

Each service receives these environment variables:
- `NODE_ENV`: Environment (staging/production)
- `AWS_REGION`: AWS region
- `ARTIFACT_BUCKET`: S3 bucket for artifacts
- `LOG_LEVEL`: Logging level
- `OPENAI_API_KEY`: Injected from Secrets Manager

Service-specific variables:
- **task-router**: All queue URLs, port configuration
- **agent-web**: Task router API URL, web-specific settings
- **agents**: Individual queue URLs, polling intervals

## Troubleshooting

### Common Issues

1. **CloudFormation Stack Fails**
   - Check IAM permissions
   - Verify all required parameters are provided
   - Check CloudFormation console for detailed error messages

2. **Docker Build Fails**
   - Ensure all Dockerfiles exist in correct locations
   - Check build context and dependencies

3. **ECS Service Won't Start**
   - Check CloudWatch logs for container errors
   - Verify task definition parameters
   - Ensure images are available in ECR

4. **Load Balancer Health Checks Fail**
   - Verify health check endpoints exist
   - Check security group configurations
   - Ensure services are listening on correct ports

### Useful Commands

```bash
# Check ECS service status
aws ecs describe-services --cluster ai-agents-cluster-staging --services ai-agents-task-router-staging

# View recent logs
aws logs filter-log-events --log-group-name /ecs/ai-agents-task-router --start-time $(date -d '30 minutes ago' +%s)000

# Check SQS queue messages
aws sqs get-queue-attributes --queue-url <queue-url> --attribute-names All
```

## Local Development

For local development and testing:

```bash
# Install all dependencies
npm run install:all

# Build all services
npm run build

# Run tests
npm run test

# Use docker-compose for local testing
cd infra
docker-compose up
```

## Cleanup

To remove all AWS resources:

1. Delete the ECS services manually (GitHub Actions doesn't handle cleanup)
2. Delete the CloudFormation stack:
   ```bash
   aws cloudformation delete-stack --stack-name ai-agents-ecs-infrastructure-staging
   ```
3. Delete ECR repositories:
   ```bash
   aws ecr delete-repository --repository-name ai-agents-task-router --force
   # Repeat for all repositories
   ```

## Cost Optimization

- Uses Fargate Spot instances (80% of capacity) for cost savings
- Configures appropriate CPU/memory allocations
- Sets log retention to 14 days
- Uses minimal instance sizes suitable for development/staging

## Security

- All services run in private subnets
- Only ALB is internet-facing
- API keys stored in AWS Secrets Manager
- IAM roles follow principle of least privilege
- VPC security groups restrict traffic appropriately 