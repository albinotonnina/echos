#!/usr/bin/env pnpm tsx

/**
 * Generate realistic test markdown notes across diverse topics and content types.
 * Simulates a real personal knowledge base built up over ~12 months.
 *
 * Usage: pnpm generate-test-notes
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const KNOWLEDGE_DIR = './data/knowledge';

type ContentType = 'note' | 'journal' | 'article' | 'youtube' | 'conversation';
type ContentStatus = 'saved' | 'read' | 'archived';
type InputSource = 'text' | 'voice' | 'url' | 'file';

interface Template {
  title: string;
  content: string;
  tags: string[];
  gist?: string;
  sourceUrl?: string;
  category: string;
}

// ─── NOTE TEMPLATES ─────────────────────────────────────────────────────────

const NOTE_TEMPLATES: Template[] = [
  {
    title: 'Rust borrow checker finally clicked',
    category: 'programming',
    tags: ['rust', 'programming', 'learning', 'memory'],
    content: `The mental model that made it click: think of the borrow checker as enforcing the rule "at any point in time, a value can either have many readers OR one writer — never both simultaneously."

Once I stopped thinking about it as a compiler limitation and started thinking about it as a documentation of who owns data at any moment, the errors started making sense.

The key insight: \`&T\` is a shared reference (many readers), \`&mut T\` is exclusive reference (one writer). These cannot coexist for the same value in the same scope.

Why this matters beyond memory safety: it's essentially compile-time enforcement of the readers-writer lock pattern that we'd otherwise do with runtime synchronization.`,
  },
  {
    title: 'Mental model: the two types of complexity',
    category: 'engineering',
    tags: ['complexity', 'software-design', 'mental-models'],
    content: `From "Out of the Tar Pit" (Moseley & Marks): **essential complexity** vs **accidental complexity**.

**Essential complexity** is inherent to the problem domain. If you're building a tax calculator, the tax rules are essential complexity — you can't simplify them away.

**Accidental complexity** is introduced by our tools, languages, approaches. State management in UI is largely accidental — functional reactive patterns reduce it significantly.

The paper's thesis: most software complexity is accidental. We should minimize accidental complexity aggressively, and then find the simplest possible representation of essential complexity.

Practical question to ask when reviewing code: "does this complexity exist because the problem requires it, or because of how we chose to solve it?"`,
  },
  {
    title: 'LLM prompting: the chain-of-thought insight',
    category: 'ai',
    tags: ['llm', 'prompting', 'ai', 'reasoning'],
    content: `Chain-of-thought prompting works because it forces the model to "show its work" before committing to an answer. The intermediate steps are not just for human readability — they actually change the token distribution the model uses for its final answer.

Practical implication: for any task that requires multi-step reasoning, adding "Think step by step" or explicitly asking for intermediate steps before the final answer significantly improves accuracy.

This also explains why few-shot examples with reasoning steps outperform few-shot examples with just answers. The model learns the pattern of reasoning, not just input→output mapping.

What I want to test: does putting the chain-of-thought after "Answer:" (i.e., forcing reasoning before seeing the answer token) work better than putting it before?`,
  },
  {
    title: 'SQLite FTS5 rank function explained',
    category: 'databases',
    tags: ['sqlite', 'fts5', 'search', 'databases'],
    content: `The FTS5 \`rank\` column returns a negative real number — more negative = less relevant. This trips people up because they expect positive scores.

The default ranking function (BM25) considers:
- Term frequency in the document
- Document frequency across the corpus (rarer terms score higher)
- Document length normalization

To sort by relevance: \`ORDER BY rank\` (ascending, because more negative = worse).

Quirk: \`rank\` is only valid inside FTS5 queries using \`MATCH\`. You can't use it in subqueries easily without materializing.

Custom ranking: you can provide your own rank function via \`fts5_api\`. The signature takes arrays of phrase occurrences per column. Probably overkill for most use cases — BM25 is good enough.

Useful: \`snippet()\` function for search result highlights. Much simpler than implementing it yourself.`,
  },
  {
    title: 'TypeScript: when to use unknown vs any',
    category: 'programming',
    tags: ['typescript', 'type-safety', 'programming'],
    content: `**Rule**: Prefer \`unknown\` over \`any\` whenever you receive data from an external source (API response, JSON.parse, user input, third-party library with poor types).

The difference:
- \`any\` disables type checking entirely — you can call methods, index properties, pass it anywhere
- \`unknown\` requires explicit narrowing before use — type guards, assertions, or Zod parsing

Pattern I use for API responses:
\`\`\`typescript
const data: unknown = await response.json();
const parsed = MySchema.parse(data); // Zod throws if invalid
\`\`\`

The only time \`any\` is justified: bridging to genuinely untyped legacy code where the cost of typing is higher than the benefit, and you're wrapping it immediately in typed functions anyway.

\`exactOptionalPropertyTypes\` in tsconfig.json is also worth enabling — it distinguishes \`{ x?: string }\` (x may be absent) from \`{ x: string | undefined }\` (x is present but undefined). Important distinction for serialization.`,
  },
  {
    title: 'Git: commits as a communication tool',
    category: 'engineering',
    tags: ['git', 'workflow', 'communication', 'engineering'],
    content: `Commits are not just version control — they're documentation. The git log is a record of *why* the code changed, not just *what* changed (that's what the diff is for).

Good commit message structure:
- First line: imperative mood, ≤72 chars, states what this commit does ("Add rate limiting to user API")
- Body (optional): why the change, not what. Link to issue. Explain trade-offs.

Anti-patterns I see:
- "fix" — fix what? why? how?
- "WIP" or "tmp" on long-lived branches
- Giant commits that mix refactoring, new features, and bug fixes

Atomic commits (one logical change per commit) make bisect powerful. When a bug is found, \`git bisect\` can pinpoint the exact commit that introduced it — but only if commits are atomic enough that "introduced it" has meaning.

I try to commit at the end of each logical unit of work, even if the feature isn't complete. Local commits can always be squashed before pushing.`,
  },
  {
    title: 'Distributed systems: the two generals problem',
    category: 'distributed-systems',
    tags: ['distributed-systems', 'consistency', 'fundamentals'],
    content: `The Two Generals Problem proves mathematically that you cannot achieve guaranteed consensus over an unreliable communication channel. This is not a solvable engineering problem — it's a formal impossibility proof.

What this means in practice:
- No distributed system can guarantee exactly-once delivery with unreliable networks
- At best we get "at least once" + idempotency, or "at most once" + detection

The practical solution space:
- **Idempotent operations**: make every operation safe to retry (use idempotency keys)
- **Saga pattern**: break long transactions into compensatable steps
- **Eventual consistency + reconciliation**: accept temporary divergence, detect and resolve conflicts

CAP theorem is related: Consistency, Availability, Partition tolerance — pick two. In a network partition (which *will* happen), you choose: reject writes (CA), or accept potentially inconsistent reads (AP).

Most web apps should choose AP with eventual consistency. CA is for when stale data causes real harm (financial ledgers, medical records).`,
  },
  {
    title: 'How I think about API design',
    category: 'engineering',
    tags: ['api-design', 'engineering', 'dx', 'rest'],
    content: `A good API is hard to use wrong. That's the north star.

Principles I apply:
1. **Fail fast and loudly** — validate at boundaries, return clear errors immediately. Never silently accept wrong input.
2. **Consistent naming** — if you use \`userId\` in one endpoint, don't use \`user_id\` in another. Pick a convention and stick to it.
3. **Return what you promised** — don't add fields to responses without versioning. Consumers depend on response shapes.
4. **Idempotent mutations** — PUT and DELETE should be idempotent. POST with idempotency keys where needed.
5. **Pagination from day one** — never return unbounded lists. Even if you have 10 items today.

The hardest part: removing things. Once an API is public, you have to support it forever or break consumers. Design for extension from the start — use versioning, make optional params optional, don't expose internal implementation details.`,
  },
  {
    title: 'Notes on BullMQ and job queues',
    category: 'infrastructure',
    tags: ['bullmq', 'redis', 'queues', 'node'],
    content: `BullMQ is the successor to Bull (same authors). Key differences:
- Full TypeScript support
- Workers run in separate processes/threads by default
- Better support for job groups and rate limiting
- Flows (job dependency graphs)

Patterns that have worked for me:
- **Concurrency per worker**: set \`concurrency\` based on whether jobs are CPU or I/O bound. I/O bound: high concurrency (20-50). CPU bound: match CPU count.
- **Job priorities**: use sparingly — the priority queue has overhead. Better to have separate queues for different priority tiers.
- **Stalled jobs**: always configure a \`stalledInterval\`. Jobs that crash mid-execution need to be detected and retried.
- **Backpressure**: use \`limiter\` option to rate-limit job processing. Prevents downstream service overload.

Gotcha: if your Redis connection drops, BullMQ will queue operations in memory and replay them on reconnect. But if the process dies during a disconnection, those in-memory ops are lost. Use persistent connections and handle reconnect events carefully.`,
  },
  {
    title: 'What makes a good code review',
    category: 'engineering',
    tags: ['code-review', 'engineering', 'team', 'feedback'],
    content: `Code review is a teaching and learning opportunity, not an approval gate. The goal is shared understanding plus better code — not gatekeeping.

What to look for (in rough priority order):
1. **Correctness** — does it do what it claims? edge cases handled?
2. **Security** — input validation, auth checks, secrets handling
3. **Readability** — will future-you understand this in 6 months?
4. **Testability** — can we verify this works? are tests included?
5. **Performance** — is there an obvious inefficiency? (avoid premature optimization)
6. **Style** — lowest priority; ideally handled by formatters/linters

How to give feedback:
- Be specific: "this loop is O(n²); here's a O(n) alternative" not "this is slow"
- Distinguish blocking from non-blocking: "[nit]" for non-critical style, "[must]" for blocking
- Ask questions before asserting: "does this need to handle the empty array case?" rather than "you forgot to handle empty arrays"

The best outcome: both reviewer and author learn something.`,
  },
  {
    title: 'Obsidian zettelkasten setup that actually works',
    category: 'productivity',
    tags: ['obsidian', 'zettelkasten', 'pkm', 'productivity'],
    content: `After trying many systems, settled on this:

**Folder structure**: flat. No nested folders. Tags + links do the organizing.

**Note types**:
- Fleeting notes: raw captures, no structure (dump in inbox)
- Literature notes: one note per source, summarize in my own words
- Permanent notes: one idea, well-developed, linked to related notes
- Maps of Content (MOC): index notes that link to clusters of related permanents

**The key habit**: process inbox weekly. Turn fleeting notes into literature or permanent notes, or delete them.

**What I don't do**:
- Timestamp-based filenames (hard to read in links)
- Mandatory templates (kills spontaneity)
- Hierarchical folders (creates anxiety about "correct" location)

The Zettelkasten works when you use the graph view as a discovery tool, not for organizing. When you see unexpected connections between notes, that's the system working.`,
  },
  {
    title: 'Running metrics: what actually matters',
    category: 'health',
    tags: ['running', 'health', 'fitness', 'metrics'],
    content: `After tracking everything for 6 months, what I actually pay attention to:

**Weekly volume** (km): the single best predictor of fitness. Steady increases of ≤10% per week to avoid injury.

**Resting heart rate**: tracks adaptations over time. Went from 58 to 51 bpm over 4 months of consistent training. Spike = sign of overtraining or illness.

**Heart rate zones**: most runs should be in zone 2 (conversational pace). Only 20% in zone 4-5. I was doing the opposite and plateaued.

**What I ignore**: pace (it's a result, not an input), calories burned (inaccurate anyway), VO2max estimates from the watch (too noisy to be actionable).

Injury prevention > performance gains. The biggest variable in long-term progress is consistency, and consistency requires staying healthy.`,
  },
  {
    title: 'Thinking about personal finance: the boring strategy that works',
    category: 'finance',
    tags: ['finance', 'investing', 'personal-finance', 'index-funds'],
    content: `The evidence-based approach that most financial advisors won't tell you because it doesn't generate fees:

1. Minimize expenses first (housing, cars, subscriptions)
2. Emergency fund: 3-6 months expenses in HYSA
3. Max tax-advantaged accounts (pension/ISA/401k equivalent) before taxable
4. Invest in low-cost total market index funds
5. Never time the market; set it and forget it

The math on fees: a 1% annual fee on £100k invested over 30 years costs ~£78k in compound returns compared to a 0.07% fee fund. Fees are the one return predictor you can actually control.

Active fund managers don't consistently beat the index net of fees over long periods. The ones that do this year are random compared to who does it next year. Index everything.

Automate it. Remove willpower from the equation. Set up automatic contributions and ignore market news.`,
  },
  {
    title: 'Understanding embeddings intuitively',
    category: 'ai',
    tags: ['embeddings', 'ai', 'machine-learning', 'search'],
    content: `An embedding is a way of encoding meaning as position in a high-dimensional space. Similar meanings → nearby positions.

The famous example: \`king - man + woman ≈ queen\`. The vector arithmetic works because gender and royalty are encoded as consistent directions in the embedding space.

Why this is useful:
- Semantic search: find documents similar in meaning, not just matching keywords
- Clustering: group similar concepts without predefined categories
- Recommendation: things close in embedding space are similar to what you like

The practical limitation: embeddings capture statistical co-occurrence in training data. They can encode bias, they can't update in real-time, and they don't understand causality — just association.

For EchOS specifically: embedding notes and querying by vector similarity gives us "what have I written about that's related to this?" which keyword search can't do. The two modes complement each other.`,
  },
  {
    title: 'On saying no (and the cost of always saying yes)',
    category: 'personal',
    tags: ['productivity', 'focus', 'saying-no', 'priorities'],
    content: `Every "yes" is an implicit "no" to something else. This sounds obvious but I consistently underestimate how full my calendar already is before accepting new things.

The question to ask before any commitment: "what am I saying no to by saying yes to this?"

Inversion helps: I now maintain a "not-to-do list" alongside my to-do list. Things I've decided not to work on, with the reasoning. It prevents me from re-relitigating decisions I've already made.

Derek Sivers rule: "if it's not a hell yes, it's a no." This is too aggressive for professional contexts where some things are just responsibilities. But for optional projects, learning, side things — it's the right bar.

What I've said no to this year that I'm glad about: another committee, a freelance project that would have been lucrative but not interesting, volunteering for a role that would have added 5 hours/week of coordination work.`,
  },
  {
    title: 'pnpm workspaces: things I wish I knew earlier',
    category: 'programming',
    tags: ['pnpm', 'monorepo', 'node', 'tooling'],
    content: `**Hoisting gotchas**: pnpm doesn't hoist by default (unlike npm/yarn). A package in \`packages/app\` that imports something only declared in the root \`package.json\` will fail. Always declare deps where they're used.

**\`workspace:*\` protocol**: use \`"@myorg/shared": "workspace:*"\` to reference local packages. pnpm resolves these to the local version without symlink issues.

**Filtering**: \`pnpm --filter @myorg/app build\` runs only for that package. \`pnpm --filter ...\` runs for it and everything that depends on it.

**Running scripts**: \`pnpm -r run test\` runs \`test\` script across all packages with one. Add \`--parallel\` if order doesn't matter.

**Gotcha with TypeScript**: each package needs its own tsconfig. A shared base tsconfig in root is a pattern: packages extend it with \`"extends": "../../tsconfig.base.json"\`. But keep path resolution local to each package.

**Changesets**: for versioning across packages with linked releases, @changesets/cli integrates well with pnpm workspaces.`,
  },
  {
    title: 'Docker multi-stage builds for Node apps',
    category: 'infrastructure',
    tags: ['docker', 'node', 'deployment', 'containers'],
    content: `Multi-stage builds cut image sizes dramatically. The key insight: you need dev dependencies to build but not to run.

Pattern that works:
\`\`\`dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]
\`\`\`

Optimizations:
- Use Alpine base (much smaller than full Debian)
- Copy package.json before source (layer caching — deps only reinstall when package.json changes)
- Non-root USER for security
- \`.dockerignore\` to exclude node_modules, .git, test files

For pnpm: \`RUN npm install -g pnpm && pnpm install --frozen-lockfile\``,
  },
  {
    title: 'Vim motions that changed how I edit text',
    category: 'productivity',
    tags: ['vim', 'editor', 'productivity', 'tools'],
    content: `The motions I actually use daily vs. the ones I thought I'd use:

**High value:**
- \`ciw\` (change inner word) — replaces word under cursor without touching surrounding characters
- \`di"\` / \`ci"\` — delete/change inside quotes
- \`<C-o>\` — jump back to previous position (navigate forward/backward through jump history)
- \`.\` — repeat last action. Underappreciated. Chain with search to apply same edit across file.
- \`%\` — jump to matching bracket/paren. Not obvious but essential.
- \`*\` / \`#\` — search for word under cursor forward/backward

**Low value (despite hype):**
- Macros (q) — useful occasionally but I reach for sed instead in practice
- Ex commands — I use them but most editing is with normal mode

The real win is thinking in objects: "word", "sentence", "paragraph", "block", "inner quotes". Once you internalize [verb][modifier][object], motions compose naturally.`,
  },
  {
    title: 'On writing clearly: lessons from editing my own work',
    category: 'writing',
    tags: ['writing', 'communication', 'clarity', 'editing'],
    content: `Editing rule 1: cut the first paragraph. It's almost always context-setting that the reader doesn't need before they know why they're reading.

Rule 2: active voice. "The function validates input" > "Input is validated by the function." The subject should act, not receive.

Rule 3: each sentence should contain one idea. If you find yourself using "and" or "but" or "which" mid-sentence, consider splitting.

Rule 4: avoid weasel words. "Relatively", "fairly", "quite", "somewhat" — either quantify or cut. "The function is fairly fast" means nothing.

Rule 5: if you can't explain it simply, you don't understand it yet. Writing exposes gaps in thinking. When a sentence is hard to write, often the underlying idea isn't clear yet.

The best test: read it aloud. If you stumble, the sentence needs work. If you run out of breath, it's too long.`,
  },
  {
    title: 'Python generators are underused',
    category: 'programming',
    tags: ['python', 'generators', 'programming', 'performance'],
    content: `Generators produce values lazily — they don't compute the whole sequence upfront. This matters when:
- The sequence is infinite or too large to hold in memory
- Computation is expensive and you might not need all values
- You want to pipeline transformations without intermediate lists

Classic use: \`def read_large_file(path): for line in open(path): yield line.strip()\`

The file handle stays open only as long as you're iterating. Compare to reading all lines into a list — that buffers the entire file.

Generator expressions: \`(x**2 for x in range(1000))\` vs \`[x**2 for x in range(1000)]\`. First is lazy, second is eager.

The \`itertools\` module is the stdlib companion. \`itertools.chain\`, \`itertools.islice\`, \`itertools.groupby\` — worth knowing well.

Where they're less useful: when you need random access, when you'll iterate multiple times (generators are consumed), when you need length upfront.`,
  },
  {
    title: 'Questions I keep asking about product decisions',
    category: 'product',
    tags: ['product', 'decision-making', 'questions'],
    content: `Questions I've found reliably useful before committing to a product direction:

**On the problem:**
- What's the actual job-to-be-done? What is the user trying to accomplish, not just what feature do they want?
- How does this user currently solve this problem? What are they doing instead?
- If we built this perfectly, how would we know it worked?

**On the approach:**
- What's the smallest thing that could test our core assumption?
- What would have to be true for this to fail? How do we validate those assumptions first?
- Who else has tried this? What happened?

**On tradeoffs:**
- What are we explicitly not doing by doing this?
- What becomes harder to change later because of this decision?
- Would we make this decision the same way with 10x the users? 0.1x?

The discipline is using these questions to slow down, not just to generate more analysis. The goal is one clear answer, not ten hedged ones.`,
  },
  {
    title: 'How zsh autocomplete actually works',
    category: 'tools',
    tags: ['zsh', 'shell', 'tools', 'productivity'],
    content: `zsh's completion system (compsys) is programmable but arcane. Key concepts:

**Completion functions**: named \`_command\`, stored in \`$fpath\`. When you tab-complete \`git\`, zsh calls \`_git\`.

**\`#compdef\`**: first line of a completion script. Tells zsh which commands this script handles.

**compadd**: the core primitive. \`compadd -a myarray\` adds items to the completion list.

Useful patterns:
\`\`\`zsh
# Complete from dynamic list
_my_tool() {
  local -a options
  options=($(my-tool list 2>/dev/null))
  compadd -a options
}
\`\`\`

**oh-my-zsh / zsh-completions**: most tools have completions here. Check before writing your own.

**Lazy-loading**: \`compinit\` is slow on large \`$fpath\`. Use \`compinit -C\` after first run to skip security check, and \`compinit -d ~/.zcompdump-$HOST\` to cache per machine.

Performance tip: \`DISABLE_MAGIC_FUNCTIONS=true\` before sourcing oh-my-zsh if paste is slow.`,
  },
  {
    title: 'Understanding event loop: microtasks vs macrotasks',
    category: 'programming',
    tags: ['javascript', 'event-loop', 'async', 'node'],
    content: `The order that trips people up:

1. Current synchronous code finishes
2. **Microtask queue** drains completely (Promises, queueMicrotask)
3. One **macrotask** runs (setTimeout, setInterval, I/O callbacks)
4. Microtask queue drains again
5. Repeat

Why this matters:
\`\`\`js
setTimeout(() => console.log('macro'), 0);
Promise.resolve().then(() => console.log('micro'));
console.log('sync');
// Output: sync, micro, macro
\`\`\`

Practical implication: if you have deeply nested Promise chains, they all run before any setTimeout fires — even setTimeout(fn, 0).

\`process.nextTick\` in Node.js is even higher priority than Promise microtasks. It runs before the microtask queue. This is a Node-specific quirk.

\`queueMicrotask\` is the standards-compliant way to schedule a microtask without creating a Promise.`,
  },
  {
    title: 'CI/CD: things that make pipelines fast',
    category: 'infrastructure',
    tags: ['ci-cd', 'devops', 'github-actions', 'performance'],
    content: `Pipeline speed compounds — slow CI adds up to hours of developer wait time per week.

**Caching**:
- Cache \`node_modules\` keyed on lockfile hash. 95% of runs don't change deps.
- Cache test results for unchanged files (vitest/jest have this built in)
- Cache Docker layers — order Dockerfile commands from least to most frequently changing

**Parallelism**:
- Split slow test suites into shards
- Run lint, typecheck, and test in parallel jobs (not sequential steps)
- Build multiple packages simultaneously with \`pnpm -r --parallel build\`

**Fail fast**:
- Run the quickest checks first (lint → typecheck → unit tests → integration → e2e)
- If lint fails, don't waste time running 5-minute test suite

**What I've measured**:
- Caching node_modules: 3 min → 30 sec
- Parallel lint + typecheck: -2 min
- Test sharding (4 shards): -4 min on a large suite
Total: pipeline that took 12 min now takes 4 min.`,
  },
  {
    title: 'Notes on sleep: what I changed and what worked',
    category: 'health',
    tags: ['sleep', 'health', 'habits', 'wellbeing'],
    content: `After reading "Why We Sleep" and a few months of experimentation:

**What actually helped (measurable via resting HR and morning HRV):**
- Consistent wake time, even weekends. The most impactful change.
- No caffeine after 1pm. I thought I was immune; I wasn't.
- Temperature: room at 17-18°C. Vasodilation in hands/feet is part of the sleep onset mechanism.
- 20-minute walk in the morning. Sets circadian rhythm via light exposure.

**What I tried that didn't help me:**
- Magnesium glycinate (subjective but no measurable change for me)
- Sleep trackers — the Oura ring data was interesting but the recommendations were generic
- Strict 8-hour window — going to bed before I was sleepy just meant lying awake

**What I gave up:**
- Alcohol. The "it helps me sleep" belief is wrong. It fragments sleep architecture badly. Sleep HRV the night after drinking is reliably terrible.

Wake time: 6:00. Lights out: 10:30 typically. Actual sleep: 7.5-8h. Works.`,
  },
  {
    title: 'On technical debt: a more precise vocabulary',
    category: 'engineering',
    tags: ['technical-debt', 'engineering', 'codebase', 'maintenance'],
    content: `"Technical debt" is overloaded to the point of being useless. More useful distinctions:

**Deliberate debt**: consciously chosen shortcuts with a plan to repay. "We'll hard-code this config for the launch and make it configurable in the next sprint." Fine in small doses if actually repaid.

**Inadvertent debt**: mistakes made without realizing it. "We didn't know about this pattern when we wrote it." No shame — pay it back when you encounter it.

**Bit rot**: things that were fine once but the surrounding world changed. Dependencies got deprecated, APIs changed, the usage patterns shifted. Ongoing cost, not a one-time fix.

**Congenital debt**: inherited from acquisition, legacy systems, or decisions made before the current team existed. Often the most expensive because the original context is lost.

Tracking it: I keep a \`tech-debt.md\` in each project with concrete items (not vague "this is messy"), estimated cost-to-fix, and the benefit of fixing it. Untracked debt doesn't get paid.`,
  },
  {
    title: 'PostgreSQL query planning basics',
    category: 'databases',
    tags: ['postgresql', 'performance', 'sql', 'query-planning'],
    content: `\`EXPLAIN ANALYZE\` is the most useful tool I've underused. It shows the actual execution plan after running the query, including actual row counts vs estimates.

Key things to look for:
- **Seq Scan on a large table**: might need an index
- **Rows estimate far from actual**: stale statistics — run \`ANALYZE\`
- **Hash Join vs Nested Loop**: hash joins are better for large datasets, nested loops for small

Index types matter:
- B-tree (default): range queries, equality, sorts
- GIN: full-text search, JSONB contains
- GiST: geometric, range types
- Hash: equality only (rarely worth it over B-tree)

**Partial indexes**: index only a subset of rows. \`CREATE INDEX ON orders(created_at) WHERE status = 'pending'\` — fast for the common query, minimal overhead.

**Index bloat**: indexes on heavily-updated tables fragment over time. \`REINDEX CONCURRENTLY\` without locking.

The optimizer makes mistakes when statistics are stale or table sizes are unusual. Check planner estimates against actuals.`,
  },
  {
    title: 'Stoicism: what\'s actually useful, what\'s hype',
    category: 'philosophy',
    tags: ['stoicism', 'philosophy', 'mindset', 'mental-health'],
    content: `The useful core of Stoic practice, as I understand it:

**The dichotomy of control**: distinguish between what is "up to us" (our judgments, intentions, responses) and what is not (outcomes, others' opinions, external events). Direct energy only toward the former.

**Negative visualization**: periodically imagine loss — of relationships, health, work — not to be morbid but to counter hedonic adaptation and appreciate what you have. Brief and deliberate, not rumination.

**The view from above**: zoom out on current problems to see them in proportion. The "Pale Blue Dot" instinct.

What's overhyped:
- Rigid suppression of emotion. The Stoics didn't advocate this. They valued appropriate emotional response and distinguished destructive passions from healthy "good feelings."
- Cold detachment as strength. Equanimity isn't absence of feeling; it's not being overwhelmed by feeling.

The most practically useful thing I took from Marcus Aurelius: asking "is this in my control?" before reacting. It genuinely short-circuits a lot of wasted energy.`,
  },
  {
    title: 'When to use a queue vs direct call',
    category: 'infrastructure',
    tags: ['queues', 'architecture', 'async', 'distributed-systems'],
    content: `The decision heuristic:

**Use a queue when:**
- The work can tolerate latency (not user-facing in < 500ms)
- The work might fail and should be retried
- The consumer is slower than the producer (backpressure)
- You want to decouple the caller from knowing where the work goes

**Use a direct call when:**
- You need the result immediately
- Failure should propagate to the caller synchronously
- The operation is idempotent and fast

**The wrong reason to add a queue**: "to decouple things" without understanding the tradeoffs. Queues add latency, add infrastructure, make debugging harder (async errors are far from their cause), and require careful thought about ordering, idempotency, and failure modes.

The right reason: durability + retry + rate limiting + backpressure. If you don't need these, a direct async call is simpler and correct.`,
  },
  {
    title: 'How I use spaced repetition for technical knowledge',
    category: 'learning',
    tags: ['spaced-repetition', 'anki', 'learning', 'memory'],
    content: `Anki works. The science is solid. The failure mode is making cards that are too big.

**Good card**: "What does \`exactOptionalPropertyTypes\` do in TypeScript?" → "Distinguishes between a property being absent vs present but undefined. \`{x?: T}\` ≠ \`{x: T | undefined}\`."

**Bad card**: "Explain the TypeScript type system" → no single correct answer, can't meaningfully verify recall.

Rules I follow:
- One fact per card
- If I can't write a clear answer in 1-2 sentences, the question is too broad
- Add cards immediately after learning (don't batch weeks of learning into one session)
- Delete or suspend cards I stop caring about — a pruned deck is a used deck

What I don't use Anki for: concepts that I'll use daily (I'll remember through use) or concepts where understanding matters more than recall (process over answer).

I use it for: syntax I use weekly but not daily, command-line flags, configuration options, mathematical definitions.

Current deck: ~800 cards, review takes 15-20 min/day at steady state.`,
  },
];

// ─── JOURNAL TEMPLATES ───────────────────────────────────────────────────────

const JOURNAL_TEMPLATES: Template[] = [
  {
    title: 'Weekly Review — W',
    category: 'reflection',
    tags: ['weekly-review', 'productivity', 'reflection'],
    content: `**What got done:**
Shipped the authentication refactor that's been in progress for 2 weeks. Turns out the complexity was mostly in the session handling edge cases, not the JWT implementation itself. Glad to have it out.

**What got stuck:**
The vector search performance issue isn't resolved. I can reproduce it consistently with >10k documents but haven't isolated the cause yet — is it the embedding generation, the ANN query, or the re-ranking step?

**Unplanned things that happened:**
Spent 3 hours debugging a problem that turned out to be a stale compiled JS file shadowing a TypeScript source. Classic. Added a note to check for this pattern when vitest behaves unexpectedly.

**For next week:**
Isolate the search performance bottleneck. Do it with profiling, not guessing. Timebox to 2h.

**Energy level this week:** 6/10 — good mornings, slow afternoons. Might be the early season change.`,
  },
  {
    title: 'Morning pages — quick capture',
    category: 'personal',
    tags: ['morning', 'reflection', 'stream-of-consciousness'],
    content: `Woke up at 5:50 before the alarm. Unusual. Mind was already running through the architecture problem I left unsolved yesterday.

The question is: does the reconciler need to handle partial failures atomically? If it indexes 500 files and fails on 501, do we rollback everything or keep what succeeded?

Keeping partial success is probably the right answer — resumable rather than all-or-nothing. But it means the reconciler needs to track which files it's already processed in this run. Or just trust the content hash to skip already-indexed files.

Trust the hash. Much simpler. Each file is independent. A failed file leaves the others intact.

Also: been avoiding the backlog of reading articles. 15 things "saved to read" that I probably won't read. Should I prune the list or accept that saving something doesn't mean I'll read it?

Accept it. The list is a record of interest at a moment, not a commitment.`,
  },
  {
    title: 'End of month retrospective',
    category: 'work',
    tags: ['retrospective', 'work', 'monthly', 'goals'],
    content: `**Goals vs. actual:**
- ✅ Ship content taxonomy feature — done, tested, deployed
- ✅ Reconciler script for standalone sync — done
- ⚠️ Integration tests for storage layer — partial. Unit tests updated, integration tests still TODO
- ❌ Performance optimization for large note sets — not started, deprioritized

**Surprise friction:**
The \`@echos/shared\` dist rebuild requirement caught me multiple times. When you change shared types, you have to rebuild before consumers see the update. Need to automate this in watch mode.

**What I'm proud of:**
The content status system (saved/read/archived) feels right. It's a small addition but it changes how the agent talks about content — "in your reading list" vs "in your knowledge base" is a meaningful distinction.

**Next month focus:**
Performance. The system works at small scale. Need to know where the limits are before users hit them.`,
  },
  {
    title: 'Thinking through the open decision',
    category: 'personal',
    tags: ['decision-making', 'reflection', 'career'],
    content: `Writing to get clear on the open question: should I contribute the plugin system publicly or keep it internal for now?

**Arguments for open:**
- Forces better API design (public API gets scrutinized more)
- Others might solve edge cases I haven't thought of
- Builds credibility for the project

**Arguments for keeping it closed:**
- Too many unknowns still — the plugin API will change, and breaking changes hurt more with external consumers
- Maintenance overhead of public contributions before the core is stable
- Once public, you can't easily change the architecture without a major version bump

**What I keep coming back to:**
The system isn't stable enough to commit to an interface. The right time to open is when I'd be willing to write a changelog and support migrations.

**Decision:** Keep internal for now. Revisit when I have 3 months of stable plugin API with no breaking changes needed.`,
  },
  {
    title: 'Day after a rough day',
    category: 'personal',
    tags: ['reflection', 'setbacks', 'resilience'],
    content: `Yesterday was bad. A decision I was confident about was wrong, and I found out in the worst way — not in testing, but when a user reported data loss. Nothing catastrophic, recoverable, but still.

The sequence:
1. Assumption: the reconciler would be idempotent by design
2. Reality: it wasn't handling the case where a file moves between categories
3. Impact: the old location's SQLite row wasn't cleaned up, creating duplicates

What I should have done: written the test for file movement before shipping.

What I'm taking from this: reconciler tests need to cover not just "file exists and syncs" but also "file moves, renames, deletes." These lifecycle events are exactly where correctness bugs hide.

Feeling rough about it but the response was good — I communicated quickly, fixed it same day, wrote the test, shipped the patch. The post-mortem discipline is more important than avoiding the mistake.`,
  },
  {
    title: 'Why I started this project',
    category: 'personal',
    tags: ['motivation', 'personal', 'pkm', 'reflection'],
    content: `Wrote the first line of EchOS code because I was frustrated with all the existing PKM tools requiring me to be at a specific app, on a specific device, in a specific mode of thinking.

The original itch: I have ideas at odd times. Waiting at a coffee queue. Running. Half-awake at 2am. The right tool should meet me where I am — voice message on my phone, quick Telegram text, or a long note in Obsidian when I have time to develop an idea.

The agent layer came later. The realization: a retrieval system is only useful if retrieval is good. Keyword search misses context. Vector search misses exact terms. The combination, surfaced through natural language ("what have I written about X?"), is the thing.

What I didn't anticipate: how much the quality of notes affects everything downstream. Bad input → bad retrieval, bad summaries, bad connections. The discipline of writing clearly (even in quick voice notes) turns out to matter.

The current version is close to what I wanted to build. Good to revisit why occasionally.`,
  },
  {
    title: 'Unpacking the frustration with a specific meeting',
    category: 'work',
    tags: ['work', 'meetings', 'communication', 'reflection'],
    content: `Had a meeting today where three separate people asked for the same update that was in the document I sent beforehand. Classic.

What's actually happening: meeting invitees don't read prep material, so sync time is used to convey information that could have been async. This is a cultural default, not a personal failure.

Options:
1. **Shorter prep**: if the doc takes more than 5 minutes to read, people won't read it
2. **Required reading**: explicitly say "no meeting without reading this first" — risky socially, effective in cultures that support it
3. **Flip the format**: send the update async, use meeting only for decisions and discussions that require back-and-forth
4. **Accept it**: some people just need to hear information twice to process it

I'm going to try option 3 more explicitly. Frame the meeting invite with "this meeting is for [specific decision], not for updates — updates are in the linked doc." Low cost, worth trying.`,
  },
  {
    title: 'On the value of boredom',
    category: 'personal',
    tags: ['boredom', 'creativity', 'mindfulness', 'reflection'],
    content: `Had an unusually quiet Sunday. No plans, no specific projects, phone in another room.

By mid-afternoon, ideas started appearing that I don't think I would have had otherwise. Connections between things I've been working on. A solution to a problem I'd been pushing against. The beginning of a thought I want to develop into something.

This is not coincidence. Default Mode Network — the brain's baseline activity when not task-focused — is where a lot of associative thinking happens. Constant stimulation (podcasts, feeds, notifications) suppresses it.

The implication: "doing nothing" is not wasted time. It's unstructured processing time.

I'm bad at this. I fill every gap. The uncomfortable feeling of having nothing to do is a signal I usually override. This Sunday was a reminder not to.

Action: schedule one "no input" morning per week. See what emerges.`,
  },
  {
    title: 'After a period of intense output — assessment',
    category: 'work',
    tags: ['work', 'productivity', 'recovery', 'burnout-prevention'],
    content: `Three weeks of high output. A lot shipped, a lot of decisions made, a lot of context held in my head simultaneously.

Current state: functional but hollow. Ideas aren't as sharp. I'm solving problems but not seeing them clearly. Making acceptable decisions but not good ones.

The sign I needed: this morning I spent 45 minutes on a problem that, last month, I would have solved in 5 minutes. The bottleneck isn't knowledge or skill — it's bandwidth. I'm full.

Recovery plan:
- Next two days: only mechanical work. No architectural decisions, no new features.
- No technical reading for a week. Brain can't absorb more right now anyway.
- Exercise, earlier bedtimes, fewer notifications.

The trap is thinking more effort compensates for diminished capacity. It doesn't. Better to rest and come back sharp than to grind out mediocre work for another two weeks.

This is sustainable engineering: knowing when to stop, not just when to work harder.`,
  },
  {
    title: 'Ideas from today\'s walk',
    category: 'ideas',
    tags: ['ideas', 'creativity', 'walking', 'capture'],
    content: `Went for a 40-minute walk with no headphones. Things that surfaced:

**On search UX**: the interface shouldn't just return results — it should explain why results are relevant. "This appeared because it matches [term] and is related to [concept you asked about previously]." Trust-building for the user.

**On note quality over quantity**: I have ~200 notes now. Maybe half are actually useful knowledge. The rest are captures that I processed once and never returned to. Should the system surface notes by last-accessed date? Recency of access might correlate with continued relevance.

**On conversation saving**: the agent's context window is a natural unit. But what if you want to save a thread of thinking that spans multiple sessions? That's a harder problem. Linking conversation summaries?

**On this project in general**: I keep building features. When do I pause and use it seriously for a month, see what's actually missing vs. what I'm adding because it's interesting to build?

Good questions. Don't need answers today.`,
  },
  {
    title: 'What worked this sprint',
    category: 'work',
    tags: ['sprint', 'retrospective', 'work', 'agile'],
    content: `Two-week sprint retrospective (just for myself):

**Shipped:**
- Content status system (saved/read/archived)
- save_conversation + mark_content tools
- Standalone reconciler script
- Updated system prompt with content semantics

**What made it go smoothly:**
The plan was detailed enough to know exactly what needed changing before starting. The file list + what changes in each file saved probably 4 hours of figuring out as I went.

**What slowed me down:**
- Stale compiled JS files breaking vitest (30 min to debug)
- The \`@echos/shared\` rebuild requirement — every type change needs a rebuild before testing
- Testing edge cases in the reconciler that I hadn't thought through

**Process improvement:**
Add a \`pnpm build:shared\` pre-test hook that only rebuilds shared if source changed. Will save time across all future iterations.

**Energy and flow:**
Good. The feature felt right to build — it addressed a real confusion in the system (saved vs. known content).`,
  },
  {
    title: 'The problem with infinite news',
    category: 'personal',
    tags: ['news', 'media', 'focus', 'information-diet'],
    content: `Went a week without reading news deliberately — just to see. Observations:

1. I was less anxious. Not because good things happened — because I wasn't feeding the anxiety cycle of following things I can't influence.
2. I didn't miss anything important. The things that mattered reached me anyway through conversation.
3. I had more time. I didn't realize how much time I was spending on ambient news consumption.

The argument for following news: informed citizenship, understanding context, not being out of touch.

The argument against: most news consumption is not informative citizenship — it's anxiety-as-entertainment, presented as civic duty. Genuine understanding of complex issues requires depth, not freshness.

My new protocol: one weekly digest (The Economist long reads), deliberately curated. No daily news apps. Breaking news via actual humans telling me about it.

This is not ignorance. It's calibrated information diet. The world will continue making decisions either way.`,
  },
];

// ─── ARTICLE TEMPLATES ───────────────────────────────────────────────────────

const ARTICLE_TEMPLATES: Template[] = [
  {
    title: 'The End of the Redis License Era',
    category: 'technology',
    tags: ['redis', 'open-source', 'licensing', 'infrastructure'],
    gist: 'Redis moved to SSPL; Valkey fork now the OSS default for new projects',
    sourceUrl: 'https://newsletter.pragmaticengineer.com/p/redis-valkey',
    content: `Redis, the legendary in-memory data structure store, moved to SSPL (Server Side Public License) in 2024, affecting commercial use. The response from the open source community was swift: the Linux Foundation forked it as Valkey, which now has backing from AWS, Google, Oracle, and others.

## What changed

SSPL requires that any service providing Redis as a service must open-source their entire stack — a non-starter for cloud providers. This prompted the immediate fork.

## Practical impact for new projects

For most self-hosted use cases, Redis itself is still fine (SSPL allows self-hosting). The issue is cloud managed offerings — AWS ElastiCache moved to Valkey. For new projects, Valkey is the safe OSS choice.

## Performance comparison

Early benchmarks show Valkey and Redis performing within noise on most workloads. The Valkey team has already shipped some optimizations the Redis team hadn't.

## The broader licensing tension

This is part of a pattern: successful open-source infrastructure projects changing licenses to prevent cloud providers from profiting without contributing (HashiCorp/Terraform, Elasticsearch, MongoDB). The community response has become predictable: fork and continue.`,
  },
  {
    title: 'Indexing Strategies for High-Write Databases',
    category: 'technology',
    tags: ['databases', 'indexing', 'performance', 'postgresql'],
    gist: 'Partial indexes, covering indexes, and BRIN can dramatically reduce write overhead compared to naive B-tree indexes',
    sourceUrl: 'https://use-the-index-luke.com/sql/anatomy',
    content: `Every index has a write penalty. When a row is inserted or updated, all indexes on that table must be updated. For write-heavy tables, this cost compounds.

## Understanding the trade-off

An index makes reads fast by paying a cost on every write. The question is always: does the read speedup justify the write overhead? For frequently-queried, infrequently-written data: yes. For audit logs or append-only streams with rare queries: often no.

## Partial indexes

Index only the rows you actually query. An orders table where you frequently query pending orders:
\`CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending'\`

This index covers only pending orders — much smaller, faster to maintain, faster to query.

## Covering indexes

Include all columns a query needs in the index itself, avoiding a table lookup:
\`CREATE INDEX idx_users_email_name ON users(email) INCLUDE (name, role)\`

A query selecting only \`name\` and \`role\` where \`email = ?\` never touches the heap.

## BRIN indexes

Block Range INdex — a tiny index that stores min/max values per block range. Ideal for naturally-ordered data (timestamps, sequential IDs). 100x smaller than B-tree, useful when approximate range scans are sufficient.`,
  },
  {
    title: 'An Introduction to Raft Consensus Algorithm',
    category: 'technology',
    tags: ['distributed-systems', 'consensus', 'raft', 'algorithms'],
    gist: 'Raft achieves distributed consensus through leader election and log replication, designed to be understandable unlike Paxos',
    sourceUrl: 'https://raft.github.io/raft.pdf',
    content: `Raft is a consensus algorithm designed to be more understandable than Paxos. It's used in etcd, CockroachDB, TiKV, and many distributed systems.

## The problem it solves

Multiple servers need to agree on a sequence of values (a replicated log) even when some servers fail. Raft guarantees that if any server commits an entry, all servers eventually commit that entry, in the same order.

## Leader-follower model

Raft elects one leader at a time. The leader receives all client requests, appends them to its log, and replicates them to followers. A follower responds to RPCs from the leader and candidates.

## Leader election

Each server has an election timeout (randomized: 150-300ms typically). If no heartbeat is received within the timeout, the server becomes a candidate, increments its term, votes for itself, and requests votes from others. A candidate wins if it receives votes from a majority.

The randomized timeout prevents split votes — servers don't all become candidates simultaneously.

## Safety guarantee

A leader can only be elected if its log is at least as up-to-date as any other server's log. This prevents a server with a stale log from becoming leader and overwriting committed entries.

Raft is not Byzantine fault tolerant — it assumes servers behave correctly but may fail. For Byzantine tolerance, you need PBFT or Tendermint.`,
  },
  {
    title: 'Staff Engineer: Being Effective Without Direct Authority',
    category: 'career',
    tags: ['staff-engineer', 'leadership', 'career', 'influence'],
    gist: 'Staff engineers create leverage through technical strategy and cross-team influence, not management authority',
    sourceUrl: 'https://staffeng.com/guides/staff-archetypes',
    content: `The Staff Engineer role is poorly defined at most companies. Will Larson's framework of archetypes is the clearest mental model I've found.

## The four archetypes

**Tech Lead**: leads a team's technical work. Closest to senior engineer extended. Most common path.

**Architect**: responsible for technical direction in a specific domain — the expert others consult. High autonomy, high accountability.

**Solver**: the person who fixes hard, cross-cutting problems. Often works independently on problems the org doesn't know how to categorize.

**Right hand**: extends the capacity of an executive. Works at org scale, often on alignment and execution rather than technical problems.

## How influence works without authority

Staff engineers influence through: technical credibility (people trust your judgment because you've been right before), context breadth (you see across teams and connect dots), and investment in others (writing, RFCs, pairing, design reviews that leave capability behind).

The common failure mode: trying to use direct authority the role doesn't have. A Staff engineer who needs to "pull rank" is already losing.

## The writing habit

The most leveraged habit at Staff level is written communication — RFCs, decision docs, technical strategy docs. Writing scales in a way that meetings don't.`,
  },
  {
    title: 'How Browsers Actually Render a Page',
    category: 'technology',
    tags: ['browsers', 'performance', 'rendering', 'css', 'html'],
    gist: 'The rendering pipeline from HTML bytes to pixels involves parsing, style computation, layout, paint, and compositing',
    sourceUrl: 'https://web.dev/articles/critical-rendering-path',
    content: `Understanding browser rendering is prerequisite to understanding web performance.

## The pipeline

1. **Parse HTML**: browser reads bytes, constructs DOM
2. **Parse CSS**: builds CSSOM (CSS Object Model)
3. **Render tree**: combines DOM + CSSOM, excludes invisible nodes
4. **Layout**: calculates positions and sizes (also called "reflow")
5. **Paint**: draws content into layers
6. **Composite**: layers assembled on GPU and displayed

## What blocks rendering

**Parser-blocking scripts**: a \`<script>\` tag without \`defer\` or \`async\` blocks HTML parsing. Parser stops, fetches + executes script, then continues. This is why "put scripts at bottom of body" was advice for years.

**Render-blocking CSS**: any \`<link rel="stylesheet">\` blocks rendering until the stylesheet loads. CSSOM can't be built without it. Fix: inline critical CSS, load rest async.

## Layout thrashing

Reading a layout property (offsetWidth, scrollTop) then writing a style causes a forced layout. Do all reads first, then all writes. Libraries like fastdom batch these.

## The compositor

Certain CSS properties (opacity, transform) are compositor-only — they don't trigger layout or paint. Animating them is cheap. Animating width, top, background triggers layout → expensive.`,
  },
  {
    title: 'Goodbye Clean Architecture: a dissent',
    category: 'technology',
    tags: ['architecture', 'clean-architecture', 'software-design', 'pragmatism'],
    gist: 'Clean Architecture\'s strict layering creates overhead disproportionate to the benefits in most applications',
    sourceUrl: 'https://programmingisterrible.com/post/clean-architecture-is-not-clean',
    content: `Clean Architecture (Robert Martin) prescribes strict separation: Entities, Use Cases, Interface Adapters, Frameworks & Drivers. Dependencies only point inward.

## The benefits are real, but...

The dependency inversion — business logic knowing nothing about databases or frameworks — is genuinely useful. It makes business rules portable and testable.

## Where it goes wrong in practice

The overhead is significant for small-to-medium teams. You end up with:
- Entities with no behavior (anemic domain model)
- Use case classes that are thin wrappers around a single repository call
- Interface definitions nobody else will ever implement
- DTOs everywhere for mapping between layers

The irony: in the name of flexibility, you create rigidity. Every simple change requires touching 5 layers.

## A more pragmatic approach

Start with the simplest structure that works. Add abstraction when you have a concrete reason — not "in case we need to swap the database." The database isn't getting swapped.

Rule of thumb: if you can explain the architecture of your system to a new developer in 5 minutes, it's probably not over-engineered. If it takes an hour, it is.`,
  },
  {
    title: 'Falsehoods Programmers Believe About Time',
    category: 'technology',
    tags: ['time', 'dates', 'programming', 'bugs'],
    gist: 'Time zones, leap seconds, DST transitions, and calendar systems make time handling reliably treacherous',
    sourceUrl: 'https://infiniteundo.com/post/25326999628/falsehoods-programmers-believe-about-time',
    content: `A partial list of false assumptions, each of which has caused real production bugs:

- "There are 24 hours in a day" — DST transitions mean some days have 23 or 25
- "A minute has 60 seconds" — leap seconds make some have 61
- "The system clock always moves forward" — NTP adjustments can go backward
- "Date X is before date Y if X is a smaller number" — timezone offsets make UTC comparison necessary
- "Time zones are on the hour" — India is UTC+5:30, Nepal is UTC+5:45
- "Midnight is always the start of a day" — some days start at 1am due to DST
- "The Unix epoch is always in the past" — in some timezones, midnight Jan 1 1970 is a negative offset

## The practical rule

Store all timestamps as UTC. Display in the user's local timezone, converting as late as possible (at the presentation layer). Never store local times in a database. Never compare two local times without first normalizing to UTC.

Use a proper datetime library (Luxon, date-fns, Temporal API when it lands) rather than Date arithmetic. The edge cases are already handled.`,
  },
  {
    title: 'AI in the Codebase: One Year In',
    category: 'technology',
    tags: ['ai', 'copilot', 'productivity', 'software-engineering'],
    gist: 'After a year with AI coding tools, the biggest gains are in boilerplate reduction and context-free tasks, not complex problem solving',
    sourceUrl: 'https://newsletter.pragmaticengineer.com/p/ai-coding-tools',
    content: `I've been using AI coding assistants daily for over a year. Here's what's actually changed.

## Where it helps

**Boilerplate**: generating CRUD endpoints, test structure, config files, markdown tables. 3x faster.

**Unfamiliar syntax**: I don't use Python daily. When I do, having something that remembers syntax correctly means I spend no time on Google.

**Explaining existing code**: "explain this regex" or "what does this SQL do?" — surprisingly good.

**First draft**: starting a function from a description. I usually rewrite the output, but starting from something beats starting from nothing.

## Where it doesn't help

**System design**: it produces confident-sounding architecture that ignores specific constraints of your system.

**Subtle bugs**: it generates code that looks right but has off-by-one errors, missing edge cases, wrong assumptions about library behavior.

**Novel problems**: the kind of problem where the solution isn't in the training data.

## The net assessment

I write less code. I review more generated code. The bottleneck moved from typing to thinking + reviewing. Not sure if that's a net win for me personally — I think in code, and having less code to write means less thinking happens.`,
  },
  {
    title: 'The Unexpected Costs of Microservices',
    category: 'technology',
    tags: ['microservices', 'architecture', 'distributed-systems', 'tradeoffs'],
    gist: 'Microservices solve scaling problems but introduce distributed systems problems that are harder to debug than monolith problems',
    sourceUrl: 'https://martinfowler.com/articles/microservices.html',
    content: `Most teams adopt microservices for the wrong reasons: they hear Netflix and Amazon did it, they want independent deployability, they think it'll let small teams work in parallel.

## What you actually get

**Network calls instead of function calls**: every service boundary is now a potential point of failure with latency, serialization cost, and partial failure modes.

**Distributed tracing becomes essential**: debugging a problem that spans 5 services requires tooling (Jaeger, Datadog) that takes time to set up and money to run.

**Data consistency**: you've traded transactions for eventual consistency. Sagas and outbox patterns are non-trivial to implement correctly.

**Operational overhead**: 10 services = 10 deployment pipelines, 10 sets of logs, 10 things to monitor.

## When it's actually worth it

When different parts of your system have genuinely different scaling characteristics. When you need different deployment schedules for different components. When different teams need real autonomy with different tech stacks.

## The recommendation

Start with a well-structured monolith. Extract services when you have a specific, demonstrated need. Don't distribute the system before you understand what needs to be distributed.`,
  },
  {
    title: 'Principles of Effective Technical Writing',
    category: 'communication',
    tags: ['writing', 'technical-writing', 'documentation', 'communication'],
    gist: 'Good technical writing states the purpose first, uses concrete examples, and is ruthlessly edited for length',
    sourceUrl: 'https://developers.google.com/tech-writing/one',
    content: `Technical writing serves a reader who needs to accomplish something. Every decision should be in service of that goal.

## Structure readers can navigate

State the purpose in the first sentence. Readers need to know if this is relevant before investing time. "This guide explains how to configure rate limiting" — not "Rate limiting is an important consideration for production systems."

## Prefer specific over general

"The function is fast" — meaningless. "The function processes 100k records/second on a 4-core machine" — useful.

"Some users reported errors" — how many? what errors?

Vague technical writing signals either uncertain knowledge or lazy revision.

## Active voice

"The library parses the JSON" > "The JSON is parsed by the library." Subject should act.

Passive voice is acceptable when the actor is unknown or unimportant: "Exceptions are logged and swallowed at the top level." But even here, active is usually clearer: "The top-level handler logs and swallows exceptions."

## Cut ruthlessly

If a word, sentence, or section doesn't add information, remove it. Documentation length is not a signal of thoroughness — it's an obstacle to finding what matters.

The best technical document is the shortest one that leaves no important question unanswered.`,
  },
  {
    title: 'What GraphQL Gets Right (and Wrong)',
    category: 'technology',
    tags: ['graphql', 'api', 'rest', 'tradeoffs'],
    gist: 'GraphQL eliminates over/under-fetching but shifts complexity from server to client and creates new N+1 query problems',
    sourceUrl: 'https://httptoolkit.com/blog/graphql-vs-rest',
    content: `GraphQL solves a real problem: clients know what data they need, servers don't. REST endpoints either over-return data (wasteful) or under-return it (multiple round trips).

## What it solves well

**Exact data fetch**: client requests precisely the fields it needs. No unused data transferred.

**Schema as documentation**: introspection means the API is self-documenting. Tooling (GraphiQL, Insomnia) can explore it without reading docs.

**Aggregating multiple resources**: instead of 3 REST calls, one GraphQL query.

## What it introduces

**N+1 queries**: the classic problem. A query for "posts with their authors" triggers one query per post for author data. Requires DataLoader or similar batching to fix — more complexity.

**Caching is harder**: REST GET requests are trivially cacheable at the HTTP level (CDN, browser). GraphQL POSTs aren't. Field-level caching requires client-side tooling (Apollo, urql).

**Complexity at the client**: REST is simple to call with fetch. GraphQL requires a query language, variables, and usually a client library.

## The honest assessment

If you're building a public API with many different clients with different needs: GraphQL wins. If you're building an API for one or two clients you control: REST is simpler and more debuggable.`,
  },
  {
    title: 'The PARA Method: a system for organizing digital information',
    category: 'productivity',
    tags: ['para', 'productivity', 'organization', 'tiago-forte'],
    gist: 'PARA organizes information by actionability: Projects, Areas, Resources, Archives — with Projects as the active focus',
    sourceUrl: 'https://fortelabs.com/blog/para/',
    content: `Tiago Forte's PARA method (from "Building a Second Brain") is the most practical information organization framework I've used.

## The four categories

**Projects**: active initiatives with a specific outcome and deadline. "Finish the EchOS plugin system" — not "side projects."

**Areas**: ongoing responsibilities without end dates. "Health," "finances," "work," "home." These don't complete; they're maintained.

**Resources**: topics of interest you might reference. Reading notes, reference material, how-tos.

**Archives**: inactive items from the above three. Projects that are done. Areas you've stepped back from. Resources you've moved past.

## Why it works

The key insight: organize by actionability, not by topic. Most organizational systems create elaborate hierarchies by subject that feel logical but don't serve retrieval. When I need a file, I'm usually in the context of a project — so looking in the project folder is the right behavior.

## How I've adapted it

Projects are the most important category. Anything in a project folder is actively being worked on. Everything else is support material.

I review the Projects list weekly. If something hasn't moved in 2 weeks, it's not actually a project — it gets archived.`,
  },
  {
    title: 'Claude: Constitutional AI and RLHF',
    category: 'ai',
    tags: ['claude', 'anthropic', 'constitutional-ai', 'rlhf', 'alignment'],
    gist: 'Constitutional AI uses a set of principles to guide AI behavior during training, reducing reliance on human feedback for every case',
    sourceUrl: 'https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback',
    content: `Anthropic's Constitutional AI (CAI) approach trains models to be helpful, harmless, and honest using a set of principles (a "constitution") rather than relying entirely on human labelers to judge every output.

## How it works

1. The model is given a set of principles (be helpful, avoid harm, respect autonomy, etc.)
2. During training, the model critiques and revises its own outputs against these principles
3. An AI preference model scores outputs by these principles, which guides reinforcement learning

## Why this matters

RLHF (Reinforcement Learning from Human Feedback) requires expensive human labeling at scale. Human feedback also has limitations — labelers make inconsistent judgments, they can be manipulated by surface features (confident-sounding wrong answers score better than uncertain correct ones), and scaling to millions of examples is expensive.

CAI allows the model to internally apply principles consistently at scale.

## What it doesn't solve

The quality of the constitution matters enormously. If the principles are poorly specified or conflict with each other, behavior is unpredictable. Also, the model is still optimizing for what the constitution says, not what the principles actually mean — Goodhart's Law applies.

The fundamental alignment problem — ensuring powerful AI systems want what humans actually want — remains open. CAI is a better training approach, not a solution.`,
  },
  {
    title: 'How Figma Builds Products: the no-meetings culture',
    category: 'business',
    tags: ['figma', 'product', 'culture', 'no-meetings', 'async'],
    gist: 'Figma defaults to async communication and written documentation, using meetings only for decisions requiring real-time back-and-forth',
    sourceUrl: 'https://www.figma.com/blog/how-we-do-product-at-figma',
    content: `Figma has been public about their product development approach. Some things that stood out from this piece.

## Default async

The principle: meetings are used for things that require real-time, high-bandwidth communication — not for information transfer. Information transfer happens in writing.

Practically: project updates go in a doc. Status goes in Slack. Decisions are proposed in writing, with context, and discussed asynchronously unless the decision is complex and time-sensitive.

## Written proposals before decisions

Major decisions require a written proposal with: problem statement, options considered, recommendation, and tradeoffs. Comments are collected before a meeting. The meeting then focuses on unresolved questions, not restating context.

## Small, empowered teams

Product teams have a PM, 1-2 engineers, and a designer. The team has genuine decision authority for their scope. This reduces the need for escalation and cross-team coordination meetings.

## What this requires organizationally

This only works if: writing is genuinely valued (and rewarded), reading is expected before meetings, and management doesn't undermine team decisions. The common failure: leaders say "be async" but then override async decisions in meetings, undermining trust in the system.`,
  },
  {
    title: 'Understanding Zod: validation at the TypeScript boundary',
    category: 'technology',
    tags: ['zod', 'typescript', 'validation', 'runtime'],
    gist: 'Zod provides runtime validation that aligns with TypeScript types, enforcing safe boundaries at the edges of your system',
    sourceUrl: 'https://zod.dev',
    content: `TypeScript's type system disappears at runtime. A value typed as \`string\` from an API response is still whatever the server actually sent — and runtime errors happen when assumptions are wrong.

## What Zod does

Zod defines schemas that both validate at runtime and infer TypeScript types. You write the schema once, get both.

\`\`\`typescript
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
});
type User = z.infer<typeof UserSchema>; // TypeScript type derived from schema
\`\`\`

## Where to use it

**Parsing external data**: API responses, environment variables, form input, query parameters. Anywhere the TypeScript type system can't prove safety.

**Not**: internal data passing between typed functions. Trust the compiler there; adding Zod is overhead without benefit.

## Composability

Schemas compose. \`.merge()\`, \`.extend()\`, \`.pick()\`, \`.omit()\`. You can build a schema library and derive variants without duplication.

## Error handling

\`.safeParse()\` returns \`{success: true, data: ...}\` or \`{success: false, error: ZodError}\`. More ergonomic than try/catch for expected validation failures.`,
  },
  {
    title: 'The Science of Habit Formation',
    category: 'psychology',
    tags: ['habits', 'psychology', 'behavior', 'neuroscience'],
    gist: 'Habits are formed through cue-routine-reward loops, and existing cues are more reliable than motivation for behavior change',
    sourceUrl: 'https://jamesclear.com/habit-stacking',
    content: `Charles Duhigg (The Power of Habit) and James Clear (Atomic Habits) have popularized the research on habit formation. The core is consistent enough to act on.

## The habit loop

**Cue → Routine → Reward**

The cue triggers the habit without conscious thought. The routine is the behavior. The reward reinforces the loop.

To build a habit: attach it to an existing cue, keep the routine small, make the reward immediate.

## Habit stacking

"After [CURRENT HABIT], I will [NEW HABIT]." This uses an existing cue (an established habit) to trigger the new one.

"After I make coffee, I will write in my journal for 5 minutes." The coffee-making is the cue; no willpower required to remember.

## Making it easy vs. attractive

Two different levers:
- **Ease**: reduce friction for desired habits (gym bag packed the night before), increase friction for undesired ones (phone charger in another room)
- **Attractiveness**: pair habits with things you enjoy (podcast only while exercising), use social accountability

## The 2-minute rule

A new habit should take less than 2 minutes to do. The goal is to establish the habit identity, not to immediately do the full behavior. 2 minutes of exercise is better than not starting because the full workout feels too much.`,
  },
  {
    title: 'Why Functional Programming Matters',
    category: 'technology',
    tags: ['functional-programming', 'haskell', 'immutability', 'composability'],
    gist: 'Functional programming\'s value is in managing complexity through immutability, pure functions, and algebraic composition',
    sourceUrl: 'https://www.cs.kent.ac.uk/people/staff/dat/miranda/whyfp90.pdf',
    content: `John Hughes' 1990 paper is still the clearest argument for why functional programming matters. The core claim: modularity (and therefore reuse) is the key to productive programming, and functional features make modularity easier.

## What makes FP code composable

**Pure functions**: same inputs always produce same outputs, no side effects. Because behavior depends only on arguments, pure functions compose without hidden coupling.

**Immutability**: data doesn't change in place. Instead of mutating, you transform. This makes state predictable — you always know what a value is, regardless of what else has run.

**Higher-order functions**: functions that take and return functions. \`map\`, \`filter\`, \`reduce\` are powerful because they separate the structure of computation (iterate over a list) from the content (what to do with each element).

## What doesn't require full FP adoption

You don't need Haskell to benefit. The same principles in TypeScript:
- Prefer const over let
- Return new objects instead of mutating
- Use map/filter/reduce instead of imperative loops
- Keep I/O at the edges; keep business logic pure

The benefits (testability, composability, predictability) are proportional to how consistently you apply them.`,
  },
  {
    title: 'Lessons from Building a Personal Finance Tool',
    category: 'business',
    tags: ['personal-finance', 'startup', 'product', 'lessons'],
    gist: 'The hardest part of personal finance software is the emotional dimension — people avoid confronting their own financial reality',
    sourceUrl: 'https://every.to/p/lessons-building-personal-finance',
    content: `Three years building a small personal finance tool. What I learned about the domain and about building software for emotional topics.

## The emotional dimension

Finance is not primarily a technical problem. The hard part is that people avoid looking at their financial situation because it's stressful. A tool that shows accurate data can make the problem feel more real and therefore worse.

The design implication: surfaces that track spending need to acknowledge that seeing the number is hard, not just show the number. Progress framing matters more than accuracy.

## Data aggregation is hard to maintain

Bank integrations break constantly. Plaid and similar services help but don't eliminate the problem. Transaction categorization needs ongoing manual correction. These operational costs are real and ongoing — not a one-time integration.

## The retention problem

People use finance tools intensely when something triggers it (tax season, debt crisis, major purchase decision), then abandon them. Sustainable retention requires finding a reason to be there weekly, not just in moments of urgency.

The answer: habit loops around the weekly review. Not just a dashboard, but a prompt + review + decision workflow.

## What I'd do differently

Narrower scope from the start. The temptation to handle everything (budgeting, investment tracking, goal setting, tax) creates a product that's mediocre at all of them. Owning one workflow completely is more valuable.`,
  },
  {
    title: 'The Physics of Climate Change, Explained Clearly',
    category: 'science',
    tags: ['climate', 'physics', 'science', 'explainer'],
    gist: 'Greenhouse gases trap outgoing infrared radiation, warming the surface — the mechanism is well-understood physics from the 1800s',
    sourceUrl: 'https://aeon.co/essays/how-greenhouse-gases-actually-warm-the-planet',
    content: `The greenhouse effect was described by Eunice Newton Foote in 1856 and John Tyndall in 1859. The physical mechanism is not new science.

## How it works

The sun emits radiation primarily in the visible spectrum. Earth's surface absorbs this, warms, and re-emits it as infrared (heat) radiation. Some of this outgoing infrared is absorbed by atmospheric gases — primarily water vapor, CO₂, methane, and nitrous oxide — and re-radiated back toward Earth.

The net effect: less heat escapes to space than arrives from the sun. The surface warms until equilibrium is re-established at a higher temperature.

## Why CO₂ specifically

Water vapor is the dominant greenhouse gas by volume, but it's feedback, not forcing. CO₂ is long-lived in the atmosphere (centuries) and varies with human activity. Increasing CO₂ increases water vapor through warming, which amplifies the effect.

## The confidence question

The basic mechanism is confirmed by satellite measurement (outgoing infrared is demonstrably lower in CO₂ absorption bands), isotope analysis (anthropogenic CO₂ has a distinct fingerprint), and surface temperature records.

Uncertainty exists in specific feedbacks, regional impacts, and tipping points — not in whether the warming is happening or why.`,
  },
];

// ─── YOUTUBE TEMPLATES ───────────────────────────────────────────────────────

const YOUTUBE_TEMPLATES: Template[] = [
  {
    title: 'Building a Compiler from Scratch — Tsoding Daily',
    category: 'programming',
    tags: ['compilers', 'programming', 'c', 'low-level'],
    gist: 'Parsing and lexing explained hands-on by writing a small language compiler in C from zero',
    sourceUrl: 'https://www.youtube.com/watch?v=dDkTd4dTbNI',
    content: `Tsoding (Alexey Kutepov) builds a small language step by step. The value is watching the decisions being made, not just the finished product.

**Why it's worth watching:**
Most compiler resources are academic. This shows a working programmer actually making choices: when to generalize, when to hardcode, when to refactor.

**Key things I took from this:**
1. Lexing is simpler than I thought — it's just categorizing characters into tokens
2. The parser transforms a flat token stream into a tree — this is where grammar rules live
3. Writing a codegen that emits assembly is scary-sounding but mechanically straightforward once you have the AST

**What I want to explore next:**
- How LLVM IR works as a compilation target (avoids writing actual assembly)
- Tree-sitter as a parser generator for editor tooling
- How incremental compilation works (don't recompile what didn't change)`,
  },
  {
    title: 'Lex Fridman interviews John Carmack on programming and work ethic',
    category: 'productivity',
    tags: ['carmack', 'programming', 'focus', 'work-ethic'],
    gist: 'Carmack describes his method of deep focus on single problems for days at a time, and his view on AI coding assistance',
    sourceUrl: 'https://www.youtube.com/watch?v=I845O57ZSy4',
    content: `A 5-hour conversation. Highlights for me:

**On focus and how Carmack works:**
He describes days where he does nothing but think about a single problem — doesn't code at all, just thinks. Then writes everything in a concentrated burst. This is very different from most developers' context-switching day.

He believes the bottleneck in his work is clarity of thought, not typing. Code is easy once you know exactly what you want to write.

**On AI coding tools:**
Cautiously positive. Thinks they're useful for boilerplate and for areas where he doesn't have deep expertise. Skeptical that they help with the hard parts — the parts where the answer isn't already somewhere in the training data.

**On career paths in software:**
The best developers he's worked with all share: deep curiosity, willingness to understand things all the way down, and comfort with being wrong. Not certifications, not CS degrees specifically.

**Quote I saved:**
"I care less about elegance than correctness. I can make it elegant later. A correct solution to an ugly problem is still a solution."`,
  },
  {
    title: '3Blue1Brown: Transformers, Visually Explained',
    category: 'ai',
    tags: ['transformers', 'attention', 'neural-networks', 'ai', '3blue1brown'],
    gist: 'Visual explanation of attention mechanisms — how transformers decide which tokens to attend to',
    sourceUrl: 'https://www.youtube.com/watch?v=eMlx5fFNoYc',
    content: `Grant Sanderson's explanation of attention is the best I've found. The visual intuition is essential.

**Key intuition for attention:**
Each token in the input produces three vectors: Query (what am I looking for?), Key (what do I contain?), Value (what do I communicate?).

The attention score between token A and token B is the dot product of A's Query with B's Key. High score = A should "attend to" B a lot.

**Why this is powerful:**
The same word in different contexts can have different attention patterns. "Bank" in "bank account" attends to money-related tokens; "bank" in "river bank" attends to water/geography tokens. The model learns these context-dependent patterns.

**Self-attention vs cross-attention:**
In the encoder, tokens attend to other tokens in the same sequence (self-attention). In the decoder, tokens also attend to encoder outputs (cross-attention) — this is how the decoder "looks at" the input when generating output.

**What I want to understand better:**
Why do multi-head attention heads specialize? Is this imposed by training or emergent?`,
  },
  {
    title: 'Theo (t3.gg): Why I Switched from Next.js to Astro',
    category: 'technology',
    tags: ['nextjs', 'astro', 'web', 'performance', 'javascript'],
    gist: 'Content-heavy sites benefit from Astro\'s island architecture over Next.js\'s React-first approach',
    sourceUrl: 'https://www.youtube.com/watch?v=x8vZHMiOjac',
    content: `Theo is entertainingly opinionated. The actual technical content is valuable once you filter for signal.

**The actual argument:**
Next.js is optimized for app-like experiences where most of the page is interactive. For content-heavy sites (docs, blogs, marketing), you're paying the React bundle cost for pages that are mostly static.

Astro's island architecture: pages are static HTML by default. Interactive components ("islands") are hydrated individually, only when needed. The result: dramatically smaller JS payload for content sites.

**Numbers cited:**
A site they migrated saw ~400KB → ~40KB of JS on page load. Load time measurably improved.

**Where I'd use each:**
- Astro: marketing sites, docs, blogs, content-driven pages
- Next.js: applications with significant interactivity, dynamic data, complex client-side state

**What I want to try:**
Building this project's docs site in Astro. Currently it's just markdown — a static Astro site would make it navigable.`,
  },
  {
    title: 'Andrej Karpathy: The State of GPT (2023)',
    category: 'ai',
    tags: ['llm', 'gpt', 'training', 'ai', 'karpathy'],
    gist: 'Comprehensive overview of how GPT models are trained, from pretraining to RLHF, by a core contributor',
    sourceUrl: 'https://www.youtube.com/watch?v=bZQun8Y4L2A',
    content: `One of the best technical overviews of how modern LLMs actually get trained. Karpathy is unusually clear about what we know vs. what we're still figuring out.

**The training pipeline:**
1. **Pretraining** on internet-scale text → the "base model." It's a next-token predictor. Not useful on its own.
2. **Supervised fine-tuning (SFT)** on human-curated Q&A → teaches the assistant format
3. **RLHF** using human preference data → aligns responses with what humans prefer
4. **(Optional) Constitutional AI / AI feedback** → scales to larger datasets

**Key insight on base models:**
The base model will try to complete any text it's given as if it's from the internet. If you give it a question, it might return more questions (it's completing a "FAQ format"). The SFT step teaches it to respond, not just complete.

**On "hallucinations":**
Karpathy distinguishes two types: not knowing something (knowledge cutoff, rare information) vs. confabulation (fabricating false details confidently). Both happen because the model is pattern-matching on form, not grounded in facts.

**Quote worth remembering:**
"LLMs don't know what they don't know. They don't have a reliable signal of their own uncertainty."`,
  },
  {
    title: 'Fireship: 7 Database Paradigms',
    category: 'technology',
    tags: ['databases', 'nosql', 'sql', 'comparison'],
    gist: 'Quick comparison of key-value, document, relational, graph, column, time-series, and search databases with real use cases',
    sourceUrl: 'https://www.youtube.com/watch?v=W2Z7fbCLSTw',
    content: `Dense 10-minute overview. Good for building vocabulary and knowing where to look for specifics.

**The seven paradigms:**
1. **Key-value** (Redis, DynamoDB): fastest for simple lookups, no structure
2. **Document** (MongoDB, Firestore): flexible schema, good for hierarchical data
3. **Relational** (PostgreSQL, MySQL): ACID, structured, relationships via foreign keys
4. **Graph** (Neo4j): nodes + edges, ideal for relationship-heavy queries
5. **Column-family** (Cassandra): optimized for writing and reading by column, not row
6. **Time-series** (InfluxDB, TimescaleDB): specialized for timestamped data, optimized aggregations
7. **Search** (Elasticsearch, Typesense): inverted indexes for full-text search

**My takeaway:**
The database you choose should match your query patterns, not your data shape. Start with Postgres — it can do most of these things adequately. Migrate to a specialist when you hit the limits.

**Where I use each currently:**
- SQLite: structured note metadata + FTS5 for full-text
- LanceDB: vector similarity search
- Redis: job queues (BullMQ)`,
  },
  {
    title: 'What I Learned Rebuilding My Productivity System',
    category: 'productivity',
    tags: ['productivity', 'pkm', 'systems', 'review'],
    gist: 'A year after switching to a simpler system, the author found that reducing tool friction mattered more than optimizing any individual tool',
    sourceUrl: 'https://www.youtube.com/watch?v=K-ssUVyfn5g',
    content: `The speaker spent a year iterating on their productivity system. The conclusion is more interesting than I expected.

**The main insight:**
Every additional tool added friction in two ways: the learning curve to use it, and the maintenance to keep it synchronized with reality. The systems that survived were the ones that required least maintenance to keep accurate.

**What they abandoned:**
- Complex tag taxonomies (too much time categorizing)
- Separate tool per use case (too much switching)
- Detailed task tracking (reviewing the review system cost as much as the tasks)

**What they kept:**
- One capture inbox (any format, clear weekly)
- Date-stamped daily notes
- A simple project list (not tool — just a list)
- Monthly calendar for commitments

**The uncomfortable truth about PKM:**
Most complexity in personal knowledge systems serves the builder's desire to feel organized, not the user's actual retrieval needs. If you can't find the note you're looking for, more structure doesn't help — better search does.

This is directly relevant to EchOS. The agent interface + vector search might be more valuable than any elaborate categorization.`,
  },
  {
    title: 'Running Economy: What It Is and How to Improve It',
    category: 'health',
    tags: ['running', 'health', 'training', 'biomechanics'],
    gist: 'Running economy — oxygen cost per unit distance — is highly trainable and matters as much as VO2max for performance',
    sourceUrl: 'https://www.youtube.com/watch?v=SvOz1TnPj7k',
    content: `A physiology breakdown by a running science channel. Practical without being oversimplified.

**Running economy defined:**
How much oxygen you consume to run a given pace. Lower oxygen consumption = better economy = faster at same effort.

**Why it matters:**
Two runners with the same VO2max can have very different performance if one has better economy. Better economy effectively raises the functional ceiling.

**What improves it:**
1. **Volume**: more mileage over time improves neuromuscular efficiency
2. **Strength training**: particularly single-leg stability work and plyometrics
3. **Strides**: short (20-30s) accelerations at fast pace, not sprint, 2x/week
4. **Running form cues that work**: slight forward lean from ankles, land under hips (not out front), relax shoulders and hands
5. **Shoe technology**: carbon plates + thick foam meaningfully improve economy (~4%)

**What doesn't matter much:**
Heel striking vs forefoot striking — the evidence is mixed and individual variation dominates.

**My application:**
Adding 2 sets of 6 strides after easy runs twice a week. 6 weeks in, no injury, noticeably better leg turnover at easy paces.`,
  },
  {
    title: 'How Git Actually Works Internally',
    category: 'programming',
    tags: ['git', 'internals', 'version-control', 'programming'],
    gist: 'Git is a content-addressable key-value store — commits, trees, and blobs are just SHA-1-addressed objects',
    sourceUrl: 'https://www.youtube.com/watch?v=lG90LZotrpo',
    content: `The "aha" video for understanding git without memorizing magic commands.

**The core data model:**
Git stores four object types, each addressed by SHA-1 hash of content:
- **blob**: file contents
- **tree**: directory (list of blobs and subtrees with names)
- **commit**: pointer to tree + parent commit(s) + author + message
- **tag**: pointer to a commit with a name

That's it. Branches, HEAD, staging — all just files pointing to commit hashes.

**Why this matters:**
When you understand that branches are just files containing a commit SHA, it demystifies:
- Branch creation: just write a new file with the current commit SHA
- Merging: find the common ancestor, apply both sets of changes
- Rebasing: replay commits on top of a different base commit
- Detached HEAD: HEAD points directly to a commit instead of a branch

**The reflog:**
Everything git does is recoverable from the reflog. Even "deleted" commits are there until garbage collection (90 days by default). The scary commands are less scary when you know this.

**Practical takeaway:**
When a git command does something unexpected, look at the underlying objects with \`git cat-file\` and \`git log --graph --all\`. The state of the repo becomes visible.`,
  },
  {
    title: 'Paul Graham: How to Do Great Work',
    category: 'productivity',
    tags: ['creativity', 'work', 'greatness', 'paul-graham'],
    gist: 'Great work requires finding your genuine curiosity, developing taste through extensive output, and accepting the risk of looking foolish',
    sourceUrl: 'https://www.youtube.com/watch?v=3MsG7eqE4K4',
    content: `A reading of the essay "How to Do Great Work" with discussion. The essay is worth reading; the video adds context.

**The key claim:**
Great work requires finding work you're genuinely curious about — not impressive, not prestigious, but actually interesting to you. Without genuine curiosity, you won't sustain the energy to do hard work over time.

**On developing taste:**
You develop taste by doing a lot of work and being willing to be critical of your own output. "Good taste" is not innate — it's accumulated judgment from repeated production and evaluation.

The uncomfortable implication: you have to go through a period where your taste exceeds your ability. You can tell that your work isn't as good as you want it to be. This period is discouraging but necessary.

**On looking foolish:**
"The prestige of a question is inversely correlated with its importance." The most important problems look obvious in retrospect but eccentric at the time they're being worked on.

Great work requires being willing to look foolish in pursuit of something others haven't recognized as important yet.

**What I took from it:**
The question "is this interesting to me?" is a reliable signal worth taking seriously, not overriding.`,
  },
];

// ─── CONVERSATION TEMPLATES ───────────────────────────────────────────────────

const CONVERSATION_TEMPLATES: Template[] = [
  {
    title: 'Deciding on the plugin architecture for EchOS',
    category: 'decision',
    tags: ['architecture', 'decision', 'plugins', 'design'],
    content: `**Context:** Conversation about whether content processors (YouTube, article scraping) should be plugins or core modules.

**The question:** If YouTube extraction is a plugin, it can be independently versioned and replaced. But it also means every plugin has to re-implement common patterns (storage, logging, config access).

**Key insight from discussion:** The distinction isn't "plugin vs core" — it's "does this share infrastructure?" The plugin receives a PluginContext with access to storage, logger, config. It doesn't re-implement those. It just implements the \`setup(context)\` method.

**Decision:** Plugin system with PluginContext injection. Core functionality (search, storage, agent) stays in \`@echos/core\`. Content-type-specific extraction is a plugin. Categorization stays in core because it's used by both.

**Follow-up to address:** Define the plugin contract (EchosPlugin interface) clearly enough that third-party plugins could implement it. Document the PluginContext shape.`,
  },
  {
    title: 'Planning the search improvement',
    category: 'planning',
    tags: ['search', 'planning', 'vector-search', 'fts5'],
    content: `**Context:** Discussion about why current search isn't finding what I expect it to find.

**Problem statement:** When I ask "what do I know about distributed systems?", the FTS5 keyword search returns notes that contain the exact phrase but misses notes that discuss related concepts (consensus, replication, CAP theorem) without using the term.

**Root cause:** FTS5 is lexical, not semantic. It matches terms, not meaning.

**Options discussed:**
1. Vector search only → fast for semantic but misses exact term matches
2. FTS5 only → current state, misses semantic
3. Hybrid: run both, merge and re-rank → best results, more complex

**Decision:** Hybrid search. FTS5 for keyword hits (especially code, names, exact terms), vector for semantic. RRF (Reciprocal Rank Fusion) for merging results.

**Implementation notes:**
- Run queries in parallel (sqlite + lancedb async)
- Combine scores: \`1/(rank_fts + 60) + 1/(rank_vector + 60)\`
- Re-rank combined list by fused score
- Return top-k

This is already in the search code but not exposed well in the agent tool. Need to surface it clearly.`,
  },
  {
    title: 'Debugging the vitest stale file issue',
    category: 'debugging',
    tags: ['vitest', 'debugging', 'typescript', 'tooling'],
    content: `**Context:** Tests were passing in isolation but failing on the imports I expected to work.

**Symptom:** \`updateNoteStatus\` method not found on the sqlite storage object, despite being in \`sqlite.ts\`. TypeScript showed it fine; vitest said it didn't exist.

**Investigation path:**
1. Checked the import in the test — correct
2. Checked the function definition — definitely there
3. Added a console.log to the module — it wasn't printing, suggesting the module wasn't loading from source
4. Checked what vitest was actually loading with \`require.resolve\` — found it was loading \`sqlite.js\`, not \`sqlite.ts\`

**Root cause:** Old compiled \`.js\` files in \`packages/core/src/\` from a previous build. Vitest resolves \`import './sqlite.js'\` literally, finding the compiled artifact before it can fall back to TypeScript.

**Fix:** Delete all compiled files from src: \`find packages/core/src -name "*.js" -delete\`

**Lesson:** When vitest behaves unexpectedly (methods missing, changes not reflected), check for stale compiled artifacts in the source directory. This is specific to packages that were once built into src/ instead of dist/.`,
  },
  {
    title: 'Thinking through content status semantics',
    category: 'planning',
    tags: ['content-status', 'product', 'design', 'planning'],
    content: `**Context:** Designing the saved/read/archived status system for EchOS notes.

**The problem we were solving:** A user's knowledge base was mixing things they actually know with things they've bookmarked to read. Search results were returning articles they'd never consumed.

**Key distinction established:** "Saved to read" ≠ "knowledge I have." Articles and YouTube videos default to \`saved\`. Notes and journals default to \`read\` because you wrote them.

**States we considered:**
- saved/unread/read/processed/archived → too many, "processed" undefined
- to-read/read → binary, doesn't handle "keep but not active"
- saved/read/archived → clean, covers all use cases

**On auto-marking read:**
When a user starts discussing a saved article with the agent, the agent should proactively mark it \`read\`. This requires the agent to recognize that it's discussing article content and make the mark_content call.

**On conversations:**
"Saving a conversation" means the agent summarizes its visible context on request. No session tracking. The conversation summary is a \`conversation\`-type note with status \`read\`.

**What we decided not to do:**
- Auto-save all conversations (too noisy)
- Separate "bookmark" database (unnecessary complexity)
- \`processed\` status (undefined, varies by person)`,
  },
  {
    title: 'Reviewing the reconciler design',
    category: 'technical-review',
    tags: ['reconciler', 'storage', 'design', 'review'],
    content: `**Context:** Design review of the reconciler that syncs markdown files to SQLite + LanceDB.

**What the reconciler does:**
Scans all \`.md\` files in the knowledge directory. For each file with a valid \`id\` frontmatter field, checks if SQLite has a matching row with the same content hash. If the hash matches, skips. If the hash differs (or row doesn't exist), upserts the note and updates the vector.

**Design question raised:** What happens to SQLite rows for files that have been deleted?

**Discussion:** The reconciler has a cleanup pass: after syncing all found files, it queries SQLite for IDs not in the current scan. Those are deleted. This handles manual file deletion and moves.

**Edge case discussed:** What if a file's \`id\` frontmatter changes? The old ID row becomes orphaned. The new ID gets a fresh row.

**Decision:** Don't try to detect ID changes. It's a degenerate case (normally IDs don't change). Document that changing a note's \`id\` frontmatter creates a duplicate — users should not do this.

**Content hash behavior:**
Hash computed on body text only, not frontmatter. This means metadata-only changes (tag updates, status changes) don't trigger re-embedding. This is the correct behavior — the semantic content didn't change.`,
  },
  {
    title: 'Brainstorm: future features worth building',
    category: 'brainstorm',
    tags: ['brainstorm', 'roadmap', 'ideas', 'features'],
    content: `**Context:** Open brainstorm on what would make EchOS more useful over the next 6 months.

**Ideas that came up:**

**High value:**
- Weekly digest: agent synthesizes what you captured and did this week, surfaces patterns, suggests connections. Auto-scheduled Sunday evening.
- Smart reading list: not just list what's saved, but surface saved articles relevant to what you're currently working on. "You're thinking about distributed systems — you have 3 saved articles on this topic."
- Graph view: show how notes link to each other. Which concepts appear across many notes? Which are isolated?

**Medium value:**
- Bulk categorization: run categorization on all uncategorized notes
- Related notes sidebar: when viewing a note, suggest 3-5 related ones based on vector similarity
- Export: structured export of knowledge base (JSON, Obsidian-compatible, Roam-compatible)

**Risky / unclear value:**
- Automatic linking: agent suggests note connections and adds links. Risk of noise.
- Memory layer: persistent facts about the user across sessions. Privacy concerns, unclear benefit.
- Multi-user: not in scope but worth thinking about the data model implications.

**Priority call:**
Weekly digest first. Highest payoff for effort, and builds the synthesis capability that everything else benefits from.`,
  },
  {
    title: 'Working through the Telegram voice message flow',
    category: 'technical-review',
    tags: ['telegram', 'voice', 'whisper', 'flow'],
    content: `**Context:** Designed and reviewed the voice message handling for the Telegram bot.

**The flow we designed:**
1. User sends voice message in Telegram
2. grammY handler receives the message as audio file
3. Bot downloads the file using Telegram file API
4. Sends audio to OpenAI Whisper for transcription
5. Passes transcribed text to the agent as a regular message (with voice context hint)
6. Agent processes it and responds

**Decision points:**
- Where to transcribe: server-side (our server calls Whisper) vs. client-side (user device). Server-side: simpler, better quality, costs money. Client-side: would require the mobile app to implement. Server-side chosen.
- Privacy: voice files are downloaded to our server temporarily, transcribed, deleted. We do not store raw audio. Added to privacy notes.
- Context hint: we pass a note to the agent that this came from voice transcription so it can set \`inputSource: 'voice'\` when creating notes.

**Edge cases handled:**
- Transcription failure: return error message to user, don't silently swallow
- Long audio (>60s): Whisper API limit. Reject with clear error message.
- Non-speech audio: Whisper returns empty or garbled string. Agent handles it gracefully.

**What we tested:**
Transcription accuracy on voice memos with technical content (code terms, proper nouns). Acceptable. Not perfect on command-line flags and variable names, but readable.`,
  },
  {
    title: 'Should EchOS be open sourced?',
    category: 'decision',
    tags: ['open-source', 'strategy', 'decision', 'community'],
    content: `**Context:** Discussion about whether to open source EchOS and when.

**Arguments for open-sourcing now:**
- Forces better API and architecture design (public code gets scrutinized more)
- Community might solve problems I haven't thought of
- Demonstrates capability to potential employers/collaborators
- Aligns with the spirit of the project (personal tool, not a business)

**Arguments for waiting:**
- Plugin API will break multiple times before stabilizing — breakage is more costly with external consumers
- Maintenance burden of responding to issues/PRs is real
- The system depends on Anthropic and OpenAI APIs — third-party keys required
- Self-hosting is nontrivial — more documentation needed before external users could succeed

**What I actually care about:**
Making this useful for myself first. If it becomes useful to others, that's a bonus. Premature publicness could shift priorities toward community management vs. product improvement.

**Decision:** Open source when:
1. The plugin API has been stable for 3+ months with no breaking changes needed
2. Setup documentation is complete enough for a technical user to self-host without help
3. I've been using it daily for 6+ months (dogfooding)

Estimated timeline: 4-6 months from today.`,
  },
];

// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────

function generateDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  // Add random time within the day to avoid all files having same time
  date.setHours(
    Math.floor(Math.random() * 14) + 7, // 7am–9pm
    Math.floor(Math.random() * 60),
    Math.floor(Math.random() * 60),
  );
  return date;
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function createMarkdownFile(
  type: ContentType,
  template: Template,
  date: Date,
  status: ContentStatus,
  inputSource: InputSource,
): string {
  const id = randomUUID();
  const dateStr = date.toISOString();
  const slug = generateSlug(template.title);
  const datePrefix = date.toISOString().slice(0, 10);
  // Always append short UUID segment to avoid filename collisions across many notes
  const uniqueSuffix = randomUUID().slice(0, 6);
  const fileName = `${datePrefix}-${slug}-${uniqueSuffix}.md`;

  const dir = join(KNOWLEDGE_DIR, type, template.category);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, fileName);

  // Build frontmatter lines
  const lines: string[] = [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    `title: '${template.title.replace(/'/g, "''")}'`,
    `created: '${dateStr}'`,
    `updated: '${dateStr}'`,
    `tags:`,
    ...template.tags.map((t) => `  - ${t}`),
    `links: []`,
    `category: ${template.category}`,
    `status: ${status}`,
    `inputSource: ${inputSource}`,
  ];

  if (template.sourceUrl) {
    lines.push(`source_url: '${template.sourceUrl}'`);
  }
  if (template.gist) {
    lines.push(`gist: '${template.gist.replace(/'/g, "''")}'`);
  }

  lines.push('---', `# ${template.title}`, '', template.content, '');

  writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Generating test notes...\n');

  const counts = { note: 0, journal: 0, article: 0, youtube: 0, conversation: 0 };

  // Generate content spread over the past ~12 months
  // Simulate realistic activity: some busy periods, some quiet, weekends lighter
  for (let daysAgo = 0; daysAgo < 365; daysAgo++) {
    const dayOfWeek = new Date(Date.now() - daysAgo * 86400000).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Active day probability: weekdays ~75%, weekends ~40%
    const activeProbability = isWeekend ? 0.4 : 0.75;
    if (Math.random() > activeProbability) continue;

    // ── Notes (1–3 on active weekdays, 0–1 on weekends) ──
    const noteCount = isWeekend
      ? Math.random() > 0.5 ? 1 : 0
      : Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < noteCount; i++) {
      const template = pick(NOTE_TEMPLATES);
      const date = generateDate(daysAgo);
      // ~15% voice input (realistic for mobile Telegram users)
      const inputSource: InputSource = Math.random() < 0.15 ? 'voice' : 'text';
      createMarkdownFile('note', template, date, 'read', inputSource);
      counts.note++;
    }

    // ── Journal entries (0–1 per day; more common on weekdays and Sundays) ──
    const journalChance = isWeekend && dayOfWeek === 0 ? 0.7 : isWeekend ? 0.3 : 0.4;
    if (Math.random() < journalChance) {
      const template = pick(JOURNAL_TEMPLATES);
      const date = generateDate(daysAgo);
      createMarkdownFile('journal', template, date, 'read', 'text');
      counts.journal++;
    }

    // ── Articles (0–2 per active day; people save more than they read) ──
    const articleCount = Math.random() < 0.6 ? Math.floor(Math.random() * 2) + 1 : 0;
    for (let i = 0; i < articleCount; i++) {
      const template = pick(ARTICLE_TEMPLATES);
      const date = generateDate(daysAgo);
      // Older articles are more likely to have been read
      const readProbability = daysAgo > 60 ? 0.65 : daysAgo > 14 ? 0.35 : 0.1;
      const archiveProbability = daysAgo > 120 ? 0.15 : 0.03;
      const status: ContentStatus =
        Math.random() < archiveProbability
          ? 'archived'
          : Math.random() < readProbability
            ? 'read'
            : 'saved';
      createMarkdownFile('article', template, date, status, 'url');
      counts.article++;
    }

    // ── YouTube (0–1 per day) ──
    if (Math.random() < 0.35) {
      const template = pick(YOUTUBE_TEMPLATES);
      const date = generateDate(daysAgo);
      const readProbability = daysAgo > 30 ? 0.55 : daysAgo > 7 ? 0.25 : 0.05;
      const status: ContentStatus = Math.random() < readProbability ? 'read' : 'saved';
      createMarkdownFile('youtube', template, date, status, 'url');
      counts.youtube++;
    }

    // ── Conversation summaries (rare — ~8% of active days) ──
    if (Math.random() < 0.08) {
      const template = pick(CONVERSATION_TEMPLATES);
      const date = generateDate(daysAgo);
      createMarkdownFile('conversation', template, date, 'read', 'text');
      counts.conversation++;
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  console.log(`Generated ${total} markdown files in ${KNOWLEDGE_DIR}:`);
  console.log('');
  console.log('  Type           Count   Status');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  note           ${String(counts.note).padStart(5)}   status: read  | inputSource: text or voice`);
  console.log(`  journal        ${String(counts.journal).padStart(5)}   status: read  | inputSource: text`);
  console.log(`  article        ${String(counts.article).padStart(5)}   status: saved/read/archived | inputSource: url`);
  console.log(`  youtube        ${String(counts.youtube).padStart(5)}   status: saved/read | inputSource: url`);
  console.log(`  conversation   ${String(counts.conversation).padStart(5)}   status: read  | inputSource: text`);
  console.log('');
  console.log('Next step: index into SQLite + LanceDB:');
  console.log('  pnpm reconcile');
}

main().catch(console.error);
