// netlify/functions/config.js
//
// Serves the browser its Supabase connection details at runtime, so the
// anon key never has to be hardcoded into the static HTML/JS. The anon key
// is safe to expose (it only grants what RLS allows) but keeping it in an
// env var means the same frontend code works against a dev and prod project.

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Platform not configured yet. Set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify environment variables.',
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ supabaseUrl, supabaseAnonKey }),
  };
};
