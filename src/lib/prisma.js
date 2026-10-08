import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { getPgConfig } from "./database-url.js";

const globalForPrisma = globalThis;

function createPrisma() {
  const { schema, ...pgConfig } = getPgConfig("DIRECT_URL");
  const pool = new pg.Pool({
    ...pgConfig,
    max: 5,
  });

  return new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
