#!/usr/bin/env node
// Imports the standard Toolbox Talk library (scripts/toolbox-talks/
// manifest.json, produced by extract.py from the supplied .docx files —
// see that script's own header comment for the exact extraction rules)
// as SYSTEM templates (toolbox_talk_templates.org_id = null), each with
// a single version 1.
//
// This is an ADMIN operation, not a client-facing feature: system
// templates have no INSERT policy for any client role at all (see
// sql/schema.sql v44), so this script must connect with elevated
// (RLS-bypassing) database credentials — the same superuser/service-role
// access schema.sql migrations themselves are applied with, never a
// route exposed through the app.
//
// Idempotent: re-running this script is always safe. A system template
// is identified by its source_filename (unique among system templates by
// construction — the import never creates two for the same file); if one
// already exists, its title/description are updated in place but NO NEW
// VERSION is created automatically (content changes are a deliberate,
// separate action — see --update-content below) so historical delivered
// talks are never put at risk of confusion with a "re-import".
//
// Usage:
//   node scripts/toolbox-talks/import.mjs                 # local test DB (PG_CONFIG-style env vars)
//   node scripts/toolbox-talks/import.mjs --update-content # also add a new version for any template whose manifest content has changed since it was last imported
//
// Connection: uses the same PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
// environment variables `pg` itself reads, matching tests/lib/db.mjs's
// own PG_CONFIG convention — point these at production only deliberately
// and briefly (see tracker/README.md's production deployment notes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "manifest.json");

const UPDATE_CONTENT = process.argv.includes("--update-content");

// Postgres's jsonb storage does not preserve key insertion order, so a
// value round-tripped through the database can come back with different
// key ordering than the same value freshly built from the manifest —
// JSON.stringify() alone would then report two IDENTICAL contents as
// "changed". Sorting keys recursively before stringifying makes the
// comparison genuinely order-independent.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toTemplateContent(record) {
  // Everything except the pure filing/identity fields (source_filename,
  // title, template_key) goes into the version's content — this is
  // exactly what's shown when delivering the talk.
  const { source_filename, title, template_key, ...content } = record;
  return content;
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}. Run extract.py against the supplied source documents first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  console.log(`Manifest: ${manifest.length} talk(s) to import.`);

  const client = new pg.Client({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE,
  });
  await client.connect();

  const results = { created: [], updatedMetadataOnly: [], newVersionAdded: [], unchanged: [], failed: [] };

  try {
    await client.query("begin");
    for (const record of manifest) {
      try {
        const content = toTemplateContent(record);
        const existing = await client.query(
          "select id, description from public.toolbox_talk_templates where org_id is null and source_filename = $1",
          [record.source_filename]
        );

        if (existing.rowCount === 0) {
          const templateId = (await client.query(
            "insert into public.toolbox_talk_templates (org_id, title, source_filename) values (null, $1, $2) returning id",
            [record.title, record.source_filename]
          )).rows[0].id;
          await client.query(
            "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2)",
            [templateId, JSON.stringify(content)]
          );
          results.created.push(record.source_filename);
          continue;
        }

        const templateId = existing.rows[0].id;
        await client.query("update public.toolbox_talk_templates set title = $1 where id = $2", [record.title, templateId]);

        const currentVersion = await client.query(
          `select tv.content from public.toolbox_talk_template_versions tv
           join public.toolbox_talk_templates t on t.id = tv.template_id
           where t.id = $1 and tv.id = t.current_version_id`,
          [templateId]
        );
        const currentContent = currentVersion.rows[0]?.content;
        const changed = stableStringify(currentContent) !== stableStringify(content);

        if (changed && UPDATE_CONTENT) {
          await client.query(
            "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2)",
            [templateId, JSON.stringify(content)]
          );
          results.newVersionAdded.push(record.source_filename);
        } else if (changed) {
          results.updatedMetadataOnly.push(`${record.source_filename} (content differs — re-run with --update-content to add a new version)`);
        } else {
          results.unchanged.push(record.source_filename);
        }
      } catch (err) {
        results.failed.push(`${record.source_filename}: ${err.message}`);
      }
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }

  console.log(`\nCreated:                ${results.created.length}`);
  console.log(`Unchanged (no-op):       ${results.unchanged.length}`);
  console.log(`New version added:       ${results.newVersionAdded.length}`);
  console.log(`Content changed, not applied (pass --update-content): ${results.updatedMetadataOnly.length}`);
  console.log(`Failed:                  ${results.failed.length}`);
  if (results.failed.length) {
    console.log("\n--- FAILURES ---");
    for (const f of results.failed) console.log(" ", f);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
