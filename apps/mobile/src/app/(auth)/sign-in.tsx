import { APP_NAME, signInSchema } from '@deltaguard/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import logo from '@/assets/images/logo.png';
import { BackButton, Body, Button, Input, Notice, Title } from '@/components/ui';
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

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/welcome');
  }

  return (
    <SafeAreaView className="flex-1 bg-ink">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow gap-6 px-6 pb-8 pt-2"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center justify-between">
            <BackButton onPress={goBack} />
            <Image
              source={logo}
              style={{ width: 36, height: 45 }}
              contentFit="contain"
              accessibilityLabel="Deltacon Security Group badge"
            />
          </View>

          <View className="gap-2 pt-4">
            <Title>Sign in</Title>
            <Body>Use the email and password from your {APP_NAME} invite.</Body>
          </View>

          {notice ? <Notice tone="info">{notice}</Notice> : null}

          <View className="gap-4">
            <Input
              label="Email"
              placeholder="Your work email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              error={errors.email}
            />
            <Input
              label="Password"
              placeholder="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              error={errors.password}
            />
          </View>

          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <Button title="Sign in" onPress={onSubmit} loading={busy} />

          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-white/10" />
            <Text className="text-xs uppercase tracking-widest text-white/40">Need help</Text>
            <View className="h-px flex-1 bg-white/10" />
          </View>

          <Text className="text-center text-sm leading-5 text-white/60">
            Forgot your password or changed phones? Contact your supervisor or an administrator.
            This phone becomes your registered device the first time you sign in.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
