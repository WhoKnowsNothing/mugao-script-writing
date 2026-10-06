import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LineRuleType,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import {
  formatDuration,
  formatTimecode,
  scriptStats,
  segmentStats,
  type Script,
} from './script.ts';

const font = {
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  eastAsia: 'Microsoft YaHei',
  cs: 'Calibri',
};
const widths = [1000, 4200, 3826]; // A4 portrait: 11906 DXA - two 1440 DXA margins.
const cleanXML = (text: string) =>
  Array.from(text)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        code >= 0x10000
      );
    })
    .join('');

const paragraphs = (text: string, label?: string): Paragraph[] => [
  ...(label
    ? [
        new Paragraph({
          children: [
            new TextRun({ text: label, bold: true, color: '34674F', size: 19 }),
          ],
          spacing: { before: 100, after: 60 },
          keepNext: true,
        }),
      ]
    : []),
  ...cleanXML(text || '—')
    .split(/\r?\n/)
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, font, size: 21 })],
          spacing: {
            before: 0,
            after: 60,
            line: 330,
            lineRule: LineRuleType.EXACT,
          },
          widowControl: true,
        }),
    ),
];

function tableCell(
  children: Paragraph[],
  width: number,
  header = false,
): TableCell {
  return new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 150, right: 150 },
    verticalAlign: VerticalAlign.TOP,
    ...(header ? { shading: { fill: 'E8EFE5' } } : {}),
  });
}

export function buildWordDocument(script: Script): Document {
  const stats = scriptStats(script);
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D8E0D2' };
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: ['段落', '文案 / 口播', '画面与制作说明'].map((text, i) =>
      tableCell(
        [
          new Paragraph({
            children: [
              new TextRun({ text, bold: true, color: '34674F', size: 20 }),
            ],
          }),
        ],
        widths[i],
        true,
      ),
    ),
  });
  const rows = script.segments.map((row, i) => {
    const timing = segmentStats(row, script);
    const longestColumn = Math.max(
      row.narration.length,
      row.visual.length + row.bgm.length + row.notes.length,
    );
    return new TableRow({
      cantSplit: longestColumn < 700,
      children: [
        tableCell(
          [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(i + 1).padStart(2, '0'),
                  bold: true,
                  color: '34674F',
                  size: 25,
                }),
              ],
              spacing: { after: 90 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `${formatTimecode(timing.planned)}${timing.isManual ? ' 手动' : ''}`,
                  size: 18,
                  color: '7D8876',
                }),
              ],
              spacing: { before: 130, after: 80 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `${timing.characters} 字`,
                  size: 17,
                  color: '7D8876',
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `停顿 ${row.pauseSeconds} 秒`,
                  size: 17,
                  color: '7D8876',
                }),
              ],
            }),
          ],
          widths[0],
        ),
        tableCell(
          [
            new Paragraph({
              children: [
                new TextRun({
                  text: cleanXML(row.title || '未命名段落'),
                  bold: true,
                  color: '34674F',
                  size: 20,
                }),
              ],
              spacing: { after: 120, line: 300, lineRule: LineRuleType.EXACT },
              keepNext: true,
            }),
            ...paragraphs(row.narration),
          ],
          widths[1],
        ),
        tableCell(
          [
            ...paragraphs(row.visual, '画面'),
            ...paragraphs(row.bgm, 'BGM / 音效'),
            ...paragraphs(row.notes, '附注'),
          ],
          widths[2],
        ),
      ],
    });
  });
  return new Document({
    creator: '幕稿',
    title: cleanXML(script.title || '未命名脚本'),
    description: cleanXML(script.description),
    styles: {
      default: {
        document: {
          run: { font, size: 21, color: '2C3731' },
          paragraph: {
            spacing: {
              before: 0,
              after: 100,
              line: 330,
              lineRule: LineRuleType.EXACT,
            },
          },
        },
        title: {
          run: { font, size: 36, bold: true, color: '2C3731' },
          paragraph: {
            spacing: { after: 180, line: 520, lineRule: LineRuleType.EXACT },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: 1080,
              bottom: 1080,
              left: 1440,
              right: 1440,
              header: 480,
              footer: 480,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: '幕稿  ·  ', size: 17, color: '89967F' }),
                  new TextRun({
                    children: [
                      PageNumber.CURRENT,
                      ' / ',
                      PageNumber.TOTAL_PAGES,
                    ],
                    size: 17,
                    color: '89967F',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            text: cleanXML(script.title || '未命名脚本'),
            heading: HeadingLevel.TITLE,
          }),
          ...(script.description ? paragraphs(script.description) : []),
          new Paragraph({
            children: [
              new TextRun({
                text: `${script.segments.length} 个段落   ·   ${stats.characters} 字   ·   口播约 ${formatDuration(stats.spoken)}   ·   计划 ${formatDuration(stats.planned)}`,
                size: 19,
                color: '65765A',
              }),
            ],
            spacing: { before: 100, after: 130 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `中文 ${script.chineseCpm} 字/分钟，英文 ${script.englishWpm} 词/分钟。字数不含标点与空白，数字逐位计；计划时长含停顿或手动时长。`,
                size: 17,
                color: '89967F',
              }),
            ],
            spacing: { after: 240 },
          }),
          new Table({
            width: {
              size: widths.reduce((a, b) => a + b, 0),
              type: WidthType.DXA,
            },
            indent: { size: 150, type: WidthType.DXA },
            columnWidths: widths,
            layout: TableLayoutType.FIXED,
            borders: {
              top: border,
              bottom: border,
              left: border,
              right: border,
              insideHorizontal: border,
              insideVertical: border,
            },
            rows: [header, ...rows],
          }),
        ],
      },
    ],
  });
}

export async function exportWordBlob(script: Script): Promise<Blob> {
  return Packer.toBlob(buildWordDocument(script));
}
