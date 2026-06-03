import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn();
const mockSetCredentials = vi.fn();
let capturedTokensCallback: ((tokens: Record<string, unknown>) => Promise<void>) | null = null;

vi.mock('../../db', () => ({
  prisma: { user: { update: mockUpdate } },
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: function OAuth2Client() {
    return {
      setCredentials: mockSetCredentials,
      on: vi.fn().mockImplementation((event: string, cb: (t: Record<string, unknown>) => Promise<void>) => {
        if (event === 'tokens') capturedTokensCallback = cb;
      }),
    };
  },
}));

import { buildGmailClient, applyCredentials } from '../../utils/auth';

const baseUser = {
  id: 'user-1',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenExpiry: new Date('2099-01-01'),
};

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({});
  mockSetCredentials.mockReset();
  capturedTokensCallback = null;
});

describe('buildGmailClient — token refresh callback', () => {
  it('persists access_token when present in refresh payload', async () => {
    buildGmailClient(baseUser);
    await capturedTokensCallback!({ access_token: 'new-access' });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accessToken: 'new-access' }),
    }));
  });

  it('persists refresh_token when present in refresh payload', async () => {
    buildGmailClient(baseUser);
    await capturedTokensCallback!({ refresh_token: 'new-refresh' });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refreshToken: 'new-refresh' }),
    }));
  });

  it('persists tokenExpiry when expiry_date is present in refresh payload', async () => {
    buildGmailClient(baseUser);
    const expiry = Date.now() + 3600000;
    await capturedTokensCallback!({ expiry_date: expiry });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tokenExpiry: new Date(expiry) }),
    }));
  });

  it('omits fields absent from the refresh payload', async () => {
    buildGmailClient(baseUser);
    await capturedTokensCallback!({ access_token: 'only-access' });
    const call = mockUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.accessToken).toBe('only-access');
    expect(call.data.refreshToken).toBeUndefined();
    expect(call.data.tokenExpiry).toBeUndefined();
  });
});

describe('applyCredentials', () => {
  it('includes expiry_date when user has a tokenExpiry', () => {
    const auth = { setCredentials: mockSetCredentials } as any;
    applyCredentials(auth, baseUser);
    const call = mockSetCredentials.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.expiry_date).toBe(new Date('2099-01-01').getTime());
  });

  it('omits expiry_date when tokenExpiry is null', () => {
    const auth = { setCredentials: mockSetCredentials } as any;
    applyCredentials(auth, { ...baseUser, tokenExpiry: null });
    const call = mockSetCredentials.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.expiry_date).toBeUndefined();
  });
});
