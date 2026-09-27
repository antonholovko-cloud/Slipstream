Host.register('trackmap', function (root) {
  root.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas><div class="center-msg" style="display:none;align-items:flex-end;padding-bottom:.4rem;font-size:.8rem"></div>';
  const canvas = root.querySelector('canvas');
  const msg = root.querySelector('.center-msg');
  const g = canvas.getContext('2d');
  let cacheKey = '';
  let proj = null; // projected points in px

  function project(points, w, h, s) {
    const rot = (s.rotate * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    let pts = points.map(([x, y]) => {
      const X = (s.mirror ? -x : x) * cos - y * sin;
      const Y = (s.mirror ? -x : x) * sin + y * cos;
      return [X, -Y]; // screen y down
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const pad = s.dotSize * 2 + 4;
    const k = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1));
    const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
    return pts.map(([x, y]) => [ox + (x - minX) * k, oy + (y - minY) * k]);
  }

  function circle(n, w, h, s) {
    const r = Math.min(w, h) / 2 - s.dotSize * 2 - 4;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      pts.push([w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r]);
    }
    return pts;
  }

  function at(pct) {
    const n = proj.length;
    const f = (((pct % 1) + 1) % 1) * n;
    const i = Math.floor(f) % n, j = (i + 1) % n, k = f - Math.floor(f);
    return [proj[i][0] + (proj[j][0] - proj[i][0]) * k, proj[i][1] + (proj[j][1] - proj[i][1]) * k];
  }

  return {
    update(state, ctx) {
      const s = ctx.settings, t = ctx.theme;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); cacheKey = ''; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const tm = state.trackMap || {};
      const key = `${tm.id}|${!!tm.points}|${w}|${h}|${s.rotate}|${s.mirror}|${s.dotSize}`;
      if (key !== cacheKey) {
        proj = tm.points ? project(tm.points, w, h, s) : circle(200, w, h, s);
        cacheKey = key;
      }
      if (!tm.points) {
        msg.style.display = 'flex';
        msg.textContent = tm.learning > 0 ? `Learning track… ${Math.round(tm.learning * 100)}%` : 'Drive a clean lap to learn this track';
      } else msg.style.display = 'none';

      // track outline
      g.lineJoin = 'round';
      g.beginPath();
      proj.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.strokeStyle = Fmt.rgba('#000000', 0.55);
      g.lineWidth = s.trackWidth + 3;
      g.stroke();
      g.strokeStyle = s.trackColor;
      g.lineWidth = s.trackWidth;
      g.stroke();

      if (s.showStartFinish && proj.length > 2) {
        const [x0, y0] = proj[0], [x1, y1] = proj[1];
        const a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
        const L = s.trackWidth * 1.6 + 3;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x0 + Math.cos(a) * L, y0 + Math.sin(a) * L);
        g.lineTo(x0 - Math.cos(a) * L, y0 - Math.sin(a) * L);
        g.stroke();
      }

      // cars (player last so it's on top)
      const cars = (state.cars || []).filter((c) => c.inWorld && c.pct >= 0).sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
      const r = s.dotSize;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const c of cars) {
        const [x, y] = at(c.pct);
        const rr = c.isPlayer ? r * 1.35 : r;
        const col = c.isPlayer ? t.accent : s.classColors ? c.classColor : '#e5e7eb';
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        if (c.onPitRoad) {
          g.fillStyle = Fmt.rgba('#000000', 0.6);
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = col;
          g.stroke();
        } else {
          g.fillStyle = col;
          g.fill();
          g.lineWidth = 1.5;
          g.strokeStyle = c.isPlayer ? '#fff' : 'rgba(0,0,0,.7)';
          g.stroke();
        }
        if (s.showNumbers && rr >= 6) {
          const label = s.showPositions ? String(c.classPosition || '') : String(c.number);
          g.font = `700 ${Math.round(rr * 1.05)}px ${t.font}, sans-serif`;
          g.fillStyle = c.onPitRoad ? col : Fmt.contrast(col.length === 7 ? col : '#ffffff');
          g.fillText(label, x, y + 0.5);
        }
      }
      ctx.setHeaderRight(Fmt.esc((state.session && state.session.track && state.session.track.name) || ''));
    },
  };
});
