import { handleArea } from '../server/http.js';

export const maxDuration = 45;

export function POST(request: Request) {
  return handleArea(request);
}
