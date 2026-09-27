Host.register('relative', function (root) {
  root.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column"><div class="rows" style="flex:1;overflow:hidden"></div><div class="footer"></div></div>';
  const rowsEl = root.querySelector('.rows');
  const footer = root.querySelector('.footer');
  let last = '';
  let lastFooter = '';

  function row(c, r, s, cols, isRace) {
    const E = Fmt.esc;
    const cls = [];
    if (!c) return `<tr>${cols.map(() => '<td>&nbsp;</td>').join('')}</tr>`;
    if (c.isPlayer) cls.push('player');
    if (c.onPitRoad) cls.push('inpit');
    let nameCls = '';
    if (s.colorLapping && r && isRace) nameCls = r.lapDiff > 0 ? 'lapping' : r.lapDiff < 0 ? 'lapped' : '';
    const cells = cols.map((col) => {
      switch (col) {
        case 'pos': return `<td class="c-pos ${nameCls}">${c.classPosition || ''}</td>`;
        case 'number': return `<td class="c-number"><span class="classbar" style="background:${c.classColor}"></span><span class="num">#${E(c.number)}</span></td>`;
        case 'name': return `<td class="c-name ${nameCls}">${E(Fmt.driverName(c, s.nameFormat))}</td>`;
        case 'license': return `<td class="c-license">${Fmt.license(c)}</td>`;
        case 'irating': return `<td class="c-irating">${Fmt.irating(c.irating)}</td>`;
        case 'pit': return `<td class="c-pit">${c.onPitRoad ? '<span class="tag pit">PIT</span>' : ''}</td>`;
        case 'last': return `<td class="c-last">${c.lastLap > 0 ? Fmt.lapTime(c.lastLap) : ''}</td>`;
        case 'gap': return `<td class="c-gap ${nameCls}">${r ? Math.abs(r.gap).toFixed(s.gapDecimals) : ''}</td>`;
        default: return '<td></td>';
      }
    });
    return `<tr class="${cls.join(' ')}">${cells.join('')}</tr>`;
  }

  return {
    update(state, ctx) {
      const s = ctx.settings;
      const cols = s.columns.filter((c) => c.on).map((c) => c.id);
      const cars = new Map((state.cars || []).map((c) => [c.idx, c]));
      const me = (state.cars || []).find((c) => c.isPlayer);
      const isRace = state.session && state.session.isRace;
      let rel = state.relative || [];
      if (s.hidePitCars) rel = rel.filter((r) => !cars.get(r.idx).onPitRoad);
      const ahead = rel.filter((r) => r.gap >= 0).slice(-s.ahead);
      const behind = rel.filter((r) => r.gap < 0).slice(0, s.behind);
      let html = '<table class="board">';
      for (let i = 0; i < s.ahead - ahead.length; i++) html += row(null, null, s, cols);
      for (const r of ahead) html += row(cars.get(r.idx), r, s, cols, isRace);
      if (me) html += row(me, { gap: 0, lapDiff: 0 }, s, cols, isRace);
      for (const r of behind) html += row(cars.get(r.idx), r, s, cols, isRace);
      for (let i = 0; i < s.behind - behind.length; i++) html += row(null, null, s, cols);
      html += '</table>';
      if (!me) html = '<div class="center-msg">Not on track</div>';
      if (html !== last) { rowsEl.innerHTML = html; last = html; }

      const ses = state.session || {};
      const p = state.player || {};
      ctx.setHeaderRight(`${Fmt.esc(ses.name || ses.type || '')}`);
      footer.style.display = s.header ? '' : 'none';
      if (s.header) {
        const inc = ses.incidentLimit ? `${p.incidents}/${ses.incidentLimit}x` : `${p.incidents ?? 0}x`;
        const rem = ses.timeRemain !== null && ses.timeRemain !== undefined ? Fmt.duration(ses.timeRemain) : ses.lapsRemain !== null ? `${ses.lapsRemain} laps` : '';
        const f = `<span>P<b>${p.classPosition || '–'}</b>/${p.classCount || '–'}</span><span>SOF <b>${ses.sof || '–'}</b></span><span>Inc <b>${inc}</b></span><span><b>${rem}</b></span>`;
        if (f !== lastFooter) { footer.innerHTML = f; lastFooter = f; }
      }
    },
  };
});
