# Regression Test Record

## Automated checks completed

- [x] Parsed the supplied `dataRaw.workingV1.json` successfully.
- [x] Confirmed schema `area_working`, version `1.0.0`.
- [x] Confirmed the fixture contains 100 Levels, 100 Views, 2,364 Areas, 5,573 boundary segments, 2,667 Walls, 53 Structural Columns, and 11 Property Line records.
- [x] Ran `node --check` successfully against every JavaScript module.
- [x] Imported `app-core.js` through Node using a temporary local Three.js namespace stub to verify local module linkage and exported initialization.
- [x] Confirmed every project file returns HTTP 200 from a simple Python static server.
- [x] Confirmed `index.html` uses relative local paths and has no unintended root-relative asset path.
- [x] Confirmed the extracted CSS content exactly matches the original inline CSS content after removing only the `<style>` wrapper.
- [x] Confirmed all 106 original HTML element IDs are retained.
- [x] Confirmed all 117 original `class` attributes are retained.
- [x] Confirmed all 56 original data-attribute names are retained.
- [x] Confirmed all 392 original named JavaScript functions remain present across the modules.
- [x] Confirmed the original and modular source each contain 80 `addEventListener` registrations.
- [x] Confirmed the original and modular source each contain the same three Leaflet `map.on(...)` registration sites.
- [x] Confirmed Leaflet `1.9.4`, JSTS `2.11.3`, and Three.js `0.160.0` references were retained.
- [x] Confirmed the deployable folder does not contain the supplied project JSON.

## Browser regression checklist

The following checks should be completed in Chrome or Edge through VS Code Live Server or `python -m http.server`. They require the retained CDN libraries to be reachable.

### Initial state

- [ ] Application opens without console errors.
- [ ] No project renders before file selection.
- [ ] Empty-file state is visible.
- [ ] Open and Choose File controls open the file picker.

### JSON loading

- [ ] The supplied JSON loads successfully.
- [ ] The loaded filename is displayed.
- [ ] `area_working` version 1.x is recognized.
- [ ] Levels and Views populate.
- [ ] Project Information populates.
- [ ] Invalid JSON displays the retained useful parser error.
- [ ] Selecting multiple files retains the original first-file-only behavior.

### 2D viewer

- [ ] Active floor, Areas, boundaries, Property Lines, Walls, and Structural Columns render.
- [ ] Area labels, pan, zoom, fit, selection, and deselection work.
- [ ] Visibility and transparency controls work.

### 3D viewer

- [ ] The complete level stack renders at the correct elevations.
- [ ] Typical-floor grouping, Walls, Columns, boundaries, labels, and orbit target behavior match the standalone file.
- [ ] Pan, rotate, wheel zoom, Top, Isometric, Fit, selection, transparency, and Z-scale controls work.

### Reports and settings

- [ ] Project Information, Active Floor Summary, Unit Mix, Area by Category, Level Summary, register values, and legend colors match the standalone file.
- [ ] Report-tab visibility settings apply and reset correctly.

### Editor and changesets

- [ ] Select, Line, Rectangle, Circle, Move, Delete, and Undo work.
- [ ] Draft/approved/reverted changesets and dirty-state tracking match the standalone file.
- [ ] Deleted records, JSTS preview topology, validation, and changed-view tracking remain correct.

### Save and export

- [ ] Direct Save works in a supporting browser.
- [ ] Browser-download fallback works.
- [ ] Session and editor-project load/save work.
- [ ] Transformer handoff export works.
- [ ] Validation blockers and suggested filenames match the standalone file.

### GitHub Pages

- [ ] Deployment works from `/RevitAreaAnalysis/`.
- [ ] CSS and every JavaScript module return HTTP 200.
- [ ] CDN libraries and Google Fonts load or fall back safely.
- [ ] Local JSON selection, save, and download work over HTTPS.

## Test-environment limitation

The artifact-generation environment could not complete the real-library interactive browser pass because external CDN DNS access was unavailable, and its managed Chromium policy blocked navigation to local test URLs. The static server, syntax, module-linkage, source-preservation, path, markup, and sample-schema checks above were completed. The manual browser checklist remains explicit rather than being reported as passed without evidence.
