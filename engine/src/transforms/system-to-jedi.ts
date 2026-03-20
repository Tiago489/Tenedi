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
    const value = _.get(systemJson, mapping.systemPath);
    if (value === undefined || value === null) continue;

    // jediPath format: "b2.b2_element_01" — tag is the first path component uppercased
    const parts = mapping.jediPath.split('.');
    const tag = parts[0].toUpperCase();
    const elementPart = parts[parts.length - 1];
    const elementMatch = elementPart.match(/_element_(\d+)$/);
    if (!elementMatch) continue;

    const elementIndex = parseInt(elementMatch[1], 10);

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
