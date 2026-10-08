# Slipstream: developer notes

Everything a player needs is in the [README](../README.md). This page is for building and changing Slipstream.

## Run from source

```powershell
npm install
npm start             # live iRacing data, demo preview while configuring
npm run demo          # force demo data
npm run check         # self-test: fake iRacing memory map → reader → model
npm test              # unit tests (node:test + jsdom): main logic, config, every overlay widget, settings UI
npm run dist          # build installer + portable exe into dist/
npm run screenshots   # regenerate docs/screenshots
npm run screenshots:speed  # regenerate docs/screenshots/speed-layouts.png (Speed in every layout)
npm run screenshots:dash   # regenerate docs/screenshots/dash-layouts.png (a few Dashboard configurations)
npm run gifs          # regenerate docs/gifs (scripted demo drive, captured off-screen)
npx electron scripts/build-flags.js   # re-render country flags (flag-icons) to src/renderer/flags
IRO_RELLOG=1 npm start               # log what the Relative is built from to <userData>/relative-log.jsonl
powershell -ExecutionPolicy Bypass -File scripts/perf.ps1   # memory / CPU benchmark (off-screen demo race)
```

The app is built on Electron and reads iRacing's telemetry straight from shared memory. It needs no native build
and no extra services.

Screenshots in `docs/screenshots` are generated from the built-in demo race and drawn over a painted backdrop.

Country flags come from each driver's iRacing flair (`DriverInfo.Drivers[].FlairName`), matched to a flag in
`src/main/flags.js`. The PNGs in `src/renderer/flags` are rendered from the flag-icons package (MIT) and committed,
so the app has no runtime dependency on it.

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

### Code signing

Releases are signed through the [SignPath Foundation](https://signpath.org) open source program. Signing switches
on once the repository variable `SIGNPATH_ORGANIZATION_ID` is set; until then releases are built unsigned.

The workflow signs in two passes, and each pass waits up to an hour for an approver to approve it on SignPath:

1. `electron-builder --dir` builds the app folder and SignPath signs `Slipstream.exe` (artifact configuration `app`).
2. The installer and portable exe are built from the signed folder (`--prepackaged`) and signed too (`installers`).
3. `scripts/rehash.js` rewrites the sha512/size in `latest.yml` and the `.blockmap`, because signing changed the
   installer's bytes and auto-update would reject it otherwise.

One-time setup:

1. Apply at [signpath.org/apply](https://signpath.org/apply). Turn on MFA for both GitHub and SignPath.
2. In SignPath, create project `Slipstream` with the GitHub.com trusted build system, a signing policy
   `release-signing`, and artifact configurations `app` and `installers` from [`.signpath/`](../.signpath).
3. In SignPath, create a CI user, add it as a submitter on `release-signing`, and copy its API token.
4. In GitHub, **Settings → Secrets and variables → Actions**: add secret `SIGNPATH_API_TOKEN`, and variable
   `SIGNPATH_ORGANIZATION_ID` (from SignPath's organization page).

## Dev flags

`IRO_USERDATA=<dir>` isolates the config. `IRO_SCREENSHOT=<dir>` captures every window and quits.
`IRO_EDIT=1` starts in edit mode. `IRO_DEMO_SKIP=<sec>` sets where the demo race starts. `IRO_PAGE=ov:standings`
opens a specific settings page. `IRO_UPDATE_CHECK=1` checks for an update at start and prints each update state.
