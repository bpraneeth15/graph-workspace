import type { DataValue } from "../graphTypes";
import { roundCoordinate } from "./graphMath";

type ParseDataValuesResult =
  | { ok: true; values: DataValue[] }
  | { ok: false; message: string };

const numberPattern = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?";

export const parseDataValues = (input: string): ParseDataValuesResult => {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Enter at least one x, y pair. Example: 1, 2",
    };
  }

  const coordinatePairValues = parseCoordinatePairValues(trimmed);
  if (coordinatePairValues.length > 0) {
    return { ok: true, values: coordinatePairValues };
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

const parseCoordinatePairValues = (input: string) => {
  const pairPattern = new RegExp(
    `\\(\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*\\)`,
    "gi"
  );
  const values: DataValue[] = [];
  let match = pairPattern.exec(input);
  while (match) {
    values.push({
      x: roundCoordinate(Number(match[1])),
      y: roundCoordinate(Number(match[2])),
    });
    match = pairPattern.exec(input);
  }
  return values;
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
          values.push({
            x: roundCoordinate(numeric[0]),
            y: roundCoordinate(numeric[1]),
          });
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
