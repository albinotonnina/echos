import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { SearchService } from '../../storage/search.js';
import {
  buildGraph,
  getSubgraph,
  getTopology,
  exportMermaid,
  exportDot,
  exportJson,
  type KnowledgeGraph,
} from '../../graph/index.js';

export interface ExploreGraphToolDeps {
  sqlite: SqliteStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  action: StringEnum(['around', 'export', 'stats'], {
    description:
      "'around' — describe connections around a note or topic. 'export' — export full graph in a given format. 'stats' — topology overview (clusters, hubs, orphans).",
  }),
  note_id: Type.Optional(
    Type.String({ description: "For 'around': ID of the center note." }),
  ),
  topic: Type.Optional(
    Type.String({
      description: "For 'around': search query to find the center note when note_id is unknown.",
    }),
  ),
  depth: Type.Optional(
    Type.Number({
      description: "For 'around': number of hops from the center (default 2).",
      minimum: 1,
      maximum: 5,
      default: 2,
    }),
  ),
  format: Type.Optional(
    StringEnum(['mermaid', 'dot', 'json'], {
      description: "For 'export': output format (default 'mermaid').",
      default: 'mermaid',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createExploreGraphTool(deps: ExploreGraphToolDeps): AgentTool<typeof schema> {
  return {
    name: 'explore_graph',
    label: 'Explore Knowledge Graph',
    description:
      "Explore the knowledge graph built from note links. Use 'around' to describe what notes are connected to a given note or topic within N hops. Use 'export' to export the full graph as Mermaid, DOT (Graphviz), or JSON. Use 'stats' to see graph topology: cluster count, most-connected hubs, and orphan notes.",
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const graph = buildGraph(deps.sqlite);

      if (params.action === 'stats') {
        return handleStats(graph);
      }

      if (params.action === 'export') {
        return handleExport(graph, (params.format ?? 'mermaid') as 'mermaid' | 'dot' | 'json');
      }

      // action === 'around'
      return await handleAround(graph, params, deps);
    },
  };
}

// ── action handlers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleStats(graph: KnowledgeGraph): Promise<AgentToolResult<any>> {
  const topo = getTopology(graph);

  const lines: string[] = [
    '## Knowledge Graph Topology\n',
    `**Nodes:** ${topo.totalNodes.toLocaleString()}`,
    `**Edges:** ${topo.totalEdges.toLocaleString()}`,
    `**Connected clusters:** ${topo.clusterCount.toLocaleString()}`,
    `**Orphan notes** (no links): ${topo.orphanNodes.length.toLocaleString()}`,
    '',
  ];

  if (topo.hubNodes.length > 0) {
    lines.push('### Top Connected Hubs');
    for (const { node, degree } of topo.hubNodes) {
      lines.push(`- **${node.title}** (id: ${node.id}) — ${degree} connection${degree !== 1 ? 's' : ''}`);
    }
    lines.push('');
  }

  if (topo.orphanNodes.length > 0 && topo.orphanNodes.length <= 20) {
    lines.push('### Orphan Notes (no connections)');
    for (const n of topo.orphanNodes) {
      lines.push(`- ${n.title} (id: ${n.id})`);
    }
  } else if (topo.orphanNodes.length > 20) {
    lines.push(`### Orphan Notes\n${topo.orphanNodes.length} notes have no links. Use \`list_notes\` to find them.`);
  }

  return Promise.resolve({
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    details: {
      totalNodes: topo.totalNodes,
      totalEdges: topo.totalEdges,
      clusterCount: topo.clusterCount,
      orphanCount: topo.orphanNodes.length,
      topHubs: topo.hubNodes.map(({ node, degree }) => ({ id: node.id, title: node.title, degree })),
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleExport(
  graph: KnowledgeGraph,
  format: 'mermaid' | 'dot' | 'json',
): Promise<AgentToolResult<any>> {
  let output: string;
  let formatName: string;

  if (format === 'dot') {
    output = exportDot(graph);
    formatName = 'DOT (Graphviz)';
  } else if (format === 'json') {
    output = exportJson(graph);
    formatName = 'JSON (node-link)';
  } else {
    output = exportMermaid(graph);
    formatName = 'Mermaid';
  }

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  // For large graphs, truncate output and warn
  const MAX_CHARS = 8000;
  let truncated = false;
  if (output.length > MAX_CHARS) {
    output = output.slice(0, MAX_CHARS) + '\n... (truncated — use export_notes tool to save full graph)';
    truncated = true;
  }

  const summary = `${formatName} export: ${nodeCount} nodes, ${edgeCount} edges${truncated ? ' (truncated)' : ''}\n\n\`\`\`${format === 'mermaid' ? 'mermaid' : format === 'dot' ? 'dot' : 'json'}\n${output}\n\`\`\``;

  return Promise.resolve({
    content: [{ type: 'text' as const, text: summary }],
    details: { nodeCount, edgeCount, format, truncated },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAround(
  graph: KnowledgeGraph,
  params: Params,
  deps: ExploreGraphToolDeps,
): Promise<AgentToolResult<any>> {
  const depth = params.depth ?? 2;
  let centerId: string | undefined = params.note_id;

  // If no note_id, find the best match via search
  if (!centerId && params.topic) {
    const vector = await deps.generateEmbedding(params.topic);
    const results = await deps.search.hybrid({ query: params.topic, vector, limit: 1 });
    if (results.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `No notes found matching "${params.topic}".` }],
        details: { found: false },
      };
    }
    centerId = results[0]!.note.metadata.id;
  }

  if (!centerId) {
    return {
      content: [
        {
          type: 'text' as const,
          text: "Please provide either 'note_id' or 'topic' for the 'around' action.",
        },
      ],
      details: { found: false },
    };
  }

  const centerNode = graph.nodes.find((n) => n.id === centerId);
  if (!centerNode) {
    return {
      content: [{ type: 'text' as const, text: `Note with id "${centerId}" not found in the graph.` }],
      details: { found: false },
    };
  }

  const subgraph = getSubgraph(graph, centerId, depth);

  // Build adjacency for hop labeling
  const adj = buildAdjacency(graph);

  const lines: string[] = [
    `## Connections around "${centerNode.title}" (depth ${depth})\n`,
    `Found **${subgraph.nodes.length - 1}** connected note${subgraph.nodes.length - 1 !== 1 ? 's' : ''} within ${depth} hop${depth !== 1 ? 's' : ''}.\n`,
  ];

  // Group by hop distance
  const hops = computeHops(centerId, depth, adj);
  for (let hop = 1; hop <= depth; hop++) {
    const atHop = Array.from(hops.entries())
      .filter(([, h]) => h === hop)
      .map(([id]) => id);

    if (atHop.length === 0) continue;
    lines.push(`### Hop ${hop}`);
    for (const id of atHop) {
      const n = subgraph.nodes.find((x) => x.id === id);
      if (!n) continue;
      const tagStr = n.tags.length > 0 ? ` [${n.tags.slice(0, 3).join(', ')}]` : '';
      const catStr = n.category ? ` • ${n.category}` : '';
      lines.push(`- **${n.title}**${tagStr}${catStr} (id: ${n.id})`);
    }
    lines.push('');
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    details: {
      centerId,
      centerTitle: centerNode.title,
      depth,
      connectedCount: subgraph.nodes.length - 1,
      edgeCount: subgraph.edges.length,
    },
  };
}

// ── internal helpers ──────────────────────────────────────────────────────────

function buildAdjacency(graph: KnowledgeGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) adj.set(node.id, new Set());
  for (const edge of graph.edges) {
    adj.get(edge.source)?.add(edge.target);
    adj.get(edge.target)?.add(edge.source);
  }
  return adj;
}

function computeHops(
  startId: string,
  maxDepth: number,
  adj: Map<string, Set<string>>,
): Map<string, number> {
  const hopMap = new Map<string, number>();
  let frontier = [startId];
  for (let hop = 1; hop <= maxDepth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (!hopMap.has(neighbor) && neighbor !== startId) {
          hopMap.set(neighbor, hop);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return hopMap;
}
