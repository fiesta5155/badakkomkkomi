export const DEFAULT_MAP_INFORMATION_ORDER = ['docking', 'protected_area', 'hazard', 'port_names', 'permits', 'porpoise'] as const;
export type MapInformationId = typeof DEFAULT_MAP_INFORMATION_ORDER[number];
// UI preference only: never part of operational layers, GeoJSON or release snapshots.
export const MAP_INFORMATION_ORDER_KEY = 'bada_map_information_ui_order_v1';

export function normalizeMapInformationOrder(value: unknown): MapInformationId[] {
  const valid = Array.isArray(value) ? value.filter((id): id is MapInformationId =>
    DEFAULT_MAP_INFORMATION_ORDER.includes(id)) : [];
  const order = [...new Set([...valid, ...DEFAULT_MAP_INFORMATION_ORDER])];
  // Introduce the new card beside hazard, preserving the relative order of every saved card.
  if (!valid.includes('port_names') && valid.includes('hazard')) {
    order.splice(order.indexOf('port_names'), 1);
    order.splice(order.indexOf('hazard') + 1, 0, 'port_names');
  }
  return order;
}

export function loadMapInformationOrder(storage: Pick<Storage, 'getItem'>): MapInformationId[] {
  try { return normalizeMapInformationOrder(JSON.parse(storage.getItem(MAP_INFORMATION_ORDER_KEY) ?? 'null')); }
  catch { return [...DEFAULT_MAP_INFORMATION_ORDER]; }
}

export function moveMapInformationItem(order: readonly MapInformationId[], id: MapInformationId, direction: -1 | 1): MapInformationId[] {
  const next = [...order], index = next.indexOf(id), target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
