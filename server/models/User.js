// New Order Global — User Model

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    default: ''
  },
  plan: {
    type: String,
    enum: ['free', 'pro', 'unlimited'],
    default: 'free'
  },
  aiRequestsUsed: {
    type: Number,
    default: 0
  },
  aiRequestsLimit: {
    type: Number,
    default: 0  // Free users get 0 AI requests
  },
  aiRequestsResetDate: {
    type: Date,
    default: () => getNextResetDate()
  },
  lemonSqueezyCustomerId: {
    type: String,
    default: null
  },
  lemonSqueezySubscriptionId: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
});

// Reset AI requests monthly
userSchema.methods.checkResetRequests = function () {
  if (new Date() >= this.aiRequestsResetDate) {
    this.aiRequestsUsed = 0;
    this.aiRequestsResetDate = getNextResetDate();
  }
};

// Check if user can make AI requests
userSchema.methods.canMakeAIRequest = function () {
  this.checkResetRequests();

  if (this.plan === 'free') return false;
  if (this.plan === 'unlimited') return true;

  return this.aiRequestsUsed < this.aiRequestsLimit;
};

// Increment AI request count
userSchema.methods.recordAIRequest = function () {
  this.aiRequestsUsed += 1;
};

function getNextResetDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

// Safe user object for API responses (no password hash)
userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    email: this.email,
    displayName: this.displayName,
    plan: this.plan,
    aiRequestsUsed: this.aiRequestsUsed,
    aiRequestsLimit: this.aiRequestsLimit,
    createdAt: this.createdAt,
    lastLogin: this.lastLogin
  };
};

module.exports = mongoose.model('User', userSchema);
