Host.css(`
.delta { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:.3rem .5rem; gap:.25rem; }
.delta .bar { position:relative; height:1.1rem; background:rgba(255,255,255,.07); border-radius:3px; overflow:hidden; }
.delta .bar i { position:absolute; top:0; bottom:0; border-radius:2px; transition: background .2s; }
.delta .bar::after { content:''; position:absolute; left:50%; top:-2px; bottom:-2px; width:2px; margin-left:-1px; background:var(--text); opacity:.8; }
.delta .row { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; }
.delta .val { font-size:1.5rem; line-height:1; }
.delta .row small { font-size:.8rem; color:var(--dim); font-weight:600; }
`);

Host.register('delta', function (root) {
  root.innerHTML = `<div class="delta"><div class="row"><small class="l"></small><span class="val">–</span><small class="r"></small></div><div class="bar"><i></i></div></div>`;
  const q = (s) => root.querySelector(s);
  const fill = q('.bar i');
  const LABEL = { best: 'vs best', optimal: 'vs optimal', sessionBest: 'vs session best', sessionOptimal: 'vs session optimal', sessionLast: 'vs last' };

  return {
    configure(ctx) {
      q('.l').style.visibility = q('.r').style.visibility = ctx.settings.showLapTimes ? '' : 'hidden';
    },
    update(state, ctx) {
      const s = ctx.settings, p = state.player, t = ctx.theme;
      if (!p || !p.deltas) return;
      const [d, dd, ok] = p.deltas[s.reference] || [];
      const val = q('.val');
      if (!ok || !Number.isFinite(d)) {
        val.textContent = '–';
        val.style.color = t.dim;
        fill.style.width = '0';
        q('.r').textContent = LABEL[s.reference];
        q('.l').textContent = Fmt.lapTime(p.lapTime, 1);
        return;
      }
      const f = Math.max(-1, Math.min(1, d / s.range));
      const color = s.showTrend && Number.isFinite(dd) && Math.abs(dd) > 0.02
        ? (dd < 0 ? t.green : t.red)
        : (d <= 0 ? t.green : t.red);
      if (f < 0) { fill.style.left = (50 + f * 50) + '%'; fill.style.width = (-f * 50) + '%'; }
      else { fill.style.left = '50%'; fill.style.width = (f * 50) + '%'; }
      fill.style.background = color;
      val.textContent = Fmt.signed(d, s.decimals);
      val.style.color = d <= 0 ? t.green : t.red;
      if (s.showLapTimes) {
        const refLap = s.reference === 'best' ? p.bestLap : s.reference === 'sessionLast' ? p.lastLap : 0;
        q('.l').textContent = Fmt.lapTime(p.lapTime, 1);
        q('.r').textContent = refLap > 0 ? '≈ ' + Fmt.lapTime(refLap + d, 2) : LABEL[s.reference];
      }
    },
  };
});
