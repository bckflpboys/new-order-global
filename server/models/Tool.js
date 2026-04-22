// New Order Global — Tool Model

const mongoose = require('mongoose');

const toolSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: '🔧'
  },
  targetSites: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'archived'],
    default: 'active'
  },
  contentScript: {
    type: String,
    default: ''
  },
  styles: {
    type: String,
    default: ''
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  storageSchema: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // The original prompt the user gave
  originalPrompt: {
    type: String,
    default: ''
  },
  // Conversation history for iterations
  chatHistory: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  version: {
    type: Number,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamps
toolSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for efficient querying
toolSchema.index({ userId: 1, status: 1 });
toolSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Tool', toolSchema);
