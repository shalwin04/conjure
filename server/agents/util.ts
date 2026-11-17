import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';

/** Text from a streamed chunk regardless of provider (string or content blocks). */
export function chunkText(chunk: AIMessageChunk | BaseMessage): string {
  const c = chunk.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((b) => (typeof b === 'string' ? b : 'text' in b && typeof b.text === 'string' ? b.text : '')).join('');
  }
  return '';
}

/**
 * Incremental NDJSON parser. Tolerates code fences, blank lines and prose
 * lines; yields every complete JSON object line as soon as its newline arrives.
 */
export class NdjsonParser {
  private buffer = '';
  private all = '';
  readonly bad: string[] = [];

  push(text: string): unknown[] {
    this.buffer += text;
    this.all += text;
    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const obj = this.parseLine(line);
      if (obj !== undefined) out.push(obj);
    }
    return out;
  }

  end(): unknown[] {
    const obj = this.parseLine(this.buffer);
    this.buffer = '';
    return obj === undefined ? [] : [obj];
  }

  /** The whole response, for a last-ditch parse when the model ignored NDJSON. */
  get text() { return this.all; }

  private parseLine(raw: string): unknown {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('{')) return undefined;
    try { return JSON.parse(line); } catch { this.bad.push(line.slice(0, 120)); return undefined; }
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
