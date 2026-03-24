import { get } from 'lodash';
import pino from 'pino';

const logger = pino({ name: 'profile' });

export interface ClientProfile {
  client: string;
  fieldMappings: Record<string, string>;
}

/**
 * Remap systemJson fields according to a client profile.
 * Each key in fieldMappings is the client's desired field name;
 * each value is a dot-path into systemJson resolved with lodash get.
 * If no profile is provided, returns systemJson unchanged.
 */
export function applyProfile(systemJson: Record<string, unknown>, profile: ClientProfile): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [clientField, systemPath] of Object.entries(profile.fieldMappings)) {
    const value = get(systemJson, systemPath);
    if (value !== undefined) {
      result[clientField] = value;
    }
  }

  logger.debug({ client: profile.client, fields: Object.keys(result).length }, 'Profile applied');
  return result;
}
