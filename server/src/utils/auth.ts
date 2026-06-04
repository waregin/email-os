import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';

export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

interface UserTokens {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
}

export function buildGmailClient(user: UserTokens): OAuth2Client {
  const auth = createOAuthClient();
  applyCredentials(auth, user);
  auth.on('tokens', async (tokens) => {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expiry_date ? { tokenExpiry: new Date(tokens.expiry_date) } : {}),
      },
    });
  });
  return auth;
}

export function applyCredentials(auth: OAuth2Client, user: UserTokens): void {
  auth.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken ?? null,
    ...(user.tokenExpiry ? { expiry_date: user.tokenExpiry.getTime() } : {}),
  });
}
