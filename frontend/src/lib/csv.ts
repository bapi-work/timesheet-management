// Text starting with these runs as a formula when the file is opened in a spreadsheet
export function csvCell(value: unknown): string {
  const text = String(value);
  const isNumber = /^-?\d+(\.\d+)?$/.test(text);
  const safe = !isNumber && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
