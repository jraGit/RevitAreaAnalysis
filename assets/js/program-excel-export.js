const EXCELJS_CDN = 'https://cdn.jsdelivr.net/npm/exceljs@4/dist/exceljs.min.js';

function col(number) {
  let result = '';
  let value = Number(number) || 0;
  while (value) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function esc(value) {
  return String(value ?? '').replace(/"/g, '""');
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function yes(value) {
  return String(value || '').toUpperCase() === 'YES';
}

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function cellRef(row, column) {
  return `${col(column)}${row}`;
}

function rangeRef(firstRow, firstColumn, lastRow, lastColumn) {
  return `${cellRef(firstRow, firstColumn)}:${cellRef(lastRow, lastColumn)}`;
}

function safeSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

export function programExcelFileName(program, sourceFileName = '') {
  const project = program?.project || {};
  const base = sanitizeFilePart(sourceFileName) ||
    sanitizeFilePart([project.project_number, project.project_name].filter(Boolean).join('-')) ||
    'area-program';
  return `${base}.program.xlsx`;
}

export function hasProgramExcelPayload(raw) {
  return raw?.program?.schema === 'area_program_export' && Array.isArray(raw.program.rows);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      if (window.ExcelJS) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export async function ensureExcelJS() {
  if (!window.ExcelJS) await loadScript(EXCELJS_CDN);
  if (!window.ExcelJS) throw new Error('ExcelJS did not initialize.');
  return window.ExcelJS;
}

function setCellStyle(cell, style = {}) {
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
  if (style.numFmt) cell.numFmt = style.numFmt;
}

function applyStyle(rowOrCell, style) {
  if (rowOrCell.eachCell) {
    rowOrCell.eachCell({ includeEmpty: true }, cell => setCellStyle(cell, style));
  } else {
    setCellStyle(rowOrCell, style);
  }
}

function setValue(ws, address, value, style) {
  const cell = ws.getCell(address);
  cell.value = value;
  if (style) setCellStyle(cell, style);
  return cell;
}

function setFormula(ws, address, formula, result, style) {
  const cell = ws.getCell(address);
  cell.value = { formula, result };
  if (style) setCellStyle(cell, style);
  return cell;
}

function setArrayFormula(ws, address, formula, result, style) {
  const cell = ws.getCell(address);
  cell.value = { formula, result, shareType: 'array', ref: address };
  if (style) setCellStyle(cell, style);
  return cell;
}

function addTitle(ws, fromCell, toCell, text, style) {
  ws.mergeCells(`${fromCell}:${toCell}`);
  setValue(ws, fromCell, text, style);
}

function addHeaderRow(ws, rowNumber, headers, style) {
  const row = ws.getRow(rowNumber);
  headers.forEach((header, index) => {
    setValue(ws, `${col(index + 1)}${rowNumber}`, header, style);
  });
  row.height = 30;
}

function applyColumnWidths(ws, widths) {
  for (const [key, width] of Object.entries(widths)) {
    ws.getColumn(key).width = width;
  }
}

function formulaResult(value) {
  return Number.isFinite(value) ? value : 0;
}

function rowsMatching(rows, criteria) {
  return rows.filter(row => Object.entries(criteria).every(([key, value]) => String(row[key] ?? '') === String(value)));
}

function sumRows(rows, criteria = {}) {
  return rowsMatching(rows, criteria).reduce((sum, row) => sum + num(row.sf), 0);
}

function countRows(rows, criteria = {}) {
  return rowsMatching(rows, criteria).length;
}

function unitRows(rows, criteria = {}) {
  return rowsMatching(rows, { ...criteria, unit: 'YES' });
}

function minSf(rows) {
  return rows.length ? Math.min(...rows.map(row => num(row.sf))) : 0;
}

function maxSf(rows) {
  return rows.length ? Math.max(...rows.map(row => num(row.sf))) : 0;
}

function sheetStyles() {
  const thinGray = { style: 'thin', color: { argb: 'FFD9D9D9' } };
  const sectionBorder = { style: 'thin', color: { argb: 'FFB7B7B7' } };
  const headerBorder = { style: 'thin', color: { argb: 'FF666666' } };
  const totalBorder = { style: 'thin', color: { argb: 'FF93C47D' } };
  return {
    title: {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } },
      alignment: { horizontal: 'left', vertical: 'middle' }
    },
    head: {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF222222' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: { top: headerBorder, right: headerBorder, bottom: headerBorder, left: headerBorder }
    },
    section: {
      font: { bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } },
      border: { top: sectionBorder, right: sectionBorder, bottom: sectionBorder, left: sectionBorder }
    },
    text: {
      border: { top: thinGray, right: thinGray, bottom: thinGray, left: thinGray }
    },
    decimal: {
      numFmt: '#,##0.00',
      border: { top: thinGray, right: thinGray, bottom: thinGray, left: thinGray }
    },
    sf: {
      numFmt: '#,##0.00 "SF"',
      border: { top: thinGray, right: thinGray, bottom: thinGray, left: thinGray }
    },
    units: {
      numFmt: '#,##0 "UNITS"',
      border: { top: thinGray, right: thinGray, bottom: thinGray, left: thinGray }
    },
    percent: {
      numFmt: '0.0%',
      border: { top: thinGray, right: thinGray, bottom: thinGray, left: thinGray }
    },
    totalSf: {
      font: { bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } },
      border: { top: totalBorder, right: totalBorder, bottom: totalBorder, left: totalBorder },
      numFmt: '#,##0.00 "SF"'
    },
    totalUnits: {
      font: { bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } },
      border: { top: totalBorder, right: totalBorder, bottom: totalBorder, left: totalBorder },
      numFmt: '#,##0 "UNITS"'
    },
    totalPercent: {
      font: { bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } },
      border: { top: totalBorder, right: totalBorder, bottom: totalBorder, left: totalBorder },
      numFmt: '0.0%'
    }
  };
}

function registerLastExcelRow(rows) {
  return rows.length + 1;
}

function registerRange(column, lastRow) {
  return `${safeSheetName('AREA REGISTER')}!$${column}$2:$${column}$${lastRow}`;
}

function quoted(value) {
  return `"${esc(value)}"`;
}

function writePodiumSheet(wb, program, styles) {
  const rows = program.rows || [];
  const lastRegisterRow = registerLastExcelRow(rows);
  const podiumViews = program.views?.podium || [];
  const podiumCategories = program.podium_categories || [];
  const headers = ['Level', 'Gross SF', 'Sellable SF', 'Efficiency', ...podiumCategories.map(category => `${category} SF`)];
  const ws = wb.addWorksheet('PODIUM PROGRAM');
  addTitle(ws, 'A1', `${col(headers.length)}1`, `${program.project?.project_name || 'PROJECT'} - PODIUM PROGRAM`, styles.title);
  addHeaderRow(ws, 3, headers, styles.head);
  const firstExcelRow = 4;

  podiumViews.forEach((item, index) => {
    const excelRow = firstExcelRow + index;
    const view = item.view || '';
    setValue(ws, `A${excelRow}`, item.level || '', styles.text);
    setFormula(
      ws,
      `B${excelRow}`,
      `SUMIF(${registerRange('B', lastRegisterRow)},${quoted(view)},${registerRange('I', lastRegisterRow)})`,
      sumRows(rows, { view }),
      styles.sf
    );
    setFormula(
      ws,
      `C${excelRow}`,
      `SUMIFS(${registerRange('I', lastRegisterRow)},${registerRange('B', lastRegisterRow)},${quoted(view)},${registerRange('J', lastRegisterRow)},"YES")`,
      sumRows(rows, { view, sell: 'YES' }),
      styles.sf
    );
    setFormula(ws, `D${excelRow}`, `IFERROR(C${excelRow}/B${excelRow},0)`, formulaResult(sumRows(rows, { view, sell: 'YES' }) / sumRows(rows, { view })), styles.percent);
    podiumCategories.forEach((category, categoryIndex) => {
      const column = col(5 + categoryIndex);
      setFormula(
        ws,
        `${column}${excelRow}`,
        `SUMIFS(${registerRange('I', lastRegisterRow)},${registerRange('B', lastRegisterRow)},${quoted(view)},${registerRange('F', lastRegisterRow)},${quoted(category)})`,
        sumRows(rows, { view, cat: category }),
        styles.sf
      );
    });
  });

  const lastExcelRow = firstExcelRow + podiumViews.length - 1;
  const totalExcelRow = podiumViews.length + 5;
  setValue(ws, `A${totalExcelRow}`, 'PODIUM TOTAL', styles.section);
  if (podiumViews.length) {
    setFormula(ws, `B${totalExcelRow}`, `SUM(B${firstExcelRow}:B${lastExcelRow})`, sumRows(rows, { tower: 'PODIUM / SHARED' }), styles.totalSf);
    setFormula(ws, `C${totalExcelRow}`, `SUM(C${firstExcelRow}:C${lastExcelRow})`, sumRows(rows, { tower: 'PODIUM / SHARED', sell: 'YES' }), styles.totalSf);
    setFormula(ws, `D${totalExcelRow}`, `IFERROR(C${totalExcelRow}/B${totalExcelRow},0)`, formulaResult(sumRows(rows, { tower: 'PODIUM / SHARED', sell: 'YES' }) / sumRows(rows, { tower: 'PODIUM / SHARED' })), styles.totalPercent);
    for (let columnIndex = 5; columnIndex <= headers.length; columnIndex += 1) {
      const column = col(columnIndex);
      const category = podiumCategories[columnIndex - 5];
      setFormula(ws, `${column}${totalExcelRow}`, `SUM(${column}${firstExcelRow}:${column}${lastExcelRow})`, sumRows(rows, { tower: 'PODIUM / SHARED', cat: category }), styles.totalSf);
    }
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];
  ws.autoFilter = { from: 'A3', to: `${col(headers.length)}${podiumViews.length + 3}` };
  applyColumnWidths(ws, { A: 27 });
  for (let i = 2; i <= headers.length; i += 1) ws.getColumn(i).width = 16;
}

function writeTowerSheet(wb, program, styles, sheetName, towerName, towerViews) {
  const rows = program.rows || [];
  const lastRegisterRow = registerLastExcelRow(rows);
  const unitTypes = program.tower_unit_types?.[towerName] || [];
  const headers = ['Level', 'Unit Count', 'Unit SF', 'Average Unit SF', ...unitTypes];
  const ws = wb.addWorksheet(sheetName);
  addTitle(ws, 'A1', `${col(headers.length)}1`, `${program.project?.project_name || 'PROJECT'} - ${sheetName}`, styles.title);
  addHeaderRow(ws, 3, headers, styles.head);
  const firstExcelRow = 4;

  towerViews.forEach((item, index) => {
    const excelRow = firstExcelRow + index;
    const view = item.view || '';
    const matchingUnits = unitRows(rows, { view });
    const unitSf = matchingUnits.reduce((sum, row) => sum + num(row.sf), 0);
    setValue(ws, `A${excelRow}`, item.level || '', styles.text);
    setFormula(ws, `B${excelRow}`, `COUNTIFS(${registerRange('B', lastRegisterRow)},${quoted(view)},${registerRange('K', lastRegisterRow)},"YES")`, matchingUnits.length, styles.units);
    setFormula(ws, `C${excelRow}`, `SUMIFS(${registerRange('I', lastRegisterRow)},${registerRange('B', lastRegisterRow)},${quoted(view)},${registerRange('K', lastRegisterRow)},"YES")`, unitSf, styles.sf);
    setFormula(ws, `D${excelRow}`, `IFERROR(C${excelRow}/B${excelRow},0)`, formulaResult(unitSf / matchingUnits.length), styles.sf);
    unitTypes.forEach((unitType, typeIndex) => {
      const column = col(5 + typeIndex);
      setFormula(
        ws,
        `${column}${excelRow}`,
        `COUNTIFS(${registerRange('B', lastRegisterRow)},${quoted(view)},${registerRange('L', lastRegisterRow)},${quoted(unitType)},${registerRange('K', lastRegisterRow)},"YES")`,
        countRows(rows, { view, unit_type: unitType, unit: 'YES' }),
        styles.units
      );
    });
  });

  const lastExcelRow = firstExcelRow + towerViews.length - 1;
  const totalExcelRow = towerViews.length + 5;
  const towerUnitRows = unitRows(rows, { tower: towerName });
  const towerUnitSf = towerUnitRows.reduce((sum, row) => sum + num(row.sf), 0);
  setValue(ws, `A${totalExcelRow}`, `${towerName} TOTAL`, styles.section);
  if (towerViews.length) {
    setFormula(ws, `B${totalExcelRow}`, `SUM(B${firstExcelRow}:B${lastExcelRow})`, towerUnitRows.length, styles.totalUnits);
    setFormula(ws, `C${totalExcelRow}`, `SUM(C${firstExcelRow}:C${lastExcelRow})`, towerUnitSf, styles.totalSf);
    setFormula(ws, `D${totalExcelRow}`, `IFERROR(C${totalExcelRow}/B${totalExcelRow},0)`, formulaResult(towerUnitSf / towerUnitRows.length), styles.totalSf);
    for (let columnIndex = 5; columnIndex <= headers.length; columnIndex += 1) {
      const column = col(columnIndex);
      const unitType = unitTypes[columnIndex - 5];
      setFormula(ws, `${column}${totalExcelRow}`, `SUM(${column}${firstExcelRow}:${column}${lastExcelRow})`, countRows(rows, { tower: towerName, unit_type: unitType, unit: 'YES' }), styles.totalUnits);
    }
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];
  ws.autoFilter = { from: 'A3', to: `${col(headers.length)}${towerViews.length + 3}` };
  applyColumnWidths(ws, { A: 27, B: 15, C: 18, D: 18 });
  for (let i = 5; i <= headers.length; i += 1) ws.getColumn(i).width = 14;
}

function writeUnitMixSheet(wb, program, styles) {
  const rows = program.rows || [];
  const lastRegisterRow = registerLastExcelRow(rows);
  const unitPairs = (program.unit_pairs || []).map(item => [item.category, item.unit_type]);
  const categories = [...new Set(unitPairs.map(([category]) => category))].sort();
  const unitTypesByCategory = new Map(categories.map(category => [
    category,
    unitPairs.filter(([cat]) => cat === category).map(([, unitType]) => unitType).sort()
  ]));
  const ws = wb.addWorksheet('UNIT MIX');
  addTitle(ws, 'A1', 'H1', `${program.project?.project_name || 'PROJECT'} - UNIT MIX CHECK`, styles.title);
  addHeaderRow(ws, 3, ['Area Category', 'Unit Type', 'Units', 'Total SF', 'Average SF', 'Min SF', 'Max SF', '% of Units'], styles.head);
  const totalUnitsFormula = `COUNTIF(${registerRange('K', lastRegisterRow)},"YES")`;
  const totalUnitCount = countRows(rows, { unit: 'YES' });
  let excelRow = 4;
  let lastRowUsed = excelRow;

  categories.forEach((category, categoryIndex) => {
    if (categoryIndex > 0) excelRow += 1;
    const categoryFirstRow = excelRow;
    for (const unitType of unitTypesByCategory.get(category)) {
      const matchingUnits = unitRows(rows, { cat: category, unit_type: unitType });
      const totalSf = matchingUnits.reduce((sum, row) => sum + num(row.sf), 0);
      const criteria = `${registerRange('F', lastRegisterRow)},${quoted(category)},${registerRange('L', lastRegisterRow)},${quoted(unitType)},${registerRange('K', lastRegisterRow)},"YES"`;
      const matchMask = `(${registerRange('F', lastRegisterRow)}=${quoted(category)})*(${registerRange('L', lastRegisterRow)}=${quoted(unitType)})*(${registerRange('K', lastRegisterRow)}="YES")`;
      setValue(ws, `A${excelRow}`, category, styles.text);
      setValue(ws, `B${excelRow}`, unitType, styles.text);
      setFormula(ws, `C${excelRow}`, `COUNTIFS(${criteria})`, matchingUnits.length, styles.units);
      setFormula(ws, `D${excelRow}`, `SUMIFS(${registerRange('I', lastRegisterRow)},${criteria})`, totalSf, styles.sf);
      setFormula(ws, `E${excelRow}`, `IFERROR(D${excelRow}/C${excelRow},0)`, formulaResult(totalSf / matchingUnits.length), styles.sf);
      setArrayFormula(ws, `F${excelRow}`, `IFERROR(MIN(IF(${matchMask},${registerRange('I', lastRegisterRow)})),0)`, minSf(matchingUnits), styles.sf);
      setArrayFormula(ws, `G${excelRow}`, `IFERROR(MAX(IF(${matchMask},${registerRange('I', lastRegisterRow)})),0)`, maxSf(matchingUnits), styles.sf);
      setFormula(ws, `H${excelRow}`, `IFERROR(C${excelRow}/${totalUnitsFormula},0)`, formulaResult(matchingUnits.length / totalUnitCount), styles.percent);
      excelRow += 1;
    }
    const categoryLastRow = excelRow - 1;
    const totalRow = excelRow;
    const categoryRows = unitRows(rows, { cat: category });
    const categorySf = categoryRows.reduce((sum, row) => sum + num(row.sf), 0);
    setValue(ws, `A${totalRow}`, `${category} TOTAL`, styles.section);
    setValue(ws, `B${totalRow}`, '', styles.section);
    setFormula(ws, `C${totalRow}`, `SUM(C${categoryFirstRow}:C${categoryLastRow})`, categoryRows.length, styles.totalUnits);
    setFormula(ws, `D${totalRow}`, `SUM(D${categoryFirstRow}:D${categoryLastRow})`, categorySf, styles.totalSf);
    setFormula(ws, `E${totalRow}`, `IFERROR(D${totalRow}/C${totalRow},0)`, formulaResult(categorySf / categoryRows.length), styles.totalSf);
    setFormula(ws, `F${totalRow}`, `MIN(F${categoryFirstRow}:F${categoryLastRow})`, minSf(categoryRows), styles.totalSf);
    setFormula(ws, `G${totalRow}`, `MAX(G${categoryFirstRow}:G${categoryLastRow})`, maxSf(categoryRows), styles.totalSf);
    setFormula(ws, `H${totalRow}`, `IFERROR(C${totalRow}/${totalUnitsFormula},0)`, formulaResult(categoryRows.length / totalUnitCount), styles.totalPercent);
    lastRowUsed = totalRow;
    excelRow += 1;
  });

  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  ws.autoFilter = { from: 'A3', to: `H${lastRowUsed}` };
  applyColumnWidths(ws, { A: 26, B: 24, C: 15, D: 16, E: 16, F: 16, G: 16, H: 14 });
}

function writeOverallSheet(wb, program, styles) {
  const rows = program.rows || [];
  const lastRegisterRow = registerLastExcelRow(rows);
  const categories = program.categories || [];
  const project = program.project || {};
  const ws = wb.addWorksheet('OVERALL');
  addTitle(ws, 'A1', 'H1', `${project.project_name || 'PROJECT'} - OVERALL PROGRAM CHECK`, styles.title);
  [
    ['Project Name', project.project_name || ''],
    ['Project Number', project.project_number || ''],
    ['Address', project.project_address || '']
  ].forEach(([label, value], index) => {
    const excelRow = index + 3;
    setValue(ws, `A${excelRow}`, label, styles.section);
    setValue(ws, `B${excelRow}`, value, styles.text);
  });
  setValue(ws, 'D3', 'Excluded Exterior Decks SF', styles.section);
  setValue(ws, 'E3', num(program.excluded_deck_sf), styles.sf);

  const grossSf = rows.reduce((sum, row) => sum + num(row.sf), 0);
  const sellableSf = rows.filter(row => yes(row.sell)).reduce((sum, row) => sum + num(row.sf), 0);
  const brandedUnits = countRows(rows, { cat: 'BRANDED RESIDENTIAL', unit: 'YES' });
  const strUnits = countRows(rows, { cat: 'SHORT TERM RENTAL (STR)', unit: 'YES' });
  const hotelUnits = rows.filter(row => ['HOTEL', 'HOTEL GUESTROOM'].includes(normalize(row.cat)) && yes(row.unit)).length;

  setValue(ws, 'A7', 'Gross SF', styles.section);
  setFormula(ws, 'B7', `SUM(${registerRange('I', lastRegisterRow)})`, grossSf, styles.sf);
  setValue(ws, 'A8', 'Sellable / Leasable SF', styles.section);
  setFormula(ws, 'B8', `SUMIFS(${registerRange('I', lastRegisterRow)},${registerRange('J', lastRegisterRow)},"YES")`, sellableSf, styles.sf);
  setValue(ws, 'A9', 'Efficiency', styles.section);
  setFormula(ws, 'B9', 'IFERROR(B8/B7,0)', formulaResult(sellableSf / grossSf), styles.percent);
  setValue(ws, 'A10', 'BRANDED RESIDENTIAL', styles.section);
  setFormula(ws, 'B10', `COUNTIFS(${registerRange('F', lastRegisterRow)},"BRANDED RESIDENTIAL",${registerRange('K', lastRegisterRow)},"YES")`, brandedUnits, styles.units);
  setValue(ws, 'A11', 'SHORT TERM RENTAL (STR)', styles.section);
  setFormula(ws, 'B11', `COUNTIFS(${registerRange('F', lastRegisterRow)},"SHORT TERM RENTAL (STR)",${registerRange('K', lastRegisterRow)},"YES")`, strUnits, styles.units);
  setValue(ws, 'A12', 'HOTEL GUESTROOM', styles.section);
  setFormula(
    ws,
    'B12',
    `SUM(COUNTIFS(${registerRange('F', lastRegisterRow)},"HOTEL",${registerRange('K', lastRegisterRow)},"YES"),COUNTIFS(${registerRange('F', lastRegisterRow)},"HOTEL GUESTROOM",${registerRange('K', lastRegisterRow)},"YES"))`,
    hotelUnits,
    styles.units
  );

  addHeaderRow(ws, 14, ['Category', 'Gross SF', 'Sellable SF'], styles.head);
  categories.forEach((category, index) => {
    const excelRow = index + 15;
    setValue(ws, `A${excelRow}`, category, styles.text);
    setFormula(ws, `B${excelRow}`, `SUMIF(${registerRange('F', lastRegisterRow)},A${excelRow},${registerRange('I', lastRegisterRow)})`, sumRows(rows, { cat: category }), styles.sf);
    setFormula(ws, `C${excelRow}`, `SUMIFS(${registerRange('I', lastRegisterRow)},${registerRange('F', lastRegisterRow)},A${excelRow},${registerRange('J', lastRegisterRow)},"YES")`, sumRows(rows, { cat: category, sell: 'YES' }), styles.sf);
  });
  applyColumnWidths(ws, { A: 30, B: 52, C: 18, D: 24, E: 18 });
}

function writeValidationSheet(wb, program, styles) {
  const rows = program.rows || [];
  const ws = wb.addWorksheet('VALIDATION');
  addTitle(ws, 'A1', 'F1', 'EXCEL <-> REVIT RECONCILIATION', styles.title);
  addHeaderRow(ws, 3, ['Check', 'Revit / Source', 'Excel Formula', 'Difference', 'Status', 'Notes'], styles.head);
  const grossSf = rows.reduce((sum, row) => sum + num(row.sf), 0);
  const sellableSf = rows.filter(row => yes(row.sell)).reduce((sum, row) => sum + num(row.sf), 0);
  const checks = [
    ['Gross SF', grossSf, 'OVERALL!B7', 'SF'],
    ['Sellable / Leasable SF', sellableSf, 'OVERALL!B8', 'SF'],
    ['BRANDED RESIDENTIAL', countRows(rows, { cat: 'BRANDED RESIDENTIAL', unit: 'YES' }), 'OVERALL!B10', 'UNITS'],
    ['SHORT TERM RENTAL (STR)', countRows(rows, { cat: 'SHORT TERM RENTAL (STR)', unit: 'YES' }), 'OVERALL!B11', 'UNITS'],
    ['HOTEL GUESTROOM', rows.filter(row => ['HOTEL', 'HOTEL GUESTROOM'].includes(normalize(row.cat)) && yes(row.unit)).length, 'OVERALL!B12', 'UNITS']
  ];
  checks.forEach(([name, sourceValue, formula, measure], index) => {
    const excelRow = index + 4;
    const valueStyle = measure === 'SF' ? styles.sf : styles.units;
    setValue(ws, `A${excelRow}`, name, styles.text);
    setValue(ws, `B${excelRow}`, sourceValue, valueStyle);
    setFormula(ws, `C${excelRow}`, formula, sourceValue, valueStyle);
    setFormula(ws, `D${excelRow}`, `C${excelRow}-B${excelRow}`, 0, valueStyle);
    setFormula(ws, `E${excelRow}`, `IF(ABS(D${excelRow})<=0.01,"PASS","CHECK")`, 'PASS', styles.text);
    setValue(ws, `F${excelRow}`, 'Formula reconciliation using included records only.', styles.text);
  });
  try {
    ws.addConditionalFormatting({
      ref: 'E4:E20',
      rules: [
        {
          type: 'containsText',
          operator: 'containsText',
          text: 'PASS',
          priority: 1,
          style: { font: { bold: true, color: { argb: 'FF274E13' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } } }
        },
        {
          type: 'containsText',
          operator: 'containsText',
          text: 'CHECK',
          priority: 2,
          style: { font: { bold: true, color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } } }
        }
      ]
    });
  } catch (error) {
    console.warn('ExcelJS conditional formatting could not be applied.', error);
  }
  applyColumnWidths(ws, { A: 28, B: 20, C: 20, D: 20, E: 14, F: 48 });
}

function writeAreaRegisterSheet(wb, program, styles) {
  const rows = program.rows || [];
  const headers = [
    'Area Record ID', 'View', 'Level', 'Elevation (ft)', 'Tower / Zone',
    'Area Category', 'Area / Unit Name', 'Number', 'Revit Area SF',
    'Sellable?', 'Unit?', 'Normalized Unit Type'
  ];
  const ws = wb.addWorksheet('AREA REGISTER');
  const tableRows = rows.map(row => [
    row.id || '',
    row.view || '',
    row.level || '',
    num(row.elev),
    row.tower || '',
    row.cat || '',
    row.name || '',
    row.num || '',
    num(row.sf),
    row.sell || '',
    row.unit || '',
    row.unit_type || ''
  ]);
  ws.addTable({
    name: 'AreaRegisterTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: headers.map(name => ({ name })),
    rows: tableRows
  });
  applyStyle(ws.getRow(1), styles.head);
  for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber += 1) {
    applyStyle(ws.getRow(rowNumber), styles.text);
    setCellStyle(ws.getCell(`D${rowNumber}`), styles.decimal);
    setCellStyle(ws.getCell(`I${rowNumber}`), styles.sf);
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  applyColumnWidths(ws, { A: 25, B: 25, C: 25, D: 13, E: 18, F: 25, G: 25, H: 10, I: 17, J: 18, K: 18, L: 18 });
}

export async function buildProgramExcelWorkbook(raw) {
  if (!hasProgramExcelPayload(raw)) {
    throw new Error('The loaded JSON does not include a program export block.');
  }
  const ExcelJS = await ensureExcelJS();
  const program = raw.program;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Revit Area Analysis Viewer';
  wb.lastModifiedBy = 'Revit Area Analysis Viewer';
  wb.created = new Date();
  wb.modified = new Date();
  wb.properties.title = `${program.project?.project_name || 'Project'} Area Program`;
  wb.properties.subject = 'Formula-driven area program reconciliation workbook';
  wb.properties.comments = 'Formula-driven reconciliation workbook generated from area_working JSON.';
  wb.calcProperties = wb.calcProperties || {};
  wb.calcProperties.fullCalcOnLoad = true;
  const styles = sheetStyles();

  writeOverallSheet(wb, program, styles);
  writePodiumSheet(wb, program, styles);
  writeTowerSheet(wb, program, styles, 'SOUTH TOWER', 'SOUTH', program.views?.south || []);
  writeTowerSheet(wb, program, styles, 'NORTH TOWER', 'NORTH', program.views?.north || []);
  writeUnitMixSheet(wb, program, styles);
  writeValidationSheet(wb, program, styles);
  writeAreaRegisterSheet(wb, program, styles);
  return wb;
}

export async function downloadProgramExcel(raw, sourceFileName = '') {
  const workbook = await buildProgramExcelWorkbook(raw);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  downloadBlob(blob, programExcelFileName(raw.program, sourceFileName));
}
