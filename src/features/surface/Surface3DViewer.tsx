import { useEffect, useRef } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type {
  SurfaceDataPoint,
  SurfaceShape,
  SurfaceStroke,
  SurfaceTool,
  SurfaceVector3,
} from "../../graphTypes";

type Surface3DViewerProps = {
  color: string;
  cutX: number;
  cutY: number;
  cutZ: number;
  dataPoints: SurfaceDataPoint[];
  equation: string;
  mouseSensitivity: number;
  onAddDataPoint: (point: SurfaceVector3, color: string) => void;
  onAddStroke: (stroke: Omit<SurfaceStroke, "id">) => void;
  onColorShape: (id: number, color: string) => void;
  onSelectShape: (id: number) => void;
  onTransformShape: (
    id: number,
    transform: { position?: SurfaceVector3; scale?: SurfaceVector3 }
  ) => void;
  paintColor: string;
  range: number;
  renderer: "canvas" | "gpu";
  resolution: number;
  selectedShapeId: number;
  shapes: SurfaceShape[];
  showContour: boolean;
  showSlices: boolean;
  strokes: SurfaceStroke[];
  tool: SurfaceTool;
  zoomSensitivity: number;
};

const SAFE_NAMES = [
  "abs",
  "acos",
  "asin",
  "atan",
  "cos",
  "exp",
  "log",
  "log10",
  "max",
  "min",
  "pow",
  "sin",
  "sqrt",
  "tan",
  "PI",
  "E",
];

export const Surface3DViewer = ({
  color,
  cutX,
  cutY,
  cutZ,
  dataPoints,
  equation,
  mouseSensitivity,
  onAddDataPoint,
  onAddStroke,
  onColorShape,
  onSelectShape,
  onTransformShape,
  paintColor,
  range,
  renderer,
  resolution,
  selectedShapeId,
  shapes,
  showContour,
  showSlices,
  strokes,
  tool,
  zoomSensitivity,
}: Surface3DViewerProps) => {
  if (renderer === "canvas") {
    return (
      <SurfaceCanvasViewer
        color={color}
        cutX={cutX}
        cutY={cutY}
        cutZ={cutZ}
        dataPoints={dataPoints}
        equation={equation}
        mouseSensitivity={mouseSensitivity}
        onAddDataPoint={onAddDataPoint}
        onAddStroke={onAddStroke}
        onColorShape={onColorShape}
        onSelectShape={onSelectShape}
        onTransformShape={onTransformShape}
        paintColor={paintColor}
        range={range}
        resolution={resolution}
        selectedShapeId={selectedShapeId}
        shapes={shapes}
        showContour={showContour}
        showSlices={showSlices}
        strokes={strokes}
        tool={tool}
        zoomSensitivity={zoomSensitivity}
      />
    );
  }

  return (
    <SurfaceGpuViewer
      color={color}
      cutX={cutX}
      cutY={cutY}
      cutZ={cutZ}
      dataPoints={dataPoints}
      equation={equation}
      mouseSensitivity={mouseSensitivity}
      onAddDataPoint={onAddDataPoint}
      onAddStroke={onAddStroke}
      onColorShape={onColorShape}
      onSelectShape={onSelectShape}
      onTransformShape={onTransformShape}
      paintColor={paintColor}
      range={range}
      resolution={resolution}
      selectedShapeId={selectedShapeId}
      shapes={shapes}
      showContour={showContour}
      showSlices={showSlices}
      strokes={strokes}
      tool={tool}
      zoomSensitivity={zoomSensitivity}
    />
  );
};

const SurfaceGpuViewer = ({
  color,
  cutX,
  cutY,
  cutZ,
  dataPoints,
  equation,
  mouseSensitivity,
  onAddDataPoint,
  onAddStroke,
  onColorShape,
  onSelectShape,
  onTransformShape,
  paintColor,
  range,
  resolution,
  selectedShapeId,
  shapes,
  showContour,
  showSlices,
  strokes,
  tool,
  zoomSensitivity,
}: Omit<Surface3DViewerProps, "renderer">) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const surfaceRef = useRef<THREE.Object3D | null>(null);
  const gridRef = useRef<THREE.Object3D | null>(null);
  const axesRef = useRef<THREE.Object3D | null>(null);
  const slicesRef = useRef<THREE.Object3D | null>(null);
  const strokesRef = useRef<THREE.Object3D | null>(null);
  const dataPointsRef = useRef<THREE.Object3D | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const shapeObjectsRef = useRef(new Map<number, THREE.Object3D>());
  const transformControlsRef = useRef<TransformControls | null>(null);
  const transformHelperRef = useRef<THREE.Object3D | null>(null);
  const cameraTargetRef = useRef(new THREE.Vector3());
  const interactionRef = useRef({
    tool,
    selectedShapeId,
    shapes,
    paintColor,
    onSelectShape,
    onTransformShape,
    onAddDataPoint,
    onAddStroke,
    onColorShape,
  });
  const rotationRef = useRef({ x: -0.45, y: 0.55 });
  const sensitivityRef = useRef({ mouse: mouseSensitivity, zoom: zoomSensitivity });

  useEffect(() => {
    sensitivityRef.current = { mouse: mouseSensitivity, zoom: zoomSensitivity };
  }, [mouseSensitivity, zoomSensitivity]);

  useEffect(() => {
    interactionRef.current = {
      tool,
      selectedShapeId,
      shapes,
      paintColor,
      onSelectShape,
      onTransformShape,
      onAddDataPoint,
      onAddStroke,
      onColorShape,
    };
  }, [
    onAddDataPoint,
    onAddStroke,
    onColorShape,
    onSelectShape,
    onTransformShape,
    paintColor,
    selectedShapeId,
    shapes,
    tool,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, Math.max(4, range * 0.8), Math.max(12, range * 2.7));
    camera.lookAt(cameraTargetRef.current);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = false;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const content = new THREE.Group();
    content.rotation.x = rotationRef.current.x;
    content.rotation.y = rotationRef.current.y;
    scene.add(content);
    contentRef.current = content;

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(6, 10, 7);
    scene.add(keyLight);

    sceneRef.current = scene;
    const transformControls = new TransformControls(camera, renderer.domElement);
    const transformHelper = transformControls.getHelper();
    transformHelper.visible = false;
    scene.add(transformHelper);
    transformControlsRef.current = transformControls;
    transformHelperRef.current = transformHelper;
    let transformDragging = false;
    const handleTransformDragging = (event: { value?: unknown }) => {
      transformDragging = Boolean(event.value);
    };
    const handleTransformChange = () => {
      const object = transformControls.object;
      const shapeId = Number(object?.userData.surfaceShapeId);
      if (!object || !Number.isFinite(shapeId)) return;
      interactionRef.current.onTransformShape(shapeId, {
        position: vectorToSurfaceVector(object.position),
        scale: vectorToSurfaceVector(object.scale),
      });
    };
    transformControls.addEventListener("dragging-changed", handleTransformDragging);
    transformControls.addEventListener("objectChange", handleTransformChange);

    const pointerState = {
      active: false,
      drawing: false,
      painting: false,
      paintedShapeId: 0,
      transforming: false,
      transformShapeId: 0,
      transformTool: "select" as SurfaceTool,
      transformStartScale: new THREE.Vector3(1, 1, 1),
      transformObject: null as THREE.Object3D | null,
      strokePoints: [] as THREE.Vector3[],
      lastX: 0,
      lastY: 0,
    };
    let liveStroke: THREE.Line | null = null;
    const clearLiveStroke = () => {
      if (!liveStroke) return;
      content.remove(liveStroke);
      disposeObject3D(liveStroke);
      liveStroke = null;
    };
    const updateLiveStroke = (points: THREE.Vector3[], activeTool: SurfaceTool) => {
      if (points.length < 2) return;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      if (liveStroke) {
        liveStroke.geometry.dispose();
        liveStroke.geometry = geometry;
        return;
      }
      const material = new THREE.LineBasicMaterial({
        color: interactionRef.current.paintColor,
        depthTest: false,
        opacity: activeTool === "pencil" ? 0.58 : 1,
        transparent: activeTool === "pencil",
      });
      liveStroke = new THREE.Line(
        geometry,
        material
      );
      liveStroke.renderOrder = 18;
      content.add(liveStroke);
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setRayFromPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };
    const findSurfaceHit = (event: PointerEvent) => {
      setRayFromPointer(event);
      const hit = raycaster.intersectObjects([...shapeObjectsRef.current.values()], true)[0];
      if (!hit) return null;
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.surfaceShapeId) object = object.parent;
      const shapeId = Number(object?.userData.surfaceShapeId);
      return Number.isFinite(shapeId) ? { point: hit.point, shapeId } : null;
    };
    const findGridPoint = (event: PointerEvent) => {
      setRayFromPointer(event);
      const worldPoint = new THREE.Vector3();
      const worldNormal = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(content.quaternion)
        .normalize();
      const workPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        worldNormal,
        content.localToWorld(new THREE.Vector3())
      );
      const hit = raycaster.ray.intersectPlane(workPlane, worldPoint);
      if (!hit) return null;
      const localPoint = content.worldToLocal(worldPoint);
      const insideGrid =
        Math.abs(localPoint.x) <= range &&
        Math.abs(localPoint.z) <= range;
      return insideGrid ? localPoint : null;
    };
    const getToolPoint = (event: PointerEvent) => {
      const hit = findSurfaceHit(event);
      return hit ? content.worldToLocal(hit.point.clone()) : findGridPoint(event);
    };
    const beginShapeTransform = (
      shapeId: number,
      activeTool: SurfaceTool,
      event: PointerEvent
    ) => {
      const shapeObject = shapeObjectsRef.current.get(shapeId);
      if (!shapeObject) return false;
      pointerState.transforming = true;
      pointerState.transformShapeId = shapeId;
      pointerState.transformTool = activeTool;
      pointerState.transformStartScale.copy(shapeObject.scale);
      pointerState.transformObject = shapeObject;
      pointerState.lastX = event.clientX;
      pointerState.lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      return true;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 2) {
        event.preventDefault();
        pointerState.active = true;
        pointerState.lastX = event.clientX;
        pointerState.lastY = event.clientY;
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button !== 0) return;
      if (transformDragging) return;
      const hit = findSurfaceHit(event);
      const activeTool = interactionRef.current.tool;
      if (hit) {
        interactionRef.current.onSelectShape(hit.shapeId);
        if (activeTool === "fill" || activeTool === "paint") {
          interactionRef.current.onColorShape(
            hit.shapeId,
            interactionRef.current.paintColor
          );
          if (activeTool === "paint") {
            pointerState.painting = true;
            pointerState.paintedShapeId = hit.shapeId;
            renderer.domElement.setPointerCapture(event.pointerId);
          }
          return;
        }
        if (activeTool === "data") {
          interactionRef.current.onAddDataPoint(
            vectorToSurfaceVector(content.worldToLocal(hit.point.clone())),
            interactionRef.current.paintColor
          );
          return;
        }
        if (activeTool === "pen" || activeTool === "pencil") {
          const point = getToolPoint(event);
          if (!point) return;
          pointerState.drawing = true;
          pointerState.strokePoints = [point];
          renderer.domElement.setPointerCapture(event.pointerId);
          return;
        }
        if (
          activeTool === "scale" ||
          activeTool === "stretch" ||
          activeTool === "shrink"
        ) {
          beginShapeTransform(hit.shapeId, activeTool, event);
          return;
        }
      }
      const gridPoint = findGridPoint(event);
      if (activeTool === "data" && gridPoint) {
        interactionRef.current.onAddDataPoint(
          vectorToSurfaceVector(gridPoint),
          interactionRef.current.paintColor
        );
        return;
      }
      if ((activeTool === "pen" || activeTool === "pencil") && gridPoint) {
        pointerState.drawing = true;
        pointerState.strokePoints = [gridPoint];
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      if (
        gridPoint &&
        (activeTool === "scale" ||
          activeTool === "stretch" ||
          activeTool === "shrink") &&
        beginShapeTransform(interactionRef.current.selectedShapeId, activeTool, event)
      ) {
        return;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerState.drawing) {
        const point = getToolPoint(event);
        const previous = pointerState.strokePoints.at(-1);
        if (point && (!previous || previous.distanceTo(point) > range / 120)) {
          pointerState.strokePoints.push(point);
          updateLiveStroke(pointerState.strokePoints, interactionRef.current.tool);
        }
        return;
      }
      if (pointerState.painting) {
        const hit = findSurfaceHit(event);
        if (hit && hit.shapeId !== pointerState.paintedShapeId) {
          interactionRef.current.onSelectShape(hit.shapeId);
          interactionRef.current.onColorShape(
            hit.shapeId,
            interactionRef.current.paintColor
          );
          pointerState.paintedShapeId = hit.shapeId;
        }
        return;
      }
      if (pointerState.transforming && pointerState.transformObject) {
        const dx = event.clientX - pointerState.lastX;
        const dy = event.clientY - pointerState.lastY;
        const start = pointerState.transformStartScale;
        const scale = pointerState.transformObject.scale;
        if (pointerState.transformTool === "stretch") {
          const xFactor = THREE.MathUtils.clamp(1 + dx * 0.012, 0.08, 18);
          const zFactor = THREE.MathUtils.clamp(1 - dy * 0.012, 0.08, 18);
          scale.set(
            clampShapeScale(start.x * xFactor),
            clampShapeScale(start.y),
            clampShapeScale(start.z * zFactor)
          );
        } else if (pointerState.transformTool === "shrink") {
          const factor = Math.exp(-Math.hypot(dx, dy) * 0.008);
          scale.set(
            clampShapeScale(start.x * factor),
            clampShapeScale(start.y * factor),
            clampShapeScale(start.z * factor)
          );
        } else {
          const factor = THREE.MathUtils.clamp(
            Math.exp(-dy * 0.01),
            0.08,
            18
          );
          scale.set(
            clampShapeScale(start.x * factor),
            clampShapeScale(start.y * factor),
            clampShapeScale(start.z * factor)
          );
        }
        return;
      }
      if (!pointerState.active) return;
      if (transformDragging) return;
      const dx = event.clientX - pointerState.lastX;
      const dy = event.clientY - pointerState.lastY;
      pointerState.lastX = event.clientX;
      pointerState.lastY = event.clientY;

      rotationRef.current.y += dx * 0.008 * sensitivityRef.current.mouse;
      rotationRef.current.x = Math.max(
        -Math.PI * 0.48,
        Math.min(
          Math.PI * 0.48,
          rotationRef.current.x + dy * 0.008 * sensitivityRef.current.mouse
        )
      );
      content.rotation.x = rotationRef.current.x;
      content.rotation.y = rotationRef.current.y;
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (pointerState.drawing) {
        pointerState.drawing = false;
        if (pointerState.strokePoints.length > 1) {
          interactionRef.current.onAddStroke({
            color: interactionRef.current.paintColor,
            opacity: interactionRef.current.tool === "pencil" ? 0.58 : 1,
            points: pointerState.strokePoints.map(vectorToSurfaceVector),
          });
        }
        pointerState.strokePoints = [];
        clearLiveStroke();
      }
      if (pointerState.transforming && pointerState.transformObject) {
        interactionRef.current.onTransformShape(pointerState.transformShapeId, {
          scale: vectorToSurfaceVector(pointerState.transformObject.scale),
        });
      }
      pointerState.painting = false;
      pointerState.paintedShapeId = 0;
      pointerState.transforming = false;
      pointerState.transformShapeId = 0;
      pointerState.transformTool = "select";
      pointerState.transformObject = null;
      pointerState.active = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pinchZoom = event.ctrlKey || event.metaKey;
      const looksLikeTrackpadPan =
        !pinchZoom &&
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
        (Math.abs(event.deltaX) > 0.5 || Math.abs(event.deltaY) < 80);
      if (looksLikeTrackpadPan) {
        const cameraDirection = cameraTargetRef.current.clone().sub(camera.position).normalize();
        const panRight = new THREE.Vector3().crossVectors(cameraDirection, camera.up).normalize();
        const panUp = camera.up.clone().normalize();
        const visibleHeight =
          2 *
          camera.position.distanceTo(cameraTargetRef.current) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const rect = renderer.domElement.getBoundingClientRect();
        const unitsPerPixel = visibleHeight / Math.max(1, rect.height);
        const pan = panRight
          .multiplyScalar(event.deltaX * unitsPerPixel * sensitivityRef.current.mouse)
          .addScaledVector(
            panUp,
            -event.deltaY * unitsPerPixel * sensitivityRef.current.mouse
          );
        camera.position.add(pan);
        cameraTargetRef.current.add(pan);
        camera.lookAt(cameraTargetRef.current);
        return;
      }
      const zoom = THREE.MathUtils.clamp(
        1 + event.deltaY * 0.0012 * sensitivityRef.current.zoom,
        0.55,
        1.8
      );
      const nextDistance = THREE.MathUtils.clamp(
        camera.position.distanceTo(cameraTargetRef.current) * zoom,
        4,
        70
      );
      camera.position
        .sub(cameraTargetRef.current)
        .setLength(nextDistance)
        .add(cameraTargetRef.current);
      camera.lookAt(cameraTargetRef.current);
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    let frame = 0;
    const animate = () => {
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      transformControls.removeEventListener("dragging-changed", handleTransformDragging);
      transformControls.removeEventListener("objectChange", handleTransformChange);
      transformControls.dispose();
      disposeObject3D(surfaceRef.current);
      disposeObject3D(gridRef.current);
      disposeObject3D(axesRef.current);
      disposeObject3D(slicesRef.current);
      disposeObject3D(strokesRef.current);
      disposeObject3D(dataPointsRef.current);
      clearLiveStroke();
      sceneRef.current = null;
      contentRef.current = null;
      surfaceRef.current = null;
      gridRef.current = null;
      axesRef.current = null;
      slicesRef.current = null;
      strokesRef.current = null;
      dataPointsRef.current = null;
      shapeObjectsRef.current.clear();
      transformControlsRef.current = null;
      transformHelperRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    if (surfaceRef.current) content.remove(surfaceRef.current);
    if (gridRef.current) content.remove(gridRef.current);
    if (axesRef.current) content.remove(axesRef.current);
    if (slicesRef.current) content.remove(slicesRef.current);
    disposeObject3D(surfaceRef.current);
    disposeObject3D(gridRef.current);
    disposeObject3D(axesRef.current);
    disposeObject3D(slicesRef.current);

    const grid = new THREE.GridHelper(
      range * 2,
      Math.max(8, Math.round(range * 2)),
      0x777777,
      0xd5d5d5
    );
    const axes = buildAxes(range);
    const surface = new THREE.Group();
    shapeObjectsRef.current.clear();
    shapes.forEach((shape) => {
      const shapeObject = buildSurfaceMesh(
        compileSurfaceEquation(shape.equation),
        range,
        resolution,
        shape.color
      );
      shapeObject.userData.surfaceShapeId = shape.id;
      shapeObject.position.set(shape.position.x, shape.position.y, shape.position.z);
      shapeObject.scale.set(shape.scale.x, shape.scale.y, shape.scale.z);
      shapeObjectsRef.current.set(shape.id, shapeObject);
      surface.add(shapeObject);
    });
    const evaluator = compileSurfaceEquation(equation);
    const slices = showSlices
      ? buildSurfaceSlices(evaluator, range, resolution, cutX, cutY, cutZ)
      : new THREE.Group();

    content.add(grid);
    content.add(axes);
    content.add(surface);
    content.add(slices);
    gridRef.current = grid;
    axesRef.current = axes;
    surfaceRef.current = surface;
    slicesRef.current = slices;
  }, [cutX, cutY, cutZ, equation, range, resolution, shapes, showSlices]);

  useEffect(() => {
    const controls = transformControlsRef.current;
    const helper = transformHelperRef.current;
    const selectedObject = shapeObjectsRef.current.get(selectedShapeId);
    if (!controls || !helper) return;
    const transformable =
      tool === "select" ||
      tool === "scale" ||
      tool === "stretch" ||
      tool === "shrink";
    if (!selectedObject || !transformable) {
      controls.detach();
      helper.visible = false;
      return;
    }
    controls.attach(selectedObject);
    helper.visible = true;
    controls.setMode(tool === "select" ? "translate" : "scale");
    controls.setSpace("local");
    controls.setSize(tool === "select" ? 0.72 : 0.62);
  }, [selectedShapeId, shapes, tool]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (strokesRef.current) content.remove(strokesRef.current);
    if (dataPointsRef.current) content.remove(dataPointsRef.current);
    disposeObject3D(strokesRef.current);
    disposeObject3D(dataPointsRef.current);
    const strokeGroup = buildStrokeGroup(strokes);
    const pointGroup = buildSurfaceDataPointGroup(dataPoints);
    content.add(strokeGroup);
    content.add(pointGroup);
    strokesRef.current = strokeGroup;
    dataPointsRef.current = pointGroup;
  }, [dataPoints, strokes]);

  return (
    <div className="surface-viewer" ref={hostRef}>
      <div className="surface-overlay">
        <strong>z = {equation}</strong>
        <span>Right-drag to spin. Two-finger scroll to roam. Pinch or wheel to zoom.</span>
      </div>
      {showContour ? (
        <SurfaceContourMap
          cutX={cutX}
          cutY={cutY}
          cutZ={cutZ}
          equation={equation}
          range={range}
          resolution={resolution}
          showSlices={showSlices}
        />
      ) : null}
    </div>
  );
};

const SurfaceCanvasViewer = ({
  color,
  cutX,
  cutY,
  cutZ,
  equation,
  range,
  resolution,
  showContour,
  showSlices,
}: Omit<Surface3DViewerProps, "renderer">) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      const evaluator = compileSurfaceEquation(equation);
      const cells = Math.max(24, Math.min(120, Math.round(resolution * 1.25)));
      const cellWidth = width / cells;
      const cellHeight = height / cells;
      const base = hexToRgb(color);

      for (let row = 0; row < cells; row += 1) {
        const y = range - (row / (cells - 1)) * range * 2;
        for (let col = 0; col < cells; col += 1) {
          const x = -range + (col / (cells - 1)) * range * 2;
          const z = clampSurfaceZ(evaluator(x, y), range);
          const strength = (z + range) / (range * 2);
          const light = 0.24 + strength * 0.62;
          context.fillStyle = `rgb(${mixChannel(255, base.r, light)}, ${mixChannel(
            255,
            base.g,
            light
          )}, ${mixChannel(255, base.b, light)})`;
          context.fillRect(col * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
        }
      }

      drawCanvasAxes(context, width, height);
    };

    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    draw();
    return () => observer.disconnect();
  }, [color, equation, range, resolution]);

  return (
    <div className="surface-viewer surface-viewer-canvas">
      <canvas aria-label="Canvas surface preview" ref={canvasRef} />
      <div className="surface-overlay">
        <strong>z = {equation}</strong>
        <span>Canvas 2D preview. Switch to GPU for rotation.</span>
      </div>
      {showContour ? (
        <SurfaceContourMap
          cutX={cutX}
          cutY={cutY}
          cutZ={cutZ}
          equation={equation}
          range={range}
          resolution={resolution}
          showSlices={showSlices}
        />
      ) : null}
    </div>
  );
};

const buildSurfaceMesh = (
  evaluator: (x: number, y: number) => number,
  range: number,
  resolution: number,
  color: string
) => {
  const group = new THREE.Group();
  const segments = Math.max(12, Math.min(96, Math.round(resolution)));
  const positions: number[] = [];
  const indices: number[] = [];
  const step = (range * 2) / segments;

  for (let yIndex = 0; yIndex <= segments; yIndex += 1) {
    const y = -range + yIndex * step;
    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const x = -range + xIndex * step;
      const z = clampSurfaceZ(evaluator(x, y), range);
      positions.push(x, z, y);
    }
  }

  for (let yIndex = 0; yIndex < segments; yIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = yIndex * (segments + 1) + xIndex;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    opacity: 0.88,
    roughness: 0.55,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  const wire = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: 0x1f2933,
      opacity: 0.22,
      transparent: true,
      wireframe: true,
    })
  );
  group.add(wire);

  return group;
};

const buildStrokeGroup = (strokes: SurfaceStroke[]) => {
  const group = new THREE.Group();
  strokes.forEach((stroke) => {
    if (stroke.points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(
      stroke.points.map((point) => new THREE.Vector3(point.x, point.y, point.z))
    );
    const material = new THREE.LineBasicMaterial({
      color: stroke.color,
      opacity: stroke.opacity,
      transparent: stroke.opacity < 1,
      depthTest: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 15;
    group.add(line);
  });
  return group;
};

const buildSurfaceDataPointGroup = (points: SurfaceDataPoint[]) => {
  const group = new THREE.Group();
  points.forEach((point) => {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 18, 18),
      new THREE.MeshBasicMaterial({
        color: point.color,
        depthTest: false,
      })
    );
    sphere.position.set(point.x, point.y, point.z);
    sphere.renderOrder = 16;
    group.add(sphere);
  });
  return group;
};

const vectorToSurfaceVector = (vector: THREE.Vector3): SurfaceVector3 => ({
  x: roundShapeValue(vector.x),
  y: roundShapeValue(vector.y),
  z: roundShapeValue(vector.z),
});

const clampShapeScale = (value: number) =>
  THREE.MathUtils.clamp(value, 0.08, 18);

const roundShapeValue = (value: number) => Number(value.toFixed(4));

const buildSurfaceSlices = (
  evaluator: (x: number, y: number) => number,
  range: number,
  resolution: number,
  cutX: number,
  cutY: number,
  cutZ: number
) => {
  const group = new THREE.Group();
  const segments = Math.max(32, Math.min(160, Math.round(resolution * 1.5)));
  const clampedX = THREE.MathUtils.clamp(cutX, -range, range);
  const clampedY = THREE.MathUtils.clamp(cutY, -range, range);
  const clampedZ = THREE.MathUtils.clamp(cutZ, -range, range);
  const verticalX: THREE.Vector3[] = [];
  const verticalY: THREE.Vector3[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const value = -range + (index / segments) * range * 2;
    verticalX.push(
      new THREE.Vector3(clampedX, clampSurfaceZ(evaluator(clampedX, value), range), value)
    );
    verticalY.push(
      new THREE.Vector3(value, clampSurfaceZ(evaluator(value, clampedY), range), clampedY)
    );
  }

  group.add(makeSurfaceLine(verticalX, 0xe53935));
  group.add(makeSurfaceLine(verticalY, 0x2f8f5b));

  const contourSegments = buildContourSegments(evaluator, range, segments, clampedZ);
  contourSegments.forEach(([a, b]) => {
    group.add(makeSurfaceLine([
      new THREE.Vector3(a.x, clampedZ, a.y),
      new THREE.Vector3(b.x, clampedZ, b.y),
    ], 0x3574f0));
  });

  return group;
};

const makeSurfaceLine = (points: THREE.Vector3[], color: number) => {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    linewidth: 3,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 12;
  return line;
};

type ContourPoint = { x: number; y: number };

const buildContourSegments = (
  evaluator: (x: number, y: number) => number,
  range: number,
  cells: number,
  level: number
): [ContourPoint, ContourPoint][] => {
  const segments: [ContourPoint, ContourPoint][] = [];
  const step = (range * 2) / cells;
  const interpolate = (
    a: ContourPoint,
    b: ContourPoint,
    av: number,
    bv: number
  ): ContourPoint => {
    const t = Math.abs(bv - av) < 0.000001 ? 0.5 : (level - av) / (bv - av);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  };

  for (let row = 0; row < cells; row += 1) {
    const y0 = -range + row * step;
    const y1 = y0 + step;
    for (let col = 0; col < cells; col += 1) {
      const x0 = -range + col * step;
      const x1 = x0 + step;
      const corners = [
        { point: { x: x0, y: y0 }, value: evaluator(x0, y0) },
        { point: { x: x1, y: y0 }, value: evaluator(x1, y0) },
        { point: { x: x1, y: y1 }, value: evaluator(x1, y1) },
        { point: { x: x0, y: y1 }, value: evaluator(x0, y1) },
      ];
      const intersections: ContourPoint[] = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const current = corners[edge];
        const next = corners[(edge + 1) % 4];
        const currentSide = current.value - level;
        const nextSide = next.value - level;
        if (currentSide === 0) intersections.push(current.point);
        if (currentSide * nextSide < 0) {
          intersections.push(
            interpolate(current.point, next.point, current.value, next.value)
          );
        }
      }
      if (intersections.length >= 2) {
        segments.push([intersections[0], intersections[1]]);
        if (intersections.length >= 4) segments.push([intersections[2], intersections[3]]);
      }
    }
  }
  return segments;
};

const SurfaceContourMap = ({
  cutX,
  cutY,
  cutZ,
  equation,
  range,
  resolution,
  showSlices,
}: {
  cutX: number;
  cutY: number;
  cutZ: number;
  equation: string;
  range: number;
  resolution: number;
  showSlices: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = 240;
    const height = 176;
    const plot = { x: 34, y: 18, width: 184, height: 124 };
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,0.96)";
    context.fillRect(0, 0, width, height);

    const evaluator = compileSurfaceEquation(equation);
    const cells = Math.max(28, Math.min(72, Math.round(resolution)));
    const samples: number[] = [];
    for (let row = 0; row <= cells; row += 1) {
      const y = -range + (row / cells) * range * 2;
      for (let col = 0; col <= cells; col += 1) {
        const x = -range + (col / cells) * range * 2;
        samples.push(evaluator(x, y));
      }
    }
    const min = Math.max(-range, Math.min(...samples));
    const max = Math.min(range, Math.max(...samples));
    const levels = Array.from({ length: 9 }, (_, index) =>
      min + ((index + 1) / 10) * (max - min || 1)
    );
    const toCanvas = (point: ContourPoint) => ({
      x: plot.x + ((point.x + range) / (range * 2)) * plot.width,
      y: plot.y + ((range - point.y) / (range * 2)) * plot.height,
    });

    context.strokeStyle = "#d4d8de";
    context.lineWidth = 1;
    context.strokeRect(plot.x, plot.y, plot.width, plot.height);
    levels.forEach((level, index) => {
      const hue = 210 - index * 12;
      context.strokeStyle = `hsl(${hue}, 70%, 42%)`;
      context.lineWidth = 1;
      buildContourSegments(evaluator, range, cells, level).forEach(([a, b]) => {
        const start = toCanvas(a);
        const end = toCanvas(b);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      });
    });

    if (showSlices) {
      const x = plot.x + ((THREE.MathUtils.clamp(cutX, -range, range) + range) / (range * 2)) * plot.width;
      const y = plot.y + ((range - THREE.MathUtils.clamp(cutY, -range, range)) / (range * 2)) * plot.height;
      context.setLineDash([4, 3]);
      context.strokeStyle = "#e53935";
      context.beginPath();
      context.moveTo(x, plot.y);
      context.lineTo(x, plot.y + plot.height);
      context.stroke();
      context.strokeStyle = "#2f8f5b";
      context.beginPath();
      context.moveTo(plot.x, y);
      context.lineTo(plot.x + plot.width, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#3574f0";
      context.fillText(`z=${formatSurfaceTick(cutZ)}`, plot.x + 6, plot.y + 14);
    }

    context.fillStyle = "#151719";
    context.font = "700 11px Inter, Arial, sans-serif";
    context.fillText("Contour", 8, 12);
    context.font = "600 10px Inter, Arial, sans-serif";
    context.fillText(formatSurfaceTick(-range), plot.x - 2, plot.y + plot.height + 14);
    context.fillText(formatSurfaceTick(range), plot.x + plot.width - 12, plot.y + plot.height + 14);
    context.fillText("x", plot.x + plot.width / 2 - 3, plot.y + plot.height + 28);
    context.save();
    context.translate(10, plot.y + plot.height / 2 + 4);
    context.rotate(-Math.PI / 2);
    context.fillText("y", 0, 0);
    context.restore();
    context.fillText(formatSurfaceTick(range), 8, plot.y + 4);
    context.fillText(formatSurfaceTick(-range), 8, plot.y + plot.height + 4);
  }, [cutX, cutY, cutZ, equation, range, resolution, showSlices]);

  return (
    <div className="surface-contour-panel">
      <canvas aria-label="Live contour view" ref={canvasRef} />
    </div>
  );
};

const buildAxes = (range: number) => {
  const group = new THREE.Group();
  const makeAxis = (points: THREE.Vector3[], color: number) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    return new THREE.Line(geometry, material);
  };
  const xColor = 0xd94f30;
  const zColor = 0x2f8f5b;
  const yColor = 0x28666e;
  group.add(makeAxis([new THREE.Vector3(-range, 0, 0), new THREE.Vector3(range, 0, 0)], xColor));
  group.add(makeAxis([new THREE.Vector3(0, -range, 0), new THREE.Vector3(0, range, 0)], zColor));
  group.add(makeAxis([new THREE.Vector3(0, 0, -range), new THREE.Vector3(0, 0, range)], yColor));

  const tickStep = getSurfaceTickStep(range);
  const tickSize = Math.max(0.08, range * 0.025);
  for (let value = -range; value <= range + 0.0001; value += tickStep) {
    const rounded = roundSurfaceTick(value);
    if (Math.abs(rounded) < 0.0001) continue;
    group.add(makeAxis([
      new THREE.Vector3(rounded, -tickSize, 0),
      new THREE.Vector3(rounded, tickSize, 0),
    ], xColor));
    group.add(makeAxis([
      new THREE.Vector3(-tickSize, rounded, 0),
      new THREE.Vector3(tickSize, rounded, 0),
    ], zColor));
    group.add(makeAxis([
      new THREE.Vector3(0, -tickSize, rounded),
      new THREE.Vector3(0, tickSize, rounded),
    ], yColor));

    group.add(createTextSprite(formatSurfaceTick(rounded), xColor, new THREE.Vector3(rounded, -tickSize * 4, 0)));
    group.add(createTextSprite(formatSurfaceTick(rounded), zColor, new THREE.Vector3(tickSize * 4, rounded, 0)));
    group.add(createTextSprite(formatSurfaceTick(rounded), yColor, new THREE.Vector3(0, -tickSize * 4, rounded)));
  }

  group.add(createTextSprite("x", xColor, new THREE.Vector3(range + tickSize * 7, 0, 0), 1.15));
  group.add(createTextSprite("z", zColor, new THREE.Vector3(0, range + tickSize * 7, 0), 1.15));
  group.add(createTextSprite("y", yColor, new THREE.Vector3(0, 0, range + tickSize * 7), 1.15));
  group.add(createTextSprite("0", 0x151719, new THREE.Vector3(tickSize * 3, -tickSize * 4, tickSize * 3)));
  return group;
};

const getSurfaceTickStep = (range: number) => {
  if (range <= 3) return 1;
  if (range <= 7) return 2;
  return 4;
};

const roundSurfaceTick = (value: number) => Number(value.toFixed(4));

const formatSurfaceTick = (value: number) => {
  const rounded = roundSurfaceTick(value);
  return `${rounded}`.replace(/\.0+$/, "");
};

const createTextSprite = (
  text: string,
  color: number,
  position: THREE.Vector3,
  scale = 0.72
) => {
  const canvas = document.createElement("canvas");
  const width = 128;
  const height = 64;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, width, height);
    context.font = "700 28px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 5;
    context.strokeStyle = "rgba(255,255,255,0.92)";
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.strokeText(text, width / 2, height / 2);
    context.fillText(text, width / 2, height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(scale * 1.6, scale * 0.8, 1);
  sprite.renderOrder = 10;
  return sprite;
};

const compileSurfaceEquation = (equation: string) => {
  const normalized = equation
    .replace(/\^/g, "**")
    .replace(/\bpi\b/gi, "PI")
    .replace(/\be\b/g, "E");
  const allowed = /^[\d+\-*/().,\sA-Za-z_*xyPIE]+$/;
  if (!allowed.test(normalized)) {
    return () => 0;
  }

  try {
    const values = SAFE_NAMES.map((name) => Math[name as keyof Math]);
    const fn = Function("x", "y", ...SAFE_NAMES, `"use strict"; return (${normalized});`);
    return (x: number, y: number) => {
      const value = fn(x, y, ...values);
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };
  } catch {
    return () => 0;
  }
};

const clampSurfaceZ = (value: number, range: number) =>
  Math.max(-range, Math.min(range, value));

const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3
    ? clean.split("").map((item) => item + item).join("")
    : clean, 16);
  if (!Number.isFinite(value)) return { r: 40, g: 102, b: 110 };
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const mixChannel = (from: number, to: number, amount: number) =>
  Math.round(from + (to - from) * amount);

const drawCanvasAxes = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) => {
  context.save();
  context.strokeStyle = "rgba(21, 23, 25, 0.72)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.fillStyle = "rgba(21, 23, 25, 0.78)";
  context.font = "700 12px Inter, system-ui, sans-serif";
  context.fillText("x", width - 18, height / 2 - 8);
  context.fillText("y", width / 2 + 8, 18);
  context.fillText("0", width / 2 + 6, height / 2 + 14);
  context.restore();
};

const disposeObject3D = (object: THREE.Object3D | null) => {
  if (!object) return;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as
      | (THREE.Material & { map?: THREE.Texture })
      | Array<THREE.Material & { map?: THREE.Texture }>
      | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => {
        item.map?.dispose();
        item.dispose();
      });
    }
    else {
      material?.map?.dispose();
      material?.dispose();
    }
  });
};
