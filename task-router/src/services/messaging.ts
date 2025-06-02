import AWS from 'aws-sdk';
import { config } from '../config';
import { createChildLogger } from '../logger';
import { sqsMessagesSent } from '../metrics';
import { SQSMessagingService, CompletionEvent } from '../types';
import { S3Storage } from './storage';

const logger = createChildLogger('messaging');

export class SQSMessaging implements SQSMessagingService {
  private sqs: AWS.SQS;
  private storage: S3Storage;

  constructor(storage: S3Storage) {
    const sqsConfig: AWS.SQS.ClientConfiguration = {
      region: config.aws.region,
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    };

    // Add LocalStack endpoint if configured
    if (config.aws.endpoint) {
      sqsConfig.endpoint = config.aws.endpoint;
    }

    this.sqs = new AWS.SQS(sqsConfig);
    this.storage = storage;
  }

  async sendTaskMessage(jobId: string, task: string, payload: any): Promise<void> {
    try {
      // Store payload in S3 first
      const payloadKey = await this.storage.storePayload(jobId, task, payload);
      
      // Determine which queue to send to
      const queueUrl = this.getQueueUrl(task);
      
      logger.info({ jobId, task, queueUrl }, 'Sending task message to SQS');
      
      await this.sqs.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          job_id: jobId,
          task_type: task,
          payload_key: payloadKey,
          timestamp: new Date().toISOString(),
          source: 'task-router',
        }),
      }).promise();

      sqsMessagesSent.inc({ queue: task, status: 'success' });
      logger.info({ jobId, task, payloadKey }, 'Successfully sent task message');
    } catch (error) {
      sqsMessagesSent.inc({ queue: task, status: 'error' });
      logger.error({ error, jobId, task }, 'Failed to send task message');
      throw error;
    }
  }

  async publishDone(event: { jobId: string }): Promise<void> {
    try {
      logger.info({ jobId: event.jobId }, 'Publishing job completion event');
      
      await this.sqs.sendMessage({
        QueueUrl: config.queues.events,
        MessageBody: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
          source: 'task-router',
          event_type: 'job_completed',
        }),
      }).promise();

      sqsMessagesSent.inc({ queue: 'events', status: 'success' });
      logger.info({ jobId: event.jobId }, 'Successfully published completion event');
    } catch (error) {
      sqsMessagesSent.inc({ queue: 'events', status: 'error' });
      logger.error({ error, jobId: event.jobId }, 'Failed to publish completion event');
      throw error;
    }
  }

  async consumeEvents(handler: (event: CompletionEvent) => Promise<void>): Promise<void> {
    logger.info('Starting to consume completion events');
    
    const receiveParams = {
      QueueUrl: config.queues.events,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ['All'],
    };

    while (true) {
      try {
        const result = await this.sqs.receiveMessage(receiveParams).promise();
        
        if (result.Messages && result.Messages.length > 0) {
          for (const message of result.Messages) {
            try {
              const event: CompletionEvent = JSON.parse(message.Body || '{}');
              await handler(event);
              
              // Delete message after successful processing
              await this.sqs.deleteMessage({
                QueueUrl: config.queues.events,
                ReceiptHandle: message.ReceiptHandle!,
              }).promise();
              
              logger.info({ jobId: event.job_id, taskType: event.task_type }, 'Processed completion event');
            } catch (error) {
              logger.error({ error, messageId: message.MessageId }, 'Failed to process completion event');
            }
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error consuming events, retrying...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async consumeJobRequests(handler: (jobRequest: { job_id: string; job_spec: any }) => Promise<void>): Promise<void> {
    logger.info('Starting to consume job requests from router jobs queue');
    
    const receiveParams = {
      QueueUrl: config.queues.routerJobs,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ['All'],
    };

    while (true) {
      try {
        const result = await this.sqs.receiveMessage(receiveParams).promise();
        
        if (result.Messages && result.Messages.length > 0) {
          for (const message of result.Messages) {
            try {
              const messageBody = JSON.parse(message.Body || '{}');
              logger.info({ messageBody }, 'Received job request message');
              
              // Handle different message formats
              let jobRequest;
              if (messageBody.job_id && messageBody.task_type === 'start_job' && messageBody.payload_key) {
                // Format from agent-web SQS messages (with payload in S3)
                const jobSpec = await this.storage.get(messageBody.payload_key);
                jobRequest = {
                  job_id: messageBody.job_id,
                  job_spec: jobSpec
                };
              } else if (messageBody.job_id && (messageBody.product || messageBody.audience)) {
                // Direct job spec in message
                jobRequest = {
                  job_id: messageBody.job_id,
                  job_spec: messageBody
                };
              } else {
                logger.warn({ messageBody }, 'Invalid job request message format');
                continue;
              }
              
              await handler(jobRequest);
              
              // Delete message after successful processing
              await this.sqs.deleteMessage({
                QueueUrl: config.queues.routerJobs,
                ReceiptHandle: message.ReceiptHandle!,
              }).promise();
              
              logger.info({ jobId: jobRequest.job_id }, 'Processed job request from SQS');
            } catch (error) {
              logger.error({ error, messageId: message.MessageId }, 'Failed to process job request');
              // Don't delete the message so it can be retried
            }
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error consuming job requests, retrying...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private getQueueUrl(task: string): string {
    switch (task) {
      case 'research':
        return config.queues.research;
      case 'designer':
        return config.queues.designer;
      case 'drawer':
        return config.queues.drawer;
      case 'product_manager':
        return config.queues.productManager;
      case 'coder':
        return config.queues.coder;
      default:
        throw new Error(`Unknown task type: ${task}`);
    }
  }
} 