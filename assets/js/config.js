// Stable viewer configuration extracted from the standalone source.
export const REVIT_BLUE = '#0000ff';
export const DEFAULT_GROUP_PALETTE = ['#e6e6ff', '#d5d5d5', '#cfe4d9', '#ffffcc', '#a5a5a5', '#b4dabf', '#88aed9', '#feedfa', '#f5f5f5', '#ffc8c8', '#ffcb97', '#dff5ec', '#eefbe7', '#dceeff', '#fff2cf', '#eadff7', '#f8e1de', '#d8f3f7', '#fbe5ef', '#f3f0d9'];
// Revit Color Scheme: Areas (AREA BLDG ANALYSIS) / LEGEND / Area Category.
// These are used whenever the JSON does not include an exported color-scheme payload.
export const DEFAULT_AREA_GROUP_COLORS = {
  'AMENITIES': '#e6e6ff',
  'BOH / MEP': '#d5d5d5',
  'BRANDED RESIDENTIAL': '#cfe4d9',
  'CIRCULATION': '#ffffcc',
  'CORE': '#a5a5a5',
  'EXTERIOR DECKS': '#b4dabf',
  'HOTEL': '#88aed9',
  'OFFICE': '#feedfa',
  'PARKING': '#f5f5f5',
  'RETAIL / COMMERCIAL': '#ffc8c8',
  'SHORT TERM RENTAL (STR)': '#ffcb97',
  'P. CORE': '#a5a5a5',
  'P. POOL DECK': '#b4dabf'
};

export const DEFAULT_REPORT_TAB_VISIBILITY = {
  project: true,
  activeFloor: true,
  unitMix: true,
  levelSummary: false,
  areaByCategory: true,
  excludedExteriorAreas: false,
  areaRegister: false
};

export const EDITOR_VERSION = 'area-working-viewer-v1.4.2';
