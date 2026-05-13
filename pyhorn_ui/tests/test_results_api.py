"""API tests for GET /results — in-memory cache of last simulation result.

These tests are marked @pytest.mark.local and are skipped in GitHub CI.
Run locally with: pytest pyhorn_ui/tests/test_results_api.py -v

Tests target pyhorn_ui/server.py (the Tauri app backend).
"""

import sys
from pathlib import Path

_GDB1 = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_GDB1))

import yaml
import pytest
from fastapi.testclient import TestClient


# ─── Import the server app directly ─────────────────────────────────────────
# We must reimport to pick up the module-level _latest_result global
import importlib
import pyhorn_ui.server as server_module
importlib.reload(server_module)
from pyhorn_ui.server import app, _latest_result  # noqa: E402, F401


@pytest.fixture
def client():
    return TestClient(app)


# Reset _latest_result before each test so they are independent
@pytest.fixture(autouse=True)
def clear_latest_result():
    server_module._latest_result = None
    yield
    server_module._latest_result = None


# ─── Minimal valid driver/horn fixtures ─────────────────────────────────────

def _fe166nv2_driver():
    return {
        "fs": 49.6,
        "qts": 0.27,
        "qes": 0.28,
        "qms": 7.88,
        "vas": 0.0369,
        "re": 7.8,
        "bl": 7.79,
        "mms": 0.00699,
        "cms": 1.472e-3,
        "rms": 0.277,
        "sd": 0.01327,
        "voltage": 2.83,
        "le": 0.8e-3,
        "xmax": 1.5e-3,
    }


def _minimal_horn():
    return {
        "throat_area": 0.004,
        "mouth_area": 0.09,
        "path_length": 1.5,
        "profile_type": "exponential",
    }


# ─── Tests ───────────────────────────────────────────────────────────────────

@pytest.mark.local
def test_results_empty_returns_404(client):
    """When no simulation has been run, /results must return 404."""
    response = client.get("/results")
    assert response.status_code == 404
    data = response.json()
    assert "No simulation results yet" in data["detail"]


@pytest.mark.local
def test_results_returns_latest_after_simulate(client):
    """After a POST /simulate, GET /results must return the cached result."""
    driver = _fe166nv2_driver()
    horn = _minimal_horn()

    # Run a simulation (server.py SimRequest expects YAML strings)
    # parse_driver_specs expects top-level T-S fields (no "driver:" wrapper)
    sim_resp = client.post("/simulate", json={
        "driver_config": yaml.dump(driver),
        "horn_config": yaml.dump(horn),
        "fmin": 20.0,
        "fmax": 2000.0,
        "n_points": 50,
    })
    assert sim_resp.status_code == 200, sim_resp.text

    # Fetch the cached result
    results_resp = client.get("/results")
    assert results_resp.status_code == 200
    data = results_resp.json()

    # Must contain frequency array and SPL
    assert "frequencies" in data
    assert "spl" in data
    assert isinstance(data["frequencies"], list)
    assert isinstance(data["spl"], list)
    assert len(data["frequencies"]) == len(data["spl"]) == 50


@pytest.mark.local
def test_results_returns_most_recent_only(client):
    """Multiple simulations must leave only the last result cached."""
    driver = _fe166nv2_driver()

    # Run two simulations with different n_points
    client.post("/simulate", json={
        "driver_config": yaml.dump(driver),
        "horn_config": yaml.dump(_minimal_horn()),
        "fmin": 20.0,
        "fmax": 2000.0,
        "n_points": 20,
    })
    client.post("/simulate", json={
        "driver_config": yaml.dump(driver),
        "horn_config": yaml.dump(_minimal_horn()),
        "fmin": 20.0,
        "fmax": 2000.0,
        "n_points": 100,
    })

    results_resp = client.get("/results")
    assert results_resp.status_code == 200
    data = results_resp.json()
    # Must be the most recent (100 points), not the first (20 points)
    assert len(data["frequencies"]) == 100


@pytest.mark.local
def test_results_contains_required_fields(client):
    """The cached result must include all key simulation fields."""
    driver = _fe166nv2_driver()
    horn = _minimal_horn()

    client.post("/simulate", json={
        "driver_config": yaml.dump(driver),
        "horn_config": yaml.dump(horn),
        "fmin": 20.0,
        "fmax": 2000.0,
        "n_points": 30,
    })

    data = client.get("/results").json()

    required = [
        "frequencies",
        "spl",
        "impedance",
        "impedance_real",
        "impedance_imag",
    ]
    for field in required:
        assert field in data, f"Missing field: {field}"
        assert isinstance(data[field], list)
        assert len(data[field]) == 30
