import { parse } from "csv-parse/sync";

/**
 * Stage 1 + 2 of the import pipeline: parse CSV text and normalize raw cells.
 * No business validation happens here.
 */

export const IMPORT_COLUMNS = [
  "sku",
  "name",
  "description",
  "category",
  "collection",
  "metal",
  "karat",
  "weight_grams",
  "making_charge",
  "stone_cost",
  "approved_price",
  "currency",
  "stock_quantity",
  "stock_status",
  "size",
  "website_url",
  "is_active",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["sku", "name"];

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Cell values that explicitly mean "unknown" and are stored as NULL. */
const UNKNOWN_MARKERS = new Set(["", "n/a", "na", "-", "unknown", "null", "tbd"]);

export type NormalizedCells = Record<ImportColumn, string | null>;

export interface ParsedRow {
  /** 1-based line number in the file as a spreadsheet user sees it (header = row 1). */
  rowNumber: number;
  cells: NormalizedCells;
}

export interface ImportIssue {
  row: number | null;
  column: string | null;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  issues: ImportIssue[];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeCell(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return UNKNOWN_MARKERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export function parseProductCsv(text: string): ParseResult {
  const issues: ImportIssue[] = [];
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    return { rows: [], issues: [{ row: null, column: null, message: "File exceeds the 5 MB import limit" }] };
  }

  let records: string[][];
  try {
    records = parse(text.replace(/^﻿/, ""), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }) as string[][];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unreadable CSV";
    return { rows: [], issues: [{ row: null, column: null, message: `CSV could not be parsed: ${message}` }] };
  }

  const [header, ...data] = records;
  if (!header) {
    return { rows: [], issues: [{ row: null, column: null, message: "File is empty" }] };
  }

  const columns = header.map(normalizeHeader);
  const known = new Set<string>(IMPORT_COLUMNS);
  const seen = new Set<string>();
  for (const column of columns) {
    // Unknown columns are rejected rather than ignored, so a typo such as
    // "aproved_price" can never silently drop a price.
    if (!known.has(column)) issues.push({ row: 1, column, message: `Unknown column "${column}"` });
    if (seen.has(column)) issues.push({ row: 1, column, message: `Duplicate column "${column}"` });
    seen.add(column);
  }
  for (const required of REQUIRED_IMPORT_COLUMNS) {
    if (!seen.has(required)) issues.push({ row: 1, column: required, message: `Missing required column "${required}"` });
  }
  if (data.length === 0) issues.push({ row: null, column: null, message: "File contains no product rows" });
  if (data.length > MAX_IMPORT_ROWS) {
    issues.push({ row: null, column: null, message: `File has ${data.length} rows; the limit is ${MAX_IMPORT_ROWS}` });
  }
  if (issues.length > 0) return { rows: [], issues };

  const rows = data.map((record, index) => {
    const cells = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, null])) as NormalizedCells;
    columns.forEach((column, i) => {
      cells[column as ImportColumn] = normalizeCell(record[i]);
    });
    return { rowNumber: index + 2, cells };
  });
  return { rows, issues };
}
