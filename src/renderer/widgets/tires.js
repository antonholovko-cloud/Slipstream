Host.css(`
.tires { position:absolute; inset:0; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:.35rem .5rem; padding:.35rem .5rem; }
.tires .tire { display:flex; flex-direction:column; gap:.15rem; min-height:0; }
.tires .strip { flex:1; display:grid; grid-template-columns:repeat(3, 1fr); gap:2px; border-radius:4px; overflow:hidden; min-height:0; }
.tires .strip i { font-style:normal; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:1.15rem; background:rgba(255,255,255,.06); transition:background .4s; }
.tires .info { display:flex; justify-content:space-between; font-size:.8rem; color:var(--dim); line-height:1.1; }
.tires .info b { color:var(--text); font-weight:700; }
.tires .none { grid-column:1 / -1; grid-row:1 / -1; display:flex; align-items:center; justify-content:center; color:var(--dim); text-align:center; font-size:.9rem; }
`);

/*
 * Tyres: a top-down car, front at the top. Each tyre's three cells are its left / middle / right
 * edge as seen from above, so the outside edge is on the outside of the car for every wheel.
 * Cold = blue, in the optimal window = green, overheating = red.
 */
Host.register('tires', function (root) {
  const WHEELS = ['lf', 'rf', 'lr', 'rr'];
  root.innerHTML = `<div class="tires">${WHEELS.map((w) => `<div class="tire ${w}"><div class="strip"><i></i><i></i><i></i></div><div class="info"></div></div>`).join('')}</div>`;
  const box = root.querySelector('.tires');
  let last = '';

  // the color for a temperature (in the overlay's unit, like the window): below it, in it, above it
  function band(x, s) {
    if (!Number.isFinite(x)) return null;
    return x < s.optimalMin ? 'blue' : x > s.optimalMax ? 'red' : 'green';
  }

  function pressure(kpa, unit) {
    if (!(kpa > 0)) return '–';
    if (unit === 'psi') return (kpa * 0.145038).toFixed(1);
    if (unit === 'bar') return (kpa / 100).toFixed(2);
    return kpa.toFixed(0);
  }

  return {
    update(state, ctx) {
      const s = ctx.settings, t = ctx.theme, tr = state.tires;
      const units = state.session ? state.session.units : 'metric';
      if (!tr || !tr.available) {
        const html = '<div class="none">No tyre data<br>(get in the car)</div>';
        if (html !== last) { box.innerHTML = html; last = html; }
        ctx.setHeaderRight('');
        return;
      }
      const unit = s.pressureUnit === 'auto' ? (units === 'imperial' ? 'psi' : 'kpa') : s.pressureUnit;
      const toUnit = (c) => (c > 0 ? (s.tempUnit === 'f' ? c * 9 / 5 + 32 : c) : null);
      let html = '';
      for (const w of WHEELS) {
        const d = tr.wheels[w] || {};
        const cells = [0, 1, 2].map((k) => {
          const x = toUnit(d.temp ? d.temp[k] : null);
          const b = band(x, s);
          const bg = b ? Fmt.rgba(t[b], 0.75) : '';
          // data-band, not a class: .blue / .green / .red are the host's !important text colors
          return `<i data-band="${b || ''}" style="background:${bg};color:${b ? Fmt.contrast(t[b]) : ''}">${x !== null ? x.toFixed(0) : '–'}</i>`;
        }).join('');
        let info = '';
        if (s.showPressure) info += `<span><b>${pressure(d.pressure, unit)}</b> ${unit === 'kpa' ? 'kPa' : unit}${d.hot ? '' : ' cold'}</span>`;
        if (s.showWear && d.wear) info += `<span><b>${Math.round(Math.min(...d.wear) * 100)}%</b></span>`;
        html += `<div class="tire ${w}"><div class="strip">${cells}</div><div class="info">${info}</div></div>`;
      }
      if (html !== last) { box.innerHTML = html; last = html; }
      // iRacing may only measure tyres in the pit stall: say how old the reading is
      ctx.setHeaderRight(tr.live ? 'live' : tr.lap > 0 ? `pit reading, after lap ${tr.lap}` : 'pit reading');
    },
  };
});
