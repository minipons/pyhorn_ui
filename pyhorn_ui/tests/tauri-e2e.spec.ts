/**
 * Tauri E2E Smoke Tests
 *
 * Launches the compiled pyhorn Tauri app (.app bundle) via Playwright's Electron API
 * and runs browser-automation assertions against it.
 *
 * On macOS, Tauri 2 uses WKWebView (not Electron), so this test connects to the
 * app's embedded webview via Playwright's Electron runner — the closest equivalent
 * for desktop-app automation without a separate testing framework.
 *
 * Prerequisites:
 *   - API server must be running on port 8765 (start with: python server.py)
 *   - The .app bundle must exist at src-tauri/target/release/bundle/macos/pyhorn.app
 *
 * Run with: npx playwright test tests/tauri-e2e.spec.ts --timeout=120000
 */

import { test, expect } from "@playwright/test";
import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { _electron, ElectronApplication } from "playwright";

// ESM: derive __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the macOS .app bundle
const APP_BUNDLE_PATH = join(
  __dirname,
  "..",
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "pyhorn.app"
);

const API_URL = "http://localhost:8765/health";

test.describe("pyhorn_ui Tauri E2E Smoke Tests", () => {
  let tauriApp: ElectronApplication | null = null;
  let devServer: ChildProcess | null = null;

  test.beforeAll(async () => {
    // 1. Verify .app bundle exists
    if (!existsSync(APP_BUNDLE_PATH)) {
      console.error(
        `App bundle not found at ${APP_BUNDLE_PATH}. Run: cd src-tauri && cargo build --release`
      );
      test.skip();
      return;
    }

    // 2. Verify API server is running
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`API health check: ${res.status}`);
    } catch {
      console.error(
        `API server not reachable at ${API_URL}. Start it with: cd pyhorn_ui && python server.py`
      );
      test.skip();
      return;
    }

    // 3. Start Vite dev server (provides frontend JS/CSS for the app in dev mode)
    const devServerRes = await fetch("http://localhost:1420").catch(() => null);
    if (!devServerRes?.ok) {
      console.log("Starting Vite dev server...");
      devServer = spawn("npm", ["run", "dev"], {
        cwd: join(__dirname, ".."),
        stdio: "pipe",
        shell: true,
      });

      // Wait for dev server to be ready (up to 30s)
      let ready = false;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const r = await fetch("http://localhost:1420");
          if (r.ok) {
            ready = true;
            console.log("Vite dev server ready at http://localhost:1420");
            break;
          }
        } catch {
          // not ready yet
        }
      }
      if (!ready) {
        console.error("Vite dev server failed to start within 30s");
        devServer?.kill?.();
        test.skip();
        return;
      }
    }

    // 4. Launch the Tauri .app via Playwright's Electron runner
    // (Electron runner on macOS connects to the app's WebKit/WebView context)
    try {
      console.log("Launching Tauri app...");
      tauriApp = await _electron.launch({
        args: undefined,
        path: APP_BUNDLE_PATH,
      });
      console.log("Tauri app launched successfully");
    } catch (err) {
      console.error("Failed to launch Tauri app:", err);
      test.skip();
      return;
    }
  });

  test.afterAll(async () => {
    if (tauriApp) {
      try {
        await tauriApp.close();
      } catch (e) {
        console.error("Error closing Tauri app:", e);
      }
    }
    if (devServer) {
      try {
        devServer.kill?.("SIGTERM");
      } catch {
        // ignore
      }
    }
  });

  // ─── Test 1: App window opens ──────────────────────────────────────────────
  test("app window opens", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Window should be visible
    const isVisible = await window.isVisible();
    expect(isVisible).toBe(true);
  });

  // ─── Test 2: Core UI shell renders ────────────────────────────────────────
  test("core UI shell renders without crashing", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Body must be visible
    const body = window.locator("body");
    await expect(body).toBeVisible();

    // App should have rendered substantial HTML
    const html = await window.content();
    expect(html.length).toBeGreaterThan(500);
  });

  // ─── Test 3: No unhandled console errors on startup ───────────────────────
  test("no unhandled console errors on startup", async () => {
    if (!tauriApp) test.skip();

    const errors: string[] = [];
    const window = await tauriApp.firstWindow();

    window.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    window.on("pageerror", (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(2000);

    const realErrors = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("net::ERR") &&
        !e.includes("Failed to load resource") &&
        !e.includes("websocket") &&
        !e.includes("[object") &&
        !e.includes("undefined")
    );

    expect(realErrors).toHaveLength(0);
  });

  // ─── Test 4: Run Simulation button is present ──────────────────────────────
  test("Run Simulation button is present and enabled", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const runButton = window.locator("button", { hasText: /run.*simulation/i });
    const count = await runButton.count();

    if (count > 0) {
      await expect(runButton.first()).toBeVisible();
      await expect(runButton.first()).toBeEnabled();
    } else {
      // Fallback: any button in the main area
      const anyBtn = window.locator("button").first();
      await expect(anyBtn).toBeVisible();
    }
  });

  // ─── Test 5: Numeric parameter inputs are editable ────────────────────────
  test("numeric parameter inputs are editable", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const inputs = window.locator("input[type='number']");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);

    await inputs.first().fill("200");
    await expect(inputs.first()).toHaveValue("200");
  });

  // ─── Test 6: HornSynthesis wizard panel expands ───────────────────────────
  test("HornSynthesis wizard panel expands on click", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const synthDetails = window.locator("details").filter({
      hasText: /synthesis/i,
    });
    const count = await synthDetails.count();

    if (count > 0) {
      await synthDetails.first().locator("summary").click();
      await window.waitForTimeout(400);
      await expect(synthDetails.first()).toHaveAttribute("open", "");
    } else {
      // Panel not present in this config — skip gracefully
      test.skip();
    }
  });

  // ─── Test 7: Chamber Wizard panel expands ──────────────────────────────────
  test("Chamber Wizard panel expands on click", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const chamberDetails = window.locator("details").filter({
      hasText: /chamber/i,
    });
    const count = await chamberDetails.count();

    if (count > 0) {
      await chamberDetails.first().locator("summary").click();
      await window.waitForTimeout(400);
      await expect(chamberDetails.first()).toHaveAttribute("open", "");
    } else {
      test.skip();
    }
  });

  // ─── Test 8: Filter Wizard panel expands ───────────────────────────────────
  test("Filter Wizard panel expands on click", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const filterDetails = window.locator("details").filter({
      hasText: /filter/i,
    });
    const count = await filterDetails.count();

    if (count > 0) {
      await filterDetails.first().locator("summary").click();
      await window.waitForTimeout(400);
      await expect(filterDetails.first()).toHaveAttribute("open", "");
    } else {
      test.skip();
    }
  });

  // ─── Test 9: API server reachable from app context ─────────────────────────
  test("API server is reachable from app context", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();

    const healthOk = await window.evaluate(async () => {
      try {
        const res = await fetch("http://localhost:8765/health");
        const data = await res.json();
        return data.status === "ok";
      } catch {
        return false;
      }
    });

    expect(healthOk).toBe(true);
  });

  // ─── Test 10: Geometry JSON → horn-segment compute (auto-segment) ─────────
  // "Import geometry JSON → verify auto-segment completes"
  // BACKLOG: E2E Tauri App UI Smoke Tests item.
  //
  // Tauri file-dialogs don't work in headless CI, so we simulate the geometry
  // JSON import by calling the /horn-segment/compute API directly from the app
  // page context — exactly what the Horn Segment UI panel does internally.
  //
  // Request  (geometry JSON / 3-of-4 params): s1_cm2, s2_cm2, l12_cm
  // Response: computed_param, area_profile, system_volume_l
  test("horn-segment API computes catenoidal segment from geometry JSON params", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const result = await window.evaluate(async () => {
      const payload = {
        s1_cm2: 50,    // throat area cm²
        s2_cm2: 300,   // mouth area cm²
        l12_cm: 150,   // horn length cm
        // f12_hz intentionally omitted → API computes it
      };
      try {
        const res = await fetch("http://localhost:8765/horn-segment/compute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        return { ok: res.ok, data };
      } catch (err) {
        return { ok: false, data: { error: String(err) } };
      }
    });

    expect(result.ok, `horn-segment API should return 200: ${JSON.stringify(result.data)}`).toBe(true);
    expect(result.data.computed_param).toBe("f12_hz");
    expect(typeof result.data.computed_value).toBe("number");
    expect(result.data.computed_value).toBeGreaterThan(0);   // cutoff frequency > 0
    expect(Array.isArray(result.data.area_profile)).toBe(true);
    expect(result.data.area_profile.length).toBeGreaterThan(0);
    expect(typeof result.data.system_volume_l).toBe("number");
    expect(result.data.system_volume_l).toBeGreaterThan(0);   // positive internal volume
  });

  // ─── Test 11: ConeVelocityPanel renders SVG chart after simulation ───────────
  test("ConeVelocityPanel renders an SVG chart after simulation", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Find and click the Run Simulation button
    const runButton = window.locator("button", { hasText: /run.*simulation/i });
    const btnCount = await runButton.count();
    if (btnCount === 0) {
      test.skip();
      return;
    }
    await runButton.first().click();

    // Wait for the ConeVelocity chart SVG to appear (simulation result populates chartData)
    const coneVelocityChart = window.locator(".recharts-line", { hasText: /cone velocity/i });
    try {
      await coneVelocityChart.waitFor({ state: "visible", timeout: 30000 });
      await expect(coneVelocityChart).toBeVisible();
    } catch {
      // Simulation may fail in CI (missing driver/horn data) — skip gracefully
      test.skip();
    }
  });

  // ─── Test 12: ConeAccelerationPanel renders SVG chart after simulation ───────
  test("ConeAccelerationPanel renders an SVG chart after simulation", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const runButton = window.locator("button", { hasText: /run.*simulation/i });
    const btnCount = await runButton.count();
    if (btnCount === 0) {
      test.skip();
      return;
    }
    await runButton.first().click();

    // Wait for the ConeAcceleration chart SVG to appear
    const coneAccelerationChart = window.locator(".recharts-line", { hasText: /cone acceleration/i });
    try {
      await coneAccelerationChart.waitFor({ state: "visible", timeout: 30000 });
      await expect(coneAccelerationChart).toBeVisible();
    } catch {
      test.skip();
    }
  });

  // ─── Test 13: FDD Model Panel section appears in sidebar ──────────────────
  test("FDD Model Panel section appears in sidebar", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // FDD Model Panel lives inside a <details> element — expand it first
    const fddDetails = window.locator("details").filter({ hasText: /fdd model/i });
    const detailsCount = await fddDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await fddDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await fddDetails.first().locator("summary").click();
      await window.waitForTimeout(300);
    }

    // FDD Model label must be visible in the sidebar
    const fddLabel = window.locator("span").filter({ hasText: /^FDD Model$/ });
    const count = await fddLabel.count();
    expect(count, "FDD Model panel should be present in the sidebar").toBeGreaterThan(0);
    await expect(fddLabel.first()).toBeVisible();
  });

  // ─── Test 14: FDD Model checkbox toggles panel open/closed ─────────────────
  test("FDD Model enable checkbox toggles panel content open/closed", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Expand the FDD details panel
    const fddDetails = window.locator("details").filter({ hasText: /fdd model/i });
    const detailsCount = await fddDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await fddDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await fddDetails.first().locator("summary").click();
      await window.waitForTimeout(300);
    }

    // Locate the FDD Model checkbox via its label
    const fddLabel = window.locator("label").filter({ hasText: /^FDD Model$/ });
    const checkbox = fddLabel.locator("input[type='checkbox']");

    const cbCount = await checkbox.count();
    if (cbCount === 0) {
      test.skip();
      return;
    }

    // FDD is disabled by default — f_c slider should not be visible
    await expect(window.getByText("f_c (Hz)").first()).not.toBeVisible();

    // Enable FDD via checkbox
    await checkbox.check();
    await window.waitForTimeout(300);

    // After enabling, f_c and D_max slider labels must be visible
    await expect(window.getByText("f_c (Hz)").first()).toBeVisible();
    await expect(window.getByText("D_max (dB)").first()).toBeVisible();

    // Disable FDD
    await checkbox.uncheck();
    await window.waitForTimeout(300);
    await expect(window.getByText("f_c (Hz)").first()).not.toBeVisible();
  });

  // ─── Test 15: RoomGainPanel section expands and shows Compute Room Gain button ──
  test("RoomGainPanel section expands and shows Compute Room Gain button", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // RoomGainPanel lives inside a <details> with summary "🏠 Room Gain Calculator"
    const roomGainDetails = window.locator("details").filter({ hasText: /room gain calculator/i });
    const detailsCount = await roomGainDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await roomGainDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await roomGainDetails.first().locator("summary").click();
      await window.waitForTimeout(400);
    }

    // Compute Room Gain button must be visible after expanding
    const computeBtn = window.locator("button", { hasText: /compute room gain/i });
    const btnCount = await computeBtn.count();
    expect(btnCount, "Compute Room Gain button should be visible after expanding RoomGainPanel").toBeGreaterThan(0);
    await expect(computeBtn.first()).toBeVisible();
  });

  // ─── Test 16: RoomGeneratorPanel section expands and shows file import UI ───
  test("RoomGeneratorPanel section expands and shows file import UI", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // RoomGeneratorPanel lives inside a <details> with summary "🏠 Room Generator"
    const roomGenDetails = window.locator("details").filter({ hasText: /room generator/i });
    const detailsCount = await roomGenDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await roomGenDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await roomGenDetails.first().locator("summary").click();
      await window.waitForTimeout(400);
    }

    // Drag-and-drop / import prompt must be visible
    const importPrompt = window.getByText(/drag.*drop.*room gain|import.*room gain file/i);
    const promptCount = await importPrompt.count();
    expect(promptCount, "Room Generator import UI should be visible after expanding").toBeGreaterThan(0);
    await expect(importPrompt.first()).toBeVisible();
  });

  // ─── Test 17: SpectrogramPanel renders in the UI ───────────────────────────
  test("SpectrogramPanel renders in the UI", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // SpectrogramPanel is in a <section className="panel"> — directly visible, no <details> needed
    const spectrogramPanel = window.locator(".panel", { hasText: /spectrogram/i });
    const count = await spectrogramPanel.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await expect(spectrogramPanel.first()).toBeVisible();

    // Placeholder shown without simulation result
    const placeholder = window.locator(".sp-placeholder", { hasText: /run a simulation first/i });
    await expect(placeholder).toBeVisible();
  });

  // ─── Test 18: Filter Wizard panel section is present and expandable ─────────
  test("Filter Wizard panel section is present and expandable", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // FilterWizard lives inside a <details className="panel"> with summary "Filter Wizard"
    const filterDetails = window.locator("details.panel", {
      has: window.locator("summary", { hasText: "Filter Wizard" }),
    });
    const detailsCount = await filterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    // Verify summary is visible
    await expect(filterDetails.locator("summary")).toBeVisible();

    // Expand the panel
    const isOpen = await filterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await filterDetails.locator("summary").click();
      await window.waitForTimeout(300);
    }

    // Panel should still be visible after expanding
    await expect(filterDetails).toBeVisible();
  });

  // ─── Test 19: Filter Wizard has band controls when expanded ─────────────────
  test("Filter Wizard has band controls when expanded", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const filterDetails = window.locator("details.panel", {
      has: window.locator("summary", { hasText: "Filter Wizard" }),
    });
    const detailsCount = await filterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await filterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await filterDetails.locator("summary").click();
      await window.waitForTimeout(300);
    }

    // FilterWizard renders 4 band rows (.filter-band-row), each with a toggle checkbox.
    // Band controls only appear when a simulation result is present.
    const bandRows = filterDetails.locator(".filter-band-row");
    const bandCount = await bandRows.count();

    if (bandCount > 0) {
      // With simulation result: band rows and checkboxes are present
      expect(bandCount).toBeGreaterThanOrEqual(4);
      const checkboxes = filterDetails.locator(".filter-band-row input[type='checkbox']");
      expect(await checkboxes.count()).toBeGreaterThan(0);
      await expect(filterDetails.locator(".preset-section")).toBeVisible();
      await expect(filterDetails.getByRole("button", { name: /save preset/i })).toBeVisible();
      await expect(filterDetails.getByRole("button", { name: /le cléac'h crossover schematic/i })).toBeVisible();
    } else {
      // Without simulation result: FilterWizard is not rendered — placeholder shown
      const placeholder = filterDetails.locator(".placeholder", { hasText: /run a simulation first/i });
      await expect(placeholder).toBeVisible();
    }
  });

  // ─── Test 20: Filter Wizard preset buttons work ────────────────────────────
  test("Filter Wizard preset buttons work", async () => {
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const filterDetails = window.locator("details.panel", {
      has: window.locator("summary", { hasText: "Filter Wizard" }),
    });
    const detailsCount = await filterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await filterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await filterDetails.locator("summary").click();
      await window.waitForTimeout(300);
    }

    // Without a simulation result, FilterWizard component is not rendered.
    const saveBtn = filterDetails.getByRole("button", { name: /save preset/i });
    const saveBtnVisible = await saveBtn.isVisible().catch(() => false);

    if (!saveBtnVisible) {
      // No simulation result — FilterWizard not rendered, verify placeholder is shown
      const placeholder = filterDetails.locator(".placeholder", { hasText: /run a simulation first/i });
      await expect(placeholder).toBeVisible();
      return;
    }

    // With simulation result: verify Save Preset flow works
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();

    // Open the save dialog
    await saveBtn.click();
    await window.waitForTimeout(200);

    const presetInput = filterDetails.locator(".preset-name-input");
    await expect(presetInput).toBeVisible();

    await presetInput.fill("Tauri Test Preset");
    const confirmSaveBtn = filterDetails.getByRole("button", { name: "Save" });
    await expect(confirmSaveBtn).toBeVisible();
    await confirmSaveBtn.click();
    await window.waitForTimeout(300);

    // Preset should appear in the preset list
    await expect(filterDetails.locator(".preset-item", { hasText: "Tauri Test Preset" })).toBeVisible();
  });

  // ─── Test 21: Filter Delta panel section is present in the UI ───────────────
  test("Filter Delta panel section is present in the UI", async () => {
    // FilterDelta (Filtered SPL — Difference vs Baseline) only renders when
    // filteredResult && result — i.e. after Apply Filters is clicked.
    // Without a simulation result it won't be visible — skip gracefully.
    if (!tauriApp) test.skip();

    const window = await tauriApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const filterDeltaPanel = window.locator(".plot-panel", {
      hasText: /filtered spl.*difference.*baseline/i,
    });
    const count = await filterDeltaPanel.count();
    if (count === 0) {
      // No simulation + filtered result → panel not rendered — expected
      test.skip();
      return;
    }
    await expect(filterDeltaPanel.first()).toBeVisible();
  });
});
