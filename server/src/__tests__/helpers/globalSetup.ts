import { execSync } from 'child_process';
import { resolve } from 'path';
import { config } from 'dotenv';
import { Client } from 'pg';

export default async function setup(): Promise<void> {
  // Load the same env the test runtime uses so the schema is reset against the
  // test database, not whatever DATABASE_URL happens to be in the shell.
  config({ path: resolve(process.cwd(), '.env.test'), override: true });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set; expected it in server/.env.test');
  }

  // Drop and recreate the public schema so every run starts from a known-clean
  // database with no leftover rows, then reapply all migrations.
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  const prismaBin = resolve('./node_modules/.bin/prisma');
  execSync(`"${prismaBin}" migrate deploy`, { env: process.env, stdio: 'pipe' });
}
