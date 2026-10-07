// core/voxcode-main-beacon.js
// Runs in the MAIN page world on VoxCode web application domains at document_start.
// Guarantees window.__NOG_EXTENSION_INSTALLED__ and window.__NOG_EXTENSION_VERSION__
// are defined synchronously in the page's execution context before React/Next.js mounts,
// completely bypassing page Content Security Policy (CSP) restrictions.

(function () {
    'use strict';

    const EXTENSION_VERSION = '1.0.0';

    try {
        window.__NOG_EXTENSION_INSTALLED__ = true;
        window.__NOG_EXTENSION_VERSION__ = EXTENSION_VERSION;

        if (document.documentElement) {
            document.documentElement.setAttribute('data-nog-extension-installed', 'true');
            document.documentElement.setAttribute('data-nog-extension-version', EXTENSION_VERSION);
        }

        const readyEvent = new CustomEvent('NOG_EXTENSION_READY', {
            detail: {
                version: EXTENSION_VERSION,
                installed: true,
                timestamp: Date.now()
            }
        });

        window.dispatchEvent(readyEvent);
        if (typeof document !== 'undefined') {
            document.dispatchEvent(readyEvent);
        }
    } catch (e) {
        // Suppress any non-fatal context errors
    }
})();
