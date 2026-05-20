import type {
  DataPlot,
  DataValue,
  GraphCurve,
  GraphLine,
  GraphMeasure,
  GraphPoint,
  GraphShape,
  ObjectTarget,
} from "./graphTypes";

type SelectedGraphObject =
  | { kind: "line"; value: GraphLine }
  | { kind: "curve"; value: GraphCurve }
  | { kind: "shape"; value: GraphShape }
  | { kind: "measure"; value: GraphMeasure }
  | null;

export type CalculatorDataContext = {
  points: GraphPoint[];
  dataPlots: DataPlot[];
  selected: SelectedGraphObject;
  selectedTarget: ObjectTarget | null;
  formatObject: (target: ObjectTarget) => string;
};

export const roundCalc = (value: number) => {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 0.000000001) return 0;
  return Number(value.toFixed(6));
};

export const evaluateExpression = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/π/g, "pi")
    .replace(/\^/g, "**")
    .replace(/\bpi\b/gi, "PI")
    .replace(/\be\b/g, "E");
  const allowed = /^[\d+\-*/().,\sA-Za-z_*]+$/;
  if (!allowed.test(normalized)) {
    throw new Error("Only calculator expressions are supported.");
  }

  const mathNames = [
    "abs",
    "acos",
    "asin",
    "atan",
    "ceil",
    "cos",
    "E",
    "exp",
    "floor",
    "log",
    "log10",
    "max",
    "min",
    "PI",
    "pow",
    "round",
    "sin",
    "sqrt",
    "tan",
  ];
  const mathValues = mathNames.map((name) => Math[name as keyof Math]);
  const result = Function(...mathNames, `"use strict"; return (${normalized});`)(
    ...mathValues
  );
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("That did not produce a finite number.");
  }
  return roundCalc(result);
};

export const getCalculatorValues = (context: CalculatorDataContext) => {
  if (context.selected?.kind === "line") {
    return [context.selected.value.a.y, context.selected.value.b.y];
  }
  if (context.selected?.kind === "curve") {
    return [
      context.selected.value.a.y,
      context.selected.value.b.y,
      context.selected.value.c.y,
    ];
  }
  if (context.selected?.kind === "shape") {
    const width = Math.abs(context.selected.value.b.x - context.selected.value.a.x);
    const height = Math.abs(context.selected.value.b.y - context.selected.value.a.y);
    return [width, height, width * height];
  }
  if (context.selected?.kind === "measure") {
    return [distance(context.selected.value.a, context.selected.value.b)];
  }

  const dataValues = context.dataPlots.flatMap((plot) =>
    plot.values.map((value) => value.y)
  );
  if (dataValues.length > 0) return dataValues;
  return context.points.map((point) => point.y);
};

export const getCalculatorPairs = (context: CalculatorDataContext): DataValue[] => {
  if (context.selected?.kind === "line") {
    return [
      { x: context.selected.value.a.x, y: context.selected.value.a.y },
      { x: context.selected.value.b.x, y: context.selected.value.b.y },
    ];
  }
  if (context.selected?.kind === "curve") {
    return [
      { x: context.selected.value.a.x, y: context.selected.value.a.y },
      { x: context.selected.value.b.x, y: context.selected.value.b.y },
      { x: context.selected.value.c.x, y: context.selected.value.c.y },
    ];
  }
  const dataValues = context.dataPlots.flatMap((plot) => plot.values);
  if (dataValues.length > 0) return dataValues;
  return context.points.map((point) => ({ x: point.x, y: point.y }));
};

export const calculateStatistic = (
  name: "MEAN" | "SD" | "VAR" | "COVAR" | "MEDIAN",
  context: CalculatorDataContext
) => {
  if (name === "COVAR") {
    const pairs = getCalculatorPairs(context);
    if (pairs.length < 2) throw new Error("COVAR needs at least two x,y pairs.");
    const meanX = mean(pairs.map((pair) => pair.x));
    const meanY = mean(pairs.map((pair) => pair.y));
    return roundCalc(
      pairs.reduce((sum, pair) => sum + (pair.x - meanX) * (pair.y - meanY), 0) /
        pairs.length
    );
  }

  const values = getCalculatorValues(context);
  if (values.length === 0) throw new Error(`${name} needs points or data.`);
  if (name === "MEAN") return roundCalc(mean(values));
  if (name === "MEDIAN") return roundCalc(median(values));
  if (name === "VAR") return roundCalc(variance(values));
  return roundCalc(Math.sqrt(variance(values)));
};

export const getSelectedObjectSummary = (context: CalculatorDataContext) => {
  if (!context.selected || !context.selectedTarget) {
    return "No object selected";
  }
  return context.formatObject(context.selectedTarget);
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const variance = (values: number[]) => {
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
};

const distance = (a: GraphPoint, b: GraphPoint) =>
  Math.hypot(b.x - a.x, b.y - a.y);
