'use strict';
/* ProGramerly - the Ionity icon set
   Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

   Drawn for this product, not borrowed: every icon is three layers on a 32 x 32
   grid - a body (b) filled with the Ionity blue -> cyan gradient, a line layer
   (l) in the bright edge colour, and one accent (a) in Ionity orange - so on
   hover the body can lift, the line can glow and the accent can light, each
   on its own. The gradients live once in the document (PGIcons.defs()).

   Shared by the app (tiles, dock, window heads) and the download page. */

(function (root) {
  const ICONS = {
    dome: '<path class="b" d="M4 24a12 12 0 0 1 24 0z"/><path class="l" d="M4 24a12 12 0 0 1 24 0M8.5 24a7.5 7.5 0 0 1 15 0M12.6 24a3.4 3.4 0 0 1 6.8 0M2 24h28M16 12V8"/><circle class="a" cx="16" cy="7" r="1.9"/>',
    relations: '<circle class="b" cx="16" cy="16" r="6"/><path class="l" d="M16 16 6 7M16 16l10-9M16 16 6 25M16 16l10 9"/><circle class="l" cx="6" cy="7" r="2.6"/><circle class="l" cx="26" cy="7" r="2.6"/><circle class="l" cx="6" cy="25" r="2.6"/><circle class="l" cx="26" cy="25" r="2.6"/><circle class="a" cx="16" cy="16" r="2.8"/>',
    ai: '<rect class="b" x="5" y="5" width="22" height="22" rx="6"/><path class="l" d="M16 9.5l1.9 4.6 4.6 1.9-4.6 1.9L16 22.5l-1.9-4.6L9.5 16l4.6-1.9z"/><path class="l" d="M5 11H2.5M5 21H2.5M27 11h2.5M27 21h2.5M11 5V2.5M21 5V2.5M11 27v2.5M21 27v2.5"/><circle class="a" cx="23" cy="9" r="1.7"/>',
    predict: '<path class="b" d="M16 3l11 6.4v13.2L16 29 5 22.6V9.4z"/><path class="l" d="M16 3l11 6.4v13.2L16 29 5 22.6V9.4zM9.5 20.5l4-4.5 3 2.6 6-6.6"/><path class="l" d="M19.5 12h3v3"/><circle class="a" cx="22.5" cy="12" r="1.8"/>',
    envs: '<path class="b" d="M16 4l11 6v12l-11 6-11-6V10z"/><path class="l" d="M16 4l11 6v12l-11 6-11-6V10zM5 10l11 6 11-6M16 16v12"/><path class="a" d="M16 4l11 6-11 6-11-6z"/>',
    system: '<rect class="b" x="3" y="5" width="26" height="17" rx="3"/><path class="l" d="M3 8a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 27h10M16 22v5M8 11h7M8 15h11"/><circle class="a" cx="23.5" cy="11" r="1.8"/>',
    software: '<path class="b" d="M5 11l11-6 11 6v11l-11 6-11-6z"/><path class="l" d="M5 11l11-6 11 6v11l-11 6-11-6zM5 11l11 6 11-6M16 17v11"/><path class="l" d="M10.5 8l11 6"/><path class="a" d="M23 2.5v6M20 5.5h6"/>',
    reading: '<path class="b" d="M2.5 16S7.5 7 16 7s13.5 9 13.5 9-5 9-13.5 9S2.5 16 2.5 16z"/><path class="l" d="M2.5 16S7.5 7 16 7s13.5 9 13.5 9-5 9-13.5 9S2.5 16 2.5 16z"/><circle class="l" cx="16" cy="16" r="4.6"/><circle class="a" cx="16" cy="16" r="2"/><path class="l" d="M3 4h5M3 28h5M24 4h5M24 28h5"/>',
    projects: '<circle class="b" cx="9" cy="24" r="5"/><path class="l" d="M9 5v14M23 13a10 10 0 0 1-10 10"/><circle class="l" cx="9" cy="24" r="4"/><circle class="l" cx="9" cy="6" r="2.6"/><circle class="a" cx="23" cy="10" r="3.2"/>',
    fans: '<circle class="b" cx="16" cy="16" r="13"/><path class="l" d="M16 13.5c0-5 2.4-9 6-9 1.8 0 2.4 1.8 1.2 3.6-1.5 2.2-4.2 3.8-7.2 5.4zM18.5 16c5 0 9 2.4 9 6 0 1.8-1.8 2.4-3.6 1.2-2.2-1.5-3.8-4.2-5.4-7.2zM16 18.5c0 5-2.4 9-6 9-1.8 0-2.4-1.8-1.2-3.6 1.5-2.2 4.2-3.8 7.2-5.4zM13.5 16c-5 0-9-2.4-9-6 0-1.8 1.8-2.4 3.6-1.2 2.2 1.5 3.8 4.2 5.4 7.2z"/><circle class="a" cx="16" cy="16" r="2.2"/>',
    cic: '<circle class="b" cx="16" cy="16" r="12"/><circle class="l" cx="16" cy="16" r="12"/><circle class="l" cx="16" cy="16" r="5"/><path class="l" d="M16 2v7M16 23v7M2 16h7M23 16h7"/><circle class="a" cx="16" cy="16" r="1.9"/>',
    monitor: '<rect class="b" x="2.5" y="5" width="27" height="22" rx="4"/><path class="l" d="M2.5 16h5l3-7 5 14 3.5-9 2 4h8.5"/><rect class="l" x="2.5" y="5" width="27" height="22" rx="4"/><circle class="a" cx="24" cy="10" r="1.6"/>',
    network: '<circle class="b" cx="16" cy="16" r="12.5"/><path class="l" d="M3.5 16h25M16 3.5c3.6 3.3 5.4 7.5 5.4 12.5S19.6 25.2 16 28.5M16 3.5c-3.6 3.3-5.4 7.5-5.4 12.5s1.8 9.2 5.4 12.5"/><circle class="l" cx="16" cy="16" r="12.5"/><circle class="a" cx="25" cy="7" r="2.2"/>',
    hardware: '<rect class="b" x="7" y="7" width="18" height="18" rx="3"/><rect class="l" x="7" y="7" width="18" height="18" rx="3"/><path class="l" d="M12 2.5V7M16 2.5V7M20 2.5V7M12 25v4.5M16 25v4.5M20 25v4.5M2.5 12H7M2.5 16H7M2.5 20H7M25 12h4.5M25 16h4.5M25 20h4.5"/><rect class="a" x="12" y="12" width="8" height="8" rx="1.6"/>',
    doctor: '<path class="b" d="M16 28S5 21.6 5 13a6.2 6.2 0 0 1 11-3.9A6.2 6.2 0 0 1 27 13c0 8.6-11 15-11 15z"/><path class="l" d="M16 28S5 21.6 5 13a6.2 6.2 0 0 1 11-3.9A6.2 6.2 0 0 1 27 13c0 8.6-11 15-11 15z"/><path class="a" d="M8 16h4l2-4 3 7 2-3h5"/>',
    terminals: '<rect class="b" x="3" y="5" width="26" height="22" rx="4"/><rect class="l" x="3" y="5" width="26" height="22" rx="4"/><path class="l" d="M3 10h26M9 15l4 3-4 3"/><path class="a" d="M16 22h7"/><circle class="l" cx="7" cy="7.6" r=".6"/><circle class="l" cx="9.6" cy="7.6" r=".6"/>',
    maintenance: '<path class="b" d="M19.5 7.5a6 6 0 0 0 7 7l-12.6 12.6a3 3 0 0 1-4.2-4.2z"/><path class="l" d="M19.5 7.5a6 6 0 0 0 7 7l-12.6 12.6a3 3 0 0 1-4.2-4.2zM20.5 3.5a8 8 0 0 1 8 8"/><circle class="a" cx="11.5" cy="24.6" r="1.6"/>',
    updates: '<circle class="b" cx="16" cy="16" r="11"/><path class="l" d="M27 16A11 11 0 1 1 23.6 8M27 4v6.5h-6.5"/><path class="a" d="M16 10.5v6l3.6 2.2"/>',
    settings: '<circle class="b" cx="16" cy="16" r="10"/><path class="l" d="M16 3v3.2M16 25.8V29M3 16h3.2M25.8 16H29M6.8 6.8l2.3 2.3M22.9 22.9l2.3 2.3M6.8 25.2l2.3-2.3M22.9 9.1l2.3-2.3"/><circle class="l" cx="16" cy="16" r="7.6"/><circle class="a" cx="16" cy="16" r="3.2"/>',
    about: '<circle class="b" cx="16" cy="16" r="12.5"/><circle class="l" cx="16" cy="16" r="12.5"/><path class="l" d="M16 14.5v8"/><circle class="a" cx="16" cy="10" r="1.9"/>',
    mcp: '<path class="b" d="M16 3l11 4v8.5c0 6.5-4.6 11.6-11 13.5-6.4-1.9-11-7-11-13.5V7z"/><path class="l" d="M16 3l11 4v8.5c0 6.5-4.6 11.6-11 13.5-6.4-1.9-11-7-11-13.5V7z"/><path class="a" d="M11 16l3.4 3.4L21.5 12"/>',
    // download page extras
    catalogue: '<rect class="b" x="4" y="4" width="10" height="10" rx="2.5"/><rect class="b" x="18" y="18" width="10" height="10" rx="2.5"/><path class="l" d="M6.5 4h5A2.5 2.5 0 0 1 14 6.5v5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 4 11.5v-5A2.5 2.5 0 0 1 6.5 4zM20.5 4h5A2.5 2.5 0 0 1 28 6.5v5a2.5 2.5 0 0 1-2.5 2.5h-5a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 20.5 4zM6.5 18h5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 4 25.5v-5A2.5 2.5 0 0 1 6.5 18z"/><path class="a" d="M23 19.5v7M19.5 23h7"/>',
    shield: '<path class="b" d="M16 3l11 4v8.5c0 6.5-4.6 11.6-11 13.5-6.4-1.9-11-7-11-13.5V7z"/><path class="l" d="M16 3l11 4v8.5c0 6.5-4.6 11.6-11 13.5-6.4-1.9-11-7-11-13.5V7z"/><rect class="a" x="12" y="14" width="8" height="7" rx="1.5"/><path class="l" d="M13.5 14v-2a2.5 2.5 0 0 1 5 0v2"/>',
    ocr: '<rect class="b" x="6" y="3" width="20" height="26" rx="3"/><path class="l" d="M9 3h14a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM10 10h12M10 14h12M10 18h7"/><path class="a" d="M2.5 22h27"/>',
    chat: '<path class="b" d="M28 15a11 11 0 0 1-16 9.8L4 27l2.2-7.3A11 11 0 1 1 28 15z"/><path class="l" d="M28 15a11 11 0 0 1-16 9.8L4 27l2.2-7.3A11 11 0 1 1 28 15z"/><circle class="a" cx="11.5" cy="15" r="1.6"/><circle class="a" cx="17" cy="15" r="1.6"/><circle class="a" cx="22.5" cy="15" r="1.6"/>',
    cloud: '<path class="b" d="M9 25a6.5 6.5 0 0 1-1-12.9A9 9 0 0 1 25.4 12 6.5 6.5 0 0 1 24 25z"/><path class="l" d="M9 25a6.5 6.5 0 0 1-1-12.9A9 9 0 0 1 25.4 12 6.5 6.5 0 0 1 24 25z"/><path class="a" d="M16 22v-8M12.8 17.2 16 14l3.2 3.2"/>',
    learn: '<rect class="b" x="3" y="4" width="26" height="24" rx="4"/><path class="l" d="M7 22l6-7 4 4 8-9"/><path class="l" d="M20.5 10H25v4.5"/><rect class="l" x="3" y="4" width="26" height="24" rx="4"/><circle class="a" cx="13" cy="15" r="1.8"/>',
    verified: '<circle class="b" cx="16" cy="16" r="12.5"/><path class="l" d="M16 3.5l2.6 2.2 3.4-.4 1.2 3.2 3.1 1.5-.6 3.4 1.8 2.9-2.3 2.6.1 3.4-3.3.9-1.6 3-3.3-1.1-3 1.6-2.1-2.7-3.4-.4-.3-3.4-2.7-2.1 1.5-3.1-.9-3.3 3-1.6 1-3.3 3.4.2z"/><path class="a" d="M11 16.5l3.4 3.4L21.5 12.6"/>',
    launch: '<path class="b" d="M8 18c2-8 7-13 16-14-1 9-6 14-14 16z"/><path class="l" d="M8 18c2-8 7-13 16-14-1 9-6 14-14 16zM8 18l-4 1 3-5M10 20l-1 4 5-3"/><circle class="a" cx="18" cy="11" r="2.4"/>',
  };

  /* Gradients and a soft glow filter, once per document. */
  function defs() {
    return '<svg class="pgi-defs" width="0" height="0" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '<linearGradient id="pgi-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f7ff0"/><stop offset=".55" stop-color="#00c8f0"/><stop offset="1" stop-color="#14e0b0"/></linearGradient>'
      + '<linearGradient id="pgi-line" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fd8ff"/><stop offset="1" stop-color="#e8fbff"/></linearGradient>'
      + '<linearGradient id="pgi-accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb04a"/><stop offset="1" stop-color="#ff7a00"/></linearGradient>'
      + '</defs></svg>';
  }
  function ensureDefs(doc = root.document) {
    if (!doc || doc.querySelector('svg.pgi-defs')) return;
    const holder = doc.createElement('div');
    holder.innerHTML = defs();
    const svg = holder.firstChild;
    doc.body.prepend(svg);
  }
  function svg(id, cls = '') {
    const body = ICONS[id] || ICONS.about;
    return `<svg class="pgi ${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false" data-icon="${id}">${body}</svg>`;
  }

  root.PGIcons = { svg, ensureDefs, defs, ids: Object.keys(ICONS) };
}(typeof window !== 'undefined' ? window : globalThis));
