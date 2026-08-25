import { InfoIcon } from "@humansignal/icons";
import { Button } from "@humansignal/ui";
import { isStarterCloudPlan } from "@humansignal/core";
import { cn } from "../../utils/bem";
import { AutoAcceptToggle } from "../AnnotationTab/AutoAcceptToggle";
import { DynamicPreannotationsToggle } from "../AnnotationTab/DynamicPreannotationsToggle";
import { GroundTruth } from "../CurrentEntity/GroundTruth";
import { ProjectCoursesBottomBarButton } from "./ProjectCoursesBottomBarButton";
import "./Actions.prefix.css";

export const Actions = ({ store }) => {
  const annotationStore = store.annotationStore;
  const entity = annotationStore.selected;
  const isViewAll = annotationStore.viewingAll === true;
  const isBulkMode = !isStarterCloudPlan() && store.hasInterface("annotation:bulk");
  const hideInstructionsForCourses = store.hideInstructionsForCourses === true;
  const showInstructions = store.description && store.hasInterface("instruction") && !hideInstructionsForCourses;

  return (
    <div className={cn("bottombar").elem("section").toClassName()}>
      <div className={cn("action-buttons").toClassName()}>
        <ProjectCoursesBottomBarButton store={store} />
        {showInstructions && (
          <Button
            type="text"
            aria-label="Instructions"
            size="small"
            variant="neutral"
            look="string"
            tooltip="Show instructions"
            onClick={() => store.toggleDescription()}
            className="aspect-square"
            leading={<InfoIcon size={24} />}
            data-testid="bottombar-instructions-button"
          />
        )}
      </div>

      {store.hasInterface("ground-truth") && !isBulkMode && <GroundTruth entity={entity} />}

      {!isViewAll && (
        <div className={cn("model-actions").toClassName()}>
          <DynamicPreannotationsToggle />
          <AutoAcceptToggle />
        </div>
      )}
    </div>
  );
};
