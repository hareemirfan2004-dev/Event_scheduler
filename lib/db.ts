import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

function makeClient() {
  const adapter = url.startsWith("file:")
    ? new PrismaBetterSqlite3({ url })
    : new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

// Reuse one client across dev hot-reloads to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
