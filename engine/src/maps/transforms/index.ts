import type { ParsedEDI } from '../../types/jedi';
import { transformCevapd204 } from './cevapd-204';

export type CustomTransformFn = (parsed: ParsedEDI) => Record<string, unknown>;

/** Registry of partner-specific custom transforms keyed by transform ID. */
export const customTransforms: Record<string, CustomTransformFn> = {
  'cevapd-204': transformCevapd204,
};
