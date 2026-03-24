import fs from 'fs';
import path from 'path';
import pino from 'pino';
import type { TransformMap } from '../types/maps';
import { config } from '../config/index';

const logger = pino({ name: 'map-registry' });

interface MapEntry {
  current: TransformMap;
  history: TransformMap[];
}

export class MapRegistry {
  private store = new Map<string, MapEntry>();

  private key(transactionSet: string, direction: 'inbound' | 'outbound'): string {
    return `${transactionSet}:${direction}`;
  }

  /** Parse map ID to determine storage key. Partner-specific IDs like "cevapd-204-inbound"
   *  store under "cevapd-204:inbound"; simple IDs like "seed-204-inbound" use default "204:inbound". */
  private partnerKeyFromId(id: string, transactionSet: string, direction: 'inbound' | 'outbound'): string {
    const parts = id.split('-');
    // Partner-specific: {partnerId}-{transactionSet}-{direction} (3+ parts where middle matches txSet)
    // Exclude conventional "seed-" prefix which is used for default maps
    if (parts.length >= 3 && parts[0] !== 'seed') {
      const last = parts[parts.length - 1];
      const middle = parts.slice(1, parts.length - 1).join('-');
      if (middle === transactionSet && last === direction) {
        return parts[0].toLowerCase() + '-' + transactionSet + ':' + direction;
      }
    }
    return this.key(transactionSet, direction);
  }

  publish(mapInput: Omit<TransformMap, 'version' | 'publishedAt'>): TransformMap {
    const k = this.partnerKeyFromId(mapInput.id, mapInput.transactionSet, mapInput.direction);
    const existing = this.store.get(k);
    const version = existing ? existing.current.version + 1 : 1;

    const map: TransformMap = { ...mapInput, version, publishedAt: new Date() };

    const entry: MapEntry = existing
      ? { current: map, history: [...existing.history, existing.current] }
      : { current: map, history: [] };

    // Atomic reference swap — synchronous in Node.js single-threaded runtime.
    // In-flight jobs using the old map via closure continue normally.
    this.store.set(k, entry);
    this.persistToDisk(map);

    logger.info({ transactionSet: map.transactionSet, direction: map.direction, version, key: k }, 'Map published');
    return map;
  }

  get(transactionSet: string, direction: 'inbound' | 'outbound'): TransformMap {
    const entry = this.store.get(this.key(transactionSet, direction));
    if (!entry) throw new Error(`No map found for ${transactionSet} ${direction}`);
    return entry.current;
  }

  getForPartner(transactionSet: string, direction: 'inbound' | 'outbound', partnerId: string): TransformMap {
    if (partnerId) {
      const partnerKey = partnerId.toLowerCase() + '-' + transactionSet + ':' + direction;
      const entry = this.store.get(partnerKey);
      if (entry) return entry.current;
    }
    return this.get(transactionSet, direction);
  }

  getVersion(transactionSet: string, direction: 'inbound' | 'outbound', version: number): TransformMap | undefined {
    const entry = this.store.get(this.key(transactionSet, direction));
    if (!entry) return undefined;
    if (entry.current.version === version) return entry.current;
    return entry.history.find(m => m.version === version);
  }

  rollback(transactionSet: string, direction: 'inbound' | 'outbound', version: number): TransformMap {
    const entry = this.store.get(this.key(transactionSet, direction));
    if (!entry) throw new Error(`No map found for ${transactionSet} ${direction}`);

    const target = entry.history.find(m => m.version === version);
    if (!target) throw new Error(`Version ${version} not found for ${transactionSet} ${direction}`);

    const newEntry: MapEntry = {
      current: { ...target, version: entry.current.version + 1, publishedAt: new Date() },
      history: [...entry.history, entry.current],
    };

    this.store.set(this.key(transactionSet, direction), newEntry);
    this.persistToDisk(newEntry.current);

    logger.info({ transactionSet, direction, rolledBackTo: version }, 'Map rolled back');
    return newEntry.current;
  }

  list(): Array<{ transactionSet: string; direction: string; version: number; publishedAt: Date }> {
    return Array.from(this.store.values()).map(e => ({
      transactionSet: e.current.transactionSet,
      direction: e.current.direction,
      version: e.current.version,
      publishedAt: e.current.publishedAt,
    }));
  }

  /** Full registry dump for syncing to Django ops platform. */
  registryDump(): Array<{
    id: string;
    storeKey: string;
    transactionSet: string;
    direction: string;
    version: number;
    customTransformId?: string;
    dslSource?: string;
    partnerKey: string | null;
  }> {
    return Array.from(this.store.entries()).map(([storeKey, entry]) => {
      const m = entry.current;
      // Extract partner from store key: "cevapd-204:inbound" → "cevapd", "204:inbound" → null
      const colonIdx = storeKey.indexOf(':');
      const prefix = storeKey.slice(0, colonIdx);
      // If prefix contains a hyphen, it's "{partner}-{txSet}"; otherwise it's just "{txSet}"
      const hyphenIdx = prefix.indexOf('-');
      const partnerKey = hyphenIdx >= 0 ? prefix.slice(0, hyphenIdx) : null;

      return {
        id: m.id,
        storeKey,
        transactionSet: m.transactionSet,
        direction: m.direction,
        version: m.version,
        customTransformId: m.customTransformId,
        dslSource: m.dslSource,
        partnerKey,
      };
    });
  }

  loadFromDisk(): void {
    const dbPath = config.maps.dbPath;
    if (!fs.existsSync(dbPath)) return;

    const files = fs.readdirSync(dbPath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dbPath, file), 'utf-8')) as TransformMap;
        data.publishedAt = new Date(data.publishedAt);
        const k = this.key(data.transactionSet, data.direction);
        const existing = this.store.get(k);
        if (!existing || existing.current.version < data.version) {
          this.store.set(k, { current: data, history: existing ? [existing.current, ...existing.history] : [] });
        }
      } catch (err: unknown) {
        logger.warn({ file, err: (err as Error).message }, 'Failed to load map from disk');
      }
    }
    logger.info({ count: files.length }, 'Maps loaded from disk');
  }

  private persistToDisk(map: TransformMap): void {
    try {
      const dbPath = config.maps.dbPath;
      fs.mkdirSync(dbPath, { recursive: true });
      const filename = path.join(dbPath, `${map.transactionSet}_${map.direction}_v${map.version}.json`);
      fs.writeFileSync(filename, JSON.stringify(map, null, 2));
    } catch (err: unknown) {
      logger.error({ err: (err as Error).message }, 'Failed to persist map to disk');
    }
  }
}

export const mapRegistry = new MapRegistry();
