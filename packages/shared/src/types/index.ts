export type ContentType = 'note' | 'journal' | 'article' | 'youtube' | 'reminder' | 'conversation' | 'image';

export type ContentStatus = 'saved' | 'read' | 'archived';

export type InputSource = 'text' | 'voice' | 'url' | 'file' | 'image';

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
  status?: ContentStatus;
  inputSource?: InputSource;
  imagePath?: string;
  imageUrl?: string;
  imageMetadata?: string;
  ocrText?: string;
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
  status?: ContentStatus;
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

export interface ScheduleEntry {
  id: string;
  jobType: string;
  cron: string;
  enabled: boolean;
  description: string;
  config: Record<string, unknown>;
  created: string;
  updated: string;
}

/**
 * Schedule IDs reserved for internal system use.
 * User-created schedules must not use these IDs.
 */
export const RESERVED_SCHEDULE_IDS = new Set(['reminder-check']);

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

export interface NotificationService {
  sendMessage(userId: number, text: string): Promise<void>;
  broadcast(text: string): Promise<void>;
}
