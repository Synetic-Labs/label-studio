import { Component, createRef, forwardRef, Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Image as KonvaImage, Circle } from "react-konva";
import { observer } from "mobx-react";
import { getEnv, getRoot, isAlive } from "mobx-state-tree";

import ImageGrid from "../ImageGrid/ImageGrid";
import ImageTransformer from "../ImageTransformer/ImageTransformer";
import ObjectTag from "../../components/Tags/Object";
import Tree from "../../core/Tree";
import styles from "./ImageView.module.css";
import { errorBuilder } from "../../core/DataValidator/ConfigValidator";
import { chunks, findClosestParent } from "../../utils/utilities";
import Konva from "konva";
import { LoadingOutlined } from "@ant-design/icons";
import { Toolbar } from "../Toolbar/Toolbar";
import { ImageViewProvider } from "./ImageViewContext";
import { Hotkey } from "../../core/Hotkey";
import { useObserver } from "mobx-react";
import ResizeObserver from "../../utils/resize-observer";
import { debounce } from "@humansignal/core/lib/utils/debounce";
import Constants from "../../core/Constants";
import { fixRectToFit, mapKonvaBrightness } from "../../utils/image";
import { FF_DEV_1442, FF_LSDV_4930, FF_ZOOM_OPTIM, isFF } from "../../utils/feature-flags";
import { Pagination } from "../../common/Pagination/Pagination";
import { Image } from "./Image";
import { Loupe } from "./Loupe";

Konva.showWarnings = false;

const hotkeys = Hotkey("Image");
const imgDefaultProps = { crossOrigin: "anonymous" };

export const splitRegions = (regions) => {
  const brushRegions = [];
  const shapeRegions = [];
  const bitmaskRegions = [];
  const vectorRegions = [];

  for (const region of regions) {
    switch (region.type) {
      case "brushregion":
        brushRegions.push(region);
        break;
      case "bitmaskregion":
        bitmaskRegions.push(region);
        break;
      default:
        shapeRegions.push(region);
        break;
    }
  }

  return {
    brushRegions,
    bitmaskRegions,
    vectorRegions,
    shapeRegions,
  };
};

const Region = observer(({ region, showSelected = false }) => {
  return Tree.renderItem(region, region.annotation, true);
});

const RegionsLayer = memo(({ regions, name, useLayers, showSelected = false, smoothing = true }) => {
  const content = regions.map((el) => {
    return <Region key={`region-${el.id}`} region={el} showSelected={showSelected} />;
  });

  return useLayers === false ? (
    content
  ) : (
    <Layer name={name} imageSmoothingEnabled={smoothing}>
      {content}
    </Layer>
  );
});

const Regions = memo(
  ({ regions, useLayers = true, chunkSize = 15, suggestion = false, showSelected = false, smoothing = true }) => {
    return (
      <ImageViewProvider value={{ suggestion }}>
        {(chunkSize ? chunks(regions, chunkSize) : regions).map((chunk, i) => (
          <RegionsLayer
            key={`chunk-${i}`}
            name={`chunk-${i}`}
            regions={chunk}
            useLayers={useLayers}
            showSelected={showSelected}
            smoothing={smoothing}
          />
        ))}
      </ImageViewProvider>
    );
  },
);

const DrawingRegion = observer(({ item }) => {
  const { drawingRegion } = item;

  if (!drawingRegion) return null;
  if (item.multiImage && item.currentImage !== drawingRegion.item_index) return null;

  const Wrapper = Layer;

  return (
    <Wrapper imageSmoothingEnabled={item.smoothingEnabled}>
      {drawingRegion ? <Region key={"drawing"} region={drawingRegion} /> : drawingRegion}
    </Wrapper>
  );
});

const SELECTION_COLOR = "#40A9FF";
const SELECTION_SECOND_COLOR = "white";
const SELECTION_DASH = [3, 3];

/**
 * Multiple selected regions when transform is unavailable — just a box with anchors
 */
const SelectionBorders = observer(({ item, selectionArea }) => {
  const { selectionBorders: bbox } = selectionArea;

  const points = bbox
    ? [
        {
          x: bbox.left,
          y: bbox.top,
        },
        {
          x: bbox.right,
          y: bbox.top,
        },
        {
          x: bbox.left,
          y: bbox.bottom,
        },
        {
          x: bbox.right,
          y: bbox.bottom,
        },
      ]
    : [];
  const ANCHOR_SIZE = 6 / item.stageScale;

  return (
    <>
      {bbox && (
        <Rect
          name="regions_selection"
          x={bbox.left}
          y={bbox.top}
          width={bbox.right - bbox.left}
          height={bbox.bottom - bbox.top}
          stroke={SELECTION_COLOR}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {points.map((point, idx) => {
        return (
          <Rect
            key={idx}
            x={point.x - ANCHOR_SIZE / 2}
            y={point.y - ANCHOR_SIZE / 2}
            width={ANCHOR_SIZE}
            height={ANCHOR_SIZE}
            fill={SELECTION_COLOR}
            stroke={SELECTION_SECOND_COLOR}
            strokeWidth={2}
            strokeScaleEnabled={false}
            listening={false}
          />
        );
      })}
    </>
  );
});

/**
 * Selection area during selection — dashed rect
 */
const SelectionRect = observer(({ item }) => {
  const { x, y, width, height } = item.onCanvasRect;

  const positionProps = {
    x,
    y,
    width,
    height,
    listening: false,
    strokeWidth: 1,
  };

  return (
    <>
      <Rect {...positionProps} stroke={SELECTION_COLOR} dash={SELECTION_DASH} strokeScaleEnabled={false} />
      <Rect
        {...positionProps}
        stroke={SELECTION_SECOND_COLOR}
        dash={SELECTION_DASH}
        dashOffset={SELECTION_DASH[0]}
        strokeScaleEnabled={false}
      />
    </>
  );
});

const TRANSFORMER_BACK_ID = "transformer_back";

const TransformerBack = observer(({ item }) => {
  const { selectedRegionsBBox } = item;
  const singleNodeMode = item.selectedRegions.length === 1;
  const dragStartPointRef = useRef({ x: 0, y: 0 });

  return (
    <Layer>
      {selectedRegionsBBox && !singleNodeMode && (
        <Rect
          id={TRANSFORMER_BACK_ID}
          fill="rgba(0,0,0,0)"
          draggable
          onClick={() => {
            item.annotation.unselectAreas();
          }}
          onMouseOver={(ev) => {
            if (!item.annotation.isLinkingMode) {
              ev.target.getStage().container().style.cursor = Constants.POINTER_CURSOR;
            }
          }}
          onMouseOut={(ev) => {
            ev.target.getStage().container().style.cursor = Constants.DEFAULT_CURSOR;
          }}
          onDragStart={(e) => {
            dragStartPointRef.current = {
              x: item.canvasToInternalX(e.target.getAttr("x")),
              y: item.canvasToInternalY(e.target.getAttr("y")),
            };
          }}
          dragBoundFunc={(pos) => {
            let { x, y } = pos;
            const { top, left, right, bottom } = item.selectedRegionsBBox;
            const { stageHeight, stageWidth } = item;

            const offset = {
              x: dragStartPointRef.current.x - left,
              y: dragStartPointRef.current.y - top,
            };

            x -= offset.x;
            y -= offset.y;

            const bbox = { x, y, width: right - left, height: bottom - top };

            const fixed = fixRectToFit(bbox, stageWidth, stageHeight);

            if (fixed.width !== bbox.width) {
              x += (fixed.width - bbox.width) * (fixed.x !== bbox.x ? -1 : 1);
            }

            if (fixed.height !== bbox.height) {
              y += (fixed.height - bbox.height) * (fixed.y !== bbox.y ? -1 : 1);
            }

            x += offset.x;
            y += offset.y;
            return { x, y };
          }}
        />
      )}
    </Layer>
  );
});

const SelectedRegions = observer(({ item, selectedRegions }) => {
  if (!selectedRegions) return null;
  const { brushRegions = [], shapeRegions = [] } = splitRegions(selectedRegions);

  return (
    <>
      {isFF(FF_LSDV_4930) ? null : <TransformerBack item={item} />}
      {brushRegions.length > 0 && (
        <Regions key="brushes" name="brushes" regions={brushRegions} useLayers={true} showSelected chankSize={0} />
      )}

      {shapeRegions.length > 0 && (
        <Regions key="shapes" name="shapes" regions={shapeRegions} showSelected chankSize={0} />
      )}
    </>
  );
});

const SelectionLayer = observer(({ item, selectionArea }) => {
  const scale = 1;
  const [isMouseWheelClick, setIsMouseWheelClick] = useState(false);
  const [shift, setShift] = useState(false);
  const isPanTool = item.getToolsManager().findSelectedTool()?.fullName === "ZoomPanTool";

  const dragHandler = (e) => setIsMouseWheelClick(e.buttons === 4);

  const handleKey = (e) => setShift(e.shiftKey);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    window.addEventListener("mousedown", dragHandler);
    window.addEventListener("mouseup", dragHandler);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
      window.removeEventListener("mousedown", dragHandler);
      window.removeEventListener("mouseup", dragHandler);
    };
  }, []);

  const disableTransform = item.zoomScale > 1 && (shift || isPanTool || isMouseWheelClick);

  let supportsTransform = true;
  let supportsRotate = true;
  let supportsScale = true;

  item.selectedRegions?.forEach((shape) => {
    supportsTransform = supportsTransform && shape.supportsTransform === true;
    supportsRotate = supportsRotate && shape.canRotate === true;
    supportsScale = supportsScale && true;
  });

  supportsTransform =
    supportsTransform &&
    (item.selectedRegions.length > 1 ||
      ((item.useTransformer || item.selectedShape?.preferTransformer) && item.selectedShape?.useTransformer));

  return (
    <Layer scaleX={scale} scaleY={scale}>
      {selectionArea.isActive ? (
        <SelectionRect item={selectionArea} />
      ) : !supportsTransform && item.selectedRegions.length > 1 ? (
        <SelectionBorders item={item} selectionArea={selectionArea} />
      ) : null}
      <ImageTransformer
        item={item}
        rotateEnabled={supportsRotate}
        supportsTransform={!disableTransform && supportsTransform}
        supportsScale={supportsScale}
        selectedShapes={item.selectedRegions}
        singleNodeMode={item.selectedRegions.length === 1}
        useSingleNodeRotation={item.selectedRegions.length === 1 && supportsRotate}
        draggableBackgroundSelector={`#${TRANSFORMER_BACK_ID}`}
      />
    </Layer>
  );
});

/**
 * Previously regions rerendered on window resize because of size recalculations,
 * but now they are rerendered just by mistake because of unmemoized `splitRegions` in main render.
 * This is temporary solution to pass in relevant props changed on window resize.
 */
const Selection = observer(({ item, ...triggeredOnResize }) => {
  const { selectionArea } = item;

  return (
    <>
      <Layer name="selection-regions-layer" />
      <SelectionLayer item={item} selectionArea={selectionArea} />
    </>
  );
});

const Crosshair = memo(
  forwardRef(({ width, height }, ref) => {
    const [pointsV, setPointsV] = useState([50, 0, 50, height]);
    const [pointsH, setPointsH] = useState([0, 100, width, 100]);
    const [x, setX] = useState(100);
    const [y, setY] = useState(50);

    const [visible, setVisible] = useState(false);
    const strokeWidth = 1;
    const dashStyle = [3, 3];
    const enableStrokeScale = false;

    if (ref) {
      ref.current = {
        updatePointer(newX, newY) {
          if (newX !== x) {
            setX(newX);
            setPointsV([newX, 0, newX, height]);
          }

          if (newY !== y) {
            setY(newY);
            setPointsH([0, newY, width, newY]);
          }
        },
        updateVisibility(visibility) {
          setVisible(visibility);
        },
      };
    }

    return (
      <Layer name="crosshair" listening={false} opacity={visible ? 0.6 : 0}>
        <Group>
          <Line
            name="v-white"
            points={pointsH}
            stroke="#fff"
            strokeWidth={strokeWidth}
            strokeScaleEnabled={enableStrokeScale}
          />
          <Line
            name="v-black"
            points={pointsH}
            stroke="#000"
            strokeWidth={strokeWidth}
            dash={dashStyle}
            strokeScaleEnabled={enableStrokeScale}
          />
        </Group>
        <Group>
          <Line
            name="h-white"
            points={pointsV}
            stroke="#fff"
            strokeWidth={strokeWidth}
            strokeScaleEnabled={enableStrokeScale}
          />
          <Line
            name="h-black"
            points={pointsV}
            stroke="#000"
            strokeWidth={strokeWidth}
            dash={dashStyle}
            strokeScaleEnabled={enableStrokeScale}
          />
        </Group>
      </Layer>
    );
  }),
);

const PixelGridLayer = observer(({ item }) => {
  const ZOOM_THRESHOLD = 20;

  const visible = item.zoomScale > ZOOM_THRESHOLD;
  const { naturalWidth, naturalHeight } = item.currentImageEntity ?? {};
  const { stageWidth, stageHeight } = item;
  const imageSmallerThanStage = naturalWidth < stageWidth || naturalHeight < stageHeight;

  const step = item.stageZoom; // image pixel

  const { verticalPoints, horizontalPoints } = useMemo(() => {
    const vPts = [];
    const hPts = [];

    // Grid starts from image origin (0, 0)
    for (let x = 0; x <= stageWidth; x += step) {
      vPts.push(x, 0, x, stageHeight, x, 0);
    }

    for (let y = 0; y <= stageHeight; y += step) {
      hPts.push(0, y, stageWidth, y, 0, y);
    }

    return { verticalPoints: vPts, horizontalPoints: hPts };
  }, [stageWidth, stageHeight]);

  return (
    <Layer listening={false} visible={visible}>
      <Line
        points={verticalPoints}
        stroke="white"
        strokeWidth={1}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        opacity={0.2}
        listening={false}
        visible={visible}
      />
      <Line
        points={horizontalPoints}
        stroke="white"
        strokeWidth={1}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        opacity={0.2}
        listening={false}
        visible={visible}
      />
    </Layer>
  );
});

/**
 * Component that creates an overlay on top
 * of the image to support Magic Wand tool
 */
const CanvasOverlay = observer(({ item }) => {
  return (
    <canvas
      className={styles.overlay}
      ref={(ref) => {
        item.setOverlayRef(ref);
      }}
      style={item.imageTransform}
    />
  );
});

export default observer(
  class ImageView extends Component {
    // stored position of canvas before creating region
    canvasX;
    canvasY;
    lastOffsetWidth = -1;
    lastOffsetHeight = -1;
    state = {
      imgStyle: {},
      pointer: [0, 0],
    };

    imageRef = createRef();
    crosshairRef = createRef();
    handleDeferredMouseDown = null;
    deferredClickTimeout = [];
    skipNextMouseDown = false;
    skipNextClick = false;
    skipNextMouseUp = false;
    mouseDownPoint = null;
    mouseDown = false;
    // Active touch-type pointers, tracked by pointerId. Two or more touches means a
    // pan/zoom gesture rather than drawing, so we abort the in-progress point and
    // stop routing draw events until all fingers lift.
    activeTouches = new Set();
    isGesture = false;
    // Latest screen position of each active touch pointer (pointerId -> {x, y}), plus
    // the pinch baseline (start distance + zoom) and last center. Used to drive
    // two-finger pinch-zoom / pan through the Image model's existing zoom actions.
    touchPoints = new Map();
    pinchState = null;

    constructor(props) {
      super(props);

      if (typeof props.item.smoothingEnabled === "boolean")
        props.store.settings.setSmoothing(props.item.smoothingEnabled);
    }

    handleOnClick = (e) => {
      const { item } = this.props;

      if (isFF(FF_DEV_1442)) {
        this.handleDeferredMouseDown?.(true);
      }
      if (this.skipNextClick) {
        this.skipNextClick = false;
        return;
      }

      const evt = e.evt || e;
      const { offsetX: x, offsetY: y } = evt;

      if (isFF(FF_LSDV_4930)) {
        // Konva can trigger click even on simple mouseup
        // You can try drag and drop interaction here https://konvajs.org/docs/events/Stage_Events.html and check the console
        // So here is false trigger preventing
        if (
          !this.mouseDownPoint ||
          Math.abs(this.mouseDownPoint.x - x) > 0.01 ||
          Math.abs(this.mouseDownPoint.y - y) > 0.01
        ) {
          this.mouseDownPoint = null;
          return;
        }
      }

      // We can only handle Bitmask selection here because the way it works -- it overlays an
      // entire stage with a single image that is not click-through, and there is no particular
      // shape we can click on. Here we're relying on cursor position and non-transparent pixels
      // of the mask to detect cursor-region collision.
      const allowedHoverTypes = /bitmask|vector/i;
      const hasSelected = item.selectedRegions.some((r) => r.type.match(allowedHoverTypes) !== null);
      const tool = item.getToolsManager().findSelectedTool();
      const isAllowedTool = tool?.toolName?.match?.(allowedHoverTypes) !== null ?? false;

      const hoveredRegion = item.regs.find((reg) => {
        if (reg.selected || tool?.mode === "drawing") return false;

        return reg.isHovered?.() ?? false;
      });

      if (hoveredRegion && !evt.defaultPrevented) {
        tool?.disable();
        hoveredRegion.onClickRegion(e);
        tool?.enable();
        return;
      }
      return item.event("click", evt, x, y);
    };

    resetDeferredClickTimeout = () => {
      if (this.deferredClickTimeout.length > 0) {
        this.deferredClickTimeout = this.deferredClickTimeout.filter((timeout) => {
          clearTimeout(timeout);
          return false;
        });
      }
    };

    handleDeferredClick = (handleDeferredMouseDownCallback, handleDeselection, eligibleToDeselect = false) => {
      this.handleDeferredMouseDown = (wasClicked) => {
        if (wasClicked && eligibleToDeselect) {
          handleDeselection();
        }
        handleDeferredMouseDownCallback();
        // mousedown should be called only once especially if it is called from mousemove interaction.
        this.handleDeferredMouseDown = null;
      };
      this.resetDeferredClickTimeout();
      this.deferredClickTimeout.push(
        setTimeout(
          () => {
            this.handleDeferredMouseDown?.(false);
          },
          this.props.item.annotation.isDrawing ? 0 : 100,
        ),
      );
    };

    handleMouseDown = (e) => {
      this.mouseDown = true;
      const { item } = this.props;

      // A multi-touch gesture (pan/zoom) is in progress: don't route as drawing.
      // Touch counting lives in the window-level pointer listeners (see below), which
      // are immune to Konva event-bubbling being cancelled by region/point handlers.
      if (this.isGesture) return;

      const isPanTool = item.getToolsManager().findSelectedTool()?.fullName === "ZoomPanTool";
      const isMoveTool = item.getToolsManager().findSelectedTool()?.fullName === "MoveTool";

      this.skipNextMouseDown = this.skipNextMouseUp = this.skipNextClick = false;
      if (isFF(FF_LSDV_4930)) {
        this.mouseDownPoint = { x: e.evt.offsetX, y: e.evt.offsetY };
      }

      item.updateSkipInteractions(e);

      const p = e.target.getParent();

      if (item.annotation.isReadOnly() && !isPanTool) return;
      if (p && p.className === "Transformer") return;

      const handleMouseDown = () => {
        if (e.evt.button === 1) {
          // prevent middle click from scrolling page
          e.evt.preventDefault();
        }

        const isRightElementToCatchToolInteractions = (el) => {
          // Bitmask is like Brush, so treat it the same
          // The only difference is that Bitmask doesn't have a group inside
          if (el.nodeType === "Layer" && !isMoveTool && el.attrs?.name === "bitmask") {
            return true;
          }

          // It could be ruler ot segmentation
          if (el.nodeType === "Group") {
            if (el?.attrs?.name === "ruler") {
              return true;
            }
            // segmentation is specific for Brushes
            // but click interaction on the region covers the case of the same MoveTool interaction here,
            // so it should ignore move tool interaction to prevent conflicts
            if (!isMoveTool && el?.attrs?.name === "segmentation") {
              return true;
            }
          }
          return false;
        };

        if (
          // create regions over another regions with Cmd/Ctrl pressed
          item.getSkipInteractions() ||
          e.target === item.stageRef ||
          findClosestParent(e.target, isRightElementToCatchToolInteractions)
        ) {
          window.addEventListener("pointermove", this.handleGlobalMouseMove);
          window.addEventListener("pointerup", this.handleGlobalMouseUp);
          const { offsetX: x, offsetY: y } = e.evt;
          // store the canvas coords for calculations in further events
          const { left, top } = item.containerRef.getBoundingClientRect();

          this.canvasX = left;
          this.canvasY = top;
          if (this.skipNextMouseDown) {
            this.skipNextMouseDown = false;
            return true;
          }
          item.event("mousedown", e, x, y);

          return true;
        }
      };

      const selectedTool = item.getToolsManager().findSelectedTool();
      const eligibleToolForDeselect = [
        undefined,
        "EllipseTool",
        "EllipseTool-dynamic",
        "RectangleTool",
        "RectangleTool-dynamic",
        "PolygonTool",
        "PolygonTool-dynamic",
        "Rectangle3PointTool",
        "Rectangle3PointTool-dynamic",
      ].includes(selectedTool?.fullName);

      if (isFF(FF_DEV_1442) && eligibleToolForDeselect) {
        const targetIsCanvas = e.target === item.stageRef;
        const annotationHasSelectedRegions = item.annotation.selectedRegions.length > 0;
        const eligibleToDeselect = targetIsCanvas && annotationHasSelectedRegions;

        const handleDeselection = () => {
          item.annotation.unselectAll();
          this.skipNextMouseDown = true;
          this.skipNextMouseUp = true;
          this.skipNextClick = true;
        };

        this.handleDeferredClick(handleMouseDown, handleDeselection, eligibleToDeselect);
        return;
      }

      const result = handleMouseDown();

      if (result) return result;

      return true;
    };

    /**
     * Mouse up outside the canvas
     */
    handleGlobalMouseUp = (e) => {
      window.removeEventListener("pointermove", this.handleGlobalMouseMove);
      window.removeEventListener("pointerup", this.handleGlobalMouseUp);

      if (e.target && e.target.tagName === "CANVAS") return;
      if (this.isGesture) return;

      const { item } = this.props;
      const { clientX: x, clientY: y } = e;

      item.freezeHistory();

      return this.triggerMouseUp(e, x - this.canvasX, y - this.canvasY);
    };

    handleGlobalMouseMove = (e) => {
      if (this.isGesture) return;
      if (e.target && e.target.tagName === "CANVAS") return;

      const { item } = this.props;
      const { clientX: x, clientY: y } = e;

      return item.event("mousemove", e, x - this.canvasX, y - this.canvasY);
    };

    // Touch counting is done at the window level (capture phase) so it is robust to
    // Konva event bubbling being cancelled by region/point handlers — which previously
    // left stale pointer ids around and wedged us in "gesture" mode (touch stopped
    // drawing entirely). Two or more concurrent touches => a pan/zoom gesture.
    handleWindowPointerDown = (e) => {
      // Reset on any fresh interaction (mouse click or first finger down).
      if (this.activeTouches.size === 0) this.isGesture = false;
      if (e.pointerType !== "touch") return;

      this.activeTouches.add(e.pointerId);
      this.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Finger count changed: re-baseline the pinch so distance/center jumps
      // (e.g. adding a 3rd finger) don't cause a sudden zoom/pan on the next move.
      this.pinchState = null;
      if (this.activeTouches.size >= 2 && !this.isGesture) {
        this.isGesture = true;
        // Cancel the point being placed; pan/zoom takes over (see handleWindowPointerMove).
        this.props.item.getToolsManager().findSelectedTool()?.abortPendingPoint?.();
      }
    };

    handleWindowPointerUp = (e) => {
      if (e.pointerType !== "touch") return;
      this.activeTouches.delete(e.pointerId);
      this.touchPoints.delete(e.pointerId);
      // Re-baseline the (possibly still ongoing) pinch after a finger lifts.
      this.pinchState = null;
      // Note: isGesture is intentionally NOT reset here — it is reset on the next
      // fresh interaction, so the final finger lifting doesn't commit a stray point.
    };

    // Two-finger pinch-zoom + pan. We reuse Label Studio's existing zoom engine
    // (`setZoom`/`setZoomPosition` — the same actions the mouse wheel and trackpad
    // drive) and only add the gesture glue: measure the distance and midpoint between
    // the two fingers. Tracked at the window level (capture phase) for the same reason
    // as the touch counting above — immune to Konva event bubbling being cancelled by
    // region/point handlers.
    //
    // Zoom is derived ABSOLUTELY from the gesture's start (startZoom * dist/startDist)
    // rather than frame-to-frame. This matters because each finger fires its own
    // pointermove events independently — they are never delivered in sync — so a
    // frame-to-frame distance ratio sees the spacing wobble as fingers update one at a
    // time, and that error accumulates into a spurious zoom drift during a pure pan.
    // An absolute mapping self-corrects: a momentarily-stale finger yields a transient
    // wrong value that is fixed on the very next event, with no accumulation. Pan stays
    // incremental — center deltas telescope to (finalCenter - startCenter) regardless
    // of intermediate staleness, so it doesn't drift either.
    handleWindowPointerMove = (e) => {
      if (e.pointerType !== "touch") return;
      this.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size < 2) return;

      const { item } = this.props;
      const container = item.stageRef?.container?.();

      if (!container) return;

      const ids = [...this.activeTouches];
      const p1 = this.touchPoints.get(ids[0]);
      const p2 = this.touchPoints.get(ids[1]);

      if (!p1 || !p2) return;

      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const rect = container.getBoundingClientRect();
      // Pinch center in stage-container coordinates — the same space as
      // stage.getPointerPosition(), which is what the zoom-to-point math expects.
      const cx = (p1.x + p2.x) / 2 - rect.left;
      const cy = (p1.y + p2.y) / 2 - rect.top;

      // First move of a gesture just establishes the baseline.
      if (!this.pinchState) {
        this.pinchState = { startDist: dist, startZoom: item.currentZoom, prevCx: cx, prevCy: cy };
        return;
      }

      const st = this.pinchState;

      // 1) Pan by how far the pinch center moved since the last event, so the content
      //    under the previous center follows to the current center.
      item.setZoomPosition(item.zoomingPositionX + (cx - st.prevCx), item.zoomingPositionY + (cy - st.prevCy));

      // 2) Zoom to the absolute target for the current finger spacing, pinning the
      //    current pinch center (zoom-to-point, same math as item.handleZoom). Cap at
      //    MAX_ZOOM (100) to match the wheel/trackpad zoom ceiling; setZoom floors at 1.
      const MAX_ZOOM = 100;
      const targetZoom = st.startDist > 0 ? Math.min(st.startZoom * (dist / st.startDist), MAX_ZOOM) : st.startZoom;

      let stageScale = item.zoomScale;
      const absX = (cx - item.zoomingPositionX) / stageScale;
      const absY = (cy - item.zoomingPositionY) / stageScale;

      item.setZoom(targetZoom);

      stageScale = item.zoomScale;
      item.setZoomPosition(cx - absX * stageScale, cy - absY * stageScale);

      item.updateImageAfterZoom();
      st.prevCx = cx;
      st.prevCy = cy;
    };

    /**
     * Mouse up on Stage
     */
    handleMouseUp = (e) => {
      this.mouseDown = false;
      const { item } = this.props;

      if (isFF(FF_DEV_1442)) {
        this.resetDeferredClickTimeout();
      }

      if (this.isGesture) return;

      item.freezeHistory();

      return this.triggerMouseUp(e, e.evt.offsetX, e.evt.offsetY);
    };

    triggerMouseUp = (e, x, y) => {
      if (this.skipNextMouseUp) {
        this.skipNextMouseUp = false;
        return;
      }
      const { item } = this.props;

      return item.event("mouseup", e, x, y);
    };

    handleMouseMove = (e) => {
      const { item } = this.props;

      // During a multi-touch gesture (pan/zoom) we don't route move events as drawing.
      if (this.isGesture) return;

      item.freezeHistory();

      this.updateCrosshair(e);

      const isMouseWheelClick = e.evt && e.evt.buttons === 4;
      const isDragging = e.evt && e.evt.buttons === 1;
      const isShiftDrag = isDragging && e.evt.shiftKey;

      if (isFF(FF_DEV_1442) && isDragging) {
        this.resetDeferredClickTimeout();
        this.handleDeferredMouseDown?.(false);
      }

      if ((isMouseWheelClick || isShiftDrag) && item.zoomScale > 1) {
        item.setSkipInteractions(true);
        e.evt.preventDefault();

        const newPos = {
          x: item.zoomingPositionX + e.evt.movementX,
          y: item.zoomingPositionY + e.evt.movementY,
        };

        item.setZoomPosition(newPos.x, newPos.y);
      } else {
        item.event("mousemove", e, e.evt.offsetX, e.evt.offsetY);
      }

      if (!e.evt.ctrlKey && !e.evt.shiftKey && !this.mouseDown) {
        const allowedTypes = /bitmask/;
        const tool = item.getToolsManager().findSelectedTool();

        if (item.regs.some((r) => r.isDrawing)) return;
        if (!item.regs.some((r) => r.type.match(allowedTypes) !== null)) return;

        // Exclusive to Vector but can be leveraged by other region types
        if (item.regs.some((r) => r.isTransforming?.())) return;

        requestAnimationFrame(() => {
          tool?.enable();
          for (const region of item.regs) {
            region.setHighlight(false);
            region.updateCursor(false);
          }

          for (const region of item.regs) {
            if (region.type.match(allowedTypes) === null) continue;

            const checkHover = !region.selected && !region.isDrawing;
            const hovered = (checkHover && region.isHovered?.()) ?? false;

            if (hovered) {
              tool?.disable();
              region.updateCursor(true);
              break;
            }
          }
        });
      }
    };

    updateCrosshair = (e) => {
      if (this.crosshairRef.current) {
        const { x, y } = e.currentTarget.getPointerPosition();
        this.crosshairRef.current.updatePointer(...this.props.item.fixZoomedCoords([x, y]));
      }
    };

    handleError = () => {
      const { item, store } = this.props;
      const cs = store.annotationStore;
      const message = getEnv(store).messages.ERR_LOADING_HTTP({
        attr: item.value,
        error: "",
        url: item.currentSrc,
      });

      cs.addErrors([errorBuilder.generalError(message)]);
    };

    updateGridSize = (range) => {
      const { item } = this.props;

      item.freezeHistory();

      item.setGridSize(range);
    };

    /**
     * Handle zoom and pan events from mouse wheel and trackpad
     * Supports:
     * - Ctrl/Cmd + mouse wheel: Smooth zoom in/out
     * - Ctrl/Cmd + trackpad pinch: Smooth pinch-to-zoom
     * - Two-finger scroll: Pan the image when zoomed in
     */
    handleZoom = (e) => {
      if (e.evt?.ctrlKey || e.evt?.metaKey) {
        e.evt.preventDefault();

        const { item } = this.props;
        const stage = item.stageRef;

        // Unified smooth zoom behavior for both trackpad and mouse wheel
        item.handleZoom(e.evt.deltaY, stage.getPointerPosition(), e.evt.ctrlKey);
      } else if (e.evt) {
        // Two fingers scroll (panning) - only when zoomed in
        const { item } = this.props;

        const maxScrollX = Math.round(item.stageWidth * item.zoomScale) - item.stageWidth;
        const maxScrollY = Math.round(item.stageHeight * item.zoomScale) - item.stageHeight;

        const newPos = {
          x: Math.min(0, Math.ceil(item.zoomingPositionX - e.evt.deltaX)),
          y: Math.min(0, Math.ceil(item.zoomingPositionY - e.evt.deltaY)),
        };

        // Calculate scroll boundaries to allow scrolling the page when reaching stage edges
        const withinX = newPos.x !== 0 && newPos.x > -maxScrollX && item.zoomScale !== 1;
        const withinY = newPos.y !== 0 && newPos.y > -maxScrollY && item.zoomScale !== 1;

        // Detect scroll direction
        const scrollingX = Math.abs(e.evt.deltaX) > Math.abs(e.evt.deltaY);
        const scrollingY = Math.abs(e.evt.deltaY) > Math.abs(e.evt.deltaX);

        if (withinX && scrollingX) e.evt.preventDefault();
        if (withinY && scrollingY) e.evt.preventDefault();

        item.setZoomPosition(newPos.x, newPos.y);
      }
    };

    renderRulers() {
      const { item } = this.props;
      const width = 1;
      const color = "white";

      return (
        <Group
          name="ruler"
          onClick={(ev) => {
            ev.cancelBubble = false;
          }}
        >
          <Line
            x={0}
            y={item.cursorPositionY}
            points={[0, 0, item.stageWidth, 0]}
            strokeWidth={width}
            stroke={color}
            tension={0}
            dash={[4, 4]}
            closed
          />
          <Line
            x={item.cursorPositionX}
            y={0}
            points={[0, 0, 0, item.stageHeight]}
            strokeWidth={width}
            stroke={color}
            tension={0}
            dash={[1.5]}
            closed
          />
        </Group>
      );
    }

    onResize = debounce(() => {
      requestAnimationFrame(() => {
        if (!this?.props?.item?.containerRef) return;
        const { offsetWidth, offsetHeight } = this.props.item.containerRef;

        if (this.props.item.naturalWidth <= 1) return;
        if (this.lastOffsetWidth === offsetWidth && this.lastOffsetHeight === offsetHeight) return;

        this.props.item.onResize(offsetWidth, offsetHeight, true);
        this.lastOffsetWidth = offsetWidth;
        this.lastOffsetHeight = offsetHeight;
      });
    }, 16);

    componentDidMount() {
      const { item } = this.props;

      window.addEventListener("resize", this.onResize);
      // Capture-phase touch counting + pinch/pan tracking for multi-touch gestures
      // (see handlers). Capture phase makes these immune to Konva cancelling bubbling.
      window.addEventListener("pointerdown", this.handleWindowPointerDown, true);
      window.addEventListener("pointermove", this.handleWindowPointerMove, true);
      window.addEventListener("pointerup", this.handleWindowPointerUp, true);
      window.addEventListener("pointercancel", this.handleWindowPointerUp, true);
      this.attachObserver(item.containerRef);
      this.updateReadyStatus();

      hotkeys.addDescription("shift", "Pan image");
    }

    attachObserver = (node) => {
      if (this.resizeObserver) this.detachObserver();

      if (node) {
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(node);
      }
    };

    detachObserver = () => {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    };

    componentWillUnmount() {
      this.detachObserver();
      window.removeEventListener("resize", this.onResize);
      window.removeEventListener("pointermove", this.handleGlobalMouseMove);
      window.removeEventListener("pointerup", this.handleGlobalMouseUp);
      window.removeEventListener("pointerdown", this.handleWindowPointerDown, true);
      window.removeEventListener("pointermove", this.handleWindowPointerMove, true);
      window.removeEventListener("pointerup", this.handleWindowPointerUp, true);
      window.removeEventListener("pointercancel", this.handleWindowPointerUp, true);

      hotkeys.removeDescription("shift");
    }

    componentDidUpdate() {
      this.onResize();
      this.updateReadyStatus();
    }

    updateReadyStatus() {
      const { item } = this.props;
      const { imageRef } = this;

      if (!item || !isAlive(item) || !imageRef.current) return;
      if (item.isReady !== imageRef.current.complete) item.setReady(imageRef.current.complete);
    }

    renderTools() {
      const { item, store } = this.props;

      if (store.annotationStore.viewingAll) return null;

      const tools = item.getToolsManager().allTools();

      return <Toolbar tools={tools} />;
    }

    render() {
      const { item, store } = this.props;

      // @todo stupid but required check for `resetState()`
      // when Image tries to render itself after detouching
      if (!isAlive(item)) return null;

      // TODO fix me
      if (!store.task || !item.currentSrc) return null;

      const containerStyle = {};

      const containerClassName = styles.container;

      const paginationEnabled = !!item.isMultiItem;

      if (getRoot(item).settings.fullscreen === false) {
        containerStyle.maxWidth = item.maxwidth;
        containerStyle.maxHeight = item.maxheight;
        containerStyle.width = item.width;
        containerStyle.height = item.height;
      }

      if (!store.settings.enableSmoothing && item.zoomScale > 1) {
        containerStyle.imageRendering = "pixelated";
      }

      const imagePositionClassnames = [
        styles.image_position,
        styles[`image_position__${item.verticalalignment === "center" ? "middle" : item.verticalalignment}`],
        styles[`image_position__${item.horizontalalignment}`],
      ];

      const wrapperClasses = [styles.wrapperComponent, item.images.length > 1 ? styles.withGallery : styles.wrapper];

      if (paginationEnabled) wrapperClasses.push(styles.withPagination);

      const [toolsReady, stageLoading] = [true, false];

      const imageIsLoaded = item.imageIsLoaded;
      const isViewingAll = store.annotationStore.viewingAll;

      return (
        <ObjectTag item={item} className={wrapperClasses.join(" ")}>
          {paginationEnabled ? (
            <div
              className={styles.pagination}
              title={isViewingAll ? "Pagination is not supported in View All Annotations" : undefined}
            >
              <Pagination
                size="small"
                outline={false}
                align="left"
                noPadding
                hotkey={{
                  prev: "image:prev",
                  next: "image:next",
                }}
                currentPage={item.currentImage + 1}
                totalPages={item.parsedValueList.length}
                onChange={(n) => item.setCurrentImage(n - 1)}
                pageSizeSelectable={false}
                disabled={isViewingAll}
              />
            </div>
          ) : null}

          <div
            ref={(node) => {
              item.setContainerRef(node);
              this.attachObserver(node);
            }}
            className={containerClassName}
            style={containerStyle}
          >
            <div
              ref={(node) => {
                this.filler = node;
              }}
              className={styles.filler}
              style={{ width: "100%", marginTop: item.fillerHeight }}
            />

            <Image
              ref={(ref) => {
                item.setImageRef(ref);
                this.imageRef.current = ref;
              }}
              usedValue={item.usedValue}
              imageEntity={item.currentImageEntity}
              imageTransform={item.imageTransform}
              updateImageSize={item.updateImageSize}
              size={item.canvasSize}
              overlay={<CanvasOverlay item={item} />}
            />
            {/* @todo this is dirty hack; rewrite to proper async waiting for data to load */}
            {stageLoading || !toolsReady ? (
              <div className={styles.loading}>
                <LoadingOutlined />
              </div>
            ) : imageIsLoaded ? (
              <EntireStage
                item={item}
                crosshairRef={this.crosshairRef}
                onClick={this.handleOnClick}
                imagePositionClassnames={imagePositionClassnames}
                state={this.state}
                onMouseEnter={() => {
                  if (this.crosshairRef.current) {
                    this.crosshairRef.current.updateVisibility(true);
                  }
                }}
                onMouseLeave={(e) => {
                  if (this.crosshairRef.current) {
                    this.crosshairRef.current.updateVisibility(false);
                  }
                  const { width: stageWidth, height: stageHeight } = item.canvasSize;
                  const { offsetX: mouseposX, offsetY: mouseposY } = e.evt;
                  const newEvent = { ...e };

                  if (mouseposX <= 0) {
                    e.offsetX = 0;
                  } else if (mouseposX >= stageWidth) {
                    e.offsetX = stageWidth;
                  }

                  if (mouseposY <= 0) {
                    e.offsetY = 0;
                  } else if (mouseposY >= stageHeight) {
                    e.offsetY = stageHeight;
                  }
                  this.handleMouseMove(newEvent);
                }}
                onDragMove={this.updateCrosshair}
                onMouseDown={this.handleMouseDown}
                onMouseMove={this.handleMouseMove}
                onMouseUp={this.handleMouseUp}
                onWheel={item.zoom ? this.handleZoom : () => {}}
              />
            ) : null}
            {imageIsLoaded && <Loupe item={item} />}
          </div>

          {toolsReady && imageIsLoaded && this.renderTools()}
          {item.images.length > 1 && (
            <div className={styles.gallery}>
              {item.images.map((src, i) => (
                <img
                  {...imgDefaultProps}
                  alt=""
                  key={src}
                  src={src}
                  className={i === item.currentImage && styles.active}
                  height="60"
                  onClick={() => item.setCurrentImage(i)}
                />
              ))}
            </div>
          )}
        </ObjectTag>
      );
    }
  },
);

const EntireStage = observer(
  ({
    item,
    imagePositionClassnames,
    state,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onDragMove,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onWheel,
    crosshairRef,
  }) => {
    const { store } = item;
    let size;
    let position;

    if (isFF(FF_ZOOM_OPTIM)) {
      size = {
        width: item.containerWidth,
        height: item.containerHeight,
      };
      position = {
        x: item.zoomingPositionX + item.alignmentOffset.x,
        y: item.zoomingPositionY + item.alignmentOffset.y,
      };
    } else {
      size = { ...item.canvasSize };
      position = {
        x: item.zoomingPositionX,
        y: item.zoomingPositionY,
      };
    }

    return (
      <Stage
        ref={(ref) => {
          item.setStageRef(ref);
          // Stop the browser from claiming touch drags as scroll/zoom. Without this the
          // browser fires `pointercancel` partway through a drag (after ~tens of px),
          // which freezes the ghost line and drops the in-progress point. We handle
          // pan/zoom ourselves. `user-select`/`touch-callout: none` also suppress the
          // long-press text-selection / callout menu that a press-and-hold would trigger.
          if (ref) {
            for (const el of [ref.content, ref.container?.()]) {
              if (!el) continue;
              el.style.touchAction = "none";
              el.style.userSelect = "none";
              el.style.webkitUserSelect = "none";
              el.style.webkitTouchCallout = "none";
            }
          }
        }}
        className={[styles["image-element"], ...imagePositionClassnames].join(" ")}
        width={size.width}
        height={size.height}
        scaleX={item.zoomScale}
        scaleY={item.zoomScale}
        x={position.x}
        y={position.y}
        offsetX={item.stageTranslate.x}
        offsetY={item.stageTranslate.y}
        rotation={item.rotation}
        // Unified Pointer Events: a single set of handlers serves mouse, touch and
        // pen. Konva's `pointer*` namespace fires once per interaction regardless of
        // input type, so we bind these instead of the mouse-only `onMouseDown`/`onClick`
        // events (which left touch/pen unhandled). `pointerclick` is the input-agnostic
        // equivalent of `click`/`tap`.
        onPointerClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onDragMove={onDragMove}
        onPointerDown={onMouseDown}
        onPointerMove={onMouseMove}
        onPointerUp={onMouseUp}
        // Suppress the browser context menu on the canvas: a touch long-press (the
        // normal press-and-hold to place a point) would otherwise pop it, and right-click
        // has no role on the drawing surface.
        onContextMenu={(e) => e.evt?.preventDefault?.()}
        onWheel={onWheel}
      >
        <StageContent item={item} store={store} state={state} crosshairRef={crosshairRef} />
      </Stage>
    );
  },
);

const ImageLayer = observer(({ item }) => {
  const imageEntity = item.currentImageEntity;
  const konvaImageRef = useRef();
  const currentSrc = imageEntity?.currentSrc;
  const [loadedImage, setLoadedImage] = useState(null);

  useEffect(() => {
    if (!imageEntity?.downloaded || !currentSrc) {
      setLoadedImage(null);
      return;
    }

    let cancelled = false;
    const img = new window.Image();

    if (item.imageCrossOrigin) img.crossOrigin = item.imageCrossOrigin;

    img.onload = () => {
      if (!cancelled) setLoadedImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setLoadedImage(null);
    };
    img.src = currentSrc;

    return () => {
      cancelled = true;
      img.src = ""; // Defensively immediately clear source to abandon decode and trigger GC
    };
  }, [imageEntity?.downloaded, currentSrc, item.imageCrossOrigin]);

  const { width, height } = useMemo(() => {
    return {
      width: imageEntity.naturalWidth,
      height: imageEntity.naturalHeight,
    };
  }, [imageEntity.naturalWidth, imageEntity.naturalHeight, item.stageWidth, item.stageHeight]);

  const brightness = mapKonvaBrightness(imageEntity.brightnessGrade);
  const contrast = imageEntity.contrastGrade - 100;

  useEffect(() => {
    const node = konvaImageRef.current;
    if (node && loadedImage) {
      try {
        // Force Konva cache reset and redraw when source/filters change.
        node.clearCache();
        node.cache({ pixelRatio: 1 });
        node.filters([Konva.Filters.Brighten, Konva.Filters.Contrast]);
        node.brightness(brightness);
        node.contrast(contrast);
      } catch {
        // Fallback to plain image draw if cache/filter pipeline fails.
        node.clearCache();
        node.filters([]);
      }
      node.getLayer()?.batchDraw();
    }
  }, [loadedImage, brightness, contrast, currentSrc]);

  return loadedImage ? (
    <Layer imageSmoothingEnabled={item.smoothingEnabled} scale={{ x: item.stageZoom, y: item.stageZoom }}>
      <KonvaImage
        key={currentSrc ?? "image-source"}
        ref={konvaImageRef}
        image={loadedImage}
        width={width}
        height={height}
        listening={false}
      />
    </Layer>
  ) : null;
});

const CursorLayer = observer(({ item, tool }) => {
  const [[x, y], setCursorPosition] = useState([0, 0]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!item.stageRef) return;
    const stage = item.stageRef;
    const onMouseMove = (e) => {
      const { x, y } = stage.getPointerPosition();
      const { x: deltaX, y: deltaY } = stage.position();
      const { x: scaleX, y: scaleY } = stage.scale();
      setCursorPosition([(x - deltaX) / scaleX, (y - deltaY) / scaleY]);
    };
    const onMouseEnter = () => {
      setVisible(true);
    };
    const onMouseLeave = () => {
      setVisible(false);
    };

    stage.on("mousemove", onMouseMove);
    stage.on("mouseenter", onMouseEnter);
    stage.on("mouseleave", onMouseLeave);

    return () => {
      stage.off("mousemove", onMouseMove);
      stage.off("mouseenter", onMouseEnter);
      stage.off("mouseleave", onMouseLeave);
    };
  }, [item.stageRef]);

  const size = useMemo(() => {
    return tool.strokeWidth * item.stageZoom;
  }, [tool.strokeWidth, item.stageZoom]);

  return visible ? (
    <Layer listening={false}>
      {tool.strokeWidth <= 2 ? (
        <>
          <Rect
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            stroke="black"
            strokeWidth={3}
            strokeScaleEnabled={false}
          />
          <Rect
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            stroke="white"
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        </>
      ) : (
        <>
          <Circle x={x} y={y} radius={size} stroke="black" strokeWidth={3} strokeScaleEnabled={false} />
          <Circle x={x} y={y} radius={size} stroke="white" strokeWidth={1} strokeScaleEnabled={false} />
        </>
      )}
    </Layer>
  ) : null;
});

const StageContent = observer(({ item, store, state, crosshairRef }) => {
  if (!isAlive(item)) return null;
  if (!store.task || !item.currentSrc) return null;

  // Keep selected or highlighted region on top
  const regions = [...item.regs].sort((r) => (r.highlighted || r.selected ? 1 : -1));
  const paginationEnabled = !!item.isMultiItem;
  const wrapperClasses = [styles.wrapperComponent, item.images.length > 1 ? styles.withGallery : styles.wrapper];
  const tool = item.getToolsManager().findSelectedTool();

  if (paginationEnabled) wrapperClasses.push(styles.withPagination);

  const { brushRegions, shapeRegions, bitmaskRegions } = splitRegions(regions);

  const {
    brushRegions: suggestedBrushRegions,
    shapeRegions: suggestedShapeRegions,
    bitmaskRegions: suggestedBitmaskRegions,
  } = splitRegions(item.suggestions);

  const renderableRegions = Object.entries({
    brush: brushRegions,
    shape: shapeRegions,
    bitmask: bitmaskRegions,
    suggestedBrush: suggestedBrushRegions,
    suggestedBismask: suggestedBitmaskRegions,
    suggestedShape: suggestedShapeRegions,
  });

  return (
    <>
      <ImageLayer item={item} />
      {item.grid && item.sizeUpdated && <ImageGrid item={item} />}

      {isFF(FF_LSDV_4930) ? <TransformerBack item={item} /> : null}

      {renderableRegions.map(([groupName, list]) => {
        const useLayers = true;
        const isSuggestion = groupName.match("suggested") !== null;

        return list.length > 0 ? (
          <Regions
            key={groupName}
            name={groupName}
            regions={list}
            useLayers={useLayers}
            suggestion={isSuggestion}
            smoothing={item.smoothingEnabled}
          />
        ) : (
          <Fragment key={groupName} />
        );
      })}
      <Selection item={item} isPanning={state.isPanning} />
      <DrawingRegion item={item} />
      {item.smoothingEnabled === false && <PixelGridLayer item={item} />}

      {item.crosshair && (
        <Crosshair
          ref={crosshairRef}
          width={isFF(FF_ZOOM_OPTIM) ? item.containerWidth : item.stageWidth}
          height={isFF(FF_ZOOM_OPTIM) ? item.containerHeight : item.stageHeight}
        />
      )}

      {tool && tool.toolName?.match(/bitmask/i) && <CursorLayer item={item} tool={tool} />}
    </>
  );
});
