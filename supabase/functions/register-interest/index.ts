// v83: handles the "Register your interest" form on the public front
// page (index.html). The second deliberate, disclosed exception to
// this app's otherwise-total "no custom backend" architecture — see
// commercial-approval-evidence's own comment for the first, and
// public.interest_signups' own comment in sql/schema.sql for the full
// reasoning: a genuinely public, unauthenticated submission with no
// Supabase Auth session has no other way to reach this project at all
// (a plain scriptless HTML form cannot set the apikey header every
// other table/RPC call in this schema assumes at minimum).
//
// verify_jwt is deliberately disabled, same reason as
// commercial-approval-evidence: a visitor filling in a public form has
// no Supabase Auth session and no JWT at all. This function does its
// own validation instead and writes with the service-role key, which
// never leaves this server-side function.
//
// Submits as a plain HTML <form method="POST">, not fetch/XHR — so
// this responds with an HTTP redirect (303), not JSON, back to the
// front page's own #interest-sent / #interest-error notice banners
// (same .notice:target convention index.html already uses for
// #shop-closed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SITE_URL = "https://thesiteoffice.uk";
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_COMPANY = 160;
const MAX_MESSAGE = 1000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function redirect(hash: string): Response {
  return new Response(null, { status: 303, headers: { Location: `${SITE_URL}/#${hash}` } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return redirect("interest-error");
  }

  // Honeypot — a field real visitors never see or fill (hidden off-
  // screen in the form, not display:none, since some bots skip those).
  // A real submission always leaves it blank; silently "succeed"
  // without writing anything so a bot gets no signal it was caught.
  if (String(form.get("website") ?? "").trim()) {
    return redirect("interest-sent");
  }

  const name = String(form.get("name") ?? "").trim().slice(0, MAX_NAME);
  const email = String(form.get("email") ?? "").trim().slice(0, MAX_EMAIL);
  const company = String(form.get("company") ?? "").trim().slice(0, MAX_COMPANY) || null;
  const message = String(form.get("message") ?? "").trim().slice(0, MAX_MESSAGE) || null;

  if (!name || !email || !EMAIL_RE.test(email)) {
    return redirect("interest-error");
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await serviceClient.from("interest_signups").insert({ name, email, company, message });
  if (error) {
    return redirect("interest-error");
  }

  return redirect("interest-sent");
});
