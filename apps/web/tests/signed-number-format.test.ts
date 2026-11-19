import { describe, expect, it } from "vitest";
import { fmtNumber, fmtPercent, fmtR, minusSign } from "../src/lib/utils";

const M = "−";

describe("fmtPercent", () => {
  it("uses the true minus for negatives", () => {
    expect(fmtPercent(-0.0041, 2)).toBe(`${M}0.41%`);
    expect(fmtPercent(-0.5)).toBe(`${M}50.0%`);
  });
  it("leaves positives unsigned by default and signs them on request", () => {
    expect(fmtPercent(0.25)).toBe("25.0%");
    expect(fmtPercent(0.25, 1, { sign: true })).toBe("+25.0%");
    expect(fmtPercent(-0.25, 1, { sign: true })).toBe(`${M}25.0%`);
  });
  it("never signs zero, -0 or values that round to zero", () => {
    for (const value of [0, -0, -0.00001]) {
      expect(fmtPercent(value, 2)).toBe("0.00%");
      expect(fmtPercent(value, 2, { sign: true })).toBe("0.00%");
    }
    expect(fmtPercent(0.00001, 2, { sign: true })).toBe("0.00%");
  });
  it("keeps the placeholder for missing values", () => {
    expect(fmtPercent(null)).toBe("–");
    expect(fmtPercent(undefined)).toBe("–");
    expect(fmtPercent(Number.NaN)).toBe("–");
    expect(fmtPercent(Infinity)).toBe("–");
  });
});

describe("fmtR", () => {
  it("formats R-multiples", () => {
    expect(fmtR(-1.2)).toBe(`${M}1.20R`);
    expect(fmtR(1.2)).toBe("1.20R");
    expect(fmtR(1.2, 2, { sign: true })).toBe("+1.20R");
    expect(fmtR(-0)).toBe("0.00R");
    expect(fmtR(null)).toBe("–");
    expect(fmtR(Number.NaN)).toBe("–");
  });
});

describe("fmtNumber", () => {
  it("uses the true minus and an unsigned zero", () => {
    expect(fmtNumber(-1234.5)).toBe(`${M}1,234.5`);
    expect(fmtNumber(1234.5)).toBe("1,234.5");
    expect(fmtNumber(-0)).toBe("0");
    expect(fmtNumber(-0.001)).toBe("0");
  });
});

describe("minusSign", () => {
  it("only rewrites a leading hyphen that signs a figure", () => {
    expect(minusSign("-$141.42")).toBe(`${M}$141.42`);
    expect(minusSign("-12.5 USD")).toBe(`${M}12.5 USD`);
    expect(minusSign("-")).toBe("-");
    expect(minusSign("2026-01-02")).toBe("2026-01-02");
    expect(minusSign("-0.00")).toBe("0.00");
    expect(minusSign("-$0.00")).toBe("$0.00");
    expect(minusSign("+3")).toBe("+3");
  });
});
