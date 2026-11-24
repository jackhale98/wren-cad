import type { ExtrudeFeature, Feature, MeshBuffers, SketchResult } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import {
  extrudePrism,
  featureEffect,
  hasSolidPreview,
  isOwnFace,
  ownedFaces,
} from './feature-effect';

const f = (x: Record<string, unknown>) => ({ suppressed: false, name: 'x', ...x }) as Feature;

describe('kinds with an exact preview solid (slice 2e.2)', () => {
  it('the solid makers have one; modifiers, copies, holes and references do not', () => {
    for (const type of ['extrude', 'revolve', 'sweep', 'loft', 'primitive']) {
      expect(hasSolidPreview(f({ id: 'a', type, op: 'cut' })), type).toBe(true);
    }
    for (const type of [
      'sketch',
      'fillet',
      'chamfer',
      'shell',
      'draft',
      'hole',
      'boolean',
      'mirror',
      'linearPattern',
      'circularPattern',
      'pushPull',
      'import',
      'plane',
      'axis',
      'point',
      'thread',
    ]) {
      expect(hasSolidPreview(f({ id: 'a', type })), type).toBe(false);
    }
  });
});

describe('effect by feature', () => {
  it('material makers follow their operation', () => {
    expect(featureEffect(f({ id: 'a', type: 'extrude', op: 'new' }))).toBe('add');
    expect(featureEffect(f({ id: 'a', type: 'extrude', op: 'add' }))).toBe('add');
    expect(featureEffect(f({ id: 'a', type: 'extrude', op: 'cut' }))).toBe('cut');
    expect(featureEffect(f({ id: 'a', type: 'revolve', op: 'cut' }))).toBe('cut');
    expect(featureEffect(f({ id: 'a', type: 'boolean', op: 'cut' }))).toBe('cut');
    expect(featureEffect(f({ id: 'a', type: 'sweep', op: 'add' }))).toBe('add');
    expect(featureEffect(f({ id: 'a', type: 'primitive', op: 'new' }))).toBe('add');
    expect(featureEffect(f({ id: 'a', type: 'extrude', op: 'intersect' }))).toBe('modify');
  });
  it('holes cut; fillet, chamfer, draft, shell and push/pull modify', () => {
    expect(featureEffect(f({ id: 'a', type: 'hole' }))).toBe('cut');
    for (const type of ['fillet', 'chamfer', 'draft', 'shell', 'pushPull'])
      expect(featureEffect(f({ id: 'a', type })), type).toBe('modify');
  });
  it('features that make no faces of their own tint nothing', () => {
    for (const type of ['sketch', 'plane', 'axis', 'point', 'thread', 'mirror', 'linearPattern'])
      expect(featureEffect(f({ id: 'a', type })), type).toBeNull();
  });
});

describe('which faces a feature owns (persistent name forms)', () => {
  const names = [
    'FA:start', // extrude caps and sides
    'FA:end',
    'FA:side(SK:e(e1))',
    'FB:fillet(edge(FA:end|FA:side(SK:e(e1))))', // fillet faces name the edge they round
    'FB:chamfer(edge(FA:start|FA:side(SK:e(e2))))',
    'FC:face(FB:face#0)', // boolean tool faces
    'FD:face.top#0', // primitive faces
    'FD:fillet(FD:vertex(x,y,z))', // corner blend
    'FAB:start', // another id sharing a prefix
    'FE:unnamed#3',
    'S1:region(e1,e2)',
  ];
  const bodies = [{ id: 'B', mesh: { faceNames: names } }];
  const own = (id: string) => ownedFaces(bodies, id).flatMap((b) => b.faces);

  it('extrude: caps and sides', () => expect(own('A')).toEqual([0, 1, 2]));
  it('fillet and chamfer: the blends, not the faces they trim', () => {
    expect(own('B')).toEqual([3, 4]);
  });
  it('boolean tool faces, primitive faces and corner blends', () => {
    expect(own('C')).toEqual([5]);
    expect(own('D')).toEqual([6, 7]);
    expect(own('E')).toEqual([9]);
  });
  it('an id that only shares a prefix does not match; nothing owned gives no entry', () => {
    expect(isOwnFace('FAB:start', 'A')).toBe(false);
    expect(own('AB')).toEqual([8]);
    expect(ownedFaces(bodies, 'ZZ')).toEqual([]);
  });
  it('lists every body that holds faces of the feature', () => {
    const two = [
      { id: 'B1', mesh: { faceNames: ['FA:start'] } },
      { id: 'B2', mesh: { faceNames: ['FQ:start'] } },
      { id: 'B3', mesh: { faceNames: ['FA:end', 'FQ:end'] } },
    ];
    expect(ownedFaces(two, 'A')).toEqual([
      { bodyId: 'B1', faces: [0] },
      { bodyId: 'B3', faces: [0] },
    ]);
  });
});

const region = (name: string): { name: string; mesh: MeshBuffers } => ({
  name,
  mesh: { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) } as MeshBuffers,
});
const sketch = (z: [number, number, number], ...names: string[]): SketchResult =>
  ({
    featureId: 'SK',
    curves: [],
    regions: names.map(region),
    frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z },
  }) as SketchResult;
const extrude = (over: Partial<ExtrudeFeature>): ExtrudeFeature => ({
  id: 'X',
  type: 'extrude',
  name: 'Extrude',
  suppressed: false,
  profile: [{ name: 'R1', kind: 'region' }],
  direction: 'normal',
  end: { kind: 'blind', depth: '10 mm' },
  op: 'add',
  ...over,
});

describe('blind extrude volume', () => {
  const sketches = [sketch([0, 0, 1], 'R1', 'R2')];
  it('normal: along the sketch normal, tinted add', () => {
    const p = extrudePrism(extrude({}), sketches, 10, false);
    expect(p).toMatchObject({ direction: [0, 0, 1], distance: 10, effect: 'add' });
    expect(p?.offset).toBeUndefined();
  });
  it('reverse cut goes against the normal and is tinted cut', () => {
    const p = extrudePrism(extrude({ direction: 'reverse', op: 'cut' }), sketches, 4, false);
    expect(p).toMatchObject({ direction: [0, 0, -1], distance: 4, effect: 'cut' });
  });
  it('symmetric starts half the depth behind the profile', () => {
    const p = extrudePrism(extrude({ direction: 'symmetric' }), sketches, 10, false);
    expect(p).toMatchObject({ direction: [0, 0, 1], distance: 10, offset: -5 });
  });
  it('every profile region is swept', () => {
    const p = extrudePrism(
      extrude({
        profile: [
          { name: 'R1', kind: 'region' },
          { name: 'R2', kind: 'region' },
        ],
      }),
      sketches,
      3,
      false,
    );
    expect(p?.regions).toHaveLength(2);
  });
  it('shows nothing where it would not be exact', () => {
    expect(extrudePrism(extrude({ end: { kind: 'throughAll' } }), sketches, 10, false)).toBeNull();
    expect(
      extrudePrism(
        extrude({ end: { kind: 'upTo', target: { name: 'F:end', kind: 'face' } } }),
        sketches,
        null,
        false,
      ),
    ).toBeNull();
    expect(extrudePrism(extrude({}), sketches, 10, true)).toBeNull(); // drafted
    expect(extrudePrism(extrude({ op: 'intersect' }), sketches, 10, false)).toBeNull();
    expect(extrudePrism(extrude({}), sketches, 0, false)).toBeNull();
    expect(extrudePrism(extrude({}), sketches, null, false)).toBeNull();
    expect(
      extrudePrism(extrude({ profile: [{ name: 'GONE', kind: 'region' }] }), sketches, 10, false),
    ).toBeNull();
    expect(
      extrudePrism(
        extrude({
          profile: [
            { name: 'R1', kind: 'region' },
            { name: 'R9', kind: 'region' },
          ],
        }),
        [sketch([0, 0, 1], 'R1'), sketch([1, 0, 0], 'R9')],
        10,
        false,
      ),
    ).toBeNull(); // regions on different planes
  });
});
