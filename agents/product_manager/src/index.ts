import { 
  createSQSHelper, 
  createS3Helper,
  parseTaskMessage, 
  TaskMessage, 
  TaskResult 
} from './aws';
import { createAgentLogger } from './logger';
import { runResearcher, runProductManager } from './agent';

// Configuration
const RESEARCH_QUEUE_URL = process.env.RESEARCH_QUEUE_URL || '';
const PRODUCT_MANAGER_QUEUE_URL = process.env.PRODUCT_MANAGER_QUEUE_URL || '';
const EVENTS_QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL || '5000');

// Initialize services
const researchQueue = createSQSHelper(RESEARCH_QUEUE_URL);
const productManagerQueue = createSQSHelper(PRODUCT_MANAGER_QUEUE_URL);
const eventsQueue = createSQSHelper(EVENTS_QUEUE_URL);
const s3Helper = createS3Helper();
const logger = createAgentLogger('product_manager');

async function sendTaskResult(result: TaskResult): Promise<void> {
  if (EVENTS_QUEUE_URL) {
    try {
      await eventsQueue.sendMessage(JSON.stringify(result));
      logger.debug({ jobId: result.job_id }, 'Task result sent to events queue');
    } catch (error) {
      logger.error({ error, jobId: result.job_id }, 'Failed to send task result to events queue');
    }
  }
}

async function processResearchMessage(message: any): Promise<void> {
  const messageLogger = logger.child({ messageId: message.MessageId });
  
  try {
    // Parse the task message
    const taskMessage: TaskMessage = parseTaskMessage(message.Body);
    const { job_id, task_type, payload_key } = taskMessage;
    
    messageLogger.info({ job_id, task_type, payload_key }, 'Processing research task');

    // Send in-progress status
    await sendTaskResult({
      job_id,
      task_type,
      status: 'in_progress',
      timestamp: new Date().toISOString()
    });

    // Get the job payload from S3
    const jobPayload = await s3Helper.getJsonObject<Record<string, any>>(payload_key);
    messageLogger.debug({ payload_key }, 'Retrieved job payload from S3');

    // Add job_id to payload for agent function
    const enrichedPayload = {
      ...jobPayload,
      job_id
    };

    // Run the research agent
    const result = await runResearcher(enrichedPayload);
    
    // Send success result
    await sendTaskResult({
      job_id,
      task_type,
      status: 'success',
      result,
      timestamp: new Date().toISOString()
    });

    // Delete the message from queue
    await researchQueue.deleteMessage(message.ReceiptHandle);
    messageLogger.info({ job_id }, 'Research task completed successfully');

  } catch (error) {
    messageLogger.error({ error }, 'Failed to process research task');
    
    // Send error result if we have job info
    if (message.Body) {
      try {
        const taskMessage = parseTaskMessage(message.Body);
        await sendTaskResult({
          job_id: taskMessage.job_id,
          task_type: taskMessage.task_type,
          status: 'error',
          error: String(error),
          timestamp: new Date().toISOString()
        });
      } catch (parseError) {
        messageLogger.error({ parseError }, 'Failed to parse message for error reporting');
      }
    }
    
    // Don't delete message on error - let it retry or go to DLQ
    throw error;
  }
}

async function processProductManagerMessage(message: any): Promise<void> {
  const messageLogger = logger.child({ messageId: message.MessageId });
  
  try {
    // Parse the task message
    const taskMessage: TaskMessage = parseTaskMessage(message.Body);
    const { job_id, task_type, payload_key } = taskMessage;
    
    messageLogger.info({ job_id, task_type, payload_key }, 'Processing product manager task');

    // Send in-progress status
    await sendTaskResult({
      job_id,
      task_type,
      status: 'in_progress',
      timestamp: new Date().toISOString()
    });

    // Get the job payload from S3
    const jobPayload = await s3Helper.getJsonObject<Record<string, any>>(payload_key);
    messageLogger.debug({ payload_key }, 'Retrieved job payload from S3');

    // Add job_id to payload for agent function (same pattern as researcher)
    const enrichedPayload = {
      ...jobPayload,
      job_id
    };

    // Run the product manager agent
    const result = await runProductManager(enrichedPayload);
    
    // Send success result
    await sendTaskResult({
      job_id,
      task_type,
      status: 'success',
      result,
      timestamp: new Date().toISOString()
    });

    // Delete the message from queue
    await productManagerQueue.deleteMessage(message.ReceiptHandle);
    messageLogger.info({ job_id }, 'Product manager task completed successfully');

  } catch (error) {
    messageLogger.error({ error }, 'Failed to process product manager task');
    
    // Send error result if we have job info
    if (message.Body) {
      try {
        const taskMessage = parseTaskMessage(message.Body);
        await sendTaskResult({
          job_id: taskMessage.job_id,
          task_type: taskMessage.task_type,
          status: 'error',
          error: String(error),
          timestamp: new Date().toISOString()
        });
      } catch (parseError) {
        messageLogger.error({ parseError }, 'Failed to parse message for error reporting');
      }
    }
    
    // Don't delete message on error - let it retry or go to DLQ
    throw error;
  }
}

async function pollForMessages(): Promise<void> {
  if (!RESEARCH_QUEUE_URL || !PRODUCT_MANAGER_QUEUE_URL) {
    logger.error('Queue URLs environment variables are not set');
    process.exit(1);
  }

  logger.info(
    { researchQueueUrl: RESEARCH_QUEUE_URL, productManagerQueueUrl: PRODUCT_MANAGER_QUEUE_URL },
    'Starting product manager agent worker'
  );

  while (true) {
    try {
      // Poll for messages from both queues
      const [researchMessages, productManagerMessages] = await Promise.all([
        researchQueue.receiveMessages(1, 20),
        productManagerQueue.receiveMessages(1, 20)
      ]);
      
      // Process research messages
      if (researchMessages.length > 0) {
        logger.debug({ messageCount: researchMessages.length }, 'Received research messages from queue');
        for (const message of researchMessages) {
          await processResearchMessage(message);
        }
      }

      // Process product manager messages
      if (productManagerMessages.length > 0) {
        logger.debug({ messageCount: productManagerMessages.length }, 'Received product manager messages from queue');
        for (const message of productManagerMessages) {
          await processProductManagerMessage(message);
        }
      }

      // If no messages, short delay before next poll
      if (researchMessages.length === 0 && productManagerMessages.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      logger.error({ error }, 'Error in message polling loop');
      
      // Wait before retrying to avoid rapid error loops
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Start the worker
if (require.main === module) {
  pollForMessages().catch((error) => {
    logger.fatal({ error }, 'Worker crashed');
    process.exit(1);
  });
} 