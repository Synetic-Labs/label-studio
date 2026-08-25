/**
 * Minimal planar-homography helpers for quads.
 *
 * Used to derive a "predicted outer quad" from four labelled corner points: when the
 * inner and outer boundaries of a physical frame are coplanar and concentric (e.g. a
 * drone-racing gate's inner opening and its outer frame), the perspective transform
 * fitted to the four inner corners predicts where the outer boundary must appear.
 */

/**
 * Solve the 8x8 linear system `A h = b` by Gauss-Jordan elimination with partial
 * pivoting. Returns `null` when the system is singular (degenerate/collinear input).
 */
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;

    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];

    if (Math.abs(d) < 1e-12) return null;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];

      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Fit the homography mapping four `src` points onto four `dst` points (same order).
 * Returns a projection function `(x, y) => [x', y']`, or `null` if degenerate.
 */
export function fitHomography(src, dst) {
  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i];
    const [x, y] = dst[i];

    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]);
    b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]);
    b.push(y);
  }
  const h = solve8(A, b);

  if (!h) return null;

  return (X, Y) => {
    const d = h[6] * X + h[7] * Y + 1;

    if (Math.abs(d) < 1e-12) return null;
    return [(h[0] * X + h[1] * Y + h[2]) / d, (h[3] * X + h[4] * Y + h[5]) / d];
  };
}

// A unit square whose corners map, in order, onto the four labelled points. Any
// consistent cyclic order (either winding, any starting corner) is fine: a homography
// exists for every such correspondence and the scaled square projects consistently.
const UNIT_SQUARE = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Project the concentric quad scaled by `ratio` (about the square's centre, in the
 * frame's own plane) through the homography fitted to the four `points`.
 *
 * @param {Array<[number, number]>} points - four corners in cyclic order
 * @param {number} ratio - outer/inner size ratio (e.g. 1.8 for AIGP racing gates)
 * @returns {Array<[number, number]>|null} four projected corners, or null if degenerate
 */
export function projectConcentricQuad(points, ratio) {
  if (!points || points.length !== 4 || !(ratio > 0)) return null;

  const H = fitHomography(UNIT_SQUARE, points);

  if (!H) return null;

  const out = [];

  for (const [X, Y] of UNIT_SQUARE) {
    const p = H(X * ratio, Y * ratio);

    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    out.push(p);
  }
  return out;
}
