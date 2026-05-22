import type { GraphPoint } from "../graphTypes";

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const getCanvasDpr = () =>
  Math.min(3, Math.max(2, window.devicePixelRatio || 1));

export const crispLine = (value: number) => Math.round(value) + 0.5;

export const roundCoordinate = (value: number) => {
  if (Math.abs(value) < 0.000001) return 0;
  return Number(value.toFixed(4));
};

export const niceStep = (rawStep: number) => {
  const exponent = Math.floor(Math.log10(rawStep));
  const base = rawStep / 10 ** exponent;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exponent;
};

export const distanceToSegment = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1
  );
  const projection = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
};

export const closestPointOnSegmentWorld = (
  point: { x: number; y: number },
  a: GraphPoint,
  b: GraphPoint
): GraphPoint => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { id: 0, x: a.x, y: a.y };
  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1
  );
  return {
    id: 0,
    x: roundCoordinate(a.x + t * dx),
    y: roundCoordinate(a.y + t * dy),
  };
};
