import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { getPgConfig } from "../src/lib/database-url.js";

const migrationsDir = resolve(import.meta.dirname, "../prisma/migrations");
const { schema, ...pgConfig } = getPgConfig("DIRECT_URL");
const client = new pg.Client(pgConfig);

function statements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

await client.connect();
await client.query(`create schema if not exists "${schema}"`);
await client.query(`set search_path to "${schema}"`);
await client.query(`create table if not exists "_prisma_migrations" (
  id varchar(36) primary key,
  checksum varchar(64) not null,
  finished_at timestamptz,
  migration_name varchar(255) not null,
  logs text,
  rolled_back_at timestamptz,
  started_at timestamptz not null default now(),
  applied_steps_count integer not null default 0
)`);
console.log("schema", schema);

const existing = await client.query('select migration_name, checksum from "_prisma_migrations" order by finished_at');
const applied = new Set(existing.rows.map((row) => row.migration_name));
console.log("applied", [...applied].join(", ") || "none");

const init = existing.rows.find((row) => row.migration_name === "20261006082945_init");
if (init) {
  const initSql = readFileSync(resolve(migrationsDir, "20261006082945_init/migration.sql"));
  const checksum = createHash("sha256").update(initSql).digest("hex");
  console.log("init checksum matches", checksum === init.checksum);
}

const pending = readdirSync(migrationsDir)
  .filter((name) => name !== "migration_lock.toml" && !applied.has(name))
  .sort();

for (const name of pending) {
  const sqlPath = resolve(migrationsDir, name, "migration.sql");
  const sql = readFileSync(sqlPath);
  const checksum = createHash("sha256").update(sql).digest("hex");
  console.log("applying", name);
  await client.query("begin");
  try {
    for (const statement of statements(sql.toString("utf8"))) {
      await client.query(statement);
    }

    await client.query(
      `insert into "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       values ($1, $2, now(), $3, null, null, now(), 1)`,
      [randomUUID(), checksum, name]
    );
    await client.query("commit");
    console.log("applied", name);
  } catch (error) {
    await client.query("rollback");
    console.error("failed", name, error.message);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("done");
