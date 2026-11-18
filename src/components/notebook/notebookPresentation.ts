import type { DockingFeature } from '../../types/docking';

/** Presentation only: never change the source records or the user's active filters. */
export function getNotebookDisplay(features: DockingFeature[], showHazards: boolean) {
  const visibleFeatures = showHazards ? features : features.filter((feature) => feature.properties.color !== 'red');
  const hazardFeatures = visibleFeatures.filter((feature) => feature.properties.color === 'red');
  return {
    visibleFeatures,
    hazardFeatures,
    hazardCount: hazardFeatures.length,
  };
}
