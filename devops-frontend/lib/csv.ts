function escapeCSVValue(value: unknown): string {
  const normalized = value == null ? '' : String(value);
  if (normalized.includes('"') || normalized.includes(',') || normalized.includes('\n')) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function downloadCSV(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => escapeCSVValue(value)).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
