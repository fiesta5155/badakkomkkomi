import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPorpoiseLocationPicker } from '../services/porpoiseLocationPicker.ts';

export function usePorpoiseLocationPicker(options: {
  enabled: boolean;
  onPick: (lat: number, lng: number) => void;
  onGpsPick: (lat: number, lng: number) => void;
}) {
  const [picker] = useState(() => createPorpoiseLocationPicker({
    geolocation: () => typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
    onPick: () => {},
  }));
  useLayoutEffect(() => {
    picker.setCallbacks({
      isAllowed: () => options.enabled,
      onPick: (point, source) => {
        if (source === 'gps') options.onGpsPick(point.lat, point.lng);
        options.onPick(point.lat, point.lng);
      },
    });
    if (!options.enabled) picker.setActive(false);
  }, [options, picker]);
  useEffect(() => {
    const leave = () => {
      if (new URLSearchParams(window.location.search).get('screen') !== 'notebook') picker.setActive(false);
    };
    window.addEventListener('popstate', leave);
    return () => { window.removeEventListener('popstate', leave); picker.setActive(false); };
  }, [picker]);
  const state = useSyncExternalStore(picker.subscribe, picker.getSnapshot);
  return { ...state, setActive: picker.setActive, press: picker.press, select: picker.select };
}
