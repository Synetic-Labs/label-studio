import { describe, expect, it } from "bun:test";
import { fitHomography, projectConcentricQuad } from "../homography";

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("fitHomography", () => {
  it("reproduces the correspondence it was fitted to", () => {
    const src = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const dst = [
      [10, 20],
      [110, 15],
      [120, 130],
      [5, 140],
    ];
    const H = fitHomography(src, dst);

    src.forEach(([x, y], i) => {
      const [px, py] = H(x, y);

      expect(close(px, dst[i][0])).toBe(true);
      expect(close(py, dst[i][1])).toBe(true);
    });
  });

  it("returns null for degenerate (collinear) points", () => {
    const src = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const dst = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];

    expect(fitHomography(src, dst)).toBeNull();
  });
});

describe("projectConcentricQuad", () => {
  it("scales an axis-aligned square about its centre for a frontal view", () => {
    // Frontal view: the homography is a similarity, so the outer quad is the inner
    // square scaled by the ratio about its centre.
    const inner = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ];
    const outer = projectConcentricQuad(inner, 1.8);

    expect(outer).toHaveLength(4);
    expect(outer.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])).toEqual([
      [32, 32],
      [68, 32],
      [68, 68],
      [32, 68],
    ]);
  });

  it("is independent of winding and starting corner", () => {
    const inner = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ];
    const rotated = [inner[2], inner[3], inner[0], inner[1]];
    const reversed = [...inner].reverse();
    const key = (q) => q.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort();

    expect(key(projectConcentricQuad(rotated, 1.8))).toEqual(key(projectConcentricQuad(inner, 1.8)));
    expect(key(projectConcentricQuad(reversed, 1.8))).toEqual(key(projectConcentricQuad(inner, 1.8)));
  });

  it("follows perspective: the near (larger) side gets the wider band", () => {
    // Trapezoid — a square seen at an angle: left edge closer to the camera (taller).
    const inner = [
      [10, 10],
      [50, 25],
      [50, 55],
      [10, 70],
    ];
    const outer = projectConcentricQuad(inner, 1.8);
    const bandLeft = inner[0][0] - outer[0][0];
    const bandRight = outer[1][0] - inner[1][0];

    expect(bandLeft).toBeGreaterThan(bandRight);
    expect(bandRight).toBeGreaterThan(0);
  });

  it("rejects bad input", () => {
    expect(projectConcentricQuad([[0, 0]], 1.8)).toBeNull();
    expect(
      projectConcentricQuad(
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        0,
      ),
    ).toBeNull();
  });
});
