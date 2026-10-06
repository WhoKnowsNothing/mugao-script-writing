import { PLATFORM_IDS, type PlatformId } from './rules';

export interface ApiConnection {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AiSettings {
  version: 1;
  text: ApiConnection;
  image: ApiConnection;
  imageSize: string;
  visualStyle: string;
  writingStyle: string;
  platforms: PlatformId[];
  customRules: string;
  rememberKeys: boolean;
}

export const SETTINGS_KEY = 'mugao-ai-settings-v1';
export const SESSION_KEYS_KEY = 'mugao-ai-session-keys-v1';

export function defaultAiSettings(): AiSettings {
  return {
    version: 1,
    text: { baseUrl: '', model: '', apiKey: '' },
    image: { baseUrl: '', model: '', apiKey: '' },
    imageSize: '',
    visualStyle: '',
    writingStyle: '',
    platforms: [...PLATFORM_IDS],
    customRules: '',
    rememberKeys: false,
  };
}

export function apiEndpoint(baseUrl: string, kind: 'text' | 'image'): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error(
      '请填写完整的 API 基础地址，例如 https://api.example.com/v1。',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('API 地址需使用 HTTPS；本机 localhost 可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'API 地址不能包含账号、密码、查询参数或片段。请将密钥填入 API Key。',
    );
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(chat\/completions|images\/generations|responses)$/.test(path))
    throw new Error(
      '请填写基础地址（通常以 /v1 结尾），不要包含具体接口路径。',
    );
  url.pathname = `${path}/${kind === 'text' ? 'chat/completions' : 'images/generations'}`;
  return url.toString();
}

export function validateConnection(
  connection: ApiConnection,
  kind: 'text' | 'image',
) {
  const endpoint = apiEndpoint(connection.baseUrl, kind);
  if (!connection.model.trim())
    throw new Error('请先在 AI 设置中填写模型名称。');
  if (connection.model.length > 200 || connection.apiKey.length > 4000)
    throw new Error('模型名称或 API Key 过长。');
  if (/[\r\n]/.test(connection.apiKey))
    throw new Error('API Key 不能包含换行。');
  return endpoint;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Reconstruct only known settings; never mix credentials into script backups. */
export function readAiSettings(local: Storage, session: Storage): AiSettings {
  const result = defaultAiSettings();
  const raw = local.getItem(SETTINGS_KEY);
  if (!raw) return result;
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== 1)
    throw new Error('AI 设置版本不支持，请重新保存设置。');
  result.rememberKeys = parsed.rememberKeys === true;
  const keys = result.rememberKeys
    ? parsed
    : JSON.parse(session.getItem(SESSION_KEYS_KEY) || '{}');
  for (const kind of ['text', 'image'] as const) {
    const baseUrl = text(parsed[kind]?.baseUrl, 2000);
    // localStorage is shared across tabs, sessionStorage is not. Never pair
    // another tab's newly saved endpoint with this tab's old credentials.
    const matchingEndpoint =
      result.rememberKeys || keys?.[kind]?.baseUrl === baseUrl;
    result[kind] = {
      baseUrl,
      model: text(parsed[kind]?.model, 200),
      apiKey: matchingEndpoint ? text(keys?.[kind]?.apiKey, 4000) : '',
    };
  }
  result.imageSize = text(parsed.imageSize, 40);
  result.visualStyle = text(parsed.visualStyle, 6000);
  result.writingStyle = text(parsed.writingStyle, 6000);
  result.customRules = text(parsed.customRules, 12000);
  if (Array.isArray(parsed.platforms))
    result.platforms = PLATFORM_IDS.filter((id) =>
      parsed.platforms.includes(id),
    );
  return result;
}

export function saveAiSettings(
  settings: AiSettings,
  local: Storage,
  session: Storage,
) {
  const { text: writing, image: picture } = settings;
  // Removing a previously remembered key happens before any fallible new write.
  if (!settings.rememberKeys) local.removeItem(SETTINGS_KEY);
  session.removeItem(SESSION_KEYS_KEY);
  const stored = {
    ...settings,
    text: { ...writing, apiKey: settings.rememberKeys ? writing.apiKey : '' },
    image: { ...picture, apiKey: settings.rememberKeys ? picture.apiKey : '' },
  };
  local.setItem(SETTINGS_KEY, JSON.stringify(stored));
  if (!settings.rememberKeys)
    session.setItem(
      SESSION_KEYS_KEY,
      JSON.stringify({
        text: { baseUrl: writing.baseUrl, apiKey: writing.apiKey },
        image: { baseUrl: picture.baseUrl, apiKey: picture.apiKey },
      }),
    );
}
