#!/usr/bin/env pnpm tsx

/**
 * Generate 1500 unique test markdown notes across diverse topics and content types.
 * Each note is generated dynamically with unique content, titles, and tags.
 * Simulates a real personal knowledge base built up over ~6 months.
 *
 * Usage: pnpm generate-test-notes
 */

import { writeFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const KNOWLEDGE_DIR = './data/knowledge';
const TARGET_NOTES = 1500;
const DAYS_SPAN = 180; // 6 months

type ContentType = 'note' | 'journal' | 'article' | 'youtube' | 'conversation';
type ContentStatus = 'saved' | 'read' | 'archived';
type InputSource = 'text' | 'voice' | 'url' | 'file';

interface GeneratedNote {
  title: string;
  content: string;
  tags: string[];
  gist?: string;
  sourceUrl?: string;
  category: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function generateDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(randInt(7, 21), randInt(0, 59), randInt(0, 59));
  return date;
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT GENERATORS BY CATEGORY
// ─────────────────────────────────────────────────────────────────────────────

const programmingLanguages = ['Rust', 'TypeScript', 'Python', 'Go', 'C++', 'Haskell', 'Elixir', 'Rust', 'JavaScript'];
const programmingTopics = {
  Rust: ['ownership', 'borrowing', 'lifetimes', 'traits', 'macros', 'async', 'the borrow checker', 'unsafe code', 'cargo', 'error handling'],
  TypeScript: ['generics', 'type inference', 'utility types', 'decorators', 'strict mode', 'union types', 'branding', 'template literal types'],
  Python: ['decorators', 'context managers', 'generators', 'asyncio', 'type hints', 'dataclasses', 'metaclasses'],
  Go: ['goroutines', 'channels', 'context', 'interfaces', 'error handling', 'go routines', 'concurrency patterns'],
  'C++': ['templates', 'RAII', 'smart pointers', 'move semantics', 'constexpr', 'concepts', 'ranges'],
  Haskell: ['monads', 'functors', 'lazy evaluation', 'type classes', 'pattern matching', 'currying'],
  Elixir: ['processes', 'OTP', 'macros', 'pattern matching', 'agents', 'gen servers'],
  JavaScript: ['promises', 'async/await', 'closures', 'prototypes', 'event loop', 'modules', 'proxies'],
};

const infrastructureTools = ['Docker', 'Kubernetes', 'Terraform', 'Nginx', 'Redis', 'PostgreSQL', 'AWS', 'GitHub Actions'];
const infrastructureTopics = ['containerization', 'orchestration', 'infrastructure as code', 'caching', 'load balancing', 'CI/CD', 'monitoring', 'logging'];

const databasesTopics = ['indexing strategies', 'query optimization', 'ACID', 'replication', 'sharding', 'transactions', 'stored procedures', ' migrations'];

const aiTopics = ['transformers', 'attention mechanisms', 'LLM prompting', 'fine-tuning', 'embeddings', 'vector databases', 'RAG', 'chain-of-thought', 'few-shot learning', 'model distillation'];

const healthTopics = ['running', 'sleep', 'nutrition', 'strength training', 'HRV', 'heart rate zones', 'recovery', 'stretching', 'hydration'];
const healthMetrics = {
  running: ['5k', '10k', 'half marathon', 'marathon', 'easy run', 'interval training', 'tempo run', 'long run'],
  sleep: ['deep sleep', 'REM sleep', 'sleep latency', 'sleep efficiency', 'circadian rhythm', 'light exposure'],
  nutrition: ['protein intake', 'carbohydrates', 'meal timing', 'fasting', 'supplements', 'hydration'],
  strength: ['squats', 'deadlifts', 'pull-ups', 'rows', 'press', 'accessory work', 'progressive overload'],
};

const productivityTopics = ['time blocking', 'Pomodoro', 'PARA method', 'Zettelkasten', 'atomic habits', 'habit stacking', 'weekly review', 'goal setting', 'focus sessions'];
const productivityTools = ['Obsidian', 'Notion', 'Todoist', 'TickTick', 'Google Calendar', 'Fantastical', 'Things 3', 'Raycast'];

const personalTopics = ['reading', 'learning', 'career', 'finances', 'relationships', 'habits', 'mindfulness', 'creativity', 'writing'];
const philosophyTopics = ['stoicism', 'existentialism', 'pragmatism', 'minimalism', 'antifragility', 'rationality'];

const financeTopics = ['index funds', 'asset allocation', 'tax optimization', 'emergency fund', 'retirement planning', 'compound interest', 'dollar cost averaging', 'FIRE movement'];

const engineeringTopics = ['software design', 'architecture', 'API design', 'code review', 'technical debt', 'testing', 'debugging', 'refactoring', 'system design'];

const writingTopics = ['technical writing', 'clarity', 'editing', 'style', 'audience', 'structure', 'storytelling'];

// ─────────────────────────────────────────────────────────────────────────────
// NOTE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateProgrammingNote(): GeneratedNote {
  const lang = rand(programmingLanguages);
  const topic = rand(programmingTopics[lang as keyof typeof programmingTopics]);
  const dayNum = randInt(1, 150);
  const title = `Day ${dayNum} of learning ${lang}: ${topic}`;
  
  const contents = [
    `Finally had a breakthrough on ${topic} in ${lang}. The key insight: ${rand(['it clicked when I stopped thinking about it as a rule and started thinking about it as a documentation of what the code is doing', 'the mental model that made it click was thinking about it as a state machine', 'the docs actually explain it well but I needed to see it in practice first'])}. ${lang} handles this differently than I expected.`,
    
    `Been practicing ${topic} in ${lang} for ${randInt(3, 20)} days now. Progress: ${rand(['can now write it without referencing docs', 'still struggling with edge cases', 'starting to see patterns in when to use it'])}. ${rand(['The compiler errors are actually helpful once you understand what they mean', 'The community has great resources for this', 'Wish I had found this resource earlier'])}.`,
    
    `Refactoring some old ${lang} code to use ${topic}. Expected it to take an hour, ended up being ${randInt(2, 8)} hours. ${rand(['The refactoring uncovered bugs I didn\'t know existed', 'The new version is 40% faster', 'I learned a lot about the language internals in the process'])}.`,
    
    `Question about ${topic} in ${lang}: ${rand(['why does this not work as expected?', 'what is the best practice here?', 'is this a bug or a feature?'])} Been trying to figure this out for ${randInt(1, 7)} hours. ${rand(['Stack Overflow wasn\'t helpful', 'The RFC explained it perfectly', 'Found the answer in a 3-year-old GitHub issue'])}.`,
    
    `Notes on ${topic}: it's ${rand(['more nuanced than I thought', 'simpler than the docs make it seem', 'exactly what I needed but didn\'t know to look for'])}. Key points: 1) ${rand(['start simple', 'understand the basics first', 'read the error messages carefully'])} 2) ${rand(['build incrementally', 'test often', 'don\'t over-engineer'])} 3) ${rand(['refactor after it works', 'document your changes', 'write tests'])}.`,
  ];
  
  const content = rand(contents);
  const tags = [lang.toLowerCase(), 'programming', topic.replace(/\s+/g, '-').toLowerCase(), rand(['learning', 'practice', 'notes', 'code'])];
  
  return {
    title,
    content,
    tags,
    category: 'programming',
  };
}

function generateDatabaseNote(): GeneratedNote {
  const topic = rand(databasesTopics);
  const db = rand(['PostgreSQL', 'SQLite', 'MySQL', 'MongoDB', 'Redis']);
  const title = `${db}: ${topic}`;
  
  const contents = [
    `Learning about ${topic} in ${db}. ${rand(['The documentation is surprisingly good', 'This is more complex than I thought', 'Found a great blog post that explains it'])}. ${rand(['Key takeaway: understand your access patterns first', 'Important: test in production-like environment', 'Remember: premature optimization is the root of all evil'])}.`,
    
    `Debugging a ${topic} issue in ${db} today. The problem: ${rand(['slow queries', 'connection pool exhaustion', 'data inconsistency', 'locking'])}. Solution: ${rand(['added an index', 'rewrote the query', 'changed the schema', 'increased pool size'])}. Lesson: ${rand(['always measure before optimizing', 'logs don\'t lie', 'test with realistic data volumes'])}.`,
    
    `Interesting finding about ${topic} in ${db}: ${rand(['it performs better with less normalization', 'the default settings are not optimal', 'there\'s a built-in way to do this'])}. Benchmarked ${randInt(10, 500)}% improvement after tuning.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: [db.toLowerCase(), 'databases', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'databases',
  };
}

function generateInfrastructureNote(): GeneratedNote {
  const tool = rand(infrastructureTools);
  const topic = rand(infrastructureTopics);
  const title = `${tool}: ${topic}`;
  
  const contents = [
    `Setting up ${tool} for ${topic}. ${rand(['The learning curve is steeper than expected', 'Much simpler than I anticipated', 'The community has great guides'])}. ${rand(['Spent 3 hours debugging a config error', 'Deployed on first try', 'Had to read the source to understand the behavior'])}.`,
    
    `Migrated our ${topic} to ${tool}. ${rand(['Zero downtime', 'Had a 2-hour outage', 'It took longer than expected'])}. ${rand(['Rollback plan worked perfectly', 'Should have tested more', 'Documentation was out of date'])}.`,
    
    `Optimizing ${tool} for ${topic}. Current setup: ${rand(['not scalable', 'costing too much', 'too complex'])}. ${rand(['Horizontal scaling seems to work', 'Switched to a managed service', 'Implemented caching layer'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: [tool.toLowerCase(), 'infrastructure', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'infrastructure',
  };
}

function generateAINote(): GeneratedNote {
  const topic = rand(aiTopics);
  const model = rand(['GPT-4', 'Claude', 'Gemini', 'Llama', 'Mistral']);
  const title = `AI: ${topic}`;
  
  const contents = [
    `Experimenting with ${topic}. ${rand(['Prompt engineering makes a big difference', 'The model is surprisingly good at this', 'Fine-tuning is overkill for this use case'])}. ${rand(['Key insight: specificity helps', 'Temperature matters more than I thought', 'Chain-of-thought improves accuracy'])}.`,
    
    `Testing ${model} on ${topic}. Results: ${randInt(70, 95)}% success rate. ${rand(['It fails on edge cases', 'Works better than expected', 'Cost is a concern at scale'])}. ${rand(['Would use in production', 'Needs more work', 'Not ready for prod but promising'])}.`,
    
    `Notes on ${topic}: ${rand(['the mechanism is elegant', 'it\'s simpler than the paper suggests', 'there are tradeoffs to consider'])}. ${rand(['Useful resource: the original paper', 'This YouTube video explains it well', 'Best explanation I found is in a blog post'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['ai', 'machine-learning', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'ai',
  };
}

function generateHealthNote(): GeneratedNote {
  const topic = rand(healthTopics);
  const metric = rand(healthMetrics[topic as keyof typeof healthMetrics] || ['general']);
  const title = `${topic}: ${metric}`;
  const value = randFloat(0.1, 9.9).toFixed(1);
  
  const contents = [
    `Day ${randInt(1, 180)} of focusing on ${topic}. Today's ${metric}: ${value} ${rand(['bpm', 'hours', 'grams', 'score', 'minutes'])}. ${rand(['Up from last week', 'Down from yesterday', 'Consistent with average'])}. ${rand(['Sleep quality affected', 'Diet made a difference', 'Exercise helped'])} this.`,
    
    `Tracking ${metric} for ${topic} over the past ${randInt(2, 8)} weeks. ${rand(['Seeing improvement', 'Plateaued', 'Need to adjust approach'])}. ${randInt(60, 95)}% of days hit target. ${rand(['HRV is trending up', 'Resting HR is down', 'Recovery score improved'])}.`,
    
    `Experiment with ${topic}: ${rand(['intermittent fasting', 'cold showers', 'meditation', 'supplements', 'zone 2 training', 'strength training'])}. ${randInt(7, 30)} days in. ${metric}: ${value}. ${rand(['Will continue', 'Not worth it', 'Need longer trial'])}.`,
    
    `Post-${rand(['5k', 'long run', 'workout', 'race'])} ${topic} check. ${metric}: ${value} ${rand(['bpm', 'hours', 'mg/dL'])}. ${rand(['Feeling good', 'Need more recovery', 'PR today'])}. ${rand(['Consistent training works', 'Sleep matters more than I thought', 'Nutrition timing is key'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['health', topic, metric.replace(/\s+/g, '-').toLowerCase()],
    category: 'health',
  };
}

function generateProductivityNote(): GeneratedNote {
  const topic = rand(productivityTopics);
  const tool = rand(productivityTools);
  const title = `Productivity: ${topic}`;
  const weeks = randInt(1, 4);
  const combo = 'Combined with ' + tool;
  const tried = 'Tried ' + tool + ' but it doesn\'t fit my workflow';
  const toolHelped = tool + ' helped';
  
  const contents = [
    `Trying ${topic} for ${weeks} weeks. ${rand(['Game changer', 'Helpful but not revolutionary', 'Too much overhead'])}. ${rand(['Using it daily now', 'Dropped it', 'Modified the approach'])}. ${rand([combo, 'Pairing with time blocking', 'Works well alone'])}.`,
    
    `Question: best way to implement ${topic}? ${rand([tried, 'Looking for something simpler', 'Want to automate this'])}. ${rand(['The PARA method might help', 'Atomic Habits has a framework', 'Need to read more'])}.`,
    
    `Weekly review using ${topic}. ${rand(['Found 3 hours of wasted time', 'Discovered pattern in energy levels', 'Need to adjust schedule'])}. ${rand([toolHelped, 'Manual tracking needed', 'This is becoming ritual'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['productivity', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'productivity',
  };
}

function generatePersonalNote(): GeneratedNote {
  const topic = rand(personalTopics);
  const title = rand([
    `On ${topic}`,
    `Thoughts on ${topic}`,
    `Reflection: ${topic}`,
    `Learning about ${topic}`,
    `Notes on ${topic}`,
  ]);
  
  const book = rand(['Atomic Habits', 'Deep Work', 'The 7 Habits', 'Thinking Fast and Slow']);
  const person = rand(['friend', 'mentor', 'coach']);
  const goal = rand(['3-month goal: ' + randInt(1, 10) + 'x improvement', '6-month goal: make it a habit', 'No timeline, just moving forward']);
  
  const contents = [
    `Been thinking about ${topic} lately. ${rand(['Started a new habit', 'Let an old one go', 'Found a better approach'])}. ${rand(['The key is consistency', 'It takes time', 'Small changes add up'])}. ${rand(['Reading "' + book + '" helped', 'Conversation with ' + person + ' clarified things', 'Just experimenting'])}.`,
    
    `Update on ${topic}: ${rand(['making progress', 'hit a plateau', 'changed direction'])}. ${rand(['Surprised by how much it matters', 'It\'s harder than I thought', 'Easier than expected'])}. ${goal}.`,
    
    `Realization about ${topic}: ${rand(['it\'s a mindset shift, not a tool problem', 'I was overcomplicating it', 'the basics work'])}. ${rand(['Deleted the fancy system', 'Simplified approach', 'Went back to basics'])}. ${rand(['Less is more', 'Done is better than perfect', 'Consistency over intensity'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['personal', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'personal',
  };
}

function generateFinanceNote(): GeneratedNote {
  const topic = rand(financeTopics);
  const title = `Finance: ${topic}`;
  const amount = randInt(100, 10000);
  const currency = rand(['$', '£']);
  const savingsRate = randInt(15, 50) + '%';
  const yearsGoal = randInt(10, 30);
  
  const contents = [
    `Researching ${topic}. ${rand(['Index funds beat active management', 'Compound interest is powerful', 'Tax-advantaged accounts first'])}. ${rand(['Set up automatic contribution', 'Reallocated portfolio', 'Opened new account'])}: ${currency}${amount}/month. ${rand(['30-year projection looks good', 'Went with low-fee option', 'Diversification matters'])}.`,
    
    `Monthly finance review: ${topic}. ${rand(['On track', 'Need to adjust', 'Better than expected'])}. ${rand(['Savings rate: ' + savingsRate, 'Invested ' + currency + amount, 'Rebalanced portfolio'])}. ${rand(['Automated everything', 'Cut expenses', 'Increased income goal'])} this month.`,
    
    `Question about ${topic}: ${rand(['is this the right approach?', 'how much allocation?', 'what about tax implications?'])} ${rand(['Financial independence goal: ' + yearsGoal + ' years', 'Following the simple path', 'Not following the herd'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['finance', 'personal-finance', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'finance',
  };
}

function generateEngineeringNote(): GeneratedNote {
  const topic = rand(engineeringTopics);
  const title = `Engineering: ${topic}`;
  
  const contents = [
    `Thought on ${topic}: ${rand(['it\'s underrated', 'we overcomplicate it', 'simplicity wins'])}. ${rand(['Code review feedback: be more specific', 'Found a better approach', 'Wrote tests first this time'])}. ${rand(['The refactoring took longer but worth it', 'Shipped in a day', 'Pair programming helped'])}.`,
    
    `Working on ${topic}. ${rand(['The team disagrees on approach', 'Found a good pattern', 'Need to document decisions'])}. ${rand(['Proposed an RFC', 'Went with the simpler solution', 'Iterated based on feedback'])}. ${rand(['Documentation is key', 'Tests prevent regression', 'Code review catches edge cases'])}.`,
    
    `Lesson learned about ${topic}: ${rand(['it\'s a trade-off, not a rule', 'context matters', 'there are exceptions'])}. ${rand(['Over-engineered this', 'Under-engineered that', 'Right-sized the solution'])}. ${rand(['Technical debt accumulates', 'Good design saves time', 'Communication matters more'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['engineering', 'software-development', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'engineering',
  };
}

function generatePhilosophyNote(): GeneratedNote {
  const topic = rand(philosophyTopics);
  const title = `Philosophy: ${topic}`;
  const author = rand(['Marcus Aurelius', 'Seneca', 'Epictetus', 'Nietzsche', 'Camus', 'James', 'Popper']);
  const question = rand(['how to apply this practically?', 'what did I miss?', 'is this compatible with my values?']);
  const timeAnswer = rand(['The answer is in the practice', 'Need to read more', 'Time will tell']);
  
  const contents = [
    `Reading about ${topic}. ${author}'s view: ${rand(['control what you can', 'embrace uncertainty', 'create meaning', 'question everything'])}. ${rand(['This resonates with my experience', 'Need to practice this more', 'Changed my perspective'])}. ${rand(['The dichotomy of control is useful', 'Absurdism makes sense', 'Pragmatism feels right'])}.`,
    
    `Applying ${topic} to daily life. ${rand(['Started a morning routine', 'Reframed setbacks', 'Let go of what I can\'t control'])}. ${rand(['Noticeably less anxiety', 'More focused', 'Better relationships'])}. ${rand(['Stoic practices work', 'It\'s a practice, not a destination', 'Balance is key'])}.`,
    
    `Question about ${topic}: ${question} ${timeAnswer}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['philosophy', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'philosophy',
  };
}

function generateWritingNote(): GeneratedNote {
  const topic = rand(writingTopics);
  const title = `Writing: ${topic}`;
  
  const reviewer = rand(['peer', 'friend', 'editor']);
  const editingTime = rand([randInt(500, 2000) + ' words', randInt(5, 30) + ' minutes', randInt(1, 5) + ' hours']);
  
  const contents = [
    `Working on ${topic}. ${rand(['Cut 30% of words', 'Added concrete examples', 'Changed the opening'])}. ${rand(['Active voice helps', 'Read it aloud', 'Feedback from ' + reviewer + ' was valuable'])}. ${rand(['Clarity over cleverness', 'Show, don\'t tell', 'One idea per sentence'])}.`,
    
    `Edit: ${rand(['first draft done', 'second draft', 'final pass'])}. ${rand(['The structure works', 'Need to reorganize', 'Ending is weak'])}. ${editingTime} of editing. ${rand(['Worth it', 'Over-edited', 'Should have done this first'])}.`,
    
    `Learning about ${topic}. ${rand(['The Elements of Style says', 'Technical writing handbook suggests', 'On Writing Well argues'])}: ${rand(['cut unnecessary words', 'use active voice', 'know your audience'])}. ${rand(['Applying to my notes', 'Practice daily', 'Need to internalize this'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['writing', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'writing',
  };
}

function generateDistributedSystemsNote(): GeneratedNote {
  const topic = rand(['consensus', 'CAP theorem', 'replication', 'partition tolerance', 'eventual consistency', 'CRDTs', 'Paxos', 'Raft']);
  const title = `Distributed Systems: ${topic}`;
  const person = rand(['team', 'expert', 'vendor']);
  
  const contents = [
    `Understanding ${topic}. ${rand(['Key insight: you can\'t have all three of CAP', 'It\'s about trade-offs', 'The math is elegant'])}. ${rand(['Practical implication: choose your trade-offs', 'This affects how we design systems', 'Real-world examples help'])}.`,
    
    `Implementing ${topic}. ${rand(['Found a good library', 'Had to build it ourselves', 'The algorithm is complex'])}. ${rand(['Works in production now', 'Still testing', 'Need more work'])}. ${rand(['Lessons: test failure modes', 'Document the assumptions', 'Monitor everything'])}.`,
    
    `Question about ${topic}: ${rand(['is this overkill?', 'how to test?', 'what are the trade-offs?'])} ${rand(['Talked to ' + person, 'Read the paper', 'Experimented locally'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['distributed-systems', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'distributed-systems',
  };
}

function generateToolsNote(): GeneratedNote {
  const tool = rand(['Vim', 'Git', 'Docker', 'Tmux', 'Zsh', 'VS Code', 'Neovim', 'Alacritty', 'Raycast']);
  const topic = rand(['shortcuts', 'plugins', 'configuration', 'workflow', 'keybindings', 'themes', 'performance']);
  const title = `${tool}: ${topic}`;
  
  const contents = [
    `Customizing ${tool} for ${topic}. ${rand(['Found a great plugin', 'Wrote my own config', 'Copied someone else\'s setup'])}. ${rand(['Productivity up ${randInt(10, 50)}%', 'Much faster now', 'Worth the setup time'])}. ${rand(['The learning curve was worth it', 'Still learning', 'Perfect now'])}.`,
    
    `Using ${tool} for ${topic}. ${rand(['Didn\'t know this existed', 'Game changer', 'Should have learned earlier'])}. ${rand(['Added to muscle memory', 'Created a cheat sheet', 'Wrote documentation'])}. ${rand(['${tool} is now essential', 'Maybe too complex', 'Perfect for my needs'])}.`,
    
    `Debugging ${tool}: ${topic} issue. ${rand(['Took ${randInt(1, 8)} hours', 'Simple fix', 'Weird edge case'])}. ${rand(['RTFM next time', 'Great community help', 'Documented the solution'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['tools', tool.toLowerCase(), topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'tools',
  };
}

function generateLearningNote(): GeneratedNote {
  const topic = rand(['spaced repetition', 'active recall', ' Feynman technique', 'learning in public', 'teaching', 'reading comprehension']);
  const title = `Learning: ${topic}`;
  
  const contents = [
    `Trying ${topic}. ${randInt(7, 90)} days in. ${rand(['Retention improved', 'Faster recall', 'Understanding deeper'])}. ${rand(['Using Anki', 'Applying the technique', 'Measuring results'])}. ${rand(['Works for technical topics', 'Need to adapt for others', 'Wish I started earlier'])}.`,
    
    `Question about ${topic}: ${rand(['optimal frequency?', 'best resources?', 'how to measure?'])} ${rand(['Experiment shows', 'Research says', 'My experience is'])}: ${rand(['daily practice', 'consistent exposure', 'active engagement'])}.`,
    
    `Reviewing ${topic}. ${rand(['Still effective', 'Need to adjust', 'Changed approach'])}. ${rand(['${randInt(100, 1000)} cards in deck', 'Spent ${randInt(10, 60)} min today', '${randInt(1, 12)} month streak'])}. ${rand(['Long-term memory is forming', 'Could be more efficient', 'Highly recommend'])}.`,
  ];
  
  return {
    title,
    content: rand(contents),
    tags: ['learning', topic.replace(/\s+/g, '-').toLowerCase()],
    category: 'learning',
  };
}

// Note generator mapping
const noteGenerators: (() => GeneratedNote)[] = [
  generateProgrammingNote,
  generateDatabaseNote,
  generateInfrastructureNote,
  generateAINote,
  generateHealthNote,
  generateProductivityNote,
  generatePersonalNote,
  generateFinanceNote,
  generateEngineeringNote,
  generatePhilosophyNote,
  generateWritingNote,
  generateDistributedSystemsNote,
  generateToolsNote,
  generateLearningNote,
];

// ─────────────────────────────────────────────────────────────────────────────
// JOURNAL GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateWeeklyReview(): GeneratedNote {
  const weekNum = randInt(1, 26);
  return {
    title: `Weekly Review — Week ${weekNum}`,
    content: `**What got done:**
- ${rand(['Shipped feature X', 'Fixed critical bug', 'Completed code review', 'Wrote documentation', 'Refactored module Y'])}
- ${rand(['Attended planning meeting', '1:1s with team', 'On-call rotation', 'Code review marathon'])}
- ${rand(['Learned about topic Z', 'Experimented with new tool', 'Read 3 articles', 'Watched 2 talks'])}

**What got stuck:**
${rand(['Performance optimization', 'Bug reproduction', 'API design', 'Migration plan'])} — ${rand(['need more context', 'waiting on external dependency', 'need to re-evaluate approach'])}

**Energy level:** ${randInt(4, 9)}/10
${rand(['Good week', 'Tired but productive', 'Balanced', 'Chaotic'])}
`,
    tags: ['weekly-review', 'productivity', 'reflection'],
    category: 'reflection',
  };
}

function generateMorningPages(): GeneratedNote {
  const topics = rand([
    'coding', 'career', 'productivity', 'health', 'relationships', 'finances', 'creativity', 'learning'
  ]);
  const feeling = rand(['motivated', 'anxious', 'focused', 'curious', 'tired']);
  const action = rand(['push through', 'take a break', 'ask for help']);
  const insight = rand([
    'The key insight: don\'t overcomplicate. The simplest solution is usually right.',
    'Question I need to answer: what would I do if I couldn\'t fail?',
    'Realization: I\'ve been avoiding the hard part. Time to face it.',
    'Idea: what if I combined X with Y? Could be interesting.',
    'Feeling: ' + feeling + '. Need to ' + action + '.',
  ]);
  const closing = rand([
    'Action for today: focus on one thing. Don\'t multitask.',
    'Reminder: it\'s a marathon, not a sprint.',
    'Note to self: the small wins add up.',
  ]);
  
  return {
    title: `Morning pages — ${topics}`,
    content: `Woke up at ${randInt(5, 7)}:${rand(['00', '15', '30', '45'])}. Mind immediately went to ${topics}.

${insight}

${closing}
`,
    tags: ['morning', 'reflection', 'stream-of-consciousness', topics],
    category: 'personal',
  };
}

function generateMonthlyRetro(): GeneratedNote {
  const month = rand(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  return {
    title: `End of ${month} retrospective`,
    content: `**Goals vs actual:**
- ${rand(['Goal A: done', 'Goal A: partial', 'Goal A: not done'])} — ${rand(['shipped', 'in progress', 'deprioritized'])}
- ${rand(['Goal B: done', 'Goal B: partial', 'Goal B: not done'])} — ${rand(['shipped', 'in progress', 'deprioritized'])}
- ${rand(['Goal C: done', 'Goal C: partial', 'Goal C: not done'])} — ${rand(['shipped', 'in progress', 'deprioritized'])}

**Surprise:**
${rand(['Unexpected project took priority', 'Team member left', 'Technology change', 'New requirement'])}

**What I\'m proud of:**
${rand(['Shipped on time', 'Learned new skill', 'Helped teammate', 'Maintained code quality'])}

**Next month focus:**
${rand(['Performance', 'Testing', 'Documentation', 'New feature', 'Technical debt'])}
`,
    tags: ['retrospective', 'monthly', 'goals'],
    category: 'work',
  };
}

function generateDecisionNote(): GeneratedNote {
  const decision = rand([
    'which database to use',
    'how to structure the API',
    'whether to refactor now or later',
    'team structure',
    'hiring plan',
    'technology choice',
    'architecture pattern',
  ]);
  return {
    title: `Decision: ${decision}`,
    content: `**The question:** ${decision}

**Options considered:**
1. ${rand(['Option A', 'Approach 1', 'Status quo'])}: ${rand(['pros: simple', 'pros: known quantity', 'cons: may not scale'])}
2. ${rand(['Option B', 'Approach 2', 'New solution'])}: ${rand(['pros: more flexible', 'pros: modern', 'cons: learning curve'])}

**Decision:** ${rand(['Option A', 'Option B'])} — ${rand(['simplicity wins', 'long-term flexibility', 'team expertise'])}

**Rationale:** ${rand(['The problem doesn\'t require complexity', 'Future-proofing matters', 'Team can execute faster'])}

**Re-evaluate in:** ${rand(['3 months', '6 months', '1 year'])}
`,
    tags: ['decision', 'architecture', 'planning'],
    category: 'decision',
  };
}

function generateReflectionNote(): GeneratedNote {
  const events = rand([
    'a difficult conversation',
    'a success',
    'a failure',
    'a realization',
    'a change in perspective',
  ]);
  const whatHappened = rand(['What happened: ' + rand(["unexpected", "as expected", "surprising turn"]), 'How I responded: ' + rand(["handled well", "could have done better", "learned from it"]), 'What I learned: ' + rand(["patience is key", "communication matters", "ask for help"])]);
  const nextTime = rand(['Next time I would: ' + rand(["prepare more", "listen more", "act faster"]), 'This reinforces: ' + rand(["my values", "my goals", "my approach"]), 'Share this with: ' + rand(["team", "friend", "mentor"])]);
  
  return {
    title: `Reflection: ${events}`,
    content: `Reflecting on ${events}.

${whatHappened}

${nextTime}
`,
    tags: ['reflection', 'personal', 'growth'],
    category: 'personal',
  };
}

function generateIdeasNote(): GeneratedNote {
  const idea1 = 'What if we could ' + rand(["search by meaning", "auto-categorize", "generate summaries"]) + '?';
  const idea2 = 'The problem: ' + rand(["users want X but get Y", "current solution is slow", "too much manual work"]);
  const idea3 = 'Insight: ' + rand(["combine A and B", "remove complexity", "automate the hard part"]);
  const idea = rand([idea1, idea2, idea3]);
  
  return {
    title: `Ideas from ${rand(['today\'s walk', 'shower', 'meditation', 'commute', 'run'])}`,
    content: `Had an idea while ${rand(['walking', 'showering', 'meditating', 'commuting', 'running'])}:

**${rand(['Feature idea', 'Improvement', 'New approach'])}:**
${idea}

**Why it matters:** ${rand(['saves time', 'improves UX', 'reduces friction'])}

**Next step:** ${rand(['prototype it', 'research more', 'ask users', 'discuss with team'])}
`,
    tags: ['ideas', 'creativity', 'capture'],
    category: 'ideas',
  };
}

const journalGenerators: (() => GeneratedNote)[] = [
  generateWeeklyReview,
  generateMorningPages,
  generateMonthlyRetro,
  generateDecisionNote,
  generateReflectionNote,
  generateIdeasNote,
];

// ─────────────────────────────────────────────────────────────────────────────
// ARTICLE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateTechArticle(): GeneratedNote {
  const topics = rand([
    'New database approach',
    'Programming language trends',
    'AI development tools',
    'Web framework comparison',
    'Cloud architecture patterns',
    'Security best practices',
    'Performance optimization',
    'Testing strategies',
  ]);
  const source = rand(['Hacker News', 'Twitter', 'Newsletter', 'Blog post', 'Conference talk']);
  
  const keypoint1 = rand(['Technology is evolving', 'Best practices emerge', 'New research shows']) + ': ' + rand(['approach A is gaining traction', 'method B has limitations', 'pattern C solves the problem']);
  const keypoint2 = rand(['Practical implications', 'Trade-offs to consider', 'Future direction']) + ': ' + rand(['adoption is growing', 'more research needed', 'production-ready now']);
  const keypoint3 = rand(['My take', 'What this means', 'Action items']) + ': ' + rand(['worth exploring', 'skip for now', 'add to roadmap']);
  const note1 = rand(['Interesting angle on', 'Surprised by', 'Agree with']) + ': ' + rand(['the analysis', 'the conclusions', 'the examples']);
  const note2 = rand(['Need to try', 'Worth reading', 'Citation needed']) + ': ' + rand(['the full article', 'the code samples', 'the follow-up']);
  const relevance = rand(['Could apply to current project', 'Good background knowledge', 'Maybe for next quarter', 'Not immediately relevant']);
  
  return {
    title: `Article: ${topics}`,
    gist: `Summary of ${topics} from ${source}`,
    sourceUrl: `https://example.com/article/${randInt(1000, 9999)}`,
    content: `## Summary

Key points from ${topics}:

1. ${keypoint1}
2. ${keypoint2}
3. ${keypoint3}

## Notes

- ${note1}
- ${note2}

## Relevance to my work

${relevance}
`,
    tags: ['technology', 'article', topics.toLowerCase().replace(/\s+/g, '-')],
    category: 'technology',
  };
}

function generateScienceArticle(): GeneratedNote {
  const topics = rand([
    'Climate science update',
    'Neuroscience discoveries',
    'Physics breakthroughs',
    'Biological research',
    'Psychology studies',
  ]);
  
  return {
    title: `Article: ${topics}`,
    gist: `Scientific findings on ${topics}`,
    sourceUrl: `https://example.com/science/${randInt(1000, 9999)}`,
    content: `## Key Findings

${rand([
  'New research shows that',
  'A recent study demonstrates',
  'Scientists have discovered',
])}: ${rand([
  'the mechanism is more complex than previously thought',
  'there are practical applications',
  'the implications are significant',
])}.

## Technical Details

- ${rand(['Methodology', 'Approach', 'Research design'])}: ${rand(['novel', 'established', 'controversial'])}
- ${rand(['Sample size', 'Data quality', 'Peer review'])}: ${rand(['robust', 'needs more work', 'preliminary'])}
- ${rand(['Conclusions', 'Limitations', 'Next steps'])}: ${rand(['well-supported', 'require replication', 'awaiting review'])}

## Personal Takeaway

${rand([
  'Fascinating implications for daily life',
  'Good to understand the basics',
  'Science literacy matters',
  'Need to follow up on this',
])}
`,
    tags: ['science', 'article', topics.toLowerCase().replace(/\s+/g, '-')],
    category: 'science',
  };
}

function generateCareerArticle(): GeneratedNote {
  const topics = rand([
    'Staff engineer role',
    'Leadership skills',
    'Technical career growth',
    'Interviewing tips',
    'Negotiation strategies',
    'Remote work',
  ]);
  
  return {
    title: `Article: ${topics}`,
    gist: `Advice on ${topics}`,
    sourceUrl: `https://example.com/career/${randInt(1000, 9999)}`,
    content: `## Main Points

${rand([
  'Key insight:',
  'Important takeaway:',
  'Core principle:',
])} ${rand([
  'influence without authority is the skill to develop',
  'specificity in feedback matters',
  'writing is the force multiplier',
  'relationships need maintenance',
])}.

## Actionable Advice

1. ${rand(['Do the work', 'Build credibility', 'Communicate clearly'])} — ${rand(['it compounds', 'it matters', 'it pays off'])}
2. ${rand(['Document decisions', 'Mentor others', 'Share learnings'])} — ${rand(['legacy matters', 'helps the team', 'builds reputation'])}
3. ${rand(['Ask for feedback', 'Seek stretch opportunities', 'Invest in relationships'])}

## Personal Application

${rand([
  'This aligns with my goals',
  'Need to practice this more',
  'Good reminder',
  'Worth trying',
])}: ${rand(['weekly 1:1s', 'writing more', 'seeking mentorship', 'taking on scope'])}.
`,
    tags: ['career', 'article', topics.toLowerCase().replace(/\s+/g, '-')],
    category: 'career',
  };
}

const articleGenerators: (() => GeneratedNote)[] = [
  generateTechArticle,
  generateScienceArticle,
  generateCareerArticle,
];

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateYouTubeNote(): GeneratedNote {
  const creators = rand(['3Blue1Brown', 'Fireship', 'Lex Fridman', 'Theo', 'Tsoding', 'Corey Schafer', 'Kent C. Dodds', 'Joel Hooks']);
  const topics = rand([
    'explainer on topic X',
    'interview with expert',
    'tutorial on tool Y',
    'discussion on approach Z',
    'review of technology',
  ]);
  
  return {
    title: `${creators}: ${topics}`,
    gist: `Key insights from ${creators}'s video on ${topics}`,
    sourceUrl: `https://youtube.com/watch?v=${randomUUID().slice(0, 11)}`,
    content: `**What I learned:**

1. ${rand(['Main concept', 'Key insight', 'Core principle'])}: ${rand(['it\'s about trade-offs', 'the mental model helps', 'the approach is practical'])}
2. ${rand(['Practical tip', 'Actionable advice', 'Useful pattern'])}: ${rand(['try this first', 'avoid this mistake', 'remember this'])}
3. ${rand(['Surprising fact', 'Counter-intuitive finding', 'Important nuance'])}: ${rand(['I didn\'t expect this', 'Changed my view', 'Worth noting'])}

**Why it matters:** ${rand(['directly applicable to my work', 'good background', 'interesting but not urgent'])}

**What I want to try:** ${rand(['the technique', 'the tool', 'the approach'])} — ${rand(['this week', 'soon', 'as a project'])}

**Related concepts:** ${rand(['topic A', 'topic B', 'topic C'])} — worth exploring further.
`,
    tags: ['youtube', 'video', 'learning'],
    category: 'technology',
  };
}

const youtubeGenerators: (() => GeneratedNote)[] = [
  generateYouTubeNote,
];

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function generateConversationNote(): GeneratedNote {
  const context = rand([
    'architecture decision',
    'debugging session',
    'design review',
    'planning meeting',
    'post-mortem',
    'brainstorm',
  ]);
  
  return {
    title: `Conversation: ${context}`,
    content: `**Context:** ${context}

**Participants:** ${rand(['me and teammate', 'me and lead', 'me and mentor', 'team discussion'])}

**Key points:**
- ${rand(['We decided to', 'We agreed to', 'We considered'])}: ${rand(['use approach A', 'defer the decision', 'try both options'])}
- ${rand(['The trade-off is', 'The risk is', 'The concern is'])}: ${rand(['complexity vs speed', 'cost vs benefit', 'now vs later'])}
- ${rand(['Action item:', 'Follow-up:', 'Next step:'])}: ${rand(['implement X', 'write RFC', 'prototype Y', 'review Z'])}

**Decision:** ${rand(['Go with option A', 'Need more info', 'Try X and evaluate'])}
**Timeline:** ${rand(['this sprint', 'next week', 'next month'])}

**My takeaway:** ${rand(['Good discussion', 'Learned something', 'Clearer direction now'])}
`,
    tags: ['conversation', context.replace(/\s+/g, '-').toLowerCase()],
    category: 'decision',
  };
}

const conversationGenerators: (() => GeneratedNote)[] = [
  generateConversationNote,
];

// ─────────────────────────────────────────────────────────────────────────────
// FILE CREATION
// ─────────────────────────────────────────────────────────────────────────────

function createMarkdownFile(
  type: ContentType,
  note: GeneratedNote,
  date: Date,
  status: ContentStatus,
  inputSource: InputSource,
): string {
  const id = randomUUID();
  const dateStr = date.toISOString();
  const slug = generateSlug(note.title);
  const datePrefix = date.toISOString().slice(0, 10);
  const uniqueSuffix = randomUUID().slice(0, 6);
  const fileName = `${datePrefix}-${slug}-${uniqueSuffix}.md`;

  const dir = join(KNOWLEDGE_DIR, type, note.category);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, fileName);

  const lines: string[] = [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    `title: '${note.title.replace(/'/g, "''")}'`,
    `created: '${dateStr}'`,
    `updated: '${dateStr}'`,
    `tags:`,
    ...note.tags.map((t) => `  - ${t}`),
    `links: []`,
    `category: ${note.category}`,
    `status: ${status}`,
    `inputSource: ${inputSource}`,
  ];

  if (note.sourceUrl) {
    lines.push(`source_url: '${note.sourceUrl}'`);
  }
  if (note.gist) {
    lines.push(`gist: '${note.gist.replace(/'/g, "''")}'`);
  }

  lines.push('---', `# ${note.title}`, '', note.content, '');

  writeFileSync(filePath, lines.join('\n'), 'utf-8');
  
  // Set the file's modification and access times to match the note date
  // This ensures the app sees the correct dates when reading file metadata
  const timestamp = date.getTime() / 1000; // Convert ms to seconds
  utimesSync(filePath, timestamp, timestamp);
  
  return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN GENERATION LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Generating ${TARGET_NOTES} unique notes over ${DAYS_SPAN} days...\n`);

  const counts = { note: 0, journal: 0, article: 0, youtube: 0, conversation: 0 };
  
  // Calculate notes per day to reach target
  // Distribute: ~50% notes, ~20% journal, ~15% articles, ~10% youtube, ~5% conversations
  const notesPerDay = Math.ceil(TARGET_NOTES / DAYS_SPAN);
  
  for (let dayIndex = 0; dayIndex < DAYS_SPAN; dayIndex++) {
    const dayOfWeek = new Date(Date.now() - dayIndex * 86400000).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Activity rate: higher on weekdays - always active to ensure we get 1500
    const activeProbability = isWeekend ? 0.7 : 0.95;
    if (Math.random() > activeProbability) continue;
    
    // Generate notes for this day - increase count to hit 1500 target
    const dayNoteCount = isWeekend ? randInt(4, 10) : randInt(8, 15);
    
    for (let i = 0; i < dayNoteCount; i++) {
      if (counts.note + counts.journal + counts.article + counts.youtube + counts.conversation >= TARGET_NOTES) break;
      
      const date = generateDate(dayIndex);
      const randVal = Math.random();
      
      if (randVal < 0.50) {
        // 50% notes
        const generator = rand(noteGenerators);
        const note = generator();
        const inputSource: InputSource = Math.random() < 0.15 ? 'voice' : 'text';
        createMarkdownFile('note', note, date, 'read', inputSource);
        counts.note++;
      } else if (randVal < 0.70) {
        // 20% journal
        const generator = rand(journalGenerators);
        const note = generator();
        createMarkdownFile('journal', note, date, 'read', 'text');
        counts.journal++;
      } else if (randVal < 0.85) {
        // 15% articles
        const generator = rand(articleGenerators);
        const note = generator();
        const readProbability = dayIndex > 60 ? 0.65 : dayIndex > 14 ? 0.35 : 0.1;
        const archiveProbability = dayIndex > 120 ? 0.15 : 0.03;
        const status: ContentStatus =
          Math.random() < archiveProbability
            ? 'archived'
            : Math.random() < readProbability
              ? 'read'
              : 'saved';
        createMarkdownFile('article', note, date, status, 'url');
        counts.article++;
      } else if (randVal < 0.95) {
        // 10% youtube
        const generator = rand(youtubeGenerators);
        const note = generator();
        const readProbability = dayIndex > 30 ? 0.55 : dayIndex > 7 ? 0.25 : 0.05;
        const status: ContentStatus = Math.random() < readProbability ? 'read' : 'saved';
        createMarkdownFile('youtube', note, date, status, 'url');
        counts.youtube++;
      } else {
        // 5% conversations
        const generator = rand(conversationGenerators);
        const note = generator();
        createMarkdownFile('conversation', note, date, 'read', 'text');
        counts.conversation++;
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  console.log(`\nGenerated ${total} unique markdown files in ${KNOWLEDGE_DIR}:`);
  console.log('');
  console.log('  Type           Count');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  note           ${String(counts.note).padStart(5)}`);
  console.log(`  journal        ${String(counts.journal).padStart(5)}`);
  console.log(`  article        ${String(counts.article).padStart(5)}`);
  console.log(`  youtube        ${String(counts.youtube).padStart(5)}`);
  console.log(`  conversation   ${String(counts.conversation).padStart(5)}`);
  console.log('');
  console.log('Next step: index into SQLite + LanceDB:');
  console.log('  pnpm reconcile');
}

main().catch(console.error);
