// Shared numeric, formatting, point, and area helpers.
export function revitToLatLng(pt) {
  const p = pointXYZ(pt, { x: 0, y: 0, z: 0 });
  return L.latLng(toNum(p && p.y), toNum(p && p.x));
}

export function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function firstArray(...items) {
  for (const item of items) {
    if (Array.isArray(item) && item.length) return item;
  }
  return [];
}

export function safeObj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function clampOpacity(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function isOpaque(value) {
  return clampOpacity(value, 1) >= 0.999;
}

export function areaSqFt(area) {
  return toNum(area?._editorPreviewSqft ?? area?.revit_calculated_area_sqft ?? area?.area_sqft ?? area?.area, 0);
}

export function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtFtIn(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';

  const sign = n < 0 ? '-' : '';
  let totalInches = Math.round(Math.abs(n) * 12);
  let feet = Math.floor(totalInches / 12);
  let inches = totalInches % 12;

  return `${sign}${feet}'-${inches}"`;
}

export function fmtSF(value) {
  return Math.round(toNum(value, 0)).toLocaleString();
}

export function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


export function pointXYZ(value, fallback = null) {
  if (Array.isArray(value)) {
    const x = toNum(value[0], NaN);
    const y = toNum(value[1], NaN);
    const z = toNum(value[2], 0);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y, z };
    return fallback;
  }
  if (value && typeof value === 'object') {
    const x = toNum(value.x, NaN);
    const y = toNum(value.y, NaN);
    const z = toNum(value.z, 0);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y, z };
  }
  return fallback;
}

export function areaCategory(area) {
  const raw = area?.area_category ?? area?.category ?? area?.department ?? 'Uncategorized';
  const txt = String(raw || '').trim();
  return txt || 'Uncategorized';
}

export function areaName(area) {
  return String(area?.area_name ?? area?.name ?? 'Unnamed').trim() || 'Unnamed';
}

export function areaNumber(area) {
  return String(area?.area_number ?? area?.number ?? '').trim();
}
