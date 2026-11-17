/**
 * Local API server for development. Vite proxies /api here, so the headset
 * (or emulator) talks to the same origin. Run: npm run server
 */
import { createServer, type IncomingMessage } from 'node:http';
import { handleConjure, handleCritique, handleArea, handleStory, handleListen, handleSpeak, handleHealth } from './http.js';
import { describeModels } from './llm/models.js';

const PORT = Number(process.env.API_PORT ?? 8787);

async function toRequest(req: IncomingMessage, signal: AbortSignal): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    signal,
  });
}

createServer(async (req, res) => {
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    let response: Response;
    if (req.url?.startsWith('/api/conjure') && req.method === 'POST') response = await handleConjure(await toRequest(req, abort.signal));
    else if (req.url?.startsWith('/api/story') && req.method === 'POST') response = await handleStory(await toRequest(req, abort.signal));
    else if (req.url?.startsWith('/api/speak') && req.method === 'POST') response = await handleSpeak(await toRequest(req, abort.signal));
    else if (req.url?.startsWith('/api/listen') && req.method === 'POST') response = await handleListen(await toRequest(req, abort.signal));
    else if (req.url?.startsWith('/api/area') && req.method === 'POST') response = await handleArea(await toRequest(req, abort.signal));
    else if (req.url?.startsWith('/api/critique') && req.method === 'POST') response = await handleCritique(await toRequest(req, abort.signal));
    else if (req.url?.startsWith('/api/health')) response = handleHealth();
    else response = Response.json({ error: 'Not found' }, { status: 404 });

    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, () => {
  console.log(`[conjure] API on http://localhost:${PORT}`);
  console.table(describeModels());
});
