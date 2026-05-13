import { useState, useCallback } from "react";
import { SimulationResult, SimParams } from "../types/simulation";

const API_BASE = "http://localhost:8765";

export function useSimulation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const simulate = useCallback(async (params: SimParams) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_config: params.driverYaml,
          horn_config: params.hornYaml,
          fmin: params.fmin,
          fmax: params.fmax,
          n_points: params.nPoints,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: SimulationResult = await res.json();
      setResult(data);
      return data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Simulation failed";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { simulate, loading, error, result };
}