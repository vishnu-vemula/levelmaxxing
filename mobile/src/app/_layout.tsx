import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppErrorBoundary } from '../shared/AppErrorBoundary.tsx';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppErrorBoundary><Slot /></AppErrorBoundary>
    </SafeAreaProvider>
  );
}
