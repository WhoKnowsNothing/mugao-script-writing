import {
  validateConnection,
  type AiSettings,
  type ApiConnection,
} from './settings';
import { imageMime, MAX_SEGMENT_IMAGE_BYTES } from '../segment-image';
export { imageMime } from '../segment-image';

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}
export interface GeneratedImage {
  src: string;
  revisedPrompt?: string;
}
export interface AiCompletionOptions {
  responseFormat?: 'json_object';
}

/** The editor depends on this boundary; a future authenticated service can implement it. */
export interface AiProvider {
  complete(
    messages: AiMessage[],
    signal: AbortSignal,
    options?: AiCompletionOptions,
  ): Promise<string>;
  generateImage(prompt: string, signal: AbortSignal): Promise<GeneratedImage>;
}

export class AiError extends Error {}
const MAX_IMAGE_BYTES = MAX_SEGMENT_IMAGE_BYTES;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes)
    throw new AiError('服务返回的数据过大，请降低生成长度或图片大小。');
  if (!response.body) throw new AiError('服务返回了空响应。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new AiError('服务返回的数据过大，请降低生成长度或图片大小。');
      }
      text += decoder.decode(item.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function request(
  connection: ApiConnection,
  kind: 'text' | 'image',
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const endpoint = validateConnection(connection, kind);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    kind === 'image' ? 180000 : 90000,
  );
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(connection.apiKey.trim()
          ? { Authorization: `Bearer ${connection.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({ model: connection.model.trim(), ...body }),
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      const reasons: Record<number, string> = {
        400:
          kind === 'text'
            ? '请求参数不受支持，请检查模型；生成建议、润色和审查需支持 JSON 输出模式。'
            : '请求参数不受支持，请检查模型与图片尺寸。',
        401: 'API Key 无效或已过期，请检查密钥。',
        402: '服务商账户余额不足或处于欠费状态（HTTP 402），请到服务商控制台检查余额与可用额度。',
        403: '没有权限使用此模型或接口。',
        404: '未找到接口或模型，请检查基础地址和模型名称。',
        413: '内容超过服务商限制，请减少段落或提示词长度。',
        429: '调用频率或额度受限，请稍后重试或检查服务商余额。',
      };
      // Provider error bodies can echo credentials or private prompts. Never display them.
      throw new AiError(
        reasons[response.status] ||
          `服务暂时不可用（HTTP ${response.status}），请稍后重试。`,
      );
    }
    const raw = await readLimited(
      response,
      kind === 'image' ? MAX_IMAGE_BYTES * 1.4 : 1024 * 1024,
    );
    try {
      return record(JSON.parse(raw));
    } catch {
      throw new AiError(
        '服务返回的不是有效 JSON，请确认使用 OpenAI 兼容接口。',
      );
    }
  } catch (cause) {
    if (signal.aborted)
      throw new AiError('已取消等待。服务商可能仍会完成请求并计费。');
    if (timedOut)
      throw new AiError(
        '等待超时，未自动重试。服务商可能仍在处理，请确认后再试。',
      );
    if (cause instanceof AiError) throw cause;
    throw new AiError(
      '无法连接 API。请检查网络、地址及服务商是否允许此网站的跨域请求（CORS）。',
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export function decodeImage(base64: string): {
  bytes: Uint8Array;
  mime: string;
} {
  if (
    !base64 ||
    base64.length > MAX_IMAGE_BYTES * 1.4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new AiError('返回的图片编码无效或超过 20 MB。');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    throw new AiError('返回的图片编码无效。');
  }
  const mime = imageMime(bytes);
  if (!mime || bytes.length > MAX_IMAGE_BYTES)
    throw new AiError('仅支持 20 MB 以内的 PNG、JPEG 或 WebP 图片。');
  return { bytes, mime };
}

export function createCustomProvider(settings: AiSettings): AiProvider {
  return {
    async complete(messages, signal, options) {
      const result = await request(
        settings.text,
        'text',
        {
          messages,
          stream: false,
          ...(options?.responseFormat
            ? { response_format: { type: options.responseFormat } }
            : {}),
        },
        signal,
      );
      const choice = record(
        Array.isArray(result.choices) ? result.choices[0] : null,
      );
      if (choice.finish_reason === 'length')
        throw new AiError('模型输出被截断，请缩小到单段后重试。');
      const message = record(choice.message);
      if (message.refusal || choice.finish_reason === 'content_filter')
        throw new AiError('服务商未生成这次内容，请调整请求。');
      if (typeof message.content !== 'string' || !message.content.trim())
        throw new AiError(
          '模型没有返回文字，请检查模型是否支持 Chat Completions。',
        );
      return message.content;
    },
    async generateImage(prompt, signal) {
      const hostname = new URL(validateConnection(settings.image, 'image'))
        .hostname;
      const siliconFlow = [
        'api.siliconflow.cn',
        'api.siliconflow.com',
      ].includes(hostname);
      const size = settings.imageSize.trim();
      const imageSize =
        size ||
        (settings.image.model.trim() === 'Kwai-Kolors/Kolors'
          ? '1024x1024'
          : '');
      if (siliconFlow && size && !/^\d{2,5}x\d{2,5}$/.test(size))
        throw new AiError(
          '硅基流动图片尺寸需填写宽x高，例如 1024x1024；也可留空使用默认尺寸。',
        );
      const result = await request(
        settings.image,
        'image',
        siliconFlow
          ? { prompt, ...(imageSize ? { image_size: imageSize } : {}) }
          : { prompt, n: 1, ...(size ? { size } : {}) },
        signal,
      );
      const images = siliconFlow ? result.images : result.data;
      const item = record(Array.isArray(images) ? images[0] : null);
      let src: string;
      if (typeof item.b64_json === 'string') {
        const { mime } = decodeImage(item.b64_json);
        src = `data:${mime};base64,${item.b64_json}`;
      } else if (typeof item.url === 'string') {
        let url: URL;
        try {
          url = new URL(item.url);
        } catch {
          throw new AiError('服务返回的图片地址无效。');
        }
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new AiError('远程图片地址必须使用 HTTPS 且不含账号密码。');
        src = url.toString();
      } else
        throw new AiError(
          '服务没有返回图片，请确认该模型支持 Images Generations。',
        );
      return {
        src,
        revisedPrompt:
          typeof item.revised_prompt === 'string'
            ? item.revised_prompt.slice(0, 16000)
            : undefined,
      };
    },
  };
}

/** Image downloads never reuse the provider Authorization header. */
export async function imageBlob(
  src: string,
  signal: AbortSignal,
): Promise<Blob> {
  if (src.startsWith('data:')) {
    const { bytes, mime } = decodeImage(src.split(',')[1] || '');
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  }
  let response: Response;
  try {
    response = await fetch(src, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
  } catch {
    throw new AiError(
      '图片下载失败，可能是链接过期或图片服务器不允许跨域；可打开原图后保存。',
    );
  }
  if (!response.ok)
    throw new AiError('图片链接已失效，请打开原图检查或重新生成。');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES)
    throw new AiError('图片超过 20 MB，请打开原图后保存。');
  // Stream to bound memory even when Content-Length is absent.
  if (!response.body) throw new AiError('图片响应为空。');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new AiError('图片超过 20 MB，请打开原图后保存。');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks);
  const mime = imageMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  if (!mime) throw new AiError('下载内容不是 PNG、JPEG 或 WebP 图片。');
  return blob.slice(0, blob.size, mime);
}
