import { NextRequest, NextResponse } from 'next/server';

interface ProjectStructure {
  description: string;
  mainFiles: string[];
}

interface CodeData {
  filename: string;
  code: string;
  description: string;
  projectStructure: ProjectStructure;
  metadata: {
    technology: string;
    jobId: string;
    timestamp: string;
  };
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

    console.log(`[API] GET /api/jobs/${jobId}/code - Starting request`);

    // External mode - try to fetch from S3 (fallback behavior)
    // This would contain the original S3 fetching logic if needed
    console.log(`[EXTERNAL MODE] S3 fetching not implemented in this local-first version`);
    return NextResponse.json(
      { error: 'External mode not implemented. Please use local mode.' },
      { status: 501 }
    );

  } catch (error) {
    console.error('Error in code API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 