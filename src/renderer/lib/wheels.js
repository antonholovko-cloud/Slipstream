/*
 * Steering wheel artwork for the dashboard. Every style draws inside viewBox
 * -50..50 with its moving parts in <g class="rot">, rotated around the center.
 * 'bar' is a horizontal steering bar instead of a wheel.
 */
(function () {
  const defs = `
    <defs>
      <linearGradient id="wRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
      <linearGradient id="wGrip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a4250"/><stop offset=".45" stop-color="#1c212b"/><stop offset="1" stop-color="#0e1117"/></linearGradient>
      <linearGradient id="wHub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a303c"/><stop offset="1" stop-color="#12151c"/></linearGradient>
      <linearGradient id="wLeather" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b7383"/><stop offset=".5" stop-color="#3a414d"/><stop offset="1" stop-color="#20242c"/></linearGradient>
      <linearGradient id="wMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#64748b"/></linearGradient>
      <linearGradient id="wCarbon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b313c"/><stop offset="1" stop-color="#0b0d11"/></linearGradient>
    </defs>`;

  const STYLES = {
    // Simple (default): thin rim, three slim spokes, small hub, only the top stripe in color
    gt: `
      <circle r="40" fill="none" stroke="#5b6270" stroke-width="5"/>
      <path d="M-38.6 -1 C-28 -2 -18 -3 -10 -3 L-10 9 C-18 9 -28 8.5 -38 9.5 Z M38.6 -1 C28 -2 18 -3 10 -3 L10 9 C18 9 28 8.5 38 9.5 Z M-6 12 L6 12 L4.2 38 L-4.2 38 Z" fill="#434955" stroke-linejoin="round"/>
      <rect x="-12" y="-7" width="24" height="20" rx="6" fill="#2a2f38"/>
      <rect x="-2.6" y="-45" width="5.2" height="10" rx="1.3" fill="var(--accent)"/>`,

    // Classic round 3-spoke: leather rim with stitching, brushed spokes
    round: `
      <circle r="41" fill="none" stroke="url(#wLeather)" stroke-width="9"/>
      <circle r="45.5" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1"/>
      <circle r="36.5" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1"/>
      <circle r="41" fill="none" stroke="rgba(255,255,255,.22)" stroke-width=".8" stroke-dasharray="2 2.6"/>
      <path d="M-36 3 C-24 6 -16 8 -11 8 M36 3 C24 6 16 8 11 8 M0 13 L0 36" fill="none" stroke="url(#wMetal)" stroke-width="6.5" stroke-linecap="round"/>
      <circle r="13" fill="url(#wHub)" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
      <circle r="5.5" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <rect x="-3" y="-46" width="6" height="10" rx="1.5" fill="var(--accent)"/>`,

    // Formula-style: carbon body with handles, screen, rev LEDs
    formula: `
      <path d="M-44 -18 C-44 -26 -38 -30 -30 -30 L30 -30 C38 -30 44 -26 44 -18 L44 18 C44 27 38 32 30 32 L18 32 C12 32 10 26 0 26 C-10 26 -12 32 -18 32 L-30 32 C-38 32 -44 27 -44 18 Z"
            fill="url(#wCarbon)" stroke="rgba(255,255,255,.2)" stroke-width="1.2"/>
      <rect x="-47" y="-14" width="12" height="36" rx="6" fill="url(#wGrip)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
      <rect x="35" y="-14" width="12" height="36" rx="6" fill="url(#wGrip)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
      <rect x="-19" y="-18" width="38" height="22" rx="3" fill="#05070a" stroke="rgba(255,255,255,.12)" stroke-width=".8"/>
      <circle cx="-12" cy="-24" r="1.9" fill="#22c55e"/><circle cx="-6" cy="-24" r="1.9" fill="#22c55e"/><circle cx="0" cy="-24" r="1.9" fill="#facc15"/>
      <circle cx="6" cy="-24" r="1.9" fill="#ef4444"/><circle cx="12" cy="-24" r="1.9" fill="#3b82f6"/>
      <path d="M-11 -7 H11" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="-25" cy="12" r="3" fill="#ef4444"/><circle cx="25" cy="12" r="3" fill="#3b82f6"/>
      <circle cx="-15" cy="16" r="2.4" fill="#facc15"/><circle cx="15" cy="16" r="2.4" fill="#22c55e"/>
      <rect x="-3" y="-35" width="6" height="7" rx="1.5" fill="var(--accent)"/>`,

    // Logitech RS50-style track wheel: D-shaped rim (round top, flat bottom), black grips,
    // brushed spokes, and a plain hub. Artwork only, no branding.
    rs50: `
      <path d="M-39 16 A42 42 0 1 1 39 16 L30 33 C18 37 -18 37 -30 33 Z" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="10" stroke-linejoin="round"/>
      <path d="M-39 16 A42 42 0 1 1 39 16 L30 33 C18 37 -18 37 -30 33 Z" fill="none" stroke="#2c323c" stroke-width="8" stroke-linejoin="round"/>
      <path d="M-41.5 -14 A42 42 0 0 0 -39 16 M41.5 -14 A42 42 0 0 1 39 16" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="13.5" stroke-linecap="round"/>
      <path d="M-41.5 -14 A42 42 0 0 0 -39 16 M41.5 -14 A42 42 0 0 1 39 16" fill="none" stroke="#3a414d" stroke-width="12" stroke-linecap="round"/>
      <path d="M-38 -2 L-20 -5 L-20 8 L-36 10 Z M38 -2 L20 -5 L20 8 L36 10 Z M-7 14 L7 14 L9 32 L-9 32 Z" fill="url(#wMetal)" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>
      <rect x="-20" y="-12" width="40" height="26" rx="9" fill="url(#wHub)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
      <circle cx="0" cy="1" r="4.5" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <rect x="-3" y="-47" width="6" height="9" rx="1.5" fill="var(--accent)"/>`,

    // Minimal ring with a center-top marker
    ring: `
      <circle r="40" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="4.5"/>
      <circle r="4" fill="rgba(255,255,255,.85)"/>
      <path d="M-38 0 H-8 M8 0 H38" stroke="rgba(255,255,255,.35)" stroke-width="2.5" stroke-linecap="round"/>
      <circle cy="-40" r="6" fill="var(--accent)" stroke="#fff" stroke-width="1.5"/>`,
  };

  function svg(style) {
    if (style === 'bar') {
      return `<svg viewBox="-50 -12 100 24" class="steerbar">
        <rect x="-48" y="-4" width="96" height="8" rx="4" fill="rgba(255,255,255,.08)"/>
        <rect class="fill" x="0" y="-4" width="0" height="8" rx="4" fill="var(--accent)"/>
        <path d="M0 -8 V8" stroke="rgba(255,255,255,.6)" stroke-width="1.2"/>
        <circle class="knob" cx="0" cy="0" r="5.5" fill="#fff" stroke="var(--accent)" stroke-width="2"/>
      </svg>`;
    }
    return `<svg viewBox="-50 -50 100 100">${defs}<g class="rot">${STYLES[style] || STYLES.gt}</g></svg>`;
  }

  window.Wheels = { svg, styles: ['gt', 'rs50', 'round', 'formula', 'ring', 'bar'] };
})();
