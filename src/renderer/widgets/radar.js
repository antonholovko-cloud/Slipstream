Host.register('radar', function (root) {
  root.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%;transition:opacity .25s"></canvas>';
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');
  const CAR_L = 4.6, CAR_W = 1.9, LANE = 2.6;

  function roundRect(x, y, w, h, r) {
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

      const near = radar.cars.filter((c) => Math.abs(c.meters) <= s.range);
      const st = radar.state;
      const leftN = st === 2 || st === 4 ? 1 : st === 5 ? 2 : 0;
      const rightN = st === 3 || st === 4 ? 1 : st === 6 ? 2 : 0;
      const active = near.length > 0 || leftN || rightN;
      canvas.style.opacity = !s.autoHide || active || ctx.editMode ? '1' : '0';

      const scale = (h / 2 - 4) / s.range; // px per meter
      const cx = w / 2, cy = h / 2;

      // range rings / background
      g.strokeStyle = Fmt.rgba(t.text, 0.12);
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(cx, cy, Math.min(w / 2 - 2, s.range * scale), s.range * scale, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(cx, 4); g.lineTo(cx, h - 4); g.stroke();
      g.setLineDash([]);

      // side warning glow: a soft radial wash on the occupied side, clipped to the radar
      const rx = Math.min(w / 2 - 2, s.range * scale), ry = s.range * scale;
      g.save();
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.clip();
      const glow = (side, n) => {
        if (!n) return;
        const gx = cx + side * rx * 0.75;
        const grad = g.createRadialGradient(gx, cy, 0, gx, cy, ry * 0.6);
        grad.addColorStop(0, Fmt.rgba(n > 1 ? s.dangerColor : s.warnColor, 0.5));
        grad.addColorStop(1, Fmt.rgba(s.warnColor, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      };
      glow(-1, leftN);
      glow(1, rightN);
      g.restore();

      // Assign cars alongside (|m| < car length) to sides reported by iRacing.
      const alongside = near.filter((c) => Math.abs(c.meters) < CAR_L * 1.4).sort((a, b) => Math.abs(a.meters) - Math.abs(b.meters));
      const sides = new Map();
      let li = 0, ri = 0;
      for (const c of alongside) {
        if (li < leftN && (ri >= rightN || c.meters >= 0 || li <= ri)) { sides.set(c.idx, -1 * (1 + li * 0.9)); li++; }
        else if (ri < rightN) { sides.set(c.idx, 1 + ri * 0.9); ri++; }
      }
      // placeholder cars when iRacing reports a side but no car is in our list
      const drawCar = (x, y, color, outline) => {
        roundRect(x - (CAR_W * scale) / 2, y - (CAR_L * scale) / 2, CAR_W * scale, CAR_L * scale, 3);
        g.fillStyle = color;
        g.fill();
        if (outline) { g.lineWidth = 2; g.strokeStyle = outline; g.stroke(); }
      };
      for (const c of near) {
        const lane = sides.get(c.idx) || 0;
        const x = cx + lane * LANE * scale;
        const y = cy - c.meters * scale;
        const overlap = Math.abs(c.meters) < CAR_L;
        const color = lane && overlap ? s.dangerColor : lane ? s.warnColor : Fmt.rgba(s.carColor, 0.35 + 0.65 * (1 - Math.abs(c.meters) / s.range));
        drawCar(x, y, color);
        if (s.showDistance && !lane && Math.abs(c.meters) > CAR_L) {
          g.fillStyle = t.text;
          g.font = `600 ${Math.max(9, 11 * (ctx.settings.scale / 100))}px ${t.font}, sans-serif`;
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(`${Math.abs(c.meters).toFixed(0)}m`, x + CAR_W * scale, y);
        }
      }
      for (let k = li; k < leftN; k++) drawCar(cx - (1 + k * 0.9) * LANE * scale, cy, s.warnColor);
      for (let k = ri; k < rightN; k++) drawCar(cx + (1 + k * 0.9) * LANE * scale, cy, s.warnColor);

      // player
      drawCar(cx, cy, t.accent, Fmt.rgba('#ffffff', 0.9));
    },
  };
});
