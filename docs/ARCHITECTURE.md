# Architecture

This document explains the current structure of Graph Workspace so future features can be added without turning the app into one large tangled file.

## Application Shape

The app is a Vite React application written in TypeScript.

Main files:

- `src/main.tsx` mounts the React app.
- `src/App.tsx` owns most 2D graph state and top-level UI state.
- `src/graphTypes.ts` defines shared graph, surface, plot, and object types.
- `src/styles.css` contains global UI, grid, panel, graph label, calculator, and surface styling.

Feature folders:

- `src/features/calculator/` contains the scientific calculator UI and calculator logic.
- `src/features/surface/` contains the Three.js and canvas 3D surface viewer.
- `src/lib/` contains reusable graph math helpers.
- `src/config/` contains reusable app constants/configuration.

## 2D Graph Model

The 2D workspace is state-driven. Core object types are stored in React state:

- points
- lines
- curves
- shapes
- distance markers
- data plots
- canvas strokes

The canvas draw loop renders the grid, graph objects, data, least-squares overlays, labels, and freehand annotations from state.

Important design rule: graph objects should be editable through state updates, not by mutating canvas drawings directly.

## 3D Surface Model

The 3D workspace uses `SurfaceShape` objects. A surface shape can currently represent:

- `surface`: equation-based shape using `z = f(x, y)`
- `cube`: editable 3D box with width, height, and depth

`Surface3DViewer.tsx` renders the 3D scene using Three.js when GPU mode is active. Canvas mode provides a lighter fallback preview.

The contour panel can switch between:

- contour view
- 2D x/y top-down view

## State Persistence

Workspace captures are stored in browser `localStorage`. A capture stores:

- current workspace mode
- 2D graph objects
- 3D surface objects
- view settings
- selected colors
- rendering settings

This is currently local to the browser. A future version can add export/import files or cloud-backed persistence.

## Current Refactor Need

`src/App.tsx` still owns too much behavior. The next structural improvement should split it into focused modules:

- `features/graph2d/`
- `features/data/`
- `features/workspaceCapture/`
- `features/tools/`
- `features/labels/`

That refactor should be done carefully, in small commits, without changing behavior.

