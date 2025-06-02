import OpenAI from 'openai';
import { createAgentLogger } from './logger';
import { createS3Helper, S3Helper } from './aws';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface DrawerSpec {
  generatedImage?: {
    url?: string | null;
  };
  heroDecision?: {
    imageType?: string;
    textPlacement?: string;
  };
  visualDirection?: {
    style?: string;
  };
  [key: string]: any;
}

export interface DesignResult {
  designPhilosophy: string;
  themeImplementation: {
    chosenTheme: string;
    themeReasoning: string;
    designApproach: string;
    contrastStrategy: string;
  };
  brandInsights: {
    industry: string;
    emotion: string;
    audienceBias: string;
    themeAlignment: string;
  };
  brandIdentity: {
    brandName: string;
    tagline: string;
    brandPersonality: string;
    logoPlacement: string;
  };
  imagePolicy: {
    heroImage: boolean;
    testimonialAvatars: boolean;
    featureImages: boolean;
    valuePropsImages: boolean;
    faqImages: boolean;
    ctaImages: boolean;
    footerImages: boolean;
  };
  heroImage: {
    available: boolean;
    url: string;
    imageType: string;
    textPlacement: string;
    overlayNeeded: boolean;
    implementation: string;
    themeAlignment: string;
  };
  sections: {
    header: any;
    hero: any;
    features: any;
    valueProps: any;
    testimonials: any;
    faq: any;
    cta: any;
    footer: any;
  };
  interactions: {
    buttonHover: any;
    cardHover: any;
    focusRing: any;
    iconHover: any;
    motionSafe: boolean;
    gradientShift: string;
  };
  accessibility: {
    contrast: string;
    keyboardNav: boolean;
    reducedMotion: boolean;
  };
  performanceBudget: {
    ttiSeconds: number;
    aboveFoldKilobytes: number;
  };
  visualIdentity: {
    colorGeneration: any;
    colors: any;
    gradients: any;
    glassMorphism: any;
    typography: any;
    spacing: any;
    animations: any;
  };
}

export async function runDesignerAgent(payload: any): Promise<DesignResult> {
  const logger = createAgentLogger('designer', payload.job_id || 'task');
  const s3Helper = createS3Helper();
  
  try {
    logger.info({ payload }, 'Starting designer task with modern dark theme');

    // Get the drawer results from S3 if available
    let drawerSpec: DrawerSpec | null = null;
    if (payload.job_id) {
      try {
        const drawerKey = `${payload.job_id}/drawer-result.json`;
        drawerSpec = await s3Helper.getJsonObject<DrawerSpec>(drawerKey);
        logger.info({ drawerKey }, 'Retrieved drawer results from S3');
      } catch (error) {
        logger.warn({ error, job_id: payload.job_id }, 'No drawer results found, proceeding without');
      }
    }

    // Extract product spec from payload (could be from drawer payload or direct)
    const productSpec = payload.drawings || payload.productSpec || payload;

    const prompt = `
  You are **Designer‑Agent**, a senior UI/UX designer who crafts **modern‑clean landing pages** in Chakra UI with **solid dark theme design systems**.
  
  ──────────────────────
  INPUT  – Product Brief & Theme
  ──────────────────────
  ${JSON.stringify(productSpec, null, 2)}
  
  ${drawerSpec ? `──────────────────────
  INPUT  – Hero Image Specifications
  ──────────────────────
  ${JSON.stringify(drawerSpec, null, 2)}` : ''}
  
  ──────────────────────
  MISSION
  ──────────────────────
  Build a **modern, conversion-focused design system** with substantial content, clear structure, and **solid dark theme design**.
  **THEME**: dark theme (enforced for all designs)
  **REASONING**: Modern, sophisticated, premium user experience with solid dark aesthetics
  
  ${drawerSpec && drawerSpec.generatedImage && drawerSpec.generatedImage.url ? 
    '✔ **HERO IMAGE AVAILABLE**: Integrate the custom-generated, theme-aware hero image perfectly into your design.' : 
    '✘ **NO HERO IMAGE**: Design clean hero section with solid dark colors only.'}
  ✘  No overwhelming clutter • No poor hierarchy • No weak calls-to-action  
  ✔  Clean design with rich content, clear sections, proper testimonials & footer.
  ✔  Solid dark theme colors, animations, and clean elements that enhance minimalism.
  
  ──────────────────────
  SOLID DARK THEME DESIGN SYSTEM (ENFORCED)
  ──────────────────────
  **SOLID DARK THEME DESIGN PRINCIPLES (MANDATORY):**
  • **Colors**: Solid dark backgrounds (gray.900, gray.800, gray.700), light text, brand-appropriate accent colors
  • **Color Schemes**: Generate contextual solid dark palettes (blue.900, purple.900, green.900, amber.900, red.900, neutral.900)
  • **NO GRADIENTS**: Use only solid colors throughout all sections
  • **Backgrounds**: Solid dark colors like gray.900, gray.800, brand.900, etc.
  • **Glass Morphism**: Dark glass effects with solid dark backgrounds and subtle transparency
  • **Typography**: High contrast light text on solid dark backgrounds with brand accent highlights
  • **Shadows**: Subtle dark shadows, minimal light effects, accent-based borders
  • **Mood**: Sophisticated, premium, tech-forward, innovative with clean brand personality
  
  **LIGHT THEME DESIGN PRINCIPLES:**
  • **Colors**: Light backgrounds (white, gray.50), dark text (gray.900, gray.700), soft accents
  • **NO GRADIENTS**: Solid light backgrounds only
  • **Glass Morphism**: Light glass effects with subtle shadows, gentle transparency
  • **Typography**: High contrast dark text on light backgrounds
  • **Shadows**: Soft shadows, gentle elevation, natural light effects
  • **Mood**: Clean, trustworthy, accessible, professional, friendly
  
  ──────────────────────
  IMAGE USAGE POLICY (STRICT)
  ──────────────────────
  **ALLOWED IMAGES:**
  • **Hero Section**: Use generated hero image if available (theme-aware)
  • **Testimonials**: Fake avatar URLs from web (e.g., Unsplash profile photos)
  
  **NO IMAGES ALLOWED:**
  • Features section (use Chakra UI icons only)
  • Value propositions section (typography and colors only)
  • FAQ section (clean typography only)
  • CTA section (colors and typography only)
  • Footer section (text and links only)
  
  ──────────────────────
  DESIGN THINKING FLOW
  ──────────────────────
  1. **Theme Analysis**  
     • Theme Choice: dark (enforced for all designs)
     • Dynamic color palette generation based on product personality and industry context
     • Brand-appropriate dark theme variation selection (blue-dark, purple-dark, green-dark, amber-dark, red-dark, neutral-dark)
     • Desired emotional tone: sophisticated, premium, modern, tech-forward with brand personality
     • Color psychology alignment with product goals and target audience preferences
  
  2. **Hero Image Integration** ${drawerSpec && drawerSpec.generatedImage && drawerSpec.generatedImage.url ? `
     • USE the theme-aware generated hero image URL: ${drawerSpec.generatedImage.url}
     • Image type: ${drawerSpec.heroDecision?.imageType || 'unknown'}
     • Text placement: ${drawerSpec.heroDecision?.textPlacement || 'overlay'}
     • Visual style: ${drawerSpec.visualDirection?.style || 'photographic'}
     • Ensure text readability with theme-appropriate overlays/shadows` : `
     • No hero image available - use theme-appropriate gradient backgrounds
     • Focus on typography and theme-based color scheme for visual impact`}
  
  3. **Content Strategy (Enhanced)**  
     • Include primary value proposition AND supporting details
     • Show 6 key features with descriptions and Chakra UI icons
     • Include multiple testimonials for credibility with fake avatar images
     • Add comprehensive footer with navigation
     • Use 1.1x more content than minimal approach
  
  4. **Theme-Based Visual Guidelines**  
     • Typography with theme-appropriate contrast ratios
     • Color palette matching chosen theme (dark or light)
     • Generous spacing but not excessive (24-32px between elements)
     • Multiple CTAs strategically placed with theme colors
     • Balance whitespace with informative content
     • Chakra UI icons for features (no custom images)
     • Theme-appropriate animations and hover effects
     • Theme-specific gradient backgrounds where appropriate
     • Glass morphism effects matching theme aesthetic
  
  5. **Essential Sections (Complete)**  
     • **Header/Navigation** – sticky navigation with logo, menu items, theme-appropriate styling
     • **Hero** – headline, subheadline, description, primary CTA ${drawerSpec && drawerSpec.generatedImage?.url ? '+ theme-aware background image' : '+ theme-appropriate gradient background'}
     • **Features (6)** – Chakra UI icon + title + description for each (NO IMAGES)
     • **Value Props** – detailed benefits with explanations (NO IMAGES - typography only)
     • **Testimonials** – 2-3 customer quotes with fake avatar photos from web URLs
     • **FAQ** – common questions and answers (NO IMAGES)
     • **Final CTA** – compelling conversion section with theme gradient background (NO IMAGES)
     • **Footer** – navigation, links, contact info, legal (NO IMAGES - text only)
  
  ──────────────────────
  OUTPUT FORMAT (STRICT JSON)
  ──────────────────────
  Return a complete design specification in JSON format with all the required sections and styling details.
  `.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a modern clean landing‑page expert who creates rich, conversion-focused designs with consistent dark theme systems. Apply dark theme to ALL sections with dark backgrounds and light text. Integrate theme-aware hero images when available and use fake avatars for testimonials only. NO IMAGES in other sections except Chakra UI icons. Include motion animations and dark gradient enhancements for ALL sections. Ensure Features, Value Props, Testimonials, FAQ, CTA, Footer ALL have dark backgrounds. Follow the prompt to the letter; output valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const designResult = JSON.parse(completion.choices[0].message.content || '{}');
    
    // Store the design result in S3
    const resultKey = `${payload.job_id || 'design'}/designer-result.json`;
    await s3Helper.putJsonObject(resultKey, {
      ...designResult,
      metadata: {
        timestamp: new Date().toISOString(),
        model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
        version: '2.0'
      }
    });

    logger.info({ resultKey }, 'Design result stored in S3');
    logger.info('Design task completed successfully');

    return designResult;

  } catch (error) {
    logger.error({ error }, 'Design task failed');
    throw error;
  }
} 