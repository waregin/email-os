import { execSync } from 'child_process';
import { resolve } from 'path';

export default async function setup(): Promise<void> {
  const prismaBin = resolve('./node_modules/.bin/prisma');
  // Ensure node is on PATH for environments where it lives outside the default PATH
  const nodeBin = '/run/host/usr/bin';
  const env = {
    ...process.env,
    DATABASE_URL: 'file:./test.db',
    PATH: `${nodeBin}:${process.env.PATH ?? ''}`,
  };
  execSync(`"${prismaBin}" migrate deploy`, { env, stdio: 'pipe' });
}
