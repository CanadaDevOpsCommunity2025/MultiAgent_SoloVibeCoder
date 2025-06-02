import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Function to get the file path for a given job ID
// This should ideally be shared from a common utils file if used in multiple places
function getJobFilePath(jobId: string): string {
  const STORAGE_DIR = path.join(os.tmpdir(), 'ai-agents-storage');
  return path.join(STORAGE_DIR, `${jobId}.json`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> } // Fix for Next.js 15
) {
  try {
    const { jobId } = await params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required in the path' },
        { status: 400 }
      );
    }

    const filePath = getJobFilePath(jobId);

    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const result = JSON.parse(fileContent);
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(
        { error: 'Job results not found.', jobId },
        { status: 404 }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(`[API /jobs/results] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to retrieve job results.', details: message },
      { status: 500 }
    );
  }
} 