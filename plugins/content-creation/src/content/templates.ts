import type { ContentTemplate, ContentType } from '../types.js';

/**
 * Content templates defining structure and guidelines for different content types
 */
export const CONTENT_TEMPLATES: Record<ContentType, ContentTemplate> = {
  thread: {
    name: 'Thread',
    description: 'Twitter/LinkedIn thread - series of connected posts building an argument or telling a story',
    structure: [
      'Hook post (attention-grabbing opening)',
      'Context/setup posts (2-3 posts)',
      'Main content posts (5-8 posts with key points)',
      'Conclusion post with call-to-action or takeaway',
    ],
    styleGuide: `
- Each post should be self-contained but connected to the thread
- Use short, punchy sentences
- Include concrete examples and analogies
- Use line breaks for emphasis and readability
- Number posts if it helps clarity (1/, 2/, etc.)
- End with a strong call-to-action or memorable takeaway
- Keep individual posts under 280 characters for Twitter, under 1000 for LinkedIn
`,
    lengthGuidelines: {
      min: 400,
      optimal: 800,
      max: 1500,
    },
  },

  blog_post: {
    name: 'Blog Post',
    description: 'Long-form article for a blog or personal site',
    structure: [
      'Compelling headline',
      'Opening hook (problem, question, or surprising fact)',
      'Context and background',
      'Main content sections (3-5 key points with examples)',
      'Practical takeaways or actionable insights',
      'Conclusion tying back to the opening',
    ],
    styleGuide: `
- Start with a hook that makes the reader care
- Use subheadings to organize content
- Include concrete examples and case studies
- Break up text with short paragraphs
- Use lists and bullet points for scannability
- End with actionable takeaways
- Aim for clarity and practical value
`,
    lengthGuidelines: {
      min: 800,
      optimal: 1500,
      max: 2500,
    },
  },

  article: {
    name: 'Article',
    description: 'General article - can be for publication, newsletter, or medium',
    structure: [
      'Strong headline',
      'Lead paragraph (who, what, why)',
      'Background and context',
      'Main arguments or findings (3-5 sections)',
      'Supporting evidence and examples',
      'Conclusion and implications',
    ],
    styleGuide: `
- Lead with the most important information
- Use clear, direct language
- Support claims with evidence and examples
- Maintain journalistic objectivity if appropriate
- Use subheadings for structure
- Conclude with broader implications or future outlook
`,
    lengthGuidelines: {
      min: 1000,
      optimal: 1800,
      max: 3000,
    },
  },

  essay: {
    name: 'Essay',
    description: 'Thoughtful, exploratory piece examining an idea or experience',
    structure: [
      'Engaging opening (anecdote, question, or observation)',
      'Thesis or central question',
      'Exploration of different angles (3-5 sections)',
      'Personal insights and reflections',
      'Synthesis and conclusion',
    ],
    styleGuide: `
- More personal and reflective than an article
- Can use first-person perspective freely
- Explore nuance and complexity
- Use storytelling and narrative techniques
- Include personal experiences and insights
- Build toward a deeper understanding or revelation
`,
    lengthGuidelines: {
      min: 1200,
      optimal: 2000,
      max: 3500,
    },
  },

  tutorial: {
    name: 'Tutorial',
    description: 'Step-by-step guide teaching how to do something',
    structure: [
      'Clear title indicating what will be learned',
      'Prerequisites and requirements',
      'Overview of what will be built/learned',
      'Step-by-step instructions (numbered or sectioned)',
      'Explanations of why each step matters',
      'Troubleshooting common issues',
      'Next steps and further learning',
    ],
    styleGuide: `
- Be extremely clear and specific
- Use imperative voice for instructions
- Include code examples or screenshots where relevant
- Explain the "why" not just the "how"
- Anticipate and address common questions
- Test instructions for clarity
- Provide expected outcomes at each step
`,
    lengthGuidelines: {
      min: 800,
      optimal: 1500,
      max: 3000,
    },
  },

  email: {
    name: 'Email',
    description: 'Professional or personal email - concise and purposeful',
    structure: [
      'Clear subject line',
      'Brief greeting',
      'Context (if needed)',
      'Main message or request',
      'Clear call-to-action or next steps',
      'Professional closing',
    ],
    styleGuide: `
- Get to the point quickly
- Use short paragraphs (2-3 sentences max)
- Be specific about what you need
- Make it easy to respond (clear questions or action items)
- Match formality to relationship and context
- Proofread carefully for professionalism
- Respect the recipient's time
`,
    lengthGuidelines: {
      min: 100,
      optimal: 250,
      max: 500,
    },
  },
};

/**
 * Get the template for a specific content type
 */
export function getTemplate(contentType: ContentType): ContentTemplate {
  return CONTENT_TEMPLATES[contentType];
}
