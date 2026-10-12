// CSV на стороне браузера: значения в кавычках, если внутри разделитель,
// кавычка или перенос; BOM в начале — чтобы Excel открыл кириллицу как UTF-8

type Cell = string | number | null | undefined;

const escapeCell = (value: Cell) => {
  const text = value === null || value === undefined ? "" : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header: string[], rows: Cell[][]) =>
  "﻿" +
  [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");

export const csvBlob = (header: string[], rows: Cell[][]) =>
  new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
