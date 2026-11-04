/**
 * Track registry. Every folder in data/tracks/ with a track.json is a circuit.
 * The small info.json files (name, length, outline) are bundled for menus; the big
 * files (track, surfaces, scenery) are loaded only when a track is picked.
 */
import surfacesFile from '../../data/surfaces.json';
import { loadSurfaces, type SurfacesFile, type SurfaceTable } from './surfaces';
import { TrackWorld, type SurfaceLayout, type TrackData } from './trackWorld';

export interface TrackInfo {
  name: string;
  length_m: number;
  official_length_m: number;
  layout_note?: string | null;
  outline: [number, number][];
}

type Loader = () => Promise<unknown>;
const idOf = (path: string) => path.split('/').slice(-2, -1)[0]!;
const byId = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [idOf(k), v]));

const infos = byId(import.meta.glob('../../data/tracks/*/info.json', { eager: true, import: 'default' })) as Record<string, TrackInfo>;
const trackFiles = byId(import.meta.glob('../../data/tracks/*/track.json', { import: 'default' })) as Record<string, Loader>;
const layoutFiles = byId(import.meta.glob('../../data/tracks/*/surfaces.json', { import: 'default' })) as Record<string, Loader>;
const sceneryFiles = byId(import.meta.glob('../../data/tracks/*/scenery.json', { import: 'default' })) as Record<string, Loader>;

/** Menu order: the original four first, then the rest alphabetically by name. */
const FIRST = ['monza', 'spa', 'silverstone', 'suzuka'];
export const CIRCUITS: string[] = Object.keys(infos)
  .filter((id) => trackFiles[id] && layoutFiles[id])
  .sort((a, b) => {
    const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return infos[a]!.name.localeCompare(infos[b]!.name);
  });

export type CircuitName = string;
export type TrackName = CircuitName | 'test';

export function isCircuit(name: string | null): name is CircuitName {
  return name !== null && CIRCUITS.includes(name);
}

export function trackInfo(name: CircuitName): TrackInfo {
  const i = infos[name];
  if (!i) throw new Error(`Unknown track "${name}"`);
  return i;
}

let table: SurfaceTable | null = null;
export function surfaceTable(): SurfaceTable {
  return (table ??= loadSurfaces(surfacesFile as unknown as SurfacesFile));
}

const cache = new Map<CircuitName, Promise<TrackWorld>>();
export function loadTrack(name: CircuitName): Promise<TrackWorld> {
  let p = cache.get(name);
  if (!p) {
    if (!isCircuit(name)) return Promise.reject(new Error(`Unknown track "${name}"`));
    p = Promise.all([trackFiles[name]!(), layoutFiles[name]!()]).then(
      ([t, l]) => new TrackWorld(t as TrackData, l as SurfaceLayout, surfaceTable()),
    );
    cache.set(name, p);
  }
  return p;
}

export async function sceneryFor(name: CircuitName): Promise<unknown> {
  const f = sceneryFiles[name];
  return f ? f() : { grandstands: [] };
}
