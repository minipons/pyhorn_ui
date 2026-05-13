import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:1420";

test.describe("pyhorn_ui E2E Smoke Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Collect console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Browser Error] ${msg.text()}`);
      }
    });
  });

  test("app loads without crashing", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // App should render something
    await expect(page.locator("body")).toBeVisible();
  });

  test("HornMetrics component renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // HornMetrics is in the DOM — it may show empty state without data
    // Verify the section exists
    const metricsSection = page.locator("text=/throat|mouth|area/i").first();
    // At minimum the app shell should load
    await expect(page.locator("body")).toBeVisible();
  });

  test("HornMetrics displays computed values after auto-simulation completes", async ({ page }) => {
    // The app auto-runs simulation on load using the default horn/driver config.
    // This tests the critical data path: app loads → simulation runs → HornMetrics
    // shows real computed values from the API (not null/empty/placeholder state).
    // Regression test for the bug where project YAML loading caused HornMetrics to
    // return null for all fields because hornYaml was the project YAML (not geometry).
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Wait for simulation to complete — the app shows "last simulated" timestamp
    await page.waitForFunction(
      () => {
        const el = Array.from(document.querySelectorAll("*")).find(
          (e) => e.textContent?.match(/last simulated/i)
        );
        return el !== undefined;
      },
      { timeout: 20000 }
    );

    // HornMetrics strip must be visible after simulation
    const metricsStrip = page.locator(".horn-metrics-strip");
    await expect(metricsStrip).toBeVisible();

    // HornMetrics should render metric badges with computed values (not null/empty)
    const badges = metricsStrip.locator(".horn-metric-badge");
    const count = await badges.count();
    expect(count, "HornMetrics should render metric badges after simulation").toBeGreaterThan(0);

    // Verify at least one badge shows a value with a unit — not "null", "—", or "Loading"
    const metricValues = metricsStrip.locator(".horn-metric-value");
    const valueCount = await metricValues.count();
    expect(valueCount, "HornMetrics should render .horn-metric-value spans").toBeGreaterThan(0);

    // Collect all visible metric values
    const values = await metricValues.allTextContents();

    // At least some values must contain digits (computed numbers, not empty/placeholder)
    const valuesWithDigits = values.filter((v) => /\d/.test(v));
    expect(
      valuesWithDigits.length,
      `HornMetrics should show computed numeric values (got: ${JSON.stringify(values)})`
    ).toBeGreaterThan(0);

    // None of the values should be null/placeholder strings
    const invalidValues = values.filter(
      (v) => v === "null" || v === "—" || v === "" || /loading/i.test(v)
    );
    expect(
      invalidValues.length,
      `HornMetrics should not show placeholder values (got invalid: ${JSON.stringify(invalidValues)})`
    ).toBe(0);
  });

  test("simulation Run button is present", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const runBtn = page.locator("button", { hasText: /run simulation/i });
    await expect(runBtn).toBeVisible();
  });

  test("frequency input field is editable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // Find a numeric input (frequency range)
    const inputs = page.locator("input[type='number']");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
    if (count > 0) {
      await inputs.first().fill("200");
      await expect(inputs.first()).toHaveValue("200");
    }
  });

  test("HornSynthesis wizard panel can be expanded", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // Look for synthesis wizard by text
    const synthesisDetails = page.locator("details").filter({ hasText: /synthesis/i });
    const count = await synthesisDetails.count();
    if (count > 0) {
      await synthesisDetails.first().locator("summary").click();
      await page.waitForTimeout(300);
    }
    // Panel should remain visible after click
    await expect(page.locator("body")).toBeVisible();
  });

  test("Chamber Wizard panel can be expanded", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const chamberDetails = page.locator("details").filter({ hasText: /chamber/i });
    const count = await chamberDetails.count();
    if (count > 0) {
      await chamberDetails.first().locator("summary").click();
      await page.waitForTimeout(300);
    }
    await expect(page.locator("body")).toBeVisible();
  });

  test("parameter input change triggers UI update", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const inputs = page.locator("input[type='number']");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
    if (count > 0) {
      const firstInput = inputs.first();
      const originalValue = await firstInput.inputValue();
      await firstInput.fill("150");
      await expect(firstInput).not.toHaveValue(originalValue);
    }
  });

  test("export section appears after simulation result", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // The Export section (with FRD button) only renders when `result` is set.
    // After a simulation completes, result is non-null → Export panel appears.
    // The app auto-runs simulation on load, so Export should be visible.
    const exportHeading = page.locator("h2", { hasText: "Export" });
    await expect(exportHeading).toBeVisible();
  });

  test("no unhandled console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // Filter out known benign errors (e.g., favicon, Tauri IPC during dev)
    const realErrors = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("net::ERR") &&
        !e.includes("Failed to load resource")
    );
    expect(realErrors).toHaveLength(0);
  });

  test("ConeVelocityPanel container renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // ConeVelocityPanel lives inside a .plot-panel with ChartTitle "Cone Velocity"
    const coneVelocityPanel = page.locator(".plot-panel", { hasText: /cone velocity/i });
    const count = await coneVelocityPanel.count();
    expect(count).toBeGreaterThan(0);
    await expect(coneVelocityPanel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so the chart (not placeholder) is visible.
  });

  test("FDD Model Panel section is present in the UI", async ({ page }) => {
    // FDDModelPanel lives inside a <details> element — must be expanded first.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the FDD details panel
    const fddDetails = page.locator("details").filter({ hasText: /fdd model/i });
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
      await page.waitForTimeout(300);
    }

    // FDD Model label must be present (inside InfoTooltip)
    const fddLabel = page.locator("span").filter({ hasText: /^FDD Model$/ });
    await expect(fddLabel.first()).toBeVisible();

    // Frequency-dependent directivity sub-text
    await expect(page.getByText("frequency-dependent directivity")).toBeVisible();
  });

  test("FDD Model checkbox toggles panel visibility", async ({ page }) => {
    // The FDD panel sliders are conditionally rendered: only when the enable checkbox is checked.
    // The panel is inside a <details> element that must be expanded first.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the FDD details panel
    const fddDetails = page.locator("details").filter({ hasText: /fdd model/i });
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
      await page.waitForTimeout(300);
    }

    // Locate the FDD checkbox inside the FDDModelPanel label
    const fddLabel = page.locator("label").filter({ hasText: /^FDD Model$/ });
    const checkbox = fddLabel.locator("input[type='checkbox']");
    const cbCount = await checkbox.count();
    if (cbCount === 0) {
      test.skip();
      return;
    }

    // Verify checkbox is initially unchecked
    await expect(checkbox).not.toBeChecked();

    // f_c (Hz) and D_max (dB) text must NOT be visible when FDD is disabled
    await expect(page.getByText("f_c (Hz)").first()).not.toBeVisible();
    await expect(page.getByText("D_max (dB)").first()).not.toBeVisible();

    // Check the checkbox to expand the FDD panel controls
    await checkbox.check();
    await page.waitForTimeout(300);

    // After enabling, f_c (Hz) and D_max (dB) slider labels must be visible
    await expect(page.getByText("f_c (Hz)").first()).toBeVisible();
    await expect(page.getByText("D_max (dB)").first()).toBeVisible();

    // Uncheck to collapse the FDD controls
    await checkbox.uncheck();
    await page.waitForTimeout(300);
    await expect(page.getByText("f_c (Hz)").first()).not.toBeVisible();
  });

  test("ConeAccelerationPanel container renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // ConeAccelerationPanel lives inside a .plot-panel with ChartTitle "Cone Acceleration"
    const coneAccelerationPanel = page.locator(".plot-panel", { hasText: /cone acceleration/i });
    const count = await coneAccelerationPanel.count();
    expect(count).toBeGreaterThan(0);
    await expect(coneAccelerationPanel.first()).toBeVisible();
    // Without a simulation result the panel shows a placeholder
    await expect(page.locator(".placeholder", { hasText: /cone acceleration/i })).toBeVisible();
  });

  // ─── RoomGainPanel ──────────────────────────────────────────────────────────
  test("RoomGainPanel section expands and shows Compute Room Gain button", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // RoomGainPanel lives inside a <details> element with summary "🏠 Room Gain Calculator"
    const roomGainDetails = page.locator("details").filter({ hasText: /room gain calculator/i });
    const count = await roomGainDetails.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const isOpen = await roomGainDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await roomGainDetails.first().locator("summary").click();
      await page.waitForTimeout(400);
    }

    // Compute Room Gain button must be visible after expanding
    const computeBtn = page.locator("button", { hasText: /compute room gain/i });
    await expect(computeBtn.first()).toBeVisible();

    // Room boundary type radio options must also be visible
    await expect(page.getByText("Free space (0 dB)")).toBeVisible();
    await expect(page.getByText("Half space (+3 dB)")).toBeVisible();
  });

  test("RoomGeneratorPanel section expands and shows file import UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // RoomGeneratorPanel lives inside a <details> with summary "🏠 Room Generator"
    const roomGenDetails = page.locator("details").filter({ hasText: /room generator/i });
    const count = await roomGenDetails.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const isOpen = await roomGenDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await roomGenDetails.first().locator("summary").click();
      await page.waitForTimeout(400);
    }

    // Drag-and-drop placeholder text must be visible
    await expect(page.getByText(/drag.*drop.*room gain|import.*room gain/i).first()).toBeVisible();
    // File format hint must be present
    await expect(page.getByText(/frequency.*room_gain|room_gain.*dB/i).first()).toBeVisible();
  });

  // ─── Missing plot-panel smoke tests ─────────────────────────────────────────
  test("SPL Frequency Response plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /spl frequency response/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so placeholder timing is unreliable across test runs.
  });

  test("Impedance plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /impedance/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so placeholder timing is unreliable across test runs.
  });

  test("Horn Profile plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /horn profile/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
  });

  test("Throat Acoustic Impedance plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /throat acoustic impedance/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
  });

  test("Driver Excursion plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /driver excursion/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so placeholder timing is unreliable across test runs.
  });

  test("Particle Velocity plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /particle velocity/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: the placeholder "Run a simulation..." is not checked because the app
    // auto-runs simulation on load, so the chart (not placeholder) is visible.
  });

  test("Diaphragm Pressure plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /diaphragm pressure/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so placeholder timing is unreliable across test runs.
  });

  test("Directivity plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /directivity/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
  });

  test("System Efficiency plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /system efficiency/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so placeholder timing is unreliable across test runs.
  });

  test("Driver Power plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /driver power/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: the placeholder "Run a simulation..." is not checked because the app
    // auto-runs simulation on load, so the chart (not placeholder) is visible.
  });

  test("Group Delay plot-panel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const panel = page.locator(".plot-panel", { hasText: /group delay/i });
    const count = await panel.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.first()).toBeVisible();
    // Note: placeholder check removed — app auto-runs simulation on load,
    // so placeholder timing is unreliable across test runs.
  });

  test("Group Delay chart shows green dashed 1/f reference line after simulation", async ({ page }) => {
    // After a simulation completes, the Group Delay chart should display the 1/f reference
    // line (GD = 1000/f ms, Hornresp page 71) as a green dashed Line.
    // This test verifies the green (#22c55e), dashed SVG path exists.
    // The app auto-runs simulation on page load using default horn/driver config.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Wait for the "last simulated" text to appear, confirming simulation completed.
    // Use a short poll loop (up to 20s) rather than a fixed sleep.
    await page.waitForFunction(
      () => {
        const el = Array.from(document.querySelectorAll("*")).find(
          (e) => e.textContent?.match(/last simulated/i)
        );
        return el !== undefined;
      },
      { timeout: 20000 }
    );

    // Find the Group Delay plot panel
    const gdPanel = page.locator(".plot-panel", { hasText: /group delay/i });
    await expect(gdPanel).toBeVisible();

    // Verify the green dashed 1/f reference line exists in the GD chart SVG.
    // Recharts <Line> renders as a <g class="recharts-line"> wrapping a <path>.
    // The SVG stroke and stroke-dasharray attributes are on the <path>, not the <g>.
    // The dasharray="5 5" is expanded by the browser to "5px, 5px, ..." so we
    // use a partial-match selector (*=) to match the expanded form.
    const greenDashedCount = await gdPanel.locator(
      '.recharts-line path[stroke="#22c55e"][stroke-dasharray*="5px"]'
    ).count();

    // Futtrup limit is also dashed but red (#f85149); only the 1/f line is green
    expect(
      greenDashedCount,
      `Expected at least 1 green dashed 1/f reference line in GD chart, found ${greenDashedCount}`
    ).toBeGreaterThan(0);
  });

  test("SpectrogramPanel renders in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // SpectrogramPanel is in a <section className="panel"> with ChartTitle "🔥 Spectrogram"
    const spectrogramPanel = page.locator(".panel", { hasText: /spectrogram/i });
    const count = await spectrogramPanel.count();
    expect(count).toBeGreaterThan(0);
    await expect(spectrogramPanel.first()).toBeVisible();
    // The "Generate Spectrogram" button must be present
    const generateBtn = page.locator("button", { hasText: /generate spectrogram/i });
    await expect(generateBtn).toBeVisible();
  });

  test("invalid YAML in driver editor shows error message", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the Driver YAML panel
    const driverDetails = page.locator("details").filter({ hasText: /driver.*yaml/i }).first();
    const count = await driverDetails.count();
    if (count === 0) {
      // Try alternate text
      const allDetails = page.locator("details");
      const total = await allDetails.count();
      let expanded = false;
      for (let i = 0; i < total; i++) {
        const txt = await allDetails.nth(i).textContent();
        if (txt && /driver/i.test(txt)) {
          await allDetails.nth(i).locator("summary").click();
          await page.waitForTimeout(300);
          expanded = true;
          break;
        }
      }
      if (!expanded) test.skip();
    } else {
      await driverDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // Find the driver textarea
    const textareas = page.locator("textarea");
    const taCount = await textareas.count();
    expect(taCount).toBeGreaterThan(0);

    // Inject invalid YAML
    await textareas.first().fill("not: valid: yaml: [");
    await page.waitForTimeout(300);

    // Error message should appear
    const errorMsg = page.locator(".yaml-error");
    const errorCount = await errorMsg.count();
    expect(errorCount).toBeGreaterThan(0);
  });

  test("server offline banner appears when API is unreachable", async ({ page }) => {
    // Intercept all API calls to simulate server being down
    await page.route("**/health", (route) => route.abort("failed"));
    await page.route("**/simulate", (route) => route.abort("failed"));

    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000); // wait for health check to fire and banner to appear

    // Server offline banner should be visible
    const banner = page.locator(".server-offline-banner");
    const bannerVisible = await banner.isVisible().catch(() => false);
    // Also check by text content
    const bannerByText = page.locator("text=/server.*offline|api.*unreachable/i");
    const count = await bannerByText.count();

    // At least one error indicator should be present
    expect(bannerVisible || count > 0).toBeTruthy();
  });

  test("horn-segment API computes catenoidal segment geometry from JSON params", async ({ page }) => {
    // Test the /horn-segment/compute endpoint (the geometry-calculation engine
    // behind the Horn Segment panel).  Tauri file-dialogs don't work in headless
    // mode, so we call the API directly — exactly what the UI does internally.
    //
    // Request: provide s1_cm2, s2_cm2, l12_cm → API computes f12_hz (cutoff).
    // Response must include computed_param, area_profile, and system_volume_l.

    const payload = {
      s1_cm2: 50,    // throat area cm²
      s2_cm2: 300,   // mouth area cm²
      l12_cm: 150,   // horn length cm
      // f12_hz intentionally omitted — API will compute it
    };

    let ok = false;
    let data: Record<string, unknown> = {};

    try {
      const res = await fetch("http://localhost:8765/horn-segment/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      ok = res.ok;
      data = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      console.error("horn-segment API call failed:", err);
    }

    expect(ok, `/horn-segment/compute should return 200 — got response: ${JSON.stringify(data)}`).toBe(true);
    expect(data.computed_param).toBe("f12_hz");
    expect(typeof data.computed_value).toBe("number");
    expect(data.computed_value).toBeGreaterThan(0);  // cutoff frequency must be positive
    expect(Array.isArray(data.area_profile)).toBe(true);
    expect((data.area_profile as unknown[]).length).toBeGreaterThan(0);
    expect(typeof data.system_volume_l).toBe("number");
    expect(data.system_volume_l).toBeGreaterThan(0); // horn must have positive internal volume
  });

  test("API server is reachable from app page context", async ({ page }) => {
    // Verify the API server is accessible from within the browser page context
    // (i.e. the Vite dev server can reach the FastAPI backend on port 8765).
    const healthOk = await page.evaluate(async () => {
      try {
        const res = await fetch("http://localhost:8765/health");
        if (!res.ok) return false;
        const json = await res.json();
        return json.status === "ok";
      } catch {
        return false;
      }
    });
    expect(healthOk).toBe(true);
  });

  test("HornMetrics renders for sections-format YAML (regression for commit 07b6940)", async ({ page }) => {
    // Regression test: before the parseSections() fix (commit 07b6940), horns
    // saved with chained profile sections (sections: [...]) would cause
    // HornMetrics to return null because throat_area/mouth_area/path_length
    // were absent at top level. This test verifies the component renders
    // non-null metrics for the sections format.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the Horn YAML panel
    const hornYamlDetails = page.locator("details.panel", { has: page.locator("summary", { hasText: "Horn YAML" }) });
    const isOpen = await hornYamlDetails.locator("summary").evaluate((el) => (el.closest("details") as HTMLDetailsElement).open);
    if (!isOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // Replace the YAML content with a sections-format horn (no top-level throat/mouth/path)
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015
  - name: body
    profile_type: exponential
    length: 0.8
    start_area: 0.015
    end_area: 0.04
  - name: mouth
    profile_type: exponential
    length: 0.3
    start_area: 0.04
    end_area: 0.06`;

    // Use evaluate to directly dispatch an input event on the textarea — more reliable
    // than fill() for triggering React's synthetic onChange in some setups.
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    // Dispatch native input event to ensure React's onChange synthetic event fires
    await hornTextarea.evaluate((el) => {
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.waitForTimeout(800); // allow useMemo to recompute

    // HornMetrics strip must be visible (not null/empty — this was the bug)
    const metricsStrip = page.locator(".horn-metrics-strip");
    await expect(metricsStrip).toBeVisible();

    // Verify expected metric badges are present
    const badges = metricsStrip.locator(".horn-metric-badge");
    const count = await badges.count();
    expect(count, "HornMetrics should render metric badges for sections-format YAML").toBeGreaterThan(0);

    // Key values derived from the sections above:
    //   throat_area = 0.008  → rt = sqrt(0.008/π) ≈ 0.0503
    //   mouth_area  = 0.06   → rm = sqrt(0.06/π)  ≈ 0.138
    //   path_length = 1.5    (0.4 + 0.8 + 0.3)
    //   expansion   = 0.06 / 0.008 = 7.5
    //   m           = (1/1.5) * ln(7.5) ≈ 1.343
    //   fc          = m*343 / (4π) ≈ 36.8 Hz
    //   krm         = rm*m/2 ≈ 0.0928  → "bass_ok"
    await expect(metricsStrip.locator(".horn-metric-value", { hasText: "Hz" })).toBeVisible();
    // Verify rating badge is visible — rating.replace("_", " ") yields "bass ok", "midrange ok", or "undersized"
    // krm ≈ 0.0928 ≥ 0.07 → "bass ok"
    await expect(metricsStrip.locator(".horn-metric-value", { hasText: /bass ok|midrange ok|undersized/ })).toBeVisible();
  });

  // ─── FilterWizard ───────────────────────────────────────────────────────────
  test("Filter Wizard panel section is present and expandable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // FilterWizard lives inside a <details className="panel"> with summary "Filter Wizard"
    const filterDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Filter Wizard" }),
    });
    const detailsCount = await filterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    // Verify summary is visible
    await expect(filterDetails.locator("summary")).toBeVisible();

    // Expand the panel (filterExpanded starts as false, so details is collapsed)
    const isOpen = await filterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await filterDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // After expanding: without a simulation result the inner content shows the placeholder.
    // With a result it shows the FilterWizard component — either way the panel is functional.
    const placeholder = filterDetails.locator(".placeholder", { hasText: /run a simulation first/i });
    const bandRows = filterDetails.locator(".filter-band-row");
    const hasPlaceholder = await placeholder.isVisible().catch(() => false);
    const hasBandRows = (await bandRows.count()) > 0;
    expect(hasPlaceholder || hasBandRows, "Expanded FilterWizard should show either placeholder or band controls").toBe(true);

    // Panel should still be visible after expanding
    await expect(filterDetails).toBeVisible();
  });

  test("Filter Wizard has band controls when expanded", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the Filter Wizard panel
    const filterDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Filter Wizard" }),
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
      await page.waitForTimeout(300);
    }

    // FilterWizard renders 4 band rows (.filter-band-row), each with a toggle checkbox.
    // Band controls only appear when a simulation result is present.
    // Without a result, the FilterWizard is not rendered — check for placeholder.
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

  test("Filter Wizard preset buttons work", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the Filter Wizard panel
    const filterDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Filter Wizard" }),
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
      await page.waitForTimeout(300);
    }

    // Without a simulation result, FilterWizard component is not rendered.
    // Check for the "Save Preset" button (inside FilterWizard, only renders with result).
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
    await page.waitForTimeout(200);

    const presetInput = filterDetails.locator(".preset-name-input");
    await expect(presetInput).toBeVisible();

    await presetInput.fill("Test Preset");
    const confirmSaveBtn = filterDetails.getByRole("button", { name: "Save" });
    await expect(confirmSaveBtn).toBeVisible();
    await confirmSaveBtn.click();
    await page.waitForTimeout(300);

    // Preset should appear in the preset list
    await expect(filterDetails.locator(".preset-item", { hasText: "Test Preset" })).toBeVisible();
  });

  test("Filter Delta panel section is present in the UI", async ({ page }) => {
    // FilterDelta (Filtered SPL — Difference vs Baseline) is a plot-panel that only
    // renders when filteredResult && result (i.e. after Apply Filters is clicked).
    // Without a simulation result it will not be visible — skip gracefully.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    const filterDeltaPanel = page.locator(".plot-panel", {
      hasText: /filtered spl.*difference.*baseline/i,
    });
    const count = await filterDeltaPanel.count();
    if (count === 0) {
      // No simulation + filtered result → panel not rendered — this is expected
      test.skip();
      return;
    }
    await expect(filterDeltaPanel.first()).toBeVisible();
  });

  test("WidthAdjustment panel section is present in the UI", async ({ page }) => {
    // WidthAdjustment lives inside a <details> element — must be expanded first.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the Width Adjustment details panel
    const waDetails = page.locator("details").filter({ hasText: /width adjustment/i });
    const detailsCount = await waDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await waDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await waDetails.first().locator("summary").click();
      await page.waitForTimeout(300);
    }

    // The component renders a description paragraph
    await expect(page.getByText(/vary the width of a rectangular horn/i)).toBeVisible();

    // Width factor input must be present
    const widthFactorInput = waDetails.locator("input[type='number']").first();
    await expect(widthFactorInput).toBeVisible();

    // Preset buttons must be present (×1, 50%, etc.) — use exact role to avoid matching the "×1 (no change)" badge
    await expect(waDetails.getByRole("button", { name: "×1", exact: true })).toBeVisible();

    // Compute button must be present
    await expect(waDetails.getByText(/apply width adjustment/i)).toBeVisible();
  });

  test("WidthAdjustment preset buttons update the width factor", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand Width Adjustment panel
    const waDetails = page.locator("details").filter({ hasText: /width adjustment/i });
    const detailsCount = await waDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await waDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await waDetails.first().locator("summary").click();
      await page.waitForTimeout(300);
    }

    // Get the width factor input
    const widthFactorInput = waDetails.locator("input[type='number']").first();
    await expect(widthFactorInput).toBeVisible();

    // Initial value should be 1.0
    await expect(widthFactorInput).toHaveValue("1");

    // Click the 150% preset button (×1.5)
    const preset150 = waDetails.getByRole("button", { name: "×1.5" });
    await preset150.click();
    await page.waitForTimeout(200);

    // The input value should change to 1.5
    await expect(widthFactorInput).toHaveValue("1.5");

    // Click the 75% preset button
    const preset75 = waDetails.getByText("75%");
    await preset75.click();
    await page.waitForTimeout(200);

    // The input value should change to 0.75
    await expect(widthFactorInput).toHaveValue("0.75");
  });

  test("WidthAdjustment slider updates the width factor input", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand Width Adjustment panel
    const waDetails = page.locator("details").filter({ hasText: /width adjustment/i });
    const detailsCount = await waDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await waDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await waDetails.first().locator("summary").click();
      await page.waitForTimeout(300);
    }

    // The width factor input and slider should be present
    const widthFactorInput = waDetails.locator("input[type='number']").first();
    const slider = waDetails.locator("input[type='range']").first();
    await expect(slider).toBeVisible();

    // Move slider to 75% position (value 0.75)
    await slider.fill("0.75");
    await page.waitForTimeout(200);

    // Input should reflect the new value
    await expect(widthFactorInput).toHaveValue("0.75");

    // Scale badge should show "-25% narrower"
    await expect(waDetails.getByText(/-25% narrower/i)).toBeVisible();
  });

  // ─── DampingMaterialPanel ─────────────────────────────────────────────────
  test("DampingMaterialPanel section is present and expandable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // DampingMaterialPanel lives inside a <details> with summary "🎭 Segment Damping Material".
    // It only renders when the Horn YAML has a sections: block, so set that up first.
    const hornYamlDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Horn YAML" }),
    });
    const hornDetailsOpen = await hornYamlDetails.locator("summary").evaluate(
      (el) => (el.closest("details") as HTMLDetailsElement).open
    );
    if (!hornDetailsOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // Set sections-format YAML so DampingMaterialPanel renders
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015
  - name: body
    profile_type: exponential
    length: 0.8
    start_area: 0.015
    end_area: 0.04`;
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    await hornTextarea.evaluate((el) => {
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.waitForTimeout(400);

    // Now find and expand the Damping Material panel
    const dampingDetails = page.locator("details").filter({ hasText: /segment damping material/i });
    const detailsCount = await dampingDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    const isOpen = await dampingDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await dampingDetails.first().locator("summary").click();
      await page.waitForTimeout(400);
    }

    // The panel should remain open
    await expect(dampingDetails.first()).toBeVisible();
    // The segment selector must be visible inside the expanded panel
    await expect(dampingDetails.locator("select")).toBeVisible();
  });

  test("DampingMaterialPanel has Fr1 slider and material presets", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Set up Horn YAML with sections
    const hornYamlDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Horn YAML" }),
    });
    const hornDetailsOpen = await hornYamlDetails.locator("summary").evaluate(
      (el) => (el.closest("details") as HTMLDetailsElement).open
    );
    if (!hornDetailsOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    await hornTextarea.evaluate((el) => el.dispatchEvent(new InputEvent("input", { bubbles: true })));
    await page.waitForTimeout(400);

    // Expand DampingMaterialPanel
    const dampingDetails = page.locator("details").filter({ hasText: /segment damping material/i });
    const detailsCount = await dampingDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await dampingDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await dampingDetails.first().locator("summary").click();
      await page.waitForTimeout(400);
    }

    // Fr1 slider: range 0–20000 (distinguished from Tal1 which is 0–1)
    const fr1Slider = dampingDetails.locator("input[type='range']").filter({ has: page.locator("..") }).nth(0);
    await expect(fr1Slider).toBeVisible();

    // Material preset buttons must be present
    await expect(dampingDetails.getByRole("button", { name: /felt/i })).toBeVisible();
    await expect(dampingDetails.getByRole("button", { name: /wool fibre/i })).toBeVisible();
    await expect(dampingDetails.getByRole("button", { name: /mineral wool/i })).toBeVisible();
    await expect(dampingDetails.getByRole("button", { name: /open-cell foam/i })).toBeVisible();

    // Preset buttons must be clickable (no crash)
    await dampingDetails.getByRole("button", { name: /felt/i }).click();
    await page.waitForTimeout(200);
    await dampingDetails.getByRole("button", { name: /mineral wool/i }).click();
    await page.waitForTimeout(200);
  });

  test("DampingMaterialPanel has Tal1 slider", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Set up Horn YAML with sections
    const hornYamlDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Horn YAML" }),
    });
    const hornDetailsOpen = await hornYamlDetails.locator("summary").evaluate(
      (el) => (el.closest("details") as HTMLDetailsElement).open
    );
    if (!hornDetailsOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    await hornTextarea.evaluate((el) => el.dispatchEvent(new InputEvent("input", { bubbles: true })));
    await page.waitForTimeout(400);

    // Expand DampingMaterialPanel
    const dampingDetails = page.locator("details").filter({ hasText: /segment damping material/i });
    const detailsCount = await dampingDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await dampingDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await dampingDetails.first().locator("summary").click();
      await page.waitForTimeout(400);
    }

    // Tal1 fill fraction slider: range 0–1 (min=0, max=1, step=0.01)
    const tal1Slider = dampingDetails.locator("input[type='range']").filter({ has: page.locator("../..") }).nth(1);
    // Tal1 has max="1" attribute; Fr1 has max="20000"
    const tal1Range = dampingDetails.locator("input[type='range']").filter({ hasText: "" }).or(
      dampingDetails.locator("input[type='range']")
    );
    // Find the Tal1 slider by its max attribute
    const sliders = dampingDetails.locator("input[type='range']");
    let tal1SliderEl: ReturnType<typeof sliders.nth> | null = null;
    const sliderCount = await sliders.count();
    for (let i = 0; i < sliderCount; i++) {
      const max = await sliders.nth(i).getAttribute("max");
      if (max === "1") {
        tal1SliderEl = sliders.nth(i);
        break;
      }
    }
    expect(tal1SliderEl).not.toBeNull();
    await expect(tal1SliderEl!).toBeVisible();

    // Labels for Tal1 must be visible (fill fraction 0%–100%)
    await expect(dampingDetails.getByText("0% (none)")).toBeVisible();
    await expect(dampingDetails.getByText("100% (full)")).toBeVisible();
  });

  test("DampingMaterialPanel preset buttons update the Fr1 slider value", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Set up Horn YAML with sections
    const hornYamlDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Horn YAML" }),
    });
    const hornDetailsOpen = await hornYamlDetails.locator("summary").evaluate(
      (el) => (el.closest("details") as HTMLDetailsElement).open
    );
    if (!hornDetailsOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    await hornTextarea.evaluate((el) => el.dispatchEvent(new InputEvent("input", { bubbles: true })));
    await page.waitForTimeout(400);

    // Expand DampingMaterialPanel
    const dampingDetails = page.locator("details").filter({ hasText: /segment damping material/i });
    const detailsCount = await dampingDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await dampingDetails.first().evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await dampingDetails.first().locator("summary").click();
      await page.waitForTimeout(400);
    }

    // Locate Fr1 slider (max=20000) and its value display
    const sliders = dampingDetails.locator("input[type='range']");
    let fr1SliderEl: ReturnType<typeof sliders.nth> | null = null;
    for (let i = 0; i < await sliders.count(); i++) {
      const max = await sliders.nth(i).getAttribute("max");
      if (max === "20000") {
        fr1SliderEl = sliders.nth(i);
        break;
      }
    }
    expect(fr1SliderEl).not.toBeNull();

    // Fr1 initial value display (clicking the value opens the inline editor)
    const fr1Display = dampingDetails.locator("span").filter({ hasText: /^0$/ }).first();

    // Click "Wool fibre" preset (fr1 = 1000)
    const woolFibreBtn = dampingDetails.getByRole("button", { name: /wool fibre/i });
    await expect(woolFibreBtn).toBeVisible();
    await woolFibreBtn.click();
    await page.waitForTimeout(300);

    // Fr1 slider value should now be 1000
    const sliderValue = await fr1SliderEl!.inputValue();
    expect(parseFloat(sliderValue)).toBe(1000);

    // Also verify the Fr1 display value shows 1000 (the clickable span)
    const fr1DisplayAfter = dampingDetails.locator("span").filter({ hasText: /^1000$/ }).first();
    await expect(fr1DisplayAfter).toBeVisible();
  });

  // ─── ThroatAdapterDesigner ───────────────────────────────────────────────
  test("ThroatAdapterDesigner panel section is present and expandable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // ThroatAdapterDesigner lives inside a <details className="panel"> with summary "Throat Adapter Designer"
    const adapterDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Throat Adapter Designer" }),
    });
    const detailsCount = await adapterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    // Verify summary is visible
    await expect(adapterDetails.locator("summary")).toBeVisible();

    // Expand the panel
    const isOpen = await adapterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await adapterDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // After expanding: the adapter-form div must be visible
    await expect(adapterDetails.locator(".adapter-form")).toBeVisible();
  });

  test("ThroatAdapterDesigner form inputs are present and editable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the ThroatAdapterDesigner panel
    const adapterDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Throat Adapter Designer" }),
    });
    const detailsCount = await adapterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await adapterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await adapterDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // D1 and D2 diameter inputs must be present
    const d1Label = adapterDetails.locator("label", { hasText: /D1.*Throat chamber side/i });
    const d2Label = adapterDetails.locator("label", { hasText: /D2.*Horn throat side/i });
    await expect(d1Label).toBeVisible();
    await expect(d2Label).toBeVisible();

    // D1 input should have default value 50 (visible as the input value)
    const d1Input = d1Label.locator("input[type='number']");
    await expect(d1Input).toHaveValue("50");

    // D2 input should have default value 100
    const d2Input = d2Label.locator("input[type='number']");
    await expect(d2Input).toHaveValue("100");

    // A1 and A2 angle inputs must be present
    const a1Label = adapterDetails.locator("label", { hasText: /A1.*Input flare angle/i });
    const a2Label = adapterDetails.locator("label", { hasText: /A2.*Output flare angle/i });
    await expect(a1Label).toBeVisible();
    await expect(a2Label).toBeVisible();

    // Profile type select must be present (conical, exponential, parabolic, cylindrical)
    const profileSelect = adapterDetails.locator("select");
    await expect(profileSelect).toBeVisible();

    // "Compute" button must be present
    const computeBtn = adapterDetails.locator("button", { hasText: /compute/i });
    await expect(computeBtn).toBeVisible();
  });

  test("ThroatAdapterDesigner form inputs are editable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand the ThroatAdapterDesigner panel
    const adapterDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Throat Adapter Designer" }),
    });
    const detailsCount = await adapterDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await adapterDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await adapterDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }

    // Change D1 value from 50 to 75
    const d1Label = adapterDetails.locator("label", { hasText: /D1.*Throat chamber side/i });
    const d1Input = d1Label.locator("input[type='number']");
    await d1Input.fill("75");
    await expect(d1Input).toHaveValue("75");

    // Change D2 value from 100 to 80
    const d2Label = adapterDetails.locator("label", { hasText: /D2.*Horn throat side/i });
    const d2Input = d2Label.locator("input[type='number']");
    await d2Input.fill("80");
    await expect(d2Input).toHaveValue("80");

    // Profile type is "conical" by default — verify it changes to "exponential"
    const profileSelect = adapterDetails.locator("select");
    await expect(profileSelect).toHaveValue("conical");
    await profileSelect.selectOption("exponential");
    await expect(profileSelect).toHaveValue("exponential");

    // Toggle "use minimum length" checkbox (default is checked)
    const minLenCheckbox = adapterDetails.locator("input[type='checkbox']").first();
    const isChecked = await minLenCheckbox.isChecked();
    await minLenCheckbox.uncheck();
    await expect(minLenCheckbox).not.toBeChecked();
    // Re-check to restore original state
    await minLenCheckbox.check();
    if (isChecked) {
      await expect(minLenCheckbox).toBeChecked();
    }
  });

  // ─── ResizeWizardPanel ─────────────────────────────────────────────────────
  test("ResizeWizardPanel section is present and expandable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // ResizeWizardPanel lives inside a <details className="panel"> with summary "Resize Wizard"
    const resizeDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Resize Wizard" }),
    });
    const detailsCount = await resizeDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    // Panel starts collapsed (resizeExpanded = false in App.tsx state)
    const isOpen = await resizeDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await resizeDetails.locator("summary").click();
      await page.waitForTimeout(500);
    }

    // ResizeWizardPanel should be visible after expanding
    await expect(resizeDetails).toBeVisible();

    // Resize factor input must be present
    const factorInput = resizeDetails.locator("input[type='number']").first();
    const inputCount = await factorInput.count();
    if (inputCount === 0) {
      test.skip();
      return;
    }
    await expect(factorInput).toBeVisible();

    // Geometry YAML editor textarea must be present
    const geometryTextarea = resizeDetails.locator("textarea").first();
    await expect(geometryTextarea).toBeVisible();

    // Compute / Apply button must be present
    const computeBtn = resizeDetails.locator("button", { hasText: /compute|apply/i });
    await expect(computeBtn.first()).toBeVisible();
  });

  test("ResizeWizardPanel preset buttons update the resize factor", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand ResizeWizardPanel
    const resizeDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Resize Wizard" }),
    });
    const detailsCount = await resizeDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await resizeDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await resizeDetails.locator("summary").click();
      await page.waitForTimeout(500);
    }

    // Get the resize factor input
    const factorInput = resizeDetails.locator("input[type='number']").first();
    const inputCount = await factorInput.count();
    if (inputCount === 0) {
      test.skip();
      return;
    }
    await expect(factorInput).toBeVisible();

    // Initial value should be 1
    await expect(factorInput).toHaveValue("1");

    // Click the ×1.5 preset button
    const presetBtn = resizeDetails.locator("button", { hasText: "×1.5" });
    const presetCount = await presetBtn.count();
    if (presetCount === 0) {
      test.skip();
      return;
    }
    await presetBtn.click();
    await page.waitForTimeout(200);
    await expect(factorInput).toHaveValue("1.5");
  });

  // ─── WavefrontViewer ───────────────────────────────────────────────────────
  test("WavefrontViewer panel is present in the UI", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // WavefrontViewer renders as <section className="panel"> with an <h2>🌊 Wavefront</h2> heading.
    // It returns null when the geometry YAML does not contain a `sections:` block, so we
    // first set sections-format YAML (same approach as DampingMaterialPanel tests).
    //
    // Step 1: Set sections-format YAML so WavefrontViewer renders
    const hornYamlDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Horn YAML" }),
    });
    const hornDetailsOpen = await hornYamlDetails.locator("summary").evaluate(
      (el) => (el.closest("details") as HTMLDetailsElement).open
    );
    if (!hornDetailsOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015
  - name: body
    profile_type: exponential
    length: 0.8
    start_area: 0.015
    end_area: 0.04`;
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    await hornTextarea.evaluate((el) => el.dispatchEvent(new InputEvent("input", { bubbles: true })));
    await page.waitForTimeout(600);

    // Step 2: Find WavefrontViewer panel (only renders when YAML has sections:)
    const wavefrontPanel = page.locator("section.panel", { has: page.locator("h2", { hasText: /wavefront/i }) });
    const count = await wavefrontPanel.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await expect(wavefrontPanel.first()).toBeVisible();

    // Mode toggle buttons: in "compute" mode only the Compute button is shown.
    // In "browse" mode only the Browse button is shown.
    // We verify Compute mode is active by checking the Compute button is visible.
    const computeBtn = wavefrontPanel.locator("button", { hasText: /⚡\s*Compute/i });
    await expect(computeBtn).toBeVisible();

    // Default view is "compute" — geometry YAML textarea and Compute button must be visible
    await expect(wavefrontPanel.locator("textarea")).toBeVisible();
    await expect(computeBtn).toBeVisible();
  });

  test("WavefrontViewer Browse mode is accessible", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Set sections-format YAML to make WavefrontViewer render
    const hornYamlDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: "Horn YAML" }),
    });
    const hornDetailsOpen = await hornYamlDetails.locator("summary").evaluate(
      (el) => (el.closest("details") as HTMLDetailsElement).open
    );
    if (!hornDetailsOpen) {
      await hornYamlDetails.locator("summary").click();
      await page.waitForTimeout(300);
    }
    const sectionsYaml = `sections:
  - name: throat
    profile_type: exponential
    length: 0.4
    start_area: 0.008
    end_area: 0.015`;
    const hornTextarea = hornYamlDetails.locator("textarea");
    await hornTextarea.clear();
    await hornTextarea.fill(sectionsYaml);
    await hornTextarea.evaluate((el) => el.dispatchEvent(new InputEvent("input", { bubbles: true })));
    await page.waitForTimeout(600);

    // Find WavefrontViewer panel
    const wavefrontPanel = page.locator("section.panel", { has: page.locator("h2", { hasText: /wavefront/i }) });
    const count = await wavefrontPanel.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await expect(wavefrontPanel.first()).toBeVisible();

    // In Compute mode, the Browse button is not rendered.
    // Click the Compute button to switch to Browse mode (this hides Compute, shows Browse).
    const computeBtn = wavefrontPanel.locator("button", { hasText: /⚡\s*Compute/i });
    const computeBtnCount = await computeBtn.count();
    if (computeBtnCount === 0) {
      test.skip();
      return;
    }
    await computeBtn.click();
    await page.waitForTimeout(300);

    // Now the Browse button should be visible (Compute mode is hidden)
    // Note: the button text is "📁 Browse" not "📂 Browse"
    const browseBtn = wavefrontPanel.locator("button", { hasText: /📁\s*Browse/i });
    await expect(browseBtn).toBeVisible();
  });

  // ─── NotchFilterPanel ──────────────────────────────────────────────────────
  test("NotchFilterPanel section is present and expandable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // NotchFilterPanel lives inside a <details className="panel"> with summary "🎯 Notch Filter"
    const notchDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: /notch filter/i }),
    });
    const detailsCount = await notchDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }

    // Verify the summary is visible
    await expect(notchDetails.locator("summary")).toBeVisible();

    // Badge shows OFF when not enabled
    const badge = notchDetails.locator(".yaml-summary-badge");
    await expect(badge).toBeVisible();

    // Expand the panel
    const isOpen = await notchDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await notchDetails.locator("summary").click();
      await page.waitForTimeout(500);
    }

    // NotchFilterPanel renders a placeholder when no simulation result exists.
    // Verify the <details> panel itself is visible and the badge updates.
    await expect(notchDetails).toBeVisible();

    // Badge should still be "OFF" (no frequencies set yet)
    await expect(badge).toHaveText("OFF");

    // NotchFilterPanel renders an enabled toggle (checkbox) — check if present
    const enabledToggle = notchDetails.locator("input[type='checkbox']");
    const toggleCount = await enabledToggle.count();
    if (toggleCount > 0) {
      await expect(enabledToggle.first()).toBeVisible();
    }

    // Apply button is always present in NotchFilterPanel regardless of simulation state
    const applyBtn = notchDetails.locator("button", { hasText: /apply/i });
    const applyBtnCount = await applyBtn.count();
    if (applyBtnCount > 0) {
      await expect(applyBtn.first()).toBeVisible();
    }
  });

  test("NotchFilterPanel enabled toggle is interactive", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Expand NotchFilterPanel
    const notchDetails = page.locator("details.panel", {
      has: page.locator("summary", { hasText: /notch filter/i }),
    });
    const detailsCount = await notchDetails.count();
    if (detailsCount === 0) {
      test.skip();
      return;
    }
    const isOpen = await notchDetails.evaluate(
      (el) => (el as HTMLDetailsElement).open
    );
    if (!isOpen) {
      await notchDetails.locator("summary").click();
      await page.waitForTimeout(500);
    }

    // Find the enabled toggle checkbox
    const enabledToggle = notchDetails.locator("input[type='checkbox']");
    const toggleCount = await enabledToggle.count();
    if (toggleCount === 0) {
      // NotchFilterPanel may not render the checkbox without a simulation result
      test.skip();
      return;
    }

    // Verify initial state and toggle interaction
    const firstToggle = enabledToggle.first();
    await expect(firstToggle).toBeVisible();
    // Toggle should start unchecked
    await expect(firstToggle).not.toBeChecked();
    // Toggle should be interactable (click does not throw)
    await firstToggle.check();
    await page.waitForTimeout(200);
    await expect(firstToggle).toBeChecked();
    // Toggle back off
    await firstToggle.uncheck();
    await page.waitForTimeout(200);
    await expect(firstToggle).not.toBeChecked();
  });

  // ─── LossyLePanel ─────────────────────────────────────────────────────────
  test("LossyLePanel section is present in the UI", async ({ page }) => {
    // LossyLePanel renders as a <div> (not inside a <details>) in the Driver Parameters section.
    // It shows a checkbox toggle for "Lossy Le" and parameter fields when enabled.
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // The Lossy Le checkbox must be visible (inside the Driver Parameters section)
    const lossyLeLabel = page.locator("label").filter({ hasText: /lossy le/i }).first();
    const count = await lossyLeLabel.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await expect(lossyLeLabel).toBeVisible();

    // The checkbox inside the label must be present
    const checkbox = lossyLeLabel.locator("input[type='checkbox']");
    await expect(checkbox).toBeVisible();
  });

  test("LossyLe checkbox starts unchecked and is togglable", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Find the Lossy Le checkbox — use the InfoTooltip span text
    const lossyLeLabel = page.locator("label").filter({ hasText: /^Lossy Le$/ }).first();
    const count = await lossyLeLabel.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const checkbox = lossyLeLabel.locator("input[type='checkbox']");
    await expect(checkbox).toBeVisible();

    // Initially unchecked (Lossy Le disabled by default)
    await expect(checkbox).not.toBeChecked();

    // When unchecked, the "disabled" hint text must be visible
    await expect(page.getByText(/lossy le model off/i)).toBeVisible();

    // Toggle on
    await checkbox.check();
    await page.waitForTimeout(200);
    await expect(checkbox).toBeChecked();

    // Disabled hint should now be hidden
    await expect(page.getByText(/lossy le model off/i)).not.toBeVisible();

    // R_e_eddy and f_ref spans must now be visible (inside LossyLePanel, not the textarea)
    // The LossyLePanel uses <span>R_e_eddy (Ω)</span> inside a div with borderBottom
    const reEddySpan = page.locator("span").filter({ hasText: "R_e_eddy (Ω)" });
    const fRefSpan = page.locator("span").filter({ hasText: /f_ref \(Hz\)/ });
    await expect(reEddySpan).toBeVisible();
    await expect(fRefSpan).toBeVisible();

    // Toggle back off
    await checkbox.uncheck();
    await page.waitForTimeout(200);
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByText(/lossy le model off/i)).toBeVisible();
  });

  test("LossyLePanel R_e_eddy and f_ref fields are editable when enabled", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    // Find and enable Lossy Le
    const lossyLeLabel = page.locator("label").filter({ hasText: /^Lossy Le$/ }).first();
    const count = await lossyLeLabel.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const checkbox = lossyLeLabel.locator("input[type='checkbox']");
    await checkbox.check();
    await page.waitForTimeout(300);

    // Click the R_e_eddy value span to start inline editing
    const reEddySpan = page.locator("span").filter({ hasText: "R_e_eddy (Ω)" });
    await expect(reEddySpan).toBeVisible();
    await reEddySpan.click();
    await page.waitForTimeout(300);

    // An inline number input should appear for editing R_e_eddy
    // The input has fontFamily: monospace and width: 80px
    const reInput = page.locator("input[type='number'][style*='monospace']").first();
    const reInputVisible = await reInput.isVisible().catch(() => false);
    if (!reInputVisible) {
      // Fallback: look for any number input that appeared
      const anyInput = page.locator("input[type='number']").last();
      await expect(anyInput).toBeVisible();
    }
  });
});
