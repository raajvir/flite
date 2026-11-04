/**
 * Low-poly scenery built from data/tracks/<name>/scenery.json:
 * grandstands, pit building, race-control tower, footbridges, start-light
 * gantry and trees. Generic, original shapes; positions follow the track via
 * TrackWorld so everything sits behind the walls.
 */
import * as THREE from 'three';
import type { TrackWorld } from '../sim/trackWorld';
import { Builder } from './meshBuilder';

export interface SceneryFile {
  grandstands: { s_start: number; s_end: number; side: 'left' | 'right'; gap: number; rows: number; roof: boolean }[];
  pits?: { s_start: number; s_end: number; side: 'left' | 'right'; gap: number; depth: number; height: number };
  towers?: { s: number; side: 'left' | 'right'; gap: number; height: number }[];
  bridges?: { s: number }[];
  gantry?: { s: number };
  trees?: { every: number; perStation: number; minGap: number; maxGap: number; clearance: number; seed: number };
}

const STEP = 4; // m along the track per scenery segment
const ROW_DEPTH = 0.9; // m per grandstand row
const ROW_RISE = 0.55; // m per grandstand row
const STAND_FRONT_WALL = 1.6; // m
const ROOF_CLEARANCE = 3; // m above the top row
const COLORS = {
  standFront: '#2f6fb3',
  standSide: '#e9edf2',
  roof: '#d8dde3',
  column: '#9aa3ad',
  seat: '#c9ced6',
  crowd: ['#e74c3c', '#f1c40f', '#ecf0f1', '#3498db', '#2c3e50', '#e67e22', '#9b59b6', '#1abc9c', '#d35400', '#bdc3c7'],
  pitWall: '#f2f2f2',
  pitDoor: '#2a2f36',
  pitGlass: '#4a90c2',
  pitRoof: '#8a8f96',
  tower: '#e9edf2',
  bridge: '#f2f2f2',
  bridgeBand: '#2f6fb3',
  gantry: '#30353c',
  lightOff: 0x3a0a0a,
  lightOn: 0xff2a1a,
  trunk: 0x7a5230,
  leaves: [0x3f8f3a, 0x4fa144, 0x357a32, 0x5bb04c, 0x2f6b2d],
};

/** Small deterministic RNG (mulberry32), so scenery is the same every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stations(world: TrackWorld, s0: number, s1: number, step = STEP): number[] {
  const span = world.wrap(s1 - s0) || world.length;
  const out: number[] = [];
  for (let d = 0; d < span; d += step) out.push(s0 + d);
  out.push(s0 + span);
  return out;
}

export interface Scenery {
  group: THREE.Group;
  /** Light up n of the 5 start lights (0 = all off). */
  setStartLights(n: number): void;
}

export function buildScenery(world: TrackWorld, file: SceneryFile): Scenery {
  const group = new THREE.Group();
  const b = new Builder();
  const rand = rng(file.trees?.seed ?? 1);

  /** World point at offset `off` beyond the track edge on a side, at height y. */
  const P = (s: number, left: boolean, off: number, y: number): number[] => {
    const edge = world.at(left ? world.wl : world.wr, s);
    const d = (left ? 1 : -1) * (edge + off);
    const p = world.point(s, d);
    return [p.x, Math.max(0, world.heightAt(s, d).h) + y, p.z];
  };
  const wall = (s: number, left: boolean) => world.wallAt(s, left);
  /** Exclusion zones for trees: [s0, s1, side, inner offset, outer offset]. */
  const zones: { s0: number; s1: number; left: boolean; o0: number; o1: number }[] = [];

  // --- Grandstands: stepped rows of crowd, a coloured front wall, optional roof.
  for (const g of file.grandstands) {
    const left = g.side === 'left';
    const st = stations(world, g.s_start, g.s_end);
    const depth = g.rows * ROW_DEPTH;
    zones.push({ s0: g.s_start, s1: g.s_end, left, o0: 0, o1: Infinity });
    for (let k = 0; k < st.length - 1; k++) {
      const a = st[k]!, c = st[k + 1]!;
      const oa = wall(a, left) + g.gap, oc = wall(c, left) + g.gap;
      // Front wall.
      b.quad(P(a, left, oa, 0), P(c, left, oc, 0), P(c, left, oc, STAND_FRONT_WALL), P(a, left, oa, STAND_FRONT_WALL), COLORS.standFront);
      for (let r = 0; r < g.rows; r++) {
        const y0 = STAND_FRONT_WALL + r * ROW_RISE;
        const y1 = y0 + ROW_RISE;
        const ra = oa + r * ROW_DEPTH, rc = oc + r * ROW_DEPTH;
        // Riser (faces the track) and the row's top: crowd colours.
        const crowd = COLORS.crowd[Math.floor(rand() * COLORS.crowd.length)]!;
        b.quad(P(a, left, ra, y0), P(c, left, rc, y0), P(c, left, rc, y1), P(a, left, ra, y1), rand() < 0.25 ? COLORS.seat : crowd);
        b.quad(P(a, left, ra, y1), P(c, left, rc, y1), P(c, left, rc + ROW_DEPTH, y1), P(a, left, ra + ROW_DEPTH, y1), COLORS.seat);
      }
      // Back wall.
      const top = STAND_FRONT_WALL + g.rows * ROW_RISE;
      b.quad(P(a, left, oa + depth, 0), P(c, left, oc + depth, 0), P(c, left, oc + depth, top), P(a, left, oa + depth, top), COLORS.standSide);
      if (g.roof) {
        const yr = top + ROOF_CLEARANCE;
        b.quad(P(a, left, oa - 1, yr), P(c, left, oc - 1, yr), P(c, left, oc + depth, yr), P(a, left, oa + depth, yr), COLORS.roof);
        if (k % 3 === 0) {
          // Column at the back holding the roof.
          const p0 = P(a, left, oa + depth - 0.3, 0), p1 = P(a, left, oa + depth - 0.3, yr);
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, yr, 0.4), new THREE.MeshLambertMaterial({ color: COLORS.column }));
          col.position.set(p0[0]!, (p0[1]! + p1[1]!) / 2, p0[2]!);
          group.add(col);
        }
      }
    }
    // End caps.
    for (const s of [g.s_start, g.s_end]) {
      const o = wall(s, left) + g.gap;
      const top = STAND_FRONT_WALL + g.rows * ROW_RISE;
      b.quad(P(s, left, o, 0), P(s, left, o + depth, 0), P(s, left, o + depth, top), P(s, left, o, STAND_FRONT_WALL), COLORS.standSide);
    }
  }

  // --- Pit building: garage doors facing the track, glass band above, flat roof.
  if (file.pits) {
    const pt = file.pits;
    const left = pt.side === 'left';
    zones.push({ s0: pt.s_start, s1: pt.s_end, left, o0: 0, o1: Infinity });
    const st = stations(world, pt.s_start, pt.s_end, 5);
    for (let k = 0; k < st.length - 1; k++) {
      const a = st[k]!, c = st[k + 1]!;
      const oa = wall(a, left) + pt.gap, oc = wall(c, left) + pt.gap;
      const door = k % 2 === 0;
      b.quad(P(a, left, oa, 0), P(c, left, oc, 0), P(c, left, oc, 4.5), P(a, left, oa, 4.5), door ? COLORS.pitDoor : COLORS.pitWall);
      b.quad(P(a, left, oa, 4.5), P(c, left, oc, 4.5), P(c, left, oc, 6.5), P(a, left, oa, 6.5), COLORS.pitWall);
      b.quad(P(a, left, oa, 6.5), P(c, left, oc, 6.5), P(c, left, oc, pt.height - 0.8), P(a, left, oa, pt.height - 0.8), COLORS.pitGlass);
      b.quad(P(a, left, oa, pt.height - 0.8), P(c, left, oc, pt.height - 0.8), P(c, left, oc, pt.height), P(a, left, oa, pt.height), COLORS.pitWall);
      b.quad(P(a, left, oa, pt.height), P(c, left, oc, pt.height), P(c, left, oc + pt.depth, pt.height), P(a, left, oa + pt.depth, pt.height), COLORS.pitRoof);
      b.quad(P(a, left, oa + pt.depth, 0), P(c, left, oc + pt.depth, 0), P(c, left, oc + pt.depth, pt.height), P(a, left, oa + pt.depth, pt.height), COLORS.pitWall);
    }
  }

  // --- Race-control tower: a block with a glass cabin on top.
  for (const t of file.towers ?? []) {
    const left = t.side === 'left';
    zones.push({ s0: t.s - 15, s1: t.s + 15, left, o0: 0, o1: Infinity });
    const base = P(t.s, left, wall(t.s, left) + t.gap, 0);
    const h = world.headingAt(t.s);
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, t.height, 8), new THREE.MeshLambertMaterial({ color: COLORS.tower, flatShading: true }));
    body.position.set(base[0]!, base[1]! + t.height / 2, base[2]!);
    body.rotation.y = h;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(11, 3.5, 11), new THREE.MeshLambertMaterial({ color: COLORS.pitGlass, flatShading: true }));
    cabin.position.set(base[0]!, base[1]! + t.height + 1.75, base[2]!);
    cabin.rotation.y = h;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(12, 0.6, 12), new THREE.MeshLambertMaterial({ color: COLORS.pitRoof }));
    cap.position.set(base[0]!, base[1]! + t.height + 3.8, base[2]!);
    cap.rotation.y = h;
    for (const m of [body, cabin, cap]) {
      m.castShadow = true;
      group.add(m);
    }
  }

  // --- Footbridges and the start gantry: beams across the track on pillars behind the walls.
  const span = (s: number, height: number, thickness: number, depth: number, color: string, band: string | null) => {
    const wl = world.at(world.wl, s) + world.wallAt(s, true) + 2;
    const wr = world.at(world.wr, s) + world.wallAt(s, false) + 2;
    const mid = world.point(s, (wl - wr) / 2);
    const h = world.headingAt(s);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(wl + wr, thickness, depth), new THREE.MeshLambertMaterial({ color, flatShading: true }));
    deck.position.set(mid.x, height, mid.z);
    deck.rotation.y = h;
    deck.castShadow = true;
    group.add(deck);
    if (band) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(wl + wr + 0.02, thickness * 0.35, depth + 0.02), new THREE.MeshLambertMaterial({ color: band }));
      stripe.position.set(mid.x, height, mid.z);
      stripe.rotation.y = h;
      group.add(stripe);
    }
    for (const d of [wl - 0.5, -(wr - 0.5)]) {
      const p = world.point(s, d);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1), new THREE.MeshLambertMaterial({ color }));
      pillar.position.set(p.x, height / 2, p.z);
      pillar.rotation.y = h;
      pillar.castShadow = true;
      group.add(pillar);
    }
    return { mid, h };
  };
  for (const br of file.bridges ?? []) {
    span(br.s, 7, 1.2, 3.5, COLORS.bridge, COLORS.bridgeBand);
    for (const left of [true, false]) zones.push({ s0: br.s - 10, s1: br.s + 10, left, o0: 0, o1: 30 });
  }

  // Start gantry with five red lights over the track.
  const lights: THREE.MeshBasicMaterial[] = [];
  if (file.gantry) {
    const { mid, h } = span(file.gantry.s, 6.5, 0.8, 1.2, COLORS.gantry, null);
    // Left normal (-cos h, sin h); lights spread across the track, facing oncoming cars.
    for (let k = 0; k < 5; k++) {
      const off = (k - 2) * 1.2;
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), new THREE.MeshLambertMaterial({ color: COLORS.gantry }));
      const x = mid.x - Math.cos(h) * off, z = mid.z + Math.sin(h) * off;
      housing.position.set(x, 5.6, z);
      housing.rotation.y = h;
      group.add(housing);
      for (const y of [5.85, 5.35]) {
        const mat = new THREE.MeshBasicMaterial({ color: COLORS.lightOff });
        lights.push(mat);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), mat);
        // Slightly towards the oncoming cars (backwards along the track = +forward reversed).
        lamp.position.set(x + Math.sin(h) * 0.3, y, z + Math.cos(h) * 0.3);
        group.add(lamp);
      }
    }
  }

  const standMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  if (!b.empty) {
    const m = b.mesh(standMat);
    m.castShadow = true;
    group.add(m);
  }

  // --- Trees: instanced trunks + crowns, scattered behind the walls, clear of every part of the track.
  if (file.trees) {
    const tr = file.trees;
    const spots: { x: number; z: number; h: number; r: number }[] = [];
    const inZone = (s: number, left: boolean, off: number) =>
      zones.some((zn) => zn.left === left && world.wrap(s - zn.s0) <= world.wrap(zn.s1 - zn.s0) && off >= zn.o0 && off <= zn.o1);
    for (let s = 0; s < world.length; s += tr.every) {
      for (const left of [true, false]) {
        for (let k = 0; k < tr.perStation; k++) {
          const off = world.wallAt(s, left) + tr.minGap + rand() * (tr.maxGap - tr.minGap);
          const ss = s + (rand() - 0.5) * tr.every;
          if (inZone(ss, left, off)) continue;
          const p = world.point(ss, (left ? 1 : -1) * (world.at(left ? world.wl : world.wr, ss) + off));
          // Must be clear of the nearest part of the track (other straights pass close by).
          const pr = world.project(p.x, p.z);
          const l2 = pr.d >= 0;
          const clear = Math.abs(pr.d) - world.at(l2 ? world.wl : world.wr, pr.s) - world.wallAt(pr.s, l2);
          if (clear < tr.clearance) continue;
          spots.push({ x: p.x, z: p.z, h: 5 + rand() * 9, r: 2.2 + rand() * 2.4 });
        }
      }
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 5), new THREE.MeshLambertMaterial({ color: COLORS.trunk, flatShading: true }), spots.length);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    spots.forEach((t, i) => {
      const trunkH = t.h * 0.45;
      m4.compose(new THREE.Vector3(t.x, trunkH / 2, t.z), q.identity(), new THREE.Vector3(1, trunkH, 1));
      trunks.setMatrixAt(i, m4);
      q.setFromAxisAngle(up, rand() * Math.PI);
      m4.compose(new THREE.Vector3(t.x, trunkH + t.r * 0.7, t.z), q, new THREE.Vector3(t.r, t.r * 1.2, t.r));
      crowns.setMatrixAt(i, m4);
      crowns.setColorAt(i, c.set(COLORS.leaves[i % COLORS.leaves.length]!));
    });
    trunks.castShadow = crowns.castShadow = true;
    group.add(trunks, crowns);
  }

  return {
    group,
    setStartLights(n: number) {
      // Lights are stored in pairs (two per housing); housing k lights when n > k.
      lights.forEach((mat, i) => mat.color.setHex(Math.floor(i / 2) < n ? COLORS.lightOn : COLORS.lightOff));
    },
  };
}
