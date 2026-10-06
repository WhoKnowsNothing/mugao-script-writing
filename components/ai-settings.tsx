'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createCustomProvider } from '@/lib/ai/provider';
import {
  validateConnection,
  type AiSettings,
  type ApiConnection,
} from '@/lib/ai/settings';
import { PLATFORM_RULES } from '@/lib/ai/rules';

export function AiSettingsForm({
  settings,
  onSave,
  onBack,
}: {
  settings: AiSettings;
  onSave: (settings: AiSettings) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function connection(
    kind: 'text' | 'image',
    field: keyof ApiConnection,
    value: string,
  ) {
    setDraft((old) => ({
      ...old,
      [kind]: {
        ...old[kind],
        ...(field === 'baseUrl' && value !== old[kind].baseUrl
          ? { apiKey: '' }
          : {}),
        [field]: value,
      },
    }));
    setMessage('');
    setError('');
  }
  function save() {
    setError('');
    try {
      for (const kind of ['text', 'image'] as const) {
        const config = draft[kind];
        if (config.baseUrl || config.model || config.apiKey)
          validateConnection(config, kind);
      }
      if (
        draft.imageSize.trim() &&
        !/^(auto|\d{2,5}x\d{2,5})$/.test(draft.imageSize.trim())
      )
        throw new Error(
          '图片尺寸请填写 auto 或宽x高，例如 1024x1024；也可留空使用服务默认值。',
        );
      onSave(draft);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function testConnection() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setMessage('');
    setError('');
    try {
      await createCustomProvider(draft).complete(
        [
          { role: 'system', content: '这是接口连接测试。只回复 OK。' },
          { role: 'user', content: '请回复 OK。' },
        ],
        controller.signal,
      );
      if (!controller.signal.aborted)
        setMessage('文字连接成功。保存设置后即可使用。');
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setTesting(false);
      }
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>AI 设置</DialogTitle>
        <DialogDescription>
          自定义服务、固定风格和常用发布平台。
        </DialogDescription>
      </DialogHeader>
      <div className="ai-scroll">
        <p className="ai-notice">
          只有点击生成或测试时，才会向你配置的服务发送内容。调用费用由该服务商收取。
        </p>
        <fieldset className="ai-form" disabled={testing}>
          {(['text', 'image'] as const).map((kind) => (
            <section className="ai-settings-section" key={kind}>
              <h3>{kind === 'text' ? '文字 API' : '生图 API'}</h3>
              <p className="form-help">
                {kind === 'text'
                  ? '用于画面建议、润色和合规审查，支持 OpenAI 兼容接口。'
                  : '用于从画面描述或附注生成一张图片，支持 OpenAI 兼容及硅基流动接口。'}
                修改地址会清空此项密钥。
              </p>
              <label className="ai-field">
                <span>{kind === 'text' ? '文字' : '生图'} API 基础地址</span>
                <Input
                  type="url"
                  value={draft[kind].baseUrl}
                  maxLength={2000}
                  placeholder="https://api.example.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => connection(kind, 'baseUrl', e.target.value)}
                />
              </label>
              <div className="ai-grid-two">
                <label className="ai-field">
                  <span>{kind === 'text' ? '文字' : '生图'}模型</span>
                  <Input
                    value={draft[kind].model}
                    maxLength={200}
                    placeholder="服务商提供的模型 ID"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => connection(kind, 'model', e.target.value)}
                  />
                </label>
                <label className="ai-field">
                  <span>{kind === 'text' ? '文字' : '生图'} API Key</span>
                  <Input
                    type="password"
                    value={draft[kind].apiKey}
                    maxLength={4000}
                    placeholder="无鉴权的本地服务可留空"
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(e) => connection(kind, 'apiKey', e.target.value)}
                  />
                </label>
              </div>
              {kind === 'image' && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraft((old) => ({
                        ...old,
                        image: {
                          ...old.image,
                          baseUrl: old.text.baseUrl,
                          apiKey: old.text.apiKey,
                        },
                      }))
                    }
                  >
                    复制文字服务地址和密钥
                  </Button>
                  <label className="ai-field" htmlFor="ai-image-size">
                    <span>图片尺寸（可选）</span>
                    <Input
                      id="ai-image-size"
                      value={draft.imageSize}
                      maxLength={40}
                      placeholder="留空使用默认尺寸，如 1024x1024"
                      onChange={(e) =>
                        setDraft({ ...draft, imageSize: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </section>
          ))}
          <section className="ai-settings-section">
            <h3>密钥保存</h3>
            <label className="ai-check">
              <input
                type="checkbox"
                checked={draft.rememberKeys}
                onChange={(e) =>
                  setDraft({ ...draft, rememberKeys: e.target.checked })
                }
              />
              <span>在此浏览器记住 API Key</span>
            </label>
            <p className="form-help">
              默认仅保存在当前标签页，刷新可继续使用，关闭标签页后清除。勾选后密钥将以明文保存在此网站的浏览器存储中。密钥不随稿件备份导出。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next: AiSettings = {
                  ...settings,
                  text: { ...settings.text, apiKey: '' },
                  image: { ...settings.image, apiKey: '' },
                  rememberKeys: false,
                };
                try {
                  onSave(next);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            >
              清除已存密钥
            </Button>
            <p className="form-help">
              当前为浏览器直连，服务商需允许此网站跨域访问。只连接你信任的服务。
            </p>
          </section>
          <section className="ai-settings-section">
            <h3>固定风格提示词</h3>
            <label className="ai-field" htmlFor="ai-visual-style">
              <span>画面风格</span>
              <Textarea
                id="ai-visual-style"
                rows={3}
                maxLength={6000}
                value={draft.visualStyle}
                placeholder="例如：暖白纸感，低饱和配色，主体居中，右侧留出字幕空间。"
                onChange={(e) =>
                  setDraft({ ...draft, visualStyle: e.target.value })
                }
              />
            </label>
            <label className="ai-field" htmlFor="ai-writing-style">
              <span>文稿风格</span>
              <Textarea
                id="ai-writing-style"
                rows={3}
                maxLength={6000}
                value={draft.writingStyle}
                placeholder="例如：自然口语，短句为主，保留必要限定，不夸大承诺。"
                onChange={(e) =>
                  setDraft({ ...draft, writingStyle: e.target.value })
                }
              />
            </label>
          </section>
          <section className="ai-settings-section">
            <h3>常用发布平台</h3>
            <div className="ai-platforms">
              {PLATFORM_RULES.map((rule) => (
                <label className="ai-check" key={rule.id}>
                  <input
                    type="checkbox"
                    checked={draft.platforms.includes(rule.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        platforms: e.target.checked
                          ? [...draft.platforms, rule.id]
                          : draft.platforms.filter((id) => id !== rule.id),
                      })
                    }
                  />
                  <span>{rule.name}</span>
                </label>
              ))}
            </div>
            <label className="ai-field" htmlFor="ai-custom-rules">
              <span>补充平台规则</span>
              <Textarea
                id="ai-custom-rules"
                rows={4}
                maxLength={12000}
                value={draft.customRules}
                placeholder="粘贴最新规则，并注明平台、适用场景、官方链接和规则日期。只填链接不会自动读取网页。"
                onChange={(e) =>
                  setDraft({ ...draft, customRules: e.target.value })
                }
              />
            </label>
            <p className="form-help">
              内置规则是有限摘要，不会实时联网更新。视频号全文尚未核验，请在此补充。
            </p>
          </section>
        </fieldset>
        {message && <output className="ai-success">{message}</output>}
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={testing}
          onClick={onBack}
        >
          返回
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={testing}
          onClick={() => void testConnection()}
        >
          {testing && <LoaderCircle className="spin" size={14} />}测试文字连接
        </Button>
        <Button type="button" disabled={testing} onClick={save}>
          保存设置
        </Button>
      </DialogFooter>
    </>
  );
}
