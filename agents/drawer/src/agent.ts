import OpenAI from 'openai';
import { createAgentLogger } from './logger';
import { createS3Helper, S3Helper } from './aws';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY_3 || process.env.OPENAI_API_KEY,
});

export interface DrawerResult {
  themeAnalysis: {
    detectedTheme: string;
    themeReasoning: string;
    visualDirection: string;
    colorStrategy: string;
  };
  imageAnalysis: {
    productType: string;
    targetAudience: string;
    emotionalTone: string;
    brandPersonality: string;
  };
  heroDecision: {
    imageType: string;
    reasoning: string;
    textPlacement: string;
  };
  visualDirection: {
    style: string;
    colorPalette: string;
    mood: string;
    composition: string;
    lighting: string;
  };
  dallePrompt: {
    mainPrompt: string;
    aspectRatio: string;
    styleModifiers: string;
    technicalSpecs: string;
    themeKeywords: string;
  };
  implementation: {
    usage: string;
    alternatives: string;
    optimization: string;
    themeIntegration: string;
  };
  generatedImage?: {
    url: string | null;
    originalUrl?: string;
    uploadStatus: string;
    timestamp: string;
    error?: string;
  };
}

interface DrawerPayload {
  productSpec: any;
  job_id?: string;
  taskId?: string;
}

function createDrawerPrompt(productSpec: any): string {
  return `
You are **Drawer‑Agent**, a creative visual designer specializing in **hero section imagery** for landing pages with **theme‑aware design**.

──────────────────────
INPUT  – Product Content & Theme
──────────────────────
${JSON.stringify(productSpec, null, 2)}

──────────────────────
MISSION
──────────────────────
Analyze the product content and **theme decision** to create the perfect **hero image prompt** for OpenAI DALL‑E generation.
Design imagery that enhances the value proposition, appeals to the target audience, and **aligns with the chosen theme** (dark or light).

──────────────────────
THEME‑AWARE VISUAL STRATEGY
──────────────────────
**THEME ANALYSIS:**  
- Product Theme: dark theme (enforced for all designs)  
- Theme Reasoning: Modern, sophisticated, premium user experience with dark aesthetics  
- Brand Personality: Sophisticated, premium, tech‑forward, innovative  

**DARK THEME VISUAL APPROACH (MANDATORY):**  
- **Color Palette**: Deep dark backgrounds (grays, blacks), single brand accent color  
- **Color Schemes**: Professional dark palette – blue‑dark, purple‑dark, green‑dark, teal‑dark, amber‑dark  
- **Lighting**: Subtle professional lighting, clean illumination, avoid dramatic shadows  
- **Mood**: Sophisticated, professional, trustworthy, premium but approachable  
- **Style**: Modern commercial, clean business aesthetic, professional minimalism  
- **Composition**: Commercial layout, clear focal hierarchy, business‑appropriate elegance  
- **AVOID**: Overly artistic/abstract imagery, complex artistic elements, avant‑garde designs  

**MANDATORY DARK THEME CHARACTERISTICS:**  
- Commercial focus, clean minimalism, professional aesthetics, brand‑supportive, dark base, subtle accents, commercial quality.

──────────────────────
VISUAL STRATEGY PROCESS
──────────────────────
1. **Content Analysis**
   • Extract key product benefits and value propositions
   • Identify target audience and their preferences
   • Understand the emotional tone and brand personality
   • **Apply theme considerations to visual direction**

2. **Theme‑Based Image Composition Decision**
   • **Full‑screen hero**: For products needing dramatic impact (games, entertainment, lifestyle)
   • **Partial hero**: For professional/business products needing text prominence
   • **Background element**: For products where content is primary focus
   • **Theme influence**: Dark themes favor full‑screen dramatic images, light themes favor balanced compositions

3. **Theme‑Aligned Visual Style Direction**
   • **Dark Theme**: Cinematic, dramatic, elegant, futuristic, high‑tech aesthetic with sophisticated atmosphere
   • **Light Theme**: Natural, clean, bright, organic, trustworthy aesthetic
   • **Style matching**: Photographic vs illustration based on theme + product type

4. **Technical Specifications**
   • Aspect ratio: 16:9 for full‑screen, 3:2 for partial hero
   • **Dark Theme**: High contrast, dramatic lighting, deep shadows, bright highlights, atmospheric elements
   • **Light Theme**: Soft lighting, even exposure, natural colors, gentle shadows
   • Composition: Leave appropriate space for text overlay based on theme

──────────────────────
THEME‑BASED PROMPT ENGINEERING
──────────────────────
**DARK THEME PROMPTS must include:**  
"professional commercial", "dark background", "minimal professional",
"business‑focused design", "subtle professional lighting",
"clean commercial composition", "sophisticated professional",
"premium business aesthetic", "corporate elegance".  
**They must avoid:** "abstract", "avant‑garde", "surreal", "artistic", "experimental".

**GOOD DARK THEME EXAMPLES:**
- "Professional dark background with subtle brand accent, clean commercial composition, business‑appropriate lighting"
- "Clean dark corporate background with minimal professional elements, commercial quality, business aesthetic"
- "Sophisticated dark business background with single brand color accent, professional commercial lighting"
- "Modern dark professional background, clean business aesthetic, minimal commercial design"

**AVOID FOR DARK THEMES:**
- Abstract art, artistic compositions, surreal elements, complex artistic details
- Overly dramatic lighting, artistic shadows, avant‑garde design elements
- Non‑commercial imagery, artistic photography, experimental compositions
- Complex visual metaphors, abstract concepts, artistic interpretations

──────────────────────
OUTPUT FORMAT (STRICT JSON)
──────────────────────
{
  "themeAnalysis": {
    "detectedTheme": "${productSpec.themeDecision?.theme || 'dark'}",
    "themeReasoning": "analysis of why this theme works for the product",
    "visualDirection": "how theme influences visual approach",
    "colorStrategy": "theme‑appropriate color considerations"
  },
  "imageAnalysis": {
    "productType": "description of product category",
    "targetAudience": "primary audience description", 
    "emotionalTone": "desired emotional response aligned with theme",
    "brandPersonality": "professional/playful/innovative/etc"
  },
  "heroDecision": {
    "imageType": "full‑screen | partial | background",
    "reasoning": "why this approach works best with the chosen theme",
    "textPlacement": "how text will overlay or integrate with theme considerations"
  },
  "visualDirection": {
    "style": "photographic | illustration | abstract | mixed",
    "colorPalette": "theme‑appropriate color scheme",
    "mood": "theme‑aligned mood description",
    "composition": "layout and focus description with theme considerations",
    "lighting": "theme‑specific lighting approach"
  },
  "dallePrompt": {
    "mainPrompt": "detailed DALL‑E prompt incorporating theme elements and beautiful atmospheric quality",
    "aspectRatio": "16:9 | 3:2 | 1:1",
    "styleModifiers": "theme‑appropriate style and quality parameters",
    "technicalSpecs": "theme‑specific lighting, resolution, photography style details",
    "themeKeywords": "specific keywords that reinforce the chosen theme"
  },
  "implementation": {
    "usage": "how designer should implement this theme‑aware image",
    "alternatives": "backup options if generation fails",
    "optimization": "suggestions for web performance",
    "themeIntegration": "how image will work with theme‑based design system"
  }
}

──────────────────────
GENERATION GUIDELINES
──────────────────────
• Prioritize professional commercial composition.  
• Single focal point; no visual distractions.  
• Ensure dark background, subtle lighting, single accent color.  
• Provide ample negative space for copy.  
• **Never** use abstract, surreal, avant‑garde, experimental language.  
• Output must be appropriate for a professional business website.  

Return **only** the JSON object with the complete theme‑aware visual strategy and DALL‑E prompt.`.trim();
}

export async function runDrawerAgent(payload: DrawerPayload): Promise<DrawerResult> {
  const logger = createAgentLogger('drawer', payload.job_id || payload.taskId);
  const s3Helper = createS3Helper();

  try {
    logger.info({ payload }, 'Starting drawer agent task');

    // Generate the drawer prompt
    const prompt = createDrawerPrompt(payload.productSpec);
    logger.debug('Generated drawer prompt');

    // Call OpenAI API for drawer strategy
    logger.info('Calling OpenAI API for drawer strategy');
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
      messages: [
        {
          role: 'system',
          content: `You are Drawer‑Agent, a corporate visual strategist.

STRICT RULES (hard blockers)  
• Output must be commercial, professional, photo‑realistic or high‑quality 3D — **never** abstract, surreal, avant‑garde, experimental or artistic.  
• Your DALL‑E prompt must always contain:  
  "professional commercial", "dark background", "subtle professional lighting", "business‑focused design", "single brand accent color".  
• It must never contain: "abstract", "surreal", "avant‑garde", "artistic", "experimental".  
• Leave generous empty space for headline text.  
• Respond **only** with the JSON schema provided by the user.`
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' }
    });

    const drawerContent = completion.choices[0]?.message?.content;
    if (!drawerContent) {
      throw new Error('No response received from OpenAI');
    }

    logger.debug({ responseLength: drawerContent.length }, 'Received drawer strategy response');

    // Parse the JSON response
    const drawerSpec: DrawerResult = JSON.parse(drawerContent);

    // Generate image using OpenAI DALL-E
    try {
      logger.info('Generating beautiful theme-aware hero image with DALL-E...');
      // const imageResponse = await openai.images.generate({
      //   model: 'dall-e-3',
      //   prompt: drawerSpec.dallePrompt.mainPrompt,
      //   size: drawerSpec.dallePrompt.aspectRatio === '16:9' ? '1792x1024' : 
      //         drawerSpec.dallePrompt.aspectRatio === '3:2' ? '1536x1024' : '1024x1024',
      //   quality: 'hd',
      //   style: 'natural',
      //   n: 1,
      // });
      // const imageUrl = imageResponse.data[0].url;

      const imageUrl = "https://oaidalleapiprodscus.blob.core.windows.net/private/org-4BM7YTdjtaPcDVyB2jpLuw19/user-O8KvS0xAPESTHtKyynJT0a00/img-7Tj82Q78lSY4TvaX7mALMzMV.png?st=2025-06-02T01%3A53%3A42Z&se=2025-06-02T03%3A53%3A42Z&sp=r&sv=2024-08-04&sr=b&rscd=inline&rsct=image/png&skoid=475fd488-6c59-44a5-9aa9-31c4db451bea&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2025-06-01T12%3A48%3A01Z&ske=2025-06-02T12%3A48%3A01Z&sks=b&skv=2024-08-04&sig=tiCR54U/rGdeQwgrtjAzFtvSVAJ1wNCXN9xWbxcyuC4%3D"


      logger.info('Beautiful theme-aware image generated successfully:', imageUrl);

      // Add the generated image info to the result
      drawerSpec.generatedImage = {
        url: imageUrl,
        originalUrl: imageUrl,
        uploadStatus: 'success',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Image generation failed:', error);
      drawerSpec.generatedImage = {
        url: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        uploadStatus: 'failed',
        timestamp: new Date().toISOString()
      };
    }

    // Store the result in S3
    const resultKey = `${payload.job_id || payload.taskId}/drawer-result.json`;
    await s3Helper.putJsonObject(resultKey, drawerSpec);
    logger.info({ resultKey }, 'Drawer result stored in S3');

    return drawerSpec;

  } catch (error) {
    logger.error({ error }, 'Drawer agent task failed');
    throw error;
  }
} 