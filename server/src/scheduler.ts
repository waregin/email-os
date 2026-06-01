import { runTriagePass } from './engine';

const INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes

let started = false;

export function startScheduler(userId: string): void {
  if (started) return;
  started = true;

  console.log(`Scheduler started for user ${userId}`);

  const run = () =>
    runTriagePass(userId)
      .then(r => console.log('Triage pass complete:', r))
      .catch(e => console.error('Triage pass failed:', e));

  run();
  setInterval(run, INTERVAL_MS);
}
