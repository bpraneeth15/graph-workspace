import { PointerEvent, useEffect, useMemo, useState } from "react";
import {
  calculateStatistic,
  evaluateExpression,
  getCalculatorPairs,
  getCalculatorValues,
  getSelectedObjectSummary,
  type CalculatorDataContext,
} from "./calculator";

type CalculatorProps = {
  context: CalculatorDataContext;
  onGuideChange: (guide: { label: string; value: number } | null) => void;
};

const SCIENCE_KEYS = ["sin(", "cos(", "tan(", "sqrt(", "log10(", "log(", "π", "e", "^", "(", ")"];
const BASIC_KEYS = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"];
const STAT_KEYS = ["MEAN", "SD", "VAR", "COVAR", "MEDIAN"] as const;

export const ScientificCalculator = ({ context, onGuideChange }: CalculatorProps) => {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ x: 380, y: 84 });
  const [drag, setDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const selectedSummary = getSelectedObjectSummary(context);
  const dataSummary = useMemo(() => {
    const values = getCalculatorValues(context);
    const pairs = getCalculatorPairs(context);
    return `${values.length} values, ${pairs.length} pairs`;
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
      setExpression(name);
      setResult(value);
      setError("");
      onGuideChange({ label: `${name} = ${value}`, value });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not calculate");
      onGuideChange(null);
    }
  };

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    });
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.min(
        Math.max(12, drag.originX + event.clientX - drag.startX),
        Math.max(12, window.innerWidth - 72)
      ),
      y: Math.min(
        Math.max(12, drag.originY + event.clientY - drag.startY),
        Math.max(12, window.innerHeight - 72)
      ),
    });
  };

  return (
    <aside
      className="scientific-calculator"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="calculator-titlebar"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => setDrag(null)}
      >
        <strong>Calculator</strong>
        <span>drag</span>
      </div>

      <div className="calculator-context">
        <span>Selected</span>
        <code>{selectedSummary}</code>
        <small>{dataSummary}</small>
      </div>

      <div className="calculator-display">
        <input
          aria-label="Calculator expression"
          onChange={(event) => setExpression(event.target.value)}
          placeholder="2*sin(3.14) + 5"
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
          <button key={key} onClick={() => runStatistic(key)} type="button">
            {key}
          </button>
        ))}
      </div>

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
          }}
          type="button"
        >
          Clear
        </button>
      </div>
    </aside>
  );
};
