import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';

import type { CachedVersion, VersionField } from '@/lib/form-store';
import { brand } from '@/lib/theme';

// The filling view: every page image stacked vertically on one canvas that
// can be pinched (1x to 5x), panned and double-tapped, with each field drawn
// as a tappable box.
//
// HOW FIELD COORDINATES MAP TO THE SCREEN
//
// A field is stored as fractions of its page AS DISPLAYED (after the PDF's
// /Rotate), measured from the top-left corner: x, y, width, height in 0..1.
// The console's editor measured them on the same rendered page image, and the
// Edge Function maps them back to PDF points (x_pt = x * page width in points,
// flipping y because PDF y grows upwards). Fractions don't depend on how big
// anything is drawn, so the same numbers work for the 1600 px PNG, the PDF
// and any phone.
//
// On the phone, in two steps:
//  1. Layout (no zoom). Each page is drawn PAGE_W points wide (the screen
//     width minus a margin) and PAGE_W / aspect tall, where aspect = image
//     width / height. Pages are stacked with a GAP, so page n starts at
//     top(n) = sum of the heights of the pages before it + gaps. A field's box
//     in canvas points is:
//        left = x * PAGE_W              top  = top(page) + y * pageHeight
//        w    = width * PAGE_W          h    = height * pageHeight
//     A small phone and a tablet get different PAGE_W, but every box stays on
//     the same spot of the page.
//  2. Zoom and pan. The whole canvas gets one transform with its origin at the
//     top-left: screen = canvas * scale + (tx, ty). Pinching changes scale and
//     moves (tx, ty) so the point between the fingers stays put:
//        tx' = focalX - (focalX - tx) * (scale' / scale)   (same for y)
//     Boxes are children of the canvas, so they scale with the pages and are
//     never recomputed; React Native hit-tests through the transform, so
//     tapping a zoomed box opens that field.
// Panning is clamped so the canvas can't be dragged away from the screen.

const MARGIN = 12;
const GAP = 16;
const MAX_SCALE = 5;
/** PDF points across a US Letter page: font sizes in the preview scale by PAGE_W / this. */
const LETTER_WIDTH_PT = 612;

/** Keeps the canvas covering the view: translation between (view - content * scale) and 0. */
function clampAxis(value: number, scale: number, view: number, content: number): number {
  'worklet';
  const min = Math.min(0, view - content * scale);
  return Math.min(0, Math.max(min, value));
}

export type FormPageHandle = {
  /** Zoom to a field (e.g. the next empty required one). */
  focus: (key: string) => void;
};

type Props = {
  version: CachedVersion;
  values: Record<string, unknown>;
  signatureUri: string | null;
  missing: Set<string>;
  problems: Record<string, string>;
  readOnly: boolean;
  onFieldPress: (field: VersionField) => void;
};

function answerText(field: VersionField, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'checkbox') return value === true ? '✓' : null;
  if (field.type === 'date' && typeof value === 'string') {
    const [y, m, d] = value.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

export const FormPages = forwardRef<FormPageHandle, Props>(function FormPages(
  { version, values, signatureUri, missing, problems, readOnly, onFieldPress },
  ref,
) {
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const pageW = Math.max(0, viewport.w - MARGIN * 2);

  // Step 1: where each page sits on the unzoomed canvas.
  const layout = useMemo(() => {
    let top = MARGIN;
    const pages = version.pages.map((uri, i) => {
      const aspect = version.aspects[i] || 8.5 / 11;
      const height = pageW / aspect;
      const page = { uri, top, height };
      top += height + GAP;
      return page;
    });
    return { pages, height: top - GAP + MARGIN };
  }, [version.pages, version.aspects, pageW]);

  // Step 2: one transform for the whole canvas (shared values run on the UI thread).
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ s: 1, x: 0, y: 0 });
  const bounds = useSharedValue({ vw: 0, vh: 0, cw: 0, ch: 0 });
  useEffect(() => {
    bounds.value = { vw: viewport.w, vh: viewport.h, cw: viewport.w, ch: layout.height };
  }, [bounds, viewport, layout.height]);

  const clampX = (x: number, s: number) => {
    'worklet';
    return clampAxis(x, s, bounds.value.vw, bounds.value.cw);
  };
  const clampY = (y: number, s: number) => {
    'worklet';
    return clampAxis(y, s, bounds.value.vh, bounds.value.ch);
  };

  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      start.value = { s: scale.value, x: tx.value, y: ty.value };
    },
    onUpdate: (e) => {
      'worklet';
      const s = Math.min(MAX_SCALE, Math.max(1, start.value.s * e.scale));
      const k = s / start.value.s;
      scale.value = s;
      tx.value = clampX(e.focalX - (e.focalX - start.value.x) * k, s);
      ty.value = clampY(e.focalY - (e.focalY - start.value.y) * k, s);
    },
  });

  const pan = usePanGesture({
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      start.value = { s: scale.value, x: tx.value, y: ty.value };
    },
    onUpdate: (e) => {
      'worklet';
      tx.value = clampX(start.value.x + e.translationX, scale.value);
      ty.value = clampY(start.value.y + e.translationY, scale.value);
    },
    onDeactivate: (e) => {
      'worklet';
      const s = scale.value;
      tx.value = withDecay({
        velocity: e.velocityX,
        clamp: [Math.min(0, bounds.value.vw - bounds.value.cw * s), 0],
      });
      ty.value = withDecay({
        velocity: e.velocityY,
        clamp: [Math.min(0, bounds.value.vh - bounds.value.ch * s), 0],
      });
    },
  });

  // Double tap: zoom in around the tap, or back out.
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      const from = scale.value;
      const to = from > 1.2 ? 1 : 2.5;
      const k = to / from;
      scale.value = withTiming(to);
      tx.value = withTiming(clampX(e.x - (e.x - tx.value) * k, to));
      ty.value = withTiming(clampY(e.y - (e.y - ty.value) * k, to));
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  useImperativeHandle(
    ref,
    () => ({
      focus: (key) => {
        const field = version.fields.find((f) => f.key === key);
        const page = field ? layout.pages[field.page - 1] : undefined;
        if (!field || !page || pageW === 0) return;
        const s = 2;
        const cx = MARGIN + (field.x + field.width / 2) * pageW;
        const cy = page.top + (field.y + field.height / 2) * page.height;
        scale.value = withTiming(s);
        tx.value = withTiming(clampAxis(viewport.w / 2 - cx * s, s, viewport.w, viewport.w));
        ty.value = withTiming(clampAxis(viewport.h / 3 - cy * s, s, viewport.h, layout.height));
      },
    }),
    [version.fields, layout, pageW, viewport, scale, tx, ty],
  );

  const fontScale = pageW / LETTER_WIDTH_PT;

  return (
    <GestureDetector gesture={gesture}>
      <View
        className="flex-1 overflow-hidden"
        onLayout={(e) =>
          setViewport({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        {pageW > 0 ? (
          <Animated.View
            style={[
              { width: viewport.w, height: layout.height, transformOrigin: 'top left' },
              canvasStyle,
            ]}
          >
            {layout.pages.map((page, i) => (
              <View
                key={page.uri}
                style={{
                  position: 'absolute',
                  left: MARGIN,
                  top: page.top,
                  width: pageW,
                  height: page.height,
                }}
                className="overflow-hidden rounded-md bg-white"
              >
                <Image
                  source={{ uri: page.uri }}
                  style={{ width: pageW, height: page.height }}
                  contentFit="fill"
                  accessibilityLabel={`Page ${i + 1}`}
                />
                {version.fields
                  .filter((f) => f.page === i + 1)
                  .map((f) => {
                    const text = answerText(f, values[f.key]);
                    const isMissing = missing.has(f.key);
                    const problem = problems[f.key];
                    const filled = f.type === 'signature' ? signatureUri !== null : text !== null;
                    return (
                      <Pressable
                        key={f.key}
                        disabled={readOnly}
                        onPress={() => onFieldPress(f)}
                        accessibilityRole="button"
                        accessibilityLabel={`${f.label}${f.required ? ', required' : ''}${
                          filled ? '' : ', empty'
                        }`}
                        style={{
                          position: 'absolute',
                          left: f.x * pageW,
                          top: f.y * page.height,
                          width: f.width * pageW,
                          height: f.height * page.height,
                          borderWidth: readOnly ? 0 : 1.5,
                          borderStyle: filled ? 'solid' : 'dashed',
                          borderColor: problem || isMissing ? '#ef4444' : brand.gold,
                          backgroundColor: readOnly
                            ? 'transparent'
                            : problem || isMissing
                              ? 'rgba(239,68,68,0.16)'
                              : filled
                                ? 'rgba(214,181,98,0.10)'
                                : 'rgba(214,181,98,0.22)',
                          borderRadius: 2,
                          justifyContent: 'center',
                        }}
                      >
                        {f.type === 'signature' ? (
                          signatureUri ? (
                            <Image
                              source={{ uri: signatureUri }}
                              style={{ width: '100%', height: '100%' }}
                              contentFit="contain"
                            />
                          ) : null
                        ) : text !== null ? (
                          <Text
                            numberOfLines={f.type === 'multiline' ? undefined : 1}
                            adjustsFontSizeToFit={f.type !== 'multiline'}
                            style={{
                              color: '#000',
                              fontSize: Math.max(4, f.font_size * fontScale),
                              paddingHorizontal: 1,
                              textAlign: f.type === 'checkbox' ? 'center' : 'left',
                            }}
                          >
                            {text}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
              </View>
            ))}
          </Animated.View>
        ) : null}
        {!readOnly ? (
          <View
            pointerEvents="none"
            className="absolute bottom-3 right-3 flex-row items-center gap-1 rounded-full bg-ink/80 px-3 py-1.5"
          >
            <Ionicons name="expand-outline" size={12} color={brand.gold} />
            <Text className="text-[11px] text-white/70">Pinch or double-tap to zoom</Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
});
