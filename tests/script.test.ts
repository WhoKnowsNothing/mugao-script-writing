import { describe, expect, it } from 'vitest';
import {
  countText,
  createScript,
  duplicateScript,
  formatDuration,
  importAsCopies,
  mergeWithNext,
  moveSegment,
  parseBackup,
  sampleWorkspace,
  scriptStats,
  segmentStats,
  splitSegment,
  validateWorkspace,
} from '@/lib/script';
import {
  initialHistory,
  recordChange,
  redoHistory,
  undoHistory,
} from '@/lib/history';
import {
  exportBackup,
  exportMarkdown,
  safeFilename,
} from '@/lib/export-markdown';

describe('文字与口播估时', () => {
  it('按 Unicode 字符统计，排除标点、空白和 emoji，英文按词估时', () => {
    const counts = countText('你好，𠀀！ Hello world! 2026 😊\n');
    expect(counts).toEqual({
      characters: 17,
      chineseUnits: 7,
      englishWords: 2,
    });
    const script = createScript();
    script.segments[0].narration = '你好，𠀀！ Hello world! 2026 😊\n';
    const result = segmentStats(script.segments[0], script);
    expect(result.spoken).toBeCloseTo((7 / 240) * 60 + (2 / 150) * 60);
  });
  it('标点不会产生朗读时间，制作说明也不计入字数', () => {
    const script = createScript();
    script.segments[0].narration = '……！？ \n';
    script.segments[0].visual = '右栏画面不能算入口播';
    script.segments[0].bgm = '测试';
    expect(scriptStats(script).characters).toBe(0);
    expect(scriptStats(script).spoken).toBe(0);
  });
  it('区分朗读、额外停顿与手动计划时长，不重复叠加停顿', () => {
    const script = createScript();
    Object.assign(script.segments[0], {
      narration: '一二三四',
      pauseSeconds: 2,
      durationSeconds: 5,
    });
    expect(segmentStats(script.segments[0], script)).toMatchObject({
      spoken: 1,
      estimated: 3,
      planned: 5,
      isManual: true,
    });
    script.segments[0].durationSeconds = null;
    expect(scriptStats(script).planned).toBe(3);
    expect(formatDuration(59.9)).toBe('1 分');
    expect(formatDuration(0)).toBe('0 秒');
  });
});

describe('段落结构操作', () => {
  it('移动时文案、画面、BGM、附注保持配对', () => {
    const script = sampleWorkspace().documents[0];
    const first = script.segments[0];
    const moved = moveSegment(script, first.id, 1);
    expect(moved.segments[1]).toEqual(first);
    expect(script.segments[0]).toBe(first);
    expect(moveSegment(script, first.id, -1)).toBe(script);
  });
  it('分段不丢字、不切开 emoji，停顿跟随末尾，制作说明不重复', () => {
    const script = createScript();
    Object.assign(script.segments[0], {
      title: '题'.repeat(200),
      narration: 'A😊B\nC',
      visual: '保留镜头',
      pauseSeconds: 3,
      durationSeconds: 0.06,
    });
    const next = splitSegment(script, script.segments[0].id, 2);
    expect(next.segments.map((row) => row.narration).join('')).toBe('A😊B\nC');
    expect(next.segments[0].narration).toBe('A😊');
    expect(next.segments[0].visual).toBe('保留镜头');
    expect(next.segments[1].visual).toBe('');
    expect(next.segments.map((row) => row.pauseSeconds)).toEqual([0, 3]);
    expect(
      next.segments.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0),
    ).toBeCloseTo(0.06);
    expect(() =>
      validateWorkspace({
        schemaVersion: 1,
        activeId: next.id,
        documents: [next],
      }),
    ).not.toThrow();
  });
  it('合并保留两侧所有文字、停顿和混合的手动时长', () => {
    const script = sampleWorkspace().documents[0];
    script.segments = script.segments.slice(0, 2);
    script.segments[0].durationSeconds = 12;
    const expectedDuration = scriptStats(script).planned;
    const [a, b] = script.segments;
    const merged = mergeWithNext(script, a.id);
    for (const field of ['narration', 'visual', 'bgm', 'notes'] as const) {
      expect(merged.segments[0][field]).toContain(a[field]);
      expect(merged.segments[0][field]).toContain(b[field]);
    }
    expect(scriptStats(merged).planned).toBeCloseTo(expectedDuration);
  });
});

describe('备份与导出安全', () => {
  it('JSON 往返保持完整，导入副本不覆盖同 ID 的现有脚本', () => {
    const workspace = sampleWorkspace();
    const roundtrip = parseBackup(exportBackup(workspace));
    expect(roundtrip).toEqual(workspace);
    const merged = importAsCopies(workspace, roundtrip);
    expect(merged.documents).toHaveLength(2);
    expect(merged.documents[1]).toEqual(workspace.documents[0]);
    expect(merged.documents[0].id).not.toBe(workspace.documents[0].id);
    expect(merged.documents[0].segments[0].narration).toBe(
      workspace.documents[0].segments[0].narration,
    );
  });
  it('拒绝重复标识、非法语速和不支持的版本', () => {
    const workspace = sampleWorkspace();
    workspace.documents[0].chineseCpm = 0;
    expect(() => validateWorkspace(workspace)).toThrow('中文语速');
    workspace.documents[0].chineseCpm = 240;
    workspace.documents[0].segments[1].id =
      workspace.documents[0].segments[0].id;
    expect(() => validateWorkspace(workspace)).toThrow('重复');
    expect(() => parseBackup('{"schemaVersion":99}')).toThrow('版本');
    expect(() => parseBackup('not json')).toThrow('JSON');
  });
  it('导出 GFM 表格转义竖线、HTML 与换行，不增加伪造的单元格', () => {
    const script = createScript('脚本 | 标题');
    Object.assign(script.segments[0], {
      narration: 'a|b\n\n<script>alert(1)</script> & **粗体**',
      visual: '画面|一\n画面二',
      bgm: '淡入',
      notes: '保留 \\ 路径',
    });
    const markdown = exportMarkdown(script);
    expect(markdown).toContain('a&#124;b<br><br>&lt;script&gt;');
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('\\*\\*粗体\\*\\*');
    const rows = markdown.split('\n').filter((line) => line.startsWith('|'));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.split('|')).toHaveLength(5);
    const prose = exportMarkdown(script, 'sections');
    expect(prose).toContain('### 文案 / 口播');
    expect(prose).toContain('### BGM / 音效\n\n淡入');
    expect(prose).not.toContain('<script>');
  });
  it('长标题仍可复制保存，文件名兼容 Windows', () => {
    const script = createScript('题'.repeat(200));
    const copy = duplicateScript(script);
    expect(copy.title.length).toBeLessThanOrEqual(200);
    expect(safeFilename('CON')).toBe('脚本-CON');
    expect(safeFilename('片名:第一集/测试?')).toBe('片名-第一集-测试-');
  });
});

describe('撤销与重做', () => {
  it('连续输入合为一组；结构改动可独立撤销，重做恢复对应字段', () => {
    const original = sampleWorkspace();
    const typed1 = structuredClone(original);
    typed1.documents[0].segments[0].narration = '新';
    const typed2 = structuredClone(typed1);
    typed2.documents[0].segments[0].narration = '新的文案';
    let history = recordChange(initialHistory(original), typed1, 'text', 1000);
    history = recordChange(history, typed2, 'text', 1200);
    expect(history.past).toHaveLength(1);
    const moved = {
      ...typed2,
      documents: [
        moveSegment(typed2.documents[0], typed2.documents[0].segments[0].id, 1),
      ],
    };
    history = recordChange(history, moved, null, 1300);
    expect(undoHistory(history).present).toEqual(typed2);
    expect(undoHistory(undoHistory(history)).present).toEqual(original);
    expect(redoHistory(undoHistory(history)).present).toEqual(moved);
  });
});
