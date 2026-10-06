'use client';

/* oxlint-disable nextjs/no-img-element -- Runtime base64 and provider image URLs work in the static build without an image server. */

import { useEffect, useRef, useState } from 'react';
import {
  Download,
  ImagePlus,
  LoaderCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AiSettingsForm } from '@/components/ai-settings';
import {
  defaultAiSettings,
  readAiSettings,
  saveAiSettings,
  type AiSettings,
} from '@/lib/ai/settings';
import { createCustomProvider, imageBlob } from '@/lib/ai/provider';
import {
  buildImagePrompt,
  buildMessages,
  inputStillMatches,
  makeAiInput,
  parseResult,
  type AiInput,
  type AiResult,
  type AiTask,
  type PolishResult,
  type VisualResult,
} from '@/lib/ai/tasks';
import { PLATFORM_RULES, rulesAreOld, selectedRules } from '@/lib/ai/rules';
import { downloadBlob, safeFilename } from '@/lib/export-markdown';
import type { Script } from '@/lib/script';
import { imageDataUrl } from '@/lib/segment-image';

export type AiLaunch = { task: AiTask | 'settings'; scope: string };
interface ResultSnapshot {
  input: AiInput;
  result: AiResult;
  settings: AiSettings;
}
const actions = [
  { id: 'visual', label: '画面建议', icon: Sparkles },
  { id: 'image', label: '生成配图', icon: ImagePlus },
  { id: 'polish', label: '润色文稿', icon: WandSparkles },
  { id: 'review', label: '合规审查', icon: ShieldCheck },
] as const;
const fieldLabels = {
  title: '标题',
  description: '简介',
  narration: '文案',
  visual: '画面',
  notes: '附注',
  bgm: 'BGM / 音效',
};

export function AiAssistant({
  script,
  launch,
  onClose,
  onApply,
  onImage,
  onLocate,
}: {
  script: Script;
  launch: AiLaunch;
  onClose: () => void;
  onApply: (
    input: AiInput,
    result: VisualResult | PolishResult,
    append: boolean,
  ) => void;
  onLocate: (segmentId: string | null) => void;
  onImage?: (input: AiInput, src: string) => void;
}) {
  const [initial] = useState(() => {
    try {
      return {
        settings: readAiSettings(localStorage, sessionStorage),
        warning: '',
      };
    } catch {
      return {
        settings: defaultAiSettings(),
        warning: '无法读取已存 AI 设置，请检查浏览器存储权限或重新保存设置。',
      };
    }
  });
  const [settings, setSettings] = useState(initial.settings);
  const [showSettings, setShowSettings] = useState(launch.task === 'settings');
  const [task, setTask] = useState<AiTask>(
    launch.task === 'settings' ? 'polish' : launch.task,
  );
  const [scope, setScope] = useState(launch.scope);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<ResultSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [imageError, setImageError] = useState(false);
  const [append, setAppend] = useState(true);
  const [applied, setApplied] = useState(false);
  const request = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      request.current?.abort();
      downloadRequest.current?.abort();
    };
  }, []);

  function saveSettings(next: AiSettings) {
    try {
      saveAiSettings(next, localStorage, sessionStorage);
    } catch {
      throw new Error(
        'AI 设置保存失败，请检查浏览器存储权限或空间；未启用新设置。',
      );
    }
    setSettings(next);
    setStorageWarning('');
    setError('');
    setResult(null);
    setShowSettings(false);
  }
  function resetResult() {
    setResult(null);
    setError('');
    setApplied(false);
    setImageError(false);
  }
  function selectTask(next: AiTask) {
    setTask(next);
    resetResult();
    if ((next === 'visual' || next === 'image') && scope === 'all')
      setScope(script.segments[0].id);
  }

  async function run() {
    if (request.current || downloading) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    resetResult();
    try {
      const input = makeAiInput(script, scope);
      const provider = createCustomProvider(settings);
      let next: AiResult;
      if (task === 'image') {
        const prompt = buildImagePrompt(input, settings, instruction);
        next = {
          kind: 'image',
          prompt,
          ...(await provider.generateImage(prompt, controller.signal)),
        };
      } else {
        const messages = buildMessages(task, input, settings, instruction);
        next = parseResult(
          task,
          await provider.complete(messages, controller.signal, {
            responseFormat: 'json_object',
          }),
          input,
          settings,
        );
      }
      if (
        next.kind === 'image' &&
        onImage &&
        next.src.startsWith('https:') &&
        !controller.signal.aborted
      ) {
        try {
          next.src = await imageDataUrl(
            await imageBlob(
              next.src,
              AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
            ),
          );
        } catch {
          // Keep a usable provider URL when cross-origin downloading is unavailable.
          // The preview and segment both mark remote links as temporary.
        }
      }
      if (!controller.signal.aborted && request.current === controller) {
        setResult({ input, result: next, settings });
        if (next.kind === 'image' && onImage) {
          onImage(input, next.src);
          setApplied(true);
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller)
        setError((cause as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setError('已取消等待。服务商可能仍会完成请求并计费。');
  }
  async function downloadImage() {
    if (result?.result.kind !== 'image' || downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloading(true);
    setError('');
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const blob = await imageBlob(result.result.src, controller.signal);
      if (controller.signal.aborted) return;
      const suffix =
        blob.type === 'image/jpeg'
          ? 'jpg'
          : blob.type === 'image/webp'
            ? 'webp'
            : 'png';
      downloadBlob(
        blob,
        `${safeFilename(result.input.title)}-${safeFilename(result.input.segments[0].title || '配图')}.${suffix}`,
      );
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? '图片下载超时，可打开原图后保存。'
          : (cause as Error).message,
      );
    } finally {
      clearTimeout(timer);
      downloadRequest.current = null;
      setDownloading(false);
    }
  }

  const stale = result !== null && !inputStillMatches(script, result.input);
  const configured = Boolean(
    settings[task === 'image' ? 'image' : 'text'].baseUrl &&
    settings[task === 'image' ? 'image' : 'text'].model,
  );
  const canAll = task === 'polish' || task === 'review';
  const rules = selectedRules(
    (result?.result.kind === 'review' ? result.settings : settings).platforms,
  );
  let destination = '';
  try {
    destination = new URL(settings[task === 'image' ? 'image' : 'text'].baseUrl)
      .host;
  } catch {
    /* No saved endpoint yet. */
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="ai-dialog">
        {showSettings ? (
          <AiSettingsForm
            settings={settings}
            onSave={saveSettings}
            onBack={() => setShowSettings(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>AI 助手</DialogTitle>
              <DialogDescription>
                把想法补成画面，让文稿更清楚。
              </DialogDescription>
            </DialogHeader>
            <div className="ai-scroll">
              <fieldset className="ai-task-tabs" aria-label="AI 功能">
                {actions.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={task === id}
                    disabled={busy || downloading}
                    onClick={() => selectTask(id)}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </fieldset>
              {storageWarning && (
                <p className="ai-error" role="alert">
                  {storageWarning}
                </p>
              )}
              {!configured && (
                <div className="ai-empty">
                  <strong>先连接你的 AI 服务</strong>
                  <p>
                    填写 API 地址、模型和密钥，即可使用
                    {task === 'image' ? '生图' : '文字'}功能。
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setShowSettings(true)}
                  >
                    前往 AI 设置
                  </Button>
                </div>
              )}
              <fieldset className="ai-form" disabled={busy || downloading}>
                <label className="ai-field">
                  <span>处理范围</span>
                  <select
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      resetResult();
                    }}
                  >
                    {canAll && (
                      <option value="all">
                        整篇文稿 · {script.segments.length} 段
                      </option>
                    )}
                    {script.segments.map((row, index) => (
                      <option key={row.id} value={row.id}>
                        第 {index + 1} 段 · {row.title || '未命名段落'}
                      </option>
                    ))}
                  </select>
                </label>
                {task === 'review' && (
                  <fieldset className="ai-platforms" aria-label="本次审查平台">
                    {PLATFORM_RULES.map((rule) => (
                      <label className="ai-check" key={rule.id}>
                        <input
                          type="checkbox"
                          checked={settings.platforms.includes(rule.id)}
                          onChange={(e) => {
                            setSettings({
                              ...settings,
                              platforms: e.target.checked
                                ? [...settings.platforms, rule.id]
                                : settings.platforms.filter(
                                    (id) => id !== rule.id,
                                  ),
                            });
                            resetResult();
                          }}
                        />
                        <span>{rule.name}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="ai-field" htmlFor="ai-extra-instruction">
                  <span>本次补充要求（可选）</span>
                  <Textarea
                    id="ai-extra-instruction"
                    rows={2}
                    maxLength={3000}
                    value={instruction}
                    onChange={(e) => {
                      setInstruction(e.target.value);
                      resetResult();
                    }}
                    placeholder={
                      task === 'review'
                        ? '例如：这是一条商业合作视频，重点检查宣传表达。'
                        : task === 'polish'
                          ? '例如：更适合口播，保留原稿中的限定条件。'
                          : '例如：竖屏构图，主体靠左，为右侧字幕留白。'
                    }
                  />
                </label>
                {task !== 'review' && (
                  <p className="form-help">
                    {(
                      task === 'polish'
                        ? settings.writingStyle
                        : settings.visualStyle
                    )
                      ? '已使用 AI 设置中的固定风格。'
                      : '可在 AI 设置中填写固定风格，后续自动沿用。'}
                  </p>
                )}
              </fieldset>
              {task === 'review' && (
                <div className="ai-rule-note">
                  <p>
                    依据内置规则摘要与补充规则审查，不联网更新，不代表平台审核结论。仅检查文字描述，不检查图片像素、实际素材或账号资质。
                  </p>
                  {rulesAreOld() && (
                    <p className="ai-warning">
                      规则摘要已超过 30 天，请核对官方最新版本并补充变更。
                    </p>
                  )}
                  {rules.some((rule) => !rule.verified) && (
                    <p className="ai-warning">
                      视频号规则正文尚未核验，本次仅可提供通用风险提示或依据你补充的规则。
                    </p>
                  )}
                  <details>
                    <summary>查看规则来源与覆盖范围</summary>
                    {rules.map((rule) => (
                      <div className="ai-rule-source" key={rule.id}>
                        <a href={rule.source} target="_blank" rel="noreferrer">
                          {rule.sourceTitle}
                        </a>
                        <span>
                          {rule.verified ? '资料核对' : '读取尝试'}：
                          {rule.checkedAt}
                        </span>
                        <p>{rule.coverage}</p>
                      </div>
                    ))}
                  </details>
                </div>
              )}
              {busy && (
                <output className="ai-loading">
                  <LoaderCircle className="spin" size={18} />
                  {task === 'image' ? '正在生成一张配图…' : '正在处理所选内容…'}
                </output>
              )}
              {error && (
                <p className="ai-error" role="alert">
                  {error}
                </p>
              )}
              {result && (
                <section className="ai-result" aria-label="AI 结果预览">
                  <h3>
                    {
                      actions.find((action) => action.id === result.result.kind)
                        ?.label
                    }{' '}
                    · 结果预览
                  </h3>
                  {stale && !applied && (
                    <p className="ai-warning" role="alert">
                      原稿已变化；此结果基于生成时的内容，请重新生成后再应用。
                    </p>
                  )}
                  {result.result.kind === 'visual' && (
                    <>
                      <label className="ai-field" htmlFor="ai-visual-result">
                        <span>建议画面</span>
                        <Textarea
                          id="ai-visual-result"
                          readOnly={applied}
                          rows={4}
                          maxLength={50000}
                          value={result.result.visual}
                          onChange={(e) => {
                            if (result.result.kind === 'visual')
                              setResult({
                                ...result,
                                result: {
                                  ...result.result,
                                  visual: e.target.value,
                                },
                              });
                          }}
                        />
                      </label>
                      <label className="ai-field" htmlFor="ai-notes-result">
                        <span>建议附注</span>
                        <Textarea
                          id="ai-notes-result"
                          readOnly={applied}
                          rows={3}
                          maxLength={50000}
                          value={result.result.notes}
                          onChange={(e) => {
                            if (result.result.kind === 'visual')
                              setResult({
                                ...result,
                                result: {
                                  ...result.result,
                                  notes: e.target.value,
                                },
                              });
                          }}
                        />
                      </label>
                      <label className="ai-check">
                        <input
                          type="checkbox"
                          checked={append}
                          disabled={applied}
                          onChange={(e) => setAppend(e.target.checked)}
                        />
                        <span>追加到现有画面与附注（取消勾选则替换）</span>
                      </label>
                    </>
                  )}
                  {result.result.kind === 'polish' && (
                    <div className="ai-rewrites">
                      {result.result.segments.map((row, index) => (
                        <div className="ai-rewrite" key={row.id}>
                          <h4>
                            {result.input.segments[index].title ||
                              `段落 ${index + 1}`}
                          </h4>
                          <div className="ai-grid-two">
                            <div>
                              <span className="ai-small-label">原文</span>
                              <p className="ai-original">
                                {result.input.segments[index].narration ||
                                  '空白段落'}
                              </p>
                            </div>
                            <label className="ai-field">
                              <span>润色结果 · {index + 1}</span>
                              <Textarea
                                readOnly={applied}
                                rows={4}
                                maxLength={50000}
                                value={row.narration}
                                onChange={(e) => {
                                  if (result.result.kind === 'polish')
                                    setResult({
                                      ...result,
                                      result: {
                                        ...result.result,
                                        segments: result.result.segments.map(
                                          (item) =>
                                            item.id === row.id
                                              ? {
                                                  ...item,
                                                  narration: e.target.value,
                                                }
                                              : item,
                                        ),
                                      },
                                    });
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.result.kind === 'image' && (
                    <>
                      {imageError ? (
                        <p className="ai-warning">
                          图片无法预览，可能是链接过期或图片无法解码。可尝试下载或打开原图。
                        </p>
                      ) : (
                        <img
                          className="ai-image"
                          src={result.result.src}
                          alt="根据当前段落画面附注生成的配图"
                          referrerPolicy="no-referrer"
                          onError={() => setImageError(true)}
                        />
                      )}
                      <div className="ai-image-actions">
                        <Button
                          variant="outline"
                          disabled={downloading}
                          onClick={() => void downloadImage()}
                        >
                          {downloading ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <Download size={14} />
                          )}
                          下载配图
                        </Button>
                        {result.result.src.startsWith('https:') && (
                          <a
                            href={result.result.src}
                            target="_blank"
                            rel="noreferrer"
                          >
                            打开原图
                          </a>
                        )}
                      </div>
                      <p className="form-help">
                        {applied
                          ? '已放入对应段落的配图栏，可在编辑器撤销。'
                          : '配图尚未放入稿件，可下载后手动添加。'}
                        {result.result.src.startsWith('https:') &&
                          ' 图片未能保存到本机，临时链接可能过期，请下载后重新添加。'}
                      </p>
                      <details>
                        <summary>查看生图提示词</summary>
                        <p className="ai-plain">{result.result.prompt}</p>
                        {result.result.revisedPrompt && (
                          <>
                            <h4>服务商调整后的提示词</h4>
                            <p className="ai-plain">
                              {result.result.revisedPrompt}
                            </p>
                          </>
                        )}
                      </details>
                    </>
                  )}
                  {result.result.kind === 'review' && (
                    <>
                      <p className="ai-plain">{result.result.summary}</p>
                      {!result.result.issues.length && (
                        <p className="ai-notice">
                          在本次提供的规则与文本范围内，未识别到具体风险；仍需核对最新规则和实际素材。
                        </p>
                      )}
                      {result.result.issues.map((issue, index) => {
                        const rule = PLATFORM_RULES.find(
                          (item) => item.id === issue.platform,
                        )!;
                        const row = result.input.segments.find(
                          (item) => item.id === issue.segmentId,
                        );
                        return (
                          <article className="ai-risk" key={index}>
                            <div className="ai-risk-heading">
                              <strong>
                                {rule.name} ·{' '}
                                {issue.severity === 'high'
                                  ? '高风险'
                                  : issue.severity === 'medium'
                                    ? '中风险'
                                    : '低风险'}
                              </strong>
                              <button
                                type="button"
                                disabled={stale}
                                onClick={() => {
                                  onClose();
                                  onLocate(issue.segmentId);
                                }}
                              >
                                {row ? row.title || '段落' : '脚本'} ·{' '}
                                {fieldLabels[issue.field]}
                              </button>
                            </div>
                            <blockquote>{issue.quote}</blockquote>
                            <p>{issue.reason}</p>
                            <p>
                              <strong>建议：</strong>
                              {issue.suggestion}
                            </p>
                            <small>
                              {issue.basis === 'reference' ? (
                                <>
                                  <span>摘要依据：</span>
                                  <a
                                    href={rule.source}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {rule.sourceTitle}
                                  </a>
                                </>
                              ) : issue.basis === 'custom' ? (
                                '依据：用户补充规则（未经官方核验）'
                              ) : (
                                '依据：通用风险提示，平台适用性待核验'
                              )}
                            </small>
                          </article>
                        );
                      })}
                    </>
                  )}
                  {(result.result.kind === 'visual' ||
                    result.result.kind === 'polish') && (
                    <div className="ai-apply">
                      <span>
                        {applied
                          ? '已写入稿件，可在编辑器中撤销。'
                          : '应用后支持撤销。'}
                      </span>
                    </div>
                  )}
                </section>
              )}
              {configured && (
                <p className="ai-disclosure">
                  本次将发送所选{scope === 'all' ? '整篇文稿' : '段落'}
                  、脚本标题与简介、相关风格及要求至{' '}
                  <strong>{destination}</strong>。
                  {task === 'review' && '审查还会发送所选平台规则。'}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy || downloading}
                onClick={() => setShowSettings(true)}
              >
                <Settings2 size={15} />
                AI 设置
              </Button>
              {busy ? (
                <Button variant="outline" onClick={cancel}>
                  取消等待
                </Button>
              ) : (
                <Button
                  variant={
                    result?.result.kind === 'visual' ||
                    result?.result.kind === 'polish'
                      ? 'outline'
                      : 'default'
                  }
                  disabled={
                    !configured ||
                    downloading ||
                    (task === 'review' && !settings.platforms.length)
                  }
                  onClick={() => void run()}
                >
                  <Sparkles size={15} />
                  {result
                    ? '重新生成'
                    : task === 'image'
                      ? '生成一张配图'
                      : task === 'review'
                        ? '开始审查'
                        : task === 'polish'
                          ? '开始润色'
                          : '生成画面建议'}
                </Button>
              )}
              {result &&
                (result.result.kind === 'visual' ||
                  result.result.kind === 'polish') && (
                  <Button
                    disabled={stale || applied || busy}
                    onClick={() => {
                      try {
                        if (
                          result.result.kind !== 'visual' &&
                          result.result.kind !== 'polish'
                        )
                          return;
                        onApply(result.input, result.result, append);
                        setApplied(true);
                        setError('');
                      } catch (cause) {
                        setError((cause as Error).message);
                      }
                    }}
                  >
                    {applied
                      ? '已应用'
                      : result.result.kind === 'visual'
                        ? '应用到画面与附注'
                        : '应用润色'}
                  </Button>
                )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
