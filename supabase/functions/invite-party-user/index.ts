// v84: lets an org admin send a real Supabase account-invite email to
// the lead person they're inviting onto a job (see sql's own comment
// on project_party_invites for the party-invite mechanism itself).
// The THIRD deliberate, disclosed exception to this app's otherwise-
// total "no custom backend" architecture (after
// commercial-approval-evidence and register-interest) - admin.
// inviteUserByEmail() needs the service-role key, which a SQL function
// can never hold.
//
// Why this exists at all: once self-service sign-up is turned off in
// Supabase (see handover notes), a brand-new person has no way to get
// an account at all - signInWithPassword() on a never-registered
// address just fails. inviteUserByEmail() is Supabase's own mechanism
// for this: it creates the Auth user and emails them a link that signs
// them in and lets them set a password (tracker/invite-password.html),
// with the real party-invite token riding along in `redirectTo` so
// that one email takes them straight through to accepting the job
// (tracker/invite.html) once they've set a password. An existing user
// doesn't need any of this - inviteUserByEmail() on an address that's
// already registered just errors, which this function treats as a
// normal, expected outcome (sent: false), not a failure: they already
// have the manually-shared link to open and sign in with.
//
// Authorization, checked server-side, every call: this function is
// deliberately NOT told who's an "admin" by the caller - it re-derives
// it from the real table. The caller's own JWT (forwarded as-is, never
// the service-role key) is used to SELECT the named invite row from
// project_party_invites; that table's own RLS policy
// ("read project_party_invites") only returns a row to whoever
// can_manage_party_invite() it already governs for every other
// invite action (create/resend/cancel) - the project owner, or, for a
// sub-subcontractor invite, the parent company's own org admin. No row
// back means "not authorized", full stop: this function never makes
// its own separate judgment call about who counts as an admin, and it
// never sees the service-role key before that check has already
// passed.
//
// verify_jwt stays at its default (true): every legitimate caller here
// is a signed-in org admin, so a request with no valid JWT at all can
// be rejected before this code even runs - unlike
// commercial-approval-evidence/register-interest, which both exist
// specifically FOR callers with no session.

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

  let body: { invite_id?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request." });
  }
  const inviteId = typeof body.invite_id === "string" ? body.invite_id : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!inviteId.trim() || !token.trim()) {
    return jsonResponse(400, { error: "Invalid request." });
  }

  // Authorization only — this client carries the anon key plus the
  // CALLER's own JWT (forwarded as-is), so it has exactly the privilege
  // that caller already has via PostgREST directly, no more. It cannot
  // read or write anything on its own; the RLS policy on
  // project_party_invites does all the real checking.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: invite, error: inviteError } = await callerClient
    .from("project_party_invites")
    .select("id, invited_email, status")
    .eq("id", inviteId)
    .single();

  if (inviteError || !invite) {
    return jsonResponse(403, { error: "Not authorized to send this invite." });
  }
  if (invite.status !== "pending") {
    return jsonResponse(409, { error: "This invite is no longer pending." });
  }

  // Only now — after the caller has proved they administer this exact
  // invite — is the service-role key used, and only to invite this one
  // email address. The party-invite token is the same one already
  // shown to the admin to copy/paste; embedding it in redirectTo means
  // the recipient's one email takes them through set-password ->
  // accept-the-job in a single journey, with no second link needed.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const redirectTo = `${SITE_URL}/tracker/invite-password.html?t=${encodeURIComponent(token)}`;
  const { error: inviteUserError } = await serviceClient.auth.admin.inviteUserByEmail(invite.invited_email, { redirectTo });

  if (inviteUserError) {
    // An existing account is the common, expected case (most invited
    // leads already use The Site Office elsewhere) - not a failure.
    // They still have the manually-shared link above to sign in with.
    const msg = (inviteUserError.message || "").toLowerCase();
    const code = (inviteUserError as { code?: string }).code || "";
    if (code === "email_exists" || /already (been )?registered|already exists/.test(msg)) {
      return jsonResponse(200, { sent: false, reason: "existing_user" });
    }
    return jsonResponse(500, { error: "Could not send the invite email." });
  }

  return jsonResponse(200, { sent: true });
});
