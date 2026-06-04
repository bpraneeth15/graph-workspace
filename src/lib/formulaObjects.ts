import type {
  FormulaObjectKind,
  FormulaVariable,
  GraphFormulaObject,
  GraphPoint,
} from "../graphTypes";
import { roundCoordinate } from "./graphMath";
import { formatNumber } from "./graphFormatting";

type FormulaDefinition = {
  kind: FormulaObjectKind;
  name: string;
  formula: string;
  variables: Array<Omit<FormulaVariable, "value"> & { value: number }>;
};

const directionalVariable = (
  key: string,
  label: string,
  value: number,
  min = -20,
  max = 20,
  step = 0.1
) => ({
  key,
  label,
  value,
  min,
  max,
  step,
});

const FORMULA_DEFINITIONS: Record<FormulaObjectKind, FormulaDefinition> = {
  square: {
    kind: "square",
    name: "Square",
    formula: "A = s^2, P = 4s",
    variables: [directionalVariable("s", "side", 2)],
  },
  rectangle: {
    kind: "rectangle",
    name: "Rectangle",
    formula: "A = w x h, P = 2(w + h)",
    variables: [
      directionalVariable("w", "width", 3),
      directionalVariable("h", "height", 2),
    ],
  },
  circle: {
    kind: "circle",
    name: "Circle",
    formula: "A = pi r^2, C = 2pi r",
    variables: [directionalVariable("r", "radius", 2)],
  },
  triangle: {
    kind: "triangle",
    name: "Triangle",
    formula: "A = 1/2 x b x h",
    variables: [
      directionalVariable("b", "base", 3),
      directionalVariable("h", "height", 2),
    ],
  },
  "right-triangle": {
    kind: "right-triangle",
    name: "Right triangle",
    formula: "c = sqrt(a^2 + b^2)",
    variables: [
      directionalVariable("a", "leg a", 3),
      directionalVariable("b", "leg b", 2),
    ],
  },
  ellipse: {
    kind: "ellipse",
    name: "Ellipse",
    formula: "x^2/a^2 + y^2/b^2 = 1",
    variables: [
      directionalVariable("a", "radius a", 3),
      directionalVariable("b", "radius b", 2),
    ],
  },
  line: {
    kind: "line",
    name: "Line",
    formula: "y = mx + b",
    variables: [
      directionalVariable("m", "m", 1),
      directionalVariable("b", "b", 0),
    ],
  },
  parabola: {
    kind: "parabola",
    name: "Parabola",
    formula: "y = ax^2 + bx + c",
    variables: [
      directionalVariable("a", "a", 1, -5, 5, 0.05),
      directionalVariable("b", "b", 0),
      directionalVariable("c", "c", 0),
    ],
  },
  sine: {
    kind: "sine",
    name: "Sine wave",
    formula: "y = A sin(Bx + C) + D",
    variables: [
      directionalVariable("A", "A", 1),
      directionalVariable("B", "B", 1, -10, 10, 0.05),
      directionalVariable("C", "C", 0),
      directionalVariable("D", "D", 0),
    ],
  },
  cosine: {
    kind: "cosine",
    name: "Cosine wave",
    formula: "y = A cos(Bx + C) + D",
    variables: [
      directionalVariable("A", "A", 1),
      directionalVariable("B", "B", 1, -10, 10, 0.05),
      directionalVariable("C", "C", 0),
      directionalVariable("D", "D", 0),
    ],
  },
  exponential: {
    kind: "exponential",
    name: "Exponential",
    formula: "y = A * e^(Bx) + D",
    variables: [
      directionalVariable("A", "A", 1, -10, 10, 0.05),
      directionalVariable("B", "B", 0.5, -3, 3, 0.05),
      directionalVariable("D", "D", 0),
    ],
  },
  logarithmic: {
    kind: "logarithmic",
    name: "Logarithmic",
    formula: "y = A log(Bx + C) + D",
    variables: [
      directionalVariable("A", "A", 1, -10, 10, 0.05),
      directionalVariable("B", "B", 1, -10, 10, 0.05),
      directionalVariable("C", "C", 2),
      directionalVariable("D", "D", 0),
    ],
  },
  absolute: {
    kind: "absolute",
    name: "Absolute value",
    formula: "y = A|Bx + C| + D",
    variables: [
      directionalVariable("A", "A", 1, -10, 10, 0.05),
      directionalVariable("B", "B", 1, -10, 10, 0.05),
      directionalVariable("C", "C", 0),
      directionalVariable("D", "D", 0),
    ],
  },
};

export const FORMULA_OBJECT_KINDS = Object.keys(
  FORMULA_DEFINITIONS
) as FormulaObjectKind[];

export const getFormulaDefinition = (kind: FormulaObjectKind) =>
  FORMULA_DEFINITIONS[kind];

export const createFormulaObject = (
  kind: FormulaObjectKind,
  id: number,
  color: string,
  anchor: GraphPoint = { id: 0, x: 0, y: 0 }
): GraphFormulaObject => {
  const definition = getFormulaDefinition(kind);
  return {
    id,
    kind,
    name: `${definition.name} ${id}`,
    formula: definition.formula,
    variables: definition.variables.map((variable) => ({ ...variable })),
    anchor: { ...anchor },
    color,
    showLabel: true,
  };
};

export const getFormulaValue = (
  object: Pick<GraphFormulaObject, "variables">,
  key: string
) => object.variables.find((variable) => variable.key === key)?.value ?? 0;

export const setFormulaVariableValue = (
  object: GraphFormulaObject,
  variableKey: string,
  value: number
): GraphFormulaObject => ({
  ...object,
  variables: object.variables.map((variable) =>
    variable.key === variableKey
      ? { ...variable, value: roundCoordinate(value) }
      : variable
  ),
});

export const getFormulaComputedValues = (
  object: GraphFormulaObject
): Array<[string, number | string]> => {
  const value = (key: string) => getFormulaValue(object, key);
  const abs = (amount: number) => Math.abs(amount);

  if (object.kind === "square") {
    const s = value("s");
    return [
      ["area", s ** 2],
      ["perimeter", 4 * abs(s)],
      ["center", `${formatNumber(object.anchor.x + s / 2)}, ${formatNumber(object.anchor.y + s / 2)}`],
    ];
  }

  if (object.kind === "rectangle") {
    const w = value("w");
    const h = value("h");
    return [
      ["area", abs(w * h)],
      ["perimeter", 2 * (abs(w) + abs(h))],
      ["center", `${formatNumber(object.anchor.x + w / 2)}, ${formatNumber(object.anchor.y + h / 2)}`],
    ];
  }

  if (object.kind === "circle") {
    const r = abs(value("r"));
    return [
      ["area", Math.PI * r ** 2],
      ["circumference", 2 * Math.PI * r],
      ["center", `${formatNumber(object.anchor.x)}, ${formatNumber(object.anchor.y)}`],
      ["radius", r],
    ];
  }

  if (object.kind === "triangle") {
    const b = value("b");
    const h = value("h");
    return [
      ["area", abs((b * h) / 2)],
      ["base", b],
      ["height", h],
    ];
  }

  if (object.kind === "right-triangle") {
    const a = value("a");
    const b = value("b");
    return [
      ["hypotenuse", Math.hypot(a, b)],
      ["area", abs((a * b) / 2)],
    ];
  }

  if (object.kind === "ellipse") {
    const a = abs(value("a"));
    const b = abs(value("b"));
    return [
      ["area", Math.PI * a * b],
      ["center", `${formatNumber(object.anchor.x)}, ${formatNumber(object.anchor.y)}`],
      ["radius a", a],
      ["radius b", b],
    ];
  }

  if (object.kind === "line") {
    return [
      ["slope", value("m")],
      ["y-intercept", value("b")],
    ];
  }

  return object.variables.map((variable) => [variable.label, variable.value] as const);
};

export const formatComputedValues = (object: GraphFormulaObject) =>
  getFormulaComputedValues(object).map(([label, value]) => ({
    label,
    value: typeof value === "number" ? formatNumber(value) : value,
  }));

export const evaluateFormulaObject = (
  object: GraphFormulaObject,
  x: number
): number | null => {
  const value = (key: string) => getFormulaValue(object, key);
  if (object.kind === "line") return value("m") * x + value("b");
  if (object.kind === "parabola") {
    return value("a") * x ** 2 + value("b") * x + value("c");
  }
  if (object.kind === "sine") {
    return value("A") * Math.sin(value("B") * x + value("C")) + value("D");
  }
  if (object.kind === "cosine") {
    return value("A") * Math.cos(value("B") * x + value("C")) + value("D");
  }
  if (object.kind === "exponential") {
    return value("A") * Math.exp(value("B") * x) + value("D");
  }
  if (object.kind === "logarithmic") {
    const input = value("B") * x + value("C");
    return input > 0 ? value("A") * Math.log(input) + value("D") : null;
  }
  if (object.kind === "absolute") {
    return value("A") * Math.abs(value("B") * x + value("C")) + value("D");
  }
  return null;
};
