document.addEventListener('DOMContentLoaded', async () => {
  const user = await NewOrderAuth.init();
  if (!user) {
    window.location.href = '../builder/builder.html';
    return;
  }

  try {
    const info = await NewOrderAPI.getCredits();
    
    document.getElementById('credit-balance').textContent = (info.credits || 0).toFixed(2);
    document.getElementById('total-used').textContent = (info.totalUsed || 0).toFixed(2);
    document.getElementById('stat-purchased').textContent = info.totalPurchased || 0;
    document.getElementById('stat-requests').textContent = info.aiRequestsUsed || 0;
    document.getElementById('stat-tools').textContent = info.toolsCreated || 0;

    const container = document.getElementById('packages-container');
    const packages = info.packages || [
      { id: 'starter', credits: 40, price: 4, label: 'Starter' },
      { id: 'popular', credits: 100, price: 8, label: 'Popular', badge: 'Most Popular' },
      { id: 'pro', credits: 200, price: 15, label: 'Pro', badge: 'Best Value' }
    ];

    packages.forEach(pkg => {
      const isPop = pkg.badge ? 'border-color: rgba(124,92,252,0.4); box-shadow: 0 0 10px rgba(124,92,252,0.1);' : '';
      const bgBtn = pkg.badge ? 'background: var(--accent-gradient);' : 'background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);';
      
      const div = document.createElement('div');
      div.className = 'card';
      div.style.cssText = 'position: relative; padding: 20px; ' + isPop;
      
      div.innerHTML = `
        ${pkg.badge ? '<div style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); background:var(--accent-primary); color:white; font-size:10px; padding:2px 8px; border-radius:10px; font-weight:700; text-transform:uppercase;">' + pkg.badge + '</div>' : ''}
        <h4 style="font-weight:700; margin-bottom:12px;">${pkg.label}</h4>
        <div style="font-size: 32px; font-weight: 800; margin-bottom: 4px;">$${pkg.price}</div>
        <div style="color: var(--accent-primary); font-weight: 600; font-size: 14px; margin-bottom: 4px;">${pkg.credits} credits</div>
        <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">$${(pkg.price/pkg.credits).toFixed(3)}/credit</div>
        <button class="btn-primary" style="width: 100%; ${bgBtn}" data-pkg="${pkg.id}">Buy ${pkg.credits} Credits</button>
      `;
      container.appendChild(div);
      
      // Add event listener to the button we just added
      const btn = div.querySelector('button');
      btn.addEventListener('click', () => buyCredits(pkg.id));
    });
  } catch (err) {
    console.error('Failed to load billing info:', err);
  }
});

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
