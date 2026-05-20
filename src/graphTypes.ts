export type GraphPoint = {
  id: number;
  x: number;
  y: number;
};

export type GraphLine = {
  id: number;
  a: GraphPoint;
  b: GraphPoint;
  color: string;
  showLabel: boolean;
};

export type GraphCurve = {
  id: number;
  a: GraphPoint;
  b: GraphPoint;
  c: GraphPoint;
  color: string;
  showLabel: boolean;
};

export type GraphShape = {
  id: number;
  type: "rectangle" | "square";
  a: GraphPoint;
  b: GraphPoint;
  color: string;
  showLabel: boolean;
};

export type GraphMeasure = {
  id: number;
  a: GraphPoint;
  b: GraphPoint;
  color: string;
  showLabel: boolean;
};

export type DataPlotStyle = "scatter" | "line" | "scatter-line" | "bar";

export type DataValue = {
  x: number;
  y: number;
};

export type DataPlot = {
  id: number;
  name: string;
  values: DataValue[];
  color: string;
  style: DataPlotStyle;
};

export type ObjectTarget =
  | { kind: "line"; id: number }
  | { kind: "curve"; id: number }
  | { kind: "shape"; id: number }
  | { kind: "measure"; id: number };

export type CalculatorGuide = {
  label: string;
  value: number;
};
