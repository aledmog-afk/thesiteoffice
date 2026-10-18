// Deliberate, disclosed exception to this app's otherwise-total
// "no custom backend" architecture (see P18b final report). Signed
// Storage URLs can only be minted by the Storage service itself using
// the service-role key — a plain SQL function cannot do it. Every
// authorization decision is still delegated to
// resolve_commercial_approval_evidence(), a SECURITY DEFINER SQL
// function that is fully testable in isolation via psql/pgTAP-style
// scripts. This function's own job is narrow and mechanical: call that
// RPC as an ordinary anon caller (zero special privilege), and only if
// it returns a row, use the service-role key — which never leaves this
// server-side function — to mint a short-lived signed URL for exactly
// the bucket/path it returned. It never touches the service-role key
// before authorization succeeds, and it never accepts a bucket/path
// from the caller.
//
// verify_jwt is deliberately disabled: an external signer has no
// Supabase Auth session and no user JWT at all (that is the entire
// point of this workflow — see the P18b spec's hard requirement that
// no account/session is ever required). Authentication instead comes
// from the caller possessing the real, unguessable approval token,
// which resolve_commercial_approval_evidence() verifies server-side on
// every call.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SIGNED_URL_TTL_SECONDS = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let body: { token?: unknown; evidence_link_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request." });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const evidenceLinkId = typeof body.evidence_link_id === "string" ? body.evidence_link_id : "";
  if (!token.trim() || !evidenceLinkId.trim()) {
    return jsonResponse(400, { error: "Invalid request." });
  }

  // Authorization only — this client carries the anon key and no more
  // privilege than an untrusted external caller already has via
  // PostgREST directly. It cannot read or write anything on its own;
  // resolve_commercial_approval_evidence() is SECURITY DEFINER and
  // does all the real checking (token validity, expiry, revocation,
  // and that this evidence link genuinely belongs to this token's own
  // commercial event).
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await authClient.rpc("resolve_commercial_approval_evidence", {
    p_token: token,
    p_evidence_link_id: evidenceLinkId,
  });

  if (error || !data || data.length === 0) {
    // Deliberately generic — mirrors the RPC's own generic refusal
    // messages so this endpoint cannot be used to distinguish "wrong
    // token" from "wrong evidence link" from "expired" by timing or
    // wording.
    return jsonResponse(403, { error: "This evidence is not available." });
  }

  const { storage_bucket: bucket, object_path: path } = data[0] as {
    storage_bucket: string;
    object_path: string;
  };

  // Only now — after authorization has already succeeded — is the
  // service-role key used, and only to mint a signed URL for exactly
  // the bucket/path the RPC itself returned. It is never sent to the
  // browser and never used for any other operation.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: signed, error: signError } = await serviceClient.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return jsonResponse(500, { error: "Could not generate access link." });
  }

  return jsonResponse(200, { signed_url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
});
