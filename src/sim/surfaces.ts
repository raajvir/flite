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
  /** Cross-section shape of the surface (kerbs): 'none', 'ramp' (rises outwards) or 'hump'. */
  profile: 'none' | 'ramp' | 'hump';
  /** Height of the profile, m */
  profileHeight: number;
}

export interface ContactParams {
  wallStiffness: number;
  wallDamping: number;
  wallFriction: number;
  carStiffness: number;
  carDamping: number;
  carFriction: number;
  /** Cap on the push from one circle-circle contact, N */
  carMaxForce: number;
  /** Kerb profiles ramp in over this distance at each end of a kerb, m */
  kerbTaper: number;
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
  profile?: { shape: string; height: number };
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
  'carMaxForce',
  'kerbTaper',
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
      profile: r.profile?.shape === 'ramp' || r.profile?.shape === 'hump' ? r.profile.shape : 'none',
      profileHeight: finite(r.profile?.height) ? r.profile!.height : 0,
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

/** Ramp kerbs reach full height this far across, then bevel down to the outer edge. */
const RAMP_PEAK = 0.85;

/**
 * Height of a surface's cross-section profile at fraction u across it (0 = inner edge,
 * 1 = outer edge) and its slope dh/du. Ramp kerbs rise outwards (so a wheel on them is
 * pushed back towards the track); hump kerbs (sausages) rise and fall.
 */
export function profileAt(s: Surface, u: number): { h: number; dhdu: number } {
  const H = s.profileHeight;
  if (s.profile === 'ramp') {
    // Rises to full height at RAMP_PEAK, then a short rounded bevel back down at the outer edge.
    return u < RAMP_PEAK ? { h: (H * u) / RAMP_PEAK, dhdu: H / RAMP_PEAK } : { h: (H * (1 - u)) / (1 - RAMP_PEAK), dhdu: -H / (1 - RAMP_PEAK) };
  }
  if (s.profile === 'hump') return { h: H * Math.sin(Math.PI * u), dhdu: H * Math.PI * Math.cos(Math.PI * u) };
  return { h: 0, dhdu: 0 };
}

/**
 * Smooth deterministic height noise in [-1, 1] at a world point (for bumps).
 * Two crossed sine ripples: no randomness, so the sim stays deterministic.
 */
export function bumpNoise(x: number, z: number, wavelength: number): number {
  const k = (2 * Math.PI) / wavelength;
  return 0.5 * (Math.sin(k * x + 1.3) * Math.sin(k * 0.83 * z + 0.4) + Math.sin(k * 0.61 * (x + z) + 2.1));
}
