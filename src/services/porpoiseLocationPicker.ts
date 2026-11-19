export interface PorpoisePickState { active: boolean; pending: boolean }
export const PORPOISE_GPS_TIMEOUT = 10000;
type Point = { lat: number; lng: number };
type PickCallbacks = { onPick: (point: Point, source: 'gps' | 'map') => void; isAllowed?: () => boolean };

// This controller only chooses coordinates. The existing modal remains the only
// place that creates a record, so a GPS callback never saves an observation.
export function createPorpoiseLocationPicker(options: PickCallbacks & {
  geolocation: () => Pick<Geolocation, 'getCurrentPosition'> | undefined;
  schedule?: (callback: () => void, milliseconds: number) => () => void;
}) {
  let state: PorpoisePickState = { active: false, pending: false };
  let callbacks: PickCallbacks = options;
  let generation = 0;
  let stopTimer: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const allowed = () => callbacks.isAllowed?.() ?? true;
  const schedule = options.schedule ?? ((callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  });
  const publish = (next: PorpoisePickState) => {
    if (state.active === next.active && state.pending === next.pending) return;
    state = next; listeners.forEach(listener => listener());
  };
  const invalidate = () => { generation++; stopTimer?.(); stopTimer = undefined; };
  const valid = ({ lat, lng }: Point) => Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  const setActive = (active: boolean) => {
    invalidate();
    publish({ active: active && allowed(), pending: false });
  };
  const accept = (point: Point, source: 'gps' | 'map') => {
    if (!state.active || !allowed() || !valid(point)) return;
    setActive(false);
    callbacks.onPick(point, source);
  };
  return {
    getSnapshot: () => state,
    setCallbacks(next: PickCallbacks) { callbacks = next; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive,
    select(lat: number, lng: number) { accept({ lat, lng }, 'map'); },
    press() {
      if (!allowed()) return;
      if (!state.active) { setActive(true); return; }
      if (state.pending) return;
      const request = ++generation;
      publish({ active: true, pending: true });
      const current = () => generation === request && state.active && allowed();
      const fail = () => {
        if (generation !== request) return;
        invalidate();
        publish({ active: state.active && allowed(), pending: false });
      };
      stopTimer = schedule(fail, PORPOISE_GPS_TIMEOUT);
      try {
        const geo = options.geolocation();
        if (!geo) { fail(); return; }
        geo.getCurrentPosition(position => {
          if (!current()) return;
          const point = { lat: position.coords.latitude, lng: position.coords.longitude };
          if (!valid(point)) { fail(); return; }
          accept(point, 'gps');
        }, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: PORPOISE_GPS_TIMEOUT });
      } catch { fail(); }
    },
  };
}
