/**
 * `@wren-cad/drawing/pmi` (M5a, ADR-100): STEP AP242 presentation PMI from the M4 layout code:
 * display items tessellated, text stroked with the drawing font's outlines, lifted onto annotation
 * planes. Worker-safe; loaded only by the kernel worker's STEP PMI export.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export {
  glyphContours,
  type StrokeFont,
  strokeFont,
  strokeText,
} from '../font/glyph-outlines';
export { profileLineAcross } from '../import/profile-line';
export * from './presentation';
