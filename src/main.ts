// Pong, but crisp (TypeScript source).

type Side = "left" | "right";
type Mode = "attract" | "serve" | "play" | "pause" | "over";
type ScoreSide = "L" | "R";

import { clamp, lerp, sign, foldYReflect, resolvePaddleHit } from "./physics";

type DifficultyConfig = {
  label: string;
  aiMaxSpeed: number;
  aiReactionMs: number;
  aiErrorPx: number;
  ballSpeed: number;
  speedUp: number;
};

function mustGetEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as unknown as T;
}

const canvas = mustGetEl<HTMLCanvasElement>("game");
const _ctx = canvas.getContext("2d", { alpha: false });
if (!_ctx) throw new Error("Could not get 2d context");
const ctx = _ctx;

const el = {
  overlay: mustGetEl<HTMLDivElement>("overlay"),
  btnStart: mustGetEl<HTMLButtonElement>("btnStart"),
  btnDifficulty: mustGetEl<HTMLButtonElement>("btnDifficulty"),
  difficultyLabel: mustGetEl<HTMLSpanElement>("difficultyLabel"),
  btnSound: mustGetEl<HTMLButtonElement>("btnSound"),
  soundLabel: mustGetEl<HTMLSpanElement>("soundLabel"),
  scoreLeft: mustGetEl<HTMLSpanElement>("scoreLeft"),
  scoreRight: mustGetEl<HTMLSpanElement>("scoreRight"),
  subline: mustGetEl<HTMLDivElement>("subline"),
  pillMode: mustGetEl<HTMLSpanElement>("pillMode"),
  pillDiff: mustGetEl<HTMLSpanElement>("pillDiff"),
};

const DPR = () => Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

const nowMs = () => performance.now();

function fitCanvas() {
  const dpr = DPR();
  const r = canvas.getBoundingClientRect();
  const w = Math.max(320, Math.floor(r.width * dpr));
  const h = Math.max(240, Math.floor(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// Simple synth beeps via WebAudio (no assets).
class Sfx {
  enabled: boolean;
  ctx: AudioContext | null;
  master: GainNode | null;

  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
  }
  ensure() {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
  }
  setEnabled(on: boolean) {
    this.enabled = !!on;
    if (!this.enabled) return;
    // Create context only when enabling (user gesture friendly).
    this.ensure();
  }
  ping(freq: number, dur: number = 0.06, type: OscillatorType = "sine") {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1.0, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.01);
  }
  hit() { this.ping(420, 0.05, "triangle"); }
  wall() { this.ping(220, 0.05, "sine"); }
  score() { this.ping(150, 0.09, "square"); }
  serve() { this.ping(560, 0.07, "sine"); }
  win() { this.ping(880, 0.10, "sine"); setTimeout(() => this.ping(660, 0.12, "sine"), 80); }
}

const sfx = new Sfx();

const Difficulty: Record<"Easy" | "Normal" | "Hard", DifficultyConfig> = {
  Easy: {
    label: "Easy",
    aiMaxSpeed: 720,
    aiReactionMs: 190,
    aiErrorPx: 26,
    ballSpeed: 820,
    speedUp: 1.035,
  },
  Normal: {
    label: "Normal",
    aiMaxSpeed: 980,
    aiReactionMs: 130,
    aiErrorPx: 16,
    ballSpeed: 900,
    speedUp: 1.045,
  },
  Hard: {
    label: "Hard",
    aiMaxSpeed: 1250,
    aiReactionMs: 90,
    aiErrorPx: 8,
    ballSpeed: 980,
    speedUp: 1.055,
  },
};

const DiffOrder = [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard];

const state = {
  mode: "attract" as Mode,
  diff: Difficulty.Normal,
  sound: true,
  scoreL: 0,
  scoreR: 0,
  maxScore: 11,
  lastT: nowMs(),
  t: 0,
};

const world = {
  // Will map to canvas px (we run physics in px space for simplicity).
  w: 960,
  h: 540,
  padW: 16,
  padH: 108,
  padInset: 36,
  ballR: 9.5,
  netW: 5,
  netGap: 18,
};

const left = {
  x: 0, y: 0,
  vy: 0,
  targetY: null as number | null,
};
const right = {
  x: 0, y: 0,
  vy: 0,
  targetY: null as number | null,
  lastReactAt: 0,
};
const ball = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  glow: 0,
};

const input = {
  up: false,
  down: false,
  pointer: {
    active: false,
    id: null as number | null,
    side: "left" as Side,
    y: 0,
  },
};

function setMode(mode: Mode) {
  state.mode = mode;
  el.pillMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  if (mode === "attract") el.subline.textContent = "Press Start";
  if (mode === "serve") el.subline.textContent = "Press Enter to serve";
  if (mode === "play") el.subline.textContent = "Space pauses";
  if (mode === "pause") el.subline.textContent = "Paused (Space to resume)";
  if (mode === "over") el.subline.textContent = "Press R to play again";
}

function setDifficulty(diff: DifficultyConfig) {
  state.diff = diff;
  el.difficultyLabel.textContent = diff.label;
  el.pillDiff.textContent = diff.label;
}

function setSound(on: boolean) {
  state.sound = !!on;
  sfx.setEnabled(state.sound);
  el.soundLabel.textContent = state.sound ? "On" : "Off";
}

function resetMatch() {
  state.scoreL = 0;
  state.scoreR = 0;
  el.scoreLeft.textContent = "0";
  el.scoreRight.textContent = "0";
  resetRound("attract");
  setMode("attract");
  showOverlay(true);
}

function resetRound(mode: Mode = "serve") {
  fitCanvas();
  world.w = canvas.width;
  world.h = canvas.height;

  world.padW = Math.max(12, Math.round(world.w * 0.016));
  world.padH = Math.max(70, Math.round(world.h * 0.20));
  world.padInset = Math.max(20, Math.round(world.w * 0.04));
  world.ballR = Math.max(7, Math.round(world.w * 0.010));
  world.netW = Math.max(3, Math.round(world.w * 0.006));
  world.netGap = Math.max(12, Math.round(world.h * 0.03));

  left.x = world.padInset;
  right.x = world.w - world.padInset - world.padW;
  left.y = right.y = (world.h - world.padH) * 0.5;
  left.vy = right.vy = 0;
  right.lastReactAt = 0;

  ball.x = world.w * 0.5;
  ball.y = world.h * 0.5;
  ball.vx = 0;
  ball.vy = 0;
  ball.glow = 0;

  setMode(mode);
}

function showOverlay(on: boolean) {
  if (on) el.overlay.removeAttribute("hidden");
  else el.overlay.setAttribute("hidden", "hidden");
}

function serve(dir: number) {
  const speed = state.diff.ballSpeed * DPR();
  const angle = (Math.random() * 0.62 - 0.31); // ~[-18,18] deg
  ball.vx = Math.cos(angle) * speed * dir;
  ball.vy = Math.sin(angle) * speed;
  ball.glow = 1;
  setMode("play");
  sfx.serve();
}

function score(side: ScoreSide) {
  if (side === "L") state.scoreL += 1;
  else state.scoreR += 1;
  el.scoreLeft.textContent = String(state.scoreL);
  el.scoreRight.textContent = String(state.scoreR);
  sfx.score();

  if (state.scoreL >= state.maxScore || state.scoreR >= state.maxScore) {
    setMode("over");
    sfx.win();
    showOverlay(true);
    el.btnStart.textContent = "Play again";
    return;
  }

  resetRound("serve");
}

function paddleMove(p: { y: number; vy: number }, dt: number, desire: number) {
  const max = 1120 * DPR();
  const accel = 6200 * DPR();
  const damp = 24;
  // desire is -1..1
  const target = desire * max;
  p.vy = lerp(p.vy, target, 1 - Math.exp(-damp * dt));
  // extra acceleration for snappy feel
  p.vy += (target - p.vy) * clamp(accel * dt / max, 0, 1);
  p.vy = clamp(p.vy, -max, max);
  p.y += p.vy * dt;
  p.y = clamp(p.y, 0, world.h - world.padH);
}

function aiStep(dt: number) {
  if (state.mode !== "play" && state.mode !== "serve") {
    // idle float
    const bob = Math.sin(state.t * 0.0012) * 0.25;
    right.y = clamp(right.y + bob * 140 * dt, 0, world.h - world.padH);
    right.vy = 0;
    return;
  }

  const d = state.diff;
  const t = nowMs();
  if (t - right.lastReactAt > d.aiReactionMs) {
    right.lastReactAt = t;
    // Predict where ball will cross the AI paddle plane (roughly).
    let predictY = world.h * 0.5;
    if (ball.vx > 0) {
      const planeX = right.x - world.ballR;
      const timeToPlane = (planeX - ball.x) / ball.vx;
      if (timeToPlane > 0 && timeToPlane < 2.0) {
        predictY = ball.y + ball.vy * timeToPlane;
        // reflect on top/bottom to simulate bounces
        const minY = world.ballR;
        const maxY = world.h - world.ballR;
        let y = predictY;
        // fold into [minY,maxY] with mirror reflections
        const span = maxY - minY;
        if (span > 0) {
          y = foldYReflect(y, minY, maxY);
        }
        predictY = y;
      }
    }
    const err = (Math.random() * 2 - 1) * d.aiErrorPx * DPR();
    right.targetY = clamp(predictY - world.padH * 0.5 + err, 0, world.h - world.padH);
  }

  // Move toward target
  const dy = (right.targetY ?? right.y) - right.y;
  const desire = clamp(dy / (world.h * 0.15), -1, 1);

  const oldY = right.y;
  paddleMove(right, dt, desire);
  // cap AI max speed
  const maxV = d.aiMaxSpeed * DPR();
  const actualV = (right.y - oldY) / dt;
  if (Math.abs(actualV) > maxV) {
    right.y = oldY + sign(actualV) * maxV * dt;
    right.vy = sign(actualV) * maxV;
  }
}

function ballStep(dt: number) {
  if (state.mode !== "play") {
    // gentle drift in attract/serve modes
    ball.x = lerp(ball.x, world.w * 0.5, 1 - Math.exp(-8 * dt));
    ball.y = lerp(ball.y, world.h * 0.5, 1 - Math.exp(-8 * dt));
    ball.glow = lerp(ball.glow, 0, 1 - Math.exp(-6 * dt));
    return;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const r = world.ballR;
  if (ball.y < r) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy);
    ball.glow = 1;
    sfx.wall();
  } else if (ball.y > world.h - r) {
    ball.y = world.h - r;
    ball.vy = -Math.abs(ball.vy);
    ball.glow = 1;
    sfx.wall();
  }

  // Paddle collisions
  const hitPaddle = (p: { x: number; y: number; vy: number }, isLeft: boolean) => {
    const px0 = p.x;
    const px1 = p.x + world.padW;
    const py0 = p.y;
    const py1 = p.y + world.padH;
    const bx0 = ball.x - r;
    const bx1 = ball.x + r;
    const by0 = ball.y - r;
    const by1 = ball.y + r;
    if (bx1 < px0 || bx0 > px1 || by1 < py0 || by0 > py1) return false;

    const dpr = DPR();
    const res = resolvePaddleHit({
      paddle: { x: p.x, y: p.y, vy: p.vy, w: world.padW, h: world.padH },
      ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, r },
      isLeft,
      speedUp: state.diff.speedUp,
      maxSpeed: 1780,
      dpr,
    });
    if (!res.hit) return false;
    ball.x = res.x;
    ball.vx = res.vx;
    ball.vy = res.vy;
    ball.glow = 1;
    sfx.hit();
    return true;
  };

  if (ball.vx < 0) hitPaddle(left, true);
  else hitPaddle(right, false);

  // Scoring
  if (ball.x < -r * 2) score("R");
  else if (ball.x > world.w + r * 2) score("L");

  ball.glow = lerp(ball.glow, 0, 1 - Math.exp(-5 * dt));
}

function leftInput(dt: number) {
  let desire = 0;
  if (input.up) desire -= 1;
  if (input.down) desire += 1;

  if (input.pointer.active && input.pointer.side === "left") {
    const target = clamp(input.pointer.y - world.padH * 0.5, 0, world.h - world.padH);
    const dy = target - left.y;
    desire = clamp(dy / (world.h * 0.12), -1, 1);
  }

  if (state.mode === "attract") {
    // cozy idle drift if no input
    if (!input.up && !input.down && !(input.pointer.active && input.pointer.side === "left")) {
      const idle = Math.sin(state.t * 0.0013) * 0.55;
      desire = clamp(idle, -1, 1);
    }
  }

  paddleMove(left, dt, desire);
}

function draw() {
  fitCanvas();
  world.w = canvas.width;
  world.h = canvas.height;

  // Background
  ctx.fillStyle = "#05050a";
  ctx.fillRect(0, 0, world.w, world.h);

  // subtle vignette + glow corners
  const g0 = ctx.createRadialGradient(world.w * 0.2, world.h * 0.25, 0, world.w * 0.2, world.h * 0.25, world.w * 0.9);
  g0.addColorStop(0, "rgba(125,240,255,0.12)");
  g0.addColorStop(0.55, "rgba(125,240,255,0.00)");
  ctx.fillStyle = g0;
  ctx.fillRect(0, 0, world.w, world.h);

  const g1 = ctx.createRadialGradient(world.w * 0.85, world.h * 0.28, 0, world.w * 0.85, world.h * 0.28, world.w * 0.8);
  g1.addColorStop(0, "rgba(255,108,247,0.10)");
  g1.addColorStop(0.6, "rgba(255,108,247,0.00)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, world.w, world.h);

  // Net
  ctx.save();
  ctx.translate(world.w * 0.5, 0);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  const dashH = Math.max(10, Math.round(world.h * 0.042));
  for (let y = 0; y < world.h; y += dashH + world.netGap) {
    ctx.fillRect(-world.netW * 0.5, y, world.netW, dashH);
  }
  ctx.restore();

  // Paddles
  const drawPaddle = (p: { x: number; y: number }, accent: string) => {
    const r = Math.round(10 * DPR());
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const w = Math.round(world.padW);
    const h = Math.round(world.padH);

    // Outer glow
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18 * DPR();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.restore();

    // Body
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, "rgba(255,255,255,0.92)");
    grad.addColorStop(1, "rgba(255,255,255,0.62)");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();

    // Inner cut
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, Math.max(6, r - 4));
    ctx.fill();
  };

  drawPaddle(left, "rgba(125,240,255,0.55)");
  drawPaddle(right, "rgba(255,108,247,0.50)");

  // Ball (with glow/trail)
  const trailN = 7;
  for (let i = trailN; i >= 1; i--) {
    const t = i / trailN;
    const px = ball.x - ball.vx * 0.006 * i;
    const py = ball.y - ball.vy * 0.006 * i;
    ctx.beginPath();
    ctx.fillStyle = `rgba(125,240,255,${0.06 * (1 - t)})`;
    ctx.arc(px, py, world.ballR * (1 - 0.08 * t), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.shadowColor = `rgba(125,240,255,${0.55 * ball.glow})`;
  ctx.shadowBlur = 28 * DPR() * (0.5 + ball.glow);
  ctx.beginPath();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.arc(ball.x, ball.y, world.ballR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pause tint
  if (state.mode === "pause") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, world.w, world.h);
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function tick() {
  fitCanvas();
  const t = nowMs();
  const dt = clamp((t - state.lastT) / 1000, 0, 0.032);
  state.lastT = t;
  state.t += dt * 1000;

  // Keep geometry responsive
  world.w = canvas.width;
  world.h = canvas.height;

  leftInput(dt);
  aiStep(dt);
  ballStep(dt);
  draw();

  requestAnimationFrame(tick);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") input.up = true;
  if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") input.down = true;

  if (e.key === " ") {
    if (state.mode === "play") setMode("pause");
    else if (state.mode === "pause") setMode("play");
    e.preventDefault();
  }

  if (e.key === "Enter") {
    if (state.mode === "attract") {
      showOverlay(false);
      resetRound("serve");
      setMode("serve");
    } else if (state.mode === "serve") {
      serve(Math.random() < 0.5 ? -1 : 1);
    } else if (state.mode === "over") {
      showOverlay(false);
      resetMatch();
    }
  }

  if (e.key === "r" || e.key === "R") {
    showOverlay(true);
    el.btnStart.textContent = "Start";
    resetMatch();
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") input.up = false;
  if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") input.down = false;
}

function pointerToLocalY(ev: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  const y = (ev.clientY - r.top) * DPR();
  return clamp(y, 0, canvas.height);
}
function pointerToSide(ev: PointerEvent): Side {
  const r = canvas.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width;
  return x < 0.5 ? "left" : "right";
}

function onPointerDown(ev: PointerEvent) {
  canvas.setPointerCapture(ev.pointerId);
  input.pointer.active = true;
  input.pointer.id = ev.pointerId;
  input.pointer.side = pointerToSide(ev);
  input.pointer.y = pointerToLocalY(ev);

  if (state.mode === "attract") {
    // Let taps start quickly
    showOverlay(false);
    resetRound("serve");
    setMode("serve");
  } else if (state.mode === "serve") {
    // Tap to serve (mobile friendly)
    serve(Math.random() < 0.5 ? -1 : 1);
  }
}

function onPointerMove(ev: PointerEvent) {
  if (!input.pointer.active || ev.pointerId !== input.pointer.id) return;
  input.pointer.y = pointerToLocalY(ev);
}

function onPointerUp(ev: PointerEvent) {
  if (ev.pointerId !== input.pointer.id) return;
  input.pointer.active = false;
  input.pointer.id = null;
}

function cycleDifficulty() {
  const i = DiffOrder.findIndex((d) => d.label === state.diff.label);
  const next = DiffOrder[(i + 1) % DiffOrder.length]!;
  setDifficulty(next);
}

el.btnStart.addEventListener("click", () => {
  showOverlay(false);
  resetRound("serve");
  setMode("serve");
});
el.btnDifficulty.addEventListener("click", () => cycleDifficulty());
el.btnSound.addEventListener("click", () => setSound(!state.sound));

window.addEventListener("keydown", onKeyDown, { passive: false });
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", () => resetRound(state.mode === "play" ? "play" : state.mode));

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// Boot
fitCanvas();
setDifficulty(Difficulty.Normal);
setSound(true);
resetRound("attract");
setMode("attract");
showOverlay(true);

requestAnimationFrame(tick);
