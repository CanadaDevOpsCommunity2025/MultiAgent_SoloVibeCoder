import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  aws: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
    s3ForcePathStyle?: boolean;
  };
  queues: {
    routerJobs: string;
    events: string;
    research: string;
    designer: string;
    drawer: string;
    productManager: string;
    coder: string;
  };
  s3: {
    artifactBucket: string;
  };
  server: {
    port: number;
    nodeEnv: string;
  };
  logging: {
    level: string;
  };
  metrics: {
    port: number;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export const config: Config = {
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.AWS_ENDPOINT_URL,
    s3ForcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  },
  queues: {
    routerJobs: requireEnv('ROUTER_JOBS_QUEUE_URL'),
    events: requireEnv('EVENTS_QUEUE_URL'),
    research: requireEnv('RESEARCH_QUEUE_URL'),
    designer: requireEnv('DESIGNER_QUEUE_URL'),
    drawer: requireEnv('DRAWER_QUEUE_URL'),
    productManager: requireEnv('PRODUCT_MANAGER_QUEUE_URL'),
    coder: requireEnv('CODER_QUEUE_URL'),
  },
  s3: {
    artifactBucket: requireEnv('ARTIFACT_BUCKET'),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  metrics: {
    port: parseInt(process.env.METRICS_PORT || '9090', 10),
  },
}; 