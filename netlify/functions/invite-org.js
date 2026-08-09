// netlify/functions/invite-org.js
//
// Creates a project invitation and (best-effort) emails the invited org.
// The insert runs as the calling user (not service role) so Postgres RLS
// decides who is allowed to invite — this function is a thin wrapper, not
// a privilege escalation.

const { getUserFromToken, restAsUser, env } = require('./_lib/supabase');
const { requestJSON } = require('./_lib/http');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing bearer token' }) };
    }
    const accessToken = authHeader.slice('Bearer '.length);

    const user = await getUserFromToken(accessToken);
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
    }

    const { project_id, invited_org_email, tier_type } = JSON.parse(event.body || '{}');
    if (!project_id || !invited_org_email || !tier_type) {
      return { statusCode: 400, body: JSON.stringify({ error: 'project_id, invited_org_email and tier_type are required' }) };
    }
    const validTiers = ['client', 'main_contractor', 'subcontractor', 'employers_agent'];
    if (!validTiers.includes(tier_type)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid tier_type' }) };
    }

    // RLS (project_invitations_insert) enforces that only the project's
    // owner org, or an org acting as Employer's Agent on the project, can
    // create an invitation here.
    const { statusCode, body } = await restAsUser(accessToken, '/project_invitations', {
      method: 'POST',
      body: { project_id, invited_org_email, tier_type },
    });

    if (statusCode >= 400) {
      return { statusCode, body: JSON.stringify({ error: 'Could not create invitation', details: body }) };
    }

    const invitation = Array.isArray(body) ? body[0] : body;
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || '';
    const acceptLink = `${siteUrl}/jct-platform/accept-invite.html?token=${invitation.token}`;

    // Email delivery is best-effort — a missing RESEND_API_KEY should not
    // fail the invite itself; the owner org can still share the link manually.
    let emailSent = false;
    if (process.env.RESEND_API_KEY) {
      try {
        const resendResp = await requestJSON('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          body: {
            from: process.env.RESEND_FROM_EMAIL || 'JCT Compensation Platform <onboarding@resend.dev>',
            to: [invited_org_email],
            subject: 'You have been invited to a project on the JCT Compensation Platform',
            html: `<p>You've been invited to join a construction project as <strong>${tier_type.replace('_', ' ')}</strong>.</p>
                   <p><a href="${acceptLink}">Accept the invitation</a></p>
                   <p>This link expires in 14 days.</p>`,
          },
        });
        emailSent = resendResp.statusCode < 300;
      } catch (e) {
        emailSent = false;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ invitation, acceptLink, emailSent }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
