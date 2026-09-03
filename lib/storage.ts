import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { validateWorkspace, type Workspace } from './script';

export interface SavedWorkspace {
  revision: number;
  savedAt: string;
  snapshotAt: number;
  workspace: Workspace;
}
export interface Snapshot {
  id: string;
  savedAt: string;
  workspace: Workspace;
}
interface MugaoDatabase extends DBSchema {
  state: { key: string; value: SavedWorkspace };
  snapshots: { key: string; value: Snapshot };
}
export class StorageConflictError extends Error {
  constructor() {
    super('其他页面已保存了新版本。当前修改仍保留在此页，请先下载备份。');
  }
}

function validateSaved(value: SavedWorkspace): SavedWorkspace {
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    !Number.isFinite(value.snapshotAt)
  )
    throw new Error('本机保存记录损坏，已停止覆盖。');
  return { ...value, workspace: validateWorkspace(value.workspace) };
}

export class LocalRepository {
  private connection?: Promise<IDBPDatabase<MugaoDatabase>>;
  constructor(private readonly name = 'mugao-script-writing-v1') {}

  private db() {
    if (!this.connection) {
      this.connection = openDB<MugaoDatabase>(this.name, 1, {
        upgrade(db) {
          db.createObjectStore('state');
          db.createObjectStore('snapshots', { keyPath: 'id' });
        },
        blocking: () => {
          void this.close();
        },
        terminated: () => {
          this.connection = undefined;
        },
      }).catch((error) => {
        this.connection = undefined;
        throw error;
      });
    }
    return this.connection;
  }
  async read(): Promise<SavedWorkspace | null> {
    const saved = await (await this.db()).get('state', 'workspace');
    return saved === undefined ? null : validateSaved(saved);
  }
  async raw(): Promise<unknown> {
    return (await this.db()).get('state', 'workspace');
  }

  /** Compare-and-swap in one transaction prevents another tab's work being silently replaced. */
  async write(
    workspace: Workspace,
    expectedRevision: number,
    timestamp = Date.now(),
  ): Promise<SavedWorkspace> {
    const safe = validateWorkspace(workspace);
    const tx = (await this.db()).transaction(
      ['state', 'snapshots'],
      'readwrite',
    );
    try {
      const state = tx.objectStore('state');
      const raw = await state.get('workspace');
      const previous = raw === undefined ? null : validateSaved(raw);
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw new StorageConflictError();
      let snapshotAt = previous?.snapshotAt ?? timestamp;
      if (previous && timestamp - snapshotAt >= 60000) {
        const snapshots = tx.objectStore('snapshots');
        await snapshots.put({
          id: `${previous.revision}`,
          savedAt: previous.savedAt,
          workspace: previous.workspace,
        });
        const all = await snapshots.getAll();
        all.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
        for (const old of all.slice(10)) await snapshots.delete(old.id);
        snapshotAt = timestamp;
      }
      const record: SavedWorkspace = {
        revision: expectedRevision + 1,
        savedAt: new Date(timestamp).toISOString(),
        snapshotAt,
        workspace: safe,
      };
      await state.put(record, 'workspace');
      await tx.done;
      return record;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* A storage error may have already aborted it. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
  async snapshots(): Promise<Snapshot[]> {
    const records = await (await this.db()).getAll('snapshots');
    return records
      .map((item) => ({
        ...item,
        workspace: validateWorkspace(item.workspace),
      }))
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  }
  async close() {
    const pending = this.connection;
    this.connection = undefined;
    if (pending) (await pending).close();
  }
}
