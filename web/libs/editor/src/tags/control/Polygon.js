import { types } from "mobx-state-tree";

import Registry from "../../core/Registry";
import { Hotkey } from "../../core/Hotkey";
import ControlBase from "./Base";
import { customTypes } from "../../core/CustomTypes";
import Types from "../../core/Types";
import { AnnotationMixin } from "../../mixins/AnnotationMixin";
import SeparatedControlMixin from "../../mixins/SeparatedControlMixin";
import { ToolManagerMixin } from "../../mixins/ToolManagerMixin";

const hotkeys = Hotkey("Polygons");

/**
 * The `Polygon` tag is used to add polygons to an image without selecting a label. This can be useful when you have only one label to assign to the polygon. Use for image segmentation tasks.
 *
 * Use with the following data types: image.
 * @example
 * <!--Basic labeling configuration for polygonal image segmentation -->
 * <View>
 *   <Polygon name="rect-1" toName="img-1" />
 *   <Image name="img-1" value="$img" />
 * </View>
 * @name Polygon
 * @meta_title Polygon Tag for Adding Polygons to Images
 * @meta_description Customize Label Studio with the Polygon tag by adding polygons to images for segmentation machine learning and data science projects.
 * @param {string} name                           - Name of tag
 * @param {string} toname                         - Name of image to label
 * @param {number} [opacity=0.6]                  - Opacity of polygon
 * @param {string} [fillColor=transparent]        - Polygon fill color in hexadecimal or HTML color name
 * @param {string} [strokeColor=#f48a42]          - Stroke color in hexadecimal
 * @param {number} [strokeWidth=3]                - Width of stroke
 * @param {small|medium|large|number} [pointSize=small] - Size of polygon handle points (a number is the radius in screen px, e.g. `18` for touch)
 * @param {number} [pointOpacity=1]                - Opacity of the handle points (0-1)
 * @param {rectangle|circle} [pointStyle=circle]  - Style of points
 * @param {string} [highlightColor=red]            - Stroke color of the selected polygon (and its dashed outer quad)
 * @param {string} [outerFill]                     - With `outerRatio`: fill the band between the polygon and the projected outer quad with this color (uses `opacity`) instead of filling the polygon
 * @param {boolean} [smart]                       - Show smart tool for interactive pre-annotations
 * @param {boolean} [smartOnly]                   - Only show smart tool for interactive pre-annotations
 * @param {pixel|none} [snap=none]                - Snap polygon to image pixels
 * @param {number} [fixedPoints]                   - Fixed number of vertices (>= 3): the polygon closes automatically after the Nth point and vertices cannot be added or removed (e.g. `4` for quads)
 * @param {number} [outerRatio]                    - For 4-point polygons, draw a dashed outer quad: the perspective (homography) projection of the quad scaled by this ratio about its centre (e.g. `1.8` = a racing gate's outer frame predicted from its inner opening)
 */
const TagAttrs = types.model({
  toname: types.maybeNull(types.string),

  opacity: types.optional(customTypes.range(), "0.2"),
  fillcolor: types.optional(customTypes.color, "#f48a42"),

  strokewidth: types.optional(types.string, "2"),
  strokecolor: types.optional(customTypes.color, "#f48a42"),

  snap: types.optional(types.string, "none"),

  pointsize: types.optional(types.string, "small"),
  pointstyle: types.optional(types.string, "circle"),
  pointopacity: types.optional(types.string, "1"),
  highlightcolor: types.maybeNull(customTypes.color),
  outerfill: types.maybeNull(customTypes.color),

  fixedpoints: types.maybeNull(types.string),
  outerratio: types.maybeNull(types.string),
});

const Validation = types.model({
  controlledTags: Types.unionTag(["Image"]),
});

const Model = types
  .model({
    type: "polygon",

    // regions: types.array(RectRegionModel),
    _value: types.optional(types.string, ""),
  })
  .volatile(() => ({
    toolNames: ["Polygon"],
  }))
  .views((self) => ({
    // Fixed vertex count (auto-close at N, no insert/delete), or null when free-form.
    get fixedPoints() {
      const n = Number.parseInt(self.fixedpoints, 10);

      return Number.isInteger(n) && n >= 3 ? n : null;
    },
    // Outer/inner ratio of the dashed projected quad drawn for 4-point polygons, or null.
    get outerRatio() {
      const r = Number.parseFloat(self.outerratio);

      return Number.isFinite(r) && r > 0 && r !== 1 ? r : null;
    },
    // Handle-point opacity in [0, 1] (1 = opaque, the upstream look).
    get pointOpacity() {
      const o = Number.parseFloat(self.pointopacity);

      return Number.isFinite(o) ? Math.min(Math.max(o, 0), 1) : 1;
    },
    // Stroke color for the selected polygon, or null for the app-wide highlight color.
    get highlightColor() {
      return self.highlightcolor ?? null;
    },
    // With `outerRatio`: fill color of the BAND between the polygon and its projected outer
    // quad (the physical frame), instead of the polygon's interior. `opacity` applies.
    get outerFill() {
      return self.outerfill ?? null;
    },
  }))
  .actions((self) => {
    return {
      initializeHotkeys() {
        hotkeys.addNamed("polygon:undo", () => {
          if (self.annotation?.selected && self.annotation.isDrawing) self.annotation.undo();
        });
        hotkeys.addNamed("polygon:redo", () => {
          if (self.annotation?.selected && self.annotation.isDrawing) self.annotation.redo();
        });
      },

      disposeHotkeys() {
        hotkeys.removeNamed("polygon:undo");
        hotkeys.removeNamed("polygon:redo");
      },

      afterCreate() {
        self.initializeHotkeys();
      },

      beforeDestroy() {
        self.disposeHotkeys();
      },
    };
  });

const PolygonModel = types.compose(
  "PolygonModel",
  ControlBase,
  AnnotationMixin,
  SeparatedControlMixin,
  TagAttrs,
  Validation,
  ToolManagerMixin,
  Model,
);

const HtxView = () => null;

Registry.addTag("polygon", PolygonModel, HtxView);

export { HtxView, PolygonModel };
