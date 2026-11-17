/**
 * Component declarations for Conjure. System-free on purpose: the editor
 * imports this module too.
 */
import { createComponent, Types } from '@iwsdk/core';

/** Marks a mesh as a playable part (of the creation, or of an area of an endless world). */
export const ConjurePart = createComponent('ConjurePart', {
  uid: { type: Types.Int32, default: 0 },
});
