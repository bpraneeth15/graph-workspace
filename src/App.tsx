import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  PointerEvent,
  ReactNode,
  Suspense,
  WheelEvent,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScientificCalculator } from "./features/calculator/ScientificCalculator";
import {
  buildCorrelationGeometry,
  getCorrelationFormulaComponent,
  type CorrelationGeometryItem,
} from "./features/formulaVisualization/correlationFormula";
import {
  COLOR_SWATCHES,
  DEFAULT_SIDEBAR_WIDTH,
  DRAW_LINE_THRESHOLD_PX,
  MAX_SIDEBAR_WIDTH,
  MAX_ZOOM,
  MIN_SIDEBAR_WIDTH,
  MIN_ZOOM,
  PINCH_ZOOM_FACTOR_PER_DELTA,
  SNAP_STEPS,
  START_VIEW,
  SUBGRID_STEP,
  SURFACE_PRESETS,
  TAP_THRESHOLD_PX,
  TRACKPAD_WHEEL_PAN_THRESHOLD,
  WHEEL_ZOOM_FACTOR_PER_DELTA,
  ZOOM_BUTTON_STEP,
} from "./config/graphConfig";
import type {
  CalculatorGuide,
  CalculatorMeanPoint,
  CorrelationGuide,
  CorrelationHighlight,
  DataPlot,
  DataPointStyle,
  DataPlotStyle,
  DataValue,
  FormulaObjectKind,
  GraphFormulaObject,
  GraphCurve,
  GraphLine,
  GraphMeasure,
  GraphPoint,
  GraphShape,
  ObjectTarget,
  RendererMode,
  SurfaceDataPoint,
  SurfaceShape,
  SurfaceStroke,
  SurfaceTool,
  SurfaceVector3,
  StatisticHighlight,
  Tool,
  ViewState,
  WorkspaceMode,
} from "./graphTypes";
import { parseDataValues } from "./lib/dataParsing";
import {
  FORMULA_OBJECT_KINDS,
  createFormulaObject,
  evaluateFormulaObject,
  formatComputedValues,
  getFormulaDefinition,
  getFormulaValue,
  setFormulaVariableValue,
} from "./lib/formulaObjects";
import {
  formatCurveEquation,
  formatLineEquation,
  formatMeasureLabel,
  formatNumber,
  formatShapeLabel,
  getDataInputLabel,
  getDataInputPlaceholder,
  getDistance,
  getLineParts,
  getObjectTitle,
  getQuadraticCoefficients,
  getShapeBounds,
  getShapeCenter,
  getShapeCorners,
  getShapeLocalPoint,
  getToolHelp,
  getToolTitle,
  isTypingTarget,
  rotatePointAround,
  SHAPE_VERTICES,
  type ShapeVertex,
} from "./lib/graphFormatting";
import {
  clamp,
  closestPointOnSegmentWorld,
  crispLine,
  distanceToSegment,
  getCanvasDpr,
  niceStep,
  roundCoordinate,
} from "./lib/graphMath";

const Surface3DViewer = lazy(() =>
  import("./features/surface/Surface3DViewer").then((module) => ({
    default: module.Surface3DViewer,
  }))
);

const CAPTURE_STORAGE_KEY = "graph-workspace:captures";
const PAGE_STORAGE_KEY = "graph-workspace:pages";

type GraphSnapshot = {
  points: GraphPoint[];
  lines: GraphLine[];
  curves: GraphCurve[];
  shapes: GraphShape[];
  formulaObjects: GraphFormulaObject[];
  measures: GraphMeasure[];
  dataPlots: DataPlot[];
  canvasStrokes: CanvasStroke[];
  canvasTextBoxes: CanvasTextBox[];
};

type WorkspaceCapture = {
  id: string;
  name: string;
  savedAt: string;
  workspaceMode: WorkspaceMode;
  view: ViewState;
  points: GraphPoint[];
  lines: GraphLine[];
  curves: GraphCurve[];
  shapes: GraphShape[];
  formulaObjects: GraphFormulaObject[];
  measures: GraphMeasure[];
  dataPlots: DataPlot[];
  canvasStrokes: CanvasStroke[];
  canvasTextBoxes: CanvasTextBox[];
  selectedColor: string;
  surface: {
    selectedShapeId: number;
    shapes: SurfaceShape[];
    strokes: SurfaceStroke[];
    dataPoints: SurfaceDataPoint[];
    range: number;
    resolution: number;
    showSlices: boolean;
    showContour: boolean;
    panelView: SurfacePanelView;
    cutX: number;
    cutY: number;
    cutZ: number;
    rendererMode: RendererMode;
  };
};

type SurfacePanelView = "contour" | "flat";

type HandleTarget =
  | { kind: "point"; id: number }
  | { kind: "line"; id: number; handle: "a" | "b" }
  | { kind: "curve"; id: number; handle: "a" | "b" | "c" }
  | { kind: "shape"; id: number; handle: ShapeVertex }
  | { kind: "measure"; id: number; handle: "a" | "b" }
  | { kind: "data"; id: number; pointIndex: number };

type GroupTarget =
  | ObjectTarget
  | { kind: "point"; id: number }
  | { kind: "data"; id: number; pointIndex: number };

type HoverMenu = {
  target: ObjectTarget;
  x: number;
  y: number;
};

type HoverSnapPoint = {
  point: GraphPoint;
  target: ObjectTarget;
};

type LeastSquaresResidual = {
  point: GraphPoint;
  fittedY: number;
  residual: number;
  squared: number;
};

type LeastSquaresSummary = {
  line: GraphLine;
  residuals: LeastSquaresResidual[];
  sum: number;
};

type CanvasTool = "none" | "pencil" | "marker" | "eraser" | "text";

type CanvasStroke = {
  id: number;
  color: string;
  opacity: number;
  width: number;
  points: GraphPoint[];
  tool: "pencil" | "marker";
};

type GraphPage = {
  id: string;
  name: string;
  state: WorkspaceCapture;
  snapshots: WorkspaceCapture[];
};

type CanvasTextBox = {
  id: number;
  color: string;
  position: GraphPoint;
  text: string;
};

type CanvasToolbarPosition = {
  x: number;
  y: number;
};

type CanvasToolbarDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastMoveTime: number;
  velocityX: number;
  velocityY: number;
  moved: boolean;
  mode:
    | "none"
    | "pan"
    | "handle"
    | "object"
    | "group"
    | "draw-line"
    | "draw-shape"
    | "draw-measure"
    | "canvas-draw"
    | "canvas-erase";
  startWorld: GraphPoint;
  historySnapshot?: GraphSnapshot;
  historyPushed: boolean;
  target?: HandleTarget;
  objectTarget?: ObjectTarget;
  groupTarget?: GroupTarget;
  canvasStrokeId?: number;
};


const clonePoint = (point: GraphPoint): GraphPoint => ({ ...point });

const cloneSnapshot = (snapshot: GraphSnapshot): GraphSnapshot => ({
  points: snapshot.points.map(clonePoint),
  lines: snapshot.lines.map((line) => ({
    ...line,
    a: clonePoint(line.a),
    b: clonePoint(line.b),
  })),
  curves: snapshot.curves.map((curve) => ({
    ...curve,
    a: clonePoint(curve.a),
    b: clonePoint(curve.b),
    c: clonePoint(curve.c),
  })),
  shapes: snapshot.shapes.map((shape) => ({
    ...shape,
    a: clonePoint(shape.a),
    b: clonePoint(shape.b),
  })),
  formulaObjects: (snapshot.formulaObjects ?? []).map((object) => ({
    ...object,
    anchor: clonePoint(object.anchor),
    variables: object.variables.map((variable) => ({ ...variable })),
  })),
  measures: snapshot.measures.map((measure) => ({
    ...measure,
    a: clonePoint(measure.a),
    b: clonePoint(measure.b),
  })),
  dataPlots: snapshot.dataPlots.map((plot) => ({
    ...plot,
    values: plot.values.map((value) => ({ ...value })),
  })),
  canvasStrokes: (snapshot.canvasStrokes ?? []).map((stroke) => ({
    ...stroke,
    points: stroke.points.map(clonePoint),
  })),
  canvasTextBoxes: (snapshot.canvasTextBoxes ?? []).map((textBox) => ({
    ...textBox,
    position: clonePoint(textBox.position),
  })),
});

const readWorkspaceCaptures = (): WorkspaceCapture[] => {
  try {
    const raw = localStorage.getItem(CAPTURE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeWorkspaceCaptures = (captures: WorkspaceCapture[]) => {
  localStorage.setItem(CAPTURE_STORAGE_KEY, JSON.stringify(captures));
};

const getNextId = (items: Array<{ id: number }>) =>
  Math.max(1, ...items.map((item) => item.id + 1));

const cloneWorkspaceCapture = (capture: WorkspaceCapture): WorkspaceCapture =>
  JSON.parse(JSON.stringify(capture)) as WorkspaceCapture;

const createEmptyWorkspaceCapture = (name = "Page 1"): WorkspaceCapture => ({
  id: `page-state-${Date.now()}`,
  name,
  savedAt: new Date().toISOString(),
  workspaceMode: "2d",
  view: { ...START_VIEW },
  points: [],
  lines: [],
  curves: [],
  shapes: [],
  formulaObjects: [],
  measures: [],
  dataPlots: [],
  canvasStrokes: [],
  canvasTextBoxes: [],
  selectedColor: COLOR_SWATCHES[0],
  surface: {
    selectedShapeId: 1,
    shapes: [
      {
        id: 1,
        type: "surface",
        name: "Surface 1",
        equation: "sin(sqrt(x*x + y*y))",
        color: COLOR_SWATCHES[0],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
    strokes: [],
    dataPoints: [],
    range: 6,
    resolution: 48,
    showSlices: true,
    showContour: true,
    panelView: "contour",
    cutX: 0,
    cutY: 0,
    cutZ: 0,
    rendererMode: "auto",
  },
});

const createGraphPage = (name: string, id = `page-${Date.now()}`): GraphPage => ({
  id,
  name,
  state: createEmptyWorkspaceCapture(name),
  snapshots: [],
});

const readGraphPages = (): GraphPage[] => {
  try {
    const raw = localStorage.getItem(PAGE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed.map((page) => ({
          ...page,
          snapshots: Array.isArray(page.snapshots) ? page.snapshots.slice(0, 3) : [],
        }))
      : [createGraphPage("Page 1", "page-1")];
  } catch {
    return [createGraphPage("Page 1", "page-1")];
  }
};

const writeGraphPages = (pages: GraphPage[]) => {
  localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(pages));
};

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef({ dx: 0, dy: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const undoStack = useRef<GraphSnapshot[]>([]);
  const redoStack = useRef<GraphSnapshot[]>([]);
  const [pages, setPages] = useState<GraphPage[]>(readGraphPages);
  const [activePageId, setActivePageId] = useState(() => pages[0].id);
  const [comparisonPageId, setComparisonPageId] = useState("");
  const [selectedPageSnapshotId, setSelectedPageSnapshotId] = useState("");
  const initialWorkspace = pages[0].state;
  const nextPointId = useRef(getNextId(initialWorkspace.points));
  const nextLineId = useRef(getNextId(initialWorkspace.lines));
  const nextCurveId = useRef(getNextId(initialWorkspace.curves));
  const nextShapeId = useRef(getNextId(initialWorkspace.shapes));
  const nextFormulaObjectId = useRef(getNextId(initialWorkspace.formulaObjects ?? []));
  const nextMeasureId = useRef(getNextId(initialWorkspace.measures));
  const nextDataPlotId = useRef(getNextId(initialWorkspace.dataPlots));
  const nextCanvasStrokeId = useRef(getNextId(initialWorkspace.canvasStrokes ?? []));
  const nextCanvasTextBoxId = useRef(getNextId(initialWorkspace.canvasTextBoxes ?? []));
  const nextSurfaceShapeId = useRef(getNextId(initialWorkspace.surface.shapes));
  const nextSurfaceStrokeId = useRef(getNextId(initialWorkspace.surface.strokes));
  const nextSurfaceDataPointId = useRef(getNextId(initialWorkspace.surface.dataPoints));

  const [view, setView] = useState<ViewState>(initialWorkspace.view);
  const [points, setPoints] = useState<GraphPoint[]>(initialWorkspace.points);
  const [lines, setLines] = useState<GraphLine[]>(initialWorkspace.lines);
  const [curves, setCurves] = useState<GraphCurve[]>(initialWorkspace.curves);
  const [shapes, setShapes] = useState<GraphShape[]>(initialWorkspace.shapes);
  const [formulaObjects, setFormulaObjects] = useState<GraphFormulaObject[]>(
    initialWorkspace.formulaObjects ?? []
  );
  const [measures, setMeasures] = useState<GraphMeasure[]>(initialWorkspace.measures);
  const [dataPlots, setDataPlots] = useState<DataPlot[]>(initialWorkspace.dataPlots);
  const [canvasStrokes, setCanvasStrokes] = useState<CanvasStroke[]>(
    initialWorkspace.canvasStrokes ?? []
  );
  const [canvasTextBoxes, setCanvasTextBoxes] = useState<CanvasTextBox[]>(
    initialWorkspace.canvasTextBoxes ?? []
  );
  const [activeCanvasTextBoxId, setActiveCanvasTextBoxId] = useState<number | null>(null);
  const [draftPoints, setDraftPoints] = useState<GraphPoint[]>([]);
  const [tool, setTool] = useState<Tool>("plot");
  const [openToolMenu, setOpenToolMenu] = useState<Tool>("plot");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    initialWorkspace.workspaceMode
  );
  const [selectedColor, setSelectedColor] = useState(initialWorkspace.selectedColor);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapStep, setSnapStep] = useState(SUBGRID_STEP);
  const [connectPoints, setConnectPoints] = useState(false);
  const [showLeastSquares, setShowLeastSquares] = useState(false);
  const [referenceLineMode, setReferenceLineMode] = useState(false);
  const [referenceSquareSide, setReferenceSquareSide] = useState<1 | -1>(1);
  const [formulaObjectKind, setFormulaObjectKind] =
    useState<FormulaObjectKind>("circle");
  const [expandedFormulaCards, setExpandedFormulaCards] = useState<
    Record<string, boolean>
  >({});
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("none");
  const [isCanvasToolbarCollapsed, setIsCanvasToolbarCollapsed] = useState(true);
  const [canvasToolbarPosition, setCanvasToolbarPosition] =
    useState<CanvasToolbarPosition>({ x: 74, y: 74 });
  const [captures, setCaptures] = useState<WorkspaceCapture[]>(readWorkspaceCaptures);
  const [selectedCaptureId, setSelectedCaptureId] = useState("");
  const [captureName, setCaptureName] = useState("Graph capture");
  const [cursor, setCursor] = useState<GraphPoint | null>(null);
  const [manualX, setManualX] = useState("");
  const [manualY, setManualY] = useState("");
  const [dataName, setDataName] = useState("Data set");
  const [dataInput, setDataInput] = useState("(0, 0)\n(1, 1)\n(2, 4)\n(3, 9)");
  const [dataPlotStyle, setDataPlotStyle] = useState<DataPlotStyle>("scatter");
  const [dataXInput, setDataXInput] = useState("");
  const [dataYInput, setDataYInput] = useState("");
  const [dataError, setDataError] = useState("");
  const [surfaceShapes, setSurfaceShapes] = useState<SurfaceShape[]>(
    initialWorkspace.surface.shapes
  );
  const [selectedSurfaceShapeId, setSelectedSurfaceShapeId] = useState(
    initialWorkspace.surface.selectedShapeId
  );
  const [surfaceTool, setSurfaceTool] = useState<SurfaceTool>("select");
  const [surfaceStrokes, setSurfaceStrokes] = useState<SurfaceStroke[]>(
    initialWorkspace.surface.strokes
  );
  const [surfaceDataPoints, setSurfaceDataPoints] = useState<SurfaceDataPoint[]>(
    initialWorkspace.surface.dataPoints
  );
  const [surfaceRange, setSurfaceRange] = useState(initialWorkspace.surface.range);
  const [surfaceResolution, setSurfaceResolution] = useState(
    initialWorkspace.surface.resolution
  );
  const [surfaceShowSlices, setSurfaceShowSlices] = useState(
    initialWorkspace.surface.showSlices
  );
  const [surfaceShowContour, setSurfaceShowContour] = useState(
    initialWorkspace.surface.showContour
  );
  const [surfacePanelView, setSurfacePanelView] = useState<SurfacePanelView>(
    initialWorkspace.surface.panelView
  );
  const [surfaceCutX, setSurfaceCutX] = useState(initialWorkspace.surface.cutX);
  const [surfaceCutY, setSurfaceCutY] = useState(initialWorkspace.surface.cutY);
  const [surfaceCutZ, setSurfaceCutZ] = useState(initialWorkspace.surface.cutZ);
  const [rendererMode, setRendererMode] = useState<RendererMode>(
    initialWorkspace.surface.rendererMode
  );
  const [mouseSensitivity, setMouseSensitivity] = useState(1);
  const [zoomSensitivity, setZoomSensitivity] = useState(1);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedObject, setSelectedObject] = useState<ObjectTarget | null>(null);
  const [groupSelectionMode, setGroupSelectionMode] = useState(false);
  const [lockedGroupTargets, setLockedGroupTargets] = useState<GroupTarget[]>([]);
  const [isGroupLocked, setIsGroupLocked] = useState(false);
  const [hoverMenu, setHoverMenu] = useState<HoverMenu | null>(null);
  const [hoverSnapPoint, setHoverSnapPoint] = useState<HoverSnapPoint | null>(null);
  const [calculatorGuide, setCalculatorGuide] = useState<CalculatorGuide | null>(null);
  const [calculatorMeanPoint, setCalculatorMeanPoint] =
    useState<CalculatorMeanPoint | null>(null);
  const [correlationGuide, setCorrelationGuide] = useState<CorrelationGuide | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const effectiveRenderer: "canvas" | "gpu" =
    workspaceMode === "surface" ? (rendererMode === "canvas" ? "canvas" : "gpu") : "canvas";
  const rendererStatusText =
    workspaceMode === "surface"
      ? `Active: ${effectiveRenderer === "gpu" ? "GPU / WebGL" : "Canvas 2D"}`
      : rendererMode === "gpu"
        ? "GPU selected. Current 2D board still uses Canvas 2D."
        : "Active: Canvas 2D";
  const selectedSurfaceShape =
    surfaceShapes.find((shape) => shape.id === selectedSurfaceShapeId) ??
    surfaceShapes[0];
  const surfaceEquation =
    selectedSurfaceShape?.equation ?? "sin(sqrt(x*x + y*y))";
  const surfaceColor = selectedSurfaceShape?.color ?? COLOR_SWATCHES[0];
  const selectedSurfaceType = selectedSurfaceShape?.type ?? "surface";

  const selectTool = (nextTool: Tool) => {
    setTool(nextTool);
    setOpenToolMenu(nextTool);
    setDraftPoints([]);
  };

  const switchWorkspaceMode = (nextMode: WorkspaceMode) => {
    setWorkspaceMode(nextMode);
    setDraftPoints([]);
    setHoverMenu(null);
    setHoverSnapPoint(null);
    setCursor(null);
  };

  const applySurfacePreset = (preset: (typeof SURFACE_PRESETS)[number]) => {
    updateSelectedSurfaceShape({ equation: preset.equation });
    setSurfaceRange(preset.range);
    setSurfaceResolution(preset.resolution);
  };

  const addSurfaceShape = () => {
    const id = nextSurfaceShapeId.current++;
    const shape: SurfaceShape = {
      id,
      type: "surface",
      name: `Surface ${id}`,
      equation: "sin(x) * cos(y)",
      color: selectedColor,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    setSurfaceShapes((current) => [...current, shape]);
    setSelectedSurfaceShapeId(id);
    setSurfaceTool("select");
  };

  const addSurfaceCube = () => {
    const id = nextSurfaceShapeId.current++;
    const cube: SurfaceShape = {
      id,
      type: "cube",
      name: `Cube ${id}`,
      equation: "",
      color: selectedColor,
      position: { x: 0, y: 0.5, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    setSurfaceShapes((current) => [...current, cube]);
    setSelectedSurfaceShapeId(id);
    setSurfaceTool("select");
  };

  const updateSelectedSurfaceShape = (patch: Partial<SurfaceShape>) => {
    setSurfaceShapes((current) =>
      current.map((shape) =>
        shape.id === selectedSurfaceShapeId ? { ...shape, ...patch } : shape
      )
    );
  };

  const updateSurfaceShapeTransform = (
    id: number,
    transform: { position?: SurfaceVector3; scale?: SurfaceVector3 }
  ) => {
    setSurfaceShapes((current) =>
      current.map((shape) =>
        shape.id === id
          ? {
              ...shape,
              position: transform.position ?? shape.position,
              scale: transform.scale ?? shape.scale,
            }
          : shape
      )
    );
  };

  const replicateSurfaceShape = () => {
    if (!selectedSurfaceShape) return;
    const id = nextSurfaceShapeId.current++;
    const copy: SurfaceShape = {
      ...selectedSurfaceShape,
      id,
      name: `Surface ${id}`,
      position: {
        x: selectedSurfaceShape.position.x + 0.8,
        y: selectedSurfaceShape.position.y,
        z: selectedSurfaceShape.position.z + 0.8,
      },
      scale: { ...selectedSurfaceShape.scale },
    };
    setSurfaceShapes((current) => [...current, copy]);
    setSelectedSurfaceShapeId(id);
    setSurfaceTool("select");
  };

  const getCurrentWorkspaceCapture = (
    name = pages.find((page) => page.id === activePageId)?.name ?? "Graph page"
  ): WorkspaceCapture => ({
    id: `page-state-${Date.now()}`,
    name,
    savedAt: new Date().toISOString(),
    workspaceMode,
    view,
    points,
    lines,
    curves,
    shapes,
    formulaObjects,
    measures,
    dataPlots,
    canvasStrokes,
    canvasTextBoxes,
    selectedColor,
    surface: {
      selectedShapeId: selectedSurfaceShapeId,
      shapes: surfaceShapes,
      strokes: surfaceStrokes,
      dataPoints: surfaceDataPoints,
      range: surfaceRange,
      resolution: surfaceResolution,
      showSlices: surfaceShowSlices,
      showContour: surfaceShowContour,
      panelView: surfacePanelView,
      cutX: surfaceCutX,
      cutY: surfaceCutY,
      cutZ: surfaceCutZ,
      rendererMode,
    },
  });

  const saveWorkspaceSnapshot = () => {
    localStorage.setItem(
      "graph-workspace:snapshot",
      JSON.stringify({
        savedAt: new Date().toISOString(),
        workspaceMode,
        view,
        points,
        lines,
        curves,
        shapes,
        formulaObjects,
        measures,
        dataPlots,
        canvasStrokes,
        canvasTextBoxes,
        surface: {
          selectedShapeId: selectedSurfaceShapeId,
          shapes: surfaceShapes,
          strokes: surfaceStrokes,
          dataPoints: surfaceDataPoints,
          range: surfaceRange,
          resolution: surfaceResolution,
          slices: {
            show: surfaceShowSlices,
            contourPanelView: surfacePanelView,
            x: surfaceCutX,
            y: surfaceCutY,
            z: surfaceCutZ,
          },
        },
      })
    );
  };

  const createWorkspaceCapture = (name = captureName) => {
    const id = `${Date.now()}`;
    const nextCapture: WorkspaceCapture = {
      ...getCurrentWorkspaceCapture(name.trim() || `Capture ${captures.length + 1}`),
      id,
    };

    setCaptures((current) => {
      const next = [nextCapture, ...current].slice(0, 20);
      writeWorkspaceCaptures(next);
      return next;
    });
    setSelectedCaptureId(id);
  };

  const restoreWorkspaceCapture = (
    captureId = selectedCaptureId,
    captureOverride?: WorkspaceCapture,
    trackHistory = true
  ) => {
    const capture = captureOverride ?? captures.find((item) => item.id === captureId);
    if (!capture) return;

    if (trackHistory) pushHistory();
    setWorkspaceMode(capture.workspaceMode);
    setView(capture.view);
    setPoints(capture.points.map(clonePoint));
    setLines(
      capture.lines.map((line) => ({
        ...line,
        a: clonePoint(line.a),
        b: clonePoint(line.b),
      }))
    );
    setCurves(
      capture.curves.map((curve) => ({
        ...curve,
        a: clonePoint(curve.a),
        b: clonePoint(curve.b),
        c: clonePoint(curve.c),
      }))
    );
    setShapes(
      capture.shapes.map((shape) => ({
        ...shape,
        a: clonePoint(shape.a),
        b: clonePoint(shape.b),
      }))
    );
    setFormulaObjects(
      (capture.formulaObjects ?? []).map((object) => ({
        ...object,
        anchor: clonePoint(object.anchor),
        variables: object.variables.map((variable) => ({ ...variable })),
      }))
    );
    setMeasures(
      capture.measures.map((measure) => ({
        ...measure,
        a: clonePoint(measure.a),
        b: clonePoint(measure.b),
      }))
    );
    setDataPlots(
      capture.dataPlots.map((plot) => ({
        ...plot,
        values: plot.values.map((value) => ({ ...value })),
      }))
    );
    setCanvasStrokes(
      (capture.canvasStrokes ?? []).map((stroke) => ({
        ...stroke,
        points: stroke.points.map(clonePoint),
      }))
    );
    setCanvasTextBoxes(
      (capture.canvasTextBoxes ?? []).map((textBox) => ({
        ...textBox,
        position: clonePoint(textBox.position),
      }))
    );
    setSelectedColor(capture.selectedColor);
    setSurfaceShapes(capture.surface.shapes.map((shape) => ({ ...shape })));
    setSelectedSurfaceShapeId(capture.surface.selectedShapeId);
    setSurfaceStrokes(
      capture.surface.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      }))
    );
    setSurfaceDataPoints(
      capture.surface.dataPoints.map((point) => ({ ...point }))
    );
    setSurfaceRange(capture.surface.range ?? 6);
    setSurfaceResolution(capture.surface.resolution ?? 48);
    setSurfaceShowSlices(capture.surface.showSlices ?? true);
    setSurfaceShowContour(capture.surface.showContour ?? true);
    setSurfacePanelView(capture.surface.panelView ?? "contour");
    setSurfaceCutX(capture.surface.cutX ?? 0);
    setSurfaceCutY(capture.surface.cutY ?? 0);
    setSurfaceCutZ(capture.surface.cutZ ?? 0);
    setRendererMode(capture.surface.rendererMode ?? "auto");
    setSelectedObject(null);
    setDraftPoints([]);
    setHoverMenu(null);
    setHoverSnapPoint(null);
    setCalculatorGuide(null);
    setCalculatorMeanPoint(null);
    setCorrelationGuide(null);
    clearLockedGroup();
    syncNextIdsFromCapture(capture);
  };

  const deleteWorkspaceCapture = (captureId = selectedCaptureId) => {
    if (!captureId) return;
    setCaptures((current) => {
      const next = current.filter((capture) => capture.id !== captureId);
      writeWorkspaceCaptures(next);
      return next;
    });
    setSelectedCaptureId((current) => (current === captureId ? "" : current));
  };

  const syncNextIdsFromCapture = (capture: WorkspaceCapture) => {
    nextPointId.current = getNextId(capture.points);
    nextLineId.current = getNextId(capture.lines);
    nextCurveId.current = getNextId(capture.curves);
    nextShapeId.current = getNextId(capture.shapes);
    nextFormulaObjectId.current = getNextId(capture.formulaObjects ?? []);
    nextMeasureId.current = getNextId(capture.measures);
    nextDataPlotId.current = getNextId(capture.dataPlots);
    nextCanvasStrokeId.current = getNextId(capture.canvasStrokes);
    nextCanvasTextBoxId.current = getNextId(capture.canvasTextBoxes ?? []);
    nextSurfaceShapeId.current = getNextId(capture.surface.shapes);
    nextSurfaceStrokeId.current = getNextId(capture.surface.strokes);
    nextSurfaceDataPointId.current = getNextId(capture.surface.dataPoints);
  };

  const updatePages = (updater: (current: GraphPage[]) => GraphPage[]) => {
    setPages((current) => {
      const next = updater(current);
      writeGraphPages(next);
      return next;
    });
  };

  const saveActiveGraphPage = () => {
    const pageState = cloneWorkspaceCapture(getCurrentWorkspaceCapture());
    updatePages((current) =>
      current.map((page) =>
        page.id === activePageId ? { ...page, state: pageState } : page
      )
    );
  };

  const switchGraphPage = (pageId: string) => {
    if (pageId === activePageId) return;
    const nextPage = pages.find((page) => page.id === pageId);
    if (!nextPage) return;
    const pageState = cloneWorkspaceCapture(getCurrentWorkspaceCapture());
    updatePages((current) =>
      current.map((page) =>
        page.id === activePageId ? { ...page, state: pageState } : page
      )
    );
    setActivePageId(pageId);
    setSelectedPageSnapshotId("");
    setComparisonPageId((current) => (current === pageId ? "" : current));
    undoStack.current = [];
    redoStack.current = [];
    setHistoryVersion((current) => current + 1);
    restoreWorkspaceCapture("", cloneWorkspaceCapture(nextPage.state), false);
  };

  const addGraphPage = () => {
    const nextNumber = pages.length + 1;
    const nextPage = createGraphPage(`Page ${nextNumber}`);
    const pageState = cloneWorkspaceCapture(getCurrentWorkspaceCapture());
    updatePages((current) => [
      ...current.map((page) =>
        page.id === activePageId ? { ...page, state: pageState } : page
      ),
      nextPage,
    ]);
    setActivePageId(nextPage.id);
    setSelectedPageSnapshotId("");
    undoStack.current = [];
    redoStack.current = [];
    setHistoryVersion((current) => current + 1);
    restoreWorkspaceCapture("", nextPage.state, false);
  };

  const removeActiveGraphPage = () => {
    if (pages.length <= 1) return;
    const remaining = pages.filter((page) => page.id !== activePageId);
    const nextPage = remaining[0];
    writeGraphPages(remaining);
    setPages(remaining);
    setActivePageId(nextPage.id);
    setComparisonPageId((current) =>
      current === activePageId || current === nextPage.id ? "" : current
    );
    setSelectedPageSnapshotId("");
    undoStack.current = [];
    redoStack.current = [];
    setHistoryVersion((current) => current + 1);
    restoreWorkspaceCapture("", cloneWorkspaceCapture(nextPage.state), false);
  };

  const renameActiveGraphPage = (name: string) => {
    updatePages((current) =>
      current.map((page) =>
        page.id === activePageId ? { ...page, name: name || "Untitled page" } : page
      )
    );
  };

  const createPageSnapshot = () => {
    const activePage = pages.find((page) => page.id === activePageId);
    if (!activePage) return;
    const snapshot = cloneWorkspaceCapture(
      getCurrentWorkspaceCapture(`Snapshot ${activePage.snapshots.length + 1}`)
    );
    updatePages((current) =>
      current.map((page) =>
        page.id === activePageId
          ? {
              ...page,
              state: cloneWorkspaceCapture(snapshot),
              snapshots: [snapshot, ...page.snapshots].slice(0, 3),
            }
          : page
      )
    );
    setSelectedPageSnapshotId(snapshot.id);
  };

  const restorePageSnapshot = () => {
    const activePage = pages.find((page) => page.id === activePageId);
    const snapshot = activePage?.snapshots.find(
      (item) => item.id === selectedPageSnapshotId
    );
    if (!snapshot) return;
    restoreWorkspaceCapture("", cloneWorkspaceCapture(snapshot));
    updatePages((current) =>
      current.map((page) =>
        page.id === activePageId
          ? { ...page, state: cloneWorkspaceCapture(snapshot) }
          : page
      )
    );
  };

  const deletePageSnapshot = () => {
    if (!selectedPageSnapshotId) return;
    updatePages((current) =>
      current.map((page) =>
        page.id === activePageId
          ? {
              ...page,
              snapshots: page.snapshots.filter(
                (snapshot) => snapshot.id !== selectedPageSnapshotId
              ),
            }
          : page
      )
    );
    setSelectedPageSnapshotId("");
  };

  const getGraphSnapshot = (): GraphSnapshot =>
    cloneSnapshot({
      points,
      lines,
      curves,
      shapes,
      formulaObjects,
      measures,
      dataPlots,
      canvasStrokes,
      canvasTextBoxes,
    });

  const restoreGraphSnapshot = (snapshot: GraphSnapshot) => {
    const next = cloneSnapshot(snapshot);
    setPoints(next.points);
    setLines(next.lines);
    setCurves(next.curves);
    setShapes(next.shapes);
    setFormulaObjects(next.formulaObjects);
    setMeasures(next.measures);
    setDataPlots(next.dataPlots);
    setCanvasStrokes(next.canvasStrokes);
    setCanvasTextBoxes(next.canvasTextBoxes);
    setActiveCanvasTextBoxId(null);
    setDraftPoints([]);
    setSelectedObject(null);
  };

  const pushHistory = (snapshot = getGraphSnapshot()) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > 100) {
      undoStack.current.shift();
    }
    redoStack.current = [];
    setHistoryVersion((current) => current + 1);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(getGraphSnapshot());
    restoreGraphSnapshot(previous);
    setHistoryVersion((current) => current + 1);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(getGraphSnapshot());
    restoreGraphSnapshot(next);
    setHistoryVersion((current) => current + 1);
  };

  const canUndo = historyVersion >= 0 && undoStack.current.length > 0;
  const canRedo = historyVersion >= 0 && redoStack.current.length > 0;
  const zoomPercent = `${((view.pixelsPerUnit - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`;
  const fitDataPoints = useMemo(
    () => collectLeastSquaresPoints(points, dataPlots),
    [dataPlots, points]
  );
  const activeFitLine =
    selectedObject?.kind === "line"
      ? lines.find((line) => line.id === selectedObject.id) ?? null
      : lines[0] ?? null;
  const leastSquaresSummary = useMemo(
    () => getLeastSquaresSummary(activeFitLine, fitDataPoints),
    [activeFitLine, fitDataPoints]
  );
  const referenceSquareSource =
    selectedObject?.kind === "line"
      ? lines.find((line) => line.id === selectedObject.id && line.reference) ?? null
      : [...lines].reverse().find((line) => line.reference) ?? null;
  const selectedReferenceSquare =
    selectedObject?.kind === "shape"
      ? shapes.find(
          (shape) =>
            shape.id === selectedObject.id &&
            shape.type === "square" &&
            shape.referenceLineId !== undefined
        ) ?? null
      : null;

  const screenToWorld = (screenX: number, screenY: number, currentView = view) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2 + currentView.offsetX;
    const centerY = rect.height / 2 + currentView.offsetY;

    return {
      x: (screenX - rect.left - centerX) / currentView.pixelsPerUnit,
      y: -(screenY - rect.top - centerY) / currentView.pixelsPerUnit,
    };
  };

  const worldToScreen = (
    x: number,
    y: number,
    width: number,
    height: number,
    currentView = view
  ) => ({
    x: width / 2 + currentView.offsetX + x * currentView.pixelsPerUnit,
    y: height / 2 + currentView.offsetY - y * currentView.pixelsPerUnit,
  });

  const worldToCanvas = (point: GraphPoint) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return worldToScreen(point.x, point.y, rect.width, rect.height);
  };

  const snapPoint = (point: { x: number; y: number }) => {
    if (!snapToGrid) {
      return {
        x: roundCoordinate(point.x),
        y: roundCoordinate(point.y),
      };
    }
    const step = snapStep;
    return {
      x: roundCoordinate(Math.round(point.x / step) * step),
      y: roundCoordinate(Math.round(point.y / step) * step),
    };
  };

  const findNearestPlottedPoint = (
    screenX: number,
    screenY: number
  ): GraphPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const local = { x: screenX - rect.left, y: screenY - rect.top };
    const hitRadius = 14;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestPoint: GraphPoint | null = null;

    points.forEach((point) => {
      const screen = worldToCanvas(point);
      const distance = Math.hypot(screen.x - local.x, screen.y - local.y);
      if (distance <= hitRadius && distance < nearestDistance) {
        nearestDistance = distance;
        nearestPoint = point;
      }
    });

    return nearestPoint;
  };

  const getMeasurePoint = (screenX: number, screenY: number) => {
    const plottedPoint = findNearestPlottedPoint(screenX, screenY);
    if (plottedPoint) {
      return {
        id: 0,
        x: plottedPoint.x,
        y: plottedPoint.y,
      };
    }

    const world = snapPoint(screenToWorld(screenX, screenY));
    return {
      id: 0,
      x: world.x,
      y: world.y,
    };
  };

  const getGeometryPoint = (screenX: number, screenY: number) => {
    const plottedPoint = findNearestPlottedPoint(screenX, screenY);
    if (plottedPoint) {
      return {
        id: 0,
        x: plottedPoint.x,
        y: plottedPoint.y,
      };
    }

    const world = snapPoint(screenToWorld(screenX, screenY));
    return {
      id: 0,
      x: world.x,
      y: world.y,
    };
  };

  const addWorldPoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pushHistory();
    setPoints((current) => [
      ...current,
      {
        id: nextPointId.current++,
        x: roundCoordinate(x),
        y: roundCoordinate(y),
        color: selectedColor,
      },
    ]);
  };

  const addPoint = (screenX: number, screenY: number) => {
    const world = snapPoint(screenToWorld(screenX, screenY));
    addWorldPoint(world.x, world.y);
  };

  const normalizeShapeEnd = (
    a: GraphPoint,
    b: GraphPoint,
    shapeType: GraphShape["type"]
  ): GraphPoint => {
    if (shapeType === "rectangle") return b;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      id: b.id,
      x: roundCoordinate(a.x + Math.sign(dx || 1) * side),
      y: roundCoordinate(a.y + Math.sign(dy || 1) * side),
    };
  };

  const addLineFromPoints = (a: GraphPoint, b: GraphPoint) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.000001) return;
    pushHistory();
    const id = nextLineId.current++;
    setLines((current) => [
      ...current,
      {
        id,
        a,
        b,
        color: selectedColor,
        showLabel: true,
        reference: referenceLineMode,
        label: referenceLineMode ? "reference line" : undefined,
      },
    ]);
    setSelectedObject({ kind: "line", id });
  };

  const addMeasureFromPoints = (a: GraphPoint, b: GraphPoint) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.000001) return;
    pushHistory();
    setMeasures((current) => [
      ...current,
      {
        id: nextMeasureId.current++,
        a,
        b,
        color: selectedColor,
        showLabel: true,
        showEndpointLabels: true,
      },
    ]);
  };

  const addShapeFromPoints = (
    type: GraphShape["type"],
    a: GraphPoint,
    b: GraphPoint
  ) => {
    const nextB = normalizeShapeEnd(a, b, type);
    if (Math.abs(a.x - nextB.x) < 0.000001 || Math.abs(a.y - nextB.y) < 0.000001) {
      return;
    }

    pushHistory();
    setShapes((current) => [
      ...current,
      {
        id: nextShapeId.current++,
        type,
        a,
        b: nextB,
        color: selectedColor,
        showLabel: true,
      },
    ]);
  };

  const addFormulaObject = (kind = formulaObjectKind) => {
    pushHistory();
    const id = nextFormulaObjectId.current++;
    const object = createFormulaObject(kind, id, selectedColor, {
      id: 0,
      x: roundCoordinate(-view.offsetX / view.pixelsPerUnit),
      y: roundCoordinate(view.offsetY / view.pixelsPerUnit),
    });
    setFormulaObjects((current) => [...current, object]);
    setExpandedFormulaCards((current) => ({ ...current, [`formula-${id}`]: true }));
    setSelectedObject({ kind: "formula", id });
  };

  const toggleFormulaCard = (cardId: string) => {
    setExpandedFormulaCards((current) => ({
      ...current,
      [cardId]: !(current[cardId] ?? true),
    }));
  };

  const getReferenceSquare = (
    referenceLine: GraphLine,
    side: 1 | -1,
    id: number
  ): GraphShape | null => {
    const { a, b } = referenceLine;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.000001) return null;
    const center = {
      x: (a.x + b.x) / 2 - side * (dy / length) * (length / 2),
      y: (a.y + b.y) / 2 + side * (dx / length) * (length / 2),
    };
    return {
      id,
      type: "square",
      a: {
        id: 0,
        x: roundCoordinate(center.x - length / 2),
        y: roundCoordinate(center.y - length / 2),
      },
      b: {
        id: 0,
        x: roundCoordinate(center.x + length / 2),
        y: roundCoordinate(center.y + length / 2),
      },
      color: referenceLine.color,
      showLabel: true,
      rotation: Math.atan2(dy, dx),
      referenceLineId: referenceLine.id,
      referenceSide: side,
    };
  };

  const addSquareFromReferenceLine = () => {
    if (!referenceSquareSource) return;
    const id = nextShapeId.current++;
    const shape = getReferenceSquare(referenceSquareSource, referenceSquareSide, id);
    if (!shape) return;
    pushHistory();
    setShapes((current) => [...current, shape]);
    setSelectedObject({ kind: "shape", id });
  };

  const flipSelectedReferenceSquare = () => {
    if (!selectedReferenceSquare) return;
    const referenceLine = lines.find(
      (line) => line.id === selectedReferenceSquare.referenceLineId && line.reference
    );
    if (!referenceLine) return;
    const nextSide = selectedReferenceSquare.referenceSide === -1 ? 1 : -1;
    const flipped = getReferenceSquare(referenceLine, nextSide, selectedReferenceSquare.id);
    if (!flipped) return;
    pushHistory();
    setShapes((current) =>
      current.map((shape) =>
        shape.id === selectedReferenceSquare.id
          ? {
              ...flipped,
              color: shape.color,
              showLabel: shape.showLabel,
              label: shape.label,
              areaLabelTx: shape.areaLabelTx,
              areaLabelTy: shape.areaLabelTy,
            }
          : shape
      )
    );
    setReferenceSquareSide(nextSide);
  };

  const addDraftGeometryPoint = (screenX: number, screenY: number) => {
    const point =
      tool === "measure"
        ? getMeasurePoint(screenX, screenY)
        : {
            id: 0,
            ...snapPoint(screenToWorld(screenX, screenY)),
          };

    if (tool === "line" || tool === "measure") {
      if (draftPoints.length === 0) {
        setDraftPoints([point]);
        return;
      }

      if (tool === "line") {
        addLineFromPoints(draftPoints[0], point);
      } else {
        addMeasureFromPoints(draftPoints[0], point);
      }
      setDraftPoints([]);
      return;
    }

    if (tool === "curve") {
      const nextDraft = [...draftPoints, point];
      if (nextDraft.length < 3) {
        setDraftPoints(nextDraft);
        return;
      }

      pushHistory();
      setCurves((current) => [
        ...current,
        {
          id: nextCurveId.current++,
          a: nextDraft[0],
          b: nextDraft[1],
          c: nextDraft[2],
          color: selectedColor,
          showLabel: true,
        },
      ]);
      setDraftPoints([]);
    }

    if (tool === "rectangle" || tool === "square") {
      if (draftPoints.length === 0) {
        setDraftPoints([point]);
        return;
      }

      addShapeFromPoints(tool, draftPoints[0], point);
      setDraftPoints([]);
    }
  };

  const findNearestHandle = (
    screenX: number,
    screenY: number
  ): HandleTarget | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const local = { x: screenX - rect.left, y: screenY - rect.top };
    const hitRadius = 12;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestTarget: HandleTarget | null = null;

    const testPoint = (point: GraphPoint, target: HandleTarget) => {
      const screen = worldToCanvas(point);
      const distance = Math.hypot(screen.x - local.x, screen.y - local.y);
      if (distance <= hitRadius && distance < nearestDistance) {
        nearestDistance = distance;
        nearestTarget = target;
      }
    };

    points.forEach((point) => testPoint(point, { kind: "point", id: point.id }));
    dataPlots.forEach((plot) => {
      plot.values.forEach((value, pointIndex) => {
        testPoint(
          { id: 0, x: value.x, y: value.y },
          { kind: "data", id: plot.id, pointIndex }
        );
      });
    });
    lines.forEach((line) => {
      testPoint(line.a, { kind: "line", id: line.id, handle: "a" });
      testPoint(line.b, { kind: "line", id: line.id, handle: "b" });
    });
    measures.forEach((measure) => {
      testPoint(measure.a, { kind: "measure", id: measure.id, handle: "a" });
      testPoint(measure.b, { kind: "measure", id: measure.id, handle: "b" });
    });
    curves.forEach((curve) => {
      testPoint(curve.a, { kind: "curve", id: curve.id, handle: "a" });
      testPoint(curve.b, { kind: "curve", id: curve.id, handle: "b" });
      testPoint(curve.c, { kind: "curve", id: curve.id, handle: "c" });
    });
    shapes.forEach((shape) => {
      const corners = getShapeCorners(shape);
      SHAPE_VERTICES.forEach((handle) => {
        testPoint(corners[handle], { kind: "shape", id: shape.id, handle });
      });
    });

    return nearestTarget;
  };

  const findNearestObject = (
    screenX: number,
    screenY: number
  ): ObjectTarget | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const local = { x: screenX - rect.left, y: screenY - rect.top };
    const hitRadius = 10;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestTarget: ObjectTarget | null = null;

    const choose = (distance: number, target: ObjectTarget) => {
      if (distance <= hitRadius && distance < nearestDistance) {
        nearestDistance = distance;
        nearestTarget = target;
      }
    };

    lines.forEach((line) => {
      if (line.reference) {
        choose(
          distanceToSegment(local, worldToCanvas(line.a), worldToCanvas(line.b)),
          { kind: "line", id: line.id }
        );
        return;
      }

      const parts = getLineParts(line);
      if (parts.vertical) {
        choose(Math.abs(local.x - worldToCanvas({ id: 0, x: parts.x, y: 0 }).x), {
          kind: "line",
          id: line.id,
        });
        return;
      }

      const leftWorldX = screenToWorld(rect.left, screenY).x;
      const rightWorldX = screenToWorld(rect.right, screenY).x;
      choose(
        distanceToSegment(
          local,
          worldToCanvas({ id: 0, x: leftWorldX, y: parts.m * leftWorldX + parts.b }),
          worldToCanvas({ id: 0, x: rightWorldX, y: parts.m * rightWorldX + parts.b })
        ),
        { kind: "line", id: line.id }
      );
    });

    measures.forEach((measure) => {
      choose(
        distanceToSegment(local, worldToCanvas(measure.a), worldToCanvas(measure.b)),
        { kind: "measure", id: measure.id }
      );
    });

    curves.forEach((curve) => {
      const coefficients = getQuadraticCoefficients(curve);
      if (!coefficients) return;
      const minCurveX = Math.min(curve.a.x, curve.b.x, curve.c.x);
      const maxCurveX = Math.max(curve.a.x, curve.b.x, curve.c.x);
      let previous = worldToCanvas({
        id: 0,
        x: minCurveX,
        y:
          coefficients.a * minCurveX ** 2 +
          coefficients.b * minCurveX +
          coefficients.c,
      });
      for (let i = 1; i <= 60; i += 1) {
        const x = minCurveX + ((maxCurveX - minCurveX) * i) / 60;
        const y = coefficients.a * x ** 2 + coefficients.b * x + coefficients.c;
        const next = worldToCanvas({ id: 0, x, y });
        choose(distanceToSegment(local, previous, next), {
          kind: "curve",
          id: curve.id,
        });
        previous = next;
      }
    });

    shapes.forEach((shape) => {
      const corners = getShapeCornerList(shape).map(worldToCanvas);
      if (isPointInsidePolygon(local, corners)) {
        choose(0, { kind: "shape", id: shape.id });
        return;
      }

      corners.forEach((corner, index) => {
        choose(distanceToSegment(local, corner, corners[(index + 1) % corners.length]), {
          kind: "shape",
          id: shape.id,
        });
      });
    });

    formulaObjects.forEach((object) => {
      const minFormulaX = screenToWorld(rect.left, screenY).x;
      const maxFormulaX = screenToWorld(rect.right, screenY).x;
      const path = getFormulaObjectPath(object, minFormulaX, maxFormulaX).map(
        worldToCanvas
      );
      if (path.length < 2) return;
      if (isClosedFormulaObject(object) && isPointInsidePolygon(local, path)) {
        choose(0, { kind: "formula", id: object.id });
        return;
      }
      for (let index = 1; index < path.length; index += 1) {
        choose(distanceToSegment(local, path[index - 1], path[index]), {
          kind: "formula",
          id: object.id,
        });
      }
      if (isClosedFormulaObject(object)) {
        choose(distanceToSegment(local, path[path.length - 1], path[0]), {
          kind: "formula",
          id: object.id,
        });
      }
    });

    return nearestTarget;
  };

  const findNearestPointOnObject = (
    screenX: number,
    screenY: number
  ): HoverSnapPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const local = { x: screenX - rect.left, y: screenY - rect.top };
    const hitRadius = 14;
    const world = screenToWorld(screenX, screenY);
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearest: HoverSnapPoint | null = null;

    const choose = (point: GraphPoint, target: ObjectTarget) => {
      const screen = worldToCanvas(point);
      const distance = Math.hypot(screen.x - local.x, screen.y - local.y);
      if (distance <= hitRadius && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = {
          point: {
            id: 0,
            x: roundCoordinate(point.x),
            y: roundCoordinate(point.y),
          },
          target,
        };
      }
    };

    lines.forEach((line) => {
      if (line.reference) {
        choose(closestPointOnSegmentWorld(world, line.a, line.b), {
          kind: "line",
          id: line.id,
        });
        return;
      }

      const parts = getLineParts(line);
      const point = parts.vertical
        ? { id: 0, x: parts.x, y: world.y }
        : { id: 0, x: world.x, y: parts.m * world.x + parts.b };
      choose(point, { kind: "line", id: line.id });
    });

    curves.forEach((curve) => {
      const coefficients = getQuadraticCoefficients(curve);
      if (!coefficients) return;
      choose(
        {
          id: 0,
          x: world.x,
          y: coefficients.a * world.x ** 2 + coefficients.b * world.x + coefficients.c,
        },
        { kind: "curve", id: curve.id }
      );
    });

    measures.forEach((measure) => {
      const closest = closestPointOnSegmentWorld(world, measure.a, measure.b);
      choose(closest, { kind: "measure", id: measure.id });
    });

    shapes.forEach((shape) => {
      const corners = getShapeCornerList(shape);
      corners.forEach((corner, index) => {
        choose(
          closestPointOnSegmentWorld(world, corner, corners[(index + 1) % corners.length]),
          { kind: "shape", id: shape.id }
        );
      });
    });

    formulaObjects.forEach((object) => {
      if (!isClosedFormulaObject(object)) {
        const pointY = evaluateFormulaObject(object, world.x);
        if (pointY !== null && Number.isFinite(pointY)) {
          choose(
            { id: 0, x: world.x, y: pointY },
            { kind: "formula", id: object.id }
          );
        }
        return;
      }

      const minFormulaX = screenToWorld(rect.left, screenY).x;
      const maxFormulaX = screenToWorld(rect.right, screenY).x;
      const path = getFormulaObjectPath(object, minFormulaX, maxFormulaX);
      path.forEach((point, index) => {
        const next = path[(index + 1) % path.length];
        choose(closestPointOnSegmentWorld(world, point, next), {
          kind: "formula",
          id: object.id,
        });
      });
    });

    return nearest;
  };

  const moveHandle = (target: HandleTarget, nextPoint: GraphPoint) => {
    if (target.kind === "point") {
      setPoints((current) =>
        current.map((point) =>
          point.id === target.id
            ? { ...point, x: nextPoint.x, y: nextPoint.y }
            : point
        )
      );
      return;
    }

    if (target.kind === "line") {
      setLines((current) =>
        current.map((line) =>
          line.id === target.id
            ? { ...line, [target.handle]: { ...line[target.handle], ...nextPoint } }
            : line
        )
      );
      return;
    }

    if (target.kind === "measure") {
      setMeasures((current) =>
        current.map((measure) =>
          measure.id === target.id
            ? { ...measure, [target.handle]: { ...measure[target.handle], ...nextPoint } }
            : measure
        )
      );
      return;
    }

    if (target.kind === "data") {
      setDataPlots((current) =>
        current.map((plot) =>
          plot.id === target.id
            ? {
                ...plot,
                values: plot.values.map((value, index) =>
                  index === target.pointIndex
                    ? { x: nextPoint.x, y: nextPoint.y }
                    : value
                ),
              }
            : plot
        )
      );
      return;
    }

    if (target.kind === "curve") {
      setCurves((current) =>
        current.map((curve) =>
          curve.id === target.id
            ? { ...curve, [target.handle]: { ...curve[target.handle], ...nextPoint } }
            : curve
        )
      );
      return;
    }

    if (target.kind === "shape") {
      setShapes((current) =>
        current.map((shape) => {
          if (shape.id !== target.id) return shape;
          return resizeAndRotateShapeFromVertex(shape, target.handle, nextPoint);
        })
      );
    }
  };

  const shiftPointBy = (point: GraphPoint, dx: number, dy: number): GraphPoint => ({
    ...point,
    x: roundCoordinate(point.x + dx),
    y: roundCoordinate(point.y + dy),
  });

  const shiftFormulaObject = (
    object: GraphFormulaObject,
    dx: number,
    dy: number
  ): GraphFormulaObject => {
    const shiftedAnchor = shiftPointBy(object.anchor, dx, dy);
    if (isClosedFormulaObject(object)) return { ...object, anchor: shiftedAnchor };

    if (object.kind === "line") {
      const m = getFormulaValue(object, "m");
      return {
        ...object,
        anchor: shiftedAnchor,
        variables: object.variables.map((variable) =>
          variable.key === "b"
            ? { ...variable, value: roundCoordinate(variable.value + dy - m * dx) }
            : variable
        ),
      };
    }

    if (object.kind === "parabola") {
      const a = getFormulaValue(object, "a");
      const b = getFormulaValue(object, "b");
      const c = getFormulaValue(object, "c");
      return {
        ...object,
        anchor: shiftedAnchor,
        variables: object.variables.map((variable) => {
          if (variable.key === "b") {
            return { ...variable, value: roundCoordinate(b - 2 * a * dx) };
          }
          if (variable.key === "c") {
            return {
              ...variable,
              value: roundCoordinate(a * dx ** 2 - b * dx + c + dy),
            };
          }
          return variable;
        }),
      };
    }

    if (object.kind === "sine" || object.kind === "cosine") {
      const B = getFormulaValue(object, "B");
      return {
        ...object,
        anchor: shiftedAnchor,
        variables: object.variables.map((variable) => {
          if (variable.key === "C") {
            return { ...variable, value: roundCoordinate(variable.value - B * dx) };
          }
          if (variable.key === "D") {
            return { ...variable, value: roundCoordinate(variable.value + dy) };
          }
          return variable;
        }),
      };
    }

    if (object.kind === "exponential") {
      const B = getFormulaValue(object, "B");
      return {
        ...object,
        anchor: shiftedAnchor,
        variables: object.variables.map((variable) => {
          if (variable.key === "A") {
            return {
              ...variable,
              value: roundCoordinate(variable.value * Math.exp(-B * dx)),
            };
          }
          if (variable.key === "D") {
            return { ...variable, value: roundCoordinate(variable.value + dy) };
          }
          return variable;
        }),
      };
    }

    if (object.kind === "logarithmic" || object.kind === "absolute") {
      const B = getFormulaValue(object, "B");
      return {
        ...object,
        anchor: shiftedAnchor,
        variables: object.variables.map((variable) => {
          if (variable.key === "C") {
            return { ...variable, value: roundCoordinate(variable.value - B * dx) };
          }
          if (variable.key === "D") {
            return { ...variable, value: roundCoordinate(variable.value + dy) };
          }
          return variable;
        }),
      };
    }

    return { ...object, anchor: shiftedAnchor };
  };

  const moveObject = (target: ObjectTarget, dx: number, dy: number) => {
    const shiftPoint = (point: GraphPoint): GraphPoint =>
      shiftPointBy(point, dx, dy);

    if (target.kind === "line") {
      setLines((current) =>
        current.map((line) =>
          line.id === target.id
            ? { ...line, a: shiftPoint(line.a), b: shiftPoint(line.b) }
            : line
        )
      );
      return;
    }

    if (target.kind === "curve") {
      setCurves((current) =>
        current.map((curve) =>
          curve.id === target.id
            ? {
                ...curve,
                a: shiftPoint(curve.a),
                b: shiftPoint(curve.b),
                c: shiftPoint(curve.c),
              }
            : curve
        )
      );
      return;
    }

    if (target.kind === "measure") {
      setMeasures((current) =>
        current.map((measure) =>
          measure.id === target.id
            ? { ...measure, a: shiftPoint(measure.a), b: shiftPoint(measure.b) }
            : measure
        )
      );
      return;
    }

    if (target.kind === "formula") {
      setFormulaObjects((current) =>
        current.map((object) =>
          object.id === target.id ? shiftFormulaObject(object, dx, dy) : object
        )
      );
      return;
    }

    setShapes((current) =>
      current.map((shape) =>
        shape.id === target.id
          ? { ...shape, a: shiftPoint(shape.a), b: shiftPoint(shape.b) }
          : shape
      )
    );
  };

  const removeObject = (target: ObjectTarget | null) => {
    if (!target) return;
    pushHistory();
    if (target.kind === "line") {
      setLines((current) => current.filter((line) => line.id !== target.id));
    }
    if (target.kind === "curve") {
      setCurves((current) => current.filter((curve) => curve.id !== target.id));
    }
    if (target.kind === "shape") {
      setShapes((current) => current.filter((shape) => shape.id !== target.id));
    }
    if (target.kind === "measure") {
      setMeasures((current) => current.filter((measure) => measure.id !== target.id));
    }
    if (target.kind === "formula") {
      setFormulaObjects((current) =>
        current.filter((object) => object.id !== target.id)
      );
    }
    setSelectedObject(null);
    setHoverMenu(null);
  };

  const getObject = (target: ObjectTarget | null) => {
    if (!target) return null;
    if (target.kind === "line") return lines.find((line) => line.id === target.id) ?? null;
    if (target.kind === "curve") return curves.find((curve) => curve.id === target.id) ?? null;
    if (target.kind === "shape") return shapes.find((shape) => shape.id === target.id) ?? null;
    if (target.kind === "formula") {
      return formulaObjects.find((object) => object.id === target.id) ?? null;
    }
    return measures.find((measure) => measure.id === target.id) ?? null;
  };

  const getSelectedObjectColor = () => {
    const selected = getObject(selectedObject);
    return selected?.color ?? null;
  };

  const updateObjectColor = (target: ObjectTarget | null, color: string) => {
    if (!target) return;
    pushHistory();
    if (target.kind === "line") {
      setLines((current) =>
        current.map((line) => (line.id === target.id ? { ...line, color } : line))
      );
      return;
    }
    if (target.kind === "curve") {
      setCurves((current) =>
        current.map((curve) => (curve.id === target.id ? { ...curve, color } : curve))
      );
      return;
    }
    if (target.kind === "shape") {
      setShapes((current) =>
        current.map((shape) => (shape.id === target.id ? { ...shape, color } : shape))
      );
      return;
    }
    if (target.kind === "formula") {
      setFormulaObjects((current) =>
        current.map((object) =>
          object.id === target.id ? { ...object, color } : object
        )
      );
      return;
    }
    setMeasures((current) =>
      current.map((measure) =>
        measure.id === target.id ? { ...measure, color } : measure
      )
    );
  };

  const applyDrawingColor = (color: string) => {
    setSelectedColor(color);
    if (selectedObject) {
      updateObjectColor(selectedObject, color);
    }
  };

  const updateDataPlotColor = (plotId: number, color: string) => {
    pushHistory();
    setDataPlots((current) =>
      current.map((plot) => (plot.id === plotId ? { ...plot, color } : plot))
    );
  };

  const updateDataPlotPointStyle = (plotId: number, pointStyle: DataPointStyle) => {
    pushHistory();
    setDataPlots((current) =>
      current.map((plot) => (plot.id === plotId ? { ...plot, pointStyle } : plot))
    );
  };

  const updatePointColor = (pointId: number, color: string) => {
    pushHistory();
    setPoints((current) =>
      current.map((point) => (point.id === pointId ? { ...point, color } : point))
    );
  };

  const updatePointDetails = (
    pointId: number,
    patch: Partial<
      Pick<GraphPoint, "x" | "y" | "color" | "label" | "showLabel" | "labelDx" | "labelDy">
    >
  ) => {
    pushHistory();
    setPoints((current) =>
      current.map((point) =>
        point.id === pointId
          ? {
              ...point,
              ...patch,
              x:
                patch.x === undefined || !Number.isFinite(patch.x)
                  ? point.x
                  : roundCoordinate(patch.x),
              y:
                patch.y === undefined || !Number.isFinite(patch.y)
                  ? point.y
                  : roundCoordinate(patch.y),
            }
          : point
      )
    );
  };

  const movePointLabel = (
    pointId: number,
    clientX: number,
    clientY: number,
    grabOffset: { x: number; y: number }
  ) => {
    const canvas = canvasRef.current;
    const point = points.find((item) => item.id === pointId);
    if (!canvas || !point) return;
    const rect = canvas.getBoundingClientRect();
    const anchor = worldToCanvas(point);
    const labelLeft = clientX - rect.left - grabOffset.x;
    const labelTop = clientY - rect.top - grabOffset.y;
    setPoints((current) =>
      current.map((item) =>
        item.id === pointId
          ? {
              ...item,
              labelDx: roundCoordinate(labelLeft - anchor.x),
              labelDy: roundCoordinate(labelTop - anchor.y),
            }
          : item
      )
    );
  };

  const moveMeasureLabel = (
    measureId: number,
    clientX: number,
    clientY: number
  ) => {
    const canvas = canvasRef.current;
    const measure = measures.find((item) => item.id === measureId);
    if (!canvas || !measure) return;
    const rect = canvas.getBoundingClientRect();
    const local = { x: clientX - rect.left, y: clientY - rect.top };
    const a = worldToCanvas(measure.a);
    const b = worldToCanvas(measure.b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0.000001) return;
    const nextT = clamp(
      ((local.x - a.x) * dx + (local.y - a.y) * dy) / lengthSquared,
      0.04,
      0.96
    );
    setMeasures((current) =>
      current.map((item) =>
        item.id === measureId ? { ...item, labelT: roundCoordinate(nextT) } : item
      )
    );
  };

  const getGroupTargetKey = (target: GroupTarget) =>
    target.kind === "data"
      ? `${target.kind}:${target.id}:${target.pointIndex}`
      : `${target.kind}:${target.id}`;

  const isGroupTargetSelected = (target: GroupTarget) =>
    lockedGroupTargets.some(
      (selected) => getGroupTargetKey(selected) === getGroupTargetKey(target)
    );

  const toggleGroupTarget = (target: GroupTarget) => {
    setLockedGroupTargets((current) => {
      const key = getGroupTargetKey(target);
      return current.some((item) => getGroupTargetKey(item) === key)
        ? current.filter((item) => getGroupTargetKey(item) !== key)
        : [...current, target];
    });
    setIsGroupLocked(false);
  };

  const moveLockedGroup = (dx: number, dy: number) => {
    const shiftPoint = (point: GraphPoint): GraphPoint => ({
      ...point,
      x: roundCoordinate(point.x + dx),
      y: roundCoordinate(point.y + dy),
    });
    const selected = new Set(lockedGroupTargets.map(getGroupTargetKey));
    setPoints((current) =>
      current.map((point) =>
        selected.has(`point:${point.id}`) ? shiftPoint(point) : point
      )
    );
    setDataPlots((current) =>
      current.map((plot) => ({
        ...plot,
        values: plot.values.map((value, pointIndex) =>
          selected.has(`data:${plot.id}:${pointIndex}`)
            ? {
                x: roundCoordinate(value.x + dx),
                y: roundCoordinate(value.y + dy),
              }
            : value
        ),
      }))
    );
    setLines((current) =>
      current.map((line) =>
        selected.has(`line:${line.id}`)
          ? { ...line, a: shiftPoint(line.a), b: shiftPoint(line.b) }
          : line
      )
    );
    setCurves((current) =>
      current.map((curve) =>
        selected.has(`curve:${curve.id}`)
          ? {
              ...curve,
              a: shiftPoint(curve.a),
              b: shiftPoint(curve.b),
              c: shiftPoint(curve.c),
            }
          : curve
      )
    );
    setShapes((current) =>
      current.map((shape) =>
        selected.has(`shape:${shape.id}`)
          ? { ...shape, a: shiftPoint(shape.a), b: shiftPoint(shape.b) }
          : shape
      )
    );
    setFormulaObjects((current) =>
      current.map((object) =>
        selected.has(`formula:${object.id}`)
          ? shiftFormulaObject(object, dx, dy)
          : object
      )
    );
    setMeasures((current) =>
      current.map((measure) =>
        selected.has(`measure:${measure.id}`)
          ? { ...measure, a: shiftPoint(measure.a), b: shiftPoint(measure.b) }
          : measure
      )
    );
  };

  const clearLockedGroup = () => {
    setLockedGroupTargets([]);
    setIsGroupLocked(false);
    setGroupSelectionMode(false);
  };

  const moveShapeAreaLabel = (
    shapeId: number,
    clientX: number,
    clientY: number
  ) => {
    const canvas = canvasRef.current;
    const shape = shapes.find((item) => item.id === shapeId);
    if (!canvas || !shape) return;
    const bounds = getShapeBounds(shape);
    if (bounds.width <= 0.000001 || bounds.height <= 0.000001) return;
    const local = rotatePointAround(
      { id: 0, ...screenToWorld(clientX, clientY) },
      getShapeCenter(shape),
      -(shape.rotation ?? 0)
    );
    setShapes((current) =>
      current.map((item) =>
        item.id === shapeId
          ? {
              ...item,
              areaLabelTx: roundCoordinate(clamp((local.x - bounds.x) / bounds.width, 0.08, 0.92)),
              areaLabelTy: roundCoordinate(
                clamp(1 - (local.y - bounds.y) / bounds.height, 0.08, 0.92)
              ),
            }
          : item
      )
    );
  };

  const updateObjectLabel = (target: ObjectTarget, label: string) => {
    pushHistory();
    if (target.kind === "line") {
      setLines((current) =>
        current.map((line) => (line.id === target.id ? { ...line, label } : line))
      );
      return;
    }
    if (target.kind === "curve") {
      setCurves((current) =>
        current.map((curve) => (curve.id === target.id ? { ...curve, label } : curve))
      );
      return;
    }
    if (target.kind === "shape") {
      setShapes((current) =>
        current.map((shape) => (shape.id === target.id ? { ...shape, label } : shape))
      );
      return;
    }
    if (target.kind === "formula") {
      setFormulaObjects((current) =>
        current.map((object) =>
          object.id === target.id ? { ...object, name: label || object.name } : object
        )
      );
      return;
    }
    setMeasures((current) =>
      current.map((measure) =>
        measure.id === target.id ? { ...measure, label } : measure
      )
    );
  };

  const updateLabelVisibility = (target: ObjectTarget, showLabel: boolean) => {
    pushHistory();
    if (target.kind === "line") {
      setLines((current) =>
        current.map((line) =>
          line.id === target.id ? { ...line, showLabel } : line
        )
      );
    }
    if (target.kind === "curve") {
      setCurves((current) =>
        current.map((curve) =>
          curve.id === target.id ? { ...curve, showLabel } : curve
        )
      );
    }
    if (target.kind === "shape") {
      setShapes((current) =>
        current.map((shape) =>
          shape.id === target.id ? { ...shape, showLabel } : shape
        )
      );
    }
    if (target.kind === "measure") {
      setMeasures((current) =>
        current.map((measure) =>
          measure.id === target.id ? { ...measure, showLabel } : measure
        )
      );
    }
    if (target.kind === "formula") {
      setFormulaObjects((current) =>
        current.map((object) =>
          object.id === target.id ? { ...object, showLabel } : object
        )
      );
    }
  };

  const updateMeasureEndpointLabelVisibility = (
    measureId: number,
    showEndpointLabels: boolean
  ) => {
    pushHistory();
    setMeasures((current) =>
      current.map((measure) =>
        measure.id === measureId ? { ...measure, showEndpointLabels } : measure
      )
    );
  };

  const updateLineFromEquation = (
    lineId: number,
    next: { m?: number; b?: number; x?: number }
  ) => {
    pushHistory();
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        const parts = getLineParts(line);
        if (parts.vertical) {
          const x = next.x ?? parts.x;
          return {
            ...line,
            a: { ...line.a, x: roundCoordinate(x) },
            b: { ...line.b, x: roundCoordinate(x) },
          };
        }

        const m = next.m ?? parts.m;
        const b = next.b ?? parts.b;
        return {
          ...line,
          a: { ...line.a, y: roundCoordinate(m * line.a.x + b) },
          b: { ...line.b, y: roundCoordinate(m * line.b.x + b) },
        };
      })
    );
  };

  const updateCurveFromEquation = (
    curveId: number,
    coefficients: { a?: number; b?: number; c?: number }
  ) => {
    pushHistory();
    setCurves((current) =>
      current.map((curve) => {
        if (curve.id !== curveId) return curve;
        const currentCoefficients = getQuadraticCoefficients(curve);
        if (!currentCoefficients) return curve;
        const a = coefficients.a ?? currentCoefficients.a;
        const b = coefficients.b ?? currentCoefficients.b;
        const c = coefficients.c ?? currentCoefficients.c;
        const updatePoint = (point: GraphPoint) => ({
          ...point,
          y: roundCoordinate(a * point.x ** 2 + b * point.x + c),
        });
        return {
          ...curve,
          a: updatePoint(curve.a),
          b: updatePoint(curve.b),
          c: updatePoint(curve.c),
        };
      })
    );
  };

  const updateShapeSize = (
    shapeId: number,
    next: { width?: number; height?: number; side?: number }
  ) => {
    pushHistory();
    setShapes((current) =>
      current.map((shape) => {
        if (shape.id !== shapeId) return shape;
        const bounds = getShapeBounds(shape);
        const width = Math.max(0.1, next.side ?? next.width ?? bounds.width);
        const height = Math.max(
          0.1,
          shape.type === "square" ? width : next.height ?? bounds.height
        );
        const center = getShapeCenter(shape);
        return {
          ...shape,
          a: {
            ...shape.a,
            x: roundCoordinate(center.x - width / 2),
            y: roundCoordinate(center.y - height / 2),
          },
          b: {
            ...shape.b,
            x: roundCoordinate(center.x + width / 2),
            y: roundCoordinate(center.y + height / 2),
          },
        };
      })
    );
  };

  const updateShapeFormulaVariable = (
    shapeId: number,
    variableKey: string,
    value: number
  ) => {
    pushHistory();
    setShapes((current) =>
      current.map((shape) => {
        if (shape.id !== shapeId) return shape;
        const width = shape.b.x - shape.a.x;
        const height = shape.b.y - shape.a.y;
        const nextWidth =
          shape.type === "square"
            ? variableKey === "s"
              ? value
              : width
            : variableKey === "w"
              ? value
              : width;
        const nextHeight =
          shape.type === "square"
            ? variableKey === "s"
              ? value
              : height
            : variableKey === "h"
              ? value
              : height;
        return {
          ...shape,
          b: {
            ...shape.b,
            x: roundCoordinate(shape.a.x + nextWidth),
            y: roundCoordinate(shape.a.y + nextHeight),
          },
        };
      })
    );
  };

  const updateLineFormulaVariable = (
    lineId: number,
    variableKey: string,
    value: number
  ) => {
    const line = lines.find((item) => item.id === lineId);
    if (!line) return;
    const parts = getLineParts(line);
    if (parts.vertical) {
      updateLineFromEquation(lineId, { x: value });
      return;
    }
    updateLineFromEquation(lineId, {
      m: variableKey === "m" ? value : parts.m,
      b: variableKey === "b" ? value : parts.b,
    });
  };

  const updateCurveFormulaVariable = (
    curveId: number,
    variableKey: string,
    value: number
  ) => {
    const curve = curves.find((item) => item.id === curveId);
    const coefficients = curve ? getQuadraticCoefficients(curve) : null;
    if (!coefficients) return;
    updateCurveFromEquation(curveId, {
      a: variableKey === "a" ? value : coefficients.a,
      b: variableKey === "b" ? value : coefficients.b,
      c: variableKey === "c" ? value : coefficients.c,
    });
  };

  const updateFormulaObjectVariable = (
    objectId: number,
    variableKey: string,
    value: number
  ) => {
    if (!Number.isFinite(value)) return;
    pushHistory();
    setFormulaObjects((current) =>
      current.map((object) =>
        object.id === objectId
          ? setFormulaVariableValue(object, variableKey, value)
          : object
      )
    );
  };

  const updateFormulaObjectAnchor = (
    objectId: number,
    axis: "x" | "y",
    value: number
  ) => {
    if (!Number.isFinite(value)) return;
    pushHistory();
    setFormulaObjects((current) =>
      current.map((object) =>
        object.id === objectId
          ? {
              ...object,
              anchor: { ...object.anchor, [axis]: roundCoordinate(value) },
            }
          : object
      )
    );
  };

  const updateMeasureFormulaVariable = (
    measureId: number,
    variableKey: string,
    value: number
  ) => {
    if (!Number.isFinite(value)) return;
    pushHistory();
    setMeasures((current) =>
      current.map((measure) => {
        if (measure.id !== measureId) return measure;
        if (variableKey === "x1") {
          return { ...measure, a: { ...measure.a, x: roundCoordinate(value) } };
        }
        if (variableKey === "y1") {
          return { ...measure, a: { ...measure.a, y: roundCoordinate(value) } };
        }
        if (variableKey === "x2") {
          return { ...measure, b: { ...measure.b, x: roundCoordinate(value) } };
        }
        if (variableKey === "y2") {
          return { ...measure, b: { ...measure.b, y: roundCoordinate(value) } };
        }
        return measure;
      })
    );
  };

  const updateHoverMenu = (screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const target = findNearestObject(screenX, screenY);
    const snapPointOnObject = findNearestPointOnObject(screenX, screenY);
    setHoverSnapPoint(snapPointOnObject);
    if (!target) {
      if (!selectedObject) setHoverMenu(null);
      return;
    }
    setHoverMenu({
      target,
      x: screenX - rect.left + 12,
      y: screenY - rect.top + 12,
    });
  };

  const addManualPoint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const x = Number(manualX);
    const y = Number(manualY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    addWorldPoint(x, y);
    setManualX("");
    setManualY("");
  };

  const addDataPlot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseDataValues(dataInput);
    if (!parsed.ok) {
      setDataError(parsed.message);
      return;
    }

    pushHistory();
    const plotName = dataName.trim() || `Data set ${nextDataPlotId.current}`;
    setDataPlots((current) => [
      ...current,
      {
        id: nextDataPlotId.current++,
        name: plotName,
        values: parsed.values,
        color: selectedColor,
        style: dataPlotStyle,
        pointStyle: "filled",
      },
    ]);
    fitViewToValues(parsed.values);
    setDataError("");
  };

  const addDataCoordinatePair = () => {
    const x = Number(dataXInput);
    const y = Number(dataYInput);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setDataError("Enter valid x_coordinate and y_coordinate values.");
      return;
    }

    const nextPair = `(${roundCoordinate(x)}, ${roundCoordinate(y)})`;
    setDataInput((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}\n${nextPair}` : nextPair;
    });
    setDataXInput("");
    setDataYInput("");
    setDataError("");
  };

  const importDataFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        setDataInput(text);
        setDataName(file.name.replace(/\.[^.]+$/, "") || "Data set");
        setDataError("");
      })
      .catch(() => {
        setDataError("Could not read that file.");
      });
    event.target.value = "";
  };

  const fitViewToValues = (values: DataValue[]) => {
    if (values.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const xs = values.map((value) => value.x);
    const ys = values.map((value) => value.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const padding = 96;
    const nextPixelsPerUnit = clamp(
      Math.min(
        (rect.width - padding) / spanX,
        (rect.height - padding) / spanY
      ),
      MIN_ZOOM,
      MAX_ZOOM
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setView({
      pixelsPerUnit: nextPixelsPerUnit,
      offsetX: -centerX * nextPixelsPerUnit,
      offsetY: centerY * nextPixelsPerUnit,
    });
  };

  const zoomAt = (screenX: number, screenY: number, zoomFactor: number) => {
    setView((current) => {
      const canvas = canvasRef.current;
      if (!canvas) return current;

      const rect = canvas.getBoundingClientRect();
      const before = screenToWorld(screenX, screenY, current);
      const nextPixelsPerUnit = clamp(
        current.pixelsPerUnit * zoomFactor,
        MIN_ZOOM,
        MAX_ZOOM
      );
      const nextCenterX = screenX - rect.left - before.x * nextPixelsPerUnit;
      const nextCenterY = screenY - rect.top + before.y * nextPixelsPerUnit;

      return {
        pixelsPerUnit: nextPixelsPerUnit,
        offsetX: nextCenterX - rect.width / 2,
        offsetY: nextCenterY - rect.height / 2,
      };
    });
  };

  const zoomTo = (screenX: number, screenY: number, nextPixelsPerUnit: number) => {
    setView((current) => {
      const canvas = canvasRef.current;
      if (!canvas) return current;

      const rect = canvas.getBoundingClientRect();
      const before = screenToWorld(screenX, screenY, current);
      const clampedPixelsPerUnit = clamp(nextPixelsPerUnit, MIN_ZOOM, MAX_ZOOM);
      const nextCenterX = screenX - rect.left - before.x * clampedPixelsPerUnit;
      const nextCenterY = screenY - rect.top + before.y * clampedPixelsPerUnit;

      return {
        pixelsPerUnit: clampedPixelsPerUnit,
        offsetX: nextCenterX - rect.width / 2,
        offsetY: nextCenterY - rect.height / 2,
      };
    });
  };

  const setZoomAtCanvasCenter = (nextPixelsPerUnit: number) => {
    setView((current) => {
      const canvas = canvasRef.current;
      const clampedPixelsPerUnit = clamp(nextPixelsPerUnit, MIN_ZOOM, MAX_ZOOM);
      if (!canvas) {
        return {
          ...current,
          pixelsPerUnit: clampedPixelsPerUnit,
        };
      }

      const centerWorld = {
        x: -current.offsetX / current.pixelsPerUnit,
        y: current.offsetY / current.pixelsPerUnit,
      };

      return {
        pixelsPerUnit: clampedPixelsPerUnit,
        offsetX: -centerWorld.x * clampedPixelsPerUnit,
        offsetY: centerWorld.y * clampedPixelsPerUnit,
      };
    });
  };

  const zoomCanvasCenterBy = (zoomDelta: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setView((current) => ({
        ...current,
        pixelsPerUnit: clamp(current.pixelsPerUnit + zoomDelta, MIN_ZOOM, MAX_ZOOM),
      }));
      return;
    }

    const rect = canvas.getBoundingClientRect();
    zoomTo(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      view.pixelsPerUnit + zoomDelta
    );
  };

  const queuePanBy = (dx: number, dy: number) => {
    pendingPanRef.current.dx += dx;
    pendingPanRef.current.dy += dy;
    if (panFrameRef.current !== null) return;

    panFrameRef.current = requestAnimationFrame(() => {
      panFrameRef.current = null;
      const pending = pendingPanRef.current;
      pendingPanRef.current = { dx: 0, dy: 0 };
      if (Math.abs(pending.dx) < 0.001 && Math.abs(pending.dy) < 0.001) return;

      setView((current) => ({
        ...current,
        offsetX: current.offsetX + pending.dx,
        offsetY: current.offsetY + pending.dy,
      }));
    });
  };

  const stopPanInertia = () => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  };

  const startPanInertia = (velocityX: number, velocityY: number) => {
    stopPanInertia();
    const maxVelocity = 2.4;
    let vx = clamp(velocityX, -maxVelocity, maxVelocity);
    let vy = clamp(velocityY, -maxVelocity, maxVelocity);
    let previousTime = performance.now();

    const step = (time: number) => {
      const dt = Math.min(32, time - previousTime);
      previousTime = time;
      queuePanBy(vx * dt, vy * dt);
      const friction = 0.90 ** (dt / 16.67);
      vx *= friction;
      vy *= friction;

      if (Math.hypot(vx, vy) < 0.015) {
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    if (Math.hypot(vx, vy) >= 0.08) {
      inertiaFrameRef.current = requestAnimationFrame(step);
    }
  };

  const updateCursor = (screenX: number, screenY: number) => {
    const world = snapPoint(screenToWorld(screenX, screenY));
    setCursor({
      id: 0,
      x: roundCoordinate(world.x),
      y: roundCoordinate(world.y),
    });
  };

  const getCanvasAnnotationPoint = (screenX: number, screenY: number): GraphPoint => {
    const world = screenToWorld(screenX, screenY);
    return {
      id: 0,
      x: roundCoordinate(world.x),
      y: roundCoordinate(world.y),
    };
  };

  const getCanvasStrokeStyle = (nextTool: CanvasTool) => ({
    width: nextTool === "marker" ? 5 : 2,
    opacity: nextTool === "marker" ? 0.36 : 0.95,
  });

  const appendCanvasStrokePoint = (strokeId: number, point: GraphPoint) => {
    setCanvasStrokes((current) =>
      current.map((stroke) => {
        if (stroke.id !== strokeId) return stroke;
        const previous = stroke.points[stroke.points.length - 1];
        if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.003) {
          return stroke;
        }
        return { ...stroke, points: [...stroke.points, point] };
      })
    );
  };

  const eraseCanvasStrokeAt = (screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const local = { x: screenX - rect.left, y: screenY - rect.top };
    const eraseRadius = 14;

    setCanvasStrokes((current) =>
      current.filter((stroke) => {
        if (stroke.points.length === 0) return false;
        if (stroke.points.length === 1) {
          const screen = worldToCanvas(stroke.points[0]);
          return Math.hypot(screen.x - local.x, screen.y - local.y) > eraseRadius;
        }

        for (let index = 1; index < stroke.points.length; index += 1) {
          const previous = worldToCanvas(stroke.points[index - 1]);
          const next = worldToCanvas(stroke.points[index]);
          if (distanceToSegment(local, previous, next) <= eraseRadius) {
            return false;
          }
        }
        return true;
      })
    );
  };

  const addCanvasTextBox = (position: GraphPoint) => {
    const id = nextCanvasTextBoxId.current++;
    setCanvasTextBoxes((current) => [
      ...current,
      {
        id,
        color: selectedColor,
        position,
        text: "",
      },
    ]);
    setActiveCanvasTextBoxId(id);
  };

  const moveCanvasTextBox = (
    textBoxId: number,
    clientX: number,
    clientY: number,
    grabOffset: { x: number; y: number }
  ) => {
    const nextPosition = screenToWorld(
      clientX - grabOffset.x,
      clientY - grabOffset.y
    );
    setCanvasTextBoxes((current) =>
      current.map((textBox) =>
        textBox.id === textBoxId
          ? {
              ...textBox,
              position: {
                id: 0,
                x: roundCoordinate(nextPosition.x),
                y: roundCoordinate(nextPosition.y),
              },
            }
          : textBox
      )
    );
  };

  const removeCanvasTextBox = (textBoxId: number) => {
    pushHistory();
    setCanvasTextBoxes((current) =>
      current.filter((textBox) => textBox.id !== textBoxId)
    );
    setActiveCanvasTextBoxId((current) => (current === textBoxId ? null : current));
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    stopPanInertia();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (canvasTool !== "none" && (event.buttons & 1) === 1) {
      const startPoint = getCanvasAnnotationPoint(event.clientX, event.clientY);
      pushHistory();
      setSelectedObject(null);
      setHoverMenu(null);
      setHoverSnapPoint(null);

      if (canvasTool === "eraser") {
        eraseCanvasStrokeAt(event.clientX, event.clientY);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          lastMoveTime: event.timeStamp,
          velocityX: 0,
          velocityY: 0,
          moved: false,
          mode: "canvas-erase",
          startWorld: startPoint,
          historyPushed: true,
        };
        updateCursor(event.clientX, event.clientY);
        return;
      }

      if (canvasTool === "text") {
        addCanvasTextBox(startPoint);
        updateCursor(event.clientX, event.clientY);
        return;
      }

      const strokeId = nextCanvasStrokeId.current++;
      const style = getCanvasStrokeStyle(canvasTool);
      setCanvasStrokes((current) => [
        ...current,
        {
          id: strokeId,
          color: selectedColor,
          opacity: style.opacity,
          width: style.width,
          points: [startPoint],
          tool: canvasTool,
        },
      ]);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastMoveTime: event.timeStamp,
        velocityX: 0,
        velocityY: 0,
        moved: false,
        mode: "canvas-draw",
        startWorld: startPoint,
        historyPushed: true,
        canvasStrokeId: strokeId,
      };
      updateCursor(event.clientX, event.clientY);
      return;
    }
    const isAuxiliaryPanGesture = (event.buttons & 6) !== 0;
    const canDragExistingGeometry = tool === "pan";
    const canDragPointInPlotMode = tool === "plot";
    const canTargetObjectForPlot = tool === "plot";
    const rawTarget =
      !isAuxiliaryPanGesture && (canDragExistingGeometry || canDragPointInPlotMode)
        ? findNearestHandle(event.clientX, event.clientY)
        : null;
    const target =
      canDragExistingGeometry ||
      (canDragPointInPlotMode &&
        (rawTarget?.kind === "point" || rawTarget?.kind === "data"))
        ? rawTarget
        : null;
    const objectTarget =
      !isAuxiliaryPanGesture &&
      !target &&
      (canDragExistingGeometry || canTargetObjectForPlot)
        ? findNearestObject(event.clientX, event.clientY)
        : null;
    const groupTarget: GroupTarget | null = target
      ? target.kind === "data"
        ? { kind: "data", id: target.id, pointIndex: target.pointIndex }
        : target.kind === "point"
          ? { kind: "point", id: target.id }
          : { kind: target.kind, id: target.id }
      : objectTarget;
    const isLockedGroupDrag =
      canDragExistingGeometry &&
      isGroupLocked &&
      groupTarget !== null &&
      isGroupTargetSelected(groupTarget);

    if (canDragExistingGeometry && groupSelectionMode && groupTarget) {
      toggleGroupTarget(groupTarget);
      if (groupTarget.kind !== "point" && groupTarget.kind !== "data") {
        setSelectedObject({ kind: groupTarget.kind, id: groupTarget.id });
      } else {
        setSelectedObject(null);
      }
      dragRef.current = null;
      updateCursor(event.clientX, event.clientY);
      return;
    }
    const startWorld =
      tool === "measure"
        ? getMeasurePoint(event.clientX, event.clientY)
        : tool === "line" || tool === "curve" || tool === "rectangle" || tool === "square"
          ? getGeometryPoint(event.clientX, event.clientY)
        : {
            id: 0,
            ...snapPoint(screenToWorld(event.clientX, event.clientY)),
          };
    if (target && target.kind !== "point" && target.kind !== "data") {
      setSelectedObject({ kind: target.kind, id: target.id });
    } else {
      setSelectedObject(objectTarget);
    }
    if (canDragExistingGeometry && (objectTarget || (target && target.kind !== "point" && target.kind !== "data"))) {
      const rect = event.currentTarget.getBoundingClientRect();
      setHoverMenu({
        target:
          objectTarget ??
          ({ kind: target!.kind, id: target!.id } as ObjectTarget),
        x: event.clientX - rect.left + 12,
        y: event.clientY - rect.top + 12,
      });
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastMoveTime: event.timeStamp,
      velocityX: 0,
      velocityY: 0,
      moved: false,
      mode: isLockedGroupDrag
        ? "group"
        : target
        ? "handle"
        : objectTarget && canDragExistingGeometry
          ? "object"
          : isAuxiliaryPanGesture
            ? "pan"
            : "none",
      startWorld: { id: 0, x: startWorld.x, y: startWorld.y },
      historySnapshot: target || objectTarget ? getGraphSnapshot() : undefined,
      historyPushed: false,
      target: target ?? undefined,
      objectTarget: objectTarget ?? undefined,
      groupTarget: groupTarget ?? undefined,
    };
    updateCursor(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      updateCursor(event.clientX, event.clientY);
      updateHoverMenu(event.clientX, event.clientY);
      return;
    }

    if (drag.mode !== "pan") {
      updateCursor(event.clientX, event.clientY);
      if (drag.mode === "none") {
        setHoverSnapPoint(findNearestPointOnObject(event.clientX, event.clientY));
      } else {
        setHoverSnapPoint(null);
      }
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    const totalDx = event.clientX - drag.startX;
    const totalDy = event.clientY - drag.startY;

    const dragDistance = Math.hypot(totalDx, totalDy);

    if (dragDistance > TAP_THRESHOLD_PX) {
      drag.moved = true;
    }

    if (drag.mode === "canvas-draw" && drag.canvasStrokeId) {
      appendCanvasStrokePoint(
        drag.canvasStrokeId,
        getCanvasAnnotationPoint(event.clientX, event.clientY)
      );
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }

    if (drag.mode === "canvas-erase") {
      eraseCanvasStrokeAt(event.clientX, event.clientY);
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }

    if (
      drag.mode === "none" &&
      dragDistance > DRAW_LINE_THRESHOLD_PX &&
      (tool === "plot" || tool === "line") &&
      (event.buttons & 1) === 1
    ) {
      drag.mode = "draw-line";
    }

    if (
      drag.mode === "none" &&
      dragDistance > DRAW_LINE_THRESHOLD_PX &&
      tool === "measure" &&
      (event.buttons & 1) === 1
    ) {
      drag.mode = "draw-measure";
    }

    if (
      drag.mode === "none" &&
      dragDistance > DRAW_LINE_THRESHOLD_PX &&
      (tool === "rectangle" || tool === "square") &&
      (event.buttons & 1) === 1
    ) {
      drag.mode = "draw-shape";
    }

    if (drag.mode === "handle" && drag.target) {
      if (!drag.historyPushed && drag.historySnapshot) {
        pushHistory(drag.historySnapshot);
        drag.historyPushed = true;
      }
      const nextPoint = snapPoint(screenToWorld(event.clientX, event.clientY));
      moveHandle(drag.target, { id: 0, x: nextPoint.x, y: nextPoint.y });
    }

    if (drag.mode === "object" && drag.objectTarget) {
      setHoverMenu(null);
      setHoverSnapPoint(null);
      if (!drag.historyPushed && drag.historySnapshot) {
        pushHistory(drag.historySnapshot);
        drag.historyPushed = true;
      }
      moveObject(
        drag.objectTarget,
        roundCoordinate(dx / view.pixelsPerUnit),
        roundCoordinate(-dy / view.pixelsPerUnit)
      );
    }

    if (drag.mode === "group") {
      setHoverMenu(null);
      setHoverSnapPoint(null);
      if (!drag.historyPushed && drag.historySnapshot) {
        pushHistory(drag.historySnapshot);
        drag.historyPushed = true;
      }
      moveLockedGroup(
        roundCoordinate(dx / view.pixelsPerUnit),
        roundCoordinate(-dy / view.pixelsPerUnit)
      );
    }

    if (drag.mode === "draw-line") {
      const nextPoint = getGeometryPoint(event.clientX, event.clientY);
      setDraftPoints([
        drag.startWorld,
        { id: 0, x: nextPoint.x, y: nextPoint.y },
      ]);
    }

    if (drag.mode === "draw-measure") {
      setDraftPoints([drag.startWorld, getMeasurePoint(event.clientX, event.clientY)]);
    }

    if (drag.mode === "draw-shape" && (tool === "rectangle" || tool === "square")) {
      const nextPoint = getGeometryPoint(event.clientX, event.clientY);
      setDraftPoints([
        drag.startWorld,
        normalizeShapeEnd(
          drag.startWorld,
          { id: 0, x: nextPoint.x, y: nextPoint.y },
          tool
        ),
      ]);
    }

    if (drag.mode === "pan") {
      const dt = Math.max(1, event.timeStamp - drag.lastMoveTime);
      const scaledDx = dx * mouseSensitivity;
      const scaledDy = dy * mouseSensitivity;
      const nextVelocityX = scaledDx / dt;
      const nextVelocityY = scaledDy / dt;
      drag.velocityX = drag.velocityX * 0.65 + nextVelocityX * 0.35;
      drag.velocityY = drag.velocityY * 0.65 + nextVelocityY * 0.35;
      drag.lastMoveTime = event.timeStamp;
      queuePanBy(scaledDx, scaledDy);
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (
      drag &&
      drag.pointerId === event.pointerId &&
      (drag.mode === "canvas-draw" || drag.mode === "canvas-erase")
    ) {
      dragRef.current = null;
      return;
    }

    if (drag && drag.pointerId === event.pointerId && drag.mode === "pan") {
      startPanInertia(drag.velocityX, drag.velocityY);
      dragRef.current = null;
      return;
    }

    if (drag && drag.pointerId === event.pointerId && drag.mode === "draw-line") {
      const endWorld = getGeometryPoint(event.clientX, event.clientY);
      addLineFromPoints(drag.startWorld, { id: 0, x: endWorld.x, y: endWorld.y });
      setDraftPoints([]);
      dragRef.current = null;
      return;
    }

    if (drag && drag.pointerId === event.pointerId && drag.mode === "draw-measure") {
      addMeasureFromPoints(drag.startWorld, getMeasurePoint(event.clientX, event.clientY));
      setDraftPoints([]);
      dragRef.current = null;
      return;
    }

    if (
      drag &&
      drag.pointerId === event.pointerId &&
      drag.mode === "draw-shape" &&
      (tool === "rectangle" || tool === "square")
    ) {
      const endWorld = getGeometryPoint(event.clientX, event.clientY);
      addShapeFromPoints(tool, drag.startWorld, { id: 0, x: endWorld.x, y: endWorld.y });
      setDraftPoints([]);
      dragRef.current = null;
      return;
    }

    if (drag && drag.pointerId === event.pointerId && drag.mode === "none" && !drag.moved) {
      if (tool === "plot") {
        const pointOnObject = drag.objectTarget
          ? findNearestPointOnObject(event.clientX, event.clientY)
          : null;
        if (pointOnObject) {
          addWorldPoint(pointOnObject.point.x, pointOnObject.point.y);
        } else {
          addPoint(event.clientX, event.clientY);
        }
      }
      if (tool === "line" || tool === "curve" || tool === "rectangle" || tool === "square" || tool === "measure") {
        setDraftPoints([]);
      }
    }
    dragRef.current = null;
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const isPinchZoom = event.ctrlKey || event.metaKey;
    const looksLikeTrackpadPan =
      !isPinchZoom &&
      event.deltaMode === 0 &&
      (Math.abs(event.deltaX) > 0.5 ||
        Math.abs(event.deltaY) < TRACKPAD_WHEEL_PAN_THRESHOLD);

    if (looksLikeTrackpadPan) {
      stopPanInertia();
      queuePanBy(-event.deltaX * mouseSensitivity, -event.deltaY * mouseSensitivity);
      return;
    }

    const normalizedDelta =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * 120
          : event.deltaY;
    const zoomSpeed = isPinchZoom
      ? PINCH_ZOOM_FACTOR_PER_DELTA
      : WHEEL_ZOOM_FACTOR_PER_DELTA;
    const zoomFactor = Math.exp(-normalizedDelta * zoomSpeed * zoomSensitivity);

    zoomAt(
      event.clientX,
      event.clientY,
      zoomFactor
    );
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (isTypingTarget(event.target)) {
        return;
      }

      if (key === "delete") {
        if (selectedObject) {
          event.preventDefault();
          removeObject(selectedObject);
        }
        return;
      }

      const hasModifier = event.ctrlKey || event.metaKey;
      if (!hasModifier) return;

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (key === "d" || key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvasStrokes, canvasTextBoxes, curves, formulaObjects, lines, measures, points, selectedObject, shapes]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = clamp(event.clientX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      setSidebarWidth(nextWidth);
      setIsSidebarCollapsed(false);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.body.classList.add("resizing-sidebar");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.classList.remove("resizing-sidebar");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const syncCanvasSize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = getCanvasDpr();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);

      setCanvasSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      );

      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
      if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
    };

    syncCanvasSize();
    const observer = new ResizeObserver(syncCanvasSize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;

    const dpr = getCanvasDpr();
    const pixelWidth = Math.round(canvasSize.width * dpr);
    const pixelHeight = Math.round(canvasSize.height * dpr);

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (canvas.style.width !== `${canvasSize.width}px`) {
      canvas.style.width = `${canvasSize.width}px`;
    }
    if (canvas.style.height !== `${canvasSize.height}px`) {
      canvas.style.height = `${canvasSize.height}px`;
    }

    drawGraph(canvas, view, {
      points,
      lines,
      curves,
      shapes,
      formulaObjects,
      measures,
      dataPlots,
      canvasStrokes,
      hoverSnapPoint,
      calculatorGuide,
      calculatorMeanPoint,
      correlationGuide,
      draftPoints,
      cursor,
      connectPoints,
      selectedColor,
      tool,
      selectedObject,
      lockedGroupTargets,
      isGroupLocked,
      showLeastSquares,
      leastSquares: leastSquaresSummary,
    });
  }, [calculatorGuide, calculatorMeanPoint, canvasSize.height, canvasSize.width, canvasStrokes, connectPoints, correlationGuide, cursor, curves, dataPlots, draftPoints, formulaObjects, hoverSnapPoint, isGroupLocked, leastSquaresSummary, lines, lockedGroupTargets, measures, points, selectedColor, selectedObject, shapes, showLeastSquares, tool, view]);

  useEffect(
    () => () => {
      if (panFrameRef.current !== null) {
        cancelAnimationFrame(panFrameRef.current);
      }
      if (inertiaFrameRef.current !== null) {
        cancelAnimationFrame(inertiaFrameRef.current);
      }
    },
    []
  );

  const getCanvasPoint = (point: GraphPoint) => ({
    x: canvasSize.width / 2 + view.offsetX + point.x * view.pixelsPerUnit,
    y: canvasSize.height / 2 + view.offsetY - point.y * view.pixelsPerUnit,
  });
  const getLabelStyle = (anchor: { x: number; y: number }) => ({
    left: clamp(anchor.x + 12, 8, Math.max(8, canvasSize.width - 220)),
    top: clamp(anchor.y - 22, 8, Math.max(8, canvasSize.height - 82)),
  });
  const getPointLabelStyle = (point: GraphPoint) => {
    const anchor = getCanvasPoint(point);
    return {
      left: clamp(anchor.x + (point.labelDx ?? 9), 8, Math.max(8, canvasSize.width - 160)),
      top: clamp(anchor.y + (point.labelDy ?? -18), 8, Math.max(8, canvasSize.height - 40)),
    };
  };
  const getMeasureLabelStyle = (measure: GraphMeasure) => {
    const a = getCanvasPoint(measure.a);
    const b = getCanvasPoint(measure.b);
    const t = measure.labelT ?? 0.5;
    return getLabelStyle({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  };
  const getShapeAreaLabelStyle = (shape: GraphShape) => {
    const point = getCanvasPoint(
      getShapeLocalPoint(shape, shape.areaLabelTx ?? 0.5, shape.areaLabelTy ?? 0.5)
    );
    return {
      left: point.x,
      top: point.y,
    };
  };
  const isOverlayActive = (target: ObjectTarget) =>
    isSelectedObject(selectedObject, target.kind, target.id);
  const shouldShowOverlay = (
    target: ObjectTarget,
    showLabel: boolean
  ) => showLabel;
  const activeColor = getSelectedObjectColor() ?? selectedColor;
  const activeRgb = hexToRgb(activeColor);
  const activeHsv = rgbToHsv(activeRgb.r, activeRgb.g, activeRgb.b);
  const colorPickerStyle = {
    "--picker-hue": `${activeHsv.h}deg`,
    "--picker-color": activeColor,
  } as CSSProperties;
  const applyRgbColor = (channel: "r" | "g" | "b", value: number) => {
    const nextRgb = {
      ...activeRgb,
      [channel]: clamp(Math.round(Number.isFinite(value) ? value : 0), 0, 255),
    };
    applyDrawingColor(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  };
  const formatObjectForCalculator = (target: ObjectTarget) => {
    if (target.kind === "line") {
      const line = lines.find((item) => item.id === target.id);
      return line ? getLineLabel(line) : "Line";
    }
    if (target.kind === "curve") {
      const curve = curves.find((item) => item.id === target.id);
      return curve ? formatCurveEquation(curve) : "Curve";
    }
    if (target.kind === "shape") {
      const shape = shapes.find((item) => item.id === target.id);
      return shape ? formatShapeLabel(shape) : "Shape";
    }
    if (target.kind === "formula") {
      const object = formulaObjects.find((item) => item.id === target.id);
      return object ? object.formula : "Formula object";
    }
    const measure = measures.find((item) => item.id === target.id);
    return measure ? formatMeasureLabel(measure) : "Distance";
  };
  const selectedCalculatorObject =
    selectedObject?.kind === "line"
      ? {
          kind: "line" as const,
          value: lines.find((line) => line.id === selectedObject.id)!,
        }
      : selectedObject?.kind === "curve"
        ? {
            kind: "curve" as const,
            value: curves.find((curve) => curve.id === selectedObject.id)!,
          }
        : selectedObject?.kind === "shape"
          ? {
              kind: "shape" as const,
              value: shapes.find((shape) => shape.id === selectedObject.id)!,
            }
          : selectedObject?.kind === "measure"
            ? {
                kind: "measure" as const,
                value: measures.find((measure) => measure.id === selectedObject.id)!,
              }
            : null;
  const calculatorContext = {
    points,
    dataPlots,
    selected:
      selectedCalculatorObject?.value === undefined ? null : selectedCalculatorObject,
    selectedTarget: selectedObject,
    formatObject: formatObjectForCalculator,
  };
  const isFormulaPanelEmpty =
    lines.length === 0 &&
    curves.length === 0 &&
    shapes.length === 0 &&
    measures.length === 0 &&
    formulaObjects.length === 0;
  const getFormulaCardExpanded = (cardId: string, selected: boolean) =>
    expandedFormulaCards[cardId] ?? selected;
  const makeComputed = (
    items: Array<[string, number | string]>
  ): FormulaCardComputedValue[] =>
    items.map(([label, value]) => ({
      label,
      value: typeof value === "number" ? formatNumber(value) : value,
    }));
  const renderLineFormulaCard = (line: GraphLine, index: number) => {
    const target: ObjectTarget = { kind: "line", id: line.id };
    const selected = isSelectedObject(selectedObject, "line", line.id);
    const parts = getLineParts(line);
    const variables: FormulaCardVariable[] = parts.vertical
      ? [{ key: "x", label: "x", value: parts.x, min: -20, max: 20, step: 0.1 }]
      : [
          { key: "m", label: "slope m", value: parts.m, min: -20, max: 20, step: 0.05 },
          { key: "b", label: "intercept b", value: parts.b, min: -20, max: 20, step: 0.1 },
        ];
    return (
      <FormulaObjectCard
        color={line.color}
        computed={
          parts.vertical
            ? makeComputed([["x-intercept", parts.x]])
            : makeComputed([
                ["slope", parts.m],
                ["y-intercept", parts.b],
              ])
        }
        expanded={getFormulaCardExpanded(`line-${line.id}`, selected)}
        formula={parts.vertical ? `x = ${formatNumber(parts.x)}` : "y = mx + b"}
        isSelected={selected}
        key={`line-card-${line.id}`}
        name={`Line L${index + 1}`}
        onColorChange={(color) => updateObjectColor(target, color)}
        onDelete={() => removeObject(target)}
        onLabelToggle={() => updateLabelVisibility(target, !line.showLabel)}
        onSelect={() => setSelectedObject(target)}
        onToggleExpanded={() => toggleFormulaCard(`line-${line.id}`)}
        onVariableChange={(key, value) => updateLineFormulaVariable(line.id, key, value)}
        showLabel={line.showLabel}
        variables={variables}
      />
    );
  };
  const renderCurveFormulaCard = (curve: GraphCurve, index: number) => {
    const target: ObjectTarget = { kind: "curve", id: curve.id };
    const selected = isSelectedObject(selectedObject, "curve", curve.id);
    const coefficients = getQuadraticCoefficients(curve);
    return (
      <FormulaObjectCard
        color={curve.color}
        computed={
          coefficients
            ? makeComputed([
                ["a", coefficients.a],
                ["b", coefficients.b],
                ["c", coefficients.c],
              ])
            : [{ label: "status", value: "needs 3 different x-values" }]
        }
        expanded={getFormulaCardExpanded(`curve-${curve.id}`, selected)}
        formula="y = ax^2 + bx + c"
        isSelected={selected}
        key={`curve-card-${curve.id}`}
        name={`Quadratic C${index + 1}`}
        onColorChange={(color) => updateObjectColor(target, color)}
        onDelete={() => removeObject(target)}
        onLabelToggle={() => updateLabelVisibility(target, !curve.showLabel)}
        onSelect={() => setSelectedObject(target)}
        onToggleExpanded={() => toggleFormulaCard(`curve-${curve.id}`)}
        onVariableChange={(key, value) => updateCurveFormulaVariable(curve.id, key, value)}
        showLabel={curve.showLabel}
        variables={
          coefficients
            ? [
                { key: "a", label: "a", value: coefficients.a, min: -5, max: 5, step: 0.05 },
                { key: "b", label: "b", value: coefficients.b, min: -20, max: 20, step: 0.1 },
                { key: "c", label: "c", value: coefficients.c, min: -20, max: 20, step: 0.1 },
              ]
            : []
        }
      />
    );
  };
  const renderShapeFormulaCard = (shape: GraphShape, index: number) => {
    const target: ObjectTarget = { kind: "shape", id: shape.id };
    const selected = isSelectedObject(selectedObject, "shape", shape.id);
    const width = shape.b.x - shape.a.x;
    const height = shape.b.y - shape.a.y;
    const side = width;
    const formula = shape.type === "square" ? "A = s^2, P = 4s" : "A = w x h, P = 2(w + h)";
    const computed =
      shape.type === "square"
        ? makeComputed([
            ["area", side ** 2],
            ["perimeter", 4 * Math.abs(side)],
            ["center", `${formatNumber(shape.a.x + side / 2)}, ${formatNumber(shape.a.y + side / 2)}`],
          ])
        : makeComputed([
            ["area", Math.abs(width * height)],
            ["perimeter", 2 * (Math.abs(width) + Math.abs(height))],
            ["center", `${formatNumber(shape.a.x + width / 2)}, ${formatNumber(shape.a.y + height / 2)}`],
          ]);
    return (
      <FormulaObjectCard
        color={shape.color}
        computed={computed}
        expanded={getFormulaCardExpanded(`shape-${shape.id}`, selected)}
        formula={formula}
        isSelected={selected}
        key={`shape-card-${shape.id}`}
        name={`${shape.type === "square" ? "Square" : "Rectangle"} S${index + 1}`}
        onColorChange={(color) => updateObjectColor(target, color)}
        onDelete={() => removeObject(target)}
        onLabelToggle={() => updateLabelVisibility(target, !shape.showLabel)}
        onSelect={() => setSelectedObject(target)}
        onToggleExpanded={() => toggleFormulaCard(`shape-${shape.id}`)}
        onVariableChange={(key, value) => updateShapeFormulaVariable(shape.id, key, value)}
        showLabel={shape.showLabel}
        variables={
          shape.type === "square"
            ? [{ key: "s", label: "side s", value: side, min: -20, max: 20, step: 0.1 }]
            : [
                { key: "w", label: "width w", value: width, min: -20, max: 20, step: 0.1 },
                { key: "h", label: "height h", value: height, min: -20, max: 20, step: 0.1 },
              ]
        }
      />
    );
  };
  const renderMeasureFormulaCard = (measure: GraphMeasure, index: number) => {
    const target: ObjectTarget = { kind: "measure", id: measure.id };
    const selected = isSelectedObject(selectedObject, "measure", measure.id);
    const dx = measure.b.x - measure.a.x;
    const dy = measure.b.y - measure.a.y;
    return (
      <FormulaObjectCard
        color={measure.color}
        computed={makeComputed([
          ["distance", getDistance(measure.a, measure.b)],
          ["dx", dx],
          ["dy", dy],
        ])}
        expanded={getFormulaCardExpanded(`measure-${measure.id}`, selected)}
        formula="d = sqrt((x2 - x1)^2 + (y2 - y1)^2)"
        isSelected={selected}
        key={`measure-card-${measure.id}`}
        name={`Distance D${index + 1}`}
        onColorChange={(color) => updateObjectColor(target, color)}
        onDelete={() => removeObject(target)}
        onLabelToggle={() => updateLabelVisibility(target, !measure.showLabel)}
        onSelect={() => setSelectedObject(target)}
        onToggleExpanded={() => toggleFormulaCard(`measure-${measure.id}`)}
        onVariableChange={(key, value) => updateMeasureFormulaVariable(measure.id, key, value)}
        showLabel={measure.showLabel}
        variables={[
          { key: "x1", label: "x1", value: measure.a.x, min: -20, max: 20, step: 0.1 },
          { key: "y1", label: "y1", value: measure.a.y, min: -20, max: 20, step: 0.1 },
          { key: "x2", label: "x2", value: measure.b.x, min: -20, max: 20, step: 0.1 },
          { key: "y2", label: "y2", value: measure.b.y, min: -20, max: 20, step: 0.1 },
        ]}
      />
    );
  };
  const renderFormulaObjectCard = (object: GraphFormulaObject) => {
    const target: ObjectTarget = { kind: "formula", id: object.id };
    const selected = isSelectedObject(selectedObject, "formula", object.id);
    return (
      <FormulaObjectCard
        color={object.color}
        computed={formatComputedValues(object)}
        expanded={getFormulaCardExpanded(`formula-${object.id}`, selected)}
        formula={object.formula}
        isSelected={selected}
        key={`formula-card-${object.id}`}
        name={object.name}
        onColorChange={(color) => updateObjectColor(target, color)}
        onDelete={() => removeObject(target)}
        onLabelToggle={() => updateLabelVisibility(target, object.showLabel === false)}
        onSelect={() => setSelectedObject(target)}
        onToggleExpanded={() => toggleFormulaCard(`formula-${object.id}`)}
        onVariableChange={(key, value) => {
          if (key === "anchor-x") updateFormulaObjectAnchor(object.id, "x", value);
          else if (key === "anchor-y") updateFormulaObjectAnchor(object.id, "y", value);
          else updateFormulaObjectVariable(object.id, key, value);
        }}
        showLabel={object.showLabel !== false}
        variables={[
          { key: "anchor-x", label: "anchor x", value: object.anchor.x, min: -20, max: 20, step: 0.1 },
          { key: "anchor-y", label: "anchor y", value: object.anchor.y, min: -20, max: 20, step: 0.1 },
          ...object.variables,
        ]}
      />
    );
  };
  const selectedCapture =
    captures.find((capture) => capture.id === selectedCaptureId) ?? null;
  const activeGraphPage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const comparisonPage =
    pages.find((page) => page.id === comparisonPageId && page.id !== activePageId) ??
    null;
  const selectedPageSnapshot =
    activeGraphPage.snapshots.find(
      (snapshot) => snapshot.id === selectedPageSnapshotId
    ) ?? null;

  return (
    <main
      className="app-shell"
      style={{
        gridTemplateColumns: isSidebarCollapsed
          ? "0px 10px minmax(0, 1fr)"
          : `${sidebarWidth}px 10px minmax(0, 1fr)`,
      }}
    >
      <nav className="app-menu-bar" aria-label="Application menu">
        <details className="app-menu-item">
          <summary>File</summary>
          <div className="app-menu-dropdown">
            <label className="field compact-field">
              <span>Active page name</span>
              <input
                onChange={(event) => renameActiveGraphPage(event.target.value)}
                type="text"
                value={activeGraphPage.name}
              />
            </label>
            <button type="button" onClick={saveActiveGraphPage}>
              Save active page
            </button>
            <button
              disabled={pages.length <= 1}
              onClick={removeActiveGraphPage}
              type="button"
            >
              Delete active page
            </button>
            <button type="button" onClick={saveWorkspaceSnapshot}>
              Save workspace
            </button>
            <label className="field compact-field">
              <span>Capture name</span>
              <input
                onChange={(event) => setCaptureName(event.target.value)}
                type="text"
                value={captureName}
              />
            </label>
            <button type="button" onClick={() => createWorkspaceCapture()}>
              Capture current workspace
            </button>
            <label className="field compact-field">
              <span>Retrieve capture</span>
              <select
                onChange={(event) => setSelectedCaptureId(event.target.value)}
                value={selectedCaptureId}
              >
                <option value="">Choose saved capture</option>
                {captures.map((capture) => (
                  <option key={capture.id} value={capture.id}>
                    {capture.name} - {new Date(capture.savedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <div className="capture-actions">
              <button
                disabled={!selectedCapture}
                onClick={() => restoreWorkspaceCapture()}
                type="button"
              >
                Restore
              </button>
              <button
                disabled={!selectedCapture}
                onClick={() => deleteWorkspaceCapture()}
                type="button"
              >
                Delete
              </button>
            </div>
            <button type="button" onClick={() => setView(START_VIEW)}>
              Reset view
            </button>
          </div>
        </details>

        <details className="app-menu-item">
          <summary>Tools</summary>
          <div className="app-menu-dropdown tools-dropdown">
            <label className="field sensitivity-field">
              <span>Mouse movement sensitivity</span>
              <div className="sensitivity-row">
                <input
                  max="5"
                  min="0.25"
                  onChange={(event) => setMouseSensitivity(Number(event.target.value))}
                  step="0.05"
                  type="range"
                  value={mouseSensitivity}
                />
                <code>{Math.round(mouseSensitivity * 100)}%</code>
              </div>
            </label>
            <label className="field sensitivity-field">
              <span>Zoom sensitivity</span>
              <div className="sensitivity-row">
                <input
                  max="8"
                  min="0.25"
                  onChange={(event) => setZoomSensitivity(Number(event.target.value))}
                  step="0.1"
                  type="range"
                  value={zoomSensitivity}
                />
                <code>{Math.round(zoomSensitivity * 100)}%</code>
              </div>
            </label>
          </div>
        </details>

        <details className="app-menu-item">
          <summary>View</summary>
          <div className="app-menu-dropdown">
            <button type="button" onClick={() => switchWorkspaceMode("2d")}>
              2D graph mode
            </button>
            <button type="button" onClick={() => switchWorkspaceMode("surface")}>
              3D surface mode
            </button>
          </div>
        </details>

        <button className="app-menu-button" type="button" onClick={saveActiveGraphPage}>
          Save
        </button>
        <button className="app-menu-button" type="button" onClick={() => window.close()}>
          Exit
        </button>
      </nav>

      <aside
        className={isSidebarCollapsed ? "sidebar collapsed" : "sidebar"}
        aria-label="Graph controls"
      >
        <div className="brand">
          <span className="brand-mark">G</span>
          <div>
            <h1>Graph Workspace</h1>
            <p>Interactive plotting board</p>
          </div>
        </div>

        {workspaceMode === "2d" ? (
          <section className="control-section">
            <h2>Tool</h2>
            <div className="segmented tool-dropdown-grid">
              {([
                ["plot", "Plot"],
                ["line", "Line"],
                ["curve", "Curve"],
                ["rectangle", "Rect"],
                ["square", "Square"],
                ["measure", "Distance"],
                ["pan", "Pan"],
              ] as Array<[Tool, string]>).map(([value, label]) => (
                <div
                  className={
                    openToolMenu === value
                      ? "tool-dropdown-cell open"
                      : "tool-dropdown-cell"
                  }
                  key={value}
                >
                  <button
                    className={tool === value ? "active" : ""}
                    onClick={() => selectTool(value)}
                    type="button"
                  >
                    <span>{label}</span>
                    <span aria-hidden="true">v</span>
                  </button>
                  <div
                    className={
                      openToolMenu === value
                        ? "tool-options open"
                        : "tool-options"
                    }
                    aria-hidden={openToolMenu !== value}
                  >
                      {value === "line" ? (
                        <>
                          <label className="toggle">
                            <input
                              checked={referenceLineMode}
                              onChange={(event) =>
                                setReferenceLineMode(event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span>Reference dotted line</span>
                          </label>
                          <span>
                            When enabled, new lines are finite dotted guide lines.
                          </span>
                        </>
                      ) : value === "square" ? (
                        <>
                          <label className="toggle">
                            <input
                              checked={showLeastSquares}
                              onChange={(event) =>
                                setShowLeastSquares(event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span>Least-squares squares</span>
                          </label>
                          <button
                            disabled={!referenceSquareSource}
                            onClick={addSquareFromReferenceLine}
                            type="button"
                          >
                            Create from reference line
                          </button>
                          <label className="toggle">
                            <input
                              checked={referenceSquareSide === -1}
                              onChange={(event) =>
                                setReferenceSquareSide(event.target.checked ? -1 : 1)
                              }
                              type="checkbox"
                            />
                            <span>Create on opposite side</span>
                          </label>
                          <button
                            disabled={!selectedReferenceSquare}
                            onClick={flipSelectedReferenceSquare}
                            type="button"
                          >
                            Flip selected square
                          </button>
                          <span>
                            Uses the selected dotted guide, or the newest dotted guide, as one side.
                          </span>
                          {showLeastSquares && leastSquaresSummary ? (
                            <>
                              <code>
                                Σ(yi - ŷi)^2 = {formatNumber(leastSquaresSummary.sum)}
                              </code>
                              <span>
                                {leastSquaresSummary.residuals.length} point
                                {leastSquaresSummary.residuals.length === 1 ? "" : "s"} against{" "}
                                {formatLineEquation(leastSquaresSummary.line)}
                              </span>
                            </>
                          ) : (
                            <span>
                              Check to show residual squares, formula, and SSE value.
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <span>{label} options</span>
                          <button disabled type="button">
                            More settings soon
                          </button>
                        </>
                      )}
                  </div>
                </div>
              ))}
            </div>
            <div className="color-tools">
              <span>{selectedObject ? "Selected color" : "Color"}</span>
              <div className="panel-color-picker" style={colorPickerStyle}>
                <label className="color-field">
                  <input
                    aria-label="Custom drawing color"
                    onChange={(event) => applyDrawingColor(event.target.value)}
                    type="color"
                    value={activeColor}
                  />
                  <span className="color-field-cursor" aria-hidden="true" />
                </label>
                <div className="color-controls-row">
                  <span className="color-preview" style={{ backgroundColor: activeColor }} />
                  <input
                    aria-label="Hue"
                    className="hue-slider"
                    max="359"
                    min="0"
                    onChange={(event) => {
                      const next = hsvToRgb(Number(event.target.value), activeHsv.s, activeHsv.v);
                      applyDrawingColor(rgbToHex(next.r, next.g, next.b));
                    }}
                    type="range"
                    value={activeHsv.h}
                  />
                </div>
                <div className="rgb-fields">
                  {([
                    ["r", "R", activeRgb.r],
                    ["g", "G", activeRgb.g],
                    ["b", "B", activeRgb.b],
                  ] as Array<["r" | "g" | "b", string, number]>).map(([channel, label, value]) => (
                    <label key={channel}>
                      <input
                        max="255"
                        min="0"
                        onChange={(event) => applyRgbColor(channel, Number(event.target.value))}
                        type="number"
                        value={value}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <small>
                {selectedObject
                  ? "Changes the selected object now."
                  : "Sets the color for new objects."}
              </small>
            </div>
          </section>
        ) : null}

        {workspaceMode === "surface" ? (
          <section className="control-section">
            <h2>3D Tools</h2>
            <div className="surface-tool-grid">
              {[
                ["select", "Select"],
                ["pen", "Pen"],
                ["pencil", "Pencil"],
                ["cutter", "Cutter"],
                ["fill", "Fill"],
                ["paint", "Paint"],
                ["scale", "Scale"],
                ["stretch", "Stretch"],
                ["shrink", "Shrink"],
                ["data", "Plot data"],
              ].map(([value, label]) => (
                <button
                  className={surfaceTool === value ? "active" : ""}
                  key={value}
                  onClick={() => setSurfaceTool(value as SurfaceTool)}
                  type="button"
                >
                  {label}
                </button>
              ))}
              <button onClick={replicateSurfaceShape} type="button">
                Replicate
              </button>
            </div>
          </section>
        ) : null}

        {workspaceMode === "surface" ? (
          <section className="control-section">
            <h2>3D Shapes</h2>
            <div className="surface-add-row">
              <button onClick={addSurfaceShape} type="button">
                Add surface
              </button>
              <button onClick={addSurfaceCube} type="button">
                Add cube
              </button>
            </div>
            <label className="field">
              <span>Selected shape</span>
              <select
                onChange={(event) =>
                  setSelectedSurfaceShapeId(Number(event.target.value))
                }
                value={selectedSurfaceShape?.id ?? ""}
              >
                {surfaceShapes.map((shape) => (
                  <option key={shape.id} value={shape.id}>
                    {(shape.type ?? "surface") === "cube" ? "Cube" : "Surface"}: {shape.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedSurfaceType === "surface" ? (
              <label className="field">
                <span>z = f(x, y)</span>
                <input
                  onChange={(event) =>
                    updateSelectedSurfaceShape({ equation: event.target.value })
                  }
                  spellCheck={false}
                  type="text"
                  value={surfaceEquation}
                />
              </label>
            ) : null}
            <label className="field">
              <span>Range</span>
              <input
                max="12"
                min="2"
                onChange={(event) => setSurfaceRange(Number(event.target.value))}
                step="0.5"
                type="range"
                value={surfaceRange}
              />
            </label>
            <label className="field">
              <span>Resolution</span>
              <input
                max="80"
                min="16"
                onChange={(event) => setSurfaceResolution(Number(event.target.value))}
                step="4"
                type="range"
                value={surfaceResolution}
              />
            </label>
            <label className="custom-color surface-color">
              <span>Surface color</span>
              <input
                aria-label="3D surface color"
                onChange={(event) =>
                  updateSelectedSurfaceShape({ color: event.target.value })
                }
                type="color"
                value={surfaceColor}
              />
            </label>
            {selectedSurfaceShape ? (
              <div className="surface-transform-fields">
                {selectedSurfaceType === "surface" ? (
                  <>
                    <label className="field">
                      <span>Scale</span>
                      <input
                        max="3"
                        min="0.2"
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          updateSelectedSurfaceShape({
                            scale: { x: value, y: value, z: value },
                          });
                        }}
                        step="0.05"
                        type="range"
                        value={selectedSurfaceShape.scale.x}
                      />
                    </label>
                    <label className="field">
                      <span>Stretch x</span>
                      <input
                        max="3"
                        min="0.2"
                        onChange={(event) =>
                          updateSelectedSurfaceShape({
                            scale: {
                              ...selectedSurfaceShape.scale,
                              x: Number(event.target.value),
                            },
                          })
                        }
                        step="0.05"
                        type="range"
                        value={selectedSurfaceShape.scale.x}
                      />
                    </label>
                    <label className="field">
                      <span>Stretch y</span>
                      <input
                        max="3"
                        min="0.2"
                        onChange={(event) =>
                          updateSelectedSurfaceShape({
                            scale: {
                              ...selectedSurfaceShape.scale,
                              z: Number(event.target.value),
                            },
                          })
                        }
                        step="0.05"
                        type="range"
                        value={selectedSurfaceShape.scale.z}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    {([
                      ["x", "Width x"],
                      ["y", "Height z"],
                      ["z", "Depth y"],
                    ] as Array<[keyof SurfaceVector3, string]>).map(([axis, label]) => (
                      <label className="field" key={axis}>
                        <span>
                          {label}: {formatNumber(selectedSurfaceShape.scale[axis])}
                        </span>
                        <input
                          max="8"
                          min="0.1"
                          onChange={(event) =>
                            updateSelectedSurfaceShape({
                              scale: {
                                ...selectedSurfaceShape.scale,
                                [axis]: Number(event.target.value),
                              },
                            })
                          }
                          step="0.1"
                          type="range"
                          value={selectedSurfaceShape.scale[axis]}
                        />
                      </label>
                    ))}
                  </>
                )}
              </div>
            ) : null}
            <div className="surface-slice-controls">
              <label className="toggle">
                <input
                  checked={surfaceShowSlices}
                  onChange={(event) => setSurfaceShowSlices(event.target.checked)}
                  type="checkbox"
                />
                <span>Show colored cuts</span>
              </label>
              <label className="toggle">
                <input
                  checked={surfaceShowContour}
                  onChange={(event) => setSurfaceShowContour(event.target.checked)}
                  type="checkbox"
                />
                <span>Show contour view</span>
              </label>
              <div className="surface-panel-toggle">
                <button
                  className={surfacePanelView === "contour" ? "active" : ""}
                  onClick={() => setSurfacePanelView("contour")}
                  type="button"
                >
                  Contour
                </button>
                <button
                  className={surfacePanelView === "flat" ? "active" : ""}
                  onClick={() => setSurfacePanelView("flat")}
                  type="button"
                >
                  2D x/y
                </button>
              </div>
              <label className="field">
                <span>Vertical x cut: {surfaceCutX}</span>
                <input
                  max={surfaceRange}
                  min={-surfaceRange}
                  onChange={(event) => setSurfaceCutX(Number(event.target.value))}
                  step="0.25"
                  type="range"
                  value={surfaceCutX}
                />
              </label>
              <label className="field">
                <span>Vertical y cut: {surfaceCutY}</span>
                <input
                  max={surfaceRange}
                  min={-surfaceRange}
                  onChange={(event) => setSurfaceCutY(Number(event.target.value))}
                  step="0.25"
                  type="range"
                  value={surfaceCutY}
                />
              </label>
              <label className="field">
                <span>Horizontal z cut: {surfaceCutZ}</span>
                <input
                  max={surfaceRange}
                  min={-surfaceRange}
                  onChange={(event) => setSurfaceCutZ(Number(event.target.value))}
                  step="0.25"
                  type="range"
                  value={surfaceCutZ}
                />
              </label>
            </div>
            <div className="surface-preset-block">
              <span>ML presets</span>
              <div className="surface-presets">
                {SURFACE_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applySurfacePreset(preset)}
                    type="button"
                  >
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
              </div>
            </div>
            <p className="surface-help">
              Use x and y. Supported functions: sin, cos, tan, sqrt, log, exp, abs, pow,
              min, max.
            </p>
          </section>
        ) : null}

        <section className="control-section">
          <h2>View</h2>
          <div className="button-row">
            <button type="button" onClick={() => setView(START_VIEW)}>
              Reset
            </button>
          </div>
          <div className="history-row">
            <button disabled={!canUndo} onClick={undo} type="button">
              Undo
            </button>
            <button disabled={!canRedo} onClick={redo} type="button">
              Redo
            </button>
          </div>

          <label className="field zoom-field">
            <span>Scale</span>
            <div className="zoom-control">
              <button
                aria-label="Zoom out"
                onClick={() => zoomCanvasCenterBy(-ZOOM_BUTTON_STEP)}
                type="button"
              >
                -
              </button>
              <input
                max={MAX_ZOOM}
                min={MIN_ZOOM}
                onChange={(event) =>
                  setZoomAtCanvasCenter(Number(event.target.value))
                }
                step="1"
                style={{ "--zoom-percent": zoomPercent } as CSSProperties}
                type="range"
                value={view.pixelsPerUnit}
              />
              <button
                aria-label="Zoom in"
                onClick={() => zoomCanvasCenterBy(ZOOM_BUTTON_STEP)}
                type="button"
              >
                +
              </button>
            </div>
          </label>

          <div className="stats">
            <span>{Math.round(view.pixelsPerUnit)} px / unit</span>
            <span>Grid: {SUBGRID_STEP} unit</span>
          </div>
          <label className="field">
            <span>Renderer</span>
            <div className="renderer-toggle">
              <button
                className={rendererMode === "auto" ? "active" : ""}
                onClick={() => setRendererMode("auto")}
                type="button"
              >
                Auto
              </button>
              <button
                className={rendererMode === "canvas" ? "active" : ""}
                onClick={() => setRendererMode("canvas")}
                type="button"
              >
                Canvas
              </button>
              <button
                className={rendererMode === "gpu" ? "active" : ""}
                onClick={() => setRendererMode("gpu")}
                type="button"
              >
                GPU
              </button>
            </div>
          </label>
          <p className="renderer-status">
            {rendererStatusText}
          </p>
          <button
            className="danger"
            disabled={!selectedObject}
            onClick={() => removeObject(selectedObject)}
            type="button"
          >
            Remove selected
          </button>
          <div className="group-controls">
            <label className="toggle">
              <input
                checked={groupSelectionMode}
                onChange={(event) => {
                  setGroupSelectionMode(event.target.checked);
                  if (event.target.checked) {
                    setIsGroupLocked(false);
                    selectTool("pan");
                  }
                }}
                type="checkbox"
              />
              <span>Select multiple in Pan mode</span>
            </label>
            <small>
              {lockedGroupTargets.length} selected · {isGroupLocked ? "locked" : "unlocked"}
            </small>
            <div className="group-control-actions">
              <button
                disabled={lockedGroupTargets.length < 2}
                onClick={() => {
                  setIsGroupLocked(true);
                  setGroupSelectionMode(false);
                  selectTool("pan");
                }}
                type="button"
              >
                Lock group
              </button>
              <button
                disabled={!isGroupLocked}
                onClick={() => setIsGroupLocked(false)}
                type="button"
              >
                Unlock
              </button>
              <button
                disabled={lockedGroupTargets.length === 0}
                onClick={clearLockedGroup}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        <section className="control-section">
          <h2>Plotting</h2>
          <label className="toggle">
            <input
              checked={snapToGrid}
              onChange={(event) => setSnapToGrid(event.target.checked)}
              type="checkbox"
            />
            <span>Snap when clicking</span>
          </label>
          <label className="field">
            <span>Mouse snap precision</span>
            <select
              disabled={!snapToGrid}
              onChange={(event) => setSnapStep(Number(event.target.value))}
              value={snapStep}
            >
              {SNAP_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step === SUBGRID_STEP ? `${step} unit (visible quarter grid)` : `${step} unit`}
                </option>
              ))}
            </select>
          </label>
          <form className="coordinate-form" onSubmit={addManualPoint}>
            <label>
              <span>X</span>
              <input
                inputMode="decimal"
                onChange={(event) => setManualX(event.target.value)}
                placeholder="1.25"
                step="any"
                type="number"
                value={manualX}
              />
            </label>
            <label>
              <span>Y</span>
              <input
                inputMode="decimal"
                onChange={(event) => setManualY(event.target.value)}
                placeholder="-0.4"
                step="any"
                type="number"
                value={manualY}
              />
            </label>
            <button type="submit">Add</button>
          </form>
          <label className="toggle">
            <input
              checked={connectPoints}
              onChange={(event) => setConnectPoints(event.target.checked)}
              type="checkbox"
            />
            <span>Connect points</span>
          </label>
          <button
            className="danger"
            onClick={() => {
              if (points.length === 0) return;
              pushHistory();
              setPoints([]);
            }}
            type="button"
          >
            Clear points
          </button>
          <button
            className="danger"
            onClick={() => {
              if (lines.length === 0 && curves.length === 0 && shapes.length === 0 && formulaObjects.length === 0 && measures.length === 0) return;
              pushHistory();
              setLines([]);
              setCurves([]);
              setShapes([]);
              setFormulaObjects([]);
              setMeasures([]);
              setDraftPoints([]);
              setSelectedObject(null);
            }}
            type="button"
          >
            Clear objects
          </button>
        </section>

        <section className="control-section">
          <h2>Data</h2>
          <form className="data-form" onSubmit={addDataPlot}>
            <label className="field">
              <span>Name</span>
              <input
                onChange={(event) => setDataName(event.target.value)}
                type="text"
                value={dataName}
              />
            </label>
            <label className="field">
              <span>Plot type</span>
              <select
                onChange={(event) =>
                  setDataPlotStyle(event.target.value as DataPlotStyle)
                }
                value={dataPlotStyle}
              >
                <option value="scatter">Scatter</option>
                <option value="line">Line</option>
                <option value="scatter-line">Connected points</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            {(dataPlotStyle === "scatter" || dataPlotStyle === "scatter-line") ? (
              <div className="data-coordinate-entry">
                <label>
                  <span>x_coordinate</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) => setDataXInput(event.target.value)}
                    placeholder="1"
                    step="any"
                    type="number"
                    value={dataXInput}
                  />
                </label>
                <label>
                  <span>y_coordinate</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) => setDataYInput(event.target.value)}
                    placeholder="2"
                    step="any"
                    type="number"
                    value={dataYInput}
                  />
                </label>
                <button onClick={addDataCoordinatePair} type="button">
                  Add pair
                </button>
              </div>
            ) : null}
            <label className="field">
              <span>{getDataInputLabel(dataPlotStyle)}</span>
              <textarea
                className="data-textarea"
                onChange={(event) => setDataInput(event.target.value)}
                placeholder={getDataInputPlaceholder(dataPlotStyle)}
                spellCheck={false}
                value={dataInput}
              />
            </label>
            <label className="file-import">
              <span>Import CSV / TXT / JSON</span>
              <input
                accept=".csv,.txt,.tsv,.json"
                onChange={importDataFile}
                type="file"
              />
            </label>
            {dataError ? <p className="form-error">{dataError}</p> : null}
            <div className="data-actions">
              <button type="submit">Generate plot</button>
              <button
                className="danger"
                disabled={dataPlots.length === 0}
                onClick={() => {
                  if (dataPlots.length === 0) return;
                  pushHistory();
                  setDataPlots([]);
                }}
                type="button"
              >
                Clear data
              </button>
            </div>
          </form>
        </section>

        <section className="control-section">
          <h2>Data sets</h2>
          <div className="equation-list">
            {dataPlots.length === 0 ? (
              <p className="empty-state">Generate a plot from pasted values.</p>
            ) : (
              dataPlots.map((plot, index) => (
                <div className="equation-row data-row" key={plot.id}>
                  <span>DS{index + 1}</span>
                  <input
                    aria-label={`Change data plot ${index + 1} color`}
                    className="row-color-input"
                    onChange={(event) => updateDataPlotColor(plot.id, event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    type="color"
                    value={plot.color}
                  />
                  <code>
                    {plot.name}: {plot.values.length} points
                  </code>
                  <button
                    aria-label={
                      (plot.pointStyle ?? "filled") === "filled"
                        ? `Show data plot ${index + 1} points as rings`
                        : `Fill data plot ${index + 1} points`
                    }
                    onClick={() =>
                      updateDataPlotPointStyle(
                        plot.id,
                        (plot.pointStyle ?? "filled") === "filled" ? "ring" : "filled"
                      )
                    }
                    title={(plot.pointStyle ?? "filled") === "filled" ? "Filled points" : "Ring points"}
                    type="button"
                  >
                    {(plot.pointStyle ?? "filled") === "filled" ? "fill" : "ring"}
                  </button>
                  <button
                    aria-label={
                      plot.style === "scatter-line"
                        ? `Disconnect data plot ${index + 1}`
                        : `Connect data plot ${index + 1}`
                    }
                    onClick={() => {
                      pushHistory();
                      setDataPlots((current) =>
                        current.map((item) =>
                          item.id === plot.id
                            ? {
                                ...item,
                                style:
                                  item.style === "scatter-line"
                                    ? "scatter"
                                    : "scatter-line",
                              }
                            : item
                        )
                      );
                    }}
                    type="button"
                  >
                    {plot.style === "scatter-line" ? "un" : "ln"}
                  </button>
                  <button
                    aria-label={`Delete data plot ${index + 1}`}
                    onClick={() => {
                      pushHistory();
                      setDataPlots((current) =>
                        current.filter((item) => item.id !== plot.id)
                      );
                    }}
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="control-section">
          <h2>Equations</h2>
          <div className="formula-add-row">
            <select
              aria-label="Formula object type"
              onChange={(event) =>
                setFormulaObjectKind(event.target.value as FormulaObjectKind)
              }
              value={formulaObjectKind}
            >
              {FORMULA_OBJECT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {getFormulaDefinition(kind).name}
                </option>
              ))}
            </select>
            <button onClick={() => addFormulaObject()} type="button">
              Add formula object
            </button>
          </div>
          <div className="formula-card-list">
            {isFormulaPanelEmpty ? (
              <p className="empty-state">
                Draw or add an object to control its formula and variables.
              </p>
            ) : (
              <>
                {lines.map(renderLineFormulaCard)}
                {curves.map(renderCurveFormulaCard)}
                {shapes.map(renderShapeFormulaCard)}
                {formulaObjects.map(renderFormulaObjectCard)}
                {measures.map(renderMeasureFormulaCard)}
              </>
            )}
          </div>
        </section>

        <section className="control-section point-list-section">
          <h2>Points</h2>
          <div className="point-list">
            {points.length === 0 ? (
              <p className="empty-state">Click the graph to add points.</p>
            ) : (
              points.map((point, index) => (
                <div className="point-row editable" key={point.id}>
                  <div className="point-row-head">
                    <span>{getPointLabel(point, index)}</span>
                    <input
                      aria-label={`Change point ${index + 1} color`}
                      className="row-color-input"
                      onChange={(event) =>
                        updatePointDetails(point.id, { color: event.target.value })
                      }
                      onClick={(event) => event.stopPropagation()}
                      type="color"
                      value={point.color ?? "#d94f30"}
                    />
                    <button
                      aria-label={
                        point.showLabel === false
                          ? `Show point ${index + 1} label`
                          : `Hide point ${index + 1} label`
                      }
                      className={
                        point.showLabel === false
                          ? "equation-label-toggle"
                          : "equation-label-toggle active"
                      }
                      onClick={() =>
                        updatePointDetails(point.id, {
                          showLabel: point.showLabel === false,
                        })
                      }
                      title={point.showLabel === false ? "Show label" : "Hide label"}
                      type="button"
                    >
                      {point.showLabel === false ? "+" : "-"}
                    </button>
                    <button
                      aria-label={`Delete point ${index + 1}`}
                      onClick={() => {
                        pushHistory();
                        setPoints((current) =>
                          current.filter((item) => item.id !== point.id)
                        );
                      }}
                      type="button"
                    >
                      x
                    </button>
                  </div>
                  <label>
                    <span>Label</span>
                    <input
                      onChange={(event) =>
                        updatePointDetails(point.id, { label: event.target.value })
                      }
                      placeholder={`P${index + 1}`}
                      type="text"
                      value={point.label ?? ""}
                    />
                  </label>
                  <div className="point-coordinate-grid">
                    <label>
                      <span>x</span>
                      <input
                        onChange={(event) =>
                          updatePointDetails(point.id, {
                            x: Number(event.target.value),
                          })
                        }
                        step="any"
                        type="number"
                        value={formatNumber(point.x)}
                      />
                    </label>
                    <label>
                      <span>y</span>
                      <input
                        onChange={(event) =>
                          updatePointDetails(point.id, {
                            y: Number(event.target.value),
                          })
                        }
                        step="any"
                        type="number"
                        value={formatNumber(point.y)}
                      />
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>

      <div
        aria-label="Resize control panel"
        className="sidebar-resizer"
        onMouseDown={() => setIsResizingSidebar(true)}
        role="separator"
      >
        <button
          aria-label={isSidebarCollapsed ? "Expand control panel" : "Collapse control panel"}
          className="collapse-sidebar-button"
          onClick={(event) => {
            event.stopPropagation();
            setIsSidebarCollapsed((current) => !current);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          type="button"
        >
          {isSidebarCollapsed ? ">" : "<"}
        </button>
      </div>

      <section className={comparisonPage ? "workspace split-pages" : "workspace"}>
        <div className="page-strip">
          <div className="page-tabs" role="tablist" aria-label="Graph pages">
            {pages.map((page) => (
              <button
                aria-selected={page.id === activePageId}
                className={page.id === activePageId ? "active" : ""}
                key={page.id}
                onClick={() => switchGraphPage(page.id)}
                role="tab"
                type="button"
              >
                {page.name}
              </button>
            ))}
            <button className="page-add-button" onClick={addGraphPage} type="button">
              +
            </button>
          </div>
          <div className="page-strip-actions">
            <label>
              <span>Side by side</span>
              <select
                onChange={(event) => {
                  saveActiveGraphPage();
                  setComparisonPageId(event.target.value);
                }}
                value={comparisonPageId}
              >
                <option value="">Off</option>
                {pages
                  .filter((page) => page.id !== activePageId)
                  .map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
              </select>
            </label>
            <button onClick={createPageSnapshot} type="button">
              Snapshot {activeGraphPage.snapshots.length}/3
            </button>
            <select
              aria-label="Page snapshots"
              onChange={(event) => setSelectedPageSnapshotId(event.target.value)}
              value={selectedPageSnapshotId}
            >
              <option value="">Previous snapshots</option>
              {activeGraphPage.snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {new Date(snapshot.savedAt).toLocaleTimeString()}
                </option>
              ))}
            </select>
            <button disabled={!selectedPageSnapshot} onClick={restorePageSnapshot} type="button">
              Revert
            </button>
            <button disabled={!selectedPageSnapshot} onClick={deletePageSnapshot} type="button">
              x
            </button>
          </div>
        </div>
        <div className="topbar">
          <div className="topbar-main">
            <div>
              <strong>
                {workspaceMode === "surface" ? "3D Surface mode" : getToolTitle(tool)}
              </strong>
              <span>
                {workspaceMode === "surface"
                  ? "Visualize z = f(x, y). Right-drag to spin, two-finger scroll to roam, and pinch or wheel to zoom."
                  : getToolHelp(tool, draftPoints.length)}
              </span>
            </div>
            <button
              className="mode-switch-button"
              onClick={() =>
                switchWorkspaceMode(workspaceMode === "surface" ? "2d" : "surface")
              }
              type="button"
            >
              {workspaceMode === "surface" ? "Go 2D Graph mode" : "Go 3D Surface mode"}
            </button>
          </div>
          {workspaceMode === "2d" ? (
            <code>
              x: {cursor ? cursor.x : 0}, y: {cursor ? cursor.y : 0}
            </code>
          ) : (
            <code>z = f(x, y)</code>
          )}
        </div>
        <div className="canvas-wrap" ref={wrapperRef}>
          {workspaceMode === "surface" ? (
            <Suspense
              fallback={
                <div className="surface-loading">
                  Loading 3D surface...
                </div>
              }
            >
              <Surface3DViewer
                color={surfaceColor}
                cutX={surfaceCutX}
                cutY={surfaceCutY}
                cutZ={surfaceCutZ}
                dataPoints={surfaceDataPoints}
                equation={surfaceEquation}
                mouseSensitivity={mouseSensitivity}
                onAddDataPoint={(point, color) =>
                  setSurfaceDataPoints((current) => [
                    ...current,
                    {
                      ...point,
                      color,
                      id: nextSurfaceDataPointId.current++,
                    },
                  ])
                }
                onAddStroke={(stroke) =>
                  setSurfaceStrokes((current) => [
                    ...current,
                    { ...stroke, id: nextSurfaceStrokeId.current++ },
                  ])
                }
                onColorShape={(id, color) =>
                  setSurfaceShapes((current) =>
                    current.map((shape) =>
                      shape.id === id ? { ...shape, color } : shape
                    )
                  )
                }
                onSelectShape={setSelectedSurfaceShapeId}
                onTransformShape={updateSurfaceShapeTransform}
                paintColor={surfaceColor}
                range={surfaceRange}
                renderer={effectiveRenderer}
                resolution={surfaceResolution}
                selectedShapeId={selectedSurfaceShapeId}
                shapes={surfaceShapes}
                showContour={surfaceShowContour}
                showSlices={surfaceShowSlices}
                surfacePanelView={surfacePanelView}
                strokes={surfaceStrokes}
                tool={surfaceTool}
                zoomSensitivity={zoomSensitivity}
              />
            </Suspense>
          ) : (
            <>
              <canvas
                aria-label="Interactive graph canvas"
                className={[
                  "graph-canvas",
                  tool === "pan" ? "pan-mode" : "",
                  canvasTool !== "none" ? `canvas-${canvasTool}-mode` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onPointerDown={handlePointerDown}
                onPointerLeave={() => {
                  setCursor(null);
                  setHoverSnapPoint(null);
                }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onContextMenu={(event) => event.preventDefault()}
                onWheel={handleWheel}
                ref={canvasRef}
              />
              <CanvasToolPalette
                canvasSize={canvasSize}
                collapsed={isCanvasToolbarCollapsed}
                onCollapsedChange={setIsCanvasToolbarCollapsed}
                onPositionChange={setCanvasToolbarPosition}
                onToolChange={setCanvasTool}
                position={canvasToolbarPosition}
                selectedColor={selectedColor}
                tool={canvasTool}
              />
              {canvasTextBoxes.map((textBox) => (
                <CanvasTextBoxAnnotation
                  active={activeCanvasTextBoxId === textBox.id}
                  color={textBox.color}
                  key={`canvas-text-box-${textBox.id}`}
                  onActivate={() => setActiveCanvasTextBoxId(textBox.id)}
                  onBeginDrag={() => {
                    pushHistory();
                    setActiveCanvasTextBoxId(textBox.id);
                  }}
                  onBeginEdit={() => pushHistory()}
                  onChange={(text) =>
                    setCanvasTextBoxes((current) =>
                      current.map((item) =>
                        item.id === textBox.id ? { ...item, text } : item
                      )
                    )
                  }
                  onDelete={() => removeCanvasTextBox(textBox.id)}
                  onDrag={(clientX, clientY, grabOffset) =>
                    moveCanvasTextBox(textBox.id, clientX, clientY, grabOffset)
                  }
                  style={getCanvasPoint(textBox.position)}
                  text={textBox.text}
                />
              ))}
              {points.map((point, index) =>
                point.showLabel === false ? null : (
                  <PointGraphLabel
                    color={point.color ?? "#d94f30"}
                    key={`point-label-${point.id}`}
                    label={getPointLabel(point, index)}
                    onBeginDrag={() => pushHistory()}
                    onDrag={(clientX, clientY, grabOffset) =>
                      movePointLabel(point.id, clientX, clientY, grabOffset)
                    }
                    style={getPointLabelStyle(point)}
                  />
                )
              )}
              {lines.map((line) => {
                const target: ObjectTarget = { kind: "line", id: line.id };
                if (!shouldShowOverlay(target, line.showLabel)) return null;
                const a = getCanvasPoint(line.a);
                const b = getCanvasPoint(line.b);
                const active = isOverlayActive(target);
                return (
                  <InlineGraphLabel
                    active={active}
                    color={line.color}
                    key={`line-label-${line.id}`}
                    label={line.showLabel ? getLineLabel(line) : "Show label"}
                    onHide={() => updateLabelVisibility(target, false)}
                    onPointerDown={() => setSelectedObject(target)}
                    onShow={() => updateLabelVisibility(target, true)}
                    showLabel={line.showLabel}
                    style={getLabelStyle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })}
                  >
                    <LabelEditor
                      fallback={line.reference ? "reference line" : formatLineEquation(line)}
                      label={line.label}
                      onChange={(label) => updateObjectLabel(target, label)}
                    />
                    {line.reference ? (
                      <p className="mini-note">Drag endpoints to aim this dotted reference line.</p>
                    ) : (
                      <LineEditor
                        line={line}
                        onChange={(next) => updateLineFromEquation(line.id, next)}
                      />
                    )}
                  </InlineGraphLabel>
                );
              })}
              {curves.map((curve) => {
                const target: ObjectTarget = { kind: "curve", id: curve.id };
                if (!shouldShowOverlay(target, curve.showLabel)) return null;
                const active = isOverlayActive(target);
                return (
                  <InlineGraphLabel
                    active={active}
                    color={curve.color}
                    key={`curve-label-${curve.id}`}
                    label={curve.showLabel ? getCurveLabel(curve) : "Show label"}
                    onHide={() => updateLabelVisibility(target, false)}
                    onPointerDown={() => setSelectedObject(target)}
                    onShow={() => updateLabelVisibility(target, true)}
                    showLabel={curve.showLabel}
                    style={getLabelStyle(getCanvasPoint(curve.b))}
                  >
                    <LabelEditor
                      fallback={formatCurveEquation(curve)}
                      label={curve.label}
                      onChange={(label) => updateObjectLabel(target, label)}
                    />
                    <CurveEditor
                      curve={curve}
                      onChange={(next) => updateCurveFromEquation(curve.id, next)}
                    />
                  </InlineGraphLabel>
                );
              })}
              {shapes.map((shape) => {
                const target: ObjectTarget = { kind: "shape", id: shape.id };
                if (!shouldShowOverlay(target, shape.showLabel)) return null;
                const active = isOverlayActive(target);
                return (
                  <InlineGraphLabel
                    active={active}
                    color={shape.color}
                    key={`shape-label-${shape.id}`}
                    label={shape.showLabel ? getShapeDisplayLabel(shape) : "Show label"}
                    onHide={() => updateLabelVisibility(target, false)}
                    onPointerDown={() => setSelectedObject(target)}
                    onShow={() => updateLabelVisibility(target, true)}
                    showLabel={shape.showLabel}
                    style={getLabelStyle(
                      getCanvasPoint(getShapeLocalPoint(shape, 0.5, 0))
                    )}
                  >
                    <LabelEditor
                      fallback={formatShapeLabel(shape)}
                      label={shape.label}
                      onChange={(label) => updateObjectLabel(target, label)}
                    />
                    <ShapeEditor
                      shape={shape}
                      onChange={(next) => updateShapeSize(shape.id, next)}
                    />
                  </InlineGraphLabel>
                );
              })}
              {shapes.map((shape) => {
                const bounds = getShapeBounds(shape);
                return (
                  <ShapeAreaLabel
                    color={shape.color}
                    key={`shape-area-label-${shape.id}`}
                    label={`A = ${formatNumber(bounds.width * bounds.height)}`}
                    onBeginDrag={() => {
                      pushHistory();
                      setSelectedObject({ kind: "shape", id: shape.id });
                    }}
                    onDrag={(clientX, clientY) =>
                      moveShapeAreaLabel(shape.id, clientX, clientY)
                    }
                    style={getShapeAreaLabelStyle(shape)}
                  />
                );
              })}
              {measures.map((measure) => {
                const target: ObjectTarget = { kind: "measure", id: measure.id };
                if (!shouldShowOverlay(target, measure.showLabel)) return null;
                const active = isOverlayActive(target);
                return (
                  <InlineGraphLabel
                    active={active}
                    color={measure.color}
                    key={`measure-label-${measure.id}`}
                    label={measure.showLabel ? getMeasureDisplayLabel(measure) : "Show label"}
                    onHide={() => updateLabelVisibility(target, false)}
                    onPointerDown={() => setSelectedObject(target)}
                    onShow={() => updateLabelVisibility(target, true)}
                    showLabel={measure.showLabel}
                    onBeginLabelDrag={() => pushHistory()}
                    onLabelDrag={(clientX, clientY) =>
                      moveMeasureLabel(measure.id, clientX, clientY)
                    }
                    style={getMeasureLabelStyle(measure)}
                  >
                    <LabelEditor
                      fallback={formatMeasureLabel(measure)}
                      label={measure.label}
                      onChange={(label) => updateObjectLabel(target, label)}
                    />
                    <MeasureDetails measure={measure} />
                  </InlineGraphLabel>
                );
              })}
            </>
          )}
        </div>
        {comparisonPage ? (
          <GraphPagePreview
            onEdit={() => switchGraphPage(comparisonPage.id)}
            page={comparisonPage}
          />
        ) : null}
      </section>
      <ScientificCalculator
        context={calculatorContext}
        onCorrelationGuideChange={setCorrelationGuide}
        onGuideChange={setCalculatorGuide}
        onMeanPointChange={setCalculatorMeanPoint}
      />
    </main>
  );
};

const GraphPagePreview = ({
  onEdit,
  page,
}: {
  onEdit: () => void;
  page: GraphPage;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = page.state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || state.workspaceMode !== "2d") return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = getCanvasDpr();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      drawGraph(canvas, state.view, {
        points: state.points,
        lines: state.lines,
        curves: state.curves,
        shapes: state.shapes,
        formulaObjects: state.formulaObjects ?? [],
        measures: state.measures,
        dataPlots: state.dataPlots,
        canvasStrokes: state.canvasStrokes ?? [],
        hoverSnapPoint: null,
        calculatorGuide: null,
        calculatorMeanPoint: null,
        correlationGuide: null,
        draftPoints: [],
        cursor: null,
        connectPoints: false,
        selectedColor: state.selectedColor,
        tool: "pan",
        selectedObject: null,
        lockedGroupTargets: [],
        isGroupLocked: false,
        showLeastSquares: false,
        leastSquares: null,
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [state]);

  return (
    <aside className="page-preview-pane" aria-label={`${page.name} preview`}>
      <header>
        <div>
          <strong>{page.name}</strong>
          <span>{page.snapshots.length}/3 snapshots</span>
        </div>
        <button onClick={onEdit} type="button">
          Edit page
        </button>
      </header>
      {state.workspaceMode === "2d" ? (
        <canvas aria-label={`${page.name} graph preview`} ref={canvasRef} />
      ) : (
        <div className="page-preview-surface">
          <strong>3D surface page</strong>
          <span>{state.surface.shapes.length} surface object(s)</span>
          <button onClick={onEdit} type="button">
            Open 3D page
          </button>
        </div>
      )}
    </aside>
  );
};

const getLabelStep = (pixelsPerUnit: number) => {
  const targetPixels = 44;
  return Math.max(SUBGRID_STEP, niceStep(targetPixels / pixelsPerUnit));
};

const getGridStroke = (index: number) => {
  if (index % 20 === 0) return "#777777";
  if (index % 4 === 0) return "#9a9a9a";
  if (index % 2 === 0) return "#b8b8b8";
  return "#dedede";
};

const getPointLabel = (point: GraphPoint, index: number) =>
  point.label?.trim() || `P${index + 1}`;

const getLineLabel = (line: GraphLine) =>
  line.label?.trim() || (line.reference ? "reference line" : formatLineEquation(line));

const getCurveLabel = (curve: GraphCurve) =>
  curve.label?.trim() || formatCurveEquation(curve);

const getShapeDisplayLabel = (shape: GraphShape) =>
  shape.label?.trim() || formatShapeLabel(shape);

const getMeasureDisplayLabel = (measure: GraphMeasure) =>
  measure.label?.trim() || formatMeasureLabel(measure);

const hexToRgb = (hex: string) => {
  const fallback = { r: 40, g: 102, b: 110 };
  const normalized = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return fallback;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((channel) =>
      clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0")
    )
    .join("")}`;

const rgbToHsv = (r: number, g: number, b: number) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }

  return {
    h: Math.round((h + 360) % 360),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
};

const hsvToRgb = (h: number, s: number, v: number) => {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (h < 60) [red, green, blue] = [chroma, x, 0];
  else if (h < 120) [red, green, blue] = [x, chroma, 0];
  else if (h < 180) [red, green, blue] = [0, chroma, x];
  else if (h < 240) [red, green, blue] = [0, x, chroma];
  else if (h < 300) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return {
    r: Math.round((red + m) * 255),
    g: Math.round((green + m) * 255),
    b: Math.round((blue + m) * 255),
  };
};

const InlineGraphLabel = ({
  active,
  children,
  color,
  label,
  onBeginLabelDrag,
  onHide,
  onLabelDrag,
  onPointerDown,
  onShow,
  showLabel,
  style,
}: {
  active: boolean;
  children: ReactNode;
  color: string;
  label: string;
  onBeginLabelDrag?: () => void;
  onHide: () => void;
  onLabelDrag?: (clientX: number, clientY: number) => void;
  onPointerDown: () => void;
  onShow: () => void;
  showLabel: boolean;
  style: { left: number; top: number };
}) => {
  const dragRef = useRef<{ pointerId: number; moved: boolean } | null>(null);

  return (
    <div
      className={active ? "inline-graph-label active" : "inline-graph-label"}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown();
        if (!showLabel) onShow();

        const target = event.target as HTMLElement;
        if (
          !onLabelDrag ||
          target.closest("button, input, select, textarea, .inline-label-editor")
        ) {
          return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, moved: false };
        onBeginLabelDrag?.();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !onLabelDrag) return;
        drag.moved = true;
        onLabelDrag(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      style={{
        ...style,
        borderColor: color,
        color,
      }}
    >
      <div className={onLabelDrag ? "inline-label-main draggable" : "inline-label-main"}>
        <button
          aria-label={showLabel ? "Hide label" : "Show label"}
          className="inline-label-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (showLabel) onHide();
            else onShow();
          }}
          type="button"
        >
          {showLabel ? "x" : "+"}
        </button>
        <span>{label}</span>
      </div>
      {active && showLabel ? <div className="inline-label-editor">{children}</div> : null}
    </div>
  );
};

const PointGraphLabel = ({
  color,
  label,
  onBeginDrag,
  onDrag,
  style,
}: {
  color: string;
  label: string;
  onBeginDrag: () => void;
  onDrag: (clientX: number, clientY: number, grabOffset: { x: number; y: number }) => void;
  style: { left: number; top: number };
}) => {
  const dragRef = useRef<{
    pointerId: number;
    grabOffset: { x: number; y: number };
  } | null>(null);

  return (
    <div
      className="point-graph-label"
      onPointerDown={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          grabOffset: {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          },
        };
        onBeginDrag();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onDrag(event.clientX, event.clientY, drag.grabOffset);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      style={{
        ...style,
        borderColor: color,
        color,
      }}
    >
      {label}
    </div>
  );
};

const ShapeAreaLabel = ({
  color,
  label,
  onBeginDrag,
  onDrag,
  style,
}: {
  color: string;
  label: string;
  onBeginDrag: () => void;
  onDrag: (clientX: number, clientY: number) => void;
  style: { left: number; top: number };
}) => {
  const dragRef = useRef<number | null>(null);

  return (
    <div
      className="shape-area-label"
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = event.pointerId;
        onBeginDrag();
      }}
      onPointerMove={(event) => {
        if (dragRef.current !== event.pointerId) return;
        onDrag(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (dragRef.current !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      style={{
        ...style,
        borderColor: color,
        color,
      }}
    >
      {label}
    </div>
  );
};

const LabelEditor = ({
  fallback,
  label,
  onChange,
}: {
  fallback: string;
  label?: string;
  onChange: (label: string) => void;
}) => (
  <label className="mini-field full">
    <span>label</span>
    <input
      onChange={(event) => onChange(event.target.value)}
      placeholder={fallback}
      type="text"
      value={label ?? ""}
    />
  </label>
);

const CanvasTextBoxAnnotation = ({
  active,
  color,
  onActivate,
  onBeginDrag,
  onBeginEdit,
  onChange,
  onDelete,
  onDrag,
  style,
  text,
}: {
  active: boolean;
  color: string;
  onActivate: () => void;
  onBeginDrag: () => void;
  onBeginEdit: () => void;
  onChange: (text: string) => void;
  onDelete: () => void;
  onDrag: (clientX: number, clientY: number, grabOffset: { x: number; y: number }) => void;
  style: { x: number; y: number };
  text: string;
}) => {
  const dragRef = useRef<{
    pointerId: number;
    grabOffset: { x: number; y: number };
  } | null>(null);
  const editingRef = useRef(false);

  return (
    <div
      className={active ? "canvas-text-box active" : "canvas-text-box"}
      onPointerDown={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      style={{ left: style.x, top: style.y, borderColor: color }}
    >
      <div
        className="canvas-text-box-title"
        onPointerDown={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!box) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            grabOffset: {
              x: event.clientX - box.left,
              y: event.clientY - box.top,
            },
          };
          onBeginDrag();
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          onDrag(event.clientX, event.clientY, drag.grabOffset);
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <span>::</span>
      </div>
      <input
        aria-label="Canvas text label"
        autoFocus={active && text.length === 0}
        onBlur={() => {
          editingRef.current = false;
        }}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          onActivate();
          if (editingRef.current) return;
          editingRef.current = true;
          onBeginEdit();
        }}
        placeholder="Label"
        size={Math.max(5, Math.min(24, text.length || 5))}
        type="text"
        value={text}
      />
      <button
        aria-label="Delete text label"
        className="canvas-text-box-delete"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        type="button"
      >
        x
      </button>
    </div>
  );
};

const CanvasToolPalette = ({
  canvasSize,
  collapsed,
  onCollapsedChange,
  onPositionChange,
  onToolChange,
  position,
  selectedColor,
  tool,
}: {
  canvasSize: { width: number; height: number };
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onPositionChange: (position: CanvasToolbarPosition) => void;
  onToolChange: (tool: CanvasTool) => void;
  position: CanvasToolbarPosition;
  selectedColor: string;
  tool: CanvasTool;
}) => {
  const toolbarDragRef = useRef<CanvasToolbarDrag | null>(null);

  const moveToolbar = (event: PointerEvent<HTMLDivElement>) => {
    const drag = toolbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    const toolbarWidth = collapsed ? 52 : 214;
    const toolbarHeight = collapsed ? 52 : 164;
    onPositionChange({
      x: clamp(drag.startLeft + dx, 8, Math.max(8, canvasSize.width - toolbarWidth - 8)),
      y: clamp(drag.startTop + dy, 8, Math.max(8, canvasSize.height - toolbarHeight - 8)),
    });
  };

  const finishToolbarDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = toolbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    toolbarDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (collapsed && !drag.moved) {
      onCollapsedChange(false);
    }
  };

  return (
    <div
      className={collapsed ? "canvas-tool-palette collapsed" : "canvas-tool-palette"}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("[data-canvas-toolbar-drag]")) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        toolbarDragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: position.x,
          startTop: position.y,
          moved: false,
        };
      }}
      onPointerMove={moveToolbar}
      onPointerUp={finishToolbarDrag}
      style={{
        left: position.x,
        top: position.y,
        "--canvas-tool-color": selectedColor,
      } as CSSProperties}
    >
      {collapsed ? (
        <button
          aria-label="Open canvas tools"
          className="canvas-tool-orb"
          data-canvas-toolbar-drag
          onClick={() => onCollapsedChange(false)}
          type="button"
        >
          P
        </button>
      ) : (
        <>
          <div className="canvas-tool-title" data-canvas-toolbar-drag>
            <span>Canvas</span>
            <button
              aria-label="Collapse canvas tools"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onCollapsedChange(true)}
              type="button"
            >
              -
            </button>
          </div>
          <div className="canvas-tool-buttons">
            {([
              ["pencil", "Pencil"],
              ["marker", "Thin marker"],
              ["eraser", "Eraser"],
              ["text", "Text box"],
              ["none", "Off"],
            ] as Array<[CanvasTool, string]>).map(([value, label]) => (
              <button
                className={tool === value ? "active" : ""}
                key={value}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onToolChange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

type FormulaCardVariable = {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
};

type FormulaCardComputedValue = {
  label: string;
  value: string;
};

const FormulaObjectCard = ({
  color,
  computed,
  expanded,
  formula,
  isSelected,
  name,
  onColorChange,
  onDelete,
  onLabelToggle,
  onSelect,
  onToggleExpanded,
  onVariableChange,
  showLabel,
  variables,
}: {
  color: string;
  computed: FormulaCardComputedValue[];
  expanded: boolean;
  formula: string;
  isSelected: boolean;
  name: string;
  onColorChange: (color: string) => void;
  onDelete: () => void;
  onLabelToggle: () => void;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onVariableChange: (key: string, value: number) => void;
  showLabel: boolean;
  variables: FormulaCardVariable[];
}) => (
  <article className={isSelected ? "formula-card selected" : "formula-card"}>
    <button className="formula-card-head" onClick={onSelect} type="button">
      <span className="formula-card-title">{name}</span>
      <code>{formula}</code>
    </button>
    <div className="formula-card-actions">
      <input
        aria-label={`Change ${name} color`}
        className="row-color-input"
        onChange={(event) => onColorChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        type="color"
        value={color}
      />
      <button
        className={showLabel ? "equation-label-toggle active" : "equation-label-toggle"}
        onClick={onLabelToggle}
        title={showLabel ? "Hide label" : "Show label"}
        type="button"
      >
        {showLabel ? "-" : "+"}
      </button>
      <button onClick={onToggleExpanded} type="button">
        {expanded ? "collapse" : "expand"}
      </button>
      <button onClick={onDelete} type="button">
        x
      </button>
    </div>
    {expanded ? (
      <div className="formula-card-body">
        {variables.map((variable) => (
          <label className="formula-variable" key={variable.key}>
            <span>{variable.label}</span>
            <input
              max={variable.max}
              min={variable.min}
              onChange={(event) =>
                onVariableChange(variable.key, Number(event.target.value))
              }
              step={variable.step}
              type="range"
              value={variable.value}
            />
            <input
              onChange={(event) =>
                onVariableChange(variable.key, Number(event.target.value))
              }
              step="any"
              type="number"
              value={formatNumber(variable.value)}
            />
          </label>
        ))}
        <div className="formula-computed-grid">
          {computed.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    ) : null}
  </article>
);

const LineEditor = ({
  line,
  onChange,
}: {
  line: GraphLine;
  onChange: (next: { m?: number; b?: number; x?: number }) => void;
}) => {
  const parts = getLineParts(line);
  if (parts.vertical) {
    return (
      <label className="mini-field">
        <span>x</span>
        <input
          onChange={(event) => onChange({ x: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(parts.x)}
        />
      </label>
    );
  }

  return (
    <div className="mini-grid">
      <label className="mini-field">
        <span>m</span>
        <input
          onChange={(event) => onChange({ m: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(parts.m)}
        />
      </label>
      <label className="mini-field">
        <span>b</span>
        <input
          onChange={(event) => onChange({ b: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(parts.b)}
        />
      </label>
    </div>
  );
};

const CurveEditor = ({
  curve,
  onChange,
}: {
  curve: GraphCurve;
  onChange: (next: { a?: number; b?: number; c?: number }) => void;
}) => {
  const coefficients = getQuadraticCoefficients(curve);
  if (!coefficients) {
    return <p className="mini-note">Use 3 different x-values to edit equation.</p>;
  }

  return (
    <div className="mini-grid three">
      <label className="mini-field">
        <span>a</span>
        <input
          onChange={(event) => onChange({ a: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(coefficients.a)}
        />
      </label>
      <label className="mini-field">
        <span>b</span>
        <input
          onChange={(event) => onChange({ b: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(coefficients.b)}
        />
      </label>
      <label className="mini-field">
        <span>c</span>
        <input
          onChange={(event) => onChange({ c: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(coefficients.c)}
        />
      </label>
    </div>
  );
};

const ShapeEditor = ({
  shape,
  onChange,
}: {
  shape: GraphShape;
  onChange: (next: { width?: number; height?: number; side?: number }) => void;
}) => {
  const bounds = getShapeBounds(shape);
  if (shape.type === "square") {
    return (
      <label className="mini-field">
        <span>side</span>
        <input
          min="0.1"
          onChange={(event) => onChange({ side: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(bounds.width)}
        />
      </label>
    );
  }

  return (
    <div className="mini-grid">
      <label className="mini-field">
        <span>w</span>
        <input
          min="0.1"
          onChange={(event) => onChange({ width: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(bounds.width)}
        />
      </label>
      <label className="mini-field">
        <span>h</span>
        <input
          min="0.1"
          onChange={(event) => onChange({ height: Number(event.target.value) })}
          step="any"
          type="number"
          value={formatNumber(bounds.height)}
        />
      </label>
    </div>
  );
};

const MeasureDetails = ({ measure }: { measure: GraphMeasure }) => (
  <div className="mini-grid">
    <p className="mini-note">
      from ({formatNumber(measure.a.x)}, {formatNumber(measure.a.y)})
    </p>
    <p className="mini-note">
      to ({formatNumber(measure.b.x)}, {formatNumber(measure.b.y)})
    </p>
  </div>
);

const getGroupTargetIdentity = (target: GroupTarget) =>
  target.kind === "data"
    ? `${target.kind}:${target.id}:${target.pointIndex}`
    : `${target.kind}:${target.id}`;

const isGraphGroupTargetSelected = (
  targets: GroupTarget[],
  target: GroupTarget
) =>
  targets.some(
    (selected) => getGroupTargetIdentity(selected) === getGroupTargetIdentity(target)
  );

const drawGroupSelectionRing = (
  context: CanvasRenderingContext2D,
  screen: { x: number; y: number },
  isLocked: boolean
) => {
  context.save();
  context.beginPath();
  context.strokeStyle = isLocked ? "#39ff14" : "#31a8ff";
  context.lineWidth = 2.6;
  context.setLineDash([4, 3]);
  context.arc(screen.x, screen.y, 10, 0, Math.PI * 2);
  context.stroke();
  context.restore();
};

const drawGraph = (
  canvas: HTMLCanvasElement,
  view: ViewState,
  graph: {
    points: GraphPoint[];
    lines: GraphLine[];
    curves: GraphCurve[];
    shapes: GraphShape[];
    formulaObjects: GraphFormulaObject[];
    measures: GraphMeasure[];
    dataPlots: DataPlot[];
    canvasStrokes: CanvasStroke[];
    hoverSnapPoint: HoverSnapPoint | null;
    calculatorGuide: CalculatorGuide | null;
    calculatorMeanPoint: CalculatorMeanPoint | null;
    correlationGuide: CorrelationGuide | null;
    draftPoints: GraphPoint[];
    cursor: GraphPoint | null;
    connectPoints: boolean;
    selectedColor: string;
    tool: Tool;
    selectedObject: ObjectTarget | null;
    lockedGroupTargets: GroupTarget[];
    isGroupLocked: boolean;
    showLeastSquares: boolean;
    leastSquares: LeastSquaresSummary | null;
  }
) => {
  const context = canvas.getContext("2d");
  if (!context) return;

  const dpr = getCanvasDpr();
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const originX = width / 2 + view.offsetX;
  const originY = height / 2 + view.offsetY;
  const gridStep = SUBGRID_STEP;
  const labelStep = getLabelStep(view.pixelsPerUnit);

  const minX = -originX / view.pixelsPerUnit;
  const maxX = (width - originX) / view.pixelsPerUnit;
  const minY = -(height - originY) / view.pixelsPerUnit;
  const maxY = originY / view.pixelsPerUnit;

  context.lineWidth = 1;
  context.font = "12px Inter, system-ui, sans-serif";
  context.textBaseline = "top";

  const startXIndex = Math.floor(minX / gridStep);
  const endXIndex = Math.ceil(maxX / gridStep);
  const startYIndex = Math.floor(minY / gridStep);
  const endYIndex = Math.ceil(maxY / gridStep);
  const startLabelX = Math.floor(minX / labelStep) * labelStep;
  const endLabelX = Math.ceil(maxX / labelStep) * labelStep;
  const startLabelY = Math.floor(minY / labelStep) * labelStep;
  const endLabelY = Math.ceil(maxY / labelStep) * labelStep;
  const toScreen = (point: GraphPoint) => ({
    x: originX + point.x * view.pixelsPerUnit,
    y: originY - point.y * view.pixelsPerUnit,
  });

  for (let index = startXIndex; index <= endXIndex; index += 1) {
    const x = index * gridStep;
    const screenX = crispLine(originX + x * view.pixelsPerUnit);
    context.beginPath();
    context.strokeStyle = getGridStroke(index);
    context.moveTo(screenX, 0);
    context.lineTo(screenX, height);
    context.stroke();
  }

  for (let index = startYIndex; index <= endYIndex; index += 1) {
    const y = index * gridStep;
    const screenY = crispLine(originY - y * view.pixelsPerUnit);
    context.beginPath();
    context.strokeStyle = getGridStroke(index);
    context.moveTo(0, screenY);
    context.lineTo(width, screenY);
    context.stroke();
  }

  context.strokeStyle = "#24211e";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, Math.round(originY));
  context.lineTo(width, Math.round(originY));
  context.moveTo(Math.round(originX), 0);
  context.lineTo(Math.round(originX), height);
  context.stroke();

  context.fillStyle = "#4a433d";
  for (let x = startLabelX; x <= endLabelX; x += labelStep) {
    if (Math.abs(x) < 0.000001) continue;
    const screenX = originX + x * view.pixelsPerUnit;
    context.fillText(formatTick(x), screenX + 4, originY + 6);
  }

  for (let y = startLabelY; y <= endLabelY; y += labelStep) {
    if (Math.abs(y) < 0.000001) continue;
    const screenY = originY - y * view.pixelsPerUnit;
    context.fillText(formatTick(y), originX + 6, screenY + 4);
  }

  context.fillStyle = "#24211e";
  context.fillText("0", originX + 6, originY + 6);

  if (graph.calculatorGuide) {
    drawCalculatorGuide(context, graph.calculatorGuide, width, height, toScreen);
  }

  if (graph.correlationGuide) {
    drawCorrelationGuide(context, graph.correlationGuide, width, height, toScreen);
  }

  if (graph.calculatorMeanPoint) {
    drawCalculatorMeanPoint(context, graph.calculatorMeanPoint, width, height, toScreen);
  }

  if (graph.showLeastSquares && graph.leastSquares) {
    drawLeastSquaresSquares(
      context,
      graph.leastSquares,
      toScreen,
      width,
      height
    );
  }

  graph.formulaObjects.forEach((object) => {
    const isSelected =
      isSelectedObject(graph.selectedObject, "formula", object.id) ||
      isGraphGroupTargetSelected(graph.lockedGroupTargets, {
        kind: "formula",
        id: object.id,
      });
    drawFormulaObject(context, object, toScreen, minX, maxX, isSelected);
  });

  graph.shapes.forEach((shape, index) => {
    const isSelected =
      isSelectedObject(graph.selectedObject, "shape", shape.id) ||
      isGraphGroupTargetSelected(graph.lockedGroupTargets, { kind: "shape", id: shape.id });
    drawShape(context, shape, toScreen, shape.color);
    if (isSelected) {
      drawShapeSelection(context, shape, toScreen);
    }
    getShapeCornerList(shape).forEach((point, handleIndex) => {
      drawHandle(context, toScreen(point), shape.color);
      context.fillStyle = "#24211e";
      context.fillText(`S${index + 1}.${handleIndex + 1}`, toScreen(point).x + 9, toScreen(point).y - 18);
    });
  });

  graph.curves.forEach((curve, index) => {
    const coefficients = getQuadraticCoefficients(curve);
    const isSelected =
      isSelectedObject(graph.selectedObject, "curve", curve.id) ||
      isGraphGroupTargetSelected(graph.lockedGroupTargets, { kind: "curve", id: curve.id });
    if (coefficients) {
      if (isSelected) {
        context.strokeStyle = "rgba(36, 33, 30, 0.28)";
        context.lineWidth = 7;
        context.beginPath();
        const sampleCount = Math.max(80, Math.round(width / 10));
        for (let i = 0; i <= sampleCount; i += 1) {
          const x = minX + ((maxX - minX) * i) / sampleCount;
          const y = coefficients.a * x ** 2 + coefficients.b * x + coefficients.c;
          const screen = toScreen({ id: 0, x, y });
          if (i === 0) context.moveTo(screen.x, screen.y);
          else context.lineTo(screen.x, screen.y);
        }
        context.stroke();
      }
      context.strokeStyle = curve.color;
      context.lineWidth = 2.5;
      context.beginPath();
      const sampleCount = Math.max(80, Math.round(width / 10));
      for (let i = 0; i <= sampleCount; i += 1) {
        const x = minX + ((maxX - minX) * i) / sampleCount;
        const y = coefficients.a * x ** 2 + coefficients.b * x + coefficients.c;
        const screen = toScreen({ id: 0, x, y });
        if (i === 0) context.moveTo(screen.x, screen.y);
        else context.lineTo(screen.x, screen.y);
      }
      context.stroke();
    }

    [curve.a, curve.b, curve.c].forEach((point, handleIndex) => {
      drawHandle(context, toScreen(point), curve.color);
      context.fillStyle = "#24211e";
      context.fillText(`C${index + 1}.${handleIndex + 1}`, toScreen(point).x + 9, toScreen(point).y - 18);
    });
  });

  graph.lines.forEach((line, index) => {
    const isSelected =
      isSelectedObject(graph.selectedObject, "line", line.id) ||
      isGraphGroupTargetSelected(graph.lockedGroupTargets, { kind: "line", id: line.id });
    const drawVisibleLine = () => {
      if (line.reference) {
        const a = toScreen(line.a);
        const b = toScreen(line.b);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        return;
      }

      const parts = getLineParts(line);
      context.beginPath();
      if (parts.vertical) {
        const screenX = originX + parts.x * view.pixelsPerUnit;
        context.moveTo(screenX, 0);
        context.lineTo(screenX, height);
      } else {
        const yLeft = parts.m * minX + parts.b;
        const yRight = parts.m * maxX + parts.b;
        const left = toScreen({ id: 0, x: minX, y: yLeft });
        const right = toScreen({ id: 0, x: maxX, y: yRight });
        context.moveTo(left.x, left.y);
        context.lineTo(right.x, right.y);
      }
      context.stroke();
    };

    if (isSelected) {
      context.strokeStyle = "rgba(36, 33, 30, 0.28)";
      context.lineWidth = 7;
      if (line.reference) context.setLineDash([5, 6]);
      drawVisibleLine();
      context.setLineDash([]);
    }

    context.strokeStyle = line.color;
    context.lineWidth = 2.5;
    if (line.reference) context.setLineDash([4, 6]);
    drawVisibleLine();
    context.setLineDash([]);

    [line.a, line.b].forEach((point, handleIndex) => {
      drawHandle(context, toScreen(point), line.color);
      context.fillStyle = "#24211e";
      context.fillText(`L${index + 1}.${handleIndex + 1}`, toScreen(point).x + 9, toScreen(point).y - 18);
    });
  });

  graph.dataPlots.forEach((plot) => {
    drawDataPlot(context, plot, toScreen);
    plot.values.forEach((value, pointIndex) => {
      if (
        isGraphGroupTargetSelected(graph.lockedGroupTargets, {
          kind: "data",
          id: plot.id,
          pointIndex,
        })
      ) {
        drawGroupSelectionRing(
          context,
          toScreen({ id: 0, x: value.x, y: value.y }),
          graph.isGroupLocked
        );
      }
    });
  });

  if (graph.hoverSnapPoint) {
    const screen = toScreen(graph.hoverSnapPoint.point);
    context.save();
    context.beginPath();
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#d94f30";
    context.lineWidth = 2.4;
    context.arc(screen.x, screen.y, 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.strokeStyle = "rgba(217, 79, 48, 0.45)";
    context.lineWidth = 1.5;
    context.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  graph.measures.forEach((measure, index) => {
    const isSelected =
      isSelectedObject(graph.selectedObject, "measure", measure.id) ||
      isGraphGroupTargetSelected(graph.lockedGroupTargets, { kind: "measure", id: measure.id });
    drawDistanceMeasureLine(context, measure, toScreen, {
      index,
      isSelected,
      showEndpointLabels: measure.showEndpointLabels ?? true,
    });
  });

  if (graph.draftPoints.length > 0) {
    const draftColor = graph.selectedColor;
    context.strokeStyle = draftColor;
    context.setLineDash([6, 6]);
    context.lineWidth = 2;

    if (
      graph.draftPoints.length >= 2 &&
      (graph.tool === "rectangle" || graph.tool === "square")
    ) {
      drawShape(
        context,
        {
          id: 0,
          type: graph.tool,
          a: graph.draftPoints[0],
          b: graph.draftPoints[1],
          color: draftColor,
          showLabel: true,
        },
        toScreen,
        draftColor
      );
    } else {
      context.beginPath();
      graph.draftPoints.forEach((point, index) => {
        const screen = toScreen(point);
        if (index === 0) context.moveTo(screen.x, screen.y);
        else context.lineTo(screen.x, screen.y);
      });
      if (graph.cursor) {
        const screen = toScreen(graph.cursor);
        if (graph.draftPoints.length === 0) context.moveTo(screen.x, screen.y);
        else context.lineTo(screen.x, screen.y);
      }
      context.stroke();
    }
    context.setLineDash([]);
    graph.draftPoints.forEach((point) => drawHandle(context, toScreen(point), draftColor));
  }

  if (graph.connectPoints && graph.points.length > 1) {
    context.strokeStyle = "#28666e";
    context.lineWidth = 2.5;
    context.beginPath();
    graph.points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.stroke();
  }

  graph.points.forEach((point, index) => {
    const screen = toScreen(point);
    const pointColor = point.color ?? "#d94f30";
    context.beginPath();
    context.fillStyle = pointColor;
    context.strokeStyle = pointColor;
    context.lineWidth = 2;
    context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (isGraphGroupTargetSelected(graph.lockedGroupTargets, { kind: "point", id: point.id })) {
      drawGroupSelectionRing(context, screen, graph.isGroupLocked);
    }
  });

  drawCanvasStrokes(context, graph.canvasStrokes, toScreen);

  context.fillStyle = "#24211e";
  context.font = "600 13px Inter, system-ui, sans-serif";
  context.fillText("x", width - 18, originY + 8);
  context.fillText("y", originX + 8, 12);

  context.fillStyle = "#756d63";
  context.font = "12px Inter, system-ui, sans-serif";
  context.fillText("Small square = 0.25 unit", 16, 16);
};

const formatTick = (value: number) => {
  const rounded = roundCoordinate(value);
  return `${rounded}`;
};

const collectLeastSquaresPoints = (
  points: GraphPoint[],
  dataPlots: DataPlot[]
): GraphPoint[] => [
  ...points.map((point) => ({ ...point })),
  ...dataPlots.flatMap((plot) =>
    plot.values.map((value, index) => ({
      id: index,
      x: value.x,
      y: value.y,
      color: plot.color,
    }))
  ),
];

const getLeastSquaresSummary = (
  line: GraphLine | null,
  fitPoints: GraphPoint[]
): LeastSquaresSummary | null => {
  if (!line || fitPoints.length === 0) return null;
  const parts = getLineParts(line);
  if (parts.vertical) return null;

  const residuals = fitPoints
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => {
      const fittedY = parts.m * point.x + parts.b;
      const residual = point.y - fittedY;
      return {
        point,
        fittedY,
        residual,
        squared: residual ** 2,
      };
    });

  if (residuals.length === 0) return null;
  return {
    line,
    residuals,
    sum: residuals.reduce((total, item) => total + item.squared, 0),
  };
};

const drawLeastSquaresSquares = (
  context: CanvasRenderingContext2D,
  summary: LeastSquaresSummary,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  width: number,
  height: number
) => {
  const color = summary.line.color;
  context.save();

  summary.residuals.forEach((item, index) => {
    const side = Math.abs(item.residual);
    if (side < 0.000001) return;
    const direction = item.residual >= 0 ? 1 : -1;
    const dataPoint = item.point;
    const fitPoint = { id: 0, x: dataPoint.x, y: item.fittedY };
    const fitOffset = {
      id: 0,
      x: dataPoint.x + side * direction,
      y: item.fittedY,
    };
    const dataOffset = {
      id: 0,
      x: dataPoint.x + side * direction,
      y: dataPoint.y,
    };

    const a = toScreen(dataPoint);
    const b = toScreen(fitPoint);
    const c = toScreen(fitOffset);
    const d = toScreen(dataOffset);

    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.lineTo(d.x, d.y);
    context.closePath();
    context.fillStyle = withAlpha(color, 0.12);
    context.strokeStyle = withAlpha(color, 0.62);
    context.lineWidth = 1.6;
    context.fill();
    context.stroke();

    context.beginPath();
    context.setLineDash([5, 4]);
    context.strokeStyle = withAlpha(color, 0.82);
    context.lineWidth = 1.8;
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.setLineDash([]);

    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = 2.6;
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.stroke();

    const screenSide = Math.hypot(c.x - b.x, c.y - b.y);
    const center = {
      x: (a.x + b.x + c.x + d.x) / 4,
      y: (a.y + b.y + c.y + d.y) / 4,
    };
    const label = `A=${formatNumber(item.squared)}`;
    context.font = "700 10px Inter, system-ui, sans-serif";
    const labelWidth = context.measureText(label).width;
    context.textBaseline = "middle";
    context.fillStyle = "rgba(255, 255, 255, 0.88)";
    if (screenSide > labelWidth + 8 && Math.abs(a.y - b.y) > 18) {
      roundRect(context, center.x - labelWidth / 2 - 4, center.y - 9, labelWidth + 8, 18, 4);
      context.fill();
      context.strokeStyle = withAlpha(color, 0.42);
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "#24211e";
      context.fillText(label, center.x - labelWidth / 2, center.y);
    } else if (screenSide > 18) {
      context.fillStyle = "#24211e";
      context.fillText(label, center.x - labelWidth / 2, center.y);
    }
  });

  drawLeastSquaresTag(context, summary, width, height);
  context.restore();
};

const drawLeastSquaresTag = (
  context: CanvasRenderingContext2D,
  summary: LeastSquaresSummary,
  width: number,
  height: number
) => {
  const formula = `SSE = Σ(yi - ŷi)^2 = ${formatNumber(summary.sum)}`;
  const detail = `ŷ = ${formatLineEquation(summary.line).replace("y = ", "")}`;
  context.font = "700 12px Inter, system-ui, sans-serif";
  const boxWidth = Math.max(
    context.measureText(formula).width,
    context.measureText(detail).width
  ) + 18;
  const boxHeight = 44;
  const x = clamp(width - boxWidth - 16, 12, width - boxWidth - 12);
  const y = clamp(16, 12, height - boxHeight - 12);

  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.strokeStyle = summary.line.color;
  context.lineWidth = 1.6;
  roundRect(context, x, y, boxWidth, boxHeight, 6);
  context.fill();
  context.stroke();
  context.fillStyle = "#24211e";
  context.fillText(formula, x + 9, y + 10);
  context.font = "600 11px Inter, system-ui, sans-serif";
  context.fillStyle = "#5c534b";
  context.fillText(detail, x + 9, y + 28);
};

const drawCalculatorGuide = (
  context: CanvasRenderingContext2D,
  guide: CalculatorGuide,
  width: number,
  height: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  if (guide.statistic && guide.pairs && guide.pairs.length > 0) {
    drawCalculatorStatisticGuide(context, guide, width, height, toScreen);
    return;
  }

  const y = toScreen({ id: 0, x: 0, y: guide.value }).y;
  if (y < -80 || y > height + 80) return;

  context.save();
  context.strokeStyle = "#d94f30";
  context.fillStyle = "#d94f30";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.beginPath();
  context.moveTo(0, y);
  context.lineTo(width, y);
  context.stroke();
  context.setLineDash([]);
  context.font = "700 12px Inter, system-ui, sans-serif";
  const label = guide.label.length > 42 ? `${guide.label.slice(0, 39)}...` : guide.label;
  const labelWidth = context.measureText(label).width + 14;
  const labelX = clamp(width - labelWidth - 12, 12, width - labelWidth - 12);
  const labelY = clamp(y - 26, 12, height - 28);
  context.fillStyle = "rgba(255, 255, 255, 0.95)";
  context.strokeStyle = "#d94f30";
  context.lineWidth = 1.5;
  roundRect(context, labelX, labelY, labelWidth, 22, 5);
  context.fill();
  context.stroke();
  context.fillStyle = "#7f2a18";
  context.fillText(label, labelX + 7, labelY + 5);
  context.restore();
};

const drawCalculatorStatisticGuide = (
  context: CanvasRenderingContext2D,
  guide: CalculatorGuide,
  width: number,
  height: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const pairs = guide.pairs ?? [];
  if (pairs.length === 0 || !guide.statistic) return;
  const meanX = getAverage(pairs.map((pair) => pair.x));
  const meanY = getAverage(pairs.map((pair) => pair.y));
  const meanScreen = toScreen({ id: 0, x: meanX, y: meanY });
  const highlights = new Set<StatisticHighlight>(guide.highlights ?? []);
  const showAll = highlights.size === 0;
  const has = (...values: StatisticHighlight[]) =>
    showAll || values.some((value) => highlights.has(value));
  const selectedHas = (...values: StatisticHighlight[]) =>
    values.some((value) => highlights.has(value));
  const accent =
    guide.statistic === "MEAN"
      ? "#39ff14"
      : guide.statistic === "SD"
      ? "#2f80ed"
      : guide.statistic === "VAR"
        ? "#9b51e0"
        : guide.statistic === "COVAR"
          ? "#f2994a"
          : "#00b894";

  const drawHorizontal = (value: number, dash = [8, 6], alpha = 0.78) => {
    const y = toScreen({ id: 0, x: 0, y: value }).y;
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.restore();
  };
  const drawVertical = (value: number, dash = [8, 6], alpha = 0.78) => {
    const x = toScreen({ id: 0, x: value, y: 0 }).x;
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    context.restore();
  };
  const drawVerticalDeviations = (color = accent) => {
    pairs.forEach((pair, index) => {
      const deviation = pair.y - meanY;
      if (Math.abs(deviation) < 0.000001) return;
      drawDistanceMeasureLine(
        context,
        {
          id: index,
          a: { id: 0, x: pair.x, y: meanY },
          b: { id: 0, x: pair.x, y: pair.y },
          color,
          label: `|yi - ȳ| = ${formatNumber(Math.abs(deviation))}`,
          showEndpointLabels: false,
          showLabel: true,
        },
        toScreen,
        { drawInlineLabel: true, showEndpointLabels: false }
      );
    });
  };
  const drawHorizontalDeviations = (color = accent) => {
    pairs.forEach((pair, index) => {
      const deviation = pair.x - meanX;
      if (Math.abs(deviation) < 0.000001) return;
      drawDistanceMeasureLine(
        context,
        {
          id: index,
          a: { id: 0, x: meanX, y: pair.y },
          b: { id: 0, x: pair.x, y: pair.y },
          color,
          label: `|xi - x̄| = ${formatNumber(Math.abs(deviation))}`,
          showEndpointLabels: false,
          showLabel: true,
        },
        toScreen,
        { drawInlineLabel: true, showEndpointLabels: false }
      );
    });
  };
  const drawVerticalDeviationSquares = (color: string, fill: string) => {
    let total = 0;
    pairs.forEach((pair, index) => {
      const deviation = pair.y - meanY;
      const side = Math.abs(deviation);
      if (side < 0.000001) return;
      total += deviation ** 2;
      const direction = index % 2 === 0 ? 1 : -1;
      const a = toScreen({ id: 0, x: pair.x, y: meanY });
      const b = toScreen({ id: 0, x: pair.x + side * direction, y: pair.y });
      context.fillStyle = fill;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      context.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      context.fillStyle = color;
      context.font = "700 11px Inter, system-ui, sans-serif";
      context.fillText(formatNumber(deviation ** 2), (a.x + b.x) / 2 + 4, (a.y + b.y) / 2);
    });
    drawStatisticLabel(context, `Σ vertical squares = ${formatNumber(total)}`, 12, height - 36, color, width, height);
  };
  const drawHorizontalDeviationSquares = (color: string, fill: string) => {
    let total = 0;
    pairs.forEach((pair, index) => {
      const deviation = pair.x - meanX;
      const side = Math.abs(deviation);
      if (side < 0.000001) return;
      total += deviation ** 2;
      const direction = index % 2 === 0 ? 1 : -1;
      const a = toScreen({ id: 0, x: meanX, y: pair.y });
      const b = toScreen({ id: 0, x: pair.x, y: pair.y + side * direction });
      context.fillStyle = fill;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      context.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      context.fillStyle = color;
      context.font = "700 11px Inter, system-ui, sans-serif";
      context.fillText(formatNumber(deviation ** 2), (a.x + b.x) / 2 + 4, (a.y + b.y) / 2);
    });
    drawStatisticLabel(context, `Σ horizontal squares = ${formatNumber(total)}`, 12, height - 64, color, width, height);
  };
  const drawSquaredDeviationStretch = (axis: "x" | "y", color: string, fill: string) => {
    let total = 0;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2.5;
    context.shadowColor = color;
    context.shadowBlur = 8;
    pairs.forEach((pair) => {
      const deviation = axis === "x" ? pair.x - meanX : pair.y - meanY;
      const side = Math.abs(deviation);
      if (side < 0.000001) return;
      const squared = deviation ** 2;
      total += squared;
      const signedSquared = Math.sign(deviation) * squared;
      const stretchedPoint =
        axis === "x"
          ? { id: 0, x: meanX + signedSquared, y: pair.y }
          : { id: 0, x: pair.x, y: meanY + signedSquared };
      const original = toScreen({ id: 0, x: pair.x, y: pair.y });
      const stretched = toScreen(stretchedPoint);
      context.globalAlpha = 0.88;
      context.setLineDash([7, 5]);
      context.beginPath();
      context.moveTo(original.x, original.y);
      context.lineTo(stretched.x, stretched.y);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 0.18;
      context.beginPath();
      context.arc(stretched.x, stretched.y, 12, 0, Math.PI * 2);
      context.fillStyle = fill;
      context.fill();
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(stretched.x, stretched.y, 5.5, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = color;
      context.font = "800 11px Inter, system-ui, sans-serif";
      const labelX = clamp(stretched.x + 8, 8, width - 130);
      const labelY = clamp(stretched.y - 8, 16, height - 12);
      context.fillText(`${axis === "x" ? "dx" : "dy"}^2 stretch ${formatNumber(squared)}`, labelX, labelY);
      context.strokeStyle = color;
      context.lineWidth = 2.5;
    });
    context.restore();
    drawStatisticLabel(
      context,
      axis === "x"
        ? `stretch x: dx -> sign(dx) dx^2; total = ${formatNumber(total)}`
        : `stretch y: dy -> sign(dy) dy^2; total = ${formatNumber(total)}`,
      12,
      axis === "x" ? height - 92 : height - 120,
      color,
      width,
      height
    );
  };
  const drawAverageVarianceSquare = (
    axis: "x" | "y",
    side: number,
    variance: number,
    color: string,
    fill: string
  ) => {
    if (side < 0.000001) return;
    const verticalDirection = axis === "y" ? 1 : -1;
    const a = toScreen({ id: 0, x: meanX, y: meanY });
    const b = toScreen({ id: 0, x: meanX + side, y: meanY + side * verticalDirection });
    context.fillStyle = fill;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    context.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    drawStatisticLabel(
      context,
      `VAR_${axis} avg area = ${formatNumber(variance)}`,
      (a.x + b.x) / 2 + 8,
      (a.y + b.y) / 2 - 12,
      color,
      width,
      height
    );
  };
  const drawVerticalSdBracket = (sdY: number) => {
    if (sdY < 0.000001) return;
    const bracketColor = "#39ff14";
    const upperY = meanY + sdY;
    const lowerY = meanY - sdY;
    drawHorizontal(meanY, [8, 6], 0.9);
    drawHorizontal(upperY, [4, 5], 0.72);
    drawHorizontal(lowerY, [4, 5], 0.72);
    const x = clamp(meanScreen.x + 46, 28, width - 28);
    const mean = toScreen({ id: 0, x: meanX, y: meanY }).y;
    const upper = toScreen({ id: 0, x: meanX, y: upperY }).y;
    const lower = toScreen({ id: 0, x: meanX, y: lowerY }).y;
    context.save();
    context.strokeStyle = bracketColor;
    context.fillStyle = bracketColor;
    context.shadowColor = bracketColor;
    context.shadowBlur = 10;
    context.lineWidth = 3;
    [[mean, upper], [mean, lower]].forEach(([a, b]) => {
      context.beginPath();
      context.moveTo(x, a);
      context.lineTo(x, b);
      context.moveTo(x - 7, a);
      context.lineTo(x + 7, a);
      context.moveTo(x - 7, b);
      context.lineTo(x + 7, b);
      context.stroke();
    });
    context.font = "800 12px Inter, system-ui, sans-serif";
    context.fillText("ȳ + SD_y", x + 10, upper - 4);
    context.fillText("ȳ - SD_y", x + 10, lower + 14);
    context.restore();
    drawStatisticLabel(context, `1 SD_y = ${formatNumber(sdY)}`, x + 12, (mean + upper) / 2 - 12, bracketColor, width, height);
  };
  const drawHorizontalSdBracket = (sdX: number) => {
    if (sdX < 0.000001) return;
    const bracketColor = "#ff2bd6";
    const rightX = meanX + sdX;
    const leftX = meanX - sdX;
    drawVertical(meanX, [8, 6], 0.9);
    drawVertical(rightX, [4, 5], 0.72);
    drawVertical(leftX, [4, 5], 0.72);
    const y = clamp(meanScreen.y - 46, 28, height - 28);
    const mean = toScreen({ id: 0, x: meanX, y: meanY }).x;
    const right = toScreen({ id: 0, x: rightX, y: meanY }).x;
    const left = toScreen({ id: 0, x: leftX, y: meanY }).x;
    context.save();
    context.strokeStyle = bracketColor;
    context.fillStyle = bracketColor;
    context.shadowColor = bracketColor;
    context.shadowBlur = 10;
    context.lineWidth = 3;
    [[mean, right], [mean, left]].forEach(([a, b]) => {
      context.beginPath();
      context.moveTo(a, y);
      context.lineTo(b, y);
      context.moveTo(a, y - 7);
      context.lineTo(a, y + 7);
      context.moveTo(b, y - 7);
      context.lineTo(b, y + 7);
      context.stroke();
    });
    context.font = "800 12px Inter, system-ui, sans-serif";
    context.fillText("x̄ + SD_x", right + 6, y - 10);
    context.fillText("x̄ - SD_x", left + 6, y - 10);
    context.restore();
    drawStatisticLabel(context, `1 SD_x = ${formatNumber(sdX)}`, (mean + right) / 2 + 8, y + 10, bracketColor, width, height);
  };

  context.save();
  if (guide.statistic === "MEAN") {
    if (has("mean-point", "mean-y")) drawHorizontal(meanY);
    if (has("mean-point", "mean-x")) drawVertical(meanX);
    if (has("mean-point")) drawStatisticMarker(context, meanScreen, accent);
    if (has("mean-point", "mean-x")) {
      drawStatisticLabel(
        context,
        `x mean = ${formatNumber(meanX)}`,
        meanScreen.x + 14,
        18,
        accent,
        width,
        height
      );
    }
    if (has("mean-point", "mean-y")) {
      drawStatisticLabel(
        context,
        `y mean = ${formatNumber(meanY)}`,
        meanScreen.x + 14,
        meanScreen.y - 28,
        accent,
        width,
        height
      );
    }
    drawStatisticLabel(
      context,
      `mean point (${formatNumber(meanX)}, ${formatNumber(meanY)})`,
      meanScreen.x + 14,
      meanScreen.y + 10,
      accent,
      width,
      height
    );
  }

  if (guide.statistic === "MEDIAN") {
    const medianX = getMedian(pairs.map((pair) => pair.x));
    const medianY = getMedian(pairs.map((pair) => pair.y));
    const medianScreen = toScreen({ id: 0, x: medianX, y: medianY });
    if (has("median-point", "median-y")) drawHorizontal(medianY);
    if (has("median-point", "median-x")) drawVertical(medianX);
    if (has("median-point")) drawStatisticMarker(context, medianScreen, accent);
    drawStatisticLabel(context, guide.label, medianScreen.x + 14, medianScreen.y - 28, accent, width, height);
  }

  if (guide.statistic === "SD") {
    const sdX = Math.sqrt(getVariance(pairs.map((pair) => pair.x)));
    const sdY = Math.sqrt(getVariance(pairs.map((pair) => pair.y)));
    const varX = sdX ** 2;
    const varY = sdY ** 2;
    if (
      has(
        "sd-center",
        "sd-y-deviations",
        "sd-y-squares",
        "sd-y-sum",
        "sd-y-average",
        "sd-y-length"
      )
    ) {
      drawHorizontal(meanY);
    }
    if (
      has(
        "sd-center",
        "sd-x-deviations",
        "sd-x-squares",
        "sd-x-sum",
        "sd-x-average",
        "sd-x-length"
      )
    ) {
      drawVertical(meanX);
    }
    if (has("sd-y-deviations")) drawVerticalDeviations("#2f80ed");
    if (has("sd-x-deviations")) drawHorizontalDeviations("#0ea5e9");
    if (has("sd-y-squares", "sd-y-sum")) {
      drawVerticalDeviationSquares("#2f80ed", "rgba(47, 128, 237, 0.11)");
    }
    if (has("sd-x-squares", "sd-x-sum")) {
      drawHorizontalDeviationSquares("#0ea5e9", "rgba(14, 165, 233, 0.11)");
    }
    if (guide.stretch && selectedHas("sd-y-squares", "sd-y-sum")) {
      drawSquaredDeviationStretch("y", "#ff4fd8", "rgba(255, 79, 216, 0.2)");
    }
    if (guide.stretch && selectedHas("sd-x-squares", "sd-x-sum")) {
      drawSquaredDeviationStretch("x", "#00f5ff", "rgba(0, 245, 255, 0.2)");
    }
    if (has("sd-y-average")) drawAverageVarianceSquare("y", sdY, varY, "#2f80ed", "rgba(47, 128, 237, 0.09)");
    if (has("sd-x-average")) drawAverageVarianceSquare("x", sdX, varX, "#0ea5e9", "rgba(14, 165, 233, 0.09)");
    if (has("sd-y-length")) drawVerticalSdBracket(sdY);
    if (has("sd-x-length")) drawHorizontalSdBracket(sdX);
    drawStatisticMarker(context, meanScreen, accent);
    drawStatisticLabel(context, `${guide.label}; SD_x = ${formatNumber(sdX)}, SD_y = ${formatNumber(sdY)}`, meanScreen.x + 14, meanScreen.y - 28, accent, width, height);
  }

  if (guide.statistic === "VAR") {
    const varX = getVariance(pairs.map((pair) => pair.x));
    const varY = getVariance(pairs.map((pair) => pair.y));
    const sdX = Math.sqrt(varX);
    const sdY = Math.sqrt(varY);
    if (
      has(
        "variance-center",
        "variance-y-deviations",
        "variance-y-squares",
        "variance-y-sum",
        "variance-y-average"
      )
    ) {
      drawHorizontal(meanY);
    }
    if (
      has(
        "variance-center",
        "variance-x-deviations",
        "variance-x-squares",
        "variance-x-sum",
        "variance-x-average"
      )
    ) {
      drawVertical(meanX);
    }
    if (has("variance-y-deviations")) drawVerticalDeviations("#9b51e0");
    if (has("variance-x-deviations")) drawHorizontalDeviations("#0ea5e9");
    if (has("variance-y-squares", "variance-y-sum")) {
      drawVerticalDeviationSquares("#6f2da8", "rgba(155, 81, 224, 0.11)");
    }
    if (has("variance-x-squares", "variance-x-sum")) {
      drawHorizontalDeviationSquares("#0ea5e9", "rgba(14, 165, 233, 0.11)");
    }
    if (guide.stretch && selectedHas("variance-y-squares", "variance-y-sum")) {
      drawSquaredDeviationStretch("y", "#ff4fd8", "rgba(255, 79, 216, 0.2)");
    }
    if (guide.stretch && selectedHas("variance-x-squares", "variance-x-sum")) {
      drawSquaredDeviationStretch("x", "#00f5ff", "rgba(0, 245, 255, 0.2)");
    }
    if (has("variance-y-average")) {
      drawAverageVarianceSquare("y", sdY, varY, "#6f2da8", "rgba(155, 81, 224, 0.1)");
    }
    if (has("variance-x-average")) {
      drawAverageVarianceSquare("x", sdX, varX, "#0ea5e9", "rgba(14, 165, 233, 0.1)");
    }
    drawStatisticMarker(context, meanScreen, accent);
    drawStatisticLabel(context, `${guide.label}; VAR_x = ${formatNumber(varX)}, VAR_y = ${formatNumber(varY)}`, meanScreen.x + 14, meanScreen.y - 28, accent, width, height);
  }

  if (guide.statistic === "COVAR") {
    if (
      has(
        "covariance-means",
        "covariance-horizontal",
        "covariance-vertical",
        "covariance-products",
        "covariance-average"
      )
    ) {
      drawHorizontal(meanY);
      drawVertical(meanX);
    }
    pairs.forEach((pair) => {
      const screen = toScreen({ id: 0, x: pair.x, y: pair.y });
      const product = (pair.x - meanX) * (pair.y - meanY);
      if (has("covariance-horizontal", "covariance-products", "covariance-average")) {
        drawDistanceMeasureLine(
          context,
          {
            id: pair.x * 1000 + pair.y,
            a: { id: 0, x: meanX, y: pair.y },
            b: { id: 0, x: pair.x, y: pair.y },
            color: "#29b6f6",
            label: `|xi - x̄| = ${formatNumber(Math.abs(pair.x - meanX))}`,
            showEndpointLabels: false,
            showLabel: true,
          },
          toScreen,
          { drawInlineLabel: has("covariance-horizontal"), showEndpointLabels: false }
        );
      }
      if (has("covariance-vertical", "covariance-products", "covariance-average")) {
        drawDistanceMeasureLine(
          context,
          {
            id: pair.x * 1000 + pair.y,
            a: { id: 0, x: pair.x, y: meanY },
            b: { id: 0, x: pair.x, y: pair.y },
            color: "#ec407a",
            label: `|yi - ȳ| = ${formatNumber(Math.abs(pair.y - meanY))}`,
            showEndpointLabels: false,
            showLabel: true,
          },
          toScreen,
          { drawInlineLabel: has("covariance-vertical"), showEndpointLabels: false }
        );
      }
      if (has("covariance-products", "covariance-average")) {
        context.fillStyle = product >= 0 ? "rgba(242, 153, 74, 0.18)" : "rgba(235, 87, 87, 0.16)";
        context.strokeStyle = product >= 0 ? "#f2994a" : "#eb5757";
        context.lineWidth = 1.5;
        context.fillRect(
          Math.min(meanScreen.x, screen.x),
          Math.min(meanScreen.y, screen.y),
          Math.abs(screen.x - meanScreen.x),
          Math.abs(screen.y - meanScreen.y)
        );
        context.strokeRect(
          Math.min(meanScreen.x, screen.x),
          Math.min(meanScreen.y, screen.y),
          Math.abs(screen.x - meanScreen.x),
          Math.abs(screen.y - meanScreen.y)
        );
      }
    });
    drawStatisticMarker(context, meanScreen, accent);
    drawStatisticLabel(context, guide.label, meanScreen.x + 14, meanScreen.y - 28, accent, width, height);
  }
  context.restore();
};

const drawStatisticMarker = (
  context: CanvasRenderingContext2D,
  screen: { x: number; y: number },
  color: string
) => {
  context.save();
  context.beginPath();
  context.fillStyle = "#ffffff";
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.arc(screen.x, screen.y, 7, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
};

const drawStatisticLabel = (
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  color: string,
  width: number,
  height: number
) => {
  context.save();
  context.font = "700 12px Inter, system-ui, sans-serif";
  const display = label.length > 54 ? `${label.slice(0, 51)}...` : label;
  const labelWidth = context.measureText(display).width + 14;
  const labelX = clamp(x, 8, Math.max(8, width - labelWidth - 8));
  const labelY = clamp(y, 8, Math.max(8, height - 28));
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  roundRect(context, labelX, labelY, labelWidth, 22, 5);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.fillText(display, labelX + 7, labelY + 5);
  context.restore();
};

const getAverage = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const getMedian = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const getVariance = (values: number[]) => {
  const average = getAverage(values);
  return getAverage(values.map((value) => (value - average) ** 2));
};

const drawCalculatorMeanPoint = (
  context: CanvasRenderingContext2D,
  meanPoint: CalculatorMeanPoint,
  width: number,
  height: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const screen = toScreen({ id: 0, x: meanPoint.x, y: meanPoint.y });
  context.save();
  context.beginPath();
  context.strokeStyle = "rgba(57, 255, 20, 0.72)";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.moveTo(0, screen.y);
  context.lineTo(width, screen.y);
  context.moveTo(screen.x, 0);
  context.lineTo(screen.x, height);
  context.stroke();
  context.setLineDash([]);
  context.shadowColor = "#39ff14";
  context.shadowBlur = 18;
  context.beginPath();
  context.fillStyle = "#ecffe7";
  context.strokeStyle = "#39ff14";
  context.lineWidth = 4;
  context.arc(screen.x, screen.y, 9, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = "#166b08";
  context.font = "800 12px Inter, system-ui, sans-serif";
  context.fillText(`mean (${formatNumber(meanPoint.x)}, ${formatNumber(meanPoint.y)})`, screen.x + 14, screen.y - 12);
  context.restore();
};

const drawCorrelationGuide = (
  context: CanvasRenderingContext2D,
  guide: CorrelationGuide,
  width: number,
  height: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  if (guide.pairs.length < 2) return;
  const geometry = buildCorrelationGeometry(guide.pairs);
  const active = new Set(guide.highlights);
  const has = (...highlights: CorrelationHighlight[]) =>
    highlights.some((highlight) => active.has(highlight));
  const showAll = has("all");
  const showComovement = showAll || has("comovement", "positive-comovement", "negative-comovement");
  const showHorizontal = showAll || has("horizontal", "x-spread", "denominator") || showComovement;
  const showVertical = showAll || has("vertical", "y-spread", "denominator") || showComovement;
  const showXSpread = has("x-spread", "denominator");
  const showYSpread = has("y-spread", "denominator");
  const showMeanX = showAll || has("mean", "mean-x") || showHorizontal;
  const showMeanY = showAll || has("mean", "mean-y") || showVertical;

  context.save();
  drawCorrelationMeanLines(context, geometry.meanX, geometry.meanY, width, height, toScreen, showMeanX, showMeanY);
  drawStatisticMarker(context, toScreen({ id: 0, x: geometry.meanX, y: geometry.meanY }), "#39ff14");

  if (showXSpread) {
    geometry.items.forEach((item) =>
      drawHorizontalSpreadSquare(context, item, geometry.meanX, geometry.meanY, toScreen)
    );
  }

  if (showYSpread) {
    geometry.items.forEach((item) =>
      drawVerticalSpreadSquare(context, item, geometry.meanX, geometry.meanY, toScreen)
    );
  }

  if (showAll || has("denominator")) {
    drawCorrelationNormalizationBox(context, geometry, width, height, toScreen);
  }

  if (showComovement) {
    geometry.items.forEach((item) => {
      const isolatePositive = has("positive-comovement") && !has("comovement", "negative-comovement") && !showAll;
      const isolateNegative = has("negative-comovement") && !has("comovement", "positive-comovement") && !showAll;
      if ((isolatePositive && item.product < 0) || (isolateNegative && item.product >= 0)) return;
      drawComovementRectangle(context, item, geometry.meanX, geometry.meanY, toScreen);
    });
  }

  geometry.items.forEach((item) => {
    const point = toScreen({ id: 0, ...item.point });
    if (showHorizontal && !showXSpread) {
      drawDirectedCorrelationSegment(
        context,
        toScreen({ id: 0, x: geometry.meanX, y: item.point.y }),
        point,
        "#00b8ff"
      );
    }
    if (showVertical && !showYSpread) {
      drawDirectedCorrelationSegment(
        context,
        toScreen({ id: 0, x: item.point.x, y: geometry.meanY }),
        point,
        "#ff45a0"
      );
    }
  });

  drawCorrelationSummary(context, guide.highlights, geometry, width, height);
  context.restore();
};

const drawCorrelationMeanLines = (
  context: CanvasRenderingContext2D,
  meanX: number,
  meanY: number,
  width: number,
  height: number,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  showMeanX: boolean,
  showMeanY: boolean
) => {
  const meanScreen = toScreen({ id: 0, x: meanX, y: meanY });
  context.save();
  context.setLineDash([7, 5]);
  context.strokeStyle = "rgba(57, 255, 20, 0.7)";
  context.lineWidth = 1.5;
  context.beginPath();
  if (showMeanY) {
    context.moveTo(0, meanScreen.y);
    context.lineTo(width, meanScreen.y);
  }
  if (showMeanX) {
    context.moveTo(meanScreen.x, 0);
    context.lineTo(meanScreen.x, height);
  }
  context.stroke();
  context.restore();
};

const drawHorizontalSpreadSquare = (
  context: CanvasRenderingContext2D,
  item: CorrelationGeometryItem,
  meanX: number,
  meanY: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const direction = item.point.y >= meanY ? 1 : -1;
  const start = { x: meanX, y: item.point.y };
  const end = { x: item.point.x, y: item.point.y + direction * item.absoluteDx };
  drawCorrelationRectangle(context, start.x, start.y, end.x, end.y, toScreen, "rgba(0, 184, 255, 0.14)", "#00b8ff");
  drawDirectedCorrelationSegment(context, toScreen({ id: 0, ...start }), toScreen({ id: 0, x: item.point.x, y: item.point.y }), "#00b8ff");
  drawCorrelationObjectLabel(
    context,
    toScreen({ id: 0, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }),
    [
      `${item.pointLabel}: dx = ${formatNumber(item.dx)}`,
      `|dx| = ${formatNumber(item.absoluteDx)}`,
      `dx² = ${formatNumber(item.xSquared)}`,
    ],
    "#0077a8"
  );
};

const drawVerticalSpreadSquare = (
  context: CanvasRenderingContext2D,
  item: CorrelationGeometryItem,
  meanX: number,
  meanY: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const direction = item.point.x >= meanX ? 1 : -1;
  const start = { x: item.point.x, y: meanY };
  const end = { x: item.point.x + direction * item.absoluteDy, y: item.point.y };
  drawCorrelationRectangle(context, start.x, start.y, end.x, end.y, toScreen, "rgba(255, 69, 160, 0.13)", "#ff45a0");
  drawDirectedCorrelationSegment(context, toScreen({ id: 0, ...start }), toScreen({ id: 0, x: item.point.x, y: item.point.y }), "#ff45a0");
  drawCorrelationObjectLabel(
    context,
    toScreen({ id: 0, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }),
    [
      `${item.pointLabel}: dy = ${formatNumber(item.dy)}`,
      `|dy| = ${formatNumber(item.absoluteDy)}`,
      `dy² = ${formatNumber(item.ySquared)}`,
    ],
    "#b62772"
  );
};

const drawComovementRectangle = (
  context: CanvasRenderingContext2D,
  item: CorrelationGeometryItem,
  meanX: number,
  meanY: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const positive = item.product >= 0;
  const color = positive ? "#12a55b" : "#e66f19";
  drawCorrelationRectangle(
    context,
    meanX,
    meanY,
    item.point.x,
    item.point.y,
    toScreen,
    positive ? "rgba(50, 215, 126, 0.24)" : "rgba(255, 159, 67, 0.24)",
    color
  );
  drawCorrelationObjectLabel(
    context,
    toScreen({ id: 0, x: (meanX + item.point.x) / 2, y: (meanY + item.point.y) / 2 }),
    [
      `${item.pointLabel}: dx=${formatNumber(item.dx)}, dy=${formatNumber(item.dy)}`,
      `dx·dy = ${formatNumber(item.product)}`,
      positive ? "positive comovement" : "negative comovement",
    ],
    color
  );
};

const drawCorrelationNormalizationBox = (
  context: CanvasRenderingContext2D,
  geometry: ReturnType<typeof buildCorrelationGeometry>,
  width: number,
  height: number,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const xVectorLength = Math.sqrt(geometry.xSpread);
  const yVectorLength = Math.sqrt(geometry.ySpread);
  if (xVectorLength < 0.000001 || yVectorLength < 0.000001) return;
  const color = "#facc15";
  const fill = "rgba(250, 204, 21, 0.14)";
  const mean = { x: geometry.meanX, y: geometry.meanY };
  const corner = {
    x: geometry.meanX + xVectorLength,
    y: geometry.meanY + yVectorLength,
  };
  const meanScreen = toScreen({ id: 0, ...mean });
  const xEnd = toScreen({ id: 0, x: corner.x, y: geometry.meanY });
  const yEnd = toScreen({ id: 0, x: geometry.meanX, y: corner.y });
  const cornerScreen = toScreen({ id: 0, ...corner });
  drawCorrelationRectangle(context, mean.x, mean.y, corner.x, corner.y, toScreen, fill, color);
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 8;
  context.lineWidth = 3;
  context.setLineDash([9, 5]);
  context.beginPath();
  context.moveTo(meanScreen.x, meanScreen.y);
  context.lineTo(xEnd.x, xEnd.y);
  context.moveTo(meanScreen.x, meanScreen.y);
  context.lineTo(yEnd.x, yEnd.y);
  context.stroke();
  context.setLineDash([]);
  context.font = "900 11px Inter, system-ui, sans-serif";
  context.fillText(`||dx|| = ${formatNumber(xVectorLength)}`, (meanScreen.x + xEnd.x) / 2 + 6, meanScreen.y - 8);
  context.fillText(`||dy|| = ${formatNumber(yVectorLength)}`, meanScreen.x + 8, (meanScreen.y + yEnd.y) / 2);
  context.restore();
  drawCorrelationObjectLabel(
    context,
    {
      x: clamp((meanScreen.x + cornerScreen.x) / 2 + 8, 12, width - 260),
      y: clamp((meanScreen.y + cornerScreen.y) / 2, 58, height - 92),
    },
    [
      "normalizer = maximum possible comovement",
      `max = ||dx|| * ||dy|| = ${formatNumber(geometry.denominator)}`,
      `actual = ${formatNumber(geometry.rawComovement)}`,
      `r = actual / max = ${geometry.coefficient === null ? "undefined" : formatNumber(geometry.coefficient)}`,
      "scale removed: only alignment remains",
    ],
    "#a16207"
  );
};

const drawCorrelationRectangle = (
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  fill: string,
  stroke: string
) => {
  const a = toScreen({ id: 0, x: x1, y: y1 });
  const b = toScreen({ id: 0, x: x2, y: y2 });
  context.save();
  context.beginPath();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  context.fill();
  context.stroke();
  context.restore();
};

const drawDirectedCorrelationSegment = (
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string
) => {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - 8 * Math.cos(angle - Math.PI / 6), end.y - 8 * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - 8 * Math.cos(angle + Math.PI / 6), end.y - 8 * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
  context.restore();
};

const drawCorrelationObjectLabel = (
  context: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  lines: string[],
  color: string
) => {
  context.save();
  context.font = "700 10px Inter, system-ui, sans-serif";
  const boxWidth = Math.max(...lines.map((line) => context.measureText(line).width)) + 10;
  const boxHeight = lines.length * 13 + 7;
  const x = anchor.x + 5;
  const y = anchor.y - boxHeight / 2;
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.strokeStyle = color;
  context.lineWidth = 1;
  roundRect(context, x, y, boxWidth, boxHeight, 4);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x + 5, y + 4 + index * 13));
  context.restore();
};

const drawCorrelationSummary = (
  context: CanvasRenderingContext2D,
  highlights: CorrelationHighlight[],
  geometry: ReturnType<typeof buildCorrelationGeometry>,
  width: number,
  height: number
) => {
  const active = new Set(highlights);
  const lines: string[] = [];
  if (active.has("x-spread")) lines.push(`Σ(xi - x̄)² = ${formatNumber(geometry.xSpread)}`);
  if (active.has("y-spread")) lines.push(`Σ(yi - ȳ)² = ${formatNumber(geometry.ySpread)}`);
  if (active.has("comovement") || active.has("positive-comovement") || active.has("negative-comovement")) {
    lines.push(`Σ[(xi - x̄)(yi - ȳ)] = ${formatNumber(geometry.rawComovement)}`);
  }
  if (active.has("denominator") || active.has("all")) {
    lines.push("denominator = maximum possible comovement");
    lines.push(`r = actual / max = ${geometry.coefficient === null ? "undefined" : formatNumber(geometry.coefficient)}`);
    lines.push("normalization removes x/y scale");
    lines.push(`√[${formatNumber(geometry.xSpread)} × ${formatNumber(geometry.ySpread)}] = ${formatNumber(geometry.denominator)}`);
  }
  if (active.has("all")) lines.push(`r = ${geometry.coefficient === null ? "undefined" : formatNumber(geometry.coefficient)}`);
  highlights.forEach((highlight) => {
    const explanation = getCorrelationFormulaComponent(highlight)?.explanation;
    if (explanation && !lines.includes(explanation)) lines.push(explanation);
  });
  if (lines.length === 0) return;
  context.save();
  context.font = "700 11px Inter, system-ui, sans-serif";
  const visibleLines = lines.slice(0, 6);
  const boxWidth = Math.min(width - 24, Math.max(...visibleLines.map((line) => context.measureText(line).width)) + 16);
  const boxHeight = visibleLines.length * 15 + 10;
  const x = 12;
  const y = clamp(34, 8, Math.max(8, height - boxHeight - 8));
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.strokeStyle = "#3d5158";
  context.lineWidth = 1;
  roundRect(context, x, y, boxWidth, boxHeight, 5);
  context.fill();
  context.stroke();
  context.fillStyle = "#243238";
  visibleLines.forEach((line, index) => context.fillText(line, x + 8, y + 5 + index * 15));
  context.restore();
};

const OPPOSITE_SHAPE_VERTEX: Record<ShapeVertex, ShapeVertex> = {
  nw: "se",
  ne: "sw",
  se: "nw",
  sw: "ne",
};

const SHAPE_VERTEX_SIGNS: Record<ShapeVertex, { x: number; y: number }> = {
  nw: { x: -1, y: 1 },
  ne: { x: 1, y: 1 },
  se: { x: 1, y: -1 },
  sw: { x: -1, y: -1 },
};

const getShapeCornerList = (shape: GraphShape) => {
  const corners = getShapeCorners(shape);
  return SHAPE_VERTICES.map((vertex) => corners[vertex]);
};

const isPointInsidePolygon = (
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
) => {
  let isInside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) isInside = !isInside;
  }
  return isInside;
};

const resizeAndRotateShapeFromVertex = (
  shape: GraphShape,
  vertex: ShapeVertex,
  nextPoint: GraphPoint
): GraphShape => {
  const bounds = getShapeBounds(shape);
  const opposite = getShapeCorners(shape)[OPPOSITE_SHAPE_VERTEX[vertex]];
  const signs = SHAPE_VERTEX_SIGNS[vertex];
  const localDiagonal = {
    x: signs.x * bounds.width,
    y: signs.y * bounds.height,
  };
  const worldDiagonal = {
    x: nextPoint.x - opposite.x,
    y: nextPoint.y - opposite.y,
  };
  const originalLength = Math.hypot(localDiagonal.x, localDiagonal.y);
  const nextLength = Math.hypot(worldDiagonal.x, worldDiagonal.y);
  if (originalLength < 0.000001 || nextLength < 0.1) return shape;
  const scale = nextLength / originalLength;
  const width = Math.max(0.1, bounds.width * scale);
  const height = Math.max(0.1, bounds.height * scale);
  const center = {
    x: (opposite.x + nextPoint.x) / 2,
    y: (opposite.y + nextPoint.y) / 2,
  };
  return {
    ...shape,
    a: {
      ...shape.a,
      x: roundCoordinate(center.x - width / 2),
      y: roundCoordinate(center.y - height / 2),
    },
    b: {
      ...shape.b,
      x: roundCoordinate(center.x + width / 2),
      y: roundCoordinate(center.y + height / 2),
    },
    rotation:
      Math.atan2(worldDiagonal.y, worldDiagonal.x) -
      Math.atan2(localDiagonal.y, localDiagonal.x),
  };
};

const drawShape = (
  context: CanvasRenderingContext2D,
  shape: GraphShape,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  color: string
) => {
  const corners = getShapeCornerList(shape).map(toScreen);
  context.beginPath();
  context.fillStyle = withAlpha(color, 0.12);
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((corner) => context.lineTo(corner.x, corner.y));
  context.closePath();
  context.fill();
  context.stroke();
};

const drawShapeSelection = (
  context: CanvasRenderingContext2D,
  shape: GraphShape,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const corners = getShapeCornerList(shape).map(toScreen);
  context.save();
  context.setLineDash([7, 5]);
  context.strokeStyle = "rgba(36, 33, 30, 0.45)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((corner) => context.lineTo(corner.x, corner.y));
  context.closePath();
  context.stroke();
  context.restore();
};

const getFormulaObjectPath = (
  object: GraphFormulaObject,
  minX: number,
  maxX: number,
  sampleCount = 180
): GraphPoint[] => {
  const x = object.anchor.x;
  const y = object.anchor.y;
  const value = (key: string) => getFormulaValue(object, key);

  if (object.kind === "square") {
    const s = value("s");
    return [
      { id: 0, x, y },
      { id: 0, x: x + s, y },
      { id: 0, x: x + s, y: y + s },
      { id: 0, x, y: y + s },
    ];
  }

  if (object.kind === "rectangle") {
    const w = value("w");
    const h = value("h");
    return [
      { id: 0, x, y },
      { id: 0, x: x + w, y },
      { id: 0, x: x + w, y: y + h },
      { id: 0, x, y: y + h },
    ];
  }

  if (object.kind === "triangle") {
    const b = value("b");
    const h = value("h");
    return [
      { id: 0, x, y },
      { id: 0, x: x + b, y },
      { id: 0, x: x + b / 2, y: y + h },
    ];
  }

  if (object.kind === "right-triangle") {
    const a = value("a");
    const b = value("b");
    return [
      { id: 0, x, y },
      { id: 0, x: x + a, y },
      { id: 0, x: x + a, y: y + b },
    ];
  }

  if (object.kind === "circle" || object.kind === "ellipse") {
    const radiusX =
      object.kind === "circle"
        ? Math.abs(value("r"))
        : Math.abs(value("a"));
    const radiusY =
      object.kind === "circle"
        ? Math.abs(value("r"))
        : Math.abs(value("b"));
    return Array.from({ length: sampleCount }, (_, index) => {
      const angle = (Math.PI * 2 * index) / sampleCount;
      return {
        id: 0,
        x: x + Math.cos(angle) * radiusX,
        y: y + Math.sin(angle) * radiusY,
      };
    });
  }

  const points: GraphPoint[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const pointX = minX + ((maxX - minX) * index) / sampleCount;
    const pointY = evaluateFormulaObject(object, pointX);
    if (pointY === null || !Number.isFinite(pointY)) continue;
    points.push({ id: 0, x: pointX, y: pointY });
  }
  return points;
};

const isClosedFormulaObject = (object: GraphFormulaObject) =>
  [
    "square",
    "rectangle",
    "circle",
    "triangle",
    "right-triangle",
    "ellipse",
  ].includes(object.kind);

const drawFormulaObject = (
  context: CanvasRenderingContext2D,
  object: GraphFormulaObject,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  minX: number,
  maxX: number,
  isSelected: boolean
) => {
  const points = getFormulaObjectPath(object, minX, maxX);
  if (points.length < 2) return;
  const screenPoints = points.map(toScreen);
  const closed = isClosedFormulaObject(object);

  context.save();
  if (isSelected) {
    context.strokeStyle = "rgba(36, 33, 30, 0.28)";
    context.lineWidth = 8;
    context.beginPath();
    screenPoints.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    if (closed) context.closePath();
    context.stroke();
  }

  context.beginPath();
  context.strokeStyle = object.color;
  context.fillStyle = withAlpha(object.color, closed ? 0.12 : 0);
  context.lineWidth = 2.5;
  screenPoints.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  if (closed) {
    context.closePath();
    context.fill();
  }
  context.stroke();

  const anchorScreen = toScreen(object.anchor);
  drawHandle(context, anchorScreen, object.color);
  if (object.showLabel !== false) {
    context.font = "700 12px Inter, system-ui, sans-serif";
    context.fillStyle = "#24211e";
    context.fillText(object.name, anchorScreen.x + 10, anchorScreen.y - 18);
  }
  context.restore();
};

const drawDataPlot = (
  context: CanvasRenderingContext2D,
  plot: DataPlot,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  if (plot.values.length === 0) return;

  const sortedValues = [...plot.values].sort((a, b) => a.x - b.x);

  if (plot.style === "bar") {
    const xValues = sortedValues.map((value) => value.x);
    const gaps = xValues
      .slice(1)
      .map((value, index) => Math.abs(value - xValues[index]))
      .filter((gap) => gap > 0);
    const minGap = gaps.length > 0 ? Math.min(...gaps) : 0.5;
    const barHalfWidth = Math.max(0.08, Math.min(0.35, minGap * 0.35));

    sortedValues.forEach((value) => {
      const top = toScreen({ id: 0, x: value.x, y: value.y });
      const base = toScreen({ id: 0, x: value.x, y: 0 });
      const left = toScreen({ id: 0, x: value.x - barHalfWidth, y: 0 }).x;
      const right = toScreen({ id: 0, x: value.x + barHalfWidth, y: 0 }).x;
      context.beginPath();
      context.fillStyle = withAlpha(plot.color, 0.22);
      context.strokeStyle = plot.color;
      context.lineWidth = 1.8;
      context.rect(
        left,
        Math.min(top.y, base.y),
        right - left,
        Math.abs(base.y - top.y)
      );
      context.fill();
      context.stroke();
      drawDataPoint(context, top, plot.color, plot.pointStyle ?? "filled");
    });
    return;
  }

  if (plot.style === "line" || plot.style === "scatter-line") {
    context.beginPath();
    context.strokeStyle = plot.color;
    context.lineWidth = 2.4;
    sortedValues.forEach((value, index) => {
      const screen = toScreen({ id: 0, x: value.x, y: value.y });
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.stroke();
  }

  sortedValues.forEach((value) => {
    drawDataPoint(
      context,
      toScreen({ id: 0, x: value.x, y: value.y }),
      plot.color,
      plot.pointStyle ?? "filled"
    );
  });
};

const drawDataPoint = (
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string,
  pointStyle: DataPointStyle
) => {
  context.beginPath();
  context.fillStyle = pointStyle === "filled" ? color : "#ffffff";
  context.strokeStyle = color;
  context.lineWidth = 2.2;
  context.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
};

const drawCanvasStrokes = (
  context: CanvasRenderingContext2D,
  strokes: CanvasStroke[],
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  strokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    context.save();
    context.globalAlpha = stroke.opacity;
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    if (stroke.points.length === 1) {
      const screen = toScreen(stroke.points[0]);
      context.lineTo(screen.x + 0.01, screen.y + 0.01);
    }
    context.stroke();
    context.restore();
  });
};

const isSelectedObject = (
  selected: ObjectTarget | null,
  kind: ObjectTarget["kind"],
  id: number
) => selected?.kind === kind && selected.id === id;

const drawDistanceMeasureLine = (
  context: CanvasRenderingContext2D,
  measure: GraphMeasure,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  options: {
    drawInlineLabel?: boolean;
    index?: number;
    isSelected?: boolean;
    showEndpointLabels?: boolean;
  } = {}
) => {
  const start = toScreen(measure.a);
  const end = toScreen(measure.b);

  if (options.isSelected) {
    context.save();
    context.strokeStyle = "rgba(36, 33, 30, 0.28)";
    context.lineWidth = 7;
    context.setLineDash([10, 7]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.restore();
  }

  context.save();
  context.strokeStyle = measure.color;
  context.lineWidth = 2.5;
  context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();

  const measureAngle = Math.atan2(end.y - start.y, end.x - start.x);
  [measure.a, measure.b].forEach((point, handleIndex) => {
    const screenPoint = toScreen(point);
    drawDimensionCap(context, screenPoint, measureAngle, measure.color);
    if (options.showEndpointLabels) {
      context.fillStyle = "#24211e";
      context.fillText(
        `D${(options.index ?? 0) + 1}.${handleIndex + 1}`,
        screenPoint.x + 9,
        screenPoint.y - 18
      );
    }
  });

  if (options.drawInlineLabel && measure.showLabel !== false) {
    const label = measure.label?.trim() || formatMeasureLabel(measure);
    const midpoint = {
      x: start.x + (end.x - start.x) * (measure.labelT ?? 0.5),
      y: start.y + (end.y - start.y) * (measure.labelT ?? 0.5),
    };
    context.save();
    context.font = "700 10px Inter, system-ui, sans-serif";
    const labelWidth = context.measureText(label).width + 12;
    const labelHeight = 18;
    const x = midpoint.x + 8;
    const y = midpoint.y - labelHeight - 6;
    context.fillStyle = "rgba(255, 255, 255, 0.94)";
    context.strokeStyle = measure.color;
    context.lineWidth = 1.4;
    roundRect(context, x, y, labelWidth, labelHeight, 5);
    context.fill();
    context.stroke();
    context.fillStyle = measure.color;
    context.fillText(label, x + 6, y + 4);
    context.restore();
  }
};

const drawDimensionCap = (
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  angle: number,
  color: string
) => {
  const halfLength = 8;
  const capAngle = angle + Math.PI / 2;
  const dx = Math.cos(capAngle) * halfLength;
  const dy = Math.sin(capAngle) * halfLength;

  context.save();
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.lineCap = "round";
  context.moveTo(point.x - dx, point.y - dy);
  context.lineTo(point.x + dx, point.y + dy);
  context.stroke();
  context.restore();
};

const drawHandle = (
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string
) => {
  context.beginPath();
  context.fillStyle = "#fffdf9";
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.arc(point.x, point.y, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();
};

const withAlpha = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const drawEquationLabel = (
  context: CanvasRenderingContext2D,
  text: string,
  anchor: { x: number; y: number },
  color: string,
  width: number,
  height: number
) => {
  context.save();
  context.font = "600 11px Inter, system-ui, sans-serif";
  context.textBaseline = "middle";

  const paddingX = 6;
  const paddingY = 3;
  const textWidth = context.measureText(text).width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 19;
  const x = clamp(anchor.x + 12, 8, width - boxWidth - 8);
  const y = clamp(anchor.y - 21, 8, height - boxHeight - 8);

  context.fillStyle = "rgba(255, 253, 249, 0.92)";
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  roundRect(context, x, y, boxWidth, boxHeight, 5);
  context.fill();
  context.stroke();

  context.fillStyle = color;
  context.fillText(text, x + paddingX, y + paddingY + boxHeight / 2 - 1);
  context.restore();
};

const roundRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
};

export default App;
