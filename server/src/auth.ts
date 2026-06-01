import { Router } from 'express';
import dotenv from 'dotenv';
import { prisma } from './db';
import { startScheduler } from './scheduler';
import { createOAuthClient } from './utils/auth';

dotenv.config();

export const authRouter = Router();

const client = createOAuthClient();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Step 1: redirect browser to Google's consent screen
authRouter.get('/google', (_req, res) => {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force refresh token to be returned every time
  });
  res.redirect(url);
});

// Step 2: Google redirects back here with an auth code
authRouter.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    res.status(400).send('Missing auth code');
    return;
  }

  try {
    const { tokens } = await client.getToken(code);
    req.session.tokens = tokens;

    if (tokens.access_token) {
      const info = await client.getTokenInfo(tokens.access_token);
      const email = info.email;
      if (email) {
        const user = await prisma.user.upsert({
          where: { email },
          update: {
            accessToken: tokens.access_token,
            ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
            ...(tokens.expiry_date ? { tokenExpiry: new Date(tokens.expiry_date) } : {}),
          },
          create: {
            email,
            name: email,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          },
        });
        req.session.userId = user.id;
        startScheduler(user.id);
      }
    }

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    // Serve a real HTML page instead of a 302 redirect.
    // Chrome 115+ (bounce tracking protection) silently drops Set-Cookie on
    // responses that are pure redirect intermediaries (Google → :3001 → :5173).
    // A 200 with an immediate JS redirect makes :3001 a first-party page load,
    // so the browser commits the cookie before navigating away.
    const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';
    res.send(
      `<!doctype html><script>location.replace(${JSON.stringify(CLIENT_URL)})</script>`,
    );
  } catch {
    res.status(500).send('Authentication failed');
  }
});

// Sign out: clear session
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});
