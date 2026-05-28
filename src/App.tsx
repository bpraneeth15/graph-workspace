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
  useRef,
  useState,
} from "react";
import { ScientificCalculator } from "./features/calculator/ScientificCalculator";
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
  DataPlot,
  DataPointStyle,
  DataPlotStyle,
  DataValue,
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
  Tool,
  ViewState,
  WorkspaceMode,
} from "./graphTypes";
import { parseDataValues } from "./lib/dataParsing";
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
  getToolHelp,
  getToolTitle,
  isTypingTarget,
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

type GraphSnapshot = {
  points: GraphPoint[];
  lines: GraphLine[];
  curves: GraphCurve[];
  shapes: GraphShape[];
  measures: GraphMeasure[];
  dataPlots: DataPlot[];
  canvasStrokes: CanvasStroke[];
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
  measures: GraphMeasure[];
  dataPlots: DataPlot[];
  canvasStrokes: CanvasStroke[];
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
  | { kind: "shape"; id: number; handle: "a" | "b" }
  | { kind: "measure"; id: number; handle: "a" | "b" }
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

type CanvasTool = "none" | "pencil" | "marker" | "eraser";

type CanvasStroke = {
  id: number;
  color: string;
  opacity: number;
  width: number;
  points: GraphPoint[];
  tool: Exclude<CanvasTool, "none" | "eraser">;
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

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef({ dx: 0, dy: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const undoStack = useRef<GraphSnapshot[]>([]);
  const redoStack = useRef<GraphSnapshot[]>([]);
  const nextPointId = useRef(1);
  const nextLineId = useRef(1);
  const nextCurveId = useRef(1);
  const nextShapeId = useRef(1);
  const nextMeasureId = useRef(1);
  const nextDataPlotId = useRef(1);
  const nextCanvasStrokeId = useRef(1);
  const nextSurfaceShapeId = useRef(2);
  const nextSurfaceStrokeId = useRef(1);
  const nextSurfaceDataPointId = useRef(1);

  const [view, setView] = useState<ViewState>(START_VIEW);
  const [points, setPoints] = useState<GraphPoint[]>([]);
  const [lines, setLines] = useState<GraphLine[]>([]);
  const [curves, setCurves] = useState<GraphCurve[]>([]);
  const [shapes, setShapes] = useState<GraphShape[]>([]);
  const [measures, setMeasures] = useState<GraphMeasure[]>([]);
  const [dataPlots, setDataPlots] = useState<DataPlot[]>([]);
  const [canvasStrokes, setCanvasStrokes] = useState<CanvasStroke[]>([]);
  const [draftPoints, setDraftPoints] = useState<GraphPoint[]>([]);
  const [tool, setTool] = useState<Tool>("plot");
  const [openToolMenu, setOpenToolMenu] = useState<Tool>("plot");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("2d");
  const [selectedColor, setSelectedColor] = useState(COLOR_SWATCHES[0]);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapStep, setSnapStep] = useState(SUBGRID_STEP);
  const [connectPoints, setConnectPoints] = useState(false);
  const [showLeastSquares, setShowLeastSquares] = useState(false);
  const [referenceLineMode, setReferenceLineMode] = useState(false);
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
  const [surfaceShapes, setSurfaceShapes] = useState<SurfaceShape[]>([
    {
      id: 1,
      type: "surface",
      name: "Surface 1",
      equation: "sin(sqrt(x*x + y*y))",
      color: COLOR_SWATCHES[0],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  ]);
  const [selectedSurfaceShapeId, setSelectedSurfaceShapeId] = useState(1);
  const [surfaceTool, setSurfaceTool] = useState<SurfaceTool>("select");
  const [surfaceStrokes, setSurfaceStrokes] = useState<SurfaceStroke[]>([]);
  const [surfaceDataPoints, setSurfaceDataPoints] = useState<SurfaceDataPoint[]>([]);
  const [surfaceRange, setSurfaceRange] = useState(6);
  const [surfaceResolution, setSurfaceResolution] = useState(48);
  const [surfaceShowSlices, setSurfaceShowSlices] = useState(true);
  const [surfaceShowContour, setSurfaceShowContour] = useState(true);
  const [surfacePanelView, setSurfacePanelView] = useState<SurfacePanelView>("contour");
  const [surfaceCutX, setSurfaceCutX] = useState(0);
  const [surfaceCutY, setSurfaceCutY] = useState(0);
  const [surfaceCutZ, setSurfaceCutZ] = useState(0);
  const [rendererMode, setRendererMode] = useState<RendererMode>("auto");
  const [mouseSensitivity, setMouseSensitivity] = useState(1);
  const [zoomSensitivity, setZoomSensitivity] = useState(1);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedObject, setSelectedObject] = useState<ObjectTarget | null>(null);
  const [hoverMenu, setHoverMenu] = useState<HoverMenu | null>(null);
  const [hoverSnapPoint, setHoverSnapPoint] = useState<HoverSnapPoint | null>(null);
  const [calculatorGuide, setCalculatorGuide] = useState<CalculatorGuide | null>(null);
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
        measures,
        dataPlots,
        canvasStrokes,
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
    const savedAt = new Date().toISOString();
    const nextCapture: WorkspaceCapture = {
      id,
      name: name.trim() || `Capture ${captures.length + 1}`,
      savedAt,
      workspaceMode,
      view,
      points,
      lines,
      curves,
      shapes,
      measures,
      dataPlots,
      canvasStrokes,
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
    };

    setCaptures((current) => {
      const next = [nextCapture, ...current].slice(0, 20);
      writeWorkspaceCaptures(next);
      return next;
    });
    setSelectedCaptureId(id);
  };

  const restoreWorkspaceCapture = (captureId = selectedCaptureId) => {
    const capture = captures.find((item) => item.id === captureId);
    if (!capture) return;

    pushHistory();
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
      capture.canvasStrokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map(clonePoint),
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
    nextMeasureId.current = getNextId(capture.measures);
    nextDataPlotId.current = getNextId(capture.dataPlots);
    nextCanvasStrokeId.current = getNextId(capture.canvasStrokes);
    nextSurfaceShapeId.current = getNextId(capture.surface.shapes);
    nextSurfaceStrokeId.current = getNextId(capture.surface.strokes);
    nextSurfaceDataPointId.current = getNextId(capture.surface.dataPoints);
  };

  const getGraphSnapshot = (): GraphSnapshot =>
    cloneSnapshot({
      points,
      lines,
      curves,
      shapes,
      measures,
      dataPlots,
      canvasStrokes,
    });

  const restoreGraphSnapshot = (snapshot: GraphSnapshot) => {
    const next = cloneSnapshot(snapshot);
    setPoints(next.points);
    setLines(next.lines);
    setCurves(next.curves);
    setShapes(next.shapes);
    setMeasures(next.measures);
    setDataPlots(next.dataPlots);
    setCanvasStrokes(next.canvasStrokes);
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
  const fitDataPoints = collectLeastSquaresPoints(points, dataPlots);
  const activeFitLine =
    selectedObject?.kind === "line"
      ? lines.find((line) => line.id === selectedObject.id) ?? null
      : lines[0] ?? null;
  const leastSquaresSummary = getLeastSquaresSummary(activeFitLine, fitDataPoints);

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
      testPoint(shape.a, { kind: "shape", id: shape.id, handle: "a" });
      testPoint(shape.b, { kind: "shape", id: shape.id, handle: "b" });
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
      const topLeft = worldToCanvas({
        id: 0,
        x: Math.min(shape.a.x, shape.b.x),
        y: Math.max(shape.a.y, shape.b.y),
      });
      const bottomRight = worldToCanvas({
        id: 0,
        x: Math.max(shape.a.x, shape.b.x),
        y: Math.min(shape.a.y, shape.b.y),
      });
      const isInside =
        local.x >= topLeft.x &&
        local.x <= bottomRight.x &&
        local.y >= topLeft.y &&
        local.y <= bottomRight.y;

      if (isInside) {
        choose(0, { kind: "shape", id: shape.id });
        return;
      }

      const corners = [
        topLeft,
        { x: bottomRight.x, y: topLeft.y },
        bottomRight,
        { x: topLeft.x, y: bottomRight.y },
      ];
      corners.forEach((corner, index) => {
        choose(distanceToSegment(local, corner, corners[(index + 1) % corners.length]), {
          kind: "shape",
          id: shape.id,
        });
      });
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
      const bounds = getShapeBounds(shape);
      const left = bounds.x;
      const right = bounds.x + bounds.width;
      const bottom = bounds.y;
      const top = bounds.y + bounds.height;
      const candidates = [
        { id: 0, x: clamp(world.x, left, right), y: top },
        { id: 0, x: clamp(world.x, left, right), y: bottom },
        { id: 0, x: left, y: clamp(world.y, bottom, top) },
        { id: 0, x: right, y: clamp(world.y, bottom, top) },
      ];
      candidates.forEach((point) => choose(point, { kind: "shape", id: shape.id }));
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
          const opposite = target.handle === "a" ? shape.b : shape.a;
          const nextCorner =
            shape.type === "square"
              ? normalizeShapeEnd(opposite, nextPoint, "square")
              : nextPoint;
          return {
            ...shape,
            [target.handle]: nextCorner,
          };
        })
      );
    }
  };

  const moveObject = (target: ObjectTarget, dx: number, dy: number) => {
    const shiftPoint = (point: GraphPoint): GraphPoint => ({
      ...point,
      x: roundCoordinate(point.x + dx),
      y: roundCoordinate(point.y + dy),
    });

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
    setSelectedObject(null);
    setHoverMenu(null);
  };

  const getObject = (target: ObjectTarget | null) => {
    if (!target) return null;
    if (target.kind === "line") return lines.find((line) => line.id === target.id) ?? null;
    if (target.kind === "curve") return curves.find((curve) => curve.id === target.id) ?? null;
    if (target.kind === "shape") return shapes.find((shape) => shape.id === target.id) ?? null;
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
        const signX = Math.sign(shape.b.x - shape.a.x) || 1;
        const signY = Math.sign(shape.b.y - shape.a.y) || -1;
        const width = Math.max(0.1, next.side ?? next.width ?? bounds.width);
        const height = Math.max(
          0.1,
          shape.type === "square" ? width : next.height ?? bounds.height
        );
        return {
          ...shape,
          b: {
            ...shape.b,
            x: roundCoordinate(shape.a.x + signX * width),
            y: roundCoordinate(shape.a.y + signY * height),
          },
        };
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
      mode: target
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
  }, [canvasStrokes, curves, lines, measures, points, selectedObject, shapes]);

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

    const resizeCanvas = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = getCanvasDpr();
      setCanvasSize({ width: rect.width, height: rect.height });
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      drawGraph(canvas, view, {
        points,
        lines,
        curves,
        shapes,
        measures,
        dataPlots,
        canvasStrokes,
        hoverSnapPoint,
        calculatorGuide,
        draftPoints,
        cursor,
        connectPoints,
        selectedColor,
        tool,
        selectedObject,
        showLeastSquares,
        leastSquares: leastSquaresSummary,
      });
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [calculatorGuide, canvasStrokes, connectPoints, cursor, curves, dataPlots, draftPoints, hoverSnapPoint, leastSquaresSummary, lines, measures, points, selectedColor, selectedObject, shapes, showLeastSquares, tool, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawGraph(canvas, view, {
        points,
        lines,
        curves,
        shapes,
        measures,
        dataPlots,
        canvasStrokes,
        hoverSnapPoint,
        calculatorGuide,
        draftPoints,
        cursor,
        connectPoints,
        selectedColor,
        tool,
        selectedObject,
        showLeastSquares,
        leastSquares: leastSquaresSummary,
      });
    }
  }, [calculatorGuide, canvasStrokes, connectPoints, cursor, curves, dataPlots, draftPoints, hoverSnapPoint, leastSquaresSummary, lines, measures, points, selectedColor, selectedObject, shapes, showLeastSquares, tool, view]);

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
  const selectedCapture =
    captures.find((capture) => capture.id === selectedCaptureId) ?? null;

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

        <button className="app-menu-button" type="button" onClick={saveWorkspaceSnapshot}>
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
              if (lines.length === 0 && curves.length === 0 && shapes.length === 0 && measures.length === 0) return;
              pushHistory();
              setLines([]);
              setCurves([]);
              setShapes([]);
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
          <div className="equation-list">
            {lines.length === 0 && curves.length === 0 && shapes.length === 0 && measures.length === 0 ? (
              <p className="empty-state">
                Draw a line, curve, rectangle, square, or distance marker.
              </p>
            ) : (
              <>
                {lines.map((line, index) => (
                  <div
                    className={
                      isSelectedObject(selectedObject, "line", line.id)
                        ? "equation-row selected"
                        : "equation-row"
                    }
                    key={`line-${line.id}`}
                    onClick={() => setSelectedObject({ kind: "line", id: line.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        setSelectedObject({ kind: "line", id: line.id });
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {(() => {
                      const target: ObjectTarget = { kind: "line", id: line.id };
                      return (
                        <>
                    <span>L{index + 1}</span>
                    <input
                      aria-label={`Change line ${index + 1} color`}
                      className="row-color-input"
                      onChange={(event) => updateObjectColor(target, event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      type="color"
                      value={line.color}
                    />
                    <code>{getLineLabel(line)}</code>
                    <button
                      aria-label={
                        line.showLabel
                          ? `Hide line ${index + 1} label`
                          : `Show line ${index + 1} label`
                      }
                      className={
                        line.showLabel
                          ? "equation-label-toggle active"
                          : "equation-label-toggle"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLabelVisibility(target, !line.showLabel);
                        if (!line.showLabel) setSelectedObject(target);
                      }}
                      title={line.showLabel ? "Hide label" : "Show label"}
                      type="button"
                    >
                      {line.showLabel ? "-" : "+"}
                    </button>
                    <button
                      aria-label={`Delete line ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        pushHistory();
                        setLines((current) =>
                          current.filter((item) => item.id !== line.id)
                        );
                      }}
                      type="button"
                    >
                      x
                    </button>
                        </>
                      );
                    })()}
                  </div>
                ))}
                {curves.map((curve, index) => (
                  <div
                    className={
                      isSelectedObject(selectedObject, "curve", curve.id)
                        ? "equation-row selected"
                        : "equation-row"
                    }
                    key={`curve-${curve.id}`}
                    onClick={() => setSelectedObject({ kind: "curve", id: curve.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        setSelectedObject({ kind: "curve", id: curve.id });
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {(() => {
                      const target: ObjectTarget = { kind: "curve", id: curve.id };
                      return (
                        <>
                    <span>C{index + 1}</span>
                    <input
                      aria-label={`Change curve ${index + 1} color`}
                      className="row-color-input"
                      onChange={(event) => updateObjectColor(target, event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      type="color"
                      value={curve.color}
                    />
                    <code>{getCurveLabel(curve)}</code>
                    <button
                      aria-label={
                        curve.showLabel
                          ? `Hide curve ${index + 1} label`
                          : `Show curve ${index + 1} label`
                      }
                      className={
                        curve.showLabel
                          ? "equation-label-toggle active"
                          : "equation-label-toggle"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLabelVisibility(target, !curve.showLabel);
                        if (!curve.showLabel) setSelectedObject(target);
                      }}
                      title={curve.showLabel ? "Hide label" : "Show label"}
                      type="button"
                    >
                      {curve.showLabel ? "-" : "+"}
                    </button>
                    <button
                      aria-label={`Delete curve ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        pushHistory();
                        setCurves((current) =>
                          current.filter((item) => item.id !== curve.id)
                        );
                      }}
                      type="button"
                    >
                      x
                    </button>
                        </>
                      );
                    })()}
                  </div>
                ))}
                {shapes.map((shape, index) => (
                  <div
                    className={
                      isSelectedObject(selectedObject, "shape", shape.id)
                        ? "equation-row selected"
                        : "equation-row"
                    }
                    key={`shape-${shape.id}`}
                    onClick={() => setSelectedObject({ kind: "shape", id: shape.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        setSelectedObject({ kind: "shape", id: shape.id });
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {(() => {
                      const target: ObjectTarget = { kind: "shape", id: shape.id };
                      return (
                        <>
                    <span>S{index + 1}</span>
                    <input
                      aria-label={`Change shape ${index + 1} color`}
                      className="row-color-input"
                      onChange={(event) => updateObjectColor(target, event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      type="color"
                      value={shape.color}
                    />
                    <code>{getShapeDisplayLabel(shape)}</code>
                    <button
                      aria-label={
                        shape.showLabel
                          ? `Hide shape ${index + 1} label`
                          : `Show shape ${index + 1} label`
                      }
                      className={
                        shape.showLabel
                          ? "equation-label-toggle active"
                          : "equation-label-toggle"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLabelVisibility(target, !shape.showLabel);
                        if (!shape.showLabel) setSelectedObject(target);
                      }}
                      title={shape.showLabel ? "Hide label" : "Show label"}
                      type="button"
                    >
                      {shape.showLabel ? "-" : "+"}
                    </button>
                    <button
                      aria-label={`Delete shape ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        pushHistory();
                        setShapes((current) =>
                          current.filter((item) => item.id !== shape.id)
                        );
                      }}
                      type="button"
                    >
                      x
                    </button>
                        </>
                      );
                    })()}
                  </div>
                ))}
                {measures.map((measure, index) => (
                  <div
                    className={
                      isSelectedObject(selectedObject, "measure", measure.id)
                        ? "equation-row measure-row selected"
                        : "equation-row measure-row"
                    }
                    key={`measure-${measure.id}`}
                    onClick={() => setSelectedObject({ kind: "measure", id: measure.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        setSelectedObject({ kind: "measure", id: measure.id });
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {(() => {
                      const target: ObjectTarget = { kind: "measure", id: measure.id };
                      const showEndpointLabels = measure.showEndpointLabels ?? true;
                      return (
                        <>
                    <span>D{index + 1}</span>
                    <input
                      aria-label={`Change distance marker ${index + 1} color`}
                      className="row-color-input"
                      onChange={(event) => updateObjectColor(target, event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      type="color"
                      value={measure.color}
                    />
                    <code>{getMeasureDisplayLabel(measure)}</code>
                    <button
                      aria-label={
                        measure.showLabel
                          ? `Hide distance marker ${index + 1} label`
                          : `Show distance marker ${index + 1} label`
                      }
                      className={
                        measure.showLabel
                          ? "equation-label-toggle active"
                          : "equation-label-toggle"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLabelVisibility(target, !measure.showLabel);
                        if (!measure.showLabel) setSelectedObject(target);
                      }}
                      title={measure.showLabel ? "Hide label" : "Show label"}
                      type="button"
                    >
                      {measure.showLabel ? "-" : "+"}
                    </button>
                    <button
                      aria-label={
                        showEndpointLabels
                          ? `Hide distance marker ${index + 1} endpoint labels`
                          : `Show distance marker ${index + 1} endpoint labels`
                      }
                      className={
                        showEndpointLabels
                          ? "equation-label-toggle active"
                          : "equation-label-toggle"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        updateMeasureEndpointLabelVisibility(
                          measure.id,
                          !showEndpointLabels
                        );
                      }}
                      title={
                        showEndpointLabels
                          ? "Hide endpoint labels"
                          : "Show endpoint labels"
                      }
                      type="button"
                    >
                      {showEndpointLabels ? "D" : "+D"}
                    </button>
                    <button
                      aria-label={`Delete distance marker ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        pushHistory();
                        setMeasures((current) =>
                          current.filter((item) => item.id !== measure.id)
                        );
                      }}
                      type="button"
                    >
                      x
                    </button>
                        </>
                      );
                    })()}
                  </div>
                ))}
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

      <section className="workspace">
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
                const bounds = getShapeBounds(shape);
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
                      getCanvasPoint({
                        id: 0,
                        x: bounds.x + bounds.width / 2,
                        y: bounds.y + bounds.height,
                      })
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
      </section>
      <ScientificCalculator
        context={calculatorContext}
        onGuideChange={setCalculatorGuide}
      />
    </main>
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
    const toolbarHeight = collapsed ? 52 : 128;
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

const drawGraph = (
  canvas: HTMLCanvasElement,
  view: ViewState,
  graph: {
    points: GraphPoint[];
    lines: GraphLine[];
    curves: GraphCurve[];
    shapes: GraphShape[];
    measures: GraphMeasure[];
    dataPlots: DataPlot[];
    canvasStrokes: CanvasStroke[];
    hoverSnapPoint: HoverSnapPoint | null;
    calculatorGuide: CalculatorGuide | null;
    draftPoints: GraphPoint[];
    cursor: GraphPoint | null;
    connectPoints: boolean;
    selectedColor: string;
    tool: Tool;
    selectedObject: ObjectTarget | null;
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

  if (graph.showLeastSquares && graph.leastSquares) {
    drawLeastSquaresSquares(
      context,
      graph.leastSquares,
      toScreen,
      width,
      height
    );
  }

  graph.shapes.forEach((shape, index) => {
    const isSelected = isSelectedObject(graph.selectedObject, "shape", shape.id);
    drawShape(context, shape, toScreen, shape.color);
    if (isSelected) {
      drawShapeSelection(context, shape, toScreen);
    }
    [shape.a, shape.b].forEach((point, handleIndex) => {
      drawHandle(context, toScreen(point), shape.color);
      context.fillStyle = "#24211e";
      context.fillText(`S${index + 1}.${handleIndex + 1}`, toScreen(point).x + 9, toScreen(point).y - 18);
    });
  });

  graph.curves.forEach((curve, index) => {
    const coefficients = getQuadraticCoefficients(curve);
    const isSelected = isSelectedObject(graph.selectedObject, "curve", curve.id);
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
    const isSelected = isSelectedObject(graph.selectedObject, "line", line.id);
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
    const isSelected = isSelectedObject(graph.selectedObject, "measure", measure.id);
    const start = toScreen(measure.a);
    const end = toScreen(measure.b);

    if (isSelected) {
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
      if (measure.showEndpointLabels ?? true) {
        context.fillStyle = "#24211e";
        context.fillText(
          `D${index + 1}.${handleIndex + 1}`,
          screenPoint.x + 9,
          screenPoint.y - 18
        );
      }
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

const drawShape = (
  context: CanvasRenderingContext2D,
  shape: GraphShape,
  toScreen: (point: GraphPoint) => { x: number; y: number },
  color: string
) => {
  const topLeft = toScreen({
    id: 0,
    x: Math.min(shape.a.x, shape.b.x),
    y: Math.max(shape.a.y, shape.b.y),
  });
  const bottomRight = toScreen({
    id: 0,
    x: Math.max(shape.a.x, shape.b.x),
    y: Math.min(shape.a.y, shape.b.y),
  });
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  context.beginPath();
  context.fillStyle = withAlpha(color, 0.12);
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.rect(topLeft.x, topLeft.y, width, height);
  context.fill();
  context.stroke();
};

const drawShapeSelection = (
  context: CanvasRenderingContext2D,
  shape: GraphShape,
  toScreen: (point: GraphPoint) => { x: number; y: number }
) => {
  const topLeft = toScreen({
    id: 0,
    x: Math.min(shape.a.x, shape.b.x),
    y: Math.max(shape.a.y, shape.b.y),
  });
  const bottomRight = toScreen({
    id: 0,
    x: Math.max(shape.a.x, shape.b.x),
    y: Math.min(shape.a.y, shape.b.y),
  });

  context.save();
  context.setLineDash([7, 5]);
  context.strokeStyle = "rgba(36, 33, 30, 0.45)";
  context.lineWidth = 2;
  context.strokeRect(
    topLeft.x - 5,
    topLeft.y - 5,
    bottomRight.x - topLeft.x + 10,
    bottomRight.y - topLeft.y + 10
  );
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
