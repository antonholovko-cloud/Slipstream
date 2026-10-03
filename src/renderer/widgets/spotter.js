/*
 * Radar: cars around you seen from above, with a glow on the side a car is alongside.
 *
 * iRacing gives no lateral position for other cars, only lap distance and the
 * spotter flag (CarLeftRight: car left / right / both / two left / two right).
 * Distance ahead / behind is exact; the side comes from the spotter flag alone.
 * A car the spotter put on a side stays drawn in that lane for a few seconds
 * after it pulls ahead or drops back, then eases back to the centre lane.
 */
Host.css(`
.spt { position:absolute; inset:0; container-type:size; display:grid; place-items:center; transition: opacity .35s; }
.spt .field { position:relative; width:min(100cqw,100cqh); height:min(100cqw,100cqh); overflow:hidden; border-radius:50%; }
.spt .ring { position:absolute; border:1px dashed var(--guide); border-radius:50%; }
.spt .axis { position:absolute; border:0 dashed var(--guide); }
.spt .axis.v { left:50%; top:0; bottom:0; border-left-width:1px; }
.spt .axis.h { top:50%; left:0; right:0; border-top-width:1px; }
.spt .lane { position:absolute; top:0; bottom:0; background:rgba(255,255,255,.10); }
.spt .wash { position:absolute; top:0; bottom:0; opacity:0; transition: opacity .2s; }
.spt .wash.on { opacity:1; }
.spt .car { position:absolute; border-radius:22%/12%; box-shadow: 0 0 0 1px rgba(0,0,0,.55); }
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
  // idx -> { side: -1 | 1, row: 1 | 2, t: last flagged (s) }. The flag says "a car is left", not
  // which car, so when both sides are flagged at once each car keeps the side it was first seen on.
  const memo = new Map();
  let shown = '';

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

  // Preview for edit mode with nobody around: one alongside on the left, a pack behind.
  const PREVIEW = { state: 2, cars: [{ idx: -1, meters: -1.6 }, { idx: -2, meters: -6 }, { idx: -3, meters: -12 }, { idx: -4, meters: 3.5 }, { idx: -5, meters: 14 }] };

  function layout(range) {
    const k = 50 / range; // % of the field per meter
    const laneW = CAR_W * 1.5 * k;
    q('.lane').style.cssText = `left:${(50 - laneW / 2).toFixed(2)}%;width:${laneW.toFixed(2)}%`;
    q('.wash.l').style.cssText = `left:0;width:${(50 - laneW / 2).toFixed(2)}%`;
    q('.wash.r').style.cssText = `right:0;width:${(50 - laneW / 2).toFixed(2)}%`;
    const rings = root.querySelectorAll('.ring');
    [100, 50].forEach((d, i) => { rings[i].style.cssText = `left:${50 - d / 2}%;top:${50 - d / 2}%;width:${d}%;height:${d}%`; });
  }

  function car(x, m, k, cls, label, side) {
    const w = CAR_W * k, h = CAR_L * k;
    const left = 50 + x * k - w / 2, top = 50 - m * k - h / 2;
    let html = `<div class="car ${cls}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${w.toFixed(2)}%;height:${h.toFixed(2)}%"></div>`;
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
      const flagged = assign(radar);
      for (const [idx, f] of flagged) memo.set(idx, { side: f.side, row: f.row, t: now });
      for (const idx of memo.keys()) if (!radar.cars.some((c) => c.idx === idx && Math.abs(c.meters) < 40)) memo.delete(idx);

      let html = '';
      // farthest first so nearer cars draw on top
      const cars = radar.cars.filter((c) => Math.abs(c.meters) <= range + CAR_L).sort((a, b) => Math.abs(b.meters) - Math.abs(a.meters));
      for (const c of cars) {
        const f = flagged.get(c.idx), m = memo.get(c.idx);
        let x = 0, meters = c.meters, label = '';
        if (f) {
          x = f.side * f.row * LANE;
          // the spotter says it's alongside: keep it overlapping even if our distance is a bit off
          meters = Math.max(-CAR_L * 0.95, Math.min(CAR_L * 0.95, c.meters));
          if (s.showOverlap) label = Math.round((1 - Math.abs(meters) / CAR_L) * 100) + '%';
        } else if (m) {
          const fade = Math.max(0, Math.min(1, 1 - (now - m.t - HOLD) / EASE));
          x = m.side * m.row * LANE * fade;
        }
        const close = f || Math.abs(c.meters) < s.closeAt;
        html += car(x, meters, k, close ? 'close' : 'far', label, f ? f.side : 0);
      }
      html += car(0, 0, k, 'me');
      if (html !== shown) { carsEl.innerHTML = html; shown = html; }
    },
  };
});
