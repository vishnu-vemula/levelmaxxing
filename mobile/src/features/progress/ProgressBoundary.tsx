import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { WeightMeasurement } from '@levelmaxing/contracts';
import { publishRecent } from './recent.ts';
import {
  SyncContextChanged, SyncCursorExpired, SyncSignInRequired, syncProgress,
  type Entry, type ProgressStore, type SyncTransport,
} from './sync.ts';

type SyncState = 'idle' | 'running' | 'current' | 'offline' | 'review' | 'reconnect';
type Progress = {
  entries: Entry[];
  availability: 'opening' | 'ready' | 'failed';
  syncState: SyncState;
  save: (weight: WeightMeasurement) => Promise<void>;
  refresh: () => void;
};
const ProgressContext = createContext<Progress | null>(null);

export function useProgress() {
  const value = useContext(ProgressContext);
  if (!value) throw new Error('Progress scope required');
  return value;
}

type ProgressBoundaryProps = PropsWithChildren<{
  scope: string;
  transport: SyncTransport | null;
  openStore(scope: string): Promise<ProgressStore>;
  createId(): string;
}>;

export function ProgressBoundary(props: ProgressBoundaryProps) {
  return <AccountProgress key={props.scope} {...props} />;
}

function AccountProgress({ scope, transport, openStore, createId, children }: ProgressBoundaryProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [availability, setAvailability] = useState<Progress['availability']>('opening');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [version, setVersion] = useState(0);
  const store = useRef<ProgressStore | null>(null);
  const syncFlight = useRef<Promise<void>>(Promise.resolve());
  const triggerRef = useRef<() => void>(() => undefined);

  const refreshRecent = useCallback(
    (db: ProgressStore, isCurrent: () => boolean, onPublished?: () => void) =>
      publishRecent(db, isCurrent, {
        publish(value) {
          setEntries(value);
          onPublished?.();
        },
        unavailable: () => setAvailability('failed'),
      }),
    [],
  );

  useEffect(() => {
    let stale = false;
    const opening = openStore(scope);
    void opening.then(db => refreshRecent(db, () => !stale, () => {
      store.current = db;
      setAvailability('ready');
    })).catch(() => {
      if (!stale) setAvailability('failed');
    });
    return () => {
      stale = true;
      store.current = null;
      void opening.then(async (opened) => {
        await syncFlight.current.catch(() => undefined);
        await opened.close();
      }).catch(() => undefined);
    };
  }, [openStore, refreshRecent, scope]);

  useEffect(() => {
    if (availability !== 'ready') return;
    if (!transport) {
      setSyncState('reconnect');
      return;
    }
    const db = store.current;
    if (!db) return;
    const stop = new AbortController();
    let busy = false;
    let queued = false;
    let blocked = false;
    const trigger = () => {
      if (stop.signal.aborted || AppState.currentState !== 'active' || blocked) return;
      if (busy) {
        queued = true;
        return;
      }
      busy = true;
      setSyncState('running');
      syncFlight.current = syncFlight.current.catch(() => undefined).then(async () => {
        if (stop.signal.aborted) return;
        try {
          const result = await syncProgress(db, transport, stop.signal);
          if (!stop.signal.aborted) {
            queued ||= result === 'continue';
            setSyncState(queued ? 'running' : 'current');
          }
        } catch (error) {
          if (stop.signal.aborted) return;
          const invalidSession = error instanceof SyncSignInRequired;
          const contextChanged = error instanceof SyncContextChanged || error instanceof SyncCursorExpired;
          blocked = invalidSession || contextChanged;
          setSyncState(invalidSession ? 'reconnect' : contextChanged ? 'review' : 'offline');
        }
        await refreshRecent(db, () => !stop.signal.aborted && store.current === db);
      }).finally(() => {
        busy = false;
        if (queued) {
          queued = false;
          trigger();
        }
      });
    };
    triggerRef.current = trigger;
    const lifecycle = AppState.addEventListener('change', state => { if (state === 'active') trigger(); });
    const poll = setInterval(trigger, 20_000);
    trigger();
    return () => {
      stop.abort();
      clearInterval(poll);
      lifecycle.remove();
      if (triggerRef.current === trigger) triggerRef.current = () => undefined;
    };
  }, [availability, refreshRecent, transport, version]);

  async function save(weight: WeightMeasurement) {
    const db = store.current;
    if (!db) throw new Error('Storage has not opened');
    await db.enqueue(createId(), weight);
    if (store.current !== db) return;
    triggerRef.current();
    // Refresh failures leave the saved intent durable and report storage separately.
    await refreshRecent(db, () => store.current === db);
  }

  return <ProgressContext.Provider value={{
    entries, availability, syncState, save, refresh: () => setVersion(value => value + 1),
  }}>{children}</ProgressContext.Provider>;
}
