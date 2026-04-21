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

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amount, currency, email, items } = JSON.parse(event.body);

    // Basic validation
    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid amount' })
      };
    }

    // Create PaymentIntent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,         // in pence, e.g. 900 = £9.00
      currency: currency || 'gbp',
      automatic_payment_methods: { enabled: true },
      receipt_email: email,
      metadata: {
        customer_email: email,
        items: items.map(i => i.name).join(', ').substring(0, 500)
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://thesiteoffice.uk',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };

  } catch (error) {
    console.error('Stripe error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
