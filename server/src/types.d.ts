import { Credentials } from 'google-auth-library';

declare module 'express-session' {
  interface SessionData {
    tokens?: Credentials;
    userId?: string;
  }
}
