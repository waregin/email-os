import { OAuth2Client } from 'google-auth-library';

export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

interface UserTokens {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
}

export function applyCredentials(auth: OAuth2Client, user: UserTokens): void {
  auth.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken ?? null,
    ...(user.tokenExpiry ? { expiry_date: user.tokenExpiry.getTime() } : {}),
  });
}
