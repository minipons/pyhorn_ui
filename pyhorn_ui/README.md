# pyhorn UI

Desktop GUI for [pyhorn](https://github.com/yourrepo/pyhorn) — a Hornresp-compatible horn loudspeaker simulator with a visual horn profile builder.

## Quick Start

```bash
cd /Users/guillaume/P/GdB1/pyhorn_ui

# Terminal 1 — start the Python API server:
PYTHON_EXE=/opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.14 -m uvicorn server:app --host 127.0.0.1 --port 8765

# Terminal 2 — run the Tauri app in dev mode:
npm run tauri dev

# Or run the built app directly:
open src-tauri/target/release/bundle/macos/pyhorn.app
```

The app icon is the classic HMV gramophone logo. The Python server on port 8765 must be running before launching the app.

---

## What the UI Does

The pyhorn UI is a real-time horn simulator. You edit driver and horn parameters, click **Run Simulation**, and see the acoustic response instantly — SPL, impedance, and excursion charts — plus a drawn horn profile showing the geometry, chambers, and driver.

It is a frontend for the same `pyhorn.solver.models.horn_response()` engine that powers the CLI.

---

## UI Panels

### 📦 Registry Browser (top of sidebar)
Browse and load saved drivers and projects from `~/.pyhorn/`.

- **All / Drivers / Projects** filter tabs
- **Load** button — populates the YAML editor and parameter panels
- **✕** — removes entry from registry (does not delete the file)
- **↺** — refreshes the list

Use this to save your favourite configurations for quick recall.

### ⚙ Driver Parameters
Click any value to edit it inline. Hover for a tooltip explaining the parameter.

| Parameter | Units | What it means |
|-----------|-------|---------------|
| fs | Hz | Free-air resonance |
| Qts | — | Total Q factor |
| Qes | — | Electrical Q |
| Qms | — | Mechanical Q |
| Vas | L | Equivalent compliance volume |
| Re | Ω | DC voice coil resistance |
| Bl | N/A | Force factor |
| Mms | g | Moving mass |
| Sd | cm² | Piston radiation area |
| Le | mH | Voice coil inductance |
| Xmax | mm | Linear excursion limit |
| Voltage | V | SPL reference voltage |

Use the **+ Presets** button to load one of the built-in drivers (Fostex FE166NV2, Dayton RS180-4, Tango 7W).

### 🎺 Horn Parameters
Click any value to edit it inline. Hover for a tooltip.

| Parameter | Units | What it means |
|-----------|-------|---------------|
| Profile | — | Flare law: exponential, conical, hyperbolic, parabolic |
| Throat area | cm² | Cross-section at the narrowest point |
| Mouth area | cm² | Cross-section at the open end |
| Expansion | :1 | Mouth / throat area ratio |
| Path length | cm | Total acoustic path length |
| Radiation angle | ° | Solid angle of mouth radiation |
| Rear chamber | cm³ | Sealed box volume behind the driver |
| Throat chamber | cm³ | Sealed volume between cone and horn throat |
| Throat atc | cm² | Cross-section of the throat chamber opening |
| Rear len lrc | cm | Average acoustic path length of rear chamber |
| Segments | — | Discretisation resolution for TMM cascade |

### Horn Metrics Strip
Below the parameters, a row of coloured badge chips shows computed acoustic metrics:

- **fc** — cutoff frequency (amber)
- **krm** — mouth size parameter (cyan)
- **mouth dia** — mouth diameter in cm
- **expansion** — area ratio
- **rating** — green (midrange OK) / amber (bass OK) / red (undersized mouth)

### Horn Profile Canvas
A drawn view of the horn shape:
- Blue-filled horn polygon, expanding from throat to mouth
- Throat chamber (TC) and rear chamber (RC) labelled
- Driver circle sized from Sd
- Scale bar in centimetres

The profile redraws automatically whenever `resultAvailable` is true.

### SPL Chart
SPL vs frequency response. Includes:
- **Cutoff reference line** — dashed amber vertical at the computed `fc`
- **Infinite baffle** reference (dashed grey, if available)

Frequency axis uses human-readable labels: 20, 50, 100, 200, 500, 1k, 2k, 5k, 10k.

### Impedance Chart
Electrical impedance magnitude (Ω) vs frequency.

### Excursion Chart
Peak diaphragm displacement (mm) vs frequency.

---

## YAML Panels

Driver YAML and Horn YAML are collapsed by default to keep the UI clean. Click **↓ expand** to reveal the raw YAML text editor.

You can also **Load file** from disk — use this to import configurations created via the CLI or exported from other tools.

---

## Registry API

The Python server exposes a REST API for registry operations:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/registry/` | List all entries (filter: `?kind=driver\|project`) |
| GET | `/registry/{name}` | Get entry metadata |
| POST | `/registry/add` | Add entry (copies YAML to `~/.pyhorn/`) |
| DELETE | `/registry/{name}` | Remove entry from registry |
| PATCH | `/registry/{name}` | Update description / tags |
| GET | `/registry/{name}/file` | Read YAML content |
| PUT | `/registry/{name}/file` | Write YAML content |
| GET | `/registry/{name}/resolve` | Get absolute file path |

---

## Architecture

```
pyhorn_ui/
├── server.py              ← FastAPI server on port 8765
├── src/
│   ├── App.tsx            ← React frontend — all UI panels
│   ├── styles.css         ← Dark theme CSS variables
│   └── components/
│       ├── HornShape.tsx         ← Canvas: horn profile drawing
│       ├── HornMetrics.tsx        ← Badge chips: fc, krm, rating, etc.
│       ├── HornSummary.tsx        ← Read-only parameter table
│       ├── EditableHornSummary.tsx ← Click-to-edit horn parameters
│       ├── EditableDriverSummary.tsx ← Click-to-edit driver parameters
│       ├── RegistryBrowser.tsx    ← Registry list + load/delete
│       ├── InfoTooltip.tsx        ← Hover tooltip component
│       └── HornTuners.tsx         ← (removed, sliders were replaced)
├── src-tauri/
│   └── src/main.rs       ← Tauri app + Python server spawning
└── src-tauri/target/release/bundle/macos/pyhorn.app
```

---

## Configuration

- **Python interpreter** — auto-detected via `PYTHON_EXE` env var; defaults to `/opt/homebrew/bin/python3.14`
- **API server** — `http://127.0.0.1:8765` (auto-started by the Tauri app)
- **CORS** — open for local development

---

## Building

```bash
cd pyhorn_ui
npm run tauri build
```

Output: `src-tauri/target/release/bundle/macos/pyhorn.app` and `.dmg`.
