import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { authRouter } from './auth';
import { gmailRouter } from './gmail';
import { agentRouter } from './agent';
import { requireAuth } from './middleware';

export const app = express();

app.use(express.json());

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET ?? 'fallback-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use('/auth', authRouter);
app.use('/api/gmail', requireAuth, gmailRouter);
app.use('/api/agent', requireAuth, agentRouter);

app.get('/api/status', (req, res) => {
  res.json({ authenticated: !!req.session.tokens });
});
