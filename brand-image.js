(() => {
  'use strict';
  fetch('./assets/sima-brand.webp.b64', { cache: 'force-cache' })
    .then(response => {
      if (!response.ok) throw new Error('Brand image unavailable');
      return response.text();
    })
    .then(encoded => {
      const source = 'data:image/webp;base64,' + encoded.trim();
      document.querySelectorAll('[data-brand-image]').forEach(image => {
        image.src = source;
      });
      ['brandFavicon', 'brandTouchIcon'].forEach(id => {
        const icon = document.getElementById(id);
        if (icon) icon.href = source;
      });
    })
    .catch(() => {});
})();
