Host.css(`
.sess { position:absolute; inset:0; display:flex; align-items:center; justify-content:space-around; gap:.6rem; padding:.2rem .6rem; flex-wrap:wrap; }
.sess div { display:flex; flex-direction:column; align-items:center; min-width:0; }
.sess small { color:var(--dim); font-size:.68rem; text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
.sess b { font-size:1.15rem; font-weight:700; white-space:nowrap; }
`);

Host.register('session', function (root) {
  root.innerHTML = '<div class="sess"></div>';
  const el = root.firstChild;
  let last = '';

  function items(state, s) {
    const ses = state.session || {}, p = state.player || {};
    const u = ses.units;
    const out = {};
    out.session = ['Session', Fmt.esc(ses.name || ses.type || '–')];
    if (ses.timeRemain !== null && ses.timeRemain !== undefined) out.remain = ['Time left', Fmt.duration(ses.timeRemain)];
    else if (ses.lapsRemain !== null && ses.lapsRemain !== undefined) out.remain = ['Laps left', ses.lapsRemain];
    else out.remain = ['Remaining', '∞'];
    out.lap = ['Lap', ses.lapsTotal ? `${Math.max(0, p.lap)}/${ses.lapsTotal}` : Math.max(0, p.lap || 0)];
    out.position = ['Position', p.classPosition ? `P${p.classPosition}<span class="dim">/${p.classCount}</span>` : '–'];
    const lim = ses.incidentLimit;
    const inc = p.incidents || 0;
    out.incidents = ['Incidents', `<span class="${lim && inc >= lim * 0.75 ? 'red' : ''}">${inc}x${lim ? `<span class="dim">/${lim}</span>` : ''}</span>`];
    out.sof = ['SOF', ses.sof || '–'];
    out.track = ['Track', Fmt.esc(ses.track ? ses.track.name : '')];
    out.air = ['Air', Fmt.temp(ses.airTemp, u)];
    out.trackTemp = ['Track', Fmt.temp(ses.trackTemp, u)];
    const WET = ['–', 'Dry', 'Mostly dry', 'Very lightly wet', 'Lightly wet', 'Moderately wet', 'Very wet', 'Extremely wet'];
    out.wetness = ['Surface', WET[ses.wetness] || '–'];
    const d = new Date();
    out.clock = ['Time', d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !s.clock24 })];
    if (ses.timeOfDay !== undefined) {
      const tod = ses.timeOfDay % 86400;
      const hh = Math.floor(tod / 3600), mm = Math.floor((tod % 3600) / 60);
      out.simClock = ['Sim time', s.clock24 ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`];
    }
    return out;
  }

  return {
    update(state, ctx) {
      const s = ctx.settings;
      const all = items(state, s);
      const html = s.items.filter((i) => i.on && all[i.id]).map((i) => `<div><small>${all[i.id][0]}</small><b>${all[i.id][1]}</b></div>`).join('');
      if (html !== last) { el.innerHTML = html; last = html; }
    },
  };
});
