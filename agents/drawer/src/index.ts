import { 
  createSQSHelper, 
  createS3Helper,
  parseTaskMessage, 
  TaskMessage, 
  TaskResult 
} from './aws';
import { createAgentLogger } from './logger';
import { runDrawerAgent } from './agent';

// Configuration
const DRAWER_QUEUE_URL = process.env.DRAWER_QUEUE_URL || '';
const EVENTS_QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL || '5000');

// Initialize services
const drawerQueue = createSQSHelper(DRAWER_QUEUE_URL);
const eventsQueue = createSQSHelper(EVENTS_QUEUE_URL);
const s3Helper = createS3Helper();
const logger = createAgentLogger('drawer');

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

async function processMessage(message: any): Promise<void> {
  const messageLogger = logger.child({ messageId: message.MessageId });
  
  try {
    // Parse the task message
    const taskMessage: TaskMessage = parseTaskMessage(message.Body);
    const { job_id, task_type, payload_key } = taskMessage;
    
    messageLogger.info({ job_id, task_type, payload_key }, 'Processing drawer task');

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

    // Create payload with correct structure for DrawerPayload interface
    const enrichedPayload = {
      productSpec: jobPayload,
      job_id
    };

    // Run the drawer agent
    const result = await runDrawerAgent(enrichedPayload);
    
    // Send success result
    await sendTaskResult({
      job_id,
      task_type,
      status: 'success',
      result,
      timestamp: new Date().toISOString()
    });

    // Delete the message from queue
    await drawerQueue.deleteMessage(message.ReceiptHandle);
    messageLogger.info({ job_id }, 'Drawer task completed successfully');

  } catch (error) {
    messageLogger.error({ error }, 'Failed to process drawer task');
    
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
  if (!DRAWER_QUEUE_URL) {
    logger.error('DRAWER_QUEUE_URL environment variable is not set');
    process.exit(1);
  }

  logger.info({ queueUrl: DRAWER_QUEUE_URL }, 'Starting drawer agent worker');

  while (true) {
    try {
      // Poll for messages
      const messages = await drawerQueue.receiveMessages(1, 20);
      
      if (messages.length > 0) {
        logger.debug({ messageCount: messages.length }, 'Received messages from queue');
        
        // Process messages sequentially for now
        // In production, you might want to process them in parallel with concurrency limits
        for (const message of messages) {
          await processMessage(message);
        }
      } else {
        // No messages, short delay before next poll
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