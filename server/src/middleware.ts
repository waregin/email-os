import { Request, Response, NextFunction } from 'express';
import type { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';
import { createOAuthClient } from './utils/auth';

dotenv.config();

const client = createOAuthClient();

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.tokens) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  client.setCredentials(req.session.tokens);

  // Refresh token if expired or expiring within 5 minutes
  const expiry = req.session.tokens.expiry_date ?? 0;
  const fiveMinutes = 5 * 60 * 1000;

  if (Date.now() >= expiry - fiveMinutes) {
    try {
      const { credentials } = await client.refreshAccessToken();
      req.session.tokens = credentials;
      client.setCredentials(credentials);
    } catch {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'Session expired, please re-authenticate' });
      return;
    }
  }

  next();
}

export function getAuthenticatedClient(req: Request): OAuth2Client {
  const c = createOAuthClient();
  c.setCredentials(req.session.tokens!);
  return c;
}
