// Polyfill: Map PizZip to JSZip with generateAsync compatibility for pptxgen
(function () {
  'use strict';
  if (typeof window !== 'undefined' && typeof window.PizZip !== 'undefined') {
    if (!window.PizZip.prototype.generateAsync) {
      window.PizZip.prototype.generateAsync = function (options) {
        return Promise.resolve().then(() => {
          const type = (options && options.type) || 'uint8array';
          return this.generate({ type: type === 'arraybuffer' ? 'uint8array' : type });
        });
      };
    }
    if (typeof window.JSZip === 'undefined') {
      window.JSZip = window.PizZip;
    }
  }
})();
