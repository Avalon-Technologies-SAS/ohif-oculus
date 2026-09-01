import {
  PanTool,
  WindowLevelTool,
  SegmentBidirectionalTool,
  StackScrollTool,
  VolumeRotateTool,
  ZoomTool,
  MIPJumpToClickTool,
  LengthTool,
  RectangleROITool,
  RectangleROIThresholdTool,
  EllipticalROITool,
  CircleROITool,
  BidirectionalTool,
  ArrowAnnotateTool,
  DragProbeTool,
  ProbeTool,
  AngleTool,
  CobbAngleTool,
  MagnifyTool,
  CrosshairsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  CircleScissorsTool,
  BrushTool,
  PaintFillTool,
  init,
  addTool,
  annotation,
  ReferenceLinesTool,
  TrackballRotateTool,
  AdvancedMagnifyTool,
  UltrasoundDirectionalTool,
  UltrasoundPleuraBLineTool,
  PlanarFreehandROITool,
  PlanarFreehandContourSegmentationTool,
  PlanarRotateTool,
  SplineROITool,
  LivewireContourTool,
  OrientationMarkerTool,
  WindowLevelRegionTool,
  SegmentSelectTool,
  RegionSegmentPlusTool,
  SegmentLabelTool,
  LivewireContourSegmentationTool,
  SculptorTool,
  SplineContourSegmentationTool,
  LabelMapEditWithContourTool,
} from '@cornerstonejs/tools';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

import CalibrationLineTool from './tools/CalibrationLineTool';
import ImageOverlayViewerTool from './tools/ImageOverlayViewerTool';

// '@cornerstonejs/ai' eagerly imports onnxruntime-web's webgpu backend, whose
// bundled Emscripten loader throws `ReferenceError: __filename is not defined`
// in this webpack build. Loading it lazily keeps that failure from crashing
// the whole viewer on startup; AI segmentation tools just won't register if it fails.
function registerAiTools() {
  import('@cornerstonejs/ai')
    .then(({ LabelmapSlicePropagationTool, MarkerLabelmapTool }) => {
      LabelmapSlicePropagationTool.isAnnotation = false;
      MarkerLabelmapTool.isAnnotation = false;
      addTool(LabelmapSlicePropagationTool);
      addTool(MarkerLabelmapTool);
    })
    .catch(error => {
      console.warn('AI segmentation tools failed to load and will be unavailable', error);
    });
}

export default function initCornerstoneTools(configuration = {}) {
  CrosshairsTool.isAnnotation = false;
  ReferenceLinesTool.isAnnotation = false;
  AdvancedMagnifyTool.isAnnotation = false;
  PlanarFreehandContourSegmentationTool.isAnnotation = false;

  init({
    addons: {
      polySeg,
    },
    computeWorker: {
      autoTerminateOnIdle: {
        enabled: false,
      },
    },
  });
  addTool(PanTool);
  addTool(SegmentBidirectionalTool);
  addTool(WindowLevelTool);
  addTool(StackScrollTool);
  addTool(VolumeRotateTool);
  addTool(ZoomTool);
  addTool(ProbeTool);
  addTool(MIPJumpToClickTool);
  addTool(LengthTool);
  addTool(RectangleROITool);
  addTool(RectangleROIThresholdTool);
  addTool(EllipticalROITool);
  addTool(CircleROITool);
  addTool(BidirectionalTool);
  addTool(ArrowAnnotateTool);
  addTool(DragProbeTool);
  addTool(AngleTool);
  addTool(CobbAngleTool);
  addTool(MagnifyTool);
  addTool(CrosshairsTool);
  addTool(RectangleScissorsTool);
  addTool(SphereScissorsTool);
  addTool(CircleScissorsTool);
  addTool(BrushTool);
  addTool(PaintFillTool);
  addTool(ReferenceLinesTool);
  addTool(CalibrationLineTool);
  addTool(TrackballRotateTool);
  addTool(ImageOverlayViewerTool);
  addTool(AdvancedMagnifyTool);
  addTool(UltrasoundDirectionalTool);
  addTool(UltrasoundPleuraBLineTool);
  addTool(PlanarFreehandROITool);
  addTool(PlanarRotateTool);
  addTool(SplineROITool);
  addTool(LivewireContourTool);
  addTool(OrientationMarkerTool);
  addTool(WindowLevelRegionTool);
  addTool(PlanarFreehandContourSegmentationTool);
  addTool(SegmentSelectTool);
  addTool(SegmentLabelTool);
  registerAiTools();
  addTool(RegionSegmentPlusTool);
  addTool(LivewireContourSegmentationTool);
  addTool(SculptorTool);
  addTool(SplineContourSegmentationTool);
  addTool(LabelMapEditWithContourTool);
  // Modify annotation tools to use dashed lines on SR
  const annotationStyle = {
    textBoxFontSize: '15px',
    lineWidth: '1.5',
  };

  const defaultStyles = annotation.config.style.getDefaultToolStyles();
  annotation.config.style.setDefaultToolStyles({
    global: {
      ...defaultStyles.global,
      ...annotationStyle,
    },
  });
}

const toolNames = {
  Pan: PanTool.toolName,
  ArrowAnnotate: ArrowAnnotateTool.toolName,
  WindowLevel: WindowLevelTool.toolName,
  StackScroll: StackScrollTool.toolName,
  Zoom: ZoomTool.toolName,
  VolumeRotate: VolumeRotateTool.toolName,
  MipJumpToClick: MIPJumpToClickTool.toolName,
  Length: LengthTool.toolName,
  DragProbe: DragProbeTool.toolName,
  Probe: ProbeTool.toolName,
  RectangleROI: RectangleROITool.toolName,
  RectangleROIThreshold: RectangleROIThresholdTool.toolName,
  EllipticalROI: EllipticalROITool.toolName,
  CircleROI: CircleROITool.toolName,
  Bidirectional: BidirectionalTool.toolName,
  Angle: AngleTool.toolName,
  CobbAngle: CobbAngleTool.toolName,
  Magnify: MagnifyTool.toolName,
  Crosshairs: CrosshairsTool.toolName,
  Brush: BrushTool.toolName,
  PaintFill: PaintFillTool.toolName,
  ReferenceLines: ReferenceLinesTool.toolName,
  CalibrationLine: CalibrationLineTool.toolName,
  TrackballRotateTool: TrackballRotateTool.toolName,
  CircleScissors: CircleScissorsTool.toolName,
  RectangleScissors: RectangleScissorsTool.toolName,
  SphereScissors: SphereScissorsTool.toolName,
  ImageOverlayViewer: ImageOverlayViewerTool.toolName,
  AdvancedMagnify: AdvancedMagnifyTool.toolName,
  UltrasoundDirectional: UltrasoundDirectionalTool.toolName,
  UltrasoundAnnotation: UltrasoundPleuraBLineTool.toolName,
  SplineROI: SplineROITool.toolName,
  LivewireContour: LivewireContourTool.toolName,
  PlanarFreehandROI: PlanarFreehandROITool.toolName,
  PlanarRotate: PlanarRotateTool.toolName,
  OrientationMarker: OrientationMarkerTool.toolName,
  WindowLevelRegion: WindowLevelRegionTool.toolName,
  PlanarFreehandContourSegmentation: PlanarFreehandContourSegmentationTool.toolName,
  SegmentBidirectional: SegmentBidirectionalTool.toolName,
  SegmentSelect: SegmentSelectTool.toolName,
  SegmentLabel: SegmentLabelTool.toolName,
  // Matches @cornerstonejs/ai's static toolName values; kept as literals since
  // that package is now loaded lazily (see registerAiTools above).
  LabelmapSlicePropagation: 'LabelmapSlicePropagation',
  MarkerLabelmap: 'MarkerLabelmap',
  RegionSegmentPlus: RegionSegmentPlusTool.toolName,
  LivewireContourSegmentation: LivewireContourSegmentationTool.toolName,
  SculptorTool: SculptorTool.toolName,
  SplineContourSegmentation: SplineContourSegmentationTool.toolName,
  LabelMapEditWithContourTool: LabelMapEditWithContourTool.toolName,
};

export { toolNames };
