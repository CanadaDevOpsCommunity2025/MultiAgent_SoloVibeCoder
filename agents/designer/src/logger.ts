import pino from 'pino';

// Determine log level from environment
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');

// Create logger configuration
const loggerConfig: pino.LoggerOptions = {
  level: logLevel,
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
};

// Create and export the logger
export const logger = pino(loggerConfig);

// Export types for convenience
export type Logger = typeof logger;

// Helper function to create child loggers with context
export function createChildLogger(context: Record<string, any>): Logger {
  return logger.child(context);
}

// Helper function to create agent-specific logger
export function createAgentLogger(agentName: string, jobId?: string): Logger {
  const context: Record<string, any> = { agent: agentName };
  if (jobId) {
    context.jobId = jobId;
  }
  return logger.child(context);
}

// Log performance helper
export function logPerformance<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const start = Date.now();
    logger.debug({ operation }, 'Starting operation');
    
    try {
      const result = await fn();
      const duration = Date.now() - start;
      logger.info({ operation, duration }, 'Operation completed successfully');
      resolve(result);
    } catch (error) {
      const duration = Date.now() - start;
      logger.error({ operation, duration, error }, 'Operation failed');
      reject(error);
    }
  });
} 