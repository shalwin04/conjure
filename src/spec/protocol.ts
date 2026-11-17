/**
 * Wire protocol between the headset and the agent server.
 * POST /api/conjure with a ConjureRequest; the response is a stream of
 * server-sent events, each carrying one ConjureEvent as JSON.
 */
import type { CreationHeaderT, CreationT, EditT, PartT } from './schema.js';
import type { StoryT } from './story.js';

/** Researched description of the real object (see server/research/reference.ts). */
export interface ReferenceView {
  subject: string;
  summary: string;
  parts: { name: string; shape?: string; count?: string; size?: string; color?: string }[];
  proportions: string[];
  colors?: string;
  materials?: string;
  motion?: string;
  sound?: string;
  sources: { title?: string; url: string }[];
}

export interface ConjureRequest {
  /** What the user said or typed. */
  text: string;
  /** The creation currently on the table (the headset owns state). */
  spec?: CreationT | null;
  /** The part the user last touched, for "make that one red". */
  focusPartId?: string | null;
}

/** POST /api/critique: a snapshot of the built creation for the Critic agent. */
export interface CritiqueRequest {
  text: string;
  spec: CreationT;
  /** JPEG data URL rendered by the headset. */
  image: string;
  reference?: ReferenceView | null;
}

/**
 * POST /api/area: design one new area of an endless world the user is
 * walking through (or the thing they just asked for, where they are looking).
 */
export interface AreaRequest {
  world: Pick<CreationT, 'title' | 'palette' | 'style' | 'terrain' | 'ambient'>;
  /** What the world is already made of (prop names). */
  kit: string[];
  /** Chunk coordinates; -z is north (away from where the user started). */
  chunk: { x: number; z: number };
  /** Titles of areas nearby, so the new one is different. */
  neighbors: string[];
  /** Set when the user asked for something here ("a lighthouse"). */
  wish?: string | null;
  /** Story worlds: this area is a chapter's place, and must contain the thing to touch (id "goal"). */
  story?: { chapter: string; place: string; target: string } | null;
}

export type Stage = 'routing' | 'researching' | 'designing' | 'editing' | 'testing' | 'fixing' | 'critiquing' | 'ready' | 'error';
export type Source = 'live' | 'fixture';

export interface PlaytestResult {
  partId: string;
  ok: boolean;
  issues: string[];
}

/** A planned group of parts and the box it will occupy (for placeholder ghosts). */
export interface PlanGroupView {
  id: string;
  label: string;
  count: number;
  min: [number, number, number];
  max: [number, number, number];
}

export type ConjureEvent =
  | { type: 'stage'; stage: Stage; message?: string }
  | { type: 'plan'; header: CreationHeaderT; source: Source; groups?: PlanGroupView[] }
  | { type: 'part'; part: PartT; index: number }
  | { type: 'edit'; ops: EditT[] }
  | { type: 'playtest'; results: PlaytestResult[]; round: number }
  | { type: 'say'; text: string }
  | { type: 'reference'; reference: ReferenceView | null; origin: 'library' | 'cache' | 'web' | 'model' | 'none'; verified: boolean; note: string }
  | { type: 'critique'; score: number; verdict: string; changes: number }
  | { type: 'commit'; spec: CreationT; source: Source; ms: number; repairs: number; reference?: ReferenceView | null }
  | { type: 'area'; title: string; narration: string[] }
  | { type: 'story'; story: StoryT }
  | { type: 'error'; message: string };

export function encodeEvent(e: ConjureEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
