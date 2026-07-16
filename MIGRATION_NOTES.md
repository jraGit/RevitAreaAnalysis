# Migration Notes

## Source

- Original standalone filename: `AreaExportViewer_working_changesets_v44.html`
- Target folder: `RevitAreaAnalysis/`
- Local regression fixture: `dataRaw.workingV1.json` (not copied into the deployable project)

## Summary

The standalone application was separated into HTML, CSS, and native ES modules. The source markup, IDs, classes, data attributes, CSS order, CDN versions, initialization order, JSON normalization, rendering, reports, editing, changesets, validation, saving, and transformer handoff logic were preserved.

No framework, backend, build step, database, authentication, cloud storage, API, analytics package, router, or service worker was introduced.

## Source mapping

| Original content | New file |
|---|---|
| Application markup and global Leaflet/JSTS tags | `index.html` |
| Inline CSS | `assets/css/app.css` |
| Stable constants and defaults | `assets/js/config.js` |
| General, 2D, and Three.js state objects | `assets/js/state.js` |
| DOM lookups and additive display wiring | `assets/js/dom.js` |
| FileReader loading and schema dispatch | `assets/js/data-loader.js` |
| Shared helpers | `assets/js/utils.js` |
| Remaining tightly coupled viewer/editor/report/export closure | `assets/js/app-core.js` |
| Startup order and fatal fallback | `assets/js/main.js` |

## Retained dependency versions

- Leaflet `1.9.4`
- JSTS `2.11.3`
- Three.js `0.160.0`
- Google Fonts: Oswald and Urbanist

## Globals converted or retained

- Stable constants are explicit module imports.
- Mutable state is created through explicit factories while preserving shared object references.
- The DOM lookup object is returned by `getDomElements()`.
- Leaflet remains available as global `L` from its classic script.
- JSTS remains available as global `jsts` from its classic script.
- Three.js remains an ES-module import.

## Compatibility adjustments

1. Relative CSS and module paths support the `/RevitAreaAnalysis/` GitHub Pages subpath.
2. `main.js` adds a targeted fatal initialization message when module startup itself fails.
3. Missing required DOM elements produce a useful console error; optional legacy references remain nullable.
4. The deeply shared viewer/editor/report implementation remains in `app-core.js` to avoid introducing circular imports or changing closure behavior during a low-risk migration.

## Known browser limitations

- The retained CDN setup requires internet access unless dependencies are hosted locally later.
- WebGL is required for the 3D view.
- The File System Access API is browser-dependent; the original download fallback remains.
- Browser-local sessions remain subject to storage quotas.
- `file://` is not a supported deployment or development workflow.

## Preservation confirmation

- No intentional visual redesign was performed.
- No intentional geometry, coordinate, topology-preview, area-calculation, camera, report, unit-mix, editor, validation, save, or export change was made.
- No project JSON is embedded in the deployable application.

## Deferred improvements

- Further extraction from `app-core.js` after automated browser regression tests exist
- Local copies of external dependencies
- Automated tests in the repository
- Performance profiling
- Web Workers for large datasets
- Optional drag-and-drop enhancements
- Optional recent-file handling
- Optional sanitized example projects
- More advanced Three.js rendering
