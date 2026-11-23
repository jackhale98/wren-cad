import {
  type DimensionLabel,
  fontSizeFor,
  labelText,
  layoutDimensionLabel,
  type Primitive,
  textWidth,
} from '@wren-cad/drawing/annotation';

const f = (n: number): string => String(Math.round(n * 1000) / 1000);

function node(p: Primitive, key: number) {
  switch (p.kind) {
    case 'text':
      return (
        <text
          key={key}
          x={f(p.at[0])}
          y={f(-p.at[1])}
          fontSize={f(fontSizeFor(p.height))}
          textLength={f(textWidth(p.text, p.height))}
          lengthAdjust="spacingAndGlyphs"
          fill="currentColor"
          stroke="none"
        >
          {p.text}
        </text>
      );
    case 'line':
      return (
        <line
          key={key}
          vectorEffect="non-scaling-stroke"
          x1={f(p.a[0])}
          y1={f(-p.a[1])}
          x2={f(p.b[0])}
          y2={f(-p.b[1])}
        />
      );
    case 'polyline':
      return (
        <polyline
          key={key}
          vectorEffect="non-scaling-stroke"
          points={p.points.map((q) => `${f(q[0])},${f(-q[1])}`).join(' ')}
          {...(p.closed ? { 'data-closed': '' } : {})}
          fill="none"
        />
      );
    case 'arc': {
      const at = (a: number) =>
        `${f(p.center[0] + p.radius * Math.cos(a))} ${f(-(p.center[1] + p.radius * Math.sin(a)))}`;
      const large = p.end - p.start > Math.PI + 1e-9 ? 1 : 0;
      return (
        <path
          key={key}
          vectorEffect="non-scaling-stroke"
          d={`M${at(p.start)}A${f(p.radius)} ${f(p.radius)} 0 ${large} 0 ${at(p.end)}`}
          fill="none"
        />
      );
    }
    case 'fill':
      return (
        <path
          key={key}
          d={p.loops.map((l) => `M${l.map((q) => `${f(q[0])} ${f(-q[1])}`).join('L')}Z`).join('')}
          fill="currentColor"
          stroke="none"
        />
      );
    default:
      return null;
  }
}

export interface LabelSvgProps {
  label: DimensionLabel;
  /** Text height of the drawing (sheet mm); everything scales from it. */
  h: number;
  /** CSS pixels per sheet mm: the picture's size follows from the label's extent. */
  scale: number;
  className?: string;
  testId?: string;
  /** A picture beside its own caption: hidden from assistive technology. */
  decorative?: boolean;
}

/**
 * A dimension label drawn from the sheet's own layout (`layoutDimensionLabel`): the same
 * primitives the SVG, PDF and DXF exports draw, so a preview cannot disagree with the sheet.
 */
export function LabelSvg({ label, h, scale, className, testId, decorative }: LabelSvgProps) {
  const block = layoutDimensionLabel(label, h);
  const pad = 0.5 * h;
  const w = block.width + 2 * pad;
  const top = block.box.max[1] + pad;
  const bottom = block.box.min[1] - pad;
  const hh = top - bottom;
  return (
    <svg
      role="img"
      aria-label={labelText(label)}
      aria-hidden={decorative || undefined}
      data-testid={testId}
      data-text={labelText(label)}
      viewBox={`${f(-pad)} ${f(-top)} ${f(w)} ${f(hh)}`}
      width={Math.ceil(w * scale)}
      height={Math.ceil(hh * scale)}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {block.prims.map((p, i) => node(p, i))}
    </svg>
  );
}
