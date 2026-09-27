Host.css(`
.fuel { position:absolute; inset:0; display:flex; flex-direction:column; padding:.35rem .6rem; gap:.35rem; }
.fuel .tank { height:.5rem; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden; }
.fuel .tank i { display:block; height:100%; border-radius:3px; transition: width .3s; }
.fuel .grid { display:grid; grid-template-columns: 1fr auto; gap:.1rem .6rem; font-size:.95rem; align-content:start; }
.fuel .grid span:nth-child(odd) { color:var(--dim); font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; align-self:center; }
.fuel .grid span:nth-child(even) { text-align:right; font-weight:700; }
.fuel .big { display:flex; justify-content:space-between; align-items:baseline; }
.fuel .big b { font-size:1.6rem; line-height:1; }
.fuel .big small { color:var(--dim); font-size:.75rem; margin-left:.2rem; }
`);

Host.register('fuel', function (root) {
  root.innerHTML = `<div class="fuel"><div class="big"></div><div class="tank"><i></i></div><div class="grid"></div></div>`;
  const q = (s) => root.querySelector(s);
  let last = '';

  return {
    update(state, ctx) {
      const s = ctx.settings, f = state.fuel, t = ctx.theme;
      if (!f) return;
      const u = state.session ? state.session.units : 'metric';
      const unit = Fmt.fuelUnit(u);
      const laps = f.laps.slice(-s.avgLaps);
      const avg = laps.length ? laps.reduce((a, b) => a + b, 0) / laps.length : 0;
      const lastLap = f.laps.length ? f.laps[f.laps.length - 1] : 0;
      const max = laps.length ? Math.max(...laps) : 0;
      const lapsLeft = avg > 0 ? f.level / avg : null;
      const toGo = f.lapsToGo;
      const need = avg > 0 && toGo !== null ? (toGo + s.safetyMargin) * avg : null;
      const add = need !== null ? Math.max(0, need - f.level) : null;
      const usable = f.max > 0 ? f.max : null;
      const stops = add !== null && usable ? Math.ceil(add / usable - 1e-6) : null;
      const warn = lapsLeft !== null && lapsLeft < s.warnLaps;

      const tankPct = f.max > 0 ? f.level / f.max : f.pct;
      const bar = q('.tank i');
      bar.style.width = (Math.max(0, Math.min(1, tankPct)) * 100).toFixed(1) + '%';
      bar.style.background = warn ? t.red : lapsLeft !== null && toGo !== null && lapsLeft < toGo ? t.yellow : t.green;

      const V = (l) => Fmt.fuel(l, u);
      let big = `<span><b>${V(f.level)}</b><small>${unit}</small></span><span><b class="${warn ? 'red' : ''}">${lapsLeft !== null ? lapsLeft.toFixed(1) : '–'}</b><small>laps</small></span>`;
      let grid = `<span>Avg / lap</span><span>${avg ? V(avg) : '–'}</span>`;
      if (s.showLast) grid += `<span>Last lap</span><span>${lastLap ? V(lastLap) : '–'}</span>`;
      if (s.showMax) grid += `<span>Max lap</span><span>${max ? V(max) : '–'}</span>`;
      grid += `<span>Laps to go</span><span>${toGo !== null ? toGo.toFixed(1) : '–'}</span>`;
      grid += `<span>To finish</span><span>${need !== null ? V(need) : '–'}</span>`;
      grid += `<span>Add at stop</span><span class="${add > 0 ? 'yellow' : 'green'}">${add !== null ? (add > 0 ? '+' + V(Math.min(add, usable || add)) : 'OK') : '–'}</span>`;
      if (s.showStops) grid += `<span>Stops needed</span><span>${stops !== null ? stops : '–'}</span>`;
      if (s.showPerHour) grid += `<span>Per hour</span><span>${f.perHour ? Fmt.fuel(f.perHour / 0.74, u, 1) : '–'}</span>`;
      const html = big + '|' + grid;
      if (html !== last) { q('.big').innerHTML = big; q('.grid').innerHTML = grid; last = html; }
      ctx.setHeaderRight(laps.length ? `${laps.length} lap avg` : 'collecting…');
    },
  };
});
