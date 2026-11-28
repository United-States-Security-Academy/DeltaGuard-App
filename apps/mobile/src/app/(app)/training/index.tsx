import { formatDate, toZoned } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useNow } from '@/components/clock-panel';
import { ProgressBar } from '@/components/progress-bar';
import { Badge, Body, Card, ErrorState, SectionTitle } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useCompanySettings } from '@/lib/shifts';
import { type LessonState, lessonState, readingDone, useMyTraining } from '@/lib/training';
import { useTrainingSync } from '@/lib/training-sync';
import { brand, fx } from '@/lib/theme';

export default function TrainingScreen() {
  const { state } = useSession();
  if (state.status !== 'ready') return null;
  return <Training userId={state.profile.id} />;
}

function Training({ userId }: { userId: string }) {
  const training = useMyTraining(userId);
  const sync = useTrainingSync();
  const { timeZone } = useCompanySettings();
  const now = useNow(60_000);
  const states = (training.data ?? []).map((l) => lessonState(l, sync.state));
  const assigned = states
    .filter((s) => !s.done)
    .sort(
      (a, b) =>
        (a.lesson.dueAt ? Date.parse(a.lesson.dueAt) : Infinity) -
        (b.lesson.dueAt ? Date.parse(b.lesson.dueAt) : Infinity),
    );
  const completed = states.filter((s) => s.done);

  const when = (iso: string) => {
    const z = toZoned(iso, timeZone);
    return `${formatDate(z.date)} ${z.time}`;
  };

  return (
    <ScrollView
      className="flex-1"
      style={fx.screen}
      contentContainerClassName="gap-4 p-5 pb-16"
      refreshControl={
        <RefreshControl
          refreshing={training.isRefetching}
          onRefresh={() => {
            void training.refetch();
            void sync.syncNow();
          }}
          tintColor={brand.gold}
          colors={[brand.gold]}
        />
      }
    >
      {training.isError && !training.data ? (
        <ErrorState
          message="Couldn't load your training."
          error={training.error}
          onRetry={() => void training.refetch()}
        />
      ) : null}

      <SectionTitle>Assigned</SectionTitle>
      {assigned.length === 0 ? (
        <Body>{training.isPending ? 'Loading…' : 'No training to do right now.'}</Body>
      ) : (
        assigned.map((s) => {
          const overdue = s.lesson.dueAt !== null && Date.parse(s.lesson.dueAt) < now;
          return (
            <LessonRow key={s.lesson.id} s={s}>
              <View className="flex-row flex-wrap gap-2">
                {s.lesson.dueAt ? (
                  <Badge tone={overdue ? 'danger' : 'muted'}>
                    {overdue ? 'Overdue · ' : 'Due '}
                    {when(s.lesson.dueAt)}
                  </Badge>
                ) : null}
                {s.waitingToSubmit ? (
                  <Badge tone="gold">Quiz waiting for signal</Badge>
                ) : readingDone(s.lesson, sync.state) && s.lesson.assessment ? (
                  <Badge tone="gold">Ready for the quiz</Badge>
                ) : null}
              </View>
              <ProgressBar value={s.progress} />
              <Text className="text-xs text-white/55">
                {Math.round(s.progress * s.lesson.pageCount)} of {s.lesson.pageCount} pages read
                {s.lesson.estimatedMinutes ? ` · about ${s.lesson.estimatedMinutes} min` : ''}
              </Text>
            </LessonRow>
          );
        })
      )}

      <SectionTitle>Completed</SectionTitle>
      {completed.length === 0 ? (
        <Body>Nothing completed yet.</Body>
      ) : (
        completed.map((s) => (
          <LessonRow key={s.lesson.id} s={s}>
            <View className="flex-row flex-wrap items-center gap-2">
              <Badge tone={s.passed ? 'gold' : 'danger'}>{s.passed ? 'Passed' : 'Failed'}</Badge>
              {s.bestScore !== null ? <Badge>Best score {Math.round(s.bestScore)}%</Badge> : null}
              {!s.lesson.assessment ? <Badge>Read</Badge> : null}
            </View>
          </LessonRow>
        ))
      )}
    </ScrollView>
  );
}

function LessonRow({ s, children }: { s: LessonState; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/training/[id]', params: { id: s.lesson.id } })}
      accessibilityRole="button"
      className="active:opacity-80"
    >
      <Card>
        <View className="flex-row items-center gap-3">
          <Ionicons name="school-outline" size={22} color={brand.gold} />
          <Text className="flex-1 text-base font-bold text-white">{s.lesson.title}</Text>
          <Ionicons name="chevron-forward" size={18} color={brand.gold} />
        </View>
        {children}
      </Card>
    </Pressable>
  );
}
