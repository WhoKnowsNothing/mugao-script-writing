'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const STORAGE_KEY = 'mugao-font-scale';

function readFontScale() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return value >= 90 && value <= 150 && value % 10 === 0 ? value : 100;
  } catch {
    return 100;
  }
}

export function DisplaySettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [scale, setScale] = useState(readFontScale);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--mg-font-scale',
      String(scale / 100),
    );
    // Textareas also need a fresh height when only the font, not their width, changes.
    const frame = requestAnimationFrame(() =>
      window.dispatchEvent(new Event('mugao-font-scale-change')),
    );
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty('--mg-font-scale');
    };
  }, [scale]);

  function changeScale(value: number) {
    const next = Math.max(90, Math.min(150, Math.round(value / 10) * 10));
    setScale(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
      setError('');
    } catch {
      setError('字号已调整，但浏览器未能保存此设置，刷新后可能恢复默认。');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="display-dialog">
        <DialogHeader>
          <DialogTitle>显示设置</DialogTitle>
          <DialogDescription>
            界面、正文和弹窗字号一起调整，不影响导出文件。
          </DialogDescription>
        </DialogHeader>
        <div className="font-scale-heading">
          <label htmlFor="font-scale">统一字号</label>
          <output htmlFor="font-scale" aria-live="polite">
            {scale}%
          </output>
        </div>
        <div className="font-scale-control">
          <Button
            variant="outline"
            size="icon"
            aria-label="减小字号"
            disabled={scale === 90}
            onClick={() => changeScale(scale - 10)}
          >
            <Minus size={18} />
          </Button>
          <input
            id="font-scale"
            type="range"
            min={90}
            max={150}
            step={10}
            value={scale}
            aria-valuetext={`${scale}%${scale === 100 ? '，默认' : ''}`}
            onChange={(event) => changeScale(Number(event.target.value))}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="增大字号"
            disabled={scale === 150}
            onClick={() => changeScale(scale + 10)}
          >
            <Plus size={18} />
          </Button>
        </div>
        <p className="form-help">即时生效，并记住此浏览器的选择。</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeScale(100)}>
            恢复默认
          </Button>
          <Button onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
