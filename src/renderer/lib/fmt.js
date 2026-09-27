/* Formatting helpers shared by all widgets. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function lapTime(t, dec = 3) {
    if (!(t > 0) || !Number.isFinite(t)) return '–:––.' + '–'.repeat(dec);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const ss = s.toFixed(dec).padStart(dec + 3, '0');
    return m > 0 ? `${m}:${ss}` : s.toFixed(dec);
  }

  function duration(t) {
    if (t === null || t === undefined || !Number.isFinite(t) || t < 0) return '–';
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function signed(v, dec = 1) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '';
    const s = Math.abs(v).toFixed(dec);
    return (v > 0 ? '+' : v < 0 ? '-' : '±') + s;
  }

  function gap(car, dec = 1) {
    if (car.lapsDown >= 1) return `+${car.lapsDown}L`;
    if (car.gap === null || car.gap === undefined) return '';
    if (car.gap === 0) return 'Leader';
    return '+' + car.gap.toFixed(dec);
  }

  function driverName(car, format) {
    const full = String(car.name || '').trim();
    const parts = full.split(/\s+/);
    const last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
    switch (format) {
      case 'short': return parts.length > 1 ? `${parts[0][0]}. ${last}` : full;
      case 'last': return last;
      case 'abbrev': return (last || full).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase();
      default: return full;
    }
  }

  // License badge: "A 3.45" with iRacing license color.
  function license(car) {
    const lic = String(car.license || '');
    if (!lic) return '';
    const [cls, sr] = lic.split(' ');
    const bg = car.licColor || '#888';
    const fg = contrast(bg);
    return `<span class="lic" style="background:${bg};color:${fg}">${esc(cls)}<small>${esc(sr ? Number(sr).toFixed(1) : '')}</small></span>`;
  }

  function irating(ir) {
    if (!ir) return '';
    return ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : String(ir);
  }

  function contrast(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#000' : '#fff';
  }

  function rgba(hex, a) {
    const c = String(hex || '#000').replace('#', '');
    const r = parseInt(c.substr(0, 2), 16) || 0, g = parseInt(c.substr(2, 2), 16) || 0, b = parseInt(c.substr(4, 2), 16) || 0;
    return `rgba(${r},${g},${b},${a})`;
  }

  function speed(ms, units) { return units === 'imperial' ? ms * 2.23694 : ms * 3.6; }
  function speedUnit(units) { return units === 'imperial' ? 'mph' : 'km/h'; }
  function temp(c, units) {
    if (c === undefined || c === null) return '–';
    return units === 'imperial' ? `${(c * 9 / 5 + 32).toFixed(0)}°F` : `${c.toFixed(1)}°C`;
  }
  function fuel(l, units, dec = 2) {
    if (l === undefined || l === null || !Number.isFinite(l)) return '–';
    return units === 'imperial' ? `${(l / 3.78541).toFixed(dec)}` : `${l.toFixed(dec)}`;
  }
  function fuelUnit(units) { return units === 'imperial' ? 'gal' : 'L'; }

  const TIRES = { 0: 'D', 1: 'W', 2: 'S', 3: 'M', 4: 'H' };

  window.Fmt = { esc, lapTime, duration, signed, gap, driverName, license, irating, contrast, rgba, speed, speedUnit, temp, fuel, fuelUnit, TIRES };
})();
