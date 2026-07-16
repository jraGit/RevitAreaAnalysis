# Revit Area Analysis

This repository is the GitHub Pages-ready modular version of `AreaExportViewer_working_changesets_v44.html`. It preserves the standalone viewer's existing layout, local JSON loading, 2D/3D visualization, reports, editor changesets, validation, save, and transformer-export workflows.

## Project structure

```text
RevitAreaAnalysis/
├── index.html
├── README.md
├── MIGRATION_NOTES.md
├── REGRESSION_TESTS.md
├── .gitignore
├── .nojekyll
├── assets/
│   ├── css/app.css
│   └── js/
│       ├── main.js
│       ├── app-core.js
│       ├── config.js
│       ├── state.js
│       ├── dom.js
│       ├── data-loader.js
│       └── utils.js
└── test-data/README.md
```

- `REGRESSION_TESTS.md`: completed structural checks and the remaining real-browser checklist.
- `index.html`: original application markup, Leaflet/JSTS CDN tags, and the single module entry point.
- `assets/css/app.css`: original CSS in the original cascade order.
- `assets/js/main.js`: controlled startup and fatal initialization fallback.
- `assets/js/app-core.js`: tightly coupled normalization, 2D/3D viewer, editor, reports, settings, and export implementation.
- `assets/js/config.js`: stable constants, palettes, tab defaults, and editor version.
- `assets/js/state.js`: factories for the original shared mutable application, 2D, and 3D state objects.
- `assets/js/dom.js`: centralized DOM lookups plus the existing presentation and empty-file wiring.
- `assets/js/data-loader.js`: browser `FileReader`, one-file behavior, parsing, and schema dispatch.
- `assets/js/utils.js`: shared numeric, formatting, point, color, and area helpers.
- `test-data/README.md`: guidance for committing sanitized fixtures only.

`app-core.js` intentionally retains the most strongly coupled logic. This is the lowest-risk migration boundary: function order, closure references, geometry calculations, and listener registration remain intact.

## Local development in Visual Studio Code

### VS Code Live Server

1. Open the `RevitAreaAnalysis` folder in Visual Studio Code.
2. Install the **Live Server** extension when needed.
3. Right-click `index.html`.
4. Select **Open with Live Server**.

### Python local server

From the Visual Studio Code terminal:

```bash
cd RevitAreaAnalysis
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

On Windows, when `python` is not recognized:

```bash
py -m http.server 8000
```

Do not use `file://` as the normal test method. ES-module and browser security behavior can differ from HTTP/HTTPS.

## Loading data

1. Open the application.
2. Select the JSON file through the application's file picker.
3. The JSON remains local in the browser and is not uploaded by this project.
4. Use the existing Save or Export controls to create output files.

The supplied project JSON is not embedded and is not automatically loaded.

## GitHub Pages deployment

1. Create or open the GitHub repository named `RevitAreaAnalysis`.
2. Place `index.html` at the repository root with the remaining project files.
3. Commit and push to the `main` branch.
4. Open **Settings** in the repository.
5. Open **Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select the `main` branch.
8. Select the `/ (root)` folder.
9. Save.
10. Open the generated GitHub Pages URL.

All project paths are relative, so the application works from:

```text
https://username.github.io/RevitAreaAnalysis/
```

## Debugging

- Open browser developer tools with `F12` or `Ctrl+Shift+I`.
- Check the **Console** for module, parsing, missing-DOM, WebGL, or library errors.
- Check **Network** and confirm the CSS and all JavaScript modules return HTTP 200.
- Confirm Leaflet `1.9.4`, JSTS `2.11.3`, and Three.js `0.160.0` loaded.
- Confirm Google Fonts load or that fallback fonts render safely.
- Test with the supplied sample JSON through the file picker.
- Compare the modular app and `AreaExportViewer_working_changesets_v44.html` with the same JSON and viewport.
