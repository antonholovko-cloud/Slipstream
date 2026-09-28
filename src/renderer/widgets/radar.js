/*
 * Proximity radar. Longitudinal positions come from track distance; iRacing only
 * reports *which side* is occupied (CarLeftRight), not exact lateral offset, so
 * cars alongside are drawn in the left/right lane that iRacing flags.
 */
Host.register('radar', function (root) {
  root.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;transition:opacity .3s"></canvas>';
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');
  const CAR_L = 4.6, CAR_W = 1.9, LANE = 2.8; // meters

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  return {
    update(state, ctx) {
      const s = ctx.settings, t = ctx.theme;
      const radar = state.radar || { state: 0, cars: [] };
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const range = s.range;
      const near = radar.cars.filter((c) => Math.abs(c.meters) <= range + CAR_L);
      const st = radar.state;
      const leftN = st === 2 || st === 4 ? 1 : st === 5 ? 2 : 0;
      const rightN = st === 3 || st === 4 ? 1 : st === 6 ? 2 : 0;
      const active = near.length > 0 || leftN || rightN;
      canvas.style.opacity = !s.autoHide || active || ctx.editMode ? '1' : '0';

      const cx = w / 2, cy = h / 2;
      const scope = s.style !== 'minimal';
      const R = scope ? Math.min(w, h) / 2 - 3 : h / 2 - 3;
      const scale = R / range; // px per meter
      const k = s.carScale || 1;
      const carW = Math.max(7, CAR_W * scale * k), carL = Math.max(14, CAR_L * scale * k);
      const laneX = Math.max(carW * 1.3, LANE * scale);

      // ---------- scope ----------
      g.save();
      g.beginPath();
      if (scope) g.arc(cx, cy, R, 0, Math.PI * 2);
      else g.rect(cx - laneX * 2.6, 0, laneX * 5.2, h);
      g.clip();
      if (scope) {
        const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
        bg.addColorStop(0, Fmt.rgba(t.bg, (s.scopeOpacity / 100) * 0.7));
        bg.addColorStop(1, Fmt.rgba(t.bg, s.scopeOpacity / 100));
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        // sweep
        if (s.sweep && g.createConicGradient) {
          const a = ((performance.now() / 1000) * Math.PI * 1.2) % (Math.PI * 2);
          const cg = g.createConicGradient(a, cx, cy);
          cg.addColorStop(0, Fmt.rgba(s.scopeColor, 0.28));
          cg.addColorStop(0.12, Fmt.rgba(s.scopeColor, 0));
          cg.addColorStop(1, Fmt.rgba(s.scopeColor, 0));
          g.fillStyle = cg;
          g.fillRect(0, 0, w, h);
        }
        // rings + crosshair
        g.strokeStyle = Fmt.rgba(s.scopeColor, 0.35);
        g.lineWidth = 1;
        for (let i = 1; i <= s.rings; i++) {
          g.beginPath();
          g.arc(cx, cy, (R * i) / (s.rings + (s.rings ? 0 : 1)), 0, Math.PI * 2);
          g.stroke();
        }
        g.strokeStyle = Fmt.rgba(s.scopeColor, 0.18);
        g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      }

      // side warning glow
      const glow = (side, n) => {
        if (!n) return;
        const gx = cx + side * laneX;
        const grad = g.createRadialGradient(gx, cy, 0, gx, cy, carL * 1.6);
        grad.addColorStop(0, Fmt.rgba(n > 1 ? s.dangerColor : s.warnColor, 0.55));
        grad.addColorStop(1, Fmt.rgba(s.warnColor, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      };
      glow(-1, leftN);
      glow(1, rightN);

      // ---------- cars ----------
      // Cars within ~a car length are alongside; put them in the lanes iRacing flags.
      const alongside = near.filter((c) => Math.abs(c.meters) < CAR_L * 1.3).sort((a, b) => Math.abs(a.meters) - Math.abs(b.meters));
      const lane = new Map();
      let li = 0, ri = 0;
      for (const c of alongside) {
        if (li < leftN && (ri >= rightN || li <= ri)) lane.set(c.idx, -(1 + li * 0.95)), li++;
        else if (ri < rightN) lane.set(c.idx, 1 + ri * 0.95), ri++;
      }
      const drawCar = (x, y, fill, stroke, label) => {
        roundRect(x - carW / 2, y - carL / 2, carW, carL, Math.min(4, carW / 3));
        g.fillStyle = fill;
        g.fill();
        if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
        if (label && carW >= 12) {
          g.save();
          g.fillStyle = Fmt.contrast(fill.startsWith('#') ? fill : '#e5e7eb');
          g.font = `700 ${Math.round(Math.min(carW * 0.8, carL * 0.4))}px ${t.font}, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(label, x, y + 1);
          g.restore();
        }
      };
      g.font = `600 ${Math.max(10, 11 * ((s.scale || 100) / 100))}px ${t.font}, sans-serif`;
      for (const c of near) {
        const l = lane.get(c.idx) || 0;
        const x = cx + l * laneX;
        const y = cy - c.meters * scale;
        const overlap = Math.abs(c.meters) < CAR_L;
        const closeness = Math.max(0, 1 - Math.abs(c.meters) / range);
        const fill = l && overlap ? s.dangerColor : l ? s.warnColor : Fmt.rgba(s.carColor, 0.4 + 0.6 * closeness);
        drawCar(x, y, fill, null, s.showNumbers ? c.number : '');
        if (s.showDistance && !l && Math.abs(c.meters) > CAR_L) {
          g.fillStyle = t.text;
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(`${Math.abs(c.meters).toFixed(0)}m`, x + carW / 2 + 4, y);
        }
      }
      // iRacing reports a side but the car isn't in our distance list: draw it alongside.
      for (let n = li; n < leftN; n++) drawCar(cx - (1 + n * 0.95) * laneX, cy, s.warnColor);
      for (let n = ri; n < rightN; n++) drawCar(cx + (1 + n * 0.95) * laneX, cy, s.warnColor);

      // player
      drawCar(cx, cy, t.accent, '#ffffff');
      g.restore();

      // ring labels (outside the clip so they stay crisp)
      if (scope && s.ringLabels && s.rings > 0) {
        g.fillStyle = Fmt.rgba(s.scopeColor, 0.85);
        g.font = `600 ${Math.max(9, 10 * ((s.scale || 100) / 100))}px ${t.font}, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        for (let i = 1; i <= s.rings; i++) {
          const r = (R * i) / s.rings;
          g.fillText(`${Math.round((range * i) / s.rings)}m`, cx + r * 0.7071 + 10, cy - r * 0.7071 + 2);
        }
      }
    },
  };
});
