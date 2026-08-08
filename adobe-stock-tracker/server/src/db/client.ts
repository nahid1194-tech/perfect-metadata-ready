import { config } from '../config';

/**
 * Optional PostgreSQL persistence via Prisma.
 *
 * The Prisma client is only constructed when DATABASE_URL is configured, so
 * the app builds and runs without a database. Everything that needs the DB
 * reports an honest "not configured / session-only" state instead.
 *
 * `getPrisma()` returns null when the database is not configured — callers
 * must treat that as the DB-less fallback path.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
type PrismaModule = typeof import('@prisma/client');
type PrismaClientInstance = InstanceType<PrismaModule['PrismaClient']>;

let prisma: PrismaClientInstance | null = null;

export function isDatabaseConfigured(): boolean {
  return config.database.enabled;
}

export function getPrisma(): PrismaClientInstance | null {
  if (!config.database.enabled) return null;
  if (!prisma) {
    // Lazy construction: importing @prisma/client is safe without a DB; only
    // constructing the client (and issuing queries) requires the connection.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client') as PrismaModule;
    prisma = new PrismaClient({
      log: config.database.enabled ? ['warn', 'error'] : [],
    });
  }
  return prisma;
}

export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
