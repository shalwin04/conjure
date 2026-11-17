import { handleStory } from '../server/http.js';

export const maxDuration = 40;

export function POST(request: Request) {
  return handleStory(request);
}
