#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
LOCALSTACK_HOST="localhost"
LOCALSTACK_PORT="4566"
BUCKET_NAME="landing-jobs-dev"
REGION="us-east-1"

echo -e "${GREEN}🚀 Starting Task Router Development Environment${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
echo -e "${YELLOW}📋 Checking dependencies...${NC}"
if ! command_exists docker; then
    echo -e "${RED}❌ Docker is required but not installed.${NC}"
    exit 1
fi

if ! command_exists docker-compose; then
    echo -e "${RED}❌ Docker Compose is required but not installed.${NC}"
    exit 1
fi

# Start LocalStack
echo -e "${YELLOW}🐳 Starting LocalStack...${NC}"
cat > docker-compose.dev.yml <<EOF
version: '3.8'
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=s3,sqs
      - DEBUG=1
      - DATA_DIR=/tmp/localstack/data
      - DOCKER_HOST=unix:///var/run/docker.sock
    volumes:
      - "/tmp/localstack:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
    networks:
      - task-router-dev

  # MinIO as an alternative S3 service
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    networks:
      - task-router-dev

networks:
  task-router-dev:
    driver: bridge

volumes:
  minio_data:
    driver: local
EOF

docker-compose -f docker-compose.dev.yml up -d

# Wait for LocalStack to be ready
echo -e "${YELLOW}⏳ Waiting for LocalStack to be ready...${NC}"
for i in {1..30}; do
    if curl -s http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}/health > /dev/null; then
        echo -e "${GREEN}✅ LocalStack is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ LocalStack failed to start${NC}"
        exit 1
    fi
    sleep 2
done

# Install AWS CLI if not present (for LocalStack interaction)
if ! command_exists aws; then
    echo -e "${YELLOW}📦 Installing AWS CLI...${NC}"
    pip install awscli-local[ver1]
fi

# Set up AWS CLI for LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=${REGION}
export AWS_ENDPOINT_URL=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}

# Create S3 bucket
echo -e "${YELLOW}🪣 Creating S3 bucket...${NC}"
aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} s3 mb s3://${BUCKET_NAME} || true

# Create SQS queues
echo -e "${YELLOW}📮 Creating SQS queues...${NC}"

create_queue() {
    local queue_name=$1
    echo "Creating queue: ${queue_name}"
    aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} sqs create-queue \
        --queue-name ${queue_name} \
        --attributes VisibilityTimeoutSeconds=300,MessageRetentionPeriod=1209600
}

create_queue "router-jobs-queue"
create_queue "events-queue"
create_queue "agent-researcher-queue"
create_queue "agent-writer-queue"
create_queue "agent-coder-queue"

# Get queue URLs
echo -e "${YELLOW}🔗 Getting queue URLs...${NC}"
ROUTER_JOBS_QUEUE_URL=$(aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} sqs get-queue-url --queue-name router-jobs-queue --query 'QueueUrl' --output text)
EVENTS_QUEUE_URL=$(aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} sqs get-queue-url --queue-name events-queue --query 'QueueUrl' --output text)
RESEARCH_QUEUE_URL=$(aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} sqs get-queue-url --queue-name agent-researcher-queue --query 'QueueUrl' --output text)
WRITER_QUEUE_URL=$(aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} sqs get-queue-url --queue-name agent-writer-queue --query 'QueueUrl' --output text)
CODER_QUEUE_URL=$(aws --endpoint-url=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT} sqs get-queue-url --queue-name agent-coder-queue --query 'QueueUrl' --output text)

# Create environment file for development
echo -e "${YELLOW}⚙️ Creating development environment file...${NC}"
cat > .env.dev <<EOF
# LocalStack AWS Configuration
AWS_REGION=${REGION}
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT_URL=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}

# SQS Queue URLs
ROUTER_JOBS_QUEUE_URL=${ROUTER_JOBS_QUEUE_URL}
EVENTS_QUEUE_URL=${EVENTS_QUEUE_URL}
RESEARCH_QUEUE_URL=${RESEARCH_QUEUE_URL}
WRITER_QUEUE_URL=${WRITER_QUEUE_URL}
CODER_QUEUE_URL=${CODER_QUEUE_URL}

# S3 Configuration
ARTIFACT_BUCKET=${BUCKET_NAME}

# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
METRICS_PORT=9090
EOF

echo -e "${GREEN}✅ Environment file created: .env.dev${NC}"

# Create mock agent script
echo -e "${YELLOW}🤖 Creating mock agent script...${NC}"
cat > scripts/mock-agent.js <<EOF
const AWS = require('aws-sdk');

// Configure AWS for LocalStack
AWS.config.update({
  accessKeyId: 'test',
  secretAccessKey: 'test',
  region: '${REGION}',
  endpoint: 'http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}',
  s3ForcePathStyle: true,
});

const sqs = new AWS.SQS();
const s3 = new AWS.S3();

const queues = {
  research: '${RESEARCH_QUEUE_URL}',
  writer: '${WRITER_QUEUE_URL}',
  coder: '${CODER_QUEUE_URL}',
};

const eventsQueueUrl = '${EVENTS_QUEUE_URL}';

async function processQueue(queueType, queueUrl) {
  console.log(\`🔄 Mock \${queueType} agent started, polling \${queueUrl}\`);
  
  while (true) {
    try {
      const result = await sqs.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        MessageAttributeNames: ['All'],
      }).promise();

      if (result.Messages && result.Messages.length > 0) {
        for (const message of result.Messages) {
          const jobId = message.MessageAttributes?.job_id?.StringValue;
          const taskType = message.MessageAttributes?.task_type?.StringValue;
          const payloadKey = message.MessageAttributes?.payload_key?.StringValue;

          console.log(\`📥 Processing \${taskType} task for job \${jobId}\`);

          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

          // Generate mock result
          const result = generateMockResult(taskType);
          
          // Store result in S3
          const resultKey = \`\${jobId}/\${taskType}-result.json\`;
          await s3.putObject({
            Bucket: '${BUCKET_NAME}',
            Key: resultKey,
            Body: JSON.stringify(result, null, 2),
            ContentType: 'application/json',
          }).promise();

          // Send completion event
          await sqs.sendMessage({
            QueueUrl: eventsQueueUrl,
            MessageBody: JSON.stringify({
              job_id: jobId,
              task: taskType,
              result_key: resultKey,
              status: 'success',
              timestamp: new Date().toISOString(),
              source: \`mock-\${taskType}-agent\`,
            }),
          }).promise();

          // Delete processed message
          await sqs.deleteMessage({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }).promise();

          console.log(\`✅ Completed \${taskType} task for job \${jobId}\`);
        }
      }
    } catch (error) {
      console.error(\`❌ Error in \${queueType} agent:\`, error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function generateMockResult(taskType) {
  switch (taskType) {
    case 'research':
      return {
        insights: [
          'Target audience values efficiency and cost-effectiveness',
          'Competitors focus heavily on enterprise features',
          'Pain point: current solutions are too complex',
        ],
        targetAudience: 'Mid-market engineering teams',
        competitorAnalysis: 'Main competitors: CompetitorA, CompetitorB',
        keyMessages: ['Simple', 'Powerful', 'Affordable'],
      };
    
    case 'writer':
      return {
        headline: 'The Simple Solution Engineering Teams Love',
        subheadline: 'Build better products faster with our intuitive platform',
        bodyText: 'Stop wrestling with complex tools. Our platform gives you everything you need to ship great products, without the complexity.',
        cta: 'Start Building Today',
      };
    
    case 'coder':
      return {
        html: \`<!DOCTYPE html><html><head><title>Landing Page</title></head><body><h1>The Simple Solution Engineering Teams Love</h1><p>Build better products faster</p></body></html>\`,
        css: \`body { font-family: Arial, sans-serif; margin: 0; padding: 2rem; } h1 { color: #333; }\`,
        js: \`console.log('Landing page loaded');\`,
      };
    
    default:
      return { message: 'Mock result generated' };
  }
}

// Start all mock agents
Object.entries(queues).forEach(([type, url]) => {
  processQueue(type, url);
});
EOF

# Install dependencies and build
echo -e "${YELLOW}📦 Installing dependencies and building...${NC}"
npm install

echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
npm run build

# Start the mock agents in background
echo -e "${YELLOW}🤖 Starting mock agents...${NC}"
node scripts/mock-agent.js &
MOCK_AGENT_PID=$!

# Function to cleanup on exit
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    kill $MOCK_AGENT_PID 2>/dev/null || true
    docker-compose -f docker-compose.dev.yml down
    rm -f docker-compose.dev.yml
}

trap cleanup EXIT

# Start the Task Router
echo -e "${GREEN}🚀 Starting Task Router with development environment...${NC}"
echo -e "${YELLOW}📝 Environment variables loaded from .env.dev${NC}"
echo -e "${YELLOW}🔗 API available at: http://localhost:3000${NC}"
echo -e "${YELLOW}📊 Metrics available at: http://localhost:9090/metrics${NC}"
echo -e "${YELLOW}💾 S3 Console (MinIO): http://localhost:9001 (admin/admin)${NC}"
echo -e "${YELLOW}🛑 Press Ctrl+C to stop${NC}"

# Load environment and start
export \$(cat .env.dev | xargs)
npm run dev
EOF

chmod +x task-router/scripts/dev.sh 