import type { ViewState } from "../graphTypes";

export const START_VIEW: ViewState = {
  offsetX: 0,
  offsetY: 0,
  pixelsPerUnit: 64,
};

export const MIN_ZOOM = 12;
export const MAX_ZOOM = 480;
export const ZOOM_BUTTON_STEP = 1;
export const WHEEL_ZOOM_FACTOR_PER_DELTA = 0.004;
export const PINCH_ZOOM_FACTOR_PER_DELTA = 0.018;
export const TRACKPAD_WHEEL_PAN_THRESHOLD = 80;
export const SNAP_STEPS = [1, 0.5, 0.25, 0.1, 0.05, 0.01];
export const COLOR_SWATCHES = [
  "#28666e",
  "#7a4f9a",
  "#d94f30",
  "#2f8f5b",
  "#c28a16",
  "#24211e",
];
export const SUBGRID_STEP = 0.25;
export const TAP_THRESHOLD_PX = 6;
export const DRAW_LINE_THRESHOLD_PX = 18;
export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 520;

export const SURFACE_PRESETS = [
  {
    name: "Convex Bowl",
    description: "MSE loss",
    equation: "(x*x + y*y) / 4",
    range: 6,
    resolution: 56,
  },
  {
    name: "Concave Bowl",
    description: "Negative bowl",
    equation: "-(x*x + y*y) / 4",
    range: 6,
    resolution: 56,
  },
  {
    name: "Saddle",
    description: "Gradient trap",
    equation: "(x*x - y*y) / 8",
    range: 6,
    resolution: 56,
  },
  {
    name: "Rosenbrock",
    description: "Narrow valley",
    equation: "((1 - x)*(1 - x) + 100*(y - x*x)*(y - x*x)) / 120",
    range: 2.5,
    resolution: 72,
  },
  {
    name: "Gaussian RBF",
    description: "Kernel bump",
    equation: "3*exp(-(x*x + y*y)/4)",
    range: 6,
    resolution: 64,
  },
  {
    name: "Sigmoid",
    description: "Decision surface",
    equation: "1 / (1 + exp(-(2*x - y)))",
    range: 6,
    resolution: 56,
  },
  {
    name: "ReLU Plane",
    description: "Activation",
    equation: "max(0, x + y)",
    range: 5,
    resolution: 52,
  },
  {
    name: "Hinge Loss",
    description: "Classifier loss",
    equation: "max(0, 1 - x*y)",
    range: 4,
    resolution: 56,
  },
  {
    name: "Non-convex",
    description: "Local minima",
    equation: "sin(x)*cos(y) + (x*x + y*y)/18",
    range: 7,
    resolution: 72,
  },
];
