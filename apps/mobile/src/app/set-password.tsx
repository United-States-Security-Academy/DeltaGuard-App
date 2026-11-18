import { authLinkParamsSchema, setPasswordSchema } from '@deltaguard/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Input, Loading, Notice, Title } from '@/components/ui';
import { fieldErrors } from '@/lib/form-errors';
import { useSession } from '@/lib/session';

type Field = 'password' | 'confirm';

// Opened by the invite deep link. Expo Router maps the URL path to this file
// and the query string to search params:
//   deltaguard://set-password?token_hash=…&type=invite          (dev/store build)
//   exp://<PC-LAN-IP>:8081/--/set-password?token_hash=…&type=invite (Expo Go)
export default function SetPasswordScreen() {
  const params = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const { acceptInvite, setPassword } = useSession();
  const link = authLinkParamsSchema.safeParse(params);
  const [phase, setPhase] = useState<'verifying' | 'form' | 'failed'>(
    link.success ? 'verifying' : 'failed',
  );
  const [linkError, setLinkError] = useState<string | null>(
    link.success ? null : 'This link is incomplete. Open the invite email again.',
  );
  const linkData = link.success ? link.data : null;
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // The token is single-use, so verify it exactly once.
  const tokenHash = linkData?.token_hash;
  const linkType = linkData?.type;
  useEffect(() => {
    if (started.current || !tokenHash || !linkType) return;
    started.current = true;

    void acceptInvite({ token_hash: tokenHash, type: linkType }).then((error) => {
      if (error) {
        setLinkError(error);
        setPhase('failed');
      } else {
        setPhase('form');
      }
    });
  }, [acceptInvite, tokenHash, linkType]);

  async function onSubmit() {
    setFormError(null);
    const parsed = setPasswordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const error = await setPassword(parsed.data.password);
    setBusy(false);
    if (error) {
      setFormError(error);
      return;
    }
    router.replace('/');
  }

  if (phase === 'verifying') return <Loading />;

  if (phase === 'failed') {
    return (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-white px-6 dark:bg-slate-950">
        <Title>Link not valid</Title>
        <Notice tone="error">{linkError}</Notice>
        <Button
          title="Go to sign in"
          variant="secondary"
          onPress={() => router.replace('/sign-in')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-950">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center gap-5 px-6 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <Title>Choose your password</Title>
          <Body>
            You&apos;ll sign in with your email and this password. This phone becomes your
            registered device.
          </Body>
          <Input
            label="New password"
            value={password}
            onChangeText={setPw}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={errors.password}
          />
          <Input
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={errors.confirm}
          />
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Button title="Save and continue" onPress={onSubmit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
