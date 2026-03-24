/* ═══════════════════════════════════════════════════════════
   NEON RUN — script.js
   2D Cyberpunk Parkour Platformer
   Architecture: Class-based, separated logic from rendering
   Author: Professional Game Dev Build
═══════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────────────────
   PHYSICS & GAME CONSTANTS
────────────────────────────────────────────────────────── */
const C = Object.freeze({
  GRAVITY:          0.55,
  JUMP_FORCE:       -13.5,
  DOUBLE_JUMP:      -12.0,
  MOVE_SPEED:       5.2,
  MAX_WALK:         8.0,
  MAX_FALL:         22.0,
  FRICTION_GROUND:  0.78,
  FRICTION_AIR:     0.92,

  // Platform generation
  PLATFORM_MIN_W:   80,
  PLATFORM_MAX_W:   200,
  PLATFORM_H:       14,
  MIN_GAP_X:        120,
  MAX_GAP_X:        230,
  GAP_Y_RANGE:      180,
  SPAWN_BUFFER:     400,   // spawn platforms this far ahead of camera

  // Camera
  CAM_LERP:         0.1,
  CAM_OFFSET_X:     0.3,   // player stays at 30% from left

  // Scoring
  SCORE_DIVISOR:    10,

  // Difficulty
  DIFF_INCREASE:    0.00008,
  DIFF_MAX:         1.0,

  // Particles
  PARTICLE_COUNT:   18,
  COIN_PARTICLE:    8,
});

/* ──────────────────────────────────────────────────────────
   UTILITY HELPERS
────────────────────────────────────────────────────────── */
const utils = {
  rand:    (min, max) => Math.random() * (max - min) + min,
  randInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  clamp:   (val, min, max) => Math.max(min, Math.min(max, val)),
  lerp:    (a, b, t) => a + (b - a) * t,
  dist:    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
};

/* ──────────────────────────────────────────────────────────
   AUDIO ENGINE  — synthesised sounds via Web Audio API
────────────────────────────────────────────────────────── */
class AudioEngine {
  constructor() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.35;
      this.masterGain.connect(this.ctx.destination);
      this.enabled = true;
    } catch (_) {
      this.enabled = false;
    }
  }

  /** Resume context (browsers need user interaction first) */
  resume() {
    if (this.enabled && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Generic tone player */
  _play(frequency, type, duration, gainVal = 0.3, detune = 0) {
    if (!this.enabled) return;
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type    = type;
    osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
    osc.detune.setValueAtTime(detune, this.ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + duration);
  }

  jump() {
    this._play(260, 'square', 0.12, 0.25);
    this._play(380, 'square', 0.10, 0.15, 5);
  }

  doubleJump() {
    this._play(340, 'square', 0.10, 0.2);
    this._play(500, 'square', 0.14, 0.2, 8);
    this._play(660, 'square', 0.08, 0.1, 10);
  }

  land() {
    this._play(80, 'sawtooth', 0.08, 0.3);
  }

  coin() {
    this._play(880, 'sine', 0.12, 0.2);
    this._play(1100, 'sine', 0.10, 0.15);
  }

  gameOver() {
    this._play(220, 'sawtooth', 0.3, 0.4);
    this._play(180, 'sawtooth', 0.4, 0.4);
    this._play(150, 'sawtooth', 0.6, 0.5);
  }
}

/* ──────────────────────────────────────────────────────────
   PARTICLE  — single visual effect unit
────────────────────────────────────────────────────────── */
class Particle {
  constructor(x, y, opts = {}) {
    this.x    = x;
    this.y    = y;
    this.vx   = opts.vx   ?? utils.rand(-3, 3);
    this.vy   = opts.vy   ?? utils.rand(-5, -1);
    this.r    = opts.r    ?? utils.rand(2, 5);
    this.life = opts.life ?? utils.rand(0.5, 1.0);
    this.maxLife = this.life;
    this.color   = opts.color ?? '#00f5ff';
    this.gravity = opts.gravity ?? 0.25;
    this.dead    = false;
  }

  update(dt) {
    this.vy  += this.gravity * dt;
    this.x   += this.vx * dt;
    this.y   += this.vy * dt;
    this.life -= 0.025 * dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx, camX, camY) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(this.x - camX, this.y - camY, this.r * alpha, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = this.color;
    ctx.fill();
    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────
   PARTICLE SYSTEM  — manages all active particles
────────────────────────────────────────────────────────── */
class ParticleSystem {
  constructor() {
    this.pool = [];
  }

  /** Burst of particles at world position */
  burst(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      this.pool.push(new Particle(x, y, {
        vx:    utils.rand(-4, 4),
        vy:    utils.rand(-6, -0.5),
        r:     utils.rand(2, 4.5),
        life:  utils.rand(0.4, 0.9),
        color: opts.color ?? '#00f5ff',
        gravity: opts.gravity ?? 0.3,
      }));
    }
  }

  /** Directional burst (e.g. jump thrust downward) */
  thrust(x, y, count, color = '#00f5ff') {
    for (let i = 0; i < count; i++) {
      this.pool.push(new Particle(x, y, {
        vx:    utils.rand(-2, 2),
        vy:    utils.rand(1, 4),
        r:     utils.rand(1.5, 3.5),
        life:  utils.rand(0.2, 0.55),
        color,
        gravity: -0.05,
      }));
    }
  }

  update(dt) {
    this.pool = this.pool.filter(p => {
      p.update(dt);
      return !p.dead;
    });
  }

  draw(ctx, camX, camY) {
    this.pool.forEach(p => p.draw(ctx, camX, camY));
  }

  clear() { this.pool = []; }
}

/* ──────────────────────────────────────────────────────────
   COIN  — collectible item on platforms
────────────────────────────────────────────────────────── */
class Coin {
  constructor(x, y) {
    this.x          = x;
    this.y          = y;
    this.r          = 9;
    this.collected  = false;
    this.bobOffset  = Math.random() * Math.PI * 2;
    this.pulse      = 0;
  }

  get bounds() {
    return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
  }

  update(dt) {
    this.pulse += 0.06 * dt;
  }

  draw(ctx, camX, camY, time) {
    if (this.collected) return;
    const screenX = this.x - camX;
    const screenY = this.y - camY + Math.sin(time * 0.002 + this.bobOffset) * 4;

    ctx.save();
    // Outer glow ring
    ctx.beginPath();
    ctx.arc(screenX, screenY, this.r + 4 + Math.sin(this.pulse) * 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,214,10,0.2)';
    ctx.lineWidth   = 3;
    ctx.stroke();

    // Coin body
    const grad = ctx.createRadialGradient(screenX - 2, screenY - 2, 1, screenX, screenY, this.r);
    grad.addColorStop(0, '#fff8c0');
    grad.addColorStop(0.5, '#ffd60a');
    grad.addColorStop(1, '#b38600');
    ctx.beginPath();
    ctx.arc(screenX, screenY, this.r, 0, Math.PI * 2);
    ctx.fillStyle   = grad;
    ctx.shadowBlur  = 16;
    ctx.shadowColor = '#ffd60a';
    ctx.fill();

    // Inner hexagon mark
    ctx.beginPath();
    ctx.arc(screenX, screenY, this.r * 0.45, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────
   PLATFORM  — static or moving, with optional coin
────────────────────────────────────────────────────────── */
class Platform {
  constructor(x, y, w, h, opts = {}) {
    this.x    = x;
    this.y    = y;
    this.w    = w;
    this.h    = h;

    // Moving platform properties
    this.moving    = opts.moving    ?? false;
    this.moveDir   = opts.moveDir   ?? 1;
    this.moveSpeed = opts.moveSpeed ?? utils.rand(1.2, 2.8);
    this.moveRange = opts.moveRange ?? utils.rand(60, 140);
    this.originX   = opts.originX   ?? x;
    this.originY   = opts.originY   ?? y;
    this.moveAxis  = opts.moveAxis  ?? 'x'; // 'x' or 'y'

    // Coin on this platform
    this.coin = opts.hasCoin
      ? new Coin(x + w / 2, y - 20)
      : null;

    // Glow color variation
    this.colorType = opts.colorType ?? 'cyan'; // 'cyan' | 'purple' | 'green'
    this._time     = Math.random() * 100;
  }

  get bounds() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  update(dt, diffMult) {
    this._time += dt;

    if (this.moving) {
      const speed = this.moveSpeed * (1 + diffMult * 0.5) * dt;

      if (this.moveAxis === 'x') {
        this.x += speed * this.moveDir;
        if (Math.abs(this.x - this.originX) >= this.moveRange) {
          this.moveDir *= -1;
        }
      } else {
        this.y += speed * this.moveDir;
        if (Math.abs(this.y - this.originY) >= this.moveRange) {
          this.moveDir *= -1;
        }
      }

      // Keep coin synced with platform
      if (this.coin && !this.coin.collected) {
        this.coin.x = this.x + this.w / 2;
        this.coin.y = this.y - 20;
      }
    }

    if (this.coin) this.coin.update(dt);
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;

    if (sx + this.w < -20 || sx > ctx.canvas.width + 20) return;

    const colors = {
      cyan:   { top: '#00f5ff', mid: '#0088aa', glow: 'rgba(0,245,255,0.5)' },
      purple: { top: '#b06be0', mid: '#6a2fa0', glow: 'rgba(155,93,229,0.5)' },
      green:  { top: '#06d6a0', mid: '#047857', glow: 'rgba(6,214,160,0.5)'  },
    };
    const col = colors[this.colorType];

    ctx.save();

    // Glow shadow
    ctx.shadowBlur  = 12 + Math.sin(this._time * 0.05) * 4;
    ctx.shadowColor = col.glow;

    // Platform body gradient
    const grad = ctx.createLinearGradient(sx, sy, sx, sy + this.h);
    grad.addColorStop(0, col.top);
    grad.addColorStop(0.4, col.mid);
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(sx, sy, this.w, this.h, 4);
    ctx.fill();

    // Top bright edge
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = col.top;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(sx, sy, this.w, 3, [4, 4, 0, 0]);
    ctx.fill();

    // Moving platform indicator dots
    if (this.moving) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle   = '#ffffff';
      const dotCount  = 3;
      const dotSpacing = this.w / (dotCount + 1);
      for (let i = 1; i <= dotCount; i++) {
        ctx.beginPath();
        ctx.arc(sx + dotSpacing * i, sy + this.h / 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────
   PLAYER  — the parkour runner
────────────────────────────────────────────────────────── */
class Player {
  constructor(x, y) {
    // World position
    this.x  = x;
    this.y  = y;
    this.w  = 28;
    this.h  = 40;

    // Physics
    this.vx       = 0;
    this.vy       = 0;

    // State flags
    this.onGround    = false;
    this.jumpCount   = 0;  // 0=none, 1=first, 2=double
    this.maxJumps    = 2;
    this.wasOnGround = false;
    this.alive       = true;

    // Animation
    this.squash    = 1;    // y scale on land/jump
    this.stretch   = 1;    // x scale
    this.lean      = 0;    // rotation lean
    this.runFrame  = 0;
    this.runTimer  = 0;
    this.trail     = [];   // motion trail positions

    // Visual state
    this.facing = 1;       // 1=right, -1=left
  }

  get bounds() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.h / 2; }
  get bottom()  { return this.y + this.h; }

  /** Apply a jump impulse */
  jump(force, audio, particles) {
    this.vy = force;
    this.onGround = false;
    this.squash = 1.3;   // stretch up on jump
    this.stretch = 0.75;

    particles.thrust(
      this.centerX,
      this.bottom,
      C.PARTICLE_COUNT / 2,
      '#00f5ff'
    );

    if (this.jumpCount === 0) {
      this.jumpCount = 1;
      audio.jump();
    } else {
      this.jumpCount = 2;
      audio.doubleJump();
      // Double-jump burst
      particles.burst(this.centerX, this.centerY, C.PARTICLE_COUNT, {
        color: '#9b5de5'
      });
    }
  }

  /** Physics update — called every frame */
  update(dt, input, platforms, particles, audio, diffMult) {
    if (!this.alive) return;

    /* ─ Horizontal movement ─ */
    const accel = this.onGround ? C.MOVE_SPEED : C.MOVE_SPEED * 0.7;

    if (input.left)  this.vx -= accel * dt;
    if (input.right) this.vx += accel * dt;

    // Friction
    const friction = this.onGround ? C.FRICTION_GROUND : C.FRICTION_AIR;
    this.vx *= Math.pow(friction, dt);
    this.vx  = utils.clamp(this.vx, -C.MAX_WALK, C.MAX_WALK);

    // Facing direction
    if (Math.abs(this.vx) > 0.3) {
      this.facing = this.vx > 0 ? 1 : -1;
    }

    // Lean into direction
    const targetLean = (this.vx / C.MAX_WALK) * 0.2;
    this.lean = utils.lerp(this.lean, targetLean, 0.15 * dt);

    /* ─ Gravity ─ */
    this.vy += C.GRAVITY * dt;
    this.vy  = Math.min(this.vy, C.MAX_FALL);

    /* ─ Integrate position ─ */
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    /* ─ Collision detection ─ */
    this.wasOnGround = this.onGround;
    this.onGround    = false;

    for (const plat of platforms) {
      if (this._resolveCollision(plat, dt)) break;
    }

    // Landing detection — emit landing particles
    if (!this.wasOnGround && this.onGround) {
      this.squash = 0.65;
      this.stretch = 1.35;
      this.jumpCount = 0;
      audio.land();
      particles.burst(this.centerX, this.bottom - 2, C.PARTICLE_COUNT / 2, {
        color:   '#00f5ff',
        gravity: 0.1,
      });
    }

    /* ─ Animate squash/stretch back to normal ─ */
    this.squash  = utils.lerp(this.squash,  1, 0.18 * dt);
    this.stretch = utils.lerp(this.stretch, 1, 0.18 * dt);

    /* ─ Run animation timer ─ */
    if (this.onGround && Math.abs(this.vx) > 0.5) {
      this.runTimer += Math.abs(this.vx) * 0.08 * dt;
    }

    /* ─ Motion trail ─ */
    this.trail.unshift({ x: this.centerX, y: this.centerY, a: 0.35 });
    if (this.trail.length > 8) this.trail.pop();
    this.trail.forEach((t, i) => { t.a -= 0.04 * dt; });
    this.trail = this.trail.filter(t => t.a > 0);
  }

  /** AABB collision with platform — returns true if collided from top */
  _resolveCollision(plat, dt) {
    const pb = plat.bounds;

    // Broad phase
    if (this.x + this.w <= pb.x || this.x >= pb.x + pb.w) return false;
    if (this.y + this.h <= pb.y || this.y >= pb.y + pb.h) return false;

    // Only resolve landing on top (player falling downward)
    const prevBottom = this.y + this.h - this.vy * dt;
    const isAbove    = prevBottom <= pb.y + 4;

    if (isAbove && this.vy >= 0) {
      this.y        = pb.y - this.h;
      this.vy       = 0;
      this.onGround = true;

      // Ride moving platforms
      if (plat.moving && plat.moveAxis === 'x') {
        this.x += plat.moveSpeed * plat.moveDir * dt;
      }
      return true;
    }
    return false;
  }

  draw(ctx, camX, camY) {
    if (!this.alive) return;

    const sx = this.x - camX + this.w / 2;
    const sy = this.y - camY + this.h / 2;
    const pw = this.w * this.stretch;
    const ph = this.h * this.squash;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.lean);

    /* ─ Motion trail ─ */
    this.trail.forEach((t, i) => {
      const ratio = 1 - i / this.trail.length;
      ctx.save();
      ctx.globalAlpha = t.a * ratio;
      ctx.fillStyle   = `hsl(${190 + i * 15}, 100%, 60%)`;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = '#00f5ff';
      ctx.beginPath();
      ctx.roundRect(
        t.x - camX - pw * 0.35,
        t.y - camY - ph * 0.35,
        pw * 0.7, ph * 0.7, 4
      );
      ctx.fill();
      ctx.restore();
    });

    /* ─ Body glow ─ */
    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#00f5ff';

    /* ─ Body gradient ─ */
    const grad = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    grad.addColorStop(0,   '#80ffff');
    grad.addColorStop(0.4, '#00c8ff');
    grad.addColorStop(1,   '#0044aa');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2, pw, ph, 6);
    ctx.fill();

    /* ─ Suit details ─ */
    ctx.shadowBlur = 0;

    // Visor
    const visorX = this.facing === 1 ? pw * 0.05 : -pw * 0.05;
    ctx.fillStyle   = 'rgba(255,250,200,0.95)';
    ctx.shadowBlur  = 6;
    ctx.shadowColor = '#fff8a0';
    ctx.beginPath();
    ctx.roundRect(visorX - pw * 0.22, -ph * 0.38, pw * 0.44, ph * 0.18, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Center stripe
    ctx.fillStyle   = 'rgba(0,245,255,0.3)';
    ctx.beginPath();
    ctx.roundRect(-pw * 0.07, -ph * 0.1, pw * 0.14, ph * 0.55, 3);
    ctx.fill();

    // Legs (running animation)
    const legPhase = Math.sin(this.runTimer) * (this.onGround ? 1 : 0);
    ctx.fillStyle = '#006688';

    // Left leg
    ctx.beginPath();
    ctx.roundRect(
      -pw * 0.3, ph * 0.38,
      pw * 0.24, ph * 0.18 + legPhase * 4,
      3
    );
    ctx.fill();

    // Right leg
    ctx.beginPath();
    ctx.roundRect(
      pw * 0.06, ph * 0.38,
      pw * 0.24, ph * 0.18 - legPhase * 4,
      3
    );
    ctx.fill();

    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────
   CAMERA  — smooth follow with lerp
────────────────────────────────────────────────────────── */
class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
  }

  follow(player) {
    // Target: keep player at ~30% from left, vertically centered
    this.targetX = player.centerX - this.canvas.width  * C.CAM_OFFSET_X;
    this.targetY = player.centerY - this.canvas.height * 0.5;
  }

  update(dt) {
    this.x = utils.lerp(this.x, this.targetX, C.CAM_LERP * dt);
    this.y = utils.lerp(this.y, this.targetY, C.CAM_LERP * dt);
  }
}

/* ──────────────────────────────────────────────────────────
   BACKGROUND RENDERER  — parallax cyberpunk grid
────────────────────────────────────────────────────────── */
class BackgroundRenderer {
  constructor(canvas) {
    this.canvas   = canvas;
    this.stars     = this._createStars(120);
    this.buildings = this._createBuildings(24);
  }

  _createStars(count) {
    return Array.from({ length: count }, () => ({
      x: Math.random() * 4000,
      y: Math.random() * 800,
      r: utils.rand(0.5, 2.5),
      blink: Math.random() * Math.PI * 2,
    }));
  }

  _createBuildings(count) {
    const buildings = [];
    let bx = -200;
    for (let i = 0; i < count; i++) {
      const bw = utils.randInt(60, 140);
      const bh = utils.randInt(80, 300);
      buildings.push({
        x: bx,
        y: 0,
        w: bw,
        h: bh,
        windows: this._createWindows(bx, bw, bh),
        parallax: utils.rand(0.15, 0.35),
      });
      bx += bw + utils.randInt(10, 40);
    }
    return buildings;
  }

  _createWindows(bx, bw, bh) {
    const wins = [];
    const cols = Math.floor(bw / 16);
    const rows = Math.floor(bh / 20);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > 0.45) {
          wins.push({
            x: bx + 8 + c * 16,
            y: c * 3,
            lit: Math.random() > 0.3,
            color: Math.random() > 0.7
              ? `hsl(${utils.rand(180, 220)}, 80%, 70%)`
              : `hsl(${utils.rand(40, 60)}, 80%, 80%)`,
          });
        }
      }
    }
    return wins;
  }

  draw(ctx, camX, camY, time) {
    const W = this.canvas.width;
    const H = this.canvas.height;

    /* ─ Sky gradient ─ */
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,   '#020210');
    sky.addColorStop(0.5, '#04041a');
    sky.addColorStop(1,   '#060614');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* ─ Stars ─ */
    this.stars.forEach(s => {
      const sx = ((s.x - camX * 0.05) % (W * 2) + W * 2) % (W * 2);
      const sy = s.y - camY * 0.02;
      const blink = 0.6 + 0.4 * Math.sin(time * 0.001 + s.blink);

      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle   = '#aaddff';
      ctx.shadowBlur  = s.r * 4;
      ctx.shadowColor = '#6699ff';
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    /* ─ Distant buildings (parallax) ─ */
    this.buildings.forEach(b => {
      const sx = b.x - camX * b.parallax;
      const sy = H - b.h - camY * 0.02;

      // Repeat buildings horizontally
      const repeat = Math.floor(camX * b.parallax / (W * 2));
      const drawX  = sx + repeat * W * 2;

      ctx.save();
      ctx.fillStyle = `rgba(8,8,28,0.9)`;
      ctx.fillRect(drawX, sy, b.w, b.h);

      // Windows
      b.windows.forEach(win => {
        if (!win.lit) return;
        const wx = drawX + (win.x - b.x);
        const wy = sy + win.y;
        const flicker = 0.6 + 0.4 * Math.sin(time * 0.0008 + win.x);

        ctx.globalAlpha = flicker * 0.8;
        ctx.fillStyle   = win.color;
        ctx.shadowBlur  = 6;
        ctx.shadowColor = win.color;
        ctx.fillRect(wx, wy, 8, 10);
      });

      ctx.restore();
    });

    /* ─ Grid floor lines ─ */
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth   = 1;

    const gridY    = H * 0.72;
    const gridSize = 50;
    const vp       = -(camX % gridSize);
    const vq       = -(camY * 0.1 % gridSize);

    // Horizontal lines (perspective-ish)
    for (let gy = gridY; gy < H + 20; gy += gridSize * 0.6) {
      ctx.beginPath();
      ctx.moveTo(0,  gy + vq);
      ctx.lineTo(W, gy + vq);
      ctx.stroke();
    }

    // Vertical lines
    for (let gx = vp; gx < W + gridSize; gx += gridSize) {
      ctx.beginPath();
      ctx.moveTo(gx, gridY);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }

    ctx.restore();

    /* ─ Horizon glow ─ */
    const horizGrad = ctx.createLinearGradient(0, H * 0.65, 0, H * 0.80);
    horizGrad.addColorStop(0, 'transparent');
    horizGrad.addColorStop(0.5, 'rgba(0,60,80,0.15)');
    horizGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = horizGrad;
    ctx.fillRect(0, H * 0.65, W, H * 0.15);
  }
}

/* ──────────────────────────────────────────────────────────
   INPUT MANAGER  — keyboard & mobile touch
────────────────────────────────────────────────────────── */
class InputManager {
  constructor() {
    this.keys   = {};
    this.left   = false;
    this.right  = false;
    this._jumpQueued = false;

    this._bindKeyboard();
    this._bindTouch();
  }

  get left()  { return this._left; }
  get right() { return this._right; }

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (['Space','ArrowUp','KeyW','ArrowLeft','ArrowRight','KeyA','KeyD'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys[e.code] = true;

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        this._jumpQueued = true;
      }
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }

  _bindTouch() {
    // Simple on-screen touch zones (left third / right third = move, top third = jump)
    window.addEventListener('touchstart', e => {
      [...e.changedTouches].forEach(t => {
        const x = t.clientX / window.innerWidth;
        const y = t.clientY / window.innerHeight;
        if (y < 0.4)  { this._jumpQueued = true; return; }
        if (x < 0.35) this.keys['_touchLeft']  = true;
        if (x > 0.65) this.keys['_touchRight'] = true;
      });
    }, { passive: true });

    window.addEventListener('touchend', e => {
      [...e.changedTouches].forEach(t => {
        const x = t.clientX / window.innerWidth;
        if (x < 0.35) this.keys['_touchLeft']  = false;
        if (x > 0.65) this.keys['_touchRight'] = false;
      });
    }, { passive: true });
  }

  /** Poll movement state — call each frame */
  poll() {
    this._left  = this.keys['ArrowLeft']  || this.keys['KeyA'] || this.keys['_touchLeft']  || false;
    this._right = this.keys['ArrowRight'] || this.keys['KeyD'] || this.keys['_touchRight'] || false;
  }

  /** Consume queued jump — returns true once per press */
  consumeJump() {
    if (this._jumpQueued) {
      this._jumpQueued = false;
      return true;
    }
    return false;
  }

  reset() {
    this.keys = {};
    this._jumpQueued = false;
    this._left  = false;
    this._right = false;
  }
}

/* ──────────────────────────────────────────────────────────
   PLATFORM GENERATOR  — procedural, difficulty-aware
────────────────────────────────────────────────────────── */
class PlatformGenerator {
  constructor() {
    this.lastX = 300;
    this.lastY = 400;
    this.platformsSpawned = 0;
  }

  reset(canvasH) {
    this.lastX = 200;
    this.lastY = canvasH * 0.55;
    this.platformsSpawned = 0;
  }

  /** Generate platforms until they extend past `untilX` */
  generate(platforms, untilX, diffMult, canvasH) {
    while (this.lastX < untilX) {
      const w = utils.rand(
        C.PLATFORM_MIN_W + diffMult * -30,
        C.PLATFORM_MAX_W - diffMult * 60
      );

      const gapX = utils.rand(
        C.MIN_GAP_X + diffMult * 40,
        C.MAX_GAP_X + diffMult * 80
      );

      const gapY = utils.rand(
        -C.GAP_Y_RANGE * 0.5,
         C.GAP_Y_RANGE * 0.5
      );

      let newX = this.lastX + gapX;
      let newY = utils.clamp(
        this.lastY + gapY,
        canvasH * 0.2,
        canvasH * 0.78
      );

      // Bias toward moving platforms as difficulty rises
      const isMoving   = Math.random() < 0.2 + diffMult * 0.25;
      const moveAxis   = Math.random() > 0.6 ? 'y' : 'x';
      const hasCoin    = Math.random() < 0.45;
      const colorTypes = ['cyan', 'purple', 'green'];
      const colorType  = colorTypes[Math.floor(Math.random() * colorTypes.length)];

      platforms.push(new Platform(newX, newY, Math.max(w, 55), C.PLATFORM_H, {
        moving:    isMoving,
        moveAxis,
        hasCoin,
        colorType,
        originX:   newX,
        originY:   newY,
      }));

      this.lastX = newX + Math.max(w, 55);
      this.lastY = newY;
      this.platformsSpawned++;
    }
  }
}

/* ──────────────────────────────────────────────────────────
   GAME CONTROLLER  — orchestrates everything
────────────────────────────────────────────────────────── */
class GameController {
  constructor() {
    // Canvas setup
    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this._resizeCanvas();

    // Sub-systems
    this.audio      = new AudioEngine();
    this.input      = new InputManager();
    this.particles  = new ParticleSystem();
    this.camera     = new Camera(this.canvas);
    this.bg         = new BackgroundRenderer(this.canvas);
    this.generator  = new PlatformGenerator();

    // Game state
    this.state      = 'MENU';   // 'MENU' | 'PLAYING' | 'GAMEOVER'
    this.score      = 0;
    this.coins      = 0;
    this.bestScore  = parseInt(localStorage.getItem('neonrun_best') ?? '0', 10);
    this.difficulty = 0;
    this.time       = 0;

    // Entities
    this.player    = null;
    this.platforms = [];

    // RAF handle
    this._rafId   = null;
    this._lastTS  = 0;

    // UI elements
    this.ui = {
      startScreen:   document.getElementById('startScreen'),
      gameOverScreen:document.getElementById('gameOverScreen'),
      hud:           document.getElementById('hud'),
      startBtn:      document.getElementById('startBtn'),
      restartBtn:    document.getElementById('restartBtn'),
      menuBtn:       document.getElementById('menuBtn'),
      hudScore:      document.getElementById('hudScore'),
      hudCoins:      document.getElementById('hudCoins'),
      hudLevel:      document.getElementById('hudLevel'),
      pip1:          document.getElementById('pip1'),
      pip2:          document.getElementById('pip2'),
      finalScore:    document.getElementById('finalScore'),
      finalCoins:    document.getElementById('finalCoins'),
      bestScore:     document.getElementById('bestScore'),
    };

    this._bindUI();
    this._bindResize();

    // Start the render loop immediately (renders menu BG)
    this._loop(0);
  }

  /* ─ UI Bindings ──────────────────────────────────────── */
  _bindUI() {
    this.ui.startBtn.addEventListener('click', () => {
      this.audio.resume();
      this._startGame();
    });
    this.ui.restartBtn.addEventListener('click', () => {
      this.audio.resume();
      this._startGame();
    });
    this.ui.menuBtn.addEventListener('click', () => {
      this._showMenu();
    });
  }

  _bindResize() {
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this.bg) this.bg.canvas = this.canvas;
    if (this.camera) this.camera.canvas = this.canvas;
  }

  /* ─ State transitions ────────────────────────────────── */
  _showMenu() {
    this.state = 'MENU';
    this.ui.startScreen.classList.remove('hidden');
    this.ui.gameOverScreen.classList.add('hidden');
    this.ui.hud.classList.add('hidden');
    this.input.reset();
  }

  _startGame() {
    const H = this.canvas.height;
    const W = this.canvas.width;

    // Reset systems
    this.platforms = [];
    this.particles.clear();
    this.score      = 0;
    this.coins      = 0;
    this.difficulty = 0;
    this.time       = 0;
    this.input.reset();
    this.generator.reset(H);

    // Create starting platform
    const startPlat = new Platform(60, H * 0.6, 260, C.PLATFORM_H, {
      colorType: 'cyan'
    });
    this.platforms.push(startPlat);

    // Generate ahead
    this.generator.generate(this.platforms, W + C.SPAWN_BUFFER, 0, H);

    // Spawn player on start platform
    this.player = new Player(
      startPlat.x + 40,
      startPlat.y - 42
    );

    // Camera — snap (no lerp) to player
    this.camera.x = this.player.centerX - W * C.CAM_OFFSET_X;
    this.camera.y = this.player.centerY - H * 0.5;
    this.camera.targetX = this.camera.x;
    this.camera.targetY = this.camera.y;

    // UI
    this.state = 'PLAYING';
    this.ui.startScreen.classList.add('hidden');
    this.ui.gameOverScreen.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
  }

  _endGame() {
    this.state = 'GAMEOVER';
    this.audio.gameOver();

    // Explosion of particles
    if (this.player) {
      this.particles.burst(this.player.centerX, this.player.centerY, 40, {
        color: '#ff006e'
      });
    }

    // Save best score
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      localStorage.setItem('neonrun_best', String(this.bestScore));
    }

    // Update DOM
    this.ui.finalScore.textContent = this.score;
    this.ui.finalCoins.textContent = this.coins;
    this.ui.bestScore.textContent  = this.bestScore;

    setTimeout(() => {
      this.ui.hud.classList.add('hidden');
      this.ui.gameOverScreen.classList.remove('hidden');
    }, 600);
  }

  /* ─ Main Game Loop ───────────────────────────────────── */
  _loop(timestamp) {
    this._rafId = requestAnimationFrame(ts => this._loop(ts));

    const rawDt = Math.min((timestamp - this._lastTS) / 1000, 0.05);
    this._lastTS = timestamp;
    this.time    = timestamp;

    // Normalise dt to 60fps units for physics consistency
    const dt = rawDt * 60;

    this._update(dt, timestamp);
    this._draw(timestamp);
  }

  /* ─ Update ───────────────────────────────────────────── */
  _update(dt, time) {
    this.input.poll();

    if (this.state !== 'PLAYING') {
      this.particles.update(dt);
      return;
    }

    /* ─ Difficulty curve ─ */
    this.difficulty = Math.min(
      C.DIFF_MAX,
      this.difficulty + C.DIFF_INCREASE * dt
    );

    /* ─ Score ─ */
    if (this.player) {
      const rawScore = Math.floor(
        Math.max(0, this.player.x - 200) / C.SCORE_DIVISOR
      );
      this.score = rawScore;
    }

    /* ─ Update platforms ─ */
    this.platforms.forEach(p => p.update(dt, this.difficulty));

    /* ─ Cull off-screen platforms ─ */
    const cullX = this.camera.x - 300;
    this.platforms = this.platforms.filter(p => p.x + p.w > cullX);

    /* ─ Generate new platforms ahead ─ */
    const genUntil = this.camera.x + this.canvas.width + C.SPAWN_BUFFER;
    this.generator.generate(this.platforms, genUntil, this.difficulty, this.canvas.height);

    /* ─ Player ─ */
    if (this.player && this.player.alive) {
      // Jump input
      if (this.input.consumeJump() && this.player.jumpCount < this.player.maxJumps) {
        const force = this.player.jumpCount === 0 ? C.JUMP_FORCE : C.DOUBLE_JUMP;
        this.player.jump(force, this.audio, this.particles);
      }

      this.player.update(dt, this.input, this.platforms, this.particles, this.audio, this.difficulty);

      /* ─ Coin collection ─ */
      this.platforms.forEach(plat => {
        if (!plat.coin || plat.coin.collected) return;
        const pb = plat.coin.bounds;
        const pl = this.player.bounds;

        if (
          pl.x < pb.x + pb.w && pl.x + pl.w > pb.x &&
          pl.y < pb.y + pb.h && pl.y + pl.h > pb.y
        ) {
          plat.coin.collected = true;
          this.coins++;
          this.audio.coin();
          this.particles.burst(plat.coin.x, plat.coin.y, C.COIN_PARTICLE, {
            color: '#ffd60a'
          });
        }
      });

      /* ─ Death: fall off screen ─ */
      if (this.player.y > this.canvas.height + this.camera.y + 200) {
        this.player.alive = false;
        this._endGame();
      }
    }

    /* ─ Camera ─ */
    if (this.player && this.player.alive) {
      this.camera.follow(this.player);
    }
    this.camera.update(dt);

    /* ─ Particles ─ */
    this.particles.update(dt);

    /* ─ HUD update ─ */
    this._updateHUD();
  }

  _updateHUD() {
    this.ui.hudScore.innerHTML = `${this.score}<span class="hud-unit">m</span>`;
    this.ui.hudCoins.textContent = this.coins;
    this.ui.hudLevel.textContent = Math.floor(this.difficulty * 10) + 1;

    // Jump pip indicators
    if (this.player) {
      const jc = this.player.jumpCount;
      this.ui.pip1.className = 'pip' + (jc >= 1 ? ' spent' : ' active');
      this.ui.pip2.className = 'pip' + (jc >= 2 ? ' spent' : ' active');
    }
  }

  /* ─ Draw ─────────────────────────────────────────────── */
  _draw(timestamp) {
    const ctx    = this.ctx;
    const W      = this.canvas.width;
    const H      = this.canvas.height;
    const camX   = this.camera.x;
    const camY   = this.camera.y;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background
    this.bg.draw(ctx, camX, camY, timestamp);

    if (this.state === 'MENU') {
      this._drawMenuBg(ctx, W, H, timestamp);
      return;
    }

    // Platforms
    this.platforms.forEach(p => {
      p.draw(ctx, camX, camY);
      if (p.coin && !p.coin.collected) {
        p.coin.draw(ctx, camX, camY, timestamp);
      }
    });

    // Player
    if (this.player) this.player.draw(ctx, camX, camY);

    // Particles
    this.particles.draw(ctx, camX, camY);

    // Vignette
    this._drawVignette(ctx, W, H);
  }

  _drawMenuBg(ctx, W, H, t) {
    // Animated preview platforms
    const samplePlatforms = [
      { x: 100,  y: H * 0.65, w: 180, phase: 0   },
      { x: 360,  y: H * 0.55, w: 140, phase: 1.0 },
      { x: 580,  y: H * 0.70, w: 160, phase: 2.0 },
      { x: 820,  y: H * 0.60, w: 120, phase: 0.5 },
    ];

    samplePlatforms.forEach(p => {
      const ox = Math.sin(t * 0.0008 + p.phase) * 30;
      ctx.save();
      ctx.shadowBlur  = 16;
      ctx.shadowColor = 'rgba(0,245,255,0.4)';
      const grad = ctx.createLinearGradient(p.x + ox, p.y, p.x + ox, p.y + 14);
      grad.addColorStop(0, '#00f5ff');
      grad.addColorStop(1, '#0044aa');
      ctx.fillStyle   = grad;
      ctx.beginPath();
      ctx.roundRect(p.x + ox, p.y, p.w, 14, 4);
      ctx.fill();
      ctx.restore();
    });
  }

  _drawVignette(ctx, W, H) {
    const vg = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.85);
    vg.addColorStop(0, 'transparent');
    vg.addColorStop(1, 'rgba(0,0,10,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
}

/* ──────────────────────────────────────────────────────────
   ENTRY POINT  — wait for DOM, boot game
────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Polyfill roundRect for older browsers
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const radius = typeof r === 'number' ? r : r?.[0] ?? 0;
      this.moveTo(x + radius, y);
      this.lineTo(x + w - radius, y);
      this.quadraticCurveTo(x + w, y, x + w, y + radius);
      this.lineTo(x + w, y + h - radius);
      this.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      this.lineTo(x + radius, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - radius);
      this.lineTo(x, y + radius);
      this.quadraticCurveTo(x, y, x + radius, y);
      this.closePath();
      return this;
    };
  }

  // Boot
  window.game = new GameController();
});
