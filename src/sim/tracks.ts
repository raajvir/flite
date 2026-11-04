/** Track registry: builds a TrackWorld from the JSON files in data/tracks/<name>/. */
import surfacesFile from '../../data/surfaces.json';
import monzaScenery from '../../data/tracks/monza/scenery.json';
import monzaLayout from '../../data/tracks/monza/surfaces.json';
import monzaTrack from '../../data/tracks/monza/track.json';
import silverstoneScenery from '../../data/tracks/silverstone/scenery.json';
import silverstoneLayout from '../../data/tracks/silverstone/surfaces.json';
import silverstoneTrack from '../../data/tracks/silverstone/track.json';
import spaScenery from '../../data/tracks/spa/scenery.json';
import spaLayout from '../../data/tracks/spa/surfaces.json';
import spaTrack from '../../data/tracks/spa/track.json';
import suzukaScenery from '../../data/tracks/suzuka/scenery.json';
import suzukaLayout from '../../data/tracks/suzuka/surfaces.json';
import suzukaTrack from '../../data/tracks/suzuka/track.json';
import { loadSurfaces, type SurfacesFile, type SurfaceTable } from './surfaces';
import { TrackWorld, type SurfaceLayout, type TrackData } from './trackWorld';

export const TRACKS = {
  monza: { name: 'Italian circuit', track: monzaTrack, layout: monzaLayout, scenery: monzaScenery },
  spa: { name: 'Belgian circuit', track: spaTrack, layout: spaLayout, scenery: spaScenery },
  silverstone: { name: 'British circuit', track: silverstoneTrack, layout: silverstoneLayout, scenery: silverstoneScenery },
  suzuka: { name: 'Japanese circuit', track: suzukaTrack, layout: suzukaLayout, scenery: suzukaScenery },
} as const;

export type CircuitName = keyof typeof TRACKS;
export type TrackName = CircuitName | 'test';
export const CIRCUITS = Object.keys(TRACKS) as CircuitName[];

export function isCircuit(name: string | null): name is CircuitName {
  return name !== null && name in TRACKS;
}

let table: SurfaceTable | null = null;
export function surfaceTable(): SurfaceTable {
  return (table ??= loadSurfaces(surfacesFile as unknown as SurfacesFile));
}

const cache = new Map<CircuitName, TrackWorld>();
export function loadTrack(name: CircuitName): TrackWorld {
  let w = cache.get(name);
  if (!w) {
    const t = TRACKS[name];
    w = new TrackWorld(t.track as unknown as TrackData, t.layout as unknown as SurfaceLayout, surfaceTable());
    cache.set(name, w);
  }
  return w;
}

export function sceneryFor(name: CircuitName): unknown {
  return TRACKS[name].scenery;
}
