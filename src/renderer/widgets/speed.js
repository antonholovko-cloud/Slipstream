/*
 * Speed: a compact readout of speed and gear with rev lights and wheelspin / lock-up.
 * Layouts: "rails" (light bars on both sides, with a wheelspin / lock-up lane), "strip" (light bar underneath) and
 * "classic" (fill behind the gear + round slip lamp).
 * Contents scale to fit the box (like Dashboard & Inputs).
 */
Host.css(`
.spd { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:.6rem; padding:0 .6rem; overflow:hidden; }
.spd .mid { display:flex; flex-direction:column; align-items:stretch; gap:.35rem; flex:none; }
.spd .row { display:flex; align-items:center; justify-content:center; gap:.6rem; }
.spd .gearwrap { position:relative; border-radius:.45rem; padding:.15rem .5rem; overflow:hidden; flex:none; }
.spd .gearwrap .rev { position:absolute; left:0; right:0; bottom:0; height:0; border-radius:.45rem; opacity:.6; transition: height .05s linear; }
.spd .gearwrap.blip .rev { height:100% !important; opacity:.9; animation: spdstrobe 90ms steps(1) infinite; }
@keyframes spdstrobe { 0% { opacity:.9; } 55% { opacity:.05; } }
.spd .gear { position:relative; font-size:2.4rem; font-weight:700; line-height:1; min-width:1.6rem; text-align:center; }
.spd .sep { width:1px; height:2.2rem; background:rgba(255,255,255,.12); flex:none; }
.spd .val { display:flex; align-items:baseline; gap:.25rem; }
.spd .val b { font-size:2.4rem; font-weight:700; line-height:1; min-width:3.6ch; text-align:right; transition: color .08s; }
.spd .val small { font-size:.8rem; color:var(--dim); font-weight:600; }
.spd .val .tag { display:none; font-size:.62rem; font-weight:800; letter-spacing:.06em; color:#000; background:var(--slip); border-radius:.25rem; padding:.05rem .3rem; align-self:center; }
.spd.slip:not(.lay-rails) .val b { color:var(--slip); }
.spd.slip.tagged .val .tag { display:block; }
.spd.slip.tagged .val small { display:none; }
.spd .lamp { width:1.3rem; height:1.3rem; border-radius:50%; flex:none; background:rgba(255,255,255,.08);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); transition: background .08s, box-shadow .08s; }
.spd .lamp.on { background:var(--slip); box-shadow: 0 0 .7rem var(--slip), inset 0 0 0 1px rgba(255,255,255,.35); }
.spd .lampbox { display:flex; flex-direction:column; align-items:center; gap:.15rem; }
.spd .lampbox small { font-size:.55rem; letter-spacing:.06em; color:var(--dim); font-weight:700; min-height:.7rem; }
/* rev lights: segments light up green -> yellow -> red, all strobe at the shift point */
.spd .lights { display:flex; gap:.14rem; flex:none; }
.spd .lights i { flex:1; border-radius:2px; background:rgba(255,255,255,.08); }
.spd .lights i.on[data-c=g] { background:var(--green); box-shadow:0 0 .35rem var(--green); }
.spd .lights i.on[data-c=y] { background:var(--yellow); box-shadow:0 0 .35rem var(--yellow); }
.spd .lights i.on[data-c=r] { background:var(--red); box-shadow:0 0 .35rem var(--red); }
.spd.blip .lights i { background:var(--lim); box-shadow:0 0 .5rem var(--lim); animation: spdstrobe 90ms steps(1) infinite; }
.spd .rail { flex-direction:column-reverse; width:.65rem; height:2.9rem; }
/* side lights: a slim lane on the outer edge strobes amber (wheelspin) or red (lock-up) */
.spd .side { display:flex; align-items:stretch; gap:.2rem; flex:none; }
.spd .lane { position:relative; width:.22rem; border-radius:1rem; overflow:hidden;
  background:linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.09) 50%, rgba(255,255,255,.03)); }
.spd .lane::after { content:''; position:absolute; inset:0; border-radius:inherit; opacity:0;
  background:linear-gradient(180deg, transparent 0%, var(--slip) 18%, #fff 50%, var(--slip) 82%, transparent 100%);
  box-shadow:0 0 .5rem var(--slip); transition:opacity .06s; }
.spd.slip .lane { overflow:visible; box-shadow:0 0 .6rem var(--slip), 0 0 .2rem var(--slip); background:var(--slip); animation: spdslip 110ms steps(1) infinite; }
.spd.slip .lane::after { opacity:1; }
@keyframes spdslip { 0% { opacity:1; } 55% { opacity:.3; } }
.spd .strip { height:.42rem; }
.spd:not(.lay-rails) .side, .spd:not(.lay-strip) .strip, .spd:not(.lay-classic) .lampbox { display:none; }
`);

Host.register('speed', function (root) {
  const RAIL = 8, STRIP = 14;
  const segs = (n) => Array.from({ length: n }, (_, i) => `<i data-c="${i < n * 0.5 ? 'g' : i < n * 0.8 ? 'y' : 'r'}"></i>`).join('');
  root.innerHTML = `<div class="spd">
    <div class="side l"><div class="lane"></div><div class="lights rail l">${segs(RAIL)}</div></div>
    <div class="mid">
      <div class="row">
        <div class="gearwrap"><div class="rev"></div><div class="gear">N</div></div><div class="sep s1"></div>
        <div class="val"><b>0</b><small></small><span class="tag"></span></div>
        <div class="lampbox"><div class="lamp"></div><small></small></div>
      </div>
      <div class="lights strip">${segs(STRIP)}</div>
    </div>
    <div class="side r"><div class="lights rail r">${segs(RAIL)}</div><div class="lane"></div></div>
  </div>`;
  const q = (s) => root.querySelector(s);
  const box = root.firstElementChild;
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const lights = [...root.querySelectorAll('.lights')].map((el) => ({ el, segs: [...el.children], lit: -1 }));
  let layout = 'rails';
  let kindHeld = null, until = 0, shown = '';

  function light(frac, strobe) {
    box.classList.toggle('blip', strobe);
    for (const l of lights) {
      const n = strobe ? 0 : Math.ceil(frac * l.segs.length - 1e-6);
      if (n === l.lit) continue;
      l.lit = n;
      l.segs.forEach((s, i) => s.classList.toggle('on', i < n));
    }
  }

  return {
    fit() { // natural size in rem for fit-to-box
      const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
      let w = 1.2; // side padding
      for (const c of box.children) if (c.offsetParent !== null) w += c.getBoundingClientRect().width / fs + 0.6;
      return { w, h: layout === 'strip' ? 3.9 : 3.2 };
    },
    configure(ctx) {
      const s = ctx.settings;
      layout = s.layout || 'rails';
      box.className = 'spd lay-' + layout + (s.slipLabel ? ' tagged' : '');
      box.style.setProperty('--lim', s.limiterColor || ctx.theme.blue);
      show(q('.gearwrap'), s.showGear);
      show(q('.s1'), s.showGear);
      show(q('.lampbox'), s.showSlip);
      for (const el of root.querySelectorAll('.lane')) show(el, s.showSlip);
      show(q('.val small'), s.showUnit);
      // clear what the previous layout lit; the next update repaints it in this one
      q('.gearwrap').classList.remove('blip');
      q('.rev').style.height = '0';
      q('.lamp').classList.remove('on');
      q('.lampbox small').textContent = '';
      for (const l of lights) l.lit = -1;
      shown = null;
    },
    update(state, ctx) {
      const s = ctx.settings, p = state.player;
      if (!p) return;
      const u = state.session ? state.session.units : 'metric';
      const su = state.session ? state.session.speedUnits || u : u; // speed unit
      const t = ctx.theme;

      // rev lights rise from the first shift light to the strobe point, then strobe
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
      const f = style === 'fill' ? Math.max(0, Math.min(1, (p.rpm - first) / Math.max(1, blueAt - first))) : 0;

      if (s.showGear) q('.gear').textContent = p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
      if (layout === 'classic') {
        // rev indicator behind the gear
        const wrap = q('.gearwrap'), rev = q('.rev');
        wrap.classList.toggle('blip', s.showGear && strobe);
        if (strobe) rev.style.background = s.limiterColor || t.blue;
        else {
          rev.style.height = (f * 100).toFixed(1) + '%';
          rev.style.background = f < 0.6 ? t.green : f < 0.9 ? t.yellow : t.red;
        }
      } else light(f, strobe);

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
          const col = k === 'spin' ? s.spinColor : k === 'lock' ? s.lockColor : '';
          const label = k === 'spin' ? 'SPIN' : k === 'lock' ? 'LOCK' : '';
          if (col) box.style.setProperty('--slip', col);
          if (layout === 'classic') {
            q('.lamp').classList.toggle('on', !!col);
            q('.lampbox small').textContent = s.slipLabel ? label : '';
          } else {
            // side lights: the lanes strobe; light strip: the speed turns the slip color.
            // Both show a SPIN / LOCK tag in place of the unit.
            box.classList.toggle('slip', !!col);
            q('.tag').textContent = label;
          }
        }
      }
    },
  };
});
