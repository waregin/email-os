import { config } from 'dotenv';
import { resolve } from 'path';

// Load test env vars with override so .env.test values win over any already-set vars
config({ path: resolve(process.cwd(), '.env.test'), override: true });
