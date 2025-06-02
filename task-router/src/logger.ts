import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logging.level,
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport: config.server.nodeEnv === 'development' 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export function createChildLogger(name: string, metadata?: Record<string, any>) {
  return logger.child({ 
    component: name,
    ...metadata,
  });
} 