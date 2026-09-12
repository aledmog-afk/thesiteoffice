// Shared PostgreSQL test helper. Connects over TCP with a password so the
// exact same code works against this sandbox's local Postgres and against
// the `postgres:` service container GitHub Actions provides in CI — see
// .github/workflows/test.yml. Never touches a real Supabase project.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PG_CONFIG = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
};

const SCHEMA_PATH = path.join(__dirname, "../../sql/schema.sql");
const MOCK_SETUP_PATH = path.join(__dirname, "mock_setup.sql");

// Runs a .sql file's full text in one simple-query call — node-postgres
// only uses the extended (parameterised) protocol when you pass query
// parameters, so a plain `query(text)` call executes a whole multi
// -statement file (including DO blocks) exactly the way `psql -f` does.
export async function runSqlFile(client, filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  await client.query(sql);
}

export async function runSql(client, sql) {
  await client.query(sql);
}

// Drops (if present) and recreates a database, as the admin/superuser.
export async function createTestDatabase(name) {
  const admin = new pg.Client({ ...PG_CONFIG, database: "postgres" });
  await admin.connect();
  // Identifiers can't be parameterised; test db names are always
  // hardcoded literals in this repo's own test files, never user input.
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(async () => {
    // WITH (FORCE) needs PG 13+; fall back for older servers.
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
}

export async function dropTestDatabase(name) {
  const admin = new pg.Client({ ...PG_CONFIG, database: "postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
  await admin.end();
}

// Applies the mock auth/storage environment, then the real application
// schema, to `name` — as the superuser (RLS doesn't apply to this
// connection, which is correct: this is schema setup, not a security test).
export async function setupSchema(name) {
  const client = new pg.Client({ ...PG_CONFIG, database: name });
  await client.connect();
  await runSqlFile(client, MOCK_SETUP_PATH);
  await runSqlFile(client, SCHEMA_PATH);
  await client.end();
}

export async function applySchemaOnly(name) {
  const client = new pg.Client({ ...PG_CONFIG, database: name });
  await client.connect();
  await runSqlFile(client, SCHEMA_PATH);
  await client.end();
}

export function adminClient(name) {
  return new pg.Client({ ...PG_CONFIG, database: name });
}

// A connection acting as a specific signed-in user — real non-superuser
// `authenticated` role, real RLS enforcement, exactly as Supabase's own
// PostgREST layer would see that user. Pass null for userId to represent
// a fully unauthenticated request.
export async function userClient(dbName, userId) {
  const client = new pg.Client({ ...PG_CONFIG, database: dbName });
  await client.connect();
  await client.query("SET ROLE authenticated");
  // Plain SET doesn't accept bind parameters at all (it wants a literal),
  // so the session GUC auth.uid() reads is set via set_config() instead —
  // a normal function call, which does.
  if (userId) {
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  } else {
    await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
  return client;
}

// True if the query raised an RLS/permission error (INSERT/UPDATE denial),
// as opposed to some other kind of failure a test should not silently
// treat as "the security boundary worked".
export function isRlsError(err) {
  return !!err && /row-level security|permission denied/i.test(err.message || "");
}
