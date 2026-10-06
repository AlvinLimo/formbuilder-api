import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads so dev restarts don't exhaust connections.
const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
