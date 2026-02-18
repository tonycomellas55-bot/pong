export type Vec = { x: number; y: number };

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const sign = (v: number): -1 | 1 => (v < 0 ? -1 : 1);

/**
 * Fold a y value into [minY,maxY] with mirror reflections (like bouncing on top/bottom walls).
 * This matches the "predict & reflect" logic used by the AI.
 */
export function foldYReflect(y: number, minY: number, maxY: number): number {
  const span = maxY - minY;
  if (span <= 0) return minY;
  let v = y - minY;
  const period = 2 * span;
  v = ((v % period) + period) % period;
  if (v > span) v = period - v;
  return v + minY;
}

export type Paddle = { x: number; y: number; vy: number; w: number; h: number };
export type Ball = { x: number; y: number; vx: number; vy: number; r: number };

export type HitResult = {
  hit: boolean;
  // New ball velocity (if hit)
  vx: number;
  vy: number;
  // Resolved x position (if hit)
  x: number;
};

/**
 * Compute a paddle collision response. This is deterministic and testable.
 * Caller is responsible for checking overlap first, or can pass overlap=true if already known.
 */
export function resolvePaddleHit(opts: {
  paddle: Paddle;
  ball: Ball;
  isLeft: boolean;
  speedUp: number;
  maxSpeed: number;
  dpr: number;
}): HitResult {
  const { paddle: p, ball: b, isLeft, speedUp, maxSpeed, dpr } = opts;

  const px0 = p.x;
  const px1 = p.x + p.w;
  const py0 = p.y;
  const py1 = p.y + p.h;
  const bx0 = b.x - b.r;
  const bx1 = b.x + b.r;
  const by0 = b.y - b.r;
  const by1 = b.y + b.r;
  if (bx1 < px0 || bx0 > px1 || by1 < py0 || by0 > py1) {
    return { hit: false, vx: b.vx, vy: b.vy, x: b.x };
  }

  // Push ball outside paddle on x
  const x = isLeft ? px1 + b.r : px0 - b.r;

  const speed = Math.hypot(b.vx, b.vy);
  const newSpeed = Math.min(speed * speedUp, maxSpeed * dpr);

  const impact = (b.y - (p.y + p.h * 0.5)) / (p.h * 0.5);
  const spin = clamp((p.vy / (1150 * dpr)) * 0.55, -0.55, 0.55);
  const ang = clamp(impact * 0.75 + spin, -0.95, 0.95);

  const dir = isLeft ? 1 : -1;
  const vx = Math.cos(ang) * newSpeed * dir;
  const vy = Math.sin(ang) * newSpeed;

  return { hit: true, vx, vy, x };
}

