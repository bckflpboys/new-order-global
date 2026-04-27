// Plan display names
const PLAN_LABELS = {
  monthly: 'Monthly Recurring',
  yearly: 'Yearly Archive',
  super_agent: 'Super Agent'
};

// Tab switching
function switchTab(tab) {
  document.getElementById('tab-purchase').classList.remove('active');
  document.getElementById('tab-history').classList.remove('active');
  document.getElementById(`tab-${tab}`).classList.add('active');

  document.getElementById('content-purchase').style.display = tab === 'purchase' ? 'block' : 'none';
  document.getElementById('content-history').style.display = tab === 'history' ? 'block' : 'none';

  if (tab === 'history') loadPurchaseHistory();
}

// Show active subscription banner
function showSubscriptionBanner(subscription) {
  if (!subscription || subscription.status === 'none' || subscription.plan === 'none') return;

  const banner = document.getElementById('active-sub-banner');
  const nameEl = document.getElementById('active-sub-name');
  const detailEl = document.getElementById('active-sub-detail');

  nameEl.textContent = PLAN_LABELS[subscription.plan] || subscription.plan;

  let detail = '';
  if (subscription.cancelAtPeriodEnd) {
    detail = subscription.currentPeriodEnd
      ? `Cancels on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
      : 'Cancelling at end of period';
    banner.style.background = 'rgba(138, 109, 0, 0.08)';
    banner.style.borderColor = 'rgba(138, 109, 0, 0.25)';
    nameEl.parentElement.querySelector('p:first-child').style.color = 'var(--warning)';
    nameEl.parentElement.querySelector('p:first-child').textContent = 'Cancelling';
    document.getElementById('cancel-sub-btn').style.display = 'none';
  } else if (subscription.status === 'active') {
    detail = subscription.currentPeriodEnd
      ? `Renews on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
      : 'Active';
  } else if (subscription.status === 'past_due') {
    detail = 'Payment past due — please update your payment method';
    banner.style.background = 'rgba(186, 26, 26, 0.08)';
    banner.style.borderColor = 'rgba(186, 26, 26, 0.25)';
  }

  detailEl.textContent = detail;
  banner.style.display = 'block';

  // Disable subscribe buttons for active users
  document.querySelectorAll('.sub-btn').forEach(btn => {
    if (subscription.status === 'active') {
      btn.disabled = true;
      btn.textContent = subscription.plan === btn.dataset.plan ? 'Current Plan' : 'Subscribed';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  });

  // Highlight current plan card
  const currentCard = document.querySelector(`.subscription-card[data-plan="${subscription.plan}"]`);
  if (currentCard) {
    currentCard.style.border = '2px solid var(--success)';
  }
}

// Subscribe to a plan
async function subscribeToPlan(planId) {
  try {
    const btn = document.querySelector(`.sub-btn[data-plan="${planId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

    const data = await NewOrderAPI.createSubscription(planId);
    if (data && data.checkoutUrl) {
      window.open(data.checkoutUrl, '_blank');
    } else {
      alert('Failed to start subscription checkout.');
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
  } catch (err) {
    alert('Error: ' + (err.message || 'Failed to subscribe'));
    const btn = document.querySelector(`.sub-btn[data-plan="${planId}"]`);
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
  }
}

// Cancel subscription
async function cancelSubscription() {
  if (!confirm('Are you sure you want to cancel your subscription? You will keep access until the end of your billing period.')) return;

  const btn = document.getElementById('cancel-sub-btn');
  btn.disabled = true;
  btn.textContent = 'Cancelling...';

  try {
    const data = await NewOrderAPI.cancelSubscription();
    alert(data.message || 'Subscription cancelled.');
    window.location.reload();
  } catch (err) {
    alert('Error: ' + (err.message || 'Failed to cancel'));
    btn.disabled = false;
    btn.textContent = 'Cancel Subscription';
  }
}

// Buy one-time credits
async function buyCredits(pkgId) {
  try {
    const data = await NewOrderAPI.createCheckout(pkgId);
    if (data && data.checkoutUrl) {
      window.open(data.checkoutUrl, '_blank');
    } else {
      alert('Failed to start checkout process.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Load purchase history
async function loadPurchaseHistory() {
  try {
    const data = await NewOrderAPI.getPurchases();
    const purchases = data.purchases || [];
    const container = document.getElementById('purchases-container');

    if (purchases.length === 0) {
      container.innerHTML = `
        <div style="padding: 48px; text-align: center;">
          <div style="width: 64px; height: 64px; border-radius: var(--radius-full); background: var(--surface-container-highest); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--on-surface-variant);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <h4 style="font-family: var(--font-headline); font-size: 18px; font-weight: 600; color: var(--on-surface); margin-bottom: 8px;">No purchases yet</h4>
          <p style="font-family: var(--font-body); font-size: 14px; color: var(--on-surface-variant);">Your purchase history will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = purchases.map(purchase => {
      const statusClass = purchase.status === 'completed' ? 'completed' : purchase.status === 'pending' ? 'pending' : 'failed';
      const typeLabels = { 'one-time': 'One-time', 'monthly': 'Monthly', 'yearly': 'Yearly', 'subscription': 'Subscription' };

      return `
        <div class="purchase-row">
          <div style="display: flex; align-items: center; gap: 24px;">
            <div style="width: 48px; height: 48px; border-radius: var(--radius-full); background: var(--surface-container-highest); display: flex; align-items: center; justify-content: center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--on-surface-variant);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                <span style="font-family: var(--font-headline); font-size: 16px; font-weight: 600; color: var(--on-surface);">${typeLabels[purchase.type] || purchase.type} Purchase</span>
                <span class="purchase-status ${statusClass}">${purchase.status}</span>
              </div>
              <p style="font-family: var(--font-body); font-size: 14px; color: var(--on-surface-variant);">${new Date(purchase.date).toLocaleDateString()}</p>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 24px;">
            <div style="text-align: right;">
              <div style="font-family: var(--font-headline); font-size: 18px; font-weight: 600; color: var(--on-surface);">$${purchase.amount.toFixed(2)}</div>
              <div style="font-family: var(--font-label); font-size: 11px; color: var(--on-surface-variant);">${purchase.credits} credits</div>
            </div>
            ${purchase.receiptUrl ? `
              <a href="${purchase.receiptUrl}" target="_blank" rel="noopener noreferrer" style="font-family: var(--font-label); font-size: 13px; color: var(--primary); text-decoration: none; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Receipt
              </a>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load purchase history:', err);
  }
}

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  const user = await NewOrderAuth.init();
  if (!user) {
    window.location.href = '../builder/builder.html';
    return;
  }

  // Tab buttons
  document.getElementById('tab-purchase').addEventListener('click', () => switchTab('purchase'));
  document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));

  // Subscribe buttons
  document.querySelectorAll('.sub-btn').forEach(btn => {
    btn.addEventListener('click', () => subscribeToPlan(btn.dataset.plan));
  });

  // Cancel subscription button
  document.getElementById('cancel-sub-btn').addEventListener('click', cancelSubscription);

  try {
    const info = await NewOrderAPI.getCredits();

    // Update balance & stats
    document.getElementById('credit-balance').textContent = (info.credits || 0).toFixed(2);
    document.getElementById('total-used').textContent = (info.totalUsed || 0).toFixed(2);
    document.getElementById('stat-purchased').textContent = info.totalPurchased || 0;
    document.getElementById('stat-used').textContent = (info.totalUsed || 0).toFixed(2);
    document.getElementById('stat-requests').textContent = info.aiRequestsUsed || 0;
    document.getElementById('stat-tools').textContent = info.toolsCreated || 0;

    // Show active subscription banner if applicable
    if (info.subscription) {
      showSubscriptionBanner(info.subscription);
    }

    // Render one-time credit packages
    const container = document.getElementById('packages-container');
    const packages = info.packages || [
      { id: 'starter', credits: 40, price: 4, label: 'Starter' },
      { id: 'popular', credits: 100, price: 8, label: 'Popular', badge: 'Most Popular' },
      { id: 'pro', credits: 200, price: 15, label: 'Pro', badge: 'Best Value' }
    ];

    packages.forEach(pkg => {
      const hasBadge = pkg.badge ? 'border: 1px solid rgba(184, 52, 28, 0.3); background: var(--surface-dim);' : '';
      const btnStyle = pkg.badge ? 'background: var(--accent-gradient); color: var(--on-primary);' : 'background: var(--surface-container-high); color: var(--primary); border: 1px solid var(--ghost-border);';

      const div = document.createElement('div');
      div.className = 'card';
      div.style.cssText = 'position: relative; padding: 24px; ' + hasBadge;

      div.innerHTML = `
        ${pkg.badge ? `<div style="position:absolute; top:-12px; left:50%; transform:translateX(-50%); padding: 4px 16px; border-radius: var(--radius-full); background: var(--tertiary); color: var(--on-tertiary); font-family: var(--font-label); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">${pkg.badge}</div>` : ''}
        <div style="padding-top: 8px; margin-bottom: 20px;">
          <h4 style="font-family: var(--font-headline); font-size: 20px; font-weight: 600; color: var(--on-surface); margin-bottom: 8px;">${pkg.label}</h4>
          <div style="display: flex; align-items: baseline; gap: 4px; margin-bottom: 8px;">
            <span style="font-family: var(--font-headline); font-size: 36px; font-weight: 600; color: var(--primary);">$${pkg.price}</span>
          </div>
          <div style="font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--primary); margin-bottom: 8px;">${pkg.credits} credits</div>
          <div style="font-family: var(--font-label); font-size: 11px; color: var(--on-surface-muted);">$${(pkg.price/pkg.credits).toFixed(3)}/credit</div>
        </div>
        <button class="btn-primary" style="width: 100%; ${btnStyle}" data-pkg="${pkg.id}">Buy ${pkg.credits} Credits</button>
      `;
      container.appendChild(div);

      const btn = div.querySelector('button');
      btn.addEventListener('click', () => buyCredits(pkg.id));
    });

    // Load purchase history
    loadPurchaseHistory();
  } catch (err) {
    console.error('Failed to load billing info:', err);
  }
});
