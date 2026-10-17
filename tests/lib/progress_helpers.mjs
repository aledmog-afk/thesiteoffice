// The real v69 progress helpers from tracker/js/app.js, for page tests
// that run under jsdom with stubbed app.js bindings. app.js itself can't
// be imported in node (it imports the Supabase client from a CDN), so
// the exact source of each pure helper is extracted and evaluated —
// never a reimplementation.
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function grabConst(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

function grabFunction(name) {
  const start = APP_JS.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in app.js`);
  const end = APP_JS.indexOf("\n}\n", start);
  return APP_JS.slice(start, end + 3).replace(/^export /, "");
}

const CONSTS = ["EXTERNAL_WORKS_TAG", "PROGRESS_STAGES", "BUILD_MILESTONES", "PLOT_STAGE_SOURCE_LABEL",
  "EXTERNAL_WORKS_STALE_DAYS", "MONTHLY_PROGRESS_BASIS_NOTE", "HISTORY_ACTOR_FALLBACK"];
const FUNCTIONS = ["plotTagKey", "resolvePlotTagsDetailed", "resolvePlotTags", "plotProgressMode", "externalWorksStale",
  "externalWorksShareSet", "externalWorksSuggestions", "formatDateTime", "historyActorName", "normalisedPackageShare"];

const src = [
  ...CONSTS.map(grabConst),
  // TAG_SPACE and PLOT_RANGE_RE are module-private but the parser needs them.
  APP_JS.match(/const TAG_SPACE = .*;\n/)[0],
  APP_JS.match(/const PLOT_RANGE_RE = .*;\n/)[0],
  ...FUNCTIONS.map(grabFunction),
  `return { ${[...CONSTS, ...FUNCTIONS].join(", ")} };`,
].join("\n");

export const progressHelpers = new Function(src)();
