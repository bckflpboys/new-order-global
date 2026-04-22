// New Order Global — API Server Entry Point
// Express server with MongoDB, JWT auth, OpenRouter AI proxy

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const toolsRoutes = require('./routes/tools');
const billingRoutes = require('./routes/billing');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// Middleware
// ============================================
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://neworderglobal.com',
    'chrome-extension://*',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ============================================
// Routes
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/billing', billingRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'New Order Global API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// Database & Server Start
// ============================================
async function start() {
  try {
    // Connect to MongoDB
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Connected to MongoDB');
    } else {
      console.warn('⚠️  MONGODB_URI not set — running without database');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`\n🚀 New Order Global API running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   AI Model: ${process.env.OPENROUTER_MODEL || 'not configured'}`);
      console.log(`   MongoDB: ${process.env.MONGODB_URI ? 'connected' : 'not configured'}\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
