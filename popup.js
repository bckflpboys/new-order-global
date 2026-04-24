document.addEventListener('DOMContentLoaded', () => {
    // --- Vertical Slider (Notifications) ---
    const verticalSlider = document.getElementById('vertical-slider');
    const btnNotifications = document.getElementById('btn-notifications');
    const btnCloseNotifications = document.getElementById('btn-close-notifications');
    const notificationDot = document.getElementById('dot');

    btnNotifications.addEventListener('click', () => {
        verticalSlider.style.transform = 'translateY(0)';
        if (notificationDot) notificationDot.style.display = 'none';
    });

    btnCloseNotifications.addEventListener('click', () => {
        verticalSlider.style.transform = 'translateY(-50%)';
    });

    // --- Horizontal Slider (Main Content) ---
    const horizontalSlider = document.getElementById('horizontal-slider');
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    let hPos = 1; // 0=History, 1=Main, 2=Settings

    function updateH() {
        horizontalSlider.style.transform = `translateX(${hPos * -33.333}%)`;
        btnLeft.innerHTML = hPos === 0 ? '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>';
        btnRight.innerHTML = hPos === 2 ? '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';
    }

    btnLeft.addEventListener('click', () => { hPos = hPos === 0 ? 1 : 0; updateH(); });
    btnRight.addEventListener('click', () => { hPos = hPos === 2 ? 1 : 2; updateH(); });

    // --- Navigation ---
    const open = (u) => chrome.tabs.create({ url: chrome.runtime.getURL(u) });
    document.getElementById('btn-create').onclick = () => open('builder/builder.html');
    document.getElementById('btn-tools').onclick = () => open('dashboard/tools.html');
    document.getElementById('btn-account').onclick = () => open('dashboard/billing.html');
    document.getElementById('btn-settings').onclick = () => open('dashboard/settings.html');
    document.getElementById('btn-yt-settings').onclick = () => chrome.runtime.openOptionsPage();

    // --- Load Tools ---
    (async () => {
        const cont = document.getElementById('tools-container');
        try {
            const tools = await ToolManager.getTools();
            if (!tools?.length) { cont.innerHTML = 'No tools found.'; return; }
            cont.innerHTML = '';
            tools.forEach(t => {
                const div = document.createElement('div');
                div.className = 'tool-card';
                div.onclick = (e) => { if (e.target.tagName !== 'INPUT' && !e.target.className.includes('slider')) open(`dashboard/tool-detail.html?id=${t.id}`); };
                div.innerHTML = `<div><div class="tool-name">${t.name || 'Untitled'}</div><div class="tool-desc">${t.description || 'No desc'}</div></div>
                    <label class="toggle-switch"><input type="checkbox" ${t.isActive !== false ? 'checked' : ''}><span class="slider"></span></label>`;
                div.querySelector('input').onchange = (e) => e.target.checked ? ToolManager.activateTool(t.id) : ToolManager.deactivateTool(t.id);
                cont.appendChild(div);
            });
        } catch (e) { cont.innerHTML = 'Error loading tools.'; }
    })();

    // --- YT Status ---
    (async () => {
        if (!(await chrome.permissions.contains({ origins: ['https://www.youtube.com/*'] }))) {
            try { await chrome.permissions.request({ origins: ['https://www.youtube.com/*'] }); } catch (e) { }
        }
    })();
});
