# 项目目录导览

应用源码集中在 `src/`。根目录保留启动入口、依赖清单和工具配置。

| 位置 | 用途 |
| --- | --- |
| `src/app/` | 网页入口、页面布局和编辑器样式。 |
| `src/components/` | 脚本编辑器、AI 设置、配图与显示设置等界面。 |
| `src/components/ui/` | 按钮、弹窗、菜单等基础组件。 |
| `src/hooks/` | 工作区状态、自动保存、段落拖动。 |
| `src/lib/` | 脚本数据、历史版本、本地存储、图片和导出逻辑。 |
| `src/lib/ai/` | API 设置、服务请求、任务输入与结果校验、平台规则。 |
| `src/static/` | `/mugao/` 静态网页版本的入口。 |
| `public/` | 随网页发布的图标和分享图片。 |
| `tests/` | 自动化测试与测试夹具，供本地和 GitHub CI 使用。 |
| `scripts/` | 示例稿件导出和静态发布包打包工具。 |
| `docs/` | 目录说明、静态包用法和版本说明。 |
| `design/` | 本机保存的界面截图、宣传图和可编辑设计素材。 |
| `releases/` | 本机生成的版本发布包与校验文件。 |
| `archive/` | 本机历史快照、旧发布包和旧环境记录。 |

## 从哪里开始阅读

1. 页面入口是 `src/app/page.tsx`，主编辑器是 `src/components/script-editor.tsx`。
2. 稿件的结构和操作规则在 `src/lib/script.ts`。自动保存从 `src/hooks/use-workspace.ts` 进入 `src/lib/storage.ts`。
3. AI 界面在 `src/components/ai-assistant.tsx` 和 `ai-settings.tsx`，服务连接和保存逻辑在 `src/lib/ai/`。
4. Word、Markdown、JSON 导出从 `src/lib/export-docx.ts` 和 `export-markdown.ts` 阅读。

`@/` 指向 `src/`。`vite.config.ts` 用于应用构建，`vite.static.config.ts` 用于静态网页包，`vitest.config.ts` 用于测试。

## 新文件放哪里

- 界面或业务改动放到相应的 `src/` 子目录。
- 功能的自动化测试放到 `tests/`。
- 宣传素材和截图放到 `design/`；版本发布物放到 `releases/版本号/`。
- 一次性验证文件放到忽略提交的 `work/`，完成后清理。

`node_modules/` 是已安装依赖。`.next/`、`.vinext/`、`.cache/`、`dist/`、`out/` 等由工具生成；`out/mugao/` 是静态构建输出。`.wrangler/` 可能包含本地数据库状态，清理前应先保留需要的数据。

`archive/`、设计工作文件、发布包和 `.qmuse/` 属于本机资料，默认忽略提交。GitHub Release 的静态网页包仅包含可部署网页、使用说明和许可证。
