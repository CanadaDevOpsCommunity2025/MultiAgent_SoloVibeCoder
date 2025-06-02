export interface JobSpec {
  product: string;
  audience: string;
  tone?: string;
  job_id?: string;  // Optional job ID provided by frontend
}

export interface TaskMessage {
  job_id: string;
  task_type: string;
  payload_key: string;
}

export interface CompletionEvent {
  job_id: string;
  task_type: string;        // Changed from 'task' to 'task_type' to match agents
  result_key?: string;      // Made optional since agents don't always send this
  status: 'success' | 'failure' | 'error' | 'in_progress';  // Added 'error' and 'in_progress' to match agents
  result?: any;             // Added to match agents
  error?: string;
  timestamp?: string;       // Added to match agents
}

export interface ResearchOutput {
  insights: string[];
  targetAudience: string;
  competitorAnalysis: string;
  keyMessages: string[];
}

export interface CopyOutput {
  headline: string;
  subheadline: string;
  bodyText: string;
  cta: string;
  research: ResearchOutput;
}

export interface CodeOutput {
  html: string;
  css: string;
  js?: string;
  copy: CopyOutput;
}

export interface JobContext {
  jobId: string;
  input: JobSpec;
  storage: S3StorageService;
  messaging: SQSMessagingService;
}

export interface S3StorageService {
  store<T>(key: string, data: T): Promise<string>;
  get<T>(key: string): Promise<T>;
}

export interface SQSMessagingService {
  sendTaskMessage(jobId: string, task: string, payload: any): Promise<void>;
  publishDone(event: { jobId: string }): Promise<void>;
}

export interface JobStatus {
  jobId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  completedTasks: string[];
  currentTask?: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
} 