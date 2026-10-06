import type { Workspace } from './script';

export interface History {
  present: Workspace;
  past: Workspace[];
  future: Workspace[];
  group: string | null;
  lastEdit: number;
  groupStarted: number;
}
export const initialHistory = (present: Workspace): History => ({
  present,
  past: [],
  future: [],
  group: null,
  lastEdit: 0,
  groupStarted: 0,
});

export function recordChange(
  history: History,
  next: Workspace,
  group: string | null = null,
  now = Date.now(),
): History {
  if (next === history.present) return history;
  const grouped =
    group !== null &&
    group === history.group &&
    now - history.lastEdit < 900 &&
    now - history.groupStarted < 4000;
  return {
    present: next,
    past: grouped
      ? history.past
      : [...history.past, history.present].slice(-80),
    future: [],
    group,
    lastEdit: now,
    groupStarted: grouped ? history.groupStarted : now,
  };
}
export function undoHistory(history: History): History {
  if (!history.past.length) return history;
  return {
    ...initialHistory(history.past[history.past.length - 1]),
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future].slice(0, 80),
  };
}
export function redoHistory(history: History): History {
  if (!history.future.length) return history;
  return {
    ...initialHistory(history.future[0]),
    past: [...history.past, history.present].slice(-80),
    future: history.future.slice(1),
  };
}
