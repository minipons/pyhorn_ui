import { describe, it, expect } from "vitest";
import { fmt, toDisplay, parse } from "../types/physical";

describe("physical unit conversions", () => {
  describe("vas", () => {
    // YAML stores m³, display/edit uses L
    it("fmt: m³ → L", () => {
      expect(fmt("vas", 0.0369)).toBe("36.9 L");
    });
    it("toDisplay: m³ → L", () => {
      expect(toDisplay("vas", 0.0369)).toBeCloseTo(36.9);
    });
    it("parse: L → m³", () => {
      expect(parse("vas", 36.9)).toBeCloseTo(0.0369);
    });
  });

  describe("sd (piston area)", () => {
    // YAML stores m², display uses cm²
    it("fmt: m² → cm²", () => {
      expect(fmt("sd", 0.01327)).toBe("132.70 cm²");
    });
    it("toDisplay: m² → cm²", () => {
      expect(toDisplay("sd", 0.01327)).toBeCloseTo(132.7);
    });
    it("parse: cm² → m²", () => {
      expect(parse("sd", 132.7)).toBeCloseTo(0.01327);
    });
  });

  describe("mms (moving mass)", () => {
    // YAML stores kg, display uses g
    it("fmt: kg → g", () => {
      expect(fmt("mms", 0.00699)).toBe("6.99 g");
    });
    it("toDisplay: kg → g", () => {
      expect(toDisplay("mms", 0.00699)).toBeCloseTo(6.99);
    });
    it("parse: g → kg", () => {
      expect(parse("mms", 6.99)).toBeCloseTo(0.00699);
    });
  });

  describe("le (inductance)", () => {
    // YAML stores H, display uses mH
    it("fmt: H → mH", () => {
      expect(fmt("le", 0.0008)).toBe("0.80 mH");
    });
    it("toDisplay: H → mH", () => {
      expect(toDisplay("le", 0.0008)).toBeCloseTo(0.8);
    });
    it("parse: mH → H", () => {
      expect(parse("le", 0.8)).toBeCloseTo(0.0008);
    });
  });

  describe("xmax (excursion)", () => {
    // YAML stores m, display uses mm
    it("fmt: m → mm", () => {
      expect(fmt("xmax", 0.001)).toBe("1.0 mm");
    });
    it("toDisplay: m → mm", () => {
      expect(toDisplay("xmax", 0.001)).toBeCloseTo(1.0);
    });
    it("parse: mm → m", () => {
      expect(parse("xmax", 1.0)).toBeCloseTo(0.001);
    });
  });

  describe("throat_area", () => {
    // YAML stores m², display uses cm²
    it("fmt: m² → cm²", () => {
      expect(fmt("throat_area", 0.008)).toBe("80.00 cm²");
    });
    it("fmt: mouth area 600 cm²", () => {
      expect(fmt("mouth_area", 0.06)).toBe("600 cm²");
    });
  });

  describe("path_length", () => {
    // YAML stores m, display uses cm
    it("fmt: m → cm", () => {
      expect(fmt("path_length", 1.5)).toBe("150.0 cm");
    });
    it("toDisplay: m → cm", () => {
      expect(toDisplay("path_length", 1.5)).toBeCloseTo(150.0);
    });
    it("parse: cm → m", () => {
      expect(parse("path_length", 150.0)).toBeCloseTo(1.5);
    });
  });

  describe("vrc (rear chamber volume)", () => {
    // YAML stores m³, display uses L
    it("fmt: ≥1L shows L", () => {
      expect(fmt("vrc", 0.0045)).toBe("4.50 L"); // 4500 cm³
    });
    it("fmt: small volume shows cm³", () => {
      expect(fmt("vrc", 0.0001)).toBe("100.0 cm³"); // 100 cm³
    });
  });

  describe("ang (radiation angle)", () => {
    // YAML stores radians, display uses n×π
    it("fmt: 2π = 2π", () => {
      expect(fmt("ang", 2 * Math.PI)).toBe("2π");
    });
    it("fmt: π/2 = 0.5π", () => {
      expect(fmt("ang", Math.PI / 2)).toBe("0.5π");
    });
    it("fmt: π = 1π", () => {
      expect(fmt("ang", Math.PI)).toBe("1π");
    });
    it("toDisplay: radians → n (e.g. 2π → 2)", () => {
      expect(toDisplay("ang", 2 * Math.PI)).toBeCloseTo(2.0);
      expect(toDisplay("ang", Math.PI / 2)).toBeCloseTo(0.5);
    });
    it("parse: n → radians (e.g. 2 → 2π)", () => {
      expect(parse("ang", 2.0)).toBeCloseTo(2 * Math.PI);
      expect(parse("ang", 0.5)).toBeCloseTo(Math.PI / 2);
    });
  });

  describe("no-op units (Hz, Ω, Q, V)", () => {
    it("fs stays Hz", () => {
      expect(fmt("fs", 49.6)).toBe("49.6 Hz");
      expect(toDisplay("fs", 49.6)).toBeCloseTo(49.6);
      expect(parse("fs", 49.6)).toBeCloseTo(49.6);
    });
    it("re stays Ω", () => {
      expect(fmt("re", 7.8)).toBe("7.80 Ω");
      expect(toDisplay("re", 7.8)).toBeCloseTo(7.8);
      expect(parse("re", 7.8)).toBeCloseTo(7.8);
    });
    it("qts stays dimensionless", () => {
      expect(fmt("qts", 0.27)).toBe("0.270");
      expect(toDisplay("qts", 0.27)).toBeCloseTo(0.27);
      expect(parse("qts", 0.27)).toBeCloseTo(0.27);
    });
  });
});
