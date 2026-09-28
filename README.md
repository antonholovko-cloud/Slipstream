<p align="center"><img src="src/assets/icon.png" width="96" alt="Slipstream logo"></p>

<h1 align="center">Slipstream</h1>

<p align="center">
Free, customizable overlays for iRacing.<br>
Standings, relative, dashboard & inputs, lap timing, fuel, delta, an auto-learned track map and more.
</p>

<p align="center">
  <a href="https://github.com/antonholovko-cloud/Slipstream/releases/latest"><b>⬇ Download for Windows</b></a>
</p>

![Slipstream overlays in a race](docs/screenshots/hero.png)

## Free forever, made for the community

Slipstream is a community project for sim racers. **It is free and always will be.** There is no paid version,
no subscription, no "pro" features behind a paywall, and no ads. It is open source under the MIT license, so
anyone can read, build and improve it.

## Your privacy

**Slipstream collects no personal data and sends nothing to any server.**

- No accounts, no sign-in, no analytics, no telemetry, no crash reporting.
- It makes no network connections at all. It reads iRacing's telemetry from your own PC's memory and draws
  it on your screen. Even the fonts are bundled with the app, so nothing is loaded from the internet.
- Your settings, profiles and learned track maps stay in a local file on your computer
  (`%APPDATA%\Slipstream`), and nowhere else.

## Getting started

### 1. Download and install

Get the latest version from the [releases page](https://github.com/antonholovko-cloud/Slipstream/releases/latest).
Pick one:

- **`Slipstream-Setup-x.y.z.exe`**: installs Slipstream with Start menu and desktop shortcuts. Recommended.
- **`Slipstream-Portable-x.y.z.exe`**: a single file that runs without installing. Keep it in any folder.

Slipstream isn't code-signed yet, so Windows may show a blue **"Windows protected your PC"** box the first time.
Click **More info**, then **Run anyway**.

### 2. Put iRacing in borderless windowed mode

Windows can't draw overlays on top of a game running in **exclusive fullscreen**, so iRacing has to run in a
window. Borderless windowed looks exactly like fullscreen, with no title bar, and performs the same on
Windows 10 and 11.

1. **Close iRacing completely.** iRacing saves its settings when it exits, so changes made while it's running
   are lost.
2. Open File Explorer and go to **`Documents\iRacing`**.
3. Open **`rendererDX11Monitor.ini`** with Notepad (right-click → *Open with* → *Notepad*).
   If you also have **`rendererDX11.ini`**, make the same changes there too.
4. Find these lines (press **Ctrl+F** to search) and change the numbers so they read:

   ```ini
   fullScreen=0
   border=0
   windowedMaximized=1
   windowedXPos=0
   windowedYPos=0
   ```

   Only change the number after the `=`. Leave the rest of each line as it is.
5. Check that **`windowedWidth`** and **`windowedHeight`** match your screen resolution, for example
   `1920` and `1080`, or `2560` and `1440`.
6. Save the file (**Ctrl+S**) and start iRacing.

iRacing should now fill the whole screen with no title bar or buttons at the top. If you see a title bar,
`border` is still `1`. If the game only covers part of the screen, check `windowedWidth` and `windowedHeight`.

> **Tip:** make a copy of the file before editing it. To go back to fullscreen later, set `fullScreen=1`.

### 3. Start Slipstream and place your overlays

1. Start **Slipstream**. It runs in the **system tray**, next to the clock. Click its icon to open the settings.
2. While iRacing isn't running, the overlays show a **demo race**, so you can set everything up without the sim.
3. Press **Ctrl+Shift+E** to enter **edit mode**. Drag overlays to move them and use the corner grip to resize them.
   Press **Ctrl+Shift+E** again to lock them in place.
4. Turn overlays on or off, and change what they show, in the settings window.

Everything is saved automatically. By default, overlays hide while you're in the garage or out of the car,
and show again when you drive.

## Overlays

| Overlay | What it shows |
|---|---|
| **Standings** | Multiclass grouping with class SOF, gap/interval, last/best lap (purple = fastest), iRating, license/SR, **estimated iRating +/-**, positions gained, pit stops, and "keep my car visible" |
| **Relative** | Cars around you by live time gap, lapping/lapped colors, pit tags, and an info bar (position, SOF, incidents, time left) |
| **Dashboard & Inputs** | Car-specific shift lights, gear, speed, RPM, a throttle/brake/clutch trace, pedal bars, a steering wheel, lap/last/best/delta, fuel, brake bias, engine warnings, pit limiter, and a **wheelspin / lock-up light** that strobes while you're slipping. Every part can be switched off |
| **Lap Timing** | Live sector times (green = personal best, purple = class best), last/best/optimal lap, and a lap log with sectors, delta, fuel used, and off-track/pit markers |
| **Fuel Calculator** | Average, last and max fuel per lap (green-flag laps only), laps left, fuel to finish with a safety margin, amount to add, stops needed |
| **Delta Bar** | Live delta to your best, optimal, session best or last lap, predicted lap time, and gap bars to the cars directly ahead and behind, showing whether you're gaining or losing per lap |
| **Track Map** | **Learned automatically** from your first clean lap, then saved for that track. Shows every car in class colors, cars in the pits and the start/finish line |
| **Session Info** | Session, time or laps left, lap, position, incidents vs limit, SOF, temperatures, track wetness, local and sim time |
| **Flags** | A big flag indicator: checkered, red, black, meatball, caution, debris, yellow, blue, white, one-to-green and green. **Off by default**; turn it on in settings |

| | |
|---|---|
| ![Standings](docs/screenshots/standings.png) | ![Relative](docs/screenshots/relative.png) |
| ![Track map](docs/screenshots/trackmap.png) | ![Fuel calculator](docs/screenshots/fuel.png) |
| ![Dashboard & Inputs](docs/screenshots/dash.png) | ![Session info](docs/screenshots/session.png) |
| ![Lap timing](docs/screenshots/laptiming.png) | ![Delta bar](docs/screenshots/delta.png) |

## Customizing

Every change you make is saved right away and kept after updates.

- **Each overlay:** position, size, scale (50–250%), background opacity, header, accent color, refresh rate,
  and which sessions it shows in (practice, qualifying, race).
- **Columns:** drag to reorder and switch columns on or off in Standings, Relative and Session Info.
- **Themes:** five built-in themes. You can change any color, the font and the corner rounding.
- **Layouts & profiles:** save different layouts (for example road, oval, streaming) and switch between them
  from the tray or with a hotkey. You can export a profile to share it or move it to another PC.
- **Backups:** a backup of your settings is made every time Slipstream starts (the last 15 are kept). Restore
  one from *Layouts & profiles*.
- **Units** follow your iRacing setting, or can be set to metric or imperial.
- **Replays and spectating:** the overlays follow the car the camera is on.

![Settings: standings columns](docs/screenshots/settings-standings.png)

### Hotkeys

Work anywhere, even while iRacing has focus. You can change them in *General & hotkeys*.

| Keys | Action |
|---|---|
| **Ctrl+Shift+E** | Edit mode on/off (move and resize overlays) |
| **Ctrl+Shift+H** | Show/hide all overlays |
| **Ctrl+Shift+S** | Open settings |
| **Ctrl+Shift+P** | Switch to the next profile |

In edit mode you can also nudge the selected overlay with the **arrow keys** (**Shift** = 10 px steps,
**Ctrl** = resize).

## Troubleshooting

**The overlays don't show up in iRacing.**
iRacing is probably in exclusive fullscreen. Follow [step 2](#2-put-iracing-in-borderless-windowed-mode).
Also check that overlays aren't hidden with **Ctrl+Shift+H**, and that the overlay is switched on in settings.

**My iRacing changes keep going back.**
iRacing was running while you edited the file and overwrote it when it closed. Close iRacing fully, then edit again.

**iRacing has a title bar with buttons at the top.**
Set `border=0` in `Documents\iRacing\rendererDX11Monitor.ini` (and in `rendererDX11.ini` if you have it),
with iRacing closed.

**The overlays disappear when I stop in the pits.**
That's on purpose, so they don't clutter the screen. You can change it in *General & hotkeys*.

**The track map is just a circle.**
It learns the track from your first clean lap (no pit stop, no off-track). After that it's saved for that track.

**I use VR.**
Slipstream draws on your monitor, so the overlays won't appear inside a VR headset.

## Updating and uninstalling

- **Update:** download the new version from the [releases page](https://github.com/antonholovko-cloud/Slipstream/releases/latest)
  and install it over the old one. Your settings and layouts are kept.
- **Uninstall:** Windows **Settings → Apps → Installed apps → Slipstream → Uninstall**. To also remove your
  settings, delete the `%APPDATA%\Slipstream` folder.

## Good to know

- The **wheelspin / lock-up light** is an estimate. iRacing doesn't share wheel speeds, so Slipstream learns how
  engine RPM relates to road speed in each gear, and lights up when the RPM jumps above it (wheelspin) or drops
  below it (lock-up), or when ABS is working. Front lock-ups on rear-drive cars without ABS can't be detected.
- The **iRating change** in Standings is an estimate based on the community-derived iRacing formula.
- Slipstream is an independent project and is not affiliated with or endorsed by iRacing.com Motorsport Simulations.

<sub>Want to build Slipstream yourself or contribute? See the [developer notes](docs/DEVELOPMENT.md).</sub>
