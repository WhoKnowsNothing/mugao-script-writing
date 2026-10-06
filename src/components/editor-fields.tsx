'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

export function AutoTextarea({
  value,
  ...props
}: ComponentProps<'textarea'> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    if (!ref.current) return;
    ref.current.style.height = '0px';
    ref.current.style.height = `${Math.max(ref.current.scrollHeight, 24)}px`;
  };
  useLayoutEffect(resize, [value]);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    let lastWidth = ref.current.clientWidth;
    let frame = 0;
    const scheduleResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - lastWidth) > 1) {
        lastWidth = entry.contentRect.width;
        // Resize after observer delivery; writing height here can trigger a loop
        // when a dialog or a mobile breakpoint changes the available width.
        scheduleResize();
      }
    });
    observer.observe(ref.current);
    window.addEventListener('mugao-font-scale-change', scheduleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('mugao-font-scale-change', scheduleResize);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <Textarea {...props} value={value} ref={ref} />;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  allowEmpty = false,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'min' | 'max'> & {
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  allowEmpty?: boolean;
}) {
  const [source, setSource] = useState(value);
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  if (source !== value) {
    setSource(value);
    setDraft(value === null ? '' : String(value));
  }
  const change = (text: string) => {
    setDraft(text);
    if (text === '') {
      if (allowEmpty) onChange(null);
      return;
    }
    const number = Number(text);
    if (Number.isFinite(number) && number >= min && number <= max)
      onChange(number);
  };
  return (
    <Input
      {...props}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={props.step ?? '0.1'}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onBlur={() => {
        if (draft === '' && allowEmpty) return;
        const n = Number(draft);
        if (draft === '' || !Number.isFinite(n) || n < min || n > max)
          setDraft(value === null ? '' : String(value));
      }}
    />
  );
}
