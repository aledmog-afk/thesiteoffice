// netlify/functions/create-payment-intent.js
//
// This function runs on Netlify's servers — NOT in the browser.
// Your Stripe Secret Key is stored as a Netlify environment variable
// called STRIPE_SECRET_KEY. It is never exposed to the public.
//
// HOW TO SET YOUR SECRET KEY IN NETLIFY:
// 1. Go to netlify.com → your site → Site settings
// 2. Click "Environment variables" in the left menu
// 3. Click "Add a variable"
// 4. Key: STRIPE_SECRET_KEY
// 5. Value: paste your sk_live_... key
// 6. Save — done. Netlify injects it securely at runtime.

const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amount, currency, email, items } = JSON.parse(event.body);

    if (!amount || amount < 50) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Stripe key not configured' }) };
    }

    const itemNames = (items || []).map(i => i.name).join(', ').substring(0, 500);

    const postData = new URLSearchParams({
      amount: amount.toString(),
      currency: currency || 'gbp',
      'automatic_payment_methods[enabled]': 'true',
      receipt_email: email || '',
      'metadata[customer_email]': email || '',
      'metadata[items]': itemNames,
    }).toString();

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.stripe.com',
        path: '/v1/payment_intents',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + secretKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (result.status !== 200) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: result.body.error && result.body.error.message || 'Stripe error' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ clientSecret: result.body.client_secret })
    };

  } catch (error) {
    console.error('Function error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong' }) };
  }
};
