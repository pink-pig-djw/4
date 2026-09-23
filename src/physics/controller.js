// First-person character controller on top of CollisionWorld. Pure JS.
export const PLAYER = {
  radius: 0.3,
  height: 1.78,
  eye: 1.64,
  walk: 2.3,        // m/s (a bit brisker than real walking so the campus doesn't feel huge)
  run: 5.4,
  jump: 4.7,        // initial vertical speed → ~1.1 m jump
  gravity: 14.5,
  stepUp: 0.42,     // max step (stairs are ramps, but kerbs/benches edges use this)
  snapDown: 0.55,   // stick to ramps/stairs when walking down
  accelGround: 38,
  accelAir: 6,
};

export class Controller {
  constructor(world, x = 0, z = 0, y = 0) {
    this.world = world;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.onGround = true;
    this.safe = { x, y, z, t: 0 };
    this.stuckTime = 0;
    this.lastMoveX = x; this.lastMoveZ = z;
    this.speed = 0;
    this.airTime = 0;
    this.events = []; // 'land', 'jump', 'respawn'
    this.boundsSoft = null;
  }

  teleport(x, z, y = null, yaw = null) {
    const w = this.world;
    if (y == null) y = w.groundHeight(x, z, 0.5); // default: ground level (never onto roofs)
    this.x = x; this.z = z; this.y = y;
    this.vx = this.vy = this.vz = 0;
    if (yaw != null) this.yaw = yaw;
    const r = w.resolve(this.x, this.z, PLAYER.radius, this.y, this.y + PLAYER.height, PLAYER.stepUp);
    this.x = r.x; this.z = r.z;
    this.y = w.groundHeight(this.x, this.z, this.y + PLAYER.stepUp);
    this.onGround = true;
    this.safe = { x: this.x, y: this.y, z: this.z, t: 0 };
  }

  // input: {fx, fz} desired move in local frame (fx right, fz forward), run, jump (edge-triggered)
  step(dt, input) {
    const P = PLAYER, w = this.world;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // yaw = 0 looks toward -z (north). Forward vector = (-sin, -cos); right = (cos, -sin)
    let mx = input.fx * cy - input.fz * sy;
    let mz = -input.fx * sy - input.fz * cy;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const target = input.run ? P.run : P.walk;
    const tvx = mx * target, tvz = mz * target;
    const acc = (this.onGround ? P.accelGround : P.accelAir) * dt;
    const dvx = tvx - this.vx, dvz = tvz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= acc) { this.vx = tvx; this.vz = tvz; }
    else { this.vx += dvx / dl * acc; this.vz += dvz / dl * acc; }

    if (input.jump && this.onGround) {
      this.vy = P.jump; this.onGround = false; this.events.push('jump');
    }

    // --- horizontal move with collision ---
    const px = this.x, pz = this.z;
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const r = w.resolve(nx, nz, P.radius, this.y, this.y + P.height, this.onGround ? P.stepUp : 0.12);
    nx = r.x; nz = r.z;

    // Step-up must also have head room at the new spot
    let ground = w.groundHeight(nx, nz, this.y + (this.onGround ? P.stepUp : 0.12));
    const ceil = w.ceilingHeight(nx, nz, ground + 0.5);
    if (ceil - ground < P.height * 0.95) { nx = px; nz = pz; ground = w.groundHeight(px, pz, this.y + P.stepUp); }

    // keep inside soft bounds
    if (this.boundsSoft) {
      const [x0, z0, x1, z1] = this.boundsSoft;
      nx = Math.min(Math.max(nx, x0), x1); nz = Math.min(Math.max(nz, z0), z1);
    }

    // actual velocity after collisions (so we don't accumulate speed into walls)
    if (dt > 0) {
      const avx = (nx - px) / dt, avz = (nz - pz) / dt;
      if (r.hits) { this.vx = avx; this.vz = avz; }
    }
    this.x = nx; this.z = nz;

    // --- vertical ---
    this.vy -= P.gravity * dt;
    let ny = this.y + this.vy * dt;
    const gh = w.groundHeight(this.x, this.z, Math.max(this.y, ny) + (this.onGround ? P.stepUp : 0.12));
    const wasGround = this.onGround;
    if (ny <= gh) {
      if (!wasGround && this.airTime > 0.25) this.events.push('land');
      ny = gh; this.vy = 0; this.onGround = true;
    } else if (wasGround && this.vy <= 0 && ny - gh <= P.snapDown) {
      ny = gh; this.vy = 0; this.onGround = true;
    } else {
      this.onGround = false;
    }
    // head
    const ch = w.ceilingHeight(this.x, this.z, ny + 0.6);
    if (ny + P.height > ch) { ny = Math.max(gh, ch - P.height); if (this.vy > 0) this.vy = 0; }
    this.y = ny;
    this.airTime = this.onGround ? 0 : this.airTime + dt;

    // --- safety net ---
    if (this.y < -15 || !Number.isFinite(this.x + this.y + this.z)) {
      this.x = this.safe.x; this.y = this.safe.y; this.z = this.safe.z;
      this.vx = this.vy = this.vz = 0; this.onGround = true;
      this.events.push('respawn');
    }
    this.safe.t += dt;
    if (this.onGround && this.safe.t > 0.5 && w.isFree(this.x, this.z, P.radius * 0.9, this.y, this.y + P.height)) {
      this.safe.x = this.x; this.safe.y = this.y; this.safe.z = this.z; this.safe.t = 0;
    }
    this.speed = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-6);
  }
}
