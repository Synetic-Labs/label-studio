import { isAlive, types } from "mobx-state-tree";

import BaseTool, { DEFAULT_DIMENSIONS } from "./Base";
import ToolMixin from "../mixins/Tool";
import { MultipleClicksDrawingTool } from "../mixins/DrawingTool";
import { NodeViews } from "../components/Node/Node";
import { observe } from "mobx";

const _Tool = types
  .model("PolygonTool", {
    group: "segmentation",
    shortcut: "tool:polygon",
  })
  .views((self) => {
    const Super = {
      createRegionOptions: self.createRegionOptions,
      isIncorrectControl: self.isIncorrectControl,
      isIncorrectLabel: self.isIncorrectLabel,
    };

    return {
      get getActivePolygon() {
        const poly = self.currentArea;

        if (poly && !isAlive(poly)) return null;
        if (poly && poly.closed) return null;
        if (poly === undefined) return null;
        if (poly && poly.type !== "polygonregion") return null;

        return poly;
      },

      get tagTypes() {
        return {
          stateTypes: "polygonlabels",
          controlTagTypes: ["polygonlabels", "polygon"],
        };
      },

      get viewTooltip() {
        return "Polygon region";
      },
      get iconComponent() {
        return self.dynamic ? NodeViews.PolygonRegionModel.altIcon : NodeViews.PolygonRegionModel.icon;
      },

      get defaultDimensions() {
        return DEFAULT_DIMENSIONS.polygon;
      },

      createRegionOptions({ x, y }) {
        return Super.createRegionOptions({
          points: [[x, y]],
          width: 10,
          closed: false,
        });
      },

      isIncorrectControl() {
        return Super.isIncorrectControl() && self.current() === null;
      },
      isIncorrectLabel() {
        return !self.current() && Super.isIncorrectLabel();
      },
      canStart() {
        return self.current() === null;
      },

      current() {
        return self.getActivePolygon;
      },
    };
  })
  .actions((self) => {
    let disposer;
    let closed;
    // Press-and-hold placement state:
    // a left press "arms" a pending point that is committed on release, so the
    // user can preview where the point lands (via the ghost line) before letting go.
    let armed = false;

    // Double-click / double-tap-to-close bookkeeping. The second tap of a double-tap
    // lands on the point the first tap just placed, so it never reaches the tool — the
    // close is therefore triggered from the point handler (see PolygonPoint), which asks
    // `isQuickRetap` whether this point was just placed within the double-tap window.
    let lastPlacedId = null;
    let lastPlacedTs = 0;
    const DOUBLE_TAP_MS = 400; // matches Konva's dblClickWindow

    return {
      handleToolSwitch(tool) {
        self.stopListening();
        if (self.getCurrentArea()?.isDrawing && tool.toolName !== "ZoomPanTool") {
          const shape = self.getCurrentArea()?.toJSON();

          if (shape?.points?.length > 2) self.finishDrawing();
          else self.cleanupUncloseableShape();
        }
      },
      listenForClose() {
        closed = false;
        disposer = observe(
          self.getCurrentArea(),
          "closed",
          () => {
            if (self.getCurrentArea()?.closed && !closed) {
              self.finishDrawing();
            }
          },
          true,
        );
      },
      stopListening() {
        if (disposer) disposer();
      },
      closeCurrent() {
        self.stopListening();
        if (closed) return;
        closed = true;
        self.getCurrentArea().closePoly();
      },

      startDrawing(x, y) {
        const point = self.control?.getSnappedPoint({ x, y });

        self.mode = "drawing";
        self.currentArea = self.createRegion(self.createRegionOptions({ x: point.x, y: point.y }), true);
        self.setDrawing(true);
      },

      // Press-and-hold placement model.
      //
      // Instead of committing a point on a click, we "arm" on press and commit on
      // release at the release position, so the ghost line previews where the point
      // will land before you let go. To undo a mistaken point, just move or delete it.
      //
      // Panning is preserved: shift-drag / middle-drag pan the image, so those are
      // never armed and never commit a point.
      mousedownEv(ev, [x, y]) {
        // Only a plain left press arms a point; shift is reserved for panning.
        if (ev.button !== 0 || ev.shiftKey) return;
        armed = true;

        // Show the ghost preview immediately on press, so a tap-and-hold (no move yet)
        // still previews where the point will land and the segment from the last point.
        const area = self.getCurrentArea();

        if (area?.isDrawing && !area.closed) area.setGhostPoint({ x, y });
      },

      // Update the ghost-line preview to follow the pointer while drawing.
      // Fires on hover (mouse) and while moving during a press/hold (mouse/touch/pen).
      mousemoveEv(_, [x, y]) {
        const area = self.getCurrentArea();

        if (area?.isDrawing && !area.closed) {
          area.setGhostPoint({ x, y });
        }
      },

      mouseupEv(ev, [x, y]) {
        // Ignore middle/right button releases.
        if (ev.button !== 0) return;

        const shouldCommit = armed && !ev.shiftKey;

        armed = false;

        if (!shouldCommit) return;

        // Commit the point (or close the path) at the release position.
        // _clickEv handles first-point creation, adding subsequent points, and
        // closing when releasing near the start point.
        const area = self.getCurrentArea();
        const before = area?.points?.length ?? 0;

        self._clickEv(ev, [x, y]);

        // Remember the just-placed point so a quick re-tap on it closes the polygon
        // (double-tap / double-click to close — see isQuickRetap / PolygonPoint).
        const after = self.getCurrentArea();

        if (after && after.points.length > before) {
          lastPlacedId = after.points[after.points.length - 1].id;
          lastPlacedTs = ev.timeStamp;
        }
      },

      // Placement happens on release (mouseup); swallow the trailing browser click
      // so we never place a duplicate point.
      clickEv() {},

      // True if `pointId` is the point we just placed and it's being tapped again within
      // the double-tap window — used by PolygonPoint to close the polygon on double-tap.
      isQuickRetap(pointId, ts) {
        return pointId != null && pointId === lastPlacedId && ts != null && ts - lastPlacedTs < DOUBLE_TAP_MS;
      },

      // Cancel the point currently being placed without committing it. Called when a
      // second finger starts a pan/zoom gesture on touch.
      abortPendingPoint() {
        if (!armed) return;
        armed = false;
        self.getCurrentArea()?.clearGhostPoint?.();
      },

      _finishDrawing() {
        const { currentArea, control } = self;

        armed = false;
        self.currentArea?.clearGhostPoint?.();
        self.currentArea.notifyDrawingFinished();
        self.setDrawing(false);
        self.currentArea = null;
        self.mode = "viewing";
        self.annotation.afterCreateResult(currentArea, control);
      },

      setDrawing(drawing) {
        self.currentArea?.setDrawing(drawing);
        self.annotation.setIsDrawing(drawing);
      },

      deleteRegion() {
        const { currentArea } = self;

        armed = false;
        self.setDrawing(false);
        self.currentArea = null;
        if (currentArea) {
          currentArea.deleteRegion();
        }
      },
    };
  });

const Polygon = types.compose(_Tool.name, ToolMixin, BaseTool, MultipleClicksDrawingTool, _Tool);

export { Polygon };
