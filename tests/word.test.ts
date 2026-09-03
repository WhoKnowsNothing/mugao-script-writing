import { describe, expect, it } from 'vitest';
import { Packer } from 'docx';
import JSZip from 'jszip';
import { buildWordDocument } from '@/lib/export-docx';
import { sampleWorkspace } from '@/lib/script';

describe('真实 Word 导出', () => {
  it('生成合法 DOCX 包，中文、换行、所有制作备注与固定表格宽度完整', async () => {
    const script = sampleWorkspace().documents[0];
    script.segments[0].narration = '第一行 <不是标签> & 引号\n\n第三行中文';
    const bytes = await Packer.toBuffer(buildWordDocument(script));
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    const xml = await zip.file('word/document.xml')!.async('string');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const content = Array.from(parsed.getElementsByTagNameNS(ns, 't'))
      .map((node) => node.textContent)
      .join('\n');
    expect(content).toContain('第一行 <不是标签> & 引号');
    expect(content).toContain('第三行中文');
    for (const row of script.segments) {
      expect(content).toContain(row.visual);
      expect(content).toContain(row.bgm);
      expect(content).toContain(row.notes);
    }
    const grid = Array.from(parsed.getElementsByTagNameNS(ns, 'gridCol')).map(
      (node) => Number(node.getAttribute('w:w')),
    );
    const tableWidth = Number(
      parsed.getElementsByTagNameNS(ns, 'tblW')[0].getAttribute('w:w'),
    );
    expect(grid).toEqual([1000, 4200, 3826]);
    expect(grid.reduce((a, b) => a + b, 0)).toBe(tableWidth);
    expect(parsed.getElementsByTagNameNS(ns, 'tblHeader')).toHaveLength(1);
    expect(parsed.getElementsByTagNameNS(ns, 'tr')).toHaveLength(4);
    expect(parsed.getElementsByTagNameNS(ns, 'tc')).toHaveLength(12);
    const fonts = await zip.file('word/styles.xml')!.async('string');
    expect(fonts).toContain('w:eastAsia="Microsoft YaHei"');
    expect(xml).not.toContain('<不是标签>');
  });
});
