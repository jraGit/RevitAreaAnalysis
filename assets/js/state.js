import { DEFAULT_REPORT_TAB_VISIBILITY, REVIT_BLUE } from './config.js';

// Factories preserve the original shared mutable object shapes.
export function createAppState() {
  return {
    mode: '3d',
    floors: [],
    activeIndex: -1,
    activeGroup: null,
    selected: null,
    panesReady: false,
    labelsVisible: true,
    boundariesVisible: true,
    propertyLinesVisible: true,
    wallsVisible: true,
    columnsVisible: true,
    display3d: { labels: true, boundaries: true, lines: true, propertyLines: true, walls: false, columns: false, areaTransparency: 0, lineTransparency: 0, typicalLineTransparency: 0.90, areaBoundaryTransparency: 0.15, propertyLineTransparency: 0, wallTransparency: 0.10, columnTransparency: 0.85 },
    display2d: { labels: true, boundaries: true, propertyLines: true, walls: true, columns: true, areaTransparency: 0, propertyLineTransparency: 0, wallTransparency: 0, columnTransparency: 0.5 },
    zScale: 1,
    reportTabVisibility: { ...DEFAULT_REPORT_TAB_VISIBILITY },
    labelBaseZoom: null,
    projectInfo: {},
    exportInfo: {},
    propertyLineExport: {},
    reportData: {},
    areaGroups: [],
    typicalFloorGroups: [],
    typicalFloorGroupingEnabled: true,
    importedAreaColorMap: {},
    styleSettings: {
      areaLineColor: REVIT_BLUE,
      boundaryLineColor: '#000000',
      propertyLineColor: '#ff0000',
      propertyLineOpacity: 1,
      propertyLineWeight: 2,
      areaFillOpacity: 1,
      wallFillColor: '#b6b6b6',
      wallLineColor: '#b6b6b6',
      wallOpacity: 1,
      wallFillOpacity2d: 1,
      columnFillColor: '#b6b6b6',
      columnLineColor: '#b6b6b6',
      columnOpacity: 0.15,
      columnFillOpacity2d: 0.15,
      areaColorMap: {}
    }
  };
}

export function createTwoDState() {
  return {
    middlePanning: false,
    lastPoint: null
  };
}

export function createThreeState(THREE) {
  return {
    ready: false,
    scene: null,
    camera: null,
    renderer: null,
    raycaster: null,
    pointer: new THREE.Vector2(),
    worldGroup: null,
    areaMeshes: [],
    wallMeshes: [],
    columnMeshes: [],
    typicalGroupMeshes: [],
    boundaryLineObjects: [],
    renderedWallKeys: new Set(),
    renderedColumnKeys: new Set(),
    labelItems: [],
    floorLabelItems: [],
    selectedMesh: null,
    bounds: null,
    baseHeight: 0,
    target: new THREE.Vector3(0, 0, 0),
    // Stable orbit base point: center of the complete rendered 3D dataset.
    // Area selection may temporarily replace target, but deselection and Fit
    // return to this project-independent whole-model center.
    defaultOrbitTarget: new THREE.Vector3(0, 0, 0),
    cameraDistance: 240,
    azimuth: Math.PI * 0.18,
    elevation: Math.PI * 0.24,
    viewportWidth: 0,
    viewportHeight: 0,
    lastCameraSignature: '',
    needsRender: true,
    needsLabelUpdate: true,
    needsPopupUpdate: true,
    dragging: false,
    dragButton: 0,
    dragStart: { x: 0, y: 0 },
    didMove: false,
    dragMode: null
  };
}
