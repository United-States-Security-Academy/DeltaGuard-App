import { View } from 'react-native';

/** A thin gold bar, 0..1. */
export function ProgressBar({ value }: { value: number }) {
  return (
    <View
      className="h-2 overflow-hidden rounded-full bg-white/10"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
    >
      <View
        className="h-full rounded-full bg-gold"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </View>
  );
}
