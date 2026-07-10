import * as XLSX from 'xlsx';

/**
 * Export data to Excel file and trigger download
 * @param data - Array of objects to export
 * @param filename - Name of the file (without extension)
 * @param sheetName - Name of the worksheet
 */
export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  sheetName: string = 'Data'
): void {
  if (!data || data.length === 0) {
    console.warn('No data to export');
    return;
  }

  // Create worksheet from data
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Auto-size columns based on content
  const columnWidths = getColumnWidths(data);
  worksheet['!cols'] = columnWidths;

  // Create workbook and add worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  const fullFilename = `${filename}_${timestamp}.xlsx`;

  // Trigger download
  XLSX.writeFile(workbook, fullFilename);
}

/**
 * Calculate column widths based on content
 */
function getColumnWidths<T extends Record<string, unknown>>(data: T[]): XLSX.ColInfo[] {
  if (data.length === 0) return [];

  const keys = Object.keys(data[0]);
  
  return keys.map(key => {
    // Get max length of values in this column (including header)
    let maxLength = key.length;
    
    data.forEach(row => {
      const value = row[key];
      const length = value != null ? String(value).length : 0;
      if (length > maxLength) {
        maxLength = Math.min(length, 50); // Cap at 50 characters
      }
    });

    return { wch: maxLength + 2 }; // Add padding
  });
}


/**
 * Export unique final values from the edited_value column for a given edited_field_name to Excel.
 * Final values = values in edited_value. One column "Edited Value", one row per unique value.
 */
export function exportUniqueFinalValuesForField(
  documents: Array<{ editedFieldName?: string; editedValue?: string }>,
  fieldName: string,
  filename: string = 'unique_values',
  sheetName?: string
): void {
  const filtered = documents.filter(
    d => (d.editedFieldName ?? '').trim() === fieldName
  );
  const uniqueValues = Array.from(new Set(filtered.map(d => (d.editedValue ?? '').trim()).filter(Boolean)));
  const data = uniqueValues.map(value => ({ 'Edited Value': value }));
  if (data.length === 0) {
    console.warn(`No rows with edited_field_name "${fieldName}" to export`);
    return;
  }
  const baseFilename = filename || `unique_${fieldName}`;
  const safeSheetName = (sheetName || fieldName).slice(0, 31);
  exportToExcel(data, baseFilename, safeSheetName);
}

