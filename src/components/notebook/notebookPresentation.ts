import type { ReferenceMapPoint } from './mapInformationData';
import type { DockingFeature } from '../../types/docking';

/** Presentation only: never change the source records or the user's active filters. */
export function getNotebookDisplay(features: DockingFeature[], showHazards: boolean, hazards: ReferenceMapPoint[] = []) {
  const visibleFeatures = features;
  const hazardFeatures = showHazards ? hazards : [];
  return {
    visibleFeatures,
    hazardFeatures,
    hazardCount: hazardFeatures.length,
  };
}
