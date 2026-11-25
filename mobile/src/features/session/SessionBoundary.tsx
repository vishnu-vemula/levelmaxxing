import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { AccountSetupPending, type AuthEnvironment, type AuthGateway, type Session } from './auth.ts';
import { Action, BrandLockup, Card, Field, Mascot, Notice, Pill, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';

type Credentials = { email: string; password: string; token: string };
type Account = {
  environment: AuthEnvironment;
  session: Session;
  signOut: () => Promise<void>;
  confirmIdentity: (password: string) => Promise<string>;
};
type SessionState = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; session: Session | null };
const AccountContext = createContext<Account | null>(null);

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error('Account scope required');
  return account;
}

type SessionBoundaryProps = {
  children: ReactNode;
  configuration: { environment: AuthEnvironment; gateway: AuthGateway } | null;
};

export function SessionBoundary({ children, configuration }: SessionBoundaryProps) {
  const environment = configuration?.environment;
  const gateway = configuration?.gateway;
  const [state, setState] = useState<SessionState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const colors = useTheme();

  useEffect(() => {
    if (!gateway) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = gateway.subscribe(session => {
      receivedEvent = true;
      if (active) setState({ phase: 'ready', session });
    }, () => {
      receivedEvent = true;
      if (active) setState({ phase: 'failed' });
    });
    void gateway.load().then(session => {
      if (active && !receivedEvent) setState({ phase: 'ready', session });
    }, () => {
      if (active && !receivedEvent) setState({ phase: 'failed' });
    });
    gateway.foreground(AppState.currentState === 'active');
    const lifecycle = AppState.addEventListener('change', next => gateway.foreground(next === 'active'));
    return () => {
      active = false;
      lifecycle.remove();
      unsubscribe();
      gateway.foreground(false);
    };
  }, [attempt, gateway]);

  if (!environment || !gateway) return (
    <Screen title="Connect Levelmaxing">
      <BrandLockup />
      <Card tone="primary"><Notice>Set the API and sign-in configuration for this build, then restart the app.</Notice></Card>
    </Screen>
  );
  if (state.phase === 'loading') return (
    <Screen title="Opening Levelmaxing" hideHeader>
      <BrandLockup />
      <Text accessibilityRole="header" style={[styles.splashTitle, { color: colors.text }]}>
        Train.{'\n'}Eat.{'\n'}<Text style={{ color: colors.primary }}>Level up.</Text>
      </Text>
      <Card tone="primary" style={styles.splashArt}>
        <Mascot size={145} />
        <ActivityIndicator color={colors.focus} accessibilityLabel="Opening your account" />
        <Notice>Opening your account…</Notice>
      </Card>
    </Screen>
  );
  if (state.phase === 'failed') return (
    <Screen title="Account unavailable" accessory={<Mascot tone="sun" />}>
      <Card tone="primary">
        <Notice>Your session could not be verified. Check your connection and try again.</Notice>
        <Action title="Try again" disabled={clearing} onPress={() => {
          setClearFailed(false);
          setState({ phase: 'loading' });
          setAttempt(value => value + 1);
        }} />
        <Action title={clearing ? 'Signing out…' : 'Use another account'} subtle disabled={clearing} onPress={() => {
          setClearing(true);
          setClearFailed(false);
          void gateway.signOut().then(() => setState({ phase: 'ready', session: null }), () => setClearFailed(true))
            .finally(() => setClearing(false));
        }} />
        {clearFailed && <Notice kind="error">Sign-out did not finish. Try again.</Notice>}
      </Card>
    </Screen>
  );
  if (!state.session) return <SignIn mode={environment.mode} gateway={gateway} onSession={session => {
    setState({ phase: 'ready', session });
  }} />;
  const session = state.session;
  const account: Account = {
    environment,
    session,
    confirmIdentity: async (password) => {
      const confirmed = environment.mode === 'local' ? session : await gateway.confirmIdentity?.(password);
      if (confirmed?.accountId !== session.accountId || !confirmed.accessToken) {
        throw new Error('The active account could not be confirmed.');
      }
      return confirmed.accessToken;
    },
    signOut: async () => {
      await gateway.signOut();
      setState({ phase: 'ready', session: null });
    },
  };
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

type Form = 'signin' | 'create' | 'reset';

function authErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function formError(form: Form, error: unknown): string {
  switch (authErrorCode(error)) {
    case 'auth/network-request-failed': return 'Check your connection and try again.';
    case 'auth/too-many-requests': return 'There have been too many attempts. Wait a little and try again.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/password-does-not-meet-requirements':
    case 'auth/weak-password': return 'Choose a stronger password and try again.';
    default: return form === 'signin' ? 'Sign-in failed. Check your details and try again.'
      : form === 'create' ? 'Account creation failed. If you already have an account, sign in or reset your password.'
      : 'We could not request a reset email. Try again.';
  }
}

const titles = { signin: 'Welcome back.', create: 'Start leveling up.', reset: 'Reset password' };
const actions = { signin: 'Sign in', create: 'Create account', reset: 'Send reset link' };

function SignIn({ mode, gateway, onSession }: {
  mode: AuthEnvironment['mode']; gateway: AuthGateway; onSession: (session: Session) => void;
}) {
  const colors = useTheme();
  const [form, setForm] = useState<Form>('signin');
  const [credentials, setCredentials] = useState<Credentials>({ email: '', password: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' | 'info' }>();
  const [showPassword, setShowPassword] = useState(false);
  const pending = useRef(false);

  function changeForm(next: Form) {
    setForm(next);
    setMessage(undefined);
    setCredentials(current => ({ ...current, password: '' }));
    setShowPassword(false);
  }

  const valid = mode === 'local' ? credentials.token.trim().length > 0
    : credentials.email.trim().length > 0 && (form === 'reset' || credentials.password.length > 0);

  async function submit() {
    if (pending.current || !valid) return;
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      if (form === 'reset' && gateway.resetPassword) {
        await gateway.resetPassword(credentials.email);
        setMessage({ text: 'If an account matches this email, a reset link will arrive shortly.', kind: 'success' });
      } else if (form === 'create' && gateway.createAccount) {
        onSession(await gateway.createAccount(credentials));
      } else {
        onSession(await gateway.signIn(credentials));
      }
    } catch (error) {
      if (form === 'reset' && authErrorCode(error) === 'auth/user-not-found') {
        setMessage({ text: 'If an account matches this email, a reset link will arrive shortly.', kind: 'success' });
      } else if (error instanceof AccountSetupPending) {
        changeForm('signin');
        setMessage({ text: 'Your sign-in account was created. Levelmaxing access is still pending. Try signing in again shortly.', kind: 'info' });
      } else {
        setMessage({ text: formError(form, error), kind: 'error' });
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen title="Levelmaxing" hideHeader>
      <BrandLockup />
      <View style={styles.greeting}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>{titles[form]}</Text>
        <Mascot size={77} tone="sun" />
      </View>
      {mode === 'cloud' && form !== 'reset' && (
        <View style={styles.choices}>
          <Pill label="Sign in" selected={form === 'signin'} disabled={busy} onPress={() => changeForm('signin')} />
          {gateway.createAccount && <Pill label="Create account" selected={form === 'create'} disabled={busy} onPress={() => changeForm('create')} />}
        </View>
      )}
      <Card>
        {mode === 'local' ? <>
          <SectionTitle>Development account</SectionTitle>
          <Field label="Development token" editable={!busy} autoCapitalize="none" autoCorrect={false}
            autoComplete="off" secureTextEntry value={credentials.token} maxLength={8192}
            onChangeText={token => setCredentials(current => ({ ...current, token }))} />
        </> : <>
          {form === 'reset' && <Notice>Enter your email address to get a link to choose a new password.</Notice>}
          <Field label="Email address" editable={!busy} autoCapitalize="none" autoCorrect={false}
            autoComplete="email" keyboardType="email-address" value={credentials.email}
            onChangeText={email => setCredentials(current => ({ ...current, email }))} />
          {form !== 'reset' && <>
            <Field label="Password" editable={!busy} autoCapitalize="none" autoCorrect={false}
              autoComplete={form === 'create' ? 'new-password' : 'current-password'}
              secureTextEntry={!showPassword} value={credentials.password}
              onChangeText={password => setCredentials(current => ({ ...current, password }))} />
            <View style={styles.choices}>
              <Pill label={showPassword ? 'Hide password' : 'Show password'} disabled={busy} onPress={() => setShowPassword(value => !value)} />
              {form === 'signin' && gateway.resetPassword && <Pill label="Forgot password?" disabled={busy} onPress={() => changeForm('reset')} />}
            </View>
          </>}
        </>}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <Action title={busy ? 'Please wait…' : actions[form]} disabled={busy || !valid} onPress={() => { void submit(); }} />
        {form === 'reset' && <Action title="Back to sign in" subtle disabled={busy} onPress={() => changeForm('signin')} />}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  splashTitle: { fontSize: 65, fontWeight: '900', letterSpacing: -3.2 },
  splashArt: { alignItems: 'center', paddingVertical: 26 },
  greeting: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heading: { flex: 1, fontSize: 42, fontWeight: '900', letterSpacing: -1.8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
