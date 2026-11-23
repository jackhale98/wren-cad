/**
 * The displayed document: while an inspector pick field takes edges or faces, the model is rolled
 * back to just before that feature (as Onshape does), so picks name the feature's input geometry.
 * The same rollback serves "Before" (change preview, ADR-103): the model without the feature being
 * edited, while the key or chip is held.
 */

import type { Part, WrenDoc } from '@wren-cad/contracts';
import type { Workbench } from './workbench';

export function viewDoc(wb: Workbench): WrenDoc {
  // The active configuration's effective document (M3.7); Default is the stored one itself.
  const doc = wb.config.resolved().doc;
  const u = wb.ui.get();
  const p = u.picking;
  const part = doc.parts[0];
  if (!part) return doc;
  if (u.before && u.featureId) {
    const idx = part.features.findIndex((f) => f.id === u.featureId);
    if (idx >= 0 && idx < part.rollbackIndex) return rolledBack(wb, doc, part, idx);
  }
  if (!p) return doc;
  const kinds = wb.pickAccepts()?.kinds ?? [];
  if (!kinds.some((k) => k === 'edge' || k === 'face' || k === 'vertex')) return doc;
  const idx = part.features.findIndex((f) => f.id === p.featureId);
  if (idx < 0 || idx >= part.rollbackIndex) return doc;
  return rolledBack(wb, doc, part, idx);
}

function rolledBack(wb: Workbench, doc: WrenDoc, part: Part, idx: number): WrenDoc {
  const memo = wb.viewMemo;
  if (memo && memo.doc === doc && memo.index === idx) return memo.out;
  const out = { ...doc, parts: [{ ...part, rollbackIndex: idx }, ...doc.parts.slice(1)] };
  wb.viewMemo = { doc, index: idx, out };
  return out;
}
