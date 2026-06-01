import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { prisma } from './db';
import { startScheduler } from './scheduler';

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`Email OS server running on http://localhost:${PORT}`);

  prisma.user.findUnique({ where: { email: 'waregin88@gmail.com' } })
    .then(user => {
      if (user?.accessToken) startScheduler(user.id);
    })
    .catch(e => console.error('Failed to start scheduler:', e));
});
