# Slipstream: developer notes

Everything a player needs is in the [README](../README.md). This page is for building and changing Slipstream.

## Run from source

```powershell
npm install
npm start             # live iRacing data, demo preview while configuring
npm run demo          # force demo data
npm run check         # self-test: fake iRacing memory map → reader → model
npm run dist          # build installer + portable exe into dist/
npm run screenshots   # regenerate docs/screenshots
```

The app is built on Electron and reads iRacing's telemetry straight from shared memory. It needs no native build
and no extra services.

Screenshots in `docs/screenshots` are generated from the built-in demo race and drawn over a painted backdrop.

## Architecture

```
src/main/irsdk.js     shared-memory reader (koffi → kernel32), var decoding, tolerant session YAML parsing
src/main/model.js     derived state: standings, classes/SOF, relative, fuel, timing, slip, track learning, iRating
src/main/mock.js      physically plausible demo race (speed profile, pit stops, flags, duels)
src/main/main.js      windows, 60 Hz loop, per-overlay fps throttling and data slicing, IPC, tray, hotkeys
src/main/config.js    profiles + forward-compatible migration of saved configs
src/shared/registry.js  overlay definitions and settings schemas (drives the settings UI)
src/renderer/         overlay host + one self-contained widget per overlay, settings app
```

## Adding a new overlay

1. Add an entry to `OVERLAYS` in `src/shared/registry.js`, with `id`, `bounds`, `needs` (the state slices it uses)
   and a `schema`. The settings page is generated from the schema automatically.
2. Create `src/renderer/widgets/<id>.js` with `Host.register('<id>', (root) => ({ update(state, ctx) {…} }))`.
3. Add a `<script>` tag for it in `overlay.html`.

## Releasing

Bump `version` in `package.json`, commit, then push a matching tag:

```powershell
git tag v0.2.0; git push origin v0.2.0
```

The **Release** workflow builds the installer and portable exe on GitHub Actions and publishes them as a GitHub Release.

## Dev flags

`IRO_USERDATA=<dir>` isolates the config. `IRO_SCREENSHOT=<dir>` captures every window and quits.
`IRO_EDIT=1` starts in edit mode. `IRO_DEMO_SKIP=<sec>` sets where the demo race starts. `IRO_PAGE=ov:standings`
opens a specific settings page. `IRO_UPDATE_CHECK=1` checks for an update at start and prints each update state.
