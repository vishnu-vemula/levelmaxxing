export type AdminConfiguration = {
  apiBase: string;
  identity:
    | { kind: 'local' }
    | { kind: 'firebase'; projectId: string; apiKey: string; authDomain: string; appId: string }
    | { kind: 'unavailable'; reason: string };
};

type Settings = {
  DEV?: boolean;
  VITE_LEVELMAXING_API_BASE?: string;
  VITE_LEVELMAXING_AUTH_MODE?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_APP_ID?: string;
};

export function readConfiguration(settings: Settings): AdminConfiguration {
  const apiBase = (settings.VITE_LEVELMAXING_API_BASE?.trim() || '/api').replace(/\/$/, '');
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(apiBase) || apiBase.startsWith('//') || apiBase.includes('//')) {
    return {
      apiBase: '',
      identity: {
        kind: 'unavailable',
        reason: 'Configure the admin API as a same-origin path before signing in.',
      },
    };
  }

  const mode = settings.VITE_LEVELMAXING_AUTH_MODE?.trim() || 'firebase';
  if (mode === 'local' && settings.DEV === true) return { apiBase, identity: { kind: 'local' } };

  const unavailable: AdminConfiguration = {
    apiBase,
    identity: {
      kind: 'unavailable',
      reason: 'Configure Firebase Authentication and an operator account to use this console.',
    },
  };
  if (mode !== 'firebase') return unavailable;

  const projectId = settings.VITE_FIREBASE_PROJECT_ID?.trim() ?? '';
  const apiKey = settings.VITE_FIREBASE_API_KEY?.trim() ?? '';
  const appId = settings.VITE_FIREBASE_APP_ID?.trim() ?? '';
  const authDomain = settings.VITE_FIREBASE_AUTH_DOMAIN?.trim().toLowerCase() || projectId + '.firebaseapp.com';
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
    || !/^AIza[A-Za-z0-9_-]{20,100}$/.test(apiKey)
    || !/^1:\d+:web:[a-f0-9]+$/.test(appId)
    || authDomain.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(authDomain)) {
    return unavailable;
  }

  return { apiBase, identity: { kind: 'firebase', projectId, apiKey, appId, authDomain } };
}
