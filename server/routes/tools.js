// New Order Global — Tools CRUD Routes

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const Tool = require('../models/Tool');

const router = express.Router();

// ============================================
// GET /api/tools — List user's tools
// ============================================
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { userId: req.userId };

    if (status) {
      query.status = status;
    }

    const tools = await Tool.find(query)
      .sort({ updatedAt: -1 })
      .select('-chatHistory') // Don't send full chat history in list
      .lean();

    res.json({ tools });
  } catch (err) {
    console.error('List tools error:', err);
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

// ============================================
// GET /api/tools/:id — Get a specific tool
// ============================================
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const tool = await Tool.findOne({
      _id: req.params.id,
      userId: req.userId
    }).lean();

    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    res.json({ tool });
  } catch (err) {
    console.error('Get tool error:', err);
    res.status(500).json({ error: 'Failed to get tool' });
  }
});

// ============================================
// POST /api/tools — Save a new tool (or accept a draft)
// ============================================
router.post('/', requireAuth, async (req, res) => {
  try {
    const { id, name, description, icon, targetSites, contentScript, styles, config, storageSchema, originalPrompt } = req.body;

    // Check tool limit based on plan
    const existingCount = await Tool.countDocuments({
      userId: req.userId,
      status: { $in: ['active', 'draft'] }
    });

    const limits = {
      free: 0,
      pro: 10,
      unlimited: 999
    };

    const userLimit = limits[req.user.plan] || 0;

    if (existingCount >= userLimit && req.user.plan === 'free') {
      return res.status(403).json({
        error: 'Free plan cannot save tools. Upgrade to Pro.',
        upgradeRequired: true
      });
    }

    if (existingCount >= userLimit) {
      return res.status(403).json({
        error: `Tool limit reached (${userLimit}). Upgrade for more.`,
        upgradeRequired: true
      });
    }

    // If an ID was provided, update the existing draft to active
    if (id) {
      const existing = await Tool.findOne({ _id: id, userId: req.userId });
      if (existing) {
        existing.status = 'active';
        existing.name = name || existing.name;
        existing.description = description || existing.description;
        if (contentScript) existing.contentScript = contentScript;
        if (styles) existing.styles = styles;
        if (config) existing.config = config;
        await existing.save();

        return res.json({
          tool: existing,
          message: 'Tool saved and activated'
        });
      }
    }

    // Create new tool
    const tool = new Tool({
      userId: req.userId,
      name: name || 'Untitled Tool',
      description: description || '',
      icon: icon || '🔧',
      targetSites: targetSites || ['*://*/*'],
      status: 'active',
      contentScript: contentScript || '',
      styles: styles || '',
      config: config || {},
      storageSchema: storageSchema || {},
      originalPrompt: originalPrompt || ''
    });

    await tool.save();

    res.status(201).json({
      tool,
      message: 'Tool created and activated'
    });

  } catch (err) {
    console.error('Save tool error:', err);
    res.status(500).json({ error: 'Failed to save tool' });
  }
});

// ============================================
// PUT /api/tools/:id — Update a tool
// ============================================
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const tool = await Tool.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    // Fields that can be updated
    const updatableFields = ['name', 'description', 'icon', 'targetSites', 'status', 'contentScript', 'styles', 'config'];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        tool[field] = req.body[field];
      }
    }

    await tool.save();

    res.json({
      tool,
      message: 'Tool updated'
    });
  } catch (err) {
    console.error('Update tool error:', err);
    res.status(500).json({ error: 'Failed to update tool' });
  }
});

// ============================================
// DELETE /api/tools/:id — Delete a tool
// ============================================
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await Tool.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId
    });

    if (!result) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    res.json({ message: 'Tool deleted' });
  } catch (err) {
    console.error('Delete tool error:', err);
    res.status(500).json({ error: 'Failed to delete tool' });
  }
});

module.exports = router;
