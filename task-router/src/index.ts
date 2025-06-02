import { logger } from './logger';
import { config } from './config';
import { TaskRouter } from './graph';
import { JobStateManager } from './services/job-state';
import { APIServer } from './api';
import { activeJobs, jobsProcessed } from './metrics';

class TaskRouterApp {
  private router: TaskRouter;
  private jobState: JobStateManager;
  private apiServer: APIServer;
  private isShuttingDown = false;

  constructor() {
    this.router = new TaskRouter();
    this.jobState = new JobStateManager();
    this.apiServer = new APIServer(this.router, this.jobState);
  }

  async start(): Promise<void> {
    logger.info('Starting Task Router application');

    try {
      // Start API server
      await this.apiServer.start();
      
      // Start event consumer
      this.startEventConsumer();
      
      // Start job request consumer
      this.startJobRequestConsumer();
      
      // Start periodic cleanup
      this.startPeriodicCleanup();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('Task Router application started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start application');
      process.exit(1);
    }
  }

  private startEventConsumer(): void {
    logger.info('Starting event consumer');
    
    const messaging = this.router.getMessaging();
    
    // Start consuming completion events in background
    messaging.consumeEvents(async (event) => {
      try {
        logger.info({ event }, 'Received completion event');
        
        // Skip processing for in_progress events
        if (event.status === 'in_progress') {
          logger.debug({ jobId: event.job_id, taskType: event.task_type }, 'Skipping in_progress event');
          return;
        }

        const isJobComplete = this.jobState.completeTask(event);
        
        if (isJobComplete) {
          const job = this.jobState.getJob(event.job_id);
          if (job) {
            if (job.status === 'completed') {
              jobsProcessed.inc({ status: 'completed' });
              logger.info({ jobId: event.job_id }, 'Job completed successfully');
            } else if (job.status === 'failed') {
              jobsProcessed.inc({ status: 'failed' });
            }
            activeJobs.dec();
          }
        } else if (event.status === 'success') {
          // Job still has more tasks to complete, but only proceed if this task succeeded
          await this.router.handleTaskCompletion(event.job_id, event.task_type);
        }
      } catch (error) {
        logger.error({ error, event }, 'Failed to process completion event');
      }
    }).catch(error => {
      logger.error({ error }, 'Event consumer failed');
      if (!this.isShuttingDown) {
        process.exit(1);
      }
    });
  }

  private startJobRequestConsumer(): void {
    logger.info('Starting job request consumer');
    
    const messaging = this.router.getMessaging();
    
    // Start consuming job requests in background
    messaging.consumeJobRequests(async (jobRequest) => {
      try {
        logger.info({ jobId: jobRequest.job_id }, 'Received job request from SQS');
        
        // Create job in state manager
        this.jobState.createJob(jobRequest.job_id);
        this.jobState.startJob(jobRequest.job_id);
        
        // Update metrics
        activeJobs.inc();
        jobsProcessed.inc({ status: 'queued' });
        
        // Start job execution asynchronously
        this.router.executeJob(jobRequest.job_id, jobRequest.job_spec).catch(error => {
          logger.error({ error, jobId: jobRequest.job_id }, 'Job execution failed after SQS pickup');
          jobsProcessed.inc({ status: 'failed' });
          activeJobs.dec();
        });
        
        logger.info({ jobId: jobRequest.job_id }, 'Successfully started job from SQS request');
      } catch (error) {
        logger.error({ error, jobRequest }, 'Failed to process job request from SQS');
      }
    }).catch(error => {
      logger.error({ error }, 'Job request consumer failed');
      if (!this.isShuttingDown) {
        process.exit(1);
      }
    });
  }

  private startPeriodicCleanup(): void {
    // Clean up old jobs every hour
    const cleanupInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        try {
          this.jobState.cleanup();
        } catch (error) {
          logger.error({ error }, 'Cleanup failed');
        }
      }
    }, 60 * 60 * 1000); // 1 hour

    // Store interval for cleanup during shutdown
    this.setupCleanupOnShutdown(() => {
      clearInterval(cleanupInterval);
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      this.isShuttingDown = true;
      
      try {
        // Give some time for ongoing requests to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      logger.error({ error }, 'Uncaught exception');
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, 'Unhandled rejection');
      process.exit(1);
    });
  }

  private setupCleanupOnShutdown(cleanup: () => void): void {
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
  }
}

// Start the application
async function main() {
  try {
    logger.info({
      nodeEnv: config.server.nodeEnv,
      port: config.server.port,
      logLevel: config.logging.level,
    }, 'Starting Task Router');

    const app = new TaskRouterApp();
    await app.start();
  } catch (error) {
    logger.error({ error }, 'Application startup failed');
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

export { TaskRouterApp }; 