/**
 * Minimal RFC 4180 CSV reader/writer for glossary import and export.
 * Handles quoted fields, escaped quotes, CRLF/LF line endings and a UTF-8 BOM.
 */

export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      i++;
    } else if (char === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (char === "\r" || char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += char === "\r" && input[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i++;
    }
  }
  if (quoted) throw new Error("Unterminated quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Quotes a cell and neutralises spreadsheet formulas (CSV injection): cells
 * starting with = + - @ tab or CR are prefixed with an apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
