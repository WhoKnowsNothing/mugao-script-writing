import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOUCH_REORDER_DELAY_MS,
  usePointerReorder,
} from '@/hooks/use-pointer-reorder';

function Fixture({
  onMove,
  documentId = 'one',
  outline = false,
}: {
  onMove: (id: string, beforeId: string | null) => void;
  documentId?: string;
  outline?: boolean;
}) {
  const reorder = usePointerReorder(documentId, onMove);
  return (
    <div
      data-reorder-list={outline ? 'outline' : 'body'}
      data-reorder-scroll={outline || undefined}
    >
      {['a', 'b', 'c'].map((id) => (
        <div key={id} data-reorder-id={id}>
          <button onPointerDown={(event) => reorder.start(event, id)}>
            {id}
          </button>
        </div>
      ))}
      <output>{reorder.drag ? 'dragging' : 'idle'}</output>
    </div>
  );
}

function pointer(
  target: Element | Window,
  type: string,
  y: number,
  x = 20,
  pointerId = 1,
  pointerType = 'touch',
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
}

const rect = (top: number, height: number) => ({
  x: 0,
  y: top,
  left: 0,
  right: 320,
  top,
  bottom: top + height,
  width: 320,
  height,
  toJSON: () => ({}),
});
let nextFrame: FrameRequestCallback;
let pageScroll = 0;
const originalVibrate = Object.getOwnPropertyDescriptor(navigator, 'vibrate');
const vibrate = vi.fn(() => true);
const hold = () => {
  act(() => {
    vi.advanceTimersByTime(TOUCH_REORDER_DELAY_MS);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vibrate.mockClear();
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vibrate,
  });
  pageScroll = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(window, 'scrollBy').mockImplementation(
    (options: ScrollToOptions | number = {}) => {
      if (typeof options === 'object') pageScroll += options.top ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute('data-reorder-list'))
        return rect(60 - pageScroll, 360);
      const index = ['a', 'b', 'c'].indexOf(this.dataset.reorderId ?? '');
      return rect(60 + Math.max(index, 0) * 120 - pageScroll, 120);
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  if (originalVibrate)
    Object.defineProperty(navigator, 'vibrate', originalVibrate);
  else Reflect.deleteProperty(navigator, 'vibrate');
});

describe('触屏拖拽手势', () => {
  it('长按半秒才激活并轻震一次，手指轻微抖动不打断，原地松手不排序或滚动', () => {
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    const handle = screen.getByRole('button', { name: 'a' });
    pointer(handle, 'pointerdown', 80);
    act(() => {
      vi.advanceTimersByTime(TOUCH_REORDER_DELAY_MS - 1);
    });
    pointer(window, 'pointermove', 83);
    expect(screen.getByText('idle')).toBeTruthy();
    expect(vibrate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('dragging')).toBeTruthy();
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(15);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(handle)).toBe(false);
    pointer(window, 'pointerup', 83);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it('长按完成前滑动会取消，之后不迟发震动或改变顺序', () => {
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    pointer(window, 'pointermove', 110);
    hold();
    pointer(window, 'pointermove', 410);
    pointer(window, 'pointerup', 410);
    expect(screen.getByText('idle')).toBeTruthy();
    expect(vibrate).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('松手才提交，支持首段移到末尾、末段移到开头', () => {
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    hold();
    pointer(window, 'pointermove', 410);
    expect(screen.getByText('dragging')).toBeTruthy();
    expect(onMove).not.toHaveBeenCalled();
    pointer(window, 'pointerup', 410);
    expect(onMove).toHaveBeenLastCalledWith('a', null);
    pointer(screen.getByRole('button', { name: 'c' }), 'pointerdown', 340);
    hold();
    pointer(window, 'pointermove', 70);
    pointer(window, 'pointerup', 70);
    expect(onMove).toHaveBeenLastCalledWith('c', 'a');
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it('轻点或拖出列表横向范围不会改变顺序，其他手指不会提前结束拖拽', () => {
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    const handle = screen.getByRole('button', { name: 'a' });
    pointer(handle, 'pointerdown', 80);
    pointer(window, 'pointermove', 83);
    pointer(window, 'pointerup', 83);
    hold();
    expect(onMove).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown', 80);
    hold();
    pointer(window, 'pointermove', 410);
    pointer(window, 'pointerup', 410, 20, 2);
    expect(screen.getByText('dragging')).toBeTruthy();
    pointer(window, 'pointerup', 410, 350);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it.each(
    ['pointercancel', 'lostpointercapture', 'Escape', 'blur'].flatMap(
      (reason) => [false, true].map((active) => ({ reason, active })),
    ),
  )(
    '$reason 取消手势（已激活：$active），不提交或继续滚动',
    ({ reason, active }) => {
      const onMove = vi.fn();
      render(<Fixture onMove={onMove} />);
      const handle = screen.getByRole('button', { name: 'a' });
      pointer(handle, 'pointerdown', 80);
      if (active) {
        hold();
        pointer(window, 'pointermove', 410);
      }
      if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      else if (reason === 'blur') fireEvent.blur(window);
      else
        pointer(reason === 'lostpointercapture' ? handle : window, reason, 410);
      pointer(window, 'pointerup', 410);
      hold();
      expect(onMove).not.toHaveBeenCalled();
      expect(screen.getByText('idle')).toBeTruthy();
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    },
  );

  it('切换脚本或卸载时取消尚未完成的拖拽', () => {
    const onMove = vi.fn();
    const view = render(<Fixture onMove={onMove} />);
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    view.rerender(<Fixture onMove={onMove} documentId="two" />);
    hold();
    pointer(window, 'pointerup', 410);
    expect(onMove).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    hold();
    pointer(window, 'pointermove', 410);
    view.unmount();
    pointer(window, 'pointerup', 410);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('拖到页面边缘时持续滚动，松手后停止', () => {
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    hold();
    pointer(window, 'pointermove', window.innerHeight - 10);
    act(() => nextFrame(16));
    act(() => nextFrame(32));
    expect(window.scrollBy).toHaveBeenCalledTimes(2);
    expect(pageScroll).toBeGreaterThan(0);
    pointer(window, 'pointerup', window.innerHeight - 10);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledOnce();
  });

  it('大纲内的拖动只滚动大纲，不滚动被抽屉覆盖的正文', () => {
    const onMove = vi.fn();
    const { container } = render(<Fixture onMove={onMove} outline />);
    const list = container.querySelector<HTMLElement>('[data-reorder-list]')!;
    list.getBoundingClientRect = () => rect(60, 180);
    const scrollOutline = vi.fn();
    list.scrollBy = scrollOutline;
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    hold();
    pointer(window, 'pointermove', 230);
    act(() => nextFrame(16));
    expect(scrollOutline).toHaveBeenCalledWith(
      expect.objectContaining({ top: expect.any(Number) }),
    );
    expect(window.scrollBy).not.toHaveBeenCalled();
    pointer(window, 'pointerup', 230);
    expect(onMove).toHaveBeenCalledOnce();
  });

  it.each(['unsupported', 'blocked'])('震动 %s 时仍可长按拖拽', (reason) => {
    Object.defineProperty(navigator, 'vibrate', {
      value:
        reason === 'unsupported'
          ? undefined
          : () => {
              throw new DOMException('Blocked');
            },
    });
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    pointer(screen.getByRole('button', { name: 'a' }), 'pointerdown', 80);
    hold();
    expect(screen.getByText('dragging')).toBeTruthy();
    pointer(window, 'pointermove', 410);
    pointer(window, 'pointerup', 410);
    expect(onMove).toHaveBeenCalledWith('a', null);
  });

  it('鼠标在手机布局中仍可直接拖动，不等待长按或震动', () => {
    const onMove = vi.fn();
    render(<Fixture onMove={onMove} />);
    pointer(
      screen.getByRole('button', { name: 'a' }),
      'pointerdown',
      80,
      20,
      1,
      'mouse',
    );
    pointer(window, 'pointermove', 410, 20, 1, 'mouse');
    expect(screen.getByText('dragging')).toBeTruthy();
    expect(vibrate).not.toHaveBeenCalled();
    pointer(window, 'pointerup', 410, 20, 1, 'mouse');
    expect(onMove).toHaveBeenCalledWith('a', null);
  });
});
