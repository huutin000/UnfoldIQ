import { Composition } from "remotion";
import { Blank } from "./compositions/Blank";
import { UnfoldiqVideo } from "./UnfoldiqVideo";
import { calculateUnfoldiqMetadata } from "./remotion-entry";
import type { UnfoldiqRenderInput } from "./runtime/types";

const defaultUnfoldiqProps: UnfoldiqRenderInput = {
  version: "1.0.0",
  projectId: "default",
  platform: "youtube",
  composition: {
    id: "UNFOLDIQVideo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    durationInFrames: 150,
    background: "#0b0e14",
    outputName: "unfoldiq.mp4",
  },
  timeline: { actualTimelineEndMs: 5000, sources: [] },
  scenes: [
    {
      sceneId: "scene-01",
      startMs: 0,
      endMs: 5000,
      durationMs: 5000,
      background: "#0b0e14",
      layers: [
        {
          layerId: "title-01",
          kind: "TEXT",
          text: "UNFOLDIQ",
          position: { xPct: 50, yPct: 42 },
          widthPct: 80,
          align: "center",
          typographyToken: "title",
          enter: "FADE",
          exit: "FADE",
          startMs: 0,
          endMs: 5000,
        },
      ],
      transition: { type: "CUT" },
    },
  ],
  assets: {},
  audio: { voice: [], music: [], sfx: [] },
  captions: { mode: "NONE", items: [] },
  status: "READY",
  debug: false,
};

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="blank"
        component={Blank}
        durationInFrames={60}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="UNFOLDIQVideo"
        component={UnfoldiqVideo}
        calculateMetadata={({ props }) => {
          const meta = calculateUnfoldiqMetadata(props);
          return {
            durationInFrames: meta.durationInFrames,
            fps: meta.fps,
            width: meta.width,
            height: meta.height,
          };
        }}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={150}
        defaultProps={defaultUnfoldiqProps}
      />
    </>
  );
};