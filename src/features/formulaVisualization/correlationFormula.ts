import type {
  CorrelationHighlight,
  DataValue,
} from "../../graphTypes";

export type CorrelationVisualType =
  | "full-correlation"
  | "mean-line-x"
  | "mean-line-y"
  | "horizontal-deviation"
  | "vertical-deviation"
  | "signed-rectangle"
  | "horizontal-spread-square"
  | "vertical-spread-square"
  | "normalization-factor";

export type CorrelationFormulaComponent = {
  id: CorrelationHighlight;
  label: string;
  title: string;
  explanation: string;
  visualType: CorrelationVisualType;
};

export type CorrelationGeometryItem = {
  pointIndex: number;
  pointLabel: string;
  point: DataValue;
  dx: number;
  dy: number;
  absoluteDx: number;
  absoluteDy: number;
  xSquared: number;
  ySquared: number;
  product: number;
};

export type CorrelationGeometry = {
  meanX: number;
  meanY: number;
  rawComovement: number;
  xSpread: number;
  ySpread: number;
  denominator: number;
  coefficient: number | null;
  items: CorrelationGeometryItem[];
};

export const CORRELATION_FORMULA_COMPONENTS: CorrelationFormulaComponent[] = [
  {
    id: "all",
    label: "r",
    title: "Show the complete correlation construction",
    explanation: "Correlation compares signed comovement with the combined horizontal and vertical spread.",
    visualType: "full-correlation",
  },
  {
    id: "mean-x",
    label: "x̄",
    title: "Show the vertical x-mean line",
    explanation: "The vertical line is x = x̄, the average horizontal coordinate.",
    visualType: "mean-line-x",
  },
  {
    id: "mean-y",
    label: "ȳ",
    title: "Show the horizontal y-mean line",
    explanation: "The horizontal line is y = ȳ, the average vertical coordinate.",
    visualType: "mean-line-y",
  },
  {
    id: "horizontal",
    label: "xi - x̄",
    title: "Show horizontal deviations",
    explanation: "Each cyan segment is the signed horizontal distance xi - x̄.",
    visualType: "horizontal-deviation",
  },
  {
    id: "vertical",
    label: "yi - ȳ",
    title: "Show vertical deviations",
    explanation: "Each pink segment is the signed vertical distance yi - ȳ.",
    visualType: "vertical-deviation",
  },
  {
    id: "comovement",
    label: "Σ[(xi - x̄)(yi - ȳ)]",
    title: "Show all signed raw comovement rectangles",
    explanation: "Each rectangle area is (xi - x̄)(yi - ȳ). The total is the raw comovement numerator.",
    visualType: "signed-rectangle",
  },
  {
    id: "positive-comovement",
    label: "+ comovement",
    title: "Show only positive comovement rectangles",
    explanation: "Green rectangles have same-sign deviations, so their signed areas are positive.",
    visualType: "signed-rectangle",
  },
  {
    id: "negative-comovement",
    label: "- comovement",
    title: "Show only negative comovement rectangles",
    explanation: "Orange rectangles have opposite-sign deviations, so their signed areas are negative.",
    visualType: "signed-rectangle",
  },
  {
    id: "x-spread",
    label: "Σ(xi - x̄)²",
    title: "Show horizontal spread squares",
    explanation: "Each blue square has side |xi - x̄| and literal area (xi - x̄)².",
    visualType: "horizontal-spread-square",
  },
  {
    id: "y-spread",
    label: "Σ(yi - ȳ)²",
    title: "Show vertical spread squares",
    explanation: "Each pink square has side |yi - ȳ| and literal area (yi - ȳ)².",
    visualType: "vertical-spread-square",
  },
  {
    id: "denominator",
    label: "√(Σdx² Σdy²)",
    title: "Show the correlation normalization factor",
    explanation: "The denominator removes x/y scale by showing the maximum possible comovement from total x spread and total y spread.",
    visualType: "normalization-factor",
  },
];

export const CORRELATION_COMPONENT_TREE = {
  id: "correlation",
  children: {
    numerator: ["comovement", "positive-comovement", "negative-comovement"],
    denominator: ["x-spread", "y-spread", "denominator"],
    means: ["mean-x", "mean-y"],
    deviations: ["horizontal", "vertical"],
  },
} as const;

export const getCorrelationFormulaComponent = (id: CorrelationHighlight) =>
  CORRELATION_FORMULA_COMPONENTS.find((component) => component.id === id);

export const buildCorrelationGeometry = (
  pairs: DataValue[]
): CorrelationGeometry => {
  const meanX = average(pairs.map((pair) => pair.x));
  const meanY = average(pairs.map((pair) => pair.y));
  const items = pairs.map((point, pointIndex) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    return {
      pointIndex,
      pointLabel: `P${pointIndex + 1}`,
      point,
      dx,
      dy,
      absoluteDx: Math.abs(dx),
      absoluteDy: Math.abs(dy),
      xSquared: dx ** 2,
      ySquared: dy ** 2,
      product: dx * dy,
    };
  });
  const rawComovement = items.reduce((sum, item) => sum + item.product, 0);
  const xSpread = items.reduce((sum, item) => sum + item.xSquared, 0);
  const ySpread = items.reduce((sum, item) => sum + item.ySquared, 0);
  const denominator = Math.sqrt(xSpread * ySpread);
  return {
    meanX,
    meanY,
    rawComovement,
    xSpread,
    ySpread,
    denominator,
    coefficient: denominator === 0 ? null : rawComovement / denominator,
    items,
  };
};

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
