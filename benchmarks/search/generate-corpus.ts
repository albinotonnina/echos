#!/usr/bin/env tsx
/**
 * Generate a synthetic knowledge base for search benchmarks.
 *
 * Produces 3 corpus scales: small (100 notes), medium (1,000 notes), large (10,000 notes).
 * All output is deterministic — the same seed produces the same corpus.
 * Outputs markdown files and a notes-index.json to benchmarks/search/fixtures/{scale}/.
 *
 * Usage: tsx benchmarks/search/generate-corpus.ts [--force]
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const FORCE = process.argv.includes('--force');

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function createPrng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function pickRng<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function pickMultipleRng<T>(rng: () => number, arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

function intRng(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Corpus definitions
// ---------------------------------------------------------------------------

export const CONTENT_TYPES = ['article', 'note', 'highlight', 'conversation'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface Topic {
  id: string;
  name: string;
  /** Core terms that appear in every note — drive semantic similarity */
  coreKeywords: string[];
  /** Additional domain terms used for content variation */
  extraKeywords: string[];
  /** Named entities for multi-hop queries */
  entities: string[];
  /** Category for the note */
  category: string;
  /** Tags always applied to notes in this topic */
  baseTags: string[];
}

export const TOPICS: Topic[] = [
  {
    id: 't0',
    name: 'Machine Learning',
    coreKeywords: ['machine learning', 'neural network', 'training', 'model', 'accuracy'],
    extraKeywords: [
      'deep learning', 'gradient descent', 'overfitting', 'classification', 'regression',
      'dataset', 'feature engineering', 'convolutional', 'transformer', 'backpropagation',
      'hyperparameter', 'epoch', 'batch size', 'loss function', 'optimizer',
    ],
    entities: ['TensorFlow', 'PyTorch', 'Hugging Face', 'ImageNet', 'BERT'],
    category: 'technology',
    baseTags: ['machine-learning', 'ai'],
  },
  {
    id: 't1',
    name: 'Cooking',
    coreKeywords: ['recipe', 'ingredient', 'cooking', 'kitchen', 'flavor'],
    extraKeywords: [
      'bake', 'sauté', 'simmer', 'chop', 'seasoning', 'cuisine', 'chef',
      'oven', 'skillet', 'marinade', 'garnish', 'umami', 'texture', 'pairing',
    ],
    entities: ['Julia Child', 'Gordon Ramsay', 'Mediterranean', 'French cuisine', 'Maillard reaction'],
    category: 'food',
    baseTags: ['cooking', 'food'],
  },
  {
    id: 't2',
    name: 'Climate Change',
    coreKeywords: ['climate', 'emissions', 'carbon', 'temperature', 'renewable energy'],
    extraKeywords: [
      'CO2', 'greenhouse gas', 'solar', 'wind power', 'deforestation', 'sea level',
      'fossil fuels', 'sustainability', 'carbon footprint', 'IPCC', 'net zero',
      'glacier', 'drought', 'biodiversity', 'methane',
    ],
    entities: ['Paris Agreement', 'IPCC', 'Greta Thunberg', 'COP26', 'NASA'],
    category: 'environment',
    baseTags: ['climate', 'environment'],
  },
  {
    id: 't3',
    name: 'Personal Finance',
    coreKeywords: ['investing', 'portfolio', 'savings', 'budget', 'compound interest'],
    extraKeywords: [
      'stocks', 'bonds', 'ETF', 'index fund', 'dividend', 'retirement', 'Roth IRA',
      'expense ratio', 'asset allocation', 'rebalancing', 'net worth', '401k',
      'emergency fund', 'dollar cost averaging', 'passive income',
    ],
    entities: ['Vanguard', 'Warren Buffett', 'S&P 500', 'Federal Reserve', 'Bogleheads'],
    category: 'finance',
    baseTags: ['finance', 'investing'],
  },
  {
    id: 't4',
    name: 'Travel',
    coreKeywords: ['travel', 'destination', 'adventure', 'culture', 'passport'],
    extraKeywords: [
      'backpacking', 'sightseeing', 'hostel', 'local cuisine', 'itinerary', 'flight',
      'visa', 'exchange rate', 'landmark', 'off the beaten path', 'budget travel',
      'photography', 'hiking', 'beach', 'museum',
    ],
    entities: ['Airbnb', 'Tokyo', 'Barcelona', 'Machu Picchu', 'Lonely Planet'],
    category: 'travel',
    baseTags: ['travel', 'adventure'],
  },
  {
    id: 't5',
    name: 'Programming',
    coreKeywords: ['code', 'software', 'algorithm', 'debugging', 'API'],
    extraKeywords: [
      'refactoring', 'test coverage', 'TypeScript', 'framework', 'deployment',
      'microservices', 'database', 'async', 'performance', 'memory leak',
      'design pattern', 'open source', 'version control', 'CI/CD', 'container',
    ],
    entities: ['GitHub', 'Stack Overflow', 'Node.js', 'Docker', 'Kubernetes'],
    category: 'technology',
    baseTags: ['programming', 'software'],
  },
  {
    id: 't6',
    name: 'Health & Fitness',
    coreKeywords: ['exercise', 'workout', 'fitness', 'nutrition', 'strength'],
    extraKeywords: [
      'running', 'cardio', 'resistance training', 'protein', 'recovery', 'sleep',
      'hydration', 'flexibility', 'HIIT', 'deadlift', 'squat', 'bench press',
      'VO2 max', 'heart rate', 'calorie deficit',
    ],
    entities: ['Garmin', 'Strava', 'CrossFit', 'Olympia', 'Dr. Peter Attia'],
    category: 'health',
    baseTags: ['fitness', 'health'],
  },
  {
    id: 't7',
    name: 'History',
    coreKeywords: ['history', 'civilization', 'empire', 'war', 'ancient'],
    extraKeywords: [
      'medieval', 'renaissance', 'revolution', 'dynasty', 'artifact', 'archaeology',
      'colonialism', 'trade route', 'plague', 'political power', 'religion',
      'manuscript', 'Bronze Age', 'Iron Age', 'Enlightenment',
    ],
    entities: ['Rome', 'Ancient Greece', 'Mongol Empire', 'Julius Caesar', 'Silk Road'],
    category: 'history',
    baseTags: ['history', 'culture'],
  },
];

// ---------------------------------------------------------------------------
// Note generation
// ---------------------------------------------------------------------------

const NOTE_TITLES: Record<string, string[]> = {
  t0: [
    'Understanding Backpropagation in Neural Networks',
    'Hyperparameter Tuning Strategies for Deep Learning',
    'Overfitting and Regularization Techniques',
    'Transfer Learning with Pre-trained Models',
    'Introduction to Gradient Descent Variants',
    'Feature Engineering Best Practices',
    'Convolutional Neural Networks for Image Classification',
    'Attention Mechanisms and Transformers',
    'Evaluating Model Accuracy and Loss Functions',
    'Building a Training Pipeline from Scratch',
    'Dataset Augmentation for Better Generalization',
    'Comparing Supervised and Unsupervised Learning',
  ],
  t1: [
    'Mastering the Art of Sautéing Vegetables',
    'How to Balance Flavors in Any Recipe',
    'Essential Kitchen Tools Every Cook Needs',
    'The Science Behind the Maillard Reaction',
    'Perfecting Homemade Bread Baking',
    'Understanding Marinades and Their Chemistry',
    'Building Umami in Plant-Based Cooking',
    'Seasoning at Every Stage of Cooking',
    'French Mother Sauces Explained',
    'Mise en Place: The Chef Method',
    'Fermentation Basics for Home Cooks',
    'Pairing Spices with Proteins',
  ],
  t2: [
    'Understanding the Carbon Budget',
    'How Solar Energy is Transforming the Grid',
    'Deforestation and Its Effect on CO2 Levels',
    'The IPCC Sixth Assessment Report Summary',
    'Methane Emissions from Agriculture',
    'Sea Level Rise Projections to 2100',
    'Net Zero Commitments from Major Economies',
    'Glacier Retreat as a Climate Indicator',
    'Wind Power Economics and Capacity Factors',
    'COP26 Outcomes and Unmet Targets',
    'Biodiversity Loss and Climate Feedback',
    'Carbon Capture Technology Overview',
  ],
  t3: [
    'Dollar Cost Averaging Explained',
    'How Index Funds Beat Active Management',
    'Building an Emergency Fund Strategy',
    'Understanding Asset Allocation by Age',
    'Dividend Reinvestment for Long-term Growth',
    'Roth IRA vs Traditional IRA Comparison',
    'Expense Ratios and Why They Matter',
    'The Power of Compound Interest Visualized',
    'Rebalancing Your Portfolio Annually',
    'ETFs vs Mutual Funds for Passive Investing',
    'Tax-loss Harvesting Strategies',
    'Net Worth Tracking and Financial Milestones',
  ],
  t4: [
    'Backpacking Southeast Asia on a Budget',
    'Hidden Gems in Barcelona Beyond the Tourist Trail',
    'How to Get a Visa for Japan',
    'Travel Photography Tips for Beginners',
    'Planning a Machu Picchu Trek Itinerary',
    'Managing Currency Exchange While Traveling',
    'Staying Safe as a Solo Traveler',
    'Finding Authentic Local Cuisine Abroad',
    'Using Airbnb vs Hostels for Budget Travel',
    'Off-Season Travel: Pros and Cons',
    'Tokyo Neighborhood Guide for First Timers',
    'Cultural Etiquette for International Travelers',
  ],
  t5: [
    'Refactoring Legacy Code with Confidence',
    'Test Coverage Strategies for Modern APIs',
    'Debugging Memory Leaks in Node.js',
    'Microservices vs Monolith Architecture Tradeoffs',
    'TypeScript Strict Mode Best Practices',
    'Building a CI/CD Pipeline with GitHub Actions',
    'Container Orchestration with Kubernetes',
    'Designing RESTful APIs That Last',
    'Async/Await Patterns and Pitfalls',
    'Open Source Contribution Guide',
    'Database Indexing for Performance',
    'Design Patterns in Modern Software Development',
  ],
  t6: [
    'Building a Strength Training Program',
    'Nutrition for Endurance Running',
    'Recovery: Sleep, Hydration, and Stretching',
    'HIIT Workouts for Maximum Efficiency',
    'Understanding VO2 Max and Cardio Fitness',
    'Progressive Overload in Resistance Training',
    'Protein Intake Guide for Muscle Growth',
    'Heart Rate Zones Explained',
    'Deadlift Form Cues and Common Mistakes',
    'Calorie Deficit Strategies That Work',
    'Tracking Fitness Progress with Strava',
    'CrossFit vs Traditional Gym Training',
  ],
  t7: [
    'The Fall of the Roman Empire Revisited',
    'Silk Road Trade Networks and Cultural Exchange',
    'The Black Death and Medieval Society',
    'How the Mongol Empire Shaped Eurasia',
    'The Bronze Age Collapse: Causes and Effects',
    'Ancient Greek Philosophy and Its Legacy',
    'European Colonialism and the African Continent',
    'The Enlightenment and Political Revolution',
    'Archaeology of Ancient Mesopotamia',
    'Julius Caesar: Politician and General',
    'The Iron Age and Technological Innovation',
    'Religious Power in Medieval Europe',
  ],
};

// Content templates per topic (core sentence patterns)
function buildNoteContent(
  topic: Topic,
  titleIdx: number,
  variant: number,
  rng: () => number,
): string {
  const core = topic.coreKeywords.join(', ');
  const extras = pickMultipleRng(rng, topic.extraKeywords, 4);
  const entity = pickRng(rng, topic.entities);
  const titleList = NOTE_TITLES[topic.id] ?? [];
  const baseTitle = titleList[titleIdx % titleList.length] ?? `${topic.name} Note ${variant}`;

  const intro = `${baseTitle} explores key concepts in ${topic.name.toLowerCase()}, covering ${core}.`;
  const body = `
This note examines ${extras[0]} and ${extras[1]} within the context of ${topic.name.toLowerCase()}.
${entity} is often referenced when discussing ${extras[2]} and ${extras[3]}.
Understanding ${topic.coreKeywords[0]} is essential for mastering ${topic.coreKeywords[1]}.
Practitioners regularly apply ${extras[0]} techniques alongside ${topic.coreKeywords[2]}.
Further exploration of ${topic.coreKeywords[3]} and ${topic.coreKeywords[4]} leads to deeper insight.
Variant detail ${variant}: ${pickRng(rng, topic.extraKeywords)} approach with ${pickRng(rng, topic.extraKeywords)} considerations.
`.trim();

  return `${intro}\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Date generation
// ---------------------------------------------------------------------------

// Reference date: 2026-04-08 (today per system context)
const REF_DATE = new Date('2026-04-08T12:00:00.000Z');

function ageToIso(ageMs: number): string {
  return new Date(REF_DATE.getTime() - ageMs).toISOString();
}

/** Age buckets: recent(0-30d), medium(31-180d), old(181-365d), veryOld(366-730d) */
const AGE_BUCKETS = [
  { weight: 0.2, minDays: 1, maxDays: 30 },
  { weight: 0.3, minDays: 31, maxDays: 180 },
  { weight: 0.3, minDays: 181, maxDays: 365 },
  { weight: 0.2, minDays: 366, maxDays: 730 },
];

function randomAgeMs(rng: () => number): number {
  const r = rng();
  let cumulative = 0;
  let chosen = AGE_BUCKETS[AGE_BUCKETS.length - 1]!;
  for (const bucket of AGE_BUCKETS) {
    cumulative += bucket.weight;
    if (r < cumulative) {
      chosen = bucket;
      break;
    }
  }
  const days = intRng(rng, chosen.minDays, chosen.maxDays);
  return days * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Exported note record
// ---------------------------------------------------------------------------

export interface BenchmarkNoteRecord {
  id: string;
  topicId: string;
  type: ContentType;
  title: string;
  content: string;
  tags: string[];
  category: string;
  created: string;
  updated: string;
}

export interface CorpusIndex {
  scale: string;
  noteCount: number;
  notes: BenchmarkNoteRecord[];
}

// ---------------------------------------------------------------------------
// Corpus generation
// ---------------------------------------------------------------------------

interface ScaleConfig {
  name: string;
  count: number;
}

const SCALES: ScaleConfig[] = [
  { name: 'small', count: 100 },
  { name: 'medium', count: 1000 },
  { name: 'large', count: 10000 },
];

function generateCorpus(scale: ScaleConfig, seed: number): BenchmarkNoteRecord[] {
  const rng = createPrng(seed);

  const notesPerTopic = Math.floor(scale.count * 0.96 / TOPICS.length);
  const needleCount = scale.count - notesPerTopic * TOPICS.length;

  const records: BenchmarkNoteRecord[] = [];
  const contentTypeWeights: ContentType[] = [
    'article', 'article', 'article', 'article', 'article',
    'note', 'note', 'note', 'note',
    'highlight', 'highlight', 'highlight',
    'conversation',
  ];

  // Topic notes
  for (const topic of TOPICS) {
    const titleList = NOTE_TITLES[topic.id] ?? [];
    for (let i = 0; i < notesPerTopic; i++) {
      const id = `bench-${topic.id}-${String(i).padStart(4, '0')}`;
      const titleIdx = i % titleList.length;
      const type = pickRng(rng, contentTypeWeights);
      const title = titleList[titleIdx] ?? `${topic.name} Note ${i}`;
      const content = buildNoteContent(topic, titleIdx, i, rng);
      const extraTags = pickMultipleRng(rng, topic.extraKeywords.slice(0, 6), intRng(rng, 1, 3));
      const tags = [...topic.baseTags, ...extraTags.map((t) => t.toLowerCase().replace(/\s+/g, '-'))];
      const ageMs = randomAgeMs(rng);

      records.push({
        id,
        topicId: topic.id,
        type,
        title: i > 0 && i % titleList.length === titleIdx ? `${title} (Part ${Math.floor(i / titleList.length) + 1})` : title,
        content,
        tags,
        category: topic.category,
        created: ageToIso(ageMs),
        updated: ageToIso(Math.max(0, ageMs - intRng(rng, 0, 7) * 86400000)),
      });
    }
  }

  // Needle notes — highly specific content for needle-in-haystack queries
  const NEEDLES = [
    {
      id: 'bench-needle-0000',
      topicId: 'needle',
      type: 'note' as ContentType,
      title: 'AlphaGo Zero Self-Play Training Technique',
      content:
        'AlphaGo Zero achieved superhuman Go performance through pure self-play reinforcement learning ' +
        'without any human game data. The Monte Carlo Tree Search combined with a deep neural network ' +
        'trained against itself, starting from random play. This contrasts with the original AlphaGo which ' +
        'relied on human expert game records for initial supervised learning. The technique has since been ' +
        'generalized to AlphaZero, mastering chess, shogi, and Go from scratch.',
      tags: ['machine-learning', 'reinforcement-learning', 'alphago', 'deepmind'],
      category: 'technology',
    },
    {
      id: 'bench-needle-0001',
      topicId: 'needle',
      type: 'article' as ContentType,
      title: 'Sourdough Starter Hydration Ratios',
      content:
        'Sourdough starter hydration dramatically affects the flavor and texture of the final loaf. ' +
        'A 100% hydration starter (equal parts flour and water by weight) produces a mild, airy crumb. ' +
        'Stiff starters at 50-60% hydration yield more sour notes because acetic acid accumulates. ' +
        'The wild yeast Saccharomyces cerevisiae and Lactobacillus bacteria in a healthy sourdough ' +
        'culture require consistent feeding at the same hydration ratio to maintain balance.',
      tags: ['cooking', 'bread', 'sourdough', 'fermentation'],
      category: 'food',
    },
    {
      id: 'bench-needle-0002',
      topicId: 'needle',
      type: 'highlight' as ContentType,
      title: 'Thermohaline Circulation and Atlantic Overturning',
      content:
        'The Atlantic Meridional Overturning Circulation (AMOC) is a critical component of global climate ' +
        'regulation. Warm surface water flows north, releasing heat to the atmosphere before cooling, ' +
        'sinking, and returning south as deep cold water. Climate models predict AMOC weakening by 2100 ' +
        'due to freshwater influx from melting ice sheets, potentially causing regional cooling in Europe ' +
        'even as global temperatures rise. This thermohaline circulation collapse risk is a key tipping point.',
      tags: ['climate', 'ocean', 'AMOC', 'tipping-point'],
      category: 'environment',
    },
    {
      id: 'bench-needle-0003',
      topicId: 'needle',
      type: 'note' as ContentType,
      title: 'Sequence-to-Sequence Models for Code Generation',
      content:
        'Sequence-to-sequence transformer models like Codex and StarCoder are trained on large corpora ' +
        'of open-source code from GitHub. They generate code completions by predicting the next token ' +
        'in a sequence given a natural language prompt or partial code context. Fine-tuning on instruction ' +
        'datasets (RLHF) dramatically improves alignment with programmer intent. Evaluation is performed ' +
        'using HumanEval benchmarks measuring functional correctness of generated Python functions.',
      tags: ['programming', 'machine-learning', 'code-generation', 'llm'],
      category: 'technology',
    },
  ];

  // For larger corpora, replicate needles with variations
  for (let i = 0; i < needleCount; i++) {
    const base = NEEDLES[i % NEEDLES.length]!;
    const idx = Math.floor(i / NEEDLES.length);
    const ageMs = randomAgeMs(rng);
    records.push({
      ...base,
      id: `bench-needle-${String(i).padStart(4, '0')}`,
      title: idx > 0 ? `${base.title} — Variant ${idx + 1}` : base.title,
      created: ageToIso(ageMs),
      updated: ageToIso(Math.max(0, ageMs - intRng(rng, 0, 7) * 86400000)),
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Write fixtures
// ---------------------------------------------------------------------------

function writeCorpus(scale: ScaleConfig, notes: BenchmarkNoteRecord[]): void {
  const dir = join(FIXTURES_DIR, scale.name);
  mkdirSync(dir, { recursive: true });

  // Write markdown files (one per note)
  for (const note of notes) {
    const filePath = join(dir, `${note.id}.md`);
    const frontmatter = [
      '---',
      `id: ${note.id}`,
      `type: ${note.type}`,
      `title: "${note.title.replace(/"/g, "'")}"`,
      `created: ${note.created}`,
      `updated: ${note.updated}`,
      `tags: [${note.tags.map((t) => `"${t}"`).join(', ')}]`,
      `category: ${note.category}`,
      `topicId: ${note.topicId}`,
      '---',
      '',
    ].join('\n');
    writeFileSync(filePath, frontmatter + note.content, 'utf-8');
  }

  // Write index JSON
  const index: CorpusIndex = { scale: scale.name, noteCount: notes.length, notes };
  writeFileSync(join(dir, 'notes-index.json'), JSON.stringify(index, null, 2), 'utf-8');

  console.log(`  [${scale.name}] Generated ${notes.length} notes → ${dir}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('EchOS Search Benchmark — Corpus Generator');
console.log('==========================================');

const SEEDS: Record<string, number> = { small: 42, medium: 42, large: 42 };

for (const scale of SCALES) {
  const indexPath = join(FIXTURES_DIR, scale.name, 'notes-index.json');
  if (!FORCE && existsSync(indexPath)) {
    console.log(`  [${scale.name}] Already exists (use --force to regenerate)`);
    continue;
  }
  const notes = generateCorpus(scale, SEEDS[scale.name]!);
  writeCorpus(scale, notes);
}

console.log('\nDone. Run pnpm bench:search to execute the benchmark.');
