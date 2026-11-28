import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// One lesson page that fits the screen and can be pinched (1x-5x), panned
// when zoomed, and double-tapped. At normal size a horizontal swipe turns the
// page (onSwipe). Same transform idea as components/form-page.tsx: one
// scale + translation with the origin at the top-left, clamped so the page
// never leaves the screen.

const MAX_SCALE = 5;
const SWIPE_DISTANCE = 60;

function clampAxis(value: number, scale: number, view: number, content: number): number {
  'worklet';
  // Content smaller than the view (scaled): keep it centred.
  if (content * scale <= view) return (view - content * scale) / 2;
  return Math.min(0, Math.max(view - content * scale, value));
}

export function ZoomablePage({
  uri,
  aspect,
  onSwipe,
  accessibilityLabel,
}: {
  uri: string;
  /** width / height of the page image */
  aspect: number;
  onSwipe: (direction: 'next' | 'previous') => void;
  accessibilityLabel: string;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The page drawn to fit the view.
  const fitW = box.w && box.h ? Math.min(box.w, box.h * aspect) : 0;
  const fitH = fitW / (aspect || 1);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ s: 1, x: 0, y: 0 });
  const dims = useSharedValue({ vw: 0, vh: 0, cw: 0, ch: 0 });

  // The parent remounts this per page; a new size (rotation, first layout)
  // goes back to fit, centred. Done in the layout handler, not an effect.
  function layout(w: number, h: number) {
    const cw = w && h ? Math.min(w, h * aspect) : 0;
    const ch = cw / (aspect || 1);
    dims.value = { vw: w, vh: h, cw, ch };
    scale.value = 1;
    tx.value = (w - cw) / 2;
    ty.value = (h - ch) / 2;
    setBox({ w, h });
  }

  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      start.value = { s: scale.value, x: tx.value, y: ty.value };
    },
    onUpdate: (e) => {
      'worklet';
      const s = Math.min(MAX_SCALE, Math.max(1, start.value.s * e.scale));
      const k = s / start.value.s;
      const d = dims.value;
      scale.value = s;
      tx.value = clampAxis(e.focalX - (e.focalX - start.value.x) * k, s, d.vw, d.cw);
      ty.value = clampAxis(e.focalY - (e.focalY - start.value.y) * k, s, d.vh, d.ch);
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
      if (scale.value <= 1.01) return; // not zoomed: this is a swipe
      const d = dims.value;
      tx.value = clampAxis(start.value.x + e.translationX, scale.value, d.vw, d.cw);
      ty.value = clampAxis(start.value.y + e.translationY, scale.value, d.vh, d.ch);
    },
    onDeactivate: (e) => {
      'worklet';
      if (scale.value > 1.01) return;
      if (
        Math.abs(e.translationX) > SWIPE_DISTANCE &&
        Math.abs(e.translationX) > Math.abs(e.translationY)
      ) {
        scheduleOnRN(onSwipe, e.translationX < 0 ? 'next' : 'previous');
      }
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      const d = dims.value;
      const to = scale.value > 1.2 ? 1 : 2.5;
      const k = to / scale.value;
      scale.value = withTiming(to);
      tx.value = withTiming(clampAxis(e.x - (e.x - tx.value) * k, to, d.vw, d.cw));
      ty.value = withTiming(clampAxis(e.y - (e.y - ty.value) * k, to, d.vh, d.ch));
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        className="flex-1 overflow-hidden"
        onLayout={(e) => layout(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
      >
        {fitW > 0 ? (
          <Animated.View
            style={[{ width: fitW, height: fitH, transformOrigin: 'top left' }, style]}
          >
            <Image
              source={{ uri }}
              style={{ width: fitW, height: fitH, backgroundColor: '#fff', borderRadius: 4 }}
              contentFit="fill"
              accessibilityLabel={accessibilityLabel}
            />
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}
