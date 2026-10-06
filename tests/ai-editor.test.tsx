import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptEditor } from '@/components/script-editor';
import { AiAssistant } from '@/components/ai-assistant';
import {
  defaultAiSettings,
  saveAiSettings,
  SETTINGS_KEY,
} from '@/lib/ai/settings';
import { sampleWorkspace } from '@/lib/script';
import { LocalRepository } from '@/lib/storage';

const saved = () =>
  waitFor(
    () =>
      expect(document.querySelector('.save-status')?.textContent).toBe(
        '已保存到本机',
      ),
    { timeout: 3000 },
  );
const value = (label: string) =>
  (screen.getByLabelText(label) as HTMLTextAreaElement).value;
const createUrl = vi.fn();
function configure() {
  saveAiSettings(
    {
      ...defaultAiSettings(),
      text: {
        baseUrl: 'https://example.test/v1',
        model: 'text-demo',
        apiKey: 'fake-test-key',
      },
      image: {
        baseUrl: 'https://image.test/v1',
        model: 'image-demo',
        apiKey: 'fake-image-key',
      },
      visualStyle: '纸感',
      writingStyle: '自然口语',
    },
    localStorage,
    sessionStorage,
  );
}
function reply(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
  sessionStorage.clear();
  createUrl.mockReset().mockReturnValue('blob:ai-test');
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('AI editor workflows', () => {
  it.each([
    ['visual', '生成画面建议', '应用到画面与附注'],
    ['polish', '开始润色', '应用润色'],
    ['review', '开始审查', '审查完成。'],
  ] as const)(
    'requests structured output for %s before showing a result',
    async (task, action, resultLabel) => {
      configure();
      const doc = sampleWorkspace().documents[0];
      const row = { ...doc.segments[0] };
      const onApply = vi.fn();
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string')
          throw new Error('Expected JSON request');
        const body = JSON.parse(init.body);
        if (body.response_format?.type !== 'json_object')
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: '建议使用近景，主体偏左。' } }],
            }),
          );
        const results = {
          visual: { visual: '近景，主体偏左。', notes: '右侧留白。' },
          polish: { segments: [{ id: row.id, narration: '润色后的口播。' }] },
          review: { summary: '审查完成。', issues: [] },
        };
        return reply(results[task]);
      });
      render(
        <AiAssistant
          script={doc}
          launch={{ task, scope: row.id }}
          onClose={vi.fn()}
          onApply={onApply}
          onLocate={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: action }));
      if (task === 'review') await screen.findByText(resultLabel);
      else await screen.findByRole('button', { name: resultLabel });
      expect(fetch).toHaveBeenCalledOnce();
      expect(onApply).not.toHaveBeenCalled();
      expect(doc.segments[0]).toEqual(row);
    },
  );
  it('saves both connections and fixed styles without sending manuscript or persisting keys by default', async () => {
    render(<ScriptEditor />);
    await saved();
    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    const fields = [
      ['文字 API 基础地址', 'https://text.test/v1'],
      ['文字模型', 'writing-model'],
      ['文字 API Key', 'fake-secret'],
      ['生图 API 基础地址', 'https://image.test/v1'],
      ['生图模型', 'picture-model'],
      ['生图 API Key', 'fake-image-secret'],
      ['画面风格', '低饱和纸感'],
      ['文稿风格', '短句口语'],
      ['补充平台规则', '新规则与日期'],
    ];
    for (const [label, next] of fields)
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: next },
      });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('低饱和纸感');
    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('fake-secret');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'AI 设置',
      }),
    );
    expect(value('画面风格')).toBe('低饱和纸感');
    expect(value('文字 API Key')).toBe('fake-secret');
  });
  it('previews visual suggestions, applies once, persists and undoes using the existing editor history', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValue(
      reply({ visual: '新构图：主体居中，留白。', notes: '补充剪辑建议。' }),
    );
    render(<ScriptEditor />);
    await saved();
    const original = value('第1段画面');
    fireEvent.click(screen.getByRole('button', { name: '第1段画面建议' }));
    fireEvent.click(screen.getByRole('button', { name: '生成画面建议' }));
    await screen.findByLabelText('建议画面');
    expect(value('第1段画面')).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: '应用到画面与附注' }));
    expect(value('第1段画面')).toBe(original + '\n\n新构图：主体居中，留白。');
    await saved();
    const repo = new LocalRepository();
    expect(
      (await repo.read())?.workspace.documents[0].segments[0].visual,
    ).toContain('新构图');
    await repo.close();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(value('第1段画面')).toBe(original);
  });
  it('polishes all segments without changing directions or replacing text before acceptance', async () => {
    configure();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (typeof init?.body !== 'string')
        throw new Error('Expected JSON request');
      const body = JSON.parse(init.body);
      const payload = JSON.parse(body.messages[1].content);
      return reply({
        segments: payload.script.segments.map(
          (row: { id: string; narration: string }) => ({
            id: row.id,
            narration: row.narration + ' 更清楚。',
          }),
        ),
      });
    });
    render(<ScriptEditor />);
    await saved();
    const original = value('第1段文案');
    const visual = value('第1段画面');
    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(screen.getByRole('button', { name: '开始润色' }));
    await screen.findByRole('button', { name: '应用润色' });
    expect(value('第1段文案')).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: '应用润色' }));
    expect(value('第1段文案')).toBe(original + ' 更清楚。');
    expect(value('第1段画面')).toBe(visual);
  });
  it('renders evidence and source coverage without applying review changes', async () => {
    configure();
    const doc = sampleWorkspace().documents[0];
    vi.mocked(fetch).mockResolvedValue(
      reply({
        summary: '需核对素材使用权限。',
        issues: [
          {
            platform: 'douyin',
            severity: 'low',
            segmentId: doc.segments[0].id,
            field: 'visual',
            quote: '一杯咖啡',
            reason: '实际素材授权未能从脚本确认。',
            suggestion: '使用自摄素材。',
            basis: 'general',
          },
        ],
      }),
    );
    render(<ScriptEditor />);
    await saved();
    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(screen.getByRole('button', { name: '合规审查' }));
    fireEvent.click(screen.getByRole('button', { name: '开始审查' }));
    await screen.findByText('使用自摄素材。', { exact: false });
    expect(screen.getByText(/视频号规则正文尚未核验/)).toBeTruthy();
    expect(
      screen.getByText('依据：通用风险提示，平台适用性待核验'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '应用润色' })).toBeNull();
    expect(value('第1段文案')).toBe(doc.segments[0].narration);
  });
  it('blocks applying a result when the underlying manuscript changes', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValue(
      reply({ visual: '新的构图', notes: '' }),
    );
    const doc = sampleWorkspace().documents[0];
    const onApply = vi.fn();
    const props = {
      launch: { task: 'visual' as const, scope: doc.segments[0].id },
      onClose: vi.fn(),
      onApply,
      onLocate: vi.fn(),
    };
    const view = render(<AiAssistant script={doc} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '生成画面建议' }));
    await screen.findByRole('button', { name: '应用到画面与附注' });
    view.rerender(
      <AiAssistant
        script={{ ...doc, title: '正在另一处修改标题' }}
        {...props}
      />,
    );
    expect(
      (
        screen.getByRole('button', {
          name: '应用到画面与附注',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });
  it('cancels work on close and ignores late responses', async () => {
    configure();
    let resolve: (response: Response) => void = () => {};
    let requestSignal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementation((_url, init) => {
      requestSignal = init?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const doc = sampleWorkspace().documents[0];
    const view = render(
      <AiAssistant
        script={doc}
        launch={{ task: 'visual', scope: doc.segments[0].id }}
        onClose={vi.fn()}
        onApply={vi.fn()}
        onLocate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成画面建议' }));
    expect(requestSignal?.aborted).toBe(false);
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      resolve(reply({ visual: '迟到结果', notes: '' }));
    });
    expect(screen.queryByText('迟到结果')).toBeNull();
  });
  it('attaches and downloads a generated image without changing text or exporting credentials', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=',
            },
          ],
        }),
      ),
    );
    render(<ScriptEditor />);
    await saved();
    const visual = value('第1段画面');
    fireEvent.click(screen.getByRole('button', { name: '第1段生成配图' }));
    fireEvent.click(screen.getByRole('button', { name: '生成一张配图' }));
    await screen.findByAltText('根据当前段落画面附注生成的配图');
    fireEvent.click(screen.getByRole('button', { name: '下载配图' }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledOnce());
    expect(value('第1段画面')).toBe(visual);
    await saved();
    expect(screen.getByAltText('第1段配图').getAttribute('src')).toMatch(
      /^data:image\/png/,
    );
    const repo = new LocalRepository();
    const state = JSON.stringify(await repo.read());
    await repo.close();
    expect(state).not.toContain('fake-test-key');
    expect(state).not.toContain('fake-image-key');
    expect(state).toContain('data:image/png;base64,');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.queryByAltText('第1段配图')).toBeNull();
    expect(document.querySelector('.has-images')).toBeNull();
  });
  it.each([false, true])(
    'handles remote image caching failure=%s while attaching only to the requested segment',
    async (downloadFails) => {
      configure();
      const png =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ url: 'https://images.test/generated.png' }],
          }),
        ),
      );
      if (downloadFails)
        vi.mocked(fetch).mockRejectedValueOnce(new TypeError('CORS'));
      else
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(Buffer.from(png, 'base64')),
        );
      render(<ScriptEditor />);
      await saved();
      fireEvent.click(screen.getByRole('button', { name: '第2段生成配图' }));
      fireEvent.click(screen.getByRole('button', { name: '生成一张配图' }));
      const image = await screen.findByAltText('第2段配图');
      expect(image.getAttribute('src')).toBe(
        downloadFails
          ? 'https://images.test/generated.png'
          : `data:image/png;base64,${png}`,
      );
      expect(screen.queryByAltText('第1段配图')).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
      const downloadOptions = vi.mocked(fetch).mock.calls[1][1];
      expect(downloadOptions?.credentials).toBe('omit');
      expect(downloadOptions?.headers).toBeUndefined();
      await saved();
    },
  );
  it('keeps a generated image in preview when the target manuscript changes during the request', async () => {
    configure();
    let respond: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    render(<ScriptEditor />);
    await saved();
    fireEvent.click(screen.getByRole('button', { name: '第1段生成配图' }));
    fireEvent.click(screen.getByRole('button', { name: '生成一张配图' }));
    fireEvent.change(screen.getByLabelText('第1段画面'), {
      target: { value: '生成期间更新了构图' },
    });
    await act(async () => {
      respond(
        new Response(
          JSON.stringify({
            data: [
              {
                b64_json:
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=',
              },
            ],
          }),
        ),
      );
    });
    await screen.findByText(/生成期间稿件已变化/);
    expect(screen.getByAltText('根据当前段落画面附注生成的配图')).toBeTruthy();
    expect(screen.queryByAltText('第1段配图')).toBeNull();
    expect(value('第1段画面')).toBe('生成期间更新了构图');
    await saved();
  });
  it('shows a billing error for image HTTP 402 without retrying or changing the manuscript', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 402 }));
    const doc = sampleWorkspace().documents[0];
    const original = structuredClone(doc);
    const onApply = vi.fn();
    render(
      <AiAssistant
        script={doc}
        launch={{ task: 'image', scope: doc.segments[0].id }}
        onClose={vi.fn()}
        onApply={onApply}
        onLocate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成一张配图' }));
    await screen.findByText(/服务商账户余额不足或处于欠费状态/);
    expect(screen.queryByAltText('根据当前段落画面附注生成的配图')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    expect(doc).toEqual(original);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
