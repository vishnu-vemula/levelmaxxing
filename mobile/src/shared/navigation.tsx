import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

export type AppPath = '/' | '/add' | '/check-in' | '/coach' | '/export-data' | '/food' | '/groceries'
  | '/history' | '/library' | '/more' | '/nutrition' | '/onboarding' | '/program' | '/progress'
  | '/recipes' | '/settings' | '/workout';

type Params = Readonly<Record<string, string | undefined>>;
type Route = { pathname: AppPath; params: Params };
type Destination = AppPath | { pathname: AppPath; params?: Params };
type Router = {
  push(destination: Destination): void;
  replace(destination: Destination): void;
  back(): void;
  canGoBack(): boolean;
  setParams(params: Params): void;
};

const Navigation = createContext<{ route: Route; router: Router } | null>(null);
const start: Route = { pathname: '/', params: {} };

function routeFor(destination: Destination): Route {
  return typeof destination === 'string' ? { pathname: destination, params: {} }
    : { pathname: destination.pathname, params: destination.params ?? {} };
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<readonly Route[]>([start]);
  const route = stack.at(-1) ?? start;
  const canGoBack = stack.length > 1;
  const router = useMemo<Router>(() => ({
    push: (target) => setStack(previous => [...previous, routeFor(target)]),
    replace: (target) => setStack(previous => [...previous.slice(0, -1), routeFor(target)]),
    back: () => setStack(previous => previous.length > 1 ? previous.slice(0, -1) : previous),
    canGoBack: () => canGoBack,
    setParams: (params) => setStack(previous => {
      const current = previous.at(-1) ?? start;
      return [...previous.slice(0, -1), { ...current, params: { ...current.params, ...params } }];
    }),
  }), [canGoBack]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!router.canGoBack()) return false;
      router.back();
      return true;
    });
    return () => subscription.remove();
  }, [router]);

  return <Navigation.Provider value={{ route, router }}>{children}</Navigation.Provider>;
}

function useNavigation() {
  const navigation = useContext(Navigation);
  if (!navigation) throw new Error('Navigation is unavailable.');
  return navigation;
}

export const useRouter = () => useNavigation().router;
export const usePathname = () => useNavigation().route.pathname;
export const useLocalSearchParams = <T extends Params>() => useNavigation().route.params as T;
