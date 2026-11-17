import { handleCritique } from '../server/http.js';

export const maxDuration = 60;

export function POST(request: Request) {
  return handleCritique(request);
}
