import {parseWorkspaceHistoryKind, type WorkspaceHistoryCursor, type WorkspaceHistoryKind} from '@levelmaxing/contracts';
import {randomUUID} from 'expo-crypto';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useEffect, useRef, useState} from 'react';
import {Alert, Share} from 'react-native';
import {ApiFailure, createApiRequester, type ApiRequester} from '../../platform/api.ts';
import {Action, Card, Field, Notice, Screen, SectionTitle} from '../../shared/ui.tsx';
import {useAccount} from '../session/index.ts';
import {getAccountExportPage, getArchiveExportPage} from './api.ts';
import {accountExportTexts, archiveExportTexts} from './format.ts';

type Download = {index: number; parts: string[]} & (
  | {kind: 'active'; through: string; after: string; next: string | null}
  | {kind: 'archive'; next: WorkspaceHistoryCursor | null}
);
type Session = {exportId: string; startedAt: string; request: ApiRequester};

export function AccountExportScreen() {
  const {environment, session, confirmIdentity} = useAccount();
  const params = useLocalSearchParams<{archive?: string}>();
  const archive = parseWorkspaceHistoryKind(params.archive);
  return <ExportFlow archive={archive} key={`${environment.mode}|${environment.api}|${session.accountId}|${archive ?? 'active'}`} environment={environment} confirmIdentity={confirmIdentity} />;
}

function ExportFlow({environment, confirmIdentity, archive}: {
  archive?: WorkspaceHistoryKind;
  environment: ReturnType<typeof useAccount>['environment'];
  confirmIdentity: (password: string) => Promise<string>;
}) {
  const router = useRouter();
  const cloud = environment.mode === 'cloud';
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [download, setDownload] = useState<Download>();
  const active = useRef<{controller: AbortController} | null>(null);
  const current = useRef<Session | null>(null);
  const shareScope = useRef<string | null>(null);
  useEffect(() => () => {
    active.current?.controller.abort();
    active.current = null;
    current.current = null;
    shareScope.current = null;
  }, []);

  async function loadPage(previous?: Download, confirmAgain = false) {
    if (active.current) return;
    const operation = {controller: new AbortController()};
    active.current = operation;
    setFailure('');
    setBusy(true);
    const isCurrent = () => active.current === operation && !operation.controller.signal.aborted;
    try {
      let exportSession = current.current;
      if (previous === undefined || confirmAgain) {
        const enteredPassword = password;
        setPassword('');
        const accessToken = await confirmIdentity(enteredPassword);
        if (!isCurrent()) return;
        const publishableKey = environment.mode === 'cloud' ? environment.publishableKey : undefined;
        exportSession = {
          exportId: exportSession?.exportId ?? randomUUID(),
          startedAt: exportSession?.startedAt ?? new Date().toISOString(),
          request: createApiRequester(environment.api, accessToken, publishableKey),
        };
      }
      if (!exportSession) return;
      const index = (previous?.index ?? 0) + 1;
      const meta = {exportId: exportSession.exportId, startedAt: exportSession.startedAt, index};
      let nextDownload: Download;
      if (archive) {
        const page = await getArchiveExportPage(exportSession.request, archive,
          previous?.kind === 'archive' ? previous.next : null, operation.controller.signal);
        if (!isCurrent()) return;
        nextDownload = {kind: 'archive', index, next: page.next, parts: archiveExportTexts(archive, page, meta)};
      } else {
        const prior = previous?.kind === 'active' ? previous : undefined;
        const page = await getAccountExportPage(exportSession.request, prior?.next ?? null, operation.controller.signal);
        if (!isCurrent()) return;
        if (prior === undefined ? page.workspace === null : page.workspace !== null ||
            page.weight.highWater !== prior.through ||
            page.weight.groups[0]?.revision !== (BigInt(prior.after) + 1n).toString()) {
          throw new ApiFailure(502, 'response_invalid');
        }
        nextDownload = {
          kind: 'active', index, through: page.weight.highWater, after: page.weight.groups.at(-1)?.revision ?? '0',
          next: page.weight.nextCursor, parts: accountExportTexts(page, meta),
        };
      }
      current.current = exportSession;
      setNeedsConfirmation(false);
      shareScope.current = exportSession.exportId;
      setDownload(nextDownload);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiFailure && error.status === 403 && error.code === 'recent_authentication_required') {
        setNeedsConfirmation(cloud);
        setFailure(cloud ? 'Confirm your password to continue this export.' : 'Sign in again before exporting your data.');
      } else if (error instanceof ApiFailure && error.status === 410) {
        current.current = null;
        setNeedsConfirmation(false);
        setFailure('This export expired. Share the current page if needed, then start a new export.');
      } else if (error instanceof ApiFailure && (error.status === 401 || error.status === 403)) {
        current.current = null;
        shareScope.current = null;
        setDownload(undefined);
        setNeedsConfirmation(false);
        setFailure('This account cannot export data. Confirm you are signed in to the right account.');
      } else if (error instanceof ApiFailure && error.code === 'history_unavailable') {
        setFailure('Archived records are unavailable on this server.');
      } else if ((!previous || confirmAgain) && cloud && !(error instanceof ApiFailure)) {
        setFailure('Identity confirmation failed. Check your password and connection, then try again.');
      } else {
        setFailure(previous
          ? 'The next page could not be loaded. The current page is still available. Check your connection and try again.'
          : 'Export could not be loaded. Check your connection and try again.');
      }
    } finally {
      if (isCurrent()) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  function confirmShare(contents: string) {
    const scope = shareScope.current;
    if (scope === null) return;
    Alert.alert('Share private records?', 'This export can include health and journal information. Choose a destination you trust.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Open share sheet', onPress: () => {
        if (shareScope.current !== scope) return;
        void Share.share({title: 'Levelmaxing data export', message: contents}).catch(() => {
          if (shareScope.current === scope) setFailure('Could not open the share sheet. Try again.');
        });
      }},
    ]);
  }

  const scope = archive === 'meals' ? 'Archived meals' : archive === 'workouts' ? 'Archived workouts' : 'Active records and weight';
  return <Screen title="Data export" detail={scope} onBack={() => router.canGoBack() ? router.back() : router.replace('/settings')}>
    <Card>
      <SectionTitle>What’s included</SectionTitle>
      {archive ? <Notice>This export reads the selected archive as you paginate. Keep the archive unchanged until you finish.</Notice> : <>
        <Notice>Current synced profile, training, nutrition, groceries, check-ins, activity, bookmarks, and confirmed weight records.</Notice>
        <Notice>Sync pending entries before exporting. Archived meals and workouts have their own export options in Settings.</Notice>
      </>}
    </Card>
    {download === undefined ? <Card>
      {cloud && <Field label="Confirm your password" autoComplete="current-password" textContentType="password"
        secureTextEntry editable={!busy} value={password} onChangeText={setPassword} />}
      <Action title={busy ? 'Preparing export…' : 'Prepare export'} disabled={busy || (cloud && password.length === 0)}
        onPress={() => { void loadPage(); }} />
    </Card> : <Card>
      <SectionTitle>Export page {download.index}</SectionTitle>
      {download.next !== null && <Notice>More records remain. Share this page before opening the next one.</Notice>}
      {download.parts.length > 1 && <Notice>This page has multiple JSON text parts. Share every part to keep all its records.</Notice>}
      {download.parts.map((contents, index) => <Action key={index} title={download.parts.length === 1 ? 'Share this page as JSON' : `Share part ${index + 1} of ${download.parts.length}`}
        disabled={busy} onPress={() => confirmShare(contents)} />)}
      {download.next && current.current && <>
        {needsConfirmation && cloud && <Field label="Confirm your password again" autoComplete="current-password" textContentType="password"
          secureTextEntry editable={!busy} value={password} onChangeText={setPassword} />}
        <Action title={busy ? 'Loading records…' : 'Load next page'}
          disabled={busy || (needsConfirmation && password.length === 0)} onPress={() => { void loadPage(download, needsConfirmation); }} />
      </>}
      <Action title="Close this export" subtle disabled={busy} onPress={() => {
        current.current = null;
        shareScope.current = null;
        setDownload(undefined);
        setNeedsConfirmation(false);
        setPassword('');
        setFailure('');
      }} />
    </Card>}
    {failure && <Notice kind="error">{failure}</Notice>}
  </Screen>;
}
