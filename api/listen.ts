import { handleListen } from '../server/http.js';

export const maxDuration = 30;

export function POST(request: Request) {
  return handleListen(request);
}
