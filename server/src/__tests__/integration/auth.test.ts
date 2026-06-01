import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// --- Hoisted mock refs (available before imports) ---
const {
  mockGenerateAuthUrl,
  mockGetToken,
  mockGetTokenInfo,
  mockSetCredentials,
  mockRefreshAccessToken,
} = vi.hoisted(() => ({
  mockGenerateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/oauth?test=1'),
  mockGetToken: vi.fn().mockResolvedValue({
    tokens: {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expiry_date: new Date('2099-01-01').getTime(),
    },
  }),
  mockGetTokenInfo: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
  mockSetCredentials: vi.fn(),
  mockRefreshAccessToken: vi.fn().mockResolvedValue({
    credentials: { access_token: 'refreshed', expiry_date: new Date('2099-01-01').getTime() },
  }),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: function OAuth2Client() {
    return {
      generateAuthUrl: mockGenerateAuthUrl,
      getToken: mockGetToken,
      getTokenInfo: mockGetTokenInfo,
      setCredentials: mockSetCredentials,
      refreshAccessToken: mockRefreshAccessToken,
      on: vi.fn(),
    };
  },
}));

vi.mock('../../scheduler', () => ({ startScheduler: vi.fn() }));
vi.mock('googleapis', () => ({ google: { gmail: vi.fn() } }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: function Anthropic() { return { messages: { create: vi.fn() } }; },
}));

import { app } from '../../app';
import { resetDb, prisma } from '../helpers/db';
import { startScheduler } from '../../scheduler';

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/oauth?test=1');
  mockGetToken.mockResolvedValue({
    tokens: {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expiry_date: new Date('2099-01-01').getTime(),
    },
  });
  mockGetTokenInfo.mockResolvedValue({ email: 'test@example.com' });
  mockRefreshAccessToken.mockResolvedValue({
    credentials: { access_token: 'refreshed', expiry_date: new Date('2099-01-01').getTime() },
  });
});

afterEach(async () => {
  await resetDb();
});

describe('GET /auth/google', () => {
  it('redirects to Google consent URL', async () => {
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });
});

describe('GET /auth/callback', () => {
  it('returns 400 when code is missing', async () => {
    const res = await request(app).get('/auth/callback');
    expect(res.status).toBe(400);
  });

  it('exchanges code for tokens, creates user in DB, and returns 200', async () => {
    const res = await request(app).get('/auth/callback?code=test-code');
    expect(res.status).toBe(200);
    expect(res.text).toContain('location.replace');

    const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
    expect(user).not.toBeNull();
    expect(user!.accessToken).toBe('test-access-token');
  });

  it('upserts existing user tokens on repeat login', async () => {
    await prisma.user.create({
      data: { email: 'test@example.com', name: 'Test User', accessToken: 'old-token' },
    });

    await request(app).get('/auth/callback?code=test-code');

    const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
    expect(user!.accessToken).toBe('test-access-token');
  });

  it('starts the scheduler after successful login', async () => {
    await request(app).get('/auth/callback?code=test-code');
    expect(startScheduler).toHaveBeenCalledOnce();
  });

  it('stores tokens in session so subsequent requests are authenticated', async () => {
    const agent = request.agent(app);
    await agent.get('/auth/callback?code=test-code').expect(200);

    const statusRes = await agent.get('/api/status');
    expect(statusRes.body.authenticated).toBe(true);
  });

  it('returns 500 when token exchange fails', async () => {
    mockGetToken.mockRejectedValueOnce(new Error('OAuth error'));
    const res = await request(app).get('/auth/callback?code=bad-code');
    expect(res.status).toBe(500);
  });
});

describe('POST /auth/logout', () => {
  it('destroys session and returns ok', async () => {
    const agent = request.agent(app);
    await agent.get('/auth/callback?code=test-code').expect(200);

    const logoutRes = await agent.post('/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    const statusRes = await agent.get('/api/status');
    expect(statusRes.body.authenticated).toBe(false);
  });
});

describe('GET /api/status', () => {
  it('returns authenticated: false when not logged in', async () => {
    const res = await request(app).get('/api/status');
    expect(res.body.authenticated).toBe(false);
  });

  it('returns authenticated: true when logged in', async () => {
    const agent = request.agent(app);
    await agent.get('/auth/callback?code=test-code');
    const res = await agent.get('/api/status');
    expect(res.body.authenticated).toBe(true);
  });
});

describe('requireAuth middleware', () => {
  it('returns 401 on unauthenticated request to protected route', async () => {
    const res = await request(app).get('/api/gmail/threads');
    expect(res.status).toBe(401);
  });

  it('auto-refreshes session token when it is within 5 minutes of expiry', async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: 'expiring-token',
        refresh_token: 'rtok',
        expiry_date: Date.now() + 60_000, // 1 min — inside the 5-min refresh window
      },
    });

    const agent = request.agent(app);
    await agent.get('/auth/callback?code=test-code').expect(200);

    // Hit a protected route — the Gmail layer may fail (no real mock), but requireAuth runs first
    await agent.get('/api/gmail/threads');
    expect(mockRefreshAccessToken).toHaveBeenCalledOnce();
  });

  it('returns 401 and destroys session when token refresh fails', async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: 'expiring-token',
        refresh_token: 'rtok',
        expiry_date: Date.now() + 60_000,
      },
    });
    mockRefreshAccessToken.mockRejectedValueOnce(new Error('token refresh failed'));

    const agent = request.agent(app);
    await agent.get('/auth/callback?code=test-code').expect(200);

    const res = await agent.get('/api/gmail/threads');
    expect(res.status).toBe(401);

    const statusRes = await agent.get('/api/status');
    expect(statusRes.body.authenticated).toBe(false);
  });
});
