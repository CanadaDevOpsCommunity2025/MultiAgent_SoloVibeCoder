import { createChildLogger } from './logger';
import { nodeLatency, nodeErrors, timeOperation } from './metrics';
import { JobSpec, JobContext, ResearchOutput, CopyOutput } from './types';
import { S3Storage } from './services/storage';
import { SQSMessaging } from './services/messaging';

const logger = createChildLogger('graph');

export class TaskRouter {
  private storage: S3Storage;
  private messaging: SQSMessaging;

  constructor() {
    this.storage = new S3Storage();
    this.messaging = new SQSMessaging(this.storage);
  }

  async executeJob(jobId: string, input: JobSpec): Promise<void> {
    const context: JobContext = {
      jobId,
      input,
      storage: this.storage,
      messaging: this.messaging,
    };

    logger.info({ jobId, input }, 'Starting job execution');

    try {
      // Execute research task first
      await this.executeResearchTask(context);
    } catch (error) {
      logger.error({ error, jobId }, 'Job execution failed');
      nodeErrors.inc({ node: 'job', error_type: 'execution_error' });
      throw error;
    }
  }

  private async executeResearchTask(context: JobContext): Promise<void> {
    await timeOperation(
      nodeLatency,
      { node: 'research', job_id: context.jobId },
      async () => {
        try {
          logger.info({ jobId: context.jobId }, 'Executing research task');
          
          const researchPayload = {
            product: context.input.product,
            audience: context.input.audience,
            tone: context.input.tone,
            task: 'research',
            instructions: [
              'Analyze the target audience and their pain points',
              'Research competitors and their messaging strategies',
              'Identify key value propositions for the product',
              'Generate insights for content creation',
            ],
          };

          await context.messaging.sendTaskMessage(
            context.jobId,
            'research',
            researchPayload
          );

          logger.info({ jobId: context.jobId }, 'Research task dispatched');
        } catch (error) {
          nodeErrors.inc({ node: 'research', error_type: 'dispatch_error' });
          throw error;
        }
      }
    );
  }

  async handleTaskCompletion(jobId: string, taskType: string): Promise<void> {
    logger.info({ jobId, taskType }, 'Handling task completion');

    try {
      switch (taskType) {
        case 'research':
          await this.executeProductManagerTask(jobId);
          break;
        case 'product_manager':
          await this.executeDrawerTask(jobId);
          break;
        case 'drawer':
          await this.executeDesignerTask(jobId);
          break;
        case 'designer':
          await this.executeCodeTask(jobId);
          break;
        case 'coder':
          await this.completeJob(jobId);
          break;
        default:
          logger.warn({ jobId, taskType }, 'Unknown task completion');
      }
    } catch (error) {
      logger.error({ error, jobId, taskType }, 'Failed to handle task completion');
      throw error;
    }
  }

  private async executeProductManagerTask(jobId: string): Promise<void> {
    await timeOperation(
      nodeLatency,
      { node: 'product_manager', job_id: jobId },
      async () => {
        try {
          logger.info({ jobId }, 'Executing product manager task');
          
          // Retrieve research results
          const research = await this.storage.get<ResearchOutput>(`${jobId}/research-result.json`);
          
          const productManagerPayload = {
            research,
            task: 'product_manager',
            instructions: [
              'Analyze research findings and define product strategy',
              'Create detailed product requirements and specifications',
              'Define user personas and user journey',
              'Establish product positioning and messaging framework',
              'Create comprehensive product brief for design and development',
            ],
          };

          await this.messaging.sendTaskMessage(jobId, 'product_manager', productManagerPayload);
          
          logger.info({ jobId }, 'Product manager task dispatched');
        } catch (error) {
          nodeErrors.inc({ node: 'product_manager', error_type: 'dispatch_error' });
          throw error;
        }
      }
    );
  }

  private async executeDesignerTask(jobId: string): Promise<void> {
    await timeOperation(
      nodeLatency,
      { node: 'designer', job_id: jobId },
      async () => {
        try {
          logger.info({ jobId }, 'Executing designer task');
          
          // Retrieve drawer results (since designer now comes after drawer)
          const drawings = await this.storage.get(`${jobId}/drawer-result.json`);
          
          const designerPayload = {
            drawings,
            task: 'designer',
            instructions: [
              'Create comprehensive design system and style guide based on visual mockups',
              'Design user interface layouts and wireframes',
              'Develop visual hierarchy and typography specifications',
              'Create color palette and branding guidelines',
              'Design responsive layouts for multiple screen sizes',
            ],
          };

          await this.messaging.sendTaskMessage(jobId, 'designer', designerPayload);
          
          logger.info({ jobId }, 'Designer task dispatched');
        } catch (error) {
          nodeErrors.inc({ node: 'designer', error_type: 'dispatch_error' });
          throw error;
        }
      }
    );
  }

  private async executeDrawerTask(jobId: string): Promise<void> {
    await timeOperation(
      nodeLatency,
      { node: 'drawer', job_id: jobId },
      async () => {
        try {
          logger.info({ jobId }, 'Executing drawer task');
          
          // Retrieve product manager results (since drawer now comes after product_manager)
          const productSpec = await this.storage.get(`${jobId}/product-manager-result.json`);
          
          const drawerPayload = {
            productSpec,
            task: 'drawer',
            instructions: [
              'Create detailed visual mockups and prototypes based on product requirements',
              'Generate high-fidelity design assets and components',
              'Create interactive design elements and animations',
              'Develop comprehensive UI component library',
              'Prepare visual assets for design handoff',
            ],
          };

          await this.messaging.sendTaskMessage(jobId, 'drawer', drawerPayload);
          
          logger.info({ jobId }, 'Drawer task dispatched');
        } catch (error) {
          nodeErrors.inc({ node: 'drawer', error_type: 'dispatch_error' });
          throw error;
        }
      }
    );
  }

  private async executeCodeTask(jobId: string): Promise<void> {
    await timeOperation(
      nodeLatency,
      { node: 'code', job_id: jobId },
      async () => {
        try {
          logger.info({ jobId }, 'Executing code task');
          
          // Retrieve designer results (since coder now comes after designer)
          const designSpec = await this.storage.get(`${jobId}/designer-result.json`);
          
          const codePayload = {
            designSpec,
            task: 'coder',
            instructions: [
              'Create responsive HTML structure based on designs',
              'Implement modern CSS with pixel-perfect styling',
              'Add interactive elements and animations',
              'Ensure mobile-first responsive design',
              'Optimize for performance and user experience',
            ],
          };

          await this.messaging.sendTaskMessage(jobId, 'coder', codePayload);
          
          logger.info({ jobId }, 'Code task dispatched');
        } catch (error) {
          nodeErrors.inc({ node: 'code', error_type: 'dispatch_error' });
          throw error;
        }
      }
    );
  }

  private async completeJob(jobId: string): Promise<void> {
    await timeOperation(
      nodeLatency,
      { node: 'complete', job_id: jobId },
      async () => {
        try {
          logger.info({ jobId }, 'Completing job');
          
          // Publish completion event
          await this.messaging.publishDone({ jobId });
          
          logger.info({ jobId }, 'Job completed successfully');
        } catch (error) {
          nodeErrors.inc({ node: 'complete', error_type: 'completion_error' });
          throw error;
        }
      }
    );
  }

  getStorage(): S3Storage {
    return this.storage;
  }

  getMessaging(): SQSMessaging {
    return this.messaging;
  }
} 