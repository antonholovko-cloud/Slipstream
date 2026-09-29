(function () {
  const R = window.Registry;
  const api = window.api;
  let cfg = null;
  let status = {};
  let hotkeyErrors = [];
  let displays = [];
  let page = new URLSearchParams(location.search).get('page') || 'home';
  let localEchoes = 0;
  let update = null; // updater state from the main process

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const profile = () => cfg.profiles[cfg.activeProfile];
  const ov = (id) => profile().overlays[id];
  const keyLabel = (acc) => String(acc || '').replace(/CommandOrControl/g, 'Ctrl');

  function setOverlay(id, patch) { localEchoes++; Object.assign(ov(id), patch); return api.invoke('settings:setOverlay', id, patch); }
  function setGlobal(patch) { localEchoes++; Object.assign(cfg.global, patch); return api.invoke('settings:setGlobal', patch); }

  // ---------------- nav ----------------
  function renderNav() {
    $('#profile-name').textContent = 'Profile: ' + profile().name;
    const main = [['home', '▦', 'Overview'], ['appearance', '🎨', 'Appearance'], ['general', '⚙', 'General & hotkeys'], ['profiles', '💾', 'Layouts & profiles']];
    $('#nav-main').innerHTML = main.map(([id, ico, label]) => `<a data-page="${id}" class="${page === id ? 'active' : ''}"><span class="ico">${ico}</span><span class="grow">${label}</span></a>`).join('');
    $('#nav-overlays').innerHTML = R.OVERLAYS.map((d) => {
      const on = ov(d.id).enabled;
      return `<a data-page="ov:${d.id}" class="${page === 'ov:' + d.id ? 'active' : ''} ${on ? '' : 'off'}"><span class="ico">${d.icon}</span><span class="grow">${d.name}</span>
        <label class="sw" data-toggle="${d.id}"><input type="checkbox" ${on ? 'checked' : ''}><span></span></label></a>`;
    }).join('');
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.nonav')) return;
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      if (e.target.tagName === 'INPUT') {
        const id = tg.dataset.toggle;
        setOverlay(id, { enabled: e.target.checked }).then(() => { renderNav(); if (page === 'home' || page === 'ov:' + id) renderPage(); });
      }
      return;
    }
    const a = e.target.closest('[data-page]');
    if (a) { page = a.dataset.page; renderNav(); renderPage(); }
  });

  function renderStatus() {
    const s = status;
    const el = $('#status');
    el.className = 'pill ' + (s.source === 'iracing' ? 'live' : s.source === 'demo' ? 'demo' : '');
    el.innerHTML = `<i></i>${s.source === 'iracing' ? `Connected to iRacing${s.track ? ' · ' + esc(s.track) : ''}${s.session ? ' · ' + esc(s.session) : ''}` : s.source === 'demo' ? 'Demo data (iRacing not running)' : 'Waiting for iRacing…'}`;
    const be = $('#btn-edit');
    be.textContent = s.editMode ? '✓ Done editing' : '✥ Edit layout';
    be.classList.toggle('on', !!s.editMode);
    $('#btn-hide').textContent = s.hidden ? '👁 Show overlays' : '🙈 Hide overlays';
  }

  function renderSaved() {
    const el = $('#saved');
    if (!lastSaved) { el.textContent = '✓ Changes save automatically'; return; }
    el.textContent = '✓ Saved ' + new Date(lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }
  $('#btn-edit').onclick = () => api.invoke('settings:setEditMode', !status.editMode);
  $('#btn-hide').onclick = () => api.invoke('settings:setHidden', !status.hidden);

  // ---------------- field builders ----------------
  function field(f, value, onChange) {
    const wrap = h(`<div class="field"><label>${esc(f.label)}</label><div class="ctl"></div></div>`);
    const ctl = $('.ctl', wrap);
    switch (f.type) {
      case 'bool': {
        const el = h(`<label class="sw"><input type="checkbox" ${value ? 'checked' : ''}><span></span></label>`);
        $('input', el).onchange = (e) => onChange(e.target.checked);
        ctl.append(el);
        break;
      }
      case 'number': {
        const el = h(`<input type="number" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}" value="${value}">`);
        el.oninput = () => { const v = parseFloat(el.value); if (Number.isFinite(v)) onChange(Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v))); };
        ctl.append(el);
        break;
      }
      case 'range': {
        // slider plus an editable number box, kept in sync
        const el = h(`<input type="range" min="${f.min}" max="${f.max}" step="${f.step ?? 1}" value="${value}">`);
        const box = h(`<input type="number" class="rangebox" min="${f.min}" max="${f.max}" step="${f.step ?? 1}" value="${value}">`);
        el.oninput = () => { box.value = el.value; onChange(parseFloat(el.value)); };
        box.oninput = () => {
          const v = parseFloat(box.value);
          if (!Number.isFinite(v)) return;
          const c = Math.max(f.min, Math.min(f.max, v));
          el.value = c;
          onChange(c);
        };
        box.onblur = () => { box.value = el.value; };
        ctl.append(el, box);
        break;
      }
      case 'color': {
        const el = h(`<input type="color" value="${value || '#e11d48'}">`);
        el.oninput = () => onChange(el.value);
        ctl.append(el);
        if (f.allowEmpty) {
          const clr = h(`<button class="btn small ghost" title="Use theme color">${value ? 'Reset' : 'Theme'}</button>`);
          clr.onclick = () => { onChange(''); clr.textContent = 'Theme'; };
          el.addEventListener('input', () => { clr.textContent = 'Reset'; });
          ctl.append(clr);
        }
        break;
      }
      case 'select': {
        const el = h(`<select>${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
        el.onchange = () => onChange(el.value);
        ctl.append(el);
        break;
      }
      case 'text': {
        const el = h(`<input type="text" value="${esc(value)}">`);
        el.oninput = () => onChange(el.value);
        ctl.append(el);
        break;
      }
      case 'columns':
        return columnsEditor(f, value, onChange);
      default: break;
    }
    return wrap;
  }

  // Drag-and-drop reorderable column list with toggles.
  function columnsEditor(f, value, onChange) {
    const wrap = h(`<div class="field" style="flex-direction:column;align-items:stretch"><label>${esc(f.label)} <span style="color:var(--dim);font-size:12px">— drag to reorder</span></label><div class="cols"></div></div>`);
    const list = $('.cols', wrap);
    let cols = value.map((c) => ({ ...c }));
    const label = (id) => (f.columns.find((c) => c.id === id) || {}).label || id;
    const commit = () => { onChange(cols.map((c) => ({ ...c }))); draw(); };
    let dragFrom = -1;
    function draw() {
      list.innerHTML = '';
      cols.forEach((c, i) => {
        const it = h(`<div class="col-item ${c.on ? '' : 'off'}" draggable="true">
          <span class="handle">⋮⋮</span>
          <label class="sw"><input type="checkbox" ${c.on ? 'checked' : ''}><span></span></label>
          <span class="grow">${esc(label(c.id))}</span>
          <button title="Move up">▲</button><button title="Move down">▼</button></div>`);
        $('input', it).onchange = (e) => { c.on = e.target.checked; commit(); };
        const [up, down] = it.querySelectorAll('button');
        up.onclick = () => { if (i > 0) { [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; commit(); } };
        down.onclick = () => { if (i < cols.length - 1) { [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]]; commit(); } };
        it.addEventListener('dragstart', () => { dragFrom = i; it.classList.add('dragging'); });
        it.addEventListener('dragend', () => it.classList.remove('dragging'));
        it.addEventListener('dragover', (e) => { e.preventDefault(); it.classList.add('over'); });
        it.addEventListener('dragleave', () => it.classList.remove('over'));
        it.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragFrom < 0 || dragFrom === i) return;
          const [m] = cols.splice(dragFrom, 1);
          cols.splice(i, 0, m);
          dragFrom = -1;
          commit();
        });
        list.append(it);
      });
    }
    draw();
    return wrap;
  }

  function card(title, children, grid = true) {
    const c = h(`<div class="card">${title ? `<h2>${esc(title)}</h2>` : ''}<div class="${grid ? 'grid2' : ''}"></div></div>`);
    const body = c.lastElementChild;
    for (const ch of children) if (ch) body.append(ch);
    return c;
  }

  // ---------------- pages ----------------
  function renderPage() {
    const el = $('#page');
    const scroll = el.scrollTop;
    el.innerHTML = '';
    if (page === 'home') pageHome(el);
    else if (page === 'appearance') pageAppearance(el);
    else if (page === 'general') pageGeneral(el);
    else if (page === 'profiles') pageProfiles(el);
    else if (page.startsWith('ov:')) pageOverlay(el, page.slice(3));
    el.scrollTop = scroll;
  }

  function screenMap() {
    const all = displays.length ? displays : [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
    const minX = Math.min(...all.map((d) => d.bounds.x)), minY = Math.min(...all.map((d) => d.bounds.y));
    const maxX = Math.max(...all.map((d) => d.bounds.x + d.bounds.width)), maxY = Math.max(...all.map((d) => d.bounds.y + d.bounds.height));
    const W = maxX - minX, H = maxY - minY;
    const scr = h(`<div class="screen" style="aspect-ratio:${W}/${H}"></div>`);
    for (const d of all) {
      scr.append(h(`<div style="position:absolute;border:1px dashed #1e293b;left:${((d.bounds.x - minX) / W) * 100}%;top:${((d.bounds.y - minY) / H) * 100}%;width:${(d.bounds.width / W) * 100}%;height:${(d.bounds.height / H) * 100}%"></div>`));
    }
    for (const d of R.OVERLAYS) {
      const s = ov(d.id), b = s.bounds;
      const box = h(`<div class="box ${s.enabled ? '' : 'off'}" data-page="ov:${d.id}" title="${esc(d.name)}" style="left:${((b.x - minX) / W) * 100}%;top:${((b.y - minY) / H) * 100}%;width:${(b.width / W) * 100}%;height:${(b.height / H) * 100}%">${d.icon} ${esc(d.name)}</div>`);
      scr.append(box);
    }
    return scr;
  }

  function pageHome(el) {
    el.append(h(`<div><h1>Overview</h1><p class="lead">Turn overlays on, then press <b>Edit layout</b> (or <kbd>${esc(keyLabel(cfg.global.hotkeys.toggleEdit))}</kbd>) to drag and resize them on screen. Arrow keys nudge the focused overlay, <kbd>Shift</kbd> for 10px, <kbd>Ctrl</kbd> to resize.</p></div>`));
    const ub = updateBanner();
    if (ub) el.append(ub);
    el.append(h(`<div class="tip">💡 Run iRacing in <b>Borderless / Windowed</b> mode — overlays can't be drawn over exclusive fullscreen. While iRacing isn't running, overlays show demo data whenever this window is open or edit mode is on.</div>`));
    el.append(screenMap());
    const grid = h('<div class="overview"></div>');
    for (const d of R.OVERLAYS) {
      const s = ov(d.id);
      const card = h(`<div class="ov" data-page="ov:${d.id}"><div class="t"><span>${d.icon}</span><span class="grow">${esc(d.name)}</span>
        <label class="sw" data-toggle="${d.id}"><input type="checkbox" ${s.enabled ? 'checked' : ''}><span></span></label></div><p>${esc(d.description)}</p>
        <div class="quick nonav">
          <label>Opacity</label><input type="range" min="10" max="100" step="1" data-k="opacity" value="${s.opacity ?? 100}"><span>${s.opacity ?? 100}%</span>
          <label>Background</label><input type="range" min="0" max="100" step="1" data-k="bgOpacity" value="${s.bgOpacity ?? 85}"><span>${s.bgOpacity ?? 85}%</span>
        </div></div>`);
      for (const r of card.querySelectorAll('.quick input')) {
        r.oninput = () => { r.nextElementSibling.textContent = r.value + '%'; setOverlay(d.id, { [r.dataset.k]: +r.value }); };
      }
      grid.append(card);
    }
    el.append(grid);
  }

  // ---------------- updates ----------------
  const UPDATE_WHY = 'Slipstream asks GitHub, where it is published, whether a newer version exists: once at start and every 6 hours. Nothing about you or your PC is sent.';

  function updateText(u) {
    if (!u) return '';
    switch (u.status) {
      case 'checking': return 'Checking for updates…';
      case 'none': return `You have the latest version (${esc(u.current)}).`;
      case 'downloading': return `Downloading version ${esc(u.version)}… ${u.percent || 0}%`;
      case 'ready': return `Version <b>${esc(u.version)}</b> is downloaded and installs when you quit Slipstream.`;
      case 'available': return `Version <b>${esc(u.version)}</b> is available.`;
      case 'error': return `Couldn't check for updates: ${esc(u.error)}`;
      default: return `Version ${esc(u.current)}.`;
    }
  }

  function updateAction(u) {
    if (!u) return null;
    if (u.status === 'ready') return ['Restart and update now', 'install'];
    if (u.status === 'available') return ['Download ' + u.version, 'install'];
    if (['idle', 'none', 'error'].includes(u.status)) return ['Check now', 'check'];
    return null;
  }

  function actionButton(u, cls) {
    const a = updateAction(u);
    if (!a) return null;
    const b = h(`<button class="btn ${cls}">${esc(a[0])}</button>`);
    b.onclick = () => api.invoke('settings:update', a[1]);
    return b;
  }

  // Overview: ask once whether to check automatically; later, show a ready/available update.
  function updateBanner() {
    if (cfg.global.autoUpdate === null || cfg.global.autoUpdate === undefined) {
      const box = h(`<div class="tip update"><b>Keep Slipstream up to date?</b><br>${UPDATE_WHY}
        You can change this any time in <i>General &amp; hotkeys</i>.<div class="row"></div></div>`);
      const yes = h('<button class="btn primary small">Yes, check for updates</button>');
      const no = h('<button class="btn small">No thanks</button>');
      yes.onclick = () => setGlobal({ autoUpdate: true }).then(renderPage);
      no.onclick = () => setGlobal({ autoUpdate: false }).then(renderPage);
      $('.row', box).append(yes, no);
      return box;
    }
    if (update && (update.status === 'ready' || update.status === 'available')) {
      const box = h(`<div class="tip update">⬆ ${updateText(update)}<div class="row"></div></div>`);
      const b = actionButton(update, 'primary small');
      if (b) $('.row', box).append(b);
      return box;
    }
    return null;
  }

  function updatesCard() {
    const g = cfg.global;
    const u = update;
    const kindNote = !u ? '' : u.kind === 'portable'
      ? 'You are using the portable version: Slipstream tells you when an update is out, and you download it yourself.'
      : u.kind === 'dev' ? 'Running from source: updates are only checked, never installed.'
      : 'Updates download in the background and install when you quit Slipstream.';
    const info = h(`<div class="updinfo"><p>${updateText(u)}</p><p class="dim">${kindNote} ${UPDATE_WHY}</p><div class="row"></div></div>`);
    const b = actionButton(u, 'small');
    if (b) $('.row', info).append(b);
    const rel = h('<button class="btn small ghost">Release notes</button>');
    rel.onclick = () => api.invoke('settings:update', 'notes');
    $('.row', info).append(rel);
    return card('Updates', [
      field({ label: 'Check for updates automatically', type: 'bool' }, g.autoUpdate === true, (v) => setGlobal({ autoUpdate: v })),
      info,
    ], false);
  }

  function pageOverlay(el, id) {
    const d = R.byId(id);
    const s = ov(id);
    const head = h(`<div><h1>${d.icon} ${esc(d.name)} <label class="sw" data-toggle="${id}"><input type="checkbox" ${s.enabled ? 'checked' : ''}><span></span></label></h1><p class="lead">${esc(d.description)}</p></div>`);
    el.append(head);

    // layout
    const b = s.bounds;
    const setB = (k) => (v) => { const nb = { ...ov(id).bounds, [k]: Math.round(v) }; setOverlay(id, { bounds: nb }); };
    const layout = card('Position & size', [
      field({ label: 'X', type: 'number', step: 1 }, b.x, setB('x')),
      field({ label: 'Y', type: 'number', step: 1 }, b.y, setB('y')),
      field({ label: 'Width', type: 'number', min: 60, max: 4000 }, b.width, setB('width')),
      field({ label: 'Height', type: 'number', min: 30, max: 3000 }, b.height, setB('height')),
    ]);
    const tools = h('<div class="row" style="padding:6px 0 12px"></div>');
    const center = h('<button class="btn small">Center on primary screen</button>');
    center.onclick = () => {
      const p = displays.find((x) => x.primary) || { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
      const cur = ov(id).bounds;
      setOverlay(id, { bounds: { ...cur, x: Math.round(p.bounds.x + (p.bounds.width - cur.width) / 2), y: Math.round(p.bounds.y + (p.bounds.height - cur.height) / 2) } }).then(renderPage);
    };
    const def = h('<button class="btn small">Default size & position</button>');
    def.onclick = () => setOverlay(id, { bounds: { ...d.bounds } }).then(renderPage);
    const reset = h('<button class="btn small danger">Reset all settings</button>');
    reset.onclick = () => { if (confirm(`Reset ${d.name} to defaults?`)) { localEchoes++; api.invoke('settings:resetOverlay', id).then(reload); } };
    tools.append(center, def, reset);
    layout.append(tools);
    el.append(layout);

    const specific = d.schema.filter((f) => f.type !== 'columns');
    const cols = d.schema.filter((f) => f.type === 'columns');
    for (const f of cols) el.append(card('', [field(f, s[f.key], (v) => setOverlay(id, { [f.key]: v }))], false));
    if (specific.length) el.append(card('Options', specific.map((f) => field(f, s[f.key], (v) => setOverlay(id, { [f.key]: v })))));
    el.append(card('Appearance & visibility', R.COMMON_SCHEMA.map((f) => field(f, s[f.key], (v) => setOverlay(id, { [f.key]: v })))));
  }

  function pageAppearance(el) {
    const g = cfg.global;
    el.append(h('<div><h1>Appearance</h1><p class="lead">Pick a theme, then fine-tune any color. Changes apply to all overlays live; per-overlay scale, opacity and accent are on each overlay\'s page.</p></div>'));
    const themes = h('<div class="themes"></div>');
    for (const [key, t] of Object.entries(R.THEMES)) {
      const el2 = h(`<div class="theme ${g.theme === key ? 'active' : ''}"><div class="sw8">${['bg', 'header', 'accent', 'player', 'purple', 'green', 'red', 'text'].map((k) => `<i style="background:${t[k]}"></i>`).join('')}</div><b style="font-family:${t.font}">${esc(t.name)}</b></div>`);
      el2.onclick = () => setGlobal({ theme: key, themeOverrides: {} }).then(() => renderPage());
      themes.append(el2);
    }
    el.append(card('Theme', [themes], false));

    const base = R.THEMES[g.theme] || R.THEMES.carbon;
    const ovr = g.themeOverrides || {};
    const colorKeys = [['bg', 'Background'], ['bgAlt', 'Alternate row'], ['header', 'Header'], ['text', 'Text'], ['dim', 'Secondary text'], ['accent', 'Accent'], ['player', 'My car highlight'], ['purple', 'Fastest lap'], ['green', 'Positive / gain'], ['red', 'Negative / loss'], ['yellow', 'Warning'], ['blue', 'Info']];
    const setO = (k) => (v) => { const o = { ...(cfg.global.themeOverrides || {}), [k]: v }; setGlobal({ themeOverrides: o }); };
    el.append(card('Colors', colorKeys.map(([k, label]) => field({ label, type: 'color' }, ovr[k] || base[k], setO(k)))));
    el.append(card('Transparency', [
      field({ label: 'Master opacity (%): applies to all overlays on top of their own setting', type: 'range', min: 10, max: 100, step: 1 }, g.masterOpacity ?? 100, (v) => setGlobal({ masterOpacity: v })),
    ]));
    el.append(card('Typography & shape', [
      field({ label: 'Font', type: 'select', options: [{ value: '', label: `Theme default (${base.font})` }].concat(R.FONTS.map((f) => ({ value: f, label: f }))) }, g.font || '', (v) => setGlobal({ font: v })),
      field({ label: 'Corner radius', type: 'range', min: 0, max: 20, step: 1 }, ovr.radius ?? base.radius, setO('radius')),
    ]));
    const rst = h('<button class="btn small danger">Reset color overrides</button>');
    rst.onclick = () => setGlobal({ themeOverrides: {} }).then(renderPage);
    el.append(rst);
  }

  function hotkeyField(label, key) {
    const wrap = h(`<div class="field"><label>${esc(label)}</label><div class="ctl"><button class="btn hk"></button><button class="btn small ghost" title="Clear">✕</button></div></div>`);
    const [btn, clr] = wrap.querySelectorAll('button');
    btn.textContent = keyLabel(cfg.global.hotkeys[key]) || '— none —';
    btn.onclick = () => {
      btn.classList.add('rec');
      btn.textContent = 'Press keys… (Esc to cancel)';
      const onKey = (e) => {
        e.preventDefault();
        if (e.key === 'Escape') { done(); return; }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        const parts = [];
        if (e.ctrlKey) parts.push('CommandOrControl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        let k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code.startsWith('Numpad') ? 'num' + e.code.slice(6).toLowerCase() : e.key.length === 1 ? e.key.toUpperCase() : e.key;
        if (k === ' ') k = 'Space';
        parts.push(k);
        setGlobal({ hotkeys: { ...cfg.global.hotkeys, [key]: parts.join('+') } });
        done();
      };
      const done = () => { window.removeEventListener('keydown', onKey, true); btn.classList.remove('rec'); btn.textContent = keyLabel(cfg.global.hotkeys[key]) || '— none —'; };
      window.addEventListener('keydown', onKey, true);
    };
    clr.onclick = () => { setGlobal({ hotkeys: { ...cfg.global.hotkeys, [key]: '' } }).then(renderPage); };
    return wrap;
  }

  function pageGeneral(el) {
    const g = cfg.global;
    el.append(h('<div><h1>General</h1><p class="lead">Data source, units and global hotkeys.</p></div>'));
    el.append(updatesCard());
    el.append(card('Data', [
      field({ label: 'Data source', type: 'select', options: [{ value: 'auto', label: 'Auto (iRacing, demo while editing)' }, { value: 'iracing', label: 'iRacing only' }, { value: 'demo', label: 'Demo data always' }] }, g.dataSource, (v) => setGlobal({ dataSource: v })),
      field({ label: 'Units (fuel, temperatures)', type: 'select', options: [{ value: 'auto', label: 'Follow iRacing setting' }, { value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }] }, g.units, (v) => setGlobal({ units: v })),
      field({ label: 'Speed unit (all overlays)', type: 'select', options: [{ value: 'auto', label: 'Same as units above' }, { value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }] }, g.speedUnit || 'auto', (v) => setGlobal({ speedUnit: v })),
      field({ label: 'Hide overlays when not driving (garage, setup screen, menus)', type: 'bool' }, g.hideWhenNotDriving, (v) => setGlobal({ hideWhenNotDriving: v })),
      field({ label: 'Hide overlays when stopped in the pits (each overlay can override this on its own page)', type: 'bool' }, g.hideWhenStoppedInPits, (v) => setGlobal({ hideWhenStoppedInPits: v })),
      field({ label: 'Show overlays while watching replays / spectating', type: 'bool' }, g.showInReplays, (v) => setGlobal({ showInReplays: v })),
      field({ label: 'Follow camera car in replays / spectating', type: 'bool' }, g.focusCamCar, (v) => setGlobal({ focusCamCar: v })),
      field({ label: 'Snap to grid while dragging (px, 0 = off)', type: 'number', min: 0, max: 50 }, g.snapToGrid, (v) => setGlobal({ snapToGrid: v })),
      field({ label: 'Start minimized to tray', type: 'bool' }, g.startMinimized, (v) => setGlobal({ startMinimized: v })),
    ]));
    const hk = card('Hotkeys (global)', [
      hotkeyField('Toggle edit layout', 'toggleEdit'),
      hotkeyField('Show / hide all overlays', 'toggleVisible'),
      hotkeyField('Open settings', 'openSettings'),
      hotkeyField('Next profile', 'nextProfile'),
      hotkeyField('Switch km/h / mph', 'toggleSpeedUnit'),
    ]);
    if (hotkeyErrors.length) hk.append(h(`<div class="warnbox">⚠ ${hotkeyErrors.map(esc).join('<br>')}</div>`));
    el.append(hk);
    const maps = Object.keys(cfg.trackMaps || {});
    const tm = card('Learned track maps', [h(`<div style="padding:10px 0;color:var(--dim)">${maps.length} track(s) learned. The map is recorded automatically during your first clean lap on a track.</div>`)], false);
    const forget = h('<button class="btn small danger" style="margin-bottom:12px">Forget all track maps</button>');
    forget.onclick = () => { if (confirm('Forget all learned track maps?')) api.invoke('settings:forgetTrack', '*').then(reload); };
    tm.append(forget);
    el.append(tm);
    el.append(h(`<p style="color:var(--dim);font-size:12px">Settings file: ${esc(cfgPath)}</p>`));
  }

  function pageProfiles(el) {
    el.append(h(`<div><h1>Layouts & profiles</h1><p class="lead">Everything you change (positions, sizes, options, theme) is <b>saved automatically</b> and restored the next time Slipstream starts, including after updates. Each profile is a complete layout: switch with the tray menu or <kbd>${esc(keyLabel(cfg.global.hotkeys.nextProfile))}</kbd>.</p></div>`));

    // save the current layout under a name
    const snap = h(`<div class="card"><h2>Save current layout</h2><div class="row" style="padding:6px 0 14px">
      <input type="text" class="snapname" placeholder="Layout name, e.g. Road race" style="background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:7px 10px;width:280px">
      <button class="btn primary">💾 Save layout as new profile</button><span class="snapmsg" style="color:var(--dim);font-size:13px"></span></div></div>`);
    const nameIn = $('.snapname', snap);
    const doSnap = () => {
      const name = nameIn.value.trim() || `${profile().name} ${new Date().toLocaleDateString()}`;
      api.invoke('settings:profile', 'snapshot', name).then(() => { $('.snapmsg', snap).textContent = `Saved “${name}”`; });
    };
    $('button', snap).onclick = doSnap;
    nameIn.onkeydown = (e) => { if (e.key === 'Enter') doSnap(); };
    el.append(snap);

    const list = h('<div class="card profiles"></div>');
    for (const [key, p] of Object.entries(cfg.profiles)) {
      const active = key === cfg.activeProfile;
      const row = h(`<div class="prof"><div class="grow"><input value="${esc(p.name)}"></div>${active ? '<span class="badge">Active</span>' : '<button class="btn small sel">Activate</button>'}
        <button class="btn small dup">Duplicate</button><button class="btn small exp">Export</button><button class="btn small danger del">Delete</button></div>`);
      const inp = $('input', row);
      inp.onchange = () => api.invoke('settings:profile', 'rename', key, inp.value);
      const sel = $('.sel', row); if (sel) sel.onclick = () => api.invoke('settings:profile', 'select', key);
      $('.dup', row).onclick = () => api.invoke('settings:profile', 'create', p.name + ' (copy)', key);
      $('.exp', row).onclick = () => api.invoke('settings:profile', 'export', key);
      $('.del', row).onclick = () => { if (Object.keys(cfg.profiles).length > 1 && confirm(`Delete profile "${p.name}"?`)) api.invoke('settings:profile', 'delete', key); };
      list.append(row);
    }
    el.append(list);
    const actions = h('<div class="row"></div>');
    const nw = h('<button class="btn primary">+ New profile</button>');
    nw.onclick = () => api.invoke('settings:profile', 'create', 'Profile ' + (Object.keys(cfg.profiles).length + 1));
    const imp = h('<button class="btn">Import profile…</button>');
    imp.onclick = () => api.invoke('settings:profile', 'import').catch((e) => alert('Import failed: ' + e.message));
    actions.append(nw, imp);
    el.append(actions);

    // full backup / restore
    const bk = h(`<div class="card" style="margin-top:18px"><h2>Backup & restore</h2>
      <p style="color:var(--dim);margin:4px 0 10px;font-size:13px">A backup of your settings is taken automatically every time Slipstream starts (the last 15 are kept).
      You can also export everything (all profiles, theme, hotkeys, learned track maps) to move to another PC.</p>
      <div class="row" style="padding-bottom:10px"><button class="btn exp-all">⬆ Export all settings…</button><button class="btn imp-all">⬇ Import all settings…</button></div>
      <div class="backups"></div></div>`);
    $('.exp-all', bk).onclick = () => api.invoke('settings:profile', 'exportAll');
    $('.imp-all', bk).onclick = () => {
      if (confirm('Replace ALL current settings with the imported file? (A backup of the current settings is taken first.)')) api.invoke('settings:profile', 'importAll').catch((e) => alert('Import failed: ' + e.message));
    };
    const list2 = $('.backups', bk);
    if (!backups.length) list2.append(h('<div style="color:var(--dim);font-size:13px;padding-bottom:10px">No backups yet.</div>'));
    for (const b of backups) {
      const reason = (b.name.match(/-([a-z-]+)\.json$/) || [, ''])[1];
      const row = h(`<div class="prof"><div class="grow" style="font-size:13px">${esc(new Date(b.time).toLocaleString())} <span style="color:var(--dim)">· ${esc(reason)}</span></div><button class="btn small">Restore</button></div>`);
      $('button', row).onclick = () => { if (confirm(`Restore settings from ${new Date(b.time).toLocaleString()}? Your current settings are backed up first.`)) api.invoke('settings:profile', 'restore', b.name); };
      list2.append(row);
    }
    el.append(bk);
    el.append(h(`<p style="color:var(--dim);font-size:12px">Settings file: ${esc(cfgFile)}</p>`));
  }

  // ---------------- data ----------------
  let cfgPath = '';
  let cfgFile = '';
  let lastSaved = null;
  let backups = [];
  async function reload() {
    const d = await api.invoke('settings:get');
    update = d.update;
    cfg = d.config;
    cfgFile = d.file;
    lastSaved = d.lastSaved;
    backups = d.backups || [];
    status = d.status;
    hotkeyErrors = d.hotkeyErrors;
    cfgPath = d.userData;
    displays = await api.invoke('settings:displays');
    renderNav();
    renderStatus();
    renderSaved();
    renderPage();
  }

  api.on('settings:saved', (d) => { lastSaved = d.lastSaved; renderSaved(); });
  api.on('settings:config', (d) => {
    cfg = d.config;
    backups = d.backups || backups;
    hotkeyErrors = d.hotkeyErrors;
    if (localEchoes > 0) { localEchoes--; renderNav(); return; }
    if (!R.byId(page.slice(3)) && page.startsWith('ov:')) page = 'home';
    renderNav();
    renderPage();
  });
  api.on('settings:status', (s) => { status = s; renderStatus(); });
  api.on('settings:update', (u) => {
    const was = update && update.status + update.percent;
    update = u;
    if (was !== u.status + u.percent && (page === 'home' || page === 'general')) renderPage();
  });

  reload();
})();
