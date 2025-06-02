import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

// Rate limiting store
const rateLimitStore = new Map<string, number>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in milliseconds

// Helper function to get client IP
function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  // Fallback to localhost for development
  return 'localhost';
}

// Helper function to check rate limit
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const lastRequest = rateLimitStore.get(ip);
  
  if (!lastRequest) {
    rateLimitStore.set(ip, now);
    return true; // First request, allow it
  }
  
  const timeSinceLastRequest = now - lastRequest;
  
  if (timeSinceLastRequest >= RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, now);
    return true; // Enough time has passed, allow it
  }
  
  return false; // Rate limited
}

// Helper function to clean up old entries (optional, to prevent memory leaks)
function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [ip, timestamp] of rateLimitStore.entries()) {
    if (now - timestamp > RATE_LIMIT_WINDOW) {
      rateLimitStore.delete(ip);
    }
  }
}

// Types matching the task-router expectations
interface JobSpec {
  product: string;
  audience: string;
  tone?: string;
  tasks?: string[];
}

// Initialize AWS clients
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

// Configuration
const S3_BUCKET_NAME = process.env.ARTIFACT_BUCKET || process.env.S3_BUCKET_NAME || '';
const TASK_ROUTER_API_URL = process.env.TASK_ROUTER_API_URL || 'http://localhost:3001';
const USE_LOCAL_AGENTS = process.env.USE_LOCAL_AGENTS === 'true';

async function storeJobSpecInS3(jobId: string, jobSpec: JobSpec): Promise<string> {
  if (!S3_BUCKET_NAME) {
    throw new Error('S3_BUCKET_NAME environment variable is not set');
  }

  // Store the job spec as the initial research payload to match task-router pattern
  const key = `${jobId}/research.json`;
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(jobSpec),
    ContentType: 'application/json',
  });

  try {
    await s3Client.send(command);
    console.log(`Job spec stored in S3 for job ${jobId} at key ${key}`);
    return key;
  } catch (error) {
    console.error('Failed to store job spec in S3:', error);
    throw error;
  }
}

async function createJobInTaskRouter(jobId: string, jobSpec: JobSpec): Promise<void> {
  try {
    console.log(`[DEBUG] Starting HTTP call to task-router for job ${jobId}`);
    console.log(`[DEBUG] URL: ${TASK_ROUTER_API_URL}/api/router/jobs`);
    console.log(`[DEBUG] Request body:`, JSON.stringify({ ...jobSpec, job_id: jobId }, null, 2));
    
    const response = await fetch(`${TASK_ROUTER_API_URL}/api/router/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...jobSpec,
        job_id: jobId, // Include the job ID we generated
      }),
    });

    console.log(`[DEBUG] Response status: ${response.status}`);
    console.log(`[DEBUG] Response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[DEBUG] Error response body: ${errorText}`);
      throw new Error(`Task router responded with ${response.status}: ${errorText}`);
    }

    const responseBody = await response.text();
    console.log(`[DEBUG] Success response body: ${responseBody}`);
    console.log(`Job ${jobId} created in task router`);
  } catch (error) {
    console.error(`Failed to create job in task router:`, error);
    throw error;
  }
}

// Helper function to retrieve job data from S3
async function getJobFromS3(jobId: string): Promise<any | null> {
  if (!S3_BUCKET_NAME) {
    console.log('S3_BUCKET_NAME not configured, skipping S3 retrieval');
    return null;
  }

  try {
    console.log(`[S3] Retrieving job ${jobId} from bucket: ${S3_BUCKET_NAME} (ARTIFACT_BUCKET=${process.env.ARTIFACT_BUCKET})`);
    
    // First, try to get the job spec from initial research payload
    let jobSpec = null;
    try {
      const jobSpecKey = `${jobId}/research.json`;
      console.log(`[S3] Looking for job spec at: ${jobSpecKey}`);
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
      console.log(`[S3] No job spec found for ${jobId}:`, error);
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
      console.log(`[S3] Found ${listResponse.Contents.length} objects for job ${jobId}:`);
      listResponse.Contents.forEach(obj => console.log(`[S3]   - ${obj.Key}`));
      
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
              
              // Extract agent type from key (e.g., "research-result.json" -> "research")
              const keyParts = object.Key.split('/');
              const fileName = keyParts[keyParts.length - 1]; // Get the filename part
              const agentType = fileName.replace('-result.json', '');
              results[agentType] = resultData;
              
              console.log(`[S3] Successfully retrieved ${agentType} result from ${object.Key}`);
              
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

    console.log(`[S3] Job ${jobId} final status: ${status}`);
    console.log(`[S3] Completed agents: [${completedAgents.join(', ')}]`);
    console.log(`[S3] Available results: [${Object.keys(results).join(', ')}]`);

    return {
      job_id: jobId,
      id: jobId,
      title: (jobSpec?.description || jobSpec?.product || 'Landing Page Project').slice(0, 50) + '...',
      description: jobSpec?.description || jobSpec?.product || 'AI-generated landing page',
      product: jobSpec?.product || jobSpec?.description || 'AI-generated landing page',
      status,
      createdAt,
      created_at: createdAt,
      last_updated: lastUpdated,
      progress: Math.round((completedAgents.length / expectedAgents.length) * 100),
      results: {
        research: results.research || null,
        product_manager: results.product_manager || null,
        drawer: results.drawer || null,
        designer: results.designer || null,
        coder: results.coder || null,
      },
      tasks_completed: completedAgents,
      tasks_pending: expectedAgents.filter(agent => !completedAgents.includes(agent)),
      mode: 'external'
    };

  } catch (error) {
    console.error(`[S3] Error retrieving job ${jobId} from S3:`, error);
    return null;
  }
}

// Helper function to list all jobs from S3
async function getAllJobsFromS3(): Promise<any[]> {
  if (!S3_BUCKET_NAME) {
    console.log('S3_BUCKET_NAME not configured, returning empty list');
    return [];
  }

  try {
    // List all objects and find job IDs by looking for research.json or result files
    const listCommand = new ListObjectsV2Command({
      Bucket: S3_BUCKET_NAME,
      Prefix: '',
    });

    const listResponse = await s3Client.send(listCommand);
    const jobIds = new Set<string>();

    if (listResponse.Contents) {
      for (const object of listResponse.Contents) {
        if (object.Key) {
          // Extract job ID from paths like "jobId/research.json" or "jobId/research-result.json"
          const parts = object.Key.split('/');
          if (parts.length >= 2 && (parts[1].endsWith('.json') || parts[1].endsWith('-result.json'))) {
            jobIds.add(parts[0]);
          }
        }
      }
    }

    const jobs: any[] = [];
    for (const jobId of jobIds) {
      const jobData = await getJobFromS3(jobId);
      if (jobData) {
        jobs.push(jobData);
      }
    }

    return jobs;
  } catch (error) {
    console.error('Error retrieving jobs from S3:', error);
    return [];
  }
}

export async function POST(request: NextRequest) {
  console.log('🚀 [API/JOBS] POST request received');
  
  // Rate limiting check
  const clientIP = getClientIP(request);
  console.log(`🔍 [API/JOBS] Client IP: ${clientIP}`);
  
  if (!checkRateLimit(clientIP)) {
    console.log(`❌ [API/JOBS] Rate limit exceeded for IP: ${clientIP}`);
    return NextResponse.json(
      { 
        error: 'Rate limit exceeded',
        message: 'Only 1 request per minute is allowed. Please try again later.',
        retryAfter: 60
      },
      { 
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': '1',
          'X-RateLimit-Window': '60'
        }
      }
    );
  }
  
  // Clean up old entries periodically (every 100 requests)
  if (Math.random() < 0.01) {
    cleanupRateLimitStore();
  }
  
  console.log('🔧 [API/JOBS] Environment check:');
  console.log(`   TASK_ROUTER_API_URL: ${TASK_ROUTER_API_URL}`);
  console.log(`   S3_BUCKET_NAME: ${S3_BUCKET_NAME}`);
  console.log(`   USE_LOCAL_AGENTS: ${USE_LOCAL_AGENTS}`);
  
  try {
    const body = await request.json();
    const jobSpec: JobSpec = body;
    
    console.log('📝 [API/JOBS] Request body:', JSON.stringify(jobSpec, null, 2));

    // Validate required fields
    if (!jobSpec.product || !jobSpec.audience) {
      console.log('❌ [API/JOBS] Validation failed: Missing required fields');
      return NextResponse.json(
        { error: 'Missing required fields: product and audience are required' },
        { status: 400 }
      );
    }

    // Generate unique job ID
    const jobId = uuidv4();
    console.log(`🆔 [API/JOBS] Generated job ID: ${jobId}`);

    // Mode selection: External task-router (since we removed local agents)
    console.log(`[EXTERNAL MODE] Using task-router for job ${jobId}`);
    
    try {
      // Store job specification in S3 if configured
      let payloadKey = '';
      if (S3_BUCKET_NAME) {
        console.log(`📦 [API/JOBS] Storing job spec in S3 bucket: ${S3_BUCKET_NAME}`);
        payloadKey = await storeJobSpecInS3(jobId, jobSpec);
        console.log(`📦 [API/JOBS] Job spec stored at: ${payloadKey}`);
      } else {
        console.log('⚠️ [API/JOBS] S3_BUCKET_NAME not configured, skipping S3 storage');
      }

      // Option 1: Direct API call to task-router (if available)
      if (TASK_ROUTER_API_URL) {
        console.log(`🌐 [API/JOBS] Calling task-router API: ${TASK_ROUTER_API_URL}/api/router/jobs`);
        await createJobInTaskRouter(jobId, jobSpec);
        console.log(`✅ [API/JOBS] Successfully created job in task-router`);
      } else {
        console.log('⚠️ [API/JOBS] TASK_ROUTER_API_URL not configured');
        throw new Error('Task router API URL not configured');
      }

      console.log(`🎉 [API/JOBS] Job ${jobId} created successfully`);
      return NextResponse.json({
        job_id: jobId,
        status: 'queued',
        message: 'Job created successfully and sent to task-router for processing',
        mode: 'external'
      }, { status: 201 });

    } catch (integrationError) {
      console.error('❌ [API/JOBS] Integration error:', integrationError);
      
      return NextResponse.json({
        error: 'Failed to queue job for external processing',
        job_id: jobId,
        details: process.env.NODE_ENV === 'development' ? String(integrationError) : undefined,
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ [API/JOBS] API error:', error);
    
    return NextResponse.json(
      { 
        error: 'Invalid request',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 400 }
    );
  }
}

export async function GET() {
  try {
    console.log('GET /api/jobs - Retrieving jobs from S3');
    
    // Get jobs from S3
    const s3Jobs = await getAllJobsFromS3();
    
    // Sort by creation date (newest first)
    s3Jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    return NextResponse.json({ 
      jobs: s3Jobs,
      total: s3Jobs.length,
      mode: 'external',
      storage: 'S3',
      note: 'Jobs and results retrieved from S3 storage'
    });
  } catch (error) {
    console.error('Error in jobs GET endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
} 