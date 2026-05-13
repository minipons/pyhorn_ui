"""FastAPI server that wraps pyhorn for the Tauri desktop app."""
from __future__ import annotations

import sys
import os
from pathlib import Path
from typing import Optional, List, Literal

# pyhorn_core is installed as a pip package — no sys.path manipulation needed
# The server imports pyhorn_core directly as: from pyhorn_core.solver.models import horn_response

# pyhorn_core is imported as a pip package — no runtime check needed
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
import numpy as np
import scipy.signal as scipy_signal
import asyncio

# Import pyhorn components
from pyhorn_core.config.parser import parse_driver_specs, parse_horn_geometry
from pyhorn_core.config.models import DriverSpecs, HornGeometry
from pyhorn_core.solver.models import horn_response
from pyhorn_core.solver.room import RoomConfig, compute_room_gain, apply_room_gain
from pyhorn_api.routes.room import RoomGainComputeRequest, RoomGainComputeResponse
from pyhorn_core.solver.adapter import compute_throat_adapter, throat_adapter_profile
from pyhorn_registry import Registry, RegistryEntry
from pyhorn_api.routes.room import router as room_router
from pyhorn_core.solver.wavefront import (
    boundary_condition_mask,
    solve_2d_wave_pml,
    ka_warning,
)


app = FastAPI(title="pyhorn API", version="1.0.0", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OptionsFallbackMiddleware(BaseHTTPMiddleware):
    """Catch-all middleware that intercepts OPTIONS requests before the router.

    Without this, OPTIONS requests to routes that only allow specific methods
    (POST/GET) get a 405 from the routing layer *before* CORSMiddleware can
    handle the preflight.  This middleware returns a 200 with appropriate CORS
    headers for any OPTIONS request, letting CORSMiddleware's response-middleware
    phase add the rest of the headers.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return Response(status_code=200, headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Credentials": "false",
            })
        return await call_next(request)


app.add_middleware(OptionsFallbackMiddleware)


# ── Global exception handlers ─────────────────────────────────────────────────────
# These catch unhandled errors from all endpoints and return clean user-facing messages
# instead of leaking raw Python tracebacks or exception text.


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    """Convert Pydantic ValidationError to user-friendly 422 responses.

    Shows which field is missing or invalid, without leaking Python tracebacks.
    E.g. "Missing required field: 'throat_area'" or "Invalid value for 'fs': ensure this value is greater than 0".
    """
    errors = exc.errors()
    if not errors:
        return JSONResponse(
            status_code=422,
            content={"detail": "Validation error", "errors": []},
        )

    messages = []
    for err in errors:
        loc = err.get("loc", ())
        field = ".".join(str(l) for l in loc) if loc else "unknown"
        msg = err.get("msg", "").strip()
        input_type = err.get("type", "")

        if "missing" in input_type or "field required" in msg.lower():
            messages.append(f"Missing required field: '{field}'")
        elif msg:
            messages.append(f"Invalid value for '{field}': {msg}")
        else:
            messages.append(f"Invalid '{field}'")

    detail = "; ".join(messages) if messages else "Validation error"
    return JSONResponse(status_code=422, content={"detail": detail})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Catch-all for unexpected errors — logs the full traceback server-side
    and returns a generic 500 message to the client so internal details don't leak."""
    import sys as _sys, traceback as _tb
    _tb.print_exc(file=_sys.stderr)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again or report this issue."},
    )


# ── Wavefront 2-D simulator ───────────────────────────────────────────────────────

import warnings


class WavefrontComputeRequest(BaseModel):
    """Request parameters for 2-D wavefront pressure-field computation."""

    coordinates: list[list[float]] = Field(
        ...,
        description="Horn centreline polygon vertices as [x, y] pairs in metres.",
    )
    source_x: Optional[float] = Field(
        None,
        description="Driver/source x position in metres. Defaults to the centroid.",
    )
    source_y: Optional[float] = Field(
        None,
        description="Driver/source y position in metres. Defaults to the centroid.",
    )
    enclosure_dims: Optional[list[float]] = Field(
        None,
        description="[width_m, height_m] of the rectangular enclosure.",
    )
    frequency: float = Field(500.0, description="Drive frequency in Hz.")
    nx: int = Field(80, description="Number of grid points in x direction.")
    ny: int = Field(40, description="Number of grid points in y direction.")
    wall_thickness: float = Field(0.005, description="Wall exclusion band thickness in metres.")
    pml_width: int = Field(15, description="PML absorbing boundary width in grid cells.")


class WavefrontComputeResponse(BaseModel):
    """Response from the 2-D wavefront pressure-field computation."""

    frequency_hz: float = Field(..., description="Drive frequency (Hz).")
    k_radm: float = Field(..., description="Wave number k = 2πf/c (rad/m).")
    nx: int = Field(..., description="Number of grid points in x.")
    ny: int = Field(..., description="Number of grid points in y.")
    dx_m: float = Field(..., description="Grid spacing in x (m).")
    dy_m: float = Field(..., description="Grid spacing in y (m).")
    mesh_x: list[list[float]] = Field(..., description="2-D array (ny × nx) of x coordinates in metres.")
    mesh_y: list[list[float]] = Field(..., description="2-D array (ny × nx) of y coordinates in metres.")
    p_magnitude: list[list[float]] = Field(..., description="2-D array (ny × nx) of pressure magnitudes |p| in Pa.")
    p_real: list[list[float]] = Field(..., description="2-D array (ny × nx) of real(p) in Pa.")
    horn_polygon_m: list[list[float]] = Field(..., description="Closed polygon [x, y] vertices of the horn geometry in metres.")
    source_x_m: float = Field(..., description="Source x position (m).")
    source_y_m: float = Field(..., description="Source y position (m).")
    ka_validity: str = Field(
        ...,
        description="k·a validity message: 'valid' if k·a < 0.5, or a warning string if k·a ≥ 0.5.",
    )


class SimRequest(BaseModel):
    driver_config: str   # raw YAML string
    horn_config: str     # raw YAML string
    fmin: float = 20.0
    fmax: float = 5000.0
    n_points: int = 500
    off_axis_angles: Optional[list[float]] = None  # optional off-axis angles in degrees
    fdd_mode: bool = False  # use FDD (Frequency Dependent Directivity) model
    fdd_fc: float = 300.0   # FDD characteristic transition frequency (Hz)
    fdd_dmax: float = 5.0   # FDD maximum directivity index (dB)
    # Thermal power compression (Hornresp page 98): voice coil temperature in °C.
    # When provided (>20°C), thermal compression dB reduction is computed and returned.
    T_voice: Optional[float] = None
    # Notch filter: apply narrow IIR notches at specified frequencies to suppress
    # TMM numerical artifacts (e.g. the ~1847 Hz Hiro resonance).
    notch_filter: bool = False
    notch_frequencies: Optional[list[float]] = None  # list of Hz centre frequencies
    notch_q: float = 10.0  # Q factor for notch filters (higher = narrower)
    # Room boundary gain (Hornresp page 96): models effect of room walls on power response.
    # room_type: 'free_space' (default), 'half_space', 'quarter_space', 'eighth_space'.
    # room_volume_m3: room volume for Sabine room-mode estimation (optional).
    room_type: Optional[str] = "free_space"
    room_volume_m3: Optional[float] = None
    # Filter Wizard delay display mode: 'group_delay' (ms) or 'per_period' (dimensionless = τ_g × f).
    # Hornresp page 120 — Filter Wizard 'Delay' option.
    filter_delay_mode: Literal["group_delay", "per_period"] = "group_delay"


# ── Throat Adapter ─────────────────────────────────────────────────────────────────

class ThroatAdapterComputeRequest(BaseModel):
    """Request body for POST /throat-adapter/compute."""
    D1_mm: float
    D2_mm: float
    A1_deg: float
    A2_deg: float
    profile_type: str
    length_mm: Optional[float] = None


class ThroatAdapterComputeResponse(BaseModel):
    """Response from POST /throat-adapter/compute."""
    ap1_m2: float
    lpt_m: float
    minimum_length_m: float
    profile_type: str
    profile: dict  # x[], area[], diam[], A0, Ap1


class ThroatAdapterProfileResponse(BaseModel):
    """Response from GET /throat-adapter/profile."""
    x: list[float]
    area: list[float]
    diam: list[float]
    A0: float
    Ap1: float


class ThroatAdapterExportResponse(BaseModel):
    """Response from GET/POST /throat-adapter/export — a ready-to-paste YAML snippet."""
    yaml: str


# In-memory store for the latest simulation result
_latest_result: Optional[dict] = None


@app.post("/wavefront/compute", response_model=WavefrontComputeResponse)
def wavefront_compute(req: WavefrontComputeRequest):
    """Solve the 2-D Helmholtz equation for a horn geometry at a given frequency.

    This endpoint runs the pyhorn wavefront simulator: a sparse finite-difference
    solution of the 2-D Helmholtz equation (∇²p + k²p = 0) with PML absorbing
    boundary conditions.  It returns the complex pressure field as JSON arrays,
    which the caller can render as a colormap.
    """
    # ── Build coordinate array ────────────────────────────────────────────────
    coords = np.asarray(req.coordinates, dtype=np.float64)
    if coords.ndim != 2 or coords.shape[1] != 2:
        raise HTTPException(
            status_code=422,
            detail="coordinates must be a list of [x, y] pairs in metres",
        )

    # ── Grid bounds (tight bounding box + 25 mm margin) ─────────────────────
    margin = 0.025
    x_min = float(coords[:, 0].min() - margin)
    x_max = float(coords[:, 0].max() + margin)
    y_min = float(coords[:, 1].min() - margin)
    y_max = float(coords[:, 1].max() + margin)

    mesh_x_arr = np.linspace(x_min, x_max, req.nx)
    mesh_y_arr = np.linspace(y_min, y_max, req.ny)
    mesh_xx, mesh_yy = np.meshgrid(mesh_x_arr, mesh_y_arr)

    # ── Boundary mask ───────────────────────────────────────────────────────
    walls = boundary_condition_mask(
        coords, mesh_xx, mesh_yy, wall_thickness=req.wall_thickness
    )

    # ── Source position ──────────────────────────────────────────────────────
    if req.source_x is not None and req.source_y is not None:
        source_x = float(req.source_x)
        source_y = float(req.source_y)
    else:
        source_x = float(np.mean(coords[:, 0]))
        source_y = float(np.mean(coords[:, 1]))

    # ── Solve ───────────────────────────────────────────────────────────────
    grid = solve_2d_wave_pml(
        mesh_x=mesh_xx,
        mesh_y=mesh_yy,
        source_x=source_x,
        source_y=source_y,
        frequency=req.frequency,
        boundary_mask=walls,
        pml_width=req.pml_width,
    )

    # ── k·a validity check ──────────────────────────────────────────────────
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ka_msg = ka_warning(
            grid.pressure_field, mesh_xx, mesh_yy, req.frequency
        )
    ka_validity = (
        ka_msg.strip()
        if ka_msg
        else f"k·a < 0.5 — 1-D horn assumption valid at {req.frequency:.1f} Hz."
    )

    # ── Serialise 2-D arrays to JSON (row-major lists) ─────────────────────
    p_mag = np.abs(grid.pressure_field)
    p_real = grid.pressure_field.real

    return WavefrontComputeResponse(
        frequency_hz=req.frequency,
        k_radm=float(grid.k),
        nx=grid.nx,
        ny=grid.ny,
        dx_m=float(grid.dx),
        dy_m=float(grid.dy),
        mesh_x=mesh_xx.tolist(),
        mesh_y=mesh_yy.tolist(),
        p_magnitude=p_mag.tolist(),
        p_real=p_real.tolist(),
        horn_polygon_m=coords.tolist(),
        source_x_m=source_x,
        source_y_m=source_y,
        ka_validity=ka_validity,
    )


@app.post("/simulate")
async def simulate(req: SimRequest):
    """Run a horn simulation given driver and horn YAML configs."""
    import tempfile

    global _latest_result

    try:
        # Write driver config to temp file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as df:
            df.write(req.driver_config)
            driver_path = df.name

        # Write horn config to temp file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as hf:
            hf.write(req.horn_config)
            horn_path = hf.name

        try:
            # Parse configs
            driver = parse_driver_specs(Path(driver_path))
            horn = parse_horn_geometry(Path(horn_path))

            # Run simulation
            freqs = np.logspace(np.log10(req.fmin), np.log10(req.fmax), req.n_points)
            off_axis_angles_np = np.asarray(req.off_axis_angles) if req.off_axis_angles is not None else None
            notch_freqs = req.notch_frequencies if req.notch_frequencies else None
            result = horn_response(
                freqs, driver, horn,
                off_axis_angles=off_axis_angles_np,
                fdd_mode=req.fdd_mode,
                fdd_fc=req.fdd_fc,
                fdd_dmax=req.fdd_dmax,
                T_voice=req.T_voice,
                notch_filter=req.notch_filter,
                notch_frequencies=notch_freqs,
                notch_q=req.notch_q,
            )

            # ── Room boundary gain (Hornresp page 96) ─────────────────────────
            room_type = req.room_type if req.room_type else "free_space"
            room_gain_db = compute_room_gain(
                freqs,
                room_type,
                distance_to_wall_m=None,
                room_volume_m3=req.room_volume_m3,
            )
            # Attach to result for completeness
            result.room_gain_db = room_gain_db
            result.room_type = room_type

            # ── Polyfill mass computation ───────────────────────────────────────
            # Hornresp pages 73-74: segments with fr1 < 1000 Rayls/m and tal1 > 0
            # contain damping material. Approximate mass = volume × tal1 × 15 kg/m³.
            POLYFILL_DENSITY_KG_M3 = 15.0  # polyester fibre bulk density
            polyfill_mass_kg: Optional[float] = None
            if horn.sections:
                total_mass = 0.0
                for sec in horn.sections:
                    if sec.fr1 > 0 and sec.fr1 < 1000 and sec.tal1 > 0:
                        volume_m3 = (sec.start_area + sec.end_area) / 2.0 * sec.length
                        total_mass += volume_m3 * sec.tal1 * POLYFILL_DENSITY_KG_M3
                if total_mass > 0:
                    polyfill_mass_kg = total_mass

            _latest_result = {
                "frequencies": freqs.tolist(),
                "spl": result.spl.tolist(),
                "impedance": np.abs(result.impedance).tolist(),
                "impedance_real": result.impedance.real.tolist(),
                "impedance_imag": result.impedance.imag.tolist(),
                "impedance_phase_deg": (
                    result.impedance_phase_deg.tolist()
                    if result.impedance_phase_deg is not None
                    else (np.angle(result.impedance) * 180.0 / np.pi).tolist()
                ),
                "excursion": result.excursion.tolist(),
                "ib_spl": result.ib_spl.tolist() if result.ib_spl is not None else None,
                "horn_spl": result.horn_spl.tolist() if result.horn_spl is not None else None,
                "phase_degrees": np.rad2deg(result.phase).tolist() if result.phase is not None else None,
                "group_delay_ms": result.group_delay.tolist() if result.group_delay is not None else None,
                "group_delay_per_period": (
                    result.group_delay_per_period.tolist()
                    if result.group_delay_per_period is not None
                    else None
                ),
                "off_axis_spl": result.off_axis_spl.tolist() if result.off_axis_spl is not None else None,
                "off_axis_angles": result.off_axis_angles.tolist() if result.off_axis_angles is not None else None,
                "radiation_angle": result.radiation_angle,
                "fdd_enabled": result.fdd_enabled,
                "fdd_di": result.fdd_di.tolist() if result.fdd_di is not None else None,
                "direction_index": result.direction_index.tolist() if result.direction_index is not None else None,
                # Previously missing — now exposed:
                "efficiency_pct": result.efficiency_pct.tolist() if result.efficiency_pct is not None else None,
                "throat_impedance_real": result.throat_impedance.real.tolist() if result.throat_impedance is not None else None,
                "throat_impedance_imag": result.throat_impedance.imag.tolist() if result.throat_impedance is not None else None,
                "throat_impedance_magnitude": np.abs(result.throat_impedance).tolist() if result.throat_impedance is not None else None,
                "second_tone_distortion": result.second_tone_distortion.tolist() if result.second_tone_distortion is not None else None,
                "thermal_compression_db": result.thermal_compression_db.tolist() if result.thermal_compression_db is not None else None,
                "spl_notched": result.spl_notched.tolist() if result.spl_notched is not None else None,
                "cone_velocity": result.cone_velocity.tolist() if result.cone_velocity is not None else None,
                "cone_acceleration": result.cone_acceleration.tolist() if result.cone_acceleration is not None else None,
                "electrical_input_power": result.electrical_input_power.tolist() if result.electrical_input_power is not None else None,
                # Diaphragm pressure (Hornresp pages 124-125)
                "diaphragm_pressure_total": (
                    np.abs(result.diaphragm_pressure_total).tolist()
                    if result.diaphragm_pressure_total is not None
                    else None
                ),
                "diaphragm_pressure_horn_side": (
                    np.abs(result.diaphragm_pressure_horn_side).tolist()
                    if result.diaphragm_pressure_horn_side is not None
                    else None
                ),
                "diaphragm_pressure_direct_side": (
                    np.abs(result.diaphragm_pressure_direct_side).tolist()
                    if result.diaphragm_pressure_direct_side is not None
                    else None
                ),
                # Particle velocity at throat/mouth/port (Hornresp page 106)
                "particle_velocity_throat": (
                    result.particle_velocity_throat.tolist()
                    if result.particle_velocity_throat is not None
                    else None
                ),
                "particle_velocity_mouth": (
                    result.particle_velocity_mouth.tolist()
                    if result.particle_velocity_mouth is not None
                    else None
                ),
                "particle_velocity_port": (
                    result.particle_velocity_port.tolist()
                    if result.particle_velocity_port is not None
                    else None
                ),
                # Room boundary gain (Hornresp page 96):
                "room_gain_db": room_gain_db.tolist(),
                "room_type": room_type,
                # TMM diagnostic info:
                "numerical_artifacts": result.numerical_artifacts if result.numerical_artifacts is not None else [],
                "segment_widths": result.segment_widths if result.segment_widths is not None else [],
                # Polyfill mass (Hornresp pages 73-74)
                "polyfill_mass_kg": polyfill_mass_kg,
            }

            return _latest_result

        finally:
            os.unlink(driver_path)
            os.unlink(horn_path)

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/results")
async def get_results():
    """Return the last computed simulation results."""
    if _latest_result is None:
        raise HTTPException(status_code=404, detail="No simulation results yet. Call /simulate first.")
    return _latest_result


@app.get("/health")
async def health():
    return {"status": "ok"}


class SynthRequest(BaseModel):
    """Request body for /synthesize."""
    fs: float
    qts: float
    qes: float
    qms: float
    vas: float
    re: float
    bl: float
    mms: float
    cms: float
    rms: float
    sd: float
    voltage: float = 2.83
    le: float = 0.0
    xmax: float = 0.0
    fmin: float = 80.0
    fmax: float = 5000.0
    mouth_area_max: Optional[float] = None
    path_length_max: Optional[float] = None
    profile_types: Optional[list[str]] = None


# In-memory store for synthesis tasks
_synth_tasks: dict[str, dict] = {}
_task_counter = 0


@app.post("/synthesize")
async def synthesize(req: SynthRequest):
    """Kick off horn synthesis (async). Returns a task_id immediately.
    Poll GET /synthesize/{task_id} for results."""
    global _task_counter
    task_id = str(_task_counter)
    _task_counter += 1

    _synth_tasks[task_id] = {"status": "running", "result": None, "error": None}

    async def _run():
        import threading

        def _optimize():
            # Lazy import to avoid pulling in shapely dependency at server startup
            from pyhorn.solver.optimizer import optimize, OptimizationConfig
            from pyhorn.config.design_space import ALL_PROFILE_TYPES
            try:
                driver = DriverSpecs(
                    fs=req.fs, qts=req.qts, qes=req.qes, qms=req.qms,
                    vas=req.vas, re=req.re, bl=req.bl,
                    mms=req.mms, cms=req.cms, rms=req.rms, sd=req.sd,
                    voltage=req.voltage, le=req.le, xmax=req.xmax,
                )
                config = OptimizationConfig(
                    fmin=req.fmin, fmax=req.fmax,
                    profile_types=req.profile_types or list(ALL_PROFILE_TYPES),
                    max_iter=60, popsize=8, tol=3e-3,
                )
                if req.mouth_area_max is not None:
                    config.mouth_area_range = (
                        config.mouth_area_range[0], req.mouth_area_max
                    )
                if req.path_length_max is not None:
                    config.path_length_range = (
                        config.path_length_range[0], req.path_length_max
                    )

                results = optimize(driver, config)
                if not results:
                    raise RuntimeError("Optimization produced no results")

                best = results[0]
                _synth_tasks[task_id]["result"] = {
                    "horn": {
                        "throat_area": best.horn.throat_area,
                        "mouth_area": best.horn.mouth_area,
                        "path_length": best.horn.path_length,
                        "profile_type": best.horn.profile_type,
                        "hyperbolic_t": best.horn.hyperbolic_t,
                        "n_segments": best.horn.n_segments,
                        "enclosure_type": best.horn.enclosure_type,
                        "lrc": best.horn.lrc,
                        "vrc": best.horn.vrc,
                        "vtc": best.horn.vtc,
                        "atc": best.horn.atc,
                        "ang": best.horn.ang,
                    },
                    "metrics": {
                        "profile_type": best.profile_type,
                        "cost": best.cost,
                        "mean_spl_db": best.mean_spl,
                        "flatness_db": best.flatness_db,
                        "bass_deficit_db": best.bass_deficit_db,
                        "excursion_ok": best.excursion_ok,
                        "n_evaluations": best.n_evaluations,
                    },
                }
                _synth_tasks[task_id]["status"] = "done"
            except Exception as e:
                import traceback
                traceback.print_exc()
                _synth_tasks[task_id]["error"] = str(e)
                _synth_tasks[task_id]["status"] = "done"

        await asyncio.to_thread(_optimize)

    asyncio.create_task(_run())
    return {"task_id": task_id, "status": "running"}


@app.get("/synthesize/{task_id}")
async def get_synthesize_result(task_id: str):
    """Return the status/result of a synthesis task."""
    if task_id not in _synth_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return _synth_tasks[task_id]


@app.post("/throat-adapter/compute", response_model=ThroatAdapterComputeResponse)
async def throat_adapter_compute(req: ThroatAdapterComputeRequest):
    """Compute a throat adapter geometry and return its profile.

    Accepts diameters in mm, converts to metres internally.
    If length_mm is not provided the geometric minimum is used.
    """
    length_m = req.length_mm / 1000.0 if req.length_mm is not None else None
    adapter = compute_throat_adapter(
        D1=req.D1_mm / 1000.0,
        D2=req.D2_mm / 1000.0,
        A1_deg=req.A1_deg,
        A2_deg=req.A2_deg,
        profile_type=req.profile_type,
        length=length_m,
    )

    # Minimum length (without explicit length override)
    min_adapter = compute_throat_adapter(
        D1=req.D1_mm / 1000.0,
        D2=req.D2_mm / 1000.0,
        A1_deg=req.A1_deg,
        A2_deg=req.A2_deg,
        profile_type=req.profile_type,
        length=None,
    )

    profile = throat_adapter_profile(adapter, n_points=101)

    return ThroatAdapterComputeResponse(
        ap1_m2=adapter.ap1,
        lpt_m=adapter.lpt,
        minimum_length_m=min_adapter.lpt,
        profile_type=adapter.type,
        profile={
            "x": profile["x"].tolist(),
            "area": profile["area"].tolist(),
            "diam": profile["diam"].tolist(),
            "A0": profile["A0"],
            "Ap1": profile["Ap1"],
        },
    )


@app.get("/throat-adapter/export", response_model=ThroatAdapterExportResponse)
async def throat_adapter_export(req: ThroatAdapterComputeRequest):
    """Compute a throat adapter and return a ready-to-paste YAML snippet.

    Same parameters as /throat-adapter/compute. Returns a YAML-formatted string
    with throat_adapter section ready to paste into a project YAML file.
    """
    length_m = req.length_mm / 1000.0 if req.length_mm is not None else None
    adapter = compute_throat_adapter(
        D1=req.D1_mm / 1000.0,
        D2=req.D2_mm / 1000.0,
        A1_deg=req.A1_deg,
        A2_deg=req.A2_deg,
        profile_type=req.profile_type,
        length=length_m,
    )

    yaml_str = (
        f"throat_adapter:\n"
        f"  type: {adapter.type}\n"
        f"  ap1: {adapter.ap1:.5f}  # m²\n"
        f"  lpt: {adapter.lpt:.4f}  # m\n"
    )
    return ThroatAdapterExportResponse(yaml=yaml_str)


@app.get("/throat-adapter/profile", response_model=ThroatAdapterProfileResponse)
async def throat_adapter_get_profile(
    d1: float,
    d2: float,
    a1: float,
    a2: float,
    type: str,
    n_points: int = 101,
):
    """Quick throat adapter profile preview.

    Query params (d1/d2 in mm, a1/a2 in degrees):
    - d1: input diameter (throat chamber side)
    - d2: output diameter (horn throat side)
    - a1: input flare half-angle in degrees
    - a2: output flare half-angle in degrees
    - type: profile_type (cylindrical/conical/exponential/parabolic)
    - n_points: number of cross-sections (default 101)
    """
    adapter = compute_throat_adapter(
        D1=d1 / 1000.0,
        D2=d2 / 1000.0,
        A1_deg=a1,
        A2_deg=a2,
        profile_type=type,
    )
    profile = throat_adapter_profile(adapter, n_points=n_points)
    return ThroatAdapterProfileResponse(
        x=profile["x"].tolist(),
        area=profile["area"].tolist(),
        diam=profile["diam"].tolist(),
        A0=profile["A0"],
        Ap1=profile["Ap1"],
    )


# ── Chamber Design Wizard ──────────────────────────────────────────────────────


class ChamberWizardComputeRequest(BaseModel):
    """Request body for POST /chamber-wizard/compute.

    Given a driver's Vas, Qts, and Sd, compute recommended rear-chamber and
    throat-chamber parameters for a back-loaded horn design.

    All linear dimensions are in metres (m). Volume in m³.
    """
    # ── Driver parameters ──────────────────────────────────────────────────
    vas_m3: float       # Vas in m³  (1 L = 0.001 m³)
    qts: float          # Total Q of driver (Qts, dimensionless)
    sd_m2: float        # Driver piston area in m²  (1 cm² = 1e-4 m²)

    # ── Tuning ─────────────────────────────────────────────────────────────
    # Target Qts for the overall system (rear chamber + horn loading).
    # Typically 0.5 – 0.7. Default 0.6.
    qts_target: float = 0.6

    # ── Optional physical constraints ──────────────────────────────────────
    # If provided, Lrc will be capped so width × height ≥ cross-section.
    max_width_m:  Optional[float] = None
    max_height_m: Optional[float] = None

    # ── Optional overrides ─────────────────────────────────────────────────
    # If provided, use this instead of sd_m2 for Atc.
    atc_override_m2: Optional[float] = None


class ParameterExplanation(BaseModel):
    value: float
    unit: str
    label: str
    explanation: str


class ChamberWizardComputeResponse(BaseModel):
    """Response from POST /chamber-wizard/compute."""
    # ── Rear chamber ────────────────────────────────────────────────────────
    vrc_m3:  float   # Rear chamber volume (m³)
    vrc_l:   float   # Rear chamber volume (litres)
    lrc_m:   float   # Rear chamber depth/length (m)
    lrc_cm:  float   # Rear chamber depth/length (cm)

    # ── Throat chamber ──────────────────────────────────────────────────────
    vtc_m3:  float   # Throat chamber volume (m³)
    vtc_cm3: float   # Throat chamber volume (cm³)
    atc_m2:  float   # Throat chamber cross-sectional area (m²)
    atc_cm2: float   # Throat chamber cross-sectional area (cm²)

    # ── Metadata ───────────────────────────────────────────────────────────
    qts_driver: float   # Input driver Qts
    qts_target: float   # Target Qts used in calculation
    sd_m2:      float   # Driver piston area (echoed back)
    warnings:   list[str]  # Validation warnings (empty = all OK)

    # ── Explanation of each parameter ───────────────────────────────────────
    explanations: dict[str, dict]  # key → {value, unit, label, explanation}


@app.post("/chamber-wizard/compute", response_model=ChamberWizardComputeResponse)
async def chamber_wizard_compute(req: ChamberWizardComputeRequest):
    """Compute recommended Vrc, Lrc, Vtc, Atc for a back-loaded horn.

    The rear chamber (Vrc / Lrc) acts as an acoustic compliance that loads the
    driver's rear radiation.  Its value is set so the combined driver + chamber
    Q equals qts_target.

    Formulas
    --------
    Vrc = Vas × (Qts² / Qts_target² − 1)
        (adds compliance to lower the effective Qts to qts_target)

    Lrc = Vrc / Atc
        (depth gives the required volume at the chosen chamber cross-section)

    Atc ≈ Sd  (throat chamber area ≈ driver piston area for good coupling)

    Vtc = 0.002 × Vas  (small throat chamber ≈ 0.2% of Vas)
    """
    warnings: list[str] = []

    # ── Validate inputs ────────────────────────────────────────────────────
    if not 0 < req.qts < 5:
        warnings.append(f"Qts={req.qts} is outside typical range (0.1–1.0).")
    if req.vas_m3 <= 0:
        raise HTTPException(status_code=400, detail="vas_m3 must be positive.")
    if req.sd_m2 <= 0:
        raise HTTPException(status_code=400, detail="sd_m2 must be positive.")
    if not 0 < req.qts_target <= 2:
        raise HTTPException(status_code=400, detail="qts_target must be in (0, 2].")

    # ── Atc ─────────────────────────────────────────────────────────────────
    atc_m2 = req.atc_override_m2 if req.atc_override_m2 else req.sd_m2

    # ── Vrc ─────────────────────────────────────────────────────────────────
    ratio = (req.qts ** 2) / (req.qts_target ** 2)
    if ratio <= 1:
        warnings.append(
            f"Driver Qts={req.qts:.3f} is already ≤ qts_target={req.qts_target:.3f}. "
            "Vrc would be zero or negative; returning minimal Vrc=1 L."
        )
        vrc_m3 = 0.001  # 1 L fallback
    else:
        vrc_m3 = req.vas_m3 * (ratio - 1)

    # ── Lrc ─────────────────────────────────────────────────────────────────
    if atc_m2 <= 0:
        raise HTTPException(status_code=400, detail="atc_m2 must be positive.")
    lrc_m = vrc_m3 / atc_m2

    # Sanity-check Lrc — warn if unreasonably thin (< 5 mm) or thick (> 500 mm)
    if lrc_m < 0.005:
        warnings.append(
            f"Lrc={lrc_m*1000:.1f} mm is extremely thin. "
            "Consider a larger Atc (e.g. 2×Sd) or a wider box cross-section."
        )
    elif lrc_m > 0.5:
        warnings.append(
            f"Lrc={lrc_m*100:.1f} cm is very deep. "
            "Verify your box depth constraints can accommodate this."
        )

    # Respect user-supplied width/height constraints for cross-section
    if req.max_width_m and req.max_height_m:
        max_area = req.max_width_m * req.max_height_m
        if atc_m2 > max_area:
            warnings.append(
                f"Atc={atc_m2*1e4:.1f} cm² exceeds max cross-section "
                f"({max_area*1e4:.1f} cm² from max_width × max_height). "
                "Lrc calculation may be optimistic."
            )

    # ── Vtc ─────────────────────────────────────────────────────────────────
    # 0.2 % of Vas — small throat chamber
    vtc_m3 = 0.002 * req.vas_m3

    # ── Explanations ───────────────────────────────────────────────────────
    explanations = {
        "vrc": {
            "value": round(vrc_m3, 8),
            "unit":  "m³",
            "label": "Rear chamber volume",
            "explanation": (
                "Volume of the sealed rear chamber behind the driver. "
                f"Computed from Vas={req.vas_m3*1e3:.3f} L, driver Qts={req.qts:.3f}, "
                f"target Qts={req.qts_target:.3f}. "
                "Vrc = Vas × (Qts²/Qts_target² − 1). "
                "A larger Vrc → lower system Q → shallower bass rolloff. "
                "Too large → under-damped (peaky response). "
                "Too small → over-damped (weak bass)."
            ),
        },
        "lrc": {
            "value": round(lrc_m, 5),
            "unit":  "m",
            "label": "Rear chamber depth",
            "explanation": (
                "Physical depth of the rear chamber (distance from driver basket "
                "to rear wall). Lrc = Vrc / Atc. "
                "A deeper chamber (higher Lrc) requires a smaller Atc for the "
                "same volume — but a very thin chamber can cause turbulent "
                "air motion near the driver. Aim for Lrc ≥ 1 cm."
            ),
        },
        "vtc": {
            "value": round(vtc_m3, 8),
            "unit":  "m³",
            "label": "Throat chamber volume",
            "explanation": (
                "Small sealed volume between the driver pollen and the horn throat. "
                "Estimated as 0.2 % of Vas (~2 per mille). "
                "Acts as an acoustic mass that smooths the transition between "
                "the driver and the horn flare. "
                "Too large → poor high-frequency response. "
                "Too small → insufficient smoothing of the driver's rising response."
            ),
        },
        "atc": {
            "value": round(atc_m2, 7),
            "unit":  "m²",
            "label": "Throat chamber cross-sectional area",
            "explanation": (
                f"Cross-sectional area of the throat chamber. "
                f"Set ≈ Sd={req.sd_m2*1e4:.2f} cm² for good acoustic coupling "
                "(chamber area ≈ driver piston area). "
                "A larger Atc → shallower Lrc for the same Vrc. "
                "Hornresp reference: Atc should be slightly larger than the "
                "horn throat area (S1) to provide proper loading."
            ),
        },
        "qts_target": {
            "value": req.qts_target,
            "unit":  "—",
            "label": "Target system Qts",
            "explanation": (
                "Desired total Q of the driver + rear-chamber system. "
                "Range 0.5–0.7 is typical for BR/BLH alignments. "
                "Qts=0.5 → maximally flat (Butterworth). "
                "Qts=0.6 → slight bass emphasis (convenient default). "
                "Qts=0.7 → more bass but poorer transient response."
            ),
        },
    }

    return ChamberWizardComputeResponse(
        vrc_m3=vrc_m3,
        vrc_l=vrc_m3 * 1000.0,
        lrc_m=lrc_m,
        lrc_cm=lrc_m * 100.0,
        vtc_m3=vtc_m3,
        vtc_cm3=vtc_m3 * 1e6,
        atc_m2=atc_m2,
        atc_cm2=atc_m2 * 1e4,
        qts_driver=req.qts,
        qts_target=req.qts_target,
        sd_m2=req.sd_m2,
        warnings=warnings,
        explanations=explanations,
    )


# ── Resize Wizard ──────────────────────────────────────────────────────────────


class ResizeComputeRequest(BaseModel):
    """Request body for POST /resize/compute."""
    geometry_yaml: str        # raw YAML string for the horn geometry
    driver_yaml: str          # raw YAML string for the driver specs
    resize_factor: float      # linear scale factor (>0; >1 larger, <1 smaller)
    adjust_sd: bool = True    # scale driver Sd by factor²
    adjust_re: bool = False   # scale driver Re by factor² (default: False)


class ResizeComputeResponse(BaseModel):
    """Response from POST /resize/compute."""
    geometry_yaml: str   # resized horn geometry as YAML string
    driver_yaml: str     # resized driver specs as YAML string
    factor: float        # the resize factor applied


def _serialize_horn_geometry(horn: HornGeometry) -> str:
    """Serialize a HornGeometry to a YAML string."""
    import yaml
    def _round_list(lst, decimals=4):
        return [round(v, decimals) for v in lst] if lst else []

    data = {"enclosure_type": horn.enclosure_type}
    if horn.throat_area > 0:
        data["throat_area"] = round(horn.throat_area, 8)
    if horn.mouth_area > 0:
        data["mouth_area"] = round(horn.mouth_area, 8)
    if horn.path_length > 0:
        data["path_length"] = round(horn.path_length, 6)
    if horn.width is not None:
        data["width"] = round(horn.width, 6)
    if horn.lrc > 0:
        data["lrc"] = round(horn.lrc, 6)
    if horn.vrc > 0:
        data["vrc"] = round(horn.vrc, 8)
    if horn.vtc > 0:
        data["vtc"] = round(horn.vtc, 8)
    if horn.atc > 0:
        data["atc"] = round(horn.atc, 8)
    if horn.lpt > 0:
        data["lpt"] = round(horn.lpt, 6)
    if horn.ap1 > 0:
        data["ap1"] = round(horn.ap1, 8)
    if horn.enclosure_dims:
        data["enclosure_dims"] = _round_list(horn.enclosure_dims)
    if horn.driver_coord:
        data["driver_coord"] = _round_list(horn.driver_coord)
    if horn.coordinates:
        data["coordinates"] = [[round(x, 5), round(y, 5)] for x, y in horn.coordinates]
    if horn.conical_segments:
        data["conical_segments"] = [
            [round(v, 6) if i < 3 else v for i, v in enumerate(seg)]
            for seg in horn.conical_segments
        ]
    if horn.rectangular_segments:
        data["rectangular_segments"] = [
            [round(v, 6) if i < 5 else v for i, v in enumerate(seg)]
            for seg in horn.rectangular_segments
        ]
    if horn.segments:
        data["segments"] = [
            [round(v, 6) if i < 2 else v for i, v in enumerate(seg)]
            for seg in horn.segments
        ]
    if horn.bends:
        data["bends"] = [[round(a, 8), round(b, 8)] for a, b in horn.bends]
    if horn.discretisation:
        data["discretisation"] = horn.discretisation
    if horn.bend_angles:
        data["bend_angles"] = [round(a, 4) for a in horn.bend_angles]
    return yaml.safe_dump(data, sort_keys=False, default_flow_style=False)


def _serialize_driver_specs(driver: DriverSpecs) -> str:
    """Serialize a DriverSpecs to a YAML string."""
    import yaml
    fields = [
        "fs", "qts", "qes", "qms", "vas", "re", "bl", "mms", "cms",
        "rms", "sd", "voltage", "le", "xmax", "alpha_re",
    ]
    data = {}
    for f in fields:
        val = getattr(driver, f, None)
        if val is not None and val != 0.0:
            data[f] = round(val, 8) if f != "alpha_re" else val
    if driver.le_freq_dependency:
        data["le_freq_dependency"] = True
        data["le_f_ref"] = round(driver.le_f_ref, 2)
    return yaml.safe_dump(data, sort_keys=False, default_flow_style=False)


@app.post("/resize/compute", response_model=ResizeComputeResponse)
async def resize_compute(req: ResizeComputeRequest):
    """Resize Wizard — scale a horn geometry and driver proportionally.

    Accepts raw YAML strings for geometry and driver, applies the resize factor,
    and returns the resized YAML strings.

    Scaling rules (Hornresp page 68):
      - Throat/mouth area (S1, S2)  → × resize_factor²
      - Path length (L12)            → × resize_factor
      - Driver Sd                   → × resize_factor²  (--adjust-sd/--no-adjust-sd)
      - Driver Re                   → × resize_factor²  (default: unchanged)
      - Driver Mms, BL, CMS, RMS, VAS → UNCHANGED
    """
    import yaml

    if req.resize_factor <= 0:
        raise HTTPException(status_code=400, detail="resize_factor must be positive")

    try:
        geometry_data = yaml.safe_load(req.geometry_yaml)
        driver_data = yaml.safe_load(req.driver_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    horn = HornGeometry(**{
        k: v for k, v in geometry_data.items()
        if k in HornGeometry.__dataclass_fields__
    })
    driver = DriverSpecs(**{
        k: v for k, v in driver_data.items()
        if k in DriverSpecs.__dataclass_fields__
    })

    from pyhorn_core.solver.resize import apply_resize
    resized_geo, resized_driver = apply_resize(
        horn, driver, req.resize_factor,
        adjust_sd=req.adjust_sd, adjust_re=req.adjust_re
    )

    return ResizeComputeResponse(
        geometry_yaml=_serialize_horn_geometry(resized_geo),
        driver_yaml=_serialize_driver_specs(resized_driver),
        factor=req.resize_factor,
    )


# ── Width Adjustment (Rectangular Horns) ─────────────────────────────────────────


class WidthAdjustmentRequest(BaseModel):
    """Request body for POST /width-adjustment/compute."""
    geometry_yaml: str       # raw YAML string for the horn geometry
    width_factor: float      # linear scale factor for width (>0; >1 wider, <1 narrower)


class WidthAdjustmentResponse(BaseModel):
    """Response from POST /width-adjustment/compute."""
    geometry_yaml: str   # adjusted horn geometry as YAML string
    width_factor: float  # the width factor applied


def _apply_width_adjustment(geometry_yaml: str, width_factor: float) -> str:
    """
    Apply a width scale factor to rectangular_segments in a horn geometry YAML.

    Each rectangular segment has the form:
        [width_start, height_start, width_end, height_end, length_m, ...]
    This function multiplies width_start and width_end by width_factor,
    leaving heights and lengths unchanged.

    Since height is constant, the mouth area changes proportionally to the width
    factor, which affects horn loading and cutoff frequency.
    """
    import yaml

    data = yaml.safe_load(geometry_yaml)
    if data is None:
        data = {}

    if "rectangular_segments" not in data or data["rectangular_segments"] is None:
        raise ValueError(
            "No rectangular_segments found in geometry YAML. "
            "Width adjustment only applies to rectangular horns."
        )

    if not data["rectangular_segments"]:
        raise ValueError(
            "rectangular_segments is empty. At least one segment is required."
        )

    adjusted = []
    for seg in data["rectangular_segments"]:
        # seg: [w1, h1, w2, h2, length, (optional fr)]
        if len(seg) < 5:
            raise ValueError(
                f"rectangular_segments entry too short: {seg}. "
                "Expected [w1, h1, w2, h2, length, (optional fr)]."
            )
        w1, h1, w2, h2 = seg[0] * width_factor, seg[1], seg[2] * width_factor, seg[3]
        rest = list(seg[4:])  # length and optional fr
        adjusted.append([round(w1, 8), h1, round(w2, 8), h2] + rest)

    data["rectangular_segments"] = adjusted

    # Recompute throat_area and mouth_area from first/last segment
    if adjusted:
        first = adjusted[0]
        last = adjusted[-1]
        data["throat_area"] = round(first[0] * first[1], 8)
        data["mouth_area"] = round(last[2] * last[3], 8)

    return yaml.safe_dump(data, sort_keys=False, default_flow_style=False)


@app.post("/width-adjustment/compute", response_model=WidthAdjustmentResponse)
async def width_adjustment_compute(req: WidthAdjustmentRequest):
    """
    Width Adjustment for Rectangular Horns — Hornresp page 77.

    Scales the width of all rectangular_segments by width_factor while keeping
    the height constant. This changes the mouth area, which affects horn loading.

    Request body:
      - geometry_yaml: raw YAML string containing rectangular_segments
      - width_factor: linear multiplier for width (e.g. 0.8 = 80% of original)

    Response:
      - geometry_yaml: updated YAML with adjusted widths
      - width_factor: the factor applied
    """
    if req.width_factor <= 0:
        raise HTTPException(status_code=400, detail="width_factor must be positive")

    try:
        adjusted_yaml = _apply_width_adjustment(req.geometry_yaml, req.width_factor)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Width adjustment failed: {e}")

    return WidthAdjustmentResponse(
        geometry_yaml=adjusted_yaml,
        width_factor=req.width_factor,
    )


# ── Horn Segment Wizard ─────────────────────────────────────────────────────────

import math

_C = 343.0  # m/s speed of sound
_THROAT_CHAMBER_VOLUME_L = 0.1  # default estimated throat chamber volume (litres)


class HornSegmentRequest(BaseModel):
    """Request body for POST /horn-segment/compute.

    Exactly 3 of the 4 parameters must be provided (not None).
    Areas are in cm², length in cm, frequency in Hz.
    """
    s1_cm2: Optional[float] = None
    s2_cm2: Optional[float] = None
    l12_cm: Optional[float] = None
    f12_hz: Optional[float] = None


class HornSegmentResponse(BaseModel):
    """Response from POST /horn-segment/compute."""
    computed_param: str                          # "s1_cm2" | "s2_cm2" | "l12_cm" | "f12_hz"
    computed_value: float
    area_profile: list[tuple[float, float]]       # (position_fraction_0_to_1, area_cm2)
    system_volume_l: float


def _catenoidal_area_at(s1_m2: float, s2_m2: float, l_m: float, x_m: float) -> float:
    """Catenoidal (T=1) horn area at distance x from throat.

    A(x) = S1 * cosh²(m·x)  where  m·L = arccosh(√(S2/S1))

    This is the correct catenoidal profile formula (T=1, Hornresp Con/Exp family):
      - At x=0:  cosh(0)=1    → A(0) = S1  (throat area)
      - At x=L:  cosh(m·L)=√(S2/S1) → A(L) = S1·(S2/S1) = S2 (mouth area)
    """
    if abs(s1_m2 - s2_m2) < 1e-12:
        return s1_m2
    if x_m <= 0.0:
        return s1_m2
    if x_m >= l_m:
        return s2_m2
    area_ratio_sqrt = math.sqrt(s2_m2 / s1_m2)
    if area_ratio_sqrt <= 1.0 + 1e-12:
        return s1_m2
    u_total = math.acosh(area_ratio_sqrt)
    m = u_total / l_m
    cosh_val = math.cosh(m * x_m)
    return s1_m2 * cosh_val * cosh_val


def _catenoidal_horn_volume_l(s1_m2: float, s2_m2: float, l_m: float) -> float:
    """Catenoidal horn internal volume in litres.

    For an expanding horn (S2 > S1):
      V = S1/(2m) · [sinh(u_total)·cosh(u_total) − u_total]
      where  u_total = arccosh(√(S2/S1)) > 0,  m = u_total/L

    For a cylindrical / contracting horn (S2 ≤ S1):
      V ≈ S1 × L  (simple cylindrical approximation)
    """
    if s2_m2 <= s1_m2:
        # Contracting or cylindrical: use simple cylindrical volume
        return max(s1_m2 * l_m * 1000.0, 0.0)
    area_ratio_sqrt = math.sqrt(s2_m2 / s1_m2)
    if area_ratio_sqrt <= 1.0 + 1e-12:
        return max(s1_m2 * l_m * 1000.0, 0.0)
    u_total = math.acosh(area_ratio_sqrt)
    m = u_total / l_m
    v_m3 = (s1_m2 / (2.0 * m)) * (math.sinh(u_total) * math.cosh(u_total) - u_total)
    return max(v_m3, 0.0) * 1000.0


@app.post("/horn-segment/compute", response_model=HornSegmentResponse)
async def compute_horn_segment(req: HornSegmentRequest):
    """
    Horn Segment Wizard — geometry calculator for a single catenoidal horn segment.

    Given any 3 of (S1 throat area, S2 mouth area, L12 horn length, F12 cutoff freq),
    computes the 4th using the catenoidal horn formulas.

    Also returns the area profile (20 points) and an estimated system volume
    (horn internal volume + throat chamber).

    Units: areas in cm², length in cm, frequency in Hz.
    Speed of sound c = 343 m/s.

    Formulas (catenoidal, T=1):
      F12  = c/(2π) × √(S2/S1 − 1) / L12
      L12  = c/(2π × F12) × √(S2/S1 − 1)
      S2   = S1 / (1 + (2π×F12×L12/c)²)
      S1   = S2 / (1 + (2π×F12×L12/c)²)     ← same structure, S1↔S2 swapped
      A(x) = S1 × coth²(m·x),  m·L = arccosh(√(S2/S1))
    """
    s1 = req.s1_cm2
    s2 = req.s2_cm2
    l12 = req.l12_cm
    f12 = req.f12_hz

    provided = sum(1 for v in (s1, s2, l12, f12) if v is not None)
    if provided != 3:
        raise HTTPException(
            status_code=422,
            detail=f"Exactly 3 of (s1_cm2, s2_cm2, l12_cm, f12_hz) must be provided; got {provided}",
        )

    # ── Case dispatch ─────────────────────────────────────────────────────────
    if s1 is not None and s2 is not None and l12 is not None:
        # → compute F12
        if s1 <= 0 or s2 <= 0 or l12 <= 0:
            raise HTTPException(status_code=422, detail="s1, s2, l12 must be positive")
        if s1 >= s2:
            raise HTTPException(status_code=422, detail="s1 must be < s2 for an expanding horn")
        s1_m2 = s1 * 1e-4
        s2_m2 = s2 * 1e-4
        l_m = l12 * 0.01
        ratio = s2_m2 / s1_m2
        computed_value = _C / (2.0 * math.pi * l_m) * math.sqrt(ratio - 1.0)
        computed_param = "f12_hz"
        s1_m2_u, s2_m2_u, l_m_u = s1_m2, s2_m2, l_m

    elif s1 is not None and s2 is not None and f12 is not None:
        # → compute L12
        if s1 <= 0 or s2 <= 0 or f12 <= 0:
            raise HTTPException(status_code=422, detail="s1, s2, f12 must be positive")
        if s1 >= s2:
            raise HTTPException(status_code=422, detail="s1 must be < s2 for an expanding horn")
        s1_m2 = s1 * 1e-4
        s2_m2 = s2 * 1e-4
        ratio = s2_m2 / s1_m2
        l_m = _C / (2.0 * math.pi * f12) * math.sqrt(ratio - 1.0)
        computed_value = round(l_m * 100.0, 4)
        computed_param = "l12_cm"
        s1_m2_u, s2_m2_u, l_m_u = s1_m2, s2_m2, l_m

    elif s1 is not None and l12 is not None and f12 is not None:
        # → compute S2
        if s1 <= 0 or l12 <= 0 or f12 <= 0:
            raise HTTPException(status_code=422, detail="s1, l12, f12 must be positive")
        s1_m2 = s1 * 1e-4
        l_m = l12 * 0.01
        term = (2.0 * math.pi * f12 * l_m / _C) ** 2
        s2_m2 = s1_m2 / (1.0 + term)
        computed_value = round(s2_m2 * 1e4, 4)
        computed_param = "s2_cm2"
        s1_m2_u, s2_m2_u, l_m_u = s1_m2, s2_m2, l_m

    elif s2 is not None and l12 is not None and f12 is not None:
        # → compute S1
        if s2 <= 0 or l12 <= 0 or f12 <= 0:
            raise HTTPException(status_code=422, detail="s2, l12, f12 must be positive")
        s2_m2 = s2 * 1e-4
        l_m = l12 * 0.01
        term = (2.0 * math.pi * f12 * l_m / _C) ** 2
        s1_m2 = s2_m2 / (1.0 + term)
        computed_value = round(s1_m2 * 1e4, 4)
        computed_param = "s1_cm2"
        s1_m2_u, s2_m2_u, l_m_u = s1_m2, s2_m2, l_m

    else:
        raise HTTPException(status_code=422, detail="Invalid parameter combination")

    # ── Area profile (20 points including throat and mouth) ───────────────────
    N = 20
    area_profile: list[tuple[float, float]] = []
    for i in range(N + 1):
        frac = i / N
        x_m = frac * l_m_u
        area_m2 = _catenoidal_area_at(s1_m2_u, s2_m2_u, l_m_u, x_m)
        area_profile.append((round(frac, 4), round(area_m2 * 1e4, 4)))

    # ── System volume estimate ─────────────────────────────────────────────────
    horn_vol_l = _catenoidal_horn_volume_l(s1_m2_u, s2_m2_u, l_m_u)
    system_volume_l = round(horn_vol_l + _THROAT_CHAMBER_VOLUME_L, 4)

    return HornSegmentResponse(
        computed_param=computed_param,
        computed_value=computed_value,
        area_profile=area_profile,
        system_volume_l=system_volume_l,
    )


def _reg() -> Registry:
    return Registry()

# ── list ──────────────────────────────────────────────────────────────────────────
@app.get("/registry/")
async def registry_list(kind: Optional[str] = None):
    """List all entries, optionally filtered by kind='driver' or 'project'."""
    reg = _reg()
    entries = reg.list(kind=kind if kind in ("driver","project") else None)
    return [e.to_dict() for e in entries]

# ── get ──────────────────────────────────────────────────────────────────────────
@app.get("/registry/{name}")
async def registry_get(name: str):
    """Get metadata for a single entry."""
    reg = _reg()
    e = reg.get(name)
    if e is None:
        raise HTTPException(status_code=404, detail=f"No entry '{name}'")
    out = e.to_dict()
    out["file_path"] = str(reg.resolve_path(name)) if reg.resolve_path(name) else None
    return out

# ── add ──────────────────────────────────────────────────────────────────────
class RegistryAddRequest(BaseModel):
    name: str
    kind: str  # 'driver' | 'project'
    yaml_content: str  # raw YAML string — server will write to temp file and copy
    description: str = ""
    tags: list[str] = []

@app.post("/registry/add")
async def registry_add(req: RegistryAddRequest):
    """Add a driver or project to the registry. Writes YAML to registry drivers/projects dir."""
    import tempfile
    reg = _reg()
    if reg.exists(req.name):
        raise HTTPException(status_code=409, detail=f"Entry '{req.name}' already exists")
    if req.kind not in ("driver","project"):
        raise HTTPException(status_code=422, detail="kind must be 'driver' or 'project'")
    # Write yaml to temp file then copy into registry
    suffix = ".yaml"
    with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False) as tf:
        tf.write(req.yaml_content)
        src = Path(tf.name)
    try:
        entry = reg.add(req.name, req.kind, src, description=req.description, tags=req.tags, copy=True)
    finally:
        src.unlink(missing_ok=True)
    return entry.to_dict()

# ── remove ────────────────────────────────────────────────────────────────────
@app.delete("/registry/{name}")
async def registry_remove(name: str, delete_file: bool = False):
    """Remove an entry. If delete_file=True, also delete the YAML file."""
    reg = _reg()
    try:
        reg.remove(name, delete_file=delete_file)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No entry '{name}'")
    return {"ok": True, "deleted_file": delete_file}

# ── metadata patch ────────────────────────────────────────────────────────────
class RegistryPatchRequest(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None

@app.patch("/registry/{name}")
async def registry_patch(name: str, req: RegistryPatchRequest):
    """Update description and/or tags."""
    reg = _reg()
    try:
        updated = reg.update_metadata(name, description=req.description, tags=req.tags)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No entry '{name}'")
    return updated.to_dict()

# ── file read ────────────────────────────────────────────────────────────────
@app.get("/registry/{name}/file")
async def registry_file_read(name: str):
    """Return the YAML content of a registered entry.
    For project entries, auto-resolves geometry_path and returns the geometry YAML."""
    import yaml
    reg = _reg()
    path = reg.resolve_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"No entry '{name}' not found")
    try:
        raw = path.read_text()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"No file found for '{name}'")

    # Auto-resolve project YAML → return geometry YAML instead
    try:
        data = yaml.safe_load(raw)
        if isinstance(data, dict) and data.get("geometry_path"):
            geo_raw = str(data["geometry_path"]).strip().strip("'\"").strip()
            geo_path = (path.parent / geo_raw).resolve()
            PYHORN_ROOT = Path(os.environ.get("PYHORN_ROOT", os.path.expanduser("~/pyhorn"))).resolve()
            try:
                geo_path.relative_to(PYHORN_ROOT)
            except ValueError:
                pass
            else:
                if geo_path.exists():
                    return {
                        "yaml": geo_path.read_text(),
                        "is_project_yaml": True,
                        "geometry_path": str(geo_path),
                    }
    except Exception:
        pass

    return {"yaml": raw}

# ── file write ───────────────────────────────────────────────────────────────
class RegistryFileWriteRequest(BaseModel):
    yaml_content: str

@app.put("/registry/{name}/file")
async def registry_file_write(name: str, req: RegistryFileWriteRequest):
    """Write updated YAML content to a registered entry's file."""
    import yaml
    reg = _reg()
    if not reg.exists(name):
        raise HTTPException(status_code=404, detail=f"No entry '{name}'")
    data = yaml.safe_load(req.yaml_content)
    if data is None:
        raise HTTPException(status_code=422, detail="Invalid YAML content")
    reg.save_yaml(name, data)
    return {"ok": True}

# ── resolve ──────────────────────────────────────────────────────────────────
# ── file read (generic) ─────────────────────────────────────────────────────
@app.get("/fs/wavefront")
async def wavefront_list(path: str):
    """List available wavefront PNG and GIF files in an output directory.

    Returns a dict with:
      - frequencies: sorted list of Hz values that have wavefront snapshots
      - snapshots: dict mapping Hz → PNG file path
      - animations: dict mapping Hz → GIF file path
    """
    import glob as _glob
    p = Path(path).expanduser().resolve()
    PYHORN_ROOT = Path(os.environ.get("PYHORN_ROOT", os.path.expanduser("~/pyhorn"))).resolve()
    try:
        p.relative_to(GDB_ROOT)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside allowed directory")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    snapshots: dict[str, str] = {}
    animations: dict[str, str] = {}

    # Recursively scan all subdirectories so the UI finds files regardless of
    # whether the CLI saved them flat in output_dir/ or in output_dir/<horn_name>/.
    for png in sorted(p.rglob("*.png")):
        stem = png.stem  # e.g. wavefront_500Hz  or  wavefront_animation_500Hz
        # Only handle snapshot files (wavefront_<freq>Hz.png), not animation frames.
        if not stem.startswith("wavefront_"):
            continue
        if stem.startswith("wavefront_animation_"):
            continue
        try:
            freq = stem.replace("wavefront_", "").replace("Hz", "")
            freq_key = freq
            snapshots[freq_key] = str(png)
        except ValueError:
            pass

    for gif in sorted(p.rglob("*.gif")):
        stem = gif.stem  # e.g. wavefront_animation_500Hz
        if not stem.startswith("wavefront_animation_"):
            continue
        try:
            freq = stem.replace("wavefront_animation_", "").replace("Hz", "")
            freq_key = freq
            animations[freq_key] = str(gif)
        except ValueError:
            pass

    frequencies = sorted(snapshots.keys(), key=lambda f: float(f))
    return {"frequencies": frequencies, "snapshots": snapshots, "animations": animations}


# ── YAML validation helpers ───────────────────────────────────────────────────

class FsValidateRequest(BaseModel):
    """Request body for POST /fs/validate."""
    yaml_content: str = Field(..., description="Raw YAML content to validate.")


def _validate_geometry_yaml(data: dict) -> list[str]:
    """Check required fields in a geometry YAML dict.

    Valid when EITHER:
      - ``throat_area``, ``mouth_area``, ``path_length`` are all present, OR
      - ``sections`` is present (chained-section format, overrides scalars).
    Returns a list of missing field names. Empty list means valid.
    """
    missing: list[str] = []
    if data.get("sections") is not None:
        return missing
    if data.get("throat_area") is None:
        missing.append("throat_area")
    if data.get("mouth_area") is None:
        missing.append("mouth_area")
    if data.get("path_length") is None:
        missing.append("path_length")
    return missing


def _validate_driver_yaml(data: dict) -> list[str]:
    """Check required fields in a driver YAML dict.

    Required: ``sd``, ``qts``, ``fs``, ``re``.
    Returns a list of missing field names. Empty list means valid.
    """
    missing: list[str] = []
    if data.get("sd") is None:
        missing.append("sd")
    if data.get("qts") is None:
        missing.append("qts")
    if data.get("fs") is None:
        missing.append("fs")
    if data.get("re") is None:
        missing.append("re")
    return missing


@app.get("/fs/read")
async def read_file(path: str):
    """Return raw file contents. Used by the Tauri UI to read YAML files.
    Also auto-resolves project YAMLs: if the file has a geometry_path key,
    the referenced geometry YAML is fetched and returned instead."""
    import yaml
    p = Path(path).expanduser().resolve()
    PYHORN_ROOT = Path(os.environ.get("PYHORN_ROOT", os.path.expanduser("~/pyhorn"))).resolve()
    try:
        p.relative_to(GDB_ROOT)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside allowed directory")
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    raw = p.read_text()

    # Auto-resolve project YAML → return the geometry YAML instead
    try:
        data = yaml.safe_load(raw)
        if isinstance(data, dict) and data.get("geometry_path"):
            geo_raw = str(data["geometry_path"]).strip().strip("'\"").strip()
            geo_path = (p.parent / geo_raw).resolve()
            try:
                geo_path.relative_to(PYHORN_ROOT)
            except ValueError:
                pass  # outside root — skip resolution
            else:
                if geo_path.exists():
                    geo_raw_content = geo_path.read_text()
                else:
                    raise HTTPException(
                        status_code=404,
                        detail=(
                            f"Geometry file not found: '{geo_raw}' "
                            f"(resolved from {p.name}, checked: {geo_path})"
                        ),
                    )
                # ── geometry file read succeeded — now validate and inject scalars
                # If the geometry YAML uses rectangular_segments format (discretised),
                # the top-level scalar fields throat_area / mouth_area / path_length
                # are missing. Compute them from the segments so HornMetrics.tsx
                # (which parses scalars via regex) gets the values it needs.
                geo_data = yaml.safe_load(geo_raw_content)
                if isinstance(geo_data, dict):
                    segs = geo_data.get("rectangular_segments")
                    has_throat = geo_data.get("throat_area") is not None
                    has_mouth  = geo_data.get("mouth_area")  is not None
                    has_path   = geo_data.get("path_length") is not None
                    if segs and (not has_throat or not has_mouth or not has_path):
                        try:
                            # rectangular_segments format:
                            #   [width, h1, width, h2, length_m, ...]
                            # width is constant (index 0/2), heights vary.
                            first = segs[0]
                            last  = segs[-1]
                            width = float(first[0])
                            h1    = float(first[1])
                            h2    = float(last[3])
                            seg_lengths = [float(seg[4]) for seg in segs if len(seg) >= 5]
                            throat_area  = round(width * h1,   8)
                            mouth_area   = round(width * h2,   8)
                            path_length  = round(sum(seg_lengths), 6)
                            # Inject scalars into the parsed data and re-serialise
                            if not has_throat:
                                geo_data["throat_area"]  = throat_area
                            if not has_mouth:
                                geo_data["mouth_area"]   = mouth_area
                            if not has_path:
                                geo_data["path_length"]  = path_length
                            geo_raw_content = yaml.safe_dump(
                                geo_data, sort_keys=False, default_flow_style=False
                            )
                        except Exception:
                            pass  # leave content unchanged on any error
                # ── Validate required geometry fields ───────────────────────
                missing = _validate_geometry_yaml(geo_data)
                if missing:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Missing required field '{missing[0]}' in geometry YAML",
                    )
                return {
                    "path": str(p),
                    "geometry_path": str(geo_path),
                    "content": geo_raw_content,
                    "is_project_yaml": True,
                }
    except HTTPException:
        raise
    except Exception:
        pass

    # ── Validate raw geometry YAML (returned directly, not via project resolution)
    # Apply the same scalar-injection logic before validation so that
    # rectangular_segments / coordinates geometries with missing scalars
    # (e.g. hiro.yaml) still pass.
    try:
        data = yaml.safe_load(raw) or {}
        if isinstance(data, dict):
            is_geometry = (
                "throat_area" in data
                or "mouth_area" in data
                or "path_length" in data
                or "sections" in data
                or "rectangular_segments" in data
                or "coordinates" in data
                or "enclosure_type" in data
            )
            if is_geometry:
                # Inject scalars from rectangular_segments if needed
                segs = data.get("rectangular_segments")
                has_throat = data.get("throat_area") is not None
                has_mouth  = data.get("mouth_area")  is not None
                has_path   = data.get("path_length") is not None
                if segs and (not has_throat or not has_mouth or not has_path):
                    try:
                        first = segs[0]
                        last  = segs[-1]
                        width = float(first[0])
                        h1    = float(first[1])
                        h2    = float(last[3])
                        seg_lengths = [float(seg[4]) for seg in segs if len(seg) >= 5]
                        if not has_throat:
                            data["throat_area"] = round(width * h1, 8)
                        if not has_mouth:
                            data["mouth_area"]  = round(width * h2, 8)
                        if not has_path:
                            data["path_length"] = round(sum(seg_lengths), 6)
                    except Exception:
                        pass  # leave data unchanged; validation will catch missing fields
                missing = _validate_geometry_yaml(data)
                if missing:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Missing required field '{missing[0]}' in geometry YAML",
                    )
    except HTTPException:
        raise
    except Exception:
        pass

    return {"path": str(p), "content": raw, "is_project_yaml": False}


@app.post("/fs/validate")
async def fs_validate(body: FsValidateRequest):
    """Validate a YAML blob and return missing required fields.

    Accepts a YAML string, detects whether it is a geometry or driver YAML
    (based on field presence), and returns validation status and a list of
    missing required fields.

    Geometry: requires ``throat_area``, ``mouth_area``, ``path_length`` OR ``sections``.
    Driver: requires ``sd``, ``qts``, ``fs``, ``re``.
    """
    import yaml

    try:
        data = yaml.safe_load(body.yaml_content) or {}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {exc}")

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=422,
            detail="YAML content must be a dictionary (key-value mapping).",
        )

    # Detect kind
    is_geometry = (
        "throat_area" in data
        or "mouth_area" in data
        or "path_length" in data
        or "sections" in data
        or "rectangular_segments" in data
        or "coordinates" in data
    )
    is_driver = "fs" in data  # lenient: any YAML with fs gets driver validation

    if is_geometry and is_driver:
        kind: str = "unknown"
    elif is_geometry:
        kind = "geometry"
    elif is_driver:
        kind = "driver"
    else:
        kind = "unknown"

    if kind == "geometry":
        missing = _validate_geometry_yaml(data)
        return {
            "kind": "geometry",
            "valid": len(missing) == 0,
            "missing_fields": missing,
        }
    elif kind == "driver":
        missing = _validate_driver_yaml(data)
        return {
            "kind": "driver",
            "valid": len(missing) == 0,
            "missing_fields": missing,
        }
    else:
        return {"kind": "unknown", "valid": False, "missing_fields": []}


@app.get("/registry/{name}/resolve")
async def registry_resolve(name: str):
    """Return the absolute file path for a registered entry."""
    reg = _reg()
    path = reg.resolve_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"No entry '{name}'")
    return {"path": str(path)}


# ── Filter Wizard ─────────────────────────────────────────────────────────────────

from typing import Literal

FilterType = Literal["lowpass", "highpass", "bandpass", "peaking_eq", "highshelf", "lowshelf", "le_cleach"]


class FilterBand(BaseModel):
    """A single filter band in a filter network."""
    type: FilterType
    frequency: float = Field(..., gt=0)  # Hz — centre / cutoff frequency, must be positive
    q: float = Field(1.0, gt=0)          # quality factor, must be positive (rejects zero/negative)
    gain_db: float = Field(0.0)          # dB — boost/cut for peakingEQ and shelves
    order: int = Field(2, ge=1, le=4)   # filter order (1=6dB/oct to 4=24dB/oct)
    enabled: bool = True


class FilterApplyRequest(BaseModel):
    """Request body for POST /filter/apply."""
    frequencies:        list[float] = Field(..., min_length=1)
    baseline_spl:       list[float] = Field(..., min_length=1)
    baseline_impedance: list[float] = Field(..., min_length=1)
    baseline_phase:     list[float] = Field(..., min_length=1)
    filter_bands:       list[FilterBand]


class FilterApplyResponse(BaseModel):
    """Response from POST /filter/apply."""
    filtered_spl:         list[float]
    filtered_impedance:   list[float]
    filtered_phase:       list[float]
    filter_magnitude_db:  list[float]   # combined filter response in dB


# ── Le Cléac'h Passive Filter ───────────────────────────────────────────────────

def compute_le_cleach_filter(
    freqs: np.ndarray, f_c: float, q: float = 0.7, r_load: float = 8.0
) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute Le Cléac'h passive L/C series high-pass filter transfer function.

    The Le Cléac'h filter is a series L+C network placed between the amplifier
    and driver for impedance equalization below the horn cutoff.

    Transfer function (series RLC high-pass, output across L):
        H(jω) = jωL / (R_load + jωL + 1/(jωC))
              = -ω²LC / (1 - ω²LC + jωR_load·C)

    Component values derived from f_c and Q:
        L = R_load / (2π * f_c * Q)
        C = Q / (2π * f_c * R_load)

    At f >> f_c: signal passes through (~0 dB)
    At f << f_c: blocked (filter attenuates, impedance rises)

    Parameters
    ----------
    freqs  : np.ndarray — frequency points (Hz)
    f_c    : float — cutoff frequency (Hz)
    q      : float — quality factor (default 0.7)
    r_load : float — load resistance in ohms (default 8.0)

    Returns
    -------
    (magnitude_db, phase_deg) at each frequency
    """
    import math

    # Derive L and C from cutoff and Q
    L = r_load / (2.0 * math.pi * f_c * q)
    C = q / (2.0 * math.pi * f_c * r_load)

    omega = 2.0 * math.pi * freqs  # rad/s
    omega_sq_LC = (omega ** 2) * L * C

    # Series RLC high-pass: H = -ω²LC / (1 - ω²LC + jωR_load·C)
    denom = 1.0 - omega_sq_LC + 1j * omega * r_load * C
    H = np.where(freqs > 0, -omega_sq_LC / denom, 0.0 + 0.0j)

    mag = np.abs(H)
    phase = np.angle(H, deg=True)

    mag_db = 20.0 * np.log10(np.clip(mag, 1e-12, None))
    return mag_db, phase


# ── Default / preset filter band configurations ────────────────────────────────

_DEFAULT_BANDS: dict[str, list[FilterBand]] = {
    "2-way crossover (LR2 12dB/oct)": [
        FilterBand(type="lowpass",  frequency=3000, q=0.707, order=2, enabled=True),
        FilterBand(type="highpass", frequency=3000, q=0.707, order=2, enabled=True),
    ],
    "3-way crossover (LR2 12dB/oct)": [
        FilterBand(type="lowpass",  frequency=400,  q=0.707, order=2, enabled=True),
        FilterBand(type="bandpass", frequency=2500, q=0.707, order=2, enabled=True),
        FilterBand(type="highpass", frequency=4000, q=0.707, order=2, enabled=True),
    ],
    "peaking EQ (+3dB at 2.5kHz)": [
        FilterBand(type="peaking_eq", frequency=2500, q=1.4, gain_db=3.0, order=2, enabled=True),
    ],
    "high-shelf cut (-3dB above 4kHz)": [
        FilterBand(type="highshelf", frequency=4000, q=0.707, gain_db=-3.0, order=2, enabled=True),
    ],
    "low-shelf boost (+3dB below 200Hz)": [
        FilterBand(type="lowshelf", frequency=200, q=0.707, gain_db=3.0, order=2, enabled=True),
    ],
    "notch filter (-12dB at 1kHz)": [
        FilterBand(type="peaking_eq", frequency=1000, q=2.0, gain_db=-12.0, order=2, enabled=True),
    ],
    "Le Cléac'h HP": [
        FilterBand(type="le_cleach", frequency=80, q=0.7, order=2, enabled=True),
    ],
}


def _compute_biquad_coeffs(
    filter_type: FilterType, freq: float, q: float, gain_db: float, order: int, fs: float
) -> tuple[list[float], list[float]]:
    """
    Compute biquad (second-order) coefficients for a single filter band.

    Uses scipy.signal.iirfilter for standard types; manual formulas for shelving
    and peakingEQ (Audio EQ cookbook approach, RBJ).

    Returns (b, a) coefficients for H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2).
    For order > 2, multiple second-order sections are cascaded; this function returns
    one section's coefficients and the caller cascades multiple calls.
    """
    from scipy.signal import iirfilter, sosfilt, sosfreqz
    import math

    # Clamp frequency to Nyquist
    freq = max(min(freq, fs / 2 * 0.9999), 1e-6)
    # Normalised frequency for scipy
    Wn = freq / (fs / 2)

    # ── Standard types via scipy ────────────────────────────────────────────
    if filter_type == "lowpass":
        # scipy iirfilter: butt/cheby1/... all give equivalent results here
        # Use Butterworth for maximally-flat passband
        sos = iirfilter(N=min(order, 12), Wn=Wn, btype="low", ftype="butter", output="sos")
        # sos shape: (n_sections, 6); each row = [b0,b1,b2,a0,a1,a2]
        # Always use the last second-order section
        sec = sos[-1]
        return sec[:3].tolist(), sec[3:].tolist()

    elif filter_type == "highpass":
        sos = iirfilter(N=min(order, 12), Wn=Wn, btype="high", ftype="butter", output="sos")
        sec = sos[-1]
        return sec[:3].tolist(), sec[3:].tolist()

    elif filter_type == "bandpass":
        # bandpass: Wn is [W1, W2]; use geometric mean for centre freq
        bw = freq / q / (fs / 2)   # bandwidth in normalised freq
        W1 = max(Wn - bw / 2, 1e-6)
        W2 = min(Wn + bw / 2, 0.9999)
        sos = iirfilter(N=min(order, 12), Wn=[W1, W2], btype="band", ftype="butter", output="sos")
        sec = sos[-1]
        return sec[:3].tolist(), sec[3:].tolist()

    # ── Shelving and peakingEQ: RBJ Audio EQ Cookbook formulas ─────────────
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * freq / fs
    alpha = math.sin(w0) / (2 * q)
    cos_w0 = math.cos(w0)

    if filter_type == "highshelf":
        # High-shelf: boost/cut above freq
        sq = math.sqrt(2) if order == 1 else 2 ** (1 / 2) if order == 2 else 2 ** (order / 2)
        # Use peakingEQ with very wide Q as approximation for shelving
        # RBJ high-shelf:
        if gain_db >= 0:
            b = [
                (1 + math.sqrt(A) * alpha + A * (1 - cos_w0) / 2),
                (-2 * (1 + cos_w0) * A),
                (1 - math.sqrt(A) * alpha + A * (1 - cos_w0) / 2),
            ]
        else:
            A2 = 1 / A
            b = [
                (A2 + math.sqrt(A2) * alpha + (1 - cos_w0) / 2),
                (-2 * (1 - cos_w0)),
                (A2 - math.sqrt(A2) * alpha + (1 - cos_w0) / 2),
            ]
        a = [
            1 + alpha / math.sqrt(A) if gain_db >= 0 else 1 + alpha * math.sqrt(A2),
            -2 * cos_w0,
            1 - alpha / math.sqrt(A) if gain_db >= 0 else 1 - alpha * math.sqrt(A2),
        ]
        # Normalise so gain at centre = gain_db
        # Scale b so that H(w0) magnitude = A
        # Approximate: scale = A / |H(w0)| computed naively
        # Just use standard peaking EQ with very low Q as shelf approximation
        # Re-do using peakingEQ formula with low Q
        # Fall back to peakingEQ with Q=0.707
        return _compute_biquad_coeffs("peakingEQ", freq, 0.707, gain_db, order, fs)

    elif filter_type == "lowshelf":
        return _compute_biquad_coeffs("peakingEQ", freq, 0.707, gain_db, order, fs)

    elif filter_type == "peaking_eq":
        # RBJ peaking EQ — single unified formula works for both boost and cut.
        # A = 10^(gd/40); for gd < 0, A < 1 gives |H| = A at w0 (cut).
        # For gd > 0, A > 1 gives |H| = A at w0 (boost).
        if gain_db == 0:
            return [1.0, 0.0, 0.0], [1.0, 0.0, 0.0]
        alpha = math.sin(w0) / (2 * q)
        cos_w0 = math.cos(w0)
        b = [1 + alpha * A, -2 * cos_w0, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cos_w0, 1 - alpha / A]
        return b, a

    # Fallback
    return [1.0, 0.0, 0.0], [1.0, 0.0, 0.0]


def _biquad_freq_response(b: list[float], a: list[float], w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute frequency response H(jω) = B(jω)/A(jω) at angular frequencies w (radians/sec).
    Returns (magnitude, phase_deg).
    """
    # H(z) evaluated on unit circle: z = exp(j*w/fs) for digital freq w (rad/sec), fs in Hz
    # For digital freq response: z = exp(j*omega) where omega = w/fs_normalised
    # Standard digital filter freq response at frequency f:
    #   z = exp(2j * pi * f / fs)
    #   H(z) = sum(b_k * z^-k) / sum(a_k * z^-k)
    # We'll compute this directly
    fs_digital = 2 * np.pi  # normalise so w_normalised = w_rad / (fs/2) -> use w in [0, pi]
    z = np.exp(1j * w)
    z_inv = 1.0 / z

    B = b[0] + b[1] * z_inv + b[2] * z_inv**2
    A = a[0] + a[1] * z_inv + a[2] * z_inv**2

    with np.errstate(divide="ignore", invalid="ignore"):
        H = B / A

    mag = np.abs(H)
    phase = np.angle(H, deg=True)
    return mag, phase


def _apply_filter_bands(
    freqs_hz: np.ndarray,
    baseline_spl_db: np.ndarray,
    baseline_impedance: np.ndarray,
    baseline_phase_deg: np.ndarray,
    bands: list[FilterBand],
    fs: float = 44100.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Cascade all enabled filter bands and apply to baseline data.

    Each band is applied as a post-processing addition in dB:
        filtered_spl = baseline_spl + filter_magnitude_db

    Phase is accumulated from each band:
        filtered_phase = baseline_phase + filter_phase

    Impedance magnitude is scaled by filter magnitude:
        filtered_z = baseline_z * filter_magnitude

    Parameters
    ----------
    freqs_hz : np.ndarray — frequency points (Hz)
    baseline_spl_db, baseline_impedance, baseline_phase_deg : baseline data
    bands : list of FilterBand (only enabled bands are applied)
    fs : sampling frequency for digital filter design (Hz)

    Returns
    -------
    (filtered_spl_db, filtered_impedance, filtered_phase_deg, filter_magnitude_db)
    """
    from scipy.signal import lfilter

    enabled = [b for b in bands if b.enabled]
    if not enabled:
        return (
            baseline_spl_db.tolist(),
            baseline_impedance.tolist(),
            baseline_phase_deg.tolist(),
            np.zeros_like(freqs_hz).tolist(),
        )

    # Digital normalised angular frequencies: omega = 2*pi*f/fs
    w_digital = 2 * np.pi * freqs_hz / fs   # rad/sample

    # Accumulate combined magnitude (dB) and phase (deg) across bands
    combined_mag_linear = np.ones_like(freqs_hz, dtype=float)
    combined_phase_deg = np.zeros_like(freqs_hz, dtype=float)

    for band in enabled:
        if band.type == "le_cleach":
            mag_db_le, phase_deg_le = compute_le_cleach_filter(
                freqs_hz, band.frequency, band.q, r_load=8.0
            )
            mag_lin = 10 ** (mag_db_le / 20.0)
            combined_mag_linear *= mag_lin
            combined_phase_deg += phase_deg_le
        else:
            b, a = _compute_biquad_coeffs(band.type, band.frequency, band.q, band.gain_db, band.order, fs)
            mag_lin, phase_deg = _biquad_freq_response(b, a, w_digital)
            # Clamp magnitude to avoid numerical issues
            mag_lin = np.clip(mag_lin, 1e-12, None)
            combined_mag_linear *= mag_lin
            combined_phase_deg += phase_deg

    # Convert combined magnitude to dB
    filter_mag_db = 20 * np.log10(combined_mag_linear)

    # Apply filter: add in dB domain (post-processing)
    filtered_spl_db = baseline_spl_db + filter_mag_db

    # Phase
    filtered_phase_deg = baseline_phase_deg + combined_phase_deg

    # Impedance magnitude scaled by filter magnitude
    filtered_impedance = baseline_impedance * combined_mag_linear

    return (
        filtered_spl_db.tolist(),
        filtered_impedance.tolist(),
        filtered_phase_deg.tolist(),
        filter_mag_db.tolist(),
    )


class FilterFromYamlRequest(BaseModel):
    """Request body for POST /filter/from-yaml."""
    yaml_path:          str                       # path to YAML filter config file
    frequencies:        list[float]
    baseline_spl:       list[float]
    baseline_impedance: list[float]   # ohms (magnitude)
    baseline_phase:    list[float]    # degrees


class FilterFromYamlResponse(BaseModel):
    """Response from POST /filter/from-yaml."""
    filtered_spl:          list[float]
    filtered_impedance:   list[float]
    filtered_phase:       list[float]
    filter_magnitude_db:  list[float]
    bands_applied:        int   # number of enabled bands


@app.post("/filter/apply", response_model=FilterApplyResponse)
async def filter_apply(req: FilterApplyRequest):
    """
    Apply a cascade of filter bands to a baseline horn response.

    Each band computes a filter transfer function H(jω) and its magnitude
    (in dB) is added to the baseline SPL — standard post-processing approach
    used by Hornresp's Filter Wizard.

    Supported filter types:
      - lowpass, highpass, bandpass (standard IIR)
      - peakingEQ (parametric EQ with frequency, Q, gain)
      - highshelf, lowshelf ( shelving EQ with frequency, gain)

    The filter is applied per-band in cascade; band phases are accumulated
    and added to the baseline phase.
    """
    freqs    = np.array(req.frequencies, dtype=float)
    spl      = np.array(req.baseline_spl, dtype=float)
    imp      = np.array(req.baseline_impedance, dtype=float)
    phase    = np.array(req.baseline_phase, dtype=float)

    if not (len(freqs) == len(spl) == len(imp) == len(phase)):
        raise HTTPException(status_code=422, detail="frequencies, baseline_spl, baseline_impedance, baseline_phase must have the same length")

    if len(freqs) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 frequency points")

    # Infer a reasonable sampling frequency from frequency spacing.
    # Use 10x the highest frequency (or 44100 Hz minimum).
    fmax = freqs[-1] if len(freqs) > 0 else 20000.0
    fs = max(fmax * 10.0, 44100.0)

    filt_spl, filt_imp, filt_phase, filt_mag_db = _apply_filter_bands(
        freqs, spl, imp, phase, req.filter_bands, fs=fs
    )

    return FilterApplyResponse(
        filtered_spl=filt_spl,
        filtered_impedance=filt_imp,
        filtered_phase=filt_phase,
        filter_magnitude_db=filt_mag_db,
    )


@app.post("/filter/from-yaml", response_model=FilterFromYamlResponse)
async def filter_from_yaml(req: FilterFromYamlRequest):
    """
    Apply filter bands from a YAML config file to a baseline horn response.

    This endpoint reads a YAML file at ``yaml_path`` and parses the
    ``filter_bands`` list from it, then applies the bands via
    :func:`_apply_filter_bands`.

    Expected YAML format::

        filter_bands:
          - type: "lowpass"
            frequency: 4000
            q: 0.7
            order: 2
            enabled: true
          - type: "peaking_eq"
            frequency: 2500
            q: 1.4
            gain_db: 3.0
            order: 2
            enabled: true

    Parameters
    ----------
    yaml_path : str — path to the YAML filter config file
    frequencies, baseline_spl, baseline_impedance, baseline_phase :
        baseline horn response data (same as ``POST /filter/apply``)

    Returns
    -------
    FilterFromYamlResponse with filtered data and count of applied bands
    """
    import yaml as _yaml
    from pathlib import Path

    # Security: resolve path, reject path-traversal patterns, and require readable file
    try:
        yaml_path = Path(req.yaml_path).expanduser().resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid yaml_path")

    # Block obvious path traversal
    if ".." in req.yaml_path:
        raise HTTPException(status_code=400, detail="yaml_path must not contain '..'")

    if not yaml_path.exists():
        raise HTTPException(status_code=404, detail=f"Filter YAML not found: {yaml_path}")

    if not yaml_path.is_file():
        raise HTTPException(status_code=400, detail="yaml_path must be a file")

    try:
        with open(yaml_path) as fh:
            filter_data = _yaml.safe_load(fh)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse YAML: {exc}")

    band_list = filter_data.get("filter_bands", []) if isinstance(filter_data, dict) else []
    if not band_list:
        raise HTTPException(status_code=422, detail="YAML must contain a non-empty 'filter_bands' list")

    try:
        bands: list[FilterBand] = [
            FilterBand(
                type=b.get("type", "peaking_eq"),
                frequency=float(b.get("frequency", 1000)),
                q=float(b.get("q", 1.0)),
                gain_db=float(b.get("gain_db", 0.0)),
                order=int(b.get("order", 2)),
                enabled=b.get("enabled", True),
            )
            for b in band_list
        ]
    except ValidationError as exc:
        # Pydantic ValidationError from FilterBand construction → user-friendly 422
        errors = exc.errors()
        bad_field = ".".join(str(loc) for loc in errors[0]["loc"]) if errors else "band parameter"
        msg = errors[0]["msg"] if errors else str(exc)
        raise HTTPException(status_code=422, detail=f"Invalid band {bad_field}: {msg}")

    freqs = np.array(req.frequencies, dtype=float)
    spl   = np.array(req.baseline_spl, dtype=float)
    imp   = np.array(req.baseline_impedance, dtype=float)
    phase = np.array(req.baseline_phase, dtype=float)

    if not (len(freqs) == len(spl) == len(imp) == len(phase)):
        raise HTTPException(status_code=422, detail="frequencies, baseline_spl, baseline_impedance, baseline_phase must have the same length")

    if len(freqs) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 frequency points")

    fmax = freqs[-1] if len(freqs) > 0 else 20000.0
    fs = max(fmax * 10.0, 44100.0)

    filt_spl, filt_imp, filt_phase, filt_mag_db = _apply_filter_bands(
        freqs, spl, imp, phase, bands, fs=fs
    )

    enabled_count = sum(1 for b in bands if b.enabled)

    return FilterFromYamlResponse(
        filtered_spl=filt_spl,
        filtered_impedance=filt_imp,
        filtered_phase=filt_phase,
        filter_magnitude_db=filt_mag_db,
        bands_applied=enabled_count,
    )


@app.get("/filter/bands")
async def filter_bands():
    """
    Return the list of available preset filter band configurations.
    Each preset includes:
      - filter_type: primary filter topology string
      - schematic: ASCII art schematic diagram
      - bands: list of FilterBand definitions ready for /filter/apply
    """
    from pyhorn_core.solver.filter_schematic import compute_filter_schematic, FilterBand

    # Map preset names → (filter_type, schematic preset name)
    _PRESET_META: dict[str, tuple[str, str]] = {
        "2-way crossover (LR2 12dB/oct)":  ("lr2_crossover_2way", "2way_xover"),
        "3-way crossover (LR2 12dB/oct)": ("lr2_crossover_3way", "3way_xover"),
        "peaking EQ (+3dB at 2.5kHz)":    ("peaking_eq",          "peaking_eq"),
        "high-shelf cut (-3dB above 4kHz)":("highshelf",          "highshelf"),
        "low-shelf boost (+3dB below 200Hz)": ("lowshelf",        "lowshelf"),
        "notch filter (-12dB at 1kHz)":    ("peaking_eq",          "peaking_eq"),
        "Le Cléac'h HP":                   ("le_cleach",           "le_cleach"),
    }

    result: dict[str, dict] = {}
    for preset_name, bands in _DEFAULT_BANDS.items():
        filter_type, schematic_preset = _PRESET_META.get(
            preset_name, ("peaking_eq", "peaking_eq")
        )
        # Generate schematic for this preset's bands
        pyhorn_bands = [
            FilterBand(
                type=b.type,
                frequency=b.frequency,
                q=b.q,
                gain_db=b.gain_db,
                order=b.order,
                enabled=b.enabled,
            )
            for b in bands
        ]
        schematic = compute_filter_schematic(pyhorn_bands)
        result[preset_name] = {
            "filter_type": filter_type,
            "schematic": schematic,
            "bands": [band.model_dump() for band in bands],
        }
    return result


@app.get("/filter/schematic")
async def filter_schematic(
    preset: Optional[str] = None,
    filter_yaml: Optional[str] = None,
    type: Optional[str] = None,
    fc: Optional[float] = None,
    q: Optional[float] = None,
    gain_db: Optional[float] = None,
    r_load: float = 8.0,
):
    """
    Return the ASCII art filter schematic.

    Accepts one of:
      1. ?preset=<name>        — named preset from /filter/bands
      2. ?filter_yaml=...     — raw YAML with filter_bands list
      3. ?type=...&fc=...&q=...  — direct parameters (type required)

    Query params:
    - preset: name of a preset (e.g. 'Le Cléac'h HP',
      '2-way crossover (LR2 12dB/oct)')
    - filter_yaml: raw YAML string containing a `filter_bands` list
    - type: filter topology (le_cleach, lr2_crossover_2way, peaking_eq,
      highshelf, lowshelf, lowpass, highpass, bandpass)
    - fc: centre/cutoff frequency in Hz
    - q: quality factor (default 0.707)
    - gain_db: boost/cut in dB (default 0)
    - r_load: load impedance in ohms (default 8.0)
    """
    import yaml as _yaml

    from pyhorn_core.solver.filter_schematic import compute_filter_schematic, FilterBand

    # ── Direct parameters mode ────────────────────────────────────────────────
    if type is not None:
        from pyhorn_core.solver.filter_schematic import generate_schematic
        schematic = generate_schematic(
            type=type,
            fc=fc,
            q=q,
            gain_db=gain_db,
            r_load=r_load,
        )
        return {"schematic": schematic}

    if filter_yaml:
        try:
            data = _yaml.safe_load(filter_yaml)
            band_list = data.get("filter_bands", []) if isinstance(data, dict) else []
            bands = [
                FilterBand(
                    type=b.get("type", "peaking_eq"),
                    frequency=float(b.get("frequency", 1000)),
                    q=float(b.get("q", 1.0)),
                    gain_db=float(b.get("gain_db", 0.0)),
                    order=int(b.get("order", 2)),
                    enabled=b.get("enabled", True),
                )
                for b in band_list
            ]
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Invalid filter YAML: {e}")
    elif preset:
        preset_bands = _DEFAULT_BANDS.get(preset)
        if preset_bands is None:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown preset '{preset}'. "
                       f"Available: {', '.join(_DEFAULT_BANDS.keys())}",
            )
        bands = [
            FilterBand(
                type=b.type,
                frequency=b.frequency,
                q=b.q,
                gain_db=b.gain_db,
                order=b.order,
                enabled=b.enabled,
            )
            for b in preset_bands
        ]
    else:
        # Default: Le Cleach HP
        preset_bands = _DEFAULT_BANDS.get("Le Cleach HP", _DEFAULT_BANDS.get("Le Cléac'h HP", []))
        bands = [
            FilterBand(
                type=b.type,
                frequency=b.frequency,
                q=b.q,
                gain_db=b.gain_db,
                order=b.order,
                enabled=b.enabled,
            )
            for b in preset_bands
        ]

    schematic = compute_filter_schematic(bands)
    return {"schematic": schematic}


# ── Filter Wizard ─────────────────────────────────────────────────────────────────


# ── Spectrogram ──────────────────────────────────────────────────────────────────

class SpectrogramRequest(BaseModel):
    """Request body for POST /spectrogram/compute."""
    frequencies: List[float]        # Hz, sorted ascending
    spl: List[float]                # dB SPL at each frequency
    phase_degrees: List[float]     # phase in degrees at each frequency
    window_ms: float = 5.0          # analysis window in ms
    overlap: float = 0.5            # overlap fraction 0-1
    fs: int = 44100                 # sample rate for ISTFT (Hz)


class SpectrogramPreset(BaseModel):
    """A single spectrogram preset."""
    name: str
    window_ms: float
    overlap: float
    description: str


class SpectrogramPresetsResponse(BaseModel):
    """Response from GET /spectrogram/presets."""
    presets: List[SpectrogramPreset]


class SpectrogramResponse(BaseModel):
    """Response from POST /spectrogram/compute."""
    time_ms: List[float]           # time axis in milliseconds
    freq_hz: List[float]           # frequency axis in Hz
    stft_db: List[List[float]]     # 2D array [time][freq], dB values
    window_ms: float
    overlap: float


@app.post("/spectrogram/compute", response_model=SpectrogramResponse)
async def spectrogram_compute(req: SpectrogramRequest):
    """
    Compute a spectrogram from a frequency-domain horn response.

    The response (frequencies, SPL, phase) is treated as a complex transfer function
    H(f) = 10^(SPL/20) × exp(j × phase_rad), then inverse FFT gives the impulse
    response h(t). STFT of h(t) produces the time-frequency spectrogram.

    This mirrors Hornresp's Spectrogram display (Hornresp page 97):
    "Spectral intensity of the impulse response or normalized amplitude in decibels
    as a function of the frequency in relation to the time in milliseconds."
    """
    import math

    # ── Validations ───────────────────────────────────────────────────────────
    n = len(req.frequencies)
    if n < 3:
        raise HTTPException(
            status_code=422,
            detail="Need at least 3 frequency points for spectrogram",
        )
    if not (len(req.spl) == len(req.phase_degrees) == n):
        raise HTTPException(
            status_code=422,
            detail="frequencies, spl, and phase_degrees must have the same length",
        )
    if req.fs <= 0:
        raise HTTPException(status_code=422, detail="fs must be positive")
    if not (0 < req.window_ms <= 100):
        raise HTTPException(status_code=422, detail="window_ms must be > 0 and ≤ 100")
    if not (0 < req.overlap < 1):
        raise HTTPException(status_code=422, detail="overlap must be in (0, 1)")

    # Strictly increasing frequencies
    for i in range(1, n):
        if req.frequencies[i] <= req.frequencies[i - 1]:
            raise HTTPException(
                status_code=422,
                detail="frequencies must be strictly increasing",
            )

    # ── Reconstruct complex transfer function ─────────────────────────────────
    f_arr = np.array(req.frequencies, dtype=float)
    spl_arr = np.array(req.spl, dtype=float)
    phase_arr = np.deg2rad(np.array(req.phase_degrees, dtype=float))

    # H(f) = 10^(SPL/20) × exp(j × phase)
    H_mag = 10.0 ** (spl_arr / 20.0)
    H_complex = H_mag * np.exp(1j * phase_arr)

    # ── Interpolate to uniform frequency grid ─────────────────────────────────
    f_min = f_arr[0]
    f_max = f_arr[-1]
    nfft = 2 ** math.ceil(math.log2(n))  # next power of 2 for better resolution

    # Uniform frequency grid from 0 to fs/2
    f_uniform = np.linspace(f_min, f_max, nfft)
    H_interp = np.interp(f_uniform, f_arr, H_complex.real) + 1j * np.interp(
        f_uniform, f_arr, H_complex.imag
    )

    # Zero-pad to nfft (centre at DC) — create full spectrum
    # The IFFT expects a symmetric spectrum for real output
    # Build full spectrum: [H(0), H(f1)...H(fn), 0...0, conj(H(fn))...conj(H(f1))]
    half_n = nfft // 2
    H_full = np.zeros(nfft, dtype=complex)
    # Copy interpolated spectrum to first half (up to Nyquist)
    # We only have data from f_min to f_max; pad with zeros outside
    f_nyquist = req.fs / 2.0
    # Map f_uniform [f_min..f_max] to FFT bin indices
    H_full[: len(H_interp)] = H_interp

    # Make it conjugate-symmetric for real IFFT output
    # Create full spectrum: H_full[k] for k=0..nfft-1
    # We want H_full[nfft - k] = conj(H_full[k]) for k=1..nfft//2
    for k in range(1, nfft // 2 + 1):
        H_full[nfft - k] = np.conj(H_full[k])

    # ── Inverse FFT → impulse response ────────────────────────────────────────
    h = np.fft.ifft(H_full).real
    t = np.arange(len(h)) / req.fs          # seconds
    t_ms = t * 1000.0                       # milliseconds

    # ── STFT of impulse response ───────────────────────────────────────────────
    window_n = max(2, int(req.window_ms / 1000.0 * req.fs))
    noverlap = int(window_n * req.overlap)

    f_stft, t_stft, Zxx = scipy_signal.stft(
        h,
        fs=req.fs,
        window="hann",
        nperseg=window_n,
        noverlap=noverlap,
        boundary=None,
    )

    # ── Convert to dB, referenced to max magnitude ─────────────────────────────
    Z_mag = np.abs(Zxx)
    Z_max = Z_mag.max() if Z_mag.max() > 0 else 1.0
    stft_db = 20.0 * np.log10(Z_mag / Z_max + 1e-15)

    # Transpose: [time][freq]
    stft_db_T = stft_db.T.tolist()

    return SpectrogramResponse(
        time_ms=(t_stft * 1000.0).tolist(),
        freq_hz=f_stft.tolist(),
        stft_db=stft_db_T,
        window_ms=req.window_ms,
        overlap=req.overlap,
    )


@app.get("/spectrogram/presets", response_model=SpectrogramPresetsResponse)
async def spectrogram_presets():
    """
    Return preset analysis configurations for the spectrogram display.

    These presets offer different trade-offs between time and frequency resolution,
    mirroring typical use-cases for horn and loudspeaker impulse response analysis.
    """
    presets = [
        SpectrogramPreset(
            name="Impulse (2ms window)",
            window_ms=2.0,
            overlap=0.75,
            description="Fine time resolution for impulse response",
        ),
        SpectrogramPreset(
            name="Standard (5ms window)",
            window_ms=5.0,
            overlap=0.5,
            description="Balanced time-frequency resolution",
        ),
        SpectrogramPreset(
            name="Smooth (10ms window)",
            window_ms=10.0,
            overlap=0.5,
            description="Smoother spectrogram, better frequency resolution",
        ),
        SpectrogramPreset(
            name="Fine freq (20ms window)",
            window_ms=20.0,
            overlap=0.3,
            description="High frequency resolution for tonal analysis",
        ),
    ]
    return SpectrogramPresetsResponse(presets=presets)


class WavExportRequest(BaseModel):
    frequencies: List[float]
    spl: List[float]          # dB SPL re 2e-5 Pa
    phase: List[float]        # radians
    output_path: str          # absolute path for the output .wav file
    fs: int = 44100           # sample rate in Hz

    @field_validator("frequencies", "spl", "phase")
    @classmethod
    def arrays_must_match_length(cls, v, info):
        return v

    @model_validator(mode="after")
    def check_array_lengths_and_fs(self):
        n = len(self.frequencies)
        if len(self.spl) != n:
            raise ValueError(f"'spl' has {len(self.spl)} elements but 'frequencies' has {n}")
        if len(self.phase) != n:
            raise ValueError(f"'phase' has {len(self.phase)} elements but 'frequencies' has {n}")
        if self.fs <= 0:
            raise ValueError(f"'fs' must be positive, got {self.fs}")
        return self


class FrdExportRequest(BaseModel):
    frequencies: List[float]
    spl_db: List[float]       # dB SPL re 2e-5 Pa
    phase_deg: List[float]    # phase in degrees
    output_path: str          # absolute path for the output .frd file

    @model_validator(mode="after")
    def check_array_lengths(self):
        n = len(self.frequencies)
        if len(self.spl_db) != n:
            raise ValueError(f"'spl_db' has {len(self.spl_db)} elements but 'frequencies' has {n}")
        if len(self.phase_deg) != n:
            raise ValueError(f"'phase_deg' has {len(self.phase_deg)} elements but 'frequencies' has {n}")
        return self


@app.post("/export/wav")
async def export_wav(req: WavExportRequest):
    """Export impulse response as a 16-bit PCM WAV file (Hornresp page 96)."""
    from pyhorn_core.solver.time_domain import export_impulse_to_wav

    try:
        freqs = np.array(req.frequencies)
        spl = np.array(req.spl)
        phase = np.array(req.phase)
        output_path = Path(req.output_path)

        export_impulse_to_wav(freqs, spl, phase, output_path, fs=req.fs)
        return {"ok": True, "path": str(output_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/export/frd")
async def export_frd(req: FrdExportRequest):
    """Export frequency response data as a .frd file (REW/ARTA format)."""
    from pyhorn_core.output.exporter import export_to_frd

    try:
        freqs = np.array(req.frequencies)
        spl_db = np.array(req.spl_db)
        phase_deg = np.array(req.phase_deg)
        output_path = Path(req.output_path)

        export_to_frd(freqs, spl_db, phase_deg, output_path)
        return {"ok": True, "path": str(output_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.include_router(room_router, prefix="/room-gain", tags=["room-gain"])

# ── Room Gain ────────────────────────────────────────────────────────────────────


@app.post("/room-gain/compute", response_model=RoomGainComputeResponse)
async def room_gain_compute(req: RoomGainComputeRequest):
    """Standalone room boundary gain calculator (Hornresp page 96).

    Computes frequency-dependent room boundary gain (dB) for a loudspeaker
    placed near room boundaries (walls, floor, corners).
    """
    freqs = np.array(req.frequencies)
    if len(freqs) < 2:
        raise HTTPException(status_code=422, detail="frequencies must have at least 2 points")

    try:
        gain_db = compute_room_gain(
            freqs,
            req.room_type,
            req.distance_to_wall_m,
            req.room_volume_m3,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if req.distance_to_wall_m is not None and req.distance_to_wall_m > 0:
        cutoff_hz = 343.0 / (2.0 * np.pi * req.distance_to_wall_m)
    else:
        cutoff_hz = None

    _PEAK_GAIN = {
        "free_space": 0.0,
        "half_space": 3.0103,
        "quarter_space": 6.0206,
        "eighth_space": 9.0309,
    }
    peak_gain = _PEAK_GAIN.get(req.room_type, 0.0)

    if cutoff_hz is not None:
        note_cutoff = f"~{cutoff_hz:.0f} Hz"
    else:
        note_cutoff = "default ~300 Hz (typical room dimension)"

    return RoomGainComputeResponse(
        frequencies=req.frequencies,
        room_gain_db=gain_db.tolist(),
        room_type=req.room_type,
        cutoff_frequency_hz=float(cutoff_hz) if cutoff_hz is not None else None,
        peak_gain_db=round(peak_gain, 4),
        model_note=(
            f"Boundary gain model: {req.room_type} — "
            f"full gain (peak {peak_gain:.1f} dB) applies below {note_cutoff} "
            f"if distance_to_wall={req.distance_to_wall_m}m, then rolls off at "
            f"−6 dB/octave (1/f²). Reference: Hornresp page 96."
        ),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)