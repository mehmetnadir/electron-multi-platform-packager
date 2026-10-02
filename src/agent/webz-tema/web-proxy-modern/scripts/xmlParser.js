// Web-proxy XML parser — BookContent.xml'den üniteleri çıkarır
// Worker veya yayıncı origin'inden /Uploads/WebDijitapDosyalar/{assetId}/data/BookContent.xml çeker
window.xmlParser = (() => {
  const cache = new Map();

  async function parseBookContent(assetId) {
    if (cache.has(assetId)) return cache.get(assetId);
    const url = `/Uploads/WebDijitapDosyalar/${assetId}/data/BookContent.xml`;
    let units = [];
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      // Yaygın iki format: <Unit page="1">Unit 1</Unit>  veya  <Chapter page="1" title="..."/>
      const nodes = [...doc.querySelectorAll('Unit, Chapter, chapter, unit')];
      units = nodes.map((n, i) => ({
        num: i + 1,
        label: n.getAttribute('title') || n.getAttribute('name') || n.textContent.trim() || `Ünite ${i + 1}`,
        page: parseInt(n.getAttribute('page') || '0', 10) || null,
      }));
    } catch (e) {
      console.warn('[xmlParser]', assetId, e.message);
      // Origin erişilemezse örnek üniteler dön
      units = Array.from({ length: 8 }, (_, i) => ({
        num: i + 1,
        label: `Unit ${i + 1} — Örnek`,
        page: i * 12 + 1,
      }));
    }
    cache.set(assetId, units);
    return units;
  }

  return { parseBookContent };
})();
