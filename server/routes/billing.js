// New Order Global — Billing Routes
// Subscription status and usage tracking (Stripe integration placeholder)

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Tool = require('../models/Tool');

const router = express.Router();

// ============================================
// GET /api/billing/subscription — Current plan info
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
        features: ['Everything in Free', 'AI Tool Builder (50 requests/mo)', 'Up to 10 saved tools', 'All built-in tools', 'Priority support']
      },
      unlimited: {
        name: 'Unlimited',
        price: 24.99,
        aiRequests: 'Unlimited',
        toolLimit: 999,
        features: ['Everything in Pro', 'Unlimited AI requests', 'Unlimited tools', 'Priority AI model', 'Early access to features']
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
      stripeCustomerId: user.stripeCustomerId || null
    });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ error: 'Failed to get subscription info' });
  }
});

// ============================================
// GET /api/billing/usage — Detailed usage stats
// ============================================
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    user.checkResetRequests();

    const toolCount = await Tool.countDocuments({
      userId: user._id,
      status: 'active'
    });

    const draftCount = await Tool.countDocuments({
      userId: user._id,
      status: 'draft'
    });

    res.json({
      aiRequests: {
        used: user.aiRequestsUsed,
        limit: user.aiRequestsLimit,
        remaining: Math.max(0, user.aiRequestsLimit - user.aiRequestsUsed),
        resetDate: user.aiRequestsResetDate
      },
      tools: {
        active: toolCount,
        drafts: draftCount,
        total: toolCount + draftCount
      },
      plan: user.plan
    });
  } catch (err) {
    console.error('Usage error:', err);
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

// ============================================
// POST /api/billing/upgrade — Upgrade plan (Stripe placeholder)
// ============================================
router.post('/upgrade', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['pro', 'unlimited'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // TODO: Integrate Stripe checkout
    // For now, return the URL where users should go to upgrade
    res.json({
      message: 'Stripe integration coming soon',
      upgradeUrl: `${process.env.FRONTEND_URL || 'https://neworderglobal.com'}/pricing`,
      requestedPlan: plan
    });

    // When Stripe is integrated, this will:
    // 1. Create a Stripe checkout session
    // 2. Return the checkout URL
    // 3. On success webhook, update user.plan and user.aiRequestsLimit

  } catch (err) {
    console.error('Upgrade error:', err);
    res.status(500).json({ error: 'Failed to process upgrade' });
  }
});

// ============================================
// POST /api/billing/webhook — Stripe webhook (placeholder)
// ============================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // TODO: Implement Stripe webhook handling
  // This will:
  // 1. Verify webhook signature
  // 2. Handle checkout.session.completed → upgrade user plan
  // 3. Handle customer.subscription.deleted → downgrade to free
  // 4. Handle invoice.payment_failed → notify user

  const planLimits = {
    free: 0,
    pro: parseInt(process.env.AI_RATE_LIMIT_PRO) || 50,
    unlimited: parseInt(process.env.AI_RATE_LIMIT_UNLIMITED) || 9999
  };

  res.json({ received: true });
});

module.exports = router;
