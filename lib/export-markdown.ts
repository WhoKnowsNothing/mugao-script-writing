import {
  formatDuration,
  formatTimecode,
  scriptStats,
  segmentStats,
  type Script,
  type Workspace,
} from './script.ts';

export type MarkdownLayout = 'table' | 'sections';

// Escape HTML first: imported text must never become executable markup in a Markdown viewer.
export function escapeMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+.!~-])/g, '\\$1')
    .replace(/\|/g, '&#124;');
}
const cell = (text: string) =>
  escapeMarkdown(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
const prose = (text: string) =>
  escapeMarkdown(text).replace(/\r\n?/g, '\n').replace(/\n/g, '  \n');

export function exportMarkdown(
  script: Script,
  layout: MarkdownLayout = 'table',
): string {
  const stats = scriptStats(script);
  const lines = [`# ${escapeMarkdown(script.title || '未命名脚本')}`, ''];
  if (script.description) lines.push(prose(script.description), '');
  lines.push(
    `> ${script.segments.length} 个段落 · ${stats.characters} 字 · 预计口播 ${formatDuration(stats.spoken)} · 计划总时长 ${formatDuration(stats.planned)}`,
    `> 中文 ${script.chineseCpm} 字/分钟，英文 ${script.englishWpm} 词/分钟。字数不含标点与空白；数字逐位计。口播时长不含停顿；计划时长包含停顿或手动时长。`,
    '',
    '<!-- exported-with: mugao v1 -->',
    '',
  );
  if (layout === 'table') {
    lines.push(
      '| 段落 / 计划时长 | 文案 / 口播 | 画面 / BGM / 附注 |',
      '| :--- | :--- | :--- |',
    );
    script.segments.forEach((row, i) => {
      const timing = segmentStats(row, script);
      const label = `**${String(i + 1).padStart(2, '0')} · ${cell(row.title || '未命名段落')}**<br>${formatTimecode(timing.planned)}${timing.isManual ? '（手动）' : ''}<br>${timing.characters} 字 · 停顿 ${row.pauseSeconds} 秒`;
      const direction = `**画面**<br>${cell(row.visual) || '—'}<br><br>**BGM / 音效**<br>${cell(row.bgm) || '—'}<br><br>**附注**<br>${cell(row.notes) || '—'}`;
      lines.push(`| ${label} | ${cell(row.narration) || '—'} | ${direction} |`);
    });
  } else {
    script.segments.forEach((row, i) => {
      const timing = segmentStats(row, script);
      lines.push(
        `## ${String(i + 1).padStart(2, '0')} · ${escapeMarkdown(row.title || '未命名段落')}`,
        '',
        `> ${timing.characters} 字 · 口播 ${formatDuration(timing.spoken)} · 停顿 ${row.pauseSeconds} 秒 · 计划 ${formatDuration(timing.planned)}${timing.isManual ? '（手动）' : ''}`,
        '',
        '### 文案 / 口播',
        '',
        prose(row.narration) || '—',
        '',
        '### 画面',
        '',
        prose(row.visual) || '—',
        '',
        '### BGM / 音效',
        '',
        prose(row.bgm) || '—',
        '',
        '### 附注',
        '',
        prose(row.notes) || '—',
        '',
      );
    });
  }
  return lines.join('\n') + '\n';
}

export function exportBackup(workspace: Workspace): string {
  return JSON.stringify(workspace, null, 2) + '\n';
}
export function safeFilename(title: string): string {
  const name =
    Array.from(title, (character) =>
      character.charCodeAt(0) < 32 ? '-' : character,
    )
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80) || '未命名脚本';
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
    ? `脚本-${name}`
    : name;
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
