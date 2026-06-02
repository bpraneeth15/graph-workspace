# Graph Workspace

Graph Workspace is an interactive plotting board for building, editing, and visualizing 2D graphs and 3D surfaces without repeatedly drawing coordinate axes by hand.

The app is currently focused on fast visual math exploration: plotting points, drawing lines and curves, manipulating shapes, importing data, visualizing least squares, using a floating calculator, and exploring 3D surfaces with GPU rendering.

## Current Capabilities

- Bright white 2D coordinate grid with quarter-unit and half-unit grid visibility.
- Interactive plotting, lines, curves, rectangles, squares, distance markers, and reference lines.
- Editable labels for graph objects, including point labels and distance labels.
- Object selection, dragging, resizing, color changes, hide/show labels, undo, and redo.
- Data entry for scatter and connected plots, with editable plotted points.
- Least-squares visualization for data points against a line.
- Floating scientific calculator with statistical helpers.
- Floating canvas tools for pencil, marker, and eraser annotations.
- Workspace captures that can save and restore graph state.
- 3D surface mode with GPU rendering, surface presets, cuts, contours, 2D top-down view, data points, drawing tools, and editable cubes.

## Tech Stack

- React
- TypeScript
- Vite
- Three.js
- HTML canvas

## Local Development

Install dependencies:

```powershell
npm install
```

Run the app:

```powershell
npm run dev -- --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5173/
```

Build:

```powershell
npm run build
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development Log](docs/DEVELOPMENT_LOG.md)
- [Roadmap](docs/ROADMAP.md)
- [Documentation Process](docs/DOCUMENTATION_PROCESS.md)

## Repository Workflow

Feature work is developed on short-lived branches and then merged into `main` through GitHub pull requests.

Before pushing code, run:

```powershell
npm run build
```

