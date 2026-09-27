/*
 * Overlay host: one per overlay window. Applies theme / common settings,
 * handles edit-mode drag & resize, and feeds state into the widget.
 */
(function () {
  const widgets = {};
  const id = new URLSearchParams(location.search).get('id');
  const def = Registry.byId(id);
  let payload = null;
  let instance = null;
  let lastState = null;

  const $ = (s) => document.querySelector(s);
  const body = $('#body');

  function register(wid, factory) { widgets[wid] = factory; }

  // Widgets add their own CSS through this so each file is self-contained.
  function css(text) {
    const el = document.createElement('style');
    el.textContent = text;
    document.head.appendChild(el);
  }

  function applyConfig(p) {
    payload = p;
    const s = p.settings, t = p.theme;
    const root = document.documentElement.style;
    const alpha = (s.bgOpacity ?? 85) / 100;
    root.setProperty('--fs', (14 * (s.scale || 100) / 100).toFixed(2) + 'px');
    root.setProperty('--bg', t.bg);
    root.setProperty('--bg-a', Fmt.rgba(t.bg, alpha));
    root.setProperty('--bg-alt', Fmt.rgba(t.bgAlt, Math.min(1, alpha + 0.05)));
    root.setProperty('--header', Fmt.rgba(t.header, Math.min(1, alpha + 0.1)));
    root.setProperty('--text', t.text);
    root.setProperty('--dim', t.dim);
    root.setProperty('--accent', s.accent || t.accent);
    root.setProperty('--player', Fmt.rgba(t.player, Math.max(0.6, alpha)));
    for (const k of ['purple', 'green', 'red', 'yellow', 'blue', 'border']) root.setProperty('--' + k, t[k]);
    root.setProperty('--radius', (t.radius ?? 6) + 'px');
    root.setProperty('--font', `'${t.font}'`);
    document.body.classList.toggle('no-header', !s.showHeader);
    document.body.classList.toggle('edit', !!p.editMode);
    $('#title').textContent = def.name;
    $('#edit-label').textContent = `${def.icon} ${def.name}  ·  ${s.bounds.width}×${s.bounds.height}`;

    const ctx = context();
    if (!instance && widgets[id]) instance = widgets[id](body, ctx);
    if (instance && instance.configure) instance.configure(ctx);
    if (lastState) render(lastState);
  }

  function context() {
    return {
      settings: payload.settings,
      theme: payload.theme,
      global: payload.global,
      editMode: payload.editMode,
      setHeaderRight: (html) => { const el = $('#header-right'); if (el.innerHTML !== html) el.innerHTML = html; },
    };
  }

  function render(state) {
    lastState = state;
    if (!instance) return;
    try {
      instance.update(state, context());
    } catch (e) {
      console.error(e);
    }
  }

  // ---- edit mode: move & resize via pointer capture ----
  function setupEditing() {
    let drag = null;
    const start = async (e, mode) => {
      if (!payload || !payload.editMode || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const b = await window.api.invoke('overlay:getBounds');
      drag = { mode, sx: e.screenX, sy: e.screenY, b, target: e.currentTarget, pid: e.pointerId };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
      window.api.send('overlay:setBounds', id, next(drag, dx, dy), false);
    };
    const end = (e) => {
      if (!drag) return;
      const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
      window.api.send('overlay:setBounds', id, next(drag, dx, dy), true);
      try { drag.target.releasePointerCapture(drag.pid); } catch (_) {}
      drag = null;
    };
    const next = (d, dx, dy) => d.mode === 'move'
      ? { x: d.b.x + dx, y: d.b.y + dy, width: d.b.width, height: d.b.height }
      : { x: d.b.x, y: d.b.y, width: d.b.width + dx, height: d.b.height + dy };

    const grip = $('#grip');
    grip.addEventListener('pointerdown', (e) => start(e, 'resize'));
    document.body.addEventListener('pointerdown', (e) => { if (e.target !== grip) start(e, 'move'); });
    for (const el of [grip, document.body]) {
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    // keyboard nudging in edit mode
    window.addEventListener('keydown', async (e) => {
      if (!payload || !payload.editMode) return;
      const step = e.shiftKey ? 10 : 1;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!map[e.key]) return;
      const b = await window.api.invoke('overlay:getBounds');
      const [dx, dy] = map[e.key];
      const nb = e.ctrlKey ? { ...b, width: b.width + dx, height: b.height + dy } : { ...b, x: b.x + dx, y: b.y + dy };
      window.api.send('overlay:setBounds', id, nb, true);
    });
  }

  async function start() {
    setupEditing();
    window.api.on('overlay:config', applyConfig);
    window.api.on('overlay:state', render);
    applyConfig(await window.api.invoke('overlay:init', id));
  }

  window.Host = { register, css, start };
})();
