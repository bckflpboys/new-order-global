// New Order Global — Auth Routes

const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { generateToken, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// ============================================
// POST /api/auth/register
// ============================================
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check for existing user
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Determine limits based on plan
    const planLimits = {
      free: 0,
      pro: parseInt(process.env.AI_RATE_LIMIT_PRO) || 50,
      unlimited: parseInt(process.env.AI_RATE_LIMIT_UNLIMITED) || 9999
    };

    // Create user
    const user = new User({
      email: email.toLowerCase().trim(),
      passwordHash,
      displayName: displayName || email.split('@')[0],
      plan: 'free',
      aiRequestsLimit: planLimits.free
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: user.toSafeJSON()
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    user.lastLogin = new Date();
    user.checkResetRequests(); // Reset AI requests if new month
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toSafeJSON()
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// GET /api/auth/profile
// ============================================
router.get('/profile', requireAuth, async (req, res) => {
  try {
    req.user.checkResetRequests();
    await req.user.save();

    res.json({
      user: req.user.toSafeJSON()
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// ============================================
// PUT /api/auth/profile
// ============================================
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { displayName } = req.body;

    if (displayName !== undefined) {
      req.user.displayName = displayName;
    }

    await req.user.save();

    res.json({
      user: req.user.toSafeJSON()
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ============================================
// POST /api/auth/change-password
// ============================================
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const isMatch = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(12);
    req.user.passwordHash = await bcrypt.hash(newPassword, salt);
    await req.user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
