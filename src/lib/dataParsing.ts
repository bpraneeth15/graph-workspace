import type { DataValue } from "../graphTypes";
import { roundCoordinate } from "./graphMath";

type ParseDataValuesResult =
  | { ok: true; values: DataValue[] }
  | { ok: false; message: string };

type NumericDataRow = {
  numbers: Array<number | null>;
  rowIndex: number;
};

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

  const headerColumns = findHeaderColumns(rows);
  const numericRows = rows
    .map((cells, rowIndex): NumericDataRow => ({
      numbers: cells.map(readNumberFromCell),
      rowIndex,
    }))
    .filter(
      (row) =>
        row.rowIndex > (headerColumns?.rowIndex ?? -1) &&
        row.numbers.some((value) => value !== null)
    );
  const [xColumn, yColumn] = headerColumns
    ? [headerColumns.xColumn, headerColumns.yColumn]
    : inferNumericColumns(numericRows);
  const values: DataValue[] = [];

  numericRows.forEach((row, index) => {
    const xValue = row.numbers[xColumn];
    const yValue = row.numbers[yColumn];
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

    const numericCells = row.numbers.filter((value): value is number => value !== null);
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
        const value = getDataValueFromNumericCells(numeric, index);
        if (value) values.push(value);
        return;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const x = readObjectNumber(record, isXHeader);
        const y = readObjectNumber(record, isYHeader, x?.key);
        if (x && y) {
          values.push({ x: roundCoordinate(x.value), y: roundCoordinate(y.value) });
        } else if (y) {
          values.push({ x: index, y: roundCoordinate(y.value) });
        }
      }
    });
    return values;
  } catch {
    return [];
  }
};

const findHeaderColumns = (rows: string[][]) => {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 6); rowIndex += 1) {
    const row = rows[rowIndex];
    const xColumn = row.findIndex(isXHeader);
    const yColumn = row.findIndex(isYHeader);
    if (xColumn >= 0 && yColumn >= 0 && xColumn !== yColumn) {
      return { rowIndex, xColumn, yColumn };
    }
  }
  return null;
};

const inferNumericColumns = (rows: NumericDataRow[]) => {
  const maxColumns = Math.max(0, ...rows.map((row) => row.numbers.length));
  const columnCounts = Array.from({ length: maxColumns }, (_, column) => ({
    column,
    count: rows.filter((row) => row.numbers[column] !== null).length,
  })).filter((item) => item.count > 0);
  const nonIndexColumns = columnCounts.filter(
    (item) => !isLikelyIndexColumn(rows, item.column)
  );
  const candidates = nonIndexColumns.length >= 2 ? nonIndexColumns : columnCounts;
  const bestColumns = candidates.sort((a, b) => b.count - a.count || a.column - b.column);
  return [bestColumns[0]?.column ?? -1, bestColumns[1]?.column ?? -1] as const;
};

const isLikelyIndexColumn = (rows: NumericDataRow[], column: number) => {
  const values = rows
    .map((row) => row.numbers[column])
    .filter((value): value is number => value !== null);
  if (values.length < 3 || values.length !== rows.length) return false;
  if (!values.every((value) => Number.isInteger(value))) return false;
  const startsAtZero = values.every((value, index) => value === index);
  const startsAtOne = values.every((value, index) => value === index + 1);
  return startsAtZero || startsAtOne;
};

const getDataValueFromNumericCells = (numericCells: number[], index: number) => {
  if (numericCells.length >= 2) {
    return {
      x: roundCoordinate(numericCells[0]),
      y: roundCoordinate(numericCells[1]),
    };
  }
  if (numericCells.length === 1) {
    return { x: index, y: roundCoordinate(numericCells[0]) };
  }
  return null;
};

const readObjectNumber = (
  record: Record<string, unknown>,
  keyMatcher: (key: string) => boolean,
  ignoredKey?: string
) => {
  const entries = Object.entries(record);
  const matchedEntry = entries.find(([key]) => key !== ignoredKey && keyMatcher(key));
  const numericEntry =
    matchedEntry ??
    entries.find(
      ([key, value]) => key !== ignoredKey && readNumberFromCell(String(value)) !== null
    );
  if (!numericEntry) return null;
  const value = readNumberFromCell(String(numericEntry[1]));
  return value === null ? null : { key: numericEntry[0], value };
};

const normalizeHeader = (cell: string) =>
  cell.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const isXHeader = (cell: string) =>
  [
    "x",
    "xcoordinate",
    "xcoord",
    "xvalue",
    "time",
    "date",
    "year",
    "input",
    "independent",
  ].includes(normalizeHeader(cell));

const isYHeader = (cell: string) =>
  [
    "y",
    "ycoordinate",
    "ycoord",
    "yvalue",
    "value",
    "amount",
    "price",
    "count",
    "score",
    "output",
    "dependent",
  ].includes(normalizeHeader(cell));

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

