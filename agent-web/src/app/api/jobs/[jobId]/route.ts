import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// Initialize AWS S3 client
const awsConfig: any = {
  region: process.env.AWS_REGION || 'us-east-1',
};

// Only set credentials if we have explicit access keys (for local development)
// In ECS/production, the SDK will automatically use the task's IAM role
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

// LocalStack configuration for local development
if (process.env.AWS_ENDPOINT_URL) {
  awsConfig.endpoint = process.env.AWS_ENDPOINT_URL;
  awsConfig.forcePathStyle = true; // Required for LocalStack S3
}

const s3Client = new S3Client(awsConfig);
const S3_BUCKET_NAME = process.env.ARTIFACT_BUCKET || process.env.S3_BUCKET_NAME || '';

// Helper function to retrieve job data from S3
async function getJobFromS3(jobId: string): Promise<any | null> {
  if (!S3_BUCKET_NAME) {
    console.log('S3_BUCKET_NAME not configured, skipping S3 retrieval');
    return null;
  }

  try {
    console.log(`[S3] Retrieving job ${jobId} from S3 bucket: ${S3_BUCKET_NAME}`);
    console.log(`[S3] Using bucket from env: ARTIFACT_BUCKET=${process.env.ARTIFACT_BUCKET}, S3_BUCKET_NAME=${process.env.S3_BUCKET_NAME}`);
    
    // First, try to get the job spec from initial research payload
    let jobSpec = null;
    try {
      const jobSpecKey = `${jobId}/research.json`;
      console.log(`[S3] Looking for job spec at key: ${jobSpecKey}`);
      const jobSpecCommand = new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: jobSpecKey,
      });
      const jobSpecResponse = await s3Client.send(jobSpecCommand);
      const jobSpecBody = await jobSpecResponse.Body?.transformToString();
      if (jobSpecBody) {
        jobSpec = JSON.parse(jobSpecBody);
        console.log(`[S3] Found job spec for ${jobId}`);
      }
    } catch (error) {
      // Job spec might not exist yet, continue
      console.log(`[S3] No job spec found for ${jobId} in S3:`, error);
    }

    // List all result files for this job
    const listCommand = new ListObjectsV2Command({
      Bucket: S3_BUCKET_NAME,
      Prefix: `${jobId}/`,
    });

    console.log(`[S3] Listing objects with prefix: ${jobId}/`);
    const listResponse = await s3Client.send(listCommand);
    const results: Record<string, any> = {};
    let lastUpdated = new Date().toISOString();
    
    if (listResponse.Contents) {
      console.log(`[S3] Found ${listResponse.Contents.length} objects for job ${jobId}`);
      listResponse.Contents.forEach(obj => console.log(`[S3] Object: ${obj.Key}`));
      
      for (const object of listResponse.Contents) {
        if (object.Key && object.Key.includes('-result.json')) {
          try {
            console.log(`[S3] Processing result file: ${object.Key}`);
            // Get the result object
            const getCommand = new GetObjectCommand({
              Bucket: S3_BUCKET_NAME,
              Key: object.Key,
            });
            const response = await s3Client.send(getCommand);
            const body = await response.Body?.transformToString();
            
            if (body) {
              const resultData = JSON.parse(body);
              
              // Extract agent type from key (e.g., "research-result.json" -> "research", "product-manager-result.json" -> "product_manager")
              const keyParts = object.Key.split('/');
              const fileName = keyParts[keyParts.length - 1]; // Get the filename part
              let agentType = fileName.replace('-result.json', '');
              
              // Map file names to agent types
              if (agentType === 'product-manager') {
                agentType = 'product_manager';
              }
              
              results[agentType] = resultData;
              
              console.log(`[S3] Retrieved ${agentType} result for job ${jobId} from ${object.Key}`);
              
              // Update last modified time
              if (object.LastModified && object.LastModified > new Date(lastUpdated)) {
                lastUpdated = object.LastModified.toISOString();
              }
            }
          } catch (error) {
            console.error(`[S3] Failed to retrieve result from ${object.Key}:`, error);
          }
        }
      }
    } else {
      console.log(`[S3] No objects found for job ${jobId}`);
    }

    // Determine job status based on results
    const expectedAgents = ['research', 'product_manager', 'drawer', 'designer', 'coder'];
    const completedAgents = expectedAgents.filter(agent => results[agent]);
    let status: 'pending' | 'in_progress' | 'completed' | 'failed' = 'pending';
    
    if (completedAgents.length === 0) {
      status = 'pending';
    } else if (completedAgents.length === expectedAgents.length) {
      status = 'completed';
    } else {
      status = 'in_progress';
    }

    const createdAt = jobSpec?.created_at || new Date().toISOString();

    console.log(`[S3] Job ${jobId} status: ${status}, completed agents: [${completedAgents.join(', ')}]`);
    console.log(`[S3] Available result keys: [${Object.keys(results).join(', ')}]`);

    return {
      job_id: jobId,
      status,
      mode: 'external',
      description: jobSpec?.description || jobSpec?.product || 'AI-generated landing page',
      product: jobSpec?.product || jobSpec?.description || 'AI-generated landing page',
      title: (jobSpec?.description || jobSpec?.product || 'Landing Page Project').slice(0, 50) + '...',
      created_at: createdAt,
      last_updated: lastUpdated,
      tasks_completed: completedAgents,
      tasks_pending: expectedAgents.filter(agent => !completedAgents.includes(agent)),
      results: {
        research: results.research || null,
        product_manager: results.product_manager || null,
        drawer: results.drawer || null,
        designer: results.designer || null,
        coder: results.coder || null,
      },
      metadata: {
        jobSpec,
        retrievedFromS3: true,
        s3Bucket: S3_BUCKET_NAME,
        resultKeys: Object.keys(results),
        expectedKeys: expectedAgents.map(agent => `${jobId}/${agent}-result.json`)
      },
    };

  } catch (error) {
    console.error(`[S3] Error retrieving job ${jobId} from S3:`, error);
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    console.log(`[API] GET /api/jobs/${jobId} - Starting request`);

    // Get job from S3
    const s3JobData = await getJobFromS3(jobId);
    
    if (s3JobData) {
      console.log(`[API] Found job ${jobId} in S3`);
      return NextResponse.json(s3JobData);
    }

    // Job not found in S3
    console.log(`[API] No data found for job ${jobId} in S3`);
    return NextResponse.json(
      { error: 'Job not found' },
      { status: 404 }
    );

  } catch (error) {
    console.error('[API] Error retrieving job:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve job' },
      { status: 500 }
    );
  }
} 