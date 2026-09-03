import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Packer } from 'docx';
import { buildWordDocument } from '../lib/export-docx.ts';
import { exportBackup, exportMarkdown } from '../lib/export-markdown.ts';
import { sampleWorkspace } from '../lib/script.ts';

const destination = process.argv[2];
if (!destination) throw new Error('Pass an explicit output directory.');
await mkdir(destination, { recursive: true });
const workspace = sampleWorkspace();
const doc = workspace.documents[0];
await writeFile(
  path.join(destination, '幕稿-示例脚本.md'),
  exportMarkdown(doc),
  'utf8',
);
await writeFile(
  path.join(destination, '幕稿-示例脚本-分段.md'),
  exportMarkdown(doc, 'sections'),
  'utf8',
);
await writeFile(
  path.join(destination, '幕稿-示例脚本.docx'),
  await Packer.toBuffer(buildWordDocument(doc)),
);
await writeFile(
  path.join(destination, '幕稿-示例备份.json'),
  exportBackup(workspace),
  'utf8',
);
process.stdout.write('Sample Markdown, DOCX and JSON exports written.\n');
