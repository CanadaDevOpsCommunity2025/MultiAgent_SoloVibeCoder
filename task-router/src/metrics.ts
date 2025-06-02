import client from 'prom-client';

// Create metrics registry
export const register = new client.Registry();

// Default metrics
client.collectDefaultMetrics({ register });

// Custom metrics for task router
export const nodeLatency = new client.Histogram({
  name: 'router_node_latency_seconds',
  help: 'Latency of node executions in seconds',
  labelNames: ['node', 'job_id'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const nodeErrors = new client.Counter({
  name: 'router_node_errors_total',
  help: 'Total number of node execution errors',
  labelNames: ['node', 'error_type'],
  registers: [register],
});

export const jobsProcessed = new client.Counter({
  name: 'router_jobs_processed_total',
  help: 'Total number of jobs processed',
  labelNames: ['status'],
  registers: [register],
});

export const activeJobs = new client.Gauge({
  name: 'router_active_jobs',
  help: 'Number of currently active jobs',
  registers: [register],
});

export const sqsMessagesSent = new client.Counter({
  name: 'router_sqs_messages_sent_total',
  help: 'Total number of SQS messages sent',
  labelNames: ['queue', 'status'],
  registers: [register],
});

export const s3Operations = new client.Counter({
  name: 'router_s3_operations_total',
  help: 'Total number of S3 operations',
  labelNames: ['operation', 'status'],
  registers: [register],
});

// Helper function to time operations
export function timeOperation<T>(
  histogram: client.Histogram<string>,
  labels: Record<string, string>,
  operation: () => Promise<T>
): Promise<T> {
  const timer = histogram.startTimer(labels);
  return operation().finally(() => timer());
} 