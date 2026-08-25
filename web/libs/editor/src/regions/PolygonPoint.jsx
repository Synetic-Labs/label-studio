import { useState } from "react";
import { Circle, Rect } from "react-konva";
import { observer } from "mobx-react";
import { getParent, hasParent, types } from "mobx-state-tree";

import { guidGenerator } from "../core/Helpers";
import { useRegionStyles } from "../hooks/useRegionColor";
import { AnnotationMixin } from "../mixins/AnnotationMixin";

const PolygonPointModel = types
  .model("PolygonPoint", {
    id: types.optional(types.identifier, guidGenerator),

    x: types.number,
    y: types.number,

    index: types.number,

    style: "circle",
    size: "small",
  })
  .volatile(() => ({
    selected: false,
  }))
  .views((self) => ({
    get parent() {
      if (!hasParent(self, 2)) return null;
      return getParent(self, 2);
    },

    get stage() {
      return self.parent?.parent;
    },

    get canvasX() {
      return self.stage?.internalToCanvasX(self.x);
    },

    get canvasY() {
      return self.stage?.internalToCanvasY(self.y);
    },
  }))
  .actions((self) => ({
    /**
     * External function for Polygon Parent
     * @param {number} x
     * @param {number} y
     */

    movePoint(offsetX, offsetY) {
      const dx = self.stage.canvasToInternalX(offsetX);
      const dy = self.stage.canvasToInternalY(offsetY);

      self.x = self.x + dx;
      self.y = self.y + dy;
    },

    _setPos(x, y) {
      self.x = x;
      self.y = y;
    },
    _movePoint(canvasX, canvasY) {
      const point = self.parent.control?.getSnappedPoint({
        x: self.stage.canvasToInternalX(canvasX),
        y: self.stage.canvasToInternalY(canvasY),
      });

      self._setPos(point.x, point.y);
    },

    /**
     * Close polygon
     * @param {*} ev
     */
    closeStartPoint() {
      if (self.annotation.isReadOnly()) return;
      if (self.parent.closed) return;

      // `closePoly()` already guards against closing with fewer than 3 points.
      // We intentionally do NOT require `mouseOverStartPoint` here: that flag is
      // only ever set by a mouse hover (`onMouseOver`), so on touch/pen devices it
      // stays false and the polygon could never be closed. Callers decide intent
      // (e.g. a tap on the start point); this just performs the close.
      self.parent.closePoly();
    },

    handleMouseOverStartPoint(ev) {
      ev.cancelBubble = true;

      const stage = self.stage?.stageRef;

      if (!stage) return;
      stage.container().style.cursor = "crosshair";

      /**
       * Check if polygon > 2 points and closed point
       */
      if (self.parent.closed || self.parent.points.length < 3) return;

      const startPoint = ev.target;

      if (self.style === "rectangle") {
        startPoint.setX(startPoint.x() - startPoint.width() / 2);
        startPoint.setY(startPoint.y() - startPoint.height() / 2);
      }

      const scaleMap = {
        small: 2,
        medium: 3,
        large: 4,
      };

      const scale = scaleMap[self.size] ?? 1.5;

      startPoint.scale({
        x: scale / self.stage.zoomScale,
        y: scale / self.stage.zoomScale,
      });

      self.parent.setMouseOverStartPoint(true);
    },

    handleMouseOutStartPoint(ev) {
      const t = ev.target;

      const stage = self.stage?.stageRef;

      if (!stage) return;
      stage.container().style.cursor = "default";

      if (self.style === "rectangle") {
        t.setX(t.x() + t.width() / 2);
        t.setY(t.y() + t.height() / 2);
      }

      t.scale({
        x: 1 / self.stage.zoomScale,
        y: 1 / self.stage.zoomScale,
      });

      self.parent.setMouseOverStartPoint(false);
    },

    getSkipInteractions() {
      return self.parent.control.obj.getSkipInteractions();
    },
  }));

const PolygonPoint = types.compose("PolygonPoint", AnnotationMixin, PolygonPointModel);

const PolygonPointView = observer(({ item, name }) => {
  if (!item.parent) return;

  const [draggable, setDraggable] = useState(true);
  const regionStyles = useRegionStyles(item.parent, {
    defaultStrokeColorHighlighted: item.parent.highlightColor,
  });
  const sizes = {
    small: 4,
    medium: 8,
    large: 12,
  };

  const stroke = {
    small: 1,
    medium: 2,
    large: 3,
  };

  // `pointSize` is small|medium|large or a number: the handle radius in screen px.
  const w = sizes[item.size] ?? (Number.parseFloat(item.size) || sizes.small);
  const strokeW = stroke[item.size] ?? 2;
  const opacity = item.parent.pointOpacity;

  const startPointAttr =
    item.index === 0
      ? {
          hitStrokeWidth: 12,
          fill: regionStyles.strokeColor || item.primary,
          onMouseOver: item.handleMouseOverStartPoint,
          onMouseOut: item.handleMouseOutStartPoint,
        }
      : null;

  const dragOpts = {
    onDragMove: (e) => {
      if (item.getSkipInteractions()) return false;
      if (e.target !== e.currentTarget) return;
      const shape = e.target;
      let { x, y } = shape.attrs;

      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x > item.stage.stageWidth) x = item.stage.stageWidth;
      if (y > item.stage.stageHeight) y = item.stage.stageHeight;

      item._movePoint(x, y);
      shape.setAttr("x", item.canvasX);
      shape.setAttr("y", item.canvasY);
      // Follow the dragged point with the magnifier for precise repositioning.
      item.stage?.setLoupePoint?.(item.x, item.y);
    },

    onDragStart: () => {
      if (item.getSkipInteractions()) {
        setDraggable(false);
        return false;
      }
      item.annotation.history.freeze();
      item.stage?.setLoupePoint?.(item.x, item.y);
    },

    onDragEnd: (e) => {
      setDraggable(true);
      item.annotation.history.unfreeze();
      item.stage?.clearLoupePoint?.();
      e.cancelBubble = true;
    },

    onMouseOver: (e) => {
      e.cancelBubble = true;
      const stage = item.stage?.stageRef;

      if (!stage) return;
      stage.container().style.cursor = "crosshair";
    },

    onMouseOut: () => {
      const stage = item.stage?.stageRef;

      if (!stage) return;
      stage.container().style.cursor = "default";
    },

    onTransformEnd(e) {
      if (e.target !== e.currentTarget) return;
      const t = e.target;

      t.setAttr("x", 0);
      t.setAttr("y", 0);
      t.setAttr("scaleX", 1);
      t.setAttr("scaleY", 1);
    },
  };

  const fill = item.selected ? "green" : "white";

  // Click/tap on a polygon point: tapping the first (start) point closes an open
  // polygon (>= 3 points); otherwise the point is selected.
  const handlePointInteraction = (ev) => {
    if (ev.evt.altKey) return item.parent.deletePoint(item);
    if (item.parent.isDrawing && item.parent.points.length === 1) return;
    // don't unselect polygon on point click/tap
    ev.evt.preventDefault?.();
    ev.cancelBubble = true;

    const canClose = !item.parent.closed && item.parent.points.length >= 3;
    const isStartPoint = item.index === 0;

    if (canClose && (isStartPoint || item.parent.mouseOverStartPoint)) {
      item.closeStartPoint();
      item.parent.notifyDrawingFinished();
    } else {
      item.parent.setSelectedPoint(item);
    }
  };

  // Double-tap / double-click anywhere to close: the first tap places a point and the
  // second lands on it. We detect that quick re-tap here on `pointerdown` (not click/
  // tap) — pointerdown fires exactly once per real press, so the browser's synthesized
  // "ghost click" that follows a touch tap can't masquerade as the second tap.
  const handlePointPointerDown = (ev) => {
    const polygonTool = item.parent.control?.tools?.Polygon;

    if (
      !item.parent.closed &&
      item.parent.points.length >= 3 &&
      polygonTool?.isQuickRetap?.(item.id, ev.evt?.timeStamp)
    ) {
      ev.cancelBubble = true;
      ev.evt.preventDefault?.();
      item.closeStartPoint();
      item.parent.notifyDrawingFinished();
    }
  };

  if (item.style === "circle") {
    return (
      <Circle
        key={name}
        name={name}
        x={item.canvasX}
        y={item.canvasY}
        radius={w}
        fill={fill}
        opacity={opacity}
        stroke="black"
        strokeWidth={strokeW}
        dragOnTop={false}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
        scaleX={1 / (item.stage.zoomScale || 1)}
        scaleY={1 / (item.stage.zoomScale || 1)}
        onDblClick={() => {
          item.parent.deletePoint(item);
        }}
        onDblTap={() => {
          item.parent.deletePoint(item);
        }}
        onPointerDown={handlePointPointerDown}
        onClick={handlePointInteraction}
        onTap={handlePointInteraction}
        {...dragOpts}
        {...startPointAttr}
        draggable={!item.parent.isReadOnly() && draggable}
      />
    );
  }
  return (
    <Rect
      name={name}
      key={name}
      x={item.x - w / 2}
      y={item.y - w / 2}
      width={w}
      height={w}
      fill={fill}
      opacity={opacity}
      stroke="black"
      strokeWidth={strokeW}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
      dragOnTop={false}
      onDblClick={() => {
        item.parent.deletePoint(item);
      }}
      onDblTap={() => {
        item.parent.deletePoint(item);
      }}
      onPointerDown={handlePointPointerDown}
      onClick={handlePointInteraction}
      onTap={handlePointInteraction}
      {...dragOpts}
      {...startPointAttr}
      draggable={!item.parent.isReadOnly()}
    />
  );
});

export { PolygonPoint, PolygonPointView };
