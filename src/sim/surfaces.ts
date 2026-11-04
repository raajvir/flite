/** Surface table loaded from data/surfaces.json (pure, validated). */

export interface Surface {
  id: number;
  name: string;
  grip: number;
  rollingResistance: number;
  bumpAmplitude: number;
  bumpWavelength: number;
  drag: number;
  color: string;
  colorAlt?: string;
  stripe?: number;
  height?: number;
  sound: string;
  particles: string;
}

export interface ContactParams {
  wallStiffness: number;
  wallDamping: number;
  wallFriction: number;
  carStiffness: number;
  carDamping: number;
  carFriction: number;
  bumpLoadGain: number;
  bumpFullSpeed: number;
}

export interface SurfaceTable {
  list: Surface[];
  byName: Record<string, Surface>;
  contact: ContactParams;
}

interface RawSurface {
  grip: number;
  rollingResistance: number;
  bump: { amplitude: number; wavelength: number };
  drag: number;
  color: string;
  colorAlt?: string;
  stripe?: number;
  height?: number;
  sound: string;
  particles: string;
}

export interface SurfacesFile {
  surfaces: Record<string, RawSurface>;
  contact: Record<string, unknown>;
}

const CONTACT_KEYS: (keyof ContactParams)[] = [
  'wallStiffness',
  'wallDamping',
  'wallFriction',
  'carStiffness',
  'carDamping',
  'carFriction',
  'bumpLoadGain',
  'bumpFullSpeed',
];
export const REQUIRED_SURFACES = [
  'asphalt',
  'paint',
  'kerb_flat',
  'kerb_sausage',
  'astroturf',
  'grass',
  'gravel',
  'runoff',
  'pitlane',
  'wall',
] as const;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadSurfaces(file: SurfacesFile): SurfaceTable {
  const list: Surface[] = [];
  const byName: Record<string, Surface> = {};
  for (const [name, r] of Object.entries(file.surfaces)) {
    if (![r.grip, r.rollingResistance, r.drag, r.bump?.amplitude, r.bump?.wavelength].every(finite)) {
      throw new Error(`Surface "${name}" has a missing or invalid number`);
    }
    if (r.bump.wavelength <= 0) throw new Error(`Surface "${name}": bump wavelength must be > 0`);
    const s: Surface = {
      id: list.length,
      name,
      grip: r.grip,
      rollingResistance: r.rollingResistance,
      bumpAmplitude: r.bump.amplitude,
      bumpWavelength: r.bump.wavelength,
      drag: r.drag,
      color: r.color,
      sound: r.sound,
      particles: r.particles,
      ...(r.colorAlt !== undefined && { colorAlt: r.colorAlt }),
      ...(r.stripe !== undefined && { stripe: r.stripe }),
      ...(r.height !== undefined && { height: r.height }),
    };
    list.push(s);
    byName[name] = s;
  }
  for (const req of REQUIRED_SURFACES) if (!byName[req]) throw new Error(`surfaces.json is missing "${req}"`);
  const contact = {} as ContactParams;
  for (const k of CONTACT_KEYS) {
    const v = file.contact[k];
    if (!finite(v)) throw new Error(`surfaces.json contact.${k} missing or invalid`);
    contact[k] = v;
  }
  return { list, byName, contact };
}

/**
 * Smooth deterministic height noise in [-1, 1] at a world point (for bumps).
 * Two crossed sine ripples: no randomness, so the sim stays deterministic.
 */
export function bumpNoise(x: number, z: number, wavelength: number): number {
  const k = (2 * Math.PI) / wavelength;
  return 0.5 * (Math.sin(k * x + 1.3) * Math.sin(k * 0.83 * z + 0.4) + Math.sin(k * 0.61 * (x + z) + 2.1));
}
