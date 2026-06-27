export interface Job {
  job_id: string;
  script: string;
  query: string;
  user_id: string;
  rag_answer: string;
  created_at: Date;
}

// Survive Turbopack module isolation — pin store to globalThis so the query
// route and events route always share the same jobs Map and subscribers Set.
declare global {
  // eslint-disable-next-line no-var
  var __jobStore:
    | {
        jobs: Map<string, Job>;
        subscribers: Set<(job: Job | null, forced: boolean) => void>;
      }
    | undefined;
}

const store =
  globalThis.__jobStore ??
  (globalThis.__jobStore = {
    jobs: new Map<string, Job>(),
    subscribers: new Set<(job: Job | null, forced: boolean) => void>(),
  });

export function createJob(job: Job): void {
  store.jobs.set(job.job_id, job);
}

export function getJob(job_id: string): Job | undefined {
  return store.jobs.get(job_id);
}

export function triggerJob(job_id: string, forced = false): boolean {
  const job = store.jobs.get(job_id);
  if (!job) return false;
  store.subscribers.forEach((cb) => cb(job, forced));
  return true;
}


export function triggerIdle(): void {
  store.subscribers.forEach((cb) => cb(null, false));
}

export function subscribe(cb: (job: Job | null, forced: boolean) => void): () => void {
  store.subscribers.add(cb);
  return () => store.subscribers.delete(cb);
}
