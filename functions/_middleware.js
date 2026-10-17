// Cloudflare Pages Function: answers 404 for repository files that are
// not part of the website (SQL schema, tests, edge-function source, CI
// config, docs, scripts, tooling, package files). The site is deployed
// from the repository root with no build step, so without this every
// file in the repo is publicly downloadable from the site.
//
// Why a Function and not _redirects: Pages _redirects only supports
// 301/302/303/307/308 and 200 (proxy); a 404 status there is not
// supported (developers.cloudflare.com/pages/configuration/redirects/,
// "Rewrites (other status codes)"). _headers cannot change a status
// either.
//
// _routes.json (repo root) runs this Function on every request except the
// app's js/css/favicon (the bulk of requests), and it just hands anything
// not blocked straight on to the static file. It can't be limited to only
// the blocked paths: Pages matches _routes.json against the raw,
// still-percent-encoded path but serves static files by the decoded one,
// so /%73ql/schema.sql would skip a narrow route list and still download
// the file (checked on a branch preview). Encoded "../" under the excluded
// folders does not resolve to another folder on Pages (checked too).
// tests/frontend/blocked_repo_paths.test.mjs checks the routes still send
// every blocked path here.

export const BLOCKED_PREFIXES = [
  "/sql", "/tests", "/supabase", "/.github", "/tracker/docs", "/scripts",
  "/tools", "/node_modules", "/functions",
];
export const BLOCKED_FILES = [
  "/package.json", "/package-lock.json", "/README.md", "/netlify.toml", "/_routes.json",
];

export function isBlockedPath(pathname) {
  let p = pathname;
  // Decode repeatedly so /%73ql/... or /sql%2Fschema.sql can't slip past.
  for (let i = 0; i < 5; i++) {
    let d;
    try { d = decodeURIComponent(p); } catch { return true; }
    if (d === p) break;
    p = d;
  }
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (BLOCKED_FILES.includes(p)) return true;
  return BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

const NOT_FOUND_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  if (isBlockedPath(pathname)) {
    return new Response("Not found\n", { status: 404, headers: NOT_FOUND_HEADERS });
  }
  return context.next();
}
