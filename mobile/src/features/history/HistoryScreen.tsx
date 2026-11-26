import {
  parseWorkspaceHistoryKind, WORKSPACE_HISTORY_MOVE_MAX, workspaceHistorySection, type WorkspaceHistoryCursor,
  type WorkspaceHistoryKind, type WorkspaceHistoryMove, type WorkspaceHistoryPage, type WorkspaceHistoryRow,
} from '@levelmaxing/contracts';
import { randomUUID } from '../../platform/native-storage.ts';
import { useLocalSearchParams, useRouter } from '../../shared/navigation.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiFailure, createApiRequester } from '../../platform/api.ts';
import { Action, Card, Field, Notice, Pill, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useAccount } from '../session/index.ts';
import { sameWorkspaceValue, useWorkspace } from '../workspace/index.ts';
import { createHistoryApi, prepareHistoryCommand, unsupportedHistory } from './api.ts';
import { activeHistoryRows, matchesHistorySelection } from './selection.ts';
import { createNativeHistoryStore } from './native-store.ts';

const activePageSize = 20;
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

type Mode = 'active' | 'archive';
type ArchiveState = {
  api: ReturnType<typeof createHistoryApi>;
  before: WorkspaceHistoryCursor | null;
  refresh: number;
} & ({ outcome: 'ready'; page: WorkspaceHistoryPage } | { outcome: 'failed' | 'unsupported' });
type Confirmation = { rows: WorkspaceHistoryRow[]; action: WorkspaceHistoryMove['action'] };
type Feedback = { message: string; kind: 'error' | 'success' };

export function HistoryScreen() {
  const { kind: rawKind } = useLocalSearchParams<{ kind?: string }>();
  const kind = parseWorkspaceHistoryKind(rawKind) ?? 'meals';
  const { environment, session } = useAccount();
  return <HistoryFlow key={`${environment.mode}|${environment.api}|${session.accountId}|${kind}`} kind={kind} />;
}

function HistoryFlow({ kind }: { kind: WorkspaceHistoryKind }) {
  const router = useRouter();
  const meals = kind === 'meals';
  const workspace = useWorkspace(workspaceHistorySection(kind));
  const units = useWorkspace('profile').value?.units ?? 'kg';
  const { environment, session } = useAccount();
  const { api: endpoint } = environment;
  const { accessToken, accountId } = session;
  const environmentMode = environment.mode;
  const publishableKey = environment.mode === 'cloud' ? environment.publishableKey : undefined;
  const api = useMemo(
    () => accessToken ? createHistoryApi(createApiRequester(endpoint, accessToken, publishableKey)) : null,
    [accessToken, endpoint, publishableKey],
  );

  const store = useMemo(
    () => createNativeHistoryStore(JSON.stringify([environmentMode, endpoint, accountId]), kind),
    [accountId, endpoint, environmentMode, kind],
  );
  const [storage, setStorage] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [storageRefresh, setStorageRefresh] = useState(0);
  const [mode, setMode] = useState<Mode>('archive');
  const [selection, setSelection] = useState(new Map<string, WorkspaceHistoryRow>());
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [activePage, setActivePage] = useState(0);
  const [filter, setFilter] = useState('');
  const [archive, setArchive] = useState<ArchiveState>();
  const [cursors, setCursors] = useState<WorkspaceHistoryCursor[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<WorkspaceHistoryMove>();
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const sendingRef = useRef<AbortController | null>(null);
  const cursor = cursors.at(-1) ?? null;
  const loaded = archive?.api === api && archive.before === cursor && archive.refresh === refresh ? archive : undefined;
  const serverPage = loaded?.outcome === 'ready' ? loaded.page : undefined;
  const activeRows = useMemo(() => activeHistoryRows(kind, workspace.value), [kind, workspace.value]);
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? activeRows.filter(({ date, value }) => date.includes(term) || value.name.toLowerCase().includes(term)) : activeRows;
  }, [activeRows, filter]);
  const page = Math.min(activePage, Math.max(0, Math.ceil(filtered.length / activePageSize) - 1));
  const visibleRows = mode === 'archive' ? serverPage?.rows ?? [] : filtered.slice(page * activePageSize, (page + 1) * activePageSize);
  const navigating = sending || confirmation !== undefined;
  const locked = navigating || pending !== undefined;
  const canMove = api !== null && storage === 'ready' && workspace.status === 'saved' &&
    workspace.version > 0 && serverPage !== undefined;
  const cardTone = meals ? 'accent' : 'primary';
  const entity = meals ? 'food entry' : 'workout';

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    const request = { api, before: cursor, refresh };
    void api.archivePage(kind, cursor, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setArchive({ ...request, outcome: 'ready', page });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setArchive({ ...request, outcome: unsupportedHistory(error) ? 'unsupported' : 'failed' });
      },
    );
    return () => controller.abort();
  }, [api, kind, cursor, refresh]);

  useEffect(() => {
    let active = true;
    void store.load().then(
      (command) => {
        if (active) {
          setPending(command);
          setStorage('ready');
        }
      },
      () => { if (active) setStorage('failed'); },
    );
    return () => { active = false; };
  }, [storageRefresh, store]);

  useEffect(() => () => { sendingRef.current?.abort(); sendingRef.current = null; }, []);

  function clearSelection() {
    setSelection(new Map());
    setConfirmation(undefined);
  }

  function switchMode(next: Mode) {
    setMode(next);
    clearSelection();
  }

  function select(row: WorkspaceHistoryRow) {
    setSelection((selected) => {
      const next = new Map(selected);
      if (next.has(row.id)) next.delete(row.id);
      else if (next.size < WORKSPACE_HISTORY_MOVE_MAX) next.set(row.id, row);
      return next;
    });
  }

  function reload() {
    workspace.retry();
    setCursors([]);
    setRefresh((value) => value + 1);
    clearSelection();
  }

  function showChanged() {
    reload();
    setFeedback({ kind: 'error', message: 'These records changed. Review the refreshed history before moving them.' });
  }

  async function execute(move?: WorkspaceHistoryMove) {
    if (!api || storage !== 'ready' || sendingRef.current || (move === undefined && (!confirmation || !canMove))) return;
    const controller = new AbortController();
    sendingRef.current = controller;
    setSending(true);
    setFeedback(undefined);
    let command = move;
    try {
      if (!command && confirmation) {
        const { rows, action } = confirmation;
        const [current, latestArchive] = await Promise.all([
          api.activeSnapshot(kind, controller.signal),
          action === 'restore' ? api.archivePage(kind, cursor, controller.signal) : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        const latestRows = latestArchive?.rows ?? visibleRows;
        const observed = { version: workspace.version, value: workspace.value };
        if (!matchesHistorySelection(observed, current.snapshot, rows, latestRows, sameWorkspaceValue)) {
          showChanged();
          return;
        }
        command = prepareHistoryCommand(action, kind, rows, randomUUID(), current);
        if (!command) {
          showChanged();
          return;
        }
        const requestedOperation = command.operationId;
        try {
          command = await store.stage(command);
        } catch {
          if (!controller.signal.aborted) {
            setStorage('failed');
            setConfirmation(undefined);
            setFeedback({ kind: 'error', message: 'The move could not be saved on this device. Reopen saved moves and try again.' });
          }
          return;
        }
        if (controller.signal.aborted) return;
        setPending(command);
        setConfirmation(undefined);
        if (command.operationId !== requestedOperation) return;
      }
      if (!command) return;
      const result = await api.move(command, controller.signal);
      if (controller.signal.aborted) return;
      await store.complete(command.operationId);
      if (controller.signal.aborted) return;
      setPending(undefined);
      reload();
      if (result.outcome === 'applied') {
        const verb = command.action === 'archive' ? 'Archived' : 'Restored';
        const plural = meals ? 'food entries' : 'workouts';
        setFeedback({ kind: 'success', message: `${verb} ${result.moved} ${result.moved === 1 ? entity : plural}.` });
      } else if (result.outcome === 'capacity') {
        setFeedback({ kind: 'error', message: 'There is not enough room in active history. Archive some active records, then try restoring fewer at a time.' });
      } else {
        setFeedback({ kind: 'error', message: 'These records changed. Review the refreshed history before moving them.' });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (unsupportedHistory(error)) {
        clearSelection();
        setFeedback({ kind: 'error', message: 'This server does not have the history archive yet.' });
      } else if (command && error instanceof ApiFailure && error.status === 409 && error.code === 'history_operation_changed') {
        try {
          await store.complete(command.operationId);
          if (controller.signal.aborted) return;
          setPending(undefined);
          showChanged();
        } catch {
          if (!controller.signal.aborted) setFeedback({ kind: 'error', message: 'The saved move could not be cleared. Retry when device storage is available.' });
        }
      } else if (error instanceof ApiFailure && (error.status === 401 || error.status === 403)) {
        setFeedback({ kind: 'error', message: 'Confirm your account connection and retry.' });
      } else {
        setFeedback({ kind: 'error', message: command
          ? 'The server response was interrupted. Retry this move to check its original result.'
          : 'Could not check the latest history. Check your connection and try again.' });
      }
    } finally {
      if (sendingRef.current === controller) {
        sendingRef.current = null;
        setSending(false);
      }
    }
  }

  return <Screen title={meals ? 'Food archive' : 'Workout archive'}
    detail={meals ? 'Move earlier food entries out of your active diary.' : 'Move completed workouts out of your active history.'}
    onBack={() => router.canGoBack() ? router.back() : router.replace(meals ? '/nutrition' : { pathname: '/workout', params: { view: 'history' } })}>
    <View style={styles.actions} accessibilityRole="tablist">
      <Pill label="Archive" role="tab" selected={mode === 'archive'} disabled={navigating} onPress={() => switchMode('archive')} />
      <Pill label="Active records" role="tab" selected={mode === 'active'} disabled={navigating} onPress={() => switchMode('active')} />
    </View>
    {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
    {!api && <Notice>Connect to your account to view or move archived records.</Notice>}
    {api && !loaded && <Notice>Loading archive…</Notice>}
    {loaded?.outcome === 'unsupported' && <Notice>This server does not have the history archive yet.</Notice>}
    {loaded?.outcome === 'failed' && <Notice kind="error">Could not load the archive. Check your connection and refresh.</Notice>}
    {api && workspace.status !== 'saved' && <Notice>Sync your active records before moving history.</Notice>}
    <Action title="Refresh history" subtle disabled={navigating || !api} onPress={reload} />
    {storage === 'loading' && <Notice>Checking saved moves…</Notice>}
    {storage === 'failed' && <Card>
      <Notice kind="error">Saved moves could not be opened on this device.</Notice>
      <Action title="Reopen saved moves" subtle onPress={() => { setStorage('loading'); setStorageRefresh((count) => count + 1); }} />
    </Card>}

    {pending && <Card tone={cardTone}>
      <SectionTitle>Move pending confirmation</SectionTitle>
      <Notice>Retrying uses the original request so the same records move only once.</Notice>
      <Action title={sending ? 'Checking move…' : 'Retry move'} tone={cardTone} disabled={sending || !api || storage !== 'ready'} onPress={() => void execute(pending)} />
    </Card>}

    {confirmation && <Card tone={cardTone}>
      <SectionTitle>{confirmation.action === 'archive' ? 'Archive selected records?' : 'Restore selected records?'}</SectionTitle>
      <Notice>{confirmation.action === 'archive'
        ? meals ? 'These entries leave active diary totals until you restore them.' : 'These workouts leave active history and set suggestions until you restore them.'
        : meals ? 'These entries return to their original days in your active diary.' : 'These workouts return to your active history so you can make corrections.'}</Notice>
      {confirmation.rows.map(({ id, value, date }) => <Notice key={id}>{value.name} · {date}</Notice>)}
      <Action title={sending ? 'Checking records…' : `${confirmation.action === 'archive' ? 'Archive' : 'Restore'} ${confirmation.rows.length}`}
        tone={cardTone} disabled={sending || !canMove} onPress={() => void execute()} />
      <Action title="Cancel" subtle disabled={sending} onPress={() => setConfirmation(undefined)} />
    </Card>}

    {mode === 'active' && <Field label="Filter active records by name or date" value={filter} autoCapitalize="none" maxLength={120}
      onChangeText={(value) => { setFilter(value); setActivePage(0); clearSelection(); }} editable={!locked} />}
    {mode === 'active' && workspace.status === 'loading' && <Notice>Loading active history…</Notice>}
    {mode === 'active' && workspace.status === 'unavailable' && <Notice kind="error">Active history could not be loaded on this device.</Notice>}
    {mode === 'active' && workspace.status !== 'loading' && workspace.status !== 'unavailable' && visibleRows.length === 0 &&
      <Notice>{filter.trim() ? 'No active records match your filter.' : 'No active records to archive.'}</Notice>}
    {mode === 'archive' && serverPage?.rows.length === 0 && <Notice>{cursor ? 'No more archived records.' : 'No archived records yet.'}</Notice>}

    {!locked && selection.size > 0 && <Action
      title={`Review ${selection.size} selected`}
      tone={cardTone} disabled={!canMove} onPress={() => setConfirmation({
        action: mode === 'archive' ? 'restore' : 'archive', rows: [...selection.values()],
      })} />}
    {visibleRows.map((row) => <HistoryRecord key={row.id} row={row} units={units} selected={selection.has(row.id)}
      onToggle={() => select(row)} disabled={locked || !canMove || (!selection.has(row.id) && selection.size === WORKSPACE_HISTORY_MOVE_MAX)} />)}
    <View style={styles.actions}>
      {mode === 'active' && <>
        {page > 0 && <Pill label="Previous page" disabled={navigating} onPress={() => { setActivePage(page - 1); clearSelection(); }} />}
        {filtered.length > (page + 1) * activePageSize && <Pill label="Next page" disabled={navigating}
          onPress={() => { setActivePage(page + 1); clearSelection(); }} />}
      </>}
      {mode === 'archive' && <>
        {cursor && <Pill label="Previous page" disabled={navigating} onPress={() => { setCursors(cursors.slice(0, -1)); clearSelection(); }} />}
        {serverPage?.next && <Pill label="Next page" disabled={navigating} onPress={() => {
          if (serverPage.next) setCursors([...cursors, serverPage.next]);
          clearSelection();
        }} />}
      </>}
    </View>
  </Screen>;
}

function HistoryRecord({ row, units, selected, disabled, onToggle }: {
  row: WorkspaceHistoryRow;
  units: 'kg' | 'lb';
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const colors = useTheme();
  const [showDetails, setShowDetails] = useState(false);
  const [exerciseId, setExerciseId] = useState<string>();
  const { value, date } = row;
  const workout = 'exercises' in value ? value : undefined;
  const food = 'meal' in value ? value : undefined;
  return <Card>
    <SectionTitle>{value.name}</SectionTitle>
    {food && <Notice>{date} · {food.meal} · {amount.format(food.quantity)} {food.unit} · {amount.format(food.macros.calories)} kcal</Notice>}
    {workout && <Notice>{date} UTC · {workout.exercises.length} exercises</Notice>}
    <View style={styles.actions}>
      <Pill label={selected ? 'Selected' : 'Select'} selected={selected} disabled={disabled} onPress={onToggle}
        accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${value.name} on ${date}`} />
      <Pill label={showDetails ? 'Hide details' : 'Details'} selected={showDetails} onPress={() => setShowDetails(!showDetails)}
        accessibilityLabel={`${showDetails ? 'Hide' : 'Show'} details for ${value.name} on ${date}`} />
    </View>
    {showDetails && food && <>
      <Text style={{ color: colors.text }}>
        {amount.format(food.macros.protein)} g protein · {amount.format(food.macros.carbs)} g carbs · {amount.format(food.macros.fat)} g fat
      </Text>
      <Notice>{food.source}</Notice>
    </>}
    {showDetails && workout && <>
      {workout.exercises.length === 0 && <Notice>No exercises were recorded.</Notice>}
      {workout.exercises.map((exercise) => <View style={styles.detail} key={exercise.id}>
        <Pill label={`${exercise.name} · ${exercise.logged.length} sets`} selected={exercise.id === exerciseId}
          onPress={() => setExerciseId(exercise.id === exerciseId ? undefined : exercise.id)} />
        {exercise.id === exerciseId && (exercise.logged.length > 0
          ? exercise.logged.map((set, index) => <Text style={{ color: colors.text }} key={set.id}>
            {index + 1}. {set.reps} reps · {amount.format(set.grams / (units === 'kg' ? 1000 : 453.59237))} {units}
          </Text>)
          : <Notice>No sets logged.</Notice>)}
      </View>)}
    </>}
  </Card>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { gap: 5 },
});
