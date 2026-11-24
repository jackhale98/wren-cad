/**
 * Before (ADR-103), the touch chip and the H key: held shows Before, any way of letting go ends it,
 * typing H in a field does not start it, auto-repeat does not toggle it.
 */
import { resolveKeymap } from '@wren-cad/ui';
import { describe, expect, it } from 'vitest';
import { APP_COMMANDS, type InputSettings } from '../app/input';
import { onKey, onKeyUp } from '../app/keyboard';
import type { Workbench } from '../app/workbench';
import { beforeChipHandlers } from './before-chip-handlers';

function fake() {
  const log: boolean[] = [];
  const cp = {
    holdCode: null as string | null,
    setBefore: (on: boolean) => log.push(on),
  };
  const input = {
    resolved: resolveKeymap(APP_COMMANDS, {}),
    keymap: {},
  } as unknown as InputSettings;
  const wb = {
    changePreview: cp,
    ui: { get: () => ({ sketch: null, drawing: null }) },
    input: { get: () => input },
  } as unknown as Workbench;
  return { wb, cp, log };
}

const key = (over: Record<string, unknown> = {}) =>
  ({
    code: 'KeyH',
    key: 'h',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: { tagName: 'DIV', isContentEditable: false },
    preventDefault: () => {},
    ...over,
  }) as unknown as KeyboardEvent;

describe('Before chip', () => {
  it('press shows Before and releasing ends it', () => {
    const { log, cp } = fake();
    const h = beforeChipHandlers(cp);
    h.hold();
    expect(log).toEqual([true]);
    h.release();
    expect(log).toEqual([true, false]);
  });

  it('pointer cancel, lost capture and blur are all the release handler', () => {
    // BeforeChip wires onPointerUp, onPointerCancel, onLostPointerCapture and onBlur to
    // `release`; the window blur is `setBefore(false)` (workbench.ts) and is idempotent.
    const { log, cp } = fake();
    const h = beforeChipHandlers(cp);
    h.hold();
    h.release();
    h.release();
    expect(log.at(-1)).toBe(false);
  });

  it('Space and Enter activate it, other keys do not', () => {
    const h = beforeChipHandlers(fake().cp);
    expect([' ', 'Enter', 'a', 'Tab'].map(h.isActivation)).toEqual([true, true, false, false]);
  });
});

describe('Before key', () => {
  it('H down shows Before, H up ends it', () => {
    const { wb, cp, log } = fake();
    onKey(wb, key());
    expect(log).toEqual([true]);
    expect(cp.holdCode).toBe('KeyH');
    onKeyUp(wb, key());
    expect(log).toEqual([true, false]);
    expect(cp.holdCode).toBeNull();
  });

  it('does nothing when typed in a text field or the expression input', () => {
    for (const target of [
      { tagName: 'INPUT', isContentEditable: false },
      { tagName: 'TEXTAREA', isContentEditable: false },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      const { wb, log } = fake();
      onKey(wb, key({ target }));
      expect(log).toEqual([]);
    }
  });

  it('auto-repeat does not toggle it', () => {
    const { wb, log } = fake();
    onKey(wb, key());
    onKey(wb, key({ repeat: true }));
    onKey(wb, key({ repeat: true }));
    expect(log).toEqual([true]);
  });
});
