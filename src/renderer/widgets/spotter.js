/*
 * Radar: cars around you seen from above, with a glow on the side a car is alongside.
 *
 * iRacing gives no lateral position for other cars, only lap distance and the
 * spotter flag (CarLeftRight: car left / right / both / two left / two right).
 * Distance ahead / behind is exact; the side comes from the spotter flag alone.
 * A car the spotter put on a side stays drawn in that lane for a few seconds
 * after it pulls ahead or drops back, then eases back to the centre lane.
 * Cars that would sit on top of each other are staggered sideways so each stays
 * visible, and a car tilts the way it is drifting while it changes lane.
 */
Host.css(`
.spt { position:absolute; inset:0; container-type:size; display:grid; place-items:center; transition: opacity .35s; }
.spt .field { position:relative; width:min(100cqw,100cqh); height:min(100cqw,100cqh); overflow:hidden; }
.spt .ring { position:absolute; border:1px dashed var(--guide); border-radius:50%; }
.spt .axis { position:absolute; border:0 dashed var(--guide); }
.spt .axis.v { left:50%; top:0; bottom:0; border-left-width:1px; }
.spt .axis.h { top:50%; left:0; right:0; border-top-width:1px; }
.spt .lane { position:absolute; top:0; bottom:0; background:rgba(255,255,255,.14);
  box-shadow: inset 2px 0 0 rgba(160,165,175,.55), inset -2px 0 0 rgba(160,165,175,.55); }
.spt .wash { position:absolute; top:0; bottom:0; opacity:0; transition: opacity .2s; }
.spt .wash.on { opacity:1; }
.spt .car { position:absolute; border-radius:24%/14%; box-shadow: 0 0 0 1.5px rgba(30,30,35,.7), 0 1px 3px rgba(0,0,0,.5); }
.spt .car.me { background:var(--me); }
.spt .car.close { background:var(--close); }
.spt .car.far { background:var(--far); }
.spt .pct { position:absolute; font-size:.7rem; font-weight:700; color:var(--text); text-shadow: 0 1px 2px rgba(0,0,0,.95);
  white-space:nowrap; transform:translateY(-50%); }
`);

Host.register('spotter', function (root) {
  root.innerHTML = `<div class="spt"><div class="field">
    <div class="wash l"></div><div class="wash r"></div><div class="lane"></div>
    <div class="guides"><div class="ring"></div><div class="ring"></div><div class="axis v"></div><div class="axis h"></div></div>
    <div class="cars"></div>
  </div></div>`;
  const q = (s) => root.querySelector(s);
  const wrap = q('.spt'), carsEl = q('.cars');
  const CAR_L = 4.6, CAR_W = 1.9, LANE = 3.1; // meters: about a GT3, and lane spacing
  const HOLD = 3, EASE = 2; // seconds a car keeps its side after the spotter lets go, then eases back
  const SLIDE = 10; // how fast a drawn car moves to its lane (1/s)
  const TILT = 9, MAX_TILT = 26; // degrees of tilt per m/s of sideways drift, and the most
  // idx -> { side: -1 | 1, row: 1 | 2, t: last flagged (s) }. The flag says "a car is left", not
  // which car, so when both sides are flagged at once each car keeps the side it was first seen on.
  const memo = new Map();
  const drawn = new Map(); // idx -> { x, a }: smoothed lateral position (m) and tilt (deg)
  let shown = '', lastT = null;

  // CarLeftRight -> cars to place on each side
  function counts(st) {
    return { '-1': st === 2 || st === 4 ? 1 : st === 5 ? 2 : 0, 1: st === 3 || st === 4 ? 1 : st === 6 ? 2 : 0 };
  }

  // idx -> { side, row } for the cars the spotter is flagging now (nearest first)
  function assign(radar) {
    const need = counts(radar.state);
    const total = need[-1] + need[1];
    const out = new Map();
    if (!total) return out;
    // our distance can be a few meters off iRacing's own, so look a little past one car length
    let near = radar.cars.filter((c) => Math.abs(c.meters) < CAR_L * 1.6);
    if (near.length < total) near = radar.cars.filter((c) => Math.abs(c.meters) < 10);
    near = near.slice().sort((a, b) => Math.abs(a.meters) - Math.abs(b.meters)).slice(0, total);
    const rows = { '-1': 0, 1: 0 };
    const put = (c, side) => { out.set(c.idx, { side, row: ++rows[side] }); need[side]--; };
    for (const c of near) {
      const m = memo.get(c.idx);
      if (m && need[m.side] > 0) put(c, m.side);
    }
    for (const c of near) {
      if (out.has(c.idx)) continue;
      put(c, need[-1] > 0 ? -1 : 1);
    }
    return out;
  }

  // Where each car goes: flagged cars in their side lane, remembered ones easing back to the
  // centre, then anything that would overlap another car staggered sideways (nearest cars keep
  // their place). Returns [{ c, x, m, flagged }].
  function place(cars, flagged, now) {
    const out = [];
    const taken = [{ x: 0, m: 0 }]; // our own car
    const hit = (x, m) => taken.some((p) => Math.abs(p.x - x) < CAR_W * 1.15 && Math.abs(p.m - m) < CAR_L * 1.05);
    for (const c of cars.slice().sort((a, b) => Math.abs(a.meters) - Math.abs(b.meters))) {
      const f = flagged.get(c.idx), mm = memo.get(c.idx);
      let x = 0, m = c.meters;
      if (f) {
        x = f.side * f.row * LANE;
        // the spotter says it's alongside: keep it overlapping even if our distance is a bit off
        m = Math.max(-CAR_L * 0.95, Math.min(CAR_L * 0.95, c.meters));
      } else {
        if (mm) x = mm.side * mm.row * LANE * Math.max(0, Math.min(1, 1 - (now - mm.t - HOLD) / EASE));
        // the spotter says nobody is alongside: never draw a car on top of ours
        if (Math.abs(x) < CAR_W * 1.15 && Math.abs(m) < CAR_L * 1.05) m = (m < 0 ? -1 : 1) * CAR_L * 1.05;
        if (hit(x, m)) {
          // stagger: try a little to either side, the side it was last on (or by number) first
          const pref = mm ? mm.side : c.idx % 2 ? -1 : 1;
          const step = CAR_W * 1.2;
          for (const d of [step, -step, step * 2, -step * 2]) {
            if (!hit(x + pref * d, m)) { x += pref * d; break; }
          }
        }
      }
      taken.push({ x, m });
      out.push({ c, x, m, flagged: f });
    }
    return out;
  }

  // Preview for edit mode with nobody around: three wide, a small pack behind.
  const PREVIEW = { state: 4, cars: [{ idx: -1, meters: 0.8 }, { idx: -2, meters: -0.6 }, { idx: -3, meters: -6 }, { idx: -4, meters: -7 }, { idx: -5, meters: -13 }, { idx: -6, meters: 12 }] };

  function layout(range) {
    const k = 50 / range; // % of the field per meter
    const laneW = CAR_W * 2.4 * k;
    q('.lane').style.cssText = `left:${(50 - laneW / 2).toFixed(2)}%;width:${laneW.toFixed(2)}%`;
    q('.wash.l').style.cssText = `left:0;width:${(50 - laneW / 2).toFixed(2)}%`;
    q('.wash.r').style.cssText = `right:0;width:${(50 - laneW / 2).toFixed(2)}%`;
    const rings = root.querySelectorAll('.ring');
    [92, 46].forEach((d, i) => { rings[i].style.cssText = `left:${50 - d / 2}%;top:${50 - d / 2}%;width:${d}%;height:${d}%`; });
  }

  function car(x, m, k, cls, label, side, tilt) {
    const w = CAR_W * k, h = CAR_L * k;
    const left = 50 + x * k - w / 2, top = 50 - m * k - h / 2;
    const rot = tilt ? `;transform:rotate(${tilt.toFixed(1)}deg)` : '';
    let html = `<div class="car ${cls}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${w.toFixed(2)}%;height:${h.toFixed(2)}%${rot}"></div>`;
    if (label) {
      // outside the car, on the far side from us
      const lx = side < 0 ? `right:${(100 - left + 1).toFixed(2)}%` : `left:${(left + w + 1).toFixed(2)}%`;
      html += `<div class="pct" style="${lx};top:${(top + h / 2).toFixed(2)}%">${label}</div>`;
    }
    return html;
  }

  let range = 0;
  return {
    configure(ctx) {
      const s = ctx.settings;
      const props = { '--me': s.meColor, '--close': s.closeColor, '--far': s.farColor, '--guide': Fmt.rgba(ctx.theme.text, 0.35) };
      for (const [k, v] of Object.entries(props)) wrap.style.setProperty(k, v);
      q('.guides').style.display = s.guides ? '' : 'none';
      range = 0; // re-layout on the next update
    },
    update(state, ctx) {
      const s = ctx.settings;
      let radar = state.radar || { state: 0, cars: [] };
      const live = radar.cars.some((c) => Math.abs(c.meters) <= s.range + CAR_L) || counts(radar.state)[-1] + counts(radar.state)[1] > 0;
      if (!live && ctx.editMode) radar = PREVIEW;
      wrap.style.opacity = !s.autoHide || live || ctx.editMode ? '1' : '0';
      if (range !== s.range) { range = s.range; layout(range); }
      const k = 50 / range;

      // side glow: yellow for one car alongside, orange when that side holds two or we're three wide
      const need = counts(radar.state);
      const threeWide = radar.state >= 4;
      for (const side of [-1, 1]) {
        const el = q(side < 0 ? '.wash.l' : '.wash.r');
        const color = need[side] > 1 || (threeWide && need[side]) ? s.dangerColor : s.warnColor;
        const dir = side < 0 ? 'to right' : 'to left';
        el.style.background = `linear-gradient(${dir}, ${Fmt.rgba(color, 0)}, ${Fmt.rgba(color, 0.85)})`;
        el.classList.toggle('on', need[side] > 0);
      }

      const now = performance.now() / 1000;
      const dt = lastT === null ? 0 : Math.max(0, Math.min(0.2, now - lastT));
      lastT = now;
      const flagged = assign(radar);
      for (const [idx, f] of flagged) memo.set(idx, { side: f.side, row: f.row, t: now });
      for (const idx of memo.keys()) if (!radar.cars.some((c) => c.idx === idx && Math.abs(c.meters) < 40)) memo.delete(idx);

      const inView = radar.cars.filter((c) => Math.abs(c.meters) <= range + CAR_L);
      const placed = place(inView, flagged, now);
      for (const idx of drawn.keys()) if (!inView.some((c) => c.idx === idx)) drawn.delete(idx);

      let html = '';
      // farthest first so nearer cars draw on top
      placed.sort((a, b) => Math.abs(b.m) - Math.abs(a.m));
      for (const p of placed) {
        // slide toward the target lane and tilt the way it's drifting
        let d = drawn.get(p.c.idx);
        if (!d) { d = { x: p.x, a: 0 }; drawn.set(p.c.idx, d); }
        else if (dt > 0) {
          const x0 = d.x;
          d.x += (p.x - d.x) * Math.min(1, dt * SLIDE);
          const lean = Math.max(-MAX_TILT, Math.min(MAX_TILT, ((d.x - x0) / dt) * TILT));
          d.a += (lean - d.a) * Math.min(1, dt * 8);
          if (Math.abs(d.a) < 0.5) d.a = 0;
        }
        let label = '';
        if (p.flagged && s.showOverlap) label = Math.round((1 - Math.abs(p.m) / CAR_L) * 100) + '%';
        const close = p.flagged || Math.abs(p.c.meters) < s.closeAt;
        html += car(d.x, p.m, k, close ? 'close' : 'far', label, p.flagged ? p.flagged.side : 0, d.a);
      }
      html += car(0, 0, k, 'me');
      if (html !== shown) { carsEl.innerHTML = html; shown = html; }
    },
  };
});
