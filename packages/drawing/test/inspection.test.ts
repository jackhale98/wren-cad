/**
 * Inspection dimensions (ISO 129-1): the value and its tolerance in a frame with rounded ends,
 * drawn by the label layout and so by every export (SVG, PDF, DXF), never over the dimension line.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DisplayItem, DisplayList, Primitive } from '../src/annotation';
import {
  dimensionLabel,
  labelText,
  layoutDimensionLabel,
  linearLayout,
  textWidth,
} from '../src/annotation';
import { renderDxfR12, renderDxfR2000 } from '../src/dxf';
import { renderPdf } from '../src/pdf';
import { stylePreset } from '../src/style';
import { renderSvg } from '../src/svg';

const style = stylePreset('iso');
const numbers = style.numbers;
const dim = style.dimension;
const h = 3.5;

type Arc = Extract<Primitive, { kind: 'arc' }>;
type Line = Extract<Primitive, { kind: 'line' }>;
type Text = Extract<Primitive, { kind: 'text' }>;

type LabelInput = Parameters<typeof dimensionLabel>[0];
const label = (over: LabelInput) => layoutDimensionLabel(dimensionLabel(over), h);
const base = { value: 25, quantity: 'length' as const, numbers };
const arcsOf = (prims: Primitive[]) => prims.filter((p): p is Arc => p.kind === 'arc');
const textsOf = (prims: Primitive[]) => prims.filter((p): p is Text => p.kind === 'text');

describe('inspection label', () => {
  it('frames the value: two lines and two semicircular ends of equal radius', () => {
    const plain = label(base);
    const t = label({ ...base, inspection: true });
    const arcs = arcsOf(t.prims);
    const lines = t.prims.filter((p): p is Line => p.kind === 'line');
    expect(arcs).toHaveLength(2);
    expect(lines).toHaveLength(2);
    expect(arcs[0]?.radius).toBeCloseTo(arcs[1]?.radius ?? 0);
    for (const a of arcs) expect(a.end - a.start).toBeCloseTo(Math.PI);
    expect(t.width).toBeGreaterThan(plain.width + (arcs[0]?.radius ?? 0));
    expect(t.box.max[1]).toBeGreaterThan(plain.box.max[1]);
    const text = textsOf(t.prims)[0] as Text;
    expect(text.at[0]).toBeGreaterThan(0);
    expect(text.at[0] + textWidth(text.text, h)).toBeLessThan(t.width);
  });

  it('keeps the text corners inside the end arcs', () => {
    const t = label({ ...base, inspection: true });
    const left = arcsOf(t.prims).find((a) => a.start > 0) as Arc;
    const text = textsOf(t.prims)[0] as Text;
    for (const y of [0, h]) {
      expect(Math.hypot(text.at[0] - left.center[0], y - left.center[1])).toBeLessThan(left.radius);
    }
  });

  it('encloses the stack, but not the count, the prefix or the suffix', () => {
    const t = label({
      ...base,
      size: 'diameter',
      tolerance: { kind: 'bilateral', upper: 0.2, lower: -0.1 },
      text: { prefix: 'A ', suffix: 'TYP', count: true },
      count: 4,
      inspection: true,
    });
    const texts = textsOf(t.prims);
    const arcs = arcsOf(t.prims);
    const left = Math.min(...arcs.map((a) => a.center[0] - a.radius));
    const right = Math.max(...arcs.map((a) => a.center[0] + a.radius));
    const lead = texts.find((x) => x.text.startsWith('4×')) as Text;
    expect(lead.at[0] + textWidth(lead.text, h)).toBeLessThanOrEqual(left + 1e-9);
    const suffix = texts.find((x) => x.text === 'TYP') as Text;
    expect(suffix.at[0]).toBeGreaterThanOrEqual(right);
    const inside = texts.filter((x) => x !== lead && x !== suffix);
    expect(inside.length).toBeGreaterThanOrEqual(3);
    for (const x of inside) {
      expect(x.at[0]).toBeGreaterThan(left);
      expect(x.at[0] + textWidth(x.text, x.height)).toBeLessThan(right);
    }
    expect(t.box.max[0]).toBeGreaterThan(right);
  });

  it('draws the basic box inside the frame; a reference has parentheses and no frame', () => {
    const basic = label({ ...base, tolerance: { kind: 'basic' }, inspection: true });
    expect(basic.prims.some((p) => p.kind === 'polyline' && p.closed)).toBe(true);
    expect(arcsOf(basic.prims)).toHaveLength(2);
    const refIn = { ...base, tolerance: { kind: 'reference' as const }, inspection: true };
    expect(arcsOf(label(refIn).prims)).toHaveLength(0);
    expect(labelText(dimensionLabel(refIn))).toBe('(25)');
    const plainBasic = label({ ...base, tolerance: { kind: 'basic' } });
    expect(arcsOf(plainBasic.prims)).toHaveLength(0);
    expect(plainBasic.prims.some((p) => p.kind === 'polyline' && p.closed)).toBe(true);
  });

  it('flattens for search as ⟨…⟩ after the lead text', () => {
    const l = dimensionLabel({
      ...base,
      text: { prefix: '4×' },
      tolerance: { kind: 'symmetric', value: 0.1 },
      inspection: true,
    });
    expect(labelText(l)).toBe('4× ⟨25 ±0.1⟩');
  });
});

describe('inspection frame in a linear dimension', () => {
  const run = (span: number) =>
    linearLayout({
      p1: [0, 0],
      p2: [span, 0],
      dir: [1, 0],
      across: 15,
      label: label({ ...base, inspection: true }),
      style: dim,
      h,
    });

  it('never overlaps the dimension line or the arrowheads', () => {
    const g = run(60);
    const arcs = arcsOf(g.prims);
    expect(arcs).toHaveLength(2);
    const yTop = Math.max(...arcs.map((a) => a.center[1] + a.radius));
    const yBottom = Math.min(...arcs.map((a) => a.center[1] - a.radius));
    const left = Math.min(...arcs.map((a) => a.center[0] - a.radius));
    const right = Math.max(...arcs.map((a) => a.center[0] + a.radius));
    const dimLines = g.prims.filter(
      (p): p is Line =>
        p.kind === 'line' && Math.abs(p.a[1] - 15) < 1e-9 && Math.abs(p.b[1] - 15) < 1e-9,
    );
    if (yBottom <= 15 && 15 <= yTop) {
      for (const l of dimLines) {
        const lo = Math.min(l.a[0], l.b[0]);
        const hi = Math.max(l.a[0], l.b[0]);
        expect(hi <= left + 1e-9 || lo >= right - 1e-9).toBe(true);
      }
    }
    expect(left).toBeGreaterThan(dim.arrow.length);
    expect(right).toBeLessThan(60 - dim.arrow.length);
  });

  it('moves the arrows outside when the frame does not fit between the extension lines', () => {
    expect(run(12).arrowsOutside).toBe(true);
  });
});

describe('inspection frame in every export', () => {
  const lab = label({ ...base, inspection: true });
  const m = (v: [number, number]): [number, number] => [v[0] + 20, v[1] + 20];
  const list: DisplayList = {
    width: 100,
    height: 50,
    items: lab.prims.flatMap((p): DisplayItem[] => {
      switch (p.kind) {
        case 'text':
          return [{ ...p, at: m(p.at), role: 'dimension' }];
        case 'line':
          return [{ ...p, a: m(p.a), b: m(p.b), role: 'dimension' }];
        case 'arc':
          return [{ ...p, center: m(p.center), role: 'dimension' }];
        default:
          return [];
      }
    }),
  };
  const st = { lineGroup: 'iso-0.5' as const, lineWidths: style.lineWidths };

  it('SVG: the frame is four strokes next to the text', () => {
    const svg = renderSvg(list, st);
    expect((svg.match(/<path|<line|<polyline/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(svg).toMatch(/A\d/);
    expect(svg).toContain('25');
  });
  it('DXF R12 and R2000: two ARC and two LINE entities', () => {
    for (const out of [renderDxfR12(list, st, {}), renderDxfR2000(list, st, {})]) {
      const rows = out.split('\n').map((l) => l.trim());
      expect(rows.filter((l) => l === 'ARC')).toHaveLength(2);
      expect(rows.filter((l) => l === 'LINE')).toHaveLength(2);
    }
  });
  it('PDF: the frame is stroked as curves and lines', () => {
    const font = new Uint8Array(
      readFileSync(join(__dirname, '../assets/fonts/osifont-lgpl3fe.ttf')),
    );
    const bytes = renderPdf([{ list, style: st }], { font, title: 't', compress: false });
    const text = Array.from(bytes, (c) => String.fromCharCode(c)).join('');
    expect((text.match(/ c /g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((text.match(/ l /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
