/** Load .env.local then .env (local dev). On Vercel, env vars come from the dashboard. */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
