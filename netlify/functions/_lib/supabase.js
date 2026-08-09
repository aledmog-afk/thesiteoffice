// netlify/functions/_lib/supabase.js
//
// Minimal Supabase REST (PostgREST + GoTrue) helpers over plain https —
// no @supabase/supabase-js dependency, matching this repo's no-build-step
// convention. Requires these Netlify environment variables:
//   SUPABASE_URL              e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY         publishable/anon key (safe to expose to browsers)
//   SUPABASE_SERVICE_ROLE_KEY secret key — server-side only, bypasses RLS

const { requestJSON } = require('./http');

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

// Resolves the calling user from a Supabase access token (the browser's
// session JWT, passed as "Authorization: Bearer <token>").
async function getUserFromToken(accessToken) {
  const url = `${env('SUPABASE_URL')}/auth/v1/user`;
  const { statusCode, body } = await requestJSON(url, {
    method: 'GET',
    headers: {
      apikey: env('SUPABASE_ANON_KEY'),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (statusCode !== 200 || !body || !body.id) return null;
  return body;
}

// PostgREST call made *as the calling user* — RLS applies normally.
// Use this for anything a signed-in user is already allowed to do; it's
// the safer default over the service-role client below.
async function restAsUser(accessToken, path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const url = `${env('SUPABASE_URL')}/rest/v1${path}`;
  return requestJSON(url, {
    method,
    headers: {
      apikey: env('SUPABASE_ANON_KEY'),
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body,
  });
}

// PostgREST call using the service role key — bypasses RLS entirely.
// Only use this for operations that legitimately need elevated access
// (e.g. redeeming an invite token before the invitee has project access,
// or the AI matching pipeline writing flagged_events).
async function restAsService(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const url = `${env('SUPABASE_URL')}/rest/v1${path}`;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return requestJSON(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body,
  });
}

module.exports = { getUserFromToken, restAsUser, restAsService, env };
