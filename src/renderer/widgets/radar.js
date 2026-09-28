/*
 * Proximity radar. Longitudinal positions come from track distance; iRacing only
 * reports *which side* is occupied (CarLeftRight), not exact lateral offset, so
 * cars alongside are drawn in the left/right lane that iRacing flags.
 */
Host.register('radar', function (root) {
  root.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;transition:opacity .35s"></canvas>';
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');
  const CAR_L = 4.6, CAR_W = 1.9, LANE = 2.8; // meters

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // A pleasant guide spacing for the chosen radius (about 2-4 guides per side).
  function guideStep(range) {
    for (const step of [2, 5, 10, 20, 25, 50]) if (range / step <= 4) return step;
    return 50;
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
      const near = radar.cars.filter((c) => Math.abs(c.meters) <= range + CAR_L / 2);
      const st = radar.state;
      const leftN = st === 2 || st === 4 ? 1 : st === 5 ? 2 : 0;
      const rightN = st === 3 || st === 4 ? 1 : st === 6 ? 2 : 0;
      const active = near.length > 0 || leftN || rightN;
      canvas.style.opacity = !s.autoHide || active || ctx.editMode ? '1' : '0';

      const cx = w / 2, cy = h / 2;
      const circle = s.shape !== 'lane';
      const R = circle ? Math.min(w, h) / 2 - 2 : h / 2 - 2; // vertical radius in px
      const scale = R / range; // px per meter
      const k = s.carScale || 1;
      const carW = Math.max(8, CAR_W * scale * k), carL = Math.max(16, CAR_L * scale * k);
      const laneX = Math.max(carW * 1.65, LANE * scale);
      const halfW = circle ? R : Math.min(w / 2 - 2, laneX * 2.4);

      // ---------- panel ----------
      const panelPath = () => {
        g.beginPath();
        if (circle) g.arc(cx, cy, R, 0, Math.PI * 2);
        else roundRect(cx - halfW, cy - R, halfW * 2, R * 2, Math.min(18, halfW * 0.4));
      };
      const alpha = (s.panelOpacity ?? 60) / 100;
      if (alpha > 0) {
        const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(R, halfW));
        bg.addColorStop(0, Fmt.rgba(t.bg, alpha * 0.45));
        bg.addColorStop(0.8, Fmt.rgba(t.bg, alpha * 0.85));
        bg.addColorStop(1, Fmt.rgba(t.bg, alpha));
        panelPath();
        g.fillStyle = bg;
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = Fmt.rgba(t.text, 0.1 * Math.min(1, alpha * 2));
        g.stroke();
      }
      g.save();
      panelPath();
      g.clip();

      // ---------- distance guides ----------
      if (s.guides) {
        const step = guideStep(range);
        g.font = `600 ${Math.max(9, 10 * ((s.scale || 100) / 100))}px ${t.font}, sans-serif`;
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        for (let m = step; m <= range; m += step) {
          for (const sign of [-1, 1]) {
            const y = cy - sign * m * scale;
            const span = circle ? Math.sqrt(Math.max(0, R * R - (y - cy) ** 2)) : halfW;
            g.strokeStyle = Fmt.rgba(t.text, 0.08);
            g.setLineDash([2, 5]);
            g.beginPath(); g.moveTo(cx - span + 6, y); g.lineTo(cx + span - 6, y); g.stroke();
            g.setLineDash([]);
            if (sign === 1) { g.fillStyle = Fmt.rgba(t.text, 0.35); g.fillText(`${m}m`, cx + span - 8, y - 7); }
          }
        }
        // lane hints
        g.strokeStyle = Fmt.rgba(t.text, 0.05);
        for (const side of [-1, 1]) {
          g.beginPath(); g.moveTo(cx + side * laneX / 2, cy - R); g.lineTo(cx + side * laneX / 2, cy + R); g.stroke();
        }
      }

      // ---------- side indicators ----------
      const sideBar = (side, n) => {
        if (!n) return;
        const color = n > 1 ? s.dangerColor : s.warnColor;
        const x = cx + side * (laneX + carW * 0.9);
        const len = carL * 2.4;
        const grad = g.createLinearGradient(0, cy - len / 2, 0, cy + len / 2);
        grad.addColorStop(0, Fmt.rgba(color, 0));
        grad.addColorStop(0.5, Fmt.rgba(color, 0.95));
        grad.addColorStop(1, Fmt.rgba(color, 0));
        g.save();
        g.shadowColor = color;
        g.shadowBlur = 12;
        roundRect(x - 2.5, cy - len / 2, 5, len, 2.5);
        g.fillStyle = grad;
        g.fill();
        g.restore();
        // soft wash on that side
        const wash = g.createRadialGradient(cx + side * laneX, cy, 0, cx + side * laneX, cy, carL * 1.5);
        wash.addColorStop(0, Fmt.rgba(color, 0.22));
        wash.addColorStop(1, Fmt.rgba(color, 0));
        g.fillStyle = wash;
        g.fillRect(0, 0, w, h);
      };
      sideBar(-1, leftN);
      sideBar(1, rightN);

      // ---------- cars ----------
      const alongside = near.filter((c) => Math.abs(c.meters) < CAR_L * 1.3).sort((a, b) => Math.abs(a.meters) - Math.abs(b.meters));
      const lane = new Map();
      let li = 0, ri = 0;
      for (const c of alongside) {
        if (li < leftN && (ri >= rightN || li <= ri)) lane.set(c.idx, -(1 + li * 0.95)), li++;
        else if (ri < rightN) lane.set(c.idx, 1 + ri * 0.95), ri++;
      }
      const drawCar = (x, y, color, opts = {}) => {
        const x0 = x - carW / 2, y0 = y - carL / 2;
        g.save();
        g.shadowColor = opts.glow ? color : 'rgba(0,0,0,.6)';
        g.shadowBlur = opts.glow ? 14 : 6;
        g.shadowOffsetY = opts.glow ? 0 : 2;
        roundRect(x0, y0, carW, carL, Math.min(carW * 0.38, 7));
        const body = g.createLinearGradient(0, y0, 0, y0 + carL);
        body.addColorStop(0, Fmt.rgba(color, opts.alpha ?? 1));
        body.addColorStop(1, Fmt.rgba(color, (opts.alpha ?? 1) * 0.72));
        g.fillStyle = body;
        g.fill();
        g.restore();
        // windscreen hint for a sense of direction
        roundRect(x0 + carW * 0.18, y0 + carL * 0.2, carW * 0.64, carL * 0.18, 2);
        g.fillStyle = 'rgba(0,0,0,.28)';
        g.fill();
        if (opts.outline) { roundRect(x0, y0, carW, carL, Math.min(carW * 0.38, 7)); g.lineWidth = 1.5; g.strokeStyle = opts.outline; g.stroke(); }
        if (opts.label && carW >= 12) {
          g.fillStyle = Fmt.contrast(color);
          g.font = `700 ${Math.round(Math.min(carW * 0.75, carL * 0.36))}px ${t.font}, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(opts.label, x, y + carL * 0.12);
        }
      };
      g.font = `600 ${Math.max(10, 11 * ((s.scale || 100) / 100))}px ${t.font}, sans-serif`;
      let closestAhead = Infinity, closestBehind = Infinity;
      for (const c of near) {
        const l = lane.get(c.idx) || 0;
        const x = cx + l * laneX;
        const y = cy - c.meters * scale;
        const overlap = Math.abs(c.meters) < CAR_L;
        if (!l) { if (c.meters > 0) closestAhead = Math.min(closestAhead, c.meters); else closestBehind = Math.min(closestBehind, -c.meters); }
        const closeness = Math.max(0, 1 - Math.abs(c.meters) / range);
        const color = l && overlap ? s.dangerColor : l ? s.warnColor : s.carColor;
        drawCar(x, y, color, { glow: !!l, alpha: l ? 1 : 0.45 + 0.55 * closeness, label: s.showNumbers ? c.number : '' });
        if (s.showDistance && !l && Math.abs(c.meters) > CAR_L) {
          g.fillStyle = Fmt.rgba(t.text, 0.85);
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(`${Math.abs(c.meters).toFixed(0)}m`, x + carW / 2 + 5, y);
        }
      }
      for (let n = li; n < leftN; n++) drawCar(cx - (1 + n * 0.95) * laneX, cy, s.warnColor, { glow: true });
      for (let n = ri; n < rightN; n++) drawCar(cx + (1 + n * 0.95) * laneX, cy, s.warnColor, { glow: true });

      // front / rear proximity bars on the player car
      const prox = (m, dir) => {
        const gapM = m - CAR_L;
        if (!(gapM < 8)) return;
        const color = gapM < 2 ? s.dangerColor : s.warnColor;
        const y = cy - dir * (carL / 2 + 5);
        g.save();
        g.shadowColor = color;
        g.shadowBlur = 10;
        roundRect(cx - carW * 0.6, y - 1.5, carW * 1.2, 3, 1.5);
        g.fillStyle = Fmt.rgba(color, 0.4 + 0.6 * (1 - Math.max(0, gapM) / 8));
        g.fill();
        g.restore();
      };
      prox(closestAhead, 1);
      prox(closestBehind, -1);

      // player
      drawCar(cx, cy, t.accent, { glow: true, outline: 'rgba(255,255,255,.9)' });
      g.restore();
    },
  };
});
