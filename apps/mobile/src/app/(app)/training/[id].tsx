import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressBar } from '@/components/progress-bar';
import { Button, ErrorState, Notice } from '@/components/ui';
import { ZoomablePage } from '@/components/zoomable-page';
import { useSession } from '@/lib/session';
import {
  lessonState,
  readingDone,
  useLessonPages,
  useMyTraining,
  viewedPages,
} from '@/lib/training';
import { useTrainingSync } from '@/lib/training-sync';
import { brand, fx } from '@/lib/theme';

/** A page counts as viewed after it has been on screen this long. */
const VIEW_AFTER_MS = 2000;
/** Reading time is saved to the phone this often (and when leaving). */
const SAVE_TIME_EVERY_S = 15;

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready' || typeof id !== 'string') return null;
  return <Lesson id={id} userId={state.profile.id} />;
}

function Lesson({ id, userId }: { id: string; userId: string }) {
  const insets = useSafeAreaInsets();
  const training = useMyTraining(userId);
  const sync = useTrainingSync();
  const lesson = training.data?.find((l) => l.id === id) ?? null;
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);
  const pages = useLessonPages(userId, lesson, (done, total) => setDownload({ done, total }));
  const local = sync.state.lessons[id];

  // Resume where the officer left off (last page on this phone, else the
  // furthest page the server knows), until they turn a page themselves.
  const [chosen, setPage] = useState<number | null>(null);
  const resume =
    lesson && sync.loaded
      ? Math.min(
          Math.max(1, local?.lastPage ?? Math.max(1, ...(lesson.progress?.pagesViewed ?? [1]))),
          Math.max(1, lesson.pageCount),
        )
      : null;
  const page = chosen ?? resume;

  // Mark the page viewed after it has been on screen for a moment.
  const { markViewed, setLastPage, addSeconds } = sync;
  useEffect(() => {
    if (page === null) return;
    setLastPage(id, page);
    const timer = setTimeout(() => markViewed(id, page), VIEW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [id, page, markViewed, setLastPage]);

  // Time spent: counted only while this screen is open AND the app is in the foreground.
  const seconds = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const flush = () => {
        if (seconds.current > 0) addSeconds(id, seconds.current);
        seconds.current = 0;
      };
      let active = AppState.currentState === 'active';
      const tick = setInterval(() => {
        if (!active) return;
        seconds.current += 1;
        if (seconds.current >= SAVE_TIME_EVERY_S) flush();
      }, 1000);
      const sub = AppState.addEventListener('change', (s) => {
        active = s === 'active';
        if (!active) flush();
      });
      return () => {
        clearInterval(tick);
        sub.remove();
        flush();
      };
    }, [id, addSeconds]),
  );

  if (!lesson) {
    if (training.isError) {
      return (
        <View className="flex-1 p-5" style={fx.screen}>
          <ErrorState
            message="Couldn't open this lesson."
            error={training.error}
            onRetry={() => void training.refetch()}
          />
        </View>
      );
    }
    return (
      <View className="flex-1 items-center justify-center" style={fx.screen}>
        {training.isPending ? (
          <ActivityIndicator color={brand.gold} />
        ) : (
          <Text className="px-6 text-center text-white/70">
            This lesson is no longer assigned to you.
          </Text>
        )}
      </View>
    );
  }

  const count = lesson.pageCount;
  const seen = viewedPages(lesson, sync.state);
  const done = readingDone(lesson, sync.state);
  const status = lessonState(lesson, sync.state);
  const go = (to: number) => setPage(Math.min(Math.max(1, to), count));

  return (
    <View className="flex-1" style={fx.screen}>
      <Stack.Screen options={{ title: lesson.title }} />

      <View className="gap-2 px-5 pt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-bold text-white" accessibilityLiveRegion="polite">
            Page {page ?? 1} of {count}
          </Text>
          <Text className="text-xs text-white/55">
            {seen.size} of {count} read
          </Text>
        </View>
        <ProgressBar value={count ? seen.size / count : 0} />
      </View>

      <View className="mt-3 flex-1 px-2">
        {pages.data && page !== null ? (
          <ZoomablePage
            key={page}
            uri={pages.data.pages[page - 1]!}
            aspect={pages.data.aspects[page - 1] ?? 8.5 / 11}
            onSwipe={(d) => go(page + (d === 'next' ? 1 : -1))}
            accessibilityLabel={`Page ${page} of ${count}`}
          />
        ) : pages.isError ? (
          <View className="p-4">
            <ErrorState
              message="The lesson isn't on this phone yet and couldn't be downloaded."
              error={pages.error}
              onRetry={() => void pages.refetch()}
            />
          </View>
        ) : (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator color={brand.gold} />
            <Text className="text-sm text-white/60">
              {download
                ? `Downloading page ${download.done} of ${download.total} for offline reading…`
                : 'Opening…'}
            </Text>
          </View>
        )}
      </View>

      <View
        className="gap-3 border-t border-white/10 px-5 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <PageButton
            icon="chevron-back"
            label="Previous page"
            disabled={!page || page <= 1}
            onPress={() => go((page ?? 1) - 1)}
          />
          <Text className="flex-1 text-center text-xs text-white/50">
            Swipe to turn · pinch to zoom
          </Text>
          <PageButton
            icon="chevron-forward"
            label="Next page"
            disabled={!page || page >= count}
            onPress={() => go((page ?? 1) + 1)}
          />
        </View>
        {status.waitingToSubmit ? (
          <Notice tone="info">
            Your quiz answers are saved and will be sent when you’re back online.
          </Notice>
        ) : null}
        {done ? (
          lesson.assessment ? (
            <Button
              title={status.passed ? 'Quiz result' : 'Start assessment'}
              onPress={() =>
                router.push({
                  pathname: '/training/quiz/[id]',
                  params: { id: lesson.assessment!.id },
                })
              }
            />
          ) : (
            <Notice tone="info">You’ve read every page. This lesson is complete.</Notice>
          )
        ) : lesson.assessment ? (
          <Text className="text-center text-xs text-white/55">
            Read every page to unlock the quiz ({count - seen.size} to go).
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PageButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-12 w-12 items-center justify-center rounded-full border border-gold/40 ${disabled ? 'opacity-30' : 'active:opacity-70'}`}
      style={fx.glass}
    >
      <Ionicons name={icon} size={22} color={brand.gold} />
    </Pressable>
  );
}
