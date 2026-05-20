import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  PointerEvent,
  ReactNode,
  WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ScientificCalculator } from "./ScientificCalculator";
import type {
  CalculatorGuide,
  DataPlot,
  DataPlotStyle,
  DataValue,
  GraphCurve,
  GraphLine,
  GraphMeasure,
  GraphPoint,
  GraphShape,
  ObjectTarget,
} from "./graphTypes";

type GraphSnapshot = {
  points: GraphPoint[];
  lines: GraphLine[];
  curves: GraphCurve[];
  shapes: GraphShape[];
  measures: GraphMeasure[];
  dataPlots: DataPlot[];
};

type ViewState = {
  offsetX: number;
  offsetY: number;
  pixelsPerUnit: number;
};

type Tool = "plot" | "line" | "curve" | "rectangle" | "square" | "measure" | "pan";

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
  mode: "none" | "pan" | "handle" | "object" | "draw-line" | "draw-shape" | "draw-measure";
  startWorld: GraphPoint;
  historySnapshot?: GraphSnapshot;
  historyPushed: boolean;
  target?: HandleTarget;
  objectTarget?: ObjectTarget;
};

const START_VIEW: ViewState = {
  offsetX: 0,
  offsetY: 0,
  pixelsPerUnit: 64,
};

const MIN_ZOOM = 12;
const MAX_ZOOM = 480;
const ZOOM_BUTTON_STEP = 1;
const WHEEL_ZOOM_PX_PER_DELTA = 0.01;
const SNAP_STEPS = [1, 0.5, 0.25, 0.1, 0.05, 0.01];
const COLOR_SWATCHES = ["#28666e", "#7a4f9a", "#d94f30", "#2f8f5b", "#c28a16", "#24211e"];
const SUBGRID_STEP = 0.25;
const TAP_THRESHOLD_PX = 6;
const DRAW_LINE_THRESHOLD_PX = 18;
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getCanvasDpr = () => Math.min(3, Math.max(2, window.devicePixelRatio || 1));

const crispLine = (value: number) => Math.round(value) + 0.5;

const roundCoordinate = (value: number) => {
  if (Math.abs(value) < 0.000001) return 0;
  return Number(value.toFixed(4));
};

const niceStep = (rawStep: number) => {
  const exponent = Math.floor(Math.log10(rawStep));
  const base = rawStep / 10 ** exponent;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exponent;
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
});

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

  const [view, setView] = useState<ViewState>(START_VIEW);
  const [points, setPoints] = useState<GraphPoint[]>([]);
  const [lines, setLines] = useState<GraphLine[]>([]);
  const [curves, setCurves] = useState<GraphCurve[]>([]);
  const [shapes, setShapes] = useState<GraphShape[]>([]);
  const [measures, setMeasures] = useState<GraphMeasure[]>([]);
  const [dataPlots, setDataPlots] = useState<DataPlot[]>([]);
  const [draftPoints, setDraftPoints] = useState<GraphPoint[]>([]);
  const [tool, setTool] = useState<Tool>("plot");
  const [selectedColor, setSelectedColor] = useState(COLOR_SWATCHES[0]);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapStep, setSnapStep] = useState(0.1);
  const [connectPoints, setConnectPoints] = useState(false);
  const [cursor, setCursor] = useState<GraphPoint | null>(null);
  const [manualX, setManualX] = useState("");
  const [manualY, setManualY] = useState("");
  const [dataName, setDataName] = useState("Data set");
  const [dataInput, setDataInput] = useState("0, 0\n1, 1\n2, 4\n3, 9");
  const [dataPlotStyle, setDataPlotStyle] = useState<DataPlotStyle>("scatter");
  const [dataError, setDataError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedObject, setSelectedObject] = useState<ObjectTarget | null>(null);
  const [hoverMenu, setHoverMenu] = useState<HoverMenu | null>(null);
  const [hoverSnapPoint, setHoverSnapPoint] = useState<HoverSnapPoint | null>(null);
  const [calculatorGuide, setCalculatorGuide] = useState<CalculatorGuide | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const selectTool = (nextTool: Tool) => {
    setTool(nextTool);
    setDraftPoints([]);
  };

  const getGraphSnapshot = (): GraphSnapshot =>
    cloneSnapshot({
      points,
      lines,
      curves,
      shapes,
      measures,
      dataPlots,
    });

  const restoreGraphSnapshot = (snapshot: GraphSnapshot) => {
    const next = cloneSnapshot(snapshot);
    setPoints(next.points);
    setLines(next.lines);
    setCurves(next.curves);
    setShapes(next.shapes);
    setMeasures(next.measures);
    setDataPlots(next.dataPlots);
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

  const addWorldPoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pushHistory();
    setPoints((current) => [
      ...current,
      {
        id: nextPointId.current++,
        x: roundCoordinate(x),
        y: roundCoordinate(y),
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
    setLines((current) => [
      ...current,
      {
        id: nextLineId.current++,
        a,
        b,
        color: selectedColor,
        showLabel: true,
      },
    ]);
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
          point.id === target.id ? { ...point, x: nextPoint.x, y: nextPoint.y } : point
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
      },
    ]);
    fitViewToValues(parsed.values);
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

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    stopPanInertia();
    event.currentTarget.setPointerCapture(event.pointerId);
    const isAuxiliaryPanGesture = (event.buttons & 6) !== 0;
    const rawTarget =
      !isAuxiliaryPanGesture
        ? findNearestHandle(event.clientX, event.clientY)
        : null;
    const isMeasuringFromPlottedPoint = tool === "measure" && rawTarget?.kind === "point";
    const target = isMeasuringFromPlottedPoint ? null : rawTarget;
    const objectTarget =
      !isAuxiliaryPanGesture && !target && !isMeasuringFromPlottedPoint
        ? findNearestObject(event.clientX, event.clientY)
        : null;
    const startWorld =
      tool === "measure"
        ? getMeasurePoint(event.clientX, event.clientY)
        : {
            id: 0,
            ...snapPoint(screenToWorld(event.clientX, event.clientY)),
          };
    if (target && target.kind !== "point" && target.kind !== "data") {
      setSelectedObject({ kind: target.kind, id: target.id });
    } else {
      setSelectedObject(objectTarget);
    }
    if (objectTarget || (target && target.kind !== "point" && target.kind !== "data")) {
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
        : objectTarget && tool !== "plot"
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
      const nextPoint = snapPoint(screenToWorld(event.clientX, event.clientY));
      setDraftPoints([
        drag.startWorld,
        { id: 0, x: nextPoint.x, y: nextPoint.y },
      ]);
    }

    if (drag.mode === "draw-measure") {
      setDraftPoints([drag.startWorld, getMeasurePoint(event.clientX, event.clientY)]);
    }

    if (drag.mode === "draw-shape" && (tool === "rectangle" || tool === "square")) {
      const nextPoint = snapPoint(screenToWorld(event.clientX, event.clientY));
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
      const nextVelocityX = dx / dt;
      const nextVelocityY = dy / dt;
      drag.velocityX = drag.velocityX * 0.65 + nextVelocityX * 0.35;
      drag.velocityY = drag.velocityY * 0.65 + nextVelocityY * 0.35;
      drag.lastMoveTime = event.timeStamp;
      queuePanBy(dx, dy);
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId && drag.mode === "pan") {
      startPanInertia(drag.velocityX, drag.velocityY);
      dragRef.current = null;
      return;
    }

    if (drag && drag.pointerId === event.pointerId && drag.mode === "draw-line") {
      const endWorld = snapPoint(screenToWorld(event.clientX, event.clientY));
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
      const endWorld = snapPoint(screenToWorld(event.clientX, event.clientY));
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
        addDraftGeometryPoint(event.clientX, event.clientY);
      }
    }
    dragRef.current = null;
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    zoomTo(
      event.clientX,
      event.clientY,
      view.pixelsPerUnit - event.deltaY * WHEEL_ZOOM_PX_PER_DELTA
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
  }, [curves, lines, measures, points, selectedObject, shapes]);

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
        hoverSnapPoint,
        calculatorGuide,
        draftPoints,
        cursor,
        connectPoints,
        selectedColor,
        tool,
        selectedObject,
      });
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [calculatorGuide, connectPoints, cursor, curves, dataPlots, draftPoints, hoverSnapPoint, lines, measures, points, selectedColor, selectedObject, shapes, tool, view]);

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
        hoverSnapPoint,
        calculatorGuide,
        draftPoints,
        cursor,
        connectPoints,
        selectedColor,
        tool,
        selectedObject,
      });
    }
  }, [calculatorGuide, connectPoints, cursor, curves, dataPlots, draftPoints, hoverSnapPoint, lines, measures, points, selectedColor, selectedObject, shapes, tool, view]);

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
  const isOverlayActive = (target: ObjectTarget) =>
    isSelectedObject(selectedObject, target.kind, target.id);
  const shouldShowOverlay = (
    target: ObjectTarget,
    showLabel: boolean
  ) => showLabel;
  const formatObjectForCalculator = (target: ObjectTarget) => {
    if (target.kind === "line") {
      const line = lines.find((item) => item.id === target.id);
      return line ? formatLineEquation(line) : "Line";
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

  return (
    <main
      className="app-shell"
      style={{
        gridTemplateColumns: isSidebarCollapsed
          ? "0px 10px minmax(0, 1fr)"
          : `${sidebarWidth}px 10px minmax(0, 1fr)`,
      }}
    >
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

        <section className="control-section">
          <h2>Tool</h2>
          <div className="segmented">
            <button
              className={tool === "plot" ? "active" : ""}
              onClick={() => selectTool("plot")}
              type="button"
            >
              Plot
            </button>
            <button
              className={tool === "line" ? "active" : ""}
              onClick={() => selectTool("line")}
              type="button"
            >
              Line
            </button>
            <button
              className={tool === "curve" ? "active" : ""}
              onClick={() => selectTool("curve")}
              type="button"
            >
              Curve
            </button>
            <button
              className={tool === "rectangle" ? "active" : ""}
              onClick={() => selectTool("rectangle")}
              type="button"
            >
              Rect
            </button>
            <button
              className={tool === "square" ? "active" : ""}
              onClick={() => selectTool("square")}
              type="button"
            >
              Square
            </button>
            <button
              className={tool === "measure" ? "active" : ""}
              onClick={() => selectTool("measure")}
              type="button"
            >
              Distance
            </button>
            <button
              className={tool === "pan" ? "active" : ""}
              onClick={() => selectTool("pan")}
              type="button"
            >
              Pan
            </button>
          </div>
          <div className="color-tools">
            <span>Color</span>
            <div className="swatches">
              {COLOR_SWATCHES.map((color) => (
                <button
                  aria-label={`Select color ${color}`}
                  className={selectedColor === color ? "swatch active" : "swatch"}
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
              <label className="custom-color">
                <span>Custom</span>
                <input
                  aria-label="Custom drawing color"
                  onChange={(event) => setSelectedColor(event.target.value)}
                  type="color"
                  value={selectedColor}
                />
              </label>
            </div>
          </div>
        </section>

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
            <span>Click precision</span>
            <select
              disabled={!snapToGrid}
              onChange={(event) => setSnapStep(Number(event.target.value))}
              value={snapStep}
            >
              {SNAP_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step} unit
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
            <label className="field">
              <span>Values</span>
              <textarea
                className="data-textarea"
                onChange={(event) => setDataInput(event.target.value)}
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
                <div className="equation-row" key={plot.id}>
                  <span>DS{index + 1}</span>
                  <code>
                    {plot.name}: {plot.values.length} points
                  </code>
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
                    <code>{formatLineEquation(line)}</code>
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
                    <code>{formatCurveEquation(curve)}</code>
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
                    <code>{formatShapeLabel(shape)}</code>
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
                        ? "equation-row selected"
                        : "equation-row"
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
                      return (
                        <>
                    <span>D{index + 1}</span>
                    <code>{formatMeasureLabel(measure)}</code>
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
                <div className="point-row" key={point.id}>
                  <span>P{index + 1}</span>
                  <code>
                    ({point.x}, {point.y})
                  </code>
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
          <div>
            <strong>{getToolTitle(tool)}</strong>
            <span>
              {getToolHelp(tool, draftPoints.length)}
            </span>
          </div>
          <code>
            x: {cursor ? cursor.x : 0}, y: {cursor ? cursor.y : 0}
          </code>
        </div>
        <div className="canvas-wrap" ref={wrapperRef}>
          <canvas
            aria-label="Interactive graph canvas"
            className={tool === "pan" ? "graph-canvas pan-mode" : "graph-canvas"}
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
                label={line.showLabel ? formatLineEquation(line) : "Show label"}
                onHide={() => updateLabelVisibility(target, false)}
                onPointerDown={() => setSelectedObject(target)}
                onShow={() => updateLabelVisibility(target, true)}
                showLabel={line.showLabel}
                style={getLabelStyle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })}
              >
                <LineEditor
                  line={line}
                  onChange={(next) => updateLineFromEquation(line.id, next)}
                />
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
                label={curve.showLabel ? formatCurveEquation(curve) : "Show label"}
                onHide={() => updateLabelVisibility(target, false)}
                onPointerDown={() => setSelectedObject(target)}
                onShow={() => updateLabelVisibility(target, true)}
                showLabel={curve.showLabel}
                style={getLabelStyle(getCanvasPoint(curve.b))}
              >
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
                label={shape.showLabel ? formatShapeLabel(shape) : "Show label"}
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
            const a = getCanvasPoint(measure.a);
            const b = getCanvasPoint(measure.b);
            const active = isOverlayActive(target);
            return (
              <InlineGraphLabel
                active={active}
                color={measure.color}
                key={`measure-label-${measure.id}`}
                label={measure.showLabel ? formatMeasureLabel(measure) : "Show label"}
                onHide={() => updateLabelVisibility(target, false)}
                onPointerDown={() => setSelectedObject(target)}
                onShow={() => updateLabelVisibility(target, true)}
                showLabel={measure.showLabel}
                style={getLabelStyle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })}
              >
                <MeasureDetails measure={measure} />
              </InlineGraphLabel>
            );
          })}
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

const getToolTitle = (tool: Tool) => {
  if (tool === "plot") return "Plot mode";
  if (tool === "line") return "Line mode";
  if (tool === "curve") return "Curve mode";
  if (tool === "rectangle") return "Rectangle mode";
  if (tool === "square") return "Square mode";
  if (tool === "measure") return "Distance mode";
  return "Pan mode";
};

const getToolHelp = (tool: Tool, draftCount: number) => {
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

const formatNumber = (value: number) => {
  const rounded = roundCoordinate(value);
  return `${rounded}`;
};

const formatSignedTerm = (coefficient: number, variable: string) => {
  if (Math.abs(coefficient) < 0.000001) return "";
  const sign = coefficient < 0 ? " - " : " + ";
  const amount = Math.abs(roundCoordinate(coefficient));
  const number = amount === 1 && variable ? "" : `${amount}`;
  return `${sign}${number}${variable}`;
};

type LineParts =
  | { vertical: true; x: number }
  | { vertical: false; m: number; b: number };

const getLineParts = (line: GraphLine): LineParts => {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  if (Math.abs(dx) < 0.000001) {
    return { vertical: true, x: line.a.x };
  }
  const m = dy / dx;
  const b = line.a.y - m * line.a.x;
  return { vertical: false, m, b };
};

const formatLineEquation = (line: GraphLine) => {
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

const getQuadraticCoefficients = (curve: GraphCurve) => {
  const { a: p1, b: p2, c: p3 } = curve;
  const d =
    (p1.x - p2.x) *
    (p1.x - p3.x) *
    (p2.x - p3.x);

  if (Math.abs(d) < 0.000001) return null;

  const a =
    (p3.x * (p2.y - p1.y) +
      p2.x * (p1.y - p3.y) +
      p1.x * (p3.y - p2.y)) /
    d;
  const b =
    (p3.x ** 2 * (p1.y - p2.y) +
      p2.x ** 2 * (p3.y - p1.y) +
      p1.x ** 2 * (p2.y - p3.y)) /
    d;
  const c =
    (p2.x * p3.x * (p2.x - p3.x) * p1.y +
      p3.x * p1.x * (p3.x - p1.x) * p2.y +
      p1.x * p2.x * (p1.x - p2.x) * p3.y) /
    d;

  return { a, b, c };
};

const formatCurveEquation = (curve: GraphCurve) => {
  const coefficients = getQuadraticCoefficients(curve);
  if (!coefficients) return "Need 3 different x-values";

  const a = roundCoordinate(coefficients.a);
  const b = roundCoordinate(coefficients.b);
  const c = roundCoordinate(coefficients.c);

  let equation = "y = ";
  if (Math.abs(a) < 0.000001) {
    equation += "0";
  } else if (a === 1) {
    equation += "x^2";
  } else if (a === -1) {
    equation += "-x^2";
  } else {
    equation += `${a}x^2`;
  }

  equation += formatSignedTerm(b, "x");
  if (Math.abs(c) >= 0.000001) {
    equation += c < 0 ? ` - ${Math.abs(c)}` : ` + ${c}`;
  }

  return equation;
};

const getShapeBounds = (shape: Pick<GraphShape, "a" | "b">) => {
  const x = Math.min(shape.a.x, shape.b.x);
  const y = Math.min(shape.a.y, shape.b.y);
  const width = Math.abs(shape.b.x - shape.a.x);
  const height = Math.abs(shape.b.y - shape.a.y);
  return { x, y, width, height };
};

const formatShapeLabel = (shape: GraphShape) => {
  const bounds = getShapeBounds(shape);
  if (shape.type === "square") {
    return `square: side ${formatNumber(bounds.width)}`;
  }
  return `rectangle: ${formatNumber(bounds.width)} x ${formatNumber(bounds.height)}`;
};

const getDistance = (a: GraphPoint, b: GraphPoint) =>
  Math.hypot(b.x - a.x, b.y - a.y);

const formatMeasureLabel = (measure: GraphMeasure) =>
  `d = ${formatNumber(getDistance(measure.a, measure.b))}`;

const getObjectTitle = (target: ObjectTarget) => {
  if (target.kind === "line") return "Line";
  if (target.kind === "curve") return "Curve";
  if (target.kind === "shape") return "Shape";
  return "Distance";
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};

const InlineGraphLabel = ({
  active,
  children,
  color,
  label,
  onHide,
  onPointerDown,
  onShow,
  showLabel,
  style,
}: {
  active: boolean;
  children: ReactNode;
  color: string;
  label: string;
  onHide: () => void;
  onPointerDown: () => void;
  onShow: () => void;
  showLabel: boolean;
  style: { left: number; top: number };
}) => (
  <div
    className={active ? "inline-graph-label active" : "inline-graph-label"}
    onPointerDown={(event) => {
      event.stopPropagation();
      onPointerDown();
      if (!showLabel) onShow();
    }}
    style={{
      ...style,
      borderColor: color,
      color,
    }}
  >
    <div className="inline-label-main">
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
    hoverSnapPoint: HoverSnapPoint | null;
    calculatorGuide: CalculatorGuide | null;
    draftPoints: GraphPoint[];
    cursor: GraphPoint | null;
    connectPoints: boolean;
    selectedColor: string;
    tool: Tool;
    selectedObject: ObjectTarget | null;
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
      drawVisibleLine();
    }

    context.strokeStyle = line.color;
    context.lineWidth = 2.5;
    drawVisibleLine();

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

    [measure.a, measure.b].forEach((point, handleIndex) => {
      drawHandle(context, toScreen(point), measure.color);
      context.fillStyle = "#24211e";
      context.fillText(`D${index + 1}.${handleIndex + 1}`, toScreen(point).x + 9, toScreen(point).y - 18);
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
    context.beginPath();
    context.fillStyle = "#d94f30";
    context.strokeStyle = "#7f2a18";
    context.lineWidth = 2;
    context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#24211e";
    context.fillText(`P${index + 1}`, screen.x + 9, screen.y - 18);
  });

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

const parseDataValues = (
  input: string
): { ok: true; values: DataValue[] } | { ok: false; message: string } => {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Enter at least one x, y pair. Example: 1, 2",
    };
  }

  const jsonValues = parseJsonDataValues(trimmed);
  if (jsonValues.length > 0) return { ok: true, values: jsonValues };

  const rows = trimmed
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map(splitDataRow);

  const numericRows = rows
    .map((row) => row.map(readNumberFromCell))
    .filter((row) => row.some((value) => value !== null));
  const maxColumns = Math.max(...numericRows.map((row) => row.length), 0);
  const columnCounts = Array.from({ length: maxColumns }, (_, column) =>
    numericRows.filter((row) => row[column] !== null).length
  );
  const bestColumns = columnCounts
    .map((count, column) => ({ count, column }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.column - b.column);
  const xColumn = bestColumns[0]?.column ?? -1;
  const yColumn = bestColumns[1]?.column ?? -1;
  const values: DataValue[] = [];

  numericRows.forEach((row, index) => {
    const xValue = row[xColumn];
    const yValue = row[yColumn];
    if (
      xColumn >= 0 &&
      yColumn >= 0 &&
      typeof xValue === "number" &&
      typeof yValue === "number"
    ) {
      values.push({
        x: roundCoordinate(xValue),
        y: roundCoordinate(yValue),
      });
      return;
    }

    const numericCells = row.filter((value): value is number => value !== null);
    if (numericCells.length >= 2) {
      values.push({
        x: roundCoordinate(numericCells[0]),
        y: roundCoordinate(numericCells[1]),
      });
      return;
    }

    if (numericCells.length === 1) {
      values.push({
        x: index,
        y: roundCoordinate(numericCells[0]),
      });
    }
  });

  if (values.length === 0) {
    return { ok: false, message: "I could not find numeric data in that input." };
  }

  return { ok: true, values };
};

const parseJsonDataValues = (input: string) => {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!Array.isArray(parsed)) return [];
    const values: DataValue[] = [];
    parsed.forEach((item, index) => {
      if (Array.isArray(item)) {
        const numeric = item
          .map((value) => readNumberFromCell(String(value)))
          .filter((value): value is number => value !== null);
        if (numeric.length >= 2) {
          values.push({ x: roundCoordinate(numeric[0]), y: roundCoordinate(numeric[1]) });
        } else if (numeric.length === 1) {
          values.push({ x: index, y: roundCoordinate(numeric[0]) });
        }
        return;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const entries = Object.entries(record);
        const xEntry =
          entries.find(([key]) => /^x$|time|date|year/i.test(key)) ??
          entries.find(([, value]) => readNumberFromCell(String(value)) !== null);
        const yEntry =
          entries.find(([key]) => /^y$|value|amount|price|count|score/i.test(key)) ??
          entries.find(
            ([key, value]) =>
              key !== xEntry?.[0] && readNumberFromCell(String(value)) !== null
          );
        const x = xEntry ? readNumberFromCell(String(xEntry[1])) : null;
        const y = yEntry ? readNumberFromCell(String(yEntry[1])) : null;
        if (x !== null && y !== null) {
          values.push({ x: roundCoordinate(x), y: roundCoordinate(y) });
        } else if (y !== null) {
          values.push({ x: index, y: roundCoordinate(y) });
        }
      }
    });
    return values;
  } catch {
    return [];
  }
};

const splitDataRow = (row: string) => {
  const matches = row.match(/"[^"]*"|'[^']*'|[^,\t; ]+/g);
  return matches?.map((cell) => cell.replace(/^["']|["']$/g, "")) ?? [];
};

const readNumberFromCell = (cell: string) => {
  const normalized = cell.trim().replace(/,/g, "");
  const match = normalized.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
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
      drawDataPoint(context, top, plot.color);
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
    drawDataPoint(context, toScreen({ id: 0, x: value.x, y: value.y }), plot.color);
  });
};

const drawDataPoint = (
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string
) => {
  context.beginPath();
  context.fillStyle = "#ffffff";
  context.strokeStyle = color;
  context.lineWidth = 2.2;
  context.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
};

const isSelectedObject = (
  selected: ObjectTarget | null,
  kind: ObjectTarget["kind"],
  id: number
) => selected?.kind === kind && selected.id === id;

const distanceToSegment = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1
  );
  const projection = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
};

const closestPointOnSegmentWorld = (
  point: { x: number; y: number },
  a: GraphPoint,
  b: GraphPoint
): GraphPoint => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return { id: 0, x: a.x, y: a.y };
  }

  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1
  );
  return {
    id: 0,
    x: roundCoordinate(a.x + t * dx),
    y: roundCoordinate(a.y + t * dy),
  };
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
