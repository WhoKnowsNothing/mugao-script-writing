import { File as NodeFile } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScriptEditor } from '@/components/script-editor';
import { LocalRepository } from '@/lib/storage';
import {
  duplicateScript,
  mergeWithNext,
  moveSegment,
  parseBackup,
  sampleWorkspace,
  splitSegment,
  validateWorkspace,
} from '@/lib/script';
import { exportBackup } from '@/lib/export-markdown';
import { imageDataUrl, validateSegmentImage } from '@/lib/segment-image';
import { buildMessages, makeAiInput } from '@/lib/ai/tasks';
import { defaultAiSettings } from '@/lib/ai/settings';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const src = `data:image/png;base64,${png}`;
const picture = () =>
  new NodeFile([Buffer.from(png, 'base64')], '配图.png', { type: 'image/png' });
const saved = () =>
  waitFor(() =>
    expect(document.querySelector('.save-status')?.textContent).toBe(
      '已保存到本机',
    ),
  );

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', undefined);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

it('keeps the image column hidden until upload, replaces a single image, restores on reload and supports undo/removal and segment deletion', async () => {
  let view = render(<ScriptEditor />);
  await saved();
  expect(document.querySelector('.has-images')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '添加第2段配图' }));
  fireEvent.change(screen.getByLabelText('选择段落配图'), {
    target: { files: [picture()] },
  });
  expect((await screen.findByAltText('第2段配图')).getAttribute('src')).toBe(
    src,
  );
  expect(screen.queryByAltText('第1段配图')).toBeNull();
  await saved();
  const repo = new LocalRepository();
  const state = (await repo.read())!.workspace;
  expect(parseBackup(exportBackup(state)).documents[0].segments[1].image).toBe(
    src,
  );
  await repo.close();
  view.unmount();
  view = render(<ScriptEditor />);
  await saved();
  expect(screen.getByAltText('第2段配图').getAttribute('src')).toBe(src);
  fireEvent.click(screen.getByRole('button', { name: '查看第2段配图' }));
  expect(screen.getByAltText('第2段配图预览').getAttribute('src')).toBe(src);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '替换第2段配图' }));
  fireEvent.change(screen.getByLabelText('选择段落配图'), {
    target: {
      files: [
        new NodeFile(
          [new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4])],
          '替换.jpg',
          { type: 'image/jpeg' },
        ),
      ],
    },
  });
  await waitFor(() =>
    expect(screen.getByAltText('第2段配图').getAttribute('src')).toMatch(
      /^data:image\/jpeg/,
    ),
  );
  expect(screen.getAllByAltText('第2段配图')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(screen.getByAltText('第2段配图').getAttribute('src')).toBe(src);
  fireEvent.click(screen.getByRole('button', { name: '移除第2段配图' }));
  expect(document.querySelector('.has-images')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(screen.getByAltText('第2段配图').getAttribute('src')).toBe(src);
  const narration = (screen.getByLabelText('第2段文案') as HTMLTextAreaElement)
    .value;
  fireEvent.click(screen.getByRole('button', { name: '删除第2段' }));
  expect(screen.getByRole('dialog', { name: '删除第 02 段？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByAltText('第2段配图').getAttribute('src')).toBe(src);
  fireEvent.click(screen.getByRole('button', { name: '删除第2段' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(screen.queryByAltText('第2段配图')).toBeNull();
  expect(screen.queryByLabelText('第3段文案')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(screen.getByAltText('第2段配图').getAttribute('src')).toBe(src);
  expect(
    (screen.getByLabelText('第2段文案') as HTMLTextAreaElement).value,
  ).toBe(narration);
  await saved();
  view.unmount();
});

it('rejects active content and invalid upload types before changing the manuscript', async () => {
  await expect(
    imageDataUrl(
      new NodeFile(['<svg onload="alert(1)"/>'], 'fake.png', {
        type: 'image/png',
      }),
    ),
  ).rejects.toThrow('只支持');
  for (const value of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'https://user:password@example.test/img.png',
    src.replace('image/png', 'image/jpeg'),
  ])
    expect(() => validateSegmentImage(value)).toThrow();
  expect(validateSegmentImage(src)).toBe(src);
  expect(validateSegmentImage('https://images.example.test/image.png')).toBe(
    'https://images.example.test/image.png',
  );
});

it('preserves images through backup, duplication, moving and splitting and prevents image loss on merge', () => {
  const workspace = sampleWorkspace();
  const doc = workspace.documents[0];
  doc.segments[1].image = src;
  expect(validateWorkspace(workspace).documents[0].segments[1].image).toBe(src);
  expect(duplicateScript(doc).segments[1].image).toBe(src);
  expect(moveSegment(doc, doc.segments[1].id, -1).segments[0].image).toBe(src);
  const split = splitSegment(doc, doc.segments[1].id, 5);
  expect(split.segments[1].image).toBe(src);
  expect(split.segments[2].image).toBeUndefined();
  expect(mergeWithNext(doc, doc.segments[0].id).segments[0].image).toBe(src);
  doc.segments[0].image = 'https://images.example.test/another.png';
  expect(() => mergeWithNext(doc, doc.segments[0].id)).toThrow('两段都有配图');
  expect(doc.segments).toHaveLength(3);
  const messages = buildMessages(
    'polish',
    makeAiInput(doc, 'all'),
    defaultAiSettings(),
    '',
  );
  expect(JSON.stringify(messages)).not.toContain('base64');
  expect(JSON.stringify(messages)).not.toContain('another.png');
});
