# pyhorn UI

Desktop UI for pyhorn acoustic simulator. Built with Tauri 2 + React + FastAPI.

## Running

```bash
# Start the API server first
cd pyhorn_ui && python server.py

# Then launch the Tauri app
npm run tauri dev
```

Or use the pre-built app which starts the server automatically on launch.

## Requirements

- Python ≥ 3.10 with `pyhorn` installed
- Node.js ≥ 18
- Rust (for Tauri)

## API Server

The FastAPI server runs on `http://localhost:8765`. Set `PYHORN_ROOT` to point to your `pyhorn` install:

```bash
PYHORN_ROOT=~/pyhorn python server.py
```

The Tauri app starts the server automatically via the configured Python environment.

## Features

- Interactive SPL / impedance / group delay / excursion charts
- Horn geometry visualization (2D schematic, 3D wireframe)
- Project file browser and editor
- Real-time simulation with cancellation support
