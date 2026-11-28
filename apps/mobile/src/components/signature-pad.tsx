import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { SafeAreaView } from 'react-native-safe-area-context';

import { brand } from '@/lib/theme';

// Full-screen signature pad. The phone turns to landscape while it is open
// (more room to sign), and back to portrait when it closes. The strokes are
// drawn on a transparent canvas over a white page, so the saved PNG has a
// transparent background and sits cleanly on the PDF; empty margins are
// trimmed.

/** Hide the pad's own footer: we draw Clear / Done in React Native. */
const WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; height: 100%; width: 100%; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; }
  body, html { background: #ffffff; height: 100%; margin: 0; }
`;

export function SignaturePad({
  visible,
  name,
  onDone,
  onCancel,
}: {
  visible: boolean;
  /** Shown under the line, e.g. the officer's name. */
  name: string | null;
  /** Base64 PNG (no data: prefix). */
  onDone: (pngBase64: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<SignatureViewRef>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    if (!visible) return;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      onShow={() => setEmpty(true)}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <SafeAreaView className="flex-1 bg-ink" edges={['top', 'bottom', 'left', 'right']}>
        <View className="flex-row items-center justify-between gap-3 px-5 py-3">
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
            <Text className="text-base font-semibold text-white/70">Cancel</Text>
          </Pressable>
          <Text className="flex-1 text-center text-sm font-bold uppercase tracking-[2px] text-white/60">
            Sign inside the box
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => {
                ref.current?.clearSignature();
                setEmpty(true);
              }}
              accessibilityRole="button"
              className="rounded-full border border-gold/40 px-4 py-2"
            >
              <Text className="font-bold text-white">Clear</Text>
            </Pressable>
            <Pressable
              onPress={() => ref.current?.readSignature()}
              disabled={empty}
              accessibilityRole="button"
              className={`rounded-full bg-gold px-5 py-2 ${empty ? 'opacity-50' : ''}`}
            >
              <Text className="font-bold text-ink">Done</Text>
            </Pressable>
          </View>
        </View>
        <View className="mx-4 mb-3 flex-1 overflow-hidden rounded-2xl bg-white">
          {visible ? (
            <SignatureScreen
              ref={ref}
              onBegin={() => setEmpty(false)}
              onOK={(dataUrl: string) => onDone(dataUrl.replace(/^data:image\/png;base64,/, ''))}
              onEmpty={() => setEmpty(true)}
              backgroundColor="rgba(255,255,255,0)"
              penColor={brand.navy}
              minWidth={1.2}
              maxWidth={3.2}
              imageType="image/png"
              trimWhitespace
              autoClear={false}
              descriptionText=""
              webStyle={WEB_STYLE}
            />
          ) : null}
          <View
            pointerEvents="none"
            className="absolute bottom-10 left-8 right-8 border-b border-slate-400"
          />
          {name ? (
            <Text pointerEvents="none" className="absolute bottom-3 left-8 text-xs text-slate-500">
              {name}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
