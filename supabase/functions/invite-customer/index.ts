// v91: lets a platform admin (Aled) send a real Supabase account-invite
// email to a brand-new company, replacing "create the Auth user by
// hand in the Supabase SQL editor" as the only route left once
// self-sign-up was removed (v74/PR #74). The FOURTH deliberate,
// disclosed exception to this app's otherwise-total "no custom
// backend" architecture (after commercial-approval-evidence,
// register-interest, invite-party-user) — auth.admin.inviteUserByEmail()
// needs the service-role key, which a SQL function can never hold.
//
// Authorization, re-checked server-side, every call — same shape as
// invite-party-user, deliberately: this function is never told "I'm a
// platform admin" by the caller. The caller's own JWT (forwarded
// as-is, never the service-role key) is used to call
// is_platform_admin() — a SECURITY DEFINER function that reads
// platform_admins directly, bypassing that table's own zero-policy
// RLS the same way every other security-definer helper in this schema
// does. A false (or error) result means "not authorized", full stop;
// the service-role key is never touched before that check has already
// passed.
//
// verify_jwt stays at its default (true) when this is deployed: every
// legitimate caller here is a signed-in platform admin, so a request
// with no valid JWT at all can be rejected before this code even
// runs — unlike commercial-approval-evidence/register-interest, which
// both exist specifically for callers with no session.
//
// "Already registered" is a normal, non-fatal result (sent: false,
// reason: "existing_user"), not an error — inviteUserByEmail() on an
// address that already has an account simply errors, and that's the
// expected, common case here (the usual reason to invite someone is
// because Register Your Interest told Aled about them; some of those
// people may already have signed up to a related product, or already
// have an account from before self-sign-up was removed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SITE_URL = "https://thesiteoffice.uk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

  const authHeader = req.headers.get("Authorization") || "";

  let body: { email?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request." });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return jsonResponse(400, { error: "Enter a valid email address." });
  }

  // Authorization only — this client carries the anon key plus the
  // CALLER's own JWT (forwarded as-is), so it has exactly the
  // privilege that caller already has via PostgREST directly, no
  // more. It cannot read or write anything on its own; is_platform_admin()
  // does the real checking, against the real table.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("is_platform_admin");
  if (adminCheckError || !isAdmin) {
    return jsonResponse(403, { error: "Not authorized to invite customers." });
  }

  // Only now — after the caller has proved they are the real platform
  // admin — is the service-role key used, and only to invite this one
  // email address. There is no party-invite token for a brand-new
  // customer (unlike invite-party-user), so redirectTo carries none —
  // invite-password.html already lands anyone who arrives with no
  // ?t= token straight on the Dashboard, where they can create their
  // own organisation and first project as normal. The optional company
  // name is carried as user metadata only — purely informational for
  // Aled's own later reference, nothing in this app reads it back.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const redirectTo = `${SITE_URL}/tracker/invite-password.html`;
  const { error: inviteUserError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: company ? { invited_company: company } : undefined,
  });

  if (inviteUserError) {
    const msg = (inviteUserError.message || "").toLowerCase();
    const code = (inviteUserError as { code?: string }).code || "";
    if (code === "email_exists" || /already (been )?registered|already exists/.test(msg)) {
      return jsonResponse(200, { sent: false, reason: "existing_user" });
    }
    return jsonResponse(500, { error: "Could not send the invite email." });
  }

  return jsonResponse(200, { sent: true });
});
