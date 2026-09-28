/*
 * Delta bar, plus two small gap bars: seconds to the car ahead and behind, with
 * a fill that grows as the gap closes, colored green while we gain on that car and red while we lose.
 */
Host.css(`
.delta { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:.3rem .5rem; gap:.25rem; }
.delta .bar { position:relative; height:1.1rem; background:rgba(255,255,255,.07); border-radius:3px; overflow:hidden; flex:none; }
.delta .bar i { position:absolute; top:0; bottom:0; border-radius:2px; transition: background .2s; }
.delta .bar::after { content:''; position:absolute; left:50%; top:-2px; bottom:-2px; width:2px; margin-left:-1px; background:var(--text); opacity:.8; }
.delta .row { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; flex:none; }
.delta .val { font-size:1.5rem; line-height:1; }
.delta .row small { font-size:.8rem; color:var(--dim); font-weight:600; }
.delta .gaps { display:flex; gap:.6rem; flex:none; }
.delta .gap { flex:1; min-width:0; display:flex; flex-direction:column; gap:.12rem; }
.delta .gap .top { display:flex; align-items:baseline; gap:.3rem; font-size:.75rem; white-space:nowrap; }
.delta .gap .lbl { color:var(--dim); font-weight:700; letter-spacing:.04em; }
.delta .gap .who { color:var(--dim); overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.delta .gap .sec { font-size:.95rem; font-weight:700; }
.delta .gap .gbar { height:.3rem; background:rgba(255,255,255,.07); border-radius:2px; overflow:hidden; position:relative; }
.delta .gap .gbar i { position:absolute; top:0; bottom:0; border-radius:2px; transition: width .25s, background .25s; }
.delta .gap.ahead .gbar i { right:0; }
.delta .gap.behind .gbar i { left:0; }
`);

Host.register('delta', function (root) {
  root.innerHTML = `<div class="delta">
    <div class="row"><small class="l"></small><span class="val">–</span><small class="r"></small></div>
    <div class="bar"><i></i></div>
    <div class="gaps">
      <div class="gap ahead"><div class="top"><span class="lbl">▲ AHEAD</span><span class="who"></span><span class="sec">–</span></div><div class="gbar"><i></i></div></div>
      <div class="gap behind"><div class="top"><span class="lbl">▼ BEHIND</span><span class="who"></span><span class="sec">–</span></div><div class="gbar"><i></i></div></div>
    </div>
  </div>`;
  const q = (s) => root.querySelector(s);
  const fill = q('.bar i');
  const LABEL = { best: 'vs best', optimal: 'vs optimal', sessionBest: 'vs session best', sessionOptimal: 'vs session optimal', sessionLast: 'vs last' };
  const hist = { ahead: [], behind: [] }; // [time, idx, gap] for the trend

  // Gap to the car ahead / behind: by class position in races, by track position otherwise.
  function neighbours(state, mode) {
    const cars = state.cars || [];
    const me = cars.find((c) => c.isPlayer);
    if (!me) return {};
    const byPos = mode === 'position' || (mode === 'auto' && state.session && state.session.isRace);
    if (byPos && me.classPosition > 0) {
      const same = cars.filter((c) => c.classId === me.classId && c.classPosition > 0);
      const a = same.find((c) => c.classPosition === me.classPosition - 1);
      const b = same.find((c) => c.classPosition === me.classPosition + 1);
      // interval = seconds to the class car directly ahead; laps by actual distance between the two
      const gapOf = (x, y) => (y.interval !== null && y.interval !== undefined ? y.interval : x.gap !== null && y.gap !== null ? Math.abs(y.gap - x.gap) : null);
      const lapsOf = (x, y) => (state.session.isRace ? Math.max(0, Math.floor(x.dist - y.dist + 0.0001)) : 0);
      return {
        ahead: a ? { car: a, gap: gapOf(a, me), laps: lapsOf(a, me) } : null,
        behind: b ? { car: b, gap: gapOf(me, b), laps: lapsOf(me, b) } : null,
      };
    }
    const rel = state.relative || [];
    const byIdx = new Map(cars.map((c) => [c.idx, c]));
    const ahead = rel.filter((r) => r.gap > 0).sort((x, y) => x.gap - y.gap)[0];
    const behind = rel.filter((r) => r.gap < 0).sort((x, y) => y.gap - x.gap)[0];
    return {
      ahead: ahead ? { car: byIdx.get(ahead.idx), gap: ahead.gap, laps: 0 } : null,
      behind: behind ? { car: byIdx.get(behind.idx), gap: -behind.gap, laps: 0 } : null,
    };
  }

  // Seconds gained (+) or lost (-) per lap against that car, from the last ~4 s.
  function trend(side, n, lapTime) {
    const h = hist[side];
    const now = performance.now() / 1000;
    if (!n || n.gap === null) { h.length = 0; return null; }
    if (h.length && h[h.length - 1][1] !== n.car.idx) h.length = 0; // different car: restart
    h.push([now, n.car.idx, n.gap]);
    while (h.length && now - h[0][0] > 4) h.shift();
    if (h.length < 2 || now - h[0][0] < 1.5) return null;
    const rate = (n.gap - h[0][2]) / (now - h[0][0]); // gap change per second
    const perLap = rate * (lapTime || 90);
    return side === 'ahead' ? -perLap : perLap; // + = good for us
  }

  function renderGap(side, n, s, t, lapTime) {
    const el = q('.gap.' + side);
    const secEl = el.querySelector('.sec'), whoEl = el.querySelector('.who'), bar = el.querySelector('.gbar i');
    if (!n || !n.car) {
      secEl.textContent = '–'; whoEl.textContent = ''; bar.style.width = '0';
      hist[side].length = 0;
      return;
    }
    whoEl.textContent = s.gapNames ? `#${n.car.number} ${Fmt.driverName(n.car, 'last')}` : '';
    if (n.laps >= 1) { secEl.textContent = `${n.laps}L`; bar.style.width = '0'; return; }
    if (n.gap === null) { secEl.textContent = '–'; bar.style.width = '0'; return; }
    secEl.textContent = n.gap.toFixed(n.gap < 10 ? 2 : 1) + 's';
    const close = Math.max(0, 1 - n.gap / s.gapScale);
    const tr = trend(side, n, lapTime);
    const good = tr !== null && tr > 0.02, bad = tr !== null && tr < -0.02;
    const color = good ? t.green : bad ? t.red : side === 'ahead' ? t.accent : t.yellow;
    bar.style.width = (close * 100).toFixed(1) + '%';
    bar.style.background = color;
  }

  return {
    configure(ctx) {
      q('.l').style.visibility = q('.r').style.visibility = ctx.settings.showLapTimes ? '' : 'hidden';
      q('.gaps').style.display = ctx.settings.showGaps ? '' : 'none';
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
      } else {
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
      }
      if (s.showGaps) {
        const n = neighbours(state, s.gapMode || 'auto');
        const lapTime = p.bestLap > 0 ? p.bestLap : p.estLap;
        renderGap('ahead', n.ahead, s, t, lapTime);
        renderGap('behind', n.behind, s, t, lapTime);
      }
    },
  };
});
