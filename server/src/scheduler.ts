import { runTriagePass } from './engine';

const INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes

const activeSchedulers = new Map<string, ReturnType<typeof setInterval>>();

export function startScheduler(userId: string): void {
  if (activeSchedulers.has(userId)) return;

  console.log(`Scheduler started for user ${userId}`);

  const run = () =>
    runTriagePass(userId)
      .then(r => console.log('Triage pass complete:', r))
      .catch(e => console.error('Triage pass failed:', e));

  run();
  activeSchedulers.set(userId, setInterval(run, INTERVAL_MS));
}
