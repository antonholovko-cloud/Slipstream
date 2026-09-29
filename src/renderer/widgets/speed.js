/*
 * Speed: a compact readout of speed and gear with a wheelspin / lock-up lamp.
 * Contents scale to fit the box (like Dashboard & Inputs).
 */
Host.css(`
.spd { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:.6rem; padding:0 .6rem; overflow:hidden; }
.spd .gearwrap { position:relative; border-radius:.45rem; padding:.15rem .5rem; overflow:hidden; flex:none; }
.spd .gearwrap .rev { position:absolute; left:0; right:0; bottom:0; height:0; border-radius:.45rem; opacity:.6; transition: height .05s linear; }
.spd .gearwrap.blip .rev { height:100% !important; opacity:.9; animation: spdstrobe 90ms steps(1) infinite; }
@keyframes spdstrobe { 0% { opacity:.9; } 55% { opacity:.05; } }
.spd .gear { position:relative; font-size:2.4rem; font-weight:700; line-height:1; min-width:1.6rem; text-align:center; }
.spd .sep { width:1px; height:2.2rem; background:rgba(255,255,255,.12); flex:none; }
.spd .val { display:flex; align-items:baseline; gap:.25rem; }
.spd .val b { font-size:2.4rem; font-weight:700; line-height:1; min-width:3.6ch; text-align:right; }
.spd .val small { font-size:.8rem; color:var(--dim); font-weight:600; }
.spd .lamp { width:1.3rem; height:1.3rem; border-radius:50%; flex:none; background:rgba(255,255,255,.08);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); transition: background .08s, box-shadow .08s; }
.spd .lamp.on { background:var(--slip); box-shadow: 0 0 .7rem var(--slip), inset 0 0 0 1px rgba(255,255,255,.35); }
.spd .lampbox { display:flex; flex-direction:column; align-items:center; gap:.15rem; }
.spd .lampbox small { font-size:.55rem; letter-spacing:.06em; color:var(--dim); font-weight:700; min-height:.7rem; }
`);

Host.register('speed', function (root) {
  root.innerHTML = `<div class="spd">
    <div class="gearwrap"><div class="rev"></div><div class="gear">N</div></div><div class="sep s1"></div>
    <div class="val"><b>0</b><small></small></div>
    <div class="lampbox"><div class="lamp"></div><small></small></div>
  </div>`;
  const q = (s) => root.querySelector(s);
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  let kindHeld = null, until = 0, shown = '';

  return {
    fit() { // natural size in rem for fit-to-box
      const el = root.firstElementChild;
      const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
      let w = 1.2; // side padding
      for (const c of el.children) if (c.offsetParent !== null) w += c.getBoundingClientRect().width / fs + 0.6;
      return { w, h: 3.2 };
    },
    configure(ctx) {
      const s = ctx.settings;
      show(q('.gearwrap'), s.showGear);
      show(q('.s1'), s.showGear);
      show(q('.lampbox'), s.showSlip);
      show(q('.val small'), s.showUnit);
    },
    update(state, ctx) {
      const s = ctx.settings, p = state.player;
      if (!p) return;
      const u = state.session ? state.session.units : 'metric';
      const su = state.session ? state.session.speedUnits || u : u; // speed unit
      if (s.showGear) {
        q('.gear').textContent = p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
        // rev indicator behind the gear: rises with rpm, blinks at the car's shift point
        const wrap = q('.gearwrap'), rev = q('.rev'), t = ctx.theme;
        const sh = p.shift || {};
        const red = sh.redline || 8000;
        const first = sh.slFirst || red * 0.7;
        const last = sh.slLast || sh.slShift || red * 0.95;
        const shiftAt = sh.slShift || last;
        // same over-rev point and blue as the Dashboard's shift-light strobe
        const blueAt = s.limiterAt === 'shift' ? shiftAt : s.limiterAt === 'last' ? last
          : s.limiterAt === 'car' ? sh.slBlink || red : red - (s.limiterRpm ?? 300);
        const style = s.revIndicator || 'fill';
        const strobe = style !== 'off' && p.rpm >= blueAt && p.gear > 0;
        wrap.classList.toggle('blip', strobe);
        if (style === 'off') { rev.style.height = '0'; }
        else if (strobe) rev.style.background = s.limiterColor || t.blue;
        else if (style === 'fill') {
          const f = Math.max(0, Math.min(1, (p.rpm - first) / Math.max(1, blueAt - first)));
          rev.style.height = (f * 100).toFixed(1) + '%';
          rev.style.background = f < 0.6 ? t.green : f < 0.9 ? t.yellow : t.red;
        } else rev.style.height = '0';
      }
      q('.val b').textContent = Math.round(Fmt.speed(p.speed, su));
      if (s.showUnit) q('.val small').textContent = Fmt.speedUnit(su);

      if (s.showSlip) {
        const sl = p.slip;
        let kind = null;
        if (sl && sl.learned) {
          if (p.throttle > 0.1 && sl.dev > s.spinSensitivity / 100) kind = 'spin';
          else if (p.brake > 0.1 && sl.dev < -s.lockSensitivity / 100) kind = 'lock';
        }
        if (!kind && s.lockOnAbs && sl && sl.abs && p.brake > 0.05) kind = 'lock';
        const now = performance.now();
        if (kind) { kindHeld = kind; until = now + 180; }
        const k = now < until ? kindHeld : '';
        if (k !== shown) {
          shown = k;
          const lamp = q('.lamp');
          const col = k === 'spin' ? s.spinColor : k === 'lock' ? s.lockColor : '';
          if (col) lamp.style.setProperty('--slip', col);
          lamp.classList.toggle('on', !!col);
          q('.lampbox small').textContent = s.slipLabel ? (k === 'spin' ? 'SPIN' : k === 'lock' ? 'LOCK' : '') : '';
        }
      }
    },
  };
});
