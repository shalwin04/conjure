import { handleHealth } from '../server/http.js';

export function GET() {
  return handleHealth();
}
