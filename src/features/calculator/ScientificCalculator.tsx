import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateStatistic,
  evaluateExpression,
  getCalculatorPairs,
  getCalculatorValues,
  getCorrelationSummary,
  getSelectedObjectSummary,
  type CalculatorDataContext,
} from "./calculator";
import { CORRELATION_FORMULA_COMPONENTS } from "../formulaVisualization/correlationFormula";
import { STATISTIC_FORMULA_COMPONENTS } from "../formulaVisualization/statisticFormula";
import type {
  CalculatorGuide,
  CalculatorMeanPoint,
  CorrelationGuide,
  CorrelationHighlight,
  StatisticHighlight,
} from "../../graphTypes";

type CalculatorProps = {
  context: CalculatorDataContext;
  onGuideChange: (guide: CalculatorGuide | null) => void;
  onMeanPointChange: (point: CalculatorMeanPoint | null) => void;
  onCorrelationGuideChange: (guide: CorrelationGuide | null) => void;
};

const SCIENCE_KEYS = ["sin(", "cos(", "tan(", "sqrt(", "log10(", "log(", "π", "e", "^", "(", ")"];
const BASIC_KEYS = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"];
const STAT_KEYS = ["MEAN", "SD", "VAR", "COVAR", "MEDIAN"] as const;
type FormulaPanel = (typeof STAT_KEYS)[number] | "r";
const STATISTIC_FORMULAS: Record<
  (typeof STAT_KEYS)[number],
  { title: string; formula: string; explanation: string }
> = {
  MEAN: {
    title: "Mean",
    formula: "x̄ = Σxi / n, ȳ = Σyi / n",
    explanation: "The mean point is the center of the selected coordinates.",
  },
  SD: {
    title: "Standard deviation",
    formula: "SD_y = √[Σ(yi - ȳ)² / n], SD_x = √[Σ(xi - x̄)² / n]",
    explanation: "Standard deviation is the normal distance obtained after square-rooting an average squared deviation.",
  },
  VAR: {
    title: "Variance",
    formula: "VAR_y = Σ(yi - ȳ)² / n, VAR_x = Σ(xi - x̄)² / n",
    explanation: "Variance is average squared spread; y terms are vertical and x terms are horizontal.",
  },
  COVAR: {
    title: "Covariance",
    formula: "COVAR = Σ[(xi - x̄)(yi - ȳ)] / n",
    explanation: "Covariance averages the signed horizontal and vertical comovement.",
  },
  MEDIAN: {
    title: "Median",
    formula: "MEDIAN = middle(sorted values)",
    explanation: "The median is the middle value after sorting the selected values.",
  },
};
const RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
const CALCULATOR_INPUT_DETACH_WIDTH = 270;
const CALCULATOR_DETACHED_INPUT_WIDTH = 326;
type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];

export const ScientificCalculator = ({
  context,
  onGuideChange,
  onMeanPointChange,
  onCorrelationGuideChange,
}: CalculatorProps) => {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [correlationHighlights, setCorrelationHighlights] =
    useState<CorrelationHighlight[]>([]);
  const [statisticHighlights, setStatisticHighlights] = useState<StatisticHighlight[]>([]);
  const [formulaPanel, setFormulaPanel] = useState<FormulaPanel | null>(null);
  const [position, setPosition] = useState({ x: 380, y: 84 });
  const [size, setSize] = useState<{ width: number; height?: number }>({ width: 340 });
  const [drag, setDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [resize, setResize] = useState<{
    pointerId: number;
    direction: ResizeDirection;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const collapsedDragMoved = useRef(false);
  const compact = size.width <= CALCULATOR_INPUT_DETACH_WIDTH;

  const selectedSummary = getSelectedObjectSummary(context);
  const dataSummary = useMemo(() => {
    const values = getCalculatorValues(context);
    const pairs = getCalculatorPairs(context);
    return `${values.length} values, ${pairs.length} pairs`;
  }, [context]);
  const correlationSummary = useMemo(() => {
    try {
      return getCorrelationSummary(context);
    } catch {
      return null;
    }
  }, [context]);

  useEffect(() => {
    if (!expression.trim()) {
      setResult(null);
      setError("");
      onGuideChange(null);
      return;
    }

    if (STAT_KEYS.some((key) => key === expression.trim()) && result !== null) {
      return;
    }

    try {
      const next = evaluateExpression(expression);
      setResult(next);
      setError("");
      onGuideChange(
        next === null ? null : { label: `${expression} = ${next}`, value: next }
      );
    } catch (nextError) {
      setResult(null);
      setError(nextError instanceof Error ? nextError.message : "Invalid expression");
      onGuideChange(null);
    }
  }, [expression, onGuideChange]);

  const append = (value: string) => {
    if (value === "=") return;
    setExpression((current) => `${current}${value}`);
  };

  const runStatistic = (name: (typeof STAT_KEYS)[number]) => {
    try {
      const value = calculateStatistic(name, context);
      const pairs = getCalculatorPairs(context);
      setFormulaPanel(name);
      setExpression(name);
      setResult(value);
      setError("");
      setCorrelationHighlights([]);
      setStatisticHighlights([]);
      onCorrelationGuideChange(null);
      onMeanPointChange(null);
      onGuideChange({ highlights: [], label: `${name} = ${value}`, pairs, statistic: name, value });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not calculate");
      onGuideChange(null);
    }
  };

  const showCorrelationPanel = () => {
    setFormulaPanel("r");
    setStatisticHighlights([]);
    setError("");
    onGuideChange(null);
    onMeanPointChange(null);
  };

  const showStatisticTerm = (
    statistic: (typeof STAT_KEYS)[number],
    highlight: StatisticHighlight
  ) => {
    try {
      const pairs = getCalculatorPairs(context);
      if (pairs.length === 0) {
        throw new Error(`${statistic} needs at least one x,y pair.`);
      }
      const value = calculateStatistic(statistic, context);
      const nextHighlights = statisticHighlights.includes(highlight)
        ? statisticHighlights.filter((current) => current !== highlight)
        : [...statisticHighlights, highlight];
      setStatisticHighlights(nextHighlights);
      setCorrelationHighlights([]);
      setError("");
      onCorrelationGuideChange(null);
      onMeanPointChange(null);
      onGuideChange(
        nextHighlights.length > 0
          ? {
              highlights: nextHighlights,
              label: `${statistic} = ${value}`,
              pairs,
              statistic,
              value,
            }
          : null
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Could not visualize ${statistic}`);
      onGuideChange(null);
    }
  };

  const showCorrelationTerm = (highlight: CorrelationHighlight) => {
    try {
      const pairs = getCalculatorPairs(context);
      if (pairs.length < 2) {
        throw new Error("Correlation needs at least two x,y pairs.");
      }
      const nextHighlights = correlationHighlights.includes(highlight)
        ? correlationHighlights.filter((current) => current !== highlight)
        : [...correlationHighlights, highlight];
      setCorrelationHighlights(nextHighlights);
      setError("");
      onCorrelationGuideChange(
        nextHighlights.length > 0 ? { highlights: nextHighlights, pairs } : null
      );
      onMeanPointChange(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not visualize correlation");
      onCorrelationGuideChange(null);
    }
  };

  const pointerDown = (event: PointerEvent<HTMLElement>) => {
    if (
      !collapsed &&
      (event.target as HTMLElement).closest("button, input, textarea, select, a")
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    collapsedDragMoved.current = false;
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    });
  };

  const pointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const moved = drag.moved || Math.hypot(dx, dy) > 4;
    if (moved) collapsedDragMoved.current = true;
    setPosition({
      x: Math.min(
        Math.max(12, drag.originX + dx),
        Math.max(12, window.innerWidth - 72)
      ),
      y: Math.min(
        Math.max(12, drag.originY + dy),
        Math.max(12, window.innerHeight - 72)
      ),
    });
    if (moved && !drag.moved) {
      setDrag({ ...drag, moved: true });
    }
  };

  const pointerUp = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  };

  const resizePointerDown = (
    direction: ResizeDirection,
    event: PointerEvent<HTMLDivElement>
  ) => {
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResize({
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.x,
      originY: rect.y,
      originWidth: rect.width,
      originHeight: rect.height,
    });
  };

  const resizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resize || resize.pointerId !== event.pointerId) return;
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    const fromLeft = resize.direction.includes("w");
    const fromRight = resize.direction.includes("e");
    const fromTop = resize.direction.includes("n");
    const fromBottom = resize.direction.includes("s");
    const minWidth = 220;
    const minHeight = 300;
    const maxWidth = fromLeft
      ? resize.originX + resize.originWidth - 12
      : window.innerWidth - resize.originX - 12;
    const maxHeight = fromTop
      ? resize.originY + resize.originHeight - 12
      : window.innerHeight - resize.originY - 12;
    const width = Math.min(
      Math.max(minWidth, resize.originWidth + (fromLeft ? -dx : fromRight ? dx : 0)),
      Math.max(minWidth, maxWidth)
    );
    const height = Math.min(
      Math.max(minHeight, resize.originHeight + (fromTop ? -dy : fromBottom ? dy : 0)),
      Math.max(minHeight, maxHeight)
    );

    setPosition({
      x: fromLeft ? resize.originX + resize.originWidth - width : resize.originX,
      y: fromTop ? resize.originY + resize.originHeight - height : resize.originY,
    });
    setSize({ width, height });
  };

  const resizePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResize(null);
  };

  if (collapsed) {
    return (
      <button
        aria-label="Open calculator"
        className="calculator-float-button"
        onClick={() => {
          if (collapsedDragMoved.current) {
            collapsedDragMoved.current = false;
            return;
          }
          setCollapsed(false);
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerCancel={pointerUp}
        onPointerUp={pointerUp}
        style={{ left: position.x, top: position.y }}
        type="button"
      >
        +/-
      </button>
    );
  }

  return (
    <aside
      className={`scientific-calculator${compact ? " compact" : ""}`}
      onPointerCancel={pointerUp}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      ref={panelRef}
      style={{ height: size.height, left: position.x, top: position.y, width: size.width }}
    >
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          aria-hidden="true"
          className={`calculator-resize-handle ${direction}`}
          key={direction}
          onPointerCancel={resizePointerUp}
          onPointerDown={(event) => resizePointerDown(direction, event)}
          onPointerMove={resizePointerMove}
          onPointerUp={resizePointerUp}
        />
      ))}
      <div className="calculator-body">
      <div
        className="calculator-titlebar"
      >
        <strong>Calculator</strong>
        <div className="calculator-title-actions">
          <button
            aria-label="Collapse calculator"
            onClick={() => setCollapsed(true)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            -
          </button>
          <span>drag</span>
        </div>
      </div>

      <div className="calculator-context">
        <span>Selected</span>
        <code>{selectedSummary}</code>
        <small>{dataSummary}</small>
      </div>

      <div className="calculator-display">
        <input
          aria-label="Calculator expression"
          className={compact ? "calculator-detached-input" : ""}
          onChange={(event) => setExpression(event.target.value)}
          placeholder="2*sin(3.14) + 5"
          style={
            compact
              ? {
                  left: position.x,
                  top: Math.max(8, position.y - 46),
                  width: Math.max(CALCULATOR_DETACHED_INPUT_WIDTH, size.width),
                }
              : undefined
          }
          value={expression}
        />
        <output>{result === null ? "ready" : result}</output>
      </div>

      {error ? <p className="calculator-error">{error}</p> : null}

      <div className="calculator-key-grid science">
        {SCIENCE_KEYS.map((key) => (
          <button key={key} onClick={() => append(key)} type="button">
            {key}
          </button>
        ))}
      </div>

      <div className="calculator-key-grid stats">
        {STAT_KEYS.map((key) => (
          <button
            className={formulaPanel === key ? "active" : ""}
            key={key}
            onClick={() => runStatistic(key)}
            type="button"
          >
            {key}
          </button>
        ))}
        <button
          className={formulaPanel === "r" ? "active" : ""}
          onClick={showCorrelationPanel}
          type="button"
        >
          r
        </button>
      </div>

      {formulaPanel ? (
        <div className="correlation-panel statistic-formula-panel">
          <div className="formula-panel-title">
            <strong>
              {formulaPanel === "r"
                ? "Correlation coefficient"
                : STATISTIC_FORMULAS[formulaPanel].title}
            </strong>
            <button
              aria-label="Hide formula"
              onClick={() => setFormulaPanel(null)}
              type="button"
            >
              x
            </button>
          </div>
          <code>
            {formulaPanel === "r"
              ? "r = Σ[(xi - x̄)(yi - ȳ)] / √[Σ(xi - x̄)² Σ(yi - ȳ)²]"
              : STATISTIC_FORMULAS[formulaPanel].formula}
          </code>
          <output>
            {formulaPanel === "r"
              ? `r = ${correlationSummary?.coefficient ?? "needs varied x,y pairs"}`
              : `${formulaPanel} = ${result ?? "needs points or data"}`}
          </output>
          {formulaPanel === "r" ? (
            <>
              <div className="correlation-terms">
                {CORRELATION_FORMULA_COMPONENTS.map((term) => (
                  <button
                    className={correlationHighlights.includes(term.id) ? "active" : ""}
                    key={term.id}
                    onClick={() => showCorrelationTerm(term.id)}
                    title={term.title}
                    type="button"
                  >
                    {term.label}
                  </button>
                ))}
              </div>
              <div className="comovement-legend">
                <span className="positive">Positive comovement</span>
                <span className="negative">Negative comovement</span>
              </div>
            </>
          ) : (
            <>
              <div className="correlation-terms statistic-formula-terms">
                {STATISTIC_FORMULA_COMPONENTS[formulaPanel].map((term) => (
                  <button
                    className={statisticHighlights.includes(term.id) ? "active" : ""}
                    key={term.id}
                    onClick={() => showStatisticTerm(formulaPanel, term.id)}
                    title={term.title}
                    type="button"
                  >
                    {term.label}
                  </button>
                ))}
              </div>
              <small>
                {STATISTIC_FORMULA_COMPONENTS[formulaPanel]
                  .filter((term) => statisticHighlights.includes(term.id))
                  .map((term) => term.explanation)
                  .join(" ") || STATISTIC_FORMULAS[formulaPanel].explanation}
              </small>
            </>
          )}
        </div>
      ) : null}

      <div className="calculator-key-grid basic">
        {BASIC_KEYS.map((key) => (
          <button key={key} onClick={() => append(key)} type="button">
            {key}
          </button>
        ))}
      </div>

      <div className="calculator-actions">
        <button onClick={() => setExpression((current) => current.slice(0, -1))} type="button">
          Back
        </button>
        <button
          onClick={() => {
            setExpression("");
            setResult(null);
            setError("");
            onGuideChange(null);
            onMeanPointChange(null);
            onCorrelationGuideChange(null);
            setCorrelationHighlights([]);
            setStatisticHighlights([]);
            setFormulaPanel(null);
          }}
          type="button"
        >
          Clear
        </button>
      </div>
      </div>
    </aside>
  );
};
