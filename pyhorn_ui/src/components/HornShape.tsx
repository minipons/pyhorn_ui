import { useEffect, useRef, useCallback, useState } from "react";

interface HornShapeProps {
  hornYaml: string;
  driverYaml: string;
  resultAvailable: boolean;
  showCrossSections?: boolean; // default false; when true, draw markers every 10cm
}

interface HornSection {
  name: string;
  profile_type: string;
  length: number;
  start_area: number;
  end_area: number;
  hyperbolic_t?: number;
}

interface ParsedHorn {
  throat_area: number;
  mouth_area: number;
  path_length: number;
  profile_type: string;
  n_segments: number;
  vtc: number;
  atc: number;
  vrc: number;
  lrc: number;
  ang: number;
  hyperbolic_t: number;
  sections: HornSection[] | null;
}

function parseYamlFloat(text: string, key: string): number | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;
    // Top-level key: no leading non-whitespace chars before "key:"
    let m = clean.match(new RegExp(`^${key}:\\s*([0-9eE.+\\-]+)`));
    if (m) {
      const val = parseFloat(m[1]);
      // Migration: old ChamberWizard saves stored vrc in LITERS and lrc in CM.
      // New format stores SI units (m³ and m). Detect old format by threshold.
      if (key === "vrc" && val > 1) return val * 1e-3; // liters → m³
      if (key === "lrc" && val > 1) return val * 1e-2; // cm → m
      return val;
    }
    // Nested key: leading whitespace then "key: value"
    m = clean.match(new RegExp(`^\\s+${key}:\\s*([0-9eE.+\\-]+)`));
    if (m) {
      const val = parseFloat(m[1]);
      if (key === "vrc" && val > 1) return val * 1e-3;
      if (key === "lrc" && val > 1) return val * 1e-2;
      return val;
    }
  }
  return null;
}

function parseYamlStr(text: string, key: string): string | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const idx = line.indexOf("#");
    const clean = idx >= 0 ? line.slice(0, idx) : line;
    const m = clean.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?`));
    if (m) return m[1].trim();
  }
  return null;
}

function parseSections(text: string): HornSection[] | null {
  const sections: HornSection[] = [];
  const lines = text.split("\n");
  let inSections = false;
  let current: Partial<HornSection> = {};

  for (const rawLine of lines) {
    const idx = rawLine.indexOf("#");
    const line = idx >= 0 ? rawLine.slice(0, idx) : rawLine;
    const trimmed = line.trim();

    if (/^sections\s*:/.test(trimmed)) {
      inSections = true;
      continue;
    }

    if (inSections) {
      // End of sections block: a top-level key (no leading whitespace in raw line,
      // not a section entry "- name:", and not the "sections:" keyword itself)
      if (
        !line.startsWith(" ") &&
        !line.startsWith("\t") &&
        trimmed.length > 0 &&
        !trimmed.startsWith("-") &&
        !trimmed.startsWith("sections")
      ) {
        if (current.name && current.length != null && current.start_area != null && current.end_area != null) {
          sections.push(current as HornSection);
        }
        inSections = false;
        current = {};
      }

      // New section entry
      if (trimmed.startsWith("- name:")) {
        if (current.name && current.length != null && current.start_area != null && current.end_area != null) {
          sections.push(current as HornSection);
        }
        current = {};
        const m = trimmed.match(/- name:\s*"?([^"\n]+)"?/);
        if (m) current.name = m[1].trim();
        continue;
      }

      // Section fields
      if (current.name !== undefined) {
        const num = (l: string, k: string) => {
          const m = l.match(new RegExp(`^\\s*${k}:\\s*([0-9eE.+\\-]+)`));
          return m ? parseFloat(m[1]) : undefined;
        };
        const str = (l: string, k: string) => {
          const m = l.match(new RegExp(`^\\s*${k}:\\s*"?([^"\n]+)"?`));
          return m ? m[1].trim() : undefined;
        };

        if (/^\s*profile_type:/.test(line)) current.profile_type = str(line, "profile_type");
        else if (/^\s*length:/.test(line)) current.length = num(line, "length");
        else if (/^\s*start_area:/.test(line)) current.start_area = num(line, "start_area");
        else if (/^\s*end_area:/.test(line)) current.end_area = num(line, "end_area");
        else if (/^\s*hyperbolic_t:/.test(line)) current.hyperbolic_t = num(line, "hyperbolic_t");
      }
    }
  }

  // Flush last section
  if (inSections && current.name && current.length != null && current.start_area != null && current.end_area != null) {
    sections.push(current as HornSection);
  }

  return sections.length > 0 ? sections : null;
}

function parseHorn(text: string): ParsedHorn | null {
  const throat_area = parseYamlFloat(text, "throat_area");
  const mouth_area = parseYamlFloat(text, "mouth_area");
  const path_length = parseYamlFloat(text, "path_length");
  const profile_type = parseYamlStr(text, "profile_type");
  const n_segments = parseYamlFloat(text, "n_segments");
  const vtc = parseYamlFloat(text, "vtc") ?? 0;
  const atc = parseYamlFloat(text, "atc") ?? 0;
  const vrc = parseYamlFloat(text, "vrc") ?? 0;
  const lrc = parseYamlFloat(text, "lrc") ?? 0;
  const ang = parseYamlFloat(text, "ang") ?? 6.2831853;
  const hyperbolic_t = parseYamlFloat(text, "hyperbolic_t") ?? 0.5;

  // Try sections format (chained profile sections)
  const sections = parseSections(text);

  if (sections && sections.length > 0) {
    const computed_throat_area = sections[0].start_area;
    const computed_mouth_area = sections[sections.length - 1].end_area;
    const computed_path_length = sections.reduce((sum, s) => sum + s.length, 0);
    return {
      throat_area: computed_throat_area,
      mouth_area: computed_mouth_area,
      path_length: computed_path_length,
      profile_type: sections[0].profile_type ?? "exponential",
      n_segments: 50,
      vtc,
      atc,
      vrc,
      lrc,
      ang,
      hyperbolic_t,
      sections,
    };
  }

  if (
    throat_area == null ||
    mouth_area == null ||
    path_length == null ||
    throat_area <= 0 ||
    mouth_area <= 0 ||
    path_length <= 0
  ) {
    return null;
  }

  return {
    throat_area,
    mouth_area,
    path_length,
    profile_type: profile_type ?? "exponential",
    n_segments: Math.max(2, Math.round(n_segments ?? 50)),
    vtc,
    atc,
    vrc,
    lrc,
    ang,
    hyperbolic_t,
    sections: null,
  };
}

function parseDriverSd(text: string): number | null {
  const sd = parseYamlFloat(text, "sd");
  return sd && sd > 0 ? sd : null;
}

type ProfileFn = (x: number, rt: number, rm: number, L: number, hyperbolic_t?: number) => number;

const profileFns: Record<string, ProfileFn> = {
  straight: (_x, rt) => rt,
  conical: (_x, rt) => rt,
  exponential: (x, rt, rm, L) => {
    const m = Math.log(rm / rt) / L;
    return rt * Math.exp(m * x);
  },
  hyperbolic: (x, rt, rm, L, hyperbolic_t = 0.5) => {
    // Mitchelhill parameterisation: r(x) = rt * (cosh(mx) + T*sinh(mx))
    // where m is set so r(L) = rm ONLY when T=0.
    // For T>0 the formula naturally overshoots rm — this is the Mitchelhill convention.
    const ratio = (rm * rm) / (rt * rt); // area ratio = (rm/rt)²
    const m = Math.acosh(Math.sqrt(ratio)) / L;
    return rt * (Math.cosh(m * x) + hyperbolic_t * Math.sinh(m * x));
  },
  parabolic: (x, rt, rm, L) => {
    const ratio = rm * rm - rt * rt;
    return Math.sqrt(rt * rt + (ratio * x) / L);
  },
};

function discretise(
  horn: ParsedHorn
): { x: number; r: number }[] {
  const { sections } = horn;

  if (sections && sections.length > 0) {
    // Chained sections format: discretise each section sequentially
    const pts: { x: number; r: number }[] = [];
    let cumX = 0;
    const SEG_PER_SECTION = 20;

    for (const sec of sections) {
      const rt2 = Math.sqrt(sec.start_area / Math.PI);
      const rm2 = Math.sqrt(sec.end_area / Math.PI);
      const L2 = sec.length;
      const fn = profileFns[sec.profile_type] ?? profileFns.exponential;

      for (let i = 0; i <= SEG_PER_SECTION; i++) {
        const x_rel = (i / SEG_PER_SECTION) * L2;
        const r = fn(x_rel, rt2, rm2, L2, sec.hyperbolic_t);
        pts.push({ x: cumX + x_rel, r });
      }
      cumX += L2;
    }
    return pts;
  }

  // Legacy single-profile format
  const { throat_area, mouth_area, path_length, profile_type, n_segments, hyperbolic_t: hornT } = horn;
  const rt = Math.sqrt(throat_area / Math.PI);
  const rm = Math.sqrt(mouth_area / Math.PI);
  const fn = profileFns[profile_type] ?? profileFns.exponential;

  const pts: { x: number; r: number }[] = [];
  for (let i = 0; i <= n_segments; i++) {
    const x = (i / n_segments) * path_length;
    const r = fn(x, rt, rm, path_length, hornT);
    pts.push({ x, r });
  }
  return pts;
}

export default function HornShape({
  hornYaml,
  driverYaml,
  resultAvailable,
  showCrossSections = false,
}: HornShapeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; distCm: number; areaCm2: number; horn: ParsedHorn | null } | null>(null);

  // Compute area at a given canvas X position
  function areaAtCanvasX(canvasX: number, horn: ParsedHorn | null, pts: { x: number; r: number }[], drawW: number, L: number): { distCm: number; areaCm2: number; horn: ParsedHorn | null } | null {
    if (!horn || pts.length === 0 || L <= 0) return null;
    const x_m = ((canvasX - 20) / drawW) * L; // marginX = 20
    if (x_m < 0 || x_m > L) return null;
    const distCm = Math.round(x_m * 100);
    // Find nearest pts
    let r = pts[0].r;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].x <= x_m && x_m <= pts[i + 1].x) {
        const t = (x_m - pts[i].x) / (pts[i + 1].x - pts[i].x);
        r = pts[i].r + t * (pts[i + 1].r - pts[i].r);
        break;
      }
    }
    const areaCm2 = Math.PI * r * r * 1e4;
    return { distCm, areaCm2, horn };
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const horn = parseHorn(hornYaml);
    const sd = parseDriverSd(driverYaml);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    // Background
    ctx.clearRect(0, 0, W, H);

    if (!resultAvailable) {
      ctx.fillStyle = "#8b949e";
      ctx.font = `13px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Run a simulation to see the horn shape", W / 2, H / 2);
      return;
    }

    if (!horn) {
      ctx.fillStyle = "#8b949e";
      ctx.font = `13px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Configure horn to see shape", W / 2, H / 2);
      return;
    }

    // Margins
    const marginX = 20;
    const marginY = 20;
    const labelH = 28;

    // --- Compute geometry ---
    const rt = Math.sqrt(horn.throat_area / Math.PI);
    const rm = Math.sqrt(horn.mouth_area / Math.PI);
    const L = horn.path_length;

    // --- Scale to fit canvas ---
    // Draw horn horizontally: x from marginX to W - marginX
    // y centered: throat at left-center, mouth at right-center
    const drawW = W - 2 * marginX;
    const drawH = H - 2 * marginY - labelH;

    // mouth_radius is typically much larger, scale to fit
    const maxR = Math.max(rt, rm) * 1.2;
    const yScale = (drawH / 2) * 0.85 / maxR;

    const toX = (x: number) => marginX + (x / L) * drawW;
    const toY = (r: number) => H / 2 - r * yScale;
    const toYb = (r: number) => H / 2 + r * yScale;

    // --- Discretise profile ---
    const pts = discretise(horn);

    // --- Draw rear chamber (RC) if vrc > 0 ---
    // NOTE: YAML stores vrc in LITERS (not m³) and lrc in CM (not m).
    // rcArea_m2 = (vrc_liters * 1e-3) / (lrc_cm * 1e-2) = vrc_liters / lrc_cm * 1e-5
    if (horn.vrc > 0 && horn.lrc > 0) {
      const rcArea_m2 = (horn.vrc * 1e-3) / (horn.lrc * 1e-2); // m²
      const rcRadius = Math.sqrt(rcArea_m2 / Math.PI); // m
      const rcHalfH = Math.max(rcRadius * yScale, 20); // minimum 20px display height
      const rcWidth = Math.min(horn.lrc * 1e-2 * drawW / L * 1.5, marginX - 4); // lrc in cm → m
      const rcX = marginX - rcWidth - 2;
      const rcTop = H / 2 - rcHalfH;
      const rcBot = H / 2 + rcHalfH;
      const throatR = rt * yScale; // visual throat radius
      const throatX = toX(0);

      ctx.fillStyle = "#1a2030";
      ctx.strokeStyle = "#3d4f6a";
      ctx.lineWidth = 1.5;
      // Main RC body
      ctx.beginPath();
      ctx.rect(rcX, rcTop, rcWidth, rcBot - rcTop);
      ctx.fill();
      ctx.stroke();
      // Tapered neck: connect RC right side to horn throat
      ctx.beginPath();
      ctx.moveTo(rcX + rcWidth, rcTop); // RC top-right
      ctx.lineTo(throatX, H / 2 - throatR); // throat top
      ctx.moveTo(rcX + rcWidth, rcBot); // RC bottom-right
      ctx.lineTo(throatX, H / 2 + throatR); // throat bottom
      ctx.moveTo(rcX + rcWidth, rcTop);
      ctx.lineTo(rcX + rcWidth + 4, rcTop);
      ctx.moveTo(rcX + rcWidth, rcBot);
      ctx.lineTo(rcX + rcWidth + 4, rcBot);
      ctx.stroke();
      // Top/bottom closing lines
      ctx.beginPath();
      ctx.moveTo(rcX + rcWidth, rcTop);
      ctx.lineTo(rcX + rcWidth + 4, rcTop);
      ctx.moveTo(rcX + rcWidth, rcBot);
      ctx.lineTo(rcX + rcWidth + 4, rcBot);
      ctx.stroke();
      ctx.fillStyle = "#6b7d9e";
      ctx.font = "bold 11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("RC", rcX + rcWidth / 2, rcTop - 5);
      // Volume label inside RC (show liters, not cc, since that's the display unit)
      ctx.fillStyle = "#4a5a7a";
      ctx.font = "9px -apple-system, sans-serif";
      ctx.fillText(`${horn.vrc.toFixed(1)}L`, rcX + rcWidth / 2, H / 2 + 4);
    }

    // --- Draw throat chamber (TC) if vtc > 0 ---
    if (horn.vtc > 0 && horn.atc > 0) {
      const tcR = Math.sqrt(horn.atc / Math.PI); // m
      const tcHalfH = Math.max(tcR * yScale, 16); // minimum 16px
      const tcTop = H / 2 - tcHalfH;
      const tcBot = H / 2 + tcHalfH;
      const tcW = 14;
      // TC ends exactly at throat (right edge touches throat line at marginX)
      const tcX = marginX - tcW;
      ctx.fillStyle = "#1a2030";
      ctx.strokeStyle = "#3d4f6a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(tcX, tcTop, tcW, tcBot - tcTop);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#6b7d9e";
      ctx.font = "bold 10px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("TC", tcX + tcW / 2, tcTop - 4);
    }

    // --- Draw driver ---
    const dR = sd ? Math.sqrt(sd / Math.PI) : rt;
    const dSize = Math.max(6, Math.min(dR * yScale * 1.5, 22));
    const dX = marginX - dSize - 4;
    const dYc = H / 2;
    ctx.beginPath();
    ctx.arc(dX + dSize / 2, dYc, dSize / 2, 0, Math.PI * 2);
    const driverGrad = ctx.createRadialGradient(
      dX + dSize / 2 - 2,
      dYc - 2,
      1,
      dX + dSize / 2,
      dYc,
      dSize / 2
    );
    driverGrad.addColorStop(0, "#4a9eff");
    driverGrad.addColorStop(1, "#1a5fb4");
    ctx.fillStyle = driverGrad;
    ctx.fill();
    ctx.strokeStyle = "#4a9eff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e6edf3";
    ctx.font = "9px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Driver", dX + dSize / 2, dYc + dSize / 2 + 11);

    // --- Draw horn shape ---
    // Top curve (filled)
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(pts[0].r));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(toX(pts[i].x), toY(pts[i].r));
    }
    // Close along bottom (straight line at y=0 for radius, no - actually along bottom of horn profile)
    for (let i = pts.length - 1; i >= 0; i--) {
      ctx.lineTo(toX(pts[i].x), toYb(pts[i].r));
    }
    ctx.closePath();

    // Gradient fill from accent
    const hornGrad = ctx.createLinearGradient(marginX, 0, marginX + drawW, 0);
    hornGrad.addColorStop(0, "#00d4ff");
    hornGrad.addColorStop(0.5, "#0099cc");
    hornGrad.addColorStop(1, "#006688");
    ctx.fillStyle = hornGrad;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke top and bottom
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(pts[0].r));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(toX(pts[i].x), toY(pts[i].r));
    }
    ctx.strokeStyle = "#00d4ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX(0), toYb(pts[0].r));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(toX(pts[i].x), toYb(pts[i].r));
    }
    ctx.strokeStyle = "#00d4ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- Throat line (vertical) ---
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(pts[0].r));
    ctx.lineTo(toX(0), toYb(pts[0].r));
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Mouth line (vertical) ---
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(toX(last.x), toY(last.r));
    ctx.lineTo(toX(last.x), toYb(last.r));
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Cross-section markers every 10cm (when enabled) ---
    if (showCrossSections) {
      const STEP_CM = 10;
      const L_cm = L * 100;

      // Build a lookup: x_m → r for fast interpolation
      // Use the pts array (already discretised)
      function radiusAt(x: number): number {
        if (pts.length === 0) return rt;
        if (x <= pts[0].x) return pts[0].r;
        if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].r;
        // Linear interp between surrounding pts
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i].x <= x && x <= pts[i + 1].x) {
            const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
            return pts[i].r + t * (pts[i + 1].r - pts[i].r);
          }
        }
        return pts[pts.length - 1].r;
      }

      ctx.save();
      ctx.setLineDash([3, 3]);

      for (let distCm = STEP_CM; distCm < L_cm; distCm += STEP_CM) {
        const x_m = distCm / 100;
        const r = radiusAt(x_m);
        const cx = toX(x_m);
        const topY = toY(r);
        const botY = toYb(r);

        // Vertical dashed line
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(cx, botY);
        ctx.strokeStyle = "#f0c040";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Distance label (above horn)
        const areaCm2 = Math.PI * r * r * 1e4; // r in m → cm²
        ctx.fillStyle = "#f0c040";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${distCm}cm`, cx, topY - 3);
        // Area label (below horn)
        ctx.fillText(`${areaCm2.toFixed(1)}cm²`, cx, botY + 10);
      }

      ctx.restore();
    }

    // --- Scale bar (in cm) ---
    const scaleBarY = H - marginY - 4;
    const scaleBarX0 = Math.max(10, W - marginX - 120);

    // Choose a round-cm mark that fits nicely
    const pixelsPerCm = drawW / (L * 100);
    const roundCmMarks = [10, 20, 25, 50, 100, 200].filter((m) => m <= L * 100 * 0.9);
    const scaleCm = roundCmMarks.length > 0 ? roundCmMarks[roundCmMarks.length - 1] : L * 50;
    const scalePx = Math.max(30, scaleCm * pixelsPerCm); // minimum 30px so "0" label isn't orphaned

    ctx.beginPath();
    ctx.moveTo(scaleBarX0, scaleBarY);
    ctx.lineTo(scaleBarX0 + scalePx, scaleBarY);
    ctx.strokeStyle = "#8b949e";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#8b949e";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("0", scaleBarX0, scaleBarY - 4);
    ctx.fillText(`${scaleCm} cm`, scaleBarX0 + scalePx, scaleBarY - 4);

    // Tick marks
    ctx.beginPath();
    ctx.moveTo(scaleBarX0, scaleBarY - 4);
    ctx.lineTo(scaleBarX0, scaleBarY + 4);
    ctx.moveTo(scaleBarX0 + scalePx, scaleBarY - 4);
    ctx.lineTo(scaleBarX0 + scalePx, scaleBarY + 4);
    ctx.stroke();

    // Labels: throat, mouth
    ctx.fillStyle = "#8b949e";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Throat", marginX, toY(pts[0].r) - 6);
    ctx.fillText("Mouth", toX(last.x), toY(last.r) - 6);
  }, [hornYaml, driverYaml, resultAvailable, showCrossSections]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(() => draw());
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener("resize", draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [draw]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "200px",
          background: "#0d1117",
          borderRadius: "6px",
          display: "block",
        }}
        onMouseMove={(e) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const horn = parseHorn(hornYaml);
          const pts = horn ? discretise(horn) : [];
          const drawW = rect.width - 40; // marginX=20 on each side
          const L = horn?.path_length ?? 1;
          const result = areaAtCanvasX(x, horn, pts, drawW, L);
          setTooltip(result ? { x, y, ...result } : null);
        }}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x + 12,
            top: tooltip.y - 30,
            background: "#1e1e1e",
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "4px 8px",
            fontSize: "11px",
            fontFamily: "monospace",
            color: "#e6edf3",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          {tooltip.distCm} cm → {tooltip.areaCm2.toFixed(2)} cm²
          {tooltip.horn && (
            <span style={{ color: "#8b949e", display: "block", fontSize: "9px", marginTop: "2px" }}>
              throat: {(tooltip.horn.throat_area * 1e4).toFixed(0)} cm² &nbsp;|&nbsp; mouth: {(tooltip.horn.mouth_area * 1e4).toFixed(0)} cm²
            </span>
          )}
        </div>
      )}
    </div>
  );
}
