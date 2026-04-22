// New Order Global — AI Routes
// Handles tool generation and iteration via OpenRouter

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimit');
const { generateToolFromPrompt, iterateToolFromFeedback } = require('../services/openrouter');
const Tool = require('../models/Tool');

const router = express.Router();

// ============================================
// POST /api/ai/generate — Generate a new tool
// ============================================
router.post('/generate', requireAuth, aiLimiter, async (req, res) => {
  try {
    const { prompt, currentUrl, currentSite, pageTitle } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Please describe what you want to build' });
    }

    if (prompt.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a more detailed description' });
    }

    // Check user's AI quota
    const user = req.user;
    user.checkResetRequests();

    if (!user.canMakeAIRequest()) {
      if (user.plan === 'free') {
        return res.status(403).json({
          error: 'AI Tool Builder requires a Pro or Unlimited plan',
          upgradeRequired: true
        });
      }
      return res.status(429).json({
        error: `You've used all ${user.aiRequestsLimit} AI requests for this month. Upgrade to Unlimited for more.`,
        upgradeRequired: true
      });
    }

    console.log(`AI Generate | User: ${user.email} | Prompt: "${prompt.substring(0, 60)}..."`);

    // Generate tool via OpenRouter
    const result = await generateToolFromPrompt(prompt, {
      currentUrl,
      currentSite,
      pageTitle
    });

    // Record usage
    user.recordAIRequest();
    await user.save();

    // Save as draft in database
    const toolDoc = new Tool({
      userId: user._id,
      name: result.tool.name,
      description: result.tool.description,
      icon: result.tool.icon || '🔧',
      targetSites: result.tool.targetSites,
      status: 'draft',
      contentScript: result.tool.contentScript,
      styles: result.tool.styles || '',
      config: result.tool.config || {},
      storageSchema: result.tool.storageSchema || {},
      originalPrompt: prompt,
      chatHistory: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: JSON.stringify(result.tool) }
      ]
    });
    await toolDoc.save();

    // Attach the DB ID to the tool
    result.tool.id = toolDoc._id.toString();
    result.tool.dbId = toolDoc._id.toString();

    res.json({
      tool: result.tool,
      usage: {
        requestsUsed: user.aiRequestsUsed,
        requestsLimit: user.aiRequestsLimit,
        model: result.model
      }
    });

  } catch (err) {
    console.error('AI generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate tool' });
  }
});

// ============================================
// POST /api/ai/iterate — Modify an existing tool
// ============================================
router.post('/iterate', requireAuth, aiLimiter, async (req, res) => {
  try {
    const { toolId, feedback, currentCode } = req.body;

    if (!feedback || feedback.trim().length === 0) {
      return res.status(400).json({ error: 'Please describe what changes you want' });
    }

    // Check quota
    const user = req.user;
    user.checkResetRequests();

    if (!user.canMakeAIRequest()) {
      return res.status(429).json({ error: 'AI request limit reached', upgradeRequired: true });
    }

    // Find existing tool
    let existingTool = currentCode;
    let toolDoc = null;

    if (toolId) {
      toolDoc = await Tool.findOne({ _id: toolId, userId: user._id });
      if (toolDoc) {
        existingTool = {
          id: toolDoc._id.toString(),
          name: toolDoc.name,
          contentScript: toolDoc.contentScript,
          styles: toolDoc.styles,
          targetSites: toolDoc.targetSites,
          config: toolDoc.config,
          version: toolDoc.version
        };
      }
    }

    if (!existingTool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    console.log(`AI Iterate | User: ${user.email} | Tool: "${existingTool.name}" | Feedback: "${feedback.substring(0, 60)}..."`);

    // Iterate via OpenRouter
    const chatHistory = toolDoc?.chatHistory || [];
    const result = await iterateToolFromFeedback(existingTool, feedback, chatHistory);

    // Record usage
    user.recordAIRequest();
    await user.save();

    // Update in database
    if (toolDoc) {
      toolDoc.name = result.tool.name;
      toolDoc.description = result.tool.description;
      toolDoc.contentScript = result.tool.contentScript;
      toolDoc.styles = result.tool.styles || '';
      toolDoc.config = result.tool.config || {};
      toolDoc.targetSites = result.tool.targetSites;
      toolDoc.version = result.tool.version || toolDoc.version + 1;
      toolDoc.chatHistory.push(
        { role: 'user', content: feedback },
        { role: 'assistant', content: JSON.stringify(result.tool) }
      );
      await toolDoc.save();
    }

    res.json({
      tool: result.tool,
      usage: {
        requestsUsed: user.aiRequestsUsed,
        requestsLimit: user.aiRequestsLimit
      }
    });

  } catch (err) {
    console.error('AI iteration error:', err);
    res.status(500).json({ error: err.message || 'Failed to iterate tool' });
  }
});

module.exports = router;
