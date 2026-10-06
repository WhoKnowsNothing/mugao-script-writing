'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  AlignLeft,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  FileJson,
  FilePlus2,
  FileText,
  Film,
  History,
  GripVertical,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  MoveVertical,
  Music2,
  PanelLeftClose,
  Plus,
  Redo2,
  Scissors,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  X,
  Combine,
  TriangleAlert,
  Sparkles,
  ImagePlus,
  Settings2,
  Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AutoTextarea, NumberField } from '@/components/editor-fields';
import { useWorkspace } from '@/hooks/use-workspace';
import { usePointerReorder } from '@/hooks/use-pointer-reorder';
import {
  activeScript,
  countText,
  createScript,
  createSegment,
  duplicateScript,
  formatDuration,
  formatTimecode,
  importAsCopies,
  LIMITS,
  mergeWithNext,
  moveSegment,
  moveSegmentBefore,
  newId,
  parseBackup,
  replaceScript,
  scriptStats,
  segmentStats,
  splitSegment,
  type Script,
  type Segment,
} from '@/lib/script';
import {
  downloadBlob,
  exportBackup,
  exportMarkdown,
  exportScriptJson,
  safeFilename,
  type MarkdownLayout,
} from '@/lib/export-markdown';
import type { Snapshot } from '@/lib/storage';
import { AiAssistant, type AiLaunch } from '@/components/ai-assistant';
import { applyAiResult, inputStillMatches } from '@/lib/ai/tasks';
import { DisplaySettings } from '@/components/display-settings';
import { SegmentImage } from '@/components/segment-image';
import {
  IMAGE_ACCEPT,
  imageDataUrl,
  validateSegmentImage,
} from '@/lib/segment-image';

const statusLabels = {
  loading: '正在读取本机脚本',
  dirty: '等待保存…',
  saving: '保存中…',
  saved: '已保存到本机',
  error: '保存已暂停',
  conflict: '检测到其他版本',
};
type Confirmation = {
  title: string;
  description: string;
  action: () => void;
  label?: string;
};

export function ScriptEditor({ homeHref }: { homeHref?: string } = {}) {
  const editor = useWorkspace();
  const { workspace, ready, commit, undo, redo, save } = editor;
  const script = activeScript(workspace);
  const hasImages = script.segments.some((row) => row.image);
  const stats = useMemo(() => scriptStats(script), [script]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedDirections, setCollapsedDirections] = useState<Set<string>>(
    () => new Set(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [aiLaunch, setAiLaunch] = useState<AiLaunch | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotError, setSnapshotError] = useState('');
  const [timingId, setTimingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState(1);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [markdownLayout, setMarkdownLayout] = useState<MarkdownLayout>('table');
  const [importText, setImportText] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<{
    scriptId: string;
    segmentId: string;
    previous?: string;
  } | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const selection = useRef<{ id: string; offset: number } | null>(null);
  const composing = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const dragSourceId = useRef<string | null>(null);
  const scriptRef = useRef(script);
  useLayoutEffect(() => {
    scriptRef.current = script;
  }, [script]);

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);

  const changeDocument = useCallback(
    (change: (doc: Script) => Script, group: string | null = null) => {
      commit((previous) => {
        const doc = activeScript(previous);
        const next = change(doc);
        return next === doc ? previous : replaceScript(previous, next);
      }, group);
    },
    [commit],
  );
  const patchSegment = useCallback(
    (id: string, field: keyof Segment, value: string | number | null) => {
      changeDocument(
        (doc) => ({
          ...doc,
          segments: doc.segments.map((row) =>
            row.id === id ? { ...row, [field]: value } : row,
          ),
        }),
        `${id}:${field}`,
      );
    },
    [changeDocument],
  );

  const setSegmentImage = (
    scriptId: string,
    segmentId: string,
    src: string | undefined,
    previous?: string,
  ) => {
    const image = validateSegmentImage(src);
    commit((current) => {
      const doc = current.documents.find((item) => item.id === scriptId);
      const row = doc?.segments.find((item) => item.id === segmentId);
      if (!doc || !row) throw new Error('目标段落已删除，配图未添加。');
      if (row.image !== previous)
        throw new Error('这段配图已发生变化，未覆盖新图片。请重新添加。');
      const next = replaceScript(current, {
        ...doc,
        segments: doc.segments.map((item) =>
          item.id === segmentId ? { ...item, image } : item,
        ),
      });
      if (
        image &&
        new TextEncoder().encode(exportBackup(next)).byteLength >
          LIMITS.fileBytes
      )
        throw new Error(
          '配图加入后备份将超过 128 MB，请缩小图片或整理现有稿件。',
        );
      return next;
    });
  };

  const chooseImage = (row: Segment) => {
    imageTarget.current = {
      scriptId: script.id,
      segmentId: row.id,
      previous: row.image,
    };
    imageInput.current?.click();
  };

  const uploadImage = async (file: File | undefined) => {
    const target = imageTarget.current;
    if (!file || !target) return;
    try {
      const src = await imageDataUrl(file);
      setSegmentImage(target.scriptId, target.segmentId, src, target.previous);
      notify('配图已添加，可撤销。');
    } catch (cause) {
      notify((cause as Error).message);
    }
  };

  const addSegment = useCallback(
    (referenceId?: string, placement: 'before' | 'after' = 'after') => {
      if (scriptRef.current.segments.length >= LIMITS.segments) {
        notify('每份脚本最多 500 个段落。');
        return;
      }
      const row = createSegment();
      pendingFocus.current = row.id;
      changeDocument((doc) => {
        const rows = [...doc.segments];
        const referenceIndex = referenceId
          ? rows.findIndex((item) => item.id === referenceId)
          : -1;
        const index =
          referenceIndex < 0
            ? rows.length
            : referenceIndex + Number(placement === 'after');
        rows.splice(index, 0, row);
        return { ...doc, segments: rows };
      });
    },
    [changeDocument, notify],
  );

  const moveBefore = useCallback(
    (id: string, targetId: string | null) => {
      const current = scriptRef.current;
      const moving = current.segments.find((row) => row.id === id);
      const next = moveSegmentBefore(current, id, targetId);
      if (!moving || next === current) {
        notify('这一段已经在目标位置。');
        return false;
      }
      const position = next.segments.findIndex((row) => row.id === id) + 1;
      changeDocument(() => next);
      notify(`已将“${moving.title || '未命名段落'}”移动至第 ${position} 段。`);
      return true;
    },
    [changeDocument, notify],
  );

  const pointerReorder = usePointerReorder(script.id, moveBefore);
  const dropPosition = (id: string, list: string) =>
    pointerReorder.drag?.list === list &&
    pointerReorder.drag.target?.markerId === id
      ? pointerReorder.drag.target.edge
      : undefined;

  const startSegmentDrag = useCallback(
    (event: ReactDragEvent<HTMLElement>, id: string) => {
      if (event.defaultPrevented) return;
      dragSourceId.current = id;
      setDraggingId(id);
      setDropTargetId(null);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    },
    [],
  );

  const dragOverSegment = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetId: string) => {
      if (!dragSourceId.current || dragSourceId.current === targetId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetId((current) => (current === targetId ? current : targetId));
    },
    [],
  );

  const finishSegmentDrag = useCallback(() => {
    dragSourceId.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  }, []);

  const dropSegment = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetId: string) => {
      event.preventDefault();
      const sourceId =
        event.dataTransfer.getData('text/plain') || dragSourceId.current;
      if (sourceId && sourceId !== targetId) moveBefore(sourceId, targetId);
      finishSegmentDrag();
    },
    [finishSegmentDrag, moveBefore],
  );

  const split = useCallback(
    (id: string, offset?: number) => {
      const current = scriptRef.current;
      const row = current.segments.find((item) => item.id === id);
      const position =
        offset ??
        (selection.current?.id === id ? selection.current.offset : -1);
      if (row && position === row.narration.length) {
        addSegment(id);
        return;
      }
      const next = splitSegment(current, id, position);
      if (next === current) {
        notify(
          current.segments.length >= LIMITS.segments
            ? '每份脚本最多 500 个段落。'
            : '先把光标放到文案中需要分段的位置。',
        );
        return;
      }
      const index = next.segments.findIndex((item) => item.id === id);
      pendingFocus.current = next.segments[index + 1].id;
      changeDocument(() => next);
      notify('已在光标处分段，制作说明保留在前一段。');
    },
    [addSegment, changeDocument, notify],
  );

  useEffect(() => {
    if (!pendingFocus.current) return;
    // IDs come from our own row model, not document text.
    const element = document.getElementById(
      `narration-${pendingFocus.current}`,
    ) as HTMLTextAreaElement | null;
    if (element) {
      element.focus();
      element.setSelectionRange(0, 0);
      pendingFocus.current = null;
    }
  }, [script.segments]);

  const addDocument = (doc = createScript()) => {
    if (workspace.documents.length >= LIMITS.documents) {
      notify('最多保存 100 份脚本。请先导出并整理现有脚本。');
      return;
    }
    commit((previous) => ({
      ...previous,
      activeId: doc.id,
      documents: [doc, ...previous.documents],
    }));
    setMobileOpen(false);
  };

  const backup = useCallback(() => {
    downloadBlob(
      new Blob([exportBackup(workspace)], {
        type: 'application/json;charset=utf-8',
      }),
      `幕稿备份-${new Date().toISOString().slice(0, 10)}.json`,
    );
    notify('备份已发起下载，包含本机全部脚本。');
  }, [workspace, notify]);

  const downloadScriptJson = () => {
    const exporting = scriptRef.current;
    downloadBlob(
      new Blob([exportScriptJson(exporting)], {
        type: 'application/json;charset=utf-8',
      }),
      `${safeFilename(exporting.title)}.json`,
    );
    notify('当前脚本 JSON 已发起下载，可通过导入备份恢复。');
  };

  const downloadMarkdown = useCallback(
    (layout: MarkdownLayout = 'table') => {
      downloadBlob(
        new Blob([exportMarkdown(scriptRef.current, layout)], {
          type: 'text/markdown;charset=utf-8',
        }),
        `${safeFilename(scriptRef.current.title)}${layout === 'sections' ? '-分段' : ''}.md`,
      );
      notify('Markdown 已发起下载。');
    },
    [notify],
  );

  const downloadWord = async () => {
    setBusy(true);
    const exporting = scriptRef.current;
    try {
      const { exportWordBlob } = await import('@/lib/export-docx');
      const blob = await exportWordBlob(exporting);
      downloadBlob(blob, `${safeFilename(exporting.title)}.docx`);
      notify('Word 文件已发起下载。');
    } catch {
      notify('Word 导出失败，文案仍保留。请重试或先导出 Markdown。');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        composing.current ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey
      )
        return;
      if (event.code === 'KeyS') {
        event.preventDefault();
        void save().then((ok) => {
          if (ok) notify('已保存到本机。');
        });
        return;
      }
      if ((event.target as HTMLElement)?.closest('[role="dialog"]')) return;
      if (event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.code === 'KeyY') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [undo, redo, save, notify]);

  const showHistory = async () => {
    setHistoryOpen(true);
    setSnapshotError('');
    try {
      setSnapshots(await editor.repository.snapshots());
    } catch {
      setSnapshotError('无法读取本机历史记录。请先导出当前脚本。');
    }
  };

  const importBackupFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError('');
    try {
      if (file.size > LIMITS.fileBytes)
        throw new Error('备份文件不能超过 128 MB。');
      const imported = parseBackup(await file.text());
      if (
        workspace.documents.length + imported.documents.length >
        LIMITS.documents
      )
        throw new Error('导入后将超过 100 份脚本，请先整理已有脚本。');
      commit((previous) => importAsCopies(previous, imported));
      setImportOpen(false);
      setMobileOpen(false);
      notify(
        `已恢复 ${imported.documents.length} 份脚本，原有脚本没有被覆盖。`,
      );
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : '读取文件失败。');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const importManuscript = () => {
    const paragraphs = importText
      .trim()
      .split(/\n\s*\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!paragraphs.length) {
      setImportError('请先粘贴文案。');
      return;
    }
    if (paragraphs.length > LIMITS.segments) {
      setImportError('空行分段后超过 500 段，请分批导入。');
      return;
    }
    if (paragraphs.some((text) => text.length > LIMITS.text)) {
      setImportError('单段文字太长，请增加空行分段。');
      return;
    }
    if (workspace.documents.length >= LIMITS.documents) {
      setImportError('最多保存 100 份脚本，请先整理现有脚本。');
      return;
    }
    const doc = createScript(importTitle.trim() || '导入的文案');
    doc.segments = paragraphs.map((text, i) => ({
      ...createSegment(`段落 ${i + 1}`),
      narration: text,
    }));
    addDocument(doc);
    setImportText('');
    setImportTitle('');
    setImportOpen(false);
    setImportError('');
    notify(`已创建脚本，按空行拆成 ${paragraphs.length} 段。`);
  };

  const removeSegment = (id: string, index: number) =>
    setConfirmation({
      title: `删除第 ${String(index + 1).padStart(2, '0')} 段？`,
      description:
        '这一段的文案、画面、BGM、附注和配图会一起删除。之后仍可通过撤销恢复。',
      action: () =>
        changeDocument((doc) => {
          const rows = doc.segments.filter((row) => row.id !== id);
          return {
            ...doc,
            segments: rows.length ? rows : [createSegment('开场')],
          };
        }),
    });
  const removeDocument = (target: Script) => {
    const id = target.id;
    setMobileOpen(false);
    setConfirmation({
      title: '删除这份脚本？',
      description: `“${target.title || '未命名脚本'}”将从本机脚本列表移除。本次操作可以撤销。`,
      action: () =>
        commit((previous) => {
          const docs = previous.documents.filter((doc) => doc.id !== id);
          if (docs.length === previous.documents.length) return previous;
          if (!docs.length) docs.push(createScript());
          return {
            ...previous,
            documents: docs,
            activeId: previous.activeId === id ? docs[0].id : previous.activeId,
          };
        }),
    });
  };
  const loadOtherVersion = () =>
    setConfirmation({
      title: '载入本机最新保存的版本？',
      label: '载入最新版本',
      description:
        '这会替换此页尚未保存的修改和撤销历史。请先用“下载备份”保留此页的稿件。',
      action: () => {
        void editor.loadLatest();
      },
    });

  const sidebar = (
    <>
      <div className="brand">
        <span className="brand-mark">
          <Clapperboard size={20} />
        </span>
        <span>
          幕稿{' '}
          <small>
            MUGAO<span className="brand-beta">Beta</span>
          </small>
        </span>
      </div>
      {homeHref && (
        <a className="home-link" href={homeHref}>
          <ArrowLeft size={14} aria-hidden="true" />
          返回勿知鸦
        </a>
      )}
      <Button
        variant="outline"
        className="new-document"
        disabled={!ready}
        onClick={() => addDocument()}
      >
        <Plus size={16} />
        新建脚本
      </Button>
      <div className="sidebar-label">
        我的脚本 <span>{workspace.documents.length}</span>
      </div>
      <nav className="document-list" aria-label="脚本列表">
        {workspace.documents.map((doc) => (
          <div className="document-list-item" key={doc.id}>
            <button
              type="button"
              className={`document-link ${doc.id === script.id ? 'active' : ''}`}
              aria-current={doc.id === script.id ? 'page' : undefined}
              disabled={!ready}
              title={doc.title || '未命名脚本'}
              onClick={() => {
                if (doc.id !== script.id)
                  commit((previous) => ({ ...previous, activeId: doc.id }));
                setMobileOpen(false);
              }}
            >
              <FileText size={16} />
              <span>{doc.title || '未命名脚本'}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="document-list-menu"
                    disabled={!ready}
                    aria-label={`管理脚本：${doc.title || '未命名脚本'}`}
                  />
                }
              >
                <MoreHorizontal size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => removeDocument(doc)}
                >
                  <Trash2 />
                  删除脚本
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </nav>
      <div className="sidebar-label outline-label">
        段落大纲 <span>{script.segments.length}</span>
      </div>
      <nav
        className="segment-outline"
        aria-label="段落大纲"
        data-reorder-list="outline"
        data-reorder-scroll
      >
        {script.segments.map((row, i) => (
          <div
            key={row.id}
            className={`outline-item${(draggingId ?? pointerReorder.drag?.id) === row.id ? ' is-dragging' : ''}${dropTargetId === row.id ? ' is-drop-target' : ''}`}
            data-reorder-id={row.id}
            data-pointer-dragging={
              pointerReorder.drag?.id === row.id || undefined
            }
            data-drop-position={dropPosition(row.id, 'outline')}
            onDragOver={(event) => dragOverSegment(event, row.id)}
            onDrop={(event) => dropSegment(event, row.id)}
          >
            <button
              type="button"
              className="outline-drag-handle"
              draggable
              disabled={!ready}
              aria-label={`拖动大纲第${i + 1}段排序`}
              title="拖动排序；触屏长按半秒后拖动"
              onPointerDown={(event) => pointerReorder.start(event, row.id)}
              onDragStart={(event) => startSegmentDrag(event, row.id)}
              onDragEnd={finishSegmentDrag}
            >
              <GripVertical size={14} />
            </button>
            <a href={`#segment-${row.id}`} onClick={() => setMobileOpen(false)}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <span>{row.title || `段落 ${i + 1}`}</span>
            </a>
          </div>
        ))}
      </nav>
      <div className="sidebar-utilities">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setMobileOpen(false);
            setDisplayOpen(true);
          }}
        >
          <Type size={14} />
          显示设置
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!ready}
          onClick={() => {
            setMobileOpen(false);
            setAiLaunch({ task: 'settings', scope: 'all' });
          }}
        >
          <Settings2 size={14} />
          AI 设置
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!ready}
          onClick={() => {
            setMobileOpen(false);
            setImportError('');
            setImportOpen(true);
          }}
        >
          <Upload size={14} />
          导入文案 / 备份
        </Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={backup}>
          <FileJson size={14} />
          备份全部脚本
        </Button>
      </div>
      <div className="sidebar-bottom">
        <LockKeyhole size={15} />
        <div>
          你的创作，本机保存<small>AI 仅在主动调用时发送内容</small>
        </div>
        <button
          type="button"
          aria-label="使用说明"
          title="使用说明与隐私"
          onClick={() => {
            setMobileOpen(false);
            setHelpOpen(true);
          }}
        >
          <CircleHelp size={15} />
        </button>
      </div>
    </>
  );
  const timingRow = script.segments.find((row) => row.id === timingId);
  const movingRow = script.segments.find((row) => row.id === movingId);
  const movingIndex = script.segments.findIndex((row) => row.id === movingId);
  const moveTargetRow = script.segments[moveTarget - 1];
  const canMove =
    !!movingRow &&
    !!moveTargetRow &&
    movingIndex !== moveTarget - 1 &&
    movingIndex + 1 !== moveTarget - 1;
  const markdown = useMemo(
    () => (previewOpen ? exportMarkdown(script, markdownLayout) : ''),
    [previewOpen, script, markdownLayout],
  );
  const timeline = useMemo(() => {
    const offsets = [0];
    for (const row of script.segments)
      offsets.push(
        offsets[offsets.length - 1] + segmentStats(row, script).planned,
      );
    return offsets;
  }, [script]);

  return (
    <div
      className="studio-shell"
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
    >
      <aside className="studio-sidebar">{sidebar}</aside>
      <main className="studio-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              variant="ghost"
              size="icon-sm"
              className="mobile-menu"
              aria-label="打开脚本列表"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={18} />
            </Button>
            <PanelLeftClose className="desktop-sidebar-icon" size={17} />
            <span>我的脚本</span>
            <ChevronRight className="breadcrumb-divider" size={13} />
            <strong>
              <span className="desktop-label">脚本编辑器</span>
              <span className="mobile-label">幕稿</span>
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={`save-status status-${editor.status}`}
              title={
                editor.savedAt
                  ? `上次保存：${new Date(editor.savedAt).toLocaleTimeString('zh-CN')}`
                  : statusLabels[editor.status]
              }
              onClick={() => {
                void save();
              }}
              aria-live="polite"
            >
              {editor.status === 'saving' || editor.status === 'loading' ? (
                <LoaderCircle size={12} className="spin" />
              ) : editor.status === 'error' || editor.status === 'conflict' ? (
                <TriangleAlert size={12} />
              ) : (
                <i />
              )}
              {statusLabels[editor.status]}
            </button>
            <div className="export-buttons">
              <Button
                disabled={!ready || busy}
                className="export-primary"
                aria-label="导出 Word"
                onClick={() => {
                  void downloadWord();
                }}
              >
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ArrowDownToLine size={15} />
                )}
                导出 Word
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      disabled={!ready || busy}
                      className="export-arrow"
                      aria-label="更多导出格式"
                    />
                  }
                >
                  <ChevronDown size={14} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="export-menu">
                  <DropdownMenuItem onClick={() => downloadMarkdown()}>
                    <FileText />
                    Markdown 双栏表格 <span className="menu-note">.md</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => downloadMarkdown('sections')}
                  >
                    <AlignLeft />
                    Markdown 分段正文
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPreviewOpen(true)}>
                    <BookOpen />
                    预览 / 复制 Markdown
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={downloadScriptJson}>
                    <FileJson />
                    导出当前脚本 JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={backup}>
                    <FileJson />
                    JSON 备份全部脚本
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <div
          className={`workspace${hasImages ? ' workspace-with-images' : ''}`}
        >
          {editor.error && (
            <div className="storage-alert" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>请先保留你的修改</strong>
                <p>{editor.error}</p>
                <div className="alert-actions">
                  <Button size="sm" variant="outline" onClick={backup}>
                    下载当前备份
                  </Button>
                  {editor.status === 'error' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void editor.retrySave();
                      }}
                    >
                      重试保存
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={loadOtherVersion}>
                    载入最新版本
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void editor.repository
                        .raw()
                        .then((raw) => {
                          downloadBlob(
                            new Blob([JSON.stringify(raw, null, 2) ?? 'null'], {
                              type: 'application/json',
                            }),
                            '幕稿-原始本机记录.json',
                          );
                        })
                        .catch(() =>
                          notify('无法读取原始记录，请先导出此页文案。'),
                        );
                    }}
                  >
                    下载原始记录
                  </Button>
                </div>
              </div>
            </div>
          )}
          <fieldset className="editor-fieldset" disabled={!ready}>
            <section className="document-heading">
              <div className="eyebrow">
                <span />
                视频脚本{' '}
                {script.id === 'welcome-script' &&
                  script.title === '把一个想法，拍成视频' && (
                    <span className="demo-label">可编辑示例</span>
                  )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="管理当前脚本"
                        className="document-menu-button"
                      />
                    }
                  >
                    <MoreHorizontal size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        titleInput.current?.focus();
                        titleInput.current?.select();
                      }}
                    >
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => addDocument(duplicateScript(script))}
                    >
                      <Copy />
                      复制脚本
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        void showHistory();
                      }}
                    >
                      <History />
                      本机历史记录
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => removeDocument(script)}
                    >
                      <Trash2 />
                      删除脚本
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Input
                ref={titleInput}
                className="document-title"
                aria-label="脚本标题"
                maxLength={200}
                placeholder="给脚本起个名字"
                value={script.title}
                onChange={(event) =>
                  changeDocument(
                    (doc) => ({ ...doc, title: event.target.value }),
                    `${script.id}:title`,
                  )
                }
              />
              <AutoTextarea
                className="document-description"
                aria-label="脚本简介"
                maxLength={2000}
                placeholder="添加主题、受众，或这条视频的小目标……"
                value={script.description}
                onChange={(event) =>
                  changeDocument(
                    (doc) => ({ ...doc, description: event.target.value }),
                    `${script.id}:description`,
                  )
                }
              />
              <div className="document-stats">
                <span title="所有文案中的文字和数字，不含标点、空白与制作说明">
                  <AlignLeft size={15} />
                  <b data-testid="total-characters">{stats.characters}</b> 字
                </span>
                <span title="仅文案的预计朗读时长，不含停顿">
                  <Clock3 size={15} />
                  口播约 <b>{formatDuration(stats.spoken)}</b>
                </span>
                <span title="每段手动时长或估算时长的合计，包含设置的停顿">
                  <Film size={15} />
                  计划 <b>{formatDuration(stats.planned)}</b>
                </span>
                <button
                  className="pace-button"
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <SlidersHorizontal size={14} />
                  {script.chineseCpm} 字 / 分钟
                </button>
              </div>
            </section>
            <div className="editor-toolbar">
              <span className="view-label">
                <AlignLeft size={16} />
                <span className="desktop-label">
                  {hasImages ? '音画脚本' : '双栏脚本'}
                </span>
                <span className="mobile-label">
                  {script.segments.length} 个段落
                </span>
              </span>
              <div className="history-buttons">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!editor.canUndo}
                  aria-label="撤销"
                  title="撤销 Ctrl+Z"
                  onClick={undo}
                >
                  <Undo2 size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!editor.canRedo}
                  aria-label="重做"
                  title="重做 Ctrl+Shift+Z"
                  onClick={redo}
                >
                  <Redo2 size={15} />
                </Button>
              </div>
              <span className="toolbar-hint">
                {script.segments.length} 个段落
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAiLaunch({ task: 'polish', scope: 'all' })}
              >
                <Sparkles size={15} />
                AI 助手
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={script.segments.length >= LIMITS.segments}
                onClick={() => addSegment()}
              >
                <Plus size={15} />
                新增段落
              </Button>
            </div>
            <input
              ref={imageInput}
              type="file"
              hidden
              accept={IMAGE_ACCEPT}
              aria-label="选择段落配图"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void uploadImage(file);
              }}
            />
            <div
              className={`script-sheet${hasImages ? ' has-images' : ''}`}
              data-reorder-list="body"
            >
              <div className="sheet-header">
                <span>#</span>
                <span>文案 / 口播</span>
                <span>画面与制作说明</span>
                {hasImages && <span>配图</span>}
              </div>
              {script.segments.map((row, index) => {
                const timing = segmentStats(row, script);
                const start = timeline[index];
                const elapsed = timeline[index + 1];
                return (
                  <div
                    className={`script-segment${(draggingId ?? pointerReorder.drag?.id) === row.id ? ' is-dragging' : ''}${dropTargetId === row.id ? ' is-drop-target' : ''}`}
                    id={`segment-${row.id}`}
                    data-reorder-id={row.id}
                    data-pointer-dragging={
                      pointerReorder.drag?.id === row.id || undefined
                    }
                    data-drop-position={dropPosition(row.id, 'body')}
                    key={row.id}
                    aria-label={`第${index + 1}段`}
                    onDragOver={(event) => dragOverSegment(event, row.id)}
                    onDrop={(event) => dropSegment(event, row.id)}
                  >
                    <div className="segment-number">
                      <button
                        type="button"
                        className="segment-drag-handle"
                        draggable
                        aria-label={`拖动正文第${index + 1}段排序`}
                        title="拖动排序；触屏长按半秒后拖动"
                        onPointerDown={(event) =>
                          pointerReorder.start(event, row.id)
                        }
                        onDragStart={(event) => startSegmentDrag(event, row.id)}
                        onDragEnd={finishSegmentDrag}
                      >
                        <GripVertical size={13} />
                        <span>{String(index + 1).padStart(2, '0')}</span>
                      </button>
                    </div>
                    <div className="narration-cell">
                      <div className="segment-heading">
                        <button
                          type="button"
                          className="mobile-segment-handle"
                          aria-label={`拖动手机第${index + 1}段排序`}
                          title="长按半秒后拖动整段排序"
                          onPointerDown={(event) =>
                            pointerReorder.start(event, row.id)
                          }
                        >
                          <GripVertical size={15} />
                          <span>{String(index + 1).padStart(2, '0')}</span>
                        </button>
                        <Input
                          aria-label={`第${index + 1}段标题`}
                          className="segment-title"
                          placeholder={`段落 ${index + 1}`}
                          maxLength={200}
                          value={row.title}
                          onChange={(event) =>
                            patchSegment(row.id, 'title', event.target.value)
                          }
                        />
                        <div className="segment-row-actions">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="segment-insert-button"
                            disabled={script.segments.length >= LIMITS.segments}
                            aria-label={`在第${index + 1}段上方插入段落`}
                            title="在上方插入段落"
                            onClick={() => addSegment(row.id, 'before')}
                          >
                            <BetweenVerticalStart size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="segment-insert-button"
                            disabled={script.segments.length >= LIMITS.segments}
                            aria-label={`在第${index + 1}段下方插入段落`}
                            title="在下方插入段落"
                            onClick={() => addSegment(row.id, 'after')}
                          >
                            <BetweenVerticalEnd size={16} />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`第${index + 1}段操作`}
                                />
                              }
                            >
                              <MoreHorizontal size={16} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="segment-menu"
                            >
                              <DropdownMenuItem
                                disabled={
                                  script.segments.length >= LIMITS.segments
                                }
                                onClick={() => addSegment(row.id, 'before')}
                              >
                                <BetweenVerticalStart />
                                在上方新增
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={
                                  script.segments.length >= LIMITS.segments
                                }
                                onClick={() => addSegment(row.id)}
                              >
                                <Plus />
                                在下方新增
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => split(row.id)}>
                                <Scissors />
                                在光标处分段{' '}
                                <span className="menu-note desktop-label">
                                  Ctrl+Enter
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === script.segments.length - 1}
                                onClick={() => {
                                  try {
                                    changeDocument((doc) =>
                                      mergeWithNext(doc, row.id),
                                    );
                                    notify('已合并，两段制作说明均已保留。');
                                  } catch (cause) {
                                    notify((cause as Error).message);
                                  }
                                }}
                              >
                                <Combine />
                                与下一段合并
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={
                                  script.segments.length >= LIMITS.segments
                                }
                                onClick={() =>
                                  changeDocument((doc) => {
                                    const rows = [...doc.segments];
                                    const position = rows.findIndex(
                                      (item) => item.id === row.id,
                                    );
                                    rows.splice(position + 1, 0, {
                                      ...rows[position],
                                      id: newId(),
                                    });
                                    return { ...doc, segments: rows };
                                  })
                                }
                              >
                                <Copy />
                                复制这一段
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  setMovingId(row.id);
                                  setMoveTarget(index + 1);
                                }}
                              >
                                <MoveVertical />
                                移动至…
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === 0}
                                onClick={() =>
                                  changeDocument((doc) =>
                                    moveSegment(doc, row.id, -1),
                                  )
                                }
                              >
                                <ArrowUp />
                                上移
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === script.segments.length - 1}
                                onClick={() =>
                                  changeDocument((doc) =>
                                    moveSegment(doc, row.id, 1),
                                  )
                                }
                              >
                                <ArrowDown />
                                下移
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="segment-delete-button"
                            aria-label={`删除第${index + 1}段`}
                            title="删除这一段"
                            onClick={() => removeSegment(row.id, index)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <AutoTextarea
                        id={`narration-${row.id}`}
                        className="narration-input"
                        aria-label={`第${index + 1}段文案`}
                        placeholder="写下这一段要说的话……"
                        maxLength={LIMITS.text}
                        value={row.narration}
                        onChange={(event) =>
                          patchSegment(row.id, 'narration', event.target.value)
                        }
                        onSelect={(event) => {
                          selection.current = {
                            id: row.id,
                            offset: event.currentTarget.selectionStart,
                          };
                        }}
                        onKeyDown={(event) => {
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key === 'Enter' &&
                            !event.nativeEvent.isComposing &&
                            !composing.current
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            split(row.id, event.currentTarget.selectionStart);
                          }
                        }}
                      />
                      <div className="segment-stats">
                        <span>
                          {timing.characters} 字 · 口播{' '}
                          {formatDuration(timing.spoken)}
                        </span>
                        <button
                          type="button"
                          className={
                            timing.isManual && timing.planned < timing.estimated
                              ? 'timing-short'
                              : ''
                          }
                          onClick={() => setTimingId(row.id)}
                          title={`计划位置 ${formatTimecode(start)}–${formatTimecode(elapsed)}，点击调整停顿或时长`}
                          aria-label={`设置第${index + 1}段时长`}
                        >
                          <Clock3 size={12} />
                          {formatTimecode(timing.planned)}
                          {timing.isManual
                            ? ' 手动'
                            : row.pauseSeconds
                              ? ` · 停 ${row.pauseSeconds}s`
                              : ''}
                        </button>
                      </div>
                    </div>
                    <div
                      className={`direction-cell${collapsedDirections.has(row.id) ? ' is-collapsed' : ''}`}
                    >
                      <button
                        type="button"
                        className="direction-toggle"
                        aria-label={`第${index + 1}段制作说明`}
                        aria-expanded={!collapsedDirections.has(row.id)}
                        aria-controls={`directions-${row.id}`}
                        onClick={() => {
                          setCollapsedDirections((previous) => {
                            const next = new Set(previous);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          });
                        }}
                      >
                        <Film size={16} />
                        <span>画面与制作说明</span>
                        <ChevronDown size={16} />
                      </button>
                      <div
                        className="direction-fields"
                        id={`directions-${row.id}`}
                      >
                        <div className="ai-segment-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`第${index + 1}段画面建议`}
                            onClick={() =>
                              setAiLaunch({ task: 'visual', scope: row.id })
                            }
                          >
                            <Sparkles size={13} />
                            画面建议
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`第${index + 1}段生成配图`}
                            onClick={() =>
                              setAiLaunch({ task: 'image', scope: row.id })
                            }
                          >
                            <ImagePlus size={13} />
                            生成配图
                          </Button>
                          {!hasImages && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`添加第${index + 1}段配图`}
                              onClick={() => chooseImage(row)}
                            >
                              <Upload size={13} />
                              添加配图
                            </Button>
                          )}
                        </div>
                        <label htmlFor={`visual-${row.id}`}>
                          <span>
                            <Film size={14} />
                            画面
                          </span>
                          <AutoTextarea
                            id={`visual-${row.id}`}
                            aria-label={`第${index + 1}段画面`}
                            maxLength={LIMITS.text}
                            value={row.visual}
                            placeholder="镜头、场景、字幕……"
                            onChange={(event) =>
                              patchSegment(row.id, 'visual', event.target.value)
                            }
                          />
                        </label>
                        <label htmlFor={`bgm-${row.id}`}>
                          <span>
                            <Music2 size={14} />
                            BGM / 音效
                          </span>
                          <AutoTextarea
                            id={`bgm-${row.id}`}
                            aria-label={`第${index + 1}段BGM`}
                            maxLength={LIMITS.text}
                            value={row.bgm}
                            placeholder="音乐情绪、入点、转场音效……"
                            onChange={(event) =>
                              patchSegment(row.id, 'bgm', event.target.value)
                            }
                          />
                        </label>
                        <label htmlFor={`notes-${row.id}`}>
                          <span>
                            <StickyNote size={14} />
                            附注
                          </span>
                          <AutoTextarea
                            id={`notes-${row.id}`}
                            aria-label={`第${index + 1}段附注`}
                            maxLength={LIMITS.text}
                            value={row.notes}
                            placeholder="拍摄、剪辑时的小提醒……"
                            onChange={(event) =>
                              patchSegment(row.id, 'notes', event.target.value)
                            }
                          />
                        </label>
                      </div>
                    </div>
                    {hasImages && (
                      <SegmentImage
                        key={row.id}
                        src={row.image}
                        index={index}
                        onUpload={() => chooseImage(row)}
                        onRemove={() => {
                          setSegmentImage(
                            script.id,
                            row.id,
                            undefined,
                            row.image,
                          );
                          notify('配图已移除，可撤销。');
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              className="add-segment"
              variant="outline"
              onClick={() => addSegment()}
              disabled={script.segments.length >= LIMITS.segments}
            >
              <Plus size={17} />
              新增段落
            </Button>
          </fieldset>
          <footer className="workspace-footer">
            <span className="desktop-label">
              Ctrl + Enter 分段 · Ctrl + Z 撤销
            </span>
            <button type="button" onClick={() => setHelpOpen(true)}>
              口播时长为估算值 <CircleHelp size={11} />
            </button>
          </footer>
        </div>
      </main>

      {aiLaunch && (
        <AiAssistant
          key={script.id}
          script={script}
          launch={aiLaunch}
          onClose={() => setAiLaunch(null)}
          onApply={(input, result, append) => {
            changeDocument((doc) => applyAiResult(doc, input, result, append));
            notify('AI 建议已应用，可撤销。');
          }}
          onImage={(input, src) => {
            if (!inputStillMatches(scriptRef.current, input))
              throw new Error(
                '生成期间稿件已变化，配图未自动添加；可下载后手动添加。',
              );
            const row = input.segments[0];
            setSegmentImage(input.scriptId, row.id, src, row.image);
            notify('AI 配图已添加到对应段落，可撤销。');
          }}
          onLocate={(segmentId) => {
            requestAnimationFrame(() => {
              if (segmentId)
                document
                  .getElementById(`segment-${segmentId}`)
                  ?.scrollIntoView({ block: 'center' });
              else titleInput.current?.focus();
            });
          }}
        />
      )}

      <Dialog
        open={mobileOpen}
        onOpenChange={(open) => {
          pointerReorder.cancel();
          setMobileOpen(open);
        }}
      >
        <DialogContent className="sidebar-dialog" placement="left">
          <DialogTitle className="sr-only">我的脚本</DialogTitle>
          <DialogDescription className="sr-only">
            选择脚本或跳转到段落
          </DialogDescription>
          {sidebar}
        </DialogContent>
      </Dialog>

      <DisplaySettings open={displayOpen} onOpenChange={setDisplayOpen} />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>口播速度</DialogTitle>
            <DialogDescription>
              只统计文案，不计画面、BGM 和附注。
            </DialogDescription>
          </DialogHeader>
          <div className="form-row">
            <label htmlFor="chinese-pace">
              中文语速 <small>字 / 分钟</small>
            </label>
            <NumberField
              id="chinese-pace"
              value={script.chineseCpm}
              min={60}
              max={600}
              step="1"
              onChange={(value) =>
                changeDocument(
                  (doc) => ({ ...doc, chineseCpm: value ?? 240 }),
                  `${script.id}:pace`,
                )
              }
            />
          </div>
          <div className="pace-presets">
            {[
              { label: '舒缓', speed: 180 },
              { label: '自然', speed: 240 },
              { label: '轻快', speed: 300 },
            ].map((preset) => (
              <Button
                key={preset.speed}
                size="sm"
                variant={
                  script.chineseCpm === preset.speed ? 'secondary' : 'outline'
                }
                onClick={() =>
                  changeDocument((doc) => ({
                    ...doc,
                    chineseCpm: preset.speed,
                  }))
                }
              >
                {preset.label} · {preset.speed}
              </Button>
            ))}
          </div>
          <div className="form-row">
            <label htmlFor="english-pace">
              英文语速 <small>词 / 分钟</small>
            </label>
            <NumberField
              id="english-pace"
              value={script.englishWpm}
              min={50}
              max={300}
              step="1"
              onChange={(value) =>
                changeDocument(
                  (doc) => ({ ...doc, englishWpm: value ?? 150 }),
                  `${script.id}:english-pace`,
                )
              }
            />
          </div>
          <p className="form-help">
            字数按文字和数字计算，排除标点、空白和表情。估时中，中文按字、英文按词、数字逐位计算。标点不会自动增加停顿，可逐段设置停顿秒数。最终请以实际试读为准。
          </p>
          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!timingRow}
        onOpenChange={(open) => {
          if (!open) setTimingId(null);
        }}
      >
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>段落时长</DialogTitle>
            <DialogDescription>
              {timingRow?.title || '当前段落'} · 口播约{' '}
              {timingRow
                ? formatDuration(segmentStats(timingRow, script).spoken)
                : ''}
            </DialogDescription>
          </DialogHeader>
          {timingRow && (
            <>
              <div className="form-row">
                <label htmlFor="pause-seconds">
                  额外停顿 <small>秒</small>
                </label>
                <NumberField
                  id="pause-seconds"
                  min={0}
                  max={3600}
                  value={timingRow.pauseSeconds}
                  onChange={(value) =>
                    patchSegment(timingRow.id, 'pauseSeconds', value ?? 0)
                  }
                />
              </div>
              <div className="form-row">
                <label htmlFor="manual-seconds">
                  手动计划时长 <small>秒 · 可留空</small>
                </label>
                <NumberField
                  id="manual-seconds"
                  min={0}
                  max={86400}
                  allowEmpty
                  placeholder="自动估算"
                  value={timingRow.durationSeconds}
                  onChange={(value) =>
                    patchSegment(timingRow.id, 'durationSeconds', value)
                  }
                />
              </div>
              <p className="form-help">
                留空时 = 口播估时 +
                额外停顿。填写后，该段计划时长直接使用手动值（已含停顿），适合纯画面、留白或固定镜头。
              </p>
              {timingRow.durationSeconds !== null &&
                timingRow.durationSeconds <
                  segmentStats(timingRow, script).estimated && (
                  <p className="inline-warning">
                    <TriangleAlert size={15} />
                    手动时长短于估算时长，请留意是否来得及读完。
                  </p>
                )}
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (timingRow)
                  patchSegment(timingRow.id, 'durationSeconds', null);
              }}
            >
              恢复自动估时
            </Button>
            <Button onClick={() => setTimingId(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!movingRow}
        onOpenChange={(open) => {
          if (!open) setMovingId(null);
        }}
      >
        <DialogContent className="settings-dialog move-dialog">
          <DialogHeader>
            <DialogTitle>
              移动第 {movingIndex >= 0 ? movingIndex + 1 : ''} 段
            </DialogTitle>
            <DialogDescription>
              输入目标段落号，当前段落会插入到它的上方。
            </DialogDescription>
          </DialogHeader>
          <div className="form-row">
            <label htmlFor="move-target">
              目标段落 <small>可输入 1–{script.segments.length}</small>
            </label>
            <NumberField
              id="move-target"
              aria-label="目标段落"
              min={1}
              max={script.segments.length}
              step="1"
              value={moveTarget}
              onChange={(value) => {
                if (value !== null) setMoveTarget(value);
              }}
            />
          </div>
          <p className="form-help move-target-help">
            {moveTargetRow
              ? `将插入到当前第 ${moveTarget} 段“${moveTargetRow.title || '未命名段落'}”上方，目标及以下段落顺延。`
              : '请输入有效的目标段落号。'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovingId(null)}>
              取消
            </Button>
            <Button
              disabled={!canMove}
              onClick={() => {
                if (movingRow && moveTargetRow)
                  moveBefore(movingRow.id, moveTargetRow.id);
                setMovingId(null);
              }}
            >
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="import-dialog">
          <DialogHeader>
            <DialogTitle>导入文案</DialogTitle>
            <DialogDescription>
              粘贴纯文本文案，空行自动分段。导入会创建新脚本，不覆盖已有内容。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="导入脚本标题"
            placeholder="新脚本的标题（可选）"
            maxLength={200}
            value={importTitle}
            onChange={(event) => setImportTitle(event.target.value)}
          />
          <Textarea
            className="bulk-text"
            aria-label="待导入文案"
            value={importText}
            maxLength={500000}
            placeholder={'第一段想说的话……\n\n空一行，开始下一段。'}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportError('');
            }}
          />
          <div className="import-meta">
            <span>{countText(importText).characters} 字</span>
            <span>已有 Markdown 可复制正文后粘贴</span>
          </div>
          <div className="import-backup">
            <div>
              <FileJson size={17} />
              <span>
                恢复幕稿 JSON 备份<small>包含文案、制作说明和语速设置</small>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              选择文件
            </Button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              tabIndex={-1}
              accept=".json,application/json"
              aria-label="导入 JSON 备份"
              onChange={(event) => {
                void importBackupFile(event.target.files?.[0]);
              }}
            />
          </div>
          {importError && (
            <p className="form-error" role="alert">
              {importError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button onClick={importManuscript} disabled={!importText.trim()}>
              <FilePlus2 size={15} />
              创建脚本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="markdown-dialog">
          <DialogHeader>
            <DialogTitle>Markdown 预览</DialogTitle>
            <DialogDescription>
              这是导出文件的源码。表格适合对照，分段正文适合长文修改。
            </DialogDescription>
          </DialogHeader>
          <div className="preview-options">
            <Button
              size="sm"
              variant={markdownLayout === 'table' ? 'secondary' : 'outline'}
              onClick={() => setMarkdownLayout('table')}
            >
              双栏表格
            </Button>
            <Button
              size="sm"
              variant={markdownLayout === 'sections' ? 'secondary' : 'outline'}
              onClick={() => setMarkdownLayout('sections')}
            >
              分段正文
            </Button>
          </div>
          <Textarea
            className="markdown-preview"
            aria-label="Markdown 源码"
            readOnly
            value={markdown}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!navigator.clipboard?.writeText) {
                  notify('当前访问方式不支持复制，请使用下载按钮。');
                  return;
                }
                void navigator.clipboard
                  .writeText(markdown)
                  .then(() => notify('Markdown 已复制。'))
                  .catch(() => notify('浏览器未允许复制，请使用下载按钮。'));
              }}
            >
              <Copy size={15} />
              复制
            </Button>
            <Button onClick={() => downloadMarkdown(markdownLayout)}>
              <Download size={15} />
              下载 .md
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="history-dialog">
          <DialogHeader>
            <DialogTitle>本机历史记录</DialogTitle>
            <DialogDescription>
              编辑期间约每分钟保留一次旧版本，最多 10
              份。恢复会创建副本，不替换当前脚本。
            </DialogDescription>
          </DialogHeader>
          {snapshotError ? (
            <p className="form-error">{snapshotError}</p>
          ) : snapshots.length === 0 ? (
            <div className="empty-history">
              <History size={27} />
              <p>还没有历史版本</p>
              <small>继续编辑一会儿，这里会出现记录。</small>
            </div>
          ) : (
            <div className="snapshot-list">
              {snapshots.map((snapshot) => {
                const saved =
                  snapshot.workspace.documents.find(
                    (doc) => doc.id === script.id,
                  ) ?? activeScript(snapshot.workspace);
                return (
                  <div className="snapshot-row" key={snapshot.id}>
                    <div>
                      <strong>{saved.title || '未命名脚本'}</strong>
                      <small>
                        {new Date(snapshot.savedAt).toLocaleString('zh-CN')} ·{' '}
                        {saved.segments.length} 段
                      </small>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        addDocument(duplicateScript(saved));
                        setHistoryOpen(false);
                        notify('历史版本已恢复为新副本。');
                      }}
                    >
                      恢复副本
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={backup}>
              <FileJson size={15} />
              下载当前完整备份
            </Button>
            <Button onClick={() => setHistoryOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="help-dialog">
          <DialogHeader>
            <DialogTitle>一个专注写稿的小工具</DialogTitle>
            <DialogDescription>
              无需注册。可选接入自己的 AI 服务，辅助写稿与配图。
            </DialogDescription>
          </DialogHeader>
          <div className="help-content">
            <p>
              <strong>写作：</strong>逐段写口播，补充画面、BGM
              与附注。段落菜单支持分段、复制、合并和移动。
              <span className="mobile-label">
                手机上可收起制作说明，专注写文案。
              </span>
              <span className="desktop-label">
                Ctrl + Enter 在光标处分段，Mac 使用 ⌘。
              </span>
            </p>
            <p>
              <strong>保存：</strong>
              编辑后自动保存到当前浏览器；看见“已保存到本机”再关闭。
              <span className="desktop-label">
                Ctrl + S 可立即保存，Ctrl + Z / Ctrl + Shift + Z 撤销和重做。
              </span>
            </p>
            <p>
              <strong>备份：</strong>Markdown / Word 用于阅读和交付；JSON
              能完整恢复所有脚本。请定期下载 JSON 到自己的文件夹。
            </p>
            <p>
              <strong>注意：</strong>
              稿件在本机保存，不跨设备同步。只有主动调用 AI
              时，所选内容才会发送到你配置的服务。更换浏览器、地址或清理网站数据后，原数据不会自动出现；无痕模式关闭后也可能丢失。本机历史不等于外部备份。
            </p>
            <p>
              <strong>AI：</strong>
              在“AI
              设置”填写服务地址、模型与密钥，可固定画面和文稿风格。段落内可获取画面建议或生成配图，“AI
              助手”还支持逐段或整稿润色、平台风险审查。文字建议需预览后应用；配图自动放入对应段落，每段一张，可替换、移除或撤销。配图随本机稿件和
              JSON 备份保存，Word / Markdown
              仅导出文字。平台规则为有限摘要，审查不保证过审。
            </p>
            <p>
              <strong>计时：</strong>
              文案文字参与估时，制作说明不参与。复杂数字、缩写和表演停顿需要实际试读校准。手动时长会覆盖该段的自动估时。
            </p>
            <p className="form-help">
              当前版本每份脚本最多 500 段，本机最多 100 份脚本；单栏最多 50,000
              字符，单张配图上限 20 MB，JSON 导入上限 128 MB。
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setHelpOpen(false)}>开始写作</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              取消
            </Button>
            <Button
              variant={confirmation?.label ? 'default' : 'destructive'}
              onClick={() => {
                confirmation?.action();
                setConfirmation(null);
              }}
            >
              {confirmation?.label || '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pointerReorder.drag && (
        <output className="toast drag-hint">
          <GripVertical size={16} />
          <span>拖拽中 · 松手放置</span>
        </output>
      )}
      {toast && !pointerReorder.drag && (
        <output className="toast">
          <Check size={16} />
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast('')}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </output>
      )}
    </div>
  );
}
