/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function normCdf(z: number): number {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** P(lo <= X < hi) for X ~ Normal(mean, sd). Use ±Infinity for open ends. */
export function normInterval(mean: number, sd: number, lo: number, hi: number): number {
  if (sd <= 0) return mean >= lo && mean < hi ? 1 : 0;
  return Math.max(0, normCdf((hi - mean) / sd) - normCdf((lo - mean) / sd));
}

/** P(X >= threshold) for X ~ Normal(mean, sd). */
export function probAtLeast(mean: number, sd: number, threshold: number): number {
  if (sd <= 0) return mean >= threshold ? 1 : 0;
  return 1 - normCdf((threshold - mean) / sd);
}

/** Gauss–Hermite nodes/weights for ∫ e^{-x²} f(x) dx (Newton iteration, Numerical Recipes `gauher`). */
export function gaussHermite(n: number): { nodes: number[]; weights: number[] } {
  const x = new Array<number>(n).fill(0);
  const w = new Array<number>(n).fill(0);
  const PIM4 = Math.PI ** -0.25;
  const m = Math.floor((n + 1) / 2);
  let z = 0;
  for (let i = 0; i < m; i++) {
    if (i === 0) z = Math.sqrt(2 * n + 1) - 1.85575 * (2 * n + 1) ** -0.16667;
    else if (i === 1) z -= (1.14 * n ** 0.426) / z;
    else if (i === 2) z = 1.86 * z - 0.86 * x[0]!;
    else if (i === 3) z = 1.91 * z - 0.91 * x[1]!;
    else z = 2 * z - x[i - 2]!;
    let pp = 0;
    for (let its = 0; its < 100; its++) {
      let p1 = PIM4;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = z * Math.sqrt(2 / j) * p2 - Math.sqrt((j - 1) / j) * p3;
      }
      pp = Math.sqrt(2 * n) * p2;
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) <= 1e-14) break;
    }
    x[i] = z;
    x[n - 1 - i] = -z;
    w[i] = 2 / (pp * pp);
    w[n - 1 - i] = w[i]!;
  }
  return { nodes: x, weights: w };
}

const GH = gaussHermite(24);

/** E[f(X)] for X ~ Normal(mean, sd) by Gauss–Hermite quadrature. */
export function expectNormal(mean: number, sd: number, f: (x: number) => number): number {
  if (sd <= 0) return f(mean);
  let sum = 0;
  for (let i = 0; i < GH.nodes.length; i++) {
    sum += GH.weights[i]! * f(mean + Math.SQRT2 * sd * GH.nodes[i]!);
  }
  return sum / Math.sqrt(Math.PI);
}
