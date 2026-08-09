// netlify/functions/accept-invite.js
//
// Redeems a project_invitations token and creates the active
// project_membership for the accepting user's org. Runs with the service
// role because the accepting org has no project access yet (that's the
// whole point of the invite) — RLS would otherwise block the lookup.
// The invitation token itself is the authorization: only someone who
// received the emailed link can call this successfully.

const { getUserFromToken, restAsService } = require('./_lib/supabase');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sign in or create an account first, then accept the invite.' }) };
    }
    const accessToken = authHeader.slice('Bearer '.length);
    const user = await getUserFromToken(accessToken);
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
    }

    const { token } = JSON.parse(event.body || '{}');
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'token is required' }) };
    }

    // Look up the caller's org via their profile (service role bypasses RLS).
    const profileResp = await restAsService(`/profiles?id=eq.${user.id}&select=org_id`);
    const profile = Array.isArray(profileResp.body) ? profileResp.body[0] : null;
    if (!profile) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No organization profile found for this account. Complete signup first.' }) };
    }

    const inviteResp = await restAsService(`/project_invitations?token=eq.${encodeURIComponent(token)}&select=*`);
    const invitation = Array.isArray(inviteResp.body) ? inviteResp.body[0] : null;
    if (!invitation) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Invitation not found' }) };
    }
    if (invitation.status !== 'pending') {
      return { statusCode: 409, body: JSON.stringify({ error: `Invitation already ${invitation.status}` }) };
    }
    if (new Date(invitation.expires_at) < new Date()) {
      await restAsService(`/project_invitations?id=eq.${invitation.id}`, {
        method: 'PATCH',
        body: { status: 'expired' },
      });
      return { statusCode: 410, body: JSON.stringify({ error: 'Invitation has expired' }) };
    }

    // Upsert-style: create the membership, or reactivate a removed one.
    const membershipResp = await restAsService('/project_memberships', {
      method: 'POST',
      extraHeaders: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: {
        project_id: invitation.project_id,
        org_id: profile.org_id,
        tier_type: invitation.tier_type,
        status: 'active',
        invited_by: invitation.invited_by,
      },
    });

    if (membershipResp.statusCode >= 400) {
      return { statusCode: membershipResp.statusCode, body: JSON.stringify({ error: 'Could not create membership', details: membershipResp.body }) };
    }

    await restAsService(`/project_invitations?id=eq.${invitation.id}`, {
      method: 'PATCH',
      body: { status: 'accepted' },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ project_id: invitation.project_id, tier_type: invitation.tier_type }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
