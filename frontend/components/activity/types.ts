export type ActivityType = 'drawing' | 'drag_drop' | 'quiz' | 'hotspot';

export interface ActivityEnvelope {
  schema_version: string;
  activity_type: ActivityType;
  book_id?: string;
  ui: { title: string; instructions: string; theme?: string };
  payload: Record<string, unknown>;
  validation?: Record<string, unknown>;
}

export interface ActivityConfigData {
  id: string;
  book: string;
  title: string;
  activity_type: ActivityType;
  config: ActivityEnvelope;
  sort_order: number;
  is_active: boolean;
}
