// Centralized DOM references and additive presentation-state wiring.

export function getDomElements() {
  const els = {
    viewerWrap: document.getElementById('viewerWrap'),
    pane3d: document.getElementById('pane3d'),
    pane2d: document.getElementById('pane2d'),
    paneResizer: document.getElementById('paneResizer'),
    sidebar: document.getElementById('sidebar'),
    sidebarResizer: document.getElementById('sidebarResizer'),
    dropOverlay: document.getElementById('dropOverlay'),
    fileInput: document.getElementById('fileInput'),
    mode2dBtn: document.getElementById('mode2dBtn'),
    mode3dBtn: document.getElementById('mode3dBtn'),
    floorSelect: document.getElementById('floorSelect'),
    floorList: document.getElementById('floorList'),
    selectedInfo: document.getElementById('selectedInfo'),
    floorSummary: document.getElementById('floorSummary'),
    summaryPanel: document.getElementById('summaryPanel'),
    unitMixPanel: document.getElementById('unitMixPanel'),
    levelSummaryPanel: document.getElementById('levelSummaryPanel'),
    areaByCategoryPanel: document.getElementById('areaByCategoryPanel'),
    excludedExteriorAreasPanel: document.getElementById('excludedExteriorAreasPanel'),
    areaRegisterPanel: document.getElementById('areaRegisterPanel'),
    projectInfoPanel: document.getElementById('projectInfoPanel'),
    styleLegend: document.getElementById('styleLegend'),
    reportTabs: document.getElementById('reportTabs'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    settingsApplyBtn: document.getElementById('settingsApplyBtn'),
    settingsResetBtn: document.getElementById('settingsResetBtn'),
    setAreaLineColor: document.getElementById('setAreaLineColor'),
    setAreaOpacity: document.getElementById('setAreaOpacity'),
    setAreaOpacityValue: document.getElementById('setAreaOpacityValue'),
    setBoundaryLineColor: document.getElementById('setBoundaryLineColor'),
    setPropertyLineColor: document.getElementById('setPropertyLineColor'),
    setPropertyLineOpacity: document.getElementById('setPropertyLineOpacity'),
    setPropertyLineOpacityValue: document.getElementById('setPropertyLineOpacityValue'),
    setPropertyLineWeight: document.getElementById('setPropertyLineWeight'),
    setPropertyLineWeightValue: document.getElementById('setPropertyLineWeightValue'),
    setWallFillColor: document.getElementById('setWallFillColor'),
    setWallLineColor: document.getElementById('setWallLineColor'),
    setWallOpacity: document.getElementById('setWallOpacity'),
    setWallOpacityValue: document.getElementById('setWallOpacityValue'),
    setColumnFillColor: document.getElementById('setColumnFillColor'),
    setColumnLineColor: document.getElementById('setColumnLineColor'),
    setColumnOpacity: document.getElementById('setColumnOpacity'),
    setColumnOpacityValue: document.getElementById('setColumnOpacityValue'),
    areaGroupSettings: document.getElementById('areaGroupSettings'),
    labelsToggle: document.getElementById('labelsToggle'),
    boundariesToggle: document.getElementById('boundariesToggle'),
    propertyLinesToggle: document.getElementById('propertyLinesToggle'),
    wallsToggle: document.getElementById('wallsToggle'),
    columnsToggle: document.getElementById('columnsToggle'),
    fitBtn: document.getElementById('fitBtn'),
    zoom3dOutBtn: document.getElementById('zoom3dOutBtn'),
    zoom3dInBtn: document.getElementById('zoom3dInBtn'),
    topBtn: document.getElementById('topBtn'),
    isoBtn: document.getElementById('isoBtn'),
    planZoomOutBtn: document.getElementById('planZoomOutBtn'),
    planFitBtn: document.getElementById('planFitBtn'),
    planZoomInBtn: document.getElementById('planZoomInBtn'),
    clearBtn: document.getElementById('clearBtn'),
    zScale: document.getElementById('zScale'),
    zScaleValue: document.getElementById('zScaleValue'),
    zScaleStepUpBtn: document.getElementById('zScaleStepUpBtn'),
    zScaleStepDownBtn: document.getElementById('zScaleStepDownBtn'),
    zScaleResetBtn: document.getElementById('zScaleResetBtn'),
    areaTransparency3d: document.getElementById('areaTransparency3d'),
    areaTransparency3dValue: document.getElementById('areaTransparency3dValue'),
    areaTransparency2d: document.getElementById('areaTransparency2d'),
    areaTransparency2dValue: document.getElementById('areaTransparency2dValue'),
    sheetTitleDisplay: document.getElementById('sheetTitleDisplay'),
    stack3d: document.getElementById('stack3d'),
    label3dLayer: document.getElementById('label3dLayer'),
    stackPopup: document.getElementById('stackPopup'),
    selectionInfoFloat: document.getElementById('selectionInfoFloat'),
    developerToolsBtn: document.getElementById('developerToolsBtn'),
    editorToolbar: document.getElementById('editorToolbar'),
    editorSelectToolBtn: document.getElementById('editorSelectToolBtn'),
    editorLineToolBtn: document.getElementById('editorLineToolBtn'),
    editorRectangleToolBtn: document.getElementById('editorRectangleToolBtn'),
    editorCircleToolBtn: document.getElementById('editorCircleToolBtn'),
    editorMoveToolBtn: document.getElementById('editorMoveToolBtn'),
    editorToolbarStatus: document.getElementById('editorToolbarStatus'),
    editorModeBtn: document.getElementById('editorModeBtn'),
    editorPanel: document.getElementById('editorPanel'),
    editorPanelCloseBtn: document.getElementById('editorPanelCloseBtn'),
    editorModeToggle: document.getElementById('editorModeToggle'),
    editorSelectionMode: document.getElementById('editorSelectionMode'),
    editorShowDeleted: document.getElementById('editorShowDeleted'),
    editorSelectionBox: document.getElementById('editorSelectionBox'),
    editorProjectInput: document.getElementById('editorProjectInput'),
    editorDirtyState: document.getElementById('editorDirtyState'),
    selectedAreasCount: document.getElementById('selectedAreasCount'),
    selectedBoundaryCount: document.getElementById('selectedBoundaryCount'),
    selectedTotalCount: document.getElementById('selectedTotalCount'),
    changesetCount: document.getElementById('changesetCount'),
    editorClearSelectionBtn: document.getElementById('editorClearSelectionBtn'),
    editorDeleteBtn: document.getElementById('editorDeleteBtn'),
    editorUndoDeleteBtn: document.getElementById('editorUndoDeleteBtn'),
    editorSaveJsonBtn: document.getElementById('editorSaveJsonBtn'),
    editorExportTransformerBtn: document.getElementById('editorExportTransformerBtn'),
    editorValidationText: document.getElementById('editorValidationText'),
    setTabProject: document.getElementById('setTabProject'),
    setTabActiveFloor: document.getElementById('setTabActiveFloor'),
    setTabUnitMix: document.getElementById('setTabUnitMix'),
    setTabLevelSummary: document.getElementById('setTabLevelSummary'),
    setTabAreaByCategory: document.getElementById('setTabAreaByCategory'),
    setTabExcludedExteriorAreas: document.getElementById('setTabExcludedExteriorAreas'),
    setTabAreaRegister: document.getElementById('setTabAreaRegister')
  };

  const required = [
    'viewerWrap', 'pane3d', 'pane2d', 'paneResizer', 'sidebar', 'fileInput',
    'floorSelect', 'floorList', 'reportTabs', 'settingsBtn', 'settingsModal',
    'stack3d', 'label3dLayer', 'editorToolbar'
  ];
  const missing = required.filter(key => !els[key]);
  if (missing.length) {
    console.error(`Revit Area Analysis: missing required DOM elements: ${missing.join(', ')}`);
  }
  return els;
}

export function wirePresentationSheet() {
  const fileInput = document.getElementById('fileInput');
  const chooseFileBtn = document.getElementById('chooseFileBtn');
  const loadedFileLabel = document.getElementById('loadedFileLabel');
  const floorSelect = document.getElementById('floorSelect');
  const levelNumberDisplay = document.getElementById('levelNumberDisplay');
  const sheetIndexDisplay = document.getElementById('sheetIndexDisplay');
  const sheetDateDisplay = document.getElementById('sheetDateDisplay');

  if (chooseFileBtn && fileInput) {
    chooseFileBtn.addEventListener('click', () => fileInput.click());
  }

  if (fileInput && loadedFileLabel) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      loadedFileLabel.innerHTML = f
        ? `LOADED: <strong>${f.name.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</strong>`
        : 'LOADED: <strong>no file</strong>';
    });
  }

  function levelTextFromOption(opt) {
    if (!opt) return '—';
    const groupedLabel = (opt.dataset?.levelDisplay || '').trim();
    if (groupedLabel) return groupedLabel;
    const raw = (opt.textContent || '').trim();
    const m = raw.match(/-?\d+(\.\d+)?/);
    return m ? m[0] : (raw || '—');
  }

  function refreshLevelDisplay() {
    if (!floorSelect || !levelNumberDisplay) return;
    const opt = floorSelect.options[floorSelect.selectedIndex];
    const levelText = levelTextFromOption(opt);
    levelNumberDisplay.textContent = levelText;
    if (sheetIndexDisplay) sheetIndexDisplay.textContent = levelText;
  }

  if (floorSelect) {
    floorSelect.addEventListener('change', refreshLevelDisplay);
    // Catch programmatic population of <option> elements after JSON load.
    new MutationObserver(refreshLevelDisplay).observe(floorSelect, { childList: true });
    refreshLevelDisplay();
  }

  if (sheetDateDisplay) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    sheetDateDisplay.textContent = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
  }
}

export function wireEmptyFileState() {
  function optionLooksLikeLoadedFloor(option) {
    if (!option) return false;
    const text = (option.textContent || '').trim();
    const value = (option.value || '').trim();
    if (!text && !value) return false;
    if (/no\s+floors?\s+loaded/i.test(text)) return false;
    return true;
  }

  function hasLoadedFloorOptions() {
    const floorSelect = document.getElementById('floorSelect');
    if (!floorSelect) return false;
    return Array.from(floorSelect.options || []).some(optionLooksLikeLoadedFloor);
  }

  function applyNoFileState() {
    const hasData = hasLoadedFloorOptions();
    document.body.classList.toggle('no-file-loaded', !hasData);
    document.body.classList.toggle('has-file-loaded', hasData);

    const title = document.getElementById('sheetTitleDisplay');
    if (!hasData && title && !title.dataset.emptyTitleLocked) {
      title.textContent = 'Project Analysis';
    }
  }

  const fileInput = document.getElementById('fileInput');
  const emptyChooseFileBtn = document.getElementById('emptyChooseFileBtn');
  if (emptyChooseFileBtn && fileInput) {
    emptyChooseFileBtn.addEventListener('click', () => fileInput.click());
  }

  const floorSelect = document.getElementById('floorSelect');
  const loadedFileLabel = document.getElementById('loadedFileLabel');
  const levelNumberDisplay = document.getElementById('levelNumberDisplay');
  const observer = new MutationObserver(applyNoFileState);
  [floorSelect, loadedFileLabel, levelNumberDisplay].forEach(el => {
    if (el) observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      document.body.classList.remove('no-file-loaded');
      document.body.classList.add('has-file-loaded');
      setTimeout(applyNoFileState, 150);
      setTimeout(applyNoFileState, 700);
    });
  }

  document.addEventListener('DOMContentLoaded', applyNoFileState);
  window.addEventListener('load', () => setTimeout(applyNoFileState, 0));
  setTimeout(applyNoFileState, 0);
  setTimeout(applyNoFileState, 300);
}
