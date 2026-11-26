import {
  libraryCategories, listBundledGuides, MAX_LIBRARY_QUERY_CHARS, readBundledGuide,
  type LibraryCategory, type LibraryDetail, type LibraryPage, type LibraryQuery,
} from '@levelmaxing/contracts';
import { useRouter } from '../../shared/navigation.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createApiRequester } from '../../platform/api.ts';
import { Action, Card, Field, Mascot, Notice, Pill, Screen, SectionTitle, useTheme } from '../../shared/ui.tsx';
import { useAccount } from '../session/index.ts';
import { useWorkspace } from '../workspace/index.ts';
import { createLibraryTransport, loadLibraryDetail, loadLibraryPage, type CatalogResult, type LibraryTransport } from './guides.ts';
import { emptyJournal } from './model.ts';

export function LibraryScreen() {
  const { value, save, status } = useWorkspace('journal');
  const { environment, session } = useAccount();
  const colors = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState<string>();
  const [onlySaved, setOnlySaved] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<LibraryCategory>();
  const [pages, setPages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const journal = value ?? emptyJournal;
  const saved = new Set(journal.bookmarks);
  const { api } = environment;
  const { accessToken } = session;
  const publishableKey = environment.mode === 'cloud' ? environment.publishableKey : undefined;
  const transport = useMemo(
    () => accessToken ? createLibraryTransport(createApiRequester(api, accessToken, publishableKey)) : null,
    [accessToken, api, publishableKey],
  );
  const after = pages.at(-1);
  const query = useMemo<LibraryQuery>(() => ({
    ...(search ? { q: search } : {}), ...(category ? { category } : {}), ...(after ? { after } : {}),
  }), [after, category, search]);
  const page = useLibraryPage(transport, query);
  const detail = useLibraryDetail(transport, selected);
  const guide = detail.data?.guide;
  const visible = page.data.cards.filter(({ id }) => !onlySaved || saved.has(id));

  function submitSearch() {
    const normalized = searchInput.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    setSearch(normalized);
    setPages([]);
  }

  async function toggle(id: string) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    const bookmarks = saved.has(id) ? journal.bookmarks.filter((bookmark) => bookmark !== id) : [...journal.bookmarks, id];
    try {
      await save({ ...journal, bookmarks });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not change the bookmark.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (selected) {
    return <Screen title={guide?.title ?? 'Learning library'} onBack={() => setSelected(undefined)}
      detail={guide?.category} accessory={<Mascot />}>
      {error !== '' && <Notice kind="error">{error}</Notice>}
      {guide ? <Card>
        {detail.source === 'bundle' && !detail.pending && <Notice>Bundled guide available offline</Notice>}
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{guide.summary}</Text>
        {guide.steps.map((step, index) => <Text key={index} style={{ color: colors.text, fontSize: 16, lineHeight: 25 }}>{step}</Text>)}
        <Action title={saved.has(guide.id) ? 'Remove bookmark' : 'Bookmark guide'} onPress={() => { void toggle(guide.id); }}
          disabled={busy || status === 'loading' || status === 'unavailable'} />
      </Card> : <Card>
        <Notice kind={detail.pending ? 'info' : 'error'}>{detail.pending ? 'Opening guide…' : 'This guide is unavailable.'}</Notice>
      </Card>}
    </Screen>;
  }

  return <Screen title="Learning library" onBack={router.canGoBack() ? () => router.back() : undefined}
    detail="Short guides for training, tracking and food." accessory={<Mascot />}>
    <Field label="Search guides" value={searchInput} maxLength={MAX_LIBRARY_QUERY_CHARS} onChangeText={setSearchInput}
      returnKeyType="search" onSubmitEditing={submitSearch} autoCapitalize="none" />
    <Action title="Search" subtle onPress={submitSearch} />
    <View style={styles.filters}>
      <Pill label="All categories" selected={!category} onPress={() => { setCategory(undefined); setPages([]); }} />
      {libraryCategories.map((candidate) => <Pill key={candidate} label={candidate} selected={category === candidate}
        onPress={() => { setCategory(candidate); setPages([]); }} />)}
      <Pill label="Bookmarked guides" selected={onlySaved} onPress={() => { setOnlySaved(!onlySaved); setPages([]); }} />
    </View>
    {page.source === 'bundle' && !page.pending && <Notice>Showing guides bundled with this app.</Notice>}
    {visible.length === 0 && <Notice>{page.pending ? 'Looking for guides…' : onlySaved
      ? 'No bookmarked guides match this page.' : 'No guides match your search.'}</Notice>}
    {visible.map((item) => <Card key={item.id}>
      <Text style={{ color: colors.muted }}>{item.category}{saved.has(item.id) ? ' · Bookmarked' : ''}</Text>
      <SectionTitle>{item.title}</SectionTitle>
      <Text style={{ color: colors.text }}>{item.summary}</Text>
      <Action title="Read guide" onPress={() => { setError(''); setSelected(item.id); }} />
    </Card>)}
    {(page.data.nextAfter !== null || pages.length > 0) && <View style={styles.filters}>
      {pages.length > 0 && <Pill label="Previous page" onPress={() => setPages((current) => current.slice(0, -1))} />}
      {page.data.nextAfter !== null && <Pill label="Next page" onPress={() => {
        const cursor = page.data.nextAfter;
        if (cursor) setPages((current) => current.at(-1) !== cursor ? [...current, cursor] : current);
      }} />}
    </View>}
  </Screen>;
}

function useLibraryPage(transport: LibraryTransport | null, query: LibraryQuery) {
  const [loaded, setLoaded] = useState<{ transport: LibraryTransport; query: LibraryQuery; result: CatalogResult<LibraryPage> }>();
  const fallback = useMemo(() => listBundledGuides(query), [query]);
  useEffect(() => {
    if (!transport) return;
    const request = new AbortController();
    void loadLibraryPage(transport, query, request.signal).then((result) => {
      if (!request.signal.aborted) setLoaded({ transport, query, result });
    }, () => {
      if (!request.signal.aborted) setLoaded({ transport, query, result: { data: fallback, source: 'bundle' } });
    });
    return () => request.abort();
  }, [transport, query, fallback]);
  if (loaded?.transport === transport && loaded.query === query) return { ...loaded.result, pending: false };
  return { data: fallback, source: 'bundle' as const, pending: transport !== null };
}

function useLibraryDetail(transport: LibraryTransport | null, id: string | undefined) {
  const [loaded, setLoaded] = useState<{
    transport: LibraryTransport; id: string; result: CatalogResult<LibraryDetail | undefined>;
  }>();
  const fallback = useMemo(() => id ? readBundledGuide(id) : undefined, [id]);
  useEffect(() => {
    if (!transport || !id) return;
    const request = new AbortController();
    void loadLibraryDetail(transport, id, request.signal).then((result) => {
      if (!request.signal.aborted) setLoaded({ transport, id, result });
    }, () => {
      if (!request.signal.aborted) setLoaded({ transport, id, result: { data: fallback, source: 'bundle' } });
    });
    return () => request.abort();
  }, [transport, id, fallback]);
  if (loaded?.transport === transport && loaded.id === id) return { ...loaded.result, pending: false };
  return { data: fallback, source: 'bundle' as const, pending: transport !== null && id !== undefined };
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
