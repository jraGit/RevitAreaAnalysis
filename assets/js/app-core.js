import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import {
  REVIT_BLUE,
  DEFAULT_GROUP_PALETTE,
  DEFAULT_AREA_GROUP_COLORS,
  DEFAULT_REPORT_TAB_VISIBILITY,
  EDITOR_VERSION
} from './config.js';
import { createAppState, createTwoDState, createThreeState } from './state.js';
import { getDomElements } from './dom.js';
import { createDataLoader } from './data-loader.js';
import {
  revitToLatLng,
  toNum,
  firstArray,
  safeObj,
  clampOpacity,
  isOpaque,
  areaSqFt,
  fmt,
  fmtFtIn,
  fmtSF,
  escapeHTML,
  clamp,
  pointXYZ,
  areaCategory,
  areaName,
  areaNumber
} from './utils.js';

export function initializeApplication() {
  'use strict';

  let editorState = null;

  const state = createAppState();
  const twoDState = createTwoDState();
  const threeState = createThreeState(THREE);
  const els = getDomElements();

  const { loadFiles } = createDataLoader({
    applyLoadedJson,
    loadEditorProjectObject,
    applyWorkingSessionObject
  });

  editorState = initEditorState(null, '');

  if (!window.L) {
    document.body.innerHTML = '<div style="padding:24px;font-family:Arial">Leaflet did not load. This file uses Leaflet and Three.js from CDN, so open it with internet access or replace the CDN links with local files.</div>';
    return;
  }

  const map = L.map('map', {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
    minZoom: -6,
    maxZoom: 8,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 150,
    scrollWheelZoom: false,
    dragging: false,
    boxZoom: true,
    doubleClickZoom: true,
    maxBoundsViscosity: 0
  });

  map.setView([0, 0], 0);
  createPanes();
  bind2DMiddlePan();
  bind2DWheelZoom();
  initThree();
  initPaneResizer();
  initSidebarResizer();
  applyReportTabVisibility();
  updateFloorControls();
  updateSummary();
  updateZScaleUI();
  initEditorInteractions();
  animate3D();

  map.on('zoomstart zoom zoomend moveend', () => update2DLabelScale(false));
  map.on('mousemove', e => {
    if (isEditorModeEnabled() && editorState?.drawStart && ['line', 'rectangle', 'circle'].includes(activeEditorTool())) {
      updateDrawPreview(pointForEditorLatLng(e.latlng));
    }
  });

  map.on('click', e => {
    // Map is always visible in 2D pane - clicks always handled
    if (e.originalEvent?.__revitAreaHandled) return;
    if (editorState?.suppressNextMapClick) {
      editorState.suppressNextMapClick = false;
      return;
    }

    const hit = find2DAreaAtLatLng(e.latlng);
    if (isEditorModeEnabled()) {
      if (handleEditorDrawingClick(e.latlng)) return;
      if (hit && activeEditorTool() !== 'move') selectEditorItem('area', getEditorKey(hit.area, hit.floor, 'area'), e.originalEvent || {});
      else if (!hit && activeEditorTool() !== 'move') clearEditorSelection(true);
      return;
    }
    if (hit) {
      select2DArea(hit.floor, hit.area, hit.layer, e.latlng);
    } else {
      map.closePopup();
      clearSelection(true);
    }
  });

  function bind2DMiddlePan() {
    const container = map.getContainer();

    container.addEventListener('contextmenu', e => {
      e.preventDefault();
    });

    container.addEventListener('mousedown', e => {
      if (e.button !== 1) return;

      e.preventDefault();
      e.stopPropagation();

      twoDState.middlePanning = true;
      twoDState.lastPoint = { x: e.clientX, y: e.clientY };
      container.classList.add('middle-panning');
      document.body.classList.add('no-middle-autoscroll');
    });

    document.addEventListener('mousemove', e => {
      if (!twoDState.middlePanning) return;

      e.preventDefault();

      const dx = e.clientX - twoDState.lastPoint.x;
      const dy = e.clientY - twoDState.lastPoint.y;
      twoDState.lastPoint = { x: e.clientX, y: e.clientY };

      // Slight gain makes large Revit plans feel closer to CAD/Revit-style pan.
      const panGain = 1.35;
      map.panBy([-dx * panGain, -dy * panGain], { animate: false });
    }, { passive: false });

    document.addEventListener('mouseup', e => {
      if (!twoDState.middlePanning) return;

      e.preventDefault();

      twoDState.middlePanning = false;
      twoDState.lastPoint = null;
      container.classList.remove('middle-panning');
      document.body.classList.remove('no-middle-autoscroll');
    }, { passive: false });

    window.addEventListener('blur', () => {
      twoDState.middlePanning = false;
      twoDState.lastPoint = null;
      container.classList.remove('middle-panning');
      document.body.classList.remove('no-middle-autoscroll');
    });
  }

  function bind2DWheelZoom() {
    const container = map.getContainer();
    if (!container) return;

    // Use the mouse center wheel directly instead of relying on Leaflet's
    // debounced wheel handler. This keeps zoom responsive in split-screen
    // and while the editor is active.
    container.addEventListener('wheel', e => {
      if (!state.floors.length) return;
      if (e.target?.closest?.('input, select, button, summary, details')) return;

      e.preventDefault();
      e.stopPropagation();

      const currentZoom = Number(map.getZoom());
      if (!Number.isFinite(currentZoom)) return;

      const direction = e.deltaY < 0 ? 1 : -1;
      const nextZoom = clamp(
        currentZoom + direction * 0.5,
        map.getMinZoom(),
        map.getMaxZoom()
      );
      if (nextZoom === currentZoom) return;

      const rect = container.getBoundingClientRect();
      const cursorPoint = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const cursorLatLng = map.containerPointToLatLng(cursorPoint);
      map.setZoomAround(cursorLatLng, nextZoom);
      update2DLabelScale(false);
    }, { passive: false, capture: true });
  }

  function createPanes() {
    if (state.panesReady) return;
    map.createPane('areasPane');
    map.getPane('areasPane').style.zIndex = 410;
    map.createPane('columnsPane');
    map.getPane('columnsPane').style.zIndex = 420;
    map.createPane('wallsPane');
    map.getPane('wallsPane').style.zIndex = 425;
    map.createPane('boundariesPane');
    map.getPane('boundariesPane').style.zIndex = 430;
    map.createPane('propertyLinesPane');
    map.getPane('propertyLinesPane').style.zIndex = 435;
    map.createPane('labelsPane');
    map.getPane('labelsPane').style.zIndex = 450;
    map.getPane('labelsPane').style.pointerEvents = 'none';
    map.createPane('editorPane');
    map.getPane('editorPane').style.zIndex = 470;
    state.panesReady = true;
  }

  function initThree() {
    threeState.scene = new THREE.Scene();
    threeState.scene.background = new THREE.Color(0xffffff);

    threeState.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
    threeState.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    threeState.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    threeState.renderer.outputColorSpace = THREE.SRGBColorSpace;
    els.stack3d.prepend(threeState.renderer.domElement);
    threeState.renderer.domElement.style.position = 'absolute';
    threeState.renderer.domElement.style.inset = '0';
    threeState.renderer.domElement.style.width = '100%';
    threeState.renderer.domElement.style.height = '100%';
    threeState.renderer.domElement.style.display = 'block';

    threeState.raycaster = new THREE.Raycaster();
    threeState.raycaster.params.Line.threshold = 2;
    threeState.worldGroup = new THREE.Group();
    threeState.scene.add(threeState.worldGroup);

    const ambient = new THREE.AmbientLight(0xffffff, 0.88);
    threeState.scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.55);
    dir1.position.set(140, 280, 180);
    threeState.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.22);
    dir2.position.set(-220, 120, -180);
    threeState.scene.add(dir2);


    bind3DEvents();
    resize3D();
    threeState.ready = true;
  }

  function bind3DEvents() {
    const canvas = threeState.renderer.domElement;

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('auxclick', e => e.preventDefault());

    canvas.addEventListener('pointerdown', e => {
      // 3D controls:
      // left click = pick/select areas, white canvas = deselect
      // left drag = rotate
      // middle drag = pan
      // shift + middle drag = rotate
      // wheel = zoom
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();

      threeState.dragging = true;
      threeState.dragButton = e.button;
      threeState.dragMode = e.button === 1 ? (e.shiftKey ? 'rotate' : 'pan') : 'rotate';
      threeState.dragStart = { x: e.clientX, y: e.clientY };
      threeState.didMove = false;

      canvas.setPointerCapture(e.pointerId);
      if (threeState.dragMode !== 'pick') els.stack3d.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', e => {
      if (!threeState.dragging) return;
      e.preventDefault();

      const dx = e.clientX - threeState.dragStart.x;
      const dy = e.clientY - threeState.dragStart.y;
      const movedEnough = Math.abs(dx) + Math.abs(dy) > 3;
      if (movedEnough) threeState.didMove = true;
      threeState.dragStart = { x: e.clientX, y: e.clientY };

      if (threeState.dragMode === 'rotate') {
        if (threeState.dragButton === 0 && !threeState.didMove) return;
        hideAll3DLabels();
        threeState.azimuth -= dx * 0.006;
        threeState.elevation += dy * 0.006;
        threeState.elevation = clamp(threeState.elevation, -Math.PI * 0.47, Math.PI * 0.47);
        updateCamera();
      } else if (threeState.dragMode === 'pan') {
        panCamera(dx, dy);
      }
    });

    canvas.addEventListener('pointerup', e => {
      if (!threeState.dragging) return;
      e.preventDefault();

      const didMove = threeState.didMove;

      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { }
      els.stack3d.classList.remove('dragging');
      threeState.dragging = false;
      threeState.dragMode = null;

      if (state.mode === '3d' && threeState.dragButton === 0 && !didMove) {
        pick3DArea(e);
      }
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();

      // Both panes are permanently visible. Do not gate 3D wheel zoom on
      // state.mode, because that made the wheel stop whenever 2D was the
      // last active context.
      const rawDelta = e.deltaMode === 1
        ? e.deltaY * 16
        : (e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY);
      const boundedDelta = clamp(rawDelta, -240, 240);
      const factor = Math.exp(boundedDelta * 0.0012);
      threeState.cameraDistance = clamp(
        threeState.cameraDistance * factor,
        20,
        8000
      );
      updateCamera();
    }, { passive: false });
  }

  function panCamera(dx, dy) {
    const camera = threeState.camera;
    const rect = threeState.renderer.domElement.getBoundingClientRect();
    const distanceScale = threeState.cameraDistance / Math.max(rect.width, rect.height, 1);
    const panSpeed = distanceScale * 1.35;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    // Pan direction tuned per axis: left/right tracks correctly; vertical was reversed.
    threeState.target.addScaledVector(right, -dx * panSpeed);
    threeState.target.addScaledVector(up, dy * panSpeed);
    updateCamera();
  }

  function pick3DArea(event) {
    if (isEditorModeEnabled()) return pick3DEditorObject(event);
    if (!threeState.areaMeshes.length) {
      clearSelection();
      return false;
    }

    const rect = threeState.renderer.domElement.getBoundingClientRect();
    threeState.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    threeState.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    threeState.raycaster.setFromCamera(threeState.pointer, threeState.camera);

    const hits = threeState.raycaster.intersectObjects(threeState.areaMeshes, false);
    if (!hits.length) {
      const groupHits = threeState.raycaster.intersectObjects(threeState.typicalGroupMeshes || [], false);
      const group = groupHits[0]?.object?.userData?.group || null;
      const representativeFloor = group?.representativeFloor || group?.baseFloor || null;
      if (representativeFloor && activateFloorForPicked3DObject(representativeFloor, false)) {
        clearSelection(true);
        return true;
      }

      clearSelection();
      return false;
    }

    const mesh = hits[0].object;

    if (threeState.selectedMesh === mesh) {
      clearSelection(true);
      return true;
    }

    const { floor, area } = mesh.userData;
    select3DArea(floor, area, mesh);
    return true;
  }



  function getAreaAnchorPoint(area) {
    return pointXYZ(area?.location_point) || pointXYZ(area?.centroid) || getAreaLabelFallbackPoint(area);
  }



  function isWorkingPackage(json) {
    return !!json && json.schema === 'area_working' && String(json.schema_version || '').startsWith('1.');
  }

  function sourceRevitId(record) {
    return record?.source?.revit_id ?? record?.revit_id ?? record?.id ?? null;
  }

  function sourceRevitUniqueId(record) {
    return record?.source?.revit_unique_id || record?.revit_unique_id || record?.unique_id || '';
  }

  function withZ(point, z = 0) {
    const pt = pointXYZ(point);
    if (!pt) return null;
    return [pt.x, pt.y, Number.isFinite(pt.z) && Array.isArray(point) && point.length > 2 ? pt.z : toNum(z, 0)];
  }

  function boundaryDisplayPoints(line) {
    const points = firstArray(line?.display_points, line?.curve?.display_points)
      .map(pt => pointXYZ(pt))
      .filter(Boolean);
    if (points.length >= 2) return points;
    const start = pointXYZ(line?.start || line?.curve?.start);
    const end = pointXYZ(line?.end || line?.curve?.end);
    return start && end ? [start, end] : [];
  }

  function workingAreaToViewer(recordId, record, level, view, scheme) {
    const z = toNum(level?.height_from_project_base_point_ft ?? level?.elevation_internal_ft, 0);
    const params = safeObj(record?.parameters);
    const loops = (Array.isArray(record?.loops) ? record.loops : [])
      .map(loop => (Array.isArray(loop?.points) ? loop.points : []).map(pt => withZ(pt, z)).filter(Boolean))
      .filter(loop => loop.length >= 3);
    const placement = withZ(record?.placement_point_xy, z);
    return {
      record_id: recordId,
      id: sourceRevitId(record),
      unique_id: sourceRevitUniqueId(record),
      source_id: sourceRevitId(record),
      source_unique_id: sourceRevitUniqueId(record),
      source_fingerprint: record?.source?.source_fingerprint || '',
      view_id: record?.view_id || view?.id || '',
      level_id: record?.level_id || level?.id || '',
      area_scheme_id: record?.area_scheme_id || scheme?.id || '',
      area_scheme: { id: scheme?.id || record?.area_scheme_id || '', name: scheme?.name || '' },
      area_scheme_context: { id: scheme?.id || record?.area_scheme_id || '', name: scheme?.name || '' },
      area_number: params.number ?? '',
      number: params.number ?? '',
      area_name: params.name ?? 'Unnamed',
      name: params.name ?? 'Unnamed',
      area_category: params.area_category ?? 'Uncategorized',
      area_type: params.area_type ?? '',
      color_group: params.color_group ?? '',
      comments: params.comments ?? '',
      unit_type: params.unit_type ?? '',
      occupant: params.occupant ?? '',
      occupant_load_factor: params.occupant_load_factor ?? 0,
      tower: params.tower ?? '',
      revit_calculated_area_sqft: toNum(record?.revit_area_sqft, 0),
      area_sqft: toNum(record?.revit_area_sqft, 0),
      location_point: placement,
      placement_point: placement,
      geometry_loops: loops,
      boundary_loops: loops,
      bounds_xy: record?.bounds_xy || null,
      provenance: safeClone(record?.provenance || {}),
      parameter_element_references: safeClone(record?.parameter_element_references || {})
    };
  }

  function workingBoundaryToViewer(recordId, record, level, view, scheme) {
    const curve = safeObj(record?.curve);
    const z = toNum(curve.z_ft ?? level?.height_from_project_base_point_ft ?? level?.elevation_internal_ft, 0);
    const start = withZ(curve.start, z);
    const end = withZ(curve.end, z);
    const mid = withZ(curve.mid, z);
    const displayPoints = (Array.isArray(curve.display_points) ? curve.display_points : [])
      .map(pt => withZ(pt, z))
      .filter(Boolean);
    return {
      record_id: recordId,
      id: sourceRevitId(record),
      unique_id: sourceRevitUniqueId(record),
      source_id: sourceRevitId(record),
      source_unique_id: sourceRevitUniqueId(record),
      source_fingerprint: record?.source?.source_fingerprint || '',
      view_id: record?.view_id || view?.id || '',
      level_id: record?.level_id || level?.id || '',
      area_scheme_id: record?.area_scheme_id || scheme?.id || '',
      area_scheme: { id: scheme?.id || record?.area_scheme_id || '', name: scheme?.name || '' },
      area_scheme_context: { id: scheme?.id || record?.area_scheme_id || '', name: scheme?.name || '' },
      geometry_type: curve.type || 'line',
      curve: safeClone(curve),
      start,
      end,
      mid,
      display_points: displayPoints.length >= 2 ? displayPoints : [start, end].filter(Boolean),
      line_style: record?.line_style || '',
      source_kind: record?.source_kind || ''
    };
  }

  function workingWallToViewer(recordId, record, typeRecord, level) {
    const geometry = safeObj(record?.geometry);
    const centerline = safeObj(geometry.centerline);
    const z = toNum(centerline.z_ft ?? geometry.base_z_ft ?? level?.height_from_project_base_point_ft, 0);
    const start = withZ(centerline.start, z);
    const end = withZ(centerline.end, z);
    return {
      record_id: recordId,
      id: sourceRevitId(record),
      unique_id: sourceRevitUniqueId(record),
      source_id: sourceRevitId(record),
      source_unique_id: sourceRevitUniqueId(record),
      visible_in_view_ids: safeClone(record?.visible_in_view_ids || []),
      intersects_level_ids: safeClone(record?.intersects_level_ids || []),
      classification: safeClone(record?.classification || {}),
      parameters: safeClone(record?.parameters || {}),
      constraints: safeClone(record?.constraints || {}),
      type_id: record?.type_id || '',
      type_name: typeRecord?.name || '',
      family_name: typeRecord?.family_name || '',
      type: { width_ft: toNum(typeRecord?.width_ft ?? geometry.width_ft, 0.5) },
      geometry: {
        render_method: geometry.render_method || 'extruded_rectangle_from_centerline_width',
        centerline: [start, end].filter(Boolean),
        width_ft: toNum(geometry.width_ft ?? typeRecord?.width_ft, 0.5),
        base_z_ft: toNum(geometry.base_z_ft, z),
        top_z_ft: toNum(geometry.top_z_ft, z + 10),
        height_ft: toNum(geometry.height_ft, 10)
      },
      centerline: [start, end].filter(Boolean),
      width_ft: toNum(geometry.width_ft ?? typeRecord?.width_ft, 0.5),
      base_z_ft: toNum(geometry.base_z_ft, z),
      top_z_ft: toNum(geometry.top_z_ft, z + 10),
      height_ft: toNum(geometry.height_ft, 10)
    };
  }

  function workingColumnToViewer(recordId, record, level) {
    const geometry = safeObj(record?.geometry);
    const baseZ = toNum(geometry.base_z_ft ?? level?.height_from_project_base_point_ft, 0);
    const footprint = (Array.isArray(geometry.footprint) ? geometry.footprint : [])
      .map(pt => withZ(pt, baseZ))
      .filter(Boolean);
    return {
      record_id: recordId,
      id: sourceRevitId(record),
      unique_id: sourceRevitUniqueId(record),
      source_id: sourceRevitId(record),
      source_unique_id: sourceRevitUniqueId(record),
      visible_in_view_ids: safeClone(record?.visible_in_view_ids || []),
      intersects_level_ids: safeClone(record?.intersects_level_ids || []),
      name: record?.name || '',
      family_name: record?.family_name || '',
      type_name: record?.type_name || '',
      structural_material: record?.structural_material || '',
      geometry: {
        ...safeClone(geometry),
        footprint,
        base_z_ft: baseZ,
        top_z_ft: toNum(geometry.top_z_ft, baseZ + 10)
      },
      footprint,
      base_z_ft: baseZ,
      top_z_ft: toNum(geometry.top_z_ft, baseZ + 10),
      height_ft: toNum(geometry.height_ft, 10)
    };
  }

  function workingPropertyLineToViewer(recordId, record, level) {
    const curve = safeObj(record?.curve);
    const z = toNum(curve.z_ft ?? level?.height_from_project_base_point_ft, 0);
    return {
      record_id: recordId,
      id: sourceRevitId(record),
      unique_id: sourceRevitUniqueId(record),
      start: withZ(curve.start, z),
      end: withZ(curve.end, z),
      curve: safeClone(curve)
    };
  }

  function wallBelongsOnLevelPlane(record, levelRecord, allLevels) {
    // Revit plan-view membership may include walls from an underlay or the
    // story immediately below. Use the wall's real vertical extents as the
    // authoritative test for display on this analytical Level.
    const geometry = safeObj(record?.geometry);
    const levelZ = toNum(
      levelRecord?.height_from_project_base_point_ft
        ?? levelRecord?.elevation_internal_ft,
      NaN
    );
    const baseZ = toNum(geometry.base_z_ft, NaN);
    const topZ = toNum(geometry.top_z_ft, NaN);

    // Preserve older/partial files when vertical information is unavailable.
    if (![levelZ, baseZ, topZ].every(Number.isFinite)) return true;

    // Derive a small tolerance from this project's Level spacing rather
    // than assuming one fixed building type. It remains capped so a wall
    // terminating at the current Level is not treated as crossing it.
    const elevations = Object.values(allLevels || {})
      .map(level => toNum(
        level?.height_from_project_base_point_ft
          ?? level?.elevation_internal_ft,
        NaN
      ))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let nearestSpacing = Number.POSITIVE_INFINITY;
    for (let i = 1; i < elevations.length; i++) {
      const spacing = elevations[i] - elevations[i - 1];
      if (spacing > 0.01) nearestSpacing = Math.min(nearestSpacing, spacing);
    }
    const toleranceFt = Number.isFinite(nearestSpacing)
      ? Math.min(0.10, Math.max(0.01, nearestSpacing * 0.005))
      : 0.05;

    // Show a wall when it starts at/below this Level and continues above
    // it. A one-story wall from the Level below normally ends at levelZ,
    // so it is excluded. A multi-Level shear/core wall continues above
    // levelZ and remains visible.
    return baseZ <= levelZ + toleranceFt
      && topZ > levelZ + toleranceFt;
  }

  function normalizeWorkingPackage(json, fileName) {
    const catalog = safeObj(json.catalog);
    const levels = safeObj(catalog.levels);
    const views = safeObj(catalog.views);
    const schemes = safeObj(catalog.area_schemes);
    const baseline = safeObj(json.baseline);
    const areasById = safeObj(baseline.areas);
    const boundariesById = safeObj(baseline.boundary_segments);
    const context = safeObj(baseline.context);
    const wallsById = safeObj(context.walls);
    const columnsById = safeObj(context.structural_columns);
    const propertyLinesById = safeObj(context.property_lines);
    const wallTypes = safeObj(catalog.context_types?.wall_types);
    const memberships = safeObj(json.relationships?.view_membership);
    const floors = [];

    const orderedViews = Object.entries(views).sort((a, b) => {
      const levelA = levels[a[1]?.level_id] || {};
      const levelB = levels[b[1]?.level_id] || {};
      const za = toNum(levelA.height_from_project_base_point_ft ?? levelA.elevation_internal_ft, Number.POSITIVE_INFINITY);
      const zb = toNum(levelB.height_from_project_base_point_ft ?? levelB.elevation_internal_ft, Number.POSITIVE_INFINITY);
      return za - zb || String(a[1]?.name || '').localeCompare(String(b[1]?.name || ''));
    });

    orderedViews.forEach(([viewId, viewRecord], viewIndex) => {
      const levelRecord = levels[viewRecord?.level_id] || {};
      const schemeRecord = schemes[viewRecord?.area_scheme_id] || {};
      const membership = memberships[viewId] || {};
      const level = {
        id: viewRecord?.level_id || '',
        name: levelRecord.name || viewRecord.name || `Level ${viewIndex + 1}`,
        height_from_project_base_point_ft: levelRecord.height_from_project_base_point_ft ?? levelRecord.elevation_internal_ft,
        raw_level_elevation_ft: levelRecord.elevation_internal_ft
      };
      const view = { id: viewId, ...viewRecord };
      const scheme = { id: viewRecord?.area_scheme_id || '', name: schemeRecord.name || '' };

      const areaIds = Array.isArray(membership.area_ids)
        ? membership.area_ids
        : Object.keys(areasById).filter(id => areasById[id]?.view_id === viewId);
      const boundaryIds = Array.isArray(membership.boundary_segment_ids)
        ? membership.boundary_segment_ids
        : Object.keys(boundariesById).filter(id => boundariesById[id]?.view_id === viewId);
      const candidateWallIds = Array.isArray(membership.wall_ids)
        ? membership.wall_ids
        : Object.keys(wallsById).filter(id => (wallsById[id]?.visible_in_view_ids || []).includes(viewId));
      const wallIds = candidateWallIds.filter(id => {
        const wallRecord = wallsById[id];
        return wallRecord
          ? wallBelongsOnLevelPlane(wallRecord, levelRecord, levels)
          : false;
      });
      const columnIds = Array.isArray(membership.structural_column_ids)
        ? membership.structural_column_ids
        : Object.keys(columnsById).filter(id => (columnsById[id]?.visible_in_view_ids || []).includes(viewId));
      // Property Lines are project/site context. Transformer v1.5+ flattens
      // each Revit PropertyLine into segment records, while older membership
      // arrays may still contain the parent PropertyLine IDs.
      const membershipPropertyLineIds = Array.isArray(membership.property_line_ids)
        ? membership.property_line_ids
        : [];
      const membershipPropertyLineIdSet = new Set(membershipPropertyLineIds.map(String));
      const propertyLineIds = Object.keys(propertyLinesById).filter(id => {
        const record = propertyLinesById[id] || {};
        const parentId = String(record.source_parent_record_id || '');
        return membershipPropertyLineIdSet.has(String(id))
          || (parentId && membershipPropertyLineIdSet.has(parentId))
          || record.host_view_id === viewId
          || record.view_id === viewId;
      });

      const singleViewJson = {
        schema: json.schema,
        schema_version: json.schema_version,
        workflow_stage: json.workflow_stage,
        export_schema: json.schema,
        export_info: {
          working_id: json.working?.working_id || '',
          baseline_fingerprint: json.working?.baseline_fingerprint || '',
          raw_package_id: json.source?.raw_package_id || '',
          source_model_title: json.project?.document_title || json.project?.model_file_name || ''
        },
        project_information: json.project?.project_information || {},
        coordinate_reference: json.coordinate_system || {},
        coordinate_basis: json.coordinate_system || {},
        units: { length: json.coordinate_system?.length_unit || 'feet', area: json.coordinate_system?.area_unit || 'square_feet' },
        project_base_point: json.coordinate_system?.project_base_point || {},
        level,
        view_name: viewRecord.name || level.name,
        view_type: viewRecord.view_type || 'AreaPlan',
        view_id: viewId,
        view_unique_id: viewRecord.source?.revit_unique_id || '',
        area_scheme: scheme,
        areas: areaIds.map(id => areasById[id] ? workingAreaToViewer(id, areasById[id], level, view, scheme) : null).filter(Boolean),
        boundary_lines: boundaryIds.map(id => boundariesById[id] ? workingBoundaryToViewer(id, boundariesById[id], level, view, scheme) : null).filter(Boolean),
        property_lines: propertyLineIds.map(id => propertyLinesById[id] ? workingPropertyLineToViewer(id, propertyLinesById[id], level) : null).filter(Boolean),
        walls_2d: wallIds.map(id => {
          const rec = wallsById[id];
          return rec ? workingWallToViewer(id, rec, wallTypes[rec.type_id] || {}, level) : null;
        }).filter(Boolean),
        structural_columns_2d: columnIds.map(id => columnsById[id] ? workingColumnToViewer(id, columnsById[id], level) : null).filter(Boolean)
      };

      const normalized = normalizeFloor(singleViewJson, fileName, { batchRoot: json, levelIndex: viewIndex, viewIndex });
      normalized.workingSource = {
        workingId: json.working?.working_id || '',
        baselineFingerprint: json.working?.baseline_fingerprint || '',
        rawPackageId: json.source?.raw_package_id || '',
        sourceScopeFingerprint: viewRecord.source_scope_fingerprint || ''
      };
      normalized.workingViewId = viewId;
      const explicitGroupMeta = json.derived?.by_view?.[viewId]?.typical_group || null;
      if (explicitGroupMeta) normalized._explicitTypicalGroupMeta = safeClone(explicitGroupMeta);
      floors.push(normalized);
    });

    // Property Lines are project-wide context. Put all segments only on
    // the actual lowest analytical floor, regardless of the Revit host view.
    if (floors.length && Object.keys(propertyLinesById).length) {
      const lowestFloor = floors.reduce((lowest, floor) => {
        if (!lowest) return floor;
        return toNum(floor?.heightFt, Number.POSITIVE_INFINITY)
          < toNum(lowest?.heightFt, Number.POSITIVE_INFINITY)
          ? floor
          : lowest;
      }, null);

      for (const floor of floors) floor.propertyLines = [];

      if (lowestFloor) {
        const lowestLevel = {
          height_from_project_base_point_ft: toNum(lowestFloor.heightFt, 0)
        };
        lowestFloor.propertyLines = Object.entries(propertyLinesById)
          .map(([id, record]) => workingPropertyLineToViewer(id, record, lowestLevel))
          .filter(Boolean);
      }
    }

    return floors;
  }

  function freezeWorkingBaseline(json) {
    const root = json?.baseline;
    if (!root || typeof root !== 'object') return;
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push(child);
      }
      try { Object.freeze(value); } catch (_) { }
    }
  }

  function applyLoadedJson(json, fileName, uiState = null) {
    const floors = normalizeFloorsFromJSON(json, fileName);
    if (!floors.length) {
      throw new Error('No area plan levels/views were found. Expected area_working v1, levels[].views[], or a legacy single-view export.');
    }

    clearActiveLayerGroup();
    map.closePopup();
    clearSelection(true);
    clear3DWorld();

    if (isWorkingPackage(json)) freezeWorkingBaseline(json);
    state.projectInfo = isWorkingPackage(json)
      ? (json.project?.project_information || {})
      : (json.project_information || json.metadata?.project_information || json.project || {});
    state.exportInfo = isWorkingPackage(json)
      ? {
        ...safeClone(json.source || {}),
        working_id: json.working?.working_id || '',
        baseline_fingerprint: json.working?.baseline_fingerprint || '',
        source_model_title: json.project?.document_title || json.project?.model_file_name || ''
      }
      : (json.export_info || json.metadata || json.source || {});
    state.propertyLineExport = json.property_line_export || {};
    state.floors = floors.sort((a, b) => {
      const ha = Number.isFinite(a.heightFt) ? a.heightFt : Number.POSITIVE_INFINITY;
      const hb = Number.isFinite(b.heightFt) ? b.heightFt : Number.POSITIVE_INFINITY;
      if (ha !== hb) return ha - hb;
      return a.name.localeCompare(b.name);
    });

    editorState = initEditorState(json, fileName);
    if (uiState) {
      editorState.selectionMode = uiState.selectionMode || editorState.selectionMode;
      editorState.showDeleted = !!uiState.showDeleted;
    }
    applyActiveBoundaryOperationsToFloors();
    assignEditorKeysToFloors(state.floors);
    rebuildDeletedMapsFromChangesets();
    applyDeletedStateToRenderData();
    markChangedViewsTopologyDirty();
    recomputeFloorCaches();

    const activeLevelId = uiState?.activeLevelId;
    const activeViewId = uiState?.activeViewId;
    state.activeIndex = Math.max(0, state.floors.findIndex(f =>
      (!activeLevelId || String(f.levelId) === String(activeLevelId)) &&
      (!activeViewId || String(f.viewId) === String(activeViewId))
    ));
    state.areaGroups = extractAreaGroups(state.floors);
    state.importedAreaColorMap = extractAreaColorMapFromJSON(json);
    state.styleSettings.areaColorMap = buildDefaultAreaColorMap(state.areaGroups);
    ensureAreaColorMap(state.areaGroups);
    state.reportData = buildReportData(json, state.floors);

    updateFloorControls();
    renderActiveFloor(true);
    render3DStack(true);
    renderStyleLegend();
    renderProjectInfo();
    renderReports();
    updateSummary();
    resize3D();
    threeState.azimuth = Math.PI * 0.20;
    threeState.elevation = Math.PI * 0.24;
    fit3DStackAfterLayout();
    fitActiveFloorAfterLayout();
    setEditorMode(false);
    editorState.dirty = false;
    if (els.loadedFileLabel) els.loadedFileLabel.innerHTML = `LOADED: <strong>${escapeHTML(fileName)}</strong>`;
    updateEditorPanel();
    showWorkingValidationReport(false);
  }

  function normalizeFloorsFromJSON(json, fileName) {
    if (isWorkingPackage(json)) return normalizeWorkingPackage(json, fileName);

    // Clean Room-to-Area pipeline schema:
    // {
    //   schema: "room_to_area_pipeline",
    //   workflow_stage: "area_plan_final_export",
    //   levels: [
    //     { id, name, height_from_project_base_point_ft, views: [{ areas, area_boundary_lines, boundary_lines, walls, structural_columns, ... }] }
    //   ]
    // }
    if (Array.isArray(json.levels)) {
      const floors = [];

      json.levels.forEach((level, levelIndex) => {
        const views = Array.isArray(level.views) && level.views.length
          ? level.views
          : [{
            name: level.name,
            type: 'AreaPlan',
            level,
            areas: level.areas || [],
            boundary_lines: firstArray(level.boundary_lines, level.area_boundary_lines),
            property_lines: level.property_lines || [],
            walls_2d: firstArray(level.walls_2d, level.walls, level.source_walls),
            structural_columns_2d: firstArray(level.structural_columns_2d, level.structural_columns, level.columns)
          }];

        views.forEach((view, viewIndex) => {
          const normalized = normalizeBatchView(json, level, view, fileName, levelIndex, viewIndex);
          if (normalized.areas.length || normalized.boundaryLines.length || normalized.walls2d.length || normalized.columns2d.length) {
            floors.push(normalized);
          }
        });
      });

      return floors;
    }

    // Legacy single-view schema fallback.
    return [normalizeFloor(json, fileName, { batchRoot: null, levelIndex: 0, viewIndex: 0 })]
      .filter(floor => floor.areas.length || floor.boundaryLines.length || floor.walls2d.length || floor.columns2d.length);
  }

  function normalizeBatchView(batchRoot, level, view, fileName, levelIndex, viewIndex) {
    const viewLevel = view.level || {};
    const levelInfo = {
      id: level.id ?? viewLevel.id ?? '',
      name: level.name || viewLevel.name || view.name || `Level ${levelIndex + 1}`,
      height_from_project_base_point_ft: level.height_from_project_base_point_ft ?? viewLevel.height_from_project_base_point_ft,
      raw_level_elevation_ft: level.raw_level_elevation_ft ?? viewLevel.raw_level_elevation_ft ?? level.elevation_ft,
      elevation_ft: level.elevation_ft ?? viewLevel.elevation_ft
    };

    const singleViewJson = {
      schema: batchRoot.schema || '',
      schema_version: batchRoot.schema_version || '',
      workflow_stage: batchRoot.workflow_stage || '',
      export_schema: batchRoot.export_schema || batchRoot.schema || '',
      export_info: batchRoot.export_info || batchRoot.metadata || {},
      summary: batchRoot.summary || {},
      project_information: batchRoot.project_information || batchRoot.metadata?.project_information || {},
      project_base_point: batchRoot.project_base_point || batchRoot.metadata?.project_base_point || {},
      coordinate_reference: batchRoot.coordinate_reference || batchRoot.coordinate_basis || batchRoot.metadata?.coordinate_basis || {},
      coordinate_basis: batchRoot.coordinate_basis || batchRoot.coordinate_reference || batchRoot.metadata?.coordinate_basis || {},
      units: batchRoot.units || batchRoot.metadata?.units || {},
      level: levelInfo,
      view_name: view.name || levelInfo.name,
      view_type: view.type || 'AreaPlan',
      view_id: view.id ?? '',
      view_unique_id: view.unique_id || '',
      area_scheme: view.area_scheme || { id: view.area_scheme_id ?? '', name: view.area_scheme_name || '' },
      areas: Array.isArray(view.areas) ? view.areas : [],
      boundary_lines: firstArray(view.boundary_lines, view.area_boundary_lines, view.reviewed_area_boundary_lines, view.resolved_area_boundary_lines),
      area_boundary_lines: firstArray(view.area_boundary_lines, view.boundary_lines, view.reviewed_area_boundary_lines, view.resolved_area_boundary_lines),
      property_lines: Array.isArray(view.property_lines) ? view.property_lines : [],
      walls_2d: firstArray(view.walls_2d, view.walls, view.source_walls),
      structural_columns_2d: firstArray(view.structural_columns_2d, view.structural_columns, view.columns)
    };

    return normalizeFloor(singleViewJson, fileName, { batchRoot, levelIndex, viewIndex });
  }

  function normalizeFloor(json, fileName, context = {}) {
    const level = json.level || {};
    const areas = Array.isArray(json.areas) ? json.areas : [];
    const boundaryLines = firstArray(json.boundary_lines, json.area_boundary_lines, json.reviewed_area_boundary_lines, json.resolved_area_boundary_lines);
    const propertyLines = Array.isArray(json.property_lines) ? json.property_lines : [];
    const walls2d = firstArray(json.walls_2d, json.walls, json.source_walls);
    const columns2d = firstArray(json.structural_columns_2d, json.structural_columns, json.columns);
    const firstArea = areas[0] || {};
    const firstBoundary = boundaryLines[0] || {};
    const firstPropertyLine = propertyLines[0] || {};
    const firstWall = walls2d[0] || {};
    const firstColumn = columns2d[0] || {};
    const fallbackZ = pointXYZ(firstArea.location_point || firstArea.centroid)?.z
      ?? pointXYZ(firstBoundary.start)?.z
      ?? pointXYZ(firstBoundary.end)?.z
      ?? pointXYZ(firstPropertyLine.start)?.z
      ?? pointXYZ(firstPropertyLine.end)?.z
      ?? firstWall.geometry?.base_z_ft
      ?? firstWall.base_z_ft
      ?? firstColumn.geometry?.base_z_ft
      ?? firstColumn.base_z_ft;
    const heightFt = toNum(level.height_from_project_base_point_ft ?? level.raw_level_elevation_ft ?? level.elevation_ft ?? fallbackZ, NaN);
    const areaScheme = json.area_scheme || firstArea.area_scheme || firstBoundary.area_scheme || { id: json.area_scheme_id ?? firstArea.area_scheme_id ?? '', name: json.area_scheme_name || firstArea.area_scheme_name || '' };

    let displayName = level.name || json.view_name || fileName;
    if (areaScheme.name && json.view_name && json.view_name !== displayName) {
      displayName = `${displayName} · ${areaScheme.name}`;
    }

    const floor = {
      sourceFile: fileName,
      raw: json,
      batchRoot: context.batchRoot || null,
      batchLevelIndex: context.levelIndex ?? 0,
      batchViewIndex: context.viewIndex ?? 0,
      name: displayName,
      levelName: level.name || displayName,
      viewName: json.view_name || '',
      viewType: json.view_type || '',
      viewId: json.view_id ?? '',
      viewUniqueId: json.view_unique_id || '',
      areaScheme,
      exportSchema: json.export_schema || json.schema || json.schema_version || '',
      schema: json.schema || '',
      schemaVersion: json.schema_version || '',
      workflowStage: json.workflow_stage || '',
      levelId: level.id ?? '',
      heightFt,
      units: json.units || {},
      coordinateReference: json.coordinate_reference || json.coordinate_basis || {},
      coordinateBasis: json.coordinate_basis || json.coordinate_reference || {},
      projectBasePoint: json.project_base_point || {},
      areas,
      boundaryLines,
      propertyLines,
      walls2d,
      columns2d,
      bounds: null,
      stats: null,
      layers: { areas: [], labels: [], boundaries: [], propertyLines: [], walls: [], columns: [] },
      y3D: 0
    };

    prepareFloorGeometryCaches(floor);
    floor.bounds = computeFloorBounds(floor);
    floor.stats = computeFloorStats(floor);
    return floor;
  }

  function prepareFloorGeometryCaches(floor) {
    for (const area of floor.areas || []) prepareAreaGeometryCache(area);
    for (const wall of floor.walls2d || []) prepareWallGeometryCache(wall);
    for (const column of floor.columns2d || []) prepareColumnGeometryCache(column);
  }

  function prepareAreaGeometryCache(area) {
    if (!area || area._geometryPrepared) return area;

    const rawLoops = Array.isArray(area._editorPreviewLoops)
      ? area._editorPreviewLoops
      : (Array.isArray(area.geometry_loops)
        ? area.geometry_loops
        : (Array.isArray(area.boundary_loops) ? area.boundary_loops.map(loop => Array.isArray(loop) ? loop : loop.points) : []));

    const cleanLoops = rawLoops
      .filter(loop => Array.isArray(loop) && loop.length >= 3)
      .map(cleanLoop)
      .filter(loop => loop.length >= 3);

    area._cleanLoops = cleanLoops;
    area._latLngLoops = cleanLoops.map(loop => loop.map(revitToLatLng));

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;

    for (const loop of cleanLoops) {
      for (const pt of loop) {
        const x = toNum(pt.x);
        const y = toNum(pt.y);
        const z = toNum(pt.z);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        sx += x;
        sy += y;
        sz += z;
        count += 1;
      }
    }

    area._box = count
      ? { minX, maxX, minY, maxY }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    area._labelFallbackPoint = count ? { x: sx / count, y: sy / count, z: sz / count } : null;
    area._geometryPrepared = true;
    return area;
  }

  function prepareWallGeometryCache(wall) {
    if (!wall || wall._geometryPrepared) return wall;

    const geometry = safeObj(wall.geometry);
    const centerline = firstArray(wall.centerline, geometry.centerline);
    const points = centerline
      .filter(Boolean)
      .map(pt => pointXYZ(pt))
      .filter(pt => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));

    wall._centerlinePoints = points;
    wall._centerlineLatLngs = points.map(revitToLatLng);
    const width = wallWidthFt(wall);
    const strips = [];
    for (let i = 0; i < points.length - 1; i++) {
      const strip = wallSegmentStrip2D(points[i], points[i + 1], width);
      if (strip) strips.push(strip);
    }
    wall._strips2d = strips;
    wall._geometryPrepared = true;
    return wall;
  }

  function prepareColumnGeometryCache(column) {
    if (!column || column._geometryPrepared) return column;

    const geometry = safeObj(column.geometry);
    const footprint = firstArray(column.footprint, geometry.footprint);
    const points = footprint
      .filter(Boolean)
      .map(pt => pointXYZ(pt))
      .filter(pt => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));

    if (points.length > 2) {
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) points.pop();
    }

    column._footprintPoints = points;
    column._footprintLatLngs = points.map(revitToLatLng);
    column._geometryPrepared = true;
    return column;
  }

  function computeFloorBounds(floor) {
    const latLngs = [];
    for (const area of floor.areas) {
      prepareAreaGeometryCache(area);
      for (const loop of (area._latLngLoops || [])) {
        for (const pt of loop) latLngs.push(pt);
      }
      const anchor = getAreaAnchorPoint(area);
      if (anchor) latLngs.push(revitToLatLng(anchor));
    }
    for (const line of floor.boundaryLines) {
      for (const pt of boundaryDisplayPoints(line)) latLngs.push(revitToLatLng(pt));
    }
    for (const line of floor.propertyLines || []) {
      if (line.start) latLngs.push(revitToLatLng(line.start));
      if (line.end) latLngs.push(revitToLatLng(line.end));
    }
    for (const wall of floor.walls2d || []) {
      prepareWallGeometryCache(wall);
      for (const pt of (wall._centerlineLatLngs || [])) latLngs.push(pt);
    }
    for (const column of floor.columns2d || []) {
      prepareColumnGeometryCache(column);
      for (const pt of (column._footprintLatLngs || [])) latLngs.push(pt);
    }
    if (!latLngs.length) return L.latLngBounds([[-50, -50], [50, 50]]);
    return L.latLngBounds(latLngs).pad(0.08);
  }

  function getAreaColorGroup(area) {
    // Color by area_category, not color_group. This matches the Excel/export classification workflow.
    return areaCategory(area);
  }

  function extractAreaGroups(floors) {
    const groups = new Set();
    for (const floor of floors || []) {
      for (const area of floor.areas || []) groups.add(getAreaColorGroup(area));
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
  }

  function normalizeAreaColorKey(value) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }

  function hexFromColorPayload(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      const text = value.trim();
      const hexMatch = text.match(/^#?([0-9a-f]{6})$/i);
      if (hexMatch) return `#${hexMatch[1].toLowerCase()}`;
      const rgbMatch = text.match(/RGB\s*[:=]?\s*(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/i);
      if (rgbMatch) {
        const r = clamp(Math.round(Number(rgbMatch[1])), 0, 255);
        const g = clamp(Math.round(Number(rgbMatch[2])), 0, 255);
        const b = clamp(Math.round(Number(rgbMatch[3])), 0, 255);
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
      }
      return '';
    }
    const rgb = value.rgb || value.color || value;
    const r = Number(rgb.r ?? rgb.red ?? rgb.Red);
    const g = Number(rgb.g ?? rgb.green ?? rgb.Green);
    const b = Number(rgb.b ?? rgb.blue ?? rgb.Blue);
    if ([r, g, b].every(Number.isFinite)) {
      return '#' + [r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
    }
    return '';
  }

  function extractAreaColorMapFromJSON(json) {
    const candidates = [
      json?.area_color_scheme,
      json?.area_category_color_scheme,
      json?.areaCategoryColorScheme,
      json?.metadata?.area_color_scheme,
      json?.metadata?.area_category_color_scheme,
      json?.export_info?.area_color_scheme,
      json?.summary?.area_color_scheme
    ].filter(Boolean);

    const map = {};
    for (const scheme of candidates) {
      const entries = Array.isArray(scheme) ? scheme : firstArray(scheme.entries, scheme.color_entries, scheme.values, scheme.items);
      for (const entry of entries || []) {
        const rawValue = entry?.value ?? entry?.area_category ?? entry?.areaCategory ?? entry?.name ?? entry?.label;
        const key = normalizeAreaColorKey(rawValue);
        if (!key) continue;
        const hex = entry?.hex || entry?.color_hex || hexFromColorPayload(entry?.rgb || entry?.color || entry);
        if (hex) map[key] = hex;
      }
    }
    return map;
  }

  function getImportedAreaColor(group) {
    const key = normalizeAreaColorKey(group);
    return state.importedAreaColorMap?.[key] || '';
  }

  function getDefaultAreaColor(group, index = 0) {
    return getImportedAreaColor(group)
      || DEFAULT_AREA_GROUP_COLORS[group]
      || DEFAULT_AREA_GROUP_COLORS[normalizeAreaColorKey(group)]
      || DEFAULT_GROUP_PALETTE[index % DEFAULT_GROUP_PALETTE.length];
  }

  function buildDefaultAreaColorMap(groups) {
    const map = {};
    (groups || []).forEach((group, index) => {
      map[group] = getDefaultAreaColor(group, index);
    });
    return map;
  }

  function ensureAreaColorMap(groups) {
    const defaults = buildDefaultAreaColorMap(groups);
    const merged = { ...defaults, ...(state.styleSettings.areaColorMap || {}) };
    const filtered = {};
    (groups || []).forEach(group => { filtered[group] = merged[group] || defaults[group] || '#e8eefc'; });
    state.styleSettings.areaColorMap = filtered;
  }

  function getAreaFillColor(area) {
    const group = getAreaColorGroup(area);
    return state.styleSettings.areaColorMap?.[group] || '#e8eefc';
  }

  function renderStyleLegend() {
    if (!els.styleLegend) return;
    if (!state.areaGroups.length) {
      els.styleLegend.innerHTML = '<div class="small">Import a file to build the area-category legend.</div>';
      return;
    }
    els.styleLegend.innerHTML = state.areaGroups.map(group => `
  <div class="item"><span class="swatch" style="background:${escapeHTML(state.styleSettings.areaColorMap[group] || '#e8eefc')}"></span>${escapeHTML(group)}</div>
  `).join('');
  }


  function boolText(value) {
    return value ? 'Yes' : 'No';
  }

  function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${fmt(n * 100, 1)}%`;
  }

  function inferIncludesFromCategory(category, field) {
    const c = String(category || '').toUpperCase();
    if (field === 'gross') return !c.includes('EXTERIOR DECK');
    if (field === 'unitMix') return c.includes('RESIDENTIAL') || c.includes('SHORT TERM') || c.includes('BRANDED');
    if (field === 'sellable') {
      return c.includes('RESIDENTIAL') || c.includes('SHORT TERM') || c.includes('BRANDED') ||
        c.includes('RETAIL') || c.includes('COMMERCIAL') || c.includes('OFFICE') ||
        c.includes('FOOD') || c.includes('HOTEL KEY') || c.includes('HOTEL GUEST');
    }
    return false;
  }

  function areaToRegisterRow(area, floor) {
    const category = areaCategory(area);
    return {
      level_name: floor?.levelName || floor?.name || area.level_name || area.level?.name || '',
      level_id: floor?.levelId || area.level_id || area.level?.id || '',
      level_elevation_ft: floor?.heightFt ?? area.level_elevation_ft ?? '',
      view_name: floor?.viewName || area.view_name || '',
      area_scheme_name: floor?.areaScheme?.name || area.area_scheme_name || '',
      area_id: area.area_id ?? area.id ?? '',
      area_unique_id: area.area_unique_id ?? area.unique_id ?? '',
      area_number: areaNumber(area),
      area_name: areaName(area),
      area_sqft: areaSqFt(area),
      area_category: category,
      area_type: area.area_type || '',
      group_name: area.group_name || '',
      include_in_gross: area.include_in_gross ?? inferIncludesFromCategory(category, 'gross'),
      include_in_sellable: area.include_in_sellable ?? inferIncludesFromCategory(category, 'sellable'),
      include_in_unit_mix: area.include_in_unit_mix ?? inferIncludesFromCategory(category, 'unitMix'),
      notes: area.classification_notes || area.notes || '',
      unit_mix_key: area.unit_mix_key || ''
    };
  }

  function normalizeRegisterRow(row) {
    const category = String(row.area_category ?? row.Area_Category ?? row.category ?? 'Uncategorized').trim() || 'Uncategorized';
    return {
      level_name: row.level_name ?? row.Level_Name ?? '',
      level_id: row.level_id ?? row.Level_ID ?? '',
      level_elevation_ft: row.level_elevation_ft ?? row.Level_Elevation_FT ?? '',
      view_name: row.view_name ?? row.View_Name ?? '',
      area_scheme_name: row.area_scheme_name ?? row.Area_Scheme_Name ?? '',
      area_id: row.area_id ?? row.id ?? '',
      area_unique_id: row.area_unique_id ?? row.unique_id ?? '',
      area_number: row.area_number ?? row.number ?? '',
      area_name: row.area_name ?? row.name ?? 'Unnamed',
      area_sqft: toNum(row.area_sqft ?? row.area_sf ?? row.revit_calculated_area_sqft, 0),
      area_category: category,
      area_type: row.area_type ?? row.Area_Type ?? '',
      group_name: row.group_name ?? '',
      include_in_gross: row.include_in_gross ?? inferIncludesFromCategory(category, 'gross'),
      include_in_sellable: row.include_in_sellable ?? inferIncludesFromCategory(category, 'sellable'),
      include_in_unit_mix: row.include_in_unit_mix ?? inferIncludesFromCategory(category, 'unitMix'),
      notes: row.notes ?? row.classification_notes ?? '',
      unit_mix_key: row.unit_mix_key ?? ''
    };
  }

  function buildRegisterFromFloors(floors) {
    const rows = [];
    for (const floor of floors || []) {
      for (const area of floor.areas || []) rows.push(areaToRegisterRow(area, floor));
    }
    return rows;
  }

  function aggregateBy(rows, keyFn, seedFn, applyFn) {
    const map = new Map();
    for (const row of rows || []) {
      const key = keyFn(row);
      if (!map.has(key)) map.set(key, seedFn(row, key));
      applyFn(map.get(key), row);
    }
    return [...map.values()];
  }

  function buildAreaByCategory(rows, grossTotal) {
    return aggregateBy(rows, r => r.area_category || 'Uncategorized', (r, key) => ({ area_category: key, count: 0, total_sqft: 0, pct_of_gross_sqft: 0 }), (acc, r) => {
      acc.count += 1;
      acc.total_sqft += toNum(r.area_sqft, 0);
    }).map(row => ({ ...row, pct_of_gross_sqft: grossTotal ? row.total_sqft / grossTotal : 0 }))
      .sort((a, b) => b.total_sqft - a.total_sqft);
  }

  function buildUnitMix(rows) {
    const unitRows = (rows || []).filter(r => r.include_in_unit_mix);
    const totalUnits = unitRows.length || 0;
    const totalArea = unitRows.reduce((sum, r) => sum + toNum(r.area_sqft, 0), 0);
    return aggregateBy(unitRows, r => `${r.area_category || 'Unit'}||${r.unit_mix_key || r.area_name || 'Unnamed'}`, (r) => ({
      area_category: r.area_category || 'Unit',
      area_name: r.unit_mix_key || r.area_name || 'Unnamed',
      count: 0,
      total_sqft: 0,
      min_unit_sqft: Infinity,
      max_unit_sqft: 0,
      average_unit_sqft: 0,
      pct_of_total_units: 0,
      pct_of_total_unit_area: 0
    }), (acc, r) => {
      const sqft = toNum(r.area_sqft, 0);
      acc.count += 1;
      acc.total_sqft += sqft;
      acc.min_unit_sqft = Math.min(acc.min_unit_sqft, sqft);
      acc.max_unit_sqft = Math.max(acc.max_unit_sqft, sqft);
    }).map(row => ({
      ...row,
      min_unit_sqft: Number.isFinite(row.min_unit_sqft) ? row.min_unit_sqft : 0,
      average_unit_sqft: row.count ? row.total_sqft / row.count : 0,
      pct_of_total_units: totalUnits ? row.count / totalUnits : 0,
      pct_of_total_unit_area: totalArea ? row.total_sqft / totalArea : 0
    })).sort((a, b) => a.area_category.localeCompare(b.area_category) || a.area_name.localeCompare(b.area_name));
  }

  function buildLevelSummary(rows, floors) {
    const byLevel = aggregateBy(rows, r => r.level_name || 'Unknown Level', (r) => ({
      level_name: r.level_name || 'Unknown Level',
      gross_sqft: 0,
      sellable_sqft: 0,
      non_sellable_sqft: 0,
      residential_unit_count: 0,
      hotel_guestroom_count: 0,
      amenity_sqft: 0,
      core_sqft: 0,
      circulation_sqft: 0,
      boh_mep_sqft: 0,
      parking_sqft: 0,
      efficiency_ratio: 0
    }), (acc, r) => {
      const sqft = toNum(r.area_sqft, 0);
      const cat = String(r.area_category || '').toUpperCase();
      if (r.include_in_gross) acc.gross_sqft += sqft;
      if (r.include_in_sellable) acc.sellable_sqft += sqft;
      if (r.include_in_unit_mix) acc.residential_unit_count += 1;
      if (cat.includes('HOTEL')) acc.hotel_guestroom_count += 1;
      if (cat.includes('AMENIT')) acc.amenity_sqft += sqft;
      if (cat.includes('CORE')) acc.core_sqft += sqft;
      if (cat.includes('CIRCULATION')) acc.circulation_sqft += sqft;
      if (cat.includes('BOH') || cat.includes('MEP')) acc.boh_mep_sqft += sqft;
      if (cat.includes('PARKING')) acc.parking_sqft += sqft;
    }).map(row => ({ ...row, non_sellable_sqft: row.gross_sqft - row.sellable_sqft, efficiency_ratio: row.gross_sqft ? row.sellable_sqft / row.gross_sqft : 0 }));

    const order = new Map((floors || []).map((f, i) => [f.levelName || f.name, i]));
    return byLevel.sort((a, b) => (order.get(a.level_name) ?? 99999) - (order.get(b.level_name) ?? 99999));
  }

  function buildReportData(json, floors) {
    const summary = json.summary || {};
    const register = (Array.isArray(json.area_register) ? json.area_register : buildRegisterFromFloors(floors)).map(normalizeRegisterRow);
    const gross = toNum(summary.total_gross_sqft, register.filter(r => r.include_in_gross).reduce((sum, r) => sum + toNum(r.area_sqft, 0), 0));
    const sellable = toNum(summary.total_sellable_sqft, register.filter(r => r.include_in_sellable).reduce((sum, r) => sum + toNum(r.area_sqft, 0), 0));
    const unitCount = toNum(summary.unit_count, register.filter(r => r.include_in_unit_mix).length);
    const areaByCategory = Array.isArray(summary.area_by_category) && summary.area_by_category.length ? summary.area_by_category : buildAreaByCategory(register, gross);
    const levelSummary = Array.isArray(summary.level_summary) && summary.level_summary.length ? summary.level_summary : buildLevelSummary(register, floors);
    const unitMix = Array.isArray(summary.unit_mix) && summary.unit_mix.length ? summary.unit_mix : buildUnitMix(register);
    const excludedExteriorAreas = Array.isArray(summary.excluded_exterior_areas) ? summary.excluded_exterior_areas : [];

    return {
      summary: {
        totalGrossSqft: gross,
        totalSellableSqft: sellable,
        totalNonSellableSqft: toNum(summary.total_non_sellable_sqft, gross - sellable),
        efficiencyRatio: toNum(summary.efficiency_ratio, gross ? sellable / gross : 0),
        areaCount: toNum(summary.area_count, register.length),
        unitCount,
        excludedExteriorAreaCount: toNum(summary.excluded_exterior_area_count, excludedExteriorAreas.length),
        excludedExteriorAreaSqft: toNum(summary.excluded_exterior_area_sqft, excludedExteriorAreas.reduce((sum, r) => sum + toNum(r.area_sqft, 0), 0)),
        areaTypeRule: summary.area_type_rule || '',
        levelsCount: floors.length
      },
      register,
      areaByCategory,
      levelSummary,
      unitMix,
      excludedExteriorAreas
    };
  }

  function tableHTML(columns, rows, limit = 300) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const displayRows = safeRows.slice(0, limit);
    const head = columns.map(c => `<th class="${c.text ? 'text' : ''}">${escapeHTML(c.label)}</th>`).join('');
    const body = displayRows.map(row => `<tr>${columns.map(c => {
      const value = c.value(row);
      return `<td class="${c.text ? 'text' : ''}">${value}</td>`;
    }).join('')}</tr>`).join('');
    const note = safeRows.length > limit ? `<div class="report-note">Showing first ${fmt(limit, 0)} of ${fmt(safeRows.length, 0)} rows to keep the viewer responsive.</div>` : '';
    return `${note}<div class="table-wrap"><table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td class="text" colspan="' + columns.length + '">No rows.</td></tr>'}</tbody></table></div>`;
  }


  function normalizeReportKey(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function cleanUnitMixAreaName(row) {
    const category = String(row?.area_category || '').trim();
    const rawName = String(row?.area_name || '').trim();
    const prefix = category ? `${category} | ` : '';
    if (prefix && rawName.toUpperCase().startsWith(prefix.toUpperCase())) {
      return rawName.slice(prefix.length).trim() || rawName;
    }
    return rawName || 'Unnamed';
  }

  function groupedTableHTML(groupKeyFn, columns, rows, limit = 300) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const displayRows = safeRows.slice(0, limit);
    const head = columns.map(c => `<th class="${c.text ? 'text' : ''}">${escapeHTML(c.label)}</th>`).join('');
    const groups = new Map();
    for (const row of displayRows) {
      const groupName = groupKeyFn(row) || 'Uncategorized';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(row);
    }
    const body = [...groups.entries()].map(([groupName, groupRows]) => {
      const groupHeader = `<tr class="group-row"><td colspan="${columns.length}">${escapeHTML(groupName)}</td></tr>`;
      const groupBody = groupRows.map(row => `<tr>${columns.map(c => {
        const value = c.value(row);
        return `<td class="${c.text ? 'text' : ''}">${value}</td>`;
      }).join('')}</tr>`).join('');
      return groupHeader + groupBody;
    }).join('');
    const note = safeRows.length > limit ? `<div class="report-note">Showing first ${fmt(limit, 0)} of ${fmt(safeRows.length, 0)} rows to keep the viewer responsive.</div>` : '';
    return `${note}<div class="table-wrap"><table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td class="text" colspan="' + columns.length + '">No rows.</td></tr>'}</tbody></table></div>`;
  }

  function categorySummaryMetric(categoryName) {
    const target = normalizeReportKey(categoryName);
    const row = (state.reportData?.areaByCategory || []).find(item => normalizeReportKey(item.area_category) === target) || {};
    return {
      count: toNum(row.count, 0),
      totalSqft: toNum(row.total_sqft, 0)
    };
  }

  function selectedAreaCard(floor, area) {
    if (!area) return '';
    return `
  <h3>Selected Area</h3>
  <div class="info-grid">
    <div class="k">Name</div><div class="v"><strong>${escapeHTML(areaName(area))}</strong></div>
    <div class="k">Category</div><div class="v">${escapeHTML(areaCategory(area))}</div>
    <div class="k">Area</div><div class="v"><strong>${fmt(areaSqFt(area), 0)} SF</strong></div>
    <div class="k">Level</div><div class="v">${escapeHTML(floor?.name || '')}</div>
    <div class="k">Revit ID</div><div class="v mono">${escapeHTML(area.id || area.area_id || '—')}</div>
  </div>
  `;
  }

  function renderSummary() {
    if (!els.summaryPanel) return;
    if (!state.floors.length) {
      els.summaryPanel.innerHTML = '<div class="small">Import one combined Area Plan batch JSON file.</div>';
      return;
    }
    const s = state.reportData.summary || {};
    els.summaryPanel.innerHTML = `
  <div class="metric-grid">
    <div class="metric-card"><div class="label">Total Gross SF</div><div class="value">${fmt(s.totalGrossSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Sellable / Leasable SF</div><div class="value">${fmt(s.totalSellableSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Non-Sellable SF</div><div class="value">${fmt(s.totalNonSellableSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Efficiency</div><div class="value">${fmt((s.efficiencyRatio || 0) * 100, 1)}%</div></div>
    <div class="metric-card"><div class="label">Unit Count</div><div class="value">${fmt(s.unitCount, 0)}</div></div>
    <div class="metric-card"><div class="label">Area Count</div><div class="value">${fmt(s.areaCount, 0)}</div></div>
  </div>
  `;
  }

  function renderUnitMix() {
    const rows = [...(state.reportData.unitMix || [])].sort((a, b) =>
      String(a.area_category || '').localeCompare(String(b.area_category || '')) ||
      cleanUnitMixAreaName(a).localeCompare(cleanUnitMixAreaName(b))
    );
    els.unitMixPanel.innerHTML = groupedTableHTML(
      r => r.area_category || 'Unit Mix',
      [
        { label: 'Area Name', text: true, value: r => escapeHTML(cleanUnitMixAreaName(r)) },
        { label: 'Count', value: r => fmt(r.count, 0) },
        { label: 'Total SF', value: r => fmt(r.total_sqft, 0) },
        { label: 'Min Unit SF', value: r => fmt(r.min_unit_sqft, 0) },
        { label: 'Max Unit SF', value: r => fmt(r.max_unit_sqft, 0) },
        { label: 'Average Unit SF', value: r => fmt(r.average_unit_sqft, 0) },
        { label: '% Total Units', value: r => pct(r.pct_of_total_units) },
        { label: '% Total Unit Area', value: r => pct(r.pct_of_total_unit_area) }
      ],
      rows,
      300
    );
  }

  function renderLevelSummaryReport() {
    els.levelSummaryPanel.innerHTML = tableHTML([
      { label: 'Level Name', text: true, value: r => escapeHTML(r.level_name || '') },
      { label: 'Gross SF', value: r => fmt(r.gross_sqft, 0) },
      { label: 'Sellable / Leasable SF', value: r => fmt(r.sellable_leasable_sqft ?? r.sellable_sqft, 0) },
      { label: 'Non-Sellable SF', value: r => fmt(r.non_sellable_sqft, 0) },
      { label: 'Short Term Rental Units', value: r => fmt(r.short_term_rental_units, 0) },
      { label: 'Branded Residential Units', value: r => fmt(r.branded_residential_units, 0) },
      { label: 'Hotel Guestrooms', value: r => fmt(r.hotel_guestrooms ?? r.hotel_guestroom_count, 0) },
      { label: 'Amenity SF', value: r => fmt(r.amenity_sqft, 0) },
      { label: 'Core SF', value: r => fmt(r.core_sqft, 0) },
      { label: 'Circulation SF', value: r => fmt(r.circulation_sqft, 0) },
      { label: 'BOH / MEP SF', value: r => fmt(r.boh_mep_sqft, 0) },
      { label: 'Parking SF', value: r => fmt(r.parking_sqft, 0) },
      { label: 'Efficiency', value: r => pct(r.efficiency_ratio) }
    ], state.reportData.levelSummary || [], 500);
  }

  function renderAreaByCategoryReport() {
    els.areaByCategoryPanel.innerHTML = tableHTML([
      { label: 'Area Category', text: true, value: r => escapeHTML(r.area_category || '') },
      { label: 'Count', value: r => fmt(r.count, 0) },
      { label: 'Total SF', value: r => fmt(r.total_sqft, 0) },
      { label: '% Gross SF', value: r => pct(r.pct_of_gross_sqft) }
    ], state.reportData.areaByCategory || [], 300);
  }

  function renderExcludedExteriorAreasReport() {
    els.excludedExteriorAreasPanel.innerHTML = tableHTML([
      { label: 'Level Name', text: true, value: r => escapeHTML(r.level_name || '') },
      { label: 'View Name', text: true, value: r => escapeHTML(r.view_name || '') },
      { label: 'Area Name', text: true, value: r => escapeHTML(r.area_name || '') },
      { label: 'Area SF', value: r => fmt(r.area_sqft, 0) },
      { label: 'Area Category', text: true, value: r => escapeHTML(r.area_category || '') },
      { label: 'Area Type', text: true, value: r => escapeHTML(r.area_type || '') },
      { label: 'Notes', text: true, value: r => escapeHTML(r.notes || '') }
    ], state.reportData.excludedExteriorAreas || [], 300);
  }

  function renderAreaRegisterReport() {
    els.areaRegisterPanel.innerHTML = tableHTML([
      { label: 'Level Name', text: true, value: r => escapeHTML(r.level_name || '') },
      { label: 'View Name', text: true, value: r => escapeHTML(r.view_name || '') },
      { label: 'Area Name', text: true, value: r => escapeHTML(r.area_name || '') },
      { label: 'Area SF', value: r => fmt(r.area_sqft, 0) },
      { label: 'Area Category', text: true, value: r => escapeHTML(r.area_category || '') },
      { label: 'Area Type', text: true, value: r => escapeHTML(r.area_type || '') },
      { label: 'Group Name', text: true, value: r => escapeHTML(r.group_name || '') },
      { label: 'Include in Gross', value: r => boolText(r.include_in_gross) },
      { label: 'Include in Sellable', value: r => boolText(r.include_in_sellable) },
      { label: 'Include in Unit Mix', value: r => boolText(r.include_in_unit_mix) },
      { label: 'Area ID', value: r => escapeHTML(r.area_id || '') }
    ], state.reportData.register || [], 500);
  }

  function clearReportPanels(message = 'Import one combined Area Plan batch JSON file.') {
    [els.summaryPanel, els.unitMixPanel, els.levelSummaryPanel, els.areaByCategoryPanel, els.excludedExteriorAreasPanel, els.areaRegisterPanel].forEach(panel => {
      if (panel) panel.innerHTML = `<div class="small">${escapeHTML(message)}</div>`;
    });
  }

  function renderReports() {
    if (!state.floors.length) {
      clearReportPanels();
      updateSummary();
      return;
    }
    renderSummary();
    updateSummary();
    renderUnitMix();
    renderLevelSummaryReport();
    renderAreaByCategoryReport();
    renderExcludedExteriorAreasReport();
    renderAreaRegisterReport();
  }


  function sheetAnalysisTitleFromProject(info) {
    const name = String(info?.project_name || '').trim();
    if (!name) return 'Project Analysis';
    return `${name.toUpperCase()} • BLDG AREA ANALYSIS`;
  }

  function updateSheetAnalysisTitle() {
    if (!els.sheetTitleDisplay) return;
    els.sheetTitleDisplay.textContent = sheetAnalysisTitleFromProject(state.projectInfo || {});
  }

  function renderProjectInfo() {
    updateSheetAnalysisTitle();
    if (!els.projectInfoPanel) return;
    if (!state.floors.length) {
      els.projectInfoPanel.innerHTML = '<div class="small">Import one combined Area Plan batch JSON file.</div>';
      return;
    }
    const info = state.projectInfo || {};
    const summary = state.reportData?.summary || {};
    const branded = categorySummaryMetric('BRANDED RESIDENTIAL');
    const shortTerm = categorySummaryMetric('SHORT TERM RENTAL UNIT');
    const hotelGuestroom = categorySummaryMetric('HOTEL GUESTROOM');
    els.projectInfoPanel.innerHTML = `
  <div class="metric-grid">
    <div class="metric-card"><div class="label">Total Gross SF</div><div class="value">${fmt(summary.totalGrossSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Sellable / Leasable SF</div><div class="value">${fmt(summary.totalSellableSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Non-Sellable SF</div><div class="value">${fmt(summary.totalNonSellableSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Efficiency</div><div class="value">${fmt((summary.efficiencyRatio || 0) * 100, 1)}%</div></div>
    <div class="metric-card"><div class="label">Branded Residential</div><div class="value">${fmt(branded.count, 0)}</div></div>
    <div class="metric-card"><div class="label">Branded Residential SF</div><div class="value">${fmt(branded.totalSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Short Term Rental Unit</div><div class="value">${fmt(shortTerm.count, 0)}</div></div>
    <div class="metric-card"><div class="label">Short Term Rental Unit SF</div><div class="value">${fmt(shortTerm.totalSqft, 0)}</div></div>
    <div class="metric-card"><div class="label">Hotel Guestroom</div><div class="value">${fmt(hotelGuestroom.count, 0)}</div></div>
    <div class="metric-card"><div class="label">Hotel Guestroom SF</div><div class="value">${fmt(hotelGuestroom.totalSqft, 0)}</div></div>
  </div>
  <div class="report-note"><strong>Efficiency</strong> = Sellable / Leasable SF ÷ Total Gross SF.</div>
  `;
  }

  function setSidebarTab(tab) {
    const buttons = Array.from(document.querySelectorAll('#reportTabs [data-tab]'));
    const visibleButtons = buttons.filter(btn => !btn.hidden);
    const targetButton = visibleButtons.find(btn => btn.dataset.tab === tab) || visibleButtons[0];
    if (!targetButton) return;
    const target = targetButton.dataset.tab;
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === target && !btn.hidden);
    });
    document.querySelectorAll('.sidebar-tab-panel').forEach(panel => panel.classList.remove('active'));
    const panel = document.getElementById(`${target}TabPanel`);
    if (panel && !panel.hidden) panel.classList.add('active');
  }

  function applyReportTabVisibility() {
    if (!els.reportTabs) return;
    const buttons = Array.from(els.reportTabs.querySelectorAll('[data-tab]'));
    const visibility = state.reportTabVisibility || { ...DEFAULT_REPORT_TAB_VISIBILITY };
    let visibleCount = buttons.reduce((count, btn) => count + (visibility[btn.dataset.tab] !== false ? 1 : 0), 0);
    if (!visibleCount) {
      visibility.project = true;
      visibleCount = 1;
    }
    state.reportTabVisibility = visibility;

    buttons.forEach(btn => {
      const isVisible = visibility[btn.dataset.tab] !== false;
      btn.hidden = !isVisible;
      const panel = document.getElementById(`${btn.dataset.tab}TabPanel`);
      if (panel) {
        panel.hidden = !isVisible;
        if (!isVisible) panel.classList.remove('active');
      }
    });

    const activeButton = buttons.find(btn => btn.classList.contains('active') && !btn.hidden);
    if (!activeButton) {
      const firstVisible = buttons.find(btn => !btn.hidden);
      if (firstVisible) setSidebarTab(firstVisible.dataset.tab);
    }
  }

  function setReportTabCheckboxes() {
    const visibility = state.reportTabVisibility || DEFAULT_REPORT_TAB_VISIBILITY;
    if (els.setTabProject) els.setTabProject.checked = visibility.project !== false;
    if (els.setTabActiveFloor) els.setTabActiveFloor.checked = visibility.activeFloor !== false;
    if (els.setTabUnitMix) els.setTabUnitMix.checked = visibility.unitMix !== false;
    if (els.setTabLevelSummary) els.setTabLevelSummary.checked = visibility.levelSummary !== false;
    if (els.setTabAreaByCategory) els.setTabAreaByCategory.checked = visibility.areaByCategory !== false;
    if (els.setTabExcludedExteriorAreas) els.setTabExcludedExteriorAreas.checked = visibility.excludedExteriorAreas !== false;
    if (els.setTabAreaRegister) els.setTabAreaRegister.checked = visibility.areaRegister !== false;
  }

  function readReportTabVisibilityFromUI() {
    const visibility = {
      project: !!els.setTabProject?.checked,
      activeFloor: !!els.setTabActiveFloor?.checked,
      unitMix: !!els.setTabUnitMix?.checked,
      levelSummary: !!els.setTabLevelSummary?.checked,
      areaByCategory: !!els.setTabAreaByCategory?.checked,
      excludedExteriorAreas: !!els.setTabExcludedExteriorAreas?.checked,
      areaRegister: !!els.setTabAreaRegister?.checked
    };
    if (!Object.values(visibility).some(Boolean)) visibility.project = true;
    return visibility;
  }

  function populateSettingsUI() {
    const s = state.styleSettings;
    els.setAreaLineColor.value = s.areaLineColor;
    els.setAreaOpacity.value = clampOpacity(s.areaFillOpacity, 1);
    els.setAreaOpacityValue.textContent = clampOpacity(s.areaFillOpacity, 1).toFixed(2);
    els.setBoundaryLineColor.value = s.boundaryLineColor;
    els.setPropertyLineColor.value = s.propertyLineColor;
    els.setPropertyLineOpacity.value = clampOpacity(s.propertyLineOpacity, 1);
    els.setPropertyLineOpacityValue.textContent = clampOpacity(s.propertyLineOpacity, 1).toFixed(2);
    els.setPropertyLineWeight.value = toNum(s.propertyLineWeight, 3);
    els.setPropertyLineWeightValue.textContent = toNum(s.propertyLineWeight, 3).toFixed(1);
    els.setWallFillColor.value = s.wallFillColor;
    els.setWallLineColor.value = s.wallLineColor;
    els.setWallOpacity.value = clampOpacity(s.wallOpacity, 1);
    els.setWallOpacityValue.textContent = clampOpacity(s.wallOpacity, 1).toFixed(2);
    els.setColumnFillColor.value = s.columnFillColor;
    els.setColumnLineColor.value = s.columnLineColor;
    els.setColumnOpacity.value = clampOpacity(s.columnOpacity, 0.15);
    els.setColumnOpacityValue.textContent = clampOpacity(s.columnOpacity, 0.15).toFixed(2);

    setReportTabCheckboxes();

    els.areaGroupSettings.innerHTML = state.areaGroups.map(group => `
  <label>${escapeHTML(group)} <input type="color" data-area-group-color="${escapeHTML(group)}" value="${escapeHTML(s.areaColorMap[group] || '#e8eefc')}" /></label>
  `).join('');
  }

  function openSettingsModal() {
    populateSettingsUI();
    els.settingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    els.settingsModal.style.display = 'none';
  }

  function applySettingsFromUI() {
    state.styleSettings.areaLineColor = els.setAreaLineColor.value;
    state.styleSettings.boundaryLineColor = els.setBoundaryLineColor.value;
    state.styleSettings.propertyLineColor = els.setPropertyLineColor.value;
    state.styleSettings.propertyLineOpacity = clampOpacity(els.setPropertyLineOpacity.value, 1);
    state.styleSettings.propertyLineWeight = clamp(toNum(els.setPropertyLineWeight.value, 3), 1, 6);
    state.styleSettings.wallFillColor = els.setWallFillColor.value;
    state.styleSettings.wallLineColor = els.setWallLineColor.value;
    state.styleSettings.wallOpacity = clampOpacity(els.setWallOpacity.value, 1);
    state.styleSettings.wallFillOpacity2d = state.styleSettings.wallOpacity;
    state.styleSettings.columnFillColor = els.setColumnFillColor.value;
    state.styleSettings.columnLineColor = els.setColumnLineColor.value;
    state.styleSettings.columnOpacity = clampOpacity(els.setColumnOpacity.value, 0.15);
    state.styleSettings.columnFillOpacity2d = state.styleSettings.columnOpacity;
    state.reportTabVisibility = readReportTabVisibilityFromUI();
    applyReportTabVisibility();

    const map = { ...(state.styleSettings.areaColorMap || {}) };
    els.areaGroupSettings.querySelectorAll('[data-area-group-color]').forEach(input => {
      map[input.dataset.areaGroupColor] = input.value;
    });
    state.styleSettings.areaColorMap = map;
    rerenderVisuals();
    closeSettingsModal();
  }

  function resetVisualSettings() {
    state.styleSettings.areaLineColor = REVIT_BLUE;
    state.styleSettings.boundaryLineColor = '#000000';
    state.styleSettings.propertyLineColor = '#ff0000';
    state.styleSettings.propertyLineOpacity = 1;
    state.styleSettings.propertyLineWeight = 2;
    state.styleSettings.areaFillOpacity = 1;
    state.display3d.labels = true;
    state.display3d.boundaries = true;
    state.display3d.lines = true;
    state.display3d.propertyLines = true;
    state.display3d.walls = false;
    state.display3d.columns = false;
    state.display3d.areaTransparency = 0;
    state.display3d.lineTransparency = 0;
    state.display3d.typicalLineTransparency = 0.90;
    state.display3d.areaBoundaryTransparency = 0.15;
    state.display3d.propertyLineTransparency = 0;
    state.display3d.wallTransparency = 0.10;
    state.display3d.columnTransparency = 0.85;
    state.display2d.labels = true;
    state.display2d.boundaries = true;
    state.display2d.propertyLines = true;
    state.display2d.walls = true;
    state.display2d.columns = true;
    state.display2d.areaTransparency = 0;
    state.display2d.propertyLineTransparency = 0;
    state.display2d.wallTransparency = 0;
    state.display2d.columnTransparency = 0.5;
    syncPaneDisplayToggles();
    syncAreaTransparencyControls();
    syncObjectTransparencyControls();
    state.styleSettings.wallFillColor = '#b6b6b6';
    state.styleSettings.wallLineColor = '#b6b6b6';
    state.styleSettings.wallOpacity = 1;
    state.styleSettings.wallFillOpacity2d = state.styleSettings.wallOpacity;
    state.styleSettings.columnFillColor = '#b6b6b6';
    state.styleSettings.columnLineColor = '#b6b6b6';
    state.styleSettings.columnOpacity = 0.15;
    state.styleSettings.columnFillOpacity2d = state.styleSettings.columnOpacity;
    state.styleSettings.areaColorMap = buildDefaultAreaColorMap(state.areaGroups);
    state.reportTabVisibility = { ...DEFAULT_REPORT_TAB_VISIBILITY };
    applyReportTabVisibility();
    populateSettingsUI();
    rerenderVisuals();
  }

  function rerenderVisuals() {
    renderStyleLegend();
    if (state.floors.length) {
      renderActiveFloor(false);
      render3DStack(false);
      updateSummary();
      renderProjectInfo();
      renderReports();
    }
  }

  function computeFloorStats(floor) {
    const byName = new Map();
    const byCategory = new Map();
    let total = 0;
    for (const area of floor.areas) {
      const key = areaName(area);
      const category = areaCategory(area);
      const sqft = areaSqFt(area);
      total += sqft;
      if (!byName.has(key)) byName.set(key, { count: 0, sqft: 0 });
      const row = byName.get(key);
      row.count += 1;
      row.sqft += sqft;
      if (!byCategory.has(category)) byCategory.set(category, { count: 0, sqft: 0 });
      const cat = byCategory.get(category);
      cat.count += 1;
      cat.sqft += sqft;
    }
    return { totalArea: total, count: floor.areas.length, byName, byCategory };
  }

  function getAreaStyle(area, view = '2d') {
    const displayState = state[`display${view}`] || {};
    const viewOpacity = clampOpacity(1 - clampOpacity(displayState.areaTransparency ?? 0, 0), 1);
    const common = {
      pane: 'areasPane',
      color: state.styleSettings.areaLineColor,
      weight: 2.1,
      opacity: 1,
      fillOpacity: viewOpacity,
      lineJoin: 'miter',
      lineCap: 'butt',
      bubblingMouseEvents: false
    };

    return {
      ...common,
      fillColor: getAreaFillColor(area)
    };
  }

  function getHighlightStyle() {
    return { color: '#ff2f00', weight: 3.5, opacity: 1, fillColor: '#ffcf33', fillOpacity: 0.58 };
  }


  function objectTransparencyStateKey(key) {
    if (key === 'lines') return 'lineTransparency';
    if (key === 'typicalLines') return 'typicalLineTransparency';
    if (key === 'areaBoundaries') return 'areaBoundaryTransparency';
    if (key === 'propertyLines') return 'propertyLineTransparency';
    if (key === 'walls') return 'wallTransparency';
    if (key === 'columns') return 'columnTransparency';
    return '';
  }

  function objectTransparencyForView(view, key) {
    const stateKey = objectTransparencyStateKey(key);
    if (!stateKey) return 0;
    const displayState = state[`display${view}`] || {};
    let fallback = 0;
    if (key === 'columns') fallback = 0.85;
    if (key === 'typicalLines') fallback = 0.90;
    return clampOpacity(displayState[stateKey] ?? fallback, fallback);
  }

  function objectOpacityForView(view, key) {
    return clampOpacity(1 - objectTransparencyForView(view, key), key === 'columns' ? 0.15 : 1);
  }

  function setThreeLineColor(obj, color) {
    if (!obj) return;
    obj.traverse?.(child => {
      if (child.material && child.material.color) {
        child.material.color.set(color);
        child.material.needsUpdate = true;
      }
    });
  }

  function isThreeLineObject(obj) {
    return !!(obj && (obj.isLine || obj.isLineSegments || obj.type === 'Line' || obj.type === 'LineSegments'));
  }

  function isHelperLineObject(obj) {
    return obj?.userData?.kind === 'helper';
  }

  function threeLineSpecificOpacityFactor(obj) {
    if (obj?.userData?.kind === 'boundary') {
      return objectOpacityForView('3d', 'areaBoundaries');
    }
    if (obj?.userData?.kind === 'floorPerimeter' && obj?.userData?.typicalGroup) {
      return objectOpacityForView('3d', 'typicalLines');
    }
    return 1;
  }

  function resolvedThreeLineOpacity(obj, mat) {
    if (!mat) return 1;
    mat.userData = mat.userData || {};
    if (mat.userData.baseLineOpacity === undefined || mat.userData.baseLineOpacity === null) {
      mat.userData.baseLineOpacity = clampOpacity(mat.opacity ?? 1, 1);
    }
    const globalFactor = objectOpacityForView('3d', 'lines');
    const specificFactor = threeLineSpecificOpacityFactor(obj);
    return clampOpacity(
      mat.userData.baseLineOpacity * globalFactor * specificFactor,
      mat.userData.baseLineOpacity
    );
  }

  function apply3DAllLinesTransparency() {
    if (!threeState.worldGroup) return;
    threeState.worldGroup.traverse(obj => {
      if (!isThreeLineObject(obj) || isHelperLineObject(obj) || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(mat => {
        if (!mat) return;
        const nextOpacity = resolvedThreeLineOpacity(obj, mat);
        mat.opacity = nextOpacity;
        mat.transparent = !isOpaque(nextOpacity);
        mat.depthWrite = isOpaque(nextOpacity);
        mat.needsUpdate = true;
      });
    });
  }

  function refreshActiveFloorPerimeterHighlight() {
    if (!threeState.worldGroup) return;
    const activeFloor = state.floors[state.activeIndex] || null;
    const highlightColor = getHighlightStyle().color || '#ff2f00';

    threeState.worldGroup.traverse(obj => {
      if (obj?.userData?.kind !== 'floorPerimeter' || !obj.material) return;

      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      const isActive = !!(activeFloor && obj.userData.floor === activeFloor);

      // Start from the already-resolved global line opacity, then strengthen
      // only the active level perimeter so the current Level reads clearly in 3D.
      materials.forEach(mat => {
        if (!mat) return;
        const baseColor = obj.userData.baseColor || state.styleSettings.boundaryLineColor || '#111111';
        mat.color.set(isActive ? highlightColor : baseColor);

        if (isActive) {
          const boostedOpacity = clampOpacity(Math.max(mat.opacity ?? 1, 1), 1);
          mat.opacity = boostedOpacity;
          mat.transparent = !isOpaque(boostedOpacity);
          mat.depthWrite = isOpaque(boostedOpacity);
        }
        mat.needsUpdate = true;
      });

      obj.renderOrder = isActive ? 65 : 45;
    });
  }

  function wallCenterlinePoints(wall) {
    prepareWallGeometryCache(wall);
    return wall?._centerlinePoints || [];
  }

  function wallWidthFt(wall) {
    const w = toNum(wall?.geometry?.width_ft ?? wall?.width_ft ?? wall?.type?.width_ft, 0);
    return w > 0 ? w : 0.5;
  }

  function wallBaseZFt(wall, floor) {
    const fallback = Number.isFinite(floor?.heightFt) ? floor.heightFt : 0;
    return toNum(wall?.geometry?.base_z_ft ?? wall?.base_z_ft, fallback);
  }

  function wallTopZFt(wall, floor) {
    const base = wallBaseZFt(wall, floor);
    const top = toNum(wall?.geometry?.top_z_ft ?? wall?.top_z_ft, NaN);
    if (Number.isFinite(top) && top > base) return top;

    const height = toNum(wall?.geometry?.height_ft ?? wall?.height_ft, NaN);
    if (Number.isFinite(height) && height > 0) return base + height;

    return base + 10;
  }

  function wallKey(wall, floor, index = 0) {
    return String(wall?.unique_id || wall?.id || `${floor?.levelId || floor?.name || 'floor'}:${index}:${JSON.stringify(wall?.centerline || [])}`);
  }

  function wallSegmentStrip2D(a, b, width) {
    const dx = toNum(b.x) - toNum(a.x);
    const dy = toNum(b.y) - toNum(a.y);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) return null;

    const nx = -dy / len;
    const ny = dx / len;
    const hw = Math.max(width / 2, 0.01);

    return [
      { x: toNum(a.x) + nx * hw, y: toNum(a.y) + ny * hw, z: toNum(a.z) },
      { x: toNum(b.x) + nx * hw, y: toNum(b.y) + ny * hw, z: toNum(b.z) },
      { x: toNum(b.x) - nx * hw, y: toNum(b.y) - ny * hw, z: toNum(b.z) },
      { x: toNum(a.x) - nx * hw, y: toNum(a.y) - ny * hw, z: toNum(a.z) }
    ];
  }

  function wallTo2DStrips(wall) {
    prepareWallGeometryCache(wall);
    return wall?._strips2d || [];
  }

  function getWall2DStyle() {
    return {
      pane: 'wallsPane',
      color: state.styleSettings.wallLineColor,
      weight: 1,
      opacity: objectOpacityForView('2d', 'walls'),
      fillColor: state.styleSettings.wallFillColor,
      fillOpacity: objectOpacityForView('2d', 'walls'),
      interactive: false,
      lineJoin: 'miter',
      lineCap: 'butt'
    };
  }

  function columnFootprintPoints(column) {
    prepareColumnGeometryCache(column);
    return column?._footprintPoints || [];
  }

  function columnBaseZFt(column, floor) {
    const fallback = Number.isFinite(floor?.heightFt) ? floor.heightFt : 0;
    return toNum(column?.geometry?.base_z_ft ?? column?.base_z_ft, fallback);
  }

  function columnTopZFt(column, floor) {
    const base = columnBaseZFt(column, floor);
    const top = toNum(column?.geometry?.top_z_ft ?? column?.top_z_ft, NaN);
    if (Number.isFinite(top) && top > base) return top;

    const height = toNum(column?.geometry?.height_ft ?? column?.height_ft, NaN);
    if (Number.isFinite(height) && height > 0) return base + height;

    return base + 10;
  }

  function columnKey(column, floor, index = 0) {
    return String(column?.unique_id || column?.id || `${floor?.levelId || floor?.name || 'floor'}:column:${index}:${JSON.stringify(column?.footprint || column?.geometry?.footprint || [])}`);
  }

  function getColumn2DStyle() {
    return {
      pane: 'columnsPane',
      color: state.styleSettings.columnLineColor,
      weight: 1,
      opacity: objectOpacityForView('2d', 'columns'),
      fillColor: state.styleSettings.columnFillColor,
      fillOpacity: objectOpacityForView('2d', 'columns'),
      interactive: false,
      lineJoin: 'miter',
      lineCap: 'butt'
    };
  }


  function initEditorState(sourceJson = null, sourceFileName = '') {
    return {
      sourceFileName: sourceFileName || '',
      sourceSchema: sourceJson?.schema || sourceJson?.export_schema || sourceJson?.metadata?.schema || '',
      sourceSchemaVersion: sourceJson?.schema_version || sourceJson?.metadata?.schema_version || '',
      sourceModelTitle: sourceJson?.project?.document_title || sourceJson?.project?.model_file_name || sourceJson?.source_model_title || sourceJson?.metadata?.source_model_title || sourceJson?.export_info?.source_model_title || '',
      sourceWorkingId: sourceJson?.working?.working_id || '',
      baselineFingerprint: sourceJson?.working?.baseline_fingerprint || '',
      isWorkingPackage: isWorkingPackage(sourceJson),
      loadedAt: new Date().toISOString(),
      sourceJson,
      editorVersion: EDITOR_VERSION,
      changesets: safeClone(Array.isArray(sourceJson?.changesets) ? sourceJson.changesets : []),
      activeLevelId: null,
      activeViewId: null,
      modeEnabled: false,
      tool: 'select',
      drawStart: null,
      drawPreviewLayer: null,
      editHandleLayer: null,
      selectionMode: 'crossing',
      showDeleted: false,
      selected: {
        areas: new Set(),
        boundaryLines: new Set()
      },
      selectable: {
        byKey: new Map(),
        areas: [],
        boundaryLines: []
      },
      deleted: {
        areas: {},
        boundaryLines: {}
      },
      undoStack: [],
      edits: [],
      dirty: false,
      saveFileHandle: null,
      suppressNextMapClick: false
    };
  }

  function isEditorModeEnabled() {
    return !!editorState?.modeEnabled;
  }

  function safeClone(value) {
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value ?? null)); }
  }

  function editorElementBaseId(obj, index = 0) {
    if (!obj) return `anon-${index}`;
    return String(obj.record_id || obj.unique_id || obj.source_unique_id || obj.id || obj.source_id || obj.element_id || obj.guid || index);
  }

  function getEditorKey(obj, floor, type) {
    if (!obj) return '';
    if (obj._editorKey) return obj._editorKey;
    const prefix = type === 'boundary' || type === 'area_boundary_line' ? 'boundary' : 'area';
    const levelId = floor?.levelId ?? obj.level_id ?? obj.view_level_context?.id ?? '';
    const viewId = floor?.viewId ?? obj.view_id ?? '';
    const baseId = editorElementBaseId(obj, obj._editorIndex ?? 0);
    obj._editorKey = `${prefix}:${levelId}:${viewId}:${baseId}:${obj._editorIndex ?? 0}`;
    return obj._editorKey;
  }

  function assignEditorKeysToFloors(floors) {
    for (const floor of floors || []) {
      (floor.areas || []).forEach((area, index) => {
        area._editorIndex = index;
        area._editorType = 'area';
        area._editorKey = `area:${floor.levelId ?? ''}:${floor.viewId ?? ''}:${editorElementBaseId(area, index)}:${index}`;
      });
      (floor.boundaryLines || []).forEach((line, index) => {
        line._editorIndex = index;
        line._editorType = 'boundary';
        line._editorKey = `boundary:${floor.levelId ?? ''}:${floor.viewId ?? ''}:${editorElementBaseId(line, index)}:${index}`;
      });
    }
  }

  function isEditorDeleted(type, key) {
    if (!editorState || !key) return false;
    if (type === 'area') return !!editorState.deleted.areas[key];
    return !!editorState.deleted.boundaryLines[key];
  }

  function isEditorAreaSelected(area) {
    return !!editorState?.selected?.areas?.has(area?._editorKey);
  }

  function isEditorBoundarySelected(line) {
    return !!editorState?.selected?.boundaryLines?.has(line?._editorKey);
  }

  function getActiveFloor() {
    return state.floors[state.activeIndex] || null;
  }

  function buildSelectableIndex() {
    if (!editorState) return;
    const byKey = new Map();
    const areas = [];
    const boundaryLines = [];
    for (const floor of state.floors || []) {
      for (const area of floor.areas || []) {
        const key = getEditorKey(area, floor, 'area');
        if (isEditorDeleted('area', key)) continue;
        const layer = floor.layers?.areas?.find(l => l._areaData === area) || null;
        const mesh = threeState.areaMeshes.find(m => m.userData?.area === area && m.userData?.floor === floor) || null;
        const item = { key, type: 'area', floor, object: area, area, layer, mesh, box: getAreaBox(area) };
        areas.push(item);
        byKey.set(key, item);
      }
      for (const line of floor.boundaryLines || []) {
        const key = getEditorKey(line, floor, 'boundary');
        if (isEditorDeleted('boundary', key)) continue;
        const layer = floor.layers?.boundaries?.find(l => l._boundaryData === line) || null;
        const lineObj = threeState.boundaryLineObjects.find(o => o.userData?.line === line && o.userData?.floor === floor) || null;
        const item = { key, type: 'boundary', floor, object: line, line, layer, lineObj, box: getLineBox(line) };
        boundaryLines.push(item);
        byKey.set(key, item);
      }
    }
    editorState.selectable = { byKey, areas, boundaryLines };
  }

  function getLineBox(line) {
    const points = boundaryDisplayPoints(line);
    if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
      minX: Math.min(...points.map(pt => pt.x)),
      minY: Math.min(...points.map(pt => pt.y)),
      maxX: Math.max(...points.map(pt => pt.x)),
      maxY: Math.max(...points.map(pt => pt.y))
    };
  }

  function clearEditorSelection(update = true) {
    if (!editorState) return;
    editorState.selected.areas.clear();
    editorState.selected.boundaryLines.clear();
    map.closePopup();
    els.stackPopup.style.display = 'none';
    refreshEditorSelectionStyles();
    if (update) updateEditorPanel();
  }

  function selectEditorItem(type, key, domEvent = {}) {
    if (!editorState || !key) return;
    clearSelection(false);
    const set = type === 'area' ? editorState.selected.areas : editorState.selected.boundaryLines;
    const additive = !!domEvent.shiftKey;
    const toggle = !!(domEvent.ctrlKey || domEvent.metaKey);
    if (!additive && !toggle) clearEditorSelection(false);
    if (toggle && set.has(key)) set.delete(key);
    else set.add(key);
    refreshEditorSelectionStyles();
    updateEditorPanel();
  }

  function selectByPoint(type, key, domEvent = {}) {
    selectEditorItem(type, key, domEvent);
  }

  function rectsOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function rectContains(a, b) {
    return a.minX <= b.minX && a.maxX >= b.maxX && a.minY <= b.minY && a.maxY >= b.maxY;
  }

  function lineIntersectsRect(line, rect) {
    const points = boundaryDisplayPoints(line);
    if (points.length < 2) return false;
    const box = getLineBox(line);
    if (!rectsOverlap(rect, box)) return false;
    const corners = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY }
    ];
    for (const pt of points) if (pointInRect(pt, rect)) return true;
    for (let p = 0; p < points.length - 1; p++) {
      const a = points[p];
      const b = points[p + 1];
      for (let i = 0; i < corners.length; i++) {
        if (segmentsIntersectXY(a, b, corners[i], corners[(i + 1) % corners.length])) return true;
      }
    }
    return false;
  }

  function pointInRect(pt, rect) {
    return pt.x >= rect.minX && pt.x <= rect.maxX && pt.y >= rect.minY && pt.y <= rect.maxY;
  }

  function segmentsIntersectXY(a, b, c, d) {
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSeg = (p, q, r) => Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 && Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (Math.abs(o1) < 1e-9 && onSeg(a, c, b)) return true;
    if (Math.abs(o2) < 1e-9 && onSeg(a, d, b)) return true;
    if (Math.abs(o3) < 1e-9 && onSeg(c, a, d)) return true;
    if (Math.abs(o4) < 1e-9 && onSeg(c, b, d)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }

  function areaIntersectsRect(area, rect, requireContained = false) {
    prepareAreaGeometryCache(area);
    const box = getAreaBox(area);
    if (requireContained) return rectContains(rect, box);
    if (!rectsOverlap(rect, box)) return false;
    const loops = area._cleanLoops || [];
    for (const loop of loops) {
      for (const pt of loop) if (pointInRect(pt, rect)) return true;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        if (lineIntersectsRect({ start: a, end: b }, rect)) return true;
      }
    }
    const center = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
    return pointInAreaXY(center, area);
  }

  function selectByRectangle(rect, source = '2d', domEvent = {}) {
    if (!editorState) return;
    const mode = editorState.selectionMode || 'crossing';
    const requireContained = mode === 'window';
    if (!domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.metaKey) clearEditorSelection(false);
    const floor = source === '2d' ? getActiveFloor() : null;
    const areas = source === '2d' ? (floor ? editorState.selectable.areas.filter(i => i.floor === floor) : []) : editorState.selectable.areas;
    const lines = source === '2d' ? (floor ? editorState.selectable.boundaryLines.filter(i => i.floor === floor) : []) : editorState.selectable.boundaryLines;
    for (const item of areas) {
      if (areaIntersectsRect(item.area, rect, requireContained)) editorState.selected.areas.add(item.key);
    }
    for (const item of lines) {
      const hit = requireContained ? rectContains(rect, item.box) : lineIntersectsRect(item.line, rect);
      if (hit) editorState.selected.boundaryLines.add(item.key);
    }
    refreshEditorSelectionStyles();
    updateEditorPanel();
  }

  function setEditorMode(enabled) {
    if (!editorState) return;
    editorState.modeEnabled = !!enabled;
    if (els.editorModeToggle) els.editorModeToggle.checked = editorState.modeEnabled;
    if (els.editorModeBtn) els.editorModeBtn.classList.toggle('active', editorState.modeEnabled);
    if (els.developerToolsBtn) els.developerToolsBtn.classList.toggle('editor-on', editorState.modeEnabled);
    if (els.editorToolbar) els.editorToolbar.hidden = !editorState.modeEnabled;
    if (editorState.modeEnabled) {
      switchMode('2d');
      clearSelection(false);
      setEditorTool(editorState.tool || 'select');
    } else {
      cancelEditorDrawing();
      clearEditorSelection(false);
      clearBoundaryEditHandles();
    }
    updateEditorPanel();
  }


  function activeEditorTool() {
    return String(editorState?.tool || 'select');
  }

  function editorToolButtons() {
    return {
      select: els.editorSelectToolBtn,
      line: els.editorLineToolBtn,
      rectangle: els.editorRectangleToolBtn,
      circle: els.editorCircleToolBtn,
      move: els.editorMoveToolBtn
    };
  }

  function setEditorTool(tool) {
    if (!editorState) return;
    const allowed = new Set(['select', 'line', 'rectangle', 'circle', 'move']);
    editorState.tool = allowed.has(tool) ? tool : 'select';
    cancelEditorDrawing();
    for (const [name, button] of Object.entries(editorToolButtons())) {
      if (button) button.classList.toggle('active', name === editorState.tool);
    }
    const container = map.getContainer();
    container.classList.toggle('editor-draw-crosshair', ['line', 'rectangle', 'circle'].includes(editorState.tool));
    container.classList.toggle('editor-move-cursor', editorState.tool === 'move');
    if (editorState.tool !== 'move') clearBoundaryEditHandles();
    renderActiveFloor(false);
    updateEditorPanel();
  }

  function pointForEditorLatLng(latlng, floor = getActiveFloor()) {
    return {
      x: toNum(latlng?.lng),
      y: toNum(latlng?.lat),
      z: toNum(floor?.heightFt ?? floor?.level?.height_from_project_base_point_ft, 0)
    };
  }

  function pointArrayXY(point) {
    const p = pointXYZ(point);
    return p ? [roundEditorNumber(p.x), roundEditorNumber(p.y)] : null;
  }

  function roundEditorNumber(value) {
    return Math.round(toNum(value) * 1000) / 1000;
  }

  function curveFromEndpoints(start, end, z) {
    return {
      type: 'line',
      start: [roundEditorNumber(start.x), roundEditorNumber(start.y)],
      end: [roundEditorNumber(end.x), roundEditorNumber(end.y)],
      z_ft: roundEditorNumber(z),
      length_ft: roundEditorNumber(Math.hypot(end.x - start.x, end.y - start.y)),
      reconstruction: 'exact_line'
    };
  }

  function boundaryOperationValue(recordId, floor, start, end) {
    const z = toNum(start?.z ?? end?.z ?? floor?.heightFt, 0);
    return {
      record_id: recordId,
      view_id: floor?.viewId || '',
      level_id: floor?.levelId || '',
      area_scheme_id: floor?.areaScheme?.id || '',
      curve: curveFromEndpoints(start, end, z),
      line_style: 'Area Boundary',
      source_kind: 'manual_viewer',
      lifecycle: { status: 'created_outside_revit' }
    };
  }

  function viewerBoundaryFromOperationValue(value, floor) {
    const curve = safeObj(value?.curve);
    const z = toNum(curve.z_ft ?? floor?.heightFt, 0);
    const start = withZ(curve.start, z);
    const end = withZ(curve.end, z);
    return {
      record_id: value?.record_id || newPipelineId('tmp_bnd'),
      id: null,
      unique_id: '',
      source_id: null,
      source_unique_id: '',
      source_fingerprint: '',
      view_id: value?.view_id || floor?.viewId || '',
      level_id: value?.level_id || floor?.levelId || '',
      area_scheme_id: value?.area_scheme_id || floor?.areaScheme?.id || '',
      area_scheme: safeClone(floor?.areaScheme || {}),
      area_scheme_context: safeClone(floor?.areaScheme || {}),
      geometry_type: 'line',
      curve: safeClone(curve),
      start,
      end,
      display_points: [start, end].filter(Boolean),
      line_style: value?.line_style || 'Area Boundary',
      source_kind: value?.source_kind || 'manual_viewer',
      lifecycle: safeClone(value?.lifecycle || { status: 'created_outside_revit' })
    };
  }

  function setBoundaryEndpoints(line, start, end) {
    if (!line || !start || !end) return;
    const z = toNum(start.z ?? end.z ?? line?.curve?.z_ft, 0);
    line.start = { x: roundEditorNumber(start.x), y: roundEditorNumber(start.y), z: roundEditorNumber(z) };
    line.end = { x: roundEditorNumber(end.x), y: roundEditorNumber(end.y), z: roundEditorNumber(z) };
    line.display_points = [safeClone(line.start), safeClone(line.end)];
    line.curve = curveFromEndpoints(line.start, line.end, z);
    line.geometry_type = 'line';
  }

  function boundarySnapshot(line) {
    const start = pointXYZ(line?.start || line?.curve?.start);
    const end = pointXYZ(line?.end || line?.curve?.end);
    if (!start || !end) return null;
    return { start: safeClone(start), end: safeClone(end), curve: safeClone(line?.curve || curveFromEndpoints(start, end, start.z)) };
  }

  function sameBoundarySnapshot(a, b) {
    if (!a || !b) return false;
    return Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y, a.end.x - b.end.x, a.end.y - b.end.y) < 0.0005;
  }

  function createDraftChangeset(description, floor, operations) {
    if (!editorState || !operations?.length) return null;
    const now = new Date().toISOString();
    const changeset = {
      changeset_id: newPipelineId('chg'),
      origin: 'manual_viewer',
      status: 'draft',
      created_at_utc: now,
      updated_at_utc: now,
      description,
      scope: {
        area_scheme_ids: floor?.areaScheme?.id ? [String(floor.areaScheme.id)] : [],
        level_ids: floor?.levelId ? [String(floor.levelId)] : [],
        view_ids: floor?.viewId ? [String(floor.viewId)] : []
      },
      operations
    };
    editorState.changesets.push(changeset);
    editorState.edits.push({ action: 'create_changeset', changeset_id: changeset.changeset_id, at: now, operation_count: operations.length });
    editorState.dirty = true;
    return changeset;
  }

  function addBoundaryShape(points, description) {
    const floor = getActiveFloor();
    if (!floor || !Array.isArray(points) || points.length < 2) return;
    const operations = [];
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.01) continue;
      const recordId = newPipelineId('tmp_bnd');
      operations.push({
        operation_id: newPipelineId('op'),
        action: 'add',
        entity_type: 'boundary_segment',
        record_id: recordId,
        level_id: floor.levelId || '',
        view_id: floor.viewId || '',
        area_scheme_id: floor.areaScheme?.id || '',
        value: boundaryOperationValue(recordId, floor, start, end),
        reason: description
      });
    }
    if (!operations.length) return;
    createDraftChangeset(description, floor, operations);
    rebuildEffectiveStateFromChangesets(false);
  }

  function recordBoundaryUpdate(floor, line, before, after, reason) {
    if (!floor || !line || !before || !after || sameBoundarySnapshot(before, after)) return;
    const operation = {
      operation_id: newPipelineId('op'),
      action: 'update',
      entity_type: 'boundary_segment',
      record_id: entityRecordId(line),
      source_revit_id: line?.id ?? line?.source_id ?? null,
      source_revit_unique_id: line?.unique_id || line?.source_unique_id || '',
      source_fingerprint: line?.source_fingerprint || '',
      level_id: floor.levelId || '',
      view_id: floor.viewId || '',
      area_scheme_id: floor.areaScheme?.id || '',
      before: { curve: safeClone(before.curve) },
      after: { curve: safeClone(after.curve) },
      reason
    };
    createDraftChangeset(reason, floor, [operation]);
    rebuildEffectiveStateFromChangesets(false);
  }

  function findFloorByViewId(viewId) {
    return (state.floors || []).find(floor => String(floor.viewId || '') === String(viewId || '')) || null;
  }

  function findBoundaryByRecordId(recordId) {
    for (const floor of state.floors || []) {
      const line = (floor.boundaryLines || []).find(item => entityRecordId(item) === String(recordId || ''));
      if (line) return { floor, line };
    }
    return null;
  }

  function applyActiveBoundaryOperationsToFloors() {
    if (!editorState) return;
    for (const changeset of activeChangesets()) {
      for (const operation of changeset.operations || []) {
        if (operation?.entity_type !== 'boundary_segment') continue;
        if (operation.action === 'add') {
          const floor = findFloorByViewId(operation.view_id || operation.value?.view_id);
          if (!floor) continue;
          if ((floor.boundaryLines || []).some(line => entityRecordId(line) === String(operation.record_id || ''))) continue;
          const value = { ...(safeClone(operation.value || {})), record_id: operation.record_id };
          floor.boundaryLines.push(viewerBoundaryFromOperationValue(value, floor));
          floor._editorTopologyDirty = true;
        } else if (operation.action === 'update') {
          const found = findBoundaryByRecordId(operation.record_id);
          if (!found) continue;
          const curve = safeObj(operation.after?.curve || operation.patch?.curve || operation.value?.curve);
          const z = toNum(curve.z_ft ?? found.floor.heightFt, 0);
          const start = withZ(curve.start, z);
          const end = withZ(curve.end, z);
          if (start && end) {
            setBoundaryEndpoints(found.line, start, end);
            found.floor._editorTopologyDirty = true;
          }
        }
      }
    }
  }

  function markChangedViewsTopologyDirty() {
    const changedViews = new Set();
    for (const changeset of activeChangesets()) {
      for (const operation of changeset.operations || []) {
        if (operation?.entity_type === 'boundary_segment' && operation?.view_id) changedViews.add(String(operation.view_id));
      }
    }
    for (const floor of state.floors || []) {
      if (changedViews.has(String(floor.viewId || ''))) floor._editorTopologyDirty = true;
    }
  }

  function rebuildEffectiveStateFromChangesets(fit = false) {
    if (!editorState?.sourceJson) return;
    const active = getActiveFloor();
    const activeLevelId = active?.levelId || '';
    const activeViewId = active?.viewId || '';
    state.floors = normalizeFloorsFromJSON(editorState.sourceJson, editorState.sourceFileName).sort((a, b) => {
      const ha = Number.isFinite(a.heightFt) ? a.heightFt : Number.POSITIVE_INFINITY;
      const hb = Number.isFinite(b.heightFt) ? b.heightFt : Number.POSITIVE_INFINITY;
      return ha - hb || a.name.localeCompare(b.name);
    });
    applyActiveBoundaryOperationsToFloors();
    assignEditorKeysToFloors(state.floors);
    rebuildDeletedMapsFromChangesets();
    applyDeletedStateToRenderData();
    markChangedViewsTopologyDirty();
    state.activeIndex = Math.max(0, state.floors.findIndex(f => String(f.levelId) === String(activeLevelId) && String(f.viewId) === String(activeViewId)));
    clearEditorSelection(false);
    recomputeFloorCaches();
    updateFloorControls();
    renderActiveFloor(fit);
    render3DStack(false);
    renderStyleLegend();
    renderProjectInfo();
    renderReports();
    updateSummary();
    updateEditorPanel();
  }

  function undoLastViewerChangeset() {
    if (!editorState) return;
    const changeset = [...(editorState.changesets || [])].reverse().find(item => isAppliedChangeset(item) && item.origin === 'manual_viewer');
    if (!changeset) return;
    changeset.status = 'reverted';
    changeset.updated_at_utc = new Date().toISOString();
    changeset.reverted_at_utc = changeset.updated_at_utc;
    editorState.dirty = true;
    rebuildEffectiveStateFromChangesets(false);
  }

  function removeDrawPreview() {
    if (editorState?.drawPreviewLayer) {
      try { map.removeLayer(editorState.drawPreviewLayer); } catch (_) { }
    }
    if (editorState) editorState.drawPreviewLayer = null;
  }

  function cancelEditorDrawing() {
    if (!editorState) return;
    editorState.drawStart = null;
    removeDrawPreview();
  }

  function shapePreviewPoints(tool, start, current) {
    if (!start || !current) return [];
    if (tool === 'line') return [start, current];
    if (tool === 'rectangle') {
      return [
        start,
        { x: current.x, y: start.y, z: start.z },
        current,
        { x: start.x, y: current.y, z: start.z },
        start
      ];
    }
    if (tool === 'circle') {
      const radius = Math.hypot(current.x - start.x, current.y - start.y);
      if (radius < 0.01) return [];
      const points = [];
      const count = 24;
      for (let index = 0; index <= count; index++) {
        const angle = (Math.PI * 2 * index) / count;
        points.push({ x: start.x + radius * Math.cos(angle), y: start.y + radius * Math.sin(angle), z: start.z });
      }
      return points;
    }
    return [];
  }

  function updateDrawPreview(current) {
    removeDrawPreview();
    if (!editorState?.drawStart) return;
    const points = shapePreviewPoints(activeEditorTool(), editorState.drawStart, current);
    if (points.length < 2) return;
    editorState.drawPreviewLayer = L.polyline(points.map(revitToLatLng), {
      pane: 'boundariesPane',
      color: '#e83222',
      weight: 2.5,
      opacity: 0.95,
      dashArray: '7 5',
      interactive: false,
      className: 'editor-shape-preview'
    }).addTo(map);
  }

  function handleEditorDrawingClick(latlng) {
    const tool = activeEditorTool();
    if (!['line', 'rectangle', 'circle'].includes(tool)) return false;
    const point = pointForEditorLatLng(latlng);
    if (!editorState.drawStart) {
      editorState.drawStart = point;
      updateDrawPreview(point);
      updateEditorPanel();
      return true;
    }
    const points = shapePreviewPoints(tool, editorState.drawStart, point);
    const label = tool === 'line' ? 'Add Area Boundary Line' : (tool === 'rectangle' ? 'Add Area Boundary Rectangle' : 'Add Area Boundary Circle (24 straight segments)');
    cancelEditorDrawing();
    addBoundaryShape(points, label);
    return true;
  }

  function clearBoundaryEditHandles() {
    if (editorState?.editHandleLayer) {
      try { map.removeLayer(editorState.editHandleLayer); } catch (_) { }
    }
    if (editorState) editorState.editHandleLayer = null;
  }

  function updateBoundaryLayerGeometry(floor, line) {
    const layer = floor?.layers?.boundaries?.find(item => item._boundaryData === line);
    if (layer) layer.setLatLngs(boundaryDisplayPoints(line).map(revitToLatLng));
  }

  function handleIcon(kind) {
    return L.divIcon({
      className: '',
      html: `<div class="boundary-edit-handle ${kind}"></div>`,
      iconSize: kind === 'move' ? [15, 15] : [13, 13],
      iconAnchor: kind === 'move' ? [7.5, 7.5] : [6.5, 6.5]
    });
  }

  function renderBoundaryEditHandles(floor) {
    clearBoundaryEditHandles();
    if (!isEditorModeEnabled() || activeEditorTool() !== 'move' || !floor) return;
    const selectedKey = Array.from(editorState.selected.boundaryLines || [])[0];
    const item = selectedKey ? editorState.selectable.byKey.get(selectedKey) : null;
    if (!item || item.floor !== floor) return;
    const line = item.line;
    const start = pointXYZ(line.start);
    const end = pointXYZ(line.end);
    if (!start || !end) return;
    const group = L.layerGroup().addTo(map);
    editorState.editHandleLayer = group;

    const makeMarker = (kind, point) => {
      const marker = L.marker(revitToLatLng(point), { draggable: true, icon: handleIcon(kind), keyboard: false, pane: 'editorPane' }).addTo(group);
      let before = null;
      marker.on('dragstart', () => { before = boundarySnapshot(line); });
      marker.on('drag', event => {
        const current = pointForEditorLatLng(event.target.getLatLng(), floor);
        const a = pointXYZ(line.start);
        const b = pointXYZ(line.end);
        if (!a || !b) return;
        if (kind === 'endpoint-start') setBoundaryEndpoints(line, current, b);
        else if (kind === 'endpoint-end') setBoundaryEndpoints(line, a, current);
        else {
          const previousCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.z };
          const dx = current.x - previousCenter.x;
          const dy = current.y - previousCenter.y;
          setBoundaryEndpoints(line, { x: a.x + dx, y: a.y + dy, z: a.z }, { x: b.x + dx, y: b.y + dy, z: b.z });
        }
        updateBoundaryLayerGeometry(floor, line);
      });
      marker.on('dragend', () => {
        const after = boundarySnapshot(line);
        recordBoundaryUpdate(floor, line, before, after, kind === 'move' ? 'Move Area Boundary Line' : 'Move Area Boundary Line endpoint');
      });
      return marker;
    };

    makeMarker('endpoint endpoint-start', start);
    makeMarker('move', { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: start.z });
    makeMarker('endpoint endpoint-end', end);
  }

  function polygonizerCollectionToArray(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (typeof collection.toArray === 'function') return collection.toArray();
    const result = [];
    try {
      const iterator = collection.iterator();
      while (iterator.hasNext()) result.push(iterator.next());
    } catch (_) { }
    return result;
  }

  function coordinatesToLoop(coords, z) {
    return Array.from(coords || []).map(coord => ({ x: roundEditorNumber(coord.x), y: roundEditorNumber(coord.y), z: roundEditorNumber(z) }));
  }

  function recomputeAreaPreviewForFloor(floor) {
    if (!floor?._editorTopologyDirty) return;
    for (const area of floor.areas || []) {
      delete area._editorPreviewLoops;
      delete area._editorPreviewSqft;
      area._geometryPrepared = false;
    }
    floor._editorTopologyDirty = false;
    if (!window.jsts?.geom?.GeometryFactory || !window.jsts?.operation?.polygonize?.Polygonizer) {
      floor._editorPreviewWarning = 'JSTS polygonizer did not load; Area preview remains at the source geometry.';
      return;
    }
    try {
      const factory = new window.jsts.geom.GeometryFactory();
      const polygonizer = new window.jsts.operation.polygonize.Polygonizer();
      for (const line of floor.boundaryLines || []) {
        const points = boundaryDisplayPoints(line);
        for (let index = 0; index < points.length - 1; index++) {
          const a = pointXYZ(points[index]);
          const b = pointXYZ(points[index + 1]);
          if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 0.001) continue;
          const lineString = factory.createLineString([
            new window.jsts.geom.Coordinate(roundEditorNumber(a.x), roundEditorNumber(a.y)),
            new window.jsts.geom.Coordinate(roundEditorNumber(b.x), roundEditorNumber(b.y))
          ]);
          polygonizer.add(lineString);
        }
      }
      const polygons = polygonizerCollectionToArray(polygonizer.getPolygons());
      for (const area of floor.areas || []) {
        const seed = pointXYZ(area.location_point || area.placement_point);
        if (!seed) continue;
        const point = factory.createPoint(new window.jsts.geom.Coordinate(seed.x, seed.y));
        const candidates = polygons.filter(poly => {
          try { return poly.covers(point); } catch (_) { try { return poly.contains(point); } catch (_) { return false; } }
        });
        if (!candidates.length) continue;
        candidates.sort((a, b) => a.getArea() - b.getArea());
        const polygon = candidates[0];
        const loops = [coordinatesToLoop(polygon.getExteriorRing().getCoordinates(), seed.z)];
        for (let index = 0; index < polygon.getNumInteriorRing(); index++) {
          loops.push(coordinatesToLoop(polygon.getInteriorRingN(index).getCoordinates(), seed.z));
        }
        area._editorPreviewLoops = loops;
        area._editorPreviewSqft = roundEditorNumber(polygon.getArea());
        area._geometryPrepared = false;
      }
      floor._editorPreviewWarning = '';
    } catch (error) {
      floor._editorPreviewWarning = `Area preview polygonization failed: ${error.message}`;
      console.warn(floor._editorPreviewWarning, error);
    }
  }

  function updateEditorPanel() {
    if (!editorState) return;
    for (const [name, button] of Object.entries(editorToolButtons())) {
      if (button) button.classList.toggle('active', name === activeEditorTool());
    }
    if (els.editorToolbar) els.editorToolbar.hidden = !editorState.modeEnabled;
    const areaCount = editorState.selected.areas.size;
    const lineCount = editorState.selected.boundaryLines.size;
    if (els.selectedAreasCount) els.selectedAreasCount.textContent = String(areaCount);
    if (els.selectedBoundaryCount) els.selectedBoundaryCount.textContent = String(lineCount);
    if (els.selectedTotalCount) els.selectedTotalCount.textContent = String(areaCount + lineCount);
    if (els.changesetCount) els.changesetCount.textContent = String((editorState.changesets || []).length);
    if (els.editorDirtyState) {
      els.editorDirtyState.textContent = editorState.dirty ? 'Unsaved Changes' : 'Saved';
      els.editorDirtyState.classList.toggle('is-dirty', !!editorState.dirty);
    }
    if (els.editorDeleteBtn) els.editorDeleteBtn.disabled = areaCount + lineCount === 0;
    if (els.editorUndoDeleteBtn) els.editorUndoDeleteBtn.disabled = !editorState.undoStack.length;
    if (els.editorSelectionMode) els.editorSelectionMode.value = editorState.selectionMode || 'crossing';
    if (els.editorShowDeleted) els.editorShowDeleted.checked = !!editorState.showDeleted;
    if (els.editorSaveJsonBtn) {
      els.editorSaveJsonBtn.disabled = !editorState.isWorkingPackage;
      els.editorSaveJsonBtn.title = editorState.isWorkingPackage
        ? 'Save the complete editable area_working JSON with its immutable baseline and all changesets.'
        : 'Load an area_working JSON first.';
    }
    if (els.editorExportTransformerBtn) {
      els.editorExportTransformerBtn.disabled = !editorState.isWorkingPackage;
      els.editorExportTransformerBtn.title = editorState.isWorkingPackage
        ? 'Approve current draft changesets and export the complete area_working handoff for the second transformer.'
        : 'Load an area_working JSON first.';
    }
    if (els.editorToolbarStatus) {
      const drawing = editorState.drawStart ? ' · click second point' : '';
      const selected = areaCount + lineCount;
      els.editorToolbarStatus.textContent = `${activeEditorTool()}${drawing} · ${selected} selected · ${(editorState.changesets || []).filter(isAppliedChangeset).length} changes`;
      els.editorToolbarStatus.title = getActiveFloor()?._editorPreviewWarning || '';
    }
    updateSimpleEditorStatus();
  }

  function refreshEditorSelectionStyles() {
    if (!editorState) return;
    for (const item of editorState.selectable.areas || []) {
      if (item.layer) {
        if (editorState.selected.areas.has(item.key)) {
          item.layer.setStyle({ color: '#ff2f00', fillColor: '#ffcf33', fillOpacity: 0.95, weight: 4, opacity: 1 });
          item.layer.bringToFront();
        } else if (item.layer._baseStyle) {
          item.layer.setStyle(item.layer._baseStyle);
        }
      }
      if (item.mesh) {
        if (editorState.selected.areas.has(item.key)) {
          item.mesh.material.color.set('#ffcf33');
          item.mesh.material.opacity = 0.95;
          const outline = item.mesh.userData?.outline;
          if (outline) { outline.visible = true; setThreeLineColor(outline, '#ff2f00'); }
        } else {
          item.mesh.material.color.set(item.mesh.userData.baseFillColor || '#eefbe7');
          item.mesh.material.opacity = item.mesh.userData.baseOpacity ?? 0.78;
          const outline = item.mesh.userData?.outline;
          if (outline) { outline.visible = false; setThreeLineColor(outline, state.styleSettings.areaLineColor); }
        }
      }
    }
    for (const item of editorState.selectable.boundaryLines || []) {
      if (item.layer) {
        if (editorState.selected.boundaryLines.has(item.key)) {
          item.layer.setStyle({ color: '#ff2f00', weight: 5, opacity: 1, dashArray: null });
          item.layer.bringToFront();
        } else if (item.layer._baseStyle) {
          item.layer.setStyle(item.layer._baseStyle);
        }
      }
      if (item.lineObj) {
        const selected = editorState.selected.boundaryLines.has(item.key);
        item.lineObj.visible = selected
          ? true
          : (state.display3d.lines !== false && state.display3d.boundaries !== false);
        setThreeLineColor(item.lineObj, selected ? '#ff2f00' : (item.lineObj.userData.baseColor || state.styleSettings.boundaryLineColor));
        if (item.lineObj.material) {
          const materials = Array.isArray(item.lineObj.material) ? item.lineObj.material : [item.lineObj.material];
          materials.forEach(mat => {
            if (!mat) return;
            const opacity = selected ? 1 : resolvedThreeLineOpacity(item.lineObj, mat);
            mat.opacity = opacity;
            mat.transparent = !isOpaque(opacity);
            mat.depthWrite = isOpaque(opacity);
            mat.needsUpdate = true;
          });
        }
      }
    }
    mark3DDirty();
  }

  function newPipelineId(prefix) {
    try {
      if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
    } catch (_) { }
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }

  function isAppliedChangeset(changeset) {
    const status = String(changeset?.status || 'draft').toLowerCase();
    return status === 'draft' || status === 'approved';
  }

  function activeChangesets() {
    return (editorState?.changesets || []).filter(isAppliedChangeset);
  }

  function entityRecordId(object) {
    return String(object?.record_id || object?.unique_id || object?.source_unique_id || object?.id || object?.source_id || '');
  }

  function buildDeleteOperation(type, floor, object) {
    const entityType = type === 'area' ? 'area' : 'boundary_segment';
    const scheme = floor?.areaScheme || object?.area_scheme_context || object?.area_scheme || {};
    return {
      operation_id: newPipelineId('op'),
      action: 'delete',
      entity_type: entityType,
      record_id: entityRecordId(object),
      source_revit_id: object?.id ?? object?.source_id ?? null,
      source_revit_unique_id: object?.unique_id || object?.source_unique_id || '',
      level_id: floor?.levelId ?? object?.level_id ?? '',
      view_id: floor?.viewId ?? object?.view_id ?? '',
      area_scheme_id: scheme?.id ?? '',
      reason: 'Manual deletion in internal working viewer'
    };
  }

  function rebuildDeletedMapsFromChangesets() {
    if (!editorState) return;
    editorState.deleted = { areas: {}, boundaryLines: {} };
    const byRecord = new Map();
    for (const floor of state.floors || []) {
      (floor.areas || []).forEach((object, index) => byRecord.set(`area:${entityRecordId(object)}`, { type: 'area', floor, object, index }));
      (floor.boundaryLines || []).forEach((object, index) => byRecord.set(`boundary_segment:${entityRecordId(object)}`, { type: 'boundary', floor, object, index }));
    }
    for (const changeset of activeChangesets()) {
      for (const operation of changeset.operations || []) {
        if (operation?.action !== 'delete') continue;
        const item = byRecord.get(`${operation.entity_type}:${operation.record_id}`);
        if (!item) continue;
        const key = getEditorKey(item.object, item.floor, item.type);
        const record = makeDeletedRecord(item.type, key, item.floor, item.object, item.index);
        record.changeset_id = changeset.changeset_id || '';
        record.operation_id = operation.operation_id || '';
        record.deleted_at = changeset.created_at_utc || record.deleted_at;
        if (item.type === 'area') editorState.deleted.areas[key] = record;
        else editorState.deleted.boundaryLines[key] = record;
      }
    }
  }

  function buildWorkingSessionPayload() {
    return {
      schema: 'area_working_session_v1',
      schema_version: '1.0.0',
      saved_at_utc: new Date().toISOString(),
      app_editor_version: EDITOR_VERSION,
      source: {
        source_file_name: editorState?.sourceFileName || '',
        working_id: editorState?.sourceWorkingId || '',
        baseline_fingerprint: editorState?.baselineFingerprint || ''
      },
      changesets: safeClone(editorState?.changesets || []),
      editor_state: serializableEditorState()
    };
  }

  function buildEditedWorkingPackage() {
    if (!editorState?.isWorkingPackage || !editorState?.sourceJson) return null;
    const payload = safeClone(editorState.sourceJson);
    payload.changesets = safeClone(editorState.changesets || []);
    payload.workflow_stage = 'development_working_with_changesets';
    payload.editor_session = {
      app_editor_version: EDITOR_VERSION,
      saved_at_utc: new Date().toISOString(),
      active_level_id: getActiveFloor()?.levelId ?? null,
      active_view_id: getActiveFloor()?.viewId ?? null,
      selection_mode: editorState.selectionMode,
      show_deleted: editorState.showDeleted
    };
    return payload;
  }

  function applyWorkingSessionObject(session, fileName = 'working-session.json') {
    if (!editorState?.isWorkingPackage || !editorState?.sourceJson) {
      alert('Load the matching area_working baseline first, then open this lightweight session file.');
      return;
    }
    const expected = session?.source?.baseline_fingerprint || '';
    const current = editorState.baselineFingerprint || '';
    if (!expected || !current || expected !== current) {
      alert(`The session does not match the loaded immutable baseline.\n\nSession: ${expected || '(missing)'}\nLoaded: ${current || '(missing)'}`);
      return;
    }
    const sourceClone = safeClone(editorState.sourceJson);
    sourceClone.changesets = safeClone(session.changesets || []);
    applyLoadedJson(sourceClone, editorState.sourceFileName || fileName, session.editor_state || null);
  }

  function exportChangesetBundle() {
    if (!editorState?.isWorkingPackage) {
      alert('Changeset bundles are available after loading an area_working package.');
      return;
    }
    const payload = {
      schema: 'area_changeset_bundle_v1',
      schema_version: '1.0.0',
      created_at_utc: new Date().toISOString(),
      source: {
        working_id: editorState.sourceWorkingId,
        baseline_fingerprint: editorState.baselineFingerprint,
        raw_package_id: editorState.sourceJson?.source?.raw_package_id || '',
        project_fingerprint: editorState.sourceJson?.source?.project_fingerprint || ''
      },
      changesets: safeClone(editorState.changesets || [])
    };
    downloadJson(payload, `${projectFileBaseName()}.changesets.json`);
  }

  function showWorkingValidationReport(show = true) {
    if (!editorState?.isWorkingPackage) return validateRevitCommitExport(show);
    const sourceValidation = safeObj(editorState.sourceJson?.validation);
    const active = activeChangesets();
    const proposed = (editorState.changesets || []).filter(cs => String(cs?.status || '').toLowerCase() === 'proposed');
    const operations = active.reduce((sum, cs) => sum + (Array.isArray(cs.operations) ? cs.operations.length : 0), 0);
    const deletedAreas = Object.keys(editorState.deleted?.areas || {}).length;
    const deletedLines = Object.keys(editorState.deleted?.boundaryLines || {}).length;
    const blockers = Array.isArray(sourceValidation.revit_import_blockers) ? sourceValidation.revit_import_blockers : [];
    const sourceIssues = Array.isArray(sourceValidation.issues) ? sourceValidation.issues : [];
    const lines = [
      `Working ID: ${editorState.sourceWorkingId || '(missing)'}`,
      `Baseline fingerprint: ${editorState.baselineFingerprint || '(missing)'}`,
      `Baseline status: ${sourceValidation.working_consistency?.status || sourceValidation.status || 'unknown'}`,
      `Source warnings: ${toNum(sourceValidation.warning_count, sourceIssues.filter(i => i.severity === 'warning').length)}`,
      `Changesets: ${editorState.changesets.length} total / ${active.length} applied / ${proposed.length} proposed`,
      `Applied operations: ${operations}`,
      `Effective deletions: ${deletedAreas} Areas / ${deletedLines} Boundary Segments`,
      `Revit-import ready from source: ${sourceValidation.revit_import_ready === true ? 'Yes' : 'No'}`,
      `Import blockers: ${blockers.length ? blockers.join(', ') : 'none reported'}`,
      '',
      'Source validation issues:',
      ...(sourceIssues.length ? sourceIssues.slice(0, 40).map(issue => `- ${String(issue.severity || 'info').toUpperCase()} · ${issue.code || 'issue'}: ${issue.message || ''}`) : ['- None reported']),
      '',
      'Milestone note: this viewer records and validates changesets. Revit import-package generation remains intentionally locked.'
    ];
    if (els.editorValidationText) els.editorValidationText.textContent = lines.join('\n');
    if (show) els.editorPanel.hidden = false;
    return { sourceValidation, activeChangesetCount: active.length, operationCount: operations, blockers };
  }

  function cloneWithoutRuntimeFields(object) {
    if (!object || typeof object !== 'object') return object;
    const clean = {};
    for (const [key, value] of Object.entries(object)) {
      if (String(key).startsWith('_')) continue;
      clean[key] = safeClone(value);
    }
    return clean;
  }

  function makeDeletedRecord(type, key, floor, object, index) {
    const now = new Date().toISOString();
    const scheme = floor?.areaScheme || object?.area_scheme_context || object?.area_scheme || {};
    const base = {
      key,
      type,
      record_id: entityRecordId(object),
      source_id: object?.id ?? object?.source_id ?? null,
      source_unique_id: object?.unique_id || object?.source_unique_id || '',
      level_id: floor?.levelId ?? object?.level_id ?? '',
      level_name: floor?.levelName || floor?.name || object?.level_name || '',
      view_id: floor?.viewId ?? object?.view_id ?? '',
      view_name: floor?.viewName || object?.view_name || '',
      area_scheme_id: scheme?.id ?? '',
      area_scheme_name: scheme?.name || '',
      deleted_at: now,
      original_index: index,
      original: cloneWithoutRuntimeFields(object)
    };
    if (type === 'area') {
      base.number = areaNumber(object);
      base.name = areaName(object);
      base.area_type = object?.area_type || '';
      base.area_category = areaCategory(object);
      base.color_group = getAreaColorGroup(object);
    }
    return base;
  }

  function deleteSelectedElements() {
    if (!editorState) return;
    const selectedAreaKeys = Array.from(editorState.selected.areas);
    const selectedLineKeys = Array.from(editorState.selected.boundaryLines);
    if (!selectedAreaKeys.length && !selectedLineKeys.length) return;
    const activeFloor = getActiveFloor();
    const msg = `Record a draft delete changeset?\n\nAreas: ${selectedAreaKeys.length}\nBoundary Segments: ${selectedLineKeys.length}\nActive Level/View: ${activeFloor ? activeFloor.name : 'multiple / 3D stack'}\n\nThe immutable baseline will not be modified.`;
    if (!confirm(msg)) return;

    const changesetId = newPipelineId('chg');
    const operations = [];
    const undoEntry = { at: new Date().toISOString(), changesetId, areas: [], boundaryLines: [] };
    const levelIds = new Set();
    const viewIds = new Set();
    const schemeIds = new Set();

    for (const key of selectedAreaKeys) {
      const item = editorState.selectable.byKey.get(key);
      if (!item) continue;
      const arr = item.floor.areas || [];
      const idx = arr.indexOf(item.area);
      if (idx < 0) continue;
      const [removed] = arr.splice(idx, 1);
      const record = makeDeletedRecord('area', key, item.floor, removed, idx);
      record.changeset_id = changesetId;
      editorState.deleted.areas[key] = record;
      undoEntry.areas.push({ floor: item.floor, index: idx, object: removed, key });
      operations.push(buildDeleteOperation('area', item.floor, removed));
      levelIds.add(String(item.floor.levelId || ''));
      viewIds.add(String(item.floor.viewId || ''));
      schemeIds.add(String(item.floor.areaScheme?.id || ''));
    }
    for (const key of selectedLineKeys) {
      const item = editorState.selectable.byKey.get(key);
      if (!item) continue;
      const arr = item.floor.boundaryLines || [];
      const idx = arr.indexOf(item.line);
      if (idx < 0) continue;
      const [removed] = arr.splice(idx, 1);
      const record = makeDeletedRecord('boundary', key, item.floor, removed, idx);
      record.changeset_id = changesetId;
      editorState.deleted.boundaryLines[key] = record;
      undoEntry.boundaryLines.push({ floor: item.floor, index: idx, object: removed, key });
      operations.push(buildDeleteOperation('boundary', item.floor, removed));
      levelIds.add(String(item.floor.levelId || ''));
      viewIds.add(String(item.floor.viewId || ''));
      schemeIds.add(String(item.floor.areaScheme?.id || ''));
    }

    if (!operations.length) return;
    editorState.changesets.push({
      changeset_id: changesetId,
      origin: 'manual_viewer',
      status: 'draft',
      created_at_utc: undoEntry.at,
      updated_at_utc: undoEntry.at,
      description: `Manual deletion: ${undoEntry.areas.length} Area(s), ${undoEntry.boundaryLines.length} Boundary Segment(s)`,
      scope: {
        area_scheme_ids: [...schemeIds].filter(Boolean),
        level_ids: [...levelIds].filter(Boolean),
        view_ids: [...viewIds].filter(Boolean)
      },
      operations
    });
    editorState.undoStack.push(undoEntry);
    editorState.edits.push({ action: 'create_delete_changeset', changeset_id: changesetId, at: undoEntry.at, operation_count: operations.length });
    editorState.dirty = true;
    clearEditorSelection(false);
    rebuildEffectiveStateFromChangesets(false);
  }

  function undoLastDelete() {
    if (!editorState?.undoStack?.length) return;
    const entry = editorState.undoStack.pop();
    for (const item of entry.areas || []) {
      const arr = item.floor.areas || [];
      arr.splice(Math.min(item.index, arr.length), 0, item.object);
      delete editorState.deleted.areas[item.key];
    }
    for (const item of entry.boundaryLines || []) {
      const arr = item.floor.boundaryLines || [];
      arr.splice(Math.min(item.index, arr.length), 0, item.object);
      delete editorState.deleted.boundaryLines[item.key];
    }
    const changeset = (editorState.changesets || []).find(cs => cs.changeset_id === entry.changesetId);
    if (changeset) {
      changeset.status = 'reverted';
      changeset.updated_at_utc = new Date().toISOString();
      changeset.reverted_at_utc = changeset.updated_at_utc;
    }
    editorState.edits.push({ action: 'revert_changeset', changeset_id: entry.changesetId || '', at: new Date().toISOString() });
    editorState.dirty = true;
    assignEditorKeysToFloors(state.floors);
    updateAfterEditorDataChange(false);
  }

  function applyDeletedStateToRenderData() {
    if (!editorState) return;
    for (const floor of state.floors || []) {
      floor.areas = (floor.areas || []).filter(area => !editorState.deleted.areas[getEditorKey(area, floor, 'area')]);
      floor.boundaryLines = (floor.boundaryLines || []).filter(line => !editorState.deleted.boundaryLines[getEditorKey(line, floor, 'boundary')]);
    }
  }

  function recomputeFloorCaches() {
    for (const floor of state.floors || []) {
      recomputeAreaPreviewForFloor(floor);
      prepareFloorGeometryCaches(floor);
      floor.bounds = computeFloorBounds(floor);
      floor.stats = computeFloorStats(floor);
    }
    state.areaGroups = extractAreaGroups(state.floors);
    ensureAreaColorMap(state.areaGroups);
    state.reportData = buildReportData(editorState?.sourceJson || {}, state.floors);
  }

  function updateAfterEditorDataChange(fit = false) {
    recomputeFloorCaches();
    renderActiveFloor(fit);
    render3DStack(false);
    renderStyleLegend();
    renderProjectInfo();
    renderReports();
    updateSummary();
    updateEditorPanel();
  }

  function serializableEditorState() {
    return {
      sourceFileName: editorState.sourceFileName,
      sourceSchema: editorState.sourceSchema,
      sourceSchemaVersion: editorState.sourceSchemaVersion,
      sourceModelTitle: editorState.sourceModelTitle,
      sourceWorkingId: editorState.sourceWorkingId,
      baselineFingerprint: editorState.baselineFingerprint,
      loadedAt: editorState.loadedAt,
      activeLevelId: getActiveFloor()?.levelId ?? null,
      activeViewId: getActiveFloor()?.viewId ?? null,
      selectionMode: editorState.selectionMode,
      showDeleted: editorState.showDeleted,
      deleted: editorState.deleted,
      edits: editorState.edits,
      dirty: editorState.dirty
    };
  }

  function buildEditorProjectSavePayload(includeSource = true) {
    return {
      schema: 'area_editor_project_v1',
      app_editor_version: EDITOR_VERSION,
      saved_at: new Date().toISOString(),
      saved_at_local: new Date().toLocaleString(),
      source: {
        source_file_name: editorState?.sourceFileName || '',
        source_model_title: editorState?.sourceModelTitle || state.exportInfo?.source_model_title || '',
        source_schema: editorState?.sourceSchema || '',
        source_schema_version: editorState?.sourceSchemaVersion || ''
      },
      project_information: state.projectInfo || {},
      editor_state: serializableEditorState(),
      source_json: includeSource ? editorState?.sourceJson : null
    };
  }

  function projectFileBaseName() {
    const name = state.projectInfo?.project_name || state.projectInfo?.name || editorState?.sourceFileName || 'area-project';
    return String(name).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'area-project';
  }


  function sourceFileStem() {
    const original = String(editorState?.sourceFileName || state.projectInfo?.project_name || 'area-working');
    return original
      .replace(/\.json$/i, '')
      .replace(/\.(viewerSaved|toRevitTransformer|workingV1\.edited|workingV1)$/i, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'area-working';
  }

  function workingCollectionIds(collectionName) {
    const collection = editorState?.sourceJson?.baseline?.[collectionName];
    if (Array.isArray(collection)) {
      return new Set(collection.map((record, index) => String(record?.record_id || record?.id || index)));
    }
    if (collection && typeof collection === 'object') return new Set(Object.keys(collection));
    return new Set();
  }

  function approvedChangesetsForHandoff(nowIso) {
    return (editorState?.changesets || []).map(changeset => {
      const clone = safeClone(changeset);
      const status = String(clone?.status || 'draft').toLowerCase();
      if (status === 'draft') {
        clone.status = 'approved';
        clone.updated_at_utc = nowIso;
        clone.approved_at_utc = nowIso;
        clone.approved_via = 'explicit_viewer_export';
      }
      return clone;
    });
  }

  function appliedDeleteRecordIds(changesets) {
    const deleted = new Set();
    for (const changeset of changesets || []) {
      if (!isAppliedChangeset(changeset)) continue;
      for (const operation of changeset.operations || []) {
        if (operation?.action === 'delete' && operation?.record_id) {
          deleted.add(String(operation.record_id));
        }
      }
    }
    return deleted;
  }

  function duplicateBoundaryResolution(changesets) {
    const deleted = appliedDeleteRecordIds(changesets);
    const sourceIssues = Array.isArray(editorState?.sourceJson?.validation?.issues)
      ? editorState.sourceJson.validation.issues
      : [];
    const duplicateIssue = sourceIssues.find(issue => issue?.code === 'duplicate_boundary_geometry');
    const unresolved = [];
    let groupCount = 0;
    let resolvedCount = 0;

    for (const viewEntry of duplicateIssue?.details || []) {
      for (const group of viewEntry?.groups || []) {
        if (!Array.isArray(group)) continue;
        groupCount += 1;
        const remaining = group.filter(recordId => !deleted.has(String(recordId)));
        if (remaining.length > 1) {
          unresolved.push({
            view_id: viewEntry?.view_id || '',
            view_name: viewEntry?.view_name || '',
            original_record_ids: safeClone(group),
            remaining_record_ids: remaining
          });
        } else {
          resolvedCount += 1;
        }
      }
    }
    return { groupCount, resolvedCount, unresolved };
  }

  function validateViewerHandoff(changesets) {
    const errors = [];
    const warnings = [];
    if (!editorState?.isWorkingPackage || !editorState?.sourceJson) {
      errors.push('A valid area_working package is not loaded.');
      return { errors, warnings, blockers: [], duplicateResolution: { groupCount: 0, resolvedCount: 0, unresolved: [] } };
    }
    if (!editorState.sourceWorkingId) errors.push('working.working_id is missing.');
    if (!editorState.baselineFingerprint) errors.push('working.baseline_fingerprint is missing.');

    const areaIds = workingCollectionIds('areas');
    const boundaryIds = workingCollectionIds('boundary_segments');
    const knownEntityTypes = new Set(['area', 'boundary_segment']);
    const allowedActions = new Set(['add', 'update', 'delete']);

    for (const changeset of changesets || []) {
      const status = String(changeset?.status || 'draft').toLowerCase();
      if (!['draft', 'approved', 'reverted', 'rejected', 'proposed', 'unresolved', 'imported'].includes(status)) {
        errors.push(`Changeset ${changeset?.changeset_id || '(missing id)'} has unsupported status "${status}".`);
      }
      if (!changeset?.changeset_id) errors.push('A changeset is missing changeset_id.');
      for (const operation of changeset?.operations || []) {
        const entityType = String(operation?.entity_type || '');
        const action = String(operation?.action || '');
        const recordId = String(operation?.record_id || '');
        if (!operation?.operation_id) errors.push(`Changeset ${changeset?.changeset_id || '(missing id)'} contains an operation without operation_id.`);
        if (!knownEntityTypes.has(entityType)) errors.push(`Operation ${operation?.operation_id || '(missing id)'} has unsupported entity_type "${entityType}".`);
        if (!allowedActions.has(action)) errors.push(`Operation ${operation?.operation_id || '(missing id)'} has unsupported action "${action}".`);
        if (!recordId) errors.push(`Operation ${operation?.operation_id || '(missing id)'} is missing record_id.`);
        if (action === 'add' && entityType === 'boundary_segment') {
          if (boundaryIds.has(recordId)) errors.push(`Boundary add operation reuses existing record ${recordId}.`);
          else boundaryIds.add(recordId);
          const curve = operation?.value?.curve;
          if (curve?.type !== 'line' || !Array.isArray(curve?.start) || !Array.isArray(curve?.end)) errors.push(`Boundary add ${recordId} must contain one straight line curve.`);
        } else {
          if (entityType === 'area' && recordId && !areaIds.has(recordId)) errors.push(`Area operation targets unknown baseline record ${recordId}.`);
          if (entityType === 'boundary_segment' && recordId && !boundaryIds.has(recordId)) errors.push(`Boundary operation targets unknown effective record ${recordId}.`);
          if (action === 'update' && entityType === 'boundary_segment' && operation?.after?.curve?.type !== 'line') errors.push(`Boundary update ${recordId} must contain one straight line curve.`);
        }
      }
    }

    const duplicateResolution = duplicateBoundaryResolution(changesets);
    const sourceBlockers = Array.isArray(editorState.sourceJson?.validation?.revit_import_blockers)
      ? [...editorState.sourceJson.validation.revit_import_blockers]
      : [];
    const blockers = sourceBlockers.filter(code => {
      if (code !== 'duplicate_boundary_geometry') return true;
      return duplicateResolution.unresolved.length > 0;
    });

    if (duplicateResolution.unresolved.length) {
      warnings.push(`${duplicateResolution.unresolved.length} coincident Area Boundary group(s) remain unresolved.`);
    } else if (duplicateResolution.groupCount) {
      warnings.push(`All ${duplicateResolution.groupCount} source coincident Area Boundary group(s) are resolved by active delete changesets.`);
    }

    const pending = (changesets || []).filter(cs => ['proposed', 'unresolved'].includes(String(cs?.status || '').toLowerCase()));
    if (pending.length) {
      blockers.push('pending_or_unresolved_changesets');
      warnings.push(`${pending.length} proposed or unresolved changeset(s) are not approved.`);
    }

    return {
      errors: Array.from(new Set(errors)),
      warnings: Array.from(new Set(warnings)),
      blockers: Array.from(new Set(blockers)),
      duplicateResolution
    };
  }

  function changedScopeFromChangesets(changesets) {
    const areaSchemeIds = new Set();
    const levelIds = new Set();
    const viewIds = new Set();
    for (const changeset of changesets || []) {
      const status = String(changeset?.status || 'draft').toLowerCase();
      if (!['draft', 'approved'].includes(status)) continue;
      for (const id of changeset?.scope?.area_scheme_ids || []) if (id) areaSchemeIds.add(String(id));
      for (const id of changeset?.scope?.level_ids || []) if (id) levelIds.add(String(id));
      for (const id of changeset?.scope?.view_ids || []) if (id) viewIds.add(String(id));
      for (const operation of changeset?.operations || []) {
        if (operation?.area_scheme_id) areaSchemeIds.add(String(operation.area_scheme_id));
        if (operation?.level_id) levelIds.add(String(operation.level_id));
        if (operation?.view_id) viewIds.add(String(operation.view_id));
      }
    }
    return {
      area_scheme_ids: [...areaSchemeIds].sort(),
      level_ids: [...levelIds].sort(),
      view_ids: [...viewIds].sort()
    };
  }

  function buildTransformerHandoffPackage() {
    if (!editorState?.isWorkingPackage || !editorState?.sourceJson) return null;
    const now = new Date().toISOString();
    const approvedChangesets = approvedChangesetsForHandoff(now);
    const validation = validateViewerHandoff(approvedChangesets);
    const payload = safeClone(editorState.sourceJson);
    const approvedIds = approvedChangesets
      .filter(cs => String(cs?.status || '').toLowerCase() === 'approved')
      .map(cs => cs.changeset_id)
      .filter(Boolean);
    const appliedOperationCount = approvedChangesets
      .filter(cs => ['approved', 'draft'].includes(String(cs?.status || '').toLowerCase()))
      .reduce((sum, cs) => sum + (Array.isArray(cs?.operations) ? cs.operations.length : 0), 0);

    payload.changesets = approvedChangesets;
    payload.workflow_stage = 'viewer_approved_handoff';
    payload.handoff = {
      schema: 'area_viewer_handoff_manifest',
      schema_version: '1.0.0',
      export_id: newPipelineId('handoff'),
      created_at_utc: now,
      target_transformer: 'revit_import_package_transformer',
      source_file_name: editorState.sourceFileName || '',
      working_id: editorState.sourceWorkingId || '',
      baseline_fingerprint: editorState.baselineFingerprint || '',
      raw_package_id: payload?.source?.raw_package_id || '',
      project_fingerprint: payload?.source?.project_fingerprint || '',
      project_state_fingerprint: payload?.source?.project_state_fingerprint || '',
      source_scope_fingerprint: payload?.source?.scope_fingerprint || '',
      source_content_fingerprint: payload?.source?.source_content_fingerprint || '',
      approval: {
        method: 'explicit_export_button',
        approved_at_utc: now,
        approved_changeset_ids: approvedIds
      },
      changed_scope: changedScopeFromChangesets(approvedChangesets),
      source_selection: safeClone(payload?.source?.selection || {}),
      counts: {
        changeset_count: approvedChangesets.length,
        approved_changeset_count: approvedIds.length,
        applied_operation_count: appliedOperationCount
      },
      validation: {
        handoff_status: validation.errors.length ? 'invalid' : (validation.blockers.length ? 'valid_with_blockers' : 'valid'),
        handoff_error_count: validation.errors.length,
        downstream_blockers: validation.blockers,
        warnings: validation.warnings,
        duplicate_boundary_resolution: validation.duplicateResolution
      },
      contract: {
        top_level_schema_remains: 'area_working',
        immutable_baseline_required: true,
        second_transformer_must_validate: true,
        second_transformer_output: 'one-scope revit_area_import package',
        direct_revit_import_allowed: false
      }
    };
    payload.editor_session = {
      app_editor_version: EDITOR_VERSION,
      saved_at_utc: now,
      active_level_id: getActiveFloor()?.levelId ?? null,
      active_view_id: getActiveFloor()?.viewId ?? null,
      selection_mode: editorState.selectionMode,
      show_deleted: editorState.showDeleted
    };
    return { payload, approvedChangesets, validation };
  }

  async function writeJsonFile(payload, suggestedName, reuseWorkingHandle = false) {
    const jsonText = JSON.stringify(payload, null, 2);
    if (window.showSaveFilePicker) {
      try {
        let handle = reuseWorkingHandle ? editorState?.saveFileHandle : null;
        if (!handle) {
          handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{
              description: 'JSON file',
              accept: { 'application/json': ['.json'] }
            }]
          });
        }
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
        if (reuseWorkingHandle && editorState) editorState.saveFileHandle = handle;
        return { method: 'file_system_access', name: handle.name || suggestedName };
      } catch (error) {
        if (error?.name === 'AbortError') return { method: 'cancelled', name: suggestedName };
        console.warn('Direct save was unavailable; using browser download.', error);
      }
    }
    downloadJson(payload, suggestedName);
    return { method: 'download', name: suggestedName };
  }

  async function saveCurrentWorkingJson() {
    if (!editorState?.isWorkingPackage || !editorState?.sourceJson) {
      alert('Load an area_working JSON before saving.');
      return;
    }
    const payload = buildEditedWorkingPackage();
    payload.workflow_stage = (editorState.changesets || []).length
      ? 'development_working_with_changesets'
      : 'development_working_baseline';
    payload.viewer_save = {
      saved_at_utc: new Date().toISOString(),
      app_editor_version: EDITOR_VERSION,
      purpose: 'continue_editing_in_internal_viewer'
    };
    const result = await writeJsonFile(payload, `${sourceFileStem()}.viewerSaved.json`, true);
    if (result.method === 'cancelled') return;
    editorState.dirty = false;
    updateEditorPanel();
  }

  async function exportToSecondTransformer() {
    if (!editorState?.isWorkingPackage || !editorState?.sourceJson) {
      alert('Load an area_working JSON before exporting.');
      return;
    }
    const built = buildTransformerHandoffPackage();
    if (!built) return;
    if (built.validation.errors.length) {
      alert(`Export blocked because the viewer handoff is invalid:\n\n${built.validation.errors.join('\n')}`);
      return;
    }

    const draftCount = (editorState.changesets || []).filter(cs => String(cs?.status || 'draft').toLowerCase() === 'draft').length;
    const blockerText = built.validation.blockers.length
      ? `\n\nDownstream blockers remain:\n- ${built.validation.blockers.join('\n- ')}\n\nThe second transformer must stop before producing a destructive Revit-import package until these are resolved.`
      : '';
    const message = draftCount
      ? `Export will approve ${draftCount} draft changeset(s) and create the JSON for the second transformer.${blockerText}\n\nContinue?`
      : `Export the current no-change/approved working state to the second transformer?${blockerText}\n\nContinue?`;
    if (!confirm(message)) return;

    const result = await writeJsonFile(built.payload, `${sourceFileStem()}.toRevitTransformer.json`, false);
    if (result.method === 'cancelled') return;
    editorState.changesets = safeClone(built.approvedChangesets);
    rebuildDeletedMapsFromChangesets();
    editorState.dirty = false;
    updateEditorPanel();
  }

  function updateSimpleEditorStatus() {
    if (!els.editorValidationText || !editorState) return;
    if (!editorState.isWorkingPackage) {
      els.editorValidationText.textContent = 'Load an area_working JSON produced by the first transformer.';
      return;
    }
    const changesets = editorState.changesets || [];
    const draft = changesets.filter(cs => String(cs?.status || 'draft').toLowerCase() === 'draft').length;
    const approved = changesets.filter(cs => String(cs?.status || '').toLowerCase() === 'approved').length;
    const reverted = changesets.filter(cs => String(cs?.status || '').toLowerCase() === 'reverted').length;
    const operations = changesets
      .filter(isAppliedChangeset)
      .reduce((sum, cs) => sum + (Array.isArray(cs?.operations) ? cs.operations.length : 0), 0);
    const check = validateViewerHandoff(changesets);
    els.editorValidationText.textContent = [
      `Working ID: ${editorState.sourceWorkingId || '(missing)'}`,
      `Baseline: ${editorState.baselineFingerprint || '(missing)'}`,
      `Changesets: ${changesets.length} total · ${draft} draft · ${approved} approved · ${reverted} reverted`,
      `Applied operations: ${operations}`,
      `Downstream blockers: ${check.blockers.length ? check.blockers.join(', ') : 'none'}`,
      '',
      'Save JSON = preserve the editable area_working package.',
      'Export to Transformer = approve drafts and create the next pipeline file.'
    ].join('\n');
  }

  function saveEditorProjectToLocalStorage() {
    if (!editorState?.sourceJson) { alert('Load a source JSON before saving.'); return; }
    try {
      const payload = editorState.isWorkingPackage ? buildWorkingSessionPayload() : buildEditorProjectSavePayload(false);
      localStorage.setItem('revitAreaEditor:lastProjectLight', JSON.stringify(payload));
      editorState.dirty = false;
      updateEditorPanel();
      alert(editorState.isWorkingPackage
        ? 'Saved a lightweight VS Code/viewer session in this browser. The immutable baseline remains in your area_working JSON file.'
        : 'Saved a lightweight editor session in this browser.');
    } catch (err) {
      alert('Browser storage could not save the session. Use Export Working File instead.\n\n' + err.message);
    }
  }

  function downloadEditorProjectFile() {
    if (!editorState?.sourceJson) { alert('Load a source JSON before saving.'); return; }
    if (editorState.isWorkingPackage) {
      const payload = buildEditedWorkingPackage();
      downloadJson(payload, `${projectFileBaseName()}.workingV1.edited.json`);
    } else {
      downloadJson(buildEditorProjectSavePayload(true), `${projectFileBaseName()}.area-editor-project.json`);
    }
    editorState.dirty = false;
    updateEditorPanel();
  }

  function loadEditorProjectFile(fileList) {
    const file = Array.from(fileList || [])[0];
    if (!file) return;
    readFileAsText(file).then(raw => {
      const json = JSON.parse(raw);
      if (isWorkingPackage(json)) {
        applyLoadedJson(json, file.name, json.editor_session ? {
          activeLevelId: json.editor_session.active_level_id,
          activeViewId: json.editor_session.active_view_id,
          selectionMode: json.editor_session.selection_mode,
          showDeleted: json.editor_session.show_deleted
        } : null);
        return;
      }
      if (json.schema === 'area_working_session_v1') {
        applyWorkingSessionObject(json, file.name);
        return;
      }
      if (json.schema === 'area_editor_project_v1') {
        loadEditorProjectObject(json, file.name);
        return;
      }
      throw new Error('Expected area_working, area_working_session_v1, or legacy area_editor_project_v1.');
    }).catch(err => alert(`Saved project could not be opened:\n\n${err.message}`));
  }

  function loadEditorProjectObject(project, fileName = 'saved-project.json') {
    if (editorState?.dirty && !confirm('You have unsaved changes. Open another project anyway?')) return;
    const sourceJson = project.source_json;
    if (!sourceJson) {
      alert('This saved editor project does not include the original source JSON. Reopen the original JSON first, then apply the tombstones manually from this project file.');
      return;
    }
    const floors = normalizeFloorsFromJSON(sourceJson, project.source?.source_file_name || fileName);
    clearActiveLayerGroup();
    map.closePopup();
    clearSelection(true);
    clear3DWorld();
    state.projectInfo = sourceJson.project_information || sourceJson.metadata?.project_information || sourceJson.project || project.project_information || {};
    state.exportInfo = sourceJson.export_info || sourceJson.metadata || sourceJson.source || project.source || {};
    state.propertyLineExport = sourceJson.property_line_export || {};
    state.floors = floors.sort((a, b) => {
      const ha = Number.isFinite(a.heightFt) ? a.heightFt : Number.POSITIVE_INFINITY;
      const hb = Number.isFinite(b.heightFt) ? b.heightFt : Number.POSITIVE_INFINITY;
      if (ha !== hb) return ha - hb;
      return a.name.localeCompare(b.name);
    });
    editorState = initEditorState(sourceJson, project.source?.source_file_name || fileName);
    editorState.deleted = project.editor_state?.deleted || { areas: {}, boundaryLines: {} };
    editorState.edits = project.editor_state?.edits || [];
    editorState.selectionMode = project.editor_state?.selectionMode || 'crossing';
    editorState.showDeleted = !!project.editor_state?.showDeleted;
    assignEditorKeysToFloors(state.floors);
    applyDeletedStateToRenderData();
    state.activeIndex = Math.max(0, state.floors.findIndex(f => String(f.levelId) === String(project.editor_state?.activeLevelId) && String(f.viewId) === String(project.editor_state?.activeViewId)));
    state.importedAreaColorMap = extractAreaColorMapFromJSON(sourceJson);
    state.styleSettings.areaColorMap = buildDefaultAreaColorMap(extractAreaGroups(state.floors));
    recomputeFloorCaches();
    updateFloorControls();
    renderActiveFloor(true);
    render3DStack(true);
    renderStyleLegend();
    renderProjectInfo();
    renderReports();
    updateSummary();
    resize3D();
    threeState.azimuth = Math.PI * 0.20;
    threeState.elevation = Math.PI * 0.24;
    fit3DStackAfterLayout();
    fitActiveFloorAfterLayout();
    setEditorMode(false);
    editorState.dirty = false;
    if (els.loadedFileLabel) els.loadedFileLabel.innerHTML = `LOADED: <strong>${escapeHTML(project.source?.source_file_name || fileName)}</strong>`;
    updateEditorPanel();
  }

  function downloadJson(obj, fileName) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resolveAreaPlacementPoint(area) {
    const sourcePt = pointXYZ(area?.location_point || area?.placement_point || area?.center_point || area?.centroid);
    if (sourcePt) return { point: sourcePt, method: area.location_point || area.placement_point ? 'source_location' : 'polygon_centroid' };
    prepareAreaGeometryCache(area);
    const fallback = area?._labelFallbackPoint || null;
    if (fallback) return { point: fallback, method: pointInAreaXY(fallback, area) ? 'calculated_inside_point' : 'polygon_centroid' };
    return { point: null, method: 'missing_or_unresolved' };
  }

  function areaCommitRecord(area, floor, warnings) {
    const placement = resolveAreaPlacementPoint(area);
    if (!placement.point) warnings.push(`Area ${areaName(area)} on ${floor.name} has no reliable placement point.`);
    const scheme = floor.areaScheme || area.area_scheme_context || area.area_scheme || {};
    return {
      source_id: area.id ?? area.source_id ?? null,
      source_unique_id: area.unique_id || area.source_unique_id || '',
      commit_action: 'keep',
      number: areaNumber(area),
      name: areaName(area),
      area_type: area.area_type || '',
      area_category: areaCategory(area),
      color_group: getAreaColorGroup(area),
      revit_calculated_area_sqft: areaSqFt(area),
      placement_point: placement.point,
      placement_point_method: placement.method,
      boundary_reference: { method: 'area_seed_inside_boundary_loop' },
      level_id: floor.levelId,
      level_name: floor.levelName || floor.name,
      view_id: floor.viewId,
      view_name: floor.viewName || floor.name,
      area_scheme_id: scheme.id ?? '',
      area_scheme_name: scheme.name || ''
    };
  }

  function boundaryCommitRecord(line, floor, warnings) {
    const start = pointXYZ(line.start);
    const end = pointXYZ(line.end);
    if (!start || !end) warnings.push(`Boundary line ${line.id || line.unique_id || '(unknown)'} on ${floor.name} is missing start/end points.`);
    else if (Math.hypot(start.x - end.x, start.y - end.y, (start.z || 0) - (end.z || 0)) < 1e-7) warnings.push(`Boundary line ${line.id || line.unique_id || '(unknown)'} on ${floor.name} has zero length.`);
    const scheme = floor.areaScheme || line.area_scheme_context || line.area_scheme || {};
    return {
      record_id: line.record_id || '',
      source_id: line.id ?? line.source_id ?? null,
      source_unique_id: line.unique_id || line.source_unique_id || '',
      commit_action: 'keep',
      geometry_type: line.curve?.type || line.geometry_type || 'line',
      curve: safeClone(line.curve || null),
      start,
      end,
      level_id: floor.levelId,
      level_name: floor.levelName || floor.name,
      view_id: floor.viewId,
      view_name: floor.viewName || floor.name,
      area_scheme_id: scheme.id ?? '',
      area_scheme_name: scheme.name || ''
    };
  }

  function buildRevitCommitExport() {
    const validation = validateRevitCommitExport(false);
    const schemes = new Map();
    for (const floor of state.floors || []) {
      const scheme = floor.areaScheme || {};
      const key = String(scheme.id ?? scheme.name ?? '');
      if (key && !schemes.has(key)) schemes.set(key, { id: scheme.id ?? '', name: scheme.name || '' });
    }
    const levelsMap = new Map();
    const warnings = [...validation.warnings];
    for (const floor of state.floors || []) {
      const levelKey = String(floor.levelId || floor.levelName || floor.name);
      if (!levelsMap.has(levelKey)) {
        levelsMap.set(levelKey, {
          id: floor.levelId,
          name: floor.levelName || floor.name,
          height_from_project_base_point_ft: Number.isFinite(floor.heightFt) ? floor.heightFt : null,
          views: []
        });
      }
      const scheme = floor.areaScheme || {};
      levelsMap.get(levelKey).views.push({
        id: floor.viewId,
        name: floor.viewName || floor.name,
        area_scheme_context: { id: scheme.id ?? '', name: scheme.name || '' },
        boundary_lines: (floor.boundaryLines || []).map(line => boundaryCommitRecord(line, floor, warnings)),
        areas: (floor.areas || []).map(area => areaCommitRecord(area, floor, warnings))
      });
    }
    const counts = {
      areas_to_keep: (state.floors || []).reduce((sum, f) => sum + (f.areas || []).length, 0),
      boundary_lines_to_keep: (state.floors || []).reduce((sum, f) => sum + (f.boundaryLines || []).length, 0),
      areas_deleted: Object.keys(editorState?.deleted?.areas || {}).length,
      boundary_lines_deleted: Object.keys(editorState?.deleted?.boundaryLines || {}).length
    };
    const sourceJson = editorState?.sourceJson || {};
    return {
      schema: 'revit_area_editor_commit_v1',
      workflow_stage: 'html_area_plan_editor_export',
      created_at_local: new Date().toLocaleString(),
      created_at_utc: new Date().toISOString(),
      editor_app_version: EDITOR_VERSION,
      source: {
        source_file_name: editorState?.sourceFileName || '',
        source_model_title: editorState?.sourceModelTitle || sourceJson.source_model_title || state.exportInfo?.source_model_title || '',
        source_schema: editorState?.sourceSchema || sourceJson.schema || sourceJson.export_schema || '',
        source_schema_version: editorState?.sourceSchemaVersion || sourceJson.schema_version || ''
      },
      project_information: state.projectInfo || {},
      units: sourceJson.units || sourceJson.metadata?.units || { length: 'feet', area: 'square_feet' },
      coordinate_basis: sourceJson.coordinate_basis || sourceJson.coordinate_reference || sourceJson.metadata?.coordinate_basis || {
        origin: 'project_base_point',
        xy_basis: 'project_xy_feet_relative_to_project_base_point',
        z_basis: 'height_from_project_base_point_ft'
      },
      area_schemes: Array.from(schemes.values()),
      levels: Array.from(levelsMap.values()),
      deleted: {
        boundary_lines: Object.values(editorState?.deleted?.boundaryLines || {}).map(({ original, ...rest }) => rest),
        areas: Object.values(editorState?.deleted?.areas || {}).map(({ original, ...rest }) => rest)
      },
      validation: {
        has_errors: false,
        warnings: Array.from(new Set(warnings)),
        counts
      }
    };
  }

  function validateRevitCommitExport(show = true) {
    const warnings = [];
    const ids = new Set();
    let areaCount = 0;
    let boundaryCount = 0;
    for (const floor of state.floors || []) {
      const ctx = `${floor.levelName || floor.name} / ${floor.viewName || floor.name}`;
      if (!floor.levelName && !floor.levelId) warnings.push(`Missing level context for ${ctx}.`);
      if (!floor.viewName && !floor.viewId) warnings.push(`Missing view context for ${ctx}.`);
      if (!floor.areaScheme?.name && !floor.areaScheme?.id) warnings.push(`Missing area scheme context for ${ctx}.`);
      if ((floor.areas || []).length && !(floor.boundaryLines || []).length) warnings.push(`${ctx} has Areas but no Area Boundary Lines.`);
      for (const area of floor.areas || []) {
        areaCount++;
        const idKey = `area:${area.id || area.unique_id || ''}`;
        if (idKey !== 'area:' && ids.has(idKey)) warnings.push(`Duplicate Area source id/unique_id found: ${idKey}`);
        if (idKey !== 'area:') ids.add(idKey);
        const placement = resolveAreaPlacementPoint(area);
        if (!placement.point) warnings.push(`Area ${areaNumber(area) || areaName(area)} on ${ctx} has no placement point.`);
      }
      for (const line of floor.boundaryLines || []) {
        boundaryCount++;
        const idKey = `boundary:${line.id || line.unique_id || ''}`;
        if (idKey !== 'boundary:' && ids.has(idKey)) warnings.push(`Duplicate Boundary Line source id/unique_id found: ${idKey}`);
        if (idKey !== 'boundary:') ids.add(idKey);
        const start = pointXYZ(line.start);
        const end = pointXYZ(line.end);
        if (!start || !end) warnings.push(`Boundary Line ${line.id || line.unique_id || '(unknown)'} on ${ctx} has missing start/end.`);
        else if (Math.hypot(start.x - end.x, start.y - end.y, (start.z || 0) - (end.z || 0)) < 1e-7) warnings.push(`Boundary Line ${line.id || line.unique_id || '(unknown)'} on ${ctx} has zero length.`);
      }
    }
    const counts = {
      areas_to_keep: areaCount,
      boundary_lines_to_keep: boundaryCount,
      areas_deleted: Object.keys(editorState?.deleted?.areas || {}).length,
      boundary_lines_deleted: Object.keys(editorState?.deleted?.boundaryLines || {}).length
    };
    const result = { has_errors: false, warnings: Array.from(new Set(warnings)), counts };
    if (show && els.editorValidationText) {
      els.editorValidationText.textContent = [
        `Validation: ${result.warnings.length ? result.warnings.length + ' warning(s)' : 'no warnings'}`,
        `Areas to keep: ${counts.areas_to_keep}`,
        `Boundary lines to keep: ${counts.boundary_lines_to_keep}`,
        `Deleted areas: ${counts.areas_deleted}`,
        `Deleted boundary lines: ${counts.boundary_lines_deleted}`,
        '',
        ...(result.warnings.length ? result.warnings.slice(0, 80) : ['Ready to export pyRevit commit JSON.'])
      ].join('\n');
    }
    return result;
  }

  function exportRevitCommitJson() {
    if (!state.floors.length) { alert('Load a JSON file before exporting.'); return; }
    const payload = buildRevitCommitExport();
    validateRevitCommitExport(true);
    downloadJson(payload, `${projectFileBaseName()}.revit-area-editor-commit.json`);
    editorState.dirty = false;
    updateEditorPanel();
  }

  function renderDeletedOverlays2D(floor, group) {
    if (!editorState?.showDeleted || !floor || !group) return;
    const deletedAreaStyle = { pane: 'areasPane', color: '#8b1111', weight: 1.6, opacity: 0.55, dashArray: '4 4', fillColor: '#8b1111', fillOpacity: 0.08, interactive: false };
    const deletedLineStyle = { pane: 'boundariesPane', color: '#8b1111', weight: 2.5, opacity: 0.65, dashArray: '5 5', interactive: false };
    for (const record of Object.values(editorState.deleted.areas || {})) {
      if (!recordMatchesFloor(record, floor)) continue;
      const area = record.original;
      const loops = areaLoopsToLatLngs(area);
      if (loops.length) L.polygon(loops, deletedAreaStyle).addTo(group);
    }
    for (const record of Object.values(editorState.deleted.boundaryLines || {})) {
      if (!recordMatchesFloor(record, floor)) continue;
      const line = record.original;
      const points = boundaryDisplayPoints(line);
      if (points.length >= 2) L.polyline(points.map(revitToLatLng), deletedLineStyle).addTo(group);
    }
  }

  function recordMatchesFloor(record, floor) {
    if (!record || !floor) return false;
    const sameView = String(record.view_id || '') === String(floor.viewId || '') || (!record.view_id && record.view_name === (floor.viewName || floor.name));
    const sameLevel = String(record.level_id || '') === String(floor.levelId || '') || (!record.level_id && record.level_name === (floor.levelName || floor.name));
    return sameView && sameLevel;
  }

  function worldPointToScreen(pt, rect) {
    const p = pt.clone().project(threeState.camera);
    if (p.z < -1 || p.z > 1) return null;
    return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
  }

  function screenRectToWorldSelectionRect(screenRect) {
    const rect = threeState.renderer.domElement.getBoundingClientRect();
    const worldRect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const consider = pt => {
      if (!pt) return;
      if (pt.x < screenRect.left || pt.x > screenRect.right || pt.y < screenRect.top || pt.y > screenRect.bottom) return;
      const world = screenPointToPlaneXY(pt.x, pt.y, getActiveFloor()?.y3D ?? 0);
      if (!world) return;
      worldRect.minX = Math.min(worldRect.minX, world.x);
      worldRect.maxX = Math.max(worldRect.maxX, world.x);
      worldRect.minY = Math.min(worldRect.minY, world.y);
      worldRect.maxY = Math.max(worldRect.maxY, world.y);
    };
    consider({ x: screenRect.left, y: screenRect.top });
    consider({ x: screenRect.right, y: screenRect.top });
    consider({ x: screenRect.right, y: screenRect.bottom });
    consider({ x: screenRect.left, y: screenRect.bottom });
    if (!Number.isFinite(worldRect.minX)) return null;
    return worldRect;
  }

  function screenPointToPlaneXY(clientX, clientY, yPlane = 0) {
    const rect = threeState.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, threeState.camera);
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-9) return null;
    const t = (yPlane - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    const hit = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    return { x: hit.x, y: -hit.z };
  }

  function selectBy3DScreenRectangle(screenRect, domEvent = {}) {
    if (!editorState) return;
    if (!domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.metaKey) clearEditorSelection(false);
    const mode = editorState.selectionMode || 'crossing';
    const requireContained = mode === 'window';
    const rect = threeState.renderer.domElement.getBoundingClientRect();
    const hitScreenRect = item => {
      const pts = [];
      if (item.type === 'area') {
        prepareAreaGeometryCache(item.area);
        const box = getAreaBox(item.area);
        const y = item.floor.y3D;
        pts.push(worldPointToScreen(new THREE.Vector3(box.minX, y, -box.minY), rect));
        pts.push(worldPointToScreen(new THREE.Vector3(box.maxX, y, -box.minY), rect));
        pts.push(worldPointToScreen(new THREE.Vector3(box.maxX, y, -box.maxY), rect));
        pts.push(worldPointToScreen(new THREE.Vector3(box.minX, y, -box.maxY), rect));
      } else {
        const a = pointXYZ(item.line.start);
        const b = pointXYZ(item.line.end);
        if (a) pts.push(worldPointToScreen(new THREE.Vector3(a.x, item.floor.y3D, -a.y), rect));
        if (b) pts.push(worldPointToScreen(new THREE.Vector3(b.x, item.floor.y3D, -b.y), rect));
      }
      const valid = pts.filter(Boolean);
      if (!valid.length) return false;
      const box = { left: Math.min(...valid.map(p => p.x)), right: Math.max(...valid.map(p => p.x)), top: Math.min(...valid.map(p => p.y)), bottom: Math.max(...valid.map(p => p.y)) };
      if (requireContained) return screenRect.left <= box.left && screenRect.right >= box.right && screenRect.top <= box.top && screenRect.bottom >= box.bottom;
      return screenRect.left <= box.right && screenRect.right >= box.left && screenRect.top <= box.bottom && screenRect.bottom >= box.top;
    };
    for (const item of editorState.selectable.areas || []) if (hitScreenRect(item)) editorState.selected.areas.add(item.key);
    for (const item of editorState.selectable.boundaryLines || []) if (hitScreenRect(item)) editorState.selected.boundaryLines.add(item.key);
    refreshEditorSelectionStyles();
    updateEditorPanel();
  }

  function pick3DEditorObject(event) {
    buildSelectableIndex();
    const objects = [...threeState.areaMeshes, ...threeState.boundaryLineObjects];
    if (!objects.length) { clearEditorSelection(true); return false; }
    const rect = threeState.renderer.domElement.getBoundingClientRect();
    threeState.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    threeState.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    threeState.raycaster.params.Line = { threshold: 2.5 };
    threeState.raycaster.setFromCamera(threeState.pointer, threeState.camera);
    const hits = threeState.raycaster.intersectObjects(objects, false);
    if (!hits.length) { clearEditorSelection(true); return false; }
    const obj = hits[0].object;
    const kind = obj.userData?.kind === 'boundary' ? 'boundary' : 'area';
    const key = obj.userData?.editorKey || getEditorKey(kind === 'area' ? obj.userData.area : obj.userData.line, obj.userData.floor, kind);
    selectEditorItem(kind, key, event);
    return true;
  }

  function initEditorInteractions() {
    if (els.developerToolsBtn) els.developerToolsBtn.addEventListener('click', () => setEditorMode(!editorState.modeEnabled));
    if (els.editorModeBtn) els.editorModeBtn.addEventListener('click', () => setEditorMode(!editorState.modeEnabled));
    if (els.editorModeToggle) els.editorModeToggle.addEventListener('change', e => setEditorMode(e.target.checked));
    if (els.editorSelectionMode) els.editorSelectionMode.addEventListener('change', e => { editorState.selectionMode = e.target.value; updateEditorPanel(); });
    if (els.editorShowDeleted) els.editorShowDeleted.addEventListener('change', e => { editorState.showDeleted = e.target.checked; renderActiveFloor(false); render3DStack(false); updateEditorPanel(); });
    for (const [name, button] of Object.entries(editorToolButtons())) {
      if (button) button.addEventListener('click', () => setEditorTool(name));
    }
    if (els.editorClearSelectionBtn) els.editorClearSelectionBtn.addEventListener('click', () => clearEditorSelection(true));
    if (els.editorDeleteBtn) els.editorDeleteBtn.addEventListener('click', deleteSelectedElements);
    if (els.editorUndoDeleteBtn) els.editorUndoDeleteBtn.addEventListener('click', undoLastViewerChangeset);
    if (els.editorSaveJsonBtn) els.editorSaveJsonBtn.addEventListener('click', () => { saveCurrentWorkingJson(); });
    if (els.editorExportTransformerBtn) els.editorExportTransformerBtn.addEventListener('click', () => { exportToSecondTransformer(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isEditorModeEnabled()) {
        if (editorState.drawStart) cancelEditorDrawing();
        else clearEditorSelection(true);
        updateEditorPanel();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && isEditorModeEnabled() && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
        deleteSelectedElements();
      }
    });
    bind2DEditorRectangleSelection();
    bind3DEditorRectangleSelection();
    updateEditorPanel();
  }

  function normalizedScreenRect(a, b) {
    return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
  }

  function showEditorSelectionBox(rect) {
    if (!els.editorSelectionBox) return;
    els.editorSelectionBox.style.display = 'block';
    els.editorSelectionBox.style.left = `${rect.left}px`;
    els.editorSelectionBox.style.top = `${rect.top}px`;
    els.editorSelectionBox.style.width = `${Math.max(1, rect.right - rect.left)}px`;
    els.editorSelectionBox.style.height = `${Math.max(1, rect.bottom - rect.top)}px`;
  }

  function hideEditorSelectionBox() {
    if (els.editorSelectionBox) els.editorSelectionBox.style.display = 'none';
  }

  function bind2DEditorRectangleSelection() {
    const container = map.getContainer();
    let start = null;
    let dragging = false;
    container.addEventListener('pointerdown', e => {
      if (!isEditorModeEnabled() || activeEditorTool() !== 'select' || e.button !== 0) return;
      if (e.target.closest('.leaflet-control')) return;
      start = { x: e.clientX, y: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
      dragging = false;
    }, true);
    container.addEventListener('pointermove', e => {
      if (!start || !isEditorModeEnabled() || activeEditorTool() !== 'select') return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging && Math.abs(dx) + Math.abs(dy) > 5) dragging = true;
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = normalizedScreenRect(start, { x: e.clientX, y: e.clientY });
      showEditorSelectionBox(rect);
    }, true);
    container.addEventListener('pointerup', e => {
      if (!start || !isEditorModeEnabled()) { start = null; return; }
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
        const rect = normalizedScreenRect(start, { x: e.clientX, y: e.clientY });
        const nw = map.containerPointToLatLng([rect.left - container.getBoundingClientRect().left, rect.top - container.getBoundingClientRect().top]);
        const se = map.containerPointToLatLng([rect.right - container.getBoundingClientRect().left, rect.bottom - container.getBoundingClientRect().top]);
        const worldRect = { minX: Math.min(nw.lng, se.lng), maxX: Math.max(nw.lng, se.lng), minY: Math.min(nw.lat, se.lat), maxY: Math.max(nw.lat, se.lat) };
        selectByRectangle(worldRect, '2d', start);
        editorState.suppressNextMapClick = true;
      }
      hideEditorSelectionBox();
      start = null;
      dragging = false;
    }, true);
  }

  function bind3DEditorRectangleSelection() {
    const getCanvas = () => threeState.renderer?.domElement;
    let start = null;
    let dragging = false;
    const onDown = e => {
      if (!isEditorModeEnabled() || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
      dragging = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      getCanvas()?.setPointerCapture?.(e.pointerId);
    };
    const onMove = e => {
      if (!start || !isEditorModeEnabled()) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging && Math.abs(dx) + Math.abs(dy) > 5) dragging = true;
      if (!dragging) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showEditorSelectionBox(normalizedScreenRect(start, { x: e.clientX, y: e.clientY }));
    };
    const onUp = e => {
      if (!start || !isEditorModeEnabled()) { start = null; return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (dragging) {
        const rect = normalizedScreenRect(start, { x: e.clientX, y: e.clientY });
        selectBy3DScreenRectangle(rect, start);
      } else {
        pick3DEditorObject(e);
      }
      hideEditorSelectionBox();
      start = null;
      dragging = false;
      try { getCanvas()?.releasePointerCapture?.(e.pointerId); } catch (_) { }
    };
    const canvas = getCanvas();
    if (canvas) {
      canvas.addEventListener('pointerdown', onDown, true);
      canvas.addEventListener('pointermove', onMove, true);
      canvas.addEventListener('pointerup', onUp, true);
    }
  }

  function getLowestFloor() {
    return (state.floors || []).reduce((lowest, floor) => {
      if (!lowest) return floor;
      const currentZ = toNum(floor?.heightFt, Number.POSITIVE_INFINITY);
      const lowestZ = toNum(lowest?.heightFt, Number.POSITIVE_INFINITY);
      return currentZ < lowestZ ? floor : lowest;
    }, null);
  }

  function propertyLineDisplayPoints(line, fallbackZ = 0) {
    const curve = safeObj(line?.curve);
    const source = firstArray(curve.display_points, line?.display_points);
    const points = source.length
      ? source.map(pointXYZ).filter(Boolean)
      : [pointXYZ(line?.start), pointXYZ(line?.end)].filter(Boolean);
    return points.map(pt => ({ x: pt.x, y: pt.y, z: Number.isFinite(pt.z) ? pt.z : fallbackZ }));
  }

  function getUniqueProjectPropertyLines() {
    const unique = new Map();
    for (const floor of state.floors || []) {
      for (const line of floor.propertyLines || []) {
        const points = propertyLineDisplayPoints(line, toNum(floor?.heightFt, 0));
        if (points.length < 2) continue;
        const key = String(line?.record_id || line?.unique_id || line?.id || JSON.stringify(points.map(pt => [Math.round(pt.x * 1000) / 1000, Math.round(pt.y * 1000) / 1000])));
        if (!unique.has(key)) unique.set(key, line);
      }
    }
    return [...unique.values()];
  }

  function isLowestFloor(floor) {
    const lowest = getLowestFloor();
    return !!lowest && floor === lowest;
  }

  function getPropertyLine2DStyle() {
    return {
      pane: 'propertyLinesPane',
      color: state.styleSettings.propertyLineColor,
      weight: clamp(toNum(state.styleSettings.propertyLineWeight, 2), 1, 6),
      opacity: objectOpacityForView('2d', 'propertyLines'),
      dashArray: '18 10',
      lineCap: 'butt',
      lineJoin: 'round',
      interactive: false
    };
  }

  function areaLoopsToLatLngs(area) {
    prepareAreaGeometryCache(area);
    return area?._latLngLoops || [];
  }

  function renderActiveFloor(fit = false) {
    clearBoundaryEditHandles();
    clearActiveLayerGroup();
    map.closePopup();
    clearSelection(false);

    const floor = state.floors[state.activeIndex];
    if (!floor) {
      updateSummary();
      return;
    }

    const group = L.layerGroup().addTo(map);
    const labelGroup = L.layerGroup();
    const boundaryGroup = L.layerGroup();
    const propertyLineGroup = L.layerGroup();
    const wallGroup = L.layerGroup();
    const columnGroup = L.layerGroup();
    floor.layers = { areas: [], labels: [], boundaries: [], propertyLines: [], walls: [], columns: [], labelGroup, boundaryGroup, propertyLineGroup, wallGroup, columnGroup };

    for (const area of floor.areas) {
      if (isEditorDeleted('area', getEditorKey(area, floor, 'area'))) continue;
      const loops = areaLoopsToLatLngs(area);
      if (!loops.length) continue;
      const style = getAreaStyle(area, '2d');
      const polygon = L.polygon(loops, style).addTo(group);
      polygon._baseStyle = style;
      polygon._areaData = area;
      polygon.on('click', e => {
        // Native Leaflet polygon pick path.
        // The map-level hit test below is the fallback path.
        if (e.originalEvent) e.originalEvent.__revitAreaHandled = true;
        if (isEditorModeEnabled()) {
          if (!handleEditorDrawingClick(e.latlng) && activeEditorTool() !== 'move') {
            selectEditorItem('area', getEditorKey(area, floor, 'area'), e.originalEvent || {});
          }
        } else {
          select2DArea(floor, area, polygon, e.latlng);
        }
        if (e.originalEvent) {
          try { L.DomEvent.stopPropagation(e.originalEvent); } catch (_) { }
        }
      });
      polygon.on('mouseover', () => {
        if (!isEditorAreaSelected(area) && state.selected?.layer !== polygon) polygon.setStyle({ weight: 3, fillOpacity: Math.min((style.fillOpacity ?? 0.78) + 0.12, 1) });
      });
      polygon.on('mouseout', () => {
        if (!isEditorAreaSelected(area) && state.selected?.layer !== polygon) polygon.setStyle(style);
      });
      floor.layers.areas.push(polygon);
    }

    for (const column of floor.columns2d || []) {
      const footprint = columnFootprintPoints(column);
      if (footprint.length < 3) continue;
      const poly = L.polygon(column._footprintLatLngs || footprint.map(revitToLatLng), getColumn2DStyle());
      poly.addTo(columnGroup);
      floor.layers.columns.push(poly);
    }

    for (const wall of floor.walls2d || []) {
      for (const strip of wallTo2DStrips(wall)) {
        const wallPoly = L.polygon(strip.map(revitToLatLng), getWall2DStyle());
        wallPoly.addTo(wallGroup);
        floor.layers.walls.push(wallPoly);
      }
    }

    for (const line of floor.boundaryLines) {
      if (isEditorDeleted('boundary', getEditorKey(line, floor, 'boundary'))) continue;
      const boundaryPoints = boundaryDisplayPoints(line);
      if (boundaryPoints.length < 2) continue;
      const boundaryStyle = {
        pane: 'boundariesPane',
        color: state.styleSettings.boundaryLineColor,
        weight: 2.3,
        opacity: 1,
        lineCap: 'butt',
        interactive: true
      };
      const polyline = L.polyline(boundaryPoints.map(revitToLatLng), boundaryStyle);
      polyline._baseStyle = boundaryStyle;
      polyline._boundaryData = line;
      polyline.on('click', e => {
        if (!isEditorModeEnabled() || !['select', 'move'].includes(activeEditorTool())) return;
        if (e.originalEvent) e.originalEvent.__revitAreaHandled = true;
        selectEditorItem('boundary', getEditorKey(line, floor, 'boundary'), e.originalEvent || {});
        if (activeEditorTool() === 'move') setTimeout(() => renderBoundaryEditHandles(floor), 0);
        if (e.originalEvent) {
          try { L.DomEvent.stopPropagation(e.originalEvent); } catch (_) { }
        }
      });
      polyline.addTo(boundaryGroup);
      floor.layers.boundaries.push(polyline);
    }

    renderDeletedOverlays2D(floor, group);
    renderBoundaryEditHandles(floor);

    // Property Lines are project/site context. Display them only when the
    // active plan is the lowest Level, regardless of the source host view.
    if (isLowestFloor(floor)) {
      for (const line of getUniqueProjectPropertyLines()) {
        const points = propertyLineDisplayPoints(line, toNum(floor.heightFt, 0));
        if (points.length < 2) continue;
        const polyline = L.polyline(points.map(revitToLatLng), getPropertyLine2DStyle());
        polyline.addTo(propertyLineGroup);
        floor.layers.propertyLines.push(polyline);
      }
    }

    for (const area of floor.areas) {
      const pt = getAreaAnchorPoint(area);
      if (!pt) continue;
      const marker = L.marker(revitToLatLng(pt), {
        pane: 'labelsPane',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'revit-label-icon',
          iconSize: [1, 1],
          iconAnchor: [0, 0],
          html: makeAreaLabel(area)
        })
      });
      marker.addTo(labelGroup);
      floor.layers.labels.push(marker);
    }

    if (state.display2d.columns) columnGroup.addTo(group);
    if (state.display2d.walls) wallGroup.addTo(group);
    if (state.display2d.boundaries) boundaryGroup.addTo(group);
    if (state.display2d.propertyLines) propertyLineGroup.addTo(group);
    if (state.display2d.labels) labelGroup.addTo(group);

    state.activeGroup = group;
    updateSummary();
    updateFloorControls();

    if (fit) fitActiveFloor();
    else update2DLabelScale(false);
  }

  function clearActiveLayerGroup() {
    if (state.activeGroup) {
      map.removeLayer(state.activeGroup);
      state.activeGroup = null;
    }
  }

  function getAreaLabelFallbackPoint(area) {
    prepareAreaGeometryCache(area);
    return area?._labelFallbackPoint || null;
  }

  function makeAreaLabel(area) {
    const name = escapeHTML(areaName(area));
    const sqft = fmtSF(areaSqFt(area));
    const labelClass = getLabelClass(area);
    return `<div class="revit-label ${labelClass}"><div class="name">${name}</div><div class="sf">${sqft} SF</div></div>`;
  }

  function getLabelClass(area) {
    const box = getAreaBox(area);
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const sqft = areaSqFt(area);
    const classes = [];
    const areaNameText = areaName(area).toUpperCase();
    if (h > w * 1.65 && w < 11 && sqft > 150 && !areaNameText.includes('STAIR')) classes.push('rotated');
    if (sqft < 120 || Math.min(w, h) < 9) classes.push('small-label');
    if (sqft < 95) classes.push('tiny-label');
    return classes.join(' ');
  }

  function getAreaBox(area) {
    prepareAreaGeometryCache(area);
    return area?._box || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  function find2DAreaAtLatLng(latlng) {
    const floor = state.floors[state.activeIndex];
    if (!floor || !floor.layers?.areas?.length || !latlng) return null;

    const pt = { x: toNum(latlng.lng), y: toNum(latlng.lat) };

    // Search in reverse draw order so visually top-most areas win first.
    for (let i = floor.layers.areas.length - 1; i >= 0; i--) {
      const layer = floor.layers.areas[i];
      const area = layer._areaData;
      if (!area) continue;
      const box = getAreaBox(area);
      if (pt.x < box.minX || pt.x > box.maxX || pt.y < box.minY || pt.y > box.maxY) continue;
      if (pointInAreaXY(pt, area)) return { floor, area, layer };
    }

    return null;
  }

  function pointInAreaXY(pt, area) {
    prepareAreaGeometryCache(area);
    const loops = area?._cleanLoops || [];

    if (!loops.length) return false;

    // First loop is the outer boundary. Additional loops are treated as holes.
    if (!pointInRingXY(pt, loops[0])) return false;

    for (let i = 1; i < loops.length; i++) {
      if (pointInRingXY(pt, loops[i])) return false;
    }

    return true;
  }

  function pointInRingXY(pt, ring) {
    let inside = false;
    const x = pt.x;
    const y = pt.y;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = toNum(ring[i].x);
      const yi = toNum(ring[i].y);
      const xj = toNum(ring[j].x);
      const yj = toNum(ring[j].y);

      // Treat points very close to an edge as inside, which makes narrow Revit areas easier to pick.
      if (pointNearSegmentXY(x, y, xi, yi, xj, yj, 0.35)) return true;

      const intersects = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);

      if (intersects) inside = !inside;
    }

    return inside;
  }

  function pointNearSegmentXY(px, py, ax, ay, bx, by, tolerance) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) {
      const ddx = px - ax;
      const ddy = py - ay;
      return Math.sqrt(ddx * ddx + ddy * ddy) <= tolerance;
    }

    const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const ddx = px - cx;
    const ddy = py - cy;
    return Math.sqrt(ddx * ddx + ddy * ddy) <= tolerance;
  }

  function areaIdentity(area) {
    if (!area) return '';
    return String(
      area.unique_id ??
      area.id ??
      area.area_id ??
      `${areaNumber(area)}|${areaName(area)}|${fmtSF(areaSqFt(area))}`
    );
  }

  function isSameArea(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const aId = areaIdentity(a);
    const bId = areaIdentity(b);
    return !!aId && aId === bId;
  }

  function find2DLayerForArea(floor, area) {
    const activeFloor = state.floors[state.activeIndex];
    if (!floor || floor !== activeFloor || !floor.layers?.areas?.length) return null;
    return floor.layers.areas.find(layer => isSameArea(layer._areaData, area)) || null;
  }

  function find3DMeshForArea(floor, area) {
    if (!floor || !area || !threeState.areaMeshes?.length) return null;
    return threeState.areaMeshes.find(mesh => mesh.userData?.floor === floor && isSameArea(mesh.userData?.area, area)) || null;
  }

  function floorIndexForFloor(floor) {
    if (!floor || !state.floors?.length) return -1;

    const directIndex = state.floors.indexOf(floor);
    if (directIndex >= 0) return directIndex;

    const floorLevelId = floor.levelId ?? '';
    const floorViewId = floor.viewId ?? '';
    const floorName = floor.levelName || floor.name || '';
    const floorHeight = Number(floor.heightFt);

    for (let i = 0; i < state.floors.length; i++) {
      const candidate = state.floors[i];
      if (!candidate) continue;

      const sameLevelId = floorLevelId !== '' && String(candidate.levelId ?? '') === String(floorLevelId);
      const sameViewId = floorViewId !== '' && String(candidate.viewId ?? '') === String(floorViewId);
      if (sameLevelId && (sameViewId || floorViewId === '')) return i;

      const candidateName = candidate.levelName || candidate.name || '';
      const candidateHeight = Number(candidate.heightFt);
      if (floorName && candidateName === floorName && Number.isFinite(floorHeight) && Number.isFinite(candidateHeight) && Math.abs(candidateHeight - floorHeight) < 0.01) {
        return i;
      }
    }

    return -1;
  }

  function activateFloorForPicked3DObject(floor, fitPlan = true) {
    const floorIndex = floorIndexForFloor(floor);
    if (floorIndex < 0 || floorIndex === state.activeIndex) return false;

    // Selecting in the 3D stack should drive the right-side Active Level selector
    // and the 2D floor plan, regardless of whether the picked floor is a normal
    // floor or the representative plan inside a typical-floor group.
    setActiveFloor(floorIndex, fitPlan);
    return true;
  }

  function apply2DHighlight(layer) {
    if (!layer) return;
    layer.setStyle(getHighlightStyle());
    layer.bringToFront();
  }

  function apply3DHighlight(mesh) {
    if (!mesh) return;
    threeState.selectedMesh = mesh;
    mesh.material.color.set('#ffcf33');
    mesh.material.opacity = 0.92;
    const line = mesh.userData.outline;
    if (line) {
      line.visible = true;
      setThreeLineColor(line, '#ff2f00');
    }
    mark3DDirty();
  }

  function select2DArea(floor, area, layer, latlng) {
    if (floorIndexForFloor(floor) !== state.activeIndex) {
      activateFloorForPicked3DObject(floor, false);
    }
    const mesh = find3DMeshForArea(floor, area);
    if ((state.selected?.layer && state.selected.layer === layer) || (state.selected?.mesh && state.selected.mesh === mesh)) {
      map.closePopup();
      clearSelection(true);
      return;
    }

    clearSelection(false);
    state.selected = { floor, area, layer, mesh, type: 'linked' };
    apply2DHighlight(layer);
    apply3DHighlight(mesh);
    focus3DOrbitOnArea(floor, area, mesh);

    map.closePopup();
    hide3DPopup();
    showSelectionInfoFloat(floor, area);
    updateSelectedInfo(floor, area);
    updateSummary();
  }

  function select3DArea(floor, area, mesh) {
    const activeBeforePick = state.activeIndex;
    const layerBeforeActivation = find2DLayerForArea(floor, area);
    const alreadySelected =
      (state.selected?.mesh && state.selected.mesh === mesh) ||
      (state.selected?.layer && state.selected.layer === layerBeforeActivation);

    if (alreadySelected && floorIndexForFloor(floor) === activeBeforePick) {
      map.closePopup();
      clearSelection(true);
      return;
    }

    clearSelection(false);
    map.closePopup();

    // Any 3D area pick should make that area's source level the Active Level.
    // This applies to normal stacked floors and representative typical-floor plans.
    activateFloorForPicked3DObject(floor, false);

    const layer = find2DLayerForArea(floor, area);
    state.selected = { floor, area, layer, mesh, type: 'linked' };
    apply3DHighlight(mesh);
    apply2DHighlight(layer);
    focus3DOrbitOnArea(floor, area, mesh);

    hide3DPopup();
    showSelectionInfoFloat(floor, area);
    updateSelectedInfo(floor, area);
    updateSummary();
  }

  function clearSelection(resetInfo = true) {
    const hadSelectedArea = !!state.selected?.area;
    let changed3DSelection = false;
    if (state.selected?.layer) {
      state.selected.layer.setStyle(state.selected.layer._baseStyle);
    }
    if (threeState.selectedMesh) {
      changed3DSelection = true;
      const mesh = threeState.selectedMesh;
      mesh.material.color.set(mesh.userData.baseFillColor || '#eefbe7');
      mesh.material.opacity = mesh.userData.baseOpacity ?? 0.78;
      const line = mesh.userData.outline;
      if (line) {
        setThreeLineColor(line, state.styleSettings.areaLineColor);
        line.visible = false;
      }
      threeState.selectedMesh = null;
    }
    state.selected = null;
    if (hadSelectedArea) restoreDefault3DOrbitTarget();
    if (els.stackPopup.style.display !== 'none') changed3DSelection = true;
    hide3DPopup();
    hideSelectionInfoFloat();
    if (changed3DSelection) mark3DDirty();
    if (resetInfo) {
      const msg = state.mode === '3d'
        ? '3D Areas mode displays area names as labels. Left-click an area to highlight it and show the selected-area info card.'
        : 'Left-click an area polygon in 2D Plan mode to select it. Middle-click drag pans the plan. Click the same area again or click white canvas to deselect.';
      els.selectedInfo.innerHTML = `<div class="small">${msg}</div>`;
    }
    if (resetInfo && state.floors.length) updateSummary();
  }

  function makePopupContent(floor, area) {
    const towerRaw = area.tower;
    const towerVal = (towerRaw === undefined || towerRaw === null || String(towerRaw).trim() === '' || String(towerRaw).trim() === '0') ? 'n/a' : escapeHTML(String(towerRaw));
    return `
  <div class="popup-title">${escapeHTML(areaName(area))}</div>
  <div class="popup-main">${fmtSF(areaSqFt(area))} SF</div>
  <div class="popup-sub">${escapeHTML(areaCategory(area))}</div>
  <div class="popup-sub">${escapeHTML(floor.name)} · ${fmtFtIn(floor.heightFt)}</div>
  <div class="popup-sub">Tower: <strong>${towerVal}</strong></div>
  `;
  }

  function showSelectionInfoFloat(floor, area) {
    if (!els.selectionInfoFloat || !floor || !area) return;
    els.selectionInfoFloat.innerHTML = `
      <button type="button" class="selection-info-close" aria-label="Close selected area info">×</button>
      ${makePopupContent(floor, area)}
    `;
    els.selectionInfoFloat.hidden = false;
    const closeBtn = els.selectionInfoFloat.querySelector('.selection-info-close');
    if (closeBtn) closeBtn.addEventListener('click', () => clearSelection(true), { once: true });
  }

  function hideSelectionInfoFloat() {
    if (!els.selectionInfoFloat) return;
    els.selectionInfoFloat.hidden = true;
    els.selectionInfoFloat.innerHTML = '';
  }

  function hide3DPopup() {
    if (!els.stackPopup) return;
    els.stackPopup.style.display = 'none';
    delete els.stackPopup.dataset.worldX;
    delete els.stackPopup.dataset.worldY;
    delete els.stackPopup.dataset.worldZ;
  }

  function get2DPopupOffset(latlng) {
    if (!latlng || !map) return L.point(96, -56);
    try {
      const size = map.getSize();
      const point = map.latLngToContainerPoint(latlng);
      const xDir = point.x < size.x * 0.56 ? 1 : -1;
      const yDir = point.y < size.y * 0.34 ? 1 : -1;

      // Move the info card away from the selected polygon while still
      // keeping it visually connected to the clicked/selected area.
      return L.point(104 * xDir, 58 * yDir);
    } catch (err) {
      return L.point(96, -56);
    }
  }

  function updateSelectedInfo(floor, area) {
    const pt = getAreaAnchorPoint(area) || {};
    const z = toNum(pt.z ?? floor.heightFt, NaN);
    const towerRaw = area.tower;
    const towerVal = (towerRaw === undefined || towerRaw === null || String(towerRaw).trim() === '' || String(towerRaw).trim() === '0') ? 'n/a' : escapeHTML(String(towerRaw));
    els.selectedInfo.innerHTML = `
  <div class="info-grid">
    <div class="k">Name</div><div class="v"><strong>${escapeHTML(areaName(area))}</strong></div>
    <div class="k">Number</div><div class="v">${escapeHTML(areaNumber(area) || '—')}</div>
    <div class="k">Area Category</div><div class="v">${escapeHTML(areaCategory(area))}</div>
    <div class="k">Tower</div><div class="v"><strong>${towerVal}</strong></div>
    <div class="k">Area</div><div class="v"><strong>${fmt(areaSqFt(area), 2)} SF</strong></div>
    <div class="k">Level</div><div class="v">${escapeHTML(floor.name)}</div>
    <div class="k">Height</div><div class="v"><strong>${fmtFtIn(floor.heightFt)}</strong></div>
    <div class="k">3D display Y</div><div class="v mono">${fmt(floor.y3D, 3)} ft display at ${fmt(state.zScale, 2)}x Z scale</div>
    <div class="k">Point XYZ</div><div class="v mono">X ${fmt(pt.x, 3)}<br>Y ${fmt(pt.y, 3)}<br>Z ${fmt(z, 3)}</div>
    <div class="k">Revit ID</div><div class="v mono">${escapeHTML(area.id || '—')}</div>
    <div class="k">Unique ID</div><div class="v mono">${escapeHTML(area.unique_id || '—')}</div>
    <div class="k">Department</div><div class="v">${escapeHTML(area.department || '—')}</div>
    <div class="k">Comments</div><div class="v">${escapeHTML(area.comments || '—')}</div>
    <div class="k">Source file</div><div class="v">${escapeHTML(floor.sourceFile)}</div>
  </div>
  `;
  }

  function uniqueWallCount(floors) {
    const keys = new Set();
    for (const floor of floors || []) {
      (floor.walls2d || []).forEach((wall, index) => keys.add(wallKey(wall, floor, index)));
    }
    return keys.size;
  }

  function uniqueColumnCount(floors) {
    const keys = new Set();
    for (const floor of floors || []) {
      (floor.columns2d || []).forEach((column, index) => keys.add(columnKey(column, floor, index)));
    }
    return keys.size;
  }

  function updateSummary() {
    const floor = state.floors[state.activeIndex];
    if (!state.floors.length) {
      els.floorSummary.innerHTML = '<div class="small">Import one combined Area Plan batch JSON file.</div>';
      return;
    }

    if (!floor) {
      els.floorSummary.innerHTML = '<div class="small">No active floor selected.</div>';
      return;
    }

    const rows = [...floor.stats.byCategory.entries()]
      .sort((a, b) => b[1].sqft - a[1].sqft)
      .map(([name, v]) => `
    <tr>
      <td class="text">${escapeHTML(name)}</td>
      <td>${fmt(v.count, 0)}</td>
      <td>${fmt(v.sqft, 0)}</td>
    </tr>
  `).join('');

    const totalSf = state.reportData?.summary?.totalGrossSqft ?? state.floors.reduce((sum, f) => sum + (f.stats?.totalArea || 0), 0);
    const sellableSf = state.reportData?.summary?.totalSellableSqft ?? 0;
    const efficiency = totalSf ? sellableSf / totalSf : 0;

    els.floorSummary.innerHTML = `
  <div class="metric-grid">
    <div class="metric-card"><div class="label">Total Gross Sq.ft.</div><div class="value">${fmt(totalSf, 0)} SF</div></div>
    <div class="metric-card"><div class="label">Efficiency</div><div class="value">${fmt(efficiency * 100, 1)}%</div></div>
    <div class="metric-card"><div class="label">Active Floor SF</div><div class="value">${fmt(floor.stats.totalArea, 0)} SF</div></div>
  </div>
  <div class="info-grid" style="margin-bottom:10px">
    <div class="k">Level</div><div class="v"><strong>${escapeHTML(floor.name)}</strong></div>
    <div class="k">Height</div><div class="v">${fmtFtIn(floor.heightFt)}</div>
  </div>
  <div class="table-wrap">
    <table class="report-table">
      <thead><tr><th class="text">Area Category</th><th>Count</th><th>SF</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div id="activeSelectedArea" class="selected-card" style="display:${state.selected?.area ? 'block' : 'none'}">${state.selected?.area ? selectedAreaCard(state.selected.floor, state.selected.area) : ''}</div>
  `;
  }

  function floorIndexForSelectorFloor(floor) {
    if (!floor) return -1;
    return state.floors.indexOf(floor);
  }

  function compactTypicalGroupLabel(group) {
    const base = parseFloorLabelParts(group?.baseFloor);
    const top = parseFloorLabelParts(group?.topFloor);
    const prefix = base.prefix && base.prefix === top.prefix ? `${base.prefix} ` : '';
    if (base.level && top.level) return `${prefix}LEVELS ${base.level}–${top.level}`;
    return typicalGroupLabelText(group).replace(/\s+-\s+/g, '–');
  }

  function typicalGroupHeaderLabel(group) {
    const base = parseFloorLabelParts(group?.baseFloor);
    const top = parseFloorLabelParts(group?.topFloor);
    if (base.level && top.level) {
      const prefix = base.prefix && base.prefix === top.prefix ? `${base.prefix} ` : '';
      return `${prefix}${base.level}–${top.level}`;
    }
    return compactTypicalGroupLabel(group);
  }

  function levelSelectorEntries() {
    const groupByFloor = new Map();
    for (const group of state.typicalFloorGroups || []) {
      for (const floor of group.floors || []) groupByFloor.set(floor, group);
    }

    const entries = [];
    const emittedGroups = new Set();
    const sortedFloors = (state.floors || [])
      .slice()
      .sort((a, b) => toNum(a.heightFt, 0) - toNum(b.heightFt, 0));

    for (const floor of sortedFloors) {
      const group = groupByFloor.get(floor);
      if (group) {
        if (emittedGroups.has(group.id)) continue;
        emittedGroups.add(group.id);
        const representative = group.representativeFloor || group.baseFloor || floor;
        entries.push({
          kind: 'typical',
          sortHeight: toNum(group.baseFloor?.heightFt, 0),
          value: `group:${group.id}`,
          floorIndex: floorIndexForSelectorFloor(representative),
          floor: representative,
          group,
          label: `${compactTypicalGroupLabel(group)} · TYPICAL (${group.floors.length} LEVELS)`,
          headerLabel: typicalGroupHeaderLabel(group)
        });
        continue;
      }

      entries.push({
        kind: 'floor',
        sortHeight: toNum(floor.heightFt, 0),
        value: `floor:${floorIndexForSelectorFloor(floor)}`,
        floorIndex: floorIndexForSelectorFloor(floor),
        floor,
        group: null,
        label: `${floor.levelName || floor.name} · ${fmtFtIn(floor.heightFt)}`,
        headerLabel: parseFloorLabelParts(floor).prefix
          ? `${parseFloorLabelParts(floor).prefix} ${parseFloorLabelParts(floor).level || ''}`.trim()
          : (parseFloorLabelParts(floor).level || floor.levelName || floor.name)
      });
    }

    return entries.sort((a, b) => a.sortHeight - b.sortHeight);
  }

  function activeSelectorEntry(entries) {
    const activeFloor = state.floors[state.activeIndex];
    if (!activeFloor) return null;
    const group = activeFloor._typicalGroup;
    if (group) return entries.find(entry => entry.kind === 'typical' && entry.group?.id === group.id) || null;
    return entries.find(entry => entry.kind === 'floor' && entry.floor === activeFloor) || null;
  }

  function handleFloorSelectorChange(rawValue) {
    const value = String(rawValue || '');
    if (!value) return;

    if (value.startsWith('group:')) {
      const groupId = value.slice('group:'.length);
      const group = (state.typicalFloorGroups || []).find(item => String(item.id) === groupId);
      const representative = group?.representativeFloor || group?.baseFloor;
      const index = floorIndexForSelectorFloor(representative);
      if (index >= 0) setActiveFloor(index);
      return;
    }

    const indexText = value.startsWith('floor:') ? value.slice('floor:'.length) : value;
    const index = Number(indexText);
    if (Number.isInteger(index)) setActiveFloor(index);
  }

  function updateFloorControls() {
    els.floorSelect.innerHTML = '';

    if (!state.floors.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No floors loaded';
      opt.value = '';
      els.floorSelect.appendChild(opt);
      els.floorSelect.disabled = true;
      els.floorList.innerHTML = 'No batch JSON loaded yet.';
      return;
    }

    els.floorSelect.disabled = false;
    const entries = levelSelectorEntries();
    const selectedEntry = activeSelectorEntry(entries);

    for (const entry of entries) {
      const opt = document.createElement('option');
      opt.value = entry.value;
      opt.textContent = entry.label;
      opt.dataset.floorIndex = String(entry.floorIndex);
      opt.dataset.levelDisplay = entry.headerLabel || '';
      opt.dataset.entryKind = entry.kind;
      if (selectedEntry && selectedEntry.value === entry.value) opt.selected = true;
      els.floorSelect.appendChild(opt);
    }

    // Keep the detailed floor list available in the sidebar, but group repeated
    // tower floors there as one logical row as well. This avoids presenting a
    // hundred near-identical floors while retaining individual source levels in data.
    els.floorList.innerHTML = entries.map(entry => {
      const isActive = selectedEntry && selectedEntry.value === entry.value;
      if (entry.kind === 'typical') {
        const totalArea = (entry.group?.floors || []).reduce(
          (sum, floor) => sum + toNum(floor.stats?.totalArea, 0),
          0
        );
        return `
          <div class="floor-row ${isActive ? 'active' : ''}" data-selector-value="${escapeHTML(entry.value)}">
            <div class="name">${escapeHTML(entry.label)}</div>
            <div class="floor-total">${fmt(totalArea, 0)} SF TOTAL</div>
            <div class="height">${fmtFtIn(entry.group?.baseFloor?.heightFt)}–${fmtFtIn(entry.group?.topFloor?.heightFt)}</div>
            <div class="meta">Representative plan: ${escapeHTML(entry.floor?.levelName || entry.floor?.name || '')}</div>
          </div>`;
      }
      return `
        <div class="floor-row ${isActive ? 'active' : ''}" data-selector-value="${escapeHTML(entry.value)}">
          <div class="name">${escapeHTML(entry.floor?.name || '')}</div>
          <div class="floor-total">${fmt(entry.floor?.stats?.totalArea || 0, 0)} SF</div>
          <div class="height">${fmtFtIn(entry.floor?.heightFt)}</div>
        </div>`;
    }).join('');
  }

  function fitActiveFloor() {
    const floor = state.floors[state.activeIndex];
    if (!floor || !floor.bounds || !floor.bounds.isValid()) return;

    // Do not set Leaflet maxBounds here.
    // The previous version used maxBounds around the plan geometry, which made
    // middle-click pan feel like it hit an invisible wall before the user reached
    // the available white canvas. Keeping the map unconstrained feels closer to
    // Revit/CAD pan behavior.
    map.setMaxBounds(null);

    map.fitBounds(floor.bounds, { padding: [54, 54], animate: false });
    update2DLabelScale(true);
  }

  function fitActiveFloorAfterLayout() {
    if (!state.floors.length) return;
    requestAnimationFrame(() => {
      map.invalidateSize(false);
      fitActiveFloor();
      requestAnimationFrame(() => {
        map.invalidateSize(false);
        fitActiveFloor();
      });
    });
  }

  function update2DLabelScale(resetBase = false) {
    if (!map || !map.getContainer) return;
    const zoom = Number(map.getZoom());
    if (!Number.isFinite(zoom)) return;
    if (resetBase || state.labelBaseZoom === null || !Number.isFinite(state.labelBaseZoom)) {
      state.labelBaseZoom = zoom;
    }

    // Leaflet divIcon labels are screen-space by default. Scale them from
    // the fitted-floor zoom so the full-plan view stays compact, then grow
    // the labels progressively as the user zooms in.
    const delta = zoom - state.labelBaseZoom;
    const scale = clamp(0.44 * Math.pow(1.32, delta), 0.24, 1.22);
    map.getContainer().style.setProperty('--label-scale', scale.toFixed(3));
  }

  function setActiveFloor(index, fit = true) {
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= state.floors.length) return;
    state.activeIndex = n;
    renderActiveFloor(fit);
    updateFloorControls();
    updateSummary();
    if (state.mode === '3d') {
      clearSelection(true);
      update3DLabels();
    }
  }

  function clearAll() {
    clearActiveLayerGroup();
    map.closePopup();
    clearSelection(true);
    clear3DWorld();
    state.floors = [];
    state.activeIndex = -1;
    state.projectInfo = {};
    state.exportInfo = {};
    state.propertyLineExport = {};
    state.reportData = {};
    state.areaGroups = [];
    state.typicalFloorGroups = [];
    state.importedAreaColorMap = {};
    state.styleSettings.areaColorMap = {};
    editorState = initEditorState(null, '');
    setEditorMode(false);
    if (els.editorValidationText) els.editorValidationText.textContent = 'Load a JSON file, turn on Editor Mode, then select Areas or Area Boundary Lines.';
    if (els.loadedFileLabel) els.loadedFileLabel.innerHTML = 'LOADED: <strong>no file</strong>';
    els.fileInput.value = '';
    updateFloorControls();
    updateSummary();
    renderProjectInfo();
    renderReports();
    renderStyleLegend();
    map.setMaxBounds(null);
    map.setView([0, 0], 0);
    threeState.target.set(0, 0, 0);
    threeState.cameraDistance = 240;
    updateCamera();
  }

  function is3DLabelAllowed(item) {
    if (!state.display3d.labels) return false;
    if (item?.alwaysVisible) return true;
    // In split-screen, 3D is always showing. Only show labels for the active floor.
    // If the active floor is inside a typical-floor extrusion, show labels for the
    // group's single center representative plan instead of hidden base/top plates.
    const activeFloor = state.floors[state.activeIndex];
    if (!activeFloor || !item?.floor) return false;
    if (item.floor === activeFloor) return true;
    if (activeFloor._typicalGroup && item.floor._typicalGroup === activeFloor._typicalGroup) return true;
    return false;
  }

  function refreshVisibility() {
    const floor = state.floors[state.activeIndex];
    if (floor && state.activeGroup) {
      if (floor.layers.boundaryGroup) {
        if (state.display2d.boundaries && !state.activeGroup.hasLayer(floor.layers.boundaryGroup)) floor.layers.boundaryGroup.addTo(state.activeGroup);
        else if (!state.display2d.boundaries && state.activeGroup.hasLayer(floor.layers.boundaryGroup)) state.activeGroup.removeLayer(floor.layers.boundaryGroup);
      }
      if (floor.layers.propertyLineGroup) {
        if (state.display2d.propertyLines && !state.activeGroup.hasLayer(floor.layers.propertyLineGroup)) floor.layers.propertyLineGroup.addTo(state.activeGroup);
        else if (!state.display2d.propertyLines && state.activeGroup.hasLayer(floor.layers.propertyLineGroup)) state.activeGroup.removeLayer(floor.layers.propertyLineGroup);
      }
      if (floor.layers.columnGroup) {
        if (state.display2d.columns && !state.activeGroup.hasLayer(floor.layers.columnGroup)) floor.layers.columnGroup.addTo(state.activeGroup);
        else if (!state.display2d.columns && state.activeGroup.hasLayer(floor.layers.columnGroup)) state.activeGroup.removeLayer(floor.layers.columnGroup);
      }
      if (floor.layers.wallGroup) {
        if (state.display2d.walls && !state.activeGroup.hasLayer(floor.layers.wallGroup)) floor.layers.wallGroup.addTo(state.activeGroup);
        else if (!state.display2d.walls && state.activeGroup.hasLayer(floor.layers.wallGroup)) state.activeGroup.removeLayer(floor.layers.wallGroup);
      }
      if (floor.layers.labelGroup) {
        if (state.display2d.labels && !state.activeGroup.hasLayer(floor.layers.labelGroup)) floor.layers.labelGroup.addTo(state.activeGroup);
        else if (!state.display2d.labels && state.activeGroup.hasLayer(floor.layers.labelGroup)) state.activeGroup.removeLayer(floor.layers.labelGroup);
      }
    }

    for (const item of threeState.labelItems) item.el.style.display = is3DLabelAllowed(item) ? 'block' : 'none';
    for (const item of threeState.floorLabelItems) item.el.style.display = is3DLabelAllowed(item) ? 'block' : 'none';
    if (threeState.worldGroup) {
      const showAll3DLines = state.display3d.lines !== false;
      threeState.worldGroup.traverse(obj => {
        if (obj.userData?.kind === 'boundary') obj.visible = showAll3DLines && state.display3d.boundaries;
        if (obj.userData?.kind === 'floorPerimeter') obj.visible = showAll3DLines;
        if (obj.userData?.kind === 'propertyLine') obj.visible = showAll3DLines && state.display3d.propertyLines;
        if (obj.userData?.kind === 'areaOutline') {
          obj.visible = showAll3DLines && obj === threeState.selectedMesh?.userData?.outline;
        }
        if (obj.userData?.kind === 'wall') obj.visible = state.display3d.walls;
        if (obj.userData?.kind === 'column') obj.visible = state.display3d.columns;
        if (obj.userData?.kind === 'typicalFloorVolume') obj.visible = true;
        if (obj.userData?.kind === 'typicalFloorVolumeEdge') obj.visible = false;
        if (isThreeLineObject(obj) && !isHelperLineObject(obj) && !showAll3DLines) obj.visible = false;
      });
      apply3DAllLinesTransparency();
      refreshActiveFloorPerimeterHighlight();
    }
    mark3DDirty();
  }

  function switchMode(mode) {
    state.mode = mode;
    els.mode2dBtn.classList.toggle('active', mode === '2d');
    els.mode3dBtn.classList.toggle('active', mode === '3d');
    // Both 3D and 2D are always visible in split screen.
    // switchMode just records the active context and refreshes the 2D fit.
    map.invalidateSize(false);
    fitActiveFloor();
    if (mode === '3d') {
      resize3D();
    }
  }

  function clear3DWorld() {
    if (!threeState.worldGroup) return;
    while (threeState.worldGroup.children.length) {
      const obj = threeState.worldGroup.children.pop();
      disposeObject(obj);
    }
    threeState.areaMeshes = [];
    threeState.wallMeshes = [];
    threeState.columnMeshes = [];
    threeState.typicalGroupMeshes = [];
    threeState.boundaryLineObjects = [];
    threeState.renderedWallKeys = new Set();
    threeState.renderedColumnKeys = new Set();
    threeState.labelItems = [];
    threeState.floorLabelItems = [];
    els.label3dLayer.innerHTML = '';
    els.stackPopup.style.display = 'none';
    mark3DDirty();
  }

  function disposeObject(obj) {
    obj.traverse?.(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
        else child.material.dispose?.();
      }
    });
  }


  function roundForTypicalSignature(value, increment = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const step = Number(increment) || 1;
    return Math.round(n / step) * step;
  }

  function floorAreaBounds3D(floor) {
    const xs = [];
    const zs = [];
    for (const area of floor?.areas || []) {
      prepareAreaGeometryCache(area);
      for (const loop of (area._cleanLoops || [])) {
        for (const pt of loop) {
          xs.push(toNum(pt.x));
          zs.push(-toNum(pt.y));
        }
      }
    }
    if (!xs.length) return floorBounds3D(floor);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }


  function floorPerimeterFootprintFromBounds(bounds) {
    if (!bounds) return [];
    const minX = toNum(bounds.minX);
    const maxX = toNum(bounds.maxX);
    const minRevitY = -toNum(bounds.maxZ);
    const maxRevitY = -toNum(bounds.minZ);
    if (![minX, maxX, minRevitY, maxRevitY].every(Number.isFinite)) return [];
    if (Math.abs(maxX - minX) < 1e-6 || Math.abs(maxRevitY - minRevitY) < 1e-6) return [];
    return [
      { x: minX, y: minRevitY, z: 0 },
      { x: maxX, y: minRevitY, z: 0 },
      { x: maxX, y: maxRevitY, z: 0 },
      { x: minX, y: maxRevitY, z: 0 },
      { x: minX, y: minRevitY, z: 0 }
    ];
  }

  function floorPerimeterFootprint(floor) {
    return floorPerimeterFootprintFromBounds(floorAreaBounds3D(floor));
  }

  function makePolyline3DFromFootprint(footprint, y, color = '#111111', opacity = 0.95) {
    const pts = (footprint || []).map(pt => pointXYZ(pt)).filter(Boolean);
    if (pts.length < 3 || !Number.isFinite(y)) return null;
    const closed = pts.slice();
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) closed.push(first);
    const points = closed.map(pt => revitPointTo3D(pt, y));
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const lineOpacity = clampOpacity(opacity, 0.95);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: !isOpaque(lineOpacity),
      opacity: lineOpacity,
      linewidth: 1
    });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 45;
    line.userData = { kind: 'floorPerimeter', baseColor: color };
    return line;
  }

  function addFloorPerimeterLine3D(parentGroup, floor, y, options = {}) {
    if (!parentGroup || !floor) return null;
    const footprint = options.footprint || floorPerimeterFootprint(floor);
    const color = options.color || state.styleSettings.boundaryLineColor || '#111111';
    const line = makePolyline3DFromFootprint(footprint, y, color, options.opacity ?? 0.95);
    if (!line) return null;
    line.userData = {
      ...line.userData,
      floor,
      typicalGroup: options.typicalGroup || null,
      kind: 'floorPerimeter',
      source: options.source || 'floor_area_bounds'
    };
    parentGroup.add(line);
    return line;
  }

  function addTypicalGroupPerimeterLines3D(parentGroup, group) {
    if (!parentGroup || !group?.floors?.length) return;
    const footprint = typicalGroupFootprint(group);
    if (!footprint || footprint.length < 4) return;

    const seenY = new Set();
    const sortedFloors = group.floors
      .slice()
      .sort((a, b) => toNum(a.heightFt, 0) - toNum(b.heightFt, 0));

    for (const floor of sortedFloors) {
      const y = Number.isFinite(toNum(floor.y3D, NaN))
        ? toNum(floor.y3D, NaN)
        : toNum(floor.heightFt, 0) * state.zScale;
      if (!Number.isFinite(y)) continue;

      // Avoid duplicate outlines when Revit has coincident levels or copied data.
      const key = Math.round(y * 1000) / 1000;
      if (seenY.has(key)) continue;
      seenY.add(key);

      addFloorPerimeterLine3D(parentGroup, floor, y + 0.3, {
        typicalGroup: group,
        footprint,
        source: 'typical_group_floor_perimeter',
        opacity: 0.95
      });
    }
  }

  function floorTypicalFootprintSignature(floor) {
    const b = floorAreaBounds3D(floor);
    if (!b) return '';

    // Typical-floor grouping is intentionally based on the Revit plan footprint,
    // not room/unit names. Unit mix can change while the structural/area-floor
    // outline is still a repeated typical floor. Round to the nearest foot to
    // absorb tiny Revit/modeling noise without grouping obviously different floors.
    const categoryParts = [];
    for (const area of floor.areas || []) {
      const pt = getAreaAnchorPoint(area) || { x: 0, y: 0 };
      categoryParts.push([
        normalizeAreaColorKey(areaCategory(area)),
        String(area?.name || area?.area_name || area?.area_type || '').toUpperCase(),
        Math.round(areaSqFt(area)),
        Math.round((toNum(pt.x) - b.minX) * 2) / 2,
        Math.round((toNum(pt.y) + b.maxZ) * 2) / 2
      ].join(':'));
    }
    categoryParts.sort();
    return [
      'fallback-v2',
      roundForTypicalSignature(b.minX, 1),
      roundForTypicalSignature(b.maxX, 1),
      roundForTypicalSignature(b.minZ, 1),
      roundForTypicalSignature(b.maxZ, 1),
      categoryParts.join(';')
    ].join('|');
  }

  function medianNumber(values, fallback = 12) {
    const clean = (values || []).map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (!clean.length) return fallback;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  }

  function dominantAverageCategoryForTypicalGroup(floors) {
    const totals = new Map();
    const counts = new Map();
    for (const floor of floors || []) {
      const perFloor = new Map();
      for (const area of floor.areas || []) {
        const cat = areaCategory(area);
        perFloor.set(cat, (perFloor.get(cat) || 0) + areaSqFt(area));
      }
      for (const [cat, sf] of perFloor.entries()) {
        totals.set(cat, (totals.get(cat) || 0) + sf);
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
    }
    let bestCat = 'Uncategorized';
    let bestAvg = -Infinity;
    for (const [cat, total] of totals.entries()) {
      const avg = total / Math.max(1, counts.get(cat) || 1);
      if (avg > bestAvg) {
        bestAvg = avg;
        bestCat = cat;
      }
    }
    return bestCat;
  }

  const TYPICAL_TOWER_AREA_CATEGORIES = new Set([
    'BRANDED RESIDENTIAL',
    'SHORT TERM RENTAL (STR)',
    'HOTEL',
    'OFFICE'
  ]);

  function isTowerTypicalCategory(category) {
    return TYPICAL_TOWER_AREA_CATEGORIES.has(normalizeAreaColorKey(category));
  }

  function typicalGroupLowestHeight(group) {
    return toNum(group?.baseFloor?.heightFt, 0);
  }

  function typicalGroupHighestHeight(group) {
    const topHeight = toNum(group?.topFloor?.heightFt, 0);
    const floorToFloor = toNum(group?.floorToFloorFt, 12);
    return topHeight + floorToFloor;
  }

  function chooseRepresentativeTypicalFloor(sortedFloors, centerHeightFt) {
    let bestFloor = sortedFloors?.[0] || null;
    let bestDistance = Infinity;
    for (const floor of sortedFloors || []) {
      const d = Math.abs(toNum(floor.heightFt, 0) - centerHeightFt);
      if (d < bestDistance) {
        bestDistance = d;
        bestFloor = floor;
      }
    }
    return bestFloor;
  }

  function shouldKeepTypicalGroupBox(group, towerStartHeightFt) {
    if (!group || !group.floors || group.floors.length < 2) return false;

    // Podium plates often repeat parking / amenity / deck footprints, but they should
    // stay as individual stack floors instead of becoming large simplified boxes.
    // Group only tower-like repeated area programs, then start grouping at the first
    // meaningful repeated tower run.
    if (!isTowerTypicalCategory(group.dominantCategory)) return false;

    const baseHeight = typicalGroupLowestHeight(group);
    if (Number.isFinite(towerStartHeightFt) && baseHeight < towerStartHeightFt - 0.1) return false;

    return true;
  }

  function applyTypicalGroupRoles(groups) {
    for (const group of groups || []) {
      for (const floor of group.floors || []) {
        floor._typicalSignature = group.signature;
        floor._typicalGroup = group;
        floor._typicalGroupRole = 'hidden';
      }
      if (group.representativeFloor) group.representativeFloor._typicalRepresentative = true;
    }
  }

  function clearTypicalFloorRoles(floors) {
    for (const floor of floors || []) {
      delete floor._typicalSignature;
      delete floor._typicalGroup;
      delete floor._typicalGroupRole;
      delete floor._typicalRepresentative;
    }
  }

  function makeTypicalGroupFromRun(signature, run, groupIndex) {
    if (!signature || !Array.isArray(run) || run.length < 2) return null;
    const sorted = run.slice().sort((a, b) => toNum(a.heightFt, 0) - toNum(b.heightFt, 0));
    const baseFloor = sorted[0];
    const topFloor = sorted[sorted.length - 1];
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = toNum(sorted[i].heightFt, NaN) - toNum(sorted[i - 1].heightFt, NaN);
      if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
    }
    const floorToFloorFt = medianNumber(gaps, 12);
    const dominantCategory = dominantAverageCategoryForTypicalGroup(sorted);
    const centerHeightFt = (toNum(baseFloor.heightFt, 0) + toNum(topFloor.heightFt, 0) + floorToFloorFt) / 2;
    const representativeFloor = chooseRepresentativeTypicalFloor(sorted, centerHeightFt);
    return {
      id: `typical-${groupIndex}`,
      signature,
      floors: sorted,
      baseFloor,
      topFloor,
      floorToFloorFt,
      centerHeightFt,
      representativeFloor,
      dominantCategory,
      color: getAreaFillColor({ area_category: dominantCategory })
    };
  }

  function buildExplicitTypicalFloorGroups(floors) {
    const rawGroups = Array.isArray(state.loadedJson?.derived?.typical_floor_groups)
      ? state.loadedJson.derived.typical_floor_groups
      : [];
    if (!rawGroups.length) return [];

    const floorByView = new Map();
    for (const floor of floors || []) {
      const viewId = String(floor?.workingViewId || floor?.viewId || floor?.json?.view_id || '');
      if (viewId) floorByView.set(viewId, floor);
    }

    const groups = [];
    for (const meta of rawGroups) {
      const groupFloors = (meta?.view_ids || []).map(id => floorByView.get(String(id))).filter(Boolean);
      if (groupFloors.length < 2) continue;
      const group = makeTypicalGroupFromRun(String(meta.signature || meta.group_id || ''), groupFloors, groups.length + 1);
      if (!group) continue;
      group.id = String(meta.group_id || `typical-${groups.length + 1}`);
      group.classification = String(meta.classification || 'authoritative_transformer');
      group.isAuthoritative = true;
      group.confidence = toNum(meta.confidence, 1);
      group.zone = String(meta.zone || '');
      group.groupingBasis = Array.isArray(meta.grouping_basis) ? meta.grouping_basis.slice() : [];
      group.dominantCategory = String(meta.dominant_category || group.dominantCategory || 'Uncategorized');
      group.floorToFloorFt = toNum(meta.floor_to_floor_ft, group.floorToFloorFt);
      group.representativeFloor = floorByView.get(String(meta.representative_view_id || '')) || group.representativeFloor;
      group.color = getAreaFillColor({ area_category: group.dominantCategory });
      groups.push(group);
    }
    groups.sort((a, b) => typicalGroupLowestHeight(a) - typicalGroupLowestHeight(b));
    return groups;
  }

  function buildTypicalFloorGroups(floors) {
    clearTypicalFloorRoles(floors);
    if (!state.typicalFloorGroupingEnabled) return [];

    const explicitGroups = buildExplicitTypicalFloorGroups(floors);
    if (explicitGroups.length) {
      applyTypicalGroupRoles(explicitGroups);
      return explicitGroups;
    }

    const bySignature = new Map();
    for (const floor of floors || []) {
      const signature = floorTypicalFootprintSignature(floor);
      if (!signature) continue;
      if (!bySignature.has(signature)) bySignature.set(signature, []);
      bySignature.get(signature).push(floor);
    }

    const candidateGroups = [];
    for (const [signature, items] of bySignature.entries()) {
      if (items.length < 2) continue;
      const sorted = items.slice().sort((a, b) => toNum(a.heightFt, 0) - toNum(b.heightFt, 0));
      const allGaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const gap = toNum(sorted[i].heightFt, NaN) - toNum(sorted[i - 1].heightFt, NaN);
        if (Number.isFinite(gap) && gap > 0) allGaps.push(gap);
      }
      const typicalGap = medianNumber(allGaps, 12);
      const maxContinuousGap = Math.max(typicalGap * 1.8, typicalGap + 6, 18);
      let run = [];
      for (let i = 0; i < sorted.length; i++) {
        const floor = sorted[i];
        if (!run.length) {
          run.push(floor);
          continue;
        }
        const previous = run[run.length - 1];
        const gap = toNum(floor.heightFt, NaN) - toNum(previous.heightFt, NaN);
        if (Number.isFinite(gap) && gap > 0 && gap <= maxContinuousGap) {
          run.push(floor);
        } else {
          const group = makeTypicalGroupFromRun(signature, run, candidateGroups.length + 1);
          if (group) candidateGroups.push(group);
          run = [floor];
        }
      }
      const group = makeTypicalGroupFromRun(signature, run, candidateGroups.length + 1);
      if (group) candidateGroups.push(group);
    }

    candidateGroups.sort((a, b) => typicalGroupLowestHeight(a) - typicalGroupLowestHeight(b));

    const towerStartGroup = candidateGroups.find(group =>
      group.floors.length >= 3 && isTowerTypicalCategory(group.dominantCategory)
    );
    const towerStartHeightFt = towerStartGroup ? typicalGroupLowestHeight(towerStartGroup) : -Infinity;

    const groups = candidateGroups
      .filter(group => shouldKeepTypicalGroupBox(group, towerStartHeightFt))
      .sort((a, b) => typicalGroupLowestHeight(a) - typicalGroupLowestHeight(b));

    groups.forEach((group, index) => { group.id = `typical-${index + 1}`; });
    applyTypicalGroupRoles(groups);
    return groups;
  }

  function typicalGroupTopY(group) {
    const topHeight = toNum(group?.topFloor?.heightFt, 0);
    const floorToFloor = toNum(group?.floorToFloorFt, 12);
    return (topHeight + floorToFloor) * state.zScale;
  }

  function typicalGroupFootprint(group) {
    const b = floorAreaBounds3D(group?.baseFloor);
    if (!b) return [];
    const minRevitY = -b.maxZ;
    const maxRevitY = -b.minZ;
    return [
      { x: b.minX, y: minRevitY, z: 0 },
      { x: b.maxX, y: minRevitY, z: 0 },
      { x: b.maxX, y: maxRevitY, z: 0 },
      { x: b.minX, y: maxRevitY, z: 0 },
      { x: b.minX, y: minRevitY, z: 0 }
    ];
  }

  function typicalGroupCenterY(group) {
    const baseY = toNum(group?.baseFloor?.y3D, 0);
    const topY = typicalGroupTopY(group);
    if (!Number.isFinite(baseY) || !Number.isFinite(topY)) return baseY;
    return (baseY + topY) / 2;
  }

  function areaTo3DLabelPositionAtY(area, y) {
    const pt = getAreaAnchorPoint(area) || { x: 0, y: 0 };
    return new THREE.Vector3(toNum(pt.x), y + 0.6, -toNum(pt.y));
  }

  function parseFloorLabelParts(floor) {
    const raw = String(floor?.levelName || floor?.name || '').trim();
    const prefixMatch = raw.match(/^\s*([A-Z])\s*-\s*LEVEL\b/i);
    const levelMatch = raw.match(/\bLEVEL\s*([A-Z0-9]+)\b/i);
    const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';
    const level = levelMatch ? levelMatch[1].toUpperCase() : '';
    const clean = raw
      .replace(/\s+-\s+[-+]?\d[\d,]*(?:\.\d+)?\s*(?:'|FT|FEET)?.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      raw,
      prefix,
      level,
      clean: clean || raw
    };
  }

  function typicalGroupLabelText(group) {
    const base = parseFloorLabelParts(group?.baseFloor);
    const top = parseFloorLabelParts(group?.topFloor);
    if (base.level && top.level) {
      if (base.prefix && base.prefix === top.prefix) return `${base.prefix} LEVELS ${base.level} - ${top.level}`;
      return `LEVELS ${base.prefix ? `${base.prefix} ` : ''}${base.level} - ${top.prefix ? `${top.prefix} ` : ''}${top.level}`;
    }
    if (base.clean && top.clean && base.clean !== top.clean) return `LEVELS ${base.clean} - ${top.clean}`;
    return base.clean || top.clean || 'Typical Levels';
  }

  function floorDatumLabelText(floor) {
    const parts = parseFloorLabelParts(floor);
    const raw = String(floor?.levelName || floor?.name || '').trim();
    const cleaned = raw
      .replace(/^\s*([A-Z])\s*-\s*/i, '$1. ')
      .replace(/\s+/g, ' ')
      .trim();
    return (cleaned || parts.clean || raw || 'Level').toUpperCase();
  }

  function floorDatumAnchorCandidates(box, y) {
    if (!box) return [];
    const midX = (box.minX + box.maxX) / 2;
    const midZ = (box.minZ + box.maxZ) / 2;
    return [
      new THREE.Vector3(box.minX, y, box.minZ),
      new THREE.Vector3(box.minX, y, midZ),
      new THREE.Vector3(box.minX, y, box.maxZ),
      new THREE.Vector3(midX, y, box.minZ),
      new THREE.Vector3(midX, y, box.maxZ),
      new THREE.Vector3(box.maxX, y, box.minZ),
      new THREE.Vector3(box.maxX, y, midZ),
      new THREE.Vector3(box.maxX, y, box.maxZ)
    ];
  }

  function createDatumLabelElement(textContent, extraClass = '') {
    const el = document.createElement('div');
    el.className = `label3d floorLabel levelDatumLabel ${extraClass}`.trim();
    el.innerHTML = `
      <span class="datum-text">${escapeHTML(textContent)}</span>
    `;
    return el;
  }

  function addTypicalGroup3DLabel(group, renderY) {
    const floor = group?.representativeFloor || group?.baseFloor;
    if (!floor) return;
    const box = floorAreaBounds3D(floor) || floorBounds3D(floor);
    if (!box) return;

    const el = createDatumLabelElement(typicalGroupLabelText(group), 'typicalGroupLabel');
    els.label3dLayer.appendChild(el);
    const anchorX = (box.minX + box.maxX) / 2;
    const anchorZ = (box.minZ + box.maxZ) / 2;
    const anchorY = renderY + Math.max(0.8, Math.min(2.2, Math.abs(box.maxZ - box.minZ) * 0.01));
    threeState.floorLabelItems.push({
      el,
      position: new THREE.Vector3(anchorX, anchorY, anchorZ),
      anchor: new THREE.Vector3(anchorX, anchorY, anchorZ),
      anchorCandidates: floorDatumAnchorCandidates(box, anchorY),
      floor,
      area: null,
      typicalGroup: group,
      alwaysVisible: true,
      labelKind: 'typicalDatum'
    });
  }

  function renderTypicalFloorRepresentativePlan3D(group, parentGroup, renderY) {
    const floor = group?.representativeFloor;
    if (!floor || !parentGroup) return;

    const sliceGroup = new THREE.Group();
    sliceGroup.name = `${floor.name || 'Typical floor'} representative plan`;
    sliceGroup.userData = { kind: 'typicalFloorRepresentativePlan', group, floor };
    parentGroup.add(sliceGroup);

    for (const area of floor.areas || []) {
      if (isEditorDeleted('area', getEditorKey(area, floor, 'area'))) continue;
      const shape = makeShapeFromArea(area);
      if (!shape) continue;

      const style = getAreaStyle(area, '3d');
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      const areaOpacity = clampOpacity(style.fillOpacity ?? 1, 1);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(style.fillColor),
        transparent: !isOpaque(areaOpacity),
        opacity: areaOpacity,
        side: THREE.DoubleSide,
        depthWrite: isOpaque(areaOpacity)
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = renderY;
      mesh.renderOrder = 12;
      mesh.userData = {
        floor,
        area,
        typicalGroup: group,
        kind: 'area',
        editorKey: getEditorKey(area, floor, 'area'),
        baseFillColor: style.fillColor,
        baseOpacity: areaOpacity,
        labelPosition: areaTo3DLabelPositionAtY(area, renderY),
        outline: null
      };
      sliceGroup.add(mesh);
      threeState.areaMeshes.push(mesh);

      const outline = makeAreaOutline3D(area, renderY + 0.08, state.styleSettings.areaLineColor);
      if (outline) {
        outline.userData = { floor, area, typicalGroup: group, kind: 'areaOutline' };
        outline.visible = false;
        sliceGroup.add(outline);
        mesh.userData.outline = outline;
      }

      add3DLabel(floor, area, mesh.userData.labelPosition);
    }

    // Keep Revit area boundary lines available for editor hit-testing, but hide
    // them in the presentation stack. The visible 3D linework is simplified
    // to one clean outer perimeter per displayed floor/representative plan.
    for (const line of floor.boundaryLines || []) {
      if (isEditorDeleted('boundary', getEditorKey(line, floor, 'boundary'))) continue;
      const boundaryPoints = boundaryDisplayPoints(line);
      if (boundaryPoints.length < 2) continue;
      const geom = new THREE.BufferGeometry().setFromPoints(boundaryPoints.map(pt => revitPointTo3D(pt, renderY + 0.18)));
      const mat = new THREE.LineBasicMaterial({
        color: state.styleSettings.boundaryLineColor,
        transparent: true,
        opacity: 0.95
      });
      const lineObj = new THREE.Line(geom, mat);
      lineObj.userData = { floor, line, typicalGroup: group, kind: 'boundary', editorKey: getEditorKey(line, floor, 'boundary'), baseColor: state.styleSettings.boundaryLineColor };
      lineObj.visible = false;
      sliceGroup.add(lineObj);
      threeState.boundaryLineObjects.push(lineObj);
    }

    addFloorPerimeterLine3D(sliceGroup, floor, renderY + 0.28, {
      typicalGroup: group,
      footprint: typicalGroupFootprint(group),
      source: 'typical_group_footprint'
    });
  }

  function renderTypicalFloorGroup3D(group) {
    if (!group?.floors?.length || !threeState.worldGroup) return;
    const footprint = typicalGroupFootprint(group);
    if (footprint.length < 4) return;

    const baseY = toNum(group.baseFloor.y3D, 0) + 0.03;
    const topY = typicalGroupTopY(group);
    if (!Number.isFinite(baseY) || !Number.isFinite(topY) || Math.abs(topY - baseY) < 0.01) return;

    let geom = null;
    try {
      geom = makeExtrudedFootprintGeometry(footprint, baseY, topY);
    } catch (err) {
      console.warn('Skipped invalid typical floor group volume', group, err);
      return;
    }
    if (!geom) return;

    const typicalGroup = new THREE.Group();
    typicalGroup.name = `${group.baseFloor.levelName || group.baseFloor.name} to ${group.topFloor.levelName || group.topFloor.name}`;
    typicalGroup.userData = { kind: 'typicalFloorGroup', group };

    const volumeOpacity = 0.28;
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(group.color || '#d8e8f8'),
      transparent: true,
      opacity: volumeOpacity,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 2;
    mesh.userData = { kind: 'typicalFloorVolume', group, baseOpacity: volumeOpacity };
    typicalGroup.add(mesh);
    threeState.typicalGroupMeshes.push(mesh);

    const edgeGeom = new THREE.EdgesGeometry(geom);
    const edgeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(group.color || '#111111'),
      transparent: true,
      opacity: 0.55
    });
    const edges = new THREE.LineSegments(edgeGeom, edgeMat);
    edges.renderOrder = 3;
    edges.userData = { kind: 'typicalFloorVolumeEdge', group };
    typicalGroup.add(edges);

    // Show a clean outer perimeter at every actual floor elevation inside
    // the simplified typical-floor volume. Keep the repeated floor plans off;
    // only this perimeter line repeats so the tower reads as stacked levels.
    addTypicalGroupPerimeterLines3D(typicalGroup, group);

    // Do not draw the base and top floor plans for typical groups. Show one
    // representative plan at the center height of the box so the stack reads
    // as a clean extrusion with a single floor-plan reference.
    const representativeY = typicalGroupCenterY(group);
    renderTypicalFloorRepresentativePlan3D(group, typicalGroup, representativeY);
    // Typical floor groups always receive one grouped datum label.
    addTypicalGroup3DLabel(group, representativeY);

    threeState.worldGroup.add(typicalGroup);
  }

  function renderTypicalFloorGroupVolumes3D() {
    for (const group of state.typicalFloorGroups || []) {
      renderTypicalFloorGroup3D(group);
    }
  }

  function isRoofFloor(floor) {
    const text = `${floor?.levelName || ''} ${floor?.name || ''}`.toUpperCase();
    return /\bROOF\b/.test(text);
  }

  function floorsSelectedFor3DLevelLabels() {
    const floors = (state.floors || [])
      .slice()
      .sort((a, b) => toNum(a.heightFt, 0) - toNum(b.heightFt, 0));
    const selected = new Set();
    if (!floors.length) return selected;

    // Always label the lowest analytical Level.
    selected.add(floors[0]);

    // Label every Level whose name explicitly identifies it as a roof.
    for (const floor of floors) {
      if (isRoofFloor(floor)) selected.add(floor);
    }

    // The podium top is the highest non-typical Level below the first
    // typical tower group. This derives from the current project's actual
    // typical-group metadata rather than relying on a fixed Level number.
    const typicalStarts = (state.typicalFloorGroups || [])
      .map(group => toNum(group?.baseFloor?.heightFt, NaN))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (typicalStarts.length) {
      const firstTypicalStart = typicalStarts[0];
      const podiumCandidates = floors.filter(floor =>
        !floor._typicalGroup
        && !isRoofFloor(floor)
        && toNum(floor.heightFt, Number.POSITIVE_INFINITY) < firstTypicalStart - 0.01
      );
      if (podiumCandidates.length) {
        selected.add(podiumCandidates[podiumCandidates.length - 1]);
      }
    } else {
      // Conservative fallback for projects with no detected typical group:
      // use the highest non-roof Level below the upper third of the stack.
      const nonRoof = floors.filter(floor => !isRoofFloor(floor));
      if (nonRoof.length > 1) {
        const cutoffIndex = Math.max(0, Math.floor(nonRoof.length * 0.66) - 1);
        selected.add(nonRoof[cutoffIndex]);
      }
    }

    return selected;
  }

  function render3DStack(fit = true) {
    clear3DWorld();
    clearSelection(false);
    if (!state.floors.length) return;

    // Display vertical Y uses the true Revit level height.
    // Z scale is only a visualization multiplier; the actual height is always shown in the side panel.
    threeState.baseHeight = 0;
    threeState.renderedWallKeys = new Set();
    threeState.renderedColumnKeys = new Set();

    for (const floor of state.floors) {
      floor.y3D = Number.isFinite(floor.heightFt) ? floor.heightFt * state.zScale : 0;
    }

    state.typicalFloorGroups = buildTypicalFloorGroups(state.floors);
    state._floorsSelectedFor3DLevelLabels = floorsSelectedFor3DLevelLabels();
    renderTypicalFloorGroupVolumes3D();

    for (const floor of state.floors) {
      if (floor._typicalGroup) continue;
      renderFloor3D(floor);
    }

    threeState.bounds = compute3DBounds();

    // Establish the permanent default orbit base point from the complete
    // rendered 3D dataset. This is a viewer-only reference and is deliberately
    // independent of the Revit Project Base Point or any project's coordinates.
    const datasetCenter = getDatasetOrbitTarget();
    if (datasetCenter) {
      threeState.defaultOrbitTarget.copy(datasetCenter);
      if (!state.selected?.area) threeState.target.copy(threeState.defaultOrbitTarget);
    }

    add3DGridAndAxes();
    updateFloorControls();
    updateSummary();
    refreshVisibility();
    buildSelectableIndex();
    refreshEditorSelectionStyles();
    updateEditorPanel();
    if (fit) fit3DStack();
  }

  function shouldShowOverallFloorPerimeter3D(floor) {
    const towerStartHeights = (state.typicalFloorGroups || [])
      .map(group => typicalGroupLowestHeight(group))
      .filter(Number.isFinite);
    if (!towerStartHeights.length) return true;
    const firstTowerHeight = Math.min(...towerStartHeights);
    return toNum(floor?.heightFt, firstTowerHeight) >= firstTowerHeight - 0.1;
  }

  function renderFloor3D(floor) {
    const group = new THREE.Group();
    group.name = floor.name;
    group.userData = { floor, kind: 'floorGroup' };
    threeState.worldGroup.add(group);

    for (const area of floor.areas) {
      if (isEditorDeleted('area', getEditorKey(area, floor, 'area'))) continue;
      const shape = makeShapeFromArea(area);
      if (!shape) continue;
      const style = getAreaStyle(area, '3d');
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      const areaOpacity = clampOpacity(style.fillOpacity ?? 1, 1);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(style.fillColor),
        transparent: !isOpaque(areaOpacity),
        opacity: areaOpacity,
        side: THREE.DoubleSide,
        depthWrite: isOpaque(areaOpacity)
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = floor.y3D;
      mesh.renderOrder = 10;
      mesh.userData = {
        floor,
        area,
        kind: 'area',
        editorKey: getEditorKey(area, floor, 'area'),
        baseFillColor: style.fillColor,
        baseOpacity: areaOpacity,
        labelPosition: areaTo3DLabelPosition(floor, area),
        outline: null
      };
      group.add(mesh);
      threeState.areaMeshes.push(mesh);

      const outline = makeAreaOutline3D(area, floor.y3D + 0.08, state.styleSettings.areaLineColor);
      if (outline) {
        outline.userData = { floor, area, kind: 'areaOutline' };
        // Avoid double-line graphics: when Revit boundary_lines are visible, hide the generated area outline.
        // If Boundaries are turned off, the area outline becomes visible using the Area border color setting.
        outline.visible = false;
        group.add(outline);
        mesh.userData.outline = outline;
      }

      add3DLabel(floor, area, mesh.userData.labelPosition);
    }

    renderColumns3DForFloor(floor, group);
    renderWalls3DForFloor(floor, group);

    // Presentation stack linework: show one outer perimeter line per tower floor.
    // Podium floors remain readable from their area geometry without a large overall
    // bounding outline. Internal Revit Area Boundary Lines remain available for editor workflows.
    if (shouldShowOverallFloorPerimeter3D(floor)) {
      addFloorPerimeterLine3D(group, floor, floor.y3D + 0.28, { source: 'floor_area_bounds' });
    }

    for (const line of floor.boundaryLines) {
      if (isEditorDeleted('boundary', getEditorKey(line, floor, 'boundary'))) continue;
      const boundaryPoints = boundaryDisplayPoints(line);
      if (boundaryPoints.length < 2) continue;
      const geom = new THREE.BufferGeometry().setFromPoints(boundaryPoints.map(pt => revitPointTo3D(pt, floor.y3D + 0.18)));
      const mat = new THREE.LineBasicMaterial({ color: state.styleSettings.boundaryLineColor, transparent: true, opacity: 0.95 });
      const lineObj = new THREE.Line(geom, mat);
      lineObj.userData = { floor, line, kind: 'boundary', editorKey: getEditorKey(line, floor, 'boundary'), baseColor: state.styleSettings.boundaryLineColor };
      lineObj.visible = false;
      group.add(lineObj);
      threeState.boundaryLineObjects.push(lineObj);
    }

    // Render project Property Lines once, on the lowest Level only.
    // A dashed pattern is generated geometrically because WebGL LineBasicMaterial
    // does not provide reliable line width or dash rendering across browsers.
    if (isLowestFloor(floor)) {
      for (const line of getUniqueProjectPropertyLines()) {
        const points = propertyLineDisplayPoints(line, toNum(floor.heightFt, 0));
        if (points.length < 2) continue;
        const geom = new THREE.BufferGeometry().setFromPoints(
          points.map(pt => revitPointTo3D(pt, floor.y3D + 0.22))
        );
        const mat = new THREE.LineDashedMaterial({
          color: state.styleSettings.propertyLineColor,
          transparent: !isOpaque(objectOpacityForView('3d', 'propertyLines')),
          opacity: objectOpacityForView('3d', 'propertyLines'),
          dashSize: 8,
          gapSize: 5,
          scale: 1
        });
        const lineObj = new THREE.Line(geom, mat);
        lineObj.computeLineDistances();
        lineObj.renderOrder = 40;
        lineObj.userData = { floor, line, kind: 'propertyLine' };
        group.add(lineObj);
      }
    }

    // Label only key individual Levels: the lowest Level, the highest
    // podium Level, and any Level explicitly named as a roof.
    if (state._floorsSelectedFor3DLevelLabels?.has(floor)) {
      addFloor3DLabel(floor);
    }
  }

  function renderColumns3DForFloor(floor, group) {
    for (const column of floor.columns2d || []) {
      const footprint = columnFootprintPoints(column);
      if (footprint.length < 3) continue;

      const key = columnKey(column, floor);
      if (threeState.renderedColumnKeys.has(key)) continue;
      threeState.renderedColumnKeys.add(key);

      let geom = null;
      try {
        geom = makeExtrudedFootprintGeometry(footprint, columnBaseZFt(column, floor) * state.zScale, columnTopZFt(column, floor) * state.zScale);
      } catch (err) {
        console.warn('Skipped invalid structural column', column, err);
        continue;
      }
      if (!geom) continue;

      const columnGroup = new THREE.Group();
      columnGroup.name = column.name || column.type_name || 'Structural Column';
      columnGroup.userData = { floor, column, kind: 'column' };

      const columnOpacity = objectOpacityForView('3d', 'columns');
      const mat = new THREE.MeshLambertMaterial({
        color: state.styleSettings.columnFillColor,
        transparent: !isOpaque(columnOpacity),
        opacity: columnOpacity,
        side: THREE.DoubleSide,
        depthWrite: isOpaque(columnOpacity)
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 26;
      mesh.userData = { floor, column, kind: 'column', baseOpacity: columnOpacity };

      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({
        color: state.styleSettings.columnLineColor,
        transparent: true,
        opacity: 0.62
      });
      const edges = new THREE.LineSegments(edgeGeom, edgeMat);
      edges.userData = { floor, column, kind: 'column' };

      columnGroup.add(mesh);
      columnGroup.add(edges);
      columnGroup.visible = state.display3d.columns;
      group.add(columnGroup);
      threeState.columnMeshes.push(mesh);
    }
  }

  function makeExtrudedFootprintGeometry(footprint, baseY, topY) {
    const pts = (footprint || []).map(pt => new THREE.Vector2(toNum(pt.x), -toNum(pt.y)));
    if (pts.length < 3) return null;

    const y0 = Math.min(baseY, topY);
    const y1 = Math.max(baseY, topY);
    const n = pts.length;

    const positions = [];
    const indices = [];

    for (let i = 0; i < n; i++) {
      positions.push(pts[i].x, y0, pts[i].y);
    }
    for (let i = 0; i < n; i++) {
      positions.push(pts[i].x, y1, pts[i].y);
    }

    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const tri of tris) {
      indices.push(tri[0], tri[1], tri[2]); // bottom
      indices.push(n + tri[2], n + tri[1], n + tri[0]); // top reversed
    }

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const bi = i;
      const bj = j;
      const ti = n + i;
      const tj = n + j;
      indices.push(bi, ti, tj);
      indices.push(bi, tj, bj);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }

  function wallPasses3DStructuralFilter(wall) {
    const classification = safeObj(wall?.classification);
    if (typeof classification.render_in_3d === 'boolean') return classification.render_in_3d;

    // Legacy working JSON fallback. The transformer is authoritative when
    // render_in_3d is present; older files are evaluated from compacted
    // structural-core metadata using the same strict >16-inch rule.
    const structural = safeObj(classification.structural_core);
    const concreteCoreWidthFt = toNum(structural.concrete_structural_core_width_ft, 0);
    return concreteCoreWidthFt > (16 / 12);
  }

  function renderWalls3DForFloor(floor, group) {
    for (const wall of floor.walls2d || []) {
      if (!wallPasses3DStructuralFilter(wall)) continue;
      const pts = wallCenterlinePoints(wall);
      if (pts.length < 2) continue;

      const key = wallKey(wall, floor);
      if (threeState.renderedWallKeys.has(key)) continue;
      threeState.renderedWallKeys.add(key);

      const wallGroup = new THREE.Group();
      wallGroup.name = wall.name || wall.type_name || 'Wall';
      wallGroup.userData = { floor, wall, kind: 'wall' };

      const baseY = wallBaseZFt(wall, floor) * state.zScale;
      const topY = wallTopZFt(wall, floor) * state.zScale;
      const width = wallWidthFt(wall);

      for (let i = 0; i < pts.length - 1; i++) {
        let geom;
        try {
          geom = makeWallSegmentPrismGeometry(pts[i], pts[i + 1], width, baseY, topY);
        } catch (err) {
          console.warn('Skipped invalid wall segment', wall, err);
          continue;
        }
        if (!geom) continue;

        const wallOpacity = objectOpacityForView('3d', 'walls');
        const mat = new THREE.MeshLambertMaterial({
          color: state.styleSettings.wallFillColor,
          transparent: !isOpaque(wallOpacity),
          opacity: wallOpacity,
          side: THREE.DoubleSide,
          depthWrite: isOpaque(wallOpacity)
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.renderOrder = 30;
        mesh.userData = { floor, wall, kind: 'wall', baseOpacity: wallOpacity };

        const edgeGeom = new THREE.EdgesGeometry(geom);
        const edgeMat = new THREE.LineBasicMaterial({
          color: state.styleSettings.wallLineColor,
          transparent: true,
          opacity: 0.55
        });
        const edges = new THREE.LineSegments(edgeGeom, edgeMat);
        edges.userData = { floor, wall, kind: 'wall' };

        wallGroup.add(mesh);
        wallGroup.add(edges);
        threeState.wallMeshes.push(mesh);
      }

      if (wallGroup.children.length) {
        wallGroup.visible = state.display3d.walls;
        group.add(wallGroup);
      }
    }
  }

  function makeWallSegmentPrismGeometry(a, b, width, baseY, topY) {
    const dx = toNum(b.x) - toNum(a.x);
    const dy = toNum(b.y) - toNum(a.y);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) return null;

    const nx = -dy / len;
    const ny = dx / len;
    const hw = Math.max(width / 2, 0.01);

    const axL = toNum(a.x) + nx * hw;
    const ayL = toNum(a.y) + ny * hw;
    const axR = toNum(a.x) - nx * hw;
    const ayR = toNum(a.y) - ny * hw;
    const bxL = toNum(b.x) + nx * hw;
    const byL = toNum(b.y) + ny * hw;
    const bxR = toNum(b.x) - nx * hw;
    const byR = toNum(b.y) - ny * hw;

    const y0 = Math.min(baseY, topY);
    const y1 = Math.max(baseY, topY);

    const positions = new Float32Array([
      axL, y0, -ayL,
      axR, y0, -ayR,
      bxR, y0, -byR,
      bxL, y0, -byL,

      axL, y1, -ayL,
      axR, y1, -ayR,
      bxR, y1, -byR,
      bxL, y1, -byL
    ]);

    const indices = [
      0, 1, 2, 0, 2, 3,       // bottom
      4, 7, 6, 4, 6, 5,       // top cap
      0, 4, 5, 0, 5, 1,       // side A
      1, 5, 6, 1, 6, 2,       // side B
      2, 6, 7, 2, 7, 3,       // side C
      3, 7, 4, 3, 4, 0        // side D
    ];

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }

  function makeShapeFromArea(area) {
    prepareAreaGeometryCache(area);
    const loops = area?._cleanLoops || [];
    if (!loops.length || loops[0].length < 3) return null;

    const outer = loops[0].map(pt => new THREE.Vector2(toNum(pt.x), toNum(pt.y)));
    const shape = new THREE.Shape(outer);
    for (let i = 1; i < loops.length; i++) {
      const holePts = loops[i].map(pt => new THREE.Vector2(toNum(pt.x), toNum(pt.y)));
      if (holePts.length >= 3) shape.holes.push(new THREE.Path(holePts));
    }
    return shape;
  }

  function cleanLoop(loop) {
    const pts = loop.filter(Boolean).map(pt => pointXYZ(pt)).filter(Boolean);
    if (pts.length > 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) pts.pop();
    }
    return pts;
  }

  function makeAreaOutline3D(area, y, color) {
    const group = new THREE.Group();
    let hasLines = false;
    prepareAreaGeometryCache(area);
    for (const pts of (area._cleanLoops || [])) {
      if (pts.length < 2) continue;
      const points = pts.map(pt => revitPointTo3D(pt, y));
      points.push(revitPointTo3D(pts[0], y));
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
      group.add(new THREE.Line(geom, mat));
      hasLines = true;
    }
    return hasLines ? group : null;
  }

  function revitPointTo3D(pt, yOverride) {
    const p = pointXYZ(pt, { x: 0, y: 0, z: 0 });
    return new THREE.Vector3(toNum(p.x), yOverride, -toNum(p.y));
  }

  function areaTo3DLabelPosition(floor, area) {
    const pt = getAreaAnchorPoint(area) || { x: 0, y: 0 };
    return new THREE.Vector3(toNum(pt.x), floor.y3D + 0.6, -toNum(pt.y));
  }

  function add3DLabel(floor, area, position) {
    const el = document.createElement('div');
    el.className = 'label3d';
    el.innerHTML = `<div class="name">${escapeHTML(areaName(area))}</div>`;
    els.label3dLayer.appendChild(el);
    threeState.labelItems.push({ el, position, floor, area });
  }

  function addFloor3DLabel(floor) {
    const box = floorAreaBounds3D(floor) || floorBounds3D(floor);
    if (!box) return;
    const el = createDatumLabelElement(floorDatumLabelText(floor));
    els.label3dLayer.appendChild(el);
    const anchorX = (box.minX + box.maxX) / 2;
    const anchorZ = (box.minZ + box.maxZ) / 2;
    const anchorY = floor.y3D + 0.9;
    threeState.floorLabelItems.push({
      el,
      position: new THREE.Vector3(anchorX, anchorY, anchorZ),
      anchor: new THREE.Vector3(anchorX, anchorY, anchorZ),
      anchorCandidates: floorDatumAnchorCandidates(box, anchorY),
      floor,
      area: null,
      alwaysVisible: true,
      labelKind: 'floorDatum'
    });
  }

  function floorBounds3D(floor) {
    const xs = [];
    const zs = [];
    for (const area of floor.areas) {
      prepareAreaGeometryCache(area);
      for (const loop of (area._cleanLoops || [])) {
        for (const pt of loop) {
          xs.push(toNum(pt.x));
          zs.push(-toNum(pt.y));
        }
      }
    }
    for (const line of floor.boundaryLines) {
      const start = pointXYZ(line.start);
      const end = pointXYZ(line.end);
      if (start) { xs.push(toNum(start.x)); zs.push(-toNum(start.y)); }
      if (end) { xs.push(toNum(end.x)); zs.push(-toNum(end.y)); }
    }
    for (const wall of floor.walls2d || []) {
      const half = wallWidthFt(wall) / 2;
      for (const pt of wallCenterlinePoints(wall)) {
        xs.push(toNum(pt.x) - half, toNum(pt.x) + half);
        zs.push(-toNum(pt.y) - half, -toNum(pt.y) + half);
      }
    }
    for (const column of floor.columns2d || []) {
      for (const pt of columnFootprintPoints(column)) {
        xs.push(toNum(pt.x));
        zs.push(-toNum(pt.y));
      }
    }
    if (!xs.length) return null;
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }

  function compute3DBounds() {
    const xs = [];
    const ys = [];
    const zs = [];
    for (const floor of state.floors) {
      const b = floorBounds3D(floor);
      if (!b) continue;
      xs.push(b.minX, b.maxX);
      zs.push(b.minZ, b.maxZ);
      ys.push(floor.y3D);
      for (const wall of floor.walls2d || []) {
        ys.push(wallBaseZFt(wall, floor) * state.zScale, wallTopZFt(wall, floor) * state.zScale);
      }
      for (const column of floor.columns2d || []) {
        ys.push(columnBaseZFt(column, floor) * state.zScale, columnTopZFt(column, floor) * state.zScale);
      }
    }
    for (const group of state.typicalFloorGroups || []) {
      if (Number.isFinite(group?.baseFloor?.y3D)) ys.push(group.baseFloor.y3D);
      const topY = typicalGroupTopY(group);
      if (Number.isFinite(topY)) ys.push(topY);
    }
    if (!xs.length) return { min: new THREE.Vector3(-50, 0, -50), max: new THREE.Vector3(50, 1, 50) };
    return {
      min: new THREE.Vector3(Math.min(...xs), Math.min(...ys), Math.min(...zs)),
      max: new THREE.Vector3(Math.max(...xs), Math.max(...ys), Math.max(...zs))
    };
  }

  function add3DGridAndAxes() {
    if (!threeState.bounds) return;
    const b = threeState.bounds;
    const sizeX = b.max.x - b.min.x;
    const sizeZ = b.max.z - b.min.z;
    const size = Math.max(sizeX, sizeZ, 100);
    const centerX = (b.min.x + b.max.x) / 2;
    const centerZ = (b.min.z + b.max.z) / 2;

    const grid = new THREE.GridHelper(size * 1.25, 30, 0xcfcac0, 0xeeeeea);
    grid.position.set(centerX, 0, centerZ);
    grid.material.transparent = true;
    grid.material.opacity = 0.36;
    grid.userData = { kind: 'helper' };
    threeState.worldGroup.add(grid);
  }

  function getLowestFloorForOrbit() {
    const floors = (state.floors || [])
      .filter(f => Number.isFinite(f.heightFt))
      .slice()
      .sort((a, b) => a.heightFt - b.heightFt);
    return floors[0] || state.floors[0] || null;
  }

  function loopCentroidAndArea2D(loop) {
    const points = (loop || []).map(pointXYZ).filter(Boolean);
    if (points.length < 3) return null;

    let crossSum = 0;
    let centroidXSum = 0;
    let centroidYSum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const cross = a.x * b.y - b.x * a.y;
      crossSum += cross;
      centroidXSum += (a.x + b.x) * cross;
      centroidYSum += (a.y + b.y) * cross;
    }

    if (Math.abs(crossSum) < 1e-9) return null;
    return {
      x: centroidXSum / (3 * crossSum),
      y: centroidYSum / (3 * crossSum),
      signedArea: crossSum / 2
    };
  }

  function areaPlanarCentroid(area) {
    prepareAreaGeometryCache(area);
    const loops = area?._cleanLoops || [];
    let weightedX = 0;
    let weightedY = 0;
    let netArea = 0;

    for (let i = 0; i < loops.length; i++) {
      const result = loopCentroidAndArea2D(loops[i]);
      if (!result) continue;
      const weight = (i === 0 ? 1 : -1) * Math.abs(result.signedArea);
      weightedX += result.x * weight;
      weightedY += result.y * weight;
      netArea += weight;
    }

    if (Math.abs(netArea) > 1e-9) {
      return { x: weightedX / netArea, y: weightedY / netArea, areaFt2: Math.abs(netArea) };
    }

    const fallback = getAreaAnchorPoint(area);
    if (fallback) return { x: fallback.x, y: fallback.y, areaFt2: Math.max(areaSqFt(area), 1) };
    const box = getAreaBox(area);
    return {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
      areaFt2: Math.max(areaSqFt(area), 1)
    };
  }

  function floorPlanarCentroid(floor) {
    if (!floor) return null;
    let weightedX = 0;
    let weightedY = 0;
    let totalArea = 0;

    for (const area of floor.areas || []) {
      if (isEditorDeleted('area', getEditorKey(area, floor, 'area'))) continue;
      const result = areaPlanarCentroid(area);
      if (!result || !Number.isFinite(result.areaFt2) || result.areaFt2 <= 0) continue;
      weightedX += result.x * result.areaFt2;
      weightedY += result.y * result.areaFt2;
      totalArea += result.areaFt2;
    }

    if (totalArea > 1e-9) return { x: weightedX / totalArea, y: weightedY / totalArea };

    const bounds = floorBounds3D(floor);
    if (!bounds) return null;
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: -(bounds.minZ + bounds.maxZ) / 2
    };
  }

  function getDatasetOrbitTarget() {
    const bounds = threeState.bounds;
    if (!bounds?.min || !bounds?.max) return null;
    return new THREE.Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
  }

  function getLowestFloorOrbitTarget() {
    const floor = getLowestFloorForOrbit();
    if (!floor) return null;

    const centroid = floorPlanarCentroid(floor);
    if (!centroid) return null;

    // View-only orbit reference. This does not change the Revit origin,
    // Project Base Point, coordinates, geometry, or any JSON data.
    return new THREE.Vector3(
      centroid.x,
      Number.isFinite(floor.y3D) ? floor.y3D : 0,
      -centroid.y
    );
  }

  function getAreaOrbitTarget(floor, area, mesh = null) {
    if (!floor || !area) return null;
    const centroid = areaPlanarCentroid(area);
    if (!centroid) return null;

    let orbitY = Number.isFinite(floor.y3D) ? floor.y3D : 0;
    if (mesh?.getWorldPosition) {
      const worldPosition = new THREE.Vector3();
      mesh.getWorldPosition(worldPosition);
      if (Number.isFinite(worldPosition.y)) orbitY = worldPosition.y;
    }

    return new THREE.Vector3(centroid.x, orbitY, -centroid.y);
  }

  function getSelectedAreaOrbitTarget() {
    const selected = state.selected;
    if (!selected?.floor || !selected?.area) return null;
    const mesh = selected.mesh || find3DMeshForArea(selected.floor, selected.area);
    return getAreaOrbitTarget(selected.floor, selected.area, mesh);
  }

  function set3DOrbitTarget(target) {
    if (!target) return false;
    threeState.target.copy(target);
    if (threeState.camera) updateCamera();
    return true;
  }

  function focus3DOrbitOnArea(floor, area, mesh = null) {
    return set3DOrbitTarget(getAreaOrbitTarget(floor, area, mesh));
  }

  function restoreDefault3DOrbitTarget() {
    // Never derive the default from the most recently selected object.
    // Return to the cached center of the complete rendered dataset.
    if (threeState.defaultOrbitTarget) {
      return set3DOrbitTarget(threeState.defaultOrbitTarget.clone());
    }
    return set3DOrbitTarget(getDatasetOrbitTarget() || getLowestFloorOrbitTarget());
  }

  function maxDistanceToBoundsFromTarget(bounds, target) {
    if (!bounds || !target) return 80;
    const corners = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z)
    ];
    return Math.max(...corners.map(corner => corner.distanceTo(target)), 80);
  }

  function fit3DStack() {
    if (!state.floors.length || !threeState.bounds || !threeState.camera) return;
    const b = threeState.bounds;

    // Fit always frames the complete rendered level stack, regardless of the
    // active level or selected Area. The center comes from the actual 3D bounds,
    // so this works for projects located far from Revit 0,0 and for unequal towers.
    const target = getDatasetOrbitTarget()
      || new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
    threeState.defaultOrbitTarget.copy(target);
    threeState.target.copy(target);

    const size = new THREE.Vector3().subVectors(b.max, b.min);
    const radius = Math.max(size.length() * 0.5, 1);
    const verticalFov = THREE.MathUtils.degToRad(threeState.camera.fov || 42);
    const aspect = Math.max(threeState.camera.aspect || 1, 0.01);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const limitingFov = Math.max(0.10, Math.min(verticalFov, horizontalFov));
    const fitDistance = radius / Math.sin(limitingFov / 2);

    // Modest presentation margin keeps the full model clear of pane controls.
    threeState.cameraDistance = clamp(fitDistance * 1.12, 20, 20000);
    updateCamera();
  }

  function fit3DStackAfterLayout() {
    const run = () => {
      resize3D();
      fit3DStack();
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 120);
  }

  function zoom3DByFactor(factor) {
    if (!threeState.camera || !Number.isFinite(threeState.cameraDistance)) return;
    const safeFactor = Number.isFinite(Number(factor)) ? Number(factor) : 1;
    threeState.cameraDistance = clamp(threeState.cameraDistance * safeFactor, 20, 8000);
    updateCamera();
  }

  function set3DTopView() {
    if (!state.floors.length) return;
    threeState.azimuth = 0;
    threeState.elevation = Math.PI * 0.499;
    fit3DStack();
  }

  function set3DIsoView() {
    if (!state.floors.length) return;
    threeState.azimuth = Math.PI * 0.20;
    threeState.elevation = Math.PI * 0.24;
    fit3DStack();
  }

  function updateCamera() {
    const r = threeState.cameraDistance;
    const elev = threeState.elevation;
    const az = threeState.azimuth;
    const cosElev = Math.cos(elev);
    const x = threeState.target.x + r * cosElev * Math.sin(az);
    const y = threeState.target.y + r * Math.sin(elev);
    const z = threeState.target.z + r * cosElev * Math.cos(az);
    threeState.camera.position.set(x, y, z);
    threeState.camera.lookAt(threeState.target);
    mark3DDirty();
  }

  function resize3D() {
    if (!threeState.renderer) return;
    const rect = els.pane3d.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    threeState.viewportWidth = w;
    threeState.viewportHeight = h;
    threeState.renderer.setSize(w, h, false);
    threeState.camera.aspect = w / h;
    threeState.camera.updateProjectionMatrix();
    mark3DDirty();
  }

  function getCameraSignature() {
    if (!threeState.camera) return '';
    const pos = threeState.camera.position;
    const quat = threeState.camera.quaternion;
    return [
      pos.x.toFixed(3), pos.y.toFixed(3), pos.z.toFixed(3),
      quat.x.toFixed(4), quat.y.toFixed(4), quat.z.toFixed(4), quat.w.toFixed(4)
    ].join('|');
  }

  function mark3DDirty() {
    threeState.needsRender = true;
    threeState.needsLabelUpdate = true;
    threeState.needsPopupUpdate = true;
  }

  function animate3D() {
    requestAnimationFrame(animate3D);
    if (!threeState.ready) return;
    // Always render 3D (split screen: 3D is always visible)
    {
      const cameraSignature = getCameraSignature();
      const cameraChanged = cameraSignature !== threeState.lastCameraSignature;
      if (cameraChanged || threeState.needsLabelUpdate) update3DLabels();
      if (cameraChanged || threeState.needsPopupUpdate) update3DPopupPosition();
      if (cameraChanged || threeState.needsRender) {
        threeState.renderer.render(threeState.scene, threeState.camera);
        threeState.lastCameraSignature = cameraSignature;
        threeState.needsRender = false;
        threeState.needsLabelUpdate = false;
        threeState.needsPopupUpdate = false;
      }
    }
  }

  function projectedDatasetScreenBounds(w, h) {
    const bounds = threeState.bounds;
    if (!bounds?.min || !bounds?.max) {
      return { minX: w * 0.25, maxX: w * 0.75, minY: h * 0.20, maxY: h * 0.80, centerX: w * 0.5 };
    }
    const corners = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z)
    ];
    const pts = corners
      .map(point => point.clone().project(threeState.camera))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    if (!pts.length) return { minX: w * 0.25, maxX: w * 0.75, minY: h * 0.20, maxY: h * 0.80, centerX: w * 0.5 };
    const xs = pts.map(point => (point.x * 0.5 + 0.5) * w);
    const ys = pts.map(point => (-point.y * 0.5 + 0.5) * h);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2
    };
  }

  function layoutDatumLabels(items, w, h) {
    let leaderSvg = els.label3dLayer.querySelector('svg.level-datum-leaders');
    if (!leaderSvg) {
      leaderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      leaderSvg.setAttribute('class', 'level-datum-leaders');
      leaderSvg.setAttribute('aria-hidden', 'true');
      els.label3dLayer.prepend(leaderSvg);
    }
    leaderSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    leaderSvg.innerHTML = '';

    if (!items.length) return;

    const bounds = projectedDatasetScreenBounds(w, h);
    const margin = 10;
    const labelClearance = 24;
    const leftLaneX = clamp(bounds.minX - labelClearance, 115, Math.max(115, bounds.centerX - 55));
    const rightLaneX = clamp(bounds.maxX + labelClearance, Math.min(bounds.centerX + 55, w - 115), w - 115);

    const groups = { left: [], right: [] };

    for (const item of items) {
      const projectedCandidates = (item.anchorCandidates?.length
        ? item.anchorCandidates
        : [item.anchor]
      )
        .filter(Boolean)
        .map(world => {
          const p = world.clone().project(threeState.camera);
          return {
            world,
            x: (p.x * 0.5 + 0.5) * w,
            y: (-p.y * 0.5 + 0.5) * h,
            z: p.z
          };
        })
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.z > -1 && point.z < 1);

      if (!projectedCandidates.length) {
        item.el.style.display = 'none';
        continue;
      }

      const averageX = projectedCandidates.reduce((sum, point) => sum + point.x, 0) / projectedCandidates.length;
      const side = averageX < bounds.centerX ? 'left' : 'right';
      const edgePoint = projectedCandidates.reduce((best, point) => {
        if (!best) return point;
        return side === 'left'
          ? (point.x < best.x ? point : best)
          : (point.x > best.x ? point : best);
      }, null);

      item._anchorScreenX = edgePoint.x;
      item._anchorScreenY = edgePoint.y;
      item._side = side;
      item.el.dataset.side = side;
      item.el.style.display = 'block';
      groups[side].push(item);
    }

    const placeSide = (side, laneX) => {
      const arr = groups[side].sort((a, b) => a._anchorScreenY - b._anchorScreenY);
      if (!arr.length) return;

      const usableTop = Math.max(margin, bounds.minY - 12);
      const usableBottom = Math.min(h - margin, bounds.maxY + 12);
      const minGap = 3;

      // Start from the true projected level elevation, then resolve only
      // actual overlaps. This preserves level order and keeps labels close
      // to the correct perimeter instead of distributing them arbitrarily.
      for (const item of arr) {
        item._layoutHalf = Math.max((item.el.offsetHeight || 16) / 2, 7);
        item._layoutCenterY = clamp(
          item._anchorScreenY,
          usableTop + item._layoutHalf,
          usableBottom - item._layoutHalf
        );
      }

      // Forward pass.
      for (let i = 1; i < arr.length; i++) {
        const previous = arr[i - 1];
        const current = arr[i];
        const minimumY = previous._layoutCenterY + previous._layoutHalf + minGap + current._layoutHalf;
        if (current._layoutCenterY < minimumY) current._layoutCenterY = minimumY;
      }

      // Pull back upward if the bottom overflows.
      const last = arr[arr.length - 1];
      const overflow = (last._layoutCenterY + last._layoutHalf) - usableBottom;
      if (overflow > 0) {
        for (const item of arr) item._layoutCenterY -= overflow;
      }

      // Backward pass to preserve spacing after the correction.
      for (let i = arr.length - 2; i >= 0; i--) {
        const current = arr[i];
        const next = arr[i + 1];
        const maximumY = next._layoutCenterY - next._layoutHalf - minGap - current._layoutHalf;
        if (current._layoutCenterY > maximumY) current._layoutCenterY = maximumY;
      }

      // If the available screen height is still too tight, use a compact
      // ordered distribution inside the projected building height. The
      // leader line preserves the exact level association.
      const first = arr[0];
      if (first._layoutCenterY - first._layoutHalf < usableTop) {
        const totalHeight = arr.reduce((sum, item) => sum + item._layoutHalf * 2, 0);
        const available = Math.max(usableBottom - usableTop, totalHeight);
        const dynamicGap = arr.length > 1
          ? Math.max(1, (available - totalHeight) / (arr.length - 1))
          : 0;
        let cursor = usableTop;
        for (const item of arr) {
          item._layoutCenterY = cursor + item._layoutHalf;
          cursor += item._layoutHalf * 2 + dynamicGap;
        }
      }

      for (const item of arr) {
        const cameraDistance = threeState.camera.position.distanceTo(item.anchor);
        const scale = clamp(220 / cameraDistance, 0.76, 1.02);
        const lineEndX = laneX;
        const lineEndY = item._layoutCenterY;
        item.el.style.left = `${laneX}px`;
        item.el.style.top = `${item._layoutCenterY}px`;
        item.el.style.transform = side === 'left'
          ? `translate(-100%, -50%) scale(${scale})`
          : `translate(0, -50%) scale(${scale})`;
        item.el.style.opacity = '1';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${item._anchorScreenX.toFixed(1)} ${item._anchorScreenY.toFixed(1)} L ${lineEndX.toFixed(1)} ${lineEndY.toFixed(1)}`);
        leaderSvg.appendChild(path);
      }
    };

    placeSide('left', leftLaneX);
    placeSide('right', rightLaneX);
  }

  function hideAll3DLabels() {
    for (const item of threeState.labelItems) item.el.style.display = 'none';
    for (const item of threeState.floorLabelItems) item.el.style.display = 'none';
    const leaderSvg = els.label3dLayer.querySelector('svg.level-datum-leaders');
    if (leaderSvg) leaderSvg.innerHTML = '';
  }

  function update3DLabels() {
    if (threeState.dragging && threeState.dragMode === 'rotate') {
      hideAll3DLabels();
      return;
    }

    const w = threeState.viewportWidth || els.stack3d.clientWidth || 1;
    const h = threeState.viewportHeight || els.stack3d.clientHeight || 1;
    for (const item of threeState.labelItems) {
      if (!is3DLabelAllowed(item)) {
        item.el.style.display = 'none';
        continue;
      }
      const p = item.position.clone().project(threeState.camera);
      const visible = p.z > -1 && p.z < 1 && p.x > -1.15 && p.x < 1.15 && p.y > -1.15 && p.y < 1.15;
      item.el.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      item.el.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
      item.el.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
      const cameraDistance = threeState.camera.position.distanceTo(item.position);
      const scale = clamp(220 / cameraDistance, 0.55, 1.2);
      item.el.style.transform = `translate(-50%, -50%) scale(${scale})`;
      item.el.style.opacity = String(clamp(1.4 - cameraDistance / 900, 0.25, 1));
    }
    const visibleDatumItems = [];
    for (const item of threeState.floorLabelItems) {
      if (!is3DLabelAllowed(item)) {
        item.el.style.display = 'none';
        continue;
      }
      const anchor = item.anchor || item.position;
      if (!anchor) {
        item.el.style.display = 'none';
        continue;
      }
      const p = anchor.clone().project(threeState.camera);
      const visible = p.z > -1 && p.z < 1 && p.x > -1.35 && p.x < 1.35 && p.y > -1.15 && p.y < 1.15;
      item.el.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      visibleDatumItems.push(item);
    }
    layoutDatumLabels(visibleDatumItems, w, h);
  }

  function show3DPopup(floor, area, position) {
    hide3DPopup();
    showSelectionInfoFloat(floor, area);
  }

  function update3DPopupPosition() {
    if (els.stackPopup.style.display === 'none' || !els.stackPopup.dataset.worldX) return;
    const w = threeState.viewportWidth || els.stack3d.clientWidth || 1;
    const h = threeState.viewportHeight || els.stack3d.clientHeight || 1;
    const pos = new THREE.Vector3(
      toNum(els.stackPopup.dataset.worldX),
      toNum(els.stackPopup.dataset.worldY) + 2,
      toNum(els.stackPopup.dataset.worldZ)
    ).project(threeState.camera);
    const visible = pos.z > -1 && pos.z < 1;
    if (!visible) {
      els.stackPopup.style.display = 'none';
      return;
    }
    const x = (pos.x * 0.5 + 0.5) * w;
    const y = (-pos.y * 0.5 + 0.5) * h;
    const popupW = els.stackPopup.offsetWidth || 230;
    const popupH = els.stackPopup.offsetHeight || 90;
    const gap = 28;
    const placeRight = x < w * 0.56;
    let left = placeRight ? x + gap : x - popupW - gap;
    let top = y - popupH - gap;

    // Prefer above the selected area. If there is not enough room,
    // place below it. This keeps the info window from covering the
    // area/slice it is describing.
    if (top < 8) top = y + gap;

    els.stackPopup.style.left = `${clamp(left, 8, Math.max(8, w - popupW - 8))}px`;
    els.stackPopup.style.top = `${clamp(top, 8, Math.max(8, h - popupH - 8))}px`;
  }

  function updateZScaleUI() {
    const minScale = Math.max(1, Number(els.zScale.min || 1));
    const maxScale = Number(els.zScale.max || 8);
    state.zScale = clamp(toNum(els.zScale.value, 1), minScale, maxScale);
    els.zScale.value = String(state.zScale);
    els.zScaleValue.textContent = `${fmt(state.zScale, 2)}x`;
    if (els.zScaleStepDownBtn) els.zScaleStepDownBtn.disabled = state.zScale <= minScale + 0.001;
  }

  els.fileInput.addEventListener('change', e => loadFiles(e.target.files));
  els.mode2dBtn.addEventListener('click', () => switchMode('2d'));
  els.mode3dBtn.addEventListener('click', () => switchMode('3d'));
  els.floorSelect.addEventListener('change', e => handleFloorSelectorChange(e.target.value));
  els.fitBtn.addEventListener('click', () => { fit3DStack(); });
  els.zoom3dOutBtn.addEventListener('click', () => { zoom3DByFactor(1.18); });
  els.zoom3dInBtn.addEventListener('click', () => { zoom3DByFactor(1 / 1.18); });
  els.topBtn.addEventListener('click', () => { set3DTopView(); });
  els.isoBtn.addEventListener('click', () => { set3DIsoView(); });
  els.planZoomOutBtn.addEventListener('click', () => {
    map.setZoom(map.getZoom() - 0.25, { animate: true });
  });
  els.planFitBtn.addEventListener('click', () => { fitActiveFloorAfterLayout(); });
  els.planZoomInBtn.addEventListener('click', () => {
    map.setZoom(map.getZoom() + 0.25, { animate: true });
  });
  els.clearBtn.addEventListener('click', clearAll);

  document.addEventListener('click', e => {
    document.querySelectorAll('.pane-display-control[open]').forEach(menu => {
      if (!menu.contains(e.target)) menu.open = false;
    });
  });

  els.reportTabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    setSidebarTab(btn.dataset.tab);
  });
  els.settingsBtn.addEventListener('click', openSettingsModal);
  els.settingsCloseBtn.addEventListener('click', closeSettingsModal);
  els.settingsApplyBtn.addEventListener('click', applySettingsFromUI);
  els.settingsResetBtn.addEventListener('click', resetVisualSettings);
  els.settingsModal.addEventListener('click', e => { if (e.target === els.settingsModal) closeSettingsModal(); });
  els.setAreaOpacity.addEventListener('input', e => { els.setAreaOpacityValue.textContent = Number(e.target.value).toFixed(2); });
  els.setPropertyLineOpacity.addEventListener('input', e => { els.setPropertyLineOpacityValue.textContent = Number(e.target.value).toFixed(2); });
  els.setPropertyLineWeight.addEventListener('input', e => { els.setPropertyLineWeightValue.textContent = Number(e.target.value).toFixed(1); });
  els.setWallOpacity.addEventListener('input', e => { els.setWallOpacityValue.textContent = Number(e.target.value).toFixed(2); });
  els.setColumnOpacity.addEventListener('input', e => { els.setColumnOpacityValue.textContent = Number(e.target.value).toFixed(2); });

  function areaOpacityForView(target) {
    const group = state[`display${target}`];
    return clampOpacity(1 - clampOpacity(group?.areaTransparency ?? 0, 0), 1);
  }

  function syncAreaTransparencyControls(target) {
    const targets = target ? [target] : ['3d', '2d'];
    for (const name of targets) {
      const input = els[`areaTransparency${name}`];
      const valueEl = els[`areaTransparency${name}Value`];
      if (!input || !valueEl) continue;
      const value = clampOpacity(state[`display${name}`]?.areaTransparency ?? 0, 0);
      input.value = String(value);
      valueEl.textContent = `${Math.round(value * 100)}%`;
    }
  }

  function refresh2DAreaTransparency() {
    const floor = state.floors[state.activeIndex];
    if (!floor?.layers?.areas?.length) return;
    const opacity = areaOpacityForView('2d');
    for (const layer of floor.layers.areas) {
      if (!layer) continue;
      layer._baseStyle = { ...(layer._baseStyle || {}), fillOpacity: opacity };
      if (state.selected?.layer === layer || isEditorAreaSelected(layer._areaData)) continue;
      layer.setStyle({ fillOpacity: opacity });
    }
  }

  function refresh3DAreaTransparency() {
    const opacity = areaOpacityForView('3d');
    for (const mesh of threeState.areaMeshes) {
      if (!mesh?.material) continue;
      mesh.userData.baseOpacity = opacity;
      if (mesh === threeState.selectedMesh || isEditorAreaSelected(mesh.userData?.area)) continue;
      mesh.material.opacity = opacity;
      mesh.material.transparent = !isOpaque(opacity);
      mesh.material.depthWrite = isOpaque(opacity);
      mesh.material.needsUpdate = true;
    }
    mark3DDirty();
  }

  function wireAreaTransparencySliders() {
    document.querySelectorAll('[data-transparency-target]').forEach(input => {
      const target = input.dataset.transparencyTarget;
      syncAreaTransparencyControls(target);
      input.addEventListener('input', e => {
        const group = state[`display${target}`];
        if (!group) return;
        group.areaTransparency = clampOpacity(e.target.value, 0);
        syncAreaTransparencyControls(target);
        if (target === '2d') refresh2DAreaTransparency();
        if (target === '3d') refresh3DAreaTransparency();
      });
    });
  }


  function syncObjectTransparencyControls(target, key) {
    document.querySelectorAll('[data-object-transparency-target][data-object-transparency-key]').forEach(input => {
      const view = input.dataset.objectTransparencyTarget;
      const itemKey = input.dataset.objectTransparencyKey;
      if (target && view !== target) return;
      if (key && itemKey !== key) return;
      const value = objectTransparencyForView(view, itemKey);
      input.value = String(value);
      const valueEl = document.querySelector(`[data-object-transparency-value="${view}:${itemKey}"]`);
      if (valueEl) valueEl.textContent = `${Math.round(value * 100)}%`;
    });
  }

  function applyObjectTransparency(target, key, value) {
    const stateKey = objectTransparencyStateKey(key);
    const group = state[`display${target}`];
    if (!stateKey || !group) return;
    group[stateKey] = clampOpacity(value, key === 'columns' ? 0.85 : 0);
    syncObjectTransparencyControls(target, key);
    if (target === '2d') renderActiveFloor(false);
    if (target === '3d') render3DStack(false);
  }

  function wireObjectTransparencySliders() {
    document.querySelectorAll('[data-object-transparency-target][data-object-transparency-key]').forEach(input => {
      const target = input.dataset.objectTransparencyTarget;
      const key = input.dataset.objectTransparencyKey;
      input.addEventListener('input', e => applyObjectTransparency(target, key, e.target.value));
    });
    syncObjectTransparencyControls();
  }

  function syncPaneDisplayToggles() {
    document.querySelectorAll('[data-display-target][data-display-key]').forEach(input => {
      const target = input.dataset.displayTarget;
      const key = input.dataset.displayKey;
      if (!state[`display${target}`] || !(key in state[`display${target}`])) return;
      input.checked = !!state[`display${target}`][key];
    });
  }

  function wirePaneDisplayToggles() {
    syncPaneDisplayToggles();
    document.querySelectorAll('[data-display-target][data-display-key]').forEach(input => {
      const target = input.dataset.displayTarget;
      const key = input.dataset.displayKey;
      if (!state[`display${target}`] || !(key in state[`display${target}`])) return;
      input.checked = !!state[`display${target}`][key];
      input.addEventListener('change', e => {
        const group = state[`display${target}`];
        group[key] = e.target.checked;
        refreshVisibility();
      });
    });
  }
  wirePaneDisplayToggles();
  wireObjectTransparencySliders();
  wireAreaTransparencySliders();
  function setZScaleValue(value) {
    const min = Math.max(1, Number(els.zScale.min || 1));
    const max = Number(els.zScale.max || 8);
    const next = Math.min(max, Math.max(min, Math.round(Number(value) * 4) / 4));
    els.zScale.value = String(next);
    updateZScaleUI();
    render3DStack(false);
    // Do not auto-fit while changing Z scale. Keeping the camera stable makes
    // the vertical exaggeration feel dynamic instead of visually locked.
  }

  els.zScale.addEventListener('input', () => {
    updateZScaleUI();
    render3DStack(false);
    // Use the Fit button when you want to re-frame after changing Z scale.
  });
  if (els.zScaleStepUpBtn) els.zScaleStepUpBtn.addEventListener('click', () => setZScaleValue(toNum(els.zScale.value, 1) + 0.25));
  if (els.zScaleStepDownBtn) els.zScaleStepDownBtn.addEventListener('click', () => setZScaleValue(toNum(els.zScale.value, 1) - 0.25));
  if (els.zScaleResetBtn) els.zScaleResetBtn.addEventListener('click', () => setZScaleValue(1));

  els.floorList.addEventListener('click', e => {
    const row = e.target.closest('[data-selector-value]');
    if (!row) return;
    handleFloorSelectorChange(row.dataset.selectorValue);
  });

  ['dragenter', 'dragover'].forEach(type => {
    document.addEventListener(type, e => {
      e.preventDefault();
      els.dropOverlay.style.display = 'flex';
    });
  });
  ['dragleave', 'drop'].forEach(type => {
    document.addEventListener(type, e => {
      e.preventDefault();
      if (type === 'drop') loadFiles(e.dataTransfer.files);
      if (e.type === 'dragleave' && e.target !== document && e.clientX > 0 && e.clientY > 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight) return;
      els.dropOverlay.style.display = 'none';
    });
  });

  window.addEventListener('resize', () => {
    map.invalidateSize(false);
    resize3D();
  });

  function initPaneResizer() {
    const resizer = els.paneResizer;
    const pane3d = els.pane3d;
    const viewerWrap = els.viewerWrap;
    if (!resizer || !pane3d || !viewerWrap) return;

    const saved = Number(localStorage.getItem('areaViewerPane3dWidthPx') || 0);
    if (Number.isFinite(saved) && saved > 0) {
      requestAnimationFrame(() => {
        const wrapRect = viewerWrap.getBoundingClientRect();
        const minW = Math.min(150, Math.max(80, wrapRect.width * 0.18));
        const maxW = Math.max(minW, wrapRect.width - 150);
        const next = Math.max(minW, Math.min(maxW, saved));
        pane3d.style.width = `${next}px`;
        pane3d.style.flexBasis = 'auto';
        map.invalidateSize(false);
        resize3D();
      });
    }

    let startX = 0;
    let startWidth = 0;
    let isResizing = false;

    function applyResize(clientX) {
      const wrapRect = viewerWrap.getBoundingClientRect();
      const newWidth = startWidth + (clientX - startX);
      const minW = Math.min(150, Math.max(80, wrapRect.width * 0.18));
      const maxW = Math.max(minW, wrapRect.width - Math.min(220, Math.max(150, wrapRect.width * 0.22)));
      const next = Math.max(minW, Math.min(maxW, newWidth));
      pane3d.style.width = `${next}px`;
      pane3d.style.flexBasis = 'auto';
      map.invalidateSize(false);
      resize3D();
      return next;
    }

    resizer.addEventListener('mousedown', e => {
      isResizing = true;
      startX = e.clientX;
      startWidth = pane3d.getBoundingClientRect().width;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isResizing) return;
      applyResize(e.clientX);
    });

    document.addEventListener('mouseup', e => {
      if (!isResizing) return;
      const next = applyResize(e.clientX || startX);
      localStorage.setItem('areaViewerPane3dWidthPx', String(Math.round(next)));
      isResizing = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      map.invalidateSize(false);
      resize3D();
    });
  }

  function initSidebarResizer() {
    const resizer = els.sidebarResizer;
    const sidebar = els.sidebar;
    const app = document.querySelector('.app');
    if (!resizer || !sidebar || !app) return;

    let startX = 0;
    let startWidth = 0;
    let isResizing = false;

    resizer.addEventListener('mousedown', e => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isResizing) return;
      const appWidth = app.getBoundingClientRect().width;
      const minW = 280;
      const maxW = Math.min(680, Math.max(320, appWidth * 0.55));
      const newWidth = startWidth + (startX - e.clientX);
      app.style.setProperty('--sidebar-w', `${Math.max(minW, Math.min(maxW, newWidth))}px`);
      map.invalidateSize(false);
      resize3D();
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      map.invalidateSize(false);
      resize3D();
    });
  }
}
