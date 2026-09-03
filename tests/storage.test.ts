import { afterEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { LocalRepository, StorageConflictError } from '@/lib/storage';
import { sampleWorkspace } from '@/lib/script';

const repositories: LocalRepository[] = [];
const create = (name = crypto.randomUUID()) => {
  const repo = new LocalRepository(name);
  repositories.push(repo);
  return repo;
};
afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => repo.close()));
});

describe('本机事务保存', () => {
  it('真正写入 IndexedDB，重新打开可以恢复正文与设置', async () => {
    const name = crypto.randomUUID();
    const repo = create(name);
    expect(await repo.read()).toBeNull();
    const workspace = sampleWorkspace();
    workspace.documents[0].chineseCpm = 180;
    workspace.documents[0].segments[0].narration = '新稿\n第二行';
    await repo.write(workspace, 0);
    await repo.close();
    const restored = await create(name).read();
    expect(restored?.workspace).toEqual(workspace);
    expect(restored?.revision).toBe(1);
  });
  it('两个页面同时保存，仅一个事务成功，过期页面不得覆盖新稿', async () => {
    const name = crypto.randomUUID();
    const a = create(name),
      b = create(name);
    await a.write(sampleWorkspace(), 0);
    const second = sampleWorkspace();
    second.documents[0].title = '另一个页面的新稿';
    const result = await Promise.allSettled([
      a.write(second, 1),
      b.write(sampleWorkspace(), 1),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = result.find(
      (item) => item.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StorageConflictError);
    expect((await a.read())?.revision).toBe(2);
  });
  it('损坏的保存记录读取失败，不会被初始示例覆盖', async () => {
    const name = crypto.randomUUID();
    const repo = create(name);
    await repo.write(sampleWorkspace(), 0);
    const db = await openDB(name);
    await db.put(
      'state',
      { revision: 1, workspace: { broken: true } },
      'workspace',
    );
    await expect(repo.read()).rejects.toThrow();
    await expect(repo.write(sampleWorkspace(), 0)).rejects.toThrow();
    expect(await repo.raw()).toEqual({
      revision: 1,
      workspace: { broken: true },
    });
    db.close();
  });
  it('持续编辑按分钟保存历史，并限制为最近十份', async () => {
    const repo = create();
    const workspace = sampleWorkspace();
    for (let i = 0; i < 14; i++) {
      workspace.documents[0].title = `版本 ${i}`;
      await repo.write(
        workspace,
        i,
        Date.parse('2026-09-01T00:00:00Z') + i * 61000,
      );
    }
    const snapshots = await repo.snapshots();
    expect(snapshots).toHaveLength(10);
    expect(snapshots[0].workspace.documents[0].title).toBe('版本 12');
    expect((await repo.read())?.workspace.documents[0].title).toBe('版本 13');
  });
});
