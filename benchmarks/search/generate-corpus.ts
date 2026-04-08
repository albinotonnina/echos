#!/usr/bin/env tsx
/**
 * Generates a synthetic knowledge base for search benchmarks.
 *
 * Creates 3 corpus scales:
 *   small  — 100 notes (10 per topic)
 *   medium — 1 000 notes (100 per topic)
 *   large  — 10 000 notes (1 000 per topic)
 *
 * Run: pnpm tsx benchmarks/search/generate-corpus.ts [small|medium|large|all]
 *
 * Output: benchmarks/search/fixtures/{scale}/  — one .md file per note
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Topic definitions
// ---------------------------------------------------------------------------

interface Topic {
  name: string;
  category: string;
  type: string;
  words: string[];
  titlePrefixes: string[];
  contentSnippets: string[];
}

const TOPICS: Topic[] = [
  {
    name: 'machine-learning',
    category: 'technology',
    type: 'article',
    words: ['neural', 'network', 'gradient', 'backpropagation', 'training', 'model', 'deep', 'learning', 'classification', 'regression', 'feature', 'epoch', 'batch', 'loss', 'accuracy', 'inference', 'embedding', 'transformer', 'attention', 'layer'],
    titlePrefixes: ['Deep Learning', 'Neural Network', 'Model Training', 'Gradient Descent', 'Feature Engineering', 'Transformer Architecture', 'Backpropagation', 'Embedding Layer', 'Loss Function', 'Inference Pipeline'],
    contentSnippets: [
      'Neural networks learn by adjusting weights through backpropagation. Each training epoch processes batches of data to minimize the loss function.',
      'Deep learning models use multiple layers to extract hierarchical features. Gradient descent updates weights to improve classification accuracy.',
      'Transformer architectures use attention mechanisms to process sequential data. Embedding layers map discrete tokens to continuous feature vectors.',
      'Model training requires careful tuning of learning rate, batch size, and regularization. Overfitting occurs when the model memorizes rather than generalizes.',
      'Feature engineering transforms raw input into representations that improve model accuracy. Normalization and dimensionality reduction are common preprocessing steps.',
      'Backpropagation computes gradients of the loss with respect to each weight using the chain rule. The optimizer updates weights to reduce training loss.',
      'Inference is the process of using a trained model to make predictions. Latency and throughput are key metrics for production deployments.',
      'Attention mechanisms allow models to focus on relevant parts of the input sequence. Multi-head attention captures different types of relationships.',
      'Regression models predict continuous values while classification models assign discrete labels. Both use gradient-based optimization during training.',
      'Epoch training involves passing the entire dataset through the network multiple times. Learning rate schedules reduce the step size as training progresses.',
    ],
  },
  {
    name: 'web-development',
    category: 'technology',
    type: 'note',
    words: ['component', 'hook', 'state', 'render', 'typescript', 'javascript', 'browser', 'api', 'frontend', 'backend', 'server', 'client', 'request', 'response', 'css', 'html', 'framework', 'library', 'build', 'deploy'],
    titlePrefixes: ['React Component', 'TypeScript Generics', 'State Management', 'API Design', 'Frontend Performance', 'Server Components', 'Build Pipeline', 'CSS Architecture', 'Hook Patterns', 'Browser Rendering'],
    contentSnippets: [
      'React components are the building blocks of modern frontend applications. Hooks allow functional components to manage state and side effects.',
      'TypeScript adds static typing to JavaScript, catching errors at compile time. Generics enable type-safe reusable components and utilities.',
      'State management in complex applications requires careful design. Context API and external state libraries help share state across component trees.',
      'REST APIs communicate via HTTP request and response cycles. Proper status codes and error handling improve client-server reliability.',
      'Frontend performance depends on bundle size, render blocking resources, and caching strategies. Code splitting reduces initial load time.',
      'Server components execute on the server, reducing client-side JavaScript. They can access databases and file systems directly without API calls.',
      'Build pipelines transform source TypeScript and CSS into optimized browser bundles. Tree shaking removes unused code to minimize payload.',
      'CSS architecture using utility classes or component scoping prevents style conflicts. Custom properties enable consistent theming.',
      'Custom hooks encapsulate reusable stateful logic. They follow the same rules as built-in hooks and enable composition of behavior.',
      'Browser rendering involves parsing HTML, applying CSS, and executing JavaScript. Layout thrashing occurs when reads and writes to the DOM are interleaved.',
    ],
  },
  {
    name: 'health-fitness',
    category: 'health',
    type: 'note',
    words: ['exercise', 'nutrition', 'sleep', 'recovery', 'strength', 'cardio', 'muscle', 'protein', 'calories', 'workout', 'rest', 'inflammation', 'wellness', 'habit', 'routine', 'metabolism', 'endurance', 'flexibility', 'hydration', 'stress'],
    titlePrefixes: ['Strength Training', 'Nutrition Protocol', 'Sleep Optimization', 'Recovery Strategy', 'Cardio Programming', 'Protein Timing', 'Workout Structure', 'Habit Formation', 'Metabolic Health', 'Stress Management'],
    contentSnippets: [
      'Strength training induces muscle hypertrophy through progressive overload. Recovery between sessions allows muscles to adapt and grow stronger.',
      'Protein intake supports muscle protein synthesis after exercise. Consuming adequate calories prevents catabolism during intense training blocks.',
      'Quality sleep is essential for physical recovery and hormonal regulation. Poor sleep elevates cortisol and impairs muscle recovery.',
      'Inflammation is a natural response to exercise stress. Chronic inflammation from overtraining without adequate rest impairs performance.',
      'Cardio exercise improves cardiovascular endurance and metabolic flexibility. Zone 2 training builds aerobic base without excessive fatigue.',
      'Habit stacking links new wellness routines to existing behaviors. Consistent workout schedules outperform sporadic high-intensity efforts.',
      'Metabolism determines how efficiently the body converts food to energy. Muscle mass increases basal metabolic rate over time.',
      'Flexibility and mobility work reduces injury risk and improves movement quality. Dynamic warm-ups prepare joints for loaded exercise.',
      'Hydration affects exercise performance, cognitive function, and recovery. Electrolyte balance becomes critical during prolonged endurance efforts.',
      'Stress management through breathing and mindfulness reduces cortisol. High stress impairs sleep quality and inhibits muscle recovery.',
    ],
  },
  {
    name: 'investing-finance',
    category: 'finance',
    type: 'article',
    words: ['portfolio', 'dividend', 'compound', 'interest', 'stock', 'bond', 'equity', 'market', 'return', 'risk', 'diversification', 'index', 'fund', 'allocation', 'rebalance', 'inflation', 'yield', 'valuation', 'earnings', 'cashflow'],
    titlePrefixes: ['Portfolio Allocation', 'Dividend Investing', 'Compound Interest', 'Risk Management', 'Index Fund Strategy', 'Bond Valuation', 'Equity Analysis', 'Asset Rebalancing', 'Inflation Hedging', 'Cashflow Investing'],
    contentSnippets: [
      'Diversification across asset classes reduces portfolio volatility without sacrificing expected return. Correlation between assets determines the diversification benefit.',
      'Compound interest allows returns to generate their own returns. Long time horizons amplify the effect of early investment contributions.',
      'Dividend-paying stocks provide regular income and historically outperform during market downturns. Dividend reinvestment accelerates compound growth.',
      'Risk management requires understanding the difference between volatility and permanent capital loss. Position sizing limits downside exposure.',
      'Index funds provide low-cost market exposure by tracking a benchmark. Active fund managers rarely outperform their index after fees.',
      'Bond yields move inversely to prices. Duration measures sensitivity to interest rate changes in a fixed-income portfolio.',
      'Equity valuation uses earnings multiples, discounted cashflow, and comparable company analysis. Margin of safety protects against valuation errors.',
      'Rebalancing restores target asset allocation by selling winners and buying laggards. Tax-efficient rebalancing uses new contributions first.',
      'Inflation erodes the purchasing power of fixed-income returns. Real assets, TIPS, and equities provide inflation hedging properties.',
      'Free cashflow is the ultimate measure of business value creation. Companies that convert earnings to cashflow consistently command premium valuations.',
    ],
  },
  {
    name: 'cooking-food',
    category: 'lifestyle',
    type: 'note',
    words: ['recipe', 'ingredient', 'technique', 'flavor', 'texture', 'temperature', 'seasoning', 'cuisine', 'protein', 'vegetable', 'sauce', 'roast', 'saute', 'bake', 'marinate', 'ferment', 'umami', 'balance', 'kitchen', 'meal'],
    titlePrefixes: ['Roasting Technique', 'Sauce Fundamentals', 'Fermentation Guide', 'Seasoning Balance', 'Protein Cooking', 'Vegetable Preparation', 'Baking Science', 'Cuisine Exploration', 'Umami Development', 'Meal Planning'],
    contentSnippets: [
      'Roasting concentrates flavors through caramelization and Maillard reaction. High temperature and dry heat produce complex savory notes in vegetables and proteins.',
      'Building sauces requires understanding fat emulsification and reduction. A good sauce balances acid, fat, and seasoning to complement the main ingredient.',
      'Fermentation transforms ingredients through microbial activity. Lacto-fermented vegetables develop complex umami flavors and beneficial probiotics.',
      'Seasoning at each cooking stage layers flavor. Salt draws out moisture, enhances sweetness, and suppresses bitterness throughout the cooking process.',
      'Protein cooking temperature determines texture. Overcooking denatures proteins and expels moisture, resulting in tough, dry textures.',
      'Vegetable preparation technique affects final texture and nutrition. Blanching sets color while roasting intensifies natural sugars.',
      'Baking is a precise science where flour gluten development and leavening agents determine crumb structure and rise.',
      'Exploring diverse cuisines reveals different approaches to flavor balance. Acid and heat in Thai cuisine contrast with the umami depth of Japanese cooking.',
      'Umami, the fifth taste, comes from glutamate-rich ingredients like mushrooms, aged cheese, and fermented sauces. Combining umami sources creates depth.',
      'Meal planning reduces food waste and ensures nutritional balance. Batch cooking proteins and grains creates flexible building blocks for multiple meals.',
    ],
  },
  {
    name: 'philosophy',
    category: 'philosophy',
    type: 'article',
    words: ['consciousness', 'ethics', 'epistemology', 'metaphysics', 'reasoning', 'logic', 'knowledge', 'truth', 'reality', 'mind', 'identity', 'free', 'will', 'morality', 'virtue', 'justice', 'existence', 'perception', 'thought', 'belief'],
    titlePrefixes: ['Consciousness Theory', 'Ethical Framework', 'Epistemological Limits', 'Metaphysical Inquiry', 'Logic and Reasoning', 'Theory of Knowledge', 'Free Will Debate', 'Moral Philosophy', 'Virtue Ethics', 'Philosophy of Mind'],
    contentSnippets: [
      'Consciousness remains one of philosophy\'s hardest problems. The subjective experience of qualia resists reduction to purely physical descriptions.',
      'Ethical frameworks provide systematic approaches to moral reasoning. Consequentialism evaluates actions by outcomes while deontology focuses on duties.',
      'Epistemology examines the nature, sources, and limits of knowledge. Justified true belief has been challenged by Gettier problems.',
      'Metaphysics investigates fundamental questions about existence, identity, and causality. The debate between realism and idealism shapes scientific interpretation.',
      'Logical reasoning distinguishes valid argument forms from fallacious ones. Deductive validity guarantees true conclusions from true premises.',
      'Knowledge requires more than belief — it demands justification. Social epistemology examines how knowledge is constructed and transmitted.',
      'The free will debate centers on whether determinism is compatible with moral responsibility. Compatibilists argue that freedom consists in acting on one\'s desires.',
      'Moral philosophy seeks foundations for ethical judgment. Natural law, social contract, and care ethics each offer distinct grounding principles.',
      'Virtue ethics focuses on character rather than rules or consequences. Aristotle\'s eudaimonia describes human flourishing through cultivated virtues.',
      'The philosophy of mind examines the relationship between mental states and physical processes. Functionalism identifies mental states by their causal roles.',
    ],
  },
  {
    name: 'history-culture',
    category: 'history',
    type: 'article',
    words: ['civilization', 'ancient', 'medieval', 'revolution', 'empire', 'tradition', 'culture', 'dynasty', 'war', 'conquest', 'trade', 'archaeology', 'artifact', 'society', 'governance', 'religion', 'migration', 'period', 'era', 'heritage'],
    titlePrefixes: ['Ancient Civilization', 'Medieval Society', 'Revolutionary Period', 'Empire and Conquest', 'Trade Routes', 'Cultural Heritage', 'Dynasty Analysis', 'Archaeological Find', 'Governance Evolution', 'Migration Patterns'],
    contentSnippets: [
      'Ancient civilizations developed writing, agriculture, and governance independently in multiple river valleys. Trade networks connected these early cultures.',
      'Medieval society was organized around feudal obligations and religious authority. Monasteries preserved classical knowledge through the dark ages.',
      'Revolutions reshape political and social orders through rapid, often violent change. The underlying causes include economic inequality and institutional failure.',
      'Empires expand through military conquest, economic domination, and cultural assimilation. Their collapse often triggers migrations and cultural transformation.',
      'Trade routes transmitted not just goods but ideas, religions, and technologies. The Silk Road connected East Asian and Mediterranean civilizations.',
      'Cultural heritage encompasses tangible artifacts and intangible practices. Archaeology reconstructs past societies from material remains.',
      'Dynasties concentrate political power across generations. Succession crises frequently destabilize governance and trigger civil war.',
      'Archaeological finds reveal daily life, beliefs, and trade connections of ancient peoples. Stratigraphy dates artifacts by their position in soil layers.',
      'Governance evolved from tribal chiefdoms to city-states to nation-states. Democratic institutions emerged independently in Athens and other cultures.',
      'Migration patterns shaped the genetic, linguistic, and cultural diversity of modern populations. Climate change has historically driven large-scale migrations.',
    ],
  },
  {
    name: 'science-nature',
    category: 'science',
    type: 'article',
    words: ['biology', 'chemistry', 'physics', 'ecology', 'evolution', 'molecule', 'cell', 'organism', 'energy', 'matter', 'quantum', 'particle', 'photosynthesis', 'dna', 'species', 'adaptation', 'climate', 'ecosystem', 'thermodynamics', 'entropy'],
    titlePrefixes: ['Evolutionary Biology', 'Quantum Physics', 'Ecosystem Dynamics', 'DNA Replication', 'Thermodynamics', 'Species Adaptation', 'Molecular Chemistry', 'Climate Science', 'Cell Biology', 'Particle Physics'],
    contentSnippets: [
      'Evolution by natural selection explains the diversity of life on Earth. DNA mutations provide variation that selection acts upon across generations.',
      'Quantum mechanics describes matter and energy at subatomic scales. Wave-particle duality and the uncertainty principle challenge classical intuitions.',
      'Ecosystems are complex networks of organisms and their physical environment. Energy flows from producers to consumers through trophic levels.',
      'DNA replication ensures genetic information is accurately copied before cell division. Repair enzymes correct errors to maintain genomic integrity.',
      'Thermodynamics governs energy transformations in all physical and chemical processes. The second law states that entropy increases in isolated systems.',
      'Species adapt to environmental pressures through natural selection over generations. Convergent evolution produces similar traits in unrelated lineages.',
      'Molecular chemistry explains how atoms form bonds to create compounds with distinct properties. Reaction kinetics determines how fast chemical processes proceed.',
      'Climate science models the complex interactions between atmosphere, ocean, and land. Feedback loops amplify or dampen the effects of perturbations.',
      'Cell biology reveals the molecular machinery of life. Organelles perform specialized functions within the membrane-bounded cellular environment.',
      'Particle physics seeks the fundamental constituents of matter. The Standard Model describes quarks, leptons, and force-carrying bosons.',
    ],
  },
  {
    name: 'entrepreneurship',
    category: 'business',
    type: 'note',
    words: ['startup', 'product', 'market', 'funding', 'growth', 'pivot', 'traction', 'revenue', 'customer', 'validation', 'mvp', 'iteration', 'scale', 'team', 'culture', 'investor', 'pitch', 'competitive', 'moat', 'acquisition'],
    titlePrefixes: ['Startup Validation', 'Product-Market Fit', 'MVP Strategy', 'Growth Hacking', 'Investor Pitch', 'Team Building', 'Revenue Model', 'Competitive Moat', 'Customer Acquisition', 'Scaling Operations'],
    contentSnippets: [
      'Startup success requires validating product-market fit before scaling. Early customer interviews reveal whether the problem is worth solving.',
      'Building an MVP focuses on delivering core value quickly. Iteration based on user feedback guides product development toward market fit.',
      'Growth strategies must balance acquisition cost against lifetime customer value. Viral loops and referral programs reduce dependence on paid acquisition.',
      'Investor pitches require a compelling narrative, clear market size, and demonstrated traction. Term sheet negotiation determines control and dilution.',
      'Team culture is a sustainable competitive advantage. Hiring for values and complementary skills builds resilience through startup volatility.',
      'Revenue models must align incentives between the company and its customers. Subscription models provide predictable cashflow and reduce churn risk.',
      'Competitive moats prevent rivals from replicating your advantages. Network effects, switching costs, and proprietary data create durable defensibility.',
      'Customer acquisition channels vary by product type and market segment. B2B sales cycles differ fundamentally from consumer viral growth strategies.',
      'Scaling operations requires systematizing what worked at small scale. Process documentation and delegation enable growth without founder bottlenecks.',
      'Pivoting changes the product or market while preserving learned insights. The best pivots are driven by data, not desperation.',
    ],
  },
  {
    name: 'travel',
    category: 'lifestyle',
    type: 'note',
    words: ['destination', 'exploration', 'culture', 'geography', 'accommodation', 'itinerary', 'landscape', 'cuisine', 'local', 'adventure', 'journey', 'transport', 'visa', 'budget', 'packing', 'photography', 'experience', 'discovery', 'passport', 'distance'],
    titlePrefixes: ['Travel Planning', 'Destination Guide', 'Budget Travel', 'Photography Tips', 'Cultural Immersion', 'Adventure Itinerary', 'Packing Strategy', 'Local Cuisine', 'Transport Planning', 'Visa Requirements'],
    contentSnippets: [
      'Destination research transforms travel from tourism to genuine cultural immersion. Understanding local customs prevents unintentional offense.',
      'Budget travel prioritizes experiences over accommodation comfort. Slow travel reduces transport costs and enables deeper connections with places.',
      'Travel photography captures authentic moments by moving beyond tourist attractions. Early morning light and local markets offer compelling subjects.',
      'Cultural immersion requires learning basic local language phrases. Even imperfect attempts at communication are appreciated by locals.',
      'Adventure travel pushes comfort zone boundaries and builds resilience. Physical challenges in unfamiliar landscapes create lasting memories.',
      'Itinerary planning balances structured activities with unscheduled exploration time. Over-planning prevents serendipitous discoveries.',
      'Packing light reduces travel friction and increases flexibility. A capsule wardrobe of versatile layers handles diverse climates.',
      'Local cuisine reveals cultural history and regional geography. Street food often offers the most authentic and affordable culinary experiences.',
      'Transport planning for remote destinations requires backup options. Land borders and overland routes open destinations that flights cannot reach.',
      'Visa requirements vary significantly by passport and destination. Early research prevents last-minute disruptions to carefully planned itineraries.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Corpus generation
// ---------------------------------------------------------------------------

export interface CorpusNote {
  id: string;
  topicIndex: number;
  topicName: string;
  type: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  created: string;
  updated: string;
}

/**
 * Generates a deterministic ISO date offset from a reference time.
 * ageDays=0 → now, ageDays=365 → 1 year ago
 */
function generateDate(ageDays: number): string {
  const REF_DATE = new Date('2026-04-08T12:00:00Z');
  const ms = REF_DATE.getTime() - ageDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

/**
 * Generates a single corpus note deterministically from its index and topic.
 *
 * Within each topic, notes are spread across a time range:
 *   - First 10%: very recent (1–7 days old)
 *   - Next 40%: medium age (30–180 days old)
 *   - Last 50%: old (365–730 days old)
 */
export function generateNote(globalIndex: number, topicIndex: number, noteIndexInTopic: number, scale: string): CorpusNote {
  const topic = TOPICS[topicIndex]!;
  const rng = mulberry32(hashStr(`${scale}-${topicIndex}-${noteIndexInTopic}`));

  const notesPerTopic = scale === 'small' ? 10 : scale === 'medium' ? 100 : 1000;
  const recentCutoff = Math.floor(notesPerTopic * 0.1);
  const mediumCutoff = Math.floor(notesPerTopic * 0.5);

  let ageDays: number;
  if (noteIndexInTopic < recentCutoff) {
    ageDays = 1 + Math.floor(rng() * 6); // 1–7 days
  } else if (noteIndexInTopic < mediumCutoff) {
    ageDays = 30 + Math.floor(rng() * 150); // 30–180 days
  } else {
    ageDays = 365 + Math.floor(rng() * 365); // 365–730 days
  }

  const titleIdx = noteIndexInTopic % topic.titlePrefixes.length;
  const contentIdx = noteIndexInTopic % topic.contentSnippets.length;

  const titlePrefix = topic.titlePrefixes[titleIdx]!;
  const contentBase = topic.contentSnippets[contentIdx]!;

  // Pick 2-3 extra topic words to enrich the content
  const extraWords: string[] = [];
  const wordRng = mulberry32(hashStr(`words-${scale}-${topicIndex}-${noteIndexInTopic}`));
  const wordCount = 2 + Math.floor(wordRng() * 2);
  const usedIndices = new Set<number>();
  for (let w = 0; w < wordCount; w++) {
    let idx: number;
    do {
      idx = Math.floor(wordRng() * topic.words.length);
    } while (usedIndices.has(idx));
    usedIndices.add(idx);
    extraWords.push(topic.words[idx]!);
  }

  const seq = String(globalIndex + 1).padStart(5, '0');
  const id = `bench-${scale[0]}-${seq}`;

  const created = generateDate(ageDays);
  const content = `${contentBase}\n\nKey concepts: ${extraWords.join(', ')}.`;

  const tags = [topic.name, topic.category];
  if (noteIndexInTopic < recentCutoff) tags.push('recent');

  return {
    id,
    topicIndex,
    topicName: topic.name,
    type: topic.type,
    category: topic.category,
    title: `${titlePrefix} ${seq}`,
    content,
    tags,
    created,
    updated: created,
  };
}

function noteToMarkdown(note: CorpusNote): string {
  return [
    '---',
    `id: ${note.id}`,
    `type: ${note.type}`,
    `title: "${note.title}"`,
    `category: ${note.category}`,
    `tags: [${note.tags.map((t) => `"${t}"`).join(', ')}]`,
    `links: []`,
    `created: ${note.created}`,
    `updated: ${note.updated}`,
    '---',
    '',
    `# ${note.title}`,
    '',
    note.content,
    '',
  ].join('\n');
}

function generateScale(scale: 'small' | 'medium' | 'large'): CorpusNote[] {
  const notesPerTopic = scale === 'small' ? 10 : scale === 'medium' ? 100 : 1000;
  const notes: CorpusNote[] = [];

  for (let t = 0; t < TOPICS.length; t++) {
    for (let n = 0; n < notesPerTopic; n++) {
      const globalIndex = t * notesPerTopic + n;
      notes.push(generateNote(globalIndex, t, n, scale));
    }
  }

  return notes;
}

function writeCorpus(scale: 'small' | 'medium' | 'large'): void {
  const outDir = join(__dirname, 'fixtures', scale);
  mkdirSync(outDir, { recursive: true });

  const notes = generateScale(scale);
  let written = 0;

  for (const note of notes) {
    const fileName = `${note.id}.md`;
    writeFileSync(join(outDir, fileName), noteToMarkdown(note));
    written++;
  }

  // Write a manifest JSON for fast loading in the benchmark runner
  const manifest = notes.map((n) => ({
    id: n.id,
    topicIndex: n.topicIndex,
    topicName: n.topicName,
    type: n.type,
    category: n.category,
    title: n.title,
    tags: n.tags,
    created: n.created,
    updated: n.updated,
  }));
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`[${scale}] wrote ${written} notes + manifest.json → ${outDir}`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const arg = process.argv[2] ?? 'all';
const scales = arg === 'all' ? ['small', 'medium', 'large'] : [arg];

for (const scale of scales) {
  if (scale !== 'small' && scale !== 'medium' && scale !== 'large') {
    console.error(`Unknown scale: ${scale}. Use small, medium, large, or all.`);
    process.exit(1);
  }
  writeCorpus(scale);
}
