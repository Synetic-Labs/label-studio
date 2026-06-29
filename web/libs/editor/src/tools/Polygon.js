import { ff } from "@humansignal/core";
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
    // Set when a right-click happens during the hold -> cancel the pending point
    // (mirrors the two-finger abort gesture planned for touch).
    let aborted = false;

    // Window-level right-click listener active only during a hold. Listening at the
    // window (capture phase) makes the abort work no matter what is under the cursor,
    // and lets us suppress the browser context menu while placing a point.
    let abortListener = null;
    const startAbortWatch = () => {
      if (abortListener) return;
      abortListener = (e) => {
        if (!armed) return;
        aborted = true;
        e.preventDefault();
      };
      window.addEventListener("contextmenu", abortListener, true);
    };
    const stopAbortWatch = () => {
      if (!abortListener) return;
      window.removeEventListener("contextmenu", abortListener, true);
      abortListener = null;
    };

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
        if (!ff.isActive(ff.FF_MULTIPLE_LABELS_REGIONS)) {
          self.applyActiveStates(self.currentArea);
        }
      },

      // Press-and-hold placement model.
      //
      // Instead of committing a point on a click, we "arm" on press and commit on
      // release at the release position. While held (or on hover) the ghost line
      // previews where the point will land. A right-click during the hold aborts.
      //
      // Panning is preserved: shift-drag / middle-drag pan the image, so those are
      // never armed and never commit a point.
      mousedownEv(ev, _coords) {
        // Right-button press during a hold aborts the pending point (fast path;
        // the window contextmenu listener below is the robust catch-all).
        if (ev.button === 2) {
          if (armed) aborted = true;
          return;
        }
        // Only a plain left press arms a point; shift is reserved for panning.
        if (ev.button !== 0 || ev.shiftKey) return;
        armed = true;
        aborted = false;
        startAbortWatch();
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
        // Ignore middle/right button releases (right-click abort is handled on its press).
        if (ev.button !== 0) return;

        const shouldCommit = armed && !aborted && !ev.shiftKey;

        armed = false;
        aborted = false;
        stopAbortWatch();

        // Commit the point (or close the path) at the release position.
        // _clickEv handles first-point creation, adding subsequent points, and
        // closing when releasing near the start point.
        if (shouldCommit) self._clickEv(ev, [x, y]);
      },

      // Placement happens on release (mouseup); swallow the trailing browser click
      // so we never place a duplicate point.
      clickEv() {},

      _finishDrawing() {
        const { currentArea, control } = self;

        armed = false;
        aborted = false;
        stopAbortWatch();
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
        aborted = false;
        stopAbortWatch();
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
