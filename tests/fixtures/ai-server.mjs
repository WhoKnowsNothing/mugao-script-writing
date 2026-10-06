// Local-only HTTP fixture for browser acceptance; it never calls a model service.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const png = process.env.MUGAO_TEST_IMAGE_PATH
  ? readFileSync(process.env.MUGAO_TEST_IMAGE_PATH).toString('base64')
  : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
    res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1000000) {
      res.writeHead(413);
      res.end('{}');
      return;
    }
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end('{}');
    return;
  }
  if (body.model === 'http-401' || body.model === 'http-402') {
    res.writeHead(Number(body.model.slice(-3)));
    res.end('{}');
    return;
  }
  const send = (value) => res.end(JSON.stringify(value));
  if (body.model === 'slow')
    await new Promise((resolve) => setTimeout(resolve, 15000));
  if (req.url === '/v1/images/generations') {
    send({ data: [{ b64_json: png }] });
    return;
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  let content = 'OK';
  try {
    const payload = JSON.parse(body.messages[1].content);
    if (body.response_format?.type !== 'json_object') {
      // Reproduce providers that answer in prose unless JSON mode is enabled.
      send({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '建议使用近景，主体偏左。' },
          },
        ],
      });
      return;
    }
    const rows = payload.script.segments;
    if (payload.task === 'visual')
      content = JSON.stringify({
        visual:
          '近景俯拍桌面，纸张位于画面左下方。主体偏左，右侧留出字幕空间；使用暖白自然光。可配手写草稿与翻页细节图。',
        notes: '先拍环境全景，再切入笔尖特写，转场保持光线和构图一致。',
      });
    if (payload.task === 'polish')
      content = JSON.stringify({
        segments: rows.map((row) => ({
          id: row.id,
          narration: row.narration
            ? row.narration
                .replace('其实，', '')
                .replace('一个很好的想法', '一个好想法')
            : '',
        })),
      });
    if (payload.task === 'review')
      content = JSON.stringify({
        summary:
          '这是本地测试报告，演示风险定位与依据显示。实际发布前需核对完整规则和素材。',
        issues:
          rows[0].visual && payload.rules.length
            ? [
                {
                  platform: payload.rules[0].id,
                  severity: 'low',
                  segmentId: rows[0].id,
                  field: 'visual',
                  quote: rows[0].visual.slice(0, 12),
                  reason: '脚本无法确认配图的素材授权情况，需人工核验。',
                  suggestion: '使用自摄、原创或已获得许可的素材。',
                  basis: 'general',
                },
              ]
            : [],
      });
  } catch {
    /* Connection test. */
  }
  send({ choices: [{ finish_reason: 'stop', message: { content } }] });
});
server.listen(4191, '127.0.0.1', () =>
  process.stdout.write(
    'AI test fixture: http://127.0.0.1:4191/v1 (no external calls)\n',
  ),
);
