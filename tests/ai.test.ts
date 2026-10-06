import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleWorkspace, type Script } from '@/lib/script';
import {
  apiEndpoint,
  defaultAiSettings,
  readAiSettings,
  saveAiSettings,
  SESSION_KEYS_KEY,
  SETTINGS_KEY,
} from '@/lib/ai/settings';
import {
  AiError,
  createCustomProvider,
  decodeImage,
  imageBlob,
} from '@/lib/ai/provider';
import {
  applyAiResult,
  buildImagePrompt,
  buildMessages,
  inputStillMatches,
  makeAiInput,
  parseResult,
} from '@/lib/ai/tasks';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const configured = () => ({
  ...defaultAiSettings(),
  text: {
    baseUrl: 'https://text.example/v1',
    model: 'text-model',
    apiKey: 'private-text-key',
  },
  image: {
    baseUrl: 'https://images.example/v1',
    model: 'image-model',
    apiKey: 'private-image-key',
  },
});
const script = () => sampleWorkspace().documents[0];
const signal = () => new AbortController().signal;
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe('AI settings and transport', () => {
  it('builds exact custom paths and rejects unsafe or ambiguous endpoints', () => {
    expect(apiEndpoint('https://custom.example/proxy/v1/', 'text')).toBe(
      'https://custom.example/proxy/v1/chat/completions',
    );
    expect(apiEndpoint('http://localhost:4191/v1', 'image')).toBe(
      'http://localhost:4191/v1/images/generations',
    );
    for (const url of [
      'http://external.example/v1',
      'javascript:alert(1)',
      'https://user:secret@example.com/v1',
      'https://example.com?key=secret',
      'https://example.com/v1#key',
      'https://example.com/v1/chat/completions',
    ])
      expect(() => apiEndpoint(url, 'text')).toThrow();
  });
  it('keeps keys in the tab by default, persists preferences, and removes remembered keys', () => {
    const settings = {
      ...configured(),
      visualStyle: '纸感',
      writingStyle: '短句',
      customRules: '视频号：核对最新规则',
    };
    saveAiSettings(settings, localStorage, sessionStorage);
    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('private-');
    expect(sessionStorage.getItem(SESSION_KEYS_KEY)).toContain(
      'private-text-key',
    );
    expect(readAiSettings(localStorage, sessionStorage)).toEqual(settings);
    sessionStorage.clear();
    expect(readAiSettings(localStorage, sessionStorage).text.apiKey).toBe('');
    saveAiSettings(
      { ...settings, rememberKeys: true },
      localStorage,
      sessionStorage,
    );
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('private-image-key');
    expect(sessionStorage.getItem(SESSION_KEYS_KEY)).toBeNull();
    saveAiSettings(settings, localStorage, sessionStorage);
    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('private-');
  });
  it('does not retain remembered keys if a subsequent storage write fails', () => {
    saveAiSettings(
      { ...configured(), rememberKeys: true },
      localStorage,
      sessionStorage,
    );
    const local = {
      getItem: localStorage.getItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage;
    expect(() => saveAiSettings(configured(), local, sessionStorage)).toThrow();
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
  it("never attaches this tab's key to an endpoint changed in another tab", () => {
    saveAiSettings(configured(), localStorage, sessionStorage);
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    saved.text.baseUrl = 'https://other-provider.example/v1';
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    const next = readAiSettings(localStorage, sessionStorage);
    expect(next.text.baseUrl).toBe('https://other-provider.example/v1');
    expect(next.text.apiKey).toBe('');
    expect(next.image.apiKey).toBe('private-image-key');
  });
  it('sends separate models and keys to text/image services, without cookies or redirects', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ choices: [{ message: { content: 'hello' } }] }),
      )
      .mockResolvedValueOnce(json({ data: [{ b64_json: png }] }));
    vi.stubGlobal('fetch', fetcher);
    const settings = configured();
    const provider = createCustomProvider(settings);
    expect(
      await provider.complete([{ role: 'user', content: '测试' }], signal()),
    ).toBe('hello');
    expect((await provider.generateImage('纸感配图', signal())).src).toMatch(
      /^data:image\/png/,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://text.example/v1/chat/completions',
    );
    const textRequest = fetcher.mock.calls[0][1];
    expect(textRequest.headers.Authorization).toBe('Bearer private-text-key');
    expect(textRequest.credentials).toBe('omit');
    expect(textRequest.redirect).toBe('error');
    expect(JSON.parse(textRequest.body)).toMatchObject({
      model: 'text-model',
      stream: false,
    });
    expect(JSON.parse(textRequest.body)).not.toHaveProperty('response_format');
    expect(fetcher.mock.calls[1][0]).toBe(
      'https://images.example/v1/images/generations',
    );
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer private-image-key',
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      model: 'image-model',
      prompt: '纸感配图',
      n: 1,
    });
  });
  it.each(['https://api.deepseek.com', 'https://api.deepseek.com/v1'])(
    'requests JSON output explicitly from %s and reads only the final answer',
    async (baseUrl) => {
      const content = JSON.stringify({ visual: '近景构图', notes: '保持留白' });
      const fetcher = vi.fn().mockResolvedValue(
        json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content, reasoning_content: '这部分不是 JSON 答案。' },
            },
          ],
        }),
      );
      vi.stubGlobal('fetch', fetcher);
      const settings = configured();
      settings.text = { ...settings.text, baseUrl, model: 'deepseek-chat' };
      const doc = script();
      const input = makeAiInput(doc, doc.segments[0].id);
      const messages = buildMessages('visual', input, settings, '');
      const result = await createCustomProvider(settings).complete(
        messages,
        signal(),
        { responseFormat: 'json_object' },
      );
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(`${baseUrl}/chat/completions`);
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
        model: 'deepseek-chat',
        messages,
        stream: false,
        response_format: { type: 'json_object' },
      });
      expect(parseResult('visual', result, input, settings)).toEqual({
        kind: 'visual',
        visual: '近景构图',
        notes: '保持留白',
      });
    },
  );
  it.each([
    ['https://api.siliconflow.cn/v1', '', 'Kwai-Kolors/Kolors', '1024x1024'],
    [
      'https://api.siliconflow.cn/v1/',
      ' 720x1280 ',
      'Kwai-Kolors/Kolors',
      '720x1280',
    ],
    ['https://api.siliconflow.com/v1', '', 'black-forest-labs/FLUX.2-pro', ''],
  ])(
    'generates a SiliconFlow image from %s with size %s',
    async (baseUrl, size, model, expectedSize) => {
      const fetcher = vi.fn().mockResolvedValue(
        json({
          images: [{ url: 'https://images.example/kolors.png' }],
          timings: { inference: 1 },
          seed: 123,
        }),
      );
      vi.stubGlobal('fetch', fetcher);
      const settings = configured();
      settings.image = {
        ...settings.image,
        baseUrl,
        model,
      };
      settings.imageSize = size;
      const image = await createCustomProvider(settings).generateImage(
        '桌面俯拍',
        signal(),
      );
      expect(image.src).toBe('https://images.example/kolors.png');
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(
        `${baseUrl.replace(/\/$/, '')}/images/generations`,
      );
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
        model,
        prompt: '桌面俯拍',
        ...(expectedSize ? { image_size: expectedSize } : {}),
      });
    },
  );
  it('keeps OpenAI image parameters for gateways even when using the Kolors model name', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ data: [{ b64_json: png }] }));
    vi.stubGlobal('fetch', fetcher);
    const settings = configured();
    settings.image = {
      ...settings.image,
      baseUrl: 'https://api.siliconflow.cn.example/v1',
      model: 'Kwai-Kolors/Kolors',
    };
    settings.imageSize = '1024x1024';
    expect(
      (await createCustomProvider(settings).generateImage('桌面俯拍', signal()))
        .src,
    ).toMatch(/^data:image\/png/);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      model: 'Kwai-Kolors/Kolors',
      prompt: '桌面俯拍',
      n: 1,
      size: '1024x1024',
    });
  });
  it('validates SiliconFlow image URLs and dimensions before returning or sending data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ images: [{ url: 'javascript:alert(1)' }] }));
    vi.stubGlobal('fetch', fetcher);
    const settings = configured();
    settings.image = {
      ...settings.image,
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Kwai-Kolors/Kolors',
    };
    await expect(
      createCustomProvider(settings).generateImage('桌面俯拍', signal()),
    ).rejects.toThrow('HTTPS');
    settings.imageSize = 'auto';
    await expect(
      createCustomProvider(settings).generateImage('桌面俯拍', signal()),
    ).rejects.toThrow('尺寸');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reports HTTP 402 as an account balance problem without leaking details or retrying', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        json({ message: 'secret-key and private manuscript' }, 402),
      );
    vi.stubGlobal('fetch', fetcher);
    const error = await createCustomProvider(configured())
      .generateImage('桌面俯拍', signal())
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(AiError);
    expect(error.message).toMatch(/余额|欠费/);
    expect(error.message).toContain('402');
    expect(error.message).not.toMatch(
      /暂时不可用|稍后重试|secret-key|private manuscript/,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([400, 401, 402, 403, 404, 429, 500])(
    'handles HTTP %s without echoing provider error details or retrying',
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          json(
            { error: { message: 'secret-key and private manuscript' } },
            status,
          ),
        );
      vi.stubGlobal('fetch', fetcher);
      const error = await createCustomProvider(configured())
        .complete([], signal())
        .catch((cause) => cause);
      expect(error).toBeInstanceOf(AiError);
      expect(error.message).not.toMatch(/secret-key|private manuscript/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('reports network/CORS failures and rejects invalid or truncated text replies', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response('<html>gateway</html>'))
      .mockResolvedValueOnce(
        json({
          choices: [{ finish_reason: 'length', message: { content: '{' } }],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const provider = createCustomProvider(configured());
    await expect(provider.complete([], signal())).rejects.toThrow('CORS');
    await expect(provider.complete([], signal())).rejects.toThrow('JSON');
    await expect(provider.complete([], signal())).rejects.toThrow('截断');
  });
  it('cancels in-flight requests and times out without automatic retries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('abort', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const cancelled = createCustomProvider(configured())
      .complete([], controller.signal)
      .catch((cause) => cause);
    controller.abort();
    expect((await cancelled).message).toContain('取消');
    const timeout = createCustomProvider(configured())
      .generateImage('test', signal())
      .catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(180000);
    expect((await timeout).message).toContain('超时');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized replies and unsafe generated image URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('{}', { headers: { 'Content-Length': '99000000' } }),
        )
        .mockResolvedValueOnce(json({ data: [{ url: 'javascript:alert(1)' }] }))
        .mockResolvedValueOnce(
          json({
            data: [{ url: 'https://images.example/result.png?temporary=1' }],
          }),
        ),
    );
    const provider = createCustomProvider(configured());
    await expect(provider.complete([], signal())).rejects.toThrow('过大');
    await expect(provider.generateImage('x', signal())).rejects.toThrow(
      'HTTPS',
    );
    expect((await provider.generateImage('x', signal())).src).toBe(
      'https://images.example/result.png?temporary=1',
    );
    expect(() =>
      decodeImage(btoa('<svg><script>bad</script></svg>')),
    ).toThrow();
    expect(() => decodeImage('not base64')).toThrow();
  });
  it('downloads remote images without sending API credentials', async () => {
    const { bytes } = decodeImage(png);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const blob = await imageBlob('https://images.example/result.png', signal());
    expect(blob.type).toBe('image/png');
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers');
    expect(fetcher.mock.calls[0][1].credentials).toBe('omit');
  });
});

describe('AI task scope, evidence and safe application', () => {
  it('includes the appropriate fixed style, selected content and platform evidence', () => {
    const settings = {
      ...configured(),
      visualStyle: '画面纸感',
      writingStyle: '口语短句',
      platforms: ['channels'] as const,
      customRules: '用户补充规则',
    };
    const safeSettings = { ...settings, platforms: [...settings.platforms] };
    const doc = script();
    const input = makeAiInput(doc, doc.segments[0].id);
    const visual = buildMessages('visual', input, safeSettings, '竖屏');
    expect(visual[1].content).toContain('画面纸感');
    expect(visual[1].content).not.toContain(doc.segments[1].narration);
    expect(
      buildMessages('polish', input, safeSettings, '')[1].content,
    ).toContain('口语短句');
    const review = buildMessages('review', input, safeSettings, '')[1].content;
    expect(review).toContain('用户补充规则');
    expect(review).toContain('正文未能读取核验');
    expect(review).not.toContain('画面纸感');
    expect(buildImagePrompt(input, safeSettings, '暖光')).toContain(
      '固定画面风格：画面纸感',
    );
  });
  it('rejects empty work and overlong inputs before sending', () => {
    const doc = script();
    const input = makeAiInput(doc, doc.segments[0].id);
    const empty = {
      ...input,
      segments: [
        { ...input.segments[0], narration: '', visual: '', notes: '' },
      ],
    };
    expect(() => buildMessages('visual', empty, configured(), '')).toThrow(
      '先填写',
    );
    expect(() => buildMessages('polish', empty, configured(), '')).toThrow(
      '先写',
    );
    expect(() => buildImagePrompt(empty, configured(), '')).toThrow('先填写');
    expect(() =>
      buildMessages('review', input, { ...configured(), platforms: [] }, ''),
    ).toThrow('平台');
    expect(() =>
      buildMessages(
        'review',
        { ...input, description: 'x'.repeat(60001) },
        configured(),
        '',
      ),
    ).toThrow('60,000');
  });
  it('parses fenced JSON but rejects malformed responses and missing/duplicated polish IDs', () => {
    const input = makeAiInput(script(), 'all');
    const settings = configured();
    expect(
      parseResult(
        'visual',
        '```json\n{"visual":"构图","notes":"附注"}\n```',
        input,
        settings,
      ),
    ).toEqual({ kind: 'visual', visual: '构图', notes: '附注' });
    expect(() => parseResult('visual', 'not json', input, settings)).toThrow(
      'JSON',
    );
    expect(() =>
      parseResult('polish', '{"segments":[]}', input, settings),
    ).toThrow('遗漏');
    const duplicate = input.segments.map(() => ({
      id: input.segments[0].id,
      narration: '润色',
    }));
    expect(() =>
      parseResult(
        'polish',
        JSON.stringify({ segments: duplicate }),
        input,
        settings,
      ),
    ).toThrow('标识');
    const cleared = input.segments.map((row) => ({
      id: row.id,
      narration: '',
    }));
    expect(() =>
      parseResult(
        'polish',
        JSON.stringify({ segments: cleared }),
        input,
        settings,
      ),
    ).toThrow('清空');
  });
  it('applies visual changes without discarding existing notes, and keeps timing/BGM/narration', () => {
    const doc = script();
    const input = makeAiInput(doc, doc.segments[0].id);
    const result = {
      kind: 'visual' as const,
      visual: '建议镜头',
      notes: '建议构图',
    };
    const next = applyAiResult(doc, input, result);
    expect(next.segments[0].visual).toBe(
      doc.segments[0].visual + '\n\n建议镜头',
    );
    expect(next.segments[0].notes).toBe(doc.segments[0].notes + '\n\n建议构图');
    expect(next.segments[0].narration).toBe(doc.segments[0].narration);
    expect(next.segments[0].pauseSeconds).toBe(doc.segments[0].pauseSeconds);
    expect(next.segments[0].bgm).toBe(doc.segments[0].bgm);
    expect(applyAiResult(doc, input, result, false).segments[0].visual).toBe(
      '建议镜头',
    );
    expect(doc.segments[0].visual).not.toContain('建议镜头');
  });
  it('rejects stale/deleted/cross-script results while preserving unrelated edits and reorders', () => {
    const doc = script();
    const input = makeAiInput(doc, doc.segments[0].id);
    const result = {
      kind: 'polish' as const,
      segments: [{ id: input.segments[0].id, narration: '新口播' }],
    };
    const changed = {
      ...doc,
      segments: doc.segments.map((row, index) =>
        index === 0 ? { ...row, narration: '用户新输入' } : row,
      ),
    };
    expect(() => applyAiResult(changed, input, result)).toThrow('原稿已变化');
    expect(inputStillMatches({ ...doc, id: 'other-script' }, input)).toBe(
      false,
    );
    expect(
      inputStillMatches({ ...doc, segments: doc.segments.slice(1) }, input),
    ).toBe(false);
    const reordered: Script = { ...doc, segments: [...doc.segments].reverse() };
    const next = applyAiResult(reordered, input, result);
    expect(next.segments.map((row) => row.id)).toEqual(
      reordered.segments.map((row) => row.id),
    );
    expect(
      next.segments.find((row) => row.id === input.segments[0].id)?.narration,
    ).toBe('新口播');
  });
  it('checks each review quote against the named field and rejects fabricated rule evidence', () => {
    const input = makeAiInput(script(), 'all');
    const settings = configured();
    const issue = {
      platform: 'douyin',
      severity: 'low',
      segmentId: input.segments[0].id,
      field: 'narration',
      quote: input.segments[0].narration.slice(0, 8),
      reason: '待核查授权',
      suggestion: '核对素材',
      basis: 'general',
    };
    const review = (item: unknown) =>
      parseResult(
        'review',
        JSON.stringify({ summary: '有限范围内的风险提示', issues: [item] }),
        input,
        settings,
      );
    expect(review(issue).kind).toBe('review');
    expect(() => review({ ...issue, quote: '原稿里完全不存在的句子' })).toThrow(
      '无法定位',
    );
    expect(() =>
      review({ ...issue, platform: 'channels', basis: 'reference' }),
    ).toThrow('未提供');
    expect(() => review({ ...issue, basis: 'custom' })).toThrow('未提供');
    expect(() => review({ ...issue, field: '__proto__' })).toThrow();
    expect(() => review({ ...issue, platform: 'unselected' })).toThrow();
  });
});
