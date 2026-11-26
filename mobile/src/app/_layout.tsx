import { StatusBar, useColorScheme } from 'react-native';
import { AppErrorBoundary } from '../shared/AppErrorBoundary.tsx';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AccountLayout from './(account)/_layout.tsx';

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <AppErrorBoundary><AccountLayout /></AppErrorBoundary>
    </SafeAreaProvider>
  );
}
