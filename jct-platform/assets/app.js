// jct-platform/assets/app.js
//
// Shared client-side helpers. Loaded after the supabase-js UMD bundle
// (window.supabase) on every page. No build step — plain script tags.

const JCT = (() => {
  let clientPromise = null;

  async function initClient() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const res = await fetch('/.netlify/functions/config');
      if (!res.ok) {
        throw new Error('Could not load platform configuration. Has SUPABASE_URL / SUPABASE_ANON_KEY been set in Netlify?');
      }
      const { supabaseUrl, supabaseAnonKey } = await res.json();
      return window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    })();
    return clientPromise;
  }

  async function requireSession(client) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      window.location.href = '/jct-platform/index.html';
      return null;
    }
    return session;
  }

  async function getProfile(client, userId) {
    const { data, error } = await client
      .from('profiles')
      .select('id, org_id, name, email, role, organizations(name, tier_type)')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const TIER_LABELS = {
    client: 'Client',
    main_contractor: 'Main Contractor',
    subcontractor: 'Subcontractor',
    employers_agent: "Employer's Agent",
  };
  function tierLabel(tier) { return TIER_LABELS[tier] || tier; }

  const CATEGORY_LABELS = {
    progress: 'Progress', instruction: 'Instruction', weather: 'Weather',
    delay: 'Delay', access: 'Access', comment: 'Comment',
  };
  function categoryLabel(c) { return CATEGORY_LABELS[c] || c; }

  function fmtDate(d) {
    if (!d) return '';
    return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  async function setTopbarUser(client) {
    const el = document.getElementById('topbar-user');
    if (!el) return;
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    try {
      const profile = await getProfile(client, session.user.id);
      if (profile) {
        el.textContent = `${profile.name} · ${profile.organizations ? profile.organizations.name : ''}`;
      } else {
        el.textContent = session.user.email;
      }
    } catch (e) {
      el.textContent = session.user.email;
    }
    const signOutBtn = document.getElementById('topbar-signout');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await client.auth.signOut();
        window.location.href = '/jct-platform/index.html';
      });
    }
  }

  return { initClient, requireSession, getProfile, escapeHtml, tierLabel, categoryLabel, fmtDate, setTopbarUser };
})();
