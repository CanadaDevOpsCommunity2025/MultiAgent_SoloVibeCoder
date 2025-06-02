'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Card,
  CardBody,
  CardHeader,
  Badge,
  Button,
  Collapse,
  useDisclosure,
  Progress,
  Spinner,
  useToast,
  IconButton,
  Divider,
  Code,
  useColorModeValue
} from '@chakra-ui/react';
import { 
  ChevronDownIcon, 
  ChevronUpIcon, 
  ArrowBackIcon,
  CheckCircleIcon,
  TimeIcon,
  WarningIcon,
  CopyIcon,
  ViewIcon
} from '@chakra-ui/icons';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface AgentResult {
  agent: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  startedAt?: string;
  completedAt?: string;
  output?: any;
  error?: string;
  logs?: string[];
}

interface TaskDetail {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  agents: AgentResult[];
  overallProgress: number;
}

interface AgentCardProps {
  agent: AgentResult;
  isExpanded: boolean;
  onToggle: () => void;
}

// Custom gradient progress bar component
const GradientProgress: React.FC<{ value: number; colorScheme: string; size?: string }> = ({ 
  value, 
  colorScheme, 
  size = 'sm' 
}) => {
  const getGradient = (scheme: string) => {
    switch (scheme) {
      case 'green':
        return 'linear-gradient(90deg, #38A169 0%, #68D391 50%, #9AE6B4 100%)';
      case 'blue':
        return 'linear-gradient(90deg, #3182CE 0%, #63B3ED 50%, #90CDF4 100%)';
      case 'red':
        return 'linear-gradient(90deg, #E53E3E 0%, #FC8181 50%, #FEB2B2 100%)';
      default:
        return 'linear-gradient(90deg, #718096 0%, #A0AEC0 50%, #CBD5E0 100%)';
    }
  };

  const height = size === 'lg' ? '12px' : size === 'md' ? '8px' : '6px';

  return (
    <Box
      width="100%"
      height={height}
      bg="gray.200"
      borderRadius="full"
      overflow="hidden"
      position="relative"
    >
      <Box
        height="100%"
        width={`${Math.min(Math.max(value, 0), 100)}%`}
        background={getGradient(colorScheme)}
        borderRadius="full"
        transition="width 0.3s ease-in-out"
        position="relative"
        _after={{
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
          animation: value > 0 && value < 100 ? 'shimmer 2s infinite' : 'none',
        }}
        sx={{
          '@keyframes shimmer': {
            '0%': { transform: 'translateX(-100%)' },
            '100%': { transform: 'translateX(100%)' }
          }
        }}
      />
    </Box>
  );
};

const AgentCard: React.FC<AgentCardProps> = ({ agent, isExpanded, onToggle }) => {
  const cardBg = useColorModeValue('white', 'gray.800');
  const toast = useToast();
  const router = useRouter();
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon color="green.500" />;
      case 'in_progress':
        return <Spinner size="sm" color="blue.500" />;
      case 'failed':
        return <WarningIcon color="red.500" />;
      default:
        return <TimeIcon color="gray.500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'green';
      case 'in_progress': return 'blue';
      case 'failed': return 'red';
      default: return 'gray';
    }
  };

  // Function to copy JSX code to clipboard
  const copyCodeToClipboard = async () => {
    try {
      let jsxCode = '';
      
      if (agent.output) {
        // Check for the specific codeFiles structure that the coder agent returns
        if (agent.output.codeFiles && Array.isArray(agent.output.codeFiles)) {
          // Get the first code file (codeFiles[0].code)
          const firstCodeFile = agent.output.codeFiles[0];
          
          if (firstCodeFile && firstCodeFile.code) {
            jsxCode = firstCodeFile.code;
          }
        }
        // Fallback: try other common structures
        else if (typeof agent.output === 'string') {
          jsxCode = agent.output;
        } else if (agent.output.code) {
          jsxCode = agent.output.code;
        } else if (agent.output.jsx || agent.output.reactCode) {
          jsxCode = agent.output.jsx || agent.output.reactCode;
        }
      }

      if (!jsxCode || jsxCode.trim().length === 0) {
        toast({
          title: "No JSX Code Found",
          description: "No React/JSX code available to copy",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(jsxCode);
      } else {
        // Fallback for older browsers or non-HTTPS environments
        const textArea = document.createElement('textarea');
        textArea.value = jsxCode;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (!successful) {
            throw new Error('execCommand failed');
          }
        } finally {
          document.body.removeChild(textArea);
        }
      }

      toast({
        title: "JSX Code Copied!",
        description: "React component code has been copied to clipboard",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error('Failed to copy JSX code:', error);
      toast({
        title: "Copy Failed",
        description: "Failed to copy JSX code to clipboard. You may need to manually select and copy the code.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Function to open preview page with JSX code
  const openPreview = () => {
    try {
      // Get the current task ID from URL params
      const taskId = window.location.pathname.split('/').pop();
      
      if (!taskId) {
        toast({
          title: "Preview Failed",
          description: "Unable to determine task ID for preview",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      // Check if we have coder output before navigating
      if (!agent.output || !agent.output.codeFiles || !agent.output.codeFiles[0]?.code) {
        toast({
          title: "No JSX Code Found",
          description: "No React/JSX code available for preview",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      console.log(`[TASK-DETAIL] Opening preview for task: ${taskId}`);
      
      // Open preview in new tab
      window.open(`/preview?taskId=${taskId}`, '_blank');
    } catch (error) {
      console.error('Failed to open preview:', error);
      toast({
        title: "Preview Failed",
        description: "Failed to open JSX code preview",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Card bg={cardBg} shadow="md">
      <CardHeader pb={2}>
        <HStack justify="space-between" align="center">
          <HStack spacing={3}>
            {getStatusIcon(agent.status)}
            <VStack align="start" spacing={0}>
              <Heading size="md" textTransform="capitalize">
                {agent.agent} Agent
              </Heading>
              <HStack spacing={2}>
                <Badge colorScheme={getStatusColor(agent.status)}>
                  {agent.status.replace('_', ' ').toUpperCase()}
                </Badge>
                <Text fontSize="sm" color="gray.500">
                  {agent.progress}% complete
                </Text>
              </HStack>
            </VStack>
          </HStack>
          <HStack spacing={2}>
            {/* Show copy button and preview button for coder agent when there's output */}
            {agent.agent === 'coder' && agent.output && (
              <>
                <IconButton
                  aria-label="Copy Generated Code"
                  icon={<CopyIcon />}
                  variant="outline"
                  colorScheme="blue"
                  size="sm"
                  onClick={copyCodeToClipboard}
                  title="Copy generated code to clipboard"
                />
                <IconButton
                  aria-label="Preview Generated Code"
                  icon={<ViewIcon />}
                  variant="outline"
                  colorScheme="green"
                  size="sm"
                  onClick={openPreview}
                  title="Open live preview of generated code"
                />
              </>
            )}
            <IconButton
              aria-label={isExpanded ? "Collapse" : "Expand"}
              icon={isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              variant="ghost"
              onClick={onToggle}
            />
          </HStack>
        </HStack>
        
        <Box mt={3}>
          <GradientProgress 
            value={agent.progress} 
            colorScheme={getStatusColor(agent.status)}
            size="sm"
          />
        </Box>
      </CardHeader>

      <Collapse in={isExpanded}>
        <CardBody pt={0}>
          <VStack align="stretch" spacing={4}>
            {/* Timing Information */}
            <Box>
              <Heading size="sm" mb={2}>Timeline</Heading>
              <VStack align="start" spacing={1} fontSize="sm" color="gray.600">
                {agent.startedAt && (
                  <Text>Started: {new Date(agent.startedAt).toLocaleString()}</Text>
                )}
                {agent.completedAt && (
                  <Text>Completed: {new Date(agent.completedAt).toLocaleString()}</Text>
                )}
                {agent.startedAt && agent.completedAt && (
                  <Text>
                    Duration: {Math.round((new Date(agent.completedAt).getTime() - new Date(agent.startedAt).getTime()) / 1000)}s
                  </Text>
                )}
              </VStack>
            </Box>

            <Divider />

            {/* Error Display */}
            {agent.error && (
              <Box>
                <Heading size="sm" mb={2} color="red.500">Error</Heading>
                <Code colorScheme="red" p={3} fontSize="sm" whiteSpace="pre-wrap">
                  {agent.error}
                </Code>
              </Box>
            )}

            {/* Logs Display */}
            {agent.logs && agent.logs.length > 0 && (
              <Box>
                <Heading size="sm" mb={2}>Logs</Heading>
                <VStack align="stretch" spacing={1} maxH="200px" overflowY="auto">
                  {agent.logs.map((log, index) => (
                    <Text key={index} fontSize="sm" fontFamily="mono" color="gray.600">
                      {log}
                    </Text>
                  ))}
                </VStack>
              </Box>
            )}

            {/* Output Display */}
            {agent.output && (
              <Box>
                <HStack justify="space-between" align="center" mb={2}>
                  <Heading size="sm">
                    {agent.agent === 'coder' ? 'Generated Code' : 'Output'}
                  </Heading>
                  {/* Additional copy button and preview button in the output section for coder */}
                  {agent.agent === 'coder' && (
                    <HStack spacing={2}>
                      <Button
                        leftIcon={<CopyIcon />}
                        size="sm"
                        variant="outline"
                        colorScheme="blue"
                        onClick={copyCodeToClipboard}
                      >
                        Copy Code
                      </Button>
                      <Button
                        leftIcon={<ViewIcon />}
                        size="sm"
                        variant="solid"
                        colorScheme="green"
                        onClick={openPreview}
                      >
                        Preview
                      </Button>
                    </HStack>
                  )}
                </HStack>
                <Box 
                  maxH="400px" 
                  overflowY="auto" 
                  bg="gray.900" 
                  p={4} 
                  borderRadius="md"
                  border="1px solid"
                  borderColor="gray.700"
                >
                  {agent.agent === 'coder' && agent.output.codeFiles && Array.isArray(agent.output.codeFiles) && agent.output.codeFiles[0]?.code ? (
                    <SyntaxHighlighter
                      language="jsx"
                      style={vscDarkPlus}
                      customStyle={{
                        backgroundColor: 'transparent',
                        margin: 0,
                        padding: 0,
                        fontSize: '14px',
                        lineHeight: '1.5',
                      }}
                      wrapLines={true}
                      wrapLongLines={true}
                    >
                      {agent.output.codeFiles[0].code}
                    </SyntaxHighlighter>
                  ) : typeof agent.output === 'string' ? (
                    <Text fontSize="sm" whiteSpace="pre-wrap" color="white" fontFamily="mono">
                      {agent.output}
                    </Text>
                  ) : (
                    <SyntaxHighlighter
                      language="json"
                      style={vscDarkPlus}
                      customStyle={{
                        backgroundColor: 'transparent',
                        padding: 0,
                        margin: 0,
                        borderRadius: 0,
                        border: 'none',
                      }}
                    >
                      {JSON.stringify(agent.output, null, 2)}
                    </SyntaxHighlighter>
                  )}
                </Box>
              </Box>
            )}
          </VStack>
        </CardBody>
      </Collapse>
    </Card>
  );
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const bgColor = useColorModeValue('gray.50', 'gray.900');

  useEffect(() => {
    if (params?.id) {
      loadTaskDetail(params.id as string);
      
      // Poll for updates every 5 seconds if task is not completed
      const interval = setInterval(() => {
        if (task && task.status !== 'completed' && task.status !== 'failed') {
          loadTaskDetail(params.id as string);
        }
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [params?.id, task?.status]);

  const loadTaskDetail = async (taskId: string) => {
    try {
      console.log(`[TaskPage] Loading task detail for ID: ${taskId}`);
      
      // Try jobs API first since that's where persistent data is stored
      const response = await fetch(`/api/jobs/${taskId}`);
      if (response.ok) {
        const jobData = await response.json();
        console.log(`[TaskPage] Received job data:`, jobData);
        
        // Check if the response contains an error
        if (jobData.error) {
          throw new Error(jobData.error);
        }
        
        // Convert job data to task detail format
        const taskDetail: TaskDetail = {
          id: jobData.job_id || taskId,
          title: jobData.title || jobData.description?.slice(0, 50) + '...' || 'Landing Page Project',
          description: jobData.description || jobData.product || 'AI-generated landing page',
          status: jobData.status || 'pending',
          createdAt: jobData.created_at || jobData.last_updated || new Date().toISOString(),
          updatedAt: jobData.last_updated || jobData.created_at || new Date().toISOString(),
          overallProgress: calculateProgress(jobData),
          agents: mapJobToAgents(jobData)
        };
        
        console.log(`[TaskPage] Converted to task detail:`, taskDetail);
        setTask(taskDetail);
      } else {
        // Handle HTTP error responses
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading task detail:', error);
      
      // Only show toast if this is a new error (not during polling)
      if (loading) {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to load task details",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Helper function to calculate overall progress from job data
  const calculateProgress = (jobData: any): number => {
    if (!jobData || !jobData.results) return 0;
    
    const totalAgents = 5; // researcher, product manager, drawer, designer, coder
    const expectedResultKeys = ['research', 'product_manager', 'drawer', 'designer', 'coder'];
    const completedAgents = expectedResultKeys.filter(key => 
      jobData.results[key] && typeof jobData.results[key] === 'object'
    ).length;
    
    return Math.round((completedAgents / totalAgents) * 100);
  };

  // Helper function to map job data to agent results
  const mapJobToAgents = (jobData: any): AgentResult[] => {
    const agentNames = ['researcher', 'product manager', 'drawer', 'designer', 'coder'];
    const results = jobData?.results || {};
    
    // Map UI agent names to stored result keys
    const agentToResultKey: Record<string, string> = {
      'researcher': 'research',
      'product manager': 'product_manager',
      'drawer': 'drawer',
      'designer': 'designer',
      'coder': 'coder'
    };

    return agentNames.map((agentName, index) => {
      const resultKey = agentToResultKey[agentName];
      const hasResult = results[resultKey] && typeof results[resultKey] === 'object';
      
      // Determine status based on actual stored data and job state
      let status: 'pending' | 'in_progress' | 'completed' | 'failed' = 'pending';
      let targetProgress = 0;
      
      if (hasResult) {
        status = 'completed';
        targetProgress = 100;
      } else if (jobData?.status === 'failed') {
        status = 'failed';
        targetProgress = 0;
      } else if (jobData?.status === 'in_progress' || jobData?.status === 'pending') {
        // Check if this agent should be in progress
        const agentIndex = agentNames.indexOf(agentName);
        const previousAgentsCompleted = agentNames.slice(0, agentIndex).every(prevAgent => 
          results[agentToResultKey[prevAgent]]
        );
        
        if (agentIndex === 0 && !hasResult) {
          // Researcher should be in progress if job is active and no result yet
          status = 'in_progress';
          targetProgress = 75; // Show researcher as actively working
        } else if (previousAgentsCompleted && !hasResult) {
          status = 'in_progress';
          targetProgress = 75; // Show as actively working
        }
      }

      return {
        agent: agentName,
        status,
        progress: targetProgress,
        startedAt: hasResult ? jobData?.created_at : undefined,
        completedAt: hasResult ? jobData?.last_updated : undefined,
        output: hasResult ? results[resultKey] : undefined,
        error: jobData?.status === 'failed' ? 'Agent execution failed' : undefined,
        logs: []
      };
    });
  };

  const toggleAgentExpansion = (agentName: string) => {
    setExpandedAgents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(agentName)) {
        newSet.delete(agentName);
      } else {
        newSet.add(agentName);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    if (task) {
      setExpandedAgents(new Set(task.agents.map(agent => agent.agent)));
    }
  };

  const collapseAll = () => {
    setExpandedAgents(new Set());
  };

  if (loading) {
    return (
      <Box bg={bgColor} minH="100vh" py={8}>
        <Container maxW="7xl">
          <VStack spacing={8} align="center" justify="center" minH="60vh">
            <Spinner size="xl" />
            <Text>Loading task details...</Text>
          </VStack>
        </Container>
      </Box>
    );
  }

  if (!task) {
    return (
      <Box bg={bgColor} minH="100vh" py={8}>
        <Container maxW="7xl">
          <VStack spacing={8} align="center" justify="center" minH="60vh">
            <Text fontSize="xl">Task not found</Text>
            <Button leftIcon={<ArrowBackIcon />} onClick={() => router.push('/')}>
              Back to Tasks
            </Button>
          </VStack>
        </Container>
      </Box>
    );
  }

  const getOverallStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'green';
      case 'in_progress': return 'blue';
      case 'failed': return 'red';
      default: return 'gray';
    }
  };

  return (
    <Box bg={bgColor} minH="100vh" py={8}>
      <Container maxW="7xl">
        <VStack spacing={8} align="stretch">
          {/* Header */}
          <HStack justify="space-between" align="start">
            <VStack align="start" spacing={2}>
              <Button 
                leftIcon={<ArrowBackIcon />} 
                variant="ghost" 
                onClick={() => router.push('/')}
                alignSelf="flex-start"
              >
                Back to Tasks
              </Button>
              <Heading size="xl">{task.title}</Heading>
              <Text color="gray.600" fontSize="lg">
                {task.description}
              </Text>
              <HStack spacing={4}>
                <Badge colorScheme={getOverallStatusColor(task.status)} fontSize="md" px={3} py={1}>
                  {task.status.replace('_', ' ').toUpperCase()}
                </Badge>
                <Text fontSize="sm" color="gray.500">
                  Created: {new Date(task.createdAt).toLocaleDateString()}
                </Text>
                <Text fontSize="sm" color="gray.500">
                  Updated: {new Date(task.updatedAt).toLocaleDateString()}
                </Text>
              </HStack>
            </VStack>
          </HStack>

          {/* Overall Progress */}
          <Box bg="white" p={6} borderRadius="xl" shadow="sm">
            <VStack align="stretch" spacing={4}>
              <HStack justify="space-between">
                <Heading size="md">Overall Progress</Heading>
                <Text fontSize="lg" fontWeight="bold">
                  {task.overallProgress}%
                </Text>
              </HStack>
              <GradientProgress 
                value={task.overallProgress} 
                colorScheme={getOverallStatusColor(task.status)}
                size="lg"
              />
            </VStack>
          </Box>

          {/* Agent Controls */}
          <HStack justify="space-between" align="center">
            <Heading size="lg">Agent Progress</Heading>
            <HStack spacing={2}>
              <Button size="sm" variant="outline" onClick={expandAll}>
                Expand All
              </Button>
              <Button size="sm" variant="outline" onClick={collapseAll}>
                Collapse All
              </Button>
            </HStack>
          </HStack>

          {/* Agent Cards */}
          <VStack spacing={4} align="stretch">
            {task.agents.map((agent) => (
              <AgentCard
                key={agent.agent}
                agent={agent}
                isExpanded={expandedAgents.has(agent.agent)}
                onToggle={() => toggleAgentExpansion(agent.agent)}
              />
            ))}
          </VStack>
        </VStack>
      </Container>
    </Box>
  );
} 