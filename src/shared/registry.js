/*
 * Overlay registry — shared by the main process (require) and renderers (<script>).
 * Every overlay declares: default window bounds, the state slices it needs,
 * and a settings schema that the settings UI renders automatically.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Registry = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Settings applied to every overlay (rendered in the "Common" section).
  const COMMON_SCHEMA = [
    { key: 'scale', label: 'Scale (%)', type: 'range', min: 50, max: 250, step: 5, default: 100 },
    { key: 'opacity', label: 'Overlay opacity (%)', type: 'range', min: 10, max: 100, step: 1, default: 100 },
    { key: 'bgOpacity', label: 'Background opacity (%)', type: 'range', min: 0, max: 100, step: 1, default: 85 },
    { key: 'showHeader', label: 'Show header', type: 'bool', default: true },
    { key: 'accent', label: 'Accent color override', type: 'color', default: '', allowEmpty: true },
    { key: 'fps', label: 'Refresh rate (fps)', type: 'range', min: 1, max: 60, step: 1, default: 30 },
    { key: 'showInPractice', label: 'Show in practice', type: 'bool', default: true },
    { key: 'showInQualify', label: 'Show in qualifying', type: 'bool', default: true },
    { key: 'showInRace', label: 'Show in race', type: 'bool', default: true },
    { key: 'onlyOnTrack', label: 'Hide when not in car', type: 'bool', default: false },
    { key: 'inPits', label: 'When stopped in the pits', type: 'select', default: 'global',
      options: [{ value: 'global', label: 'Follow the General setting' }, { value: 'show', label: 'Keep showing' }, { value: 'hide', label: 'Hide' }] },
  ];

  const STANDINGS_COLUMNS = [
    { id: 'pos', label: 'Position', default: true },
    { id: 'classPos', label: 'Class position', default: false },
    { id: 'posGain', label: 'Positions gained', default: true },
    { id: 'number', label: 'Car number', default: true },
    { id: 'class', label: 'Class tag', default: false },
    { id: 'name', label: 'Driver', default: true },
    { id: 'team', label: 'Team', default: false },
    { id: 'car', label: 'Car model', default: false },
    { id: 'license', label: 'License / SR', default: true },
    { id: 'irating', label: 'iRating', default: true },
    { id: 'irDelta', label: 'iRating +/- (est.)', default: true },
    { id: 'pit', label: 'Pit stops', default: false },
    { id: 'lap', label: 'Laps', default: false },
    { id: 'gap', label: 'Gap to leader', default: true },
    { id: 'interval', label: 'Interval', default: true },
    { id: 'last', label: 'Last lap', default: true },
    { id: 'best', label: 'Best lap', default: true },
    { id: 'tire', label: 'Tire compound', default: false },
  ];

  const RELATIVE_COLUMNS = [
    { id: 'pos', label: 'Position', default: true },
    { id: 'number', label: 'Car number', default: true },
    { id: 'class', label: 'Class tag (multiclass / league splits)', default: true },
    { id: 'name', label: 'Driver', default: true },
    { id: 'license', label: 'License / SR', default: true },
    { id: 'irating', label: 'iRating', default: true },
    { id: 'pit', label: 'Pit indicator', default: true },
    { id: 'last', label: 'Last lap', default: false },
    { id: 'gap', label: 'Gap', default: true },
  ];

  const OVERLAYS = [
    {
      id: 'standings', name: 'Standings', icon: '🏁',
      description: 'Full leaderboard with multiclass grouping, gaps, iRating and estimated iRating change.',
      bounds: { x: 40, y: 120, width: 620, height: 520 },
      needs: ['session', 'player', 'cars', 'classes'],
      schema: [
        { key: 'columns', label: 'Columns', type: 'columns', columns: STANDINGS_COLUMNS },
        { key: 'maxRows', label: 'Max rows per class', type: 'number', min: 3, max: 64, default: 10 },
        { key: 'multiclass', label: 'Group by class', type: 'bool', default: true },
        { key: 'keepPlayerVisible', label: 'Always keep my car visible', type: 'bool', default: true },
        { key: 'topRows', label: 'Rows pinned to top when scrolling to me', type: 'number', min: 0, max: 10, default: 3 },
        { key: 'showClassHeader', label: 'Show class headers', type: 'bool', default: true },
        { key: 'highlightFastest', label: 'Highlight fastest lap (purple)', type: 'bool', default: true },
        { key: 'showOutOfCar', label: 'Show cars not in world', type: 'bool', default: true },
        { key: 'nameFormat', label: 'Name format', type: 'select', default: 'full',
          options: [{ value: 'full', label: 'First Last' }, { value: 'short', label: 'F. Last' }, { value: 'last', label: 'Last' }, { value: 'abbrev', label: 'LAS' }] },
        { key: 'footer', label: 'Show footer (SOF, laps, time)', type: 'bool', default: true },
      ],
    },
    {
      id: 'relative', name: 'Relative', icon: '↕',
      description: 'Cars around you on track with live time gaps, lapping/lapped coloring.',
      bounds: { x: 1260, y: 620, width: 480, height: 300 },
      needs: ['session', 'player', 'cars', 'relative', 'classes'],
      schema: [
        { key: 'columns', label: 'Columns', type: 'columns', columns: RELATIVE_COLUMNS },
        { key: 'groupByClass', label: 'Group cars by class (multiclass only; my class first)', type: 'bool', default: true },
        { key: 'ahead', label: 'Cars ahead', type: 'number', min: 0, max: 10, default: 4 },
        { key: 'behind', label: 'Cars behind', type: 'number', min: 0, max: 10, default: 4 },
        { key: 'colorLapping', label: 'Color lapping / lapped cars', type: 'bool', default: true },
        { key: 'hidePitCars', label: 'Hide cars in pits', type: 'bool', default: false },
        { key: 'nameFormat', label: 'Name format', type: 'select', default: 'full',
          options: [{ value: 'full', label: 'First Last' }, { value: 'short', label: 'F. Last' }, { value: 'last', label: 'Last' }, { value: 'abbrev', label: 'LAS' }] },
        { key: 'gapDecimals', label: 'Gap decimals', type: 'number', min: 0, max: 3, default: 1 },
        { key: 'header', label: 'Show info bar (position, SOF, incidents)', type: 'bool', default: true },
      ],
    },
    {
      id: 'dash', name: 'Dashboard & Inputs', icon: '⏱',
      description: 'Shift lights, gear, speed and RPM together with the pedal trace, pedal bars and steering wheel.',
      bounds: { x: 680, y: 920, width: 580, height: 100 },
      needs: ['player', 'session'],
      defaults: { fps: 60, showHeader: false, limiterV2: true },
      schema: [
        { key: 'autoFit', label: 'Scale contents to fit the box (resize the box to make it bigger)', type: 'bool', default: true },
        { key: 'fitHeight', label: 'Shrink box height to fit the contents (no empty space)', type: 'bool', default: false },
        { key: 'padV', label: 'Vertical padding (px)', type: 'range', min: 0, max: 30, step: 1, default: 4 },
        { key: 'shiftLights', label: 'Shift lights', type: 'bool', default: true },
        { key: 'lightCount', label: 'Number of lights', type: 'number', min: 5, max: 20, default: 12 },
        { key: 'flashOnShift', label: 'Also flash at the shift point, before the blue stage', type: 'bool', default: false },
        { key: 'limiterAt', label: 'Blue strobe (over-rev warning) starts', type: 'select', default: 'offset',
          options: [{ value: 'offset', label: 'A set number of rpm below the redline' }, { value: 'car', label: "At the car's limiter warning (from iRacing)" }, { value: 'last', label: 'When all lights are lit' }, { value: 'shift', label: 'At the shift point' }] },
        { key: 'limiterRpm', label: 'Blue strobe: rpm below the redline', type: 'number', min: 0, max: 3000, default: 300 },
        { key: 'limiterColor', label: 'Over-rev strobe color', type: 'color', default: '#38bdf8' },
        { key: 'slipLight', label: 'Wheelspin / lock-up light', type: 'bool', default: true },
        { key: 'slipSide', label: 'Slip light position', type: 'select', default: 'end',
          options: [{ value: 'end', label: 'After shift lights' }, { value: 'start', label: 'Before shift lights' }] },
        { key: 'spinSensitivity', label: 'Wheelspin sensitivity (% RPM over road speed)', type: 'range', min: 2, max: 20, step: 1, default: 6 },
        { key: 'lockSensitivity', label: 'Lock-up sensitivity (% RPM under road speed)', type: 'range', min: 3, max: 30, step: 1, default: 8 },
        { key: 'lockOnAbs', label: 'Light up when ABS is working', type: 'bool', default: true },
        { key: 'spinColor', label: 'Wheelspin color', type: 'color', default: '#f59e0b' },
        { key: 'lockColor', label: 'Lock-up color', type: 'color', default: '#ef4444' },
        { key: 'showGear', label: 'Gear, speed & RPM', type: 'bool', default: true },
        { key: 'showRpmBar', label: 'RPM bar', type: 'bool', default: true },
        { key: 'showTrace', label: 'Pedal trace graph', type: 'bool', default: true },
        { key: 'traceSeconds', label: 'Trace length (s)', type: 'range', min: 2, max: 30, step: 1, default: 8 },
        { key: 'traceWidth', label: 'Trace line width', type: 'range', min: 1, max: 6, step: 0.5, default: 2 },
        { key: 'showBars', label: 'Pedal bars', type: 'bool', default: true },
        { key: 'showClutch', label: 'Show clutch', type: 'bool', default: true },
        { key: 'showSteering', label: 'Steering wheel', type: 'bool', default: true },
        { key: 'wheelStyle', label: 'Wheel style', type: 'select', default: 'gt',
          options: [{ value: 'gt', label: 'Simple' }, { value: 'rs50', label: 'Logitech RS50 style' }, { value: 'round', label: 'Round classic' }, { value: 'formula', label: 'Formula' }, { value: 'ring', label: 'Minimal ring' }, { value: 'bar', label: 'Steering bar' }] },
        { key: 'smoothSteering', label: 'Smooth wheel rotation', type: 'bool', default: true },
        { key: 'showSteerAngle', label: 'Show steering angle (°)', type: 'bool', default: false },
        { key: 'showSteerTrace', label: 'Trace steering', type: 'bool', default: false },
        { key: 'showLapInfo', label: 'Lap / last / best / delta row', type: 'bool', default: true },
        { key: 'showFuel', label: 'Fuel', type: 'bool', default: true },
        { key: 'showBias', label: 'Brake bias', type: 'bool', default: true },
        { key: 'showWarnings', label: 'Engine warnings & pit limiter', type: 'bool', default: true },
        { key: 'throttleColor', label: 'Throttle color', type: 'color', default: '#22c55e' },
        { key: 'brakeColor', label: 'Brake color', type: 'color', default: '#ef4444' },
        { key: 'absColor', label: 'Brake color when ABS active', type: 'color', default: '#f59e0b' },
        { key: 'traceLock', label: 'Color the brake trace where a wheel locked', type: 'bool', default: true },
        { key: 'lockTraceColor', label: 'Brake trace color when locked', type: 'color', default: '#facc15' },
        { key: 'clutchColor', label: 'Clutch color', type: 'color', default: '#3b82f6' },
        { key: 'steerColor', label: 'Steering trace color', type: 'color', default: '#e5e7eb' },
      ],
    },
    {
      id: 'speed', name: 'Speed', icon: '🚀',
      description: 'Just your speed and gear, with a wheelspin / lock-up lamp.',
      bounds: { x: 1180, y: 860, width: 240, height: 64 },
      needs: ['player', 'session'],
      defaults: { fps: 30, showHeader: false },
      schema: [
        { key: 'autoFit', label: 'Scale contents to fit the box', type: 'bool', default: true },
        { key: 'showGear', label: 'Show gear', type: 'bool', default: true },
        { key: 'revIndicator', label: 'Rev indicator behind the gear', type: 'select', default: 'fill',
          options: [{ value: 'fill', label: 'Fill rising with RPM + blue strobe on over-rev' }, { value: 'blip', label: 'Blue strobe on over-rev only' }, { value: 'off', label: 'Off' }] },
        { key: 'limiterAt', label: 'Blue strobe starts (same choices as the Dashboard)', type: 'select', default: 'offset',
          options: [{ value: 'offset', label: 'A set number of rpm below the redline' }, { value: 'car', label: "At the car's limiter warning (from iRacing)" }, { value: 'last', label: 'When the shift lights are full' }, { value: 'shift', label: 'At the shift point' }] },
        { key: 'limiterRpm', label: 'Blue strobe: rpm below the redline', type: 'number', min: 0, max: 3000, default: 300 },
        { key: 'limiterColor', label: 'Over-rev strobe color', type: 'color', default: '#38bdf8' },
        { key: 'showUnit', label: 'Show unit (km/h / mph)', type: 'bool', default: true },
        { key: 'showSlip', label: 'Wheelspin / lock-up lamp', type: 'bool', default: true },
        { key: 'slipLabel', label: 'Show SPIN / LOCK text under the lamp', type: 'bool', default: true },
        { key: 'spinSensitivity', label: 'Wheelspin sensitivity (% RPM over road speed)', type: 'range', min: 2, max: 20, step: 1, default: 6 },
        { key: 'lockSensitivity', label: 'Lock-up sensitivity (% RPM under road speed)', type: 'range', min: 3, max: 30, step: 1, default: 8 },
        { key: 'lockOnAbs', label: 'Light up when ABS is working', type: 'bool', default: true },
        { key: 'spinColor', label: 'Wheelspin color', type: 'color', default: '#f59e0b' },
        { key: 'lockColor', label: 'Lock-up color', type: 'color', default: '#ef4444' },
      ],
    },
    {
      id: 'laptiming', name: 'Lap Timing', icon: '⏲',
      description: 'Live sector times (green = personal best, purple = session best), last/best/optimal lap and a lap log.',
      bounds: { x: 1260, y: 120, width: 440, height: 250 },
      needs: ['timing', 'session'],
      defaults: { fps: 20 },
      schema: [
        { key: 'showCurrent', label: 'Current lap sectors', type: 'bool', default: true },
        { key: 'showSummary', label: 'Last / best / optimal row', type: 'bool', default: true },
        { key: 'showLog', label: 'Lap log', type: 'bool', default: true },
        { key: 'logRows', label: 'Laps in log', type: 'number', min: 1, max: 30, default: 6 },
        { key: 'logSectors', label: 'Sector columns in log', type: 'bool', default: true },
        { key: 'logDelta', label: 'Delta to best column', type: 'bool', default: true },
        { key: 'logFuel', label: 'Fuel used column', type: 'bool', default: true },
        { key: 'colorSectors', label: 'Color sectors (purple / green / yellow)', type: 'bool', default: true },
        { key: 'decimals', label: 'Decimals', type: 'number', min: 1, max: 3, default: 3 },
      ],
    },
    {
      id: 'fuel', name: 'Fuel Calculator', icon: '⛽',
      description: 'Consumption per lap, laps remaining, fuel to finish and to add at next stop.',
      bounds: { x: 1260, y: 380, width: 300, height: 220 },
      needs: ['player', 'fuel', 'session'],
      defaults: { inPits: 'show' }, // fuel to add matters most in the pit box
      schema: [
        { key: 'avgLaps', label: 'Laps used for average', type: 'number', min: 1, max: 20, default: 5 },
        { key: 'safetyMargin', label: 'Safety margin (laps)', type: 'range', min: 0, max: 3, step: 0.1, default: 0.5 },
        { key: 'showLast', label: 'Show last lap usage', type: 'bool', default: true },
        { key: 'showMax', label: 'Show max usage', type: 'bool', default: true },
        { key: 'showStops', label: 'Show pit stops needed', type: 'bool', default: true },
        { key: 'showPerHour', label: 'Show usage per hour', type: 'bool', default: false },
        { key: 'warnLaps', label: 'Warn when laps of fuel below', type: 'number', min: 0, max: 10, default: 2 },
      ],
    },
    {
      id: 'delta', name: 'Delta Bar', icon: 'Δ',
      description: 'Live delta against best, session best or optimal lap, plus gaps to the cars ahead and behind.',
      bounds: { x: 760, y: 200, width: 400, height: 110 },
      needs: ['player', 'session', 'cars', 'relative'],
      defaults: { showHeader: false, fps: 30 },
      schema: [
        { key: 'reference', label: 'Reference lap', type: 'select', default: 'best',
          options: [{ value: 'best', label: 'My best lap' }, { value: 'optimal', label: 'My optimal lap' }, { value: 'sessionBest', label: 'Session best' }, { value: 'sessionOptimal', label: 'Session optimal' }, { value: 'sessionLast', label: 'My last lap' }] },
        { key: 'range', label: 'Bar range (s)', type: 'range', min: 0.2, max: 5, step: 0.1, default: 1.5 },
        { key: 'showTrend', label: 'Color by trend (gaining/losing)', type: 'bool', default: true },
        { key: 'showLapTimes', label: 'Show current / predicted lap', type: 'bool', default: true },
        { key: 'decimals', label: 'Decimals', type: 'number', min: 1, max: 3, default: 2 },
        { key: 'showGaps', label: 'Gap bars to car ahead / behind', type: 'bool', default: true },
        { key: 'gapMode', label: 'Gaps measured to', type: 'select', default: 'auto',
          options: [{ value: 'auto', label: 'Auto (class position in races, track otherwise)' }, { value: 'position', label: 'Car ahead / behind in class position' }, { value: 'track', label: 'Nearest car on track' }] },
        { key: 'gapScale', label: 'Gap bar full at (s)', type: 'range', min: 0.5, max: 10, step: 0.5, default: 3 },
        { key: 'gapNames', label: 'Show driver name & number', type: 'bool', default: true },
      ],
    },
    {
      id: 'trackmap', name: 'Track Map', icon: '🗺',
      description: 'Auto-learned track map with every car, class colors and pit indicators.',
      bounds: { x: 40, y: 660, width: 320, height: 320 },
      needs: ['player', 'cars', 'trackMap', 'session'],
      defaults: { bgOpacity: 40, fps: 20 },
      schema: [
        { key: 'dotSize', label: 'Car dot size', type: 'range', min: 3, max: 16, step: 1, default: 7 },
        { key: 'trackWidth', label: 'Track line width', type: 'range', min: 2, max: 20, step: 1, default: 6 },
        { key: 'trackColor', label: 'Track color', type: 'color', default: '#9ca3af' },
        { key: 'showNumbers', label: 'Show car numbers', type: 'bool', default: true },
        { key: 'showPositions', label: 'Show positions instead of numbers', type: 'bool', default: false },
        { key: 'classColors', label: 'Use class colors', type: 'bool', default: true },
        { key: 'showStartFinish', label: 'Show start/finish line', type: 'bool', default: true },
        { key: 'rotate', label: 'Rotation (°)', type: 'range', min: 0, max: 359, step: 1, default: 0 },
        { key: 'mirror', label: 'Mirror', type: 'bool', default: false },
      ],
    },
    {
      id: 'session', name: 'Session Info', icon: 'ℹ',
      description: 'Session type, time/laps left, weather, incidents, SOF and local clock.',
      bounds: { x: 40, y: 20, width: 620, height: 80 },
      needs: ['session', 'player'],
      defaults: { showHeader: false, fps: 5 },
      schema: [
        { key: 'items', label: 'Items', type: 'columns', columns: [
          { id: 'session', label: 'Session', default: true },
          { id: 'remain', label: 'Time / laps remaining', default: true },
          { id: 'lap', label: 'Lap', default: true },
          { id: 'position', label: 'Position', default: true },
          { id: 'incidents', label: 'Incidents', default: true },
          { id: 'sof', label: 'Strength of field', default: true },
          { id: 'track', label: 'Track', default: false },
          { id: 'air', label: 'Air temp', default: true },
          { id: 'trackTemp', label: 'Track temp', default: true },
          { id: 'wetness', label: 'Track wetness', default: false },
          { id: 'clock', label: 'Local clock', default: true },
          { id: 'simClock', label: 'In-sim time of day', default: false },
        ] },
        { key: 'clock24', label: '24h clock', type: 'bool', default: true },
      ],
    },
    {
      id: 'flags', name: 'Flags', icon: '⚑',
      description: 'Large flag indicator for yellow, blue, white, checkered, black and more.',
      bounds: { x: 1180, y: 40, width: 220, height: 110 },
      needs: ['session', 'player'],
      defaults: { enabled: false, flagsV2: true, bgOpacity: 0, showHeader: false, fps: 10 },
      schema: [
        { key: 'showGreen', label: 'Show green flag', type: 'bool', default: true },
        { key: 'greenSeconds', label: 'Green shown for (s)', type: 'number', min: 1, max: 30, default: 5 },
        { key: 'showBlue', label: 'Show blue flag', type: 'bool', default: true },
        { key: 'showMeatball', label: 'Show repair (meatball)', type: 'bool', default: true },
        { key: 'showText', label: 'Show text label', type: 'bool', default: true },
      ],
    },
  ];

  const THEMES = {
    carbon: { name: 'Carbon (default)', bg: '#0b0f14', bgAlt: '#121821', header: '#1a2230', text: '#e8edf3', dim: '#8a97a8', accent: '#e11d48', player: '#1e3a5f', purple: '#a855f7', green: '#22c55e', red: '#ef4444', yellow: '#facc15', blue: '#3b82f6', border: '#263041', radius: 6, font: 'Rajdhani' },
    glass: { name: 'Glass', bg: '#101820', bgAlt: '#16212c', header: '#1c2a38', text: '#f1f5f9', dim: '#94a3b8', accent: '#38bdf8', player: '#0c4a6e', purple: '#c084fc', green: '#4ade80', red: '#f87171', yellow: '#fde047', blue: '#60a5fa', border: '#2b3b4d', radius: 12, font: 'Inter' },
    neon: { name: 'Neon', bg: '#07030f', bgAlt: '#110822', header: '#1b0d33', text: '#f5f3ff', dim: '#a78bfa', accent: '#f0abfc', player: '#4c1d95', purple: '#e879f9', green: '#34d399', red: '#fb7185', yellow: '#fde68a', blue: '#67e8f9', border: '#3b1f66', radius: 4, font: 'Orbitron' },
    paddock: { name: 'Paddock (light)', bg: '#f8fafc', bgAlt: '#eef2f7', header: '#e2e8f0', text: '#0f172a', dim: '#64748b', accent: '#dc2626', player: '#bfdbfe', purple: '#7e22ce', green: '#15803d', red: '#b91c1c', yellow: '#a16207', blue: '#1d4ed8', border: '#cbd5e1', radius: 6, font: 'Rajdhani' },
    contrast: { name: 'High contrast', bg: '#000000', bgAlt: '#111111', header: '#1f1f1f', text: '#ffffff', dim: '#bdbdbd', accent: '#ffd400', player: '#003d80', purple: '#d946ef', green: '#00ff66', red: '#ff3030', yellow: '#ffea00', blue: '#33a1ff', border: '#444444', radius: 0, font: 'Roboto Mono' },
  };

  const FONTS = ['Rajdhani', 'Inter', 'Orbitron', 'Roboto Mono', 'Titillium Web', 'Barlow Condensed', 'Segoe UI', 'Consolas'];

  function defaultSettingsFor(def) {
    const s = { enabled: true };
    for (const f of COMMON_SCHEMA.concat(def.schema)) {
      if (f.type === 'columns') {
        s[f.key] = f.columns.map((c) => ({ id: c.id, on: c.default }));
      } else {
        s[f.key] = f.default;
      }
    }
    Object.assign(s, def.defaults || {});
    s.bounds = Object.assign({}, def.bounds);
    return s;
  }

  function byId(id) { return OVERLAYS.find((o) => o.id === id); }

  return { OVERLAYS, COMMON_SCHEMA, THEMES, FONTS, defaultSettingsFor, byId };
});
