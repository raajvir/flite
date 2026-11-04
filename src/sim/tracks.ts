/** Track registry: builds a TrackWorld from the JSON files in data/tracks/<name>/. */
import surfacesFile from '../../data/surfaces.json';
import monzaLayout from '../../data/tracks/monza/surfaces.json';
import monzaTrack from '../../data/tracks/monza/track.json';
import { loadSurfaces, type SurfacesFile, type SurfaceTable } from './surfaces';
import { TrackWorld, type SurfaceLayout, type TrackData } from './trackWorld';

export type TrackName = 'monza' | 'test';

let table: SurfaceTable | null = null;
export function surfaceTable(): SurfaceTable {
  return (table ??= loadSurfaces(surfacesFile as unknown as SurfacesFile));
}

export function loadTrack(name: Exclude<TrackName, 'test'>): TrackWorld {
  switch (name) {
    case 'monza':
      return new TrackWorld(monzaTrack as unknown as TrackData, monzaLayout as unknown as SurfaceLayout, surfaceTable());
  }
}
