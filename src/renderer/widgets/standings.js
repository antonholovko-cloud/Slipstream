Host.register('standings', function (root) {
  root.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column"><div class="scroll" style="flex:1;overflow:hidden"></div><div class="footer"></div></div>';
  const list = root.querySelector('.scroll');
  const footer = root.querySelector('.footer');
  let lastHtml = '';
  let lastFooter = '';

  function cell(col, c, s, cls) {
    const E = Fmt.esc;
    switch (col) {
      case 'pos': return `<td class="c-pos">${c.position || c.classPosition || ''}</td>`;
      case 'classPos': return `<td class="c-classPos">${c.classPosition || ''}</td>`;
      case 'posGain': {
        const g = c.posGain;
        if (!g) return `<td class="c-posGain dim">${g === 0 ? '–' : ''}</td>`;
        return `<td class="c-posGain ${g > 0 ? 'green' : 'red'}">${g > 0 ? '▲' : '▼'}${Math.abs(g)}</td>`;
      }
      case 'class': return `<td class="c-class"><span class="tag cls" style="background:${c.classColor};color:${Fmt.contrast(c.classColor)}">${E(c.className)}</span></td>`;
      case 'number': return `<td class="c-number"><span class="classbar" style="background:${c.classColor}"></span><span class="num">#${E(c.number)}</span></td>`;
      case 'flag': return `<td class="c-flag">${c.flag ? `<img class="flag" src="flags/${E(c.flag)}.png" alt="" title="${E(c.country)}">` : ''}</td>`;
      case 'name': {
        const tag = c.onPitRoad ? ' <span class="tag pit">PIT</span>' : !c.inWorld && s.isRace ? ' <span class="tag out">OUT</span>' : '';
        return `<td class="c-name">${E(Fmt.driverName(c, s.nameFormat))}${tag}</td>`;
      }
      case 'team': return `<td class="c-team">${E(c.team)}</td>`;
      case 'car': return `<td class="c-car">${E(c.car)}</td>`;
      case 'license': return `<td class="c-license">${Fmt.license(c)}</td>`;
      case 'irating': return `<td class="c-irating">${Fmt.irating(c.irating)}</td>`;
      case 'irDelta': {
        const d = c.irDelta;
        if (d === null || d === undefined) return '<td class="c-irDelta"></td>';
        return `<td class="c-irDelta ${d > 0 ? 'green' : d < 0 ? 'red' : 'dim'}">${d > 0 ? '+' : ''}${d}</td>`;
      }
      case 'pit': return `<td class="c-pit">${c.pitStops || ''}</td>`;
      case 'lap': return `<td class="c-lap">${c.lapCompleted > 0 ? c.lapCompleted : ''}</td>`;
      case 'gap': return `<td class="c-gap">${Fmt.gap(c, 1)}</td>`;
      case 'interval': {
        if (c.interval === null || c.interval === undefined) return '<td class="c-interval"></td>';
        return `<td class="c-interval">${c.interval.toFixed(1)}</td>`;
      }
      case 'last': {
        const purple = s.highlightFastest && c.lastLap > 0 && c.lastLap === cls.bestLap;
        const pb = c.lastLap > 0 && c.lastLap === c.bestLap;
        return `<td class="c-last ${purple ? 'purple' : pb ? 'green' : ''}">${c.lastLap > 0 ? Fmt.lapTime(c.lastLap) : ''}</td>`;
      }
      case 'best': return `<td class="c-best ${s.highlightFastest && c.fastest ? 'purple' : ''}">${c.bestLap > 0 ? Fmt.lapTime(c.bestLap) : ''}</td>`;
      case 'tire': return `<td class="c-tire">${c.tire >= 0 ? (Fmt.TIRES[c.tire] || c.tire) : ''}</td>`;
      default: return '<td></td>';
    }
  }

  // Choose which rows to show: first `max`, or top rows + a window around the player.
  function windowRows(cars, s) {
    const max = s.maxRows;
    if (cars.length <= max) return cars;
    const pi = cars.findIndex((c) => c.isPlayer);
    if (!s.keepPlayerVisible || pi < max) return cars.slice(0, max);
    const top = Math.min(s.topRows, max - 3);
    const rest = max - top;
    let from = Math.max(top, pi - Math.floor(rest / 2));
    from = Math.min(from, cars.length - rest);
    return cars.slice(0, top).concat([null], cars.slice(from, from + rest));
  }

  return {
    update(state, ctx) {
      const s = Object.assign({}, ctx.settings, { isRace: state.session && state.session.isRace });
      const cols = s.columns.filter((c) => c.on).map((c) => c.id);
      let cars = state.cars || [];
      if (!s.showOutOfCar) cars = cars.filter((c) => c.inWorld || c.isPlayer);
      const classes = state.classes || [];
      const groups = s.multiclass && classes.length > 1
        ? classes.map((k) => ({ k, cars: cars.filter((c) => c.classId === k.id).sort((a, b) => a.classPosition - b.classPosition) }))
        : [{ k: classes.length === 1 ? classes[0] : { bestLap: Math.min(...classes.map((k) => k.bestLap > 0 ? k.bestLap : 1e9)) }, cars: cars.slice().sort((a, b) => (a.position || 999) - (b.position || 999) || a.classPosition - b.classPosition), single: true }];

      let html = '<table class="board">';
      for (const g of groups) {
        if (!g.cars.length) continue;
        if (!g.single && s.showClassHeader) {
          html += `<tr class="class-head"><td colspan="${cols.length}"><span class="bar" style="background:${g.k.color}"></span>${Fmt.esc(g.k.name)} <span>· ${g.cars.length} cars · SOF ${g.k.sof}</span></td></tr>`;
        }
        for (const c of windowRows(g.cars, s)) {
          if (!c) { html += `<tr class="sep"><td colspan="${cols.length}">···</td></tr>`; continue; }
          const rc = [c.isPlayer ? 'player' : '', c.onPitRoad ? 'inpit' : '', !c.inWorld && s.isRace ? 'gone' : ''].join(' ');
          html += `<tr class="${rc}">` + cols.map((col) => cell(col, c, s, g.k)).join('') + '</tr>';
        }
      }
      html += '</table>';
      if (html !== lastHtml) { list.innerHTML = html; lastHtml = html; }

      const ses = state.session || {};
      ctx.setHeaderRight(Fmt.esc(ses.name || ses.type || ''));
      footer.style.display = s.footer ? '' : 'none';
      if (s.footer) {
        const laps = ses.lapsTotal ? `Lap <b>${Math.max(ses.leaderLap, 0)}</b>/${ses.lapsTotal}` : `Lap <b>${Math.max(ses.leaderLap, 0)}</b>`;
        const time = ses.timeRemain !== null && ses.timeRemain !== undefined ? `<b>${Fmt.duration(ses.timeRemain)}</b> left` : '';
        const f = `<span>SOF <b>${ses.sof || '–'}</b></span><span>${laps}</span><span>${time}</span><span>${(state.cars || []).length} cars</span>`;
        if (f !== lastFooter) { footer.innerHTML = f; lastFooter = f; }
      }
    },
  };
});
