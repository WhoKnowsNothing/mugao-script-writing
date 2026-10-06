'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialHistory,
  recordChange,
  redoHistory,
  undoHistory,
  type History,
} from '@/lib/history';
import { LocalRepository, StorageConflictError } from '@/lib/storage';
import { sampleWorkspace, type Workspace } from '@/lib/script';

export type SaveStatus =
  | 'loading'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

export function useWorkspace() {
  const [history, setHistory] = useState<History>(() =>
    initialHistory(sampleWorkspace()),
  );
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const current = useRef(history);
  const [repository] = useState(() => new LocalRepository());
  const revision = useRef(0);
  const initialized = useRef(false);
  const dirty = useRef(false);
  const paused = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<Promise<boolean> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const loadGeneration = useRef(0);

  const save = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (!initialized.current || paused.current) return false;
    const run = async () => {
      while (dirty.current && !paused.current) {
        const writing = current.current.present;
        dirty.current = false;
        if (mounted.current) setStatus('saving');
        try {
          const record = await repository.write(writing, revision.current);
          revision.current = record.revision;
          if (mounted.current) setSavedAt(record.savedAt);
          channel.current?.postMessage({ revision: record.revision });
        } catch (cause) {
          dirty.current = true;
          paused.current = true;
          if (mounted.current) {
            setStatus(
              cause instanceof StorageConflictError ? 'conflict' : 'error',
            );
            setError(
              cause instanceof StorageConflictError
                ? cause.message
                : '自动保存失败（可能是存储空间不足或浏览器禁止存储）。文字仍在此页，请立即导出备份。',
            );
          }
          return false;
        }
      }
      if (mounted.current && !paused.current) {
        setStatus('saved');
        setError('');
      }
      return !paused.current;
    };
    pending.current = run();
    try {
      return await pending.current;
    } finally {
      pending.current = null;
    }
  }, [repository]);

  const loadLatest = useCallback(async () => {
    const generation = ++loadGeneration.current;
    // Caller must confirm when discarding a local, unsaved draft.
    if (pending.current) await pending.current;
    try {
      const record = await repository.read();
      if (!mounted.current || generation !== loadGeneration.current) return;
      const next = initialHistory(record?.workspace ?? sampleWorkspace());
      current.current = next;
      revision.current = record?.revision ?? 0;
      dirty.current = record === null;
      paused.current = false;
      initialized.current = true;
      setHistory(next);
      setSavedAt(record?.savedAt ?? '');
      setStatus(record ? 'saved' : 'dirty');
      setError('');
      setReady(true);
    } catch {
      if (!mounted.current || generation !== loadGeneration.current) return;
      initialized.current = true;
      paused.current = true;
      setReady(true);
      setStatus('error');
      setError(
        '无法读取本机记录，已暂停自动保存，现有记录不会被覆盖。可下载原始记录留存，或在此临时编辑后导出。',
      );
    }
  }, [repository]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      void loadLatest();
    });
    return () => {
      mounted.current = false;
    };
  }, [loadLatest]);

  useEffect(() => {
    if (!ready || paused.current || !dirty.current) return;
    const timer = setTimeout(() => {
      void save();
    }, 350);
    return () => clearTimeout(timer);
  }, [history.present, ready, save]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || pending.current) event.preventDefault();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', onHidden);
    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('mugao-workspace-updates');
      channel.current = bus;
      bus.onmessage = (event: MessageEvent<{ revision?: number }>) => {
        if (
          !initialized.current ||
          !Number.isSafeInteger(event.data?.revision) ||
          event.data.revision! <= revision.current
        )
          return;
        if (dirty.current || pending.current) {
          paused.current = true;
          setStatus('conflict');
          setError(
            '另一个页面保存了新版本。此页修改已保留并暂停自动保存，请先下载备份，再选择载入最新版本。',
          );
        } else {
          void loadLatest();
        }
      };
    }
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', onHidden);
      channel.current?.close();
      channel.current = null;
    };
  }, [save, loadLatest]);

  const commit = useCallback(
    (
      change: (previous: Workspace) => Workspace,
      group: string | null = null,
    ) => {
      if (!initialized.current) return;
      const next = recordChange(
        current.current,
        change(current.current.present),
        group,
      );
      if (next === current.current) return;
      loadGeneration.current++;
      current.current = next;
      dirty.current = true;
      setHistory(next);
      if (!paused.current) setStatus('dirty');
    },
    [],
  );

  const travel = useCallback((direction: 'undo' | 'redo') => {
    const next =
      direction === 'undo'
        ? undoHistory(current.current)
        : redoHistory(current.current);
    if (next === current.current) return;
    loadGeneration.current++;
    current.current = next;
    dirty.current = true;
    setHistory(next);
    if (!paused.current) setStatus('dirty');
  }, []);

  const retrySave = useCallback(async () => {
    if (!initialized.current) return false;
    paused.current = false;
    dirty.current = true;
    return save();
  }, [save]);

  return {
    workspace: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    ready,
    status,
    error,
    savedAt,
    commit,
    undo: useCallback(() => travel('undo'), [travel]),
    redo: useCallback(() => travel('redo'), [travel]),
    save,
    retrySave,
    loadLatest,
    repository,
  };
}
