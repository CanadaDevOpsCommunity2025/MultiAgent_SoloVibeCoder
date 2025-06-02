import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from './logger';

// AWS Configuration
const awsConfig: any = {
  region: process.env.AWS_REGION || 'us-east-1',
};

// Only set credentials if we have explicit access keys (for local development)
// In ECS/production, the SDK will automatically use the task's IAM role
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

// LocalStack configuration for local development
if (process.env.AWS_ENDPOINT_URL) {
  awsConfig.endpoint = process.env.AWS_ENDPOINT_URL;
  awsConfig.forcePathStyle = true; // Required for LocalStack S3
}

// Initialize clients
const s3Client = new S3Client(awsConfig);
const sqsClient = new SQSClient(awsConfig);

// S3 Helpers
export class S3Helper {
  constructor(private bucketName: string = process.env.ARTIFACT_BUCKET || 'task-artifacts') {}

  async getObject(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await s3Client.send(command);
      const body = await response.Body?.transformToString();
      
      if (!body) {
        throw new Error(`No content found for key: ${key}`);
      }

      logger.debug({ key, bucket: this.bucketName }, 'Successfully retrieved object from S3');
      return body;
    } catch (error) {
      logger.error({ error, key, bucket: this.bucketName }, 'Failed to get object from S3');
      throw error;
    }
  }

  async putObject(key: string, body: string, contentType: string = 'application/json'): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      });

      await s3Client.send(command);
      logger.debug({ key, bucket: this.bucketName }, 'Successfully stored object in S3');
    } catch (error) {
      logger.error({ error, key, bucket: this.bucketName }, 'Failed to put object to S3');
      throw error;
    }
  }

  async getJsonObject<T>(key: string): Promise<T> {
    const content = await this.getObject(key);
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      logger.error({ error, key }, 'Failed to parse JSON from S3 object');
      throw new Error(`Invalid JSON in S3 object ${key}: ${error}`);
    }
  }

  async putJsonObject<T>(key: string, data: T): Promise<void> {
    const body = JSON.stringify(data, null, 2);
    await this.putObject(key, body, 'application/json');
  }
}

// SQS Helpers
export class SQSHelper {
  constructor(private queueUrl: string) {}

  async receiveMessages(maxMessages: number = 1, waitTimeSeconds: number = 20) {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
        MessageAttributeNames: ['All'],
      });

      const response = await sqsClient.send(command);
      logger.debug({ 
        messageCount: response.Messages?.length || 0, 
        queueUrl: this.queueUrl 
      }, 'Received messages from SQS');
      
      return response.Messages || [];
    } catch (error) {
      logger.error({ error, queueUrl: this.queueUrl }, 'Failed to receive messages from SQS');
      throw error;
    }
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await sqsClient.send(command);
      logger.debug({ queueUrl: this.queueUrl }, 'Successfully deleted message from SQS');
    } catch (error) {
      logger.error({ error, queueUrl: this.queueUrl }, 'Failed to delete message from SQS');
      throw error;
    }
  }

  async sendMessage(messageBody: string, messageAttributes?: Record<string, any>): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: messageBody,
        MessageAttributes: messageAttributes,
      });

      await sqsClient.send(command);
      logger.debug({ queueUrl: this.queueUrl }, 'Successfully sent message to SQS');
    } catch (error) {
      logger.error({ error, queueUrl: this.queueUrl }, 'Failed to send message to SQS');
      throw error;
    }
  }
}

// Factory functions for common patterns
export function createS3Helper(bucketName?: string): S3Helper {
  return new S3Helper(bucketName);
}

export function createSQSHelper(queueUrl: string): SQSHelper {
  return new SQSHelper(queueUrl);
}

// Task-specific message types
export interface TaskMessage {
  job_id: string;
  task_type: string;
  payload_key: string;
  timestamp?: string;
}

export interface TaskResult {
  job_id: string;
  task_type: string;
  status: 'success' | 'error' | 'in_progress';
  result?: any;
  error?: string;
  timestamp: string;
}

// Helper to parse task messages
export function parseTaskMessage(messageBody: string): TaskMessage {
  try {
    const parsed = JSON.parse(messageBody);
    if (!parsed.job_id || !parsed.task_type) {
      throw new Error('Invalid task message format: missing required fields');
    }
    return parsed as TaskMessage;
  } catch (error) {
    logger.error({ error, messageBody }, 'Failed to parse task message');
    throw error;
  }
} 