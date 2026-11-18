import { APP_NAME, COMPANY_NAME, signInSchema } from '@deltaguard/shared';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Input, Notice, Title } from '@/components/ui';
import { fieldErrors } from '@/lib/form-errors';
import { useSession } from '@/lib/session';

type Field = 'email' | 'password';

export default function SignInScreen() {
  const { state, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Why they were signed out (device reset, account suspended…), if anything.
  const notice = state.status === 'signedOut' ? state.notice : undefined;

  async function onSubmit() {
    setFormError(null);
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const error = await signIn(parsed.data.email, parsed.data.password);
    setBusy(false);
    if (error) setFormError(error);
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
          <View className="gap-1">
            <Text className="text-sm font-medium uppercase tracking-widest text-slate-500">
              {COMPANY_NAME}
            </Text>
            <Title>Sign in to {APP_NAME}</Title>
            <Body>Use the email and password from your invite.</Body>
          </View>

          {notice ? <Notice tone="info">{notice}</Notice> : null}

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            error={errors.email}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={onSubmit}
            error={errors.password}
          />

          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <Button title="Sign in" onPress={onSubmit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
