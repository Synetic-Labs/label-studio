import { observer } from "mobx-react";
import { types } from "mobx-state-tree";

import LabelMixin from "../../mixins/LabelMixin";
import Registry from "../../core/Registry";
import SelectedModelMixin from "../../mixins/SelectedModel";
import Types from "../../core/Types";
import { HtxLabels, LabelsModel } from "./Labels/Labels";
import { PolygonModel } from "./Polygon";
import ControlBase from "./Base";

/**
 * The `PolygonLabels` tag is used to create labeled polygons. Use to apply labels to polygons in semantic segmentation tasks.
 *
 * Use with the following data types: image.
 * @example
 * <!--Basic labeling configuration for polygonal semantic segmentation of images -->
 * <View>
 *   <Image name="image" value="$image" />
 *   <PolygonLabels name="labels" toName="image">
 *     <Label value="Car" />
 *     <Label value="Sign" />
 *   </PolygonLabels>
 * </View>
 * @name PolygonLabels
 * @regions PolygonRegion
 * @meta_title Polygon Label Tag for Labeling Polygons in Images
 * @meta_description Customize Label Studio with the PolygonLabels tag and label polygons in images for semantic segmentation machine learning and data science projects.
 * @param {string} name                             - Name of tag
 * @param {string} toName                           - Name of image to label
 * @param {single|multiple=} [choice=single]        - Configure whether you can select one or multiple labels
 * @param {number} [maxUsages]                      - Maximum number of times a label can be used per task
 * @param {boolean} [showInline=true]               - Show labels in the same visual line
 * @param {number} [opacity=0.2]                    - Opacity of polygon
 * @param {string} [fillColor]                      - Polygon fill color in hexadecimal
 * @param {string} [strokeColor]                    - Stroke color in hexadecimal
 * @param {number} [strokeWidth=1]                  - Width of stroke
 * @param {small|medium|large|number} [pointSize=medium] - Size of polygon handle points (a number is the radius in screen px, e.g. `18` for touch)
 * @param {number} [pointOpacity=1]                  - Opacity of the handle points (0-1)
 * @param {rectangle|circle} [pointStyle=rectangle] - Style of points
 * @param {string} [highlightColor=red]              - Stroke color of the selected polygon (and its dashed outer quad)
 * @param {string} [outerFill]                       - With `outerRatio`: fill the band between the polygon and the projected outer quad with this color (uses `opacity`) instead of filling the polygon
 * @param {pixel|none} [snap=none]                  - Snap polygon to image pixels
 * @param {number} [fixedPoints]                     - Fixed number of vertices (>= 3): the polygon closes automatically after the Nth point and vertices cannot be added or removed (e.g. `4` for quads)
 * @param {number} [outerRatio]                      - For 4-point polygons, draw a dashed outer quad: the perspective (homography) projection of the quad scaled by this ratio about its centre (e.g. `1.8` = a racing gate's outer frame predicted from its inner opening)
 * @example
 * <!--Drone-racing gates: tap the four inner corners of each gate; the polygon closes itself on the 4th
 *     corner and a dashed outer frame is projected from them, so a corner grabbed on the wrong plane
 *     shows up immediately. Label as many gates per image as needed. -->
 * <View>
 *   <Image name="image" value="$image" zoom="true" />
 *   <PolygonLabels name="gate" toName="image" fixedPoints="4" outerRatio="1.8" outerFill="#3D5AFE" opacity="0.45"
 *                  pointSize="18" pointOpacity="0.6" highlightColor="#FF00FF">
 *     <Label value="add gate" alias="gate" background="#39FF14" />
 *   </PolygonLabels>
 * </View>
 */

const Validation = types.model({
  controlledTags: Types.unionTag(["Image"]),
});

const ModelAttrs = types.model("PolygonLabelsModel", {
  type: "polygonlabels",
  children: Types.unionArray(["label", "header", "view", "hypertext"]),
});

const Composition = types.compose(
  ControlBase,
  LabelsModel,
  ModelAttrs,
  PolygonModel,
  Validation,
  LabelMixin,
  SelectedModelMixin.props({ _child: "LabelModel" }),
);

const PolygonLabelsModel = types.compose("PolygonLabelsModel", Composition);

const HtxPolygonLabels = observer(({ item }) => {
  return <HtxLabels item={item} />;
});

Registry.addTag("polygonlabels", PolygonLabelsModel, HtxPolygonLabels);

export { HtxPolygonLabels, PolygonLabelsModel };
