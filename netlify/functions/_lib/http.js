// netlify/functions/_lib/http.js
//
// Tiny dependency-free HTTPS JSON client shared by the JCT platform's
// Netlify functions. No npm packages — this repo ships static HTML plus
// serverless functions with zero build step, so every function talks to
// Supabase (PostgREST/GoTrue) and the Anthropic API over plain `https`,
// the same way netlify/functions/create-payment-intent.js talks to Stripe.

const https = require('https');

function requestJSON(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const target = new URL(url);

    const options = {
      hostname: target.hostname,
      path: target.pathname + target.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        if (raw) {
          try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { requestJSON };
