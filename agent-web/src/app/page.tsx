'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Heading,
  Input,
  Button,
  Grid,
  Card,
  CardBody,
  Text,
  VStack,
  HStack,
  Badge,
  useToast,
  Spinner,
  IconButton,
  useColorModeValue,
  Textarea,
  FormControl,
  FormLabel,
  SimpleGrid
} from '@chakra-ui/react';
import { SearchIcon, ViewIcon, StarIcon, CheckIcon, ArrowForwardIcon } from '@chakra-ui/icons';

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  agents: string[];
  progress: number;
}

export default function Home() {
  const [buildInput, setBuildInput] = useState('');
  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const toast = useToast();
  const router = useRouter();

  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const cardBg = useColorModeValue('white', 'gray.800');

  // Load existing tasks on component mount
  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      // First try to load from jobs API which has persistent storage
      const response = await fetch('/api/jobs');
      if (response.ok) {
        const jobsData = await response.json();
        // Convert jobs data to tasks format if needed
        if (jobsData.jobs) {
          setTasks(jobsData.jobs.map((job: any) => ({
            id: job.job_id || job.id,
            title: job.title || job.description?.slice(0, 50) + '...',
            description: job.description || job.product || 'Landing page project',
            status: job.status || 'pending',
            createdAt: job.createdAt || job.created_at || new Date().toISOString(),
            agents: ['researcher', 'product manager', 'drawer', 'designer', 'coder'],
            progress: job.progress || 0
          })));
        }
      } else {
        // Fallback to tasks API
        const tasksResponse = await fetch('/api/tasks');
        if (tasksResponse.ok) {
          const tasksData = await tasksResponse.json();
          setTasks(tasksData);
        }
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setIsLoadingTasks(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!buildInput.trim()) {
      toast({
        title: "Error",
        description: "Please describe your landing page requirements",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsLoading(true);

    try {
      // Use jobs API instead of tasks API for persistent storage
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          product: product || 'Landing Page Project',
          audience: audience || 'General audience',
          description: buildInput,
          tone: 'professional',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const newJob = await response.json();
      
      // Convert job to task format for display
      const newTask = {
        id: newJob.job_id,
        title: (product || buildInput.slice(0, 50)) + (buildInput.length > 50 ? '...' : ''),
        description: buildInput,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        agents: ['researcher', 'product manager', 'drawer', 'designer', 'coder'],
        progress: 0
      };
      
      toast({
        title: "Landing Page Task Created",
        description: "AI agents are now working on your landing page",
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      setBuildInput('');
      setProduct('');
      setAudience('');
      setTasks(prev => [newTask, ...prev]);
      
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to create landing page task',
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
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

  const handleTaskClick = (taskId: string) => {
    router.push(`/task/${taskId}`);
  };

  return (
    <Box bg={bgColor} minH="100vh" py={8}>
      <Container maxW="6xl">
        {/* Header */}
        <VStack spacing={6} mb={10}>
          <Box textAlign="center">
            <Heading 
              size="2xl" 
              bgGradient="linear(to-r, blue.400, purple.500)"
              bgClip="text"
              mb={4}
            >
              Multi-Agent Landing Page Generator
            </Heading>
            <Text fontSize="lg" color="gray.600" maxW="2xl" mx="auto">
              Create stunning landing pages with AI agents that research, write, and code for you
            </Text>
          </Box>

          {/* Features */}
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={8} w="full" maxW="3xl">
            <VStack spacing={2}>
              <CheckIcon color="green.500" boxSize={5} />
              <Text fontWeight="semibold" fontSize="sm">Research</Text>
            </VStack>
            <VStack spacing={2}>
              <StarIcon color="yellow.500" boxSize={5} />
              <Text fontWeight="semibold" fontSize="sm">Content</Text>
            </VStack>
            <VStack spacing={2}>
              <ArrowForwardIcon color="blue.500" boxSize={5} />
              <Text fontWeight="semibold" fontSize="sm">Code</Text>
            </VStack>
          </SimpleGrid>
        </VStack>

        {/* Input Form */}
        <Box bg={cardBg} p={6} borderRadius="xl" shadow="lg" mb={10}>
          <form onSubmit={handleSubmit}>
            <VStack spacing={4}>
              <Heading size="md" alignSelf="flex-start">
                Create Your Landing Page
              </Heading>
              
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} w="full">
                <FormControl>
                  <FormLabel fontSize="sm">Product/Service</FormLabel>
                  <Input
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    placeholder="Product name"
                    size="md"
                  />
                </FormControl>
                
                <FormControl>
                  <FormLabel fontSize="sm">Target Audience</FormLabel>
                  <Input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Target audience"
                    size="md"
                  />
                </FormControl>
              </SimpleGrid>

              <FormControl>
                <FormLabel fontSize="sm">Description</FormLabel>
                <Textarea
                  value={buildInput}
                  onChange={(e) => setBuildInput(e.target.value)}
                  placeholder="Describe your landing page requirements..."
                  size="md"
                  rows={4}
                  resize="vertical"
                />
              </FormControl>

              <Button
                type="submit"
                colorScheme="blue"
                size="lg"
                px={8}
                isLoading={isLoading}
                loadingText="Creating..."
                leftIcon={<SearchIcon />}
                alignSelf={{ base: "stretch", md: "flex-start" }}
              >
                Create Landing Page
              </Button>
            </VStack>
          </form>
        </Box>

        {/* Tasks Grid */}
        <VStack spacing={6} align="stretch">
          <HStack justify="space-between" align="center">
            <Heading size="lg">Your Projects</Heading>
            <Button variant="ghost" onClick={loadTasks} isLoading={isLoadingTasks} size="sm">
              Refresh
            </Button>
          </HStack>

          {isLoadingTasks ? (
            <Box textAlign="center" py={8}>
              <Spinner size="lg" />
              <Text mt={4} color="gray.600">Loading...</Text>
            </Box>
          ) : tasks.length === 0 ? (
            <Box textAlign="center" py={8}>
              <Text fontSize="md" color="gray.600">
                No projects yet
              </Text>
              <Text fontSize="sm" color="gray.500" mt={1}>
                Create your first landing page above
              </Text>
            </Box>
          ) : (
            <Grid 
              templateColumns={{
                base: "1fr",
                md: "repeat(2, 1fr)",
                lg: "repeat(3, 1fr)",
                xl: "repeat(4, 1fr)"
              }}
              gap={4}
            >
              {tasks.map((task) => (
                <Card 
                  key={task.id}
                  bg={cardBg}
                  shadow="md"
                  transition="all 0.2s"
                  _hover={{ 
                    shadow: "lg", 
                    transform: "translateY(-2px)",
                    cursor: "pointer"
                  }}
                  onClick={() => handleTaskClick(task.id)}
                >
                  <CardBody p={4}>
                    <VStack align="stretch" spacing={3}>
                      <HStack justify="space-between" align="flex-start">
                        <Text fontWeight="bold" fontSize="md" noOfLines={2}>
                          {task.title}
                        </Text>
                        <IconButton
                          aria-label="View"
                          icon={<ViewIcon />}
                          size="sm"
                          variant="ghost"
                        />
                      </HStack>
                      
                      <Text color="gray.600" fontSize="sm" noOfLines={2}>
                        {task.description}
                      </Text>
                      
                      <VStack spacing={2} align="stretch">
                        <HStack justify="space-between">
                          <Badge colorScheme={getStatusColor(task.status)} size="sm">
                            {task.status.replace('_', ' ').toUpperCase()}
                          </Badge>
                          <Text fontSize="xs" color="gray.500">
                            {task.progress}%
                          </Text>
                        </HStack>
                        
                        <Text fontSize="xs" color="gray.400">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </Text>
                      </VStack>
                    </VStack>
                  </CardBody>
                </Card>
              ))}
            </Grid>
          )}
        </VStack>
      </Container>
    </Box>
  );
}



