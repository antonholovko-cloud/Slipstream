/*
 * Delta bar, plus two small gap bars: seconds to the car ahead and behind, with
 * a fill that grows as the gap closes, colored green while we gain on that car and red while we lose.
 */
Host.css(`
.delta { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:.3rem .5rem; gap:.25rem; }
.delta .bar { position:relative; height:1.6rem; background:rgba(255,255,255,.07); border-radius:3px; overflow:hidden; flex:none; }
.delta .bar i { position:absolute; top:0; bottom:0; border-radius:2px; transition: background .2s; }
.delta .bar::after { content:''; position:absolute; left:50%; top:-2px; bottom:-2px; width:2px; margin-left:-1px; background:var(--text); opacity:.8; }
.delta .row { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; flex:none; }
/* the delta itself sits inside the bar next to the centre line, on the empty side */
.delta .num { position:absolute; top:50%; transform:translateY(-50%); font-weight:700; line-height:1; white-space:nowrap; z-index:1;
  text-shadow: 0 1px 2px rgba(0,0,0,.7); font-variant-numeric: tabular-nums; }
.delta .num.l { right:calc(50% + .4rem); }
.delta .num.r { left:calc(50% + .4rem); }
.delta .num.c { display:none; } /* no delta yet: just the empty bar (a dash would sit on the centre line) */
.delta .val { font-size:1.15rem; }
.delta .row small { font-size:.8rem; color:var(--dim); font-weight:600; }
.delta .sector { display:flex; align-items:center; gap:.4rem; flex:none; font-size:.75rem; font-weight:700; }
.delta .sector .lbl { color:var(--dim); letter-spacing:.04em; min-width:1.6rem; }
.delta .sector .sbar { position:relative; flex:1; height:1.05rem; background:rgba(255,255,255,.07); border-radius:2px; overflow:hidden; }
.delta .sector .sbar i { position:absolute; top:0; bottom:0; border-radius:2px; }
.delta .sector .sbar::after { content:''; position:absolute; left:50%; top:-1px; bottom:-1px; width:1px; background:var(--text); opacity:.6; }
.delta .sector .snum { font-size:.78rem; }
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
    <div class="row"><small class="l"></small><small class="r"></small></div>
    <div class="bar"><i></i><b class="val num c">–</b></div>
    <div class="sector"><span class="lbl">S1</span><div class="sbar"><i></i><b class="snum num c">–</b></div></div>
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
    const lapsOf = (x, y) => (state.session && state.session.isRace ? Math.max(0, Math.floor(x.dist - y.dist + 0.0001)) : 0);
    if (byPos && me.inWorld && state.session && state.session.isRace && me.liveAhead !== undefined) {
      // live running order in class (model.js): official positions lag until the next timing line
      const a = me.liveAhead !== null ? cars.find((c) => c.idx === me.liveAhead) : null;
      const b = cars.find((c) => c.liveAhead === me.idx && c.classId === me.classId);
      return {
        ahead: a ? { car: a, gap: me.liveInterval, laps: lapsOf(a, me) } : null,
        behind: b ? { car: b, gap: b.liveInterval, laps: lapsOf(me, b) } : null,
      };
    }
    if (byPos && me.classPosition > 0) {
      const same = cars.filter((c) => c.classId === me.classId && c.classPosition > 0);
      const a = same.find((c) => c.classPosition === me.classPosition - 1);
      const b = same.find((c) => c.classPosition === me.classPosition + 1);
      // interval = seconds to the class car directly ahead; laps by actual distance between the two
      const gapOf = (x, y) => (y.interval !== null && y.interval !== undefined ? y.interval : x.gap !== null && y.gap !== null ? Math.abs(y.gap - x.gap) : null);
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

  // Current sector only: time gained (green, left) or lost (red, right) since the sector started.
  function renderSector(sd, s, t) {
    const lbl = q('.sector .lbl'), val = q('.sector .snum'), bar = q('.sector .sbar i');
    const d = sd ? sd.d[s.reference] : null;
    lbl.textContent = sd ? 'S' + sd.sector : 'S–';
    if (d === null || d === undefined || !Number.isFinite(d)) {
      val.textContent = '–'; val.style.color = t.dim; val.className = 'snum num c'; bar.style.width = '0';
      return;
    }
    const f = Math.max(-1, Math.min(1, d / s.sectorRange));
    bar.style.left = f < 0 ? (50 + f * 50) + '%' : '50%';
    bar.style.width = (Math.abs(f) * 50) + '%';
    bar.style.background = d <= 0 ? t.green : t.red;
    val.textContent = Fmt.signed(d, s.decimals);
    val.style.color = d <= 0 ? t.green : t.red;
    val.className = 'snum num ' + (d > 0 ? 'l' : 'r');
  }

  return {
    configure(ctx) {
      q('.l').style.visibility = q('.r').style.visibility = ctx.settings.showLapTimes ? '' : 'hidden';
      q('.row').style.display = ctx.settings.showLapTimes ? '' : 'none';
      q('.gaps').style.display = ctx.settings.showGaps ? '' : 'none';
      q('.sector').style.display = ctx.settings.showSector ? '' : 'none';
    },
    update(state, ctx) {
      const s = ctx.settings, p = state.player, t = ctx.theme;
      if (!p || !p.deltas) return;
      const [d, dd, ok] = p.deltas[s.reference] || [];
      const val = q('.val');
      if (!ok || !Number.isFinite(d)) {
        val.textContent = '–';
        val.style.color = t.dim;
        val.className = 'val num c';
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
        val.className = 'val num ' + (d > 0 ? 'l' : 'r'); // next to the centre line, on the empty side
        if (s.showLapTimes) {
          const refLap = s.reference === 'best' ? p.bestLap : s.reference === 'sessionLast' ? p.lastLap : 0;
          q('.l').textContent = Fmt.lapTime(p.lapTime, 1);
          q('.r').textContent = refLap > 0 ? '≈ ' + Fmt.lapTime(refLap + d, 2) : LABEL[s.reference];
        }
      }
      if (s.showSector) renderSector(p.sectorDelta, s, t);
      if (s.showGaps) {
        const n = neighbours(state, s.gapMode || 'auto');
        const lapTime = p.bestLap > 0 ? p.bestLap : p.estLap;
        renderGap('ahead', n.ahead, s, t, lapTime);
        renderGap('behind', n.behind, s, t, lapTime);
      }
    },
  };
});
