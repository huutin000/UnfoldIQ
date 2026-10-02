import { interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";

export const Blank: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const backgroundColor = interpolateColors(
    frame,
    [0, durationInFrames / 2, durationInFrames],
    ["hsl(220, 100%, 10%)", "hsl(280, 100%, 10%)", "hsl(220, 100%, 10%)"]
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontFamily: "system-ui, sans-serif",
        fontSize: "48px",
        fontWeight: "bold",
      }}
    >
      UNFOLDIQ — Blank Composition
    </div>
  );
};