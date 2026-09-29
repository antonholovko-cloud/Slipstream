Host.css(`
.flagw { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:.6rem; padding:.3rem; }
.flagw .flag { flex:none; height:min(80%, 5rem); aspect-ratio: 3 / 2; border-radius:4px; box-shadow:0 2px 10px rgba(0,0,0,.5); position:relative; overflow:hidden; }
.flagw .label { font-weight:700; font-size:1.1rem; white-space:nowrap; line-height:1.1; letter-spacing:.05em; text-transform:uppercase; text-shadow:0 1px 4px #000; }
.flag.checkered { background: repeating-conic-gradient(#111 0 25%, #f5f5f5 0 50%) 0 0 / 25% 33.4%; }
.flag.yellow { background:#facc15; }
.flag.red { background:#dc2626; }
.flag.green { background:#16a34a; }
.flag.blue { background:#2563eb; }
.flag.blue::after { content:''; position:absolute; left:-10%; right:-10%; top:42%; height:16%; background:#facc15; transform:rotate(-28deg); }
.flag.white { background:#f5f5f5; }
.flag.black { background:#111; border:2px solid #555; }
.flag.meatball { background:#111; }
.flag.meatball::after { content:''; position:absolute; width:50%; aspect-ratio:1; left:25%; top:50%; transform:translateY(-50%); border-radius:50%; background:#f97316; }
.flag.debris { background: repeating-linear-gradient(90deg, #facc15 0 16.6%, #dc2626 16.6% 33.3%); }
.flag.caution { background: repeating-linear-gradient(45deg, #facc15 0 12px, #111 12px 24px); }
.flag.onetogreen { background: linear-gradient(90deg, #16a34a 50%, #facc15 50%); }
`);

Host.register('flags', function (root) {
  root.innerHTML = '<div class="flagw"><div class="flag"></div><div class="label"></div></div>';
  const wrap = root.firstChild;
  const flag = wrap.querySelector('.flag');
  const label = wrap.querySelector('.label');
  let greenUntil = 0;
  let prevGreen = false;
  let lastKey = null; // not '' (that is the no-flag key), so the first update always applies

  // Priority order: most important flag wins.
  function pick(f, s) {
    if (f & 0x1) return ['checkered', 'Finish'];
    if (f & 0x10) return ['red', 'Red flag'];
    if (f & 0x20000) return ['black', 'Disqualified'];
    if (f & 0x10000) return ['black', 'Black flag'];
    if (s.showMeatball && (f & 0x100000)) return ['meatball', 'Repair'];
    if (f & (0x4000 | 0x8000)) return ['caution', 'Caution'];
    if (f & 0x40) return ['debris', 'Debris'];
    if (f & (0x8 | 0x100)) return ['yellow', f & 0x100 ? 'Yellow waving' : 'Yellow'];
    if (f & 0x200) return ['onetogreen', 'One to green'];
    if (s.showBlue && (f & 0x20)) return ['blue', 'Blue flag'];
    if (f & 0x2) return ['white', 'Last lap'];
    return null;
  }

  return {
    update(state, ctx) {
      const s = ctx.settings;
      const ses = state.session || {};
      const f = ((ses.flags || 0) | (ses.carFlags || 0)) >>> 0;
      let p = pick(f, s);
      const green = !!(f & (0x4 | 0x400)) && !p;
      const now = performance.now();
      if (green && !prevGreen) greenUntil = now + s.greenSeconds * 1000;
      prevGreen = green;
      if (!p && s.showGreen && green && now < greenUntil) p = ['green', 'Green'];
      if (!p && ctx.editMode) p = ['yellow', 'Preview'];
      const key = p ? p.join('|') + s.showText : '';
      if (key === lastKey) return;
      lastKey = key;
      wrap.style.visibility = p ? 'visible' : 'hidden';
      if (!p) return;
      flag.className = 'flag ' + p[0];
      label.textContent = s.showText ? p[1] : '';
      label.style.display = s.showText ? '' : 'none';
    },
  };
});
