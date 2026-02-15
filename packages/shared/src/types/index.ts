export type ContentType = 'note' | 'journal' | 'article' | 'youtube' | 'reminder';

export interface NoteMetadata {
  id: string;
  type: ContentType;
  title: string;
  created: string;
  updated: string;
  tags: string[];
  links: string[];
  category: string;
  sourceUrl?: string;
  author?: string;
  gist?: string;
}

export interface Note {
  metadata: NoteMetadata;
  content: string;
  filePath: string;
}

export interface SearchResult {
  note: Note;
  score: number;
  highlights?: string[];
}

export interface SearchOptions {
  query: string;
  type?: ContentType;
  tags?: string[];
  category?: string;
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface MemoryEntry {
  id: string;
  kind: 'fact' | 'person' | 'project' | 'expertise' | 'preference';
  subject: string;
  content: string;
  confidence: number;
  source: string;
  created: string;
  updated: string;
}

export interface ReminderEntry {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  created: string;
  updated: string;
}

export interface ProcessedContent {
  title: string;
  content: string;
  metadata: Partial<NoteMetadata>;
  gist?: string;
  embedText?: string;
}

export interface InterfaceAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}
