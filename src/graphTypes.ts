export type GraphPoint = {
  id: number;
  x: number;
  y: number;
  color?: string;
  label?: string;
  showLabel?: boolean;
  labelDx?: number;
  labelDy?: number;
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
  type?: "surface" | "cube";
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
  label?: string;
  reference?: boolean;
};

export type GraphCurve = {
  id: number;
  a: GraphPoint;
  b: GraphPoint;
  c: GraphPoint;
  color: string;
  showLabel: boolean;
  label?: string;
};

export type GraphShape = {
  id: number;
  type: "rectangle" | "square";
  a: GraphPoint;
  b: GraphPoint;
  color: string;
  showLabel: boolean;
  label?: string;
  areaLabelTx?: number;
  areaLabelTy?: number;
  rotation?: number;
  referenceLineId?: number;
  referenceSide?: 1 | -1;
};

export type GraphMeasure = {
  id: number;
  a: GraphPoint;
  b: GraphPoint;
  color: string;
  showLabel: boolean;
  showEndpointLabels?: boolean;
  label?: string;
  labelT?: number;
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
  statistic?: "MEAN" | "SD" | "VAR" | "COVAR" | "MEDIAN";
  highlights?: StatisticHighlight[];
  pairs?: DataValue[];
};

export type CalculatorMeanPoint = {
  x: number;
  y: number;
  count: number;
};

export type CorrelationHighlight =
  | "all"
  | "mean"
  | "mean-x"
  | "mean-y"
  | "horizontal"
  | "vertical"
  | "comovement"
  | "positive-comovement"
  | "negative-comovement"
  | "x-spread"
  | "y-spread"
  | "denominator";

export type CorrelationGuide = {
  highlights: CorrelationHighlight[];
  pairs: DataValue[];
};

export type StatisticHighlight =
  | "mean-point"
  | "mean-x"
  | "mean-y"
  | "sd-center"
  | "sd-y-deviations"
  | "sd-y-squares"
  | "sd-y-sum"
  | "sd-y-average"
  | "sd-y-length"
  | "sd-x-deviations"
  | "sd-x-squares"
  | "sd-x-sum"
  | "sd-x-average"
  | "sd-x-length"
  | "variance-center"
  | "variance-y-deviations"
  | "variance-y-squares"
  | "variance-y-sum"
  | "variance-y-average"
  | "variance-x-deviations"
  | "variance-x-squares"
  | "variance-x-sum"
  | "variance-x-average"
  | "covariance-means"
  | "covariance-horizontal"
  | "covariance-vertical"
  | "covariance-products"
  | "covariance-average"
  | "median-point"
  | "median-x"
  | "median-y";
