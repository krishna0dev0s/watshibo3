import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

// Reconnect configuration (tunable via env vars)
const RECONNECT_ENABLED = process.env.PRISMA_ENABLE_RECONNECTS !== 'false';
const RECONNECT_ATTEMPTS = Number(process.env.PRISMA_RECONNECT_ATTEMPTS || 6);
const RECONNECT_INITIAL_DELAY = Number(process.env.PRISMA_RECONNECT_INITIAL_DELAY_MS || 1000);
const RECONNECT_MAX_DELAY = Number(process.env.PRISMA_RECONNECT_MAX_DELAY_MS || 30000);

export const db = globalForPrisma.prisma || new PrismaClient({
  log: ['warn', 'error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Attach helpful logging and a simple reconnect retry on startup to handle transient
// server-side restarts / admin-terminated connections (E57P01). This won't fix
// server-side interruptions (you'll need to check the DB provider), but it makes
// the app more resilient and logs clearer.
async function connectWithRetry(client, retries = 5, delayMs = 2000) {
  try {
    await client.$connect();
    console.log('Prisma: connected to database');
  } catch (err) {
    console.error(`Prisma: connect failed (${retries} retries left):`, err.message || err);
    if (retries <= 0) {
      console.error('Prisma: exhausted retries, giving up for now');
      return;
    }
    await new Promise((r) => setTimeout(r, delayMs));
    return connectWithRetry(client, retries - 1, Math.round(delayMs * 1.5));
  }
}

// Start initial connect attempt in background during dev to improve error messages
// and avoid noisy stack traces when the DB provider restarts connections.
connectWithRetry(db).catch((e) => console.error('Prisma: unexpected connect error', e));

// Avoid re-registering listeners during hot-reload / module re-evaluation in dev.
// Use a global flag stored on the shared `globalForPrisma` object.
if (!globalForPrisma.__prismaEventHandlersInstalled) {
  db.$on('error', (e) => {
    console.error('Prisma client error event:', e);

    // If the server/admin forcibly terminated the connection (E57P01),
    // attempt a controlled reconnect with exponential backoff so the
    // running app can recover transparently instead of crashing.
      const msg = (e && (e.code || e.message || '')).toString();
      const isAdminTerminate = msg.includes('E57P01') || msg.includes('terminating connection due to administrator command');

      if (isAdminTerminate) {
        console.warn('Prisma: detected admin-terminated connection (E57P01).');

        if (!RECONNECT_ENABLED) {
          console.warn('Prisma: reconnects are disabled via PRISMA_ENABLE_RECONNECTS=false');
          return;
        }

        // Track repeated admin-terminations to avoid tight reconnect loops.
        if (!globalForPrisma.__prismaAdminTerminateCount) {
          globalForPrisma.__prismaAdminTerminateCount = 0;
          globalForPrisma.__prismaLastAdminTerminate = Date.now();
        }

        const now = Date.now();
        // Reset counter if last termination was long ago (>10 minutes)
        if (now - (globalForPrisma.__prismaLastAdminTerminate || 0) > 10 * 60 * 1000) {
          globalForPrisma.__prismaAdminTerminateCount = 0;
        }
        globalForPrisma.__prismaAdminTerminateCount += 1;
        globalForPrisma.__prismaLastAdminTerminate = now;

        // If we see many admin terminations in a short time, surface a louder alert
        if (globalForPrisma.__prismaAdminTerminateCount >= 5) {
          console.error('Prisma: multiple admin-terminated events detected in a short period — investigate provider-side restarts or scaling.');
        }

        // Attempt reconnects with exponential backoff
        (async function reconnectOnAdminTerminate() {
          let attempts = RECONNECT_ATTEMPTS;
          let delay = RECONNECT_INITIAL_DELAY;
          for (let i = 0; i < attempts; i++) {
            try {
              console.log(`Prisma: reconnect attempt ${i + 1}/${attempts} (delay ${delay}ms)`);
              await db.$connect();
              console.log('Prisma: reconnect successful');
              // reset counter on success
              globalForPrisma.__prismaAdminTerminateCount = 0;
              return;
            } catch (connErr) {
              console.error(`Prisma: reconnect attempt ${i + 1} failed:`, connErr && connErr.message ? connErr.message : connErr);
              await new Promise((r) => setTimeout(r, delay));
              delay = Math.min(RECONNECT_MAX_DELAY, Math.round(delay * 1.8));
            }
          }
          console.error('Prisma: all reconnect attempts failed after admin termination');
        })();
    }
  });

  // Prisma 5+ uses the library engine which doesn't support the client-level
  // 'beforeExit' event. Register a process-level handler instead so we can
  // disconnect the client cleanly when Node is exiting.
  process.on('beforeExit', async () => {
    try {
      await db.$disconnect();
      console.log('Prisma: disconnected on process beforeExit');
    } catch (e) {
      console.error('Prisma: error disconnecting on process beforeExit', e);
    }
  });

  globalForPrisma.__prismaEventHandlersInstalled = true;
}