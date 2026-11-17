/**
 * Voice commands, shared by the headset and the server.
 *
 * The headset records a push-to-talk clip; the server (Gemini) hears it and
 * returns a transcript plus one VoiceCommand. Simple movement phrases are also
 * matched locally (`parseLocal`), so "stop" or "turn around" never wait on an AI.
 */
import { z } from 'zod';

export const DIRECTIONS = ['forward', 'back', 'left', 'right', 'north', 'south', 'east', 'west'] as const;

export const VoiceCommand = z.discriminatedUnion('intent', [
  /** Make or change something: a new world, a thing ahead of you, "make it night". */
  z.object({ intent: z.literal('conjure'), text: z.string() }),
  /** Travel to a named thing or place ("take me to the fountain"). */
  z.object({ intent: z.literal('go'), target: z.string() }),
  /** Walk a little in a direction ("go north", "walk forward"). */
  z.object({ intent: z.literal('move'), direction: z.enum(DIRECTIONS) }),
  /** Keep walking until told to stop. */
  z.object({ intent: z.literal('walk') }),
  z.object({ intent: z.literal('stop') }),
  /** Turn by degrees (+ right, - left, 180 around). */
  z.object({ intent: z.literal('turn'), degrees: z.number() }),
  z.object({ intent: z.literal('speed'), faster: z.boolean() }),
  z.object({ intent: z.literal('home') }),
  /** Go to where the current chapter happens. */
  z.object({ intent: z.literal('next') }),
  z.object({ intent: z.literal('inside') }),
  z.object({ intent: z.literal('outside') }),
  z.object({ intent: z.literal('hint') }),
  z.object({ intent: z.literal('repeat') }),
  /** Pick a story choice: 0 or 1. */
  z.object({ intent: z.literal('choose'), option: z.number().int().min(0).max(1) }),
  z.object({ intent: z.literal('none') }),
]);
export type VoiceCommandT = z.infer<typeof VoiceCommand>;

/** What the headset tells the server, so it can resolve "the fountain" or "the lantern one". */
export interface ListenContext {
  hasWorld: boolean;
  inside: boolean;
  /** Names of things and places the user can travel to. */
  names: string[];
  /** The two story choices, when a choose chapter is waiting. */
  options?: string[];
}

export interface ListenResult { transcript: string; command: VoiceCommandT }

const has = (t: string, re: RegExp) => re.test(t);

/**
 * Instant, offline matching of short control phrases. Returns null for anything
 * that needs understanding (building, editing, going to a named place).
 */
export function parseLocal(raw: string, ctx?: Pick<ListenContext, 'names' | 'options'>): VoiceCommandT | null {
  const t = raw.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { intent: 'none' };
  const words = t.split(' ').length;
  if (words <= 4) {
    if (has(t, /^(stop|halt|wait|freeze|stay( here)?|stop (walking|moving|there))$/)) return { intent: 'stop' };
    if (has(t, /^(turn )?around$|^turn back$|^look behind( me)?$/)) return { intent: 'turn', degrees: 180 };
    if (has(t, /^(turn|look) (to the )?left$/)) return { intent: 'turn', degrees: -90 };
    if (has(t, /^(turn|look) (to the )?right$/)) return { intent: 'turn', degrees: 90 };
    if (has(t, /^(keep (walking|going|moving)|walk on|go on|carry on|let's go|lets go)$/)) return { intent: 'walk' };
    if (has(t, /^(go |walk |move |step )?(forward|ahead|straight( ahead)?)$/)) return { intent: 'move', direction: 'forward' };
    if (has(t, /^(go |walk |move |step )?back(ward|wards)?$/)) return { intent: 'move', direction: 'back' };
    const dir = /^(?:go|walk|head|move|travel) (?:to the )?(north|south|east|west)$/.exec(t);
    if (dir) return { intent: 'move', direction: dir[1] as 'north' };
    if (has(t, /^(faster|run|go faster|speed up)$/)) return { intent: 'speed', faster: true };
    if (has(t, /^(slower|slow down|walk|go slower)$/)) return { intent: 'speed', faster: false };
    if (has(t, /^(go |take me )?home$|^(go )?back to (the )?start$/)) return { intent: 'home' };
    if (has(t, /^(hint|help|help me|give me a hint|what (now|next)|what do i do)$/)) return { intent: 'hint' };
    if (has(t, /^(repeat( that)?|say (that|it) again|again|pardon|what)$/)) return { intent: 'repeat' };
    if (has(t, /^(step |go )?inside$|^(enter|go in|step in)$/)) return { intent: 'inside' };
    if (has(t, /^(step |go )?out(side)?$|^(exit|leave|zoom out)$/)) return { intent: 'outside' };
    if (has(t, /^(take me there|next chapter|where next|where to|show me the way|lead the way)$/)) return { intent: 'next' };
    if (ctx?.options?.length === 2) {
      if (has(t, /^(the )?(first|first one|one|left one)$/)) return { intent: 'choose', option: 0 };
      if (has(t, /^(the )?(second|second one|two|right one)$/)) return { intent: 'choose', option: 1 };
      const pick = ctx.options.findIndex((o) => o && t.includes(o.toLowerCase()));
      if (pick >= 0) return { intent: 'choose', option: pick };
    }
  }
  // "take me to the fountain" / "go to the baker": resolved against known names.
  const go = /^(?:take me to|go to|walk to|bring me to|travel to|head to|fly to|show me) (?:the |a |an )?(.+)$/.exec(t);
  if (go && ctx?.names?.length) {
    const name = matchName(go[1], ctx.names);
    if (name) return { intent: 'go', target: name };
  }
  return null;
}

/** The known name a spoken phrase refers to ("the old well" → "Oasis well"). */
export function matchName(spoken: string, names: readonly string[]): string | null {
  const s = spoken.toLowerCase().replace(/^(the|a|an) /, '').trim();
  if (!s) return null;
  let best: string | null = null, bestScore = 0;
  const sw = s.split(/\s+/).filter((w) => w.length > 2);
  for (const n of names) {
    const l = n.toLowerCase();
    let score = l === s ? 10 : l.includes(s) || s.includes(l) ? 6 : 0;
    for (const w of sw) if (l.includes(w)) score += 2;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return bestScore >= 2 ? best : null;
}
