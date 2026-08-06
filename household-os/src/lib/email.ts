import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM_EMAIL ?? "Household OS <onboarding@resend.dev>";

export async function sendInviteEmail(opts: {
  to: string;
  householdName: string;
  inviterName: string;
  acceptUrl: string;
}) {
  if (!resend) {
    console.info(`[email disabled] Invite link for ${opts.to}: ${opts.acceptUrl}`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `${opts.inviterName} invited you to join ${opts.householdName} on Household OS`,
    html: `
      <p>${opts.inviterName} invited you to join <strong>${opts.householdName}</strong> on Household OS.</p>
      <p><a href="${opts.acceptUrl}">Accept the invite</a></p>
    `,
  });
}

export async function sendDailyDigestEmail(opts: {
  to: string;
  householdName: string;
  html: string;
}) {
  if (!resend) {
    console.info(`[email disabled] Digest for ${opts.to} skipped (no RESEND_API_KEY)`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `${opts.householdName}: today's plan`,
    html: opts.html,
  });
}
