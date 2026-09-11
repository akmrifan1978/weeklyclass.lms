import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Image as SvgImage, Path, Rect } from 'react-native-svg';

import { colors, radius } from '@/constants/theme';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  HIGHLIGHT_OPACITY,
  strokeHitBy,
  strokePath,
  thin,
  type PenTool,
  type Stroke,
} from './strokes';

/**
 * The teaching board.
 *
 * A page that takes handwriting from a stylus, a finger or a mouse and keeps
 * it as strokes rather than pixels — see strokes.ts for why that shape.
 *
 * HOW THE DRAWING IS DONE, and why it looks like this:
 *
 * The stroke in progress is held in a ref and mirrored into one piece of state
 * that is replaced on every move. Keeping the whole stroke list in state and
 * appending to it would re-render every finished stroke on every sample — sixty
 * times a second, for a page that might hold two hundred of them — and the line
 * would visibly lag behind the nib. Finished strokes are rendered from props
 * and never touched while drawing; only the live one moves.
 *
 * PanResponder rather than a gesture library because it is in React Native
 * itself and behaves the same on the web build, where a teacher on a laptop is
 * using a mouse and a student on a tablet is using a finger. Pressure is not
 * read: it is unavailable through this path on the web, and a line whose weight
 * changes on one device and not another is worse than an even one.
 */
export function DrawCanvas({
  strokes,
  onChange,
  tool,
  color,
  width,
  backgroundUrl,
  readOnly = false,
  /** Ruled like an exercise book, which is what people expect to write on. */
  ruled = true,
}: {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  tool: PenTool;
  color: string;
  width: number;
  backgroundUrl?: string | null;
  readOnly?: boolean;
  ruled?: boolean;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [live, setLive] = useState<Stroke | null>(null);

  const liveRef = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  // Kept in refs so the responder, which is built once, always reads the
  // current tool rather than the one selected when it was created.
  const settings = useRef({ tool, color, width });
  settings.current = { tool, color, width };

  const scale = box.width > 0 ? CANVAS_WIDTH / box.width : 1;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w } = event.nativeEvent.layout;
    setBox({ width: w, height: (w * CANVAS_HEIGHT) / CANVAS_WIDTH });
  }, []);

  const erase = useCallback((x: number, y: number) => {
    const remaining = strokesRef.current.filter((s) => !strokeHitBy(s, x, y));
    if (remaining.length !== strokesRef.current.length) {
      strokesRef.current = remaining;
      onChange(remaining);
    }
  }, [onChange]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !readOnly,
        onMoveShouldSetPanResponder: () => !readOnly,
        // The page sits inside a scrolling form. Without this the first
        // movement is claimed by the scroll view and the stroke never starts.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (event) => {
          const k = scaleRef.current;
          const x = event.nativeEvent.locationX * k;
          const y = event.nativeEvent.locationY * k;
          const { tool: t, color: c, width: w } = settings.current;

          if (t === 'eraser') {
            erase(x, y);
            return;
          }
          const started: Stroke = { tool: t, color: c, width: w, points: [x, y] };
          liveRef.current = started;
          setLive(started);
        },

        onPanResponderMove: (event) => {
          const k = scaleRef.current;
          const x = event.nativeEvent.locationX * k;
          const y = event.nativeEvent.locationY * k;

          if (settings.current.tool === 'eraser') {
            erase(x, y);
            return;
          }
          const current = liveRef.current;
          if (!current) return;
          current.points.push(x, y);
          // A new object each time, or React sees the same reference and skips
          // the render — the line would only appear when the hand lifted.
          setLive({ ...current, points: current.points });
        },

        onPanResponderRelease: () => {
          const finished = liveRef.current;
          liveRef.current = null;
          setLive(null);
          if (!finished || finished.points.length < 2) return;
          const kept: Stroke = { ...finished, points: thin(finished.points) };
          const next = [...strokesRef.current, kept];
          strokesRef.current = next;
          onChange(next);
        },

        onPanResponderTerminate: () => {
          // A stroke interrupted by the system is still a stroke the hand made.
          const finished = liveRef.current;
          liveRef.current = null;
          setLive(null);
          if (!finished || finished.points.length < 2) return;
          const next = [...strokesRef.current, { ...finished, points: thin(finished.points) }];
          strokesRef.current = next;
          onChange(next);
        },
      }),
    [erase, onChange, readOnly]
  );

  const rules = useMemo(() => {
    if (!ruled) return [];
    const lines: number[] = [];
    for (let y = 120; y < CANVAS_HEIGHT - 40; y += 80) lines.push(y);
    return lines;
  }, [ruled]);

  const handlers = readOnly ? {} : responder.panHandlers;

  return (
    <View
      style={[styles.frame, box.height ? { height: box.height } : null]}
      onLayout={onLayout}
      {...handlers}
    >
      {box.width > 0 ? (
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          // The page must not intercept the gestures; the View above owns them.
          pointerEvents="none"
        >
          <Rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill={colors.surface} />

          {/* A photograph of the whiteboard, or a page to annotate on top of. */}
          {backgroundUrl ? (
            <SvgImage
              x={0}
              y={0}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              href={{ uri: backgroundUrl }}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : null}

          {rules.map((y) => (
            <Path
              key={y}
              d={`M40 ${y} L${CANVAS_WIDTH - 40} ${y}`}
              stroke={colors.divider}
              strokeWidth={1.5}
            />
          ))}

          {/* Highlighter first, so ink is never buried under a marker stroke
              drawn afterwards — which is how a real highlighter behaves. */}
          {strokes
            .filter((s) => s.tool === 'highlighter')
            .map((s, i) => (
              <Path
                key={`h${i}`}
                d={strokePath(s)}
                stroke={s.color}
                strokeWidth={s.width}
                strokeOpacity={HIGHLIGHT_OPACITY}
                strokeLinecap="square"
                strokeLinejoin="round"
                fill="none"
              />
            ))}

          {strokes
            .filter((s) => s.tool === 'pen')
            .map((s, i) => (
              <Path
                key={`p${i}`}
                d={strokePath(s)}
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}

          {live ? (
            <Path
              d={strokePath(live)}
              stroke={live.color}
              strokeWidth={live.width}
              strokeOpacity={live.tool === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
              strokeLinecap={live.tool === 'highlighter' ? 'square' : 'round'}
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
});
