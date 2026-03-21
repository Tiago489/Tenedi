import _ from 'lodash';
import pino from 'pino';
import type { RawSegment } from '../types/jedi';
import type { TransformMap } from '../types/maps';

const logger = pino({ name: 'system-to-jedi' });

export function systemToJedi(systemJson: Record<string, unknown>, map: TransformMap): RawSegment[] {
  // segTag → elementIndex → value
  const segMap = new Map<string, Map<number, string>>();
  // Preserve insertion order
  const segOrder = new Set<string>();

  for (const mapping of map.mappings) {
    const rawValue = _.get(systemJson, mapping.systemPath);
    const value = rawValue !== undefined && rawValue !== null ? rawValue : mapping.default;
    if (value === undefined || value === null) continue;

    // jediPath formats supported:
    //   "b2.b2_element_01"           — flat (legacy)
    //   "heading.b1.b1_element_01"   — section-prefixed
    // Tag is derived from the element key prefix (before _element_), not parts[0],
    // so both formats produce the correct uppercase segment tag.
    const elementPart = mapping.jediPath.split('.').at(-1)!;
    const elementMatch = elementPart.match(/^(.+)_element_(\d+)$/);
    if (!elementMatch) continue;

    const tag = elementMatch[1].toUpperCase();
    const elementIndex = parseInt(elementMatch[2], 10);

    if (!segMap.has(tag)) {
      segMap.set(tag, new Map());
      segOrder.add(tag);
    }

    segMap.get(tag)!.set(elementIndex, String(value));
  }

  // Materialise into ordered RawSegment array
  const segments: RawSegment[] = [];
  for (const tag of segOrder) {
    const elementMap = segMap.get(tag)!;
    const maxIdx = Math.max(...elementMap.keys());
    const elements: string[] = new Array(maxIdx).fill('');
    for (const [idx, val] of elementMap.entries()) {
      elements[idx - 1] = val;
    }
    segments.push({ tag, elements });
  }

  logger.debug({ segmentCount: segments.length }, 'systemToJedi complete');
  return segments;
}
