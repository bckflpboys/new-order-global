// New Order Global — Billing Routes (Lemon Squeezy)
// Subscription management via Lemon Squeezy

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Tool = require('../models/Tool');

const router = express.Router();

// Lemon Squeezy API base
const LS_API_URL = 'https://api.lemonsqueezy.com/v1';

// Helper to make Lemon Squeezy API requests
async function lemonRequest(endpoint, options = {}) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) throw new Error('Lemon Squeezy API key not configured');

  const response = await fetch(`${LS_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization': `Bearer ${apiKey}`,
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Lemon Squeezy API error:', response.status, errorText);
    throw new Error(`Lemon Squeezy error (${response.status})`);
  }

  return response.json();
}

// ============================================
// GET /api/billing/subscription — Current plan
// ============================================
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    user.checkResetRequests();
    await user.save();

    const toolCount = await Tool.countDocuments({
      userId: user._id,
      status: { $in: ['active', 'draft'] }
    });

    const planDetails = {
      free: {
        name: 'Free',
        price: 0,
        aiRequests: 0,
        toolLimit: 0,
        features: ['YouTube New Order (built-in)', 'Extension popup controls']
      },
      pro: {
        name: 'Pro',
        price: 9.99,
        aiRequests: parseInt(process.env.AI_RATE_LIMIT_PRO) || 50,
        toolLimit: 10,
        features: ['Everything in Free', 'AI Tool Builder (50 requests/mo)', 'Up to 10 saved tools', 'Priority support']
      },
      unlimited: {
        name: 'Unlimited',
        price: 24.99,
        aiRequests: 'Unlimited',
        toolLimit: 999,
        features: ['Everything in Pro', 'Unlimited AI requests', 'Unlimited tools', 'Priority AI model']
      }
    };

    const currentPlan = planDetails[user.plan] || planDetails.free;

    res.json({
      plan: user.plan,
      planDetails: currentPlan,
      usage: {
        aiRequestsUsed: user.aiRequestsUsed,
        aiRequestsLimit: user.aiRequestsLimit,
        aiRequestsResetDate: user.aiRequestsResetDate,
        toolsCreated: toolCount,
        toolsLimit: currentPlan.toolLimit
      },
      lemonSqueezyCustomerId: user.lemonSqueezyCustomerId || null,
      lemonSqueezySubscriptionId: user.lemonSqueezySubscriptionId || null
    });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ error: 'Failed to get subscription info' });
  }
});

// ============================================
// GET /api/billing/usage — Detailed usage
// ============================================
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    user.checkResetRequests();

    const toolCount = await Tool.countDocuments({ userId: user._id, status: 'active' });
    const draftCount = await Tool.countDocuments({ userId: user._id, status: 'draft' });

    res.json({
      aiRequests: {
        used: user.aiRequestsUsed,
        limit: user.aiRequestsLimit,
        remaining: Math.max(0, user.aiRequestsLimit - user.aiRequestsUsed),
        resetDate: user.aiRequestsResetDate
      },
      tools: { active: toolCount, drafts: draftCount, total: toolCount + draftCount },
      plan: user.plan
    });
  } catch (err) {
    console.error('Usage error:', err);
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

// ============================================
// POST /api/billing/checkout — Create Lemon Squeezy checkout
// ============================================
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['pro', 'unlimited'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    if (!storeId) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    // Map plan to Lemon Squeezy variant IDs
    const variantIds = {
      pro: process.env.LEMONSQUEEZY_PRO_VARIANT_ID,
      unlimited: process.env.LEMONSQUEEZY_UNLIMITED_VARIANT_ID
    };

    const variantId = variantIds[plan];
    if (!variantId) {
      return res.status(500).json({ error: `Variant ID not configured for ${plan} plan` });
    }

    // Create checkout session via Lemon Squeezy API
    const checkout = await lemonRequest('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: req.user.email,
              name: req.user.displayName,
              custom: {
                user_id: req.user._id.toString()
              }
            },
            product_options: {
              redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/billing?success=true`,
              receipt_button_text: 'Go to Dashboard'
            }
          },
          relationships: {
            store: { data: { type: 'stores', id: storeId } },
            variant: { data: { type: 'variants', id: variantId } }
          }
        }
      })
    });

    const checkoutUrl = checkout.data?.attributes?.url;
    if (!checkoutUrl) {
      throw new Error('Failed to create checkout URL');
    }

    res.json({ checkoutUrl });

  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message || 'Failed to create checkout' });
  }
});

// ============================================
// POST /api/billing/portal — Get customer portal URL
// ============================================
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    if (!user.lemonSqueezyCustomerId) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Lemon Squeezy customer portal URL
    const portalUrl = `https://app.lemonsqueezy.com/my-orders`;

    res.json({ portalUrl });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to get portal URL' });
  }
});

// ============================================
// POST /api/billing/webhook — Lemon Squeezy webhooks
// ============================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    // Verify webhook signature
    if (secret) {
      const crypto = require('crypto');
      const signature = req.headers['x-signature'];
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');

      if (signature !== hmac) {
        console.error('Webhook signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.meta?.event_name;
    const customData = event.meta?.custom_data || {};
    const userId = customData.user_id;

    console.log(`Lemon Squeezy webhook: ${eventType} for user ${userId}`);

    const planLimits = {
      free: 0,
      pro: parseInt(process.env.AI_RATE_LIMIT_PRO) || 50,
      unlimited: parseInt(process.env.AI_RATE_LIMIT_UNLIMITED) || 9999
    };

    switch (eventType) {
      case 'subscription_created':
      case 'subscription_updated': {
        if (userId) {
          const user = await User.findById(userId);
          if (user) {
            const variantId = event.data?.attributes?.variant_id?.toString();
            const proVariant = process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
            const unlimitedVariant = process.env.LEMONSQUEEZY_UNLIMITED_VARIANT_ID;

            let newPlan = 'free';
            if (variantId === proVariant) newPlan = 'pro';
            else if (variantId === unlimitedVariant) newPlan = 'unlimited';

            user.plan = newPlan;
            user.aiRequestsLimit = planLimits[newPlan];
            user.lemonSqueezyCustomerId = event.data?.attributes?.customer_id?.toString();
            user.lemonSqueezySubscriptionId = event.data?.id?.toString();
            await user.save();

            console.log(`User ${user.email} upgraded to ${newPlan}`);
          }
        }
        break;
      }

      case 'subscription_cancelled':
      case 'subscription_expired': {
        if (userId) {
          const user = await User.findById(userId);
          if (user) {
            user.plan = 'free';
            user.aiRequestsLimit = planLimits.free;
            await user.save();
            console.log(`User ${user.email} downgraded to free`);
          }
        }
        break;
      }

      case 'subscription_payment_success': {
        console.log(`Payment received for user ${userId}`);
        break;
      }

      case 'subscription_payment_failed': {
        console.log(`Payment failed for user ${userId}`);
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${eventType}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
