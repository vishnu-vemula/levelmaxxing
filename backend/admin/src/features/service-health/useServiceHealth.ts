import { useEffect, useState } from 'react';
import { getServiceStatus } from './api.ts';

type ServiceHealth =
  | { kind: 'checking' }
  | { kind: 'unavailable' | 'reachable'; at: string };

export function useServiceHealth(apiBase: string) {
  const [observation, setObservation] = useState<ServiceHealth>({ kind: 'checking' });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void getServiceStatus(apiBase, signal).then(
      (available) => {
        if (!signal.aborted) {
          setObservation({ kind: available ? 'reachable' : 'unavailable', at: new Date().toISOString() });
        }
      },
      () => {
        if (!signal.aborted) setObservation({ kind: 'unavailable', at: new Date().toISOString() });
      },
    );
    return () => controller.abort();
  }, [apiBase, revision]);

  return {
    observation,
    refresh() {
      setObservation({ kind: 'checking' });
      setRevision((previous) => previous + 1);
    },
  };
}
