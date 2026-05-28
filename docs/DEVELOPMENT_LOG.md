# Development Log

This log records major product and engineering changes. Keep it updated whenever a meaningful feature, refactor, or behavior change lands.

## 2026-05-28

### Added

- Added editable 3D cubes in surface mode.
- Added support for multiple 3D surface objects at the same time.
- Added contour panel switch between contour view and 2D x/y top-down view.
- Added workspace capture and restore flow.
- Added reference dotted line option under the line tool menu.
- Added draggable distance labels and draggable point labels.
- Added direct color controls for graph objects.

### Verified

- `npm run build`
- Dev server served the app at `http://127.0.0.1:5173/`

## Earlier Milestones

### 2D graph workspace

- Built the main coordinate grid.
- Added zoom, pan, scale controls, and smoother trackpad navigation.
- Added quarter-unit and half-unit grid visibility.
- Added points, lines, curves, rectangles, squares, and distance markers.
- Added real-time equations and editable equation labels.
- Added undo and redo.
- Added object selection, dragging, resizing, label hiding, and color editing.
- Added data plotting and editable data points.
- Added least-squares visualization for fitting a line to plotted data.
- Added floating calculator and floating canvas annotation tools.

### 3D surface workspace

- Added 3D surface mode with GPU rendering through Three.js.
- Added surface presets for common mathematical and machine-learning-style shapes.
- Added colored cut/slice controls.
- Added contour preview.
- Added 3D tools for drawing, painting, scaling, stretching, shrinking, replicating, plotting data points, and selecting/moving shapes.

## Documentation Rule

Every future feature should update at least one of:

- this development log
- the roadmap
- architecture notes
- README feature list

