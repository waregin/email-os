import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { prisma } from './db';
import { startScheduler } from './scheduler';

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`Email OS server running on http://localhost:${PORT}`);

  // Resume background triage for every authenticated user, not just one.
  // New sign-ins start their own scheduler in the OAuth callback (auth.ts);
  // this covers users who authenticated before the most recent restart.
  prisma.user.findMany({ where: { accessToken: { not: null } } })
    .then(users => {
      for (const user of users) startScheduler(user.id);
      if (users.length > 0) console.log(`Started schedulers for ${users.length} user(s)`);
    })
    .catch(e => console.error('Failed to start schedulers:', e));
});
