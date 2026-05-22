export type GraphPoint = {
  id: number;
  x: number;
  y: number;
  color?: string;
};

export type ViewState = {
  offsetX: number;
  offsetY: number;
  pixelsPerUnit: number;
};

export type Tool =
  | "plot"
  | "line"
  | "curve"
  | "rectangle"
  | "square"
  | "measure"
  | "pan";

export type WorkspaceMode = "2d" | "surface";
export type RendererMode = "auto" | "canvas" | "gpu";
export type SurfaceTool =
  | "select"
  | "pen"
  | "pencil"
  | "cutter"
  | "fill"
  | "paint"
  | "scale"
  | "stretch"
  | "shrink"
  | "replicate"
  | "data";

export type SurfaceVector3 = {
  x: number;
  y: number;
  z: number;
};

export type SurfaceShape = {
  id: number;
  name: string;
  equation: string;
  color: string;
  position: SurfaceVector3;
  scale: SurfaceVector3;
};

export type SurfaceStroke = {
  id: number;
  color: string;
  opacity: number;
  points: SurfaceVector3[];
};

export type SurfaceDataPoint = SurfaceVector3 & {
  id: number;
  color: string;
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
export type DataPointStyle = "filled" | "ring";

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
  pointStyle: DataPointStyle;
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
