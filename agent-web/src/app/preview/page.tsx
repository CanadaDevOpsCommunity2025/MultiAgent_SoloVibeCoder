'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LiveProvider, LiveEditor, LivePreview, LiveError } from 'react-live';
import * as Chakra from "@chakra-ui/react";
import * as Icons from "@chakra-ui/icons";
import { motion } from "framer-motion";
import {
  Box,
  VStack,
  Spinner,
  Text,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
} from '@chakra-ui/react';

// Error Boundary Component
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

class PreviewErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Preview Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Alert status="warning" borderRadius="md" m={4}>
          <AlertIcon />
          <Box>
            <AlertTitle>Rendering Error</AlertTitle>
            <AlertDescription>
              There was an error rendering the preview. This might be due to undefined components or icons.
              <br />
              <Text fontSize="sm" mt={2} fontFamily="mono" color="red.600">
                {this.state.error?.message}
              </Text>
            </AlertDescription>
          </Box>
        </Alert>
      );
    }

    return this.props.children;
  }
}

function PreviewContent() {
  const searchParams = useSearchParams();
  const [jsxCode, setJsxCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const taskIdParam = searchParams.get('taskId');
    
    if (taskIdParam) {
      fetchCodeFromTask(taskIdParam);
    } else {
      setError('No task ID provided. Please navigate to preview from a task detail page.');
      setLoading(false);
    }
  }, [searchParams]);

  const fetchCodeFromTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/jobs/${taskId}`);
      if (response.ok) {
        const jobData = await response.json();
        
        if (jobData.error) {
          throw new Error(jobData.error);
        }
        
        if (jobData.results?.coder?.codeFiles?.[0]?.code) {
          const jsxCode = jobData.results.coder.codeFiles[0].code;
          console.log(jsxCode);
          setJsxCode(jsxCode);
        } else if (jobData.results?.coder?.code) {
          setJsxCode(jobData.results.coder.code);
        } else {
          setError('No JSX code found in task results. The coder agent may not have completed yet.');
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.error('[PREVIEW] Error fetching task data from S3:', err);
      setError('Failed to load JSX code from S3. Please check if the task has completed successfully.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="gray.50">
        <VStack spacing={4}>
          <Spinner size="xl" color="blue.500" />
          <Text fontSize="lg">Loading preview...</Text>
        </VStack>
      </Box>
    );
  }

  if (error || !jsxCode) {
    return (
      <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="gray.50">
        <Alert status="error" borderRadius="md" maxW="500px">
          <AlertIcon />
          <Box>
            <AlertTitle>Preview Error</AlertTitle>
            <AlertDescription>
              {error || 'No JSX code available for preview'}
            </AlertDescription>
          </Box>
        </Alert>
      </Box>
    );
  }

  return (
    <Box minH="100vh" w="100vw">
      <LiveProvider
        code={jsxCode}
        noInline={true}
        transformCode={(code) => {
          console.log("Original code:", code);
          
          // Strip "use client" directive
          let stripped = code.replace(/^\s*["']use client["'];?\s*$/gm, "");
          
          // Remove all import statements more comprehensively
          stripped = stripped.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "");
          stripped = stripped.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, "");
          
          // Remove CommonJS exports that cause "exports is not defined" error
          stripped = stripped.replace(/^\s*exports\..+ = .+;?\s*$/gm, "");
          stripped = stripped.replace(/^\s*module\.exports\s*=.+$/gm, "");
          
          // Remove any remaining exports references
          stripped = stripped.replace(/\bexports\./g, "");
          stripped = stripped.replace(/\bmodule\.exports\b/g, "");
          
          // Convert export default function to regular function (handle both patterns)
          stripped = stripped.replace(/export\s+default\s+function\s+(\w+)/g, "function $1");
          stripped = stripped.replace(/export\s+default\s+function\s*\(/g, "function Component(");
          
          // Remove any other export statements
          stripped = stripped.replace(/^\s*export\s+/gm, "");
          
          // Clean up any require statements that might cause issues
          stripped = stripped.replace(/^\s*const .+ = require\(.+\);\s*$/gm, "");
          stripped = stripped.replace(/^\s*require\(.+\);\s*$/gm, "");
          
          // Remove any variable declarations that might use external URLs or cause issues
          // But preserve the actual variable assignments
          
          // Clean up any trailing whitespace or empty lines
          stripped = stripped.replace(/^\s*[\r\n]/gm, '\n').trim();
          
          // Find the main component function name
          const functionMatch = stripped.match(/function\s+(\w+)/);
          const componentName = functionMatch ? functionMatch[1] : "Component";
          
          console.log("Transformed code:", stripped);
          console.log("Component name:", componentName);
          
          // Append render call
          const finalCode = `
${stripped}

render(<${componentName} />);
          `.trim();
          
          console.log("Final code:", finalCode);
          return finalCode;
        }}
        scope={{
          React,
          motion,
          ...Chakra,
          ...Icons,
        }}
      >
        <Box h="100vh" w="100%" display="flex" flexDirection="column">
          <Box flex="1" overflow="auto">
            <PreviewErrorBoundary>
              <LivePreview />
            </PreviewErrorBoundary>
          </Box>
          <LiveError style={{ 
            color: "red", 
            background: "rgba(255,255,255,0.9)", 
            padding: "8px",
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000
          }} />
        </Box>
      </LiveProvider>
    </Box>
  );
}

export default function PreviewPage() {
  return (
    <Suspense fallback={
      <Box minH="100vh" display="flex" alignItems="center" justifyContent="center">
        <VStack spacing={4}>
          <Spinner size="xl" color="blue.500" />
          <Text>Loading preview...</Text>
        </VStack>
      </Box>
    }>
      <PreviewContent />
    </Suspense>
  );
}
