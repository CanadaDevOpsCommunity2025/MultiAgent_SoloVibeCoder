import OpenAI from 'openai';
import { createAgentLogger } from './logger';
import { createS3Helper } from './aws';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CodingResult {
  projectStructure: {
    description: string;
    mainFiles: string[];
    dependencies: Record<string, string>;
  };
  codeFiles: Array<{
    filename: string;
    description: string;
    code: string;
  }>;
  configuration: Array<{
    filename: string;
    description: string;
    code: string;
  }>;
  documentation: {
    readme: string;
    deployment: string;
    development: string;
  };
}

interface CodingPayload {
  product?: string;
  audience?: string;
  description?: string;
  researchData?: any;
  contentData?: any;
  productManagerData?: any;
  designerData?: any;
  job_id?: string;
  taskId?: string;
}

/**
 * Generates a single-file Next.js landing page using GPT.
 * Incorporates optional researchData, productManagerData, and designerData into the system prompt.
 */
export async function runCodingAgent(payload: CodingPayload): Promise<CodingResult> {
  const logger = createAgentLogger('coder');
  const s3Helper = createS3Helper();

  try {
    logger.info({ payload }, 'Starting coding task');

    // Check if we have research data to incorporate
    let researchData = null;
    const jobId = payload.job_id || payload.taskId;
    if (jobId) {
      try {
        const researchKey = `${jobId}/research-result.json`;
        const researchResult = await s3Helper.getJsonObject(researchKey);
        researchData = researchResult;
        logger.debug({ researchKey }, 'Retrieved research data for coding context');
      } catch (error) {
        logger.debug('No research data found, proceeding without research context');
      }
    }

    // Check if we have product manager data to incorporate
    let productManagerData = null;
    if (jobId) {
      try {
        const contentKey = `${jobId}/product_manager-result.json`;
        const contentResult = await s3Helper.getJsonObject(contentKey);
        productManagerData = contentResult;
        logger.debug({ contentKey }, 'Retrieved product manager data for coding context');
      } catch (error) {
        logger.debug('No product manager data found, proceeding without product manager context');
      }
    }

    // Check if we have designer data to incorporate
    let designerData = null;
    if (jobId) {
      try {
        const designerKey = `${jobId}/designer-result.json`;
        const designerResult = await s3Helper.getJsonObject(designerKey);
        designerData = designerResult;
        logger.info({ designerKey }, 'Retrieved designer data for coding context');
      } catch (error) {
        logger.debug('No designer data found, proceeding without designer context');
      }
    }

    // Helper function to extract background images from designer JSON
    const extractBackgroundImages = (designData: any): Record<string, string> => {
      const bgImages: Record<string, string> = {};
      
      if (!designData?.page?.components) return bgImages;

      const processComponent = (component: any, name: string) => {
        if (component?.props?.backgroundImage) {
          // Extract URL from CSS url() format
          const match = component.props.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
          if (match && match[1]) {
            bgImages[name] = match[1];
            logger.info({ name, url: match[1].substring(0, 50) + '...' }, 'Found background image in designer data');
          }
        }
        
        // Check children recursively
        if (component?.children && Array.isArray(component.children)) {
          component.children.forEach((child: any, index: number) => {
            processComponent(child, `${name}_child_${index}`);
          });
        }
      };

      // Process all main components
      Object.entries(designData.page.components).forEach(([key, component]: [string, any]) => {
        processComponent(component, key);
      });

      return bgImages;
    };

    // Extract background images if designer data is available
    const backgroundImages = designerData ? extractBackgroundImages(designerData) : {};
    
    // Extract product name from available data sources (prioritize designer > product manager > payload)
    const extractProductName = (): string => {
      // First try designer data (most recent in pipeline)
      if (designerData?.page?.components?.header?.children) {
        const headerChildren = designerData.page.components.header.children;
        for (const child of headerChildren) {
          if (child?.props?.children && typeof child.props.children === 'string') {
            return child.props.children;
          }
        }
      }
      
      // Try brand identity from designer data
      if (designerData?.brandIdentity?.brandName) {
        return designerData.brandIdentity.brandName;
      }
      
      // Try brand identity from product manager data
      if (productManagerData?.brandIdentity?.brandName) {
        return productManagerData.brandIdentity.brandName;
      }
      
      // Try hero headline from product manager content strategy
      if (productManagerData?.contentStrategy?.hero?.headline) {
        return productManagerData.contentStrategy.hero.headline;
      }
      
      // Fall back to payload or default
      return payload.product || 'Your Product';
    };

    const extractAudience = (): string => {
      // Try product manager audience analysis
      if (productManagerData?.audienceProfile?.demographics) {
        return productManagerData.audienceProfile.demographics;
      }
      
      // Fall back to payload or default
      return payload.audience || 'General audience';
    };

    const extractDescription = (): string => {
      // Try primary value proposition from product manager
      if (productManagerData?.valueProposition?.primary) {
        return productManagerData.valueProposition.primary;
      }
      
      // Try hero body text from product manager
      if (productManagerData?.contentStrategy?.hero?.bodyText) {
        return productManagerData.contentStrategy.hero.bodyText;
      }
      
      // Fall back to payload or default
      return payload.description || 'A modern landing page';
    };

    const productName = extractProductName();
    const audienceName = extractAudience();
    const productDescription = extractDescription();

    if (Object.keys(backgroundImages).length > 0) {
      logger.info({ backgroundImages: Object.keys(backgroundImages) }, 'Extracted background images from designer data');
    }
    
    logger.info({ 
      productName, 
      audienceName, 
      productDescription: productDescription.substring(0, 100) + '...',
      hasDesignerData: !!designerData,
      hasProductManagerData: !!productManagerData
    }, 'Extracted product information from agent data')

    // Post-processing function to force correct imports and handle background images
    const forceCorrectImports = (generatedCode: string) => {
      const requiredChakraImports = [
        // Layout Components
        'Box', 'Container', 'Flex', 'Grid', 'GridItem', 'SimpleGrid', 'Stack', 'VStack', 'HStack',
        'Center', 'Square', 'Circle', 'Spacer', 'Wrap', 'WrapItem',
        
        // Typography
        'Heading', 'Text', 'Link', 'Code', 'Kbd',
        
        // Form Components
        'Button', 'IconButton', 'Input', 'InputGroup', 'InputLeftElement', 'InputRightElement',
        'Textarea', 'Select', 'Checkbox', 'Radio', 'RadioGroup', 'Switch', 'FormControl',
        'FormLabel', 'FormErrorMessage', 'FormHelperText',
        
        // Data Display
        'Image', 'Avatar', 'AvatarGroup', 'Badge', 'Tag', 'TagLabel', 'TagCloseButton',
        'Card', 'CardBody', 'CardHeader', 'CardFooter', 'List', 'ListItem', 'ListIcon',
        'OrderedList', 'UnorderedList', 'Table', 'Thead', 'Tbody', 'Tr', 'Th', 'Td',
        'TableContainer', 'Stat', 'StatLabel', 'StatNumber', 'StatHelpText', 'StatArrow',
        
        // Feedback
        'Alert', 'AlertIcon', 'AlertTitle', 'AlertDescription', 'Progress', 'CircularProgress',
        'CircularProgressLabel', 'Skeleton', 'SkeletonText', 'SkeletonCircle', 'Spinner',
        'Toast', 'useToast',
        
        // Overlay
        'Modal', 'ModalOverlay', 'ModalContent', 'ModalHeader', 'ModalFooter', 'ModalBody',
        'ModalCloseButton', 'Drawer', 'DrawerOverlay', 'DrawerContent', 'DrawerCloseButton',
        'DrawerHeader', 'DrawerBody', 'DrawerFooter', 'Popover', 'PopoverTrigger',
        'PopoverContent', 'PopoverHeader', 'PopoverBody', 'PopoverFooter', 'PopoverArrow',
        'PopoverCloseButton', 'Tooltip',
        
        // Disclosure
        'Accordion', 'AccordionItem', 'AccordionButton', 'AccordionPanel', 'AccordionIcon',
        'Tabs', 'TabList', 'TabPanels', 'Tab', 'TabPanel', 'Collapse', 'useDisclosure',
        
        // Navigation
        'Breadcrumb', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbSeparator',
        
        // Media
        'AspectRatio',
        
        // Others
        'Divider', 'CloseButton', 'Portal', 'Show', 'Hide', 'useMediaQuery', 'useBreakpointValue'
      ];

      const requiredIcons = [
        // Basic Icons (CONFIRMED TO EXIST)
        'CheckIcon', 'CloseIcon', 'AddIcon', 'MinusIcon', 'EditIcon', 'DeleteIcon',
        
        // Navigation Icons (CONFIRMED TO EXIST)
        'ArrowBackIcon', 'ArrowForwardIcon', 'ArrowUpIcon', 'ArrowDownIcon', 
        'ArrowLeftIcon', 'ArrowRightIcon', 'ChevronUpIcon', 'ChevronDownIcon',
        'ChevronLeftIcon', 'ChevronRightIcon', 'ExternalLinkIcon',
        
        // Communication Icons (CONFIRMED TO EXIST)
        'EmailIcon', 'PhoneIcon', 'AtSignIcon',
        
        // UI Icons (CONFIRMED TO EXIST)
        'SearchIcon', 'SettingsIcon', 'InfoIcon', 'WarningIcon',
        'StarIcon', 'TimeIcon', 'CalendarIcon', 'LockIcon',
        
        // Status Icons (CONFIRMED TO EXIST)
        'CheckCircleIcon', 'WarningTwoIcon', 'SmallAddIcon', 'SmallCloseIcon',
        
        // Menu & Controls (CONFIRMED TO EXIST)
        'HamburgerIcon', 'TriangleDownIcon', 'TriangleUpIcon'
      ];

      // Helper function to replace invalid icons with default icon
      const replaceInvalidIcons = (code: string): string => {
        const defaultIcon = 'CheckIcon'; // Safe default icon
        let processedCode = code;
        
        // Find all icon usage patterns
        const iconPatterns = [
          // Pattern: Icon as={SomeIcon}
          /Icon\s+as=\{(\w+Icon)\}/g,
          // Pattern: <SomeIcon>
          /<(\w+Icon)[\s>]/g,
          // Pattern: rightIcon={<SomeIcon />}
          /rightIcon=\{<(\w+Icon)\s*\/>/g,
          // Pattern: leftIcon={<SomeIcon />}
          /leftIcon=\{<(\w+Icon)\s*\/>/g,
        ];
        
        iconPatterns.forEach(pattern => {
          processedCode = processedCode.replace(pattern, (match, iconName) => {
            if (!requiredIcons.includes(iconName)) {
              logger.warn({ invalidIcon: iconName, defaultIcon }, 'Replacing invalid icon with default');
              return match.replace(iconName, defaultIcon);
            }
            return match;
          });
        });
        
        // Also clean up any invalid icon imports from the import statement
        const importPattern = /from\s+['"]@chakra-ui\/icons['"];?/;
        if (importPattern.test(processedCode)) {
          // Extract the import section and clean it
          const importMatch = processedCode.match(/import\s+\{([^}]+)\}\s+from\s+['"]@chakra-ui\/icons['"];?/);
          if (importMatch) {
            const importedIcons = importMatch[1]
              .split(',')
              .map(icon => icon.trim())
              .filter(icon => {
                const isValid = requiredIcons.includes(icon);
                if (!isValid && icon) {
                  logger.warn({ invalidImportIcon: icon }, 'Removing invalid icon from imports');
                }
                return isValid;
              });
            
            // Ensure default icon is included if we're replacing any
            if (!importedIcons.includes(defaultIcon)) {
              importedIcons.push(defaultIcon);
            }
            
            const newImportStatement = `import { 
  ${importedIcons.join(',\n  ')}
} from '@chakra-ui/icons';`;
            
            processedCode = processedCode.replace(importMatch[0], newImportStatement);
          }
        }
        
        return processedCode;
      };

      // Generate background image variables from extracted URLs
      let bgImageVariables = '';
      if (Object.keys(backgroundImages).length > 0) {
        bgImageVariables = Object.entries(backgroundImages)
          .map(([name, url]) => `const ${name}BackgroundImage = "${url}";`)
          .join('\n');
        bgImageVariables = '\n// Background image URLs extracted from designer data\n' + bgImageVariables + '\n';
      }

      // Check if motion components are already defined in the generated code
      const hasExistingMotionComponents = /const Motion\w+\s*=\s*motion\(/m.test(generatedCode);
      
      // Only add motion component definitions if they don't already exist
      let motionComponents = '';
      if (!hasExistingMotionComponents) {
        motionComponents = `

// Motion-wrapped Chakra UI components for animations
const MotionBox = motion(Box);
const MotionFlex = motion(Flex);
const MotionVStack = motion(VStack);
const MotionHStack = motion(HStack);
const MotionContainer = motion(Container);
const MotionHeading = motion(Heading);
const MotionText = motion(Text);
const MotionButton = motion(Button);
const MotionCard = motion(Card);
const MotionImage = motion(Image);
const MotionStack = motion(Stack);
const MotionGrid = motion(Grid);
const MotionSimpleGrid = motion(SimpleGrid);`;
      }

      // Force correct imports regardless of LLM output
      const correctImports = `"use client"

import { 
  ${requiredChakraImports.join(',\n  ')}
} from '@chakra-ui/react';
import { 
  ${requiredIcons.join(',\n  ')}
} from '@chakra-ui/icons';
import { motion } from 'framer-motion';${bgImageVariables}${motionComponents}`;

      // Replace the imports section (everything before the first export/const/function)
      const afterImports = generatedCode.replace(/^"use client"[\s\S]*?(?=\n\n\/\/|const |export|function)/m, '');
      
      // Apply the import fixes first
      let processedCode = correctImports + '\n\n' + afterImports.trim();
      
      // Then apply icon replacement
      processedCode = replaceInvalidIcons(processedCode);
      
      return processedCode;
    };

    // Build the comprehensive coding prompt
    const codingPrompt = `You are **Coder‑Agent**, an expert Next.js 15 frontend engineer specialized in **modern clean** Chakra UI implementation with framer-motion animations and **solid dark backgrounds**.

#### Input (Design Specifications)
- **Product**: ${productName}
- **Target Audience**: ${audienceName}
- **Description**: ${productDescription}

#### Research Data Provided
${researchData ? JSON.stringify(researchData, null, 2) : '<none>'}

#### Product Manager Data to Incorporate
${productManagerData ? JSON.stringify(productManagerData, null, 2) : '<none>'}

#### Designer Data to Incorporate
${designerData ? JSON.stringify(designerData, null, 2) : '<none>'}

#### Background Images Available
${Object.keys(backgroundImages).length > 0 ? 
  Object.entries(backgroundImages).map(([name, url]) => `- ${name}: ${url.substring(0, 80)}...`).join('\n') : 
  'No background images found in designer data'}

#### Your Mission
Implement a **complete, conversion-focused landing page** that **STRICTLY FOLLOWS the designer data** if provided, with substantial content, animations, and all essential sections. If designer data is provided, you MUST implement the exact design specifications including:

**CRITICAL DESIGNER DATA REQUIREMENTS:**
1. **EXACT LAYOUT**: Follow the component structure from designer JSON exactly
2. **BACKGROUND IMAGES**: Use provided background image URLs with proper variable extraction
3. **COLOR SCHEMES**: Match the exact colors from designer data (backgroundColor, color props)
4. **TYPOGRAPHY**: Implement exact font sizes, weights, and text content from designer data
5. **COMPONENT TYPES**: Use the exact Chakra UI components specified in designer JSON
6. **ANIMATIONS**: Implement any animation properties specified in designer data

**BACKGROUND IMAGE IMPLEMENTATION:**
When designer data includes background images, you MUST:
1. Extract ALL long background image URLs to variables before the component
2. Use bgImage prop with template literals: bgImage={\`url('\${variableName}')\`}
3. Include ALL backgroundSize, backgroundPosition, and backgroundRepeat properties from designer data
4. NEVER put long URLs directly in JSX props

**EXAMPLE BACKGROUND IMAGE IMPLEMENTATION:**
\`\`\`jsx
// ✅ CORRECT - Extract long URLs to variables (this will be auto-generated)
const heroBackgroundImage = "https://very-long-dalle-url-here...";

export default function Page() {
  return (
    <Box 
      bgImage={\`url('\${heroBackgroundImage}')\`}
      bgSize="cover"
      bgPosition="center"
      bgRepeat="no-repeat"
    >
      {/* Content */}
    </Box>
  );
}
\`\`\`

CRITICAL IMPLEMENTATION REQUIREMENTS:
1. **"use client" Directive**: MUST include "use client" at the very top of the file
2. **Complete Structure**: Single file \`app/page.jsx\` with comprehensive sections
3. **Essential Components**: Use Box, Container, Heading, Text, Button, SimpleGrid, Icon, VStack, HStack
4. **Designer Data Priority**: If designer data is provided, implement it EXACTLY. If not, create professional design.
5. **All Sections**: Hero, Features, Value Props, Testimonials, FAQ, CTA, Footer (use designer layout if provided)
6. **Clean Layout**: Professional spacing, clear hierarchy, multiple CTAs
7. **Framer Motion**: Add smooth animations throughout the page
8. **Background Handling**: Use designer backgrounds if available, otherwise use solid dark colors
9. **Content Integration**: Combine designer layout with research/content data for comprehensive implementation

#### DESIGNER DATA PROCESSING RULES:
**IF DESIGNER DATA IS PROVIDED:**
- **EXACT IMPLEMENTATION**: Follow the designer JSON structure precisely
- **COMPONENT MAPPING**: Map designer component types to Chakra UI components
- **STYLE MATCHING**: Implement exact colors, spacing, typography from designer props
- **BACKGROUND IMAGES**: Extract and implement all background images properly
- **TEXT CONTENT**: Use designer text content as primary, supplement with research/content data
- **LAYOUT STRUCTURE**: Follow designer component hierarchy and nesting

**IF NO DESIGNER DATA:**
- **FALLBACK MODE**: Create professional landing page with solid dark backgrounds
- **DEFAULT STRUCTURE**: Implement standard sections with clean design
- **CONTENT PRIORITY**: Use research and content data for rich information

#### CHAKRA UI COMPONENT MAPPING FROM DESIGNER JSON:
- **Box** → Box (with all props: bg, padding, margin, etc.)
- **Text** → Text (with fontSize, color, fontWeight, etc.)
- **Heading** → Heading (with size, color, fontWeight, etc.)
- **Button** → Button (with colorScheme, size, variant, etc.)
- **VStack** → VStack (with spacing, align, etc.)
- **HStack** → HStack (with spacing, align, etc.)
- **Stack** → Stack (with spacing, direction, etc.)
- **SimpleGrid** → SimpleGrid (with columns, spacing, etc.)
- **Grid** → Grid (with templateColumns, gap, etc.)
- **Image** → Image (with src, alt, etc.)
- **Link** → Link (with href, color, hover effects, etc.)
- **Icon** → Icon (map to valid Chakra UI icons only)

#### CRITICAL SYNTAX ERROR PREVENTION:
**LONG URL HANDLING (MANDATORY):**
- NEVER put long URLs directly in JSX props - this breaks the parser
- ALWAYS extract long URLs to variables before the component
- The background image extraction system will handle this automatically

**JSX COMMENT SYNTAX (MANDATORY):**
- ONLY use standard JSX comments: \`{/* Comment */}\`
- NEVER use JSDoc-style comments: \`{/** Comment **/}\` - these cause syntax errors

#### BACKGROUND REQUIREMENTS:
**WHEN DESIGNER DATA HAS BACKGROUNDS:**
- Use designer-specified backgrounds (including images, colors)
- Implement exact backgroundSize, backgroundPosition, backgroundRepeat
- Extract long URLs to variables automatically

**WHEN NO DESIGNER BACKGROUNDS:**
- Use solid dark colors like: bg="gray.900", bg="gray.800", bg="blue.900", etc.
- NO GRADIENTS unless specifically in designer data

#### FRAMER MOTION - ANIMATION REQUIREMENTS:
**REQUIRED IMPORTS:**
\`\`\`jsx
import { motion } from 'framer-motion';
\`\`\`

**MOTION COMPONENT DEFINITIONS (AUTOMATICALLY PROVIDED):**
\`\`\`jsx
// Motion-wrapped Chakra UI components for animations (auto-generated in imports)
const MotionBox = motion(Box);
const MotionFlex = motion(Flex);
const MotionVStack = motion(VStack);
const MotionHStack = motion(HStack);
const MotionContainer = motion(Container);
const MotionHeading = motion(Heading);
const MotionText = motion(Text);
const MotionButton = motion(Button);
const MotionCard = motion(Card);
const MotionImage = motion(Image);
const MotionStack = motion(Stack);
const MotionGrid = motion(Grid);
const MotionSimpleGrid = motion(SimpleGrid);
\`\`\`

**ANIMATION PRINCIPLES:**
- Use framer-motion for all animations with motion-wrapped Chakra UI components
- **Motion Components**: Use MotionBox, MotionCard, MotionButton, etc. instead of regular components for animations
- **Section Animations**: Use MotionBox for container animations with fadeInUp and whileInView
- **Grid Animations**: Use MotionSimpleGrid with staggerContainer for card grids
- **Individual Elements**: Use MotionHeading, MotionText, MotionButton for individual animations
- **Hover Effects**: Implement whileHover with scale and translateY transforms on interactive elements
- **Scroll Triggers**: Use whileInView with viewport={{ once: true }} for scroll-triggered animations
- **Icon Animations**: Wrap icons in motion.div for hover effects (scale, rotate)
- **Stagger Effects**: Use variants with staggerChildren for sequential animations
- **Performance**: Respect reduced motion preferences with appropriate transitions
- **Smooth Transitions**: Use appropriate durations (0.2s for hover, 0.6s-0.8s for entry animations)
- **Animation Variants**: Define reusable animation variants like fadeInUp, slideInLeft, staggerContainer

**MOTION COMPONENT USAGE EXAMPLES:**
\`\`\`jsx
{/* Hero Section with Motion */}
<MotionBox 
  bg="gray.900" 
  py={20}
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.8 }}
>
  <Container maxW="6xl">
    <MotionVStack spacing={8} textAlign="center">
      <MotionHeading 
        size="2xl" 
        color="white"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        Your Product Name
      </MotionHeading>
      <MotionText 
        fontSize="xl" 
        color="gray.300"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        Product description here
      </MotionText>
      <MotionButton 
        colorScheme="blue" 
        size="lg"
        whileHover={{ y: -5, scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.2 }}
      >
        Get Started
      </MotionButton>
    </MotionVStack>
  </Container>
</MotionBox>

{/* Feature Cards with Motion */}
<MotionSimpleGrid 
  columns={{ base: 1, md: 3 }} 
  spacing={8}
  initial="initial"
  animate="animate"
  variants={staggerContainer}
>
  <MotionCard 
    bg="gray.900"
    variants={fadeInUp}
    whileHover={{ y: -4, scale: 1.02 }}
    transition={{ duration: 0.3 }}
  >
    <CardHeader>
      <MotionVStack spacing={4}>
        <motion.div
          whileHover={{ scale: 1.1, rotate: 5 }}
          transition={{ duration: 0.2 }}
        >
          <CheckIcon boxSize={8} color="green.400" />
        </motion.div>
        <Heading size="md" color="white">Feature Title</Heading>
      </MotionVStack>
    </CardHeader>
    <CardBody>
      <Text textAlign="center" color="gray.300">
        Feature description with animations
      </Text>
    </CardBody>
  </MotionCard>
</MotionSimpleGrid>

{/* Testimonials with Motion */}
<MotionBox 
  bg="gray.800" 
  py={16}
  initial={{ opacity: 0 }}
  whileInView={{ opacity: 1 }}
  transition={{ duration: 0.8 }}
  viewport={{ once: true }}
>
  <Container maxW="6xl">
    <MotionSimpleGrid 
      columns={{ base: 1, md: 3 }} 
      spacing={8}
      variants={staggerContainer}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true }}
    >
      <MotionCard 
        bg="gray.900"
        variants={fadeInUp}
        whileHover={{ y: -2 }}
        transition={{ duration: 0.3 }}
      >
        <CardBody>
          <VStack spacing={4}>
            <Text color="gray.300" textAlign="center">
              "Amazing product that changed our business!"
            </Text>
            <HStack>
              <Avatar 
                size="sm" 
                src="https://images.unsplash.com/photo-1494790108755-2616b612b352?w=64&h=64&fit=crop&crop=face" 
              />
              <VStack spacing={0} align="start">
                <Text color="white" fontSize="sm" fontWeight="bold">Jane Doe</Text>
                <Text color="gray.400" fontSize="xs">CEO, Company</Text>
              </VStack>
            </HStack>
          </VStack>
        </CardBody>
      </MotionCard>
    </MotionSimpleGrid>
  </Container>
</MotionBox>
\`\`\`

**MOTION USAGE PATTERNS:**
- **Container Animations**: Use MotionBox for section containers with fadeInUp
- **Stagger Animations**: Use MotionSimpleGrid with staggerContainer for card grids
- **Hover Effects**: Use whileHover on MotionCard, MotionButton for interactive feedback
- **Scroll Animations**: Use whileInView for animations triggered on scroll
- **Icon Animations**: Wrap icons in motion.div for hover effects (scale, rotate)
- **Button Animations**: Use MotionButton with whileHover and whileTap
- **Text Animations**: Use MotionHeading and MotionText for entry animations

#### CHAKRA UI ICONS - USE ONLY THESE CONFIRMED EXISTING ICONS:
**REQUIRED IMPORTS (IMPORT ALL TO PREVENT ERRORS):**
\`\`\`jsx
import { 
  // Basic Icons (CONFIRMED TO EXIST)
  CheckIcon, CloseIcon, AddIcon, MinusIcon, EditIcon, DeleteIcon,
  
  // Navigation Icons (CONFIRMED TO EXIST)
  ArrowBackIcon, ArrowForwardIcon, ArrowUpIcon, ArrowDownIcon, 
  ArrowLeftIcon, ArrowRightIcon, ChevronUpIcon, ChevronDownIcon,
  ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon,
  
  // Communication Icons (CONFIRMED TO EXIST)
  EmailIcon, PhoneIcon, AtSignIcon,
  
  // UI Icons (CONFIRMED TO EXIST)
  SearchIcon, SettingsIcon, InfoIcon, WarningIcon,
  StarIcon, TimeIcon, CalendarIcon, LockIcon,
  
  // Status Icons (CONFIRMED TO EXIST)
  CheckCircleIcon, WarningTwoIcon, SmallAddIcon, SmallCloseIcon,
  
  // Menu & Controls (CONFIRMED TO EXIST)
  HamburgerIcon, TriangleDownIcon, TriangleUpIcon
} from '@chakra-ui/icons';
\`\`\`

**ONLY 23 CONFIRMED ICONS** - Import ALL of these to prevent "undefined" component errors

**🚨 CRITICAL ICON RULE**: 
1. Only use icons that are confirmed to exist in the list above


#### JSX SYNTAX REQUIREMENTS (CRITICAL):
- Use correct prop syntax: \`mb={8}\` NOT \`mb={8}"\`
- String values: \`color="gray.600"\` NOT \`color="gray.600""\`
- Object values: \`fontSize={{ base: "lg", md: "xl" }}\` 
- Number values: \`py={20}\` NOT \`py="20"\`
- Boolean values: \`isDisabled\` NOT \`isDisabled="true"\`

#### COMPLETE SECTION STRUCTURE WITH SOLID BACKGROUNDS:
1. **Header/Navigation**: Fixed sticky navigation with solid dark backdrop, light text, brand accent CTA
2. **Hero Section**: Solid dark background + light text + animated CTA
3. **Features Section**: Full-width solid dark background (gray.900) with centered content, 6 feature cards, valid Chakra UI icons, light text, animations
4. **Value Props Section**: Full-width solid dark background (gray.800) with centered content, light text and detailed benefits
5. **Testimonials Section**: Full-width solid dark background (gray.900) with centered content, 2-3 quotes, light text, fake avatar images
6. **FAQ Section**: MUST have full-width solid dark background (gray.800) with centered content, light text, accordion or simple list
7. **CTA Section**: MUST have full-width solid dark background (gray.900) with larger height (py={20}), centered content, high contrast light text and brand accent button
8. **Footer Section**: Full-width solid dark background (gray.900) with centered content, light text navigation and links

**MANDATORY IMPORTS FOR JSX FILE:**
\`\`\`jsx
"use client"

import { 
  Box, 
  Container, 
  Heading, 
  Text, 
  Button, 
  VStack, 
  HStack, 
  SimpleGrid, 
  Flex, 
  Image,
  Avatar,
  Stack,
  Grid,
  GridItem,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Divider,
  List,
  ListItem,
  ListIcon,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Spacer,
  Center,
  Square,
  Circle,
  Wrap,
  WrapItem,
  Link
} from '@chakra-ui/react';
import { 
  CheckIcon, 
  CloseIcon, 
  AddIcon, 
  MinusIcon, 
  EditIcon, 
  DeleteIcon,
  ArrowBackIcon, 
  ArrowForwardIcon, 
  ArrowUpIcon, 
  ArrowDownIcon, 
  ArrowLeftIcon, 
  ArrowRightIcon, 
  ChevronUpIcon, 
  ChevronDownIcon,
  ChevronLeftIcon, 
  ChevronRightIcon, 
  ExternalLinkIcon,
  EmailIcon, 
  PhoneIcon, 
  AtSignIcon,
  SearchIcon, 
  SettingsIcon, 
  InfoIcon, 
  WarningIcon,
  StarIcon, 
  TimeIcon, 
  CalendarIcon, 
  LockIcon,
  CheckCircleIcon, 
  WarningTwoIcon, 
  SmallAddIcon,
  SmallCloseIcon, 
  TriangleDownIcon, 
  TriangleUpIcon,
  HamburgerIcon
} from '@chakra-ui/icons';
import { motion } from 'framer-motion';

// Motion-wrapped Chakra UI components for animations (AUTO-GENERATED)
const MotionBox = motion(Box);
const MotionFlex = motion(Flex);
const MotionVStack = motion(VStack);
const MotionHStack = motion(HStack);
const MotionContainer = motion(Container);
const MotionHeading = motion(Heading);
const MotionText = motion(Text);
const MotionButton = motion(Button);
const MotionCard = motion(Card);
const MotionImage = motion(Image);
const MotionStack = motion(Stack);
const MotionGrid = motion(Grid);
const MotionSimpleGrid = motion(SimpleGrid);
\`\`\`

**STYLING PRINCIPLES:**
- Use comprehensive Chakra UI props with CORRECT syntax
- **NO GRADIENTS**: Use only solid backgrounds like bg="gray.900", bg="gray.800", bg="blue.900"
- Consistent spacing system (8px, 16px, 24px, 32px, 48px, 64px)
- Professional typography hierarchy
- Clean borders and appropriate shadows
- Hover effects with framer-motion animations
- Solid dark background treatments

**ANIMATION PRINCIPLES:**
- Use framer-motion for all animations with motion-wrapped Chakra UI components
- **Motion Components**: Use MotionBox, MotionCard, MotionButton, etc. instead of regular components for animations
- **Section Animations**: Use MotionBox for container animations with fadeInUp and whileInView
- **Grid Animations**: Use MotionSimpleGrid with staggerContainer for card grids
- **Individual Elements**: Use MotionHeading, MotionText, MotionButton for individual animations
- **Hover Effects**: Implement whileHover with scale and translateY transforms on interactive elements
- **Scroll Triggers**: Use whileInView with viewport={{ once: true }} for scroll-triggered animations
- **Icon Animations**: Wrap icons in motion.div for hover effects (scale, rotate)
- **Stagger Effects**: Use variants with staggerChildren for sequential animations
- **Performance**: Respect reduced motion preferences with appropriate transitions
- **Smooth Transitions**: Use appropriate durations (0.2s for hover, 0.6s-0.8s for entry animations)
- **Animation Variants**: Define reusable animation variants like fadeInUp, slideInLeft, staggerContainer

**CODE QUALITY:**
- Start with "use client" directive at the very top
- Extract ALL long URLs to variables before the component definition
- Use ONLY standard JSX comments {/* */}, never JSDoc-style {/** **/}
- Import ALL required Chakra UI components, icons, and framer-motion
- Clean, readable JSX structure with PERFECT syntax
- Comprehensive prop usage with correct prop types
- Consistent naming conventions
- Professional component organization
- Mobile-first responsive design
- Zero syntax errors
- Proper animation implementation with motion components
- **SOLID BACKGROUNDS ONLY**: NO bgGradient props allowed anywhere

Return your response as valid JSON in this exact format:
{
  "projectStructure": {
    "description": "Single‑file Next.js landing page with Chakra UI and solid dark backgrounds",
    "mainFiles": ["app/page.jsx"],
    "dependencies": {
      "next": "15.0.0",
      "react": "18.0.0",
      "react-dom": "18.0.0",
      "@chakra-ui/react": "^2.8.0",
      "@chakra-ui/icons": "^2.1.0",
      "@emotion/react": "^11.11.0",
      "@emotion/styled": "^11.11.0",
      "framer-motion": "^10.16.0"
    }
  },
  "codeFiles": [
    {
      "filename": "app/page.jsx",
      "description": "Single‑file landing page with inline components and solid dark backgrounds",
      "code": "<the full JSX content here>"
    }
  ],
  "configuration": [
    {
      "filename": "package.json",
      "description": "Project dependencies for Next.js with Chakra UI",
      "code": "<package.json content>"
    }
  ],
  "documentation": {
    "readme": "# Landing Page\\n\\nA modern Next.js landing page built with Chakra UI and solid dark backgrounds.\\n\\n## Getting Started\\n\\nnpm install\\nnpm run dev",
    "deployment": "Deploy to Vercel or any Next.js hosting platform with one-click deployment.",
    "development": "Run npm install then npm run dev for local development with hot reloading"
  }
}

**CRITICAL IMPLEMENTATION REQUIREMENTS:**
- MUST start with "use client" directive at the very top of the file
- MUST extract ALL long URLs to variables before the component definition
- MUST use ONLY standard JSX comments {/* */}, never JSDoc-style {/** **/}
- MUST import ALL commonly used Chakra UI React components to prevent undefined component errors
- MUST import ALL 14 approved Chakra UI icons to prevent undefined component errors
- MUST implement fixed header with solid dark background styling (h="80px")
- MUST ensure NO WHITE SPACE between header and hero section (use mt={0} and pt="80px")
- MUST implement solid dark backgrounds for ALL sections (no white/light backgrounds allowed)
- MUST use light text colors (gray.50, gray.100, white) on all dark backgrounds
- MUST ensure ALL sections have solid dark backgrounds - NO GRADIENTS ANYWHERE
- MUST import comprehensive Chakra UI components
- MUST use framer-motion for animations throughout the page
- MUST implement solid dark theme colors only
- USE ONLY the 14 approved Chakra UI icons
- Generate solid color schemes only (gray.900, gray.800, blue.900, etc.)
- Include ALL 8 sections with consistent solid dark backgrounds: Header/Navigation, Hero, Features, Value Props, Testimonials, FAQ, CTA, Footer
- Use 1.1x more content than minimal approach
- Use fake avatar URLs for testimonials only
- NO IMAGES in features, value props, FAQ, CTA, or footer sections
- Implement comprehensive solid dark color palette with consistent section backgrounds
- Add comprehensive footer with navigation and solid dark background
- Include smooth animations with framer-motion
- Double-check ALL prop syntax for correctness
- Zero tolerance for syntax errors
- Ensure mobile responsiveness with proper breakpoints
- Add framer-motion to package.json dependencies
- **ABSOLUTELY NO GRADIENTS**: Never use bgGradient, only use bg with solid colors
- **FIX HEADER GAP**: Hero section must start immediately after fixed header with NO white space
- **FULL-WIDTH SECTIONS**: All sections must use full-width backgrounds (w="full", px={0}) with Container inside for content
- **FAQ SECTION FIX**: Must have full-width dark background with NO white space on sides
- **CTA SECTION FIX**: Must have larger height (py={20}) to eliminate gaps with footer

BEGIN COMPREHENSIVE IMPLEMENTATION (must be valid JSON with PERFECT JSX SYNTAX, SOLID DARK BACKGROUNDS ONLY, VALID ICONS ONLY, EXTRACTED URL VARIABLES, STANDARD JSX COMMENTS, AND FRAMER-MOTION ANIMATIONS)`;

    logger.info('Requesting code from OpenAI with comprehensive prompt');
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert Next.js developer specialized in modern clean Chakra UI implementation with framer-motion animations. You can implement designs from designer JSON data with pixel-perfect accuracy, including proper background image handling and exact style matching. When designer data is provided, you MUST follow it precisely. When no designer data is available, create professional dark-themed designs. The file **may import any npm package** but must not use local path imports. Ensure the page compiles & renders with zero warnings. Return your response in valid JSON format exactly matching the specified structure.',
        },
        { role: 'user', content: codingPrompt },
      ],
    });

    const codingContent = completion.choices[0].message?.content;
    if (!codingContent) {
      throw new Error('OpenAI returned an empty response');
    }

    let codingResult: CodingResult;
    try {
      codingResult = JSON.parse(codingContent) as CodingResult;
      if (!codingResult.codeFiles?.length) {
        throw new Error('No code files in response');
      }
      
      // Post-process the generated code to force correct imports
      if (codingResult.codeFiles && codingResult.codeFiles[0]) {
        const originalCode = codingResult.codeFiles[0].code;
        const processedCode = forceCorrectImports(originalCode);
        codingResult.codeFiles[0].code = processedCode;
        
        logger.info('Post-processed imports to prevent LLM hallucination');
      }
      
      logger.info({ fileCount: codingResult.codeFiles.length }, 'Successfully parsed structured response');
    } catch (err) {
      logger.warn({ err }, 'Falling back to local template');
      
      // Fallback single-file landing page with solid dark backgrounds
      const fallbackCode = `"use client";

import React from "react";
import {
  Box,
  Button,
  Container,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  Stack,
  Text,
  VStack,
  SimpleGrid,
  Card,
  CardBody,
  CardHeader,
  Divider,
} from "@chakra-ui/react";
import { 
  CheckIcon, 
  StarIcon, 
  ArrowForwardIcon,
  EmailIcon,
  InfoIcon 
} from "@chakra-ui/icons";
import { motion } from "framer-motion";

const MotionBox = motion(Box);
const MotionCard = motion(Card);

export default function LandingPage() {
  return (
    <Box minH="100vh" bg="gray.900">
      {/* Hero Section */}
      <MotionBox 
        bg="gray.900" 
        py={20}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <Container maxW="6xl">
          <VStack spacing={8} textAlign="center">
            <Heading 
              size="2xl" 
              color="white"
              fontWeight="extrabold"
            >
              ` + productName + `
            </Heading>
            <Text fontSize="xl" color="gray.300" maxW="2xl">
              ` + productDescription + `
            </Text>
            <Button 
              colorScheme="blue" 
              size="lg" 
              rightIcon={<ArrowForwardIcon />}
              px={8}
              py={6}
              fontSize="lg"
            >
              Get Started Today
            </Button>
          </VStack>
        </Container>
      </MotionBox>

      {/* Features Section */}
      <Box bg="gray.800" py={16}>
        <Container maxW="6xl">
          <VStack spacing={12}>
            <Heading size="xl" textAlign="center" color="white">
              Why Choose ` + productName + `?
            </Heading>
            
            <SimpleGrid columns={{ base: 1, md: 3 }} spacing={8}>
              <MotionCard 
                bg="gray.900"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <CardHeader>
                  <VStack spacing={4}>
                    <Icon as={CheckIcon} w={8} h={8} color="green.400" />
                    <Heading size="md" color="white">Easy to Use</Heading>
                  </VStack>
                </CardHeader>
                <CardBody>
                  <Text textAlign="center" color="gray.300">
                    Intuitive design that gets you up and running in minutes, not hours.
                  </Text>
                </CardBody>
              </MotionCard>

              <MotionCard 
                bg="gray.900"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <CardHeader>
                  <VStack spacing={4}>
                    <Icon as={StarIcon} w={8} h={8} color="yellow.400" />
                    <Heading size="md" color="white">Premium Quality</Heading>
                  </VStack>
                </CardHeader>
                <CardBody>
                  <Text textAlign="center" color="gray.300">
                    Built with the highest standards and attention to detail for excellence.
                  </Text>
                </CardBody>
              </MotionCard>

              <MotionCard 
                bg="gray.900"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                <CardHeader>
                  <VStack spacing={4}>
                    <Icon as={InfoIcon} w={8} h={8} color="blue.400" />
                    <Heading size="md" color="white">24/7 Support</Heading>
                  </VStack>
                </CardHeader>
                <CardBody>
                  <Text textAlign="center" color="gray.300">
                    Round-the-clock assistance whenever you need help or guidance.
                  </Text>
                </CardBody>
              </MotionCard>
            </SimpleGrid>
          </VStack>
        </Container>
      </Box>

      {/* Footer */}
      <Box bg="gray.800" color="white" py={12}>
        <Container maxW="6xl">
          <VStack spacing={6}>
            <Heading size="md" color="white">Ready to Get Started?</Heading>
            <Button 
              colorScheme="blue" 
              size="lg"
              rightIcon={<ArrowForwardIcon />}
            >
              Start Your Free Trial
            </Button>
            
            <Divider />
            
            <Flex 
              direction={{ base: "column", md: "row" }} 
              justify="space-between" 
              align="center" 
              w="full"
              gap={4}
            >
              <Text color="gray.300">© 2024 ` + productName + `. All rights reserved.</Text>
              <HStack spacing={4}>
                <Icon as={EmailIcon} color="gray.300" />
                <Text color="gray.300">contact@company.com</Text>
              </HStack>
            </Flex>
          </VStack>
        </Container>
      </Box>
    </Box>
  );
}`;

      codingResult = {
        projectStructure: {
          description: 'Single‑file Next.js landing page with Chakra UI and solid dark backgrounds',
          mainFiles: ['app/page.jsx'],
          dependencies: {
            next: '15.0.0',
            react: '18.0.0',
            'react-dom': '18.0.0',
            '@chakra-ui/react': '^2.8.0',
            '@chakra-ui/icons': '^2.1.0',
            '@emotion/react': '^11.11.0',
            '@emotion/styled': '^11.11.0',
            'framer-motion': '^10.16.0',
            typescript: '^5.4.0',
          },
        },
        codeFiles: [
          { 
            filename: 'app/page.jsx', 
            description: 'Complete single-file landing page with hero, features, testimonials, and footer using solid dark backgrounds', 
            code: fallbackCode 
          },
        ],
        configuration: [
          {
            filename: 'package.json',
            description: 'Project dependencies for Next.js with Chakra UI',
            code: JSON.stringify({
              name: 'landing-page',
              version: '0.1.0',
              private: true,
              scripts: {
                dev: 'next dev',
                build: 'next build',
                start: 'next start',
                lint: 'next lint'
              },
              dependencies: {
                next: '15.0.0',
                react: '18.0.0',
                'react-dom': '18.0.0',
                '@chakra-ui/react': '^2.8.0',
                '@chakra-ui/icons': '^2.1.0',
                '@emotion/react': '^11.11.0',
                '@emotion/styled': '^11.11.0',
                'framer-motion': '^10.16.0',
                typescript: '^5.4.0',
              },
              devDependencies: {
                '@types/node': '^20.0.0',
                '@types/react': '^18.2.0',
                '@types/react-dom': '^18.2.0',
                eslint: '^8.0.0',
                'eslint-config-next': '15.0.0'
              }
            }, null, 2)
          }
        ],
        documentation: {
          readme: '# Single‑File Landing Page\n\nA modern Next.js landing page built with Chakra UI and solid dark backgrounds.\n\n## Getting Started\n\n```bash\nnpm install\nnpm run dev\n```\n\nOpen [http://localhost:3000](http://localhost:3000) to view the page.',
          deployment: 'Deploy to Vercel or any Next.js hosting platform with one-click deployment.',
          development: 'Run `npm install` then `npm run dev` for local development with hot reloading'
        },
      };
    }

    // Store the coding result in S3
    if (jobId) {
      const resultKey = `${jobId}/coder-result.json`;
      const enhancedResult = {
        ...codingResult,
        metadata: {
          jobId,
          agentType: 'coder',
          timestamp: new Date().toISOString(),
          model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
          version: '2.0',
          usedResearchData: !!researchData,
          usedProductManagerData: !!productManagerData,
          usedDesignerData: !!designerData,
        },
      };

      await s3Helper.putJsonObject(resultKey, enhancedResult);
      logger.info({ resultKey }, 'Coding result stored in S3');
    }

    logger.info('Coding task completed successfully');

    return codingResult;

  } catch (error) {
    logger.error({ error }, 'Coding task failed');
    throw error;
  }
}

// Remove the old forceCorrectImports function and other deprecated code 
