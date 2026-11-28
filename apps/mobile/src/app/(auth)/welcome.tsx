import { COMPANY_NAME } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Eyebrow, Notice, Title } from '@/components/ui';
import logo from '@/assets/images/logo.png';
import { useSession } from '@/lib/session';
import { brand, fx } from '@/lib/theme';

// The badge is 1121 x 1396; keep that ratio.
const LOGO_HEIGHT = 210;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 1121) / 1396);

// Small gold stars scattered over the hero, echoing the stars on the badge.
// Positions are percentages of the hero so they scale with the screen.
const STARS = [
  { top: '14%', left: '10%', size: 12, opacity: 0.7 },
  { top: '10%', left: '78%', size: 16, opacity: 0.9 },
  { top: '30%', left: '88%', size: 9, opacity: 0.5 },
  { top: '38%', left: '6%', size: 9, opacity: 0.45 },
  { top: '70%', left: '12%', size: 14, opacity: 0.8 },
  { top: '76%', left: '84%', size: 11, opacity: 0.6 },
  { top: '22%', left: '30%', size: 7, opacity: 0.4 },
  { top: '58%', left: '92%', size: 7, opacity: 0.35 },
] as const;

// Concentric rings behind the badge, like a radar sweep around a guarded site.
const RINGS = [
  { size: 260, className: 'border-gold/25' },
  { size: 360, className: 'border-gold/15' },
  { size: 470, className: 'border-gold/[0.07]' },
] as const;

/** First screen for signed-out users: brand, purpose and the way in. */
export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { state } = useSession();
  // Why they were signed out (device reset, account suspended…), if anything.
  const notice = state.status === 'signedOut' ? state.notice : undefined;

  return (
    <View className="flex-1" style={fx.screen}>
      {/* Hero: a flat navy slab, rounded at the bottom. */}
      <View
        className="flex-1 overflow-hidden rounded-b-[44px] border-b border-gold/30"
        style={{
          paddingTop: insets.top,
          backgroundColor: brand.navy,
          boxShadow: '0px 10px 24px rgba(0,0,0,0.4)',
        }}
      >
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          {RINGS.map((ring) => (
            <View
              key={ring.size}
              className={`absolute rounded-full border ${ring.className}`}
              style={{ width: ring.size, height: ring.size }}
            />
          ))}
          {/* Soft glow directly behind the badge */}
          <View className="absolute h-56 w-56 rounded-full bg-gold/10" />
        </View>

        {STARS.map((star, i) => (
          <Animated.View
            key={i}
            entering={FadeIn.delay(300 + i * 80).duration(600)}
            className="absolute"
            style={{ top: star.top, left: star.left, opacity: star.opacity }}
            pointerEvents="none"
          >
            <Ionicons name="star" size={star.size} color={brand.gold} />
          </Animated.View>
        ))}

        <View className="flex-1 items-center justify-center">
          <Animated.View entering={ZoomIn.springify().damping(14).delay(100)}>
            <Image
              source={logo}
              style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
              contentFit="contain"
              accessibilityLabel="Deltacon Security Group badge"
            />
          </Animated.View>
        </View>
      </View>

      {/* Copy and the way in */}
      <Animated.View
        entering={FadeInDown.delay(250).duration(500)}
        className="gap-5 px-6 pt-8"
        style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
      >
        <View className="gap-3">
          <Eyebrow>{COMPANY_NAME}</Eyebrow>
          <Title>Every post covered.{'\n'}Every shift accounted for.</Title>
          <Text className="text-base leading-6 text-white/70">
            Clock in on site, read your post orders, file reports and reach your team, all in one
            secure app.
          </Text>
        </View>

        {notice ? <Notice tone="info">{notice}</Notice> : null}

        <Button title="Sign in" onPress={() => router.push('/sign-in')} />

        <View className="flex-row items-center justify-center gap-2">
          <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.5)" />
          <Text className="text-center text-xs text-white/50">
            Access by invitation only. Ask your supervisor for an account.
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
