# Development Log

This log records major product and engineering changes. Keep it updated whenever a meaningful feature, refactor, or behavior change lands.

## 2026-06-04

### Fixed

- Fixed a startup render loop in the 2D graph canvas by separating canvas size observation from graph drawing.
- Rounded measured canvas dimensions before writing them to React state, preventing sub-pixel resize jitter from repeatedly retriggering renders.
- Expanded Delete-key handling to include formula-driven objects in every tool mode.

### Added

- Replaced the simple Equations list with expandable formula-variable cards for coordinate objects.
- Added formula-object creation for square, rectangle, circle, triangle, right triangle, ellipse, line, parabola, sine, cosine, exponential, logarithmic, and absolute-value objects.
- Added analog sliders, numeric inputs, computed values, color controls, label toggles, and delete actions to formula cards.

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

## 2026-05-31

### Fixed

- Fixed a React render loop that could trigger `Maximum update depth exceeded` after plotting points and a fit line.
- Memoized least-squares derived data and stopped canvas resize handling from writing unchanged dimensions back into state.

### Added

- Added draggable in-region area labels for squares and rectangles.
- Added compact editable, draggable text labels to the floating 2D canvas tool palette.
- Added corner-drag rotation for squares and rectangles, with rotated hit-testing, edge snapping, selection outlines, and in-region area labels.
- Added square construction from dotted reference lines. The selected reference line, or newest available guide, becomes one exact side of the generated square.
- Added side selection and flipping for reference-line squares, so construction squares can sit on either side of their dotted guide.
- Added multi-page graph workspaces with page tabs, a side-by-side comparison preview, and up to three restorable snapshots per page.
- Added a neon mean-point visualization and an interactive correlation-coefficient formula. Calculator term selection now highlights the mean, deviations, signed comovement rectangles, and denominator spread components directly on the grid.
- Added locked multi-object groups in Pan mode so points, dataset points, lines, curves, shapes, and distances can be collected and moved together. The mean visualization now shows both horizontal and vertical centroid guides.
- Made the floating calculator smaller and resizable. SD, variance, covariance, and median now render statistic-specific visual guides directly on the grid.
- Expanded calculator ergonomics: the panel can be dragged from non-interactive surfaces, resized from every edge or corner, and moves its expression input above the panel when compact.
- Refined the compact calculator threshold: the expression input detaches only during width reduction, keeps its readable width, and the calculator body can continue narrowing afterward.
- Delayed calculator input detachment until the attached expression box has narrowed to its practical minimum, so the box resizes inside the panel before it pops above the compact calculator.
- Preserved cyan horizontal deviations and pink vertical deviations while highlighting correlation comovement rectangles, keeping each component visually distinguishable.
- Added positive-only and negative-only comovement selections with distinct green and orange rectangle colors plus a calculator legend.
- Replaced the always-visible correlation block with an on-demand statistics formula panel. Mean, SD, variance, covariance, median, and correlation now each open their own formula view from the calculator row.
- Added a correlation formula registry and component tree. Correlation layers can now be toggled together, x̄ and ȳ have separate controls, horizontal and vertical spread render literal labeled squares with totals, and signed comovement rectangles include numeric labels and total raw comovement.
- Added selectable formula components for mean, standard deviation, variance, covariance, and median. Each selected term now highlights its corresponding lines, deviations, literal square areas, bands, or signed rectangles directly on the grid.
- Corrected standard-deviation visualization so √VAR displays x/y distance brackets from the mean instead of filled variance-area boxes. Horizontal deviations now render as horizontal distances and horizontal-deviation squares.
- Reused the distance-marker renderer for statistic and covariance deviation formula parts, so generated deviation lines now use the same dotted segment, end-cap, and distance-label visual language as the Distance tool.

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

