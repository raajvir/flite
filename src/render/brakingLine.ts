/**
 * Braking line assist: the racing line drawn on the road ahead of the player,
 * coloured live from the player's speed vs the speed plan:
 *   green  = you can stay flat out here
 *   yellow = you'll need to slow down for what's ahead, but not hard yet
 *   red    = to make the corner from your current speed you need to be braking now
 * Uses the same RacingPlan as the AI (built for the player's car).
 */
import * as THREE from 'three';
import { planBrakingDecel, type RacingPlan } from '../ai/aiDriver';
import type { CarParams } from '../sim/params';
import type { TrackWorld } from '../sim/trackWorld';

export const BRAKING_LINE = {
  ahead: 320, // m drawn ahead of the car
  behind: 6, // m drawn behind
  step: 2, // m per segment
  width: 0.7, // m
  lift: 0.05, // m above the road
  redFraction: 0.75, // red when the braking needed is above this share of the plan's braking (early warning)
  margin: 1.5, // m/s: within this of the plan counts as "on pace" (green)
  green: 0x2ecc40,
  yellow: 0xffd21f,
  red: 0xff3b30,
  opacity: 0.85,
};

export class BrakingLine {
  private readonly segs: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly mesh: THREE.Mesh;
  private readonly cGreen = new THREE.Color(BRAKING_LINE.green);
  private readonly cYellow = new THREE.Color(BRAKING_LINE.yellow);
  private readonly cRed = new THREE.Color(BRAKING_LINE.red);
  private plan: RacingPlan | null = null;
  private params: CarParams | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly world: TrackWorld,
  ) {
    const t = BRAKING_LINE;
    this.segs = Math.ceil((t.ahead + t.behind) / t.step);
    this.pos = new Float32Array(this.segs * 6 * 3);
    this.col = new Float32Array(this.segs * 6 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: t.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -12,
      }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  setPlan(plan: RacingPlan, p: CarParams): void {
    this.plan = plan;
    this.params = p;
  }

  update(carX: number, carZ: number, speed: number): void {
    if (!this.mesh.visible || !this.plan || !this.params) return;
    const t = BRAKING_LINE;
    const w = this.world;
    const p = this.params;
    const s0 = w.project(carX, carZ).s;

    const colorAt = (s: number): THREE.Color => {
      const ahead = Math.max(1, w.wrap(s - s0));
      const v = this.plan!.speedAt(s);
      if (ahead > t.ahead || v >= speed - t.margin) return this.cGreen;
      const needed = (speed * speed - v * v) / (2 * ahead);
      // Braking power fades with downforce as the car slows: judge against the plan's
      // braking at the mid-energy speed between now and the corner.
      const available = planBrakingDecel(p, this.plan!.skill, Math.sqrt((speed * speed + v * v) / 2));
      return needed >= t.redFraction * available ? this.cRed : this.cYellow;
    };
    const edge = (s: number) => {
      const d = w.at(w.raceD, s);
      const a = w.point(s, d + t.width / 2), b = w.point(s, d - t.width / 2);
      const ha = w.heightAt(s, d).h + t.lift;
      return [a.x, ha, a.z, b.x, ha, b.z];
    };

    let prev = edge(s0 - t.behind);
    let prevC = colorAt(s0 - t.behind);
    for (let k = 0; k < this.segs; k++) {
      const s = s0 - t.behind + (k + 1) * t.step;
      const cur = edge(s);
      const c = colorAt(s);
      const o = k * 18;
      // Two triangles: prevL, prevR, curR / prevL, curR, curL
      const v = [prev[0]!, prev[1]!, prev[2]!, prev[3]!, prev[4]!, prev[5]!, cur[3]!, cur[4]!, cur[5]!, prev[0]!, prev[1]!, prev[2]!, cur[3]!, cur[4]!, cur[5]!, cur[0]!, cur[1]!, cur[2]!];
      this.pos.set(v, o);
      const cols = [prevC, prevC, c, prevC, c, c];
      cols.forEach((cc, j) => this.col.set([cc.r, cc.g, cc.b], o + j * 3));
      prev = cur;
      prevC = c;
    }
    const g = this.mesh.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
  }
}
