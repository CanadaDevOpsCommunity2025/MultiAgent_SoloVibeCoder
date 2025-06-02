import { createChildLogger } from '../logger';
import { JobStatus, CompletionEvent } from '../types';

const logger = createChildLogger('job-state');

export class JobStateManager {
  private jobs: Map<string, JobStatus> = new Map();

  createJob(jobId: string): JobStatus {
    const job: JobStatus = {
      jobId,
      status: 'queued',
      completedTasks: [],
      startedAt: new Date(),
    };
    
    this.jobs.set(jobId, job);
    logger.info({ jobId }, 'Created new job');
    return job;
  }

  startJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    job.status = 'in_progress';
    logger.info({ jobId }, 'Started job processing');
  }

  completeTask(event: CompletionEvent): boolean {
    const job = this.jobs.get(event.job_id);
    if (!job) {
      logger.warn({ jobId: event.job_id }, 'Received completion event for unknown job');
      return false;
    }

    // Skip in_progress status updates
    if (event.status === 'in_progress') {
      logger.debug({ jobId: event.job_id, taskType: event.task_type }, 'Task in progress');
      return false;
    }

    if (event.status === 'failure' || event.status === 'error') {
      job.status = 'failed';
      job.error = event.error;
      job.completedAt = new Date();
      logger.error({ jobId: event.job_id, taskType: event.task_type, error: event.error }, 'Task failed');
      return true;
    }

    // Add task to completed list if not already there
    if (!job.completedTasks.includes(event.task_type)) {
      job.completedTasks.push(event.task_type);
      logger.info({ jobId: event.job_id, taskType: event.task_type }, 'Task completed');
    }

    // Check if all tasks are complete
    const requiredTasks = ['research', 'product_manager', 'drawer', 'designer', 'coder'];
    const allTasksComplete = requiredTasks.every(task => 
      job.completedTasks.includes(task)
    );

    if (allTasksComplete) {
      job.status = 'completed';
      job.completedAt = new Date();
      logger.info({ jobId: event.job_id }, 'All tasks completed - job finished');
      return true;
    }

    return false;
  }

  getJob(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  isTaskCompleted(jobId: string, task: string): boolean {
    const job = this.jobs.get(jobId);
    return job ? job.completedTasks.includes(task) : false;
  }

  getNextTasks(jobId: string): string[] {
    const job = this.jobs.get(jobId);
    if (!job) return [];

    const completedTasks = job.completedTasks;
    const nextTasks: string[] = [];

    // Task dependencies:
    // research -> product_manager -> drawer -> designer -> coder
    if (!completedTasks.includes('research')) {
      nextTasks.push('research');
    } else if (!completedTasks.includes('product_manager')) {
      nextTasks.push('product_manager');
    } else if (!completedTasks.includes('drawer')) {
      nextTasks.push('drawer');
    } else if (!completedTasks.includes('designer')) {
      nextTasks.push('designer');
    } else if (!completedTasks.includes('coder')) {
      nextTasks.push('coder');
    }

    return nextTasks;
  }

  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = new Date();
    const jobsToDelete: string[] = [];

    for (const [jobId, job] of this.jobs.entries()) {
      const jobAge = now.getTime() - job.startedAt.getTime();
      if (jobAge > maxAge && (job.status === 'completed' || job.status === 'failed')) {
        jobsToDelete.push(jobId);
      }
    }

    for (const jobId of jobsToDelete) {
      this.jobs.delete(jobId);
      logger.info({ jobId }, 'Cleaned up old job');
    }

    if (jobsToDelete.length > 0) {
      logger.info({ count: jobsToDelete.length }, 'Cleaned up completed jobs');
    }
  }

  getStats() {
    const stats = {
      total: this.jobs.size,
      queued: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };

    for (const job of this.jobs.values()) {
      stats[job.status]++;
    }

    return stats;
  }

  getAllJobs(): JobStatus[] {
    return Array.from(this.jobs.values());
  }
} 