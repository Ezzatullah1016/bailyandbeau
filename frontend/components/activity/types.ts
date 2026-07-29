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

// ─── Schema v1.1 payload shapes (additive; 1.0 shapes still valid) ────────────

export interface QuizQuestionV11 {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  image_url?: string;
  feedback_correct?: string;
  feedback_wrong?: string;
}

export interface QuizPayloadV11 {
  questions: QuizQuestionV11[];
  reveal_mode: 'host_controlled' | 'instant';
}

export interface DragDropLabelV11 {
  id: string;
  text: string;
}

export interface DragDropZoneV11 {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  accepts?: string;
}

export interface DragDropPayloadV11 {
  image_url: string;
  labels: DragDropLabelV11[];
  drop_zones: DragDropZoneV11[];
}

export interface DrawingPayloadV11 {
  palette: string[];
  brush_sizes: number[];
  allow_eraser: boolean;
  background_url?: string;
  allow_fill?: boolean;
  allow_shapes?: boolean;
  allow_submit?: boolean;
}

export interface HotspotItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
}

export interface HotspotPayload {
  image_url: string;
  display?: 'popup' | 'panel';
  hotspots: HotspotItem[];
}
