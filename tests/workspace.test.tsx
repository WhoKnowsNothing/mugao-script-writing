import { IDBFactory } from 'fake-indexeddb';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspace } from '@/hooks/use-workspace';
import type { SavedWorkspace } from '@/lib/storage';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => vi.unstubAllGlobals());

it('在异步读取其他版本期间输入，不会被较晚返回的记录覆盖', async () => {
  const { result } = renderHook(() => useWorkspace());
  await waitFor(() => expect(result.current.status).toBe('saved'));
  const remote = structuredClone(result.current.workspace);
  remote.documents[0].title = '较晚返回的其他版本';
  let finishRead!: (value: SavedWorkspace) => void;
  vi.spyOn(result.current.repository, 'read').mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.loadLatest();
    result.current.commit((previous) => ({
      ...previous,
      documents: previous.documents.map((doc) => ({
        ...doc,
        title: '刚刚输入的新稿',
      })),
    }));
  });
  await act(async () => {
    finishRead({
      revision: 2,
      savedAt: new Date().toISOString(),
      snapshotAt: Date.now(),
      workspace: remote,
    });
    await loading;
  });
  expect(result.current.workspace.documents[0].title).toBe('刚刚输入的新稿');
  await waitFor(() => expect(result.current.status).toBe('saved'));
});
