import { describe, expect, it } from 'vitest';
import {
  capabilitiesFor,
  kernelBootFor,
  meshQualityFor,
  policyFor,
  regenBudgetFor,
  shouldBootKernel,
} from './tier-policy';

describe('tier policy (PLAN §8.4)', () => {
  it('regen cache budget shrinks with the tier; desktop keeps the engine default', () => {
    expect(regenBudgetFor('desktop')).toBeUndefined();
    expect(regenBudgetFor('tablet')).toBe(4);
    expect(regenBudgetFor('phone')).toBe(2);
  });

  it('mesh quality: phones coarse, others fine', () => {
    expect(meshQualityFor('desktop')).toBe('fine');
    expect(meshQualityFor('tablet')).toBe('fine');
    expect(meshQualityFor('phone')).toBe('coarse');
  });

  it('only phones boot the kernel on first edit', () => {
    expect(kernelBootFor('desktop')).toBe('eager');
    expect(kernelBootFor('tablet')).toBe('eager');
    expect(kernelBootFor('phone')).toBe('onEdit');
    expect(policyFor('phone').tier).toBe('phone');
  });

  it('shouldBootKernel: phone waits for an edit or for a document that has no cached mesh', () => {
    expect(shouldBootKernel('desktop', { editStarted: false })).toBe(true);
    expect(shouldBootKernel('tablet', { editStarted: false })).toBe(true);
    expect(shouldBootKernel('phone', { editStarted: false })).toBe(false);
    expect(shouldBootKernel('phone', { editStarted: true })).toBe(true);
    expect(shouldBootKernel('phone', { editStarted: false, needsKernelToRender: true })).toBe(true);
  });
});

describe('capabilitiesFor (ADR-101)', () => {
  const off = { fullEditor: false };
  it('desktop: full editor, compact', () => {
    expect(capabilitiesFor('desktop', off)).toEqual({
      layout: 'full',
      density: 'compact',
      editSketches: true,
      editFeatures: true,
      editValues: true,
      editDrawings: true,
    });
  });
  it('tablet: full editor at touch density', () => {
    expect(capabilitiesFor('tablet', off)).toEqual({
      layout: 'full',
      density: 'touch',
      editSketches: true,
      editFeatures: true,
      editValues: true,
      editDrawings: true,
    });
  });
  it('phone: review layout, nothing editable yet', () => {
    expect(capabilitiesFor('phone', off)).toEqual({
      layout: 'review',
      density: 'touch',
      editSketches: false,
      editFeatures: false,
      editValues: false,
      editDrawings: false,
    });
  });
  it('phone with the full editor behaves as a tablet; the setting is ignored elsewhere', () => {
    const on = { fullEditor: true };
    expect(capabilitiesFor('phone', on)).toEqual(capabilitiesFor('tablet', off));
    expect(capabilitiesFor('desktop', on)).toEqual(capabilitiesFor('desktop', off));
    expect(capabilitiesFor('tablet', on)).toEqual(capabilitiesFor('tablet', off));
  });
  it('only the phone offers the choice; the kernel still boots on edit there', () => {
    expect(policyFor('phone').fullEditorOptional).toBe(true);
    expect(policyFor('tablet').fullEditorOptional).toBe(false);
    expect(policyFor('phone').kernelBoot).toBe('onEdit');
  });
});
