import type { ComponentProps } from 'react';
import { cssInterop } from 'nativewind';
import {
  KeyboardAvoidingView as KCAvoidingView,
  KeyboardAwareScrollView,
} from 'react-native-keyboard-controller';

// Keyboard handling for every screen with text fields.
//
// Android apps are edge-to-edge: the window no longer resizes for the
// keyboard, so React Native's KeyboardAvoidingView without a `behavior` leaves
// fields under it. react-native-keyboard-controller (KeyboardProvider in the
// root layout) follows the keyboard on both platforms, including inside
// <Modal> (it watches modal windows on Android).
//
//  - FormScrollView: forms. Scrolls the focused field (and its caret) into
//    view above the keyboard.
//  - KeyboardAvoidingView: fixed layouts such as a chat composer or a sheet;
//    `automaticOffset` accounts for headers and modals.

// Let NativeWind classes work on the library's components.
cssInterop(KeyboardAwareScrollView, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});
cssInterop(KCAvoidingView, { className: 'style' });

/** Gap kept between the keyboard and the focused field. */
const FIELD_GAP = 32;

export function FormScrollView(props: ComponentProps<typeof KeyboardAwareScrollView>) {
  return (
    <KeyboardAwareScrollView
      bottomOffset={FIELD_GAP}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
}

export function KeyboardAvoidingView(props: ComponentProps<typeof KCAvoidingView>) {
  return <KCAvoidingView behavior="padding" automaticOffset {...props} />;
}
