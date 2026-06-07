import { runTriagePass } from './engine';
import { runHealthCheck } from './health-check';

const TRIAGE_INTERVAL_MS = 3 * 60 * 1000;       // every 3 minutes
const HEALTH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours

const activeSchedulers = new Map<string, ReturnType<typeof setInterval>>();
const activeHealthCheckers = new Map<string, ReturnType<typeof setInterval>>();

export function startScheduler(userId: string): void {
  if (activeSchedulers.has(userId)) return;

  console.log(`Scheduler started for user ${userId}`);

  const runTriage = () =>
    runTriagePass(userId)
      .then((r) => console.log('Triage pass complete:', r))
      .catch((e) => console.error('Triage pass failed:', e));

  const runHealth = () =>
    runHealthCheck(userId)
      .then(() => console.log('Health check complete for user', userId))
      .catch((e) => console.error('Health check failed:', e));

  runTriage();
  activeSchedulers.set(userId, setInterval(runTriage, TRIAGE_INTERVAL_MS));

  // Run health check once immediately then on the daily interval
  runHealth();
  activeHealthCheckers.set(userId, setInterval(runHealth, HEALTH_CHECK_INTERVAL_MS));
}
