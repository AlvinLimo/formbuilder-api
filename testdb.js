import "dotenv/config";
import { prisma } from "./src/lib/prisma.js";

try {
  await prisma.$connect();
  console.log("PRISMA CONNECTION OK");

  const result = await prisma.$queryRaw`SELECT 1`;
  console.log("QUERY OK:", result);
} catch (error) {
  console.error("DATABASE TEST FAILED:");
  console.error(error);
} finally {
  await prisma.$disconnect();
}