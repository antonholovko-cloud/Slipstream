Host.css(`
.dash { position:absolute; inset:0; display:flex; flex-direction:column; padding:.35rem .5rem; gap:.3rem; }
.dash .lights { display:flex; gap:.3rem; justify-content:center; flex:none; }
.dash .lights i { flex:none; width:1rem; height:1rem; border-radius:50%; background:rgba(255,255,255,.08); }
.dash .lights.flash i { animation: dashflash .12s steps(2) infinite; }
@keyframes dashflash { 50% { opacity:.15 } }
.dash .main { display:flex; align-items:center; gap:.8rem; flex:1; min-height:0; }
.dash .gear { font-size:3.2rem; font-weight:700; line-height:1; min-width:2.4rem; text-align:center; }
.dash .col { display:flex; flex-direction:column; flex:1; gap:.15rem; min-width:0; }
.dash .speed { font-size:1.6rem; font-weight:700; line-height:1; }
.dash .speed small, .dash .rpm small { font-size:.7rem; color:var(--dim); margin-left:.2rem; }
.dash .rpm { font-size:.9rem; color:var(--dim); }
.dash .rpmbar { height:.4rem; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden; }
.dash .rpmbar i { display:block; height:100%; background:var(--accent); border-radius:3px; }
.dash .side { display:grid; grid-template-columns:auto auto; gap:0 .5rem; font-size:.85rem; align-content:center; }
.dash .side span:nth-child(odd) { color:var(--dim); font-size:.7rem; text-transform:uppercase; align-self:center; }
.dash .row { display:flex; justify-content:space-between; font-size:.85rem; gap:.5rem; }
.dash .row span { white-space:nowrap; }
.dash .row b { font-weight:700; }
.dash .warn { display:flex; gap:.25rem; }
.dash .warn span { background:var(--red); color:#fff; font-size:.65rem; font-weight:700; padding:0 .3rem; border-radius:3px; }
.dash .warn span.lim { background:var(--yellow); color:#000; }
`);

Host.register('dash', function (root) {
  root.innerHTML = `<div class="dash">
    <div class="lights"></div>
    <div class="main">
      <div class="gear">N</div>
      <div class="col">
        <div class="speed">0<small></small></div>
        <div class="rpmbar"><i></i></div>
        <div class="rpm">0<small>rpm</small></div>
      </div>
      <div class="side"></div>
    </div>
    <div class="warn"></div>
    <div class="row lapinfo"></div>
  </div>`;
  const q = (s) => root.querySelector(s);
  const lightsEl = q('.lights');
  let lightCount = 0;
  let lights = [];

  function buildLights(n) {
    lightCount = n;
    lightsEl.innerHTML = '<i></i>'.repeat(n);
    lights = [...lightsEl.children];
  }

  const WARN = [[0x01, 'WATER'], [0x02, 'FUEL P'], [0x04, 'OIL P'], [0x08, 'STALL'], [0x40, 'OIL T']];
  let lastSide = '', lastRow = '', lastWarn = '';

  return {
    configure(ctx) {
      const s = ctx.settings;
      if (s.lightCount !== lightCount) buildLights(s.lightCount);
      lightsEl.style.display = s.shiftLights ? '' : 'none';
      q('.rpmbar').style.display = s.showRpmBar ? '' : 'none';
      q('.lapinfo').style.display = s.showLapInfo ? '' : 'none';
      q('.warn').style.display = s.showWarnings ? '' : 'none';
    },
    update(state, ctx) {
      const s = ctx.settings, p = state.player, t = ctx.theme;
      if (!p) return;
      const u = state.session ? state.session.units : 'metric';
      const sh = p.shift || {};
      const red = sh.redline || 8000;
      const first = sh.slFirst || red * 0.75;
      const last = sh.slLast || sh.slShift || red * 0.95;
      const shiftAt = sh.slShift || last;
      const blink = sh.slBlink || red;

      q('.gear').textContent = p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
      q('.speed').firstChild.nodeValue = Math.round(Fmt.speed(p.speed, u));
      q('.speed small').textContent = Fmt.speedUnit(u);
      q('.rpm').firstChild.nodeValue = Math.round(p.rpm);
      const pct = Math.min(1, p.rpm / red);
      const bar = q('.rpmbar i');
      bar.style.width = (pct * 100).toFixed(1) + '%';
      bar.style.background = p.rpm >= shiftAt ? t.red : p.rpm >= first ? t.yellow : t.accent;

      if (s.shiftLights) {
        const on = p.rpm <= first ? 0 : Math.ceil(((p.rpm - first) / Math.max(1, last - first)) * lightCount);
        const blinkAll = p.rpm >= blink;
        lights.forEach((el, i) => {
          const f = i / lightCount;
          const col = blinkAll ? t.blue : f < 0.4 ? t.green : f < 0.75 ? t.yellow : t.red;
          el.style.background = i < on || blinkAll ? col : '';
          el.style.boxShadow = i < on || blinkAll ? `0 0 .5rem ${col}` : '';
        });
        lightsEl.classList.toggle('flash', s.flashOnShift && p.rpm >= shiftAt);
      }

      let side = '';
      if (s.showFuel) side += `<span>Fuel</span><span>${Fmt.fuel(p.fuel, u, 1)} ${Fmt.fuelUnit(u)}</span>`;
      if (s.showBias && p.brakeBias) side += `<span>Bias</span><span>${p.brakeBias.toFixed(1)}%</span>`;
      if (p.waterTemp) side += `<span>Water</span><span>${Fmt.temp(p.waterTemp, u)}</span>`;
      if (side !== lastSide) { q('.side').innerHTML = side; lastSide = side; }

      if (s.showWarnings) {
        const w = p.engineWarnings || 0;
        let html = (w & 0x10) ? '<span class="lim">PIT LIMITER</span>' : '';
        for (const [bit, label] of WARN) if (w & bit) html += `<span>${label}</span>`;
        if (html !== lastWarn) { q('.warn').innerHTML = html; lastWarn = html; }
      }

      if (s.showLapInfo) {
        const d = p.deltas && p.deltas.best;
        const delta = d && d[2] ? `<span class="${d[0] <= 0 ? 'green' : 'red'}">${Fmt.signed(d[0], 2)}</span>` : '<span class="dim">–</span>';
        const ses = state.session || {};
        const lapStr = ses.lapsTotal ? `${Math.max(0, p.lap)}/${ses.lapsTotal}` : Math.max(0, p.lap);
        const row = `<span>Lap <b>${lapStr}</b></span><span>Last <b>${Fmt.lapTime(p.lastLap)}</b></span><span>Best <b>${Fmt.lapTime(p.bestLap)}</b></span><span>Δ <b>${delta}</b></span>`;
        if (row !== lastRow) { q('.lapinfo').innerHTML = row; lastRow = row; }
      }
    },
  };
});
