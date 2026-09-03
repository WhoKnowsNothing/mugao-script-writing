import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();
if (!window.PointerEvent)
  window.PointerEvent = MouseEvent as typeof PointerEvent;
Object.defineProperty(window.HTMLElement.prototype, 'hasPointerCapture', {
  value: () => false,
});
Object.defineProperty(window.HTMLElement.prototype, 'setPointerCapture', {
  value: () => undefined,
});
Object.defineProperty(window.HTMLElement.prototype, 'releasePointerCapture', {
  value: () => undefined,
});
