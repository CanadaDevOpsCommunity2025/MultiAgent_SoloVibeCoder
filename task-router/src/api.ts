import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { createChildLogger } from './logger';
import { register } from './metrics';
import { jobsProcessed, activeJobs } from './metrics';
import { JobSpec } from './types';
import { TaskRouter } from './graph';
import { JobStateManager } from './services/job-state';

const logger = createChildLogger('api');

export class APIServer {
  private app: express.Application;
  private router: TaskRouter;
  private jobState: JobStateManager;

  constructor(router: TaskRouter, jobState: JobStateManager) {
    this.app = express();
    this.router = router;
    this.jobState = jobState;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging middleware with detailed information
    this.app.use((req, res, next) => {
      const start = Date.now();
      
      // Log incoming request details
      logger.info({
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        headers: {
          'content-type': req.get('Content-Type'),
          'user-agent': req.get('User-Agent'),
          'host': req.get('Host'),
          'origin': req.get('Origin'),
          'referer': req.get('Referer')
        },
        body: req.method === 'POST' ? req.body : undefined
      }, '🌐 [TASK-ROUTER] Incoming request');
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
        }, `📊 [TASK-ROUTER] Request completed: ${res.statusCode}`);
      });
      next();
    });

    // Error handling middleware
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error({ error, url: req.url, method: req.method }, 'API error');
      res.status(500).json({
        error: 'Internal server error',
        message: config.server.nodeEnv === 'development' ? error.message : undefined,
      });
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const stats = this.jobState.getStats();
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        jobs: stats,
      });
    });

    // Metrics endpoint for Prometheus
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
      } catch (error) {
        logger.error({ error }, 'Failed to generate metrics');
        res.status(500).json({ error: 'Failed to generate metrics' });
      }
    });

    // Create new job
    this.app.post('/api/router/jobs', async (req, res) => {
      logger.info('🚀 [TASK-ROUTER] POST /api/router/jobs - Creating new job');
      logger.info('📝 [TASK-ROUTER] Request body:', JSON.stringify(req.body, null, 2));
      
      try {
        const jobSpec: JobSpec = req.body;
        
        // Validate request
        if (!jobSpec.product || !jobSpec.audience) {
          logger.warn('❌ [TASK-ROUTER] Validation failed: Missing required fields', { 
            hasProduct: !!jobSpec.product, 
            hasAudience: !!jobSpec.audience,
            receivedFields: Object.keys(jobSpec)
          });
          return res.status(400).json({
            error: 'Missing required fields',
            required: ['product', 'audience'],
          });
        }

        // Use provided job_id if available, otherwise generate new one
        const jobId = jobSpec.job_id || uuidv4();
        logger.info(`🆔 [TASK-ROUTER] Job ID: ${jobId} (provided: ${!!jobSpec.job_id})`);
        
        // Create job in state manager
        this.jobState.createJob(jobId);
        this.jobState.startJob(jobId);
        logger.info(`📊 [TASK-ROUTER] Job ${jobId} created and started in state manager`);
        
        // Update metrics
        activeJobs.inc();
        jobsProcessed.inc({ status: 'queued' });
        
        // Start job execution asynchronously
        logger.info(`🔄 [TASK-ROUTER] Starting job execution for ${jobId}`);
        this.router.executeJob(jobId, jobSpec).catch(error => {
          logger.error({ error, jobId }, '❌ [TASK-ROUTER] Job execution failed');
          jobsProcessed.inc({ status: 'failed' });
          activeJobs.dec();
        });

        logger.info({ jobId, jobSpec }, '✅ [TASK-ROUTER] Job created successfully');
        
        res.status(201).json({
          job_id: jobId,
          status: 'queued',
        });
      } catch (error) {
        logger.error({ error }, '❌ [TASK-ROUTER] Failed to create job');
        res.status(500).json({ error: 'Failed to create job' });
      }
    });

    // Get job status
    this.app.get('/api/router/jobs/:jobId', (req, res) => {
      const { jobId } = req.params;
      logger.info(`🔍 [TASK-ROUTER] GET /api/router/jobs/${jobId} - Getting job status`);
      
      try {
        const job = this.jobState.getJob(jobId);
        
        if (!job) {
          logger.warn(`❌ [TASK-ROUTER] Job ${jobId} not found`);
          return res.status(404).json({ error: 'Job not found' });
        }

        logger.info(`✅ [TASK-ROUTER] Job ${jobId} found`, { status: job.status });
        res.json(job);
      } catch (error) {
        logger.error({ error, jobId }, '❌ [TASK-ROUTER] Failed to get job status');
        res.status(500).json({ error: 'Failed to get job status' });
      }
    });

    // List jobs
    this.app.get('/api/router/jobs', (req, res) => {
      logger.info('📋 [TASK-ROUTER] GET /api/router/jobs - Listing all jobs');
      
      try {
        const stats = this.jobState.getStats();
        logger.info('📊 [TASK-ROUTER] Job stats:', stats);
        
        res.json({
          stats,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, '❌ [TASK-ROUTER] Failed to list jobs');
        res.status(500).json({ error: 'Failed to list jobs' });
      }
    });

    // Add a tasks endpoint to match what agent-web is calling
    this.app.get('/api/router/tasks', (req, res) => {
      logger.info('📋 [TASK-ROUTER] GET /api/router/tasks - Listing all tasks (jobs)');
      
      // Helper function to calculate job progress
      const calculateJobProgress = (job: any): number => {
        if (!job.completedTasks) return 0;
        const totalTasks = 3; // research, writer, coder
        return Math.round((job.completedTasks.length / totalTasks) * 100);
      };
      
      try {
        const stats = this.jobState.getStats();
        logger.info('📊 [TASK-ROUTER] Task stats:', stats);
        
        // Get all jobs from the job state manager
        const allJobs = this.jobState.getAllJobs();
        
        // Convert jobs to tasks format that agent-web expects
        const tasks = allJobs.map((job: any) => ({
          task_id: job.jobId,
          job_id: job.jobId,
          status: job.status || 'unknown',
          created_at: job.startedAt?.toISOString() || new Date().toISOString(),
          agent_type: 'external',
          progress: calculateJobProgress(job)
        }));
        
        logger.info(`✅ [TASK-ROUTER] Returning ${tasks.length} tasks`);
        res.json(tasks);
      } catch (error) {
        logger.error({ error }, '❌ [TASK-ROUTER] Failed to list tasks');
        res.status(500).json({ error: 'Failed to list tasks' });
      }
    });

    // Catch-all for unknown routes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.originalUrl,
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(config.server.port, () => {
        logger.info({ port: config.server.port }, 'API server started');
        resolve();
      });
    });
  }

  getApp(): express.Application {
    return this.app;
  }
} 