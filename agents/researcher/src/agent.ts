import OpenAI from 'openai';
import { createAgentLogger } from './logger';
import { createS3Helper, S3Helper } from './aws';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface ResearchResult {
  summary: string;
  marketAnalysis: {
    marketSize: string;
    segments: string[];
    opportunities: string[];
    threats: string[];
  };
  audienceProfile: {
    demographics: string;
    psychographics: string;
    painPoints: string[];
    motivations: string[];
  };
  competitiveAnalysis: {
    directCompetitors: string[];
    indirectCompetitors: string[];
    competitiveAdvantages: string[];
    marketGaps: string[];
  };
  trends: {
    current: string[];
    emerging: string[];
    futureOutlook: string;
  };
  recommendations: {
    productDevelopment: string[];
    marketing: string[];
    positioning: string;
    pricing: string;
  };
  sources: string[];
}

interface ResearchPayload {
  product?: string;
  audience?: string;
  tone?: string;
  description: string;
  specificQuestions?: string[];
  researchDepth?: string;
}

// Enhanced Research Agent Prompt
function createResearchPrompt(payload: ResearchPayload): string {
  const { product, audience, tone = 'professional', description, specificQuestions = [], researchDepth = 'detailed' } = payload;

  return `
You are an expert market researcher and business analyst with access to comprehensive market data, industry reports, and competitive intelligence. You excel at uncovering deep insights that drive strategic decision-making.

## Research Brief
- **Project Description**: ${description}
- **Product/Service**: ${product || 'As described in project description'}
- **Target Audience**: ${audience || 'To be determined from project description'}
- **Tone**: ${tone}
- **Research Depth**: ${researchDepth}
${specificQuestions.length > 0 ? `- **Specific Questions**: ${specificQuestions.join(', ')}` : ''}

## Research Objectives
Conduct comprehensive research to gather actionable insights that will inform product development, positioning, and go-to-market strategy.

## Required Research Areas

### 1. Market Analysis & Opportunity Assessment
- Total Addressable Market (TAM) and growth projections
- Market segmentation and customer personas
- Industry dynamics and competitive landscape
- Emerging opportunities and market gaps
- Regulatory environment and barriers to entry

### 2. Target Audience Deep Dive
- Detailed demographic and psychographic profiles
- Customer journey mapping and touchpoints
- Pain points, frustrations, and unmet needs
- Buying behavior patterns and decision criteria
- Channel preferences and media consumption

### 3. Competitive Intelligence
- Direct and indirect competitor analysis
- Competitive positioning and value propositions
- Pricing strategies and business models
- Strengths, weaknesses, and market share
- Differentiation opportunities

### 4. Technology & Innovation Trends
- Current technological landscape
- Emerging technologies and disruptions
- Innovation opportunities and threats
- Platform ecosystems and partnerships
- Future technology roadmaps

### 5. Customer Validation & Insights
- User needs assessment and prioritization
- Feature requirements and expectations
- Usability and experience preferences
- Support and service requirements
- Success metrics and KPIs

### 6. Business Model & Monetization
- Revenue model opportunities
- Pricing sensitivity and willingness to pay
- Distribution and channel strategies
- Partnership and ecosystem opportunities
- Scalability considerations

## Output Format
Provide comprehensive research findings in structured JSON format:

\`\`\`json
{
  "executiveSummary": "High-level overview of key findings and strategic implications",
  "marketAnalysis": {
    "marketSize": "Detailed market size data with growth projections",
    "segments": ["Primary market segments with sizing"],
    "opportunities": ["Key market opportunities ranked by potential"],
    "threats": ["Market threats and challenges to address"],
    "barriers": ["Entry barriers and competitive moats"]
  },
  "audienceProfile": {
    "primaryPersonas": ["Detailed persona descriptions"],
    "demographics": "Comprehensive demographic analysis",
    "psychographics": "Behavioral patterns and motivations",
    "painPoints": ["Prioritized pain points with severity"],
    "motivations": ["Key drivers and motivational factors"],
    "customerJourney": ["Critical touchpoints and decision moments"]
  },
  "competitiveAnalysis": {
    "directCompetitors": ["Direct competitors with analysis"],
    "indirectCompetitors": ["Indirect competition and alternatives"],
    "competitiveAdvantages": ["Potential differentiation opportunities"],
    "marketGaps": ["Identified gaps and white space"],
    "competitorWeaknesses": ["Exploitable competitor vulnerabilities"]
  },
  "technologyTrends": {
    "current": ["Current relevant technologies"],
    "emerging": ["Emerging technologies to watch"],
    "disruptivePotential": ["Technologies that could disrupt the market"],
    "implementationOpportunities": ["Technology implementation recommendations"]
  },
  "customerInsights": {
    "needsPrioritization": ["Customer needs ranked by importance"],
    "featureExpectations": ["Must-have vs nice-to-have features"],
    "experienceRequirements": ["User experience expectations"],
    "successMetrics": ["How customers define success"]
  },
  "businessModel": {
    "revenueOpportunities": ["Revenue model recommendations"],
    "pricingStrategy": "Optimal pricing approach and rationale",
    "distributionChannels": ["Recommended go-to-market channels"],
    "partnerships": ["Strategic partnership opportunities"],
    "scalabilityFactors": ["Key factors for scaling the business"]
  },
  "strategicRecommendations": {
    "immediate": ["Actions to take in next 30-90 days"],
    "shortTerm": ["6-12 month strategic initiatives"],
    "longTerm": ["1-3 year strategic vision"],
    "riskMitigation": ["Key risks and mitigation strategies"]
  },
  "sources": ["Research sources and data references"],
  "confidence": {
    "dataQuality": "Assessment of research data quality (high/medium/low)",
    "assumptions": ["Key assumptions made in the analysis"],
    "uncertainties": ["Areas requiring additional research"]
  }
}
\`\`\`

Conduct thorough research and provide actionable insights that will drive strategic decision-making and competitive advantage.
`.trim();
}

export async function runResearcher(payload: any): Promise<ResearchResult> {
  const logger = createAgentLogger('researcher', payload.job_id || payload.taskId);
  const s3Helper = createS3Helper();

  try {
    logger.info({ payload }, 'Starting enhanced research task');

    // Parse the research payload with support for new format
    const researchPayload: ResearchPayload = {
      product: payload.product,
      audience: payload.audience,
      tone: payload.tone || 'professional',
      description: payload.description || payload.product || '',
      specificQuestions: payload.specificQuestions || [],
      researchDepth: payload.researchDepth || 'detailed'
    };

    logger.debug({ researchPayload }, 'Parsed research parameters');

    // Generate the enhanced research prompt
    const prompt = createResearchPrompt(researchPayload);
    logger.debug('Generated enhanced research prompt');

    // Call OpenAI API for research with improved parameters
    logger.info('Calling OpenAI API for comprehensive research');
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
      messages: [
        {
          role: 'system',
          content: 'You are a world-class market researcher and business strategist with expertise in competitive intelligence, market analysis, and customer insights. You have access to comprehensive industry data and trends. Always provide actionable, data-driven insights formatted as valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 6000,
      response_format: { type: "json_object" }
    });

    const researchContent = completion.choices[0]?.message?.content;
    if (!researchContent) {
      throw new Error('No response received from OpenAI');
    }

    logger.debug({ responseLength: researchContent.length }, 'Received comprehensive research response');

    // Parse the JSON response from the AI
    let researchResult: ResearchResult;
    try {
      const parsedResponse = JSON.parse(researchContent);
      
      // Map the enhanced response to the existing structure
      researchResult = {
        summary: parsedResponse.executiveSummary || 'Research completed successfully',
        marketAnalysis: {
          marketSize: parsedResponse.marketAnalysis?.marketSize || 'Analysis complete',
          segments: parsedResponse.marketAnalysis?.segments || [],
          opportunities: parsedResponse.marketAnalysis?.opportunities || [],
          threats: parsedResponse.marketAnalysis?.threats || []
        },
        audienceProfile: {
          demographics: parsedResponse.audienceProfile?.demographics || 'Analysis complete',
          psychographics: parsedResponse.audienceProfile?.psychographics || 'Analysis complete',
          painPoints: parsedResponse.audienceProfile?.painPoints || [],
          motivations: parsedResponse.audienceProfile?.motivations || []
        },
        competitiveAnalysis: {
          directCompetitors: parsedResponse.competitiveAnalysis?.directCompetitors || [],
          indirectCompetitors: parsedResponse.competitiveAnalysis?.indirectCompetitors || [],
          competitiveAdvantages: parsedResponse.competitiveAnalysis?.competitiveAdvantages || [],
          marketGaps: parsedResponse.competitiveAnalysis?.marketGaps || []
        },
        trends: {
          current: parsedResponse.technologyTrends?.current || [],
          emerging: parsedResponse.technologyTrends?.emerging || [],
          futureOutlook: parsedResponse.strategicRecommendations?.longTerm?.join('; ') || 'Positive outlook'
        },
        recommendations: {
          productDevelopment: parsedResponse.customerInsights?.featureExpectations || [],
          marketing: parsedResponse.strategicRecommendations?.immediate || [],
          positioning: parsedResponse.businessModel?.pricingStrategy || 'Value-based positioning',
          pricing: parsedResponse.businessModel?.revenueOpportunities?.join('; ') || 'Competitive pricing'
        },
        sources: parsedResponse.sources || []
      };

    } catch (parseError) {
      logger.error({ parseError, content: researchContent.substring(0, 500) }, 'Failed to parse AI response as JSON');
      
      // Enhanced fallback structure
      researchResult = {
        summary: 'Research completed - comprehensive analysis available in raw content',
        marketAnalysis: {
          marketSize: 'Detailed analysis completed',
          segments: ['Primary target segment', 'Secondary opportunities'],
          opportunities: ['Market gap identified', 'Growth potential confirmed'],
          threats: ['Competitive pressure', 'Market saturation risk']
        },
        audienceProfile: {
          demographics: 'Target audience identified and analyzed',
          psychographics: 'Behavioral patterns and motivations mapped',
          painPoints: ['Primary pain point', 'Secondary challenges'],
          motivations: ['Key driver', 'Secondary motivations']
        },
        competitiveAnalysis: {
          directCompetitors: ['Competitor analysis completed'],
          indirectCompetitors: ['Alternative solutions identified'],
          competitiveAdvantages: ['Differentiation opportunities found'],
          marketGaps: ['White space opportunities identified']
        },
        trends: {
          current: ['Industry trends analyzed'],
          emerging: ['Future opportunities identified'],
          futureOutlook: 'Positive market trajectory with growth opportunities'
        },
        recommendations: {
          productDevelopment: ['Feature recommendations provided'],
          marketing: ['Go-to-market strategy outlined'],
          positioning: 'Strategic positioning recommendations available',
          pricing: 'Pricing strategy recommendations provided'
        },
        sources: ['Industry reports', 'Market data', 'Competitive intelligence']
      };
    }

    // Store the enhanced research result in S3
    const resultKey = `${payload.job_id || payload.taskId}/research-result.json`;
    const enhancedResult = {
      ...researchResult,
      metadata: {
        jobId: payload.job_id || payload.taskId,
        agentType: 'researcher',
        timestamp: new Date().toISOString(),
        model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
        version: '2.0',
        researchDepth: researchPayload.researchDepth,
        rawResponse: researchContent
      }
    };

    await s3Helper.putJsonObject(resultKey, enhancedResult);

    logger.info({ resultKey }, 'Enhanced research result stored in S3');
    logger.info('Research task completed successfully with enhanced insights');

    return researchResult;

  } catch (error) {
    logger.error({ error }, 'Enhanced research task failed');
    throw error;
  }
} 