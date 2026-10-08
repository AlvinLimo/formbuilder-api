import app from "./index.js";
import { prisma } from "./lib/prisma.js";
import { assertJwtSecret } from "./lib/auth.js";

const PORT = Number(process.env.PORT) || 3001;

async function start() {
  try {
    assertJwtSecret();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    await prisma.$connect();
    console.log("Connected to database");
  } catch (err) {
    console.error("Failed to connect to database:", err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

start();
