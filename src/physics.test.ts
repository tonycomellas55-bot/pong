import { describe, expect, test } from "bun:test";
import { clamp, foldYReflect, resolvePaddleHit } from "./physics";

describe("clamp", () => {
  test("bounds a value", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("foldYReflect", () => {
  test("returns values inside range unchanged", () => {
    expect(foldYReflect(5, 0, 10)).toBe(5);
    expect(foldYReflect(0, 0, 10)).toBe(0);
    expect(foldYReflect(10, 0, 10)).toBe(10);
  });

  test("mirrors above max", () => {
    // 10..0 reflection: 11 -> 9, 12 -> 8
    expect(foldYReflect(11, 0, 10)).toBe(9);
    expect(foldYReflect(12, 0, 10)).toBe(8);
  });

  test("mirrors below min", () => {
    // 0..10 reflection: -1 -> 1, -2 -> 2
    expect(foldYReflect(-1, 0, 10)).toBe(1);
    expect(foldYReflect(-2, 0, 10)).toBe(2);
  });
});

describe("resolvePaddleHit", () => {
  test("no hit when not overlapping", () => {
    const res = resolvePaddleHit({
      paddle: { x: 20, y: 20, vy: 0, w: 10, h: 50 },
      ball: { x: 200, y: 200, vx: -100, vy: 0, r: 5 },
      isLeft: true,
      speedUp: 1.05,
      maxSpeed: 1780,
      dpr: 1,
    });
    expect(res.hit).toBe(false);
  });

  test("hit flips vx direction correctly (left paddle)", () => {
    const res = resolvePaddleHit({
      paddle: { x: 20, y: 100, vy: 0, w: 10, h: 80 },
      ball: { x: 29, y: 140, vx: -400, vy: 0, r: 6 },
      isLeft: true,
      speedUp: 1.0,
      maxSpeed: 1780,
      dpr: 1,
    });
    expect(res.hit).toBe(true);
    expect(res.vx).toBeGreaterThan(0);
    expect(res.x).toBe(20 + 10 + 6);
  });

  test("hit flips vx direction correctly (right paddle)", () => {
    const res = resolvePaddleHit({
      paddle: { x: 200, y: 100, vy: 0, w: 10, h: 80 },
      ball: { x: 211, y: 140, vx: 400, vy: 0, r: 6 },
      isLeft: false,
      speedUp: 1.0,
      maxSpeed: 1780,
      dpr: 1,
    });
    expect(res.hit).toBe(true);
    expect(res.vx).toBeLessThan(0);
    expect(res.x).toBe(200 - 6);
  });
});

