'use client';

/* oxlint-disable nextjs/no-img-element -- Local image data works without an image server. */
import { useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function SegmentImage({
  src,
  index,
  onUpload,
  onRemove,
}: {
  src?: string;
  index: number;
  onUpload: () => void;
  onRemove: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <div className="segment-image-cell" aria-label={`第${index + 1}段配图栏`}>
      <span className="mobile-label">配图</span>
      {src ? (
        <>
          {failedSrc === src ? (
            <p className="image-help">图片无法显示，请更换配图。</p>
          ) : (
            <button
              type="button"
              className="segment-image-preview"
              onClick={() => setPreviewOpen(true)}
              aria-label={`查看第${index + 1}段配图`}
            >
              <img
                src={src}
                alt={`第${index + 1}段配图`}
                referrerPolicy="no-referrer"
                onError={() => setFailedSrc(src)}
              />
            </button>
          )}
          <div className="segment-image-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={onUpload}
              aria-label={`替换第${index + 1}段配图`}
            >
              <Upload size={13} />
              替换
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label={`移除第${index + 1}段配图`}
            >
              <Trash2 size={13} />
              移除
            </Button>
          </div>
          {src.startsWith('https:') && (
            <p className="image-help">临时链接可能过期，建议下载后重新添加。</p>
          )}
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="segment-image-dialog">
              <DialogHeader>
                <DialogTitle>第 {index + 1} 段配图</DialogTitle>
                <DialogDescription>每段保留一张配图。</DialogDescription>
              </DialogHeader>
              <img
                className="segment-image-full"
                src={src}
                alt={`第${index + 1}段配图预览`}
                referrerPolicy="no-referrer"
              />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Button
          className="segment-image-empty"
          variant="ghost"
          onClick={onUpload}
          aria-label={`添加第${index + 1}段配图`}
        >
          <ImagePlus size={16} />
          添加配图
        </Button>
      )}
    </div>
  );
}
