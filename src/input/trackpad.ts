/**
 * Trackpad (or mouse) steering.
 *
 * Click the game to capture the pointer (Pointer Lock); then sliding a finger left/right
 * moves the steering. `range` = pixels of finger travel from centre to full lock.
 * When you stop moving, steering drifts back to centre at `centering` per second
 * (0 = it stays where you leave it). If pointer lock is refused, the cursor's horizontal
 * position on screen steers instead.
 */
const STILL_TIME = 0.06; // s without movement before centring kicks in

export class TrackpadSteer {
  enabled = false;
  range = 260;
  centering = 1.5;
  steer = 0;
  private locked = false;
  private sinceMove = 0;
  private absoluteX: number | null = null;
  /** Called when the browser releases the pointer (e.g. Esc), so the game can pause. */
  onRelease: (() => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    target.addEventListener('click', () => {
      if (this.enabled && !this.locked) void this.target.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.target;
      if (was && !this.locked) {
        this.steer = 0;
        this.onRelease?.();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        // Finger right = steer right = negative steer in our convention.
        this.steer = Math.max(-1, Math.min(1, this.steer - e.movementX / this.range));
        this.sinceMove = 0;
      } else {
        this.absoluteX = e.clientX;
      }
    });
  }

  get captured(): boolean {
    return this.locked;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.steer = 0;
    if (!on && this.locked) document.exitPointerLock();
  }

  update(dt: number): number {
    if (!this.enabled) return 0;
    if (!this.locked) {
      // Fallback: cursor position across the screen (centre = straight).
      if (this.absoluteX === null) return 0;
      const half = window.innerWidth / 2;
      this.steer = Math.max(-1, Math.min(1, -(this.absoluteX - half) / Math.min(half, this.range * 1.5)));
      return this.steer;
    }
    this.sinceMove += dt;
    if (this.sinceMove > STILL_TIME && this.centering > 0) this.steer *= Math.exp(-this.centering * dt);
    return this.steer;
  }
}
