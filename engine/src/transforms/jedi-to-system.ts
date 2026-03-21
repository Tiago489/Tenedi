import { get, set } from 'lodash';
import pino from 'pino';
import type { JediTransaction } from '../types/jedi';
import { type TransformMap, type FieldMapping, TransformFunctions } from '../types/maps';

const logger = pino({ name: 'jedi-to-system' });

export function jediToSystem(tx: JediTransaction, map: TransformMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of map.mappings) {
    try {
      const rawValue = get(tx, mapping.jediPath);
      applyMapping(rawValue, result, mapping);
    } catch (err: unknown) {
      logger.warn({ jediPath: mapping.jediPath, err: (err as Error).message }, 'Mapping error');
    }
  }

  return result;
}

function applyMapping(
  rawValue: unknown,
  result: Record<string, unknown>,
  mapping: FieldMapping,
): void {
  if (rawValue === undefined || rawValue === null) {
    if (mapping.default !== undefined) {
      set(result, mapping.systemPath, mapping.default);
    }
    return;
  }

  let value: unknown = rawValue;

  if (mapping.transform) {
    const fn = TransformFunctions[mapping.transform];
    if (fn) {
      value = (fn as (v: string) => unknown)(String(rawValue));
    } else {
      logger.warn({ transform: mapping.transform }, 'Unknown transform function');
    }
  }

  set(result, mapping.systemPath, value);
}
