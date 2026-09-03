import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScriptEditor } from '@/components/script-editor';
import { LocalRepository } from '@/lib/storage';

const createUrl = vi.fn<(blob: Blob | MediaSource) => string>();
const clickDownload = vi.fn();

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('Blob', NodeBlob);
  createUrl.mockReset().mockReturnValue('blob:test-download');
  clickDownload.mockReset();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    clickDownload,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const waitUntilSaved = () =>
  waitFor(() => expect(screen.queryByText('已保存到本机')).not.toBeNull(), {
    timeout: 2500,
  });

describe('编辑器实际组件流程（非浏览器视觉测试）', () => {
  it('编辑后保存，卸载重开恢复；一键 Markdown 使用当前文案', async () => {
    const first = render(<ScriptEditor />);
    await waitUntilSaved();
    fireEvent.change(screen.getByLabelText('脚本标题'), {
      target: { value: '新视频测试' },
    });
    fireEvent.change(screen.getByLabelText('第1段文案'), {
      target: { value: '新文案\n第二行|特殊符号' },
    });
    fireEvent.change(screen.getByLabelText('第1段画面'), {
      target: { value: '新镜头说明' },
    });
    await waitUntilSaved();
    first.unmount();
    render(<ScriptEditor />);
    await waitUntilSaved();
    expect((screen.getByLabelText('脚本标题') as HTMLInputElement).value).toBe(
      '新视频测试',
    );
    expect(
      (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
    ).toBe('新文案\n第二行|特殊符号');
    expect(
      (screen.getByLabelText('第1段画面') as HTMLTextAreaElement).value,
    ).toBe('新镜头说明');
    fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));
    const blob = createUrl.mock.calls[0][0] as Blob;
    const markdown = await blob.text();
    expect(markdown).toContain('# 新视频测试');
    expect(markdown).toContain('新文案<br>第二行&#124;特殊符号');
    expect(markdown).toContain('新镜头说明');
    expect(clickDownload).toHaveBeenCalledOnce();
  });

  it('新建、中文输入法组合、光标分段与撤销可组合使用', async () => {
    render(<ScriptEditor />);
    await waitUntilSaved();
    fireEvent.click(screen.getByRole('button', { name: '新建脚本' }));
    const narration = screen.getByLabelText('第1段文案') as HTMLTextAreaElement;
    fireEvent.compositionStart(narration);
    fireEvent.change(narration, { target: { value: '你好世界' } });
    fireEvent.keyDown(narration, {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      isComposing: true,
    });
    expect(narration.value).toBe('你好世界');
    fireEvent.compositionEnd(narration);
    narration.setSelectionRange(2, 2);
    fireEvent.keyDown(narration, {
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
    });
    expect(
      (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
    ).toBe('你好');
    expect(
      (screen.getByLabelText('第2段文案') as HTMLTextAreaElement).value,
    ).toBe('世界');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(
      (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
    ).toBe('你好世界');
    expect(screen.queryByLabelText('第2段文案')).toBeNull();
    await waitUntilSaved();
  });

  it('菜单上移下移保留左右配对，重做恢复结构操作', async () => {
    render(<ScriptEditor />);
    await waitUntilSaved();
    const before = (screen.getByLabelText('第1段文案') as HTMLTextAreaElement)
      .value;
    const bgm = (screen.getByLabelText('第1段BGM') as HTMLTextAreaElement)
      .value;
    fireEvent.click(screen.getByRole('button', { name: '第1段操作' }));
    // jsdom has no popup geometry; this test exercises the menu action, not layout visibility.
    fireEvent.click(
      screen.getByRole('menuitem', { name: '下移', hidden: true }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true }) === null).toBe(true),
    );
    expect(
      (screen.getByLabelText('第2段文案') as HTMLTextAreaElement).value,
    ).toBe(before);
    expect(
      (screen.getByLabelText('第2段BGM') as HTMLTextAreaElement).value,
    ).toBe(bgm);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(
      (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
    ).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(
      (screen.getByLabelText('第2段文案') as HTMLTextAreaElement).value,
    ).toBe(before);
    await waitUntilSaved();
  }, 30000);

  it('存储失败时保留输入、显示警告，仍可导出', async () => {
    render(<ScriptEditor />);
    await waitUntilSaved();
    vi.spyOn(LocalRepository.prototype, 'write').mockRejectedValue(
      new DOMException('quota', 'QuotaExceededError'),
    );
    fireEvent.change(screen.getByLabelText('第1段文案'), {
      target: { value: '保存失败也不能丢的稿子' },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('自动保存失败'),
    );
    expect(
      (screen.getByLabelText('第1段文案') as HTMLTextAreaElement).value,
    ).toBe('保存失败也不能丢的稿子');
    fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toContain('保存失败也不能丢的稿子');
  });

  it('错误 JSON 导入不会替换现有脚本', async () => {
    const user = userEvent.setup();
    render(<ScriptEditor />);
    await waitUntilSaved();
    const title = screen.getByLabelText('脚本标题') as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: '导入文案 / 备份' }));
    const file = new File(['bad'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => 'not json' });
    fireEvent.change(screen.getByLabelText('导入 JSON 备份'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('JSON'),
    );
    expect(title.value).toBe('把一个想法，拍成视频');
  });
});
