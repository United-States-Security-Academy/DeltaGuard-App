import { authLinkParamsSchema, setPasswordSchema } from '@deltaguard/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScrollView } from '@/components/keyboard';
import { Body, Button, Loading, Notice, PasswordInput, Title } from '@/components/ui';
import { fieldErrors } from '@/lib/form-errors';
import { useSession } from '@/lib/session';
import { fx } from '@/lib/theme';

type Field = 'password' | 'confirm';

// Opened by the invite deep link. Expo Router maps the URL path to this file
// and the query string to search params:
//   deltaguard://set-password?token_hash=…&type=invite          (dev/store build)
//   exp://<PC-LAN-IP>:8081/--/set-password?token_hash=…&type=invite (Expo Go)
export default function SetPasswordScreen() {
  const params = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const { acceptInvite, setPassword, state } = useSession();
  const link = authLinkParamsSchema.safeParse(params);
  // Nothing happens until the person taps Continue: a link alone never signs
  // anyone in (src/lib/deep-links.ts has already checked its parameters).
  const [phase, setPhase] = useState<'confirm' | 'verifying' | 'form' | 'failed'>(
    link.success ? 'confirm' : 'failed',
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

  // The token is single-use, so verify it exactly once, when asked to.
  const tokenHash = linkData?.token_hash;
  const linkType = linkData?.type;
  function verify() {
    if (started.current || !tokenHash || !linkType) return;
    started.current = true;
    setPhase('verifying');
    void acceptInvite({ token_hash: tokenHash, type: linkType }).then((error) => {
      if (error) {
        setLinkError(error);
        setPhase('failed');
      } else {
        setPhase('form');
      }
    });
  }

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

  if (phase === 'confirm') {
    // Someone is already signed in on this phone: an invite link must not
    // quietly switch it to another account.
    const signedIn = state.status === 'ready' || state.status === 'unreachable';
    return (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-ink px-6">
        <Title>{linkType === 'recovery' ? 'Reset your password' : 'Set up your account'}</Title>
        {signedIn ? (
          <>
            <Notice tone="error">
              Someone is already signed in on this phone. Sign out first, then open the link
              again.
            </Notice>
            <Button title="Back" variant="secondary" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <Body>
              This link from your DeltaGuard email lets you choose a password. Continue only if you
              asked for it or were invited by Deltacon.
            </Body>
            <Button title="Continue" onPress={verify} />
            <Button title="Cancel" variant="secondary" onPress={() => router.replace('/')} />
          </>
        )}
      </SafeAreaView>
    );
  }

  if (phase === 'failed') {
    return (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-ink px-6">
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
    <SafeAreaView className="flex-1" style={fx.screen}>
      <FormScrollView contentContainerClassName="flex-grow justify-center gap-5 px-6 py-8">
        <Title>Choose your password</Title>
        <Body>
          You&apos;ll sign in with your email and this password. This phone becomes your registered
          device.
        </Body>
        <PasswordInput
          label="New password"
          value={password}
          onChangeText={setPw}
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.password}
        />
        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.confirm}
        />
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button title="Save and continue" onPress={onSubmit} loading={busy} />
      </FormScrollView>
    </SafeAreaView>
  );
}
