
import { defineConfig } from "prisma/config";
import { getDatabaseUrl } from "./src/lib/database-url.js";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  // The CLI (migrations, introspection) must use the session-mode pooler;
  // the app's runtime client uses DATABASE_URL from schema.prisma.
  datasource: {
    url: getDatabaseUrl("DIRECT_URL"),
  },
});
