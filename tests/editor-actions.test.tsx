import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ScriptEditor } from '@/components/script-editor';
import { LocalRepository } from '@/lib/storage';
import {
  createScript,
  parseBackup,
  sampleWorkspace,
  type Workspace,
} from '@/lib/script';

const createUrl = vi.fn<(blob: Blob | MediaSource) => string>();
const clickDownload = vi.fn();

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('Blob', NodeBlob);
  createUrl.mockReset().mockReturnValue('blob:single-script');
  clickDownload.mockReset();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    clickDownload,
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openWorkspace(workspace: Workspace) {
  await new LocalRepository().write(workspace, 0);
  render(<ScriptEditor />);
  await waitFor(() =>
    expect(document.querySelector('.save-status')?.textContent).toBe(
      '已保存到本机',
    ),
  );
}

function requestDelete(title: string) {
  fireEvent.click(screen.getByRole('button', { name: `管理脚本：${title}` }));
  fireEvent.click(
    screen.getByRole('menuitem', { name: '删除脚本', hidden: true }),
  );
}

it('从列表取消或删除非当前脚本不切换稿件，删除当前脚本及撤销保持内容', async () => {
  const workspace = sampleWorkspace();
  const current = workspace.documents[0];
  const other = createScript('幕稿测试 · 待删除');
  workspace.documents.unshift(other);
  await openWorkspace(workspace);

  requestDelete(other.title);
  expect(
    screen.getByRole('dialog', { name: '删除这份脚本？' }).textContent,
  ).toContain(other.title);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect((screen.getByLabelText('脚本标题') as HTMLInputElement).value).toBe(
    current.title,
  );
  expect(screen.getByRole('button', { name: other.title })).toBeTruthy();

  requestDelete(other.title);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(screen.queryByRole('button', { name: other.title })).toBeNull();
  expect((screen.getByLabelText('脚本标题') as HTMLInputElement).value).toBe(
    current.title,
  );
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(screen.getByRole('button', { name: other.title })).toBeTruthy();

  requestDelete(current.title);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect((screen.getByLabelText('脚本标题') as HTMLInputElement).value).toBe(
    other.title,
  );
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(
    (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
  ).toBe(current.segments[0].narration);
}, 60000);

it('删除最后一份脚本后保留可编辑空稿，撤销可恢复原稿', async () => {
  const workspace = sampleWorkspace();
  const current = workspace.documents[0];
  await openWorkspace(workspace);
  requestDelete(current.title);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(
    within(screen.getByLabelText('脚本列表')).queryByRole('button', {
      name: current.title,
    }),
  ).toBeNull();
  expect(
    (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
  ).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect((screen.getByLabelText('脚本标题') as HTMLInputElement).value).toBe(
    current.title,
  );
  expect(
    (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
  ).toBe(current.segments[0].narration);
}, 60000);

it('单脚本 JSON 下载只包含当前稿件，保留所有字段并能用现有导入格式读取', async () => {
  const workspace = sampleWorkspace();
  const current = workspace.documents[0];
  current.title = '幕稿/单篇';
  current.segments[0].durationSeconds = 35;
  current.chineseCpm = 210;
  workspace.documents.unshift(createScript('这份脚本不应导出'));
  await openWorkspace(workspace);
  fireEvent.click(screen.getByRole('button', { name: '更多导出格式' }));
  fireEvent.click(
    screen.getByRole('menuitem', { name: '导出当前脚本 JSON', hidden: true }),
  );
  expect(createUrl).toHaveBeenCalledOnce();
  const downloaded = await (createUrl.mock.calls[0][0] as Blob).text();
  expect(parseBackup(downloaded)).toEqual({
    schemaVersion: 1,
    activeId: current.id,
    documents: [current],
  });
  expect(downloaded).not.toContain('这份脚本不应导出');
  expect((clickDownload.mock.contexts[0] as HTMLAnchorElement).download).toBe(
    '幕稿-单篇.json',
  );
}, 30000);
