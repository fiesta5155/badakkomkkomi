export const MAP_INFORMATION_VISIBILITY_KEY = 'bada_map_information_visibility_v1';
export const DEFAULT_MAP_INFORMATION_VISIBILITY = { hazard: true, port_names: true, permits: true, porpoise: true };
export type MapInformationVisibility = typeof DEFAULT_MAP_INFORMATION_VISIBILITY;
export function loadMapInformationVisibility(storage: Pick<Storage, 'getItem'>): MapInformationVisibility {
  const result = { ...DEFAULT_MAP_INFORMATION_VISIBILITY };
  try {
    const value = JSON.parse(storage.getItem(MAP_INFORMATION_VISIBILITY_KEY) ?? 'null');
    for (const key of Object.keys(result) as (keyof MapInformationVisibility)[]) {
      if (typeof value?.[key] === 'boolean') result[key] = value[key];
    }
  } catch { /* Missing or inaccessible preferences use first-run defaults. */ }
  return result;
}
