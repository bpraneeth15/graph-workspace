import type {
  DataPlotStyle,
  GraphCurve,
  GraphLine,
  GraphMeasure,
  GraphPoint,
  GraphShape,
  ObjectTarget,
  Tool,
} from "../graphTypes";
import { roundCoordinate } from "./graphMath";

export const getToolTitle = (tool: Tool) => {
  if (tool === "plot") return "Plot mode";
  if (tool === "line") return "Line mode";
  if (tool === "curve") return "Curve mode";
  if (tool === "rectangle") return "Rectangle mode";
  if (tool === "square") return "Square mode";
  if (tool === "measure") return "Distance mode";
  return "Pan mode";
};

export const getToolHelp = (tool: Tool, draftCount: number) => {
  if (tool === "plot") {
    return "Click to place a point. Hold and drag on empty space to draw a line.";
  }
  if (tool === "line") {
    return draftCount === 0
      ? "Click two endpoints, or hold and drag to draw a line."
      : "Click the second endpoint. Drag endpoints later to change the equation.";
  }
  if (tool === "curve") {
    return `Click ${3 - draftCount} more control point${
      3 - draftCount === 1 ? "" : "s"
    }. Drag controls later to change the equation.`;
  }
  if (tool === "rectangle") {
    return draftCount === 0
      ? "Hold and drag to draw a rectangle, or click two opposite corners."
      : "Click the opposite corner to finish the rectangle.";
  }
  if (tool === "square") {
    return draftCount === 0
      ? "Hold and drag to draw a square, or click two opposite corners."
      : "Click the opposite corner to finish the square.";
  }
  if (tool === "measure") {
    return draftCount === 0
      ? "Click two points, or hold and drag to draw a dotted distance marker."
      : "Click the second point to finish the distance marker.";
  }
  return "Left click objects to select and edit. Right click drag to move around.";
};

export const getDataInputLabel = (style: DataPlotStyle) => {
  if (style === "scatter" || style === "scatter-line") {
    return "Coordinate values: (x_coordinate, y_coordinate)";
  }
  if (style === "bar") {
    return "Bar values: (x_position, value)";
  }
  return "Line values: (x_coordinate, y_coordinate)";
};

export const getDataInputPlaceholder = (style: DataPlotStyle) => {
  if (style === "bar") return "(1, 12)\n(2, 18)\n(3, 9)";
  return "(1, 2)\n(2, 4)\n(3, 6)";
};

export const formatNumber = (value: number) => {
  const rounded = roundCoordinate(value);
  return `${rounded}`;
};

export const formatSignedTerm = (coefficient: number, variable: string) => {
  if (Math.abs(coefficient) < 0.000001) return "";
  const sign = coefficient < 0 ? " - " : " + ";
  const amount = Math.abs(roundCoordinate(coefficient));
  const number = amount === 1 && variable ? "" : `${amount}`;
  return `${sign}${number}${variable}`;
};

export type LineParts =
  | { vertical: true; x: number }
  | { vertical: false; m: number; b: number };

export const getLineParts = (line: GraphLine): LineParts => {
  const dx = line.b.x - line.a.x;
  if (Math.abs(dx) < 0.000001) {
    return { vertical: true, x: line.a.x };
  }
  const m = (line.b.y - line.a.y) / dx;
  const b = line.a.y - m * line.a.x;
  return { vertical: false, m, b };
};

export const formatLineEquation = (line: GraphLine) => {
  const parts = getLineParts(line);
  if (parts.vertical) return `x = ${formatNumber(parts.x)}`;

  const m = roundCoordinate(parts.m);
  const b = roundCoordinate(parts.b);
  let equation = "y = ";
  if (Math.abs(m) < 0.000001) {
    equation += "0";
  } else if (m === 1) {
    equation += "x";
  } else if (m === -1) {
    equation += "-x";
  } else {
    equation += `${m}x`;
  }

  if (Math.abs(b) >= 0.000001) {
    equation += b < 0 ? ` - ${Math.abs(b)}` : ` + ${b}`;
  }
  return equation;
};

export const getQuadraticCoefficients = (curve: GraphCurve) => {
  const points = [curve.a, curve.b, curve.c];
  const [p1, p2, p3] = points;
  const denominator =
    (p1.x - p2.x) * (p1.x - p3.x) * (p2.x - p3.x);
  if (Math.abs(denominator) < 0.000001) return null;

  const a =
    (p3.x * (p2.y - p1.y) +
      p2.x * (p1.y - p3.y) +
      p1.x * (p3.y - p2.y)) /
    denominator;
  const b =
    (p3.x ** 2 * (p1.y - p2.y) +
      p2.x ** 2 * (p3.y - p1.y) +
      p1.x ** 2 * (p2.y - p3.y)) /
    denominator;
  const c =
    (p2.x * p3.x * (p2.x - p3.x) * p1.y +
      p3.x * p1.x * (p3.x - p1.x) * p2.y +
      p1.x * p2.x * (p1.x - p2.x) * p3.y) /
    denominator;
  return { a, b, c };
};

export const formatCurveEquation = (curve: GraphCurve) => {
  const coefficients = getQuadraticCoefficients(curve);
  if (!coefficients) return "Need 3 different x-values";
  const { a, b, c } = coefficients;
  const roundedA = roundCoordinate(a);
  const roundedB = roundCoordinate(b);
  const roundedC = roundCoordinate(c);

  let equation = "y = ";
  if (Math.abs(roundedA) < 0.000001) {
    equation += "0";
  } else if (roundedA === 1) {
    equation += "x^2";
  } else if (roundedA === -1) {
    equation += "-x^2";
  } else {
    equation += `${roundedA}x^2`;
  }

  equation += formatSignedTerm(roundedB, "x");
  if (Math.abs(roundedC) >= 0.000001) {
    equation += roundedC < 0 ? ` - ${Math.abs(roundedC)}` : ` + ${roundedC}`;
  }

  return equation;
};

export const getShapeBounds = (shape: Pick<GraphShape, "a" | "b">) => {
  const x = Math.min(shape.a.x, shape.b.x);
  const y = Math.min(shape.a.y, shape.b.y);
  const width = Math.abs(shape.b.x - shape.a.x);
  const height = Math.abs(shape.b.y - shape.a.y);
  return { x, y, width, height };
};

export const formatShapeLabel = (shape: GraphShape) => {
  const bounds = getShapeBounds(shape);
  if (shape.type === "square") {
    return `square: side ${formatNumber(bounds.width)}`;
  }
  return `rectangle: ${formatNumber(bounds.width)} x ${formatNumber(bounds.height)}`;
};

export const getDistance = (a: GraphPoint, b: GraphPoint) =>
  Math.hypot(b.x - a.x, b.y - a.y);

export const formatMeasureLabel = (measure: GraphMeasure) =>
  `d = ${formatNumber(getDistance(measure.a, measure.b))}`;

export const getObjectTitle = (target: ObjectTarget) => {
  if (target.kind === "line") return "Line";
  if (target.kind === "curve") return "Curve";
  if (target.kind === "shape") return "Shape";
  return "Distance";
};

export const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};
