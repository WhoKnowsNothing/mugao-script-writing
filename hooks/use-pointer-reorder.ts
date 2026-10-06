'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

type DropTarget = {
  markerId: string;
  beforeId: string | null;
  edge: 'before' | 'after';
};
type PointerDrag = { id: string; list: string; target: DropTarget | null };

export const TOUCH_REORDER_DELAY_MS = 500;
const MOVE_TOLERANCE = 8;

// Only handles opt out of touch scrolling. Text fields and the rest of each row
// retain native scrolling, selection and editing. touch-action must be set before
// pointerdown: changing it after a long press cannot stop an ongoing browser pan.
export function usePointerReorder(
  documentId: string,
  onMove: (id: string, beforeId: string | null) => void,
) {
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => {
    cleanup.current?.();
    setDrag(null);
  }, []);

  useEffect(() => cancel, [documentId, cancel]);

  const start = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    // Desktop handles keep their existing HTML drag-and-drop behavior.
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      cleanup.current ||
      (event.pointerType === 'mouse' && event.currentTarget.draggable)
    )
      return;
    const handle = event.currentTarget;
    const list = handle.closest<HTMLElement>('[data-reorder-list]');
    if (!list) return;
    const scroller = list.closest<HTMLElement>('[data-reorder-scroll]');
    const pointerId = event.pointerId;
    const needsLongPress = event.pointerType !== 'mouse';
    const startX = event.clientX;
    const startY = event.clientY;
    let x = startX;
    let y = startY;
    let active = false;
    let moved = false;
    let pressTimer: number | undefined;
    let target: DropTarget | null = null;
    let frame = 0;
    let lastTime = 0;
    event.preventDefault();
    handle.setPointerCapture(pointerId);

    const updateTarget = () => {
      const bounds = list.getBoundingClientRect();
      let next: DropTarget | null = null;
      if (
        x >= bounds.left &&
        x <= bounds.right &&
        y >= 0 &&
        y <= window.innerHeight
      ) {
        const rows = [
          ...list.querySelectorAll<HTMLElement>('[data-reorder-id]'),
        ].filter((row) => row.dataset.reorderId !== id);
        const following = rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return y < rect.top + rect.height / 2;
        });
        const marker = following ?? rows[rows.length - 1];
        if (marker)
          next = {
            markerId: marker.dataset.reorderId!,
            beforeId: following?.dataset.reorderId ?? null,
            edge: following ? 'before' : 'after',
          };
      }
      if (next?.markerId !== target?.markerId || next?.edge !== target?.edge) {
        target = next;
        setDrag({ id, list: list.dataset.reorderList!, target });
      }
    };

    const tick = (time: number) => {
      const elapsed = lastTime ? Math.min(time - lastTime, 32) : 16;
      lastTime = time;
      const bounds = scroller?.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>('.topbar');
      const headerBottom =
        header && getComputedStyle(header).position === 'sticky'
          ? header.getBoundingClientRect().bottom
          : 0;
      const top = bounds ? Math.max(0, bounds.top) : headerBottom;
      const bottom = bounds
        ? Math.min(window.innerHeight, bounds.bottom)
        : window.innerHeight;
      const edge = Math.min(64, (bottom - top) / 3);
      const listBounds = list.getBoundingClientRect();
      if (
        x >= listBounds.left &&
        x <= listBounds.right &&
        y >= 0 &&
        y <= window.innerHeight
      ) {
        const speed =
          y < top + edge
            ? -Math.min(1, (top + edge - y) / edge)
            : y > bottom - edge
              ? Math.min(1, (y - bottom + edge) / edge)
              : 0;
        if (speed) {
          (scroller ?? window).scrollBy({
            top: speed * elapsed * 0.65,
            behavior: 'instant',
          });
          updateTarget();
        }
      }
      frame = requestAnimationFrame(tick);
    };

    const activate = () => {
      active = true;
      setDrag({ id, list: list.dataset.reorderList!, target: null });
      if (needsLongPress) {
        try {
          navigator.vibrate?.(15);
        } catch {
          // Haptics are optional; the visible drag state works without them.
        }
      }
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      x = next.clientX;
      y = next.clientY;
      const distance = Math.hypot(x - startX, y - startY);
      if (!active) {
        if (distance < MOVE_TOLERANCE) return;
        // A swipe before the hold completes must never pick up a segment.
        if (needsLongPress) {
          cancel();
          return;
        }
        activate();
      }
      next.preventDefault();
      if (!moved) {
        if (distance < MOVE_TOLERANCE) return;
        moved = true;
        frame = requestAnimationFrame(tick);
      }
      updateTarget();
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (active && moved) {
        x = next.clientX;
        y = next.clientY;
        updateTarget();
      }
      const destination = target;
      cancel();
      if (active && moved && destination) onMove(id, destination.beforeId);
    };
    const abortPointer = (next: PointerEvent) => {
      if (next.pointerId === pointerId) cancel();
    };
    const escape = (next: KeyboardEvent) => {
      if (next.key === 'Escape') cancel();
    };
    const preventNativeDrag = (next: DragEvent) => next.preventDefault();
    const preventContextMenu = (next: Event) => next.preventDefault();

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', abortPointer);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    handle.addEventListener('lostpointercapture', abortPointer);
    handle.addEventListener('dragstart', preventNativeDrag);
    handle.addEventListener('contextmenu', preventContextMenu);
    if (needsLongPress)
      pressTimer = window.setTimeout(activate, TOUCH_REORDER_DELAY_MS);
    cleanup.current = () => {
      cleanup.current = null;
      window.clearTimeout(pressTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', abortPointer);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      handle.removeEventListener('lostpointercapture', abortPointer);
      handle.removeEventListener('dragstart', preventNativeDrag);
      handle.removeEventListener('contextmenu', preventContextMenu);
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
    };
  };

  return { drag, start, cancel };
}
