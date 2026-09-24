import * as THREE from 'three';

// All positions are in the player rig's tracking space. Stick movement and
// smooth turning must never contribute to a charge or a throw.
export class BlastGesture {
  constructor() {
    this.relative = new THREE.Vector3();
    this.previousRelative = new THREE.Vector3();
    this.strokeDirection = new THREE.Vector3();
    this.delta = new THREE.Vector3();
    this.leftDelta = new THREE.Vector3();
    this.rightDelta = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.history = [];
    this.reset();
  }

  reset() {
    this.active = false;
    this.charge = 0;
    this.motion = 0;
    this.time = 0;
    this.poseLost = 0;
    this.releaseTime = 0;
    this.locked = false;
    this.strokes = 0;
    this.strokeLength = 0;
    this.reverseLength = 0;
    this.lastStroke = -100;
    this.strokeDirection.set(0, 0, 0);
    this.history.length = 0;
    this.message = 'Hold A · palms facing';
  }

  cancel(message) {
    this.active = false;
    this.charge = 0;
    this.motion = 0;
    this.poseLost = 0;
    this.history.length = 0;
    this.message = message;
  }

  update(dt, sample) {
    this.time += dt;
    if (!sample?.tracked || dt <= 0 || dt > 0.09) {
      this.cancel('Bring both controllers into view');
      return null;
    }
    const { left, right, leftNormal, rightNormal, head, forward, held } = sample;
    this.relative.subVectors(right, left);
    const separation = this.relative.length();
    this.delta.copy(this.relative).normalize();
    const facing = leftNormal.dot(this.delta) > 0.22 && rightNormal.dot(this.delta) < -0.22;
    const inRange = separation > 0.13 && separation < 0.8;
    const pose = inRange && facing;

    if (this.locked) {
      if (!held) this.locked = false;
      this.previousRelative.copy(this.relative);
      this.message = 'Release A to charge again';
      return null;
    }
    if (!this.active) {
      this.message = !held ? 'Hold A · palms facing' : !inRange
        ? 'Hands about 20–60 cm apart' : !facing ? 'Turn your palms toward each other' : 'Move hands back and forth';
      if (held && pose) {
        this.active = true;
        this.charge = 0.04;
        this.releaseTime = 0;
        this.strokes = 0;
        this.strokeLength = 0;
        this.reverseLength = 0;
        this.strokeDirection.set(0, 0, 0);
        this.lastStroke = -100;
        this.history.length = 0;
      }
      this.previousRelative.copy(this.relative);
      return null;
    }

    // Short grace periods allow wrists to open and A to be released during
    // the actual thrust; simply releasing the button never fires a blast.
    this.releaseTime = held ? 0 : this.releaseTime + dt;
    this.poseLost = pose ? 0 : this.poseLost + dt;
    if (this.releaseTime > 0.2 || this.poseLost > 0.65 || separation > 1.15) {
      this.cancel('Hold A · palms facing');
      return null;
    }

    this.leftDelta.copy(left).sub(head);
    this.rightDelta.copy(right).sub(head);
    const oldest = this.history[0];
    if (oldest && this.charge >= 0.22) {
      const elapsed = this.time - oldest.time;
      this.leftDelta.sub(oldest.left);
      this.rightDelta.sub(oldest.right);
      const lp = this.leftDelta.dot(forward);
      const rp = this.rightDelta.dot(forward);
      const common = (lp + rp) * 0.5;
      // Both hands must advance together. Alternating charging strokes,
      // one-handed swings, and normal controller jitter cannot launch it.
      if (elapsed >= 0.075 && common > 0.09 && common / elapsed > 0.68 &&
          lp > 0.065 && rp > 0.065 && Math.min(lp, rp) / Math.max(lp, rp) > 0.42) {
        this.direction.addVectors(this.leftDelta, this.rightDelta).normalize();
        if (this.direction.dot(forward) > 0.55) {
          const shot = { charge: this.charge, direction: this.direction.clone() };
          this.cancel('Release A to charge again');
          this.locked = true;
          return shot;
        }
      }
    }
    this.history.push({ time: this.time, left: left.clone().sub(head), right: right.clone().sub(head) });
    while (this.history.length > 1 && this.time - this.history[0].time > 0.14) this.history.shift();

    this.delta.subVectors(this.relative, this.previousRelative);
    this.previousRelative.copy(this.relative);
    // Project out squeezing/apart motion: charging is rubbing/orbiting the
    // hands parallel to the palm plane, not clapping the controllers.
    const axis = this.relative.clone().normalize();
    this.delta.addScaledVector(axis, -this.delta.dot(axis));
    const distance = this.delta.length();
    const speed = distance / dt;
    const validMotion = pose && held && speed > 0.12 && speed < 4;
    this.motion = THREE.MathUtils.lerp(this.motion, validMotion ? Math.min(speed / 1.2, 1) : 0, 1 - Math.exp(-12 * dt));

    if (validMotion) {
      if (this.strokeDirection.lengthSq() === 0) this.strokeDirection.copy(this.delta).normalize();
      const along = this.delta.dot(this.strokeDirection);
      if (along >= 0) {
        this.strokeLength += distance;
        this.reverseLength = Math.max(0, this.reverseLength - distance);
      } else {
        this.reverseLength += distance;
        if (this.reverseLength > 0.028) {
          if (this.strokeLength > 0.045) {
            this.strokes++;
            this.lastStroke = this.time;
          }
          this.strokeDirection.copy(this.delta).normalize();
          this.strokeLength = this.reverseLength;
          this.reverseLength = 0;
        }
      }
      if (this.strokes > 0 && this.time - this.lastStroke < 0.85) {
        this.charge = Math.min(1, this.charge + Math.min(speed, 1.5) * dt * 0.42);
      }
    }
    this.message = this.charge >= 0.99 ? 'FULL CHARGE · push both hands forward'
      : this.charge >= 0.22 ? 'READY · push both hands forward' : 'Slide hands back and forth to charge';
    return null;
  }
}
