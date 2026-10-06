import { validateSegmentImage } from './segment-image.ts';

export const LIMITS = {
  documents: 100,
  segments: 500,
  text: 50000,
  fileBytes: 128 * 1024 * 1024,
};

export interface Segment {
  id: string;
  title: string;
  narration: string;
  visual: string;
  bgm: string;
  notes: string;
  image?: string;
  pauseSeconds: number;
  durationSeconds: number | null;
}

export interface Script {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  chineseCpm: number;
  englishWpm: number;
  segments: Segment[];
}

export interface Workspace {
  schemaVersion: 1;
  activeId: string;
  documents: Script[];
}

export const newId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on ordinary HTTP preview addresses.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const nowISO = () => new Date().toISOString();

export function createSegment(title = ''): Segment {
  return {
    id: newId(),
    title,
    narration: '',
    visual: '',
    bgm: '',
    notes: '',
    pauseSeconds: 0,
    durationSeconds: null,
  };
}

export function createScript(title = '未命名脚本'): Script {
  const now = nowISO();
  return {
    id: newId(),
    title,
    description: '',
    createdAt: now,
    updatedAt: now,
    chineseCpm: 240,
    englishWpm: 150,
    segments: [createSegment('开场')],
  };
}

export function sampleWorkspace(): Workspace {
  const document: Script = {
    id: 'welcome-script',
    title: '把一个想法，拍成视频',
    description: '把想说的话写在左边，把想拍的画面留在右边。',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    chineseCpm: 240,
    englishWpm: 150,
    segments: [
      {
        id: 'welcome-1',
        title: '开场 · 从一个问题开始',
        narration:
          '你有没有这样的时刻：脑子里明明有一个很好的想法，一打开文档，却不知道第一句话该怎么写。\n\n其实，你不需要一开始就写出完美的脚本。',
        visual: '桌面俯拍，空白文档与一杯咖啡。镜头慢慢推近光标。',
        bgm: '轻柔的钢琴，从低音量进入',
        notes: '第一句后稍停，给观众一点思考的时间。',
        pauseSeconds: 1,
        durationSeconds: null,
      },
      {
        id: 'welcome-2',
        title: '展开 · 先写清楚，再拍出来',
        narration:
          '先把想说的话分成几个小段。左边写你要说什么，右边记下观众会看到什么。\n\n一句口播、一段画面，想法就这样慢慢有了形状。',
        visual: '录屏展示：新增段落，填写文案，然后补充画面说明。',
        bgm: '延续前段，加入轻微的节奏',
        notes: '录屏中的鼠标移动放慢，关键操作留出停顿。',
        pauseSeconds: 0,
        durationSeconds: null,
      },
      {
        id: 'welcome-3',
        title: '收尾 · 留下一个行动',
        narration:
          '不用等到所有细节都想好。写下第一段，再往前走一步。\n\n你的下一条视频，就从这里开始。',
        visual: '切回桌面，合上笔记本。淡出到片尾。',
        bgm: '最后两秒自然淡出',
        notes: '片尾保留两秒纯画面。',
        pauseSeconds: 2,
        durationSeconds: null,
      },
    ],
  };
  return { schemaVersion: 1, activeId: document.id, documents: [document] };
}

export function activeScript(workspace: Workspace): Script {
  return (
    workspace.documents.find((d) => d.id === workspace.activeId) ??
    workspace.documents[0]
  );
}

/** Visible letters and digits, not UTF-16 units. Punctuation and emoji are excluded. */
export function countText(text: string) {
  const letters = text.match(/[\p{L}\p{N}]/gu) ?? [];
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  const englishWords =
    text.match(
      /\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’-][\p{Script=Latin}\p{M}]+)*/gu,
    ) ?? [];
  return {
    characters: letters.length,
    chineseUnits: letters.length - latin.length,
    englishWords: englishWords.length,
  };
}

export function segmentStats(
  segment: Segment,
  script: Pick<Script, 'chineseCpm' | 'englishWpm'>,
) {
  const counts = countText(segment.narration);
  const spoken =
    (counts.chineseUnits / script.chineseCpm) * 60 +
    (counts.englishWords / script.englishWpm) * 60;
  const estimated = spoken + segment.pauseSeconds;
  return {
    ...counts,
    spoken,
    estimated,
    planned: segment.durationSeconds ?? estimated,
    isManual: segment.durationSeconds !== null,
  };
}

export function scriptStats(script: Script) {
  return script.segments.reduce(
    (acc, row) => {
      const stats = segmentStats(row, script);
      return {
        characters: acc.characters + stats.characters,
        englishWords: acc.englishWords + stats.englishWords,
        spoken: acc.spoken + stats.spoken,
        pauses: acc.pauses + row.pauseSeconds,
        planned: acc.planned + stats.planned,
        manualCount: acc.manualCount + Number(stats.isManual),
      };
    },
    {
      characters: 0,
      englishWords: 0,
      spoken: 0,
      pauses: 0,
      planned: 0,
      manualCount: 0,
    },
  );
}

export function formatDuration(seconds: number) {
  const rounded = Math.ceil(Math.max(0, seconds) - 1e-9);
  if (rounded < 60) return `${rounded} 秒`;
  const minutes = Math.floor(rounded / 60);
  return `${minutes} 分${rounded % 60 ? ` ${rounded % 60} 秒` : ''}`;
}

export function formatTimecode(seconds: number) {
  const n = Math.ceil(Math.max(0, seconds) - 1e-9);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function replaceScript(workspace: Workspace, doc: Script): Workspace {
  return {
    ...workspace,
    documents: workspace.documents.map((d) =>
      d.id === doc.id ? { ...doc, updatedAt: nowISO() } : d,
    ),
  };
}

export function duplicateScript(doc: Script): Script {
  return {
    ...doc,
    id: newId(),
    title: `${(doc.title || '未命名脚本').slice(0, 196)}（副本）`,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    segments: doc.segments.map((row) => ({ ...row, id: newId() })),
  };
}

export function moveSegment(
  doc: Script,
  id: string,
  direction: -1 | 1,
): Script {
  const from = doc.segments.findIndex((row) => row.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= doc.segments.length) return doc;
  const rows = [...doc.segments];
  [rows[from], rows[to]] = [rows[to], rows[from]];
  return { ...doc, segments: rows };
}

// A null target places the segment at the end of the script.
export function moveSegmentBefore(
  doc: Script,
  id: string,
  targetId: string | null,
): Script {
  const from = doc.segments.findIndex((row) => row.id === id);
  const target = doc.segments.findIndex((row) => row.id === targetId);
  if (from < 0 || (targetId !== null && target < 0) || id === targetId)
    return doc;
  const rows = [...doc.segments];
  const [moving] = rows.splice(from, 1);
  const insertion =
    targetId === null
      ? rows.length
      : rows.findIndex((row) => row.id === targetId);
  rows.splice(insertion, 0, moving);
  if (rows.every((row, index) => row === doc.segments[index])) return doc;
  return { ...doc, segments: rows };
}

export function splitSegment(doc: Script, id: string, offset: number): Script {
  const index = doc.segments.findIndex((row) => row.id === id);
  const row = doc.segments[index];
  if (
    !row ||
    offset <= 0 ||
    offset >= row.narration.length ||
    doc.segments.length >= LIMITS.segments
  )
    return doc;
  // Do not split a supplementary Unicode character in the middle of its surrogate pair.
  if (
    /[\uD800-\uDBFF]/u.test(row.narration[offset - 1]) &&
    /[\uDC00-\uDFFF]/u.test(row.narration[offset])
  )
    offset++;
  if (offset >= row.narration.length) return doc;
  const first = row.narration.slice(0, offset);
  const second = row.narration.slice(offset);
  const firstDuration =
    row.durationSeconds === null
      ? null
      : (row.durationSeconds * first.length) / row.narration.length;
  const next = {
    ...createSegment(`${(row.title || '段落').slice(0, 197)}（续）`),
    narration: second,
    pauseSeconds: row.pauseSeconds,
    durationSeconds:
      row.durationSeconds === null
        ? null
        : Math.max(0, row.durationSeconds - (firstDuration ?? 0)),
  };
  const rows = [...doc.segments];
  rows.splice(
    index,
    1,
    {
      ...row,
      narration: first,
      pauseSeconds: 0,
      durationSeconds: firstDuration,
    },
    next,
  );
  return { ...doc, segments: rows };
}

const joinText = (a: string, b: string) => (a && b ? `${a}\n\n${b}` : a || b);

export function mergeWithNext(doc: Script, id: string): Script {
  const index = doc.segments.findIndex((row) => row.id === id);
  const a = doc.segments[index],
    b = doc.segments[index + 1];
  if (index < 0 || !a || !b) return doc;
  if (a.image && b.image && a.image !== b.image)
    throw new Error(
      '两段都有配图，每段只能保留一张。请先移除其中一张，再合并。',
    );
  const merged: Segment = {
    ...a,
    narration: joinText(a.narration, b.narration),
    visual: joinText(a.visual, b.visual),
    bgm: joinText(a.bgm, b.bgm),
    notes: joinText(a.notes, b.notes),
    ...(a.image || b.image ? { image: a.image || b.image } : {}),
    pauseSeconds: a.pauseSeconds + b.pauseSeconds,
    durationSeconds:
      a.durationSeconds !== null || b.durationSeconds !== null
        ? segmentStats(a, doc).planned + segmentStats(b, doc).planned
        : null,
  };
  if (
    [merged.narration, merged.visual, merged.bgm, merged.notes].some(
      (value) => value.length > LIMITS.text,
    )
  )
    throw new Error('合并后的单栏文字过长，请保留为两个段落。');
  if (merged.pauseSeconds > 3600 || (merged.durationSeconds ?? 0) > 86400)
    throw new Error('合并后的时长超出范围，请保留为两个段落。');
  const rows = [...doc.segments];
  rows.splice(index, 2, merged);
  return { ...doc, segments: rows };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}格式不正确。`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = LIMITS.text): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${label}不是有效文本，或超出长度限制。`);
  return value.replace(/\r\n?/g, '\n');
}
function number(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label}超出范围。`);
  return value;
}
function identifier(value: unknown): string {
  const id = string(value, '标识', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('脚本或段落标识无效。');
  return id;
}
function date(value: unknown): string {
  const str = string(value, '日期', 40);
  if (!Number.isFinite(Date.parse(str))) throw new Error('备份日期无效。');
  return new Date(str).toISOString();
}

/** Reconstruct supported fields instead of trusting or spreading imported objects. */
export function validateWorkspace(value: unknown): Workspace {
  const root = object(value, '备份');
  if (root.schemaVersion !== 1)
    throw new Error('不支持这个备份版本。请使用幕稿导出的 v1 JSON 备份。');
  if (
    !Array.isArray(root.documents) ||
    root.documents.length < 1 ||
    root.documents.length > LIMITS.documents
  )
    throw new Error(`备份需包含 1–${LIMITS.documents} 份脚本。`);
  const allIds = new Set<string>();
  const documents = root.documents.map((raw): Script => {
    const d = object(raw, '脚本');
    const id = identifier(d.id);
    if (allIds.has(id)) throw new Error('备份中存在重复的脚本标识。');
    allIds.add(id);
    if (
      !Array.isArray(d.segments) ||
      d.segments.length < 1 ||
      d.segments.length > LIMITS.segments
    )
      throw new Error(`每份脚本需包含 1–${LIMITS.segments} 个段落。`);
    const rowIds = new Set<string>();
    const segments = d.segments.map((rawRow): Segment => {
      const r = object(rawRow, '段落');
      const rowId = identifier(r.id);
      const image = validateSegmentImage(r.image);
      if (rowIds.has(rowId)) throw new Error('备份中存在重复的段落标识。');
      rowIds.add(rowId);
      return {
        id: rowId,
        title: string(r.title, '段落标题', 200),
        narration: string(r.narration, '文案'),
        visual: string(r.visual, '画面'),
        bgm: string(r.bgm, 'BGM'),
        notes: string(r.notes, '附注'),
        ...(image ? { image } : {}),
        pauseSeconds: number(r.pauseSeconds, '停顿', 0, 3600),
        durationSeconds:
          r.durationSeconds === null
            ? null
            : number(r.durationSeconds, '手动时长', 0, 86400),
      };
    });
    return {
      id,
      title: string(d.title, '脚本标题', 200),
      description: string(d.description, '简介', 2000),
      createdAt: date(d.createdAt),
      updatedAt: date(d.updatedAt),
      chineseCpm: number(d.chineseCpm, '中文语速', 60, 600),
      englishWpm: number(d.englishWpm, '英文语速', 50, 300),
      segments,
    };
  });
  const activeId = identifier(root.activeId);
  if (!documents.some((d) => d.id === activeId))
    throw new Error('备份中找不到当前脚本。');
  return { schemaVersion: 1, activeId, documents };
}

export function parseBackup(text: string): Workspace {
  if (new TextEncoder().encode(text).byteLength > LIMITS.fileBytes)
    throw new Error('备份文件不能超过 128 MB。');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON 备份。');
  }
  return validateWorkspace(data);
}

export function importAsCopies(
  current: Workspace,
  incoming: Workspace,
): Workspace {
  if (current.documents.length + incoming.documents.length > LIMITS.documents)
    throw new Error(`最多保存 ${LIMITS.documents} 份脚本，请先整理现有脚本。`);
  const documents = incoming.documents.map((doc) => ({
    ...duplicateScript(doc),
    title: doc.title,
  }));
  const activeIndex = incoming.documents.findIndex(
    (doc) => doc.id === incoming.activeId,
  );
  return {
    ...current,
    activeId: documents[activeIndex].id,
    documents: [...documents, ...current.documents],
  };
}
