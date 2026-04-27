// Global functions for tab switching
function switchTab(tab) {
  // Update tab buttons
  document.getElementById('tab-purchase').classList.remove('active');
  document.getElementById('tab-history').classList.remove('active');
  document.getElementById(`tab-${tab}`).classList.add('active');

  // Update content
  document.getElementById('content-purchase').style.display = tab === 'purchase' ? 'block' : 'none';
  document.getElementById('content-history').style.display = tab === 'history' ? 'block' : 'none';

  // Load purchase history when switching to history tab
  if (tab === 'history') {
    loadPurchaseHistory();
  }
}

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
      const typeLabels = {
        'one-time': 'One-time',
        'monthly': 'Monthly',
        'yearly': 'Yearly'
      };

      return `
        <div class="purchase-row">
          <div style="display: flex; align-items: center; gap: 24px;">
            <div style="width: 48px; height: 48px; border-radius: var(--radius-full); background: var(--surface-container-highest); display: flex; align-items: center; justify-content: center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--on-surface-variant);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                <span style="font-family: var(--font-headline); font-size: 16px; font-weight: 600; color: var(--on-surface);">${typeLabels[purchase.type]} Purchase</span>
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

document.addEventListener('DOMContentLoaded', async () => {
  const user = await NewOrderAuth.init();
  if (!user) {
    window.location.href = '../builder/builder.html';
    return;
  }

  // Add tab button event listeners
  document.getElementById('tab-purchase').addEventListener('click', () => switchTab('purchase'));
  document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));

  try {
    const info = await NewOrderAPI.getCredits();
    
    document.getElementById('credit-balance').textContent = (info.credits || 0).toFixed(2);
    document.getElementById('total-used').textContent = (info.totalUsed || 0).toFixed(2);
    document.getElementById('stat-purchased').textContent = info.totalPurchased || 0;
    document.getElementById('stat-used').textContent = (info.totalUsed || 0).toFixed(2);
    document.getElementById('stat-requests').textContent = info.aiRequestsUsed || 0;
    document.getElementById('stat-tools').textContent = info.toolsCreated || 0;

    // Render purchase credits packages
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
      
      // Add event listener to the button we just added
      const btn = div.querySelector('button');
      btn.addEventListener('click', () => buyCredits(pkg.id));
    });

    // Load purchase history
    loadPurchaseHistory();
  } catch (err) {
    console.error('Failed to load billing info:', err);
  }
});
