import type { RouteWaypoint } from '../types/route';

function numberPoints(points: RouteWaypoint[]): RouteWaypoint[] {
  return points.map((point, index) => ({
    ...point,
    name: `지점 ${index + 1}`,
    type: index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'waypoint',
  }));
}

export function appendStraightRoutePoint(
  points: RouteWaypoint[],
  lat: number,
  lng: number,
  id: string,
): RouteWaypoint[] {
  return numberPoints([
    ...points,
    { id, name: '', lat, lng, type: 'waypoint', isCustomCoord: true },
  ]);
}

export function removeStraightRoutePoint(points: RouteWaypoint[], id: string): RouteWaypoint[] {
  return numberPoints(points.filter((point) => point.id !== id));
}

export function moveStraightRoutePoint(
  points: RouteWaypoint[],
  id: string,
  lat: number,
  lng: number,
): RouteWaypoint[] {
  return points.map((point) => (point.id === id ? { ...point, lat, lng } : point));
}
