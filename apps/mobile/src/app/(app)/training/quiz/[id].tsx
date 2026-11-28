import {
  type AttemptResult,
  friendlyError,
  officerAssessmentSchema,
  TRAINING_ERROR_CODES,
} from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePreventScreenCapture } from 'expo-screen-capture';

import { useNow } from '@/components/clock-panel';
import { ProgressBar } from '@/components/progress-bar';
import { Badge, Button, Card, ErrorState, Notice, SectionTitle } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { fetchAttemptReview, useAssessmentOverview, useMyTraining } from '@/lib/training';
import type { QuizDraft } from '@/lib/training-store';
import { useTrainingSync } from '@/lib/training-sync';
import { brand, fx } from '@/lib/theme';

type Review = NonNullable<AttemptResult['review']>;
type Phase =
  | { kind: 'rules' }
  | { kind: 'question' }
  | { kind: 'review' }
  | { kind: 'queued' }
  | { kind: 'result'; result: AttemptResult };

export default function QuizScreen() {
  // Personal data, photos or answers on screen: no screenshots or recording.
  usePreventScreenCapture('quiz');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'ready' || typeof id !== 'string') return null;
  return <Quiz assessmentId={id} userId={state.profile.id} />;
}

function Quiz({ assessmentId, userId }: { assessmentId: string; userId: string }) {
  const insets = useSafeAreaInsets();
  const sync = useTrainingSync();
  const overview = useAssessmentOverview(assessmentId);
  const training = useMyTraining(userId);
  const lesson = training.data?.find((l) => l.assessment?.id === assessmentId) ?? null;
  const draft = sync.state.drafts[assessmentId] ?? null;
  const queued = sync.state.submissions.find(
    (s) => s.assessmentId === assessmentId && s.state === 'queued',
  );
  const [phase, setPhase] = useState<Phase>(() =>
    queued ? { kind: 'queued' } : { kind: 'rules' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An answer submitted offline was graded in the background: show it.
  const landed = sync.state.results[assessmentId];
  if (phase.kind === 'queued' && !queued && landed) setPhase({ kind: 'result', result: landed });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // Make sure the server has the reading progress first.
      await sync.syncNow();
      const { data, error: rpcError } = await supabase.rpc('get_assessment_for_officer', {
        p_assessment_id: assessmentId,
      });
      if (rpcError) {
        setError(
          rpcError.code === TRAINING_ERROR_CODES.readingNotComplete
            ? 'The server hasn’t received all your reading yet. Connect to the internet and try again.'
            : rpcError.code === TRAINING_ERROR_CODES.noAttemptsLeft
              ? 'You have no attempts left. Ask your admin if you need another one.'
              : rpcError.code === TRAINING_ERROR_CODES.alreadyPassed
                ? 'You already passed this quiz.'
                : `The quiz couldn’t be opened. ${friendlyError(rpcError)}`,
        );
        return;
      }
      const quiz = officerAssessmentSchema.parse(data);
      // Same open attempt as before? Keep the answers already given.
      const answers = draft?.quiz.attempt.id === quiz.attempt.id ? draft.answers : {};
      await sync.saveDraft(assessmentId, { quiz, answers, index: 0 });
      setPhase({ kind: 'question' });
    } catch (e) {
      setError(`The quiz couldn’t be opened. ${friendlyError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit(d: QuizDraft) {
    setBusy(true);
    try {
      const outcome = await sync.submitAnswers({
        assessmentId,
        lessonId: d.quiz.lesson_id,
        attemptId: d.quiz.attempt.id,
        answers: d.answers,
      });
      if (outcome.kind === 'graded') setPhase({ kind: 'result', result: outcome.result });
      else if (outcome.kind === 'queued') setPhase({ kind: 'queued' });
      else {
        Alert.alert('Not accepted', outcome.message);
        await sync.saveDraft(assessmentId, null);
        setPhase({ kind: 'rules' });
        void overview.refetch();
      }
      void training.refetch();
    } finally {
      setBusy(false);
    }
  }

  const title = lesson ? `Quiz: ${lesson.title}` : 'Quiz';

  return (
    <View className="flex-1" style={fx.screen}>
      <Stack.Screen options={{ title }} />
      {phase.kind === 'rules' ? (
        <Rules
          overview={overview}
          lastAttemptId={lesson?.attempts.at(-1)?.id ?? null}
          lastScore={lesson?.attempts.at(-1)?.score ?? null}
          hasDraft={draft !== null}
          busy={busy}
          error={error}
          onStart={() => void start()}
          bottom={insets.bottom}
        />
      ) : phase.kind === 'question' && draft ? (
        <Questions
          draft={draft}
          bottom={insets.bottom}
          onChange={(d) => void sync.saveDraft(assessmentId, d)}
          onReview={() => setPhase({ kind: 'review' })}
          onTimeUp={() => void submit(draft)}
        />
      ) : phase.kind === 'review' && draft ? (
        <ReviewAnswers
          draft={draft}
          busy={busy}
          bottom={insets.bottom}
          onEdit={(index) => {
            void sync.saveDraft(assessmentId, { ...draft, index });
            setPhase({ kind: 'question' });
          }}
          onSubmit={() => void submit(draft)}
          onTimeUp={() => void submit(draft)}
        />
      ) : phase.kind === 'queued' ? (
        <View className="flex-1 justify-center gap-4 p-6">
          <Ionicons name="cloud-upload-outline" size={44} color={brand.gold} />
          <Text className="text-xl font-extrabold text-white">Answers saved</Text>
          <Text className="text-base leading-6 text-white/80">
            You’re offline, so your answers are saved on this phone and will be submitted
            automatically when you’re back online. Your score appears here and in Training.
          </Text>
          <Notice tone="info">
            The time limit is measured on the server from when you opened the quiz, so answers that
            arrive after the time is up may be scored as over time.
          </Notice>
          <Button title="Try now" variant="secondary" onPress={() => void sync.syncNow()} />
          <Button title="Back to training" onPress={() => router.navigate('/training')} />
        </View>
      ) : phase.kind === 'result' ? (
        <Result result={phase.result} bottom={insets.bottom} />
      ) : (
        <ActivityIndicator color={brand.gold} className="mt-10" />
      )}
    </View>
  );
}

function Rules({
  overview,
  lastAttemptId,
  lastScore,
  hasDraft,
  busy,
  error,
  onStart,
  bottom,
}: {
  overview: ReturnType<typeof useAssessmentOverview>;
  lastAttemptId: string | null;
  lastScore: number | null;
  hasDraft: boolean;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  bottom: number;
}) {
  const o = overview.data;
  const [review, setReview] = useState<Review | null | 'loading'>(null);

  if (!o) {
    return overview.isError ? (
      <View className="p-5">
        <ErrorState
          message="The quiz rules couldn’t be loaded. You need a connection to start a quiz."
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      </View>
    ) : (
      <ActivityIndicator color={brand.gold} className="mt-10" />
    );
  }

  const canStart =
    !o.passed && (o.attempts_left === null || o.attempts_left > 0 || o.open_attempt !== null);

  return (
    <ScrollView
      contentContainerClassName="gap-4 p-5"
      contentContainerStyle={{ paddingBottom: bottom + 24 }}
    >
      <Card>
        <Text className="text-lg font-extrabold text-white">Before you start</Text>
        <Rule
          icon="help-circle-outline"
          text={`${o.question_count} question${o.question_count === 1 ? '' : 's'}`}
        />
        <Rule icon="ribbon-outline" text={`Pass mark ${o.pass_mark_percent}%`} />
        <Rule
          icon="repeat-outline"
          text={
            o.attempts_left === null
              ? 'Unlimited attempts'
              : `${o.attempts_left} attempt${o.attempts_left === 1 ? '' : 's'} left (of ${o.max_attempts})`
          }
        />
        <Rule
          icon="timer-outline"
          text={
            o.time_limit_minutes
              ? `${o.time_limit_minutes} minutes, starting when you open the quiz`
              : 'No time limit'
          }
        />
        <Rule
          icon="eye-outline"
          text={
            o.show_correct_answers_after === 'never'
              ? 'Correct answers are not shown'
              : o.show_correct_answers_after === 'after_pass'
                ? 'Correct answers are shown after you pass'
                : 'Correct answers are shown after you pass or use your last attempt'
          }
        />
        <Text className="text-xs text-white/55">
          You need a connection to open the quiz. If you lose signal while answering, your answers
          are kept and sent when you’re back online.
        </Text>
      </Card>

      {o.open_attempt ? (
        <Notice tone="info">
          You have a quiz in progress
          {o.open_attempt.expires_at ? ': the clock is already running' : ''}.
        </Notice>
      ) : null}
      {o.passed ? (
        <Notice tone="info">
          You passed this quiz{lastScore !== null ? ` (${Math.round(lastScore)}%)` : ''}.
        </Notice>
      ) : null}
      {!o.passed && o.attempts_left === 0 && !o.open_attempt ? (
        <Notice tone="error">
          You have no attempts left. Ask your admin if you need another one.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {canStart ? (
        <Button
          title={o.open_attempt || hasDraft ? 'Continue the quiz' : 'Start the quiz'}
          loading={busy}
          onPress={onStart}
        />
      ) : null}

      {lastAttemptId &&
      (o.passed || o.attempts_left === 0) &&
      o.show_correct_answers_after !== 'never' ? (
        review === null ? (
          <Button
            title="See the correct answers"
            variant="secondary"
            onPress={() => {
              setReview('loading');
              void fetchAttemptReview(lastAttemptId).then((r) => setReview(r ?? []));
            }}
          />
        ) : review === 'loading' ? (
          <ActivityIndicator color={brand.gold} />
        ) : review.length === 0 ? (
          <Notice tone="info">Correct answers aren’t available.</Notice>
        ) : (
          <AnswerReview review={review} />
        )
      ) : null}
    </ScrollView>
  );
}

function Rule({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <Ionicons name={icon} size={18} color={brand.gold} />
      <Text className="flex-1 text-base text-white/90">{text}</Text>
    </View>
  );
}

/** "mm:ss left", or null without a time limit. Calls onTimeUp once at zero. */
function useCountdown(expiresAt: string | null, onTimeUp: () => void): string | null {
  const now = useNow(1000);
  const fired = useRef(false);
  const left = expiresAt ? Date.parse(expiresAt) - now : null;
  useEffect(() => {
    if (left !== null && left <= 0 && !fired.current) {
      fired.current = true;
      onTimeUp();
    }
  }, [left, onTimeUp]);
  if (left === null) return null;
  const s = Math.max(0, Math.floor(left / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Timer({ text }: { text: string | null }) {
  if (!text) return null;
  const urgent = text.startsWith('0:') || /^[0-1]:/.test(text);
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${urgent ? 'border-red-400/60 bg-red-500/15' : 'border-gold/40'}`}
      accessibilityLabel={`Time left ${text}`}
    >
      <Ionicons name="timer-outline" size={14} color={urgent ? '#fca5a5' : brand.gold} />
      <Text className={`text-sm font-bold ${urgent ? 'text-red-200' : 'text-gold'}`}>{text}</Text>
    </View>
  );
}

function Questions({
  draft,
  bottom,
  onChange,
  onReview,
  onTimeUp,
}: {
  draft: QuizDraft;
  bottom: number;
  onChange: (d: QuizDraft) => void;
  onReview: () => void;
  onTimeUp: () => void;
}) {
  const { quiz, answers, index } = draft;
  const q = quiz.questions[index]!;
  const total = quiz.questions.length;
  const chosen = answers[q.id] ?? [];
  const timer = useCountdown(quiz.attempt.expires_at, onTimeUp);

  function toggle(optionId: string) {
    const next =
      q.type === 'multiple_choice'
        ? chosen.includes(optionId)
          ? chosen.filter((x) => x !== optionId)
          : [...chosen, optionId]
        : [optionId];
    onChange({ ...draft, answers: { ...answers, [q.id]: next } });
  }

  return (
    <View className="flex-1">
      <View className="gap-2 px-5 pt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-bold text-white">
            Question {index + 1} of {total}
          </Text>
          <Timer text={timer} />
        </View>
        <ProgressBar value={(index + 1) / total} />
      </View>
      <ScrollView contentContainerClassName="gap-3 p-5">
        <Text className="text-xl font-extrabold leading-7 text-white">{q.prompt}</Text>
        <Text className="text-xs uppercase tracking-[2px] text-white/50">
          {q.type === 'multiple_choice' ? 'Choose all that apply' : 'Choose one'}
        </Text>
        {q.options.map((o) => {
          const selected = chosen.includes(o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() => toggle(o.id)}
              accessibilityRole={q.type === 'multiple_choice' ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected }}
              className={`flex-row items-center gap-3 rounded-3xl border-2 px-5 py-4 ${selected ? 'border-gold bg-gold/15' : 'border-white/10'}`}
              style={selected ? undefined : fx.glass}
            >
              <Ionicons
                name={
                  q.type === 'multiple_choice'
                    ? selected
                      ? 'checkbox'
                      : 'square-outline'
                    : selected
                      ? 'radio-button-on'
                      : 'radio-button-off'
                }
                size={22}
                color={brand.gold}
              />
              <Text className="flex-1 text-base text-white">{o.text}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View
        className="flex-row gap-3 border-t border-white/10 px-5 pt-3"
        style={{ paddingBottom: bottom + 12 }}
      >
        <View className="flex-1">
          <Button
            title="Back"
            variant="secondary"
            disabled={index === 0}
            onPress={() => onChange({ ...draft, index: index - 1 })}
          />
        </View>
        <View className="flex-1">
          {index < total - 1 ? (
            <Button title="Next" onPress={() => onChange({ ...draft, index: index + 1 })} />
          ) : (
            <Button title="Review" onPress={onReview} />
          )}
        </View>
      </View>
    </View>
  );
}

function ReviewAnswers({
  draft,
  busy,
  bottom,
  onEdit,
  onSubmit,
  onTimeUp,
}: {
  draft: QuizDraft;
  busy: boolean;
  bottom: number;
  onEdit: (index: number) => void;
  onSubmit: () => void;
  onTimeUp: () => void;
}) {
  const timer = useCountdown(draft.quiz.attempt.expires_at, onTimeUp);
  const unanswered = draft.quiz.questions.filter(
    (q) => (draft.answers[q.id] ?? []).length === 0,
  ).length;
  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-5 pt-3">
        <Text className="text-lg font-extrabold text-white">Check your answers</Text>
        <Timer text={timer} />
      </View>
      <ScrollView contentContainerClassName="gap-3 p-5">
        {draft.quiz.questions.map((q, i) => {
          const picked = q.options.filter((o) => (draft.answers[q.id] ?? []).includes(o.id));
          return (
            <Pressable key={q.id} onPress={() => onEdit(i)} accessibilityRole="button">
              <Card tone={picked.length === 0 ? 'danger' : 'default'}>
                <Text className="text-xs text-white/50">Question {i + 1}</Text>
                <Text className="text-base font-bold text-white">{q.prompt}</Text>
                <Text className={`text-sm ${picked.length ? 'text-gold' : 'text-red-300'}`}>
                  {picked.length
                    ? picked.map((o) => o.text).join(', ')
                    : 'Not answered: tap to answer'}
                </Text>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
      <View
        className="gap-2 border-t border-white/10 px-5 pt-3"
        style={{ paddingBottom: bottom + 12 }}
      >
        <Button
          title="Submit answers"
          loading={busy}
          onPress={() => {
            if (unanswered === 0) return onSubmit();
            Alert.alert(
              'Submit anyway?',
              `${unanswered} question${unanswered === 1 ? ' is' : 's are'} not answered and will count as wrong.`,
              [
                { text: 'Keep answering', style: 'cancel' },
                { text: 'Submit', style: 'destructive', onPress: onSubmit },
              ],
            );
          }}
        />
      </View>
    </View>
  );
}

function Result({ result, bottom }: { result: AttemptResult; bottom: number }) {
  return (
    <ScrollView
      contentContainerClassName="gap-4 p-5"
      contentContainerStyle={{ paddingBottom: bottom + 24 }}
    >
      <Card tone={result.passed ? 'warn' : 'danger'}>
        <Ionicons
          name={result.passed ? 'trophy' : 'close-circle-outline'}
          size={40}
          color={result.passed ? brand.gold : '#fca5a5'}
        />
        <Text className="text-3xl font-extrabold text-white">
          {Math.round(result.score_percent)}%
        </Text>
        <Badge tone={result.passed ? 'gold' : 'danger'}>
          {result.passed ? 'Passed' : 'Not passed'}
        </Badge>
        <Text className="text-sm text-white/70">
          Pass mark {result.pass_mark_percent}% · attempt {result.attempt_number}
          {result.attempts_left !== null
            ? ` · ${result.attempts_left} attempt${result.attempts_left === 1 ? '' : 's'} left`
            : ''}
        </Text>
        {result.timed_out ? (
          <Notice tone="error">
            Your answers arrived after the time limit, so this attempt scored 0.
          </Notice>
        ) : null}
      </Card>
      {result.review ? (
        <>
          <SectionTitle>Correct answers</SectionTitle>
          <AnswerReview review={result.review} />
        </>
      ) : (
        <Text className="text-sm text-white/55">
          Correct answers aren’t shown for this quiz yet.
        </Text>
      )}
      <Button
        title="Back to training"
        variant="secondary"
        onPress={() => router.navigate('/training')}
      />
    </ScrollView>
  );
}

function AnswerReview({ review }: { review: Review }) {
  return (
    <View className="gap-3">
      {review.map((r, i) => {
        const mine = new Set(r.your_option_ids);
        const key = new Set(r.correct_option_ids);
        const right = mine.size > 0 && mine.size === key.size && [...key].every((k) => mine.has(k));
        return (
          <Card key={r.question_id} tone={right ? 'default' : 'danger'}>
            <Text className="text-xs text-white/50">
              Question {i + 1} · {right ? 'right' : 'wrong'}
            </Text>
            <Text className="text-base font-bold text-white">{r.prompt}</Text>
            {r.options.map((o) => (
              <View key={o.id} className="flex-row items-center gap-2">
                <Ionicons
                  name={
                    key.has(o.id)
                      ? 'checkmark-circle'
                      : mine.has(o.id)
                        ? 'close-circle'
                        : 'ellipse-outline'
                  }
                  size={18}
                  color={
                    key.has(o.id)
                      ? brand.gold
                      : mine.has(o.id)
                        ? '#fca5a5'
                        : 'rgba(255,255,255,0.3)'
                  }
                />
                <Text className={`flex-1 text-sm ${key.has(o.id) ? 'text-gold' : 'text-white/80'}`}>
                  {o.text}
                  {mine.has(o.id) ? '  (your answer)' : ''}
                </Text>
              </View>
            ))}
            {r.explanation ? <Text className="text-sm text-white/65">{r.explanation}</Text> : null}
          </Card>
        );
      })}
    </View>
  );
}
