import AWS from 'aws-sdk';
import { config } from '../config';
import { createChildLogger } from '../logger';
import { s3Operations } from '../metrics';
import { S3StorageService } from '../types';

const logger = createChildLogger('storage');

export class S3Storage implements S3StorageService {
  private s3: AWS.S3;
  private bucket: string;

  constructor() {
    const s3Config: AWS.S3.ClientConfiguration = {
      region: config.aws.region,
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    };

    // Add LocalStack endpoint if configured
    if (config.aws.endpoint) {
      s3Config.endpoint = config.aws.endpoint;
      s3Config.s3ForcePathStyle = config.aws.s3ForcePathStyle;
    }

    this.s3 = new AWS.S3(s3Config);
    this.bucket = config.s3.artifactBucket;
  }

  async store<T>(key: string, data: T): Promise<string> {
    try {
      logger.info({ key, bucket: this.bucket }, 'Storing data to S3');
      
      await this.s3.putObject({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
      }).promise();

      s3Operations.inc({ operation: 'put', status: 'success' });
      logger.info({ key }, 'Successfully stored data to S3');
      return key;
    } catch (error) {
      s3Operations.inc({ operation: 'put', status: 'error' });
      logger.error({ error, key }, 'Failed to store data to S3');
      throw error;
    }
  }

  async get<T>(key: string): Promise<T> {
    try {
      logger.info({ key, bucket: this.bucket }, 'Retrieving data from S3');
      
      const result = await this.s3.getObject({
        Bucket: this.bucket,
        Key: key,
      }).promise();

      if (!result.Body) {
        throw new Error(`No data found for key: ${key}`);
      }

      const data = JSON.parse(result.Body.toString());
      s3Operations.inc({ operation: 'get', status: 'success' });
      logger.info({ key }, 'Successfully retrieved data from S3');
      return data;
    } catch (error) {
      s3Operations.inc({ operation: 'get', status: 'error' });
      logger.error({ error, key }, 'Failed to retrieve data from S3');
      throw error;
    }
  }

  async storePayload(jobId: string, task: string, payload: any): Promise<string> {
    const key = `${jobId}/${task}.json`;
    await this.store(key, payload);
    return key;
  }

  async storeResult(jobId: string, task: string, result: any): Promise<string> {
    const key = `${jobId}/${task}-result.json`;
    await this.store(key, result);
    return key;
  }
} 