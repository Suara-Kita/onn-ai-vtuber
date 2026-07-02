import Redis from "ioredis";

// Singleton — survives hot-reload via globalThis
declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

function createClient(): Redis {
  const url = process.env.REDIS_URL ?? "redis://default:redis@localhost:6380";
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  client.on("error", (err: Error) => {
    console.error("[redis]", err.message);
  });
  return client;
}

export const redis: Redis = globalThis.__redis ?? (globalThis.__redis = createClient());

export const QA_KEY = "vroid:qa:recent";

export const JOB_KEY = (job_id: string) => `vroid:job:${job_id}`;
