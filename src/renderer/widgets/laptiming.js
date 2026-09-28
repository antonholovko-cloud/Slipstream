/*
 * Lap Timing: live sectors for the current lap, last/best/optimal and a lap log.
 * Sector colors: purple = session best (any car), green = personal best, yellow = slower.
 */
Host.css(`
.lt { position:absolute; inset:0; display:flex; flex-direction:column; padding:.4rem .5rem; gap:.4rem; }
.lt .cur { display:flex; gap:.3rem; flex:none; }
.lt .box { flex:1; min-width:0; border-radius:5px; background:rgba(255,255,255,.05); padding:.18rem .4rem .22rem; display:flex; flex-direction:column; border-bottom:2px solid transparent; }
.lt .box small { font-size:.62rem; letter-spacing:.07em; text-transform:uppercase; color:var(--dim); font-weight:700; }
.lt .box b { font-size:1.05rem; font-weight:700; line-height:1.15; white-space:nowrap; }
.lt .box.lap { flex:1.25; }
.lt .box.active { border-bottom-color:var(--accent); }
.lt .box.active b { color:var(--dim); }
.lt .box.purple { background:color-mix(in srgb, var(--purple) 22%, transparent); border-bottom-color:var(--purple); }
.lt .box.green { background:color-mix(in srgb, var(--green) 20%, transparent); border-bottom-color:var(--green); }
.lt .box.yellow { background:color-mix(in srgb, var(--yellow) 16%, transparent); border-bottom-color:var(--yellow); }
.lt .sum { display:flex; justify-content:space-between; gap:.5rem; font-size:.85rem; flex:none; padding:0 .15rem; }
.lt .sum span { white-space:nowrap; color:var(--dim); }
.lt .sum b { color:var(--text); font-weight:700; }
.lt .logwrap { flex:1; min-height:0; overflow:hidden; }
.lt table { width:100%; border-collapse:collapse; font-size:.85rem; font-weight:600; }
.lt th { font-size:.6rem; letter-spacing:.07em; text-transform:uppercase; color:var(--dim); font-weight:700; text-align:right; padding:0 .3rem .1rem; }
.lt td { text-align:right; padding:0 .3rem; height:1.35rem; white-space:nowrap; }
.lt th:first-child, .lt td:first-child { text-align:left; color:var(--dim); }
.lt tr:nth-child(even) td { background:var(--bg-alt); }
.lt td.purple { color:var(--purple); } .lt td.green { color:var(--green); } .lt td.yellow { color:var(--yellow); }
.lt tr.bad td { opacity:.5; }
.lt .flag { font-size:.62rem; font-weight:700; padding:0 .25rem; border-radius:3px; margin-left:.25rem; vertical-align:1px; }
.lt .flag.off { background:var(--red); color:#fff; }
.lt .flag.pit { background:var(--yellow); color:#000; }
`);

Host.register('laptiming', function (root) {
  root.innerHTML = '<div class="lt"><div class="cur"></div><div class="sum"></div><div class="logwrap"></div></div>';
  const q = (s) => root.querySelector(s);
  const cache = { cur: '', sum: '', log: '' };
  const set = (sel, html) => { if (cache[sel] !== html) { q('.' + (sel === 'log' ? 'logwrap' : sel)).innerHTML = html; cache[sel] = html; } };

  return {
    update(state, ctx) {
      const s = ctx.settings;
      const tm = state.timing;
      if (!tm) return;
      const dec = s.decimals;
      const n = tm.starts.length;
      const pb = tm.personalBest, sb = tm.sessionBest;
      const fmt = (x) => (x > 0 ? (x < 60 ? x.toFixed(dec) : Fmt.lapTime(x, dec)) : '–');
      const cls = (x, k) => {
        if (!s.colorSectors || !(x > 0)) return '';
        if (sb[k] > 0 && x <= sb[k] + 0.0005) return 'purple';
        if (pb[k] > 0 && x <= pb[k] + 0.0005) return 'green';
        return 'yellow';
      };

      // current lap
      q('.cur').style.display = s.showCurrent ? '' : 'none';
      if (s.showCurrent) {
        const c = tm.current;
        let html = `<div class="box lap"><small>Lap</small><b>${c && c.timed ? Fmt.lapTime(c.lapRunning, 1) : '–'}</b></div>`;
        for (let k = 0; k < n; k++) {
          const done = c && c.times[k] > 0 && c.sector !== k ? c.times[k] : null;
          if (c && c.timed && c.sector === k) html += `<div class="box active"><small>S${k + 1}</small><b>${c.running !== null ? c.running.toFixed(1) : '–'}</b></div>`;
          else html += `<div class="box ${done ? cls(done, k) : ''}"><small>S${k + 1}</small><b>${done ? fmt(done) : '–'}</b></div>`;
        }
        set('cur', html);
      }

      // last / best / optimal
      q('.sum').style.display = s.showSummary ? '' : 'none';
      const last = tm.log.length ? tm.log[tm.log.length - 1] : null;
      if (s.showSummary) {
        set('sum', `<span>Last <b>${last ? Fmt.lapTime(last.time, dec) : '–'}</b></span><span>Best <b class="green">${tm.bestLap ? Fmt.lapTime(tm.bestLap, dec) : '–'}</b></span><span>Optimal <b class="purple">${tm.optimal ? Fmt.lapTime(tm.optimal, dec) : '–'}</b></span>`);
      }

      // lap log, newest first
      q('.logwrap').style.display = s.showLog ? '' : 'none';
      if (s.showLog) {
        const u = state.session ? state.session.units : 'metric';
        const rows = tm.log.slice(-s.logRows).reverse();
        let head = '<tr><th>Lap</th><th>Time</th>';
        if (s.logDelta) head += '<th>Δ</th>';
        if (s.logSectors) for (let k = 0; k < n; k++) head += `<th>S${k + 1}</th>`;
        if (s.logFuel) head += `<th>${Fmt.fuelUnit(u)}</th>`;
        head += '</tr>';
        let body = '';
        for (const e of rows) {
          const bad = e.off || e.pit;
          const flags = (e.off ? '<span class="flag off">OFF</span>' : '') + (e.pit ? '<span class="flag pit">PIT</span>' : '');
          const best = !bad && tm.bestLap && Math.abs(e.time - tm.bestLap) < 0.0005;
          let r = `<tr class="${bad ? 'bad' : ''}"><td>${e.lap > 0 ? e.lap : ''}${flags}</td><td class="${best ? 'green' : ''}">${Fmt.lapTime(e.time, dec)}</td>`;
          if (s.logDelta) r += `<td class="${best ? 'green' : ''}">${tm.bestLap ? (best ? '–' : Fmt.signed(e.time - tm.bestLap, Math.min(dec, 2))) : ''}</td>`;
          if (s.logSectors) for (let k = 0; k < n; k++) r += `<td class="${bad ? '' : cls(e.sectors[k], k)}">${fmt(e.sectors[k])}</td>`;
          if (s.logFuel) r += `<td>${e.fuel > 0 ? Fmt.fuel(e.fuel, u) : ''}</td>`;
          body += r + '</tr>';
        }
        if (!rows.length) body = `<tr><td colspan="9" style="text-align:center;color:var(--dim);padding-top:.4rem">Complete a lap to start the log</td></tr>`;
        set('log', `<table>${head}${body}</table>`);
      }
      ctx.setHeaderRight(tm.optimal ? `Optimal ${Fmt.lapTime(tm.optimal, dec)}` : '');
    },
  };
});
