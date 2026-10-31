import type { Response } from "express";
import { Timestamp } from "firebase-admin/firestore";

// CSV exports that open cleanly in Excel (plan D27): UTF-8 with a BOM, CRLF
// line endings, every field quoted when needed, and cells that start with
// = + - @ prefixed with ' so Excel doesn't run them as formulas.

export type Cell = string | number | boolean | null | undefined | Date | Timestamp;

export function csvCell(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Timestamp) v = v.toDate();
  if (v instanceof Date) return v.toISOString();
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: Cell[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/** Starts a CSV download; write rows with `row()`, then call `end()`. */
export function csvStream(res: Response, filename: string, header: string[]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.write("﻿" + csvLine(header));
  return {
    row: (cells: Cell[]) => res.write(csvLine(cells)),
    end: () => res.end(),
  };
}
