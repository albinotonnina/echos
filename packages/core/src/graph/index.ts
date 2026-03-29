import type { SqliteStorage, NoteRow } from '../storage/sqlite.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  tags: string[];
  category: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TopologyStats {
  totalNodes: number;
  totalEdges: number;
  orphanNodes: GraphNode[];
  hubNodes: Array<{ node: GraphNode; degree: number }>;
  clusterCount: number;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildGraph(sqlite: SqliteStorage): KnowledgeGraph {
  const rows = sqlite.listNotes({ limit: 100_000 });

  const nodeMap = new Map<string, GraphNode>();
  for (const row of rows) {
    nodeMap.set(row.id, {
      id: row.id,
      title: row.title,
      type: row.type,
      tags: parseTags(row.tags),
      category: row.category,
    });
  }

  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const row of rows) {
    const links = parseLinks(row.links);
    for (const targetId of links) {
      if (!nodeMap.has(targetId)) continue;
      // Deduplicate: store both directions as a canonical sorted key
      const key = [row.id, targetId].sort().join('→');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: row.id, target: targetId });
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

// ── Subgraph ──────────────────────────────────────────────────────────────────

export function getSubgraph(
  graph: KnowledgeGraph,
  centerNodeId: string,
  depth: number,
): KnowledgeGraph {
  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, new Set());
    if (!adj.has(edge.target)) adj.set(edge.target, new Set());
    adj.get(edge.source)!.add(edge.target);
    adj.get(edge.target)!.add(edge.source);
  }

  // BFS from center
  const visited = new Set<string>([centerNodeId]);
  let frontier = [centerNodeId];
  for (let i = 0; i < depth; i++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = Array.from(visited)
    .map((id) => nodeIndex.get(id))
    .filter((n): n is GraphNode => n !== undefined);

  const edges = graph.edges.filter(
    (e) => visited.has(e.source) && visited.has(e.target),
  );

  return { nodes, edges };
}

// ── Exporters ─────────────────────────────────────────────────────────────────

export function exportMermaid(graph: KnowledgeGraph): string {
  const lines: string[] = ['graph TD'];

  for (const node of graph.nodes) {
    const label = escapeMermaidLabel(node.title);
    lines.push(`  ${sanitizeMermaidId(node.id)}["${label}"]`);
  }

  for (const edge of graph.edges) {
    lines.push(`  ${sanitizeMermaidId(edge.source)} --> ${sanitizeMermaidId(edge.target)}`);
  }

  return lines.join('\n');
}

export function exportDot(graph: KnowledgeGraph): string {
  const lines: string[] = ['digraph knowledge {', '  rankdir=LR;'];

  for (const node of graph.nodes) {
    const label = escapeDotLabel(node.title);
    lines.push(`  "${node.id}" [label="${label}"];`);
  }

  for (const edge of graph.edges) {
    lines.push(`  "${edge.source}" -> "${edge.target}";`);
  }

  lines.push('}');
  return lines.join('\n');
}

export function exportJson(graph: KnowledgeGraph): string {
  // node-link format compatible with D3 and vis.js
  return JSON.stringify(
    {
      nodes: graph.nodes.map((n) => ({ id: n.id, label: n.title, type: n.type, tags: n.tags, category: n.category })),
      edges: graph.edges.map((e) => ({ source: e.source, target: e.target, ...(e.label ? { label: e.label } : {}) })),
    },
    null,
    2,
  );
}

// ── Topology ──────────────────────────────────────────────────────────────────

export function getTopology(graph: KnowledgeGraph): TopologyStats {
  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));

  const orphanNodes = graph.nodes.filter((n) => (degree.get(n.id) ?? 0) === 0);

  const hubNodes = graph.nodes
    .map((n) => ({ node: n, degree: degree.get(n.id) ?? 0 }))
    .filter((x) => x.degree > 1)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  const clusterCount = countClusters(graph.nodes, graph.edges);

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    orphanNodes,
    hubNodes,
    clusterCount,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
}

function parseLinks(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
}

function sanitizeMermaidId(id: string): string {
  // Mermaid node IDs must start with a letter and contain only alphanumeric + underscore
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/[<>]/g, '');
}

function escapeDotLabel(label: string): string {
  return label.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function countClusters(nodes: GraphNode[], edges: GraphEdge[]): number {
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);

  function find(x: string): string {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }

  function union(a: string, b: string): void {
    parent.set(find(a), find(b));
  }

  for (const e of edges) {
    union(e.source, e.target);
  }

  const roots = new Set<string>();
  for (const n of nodes) roots.add(find(n.id));
  return roots.size;
}
