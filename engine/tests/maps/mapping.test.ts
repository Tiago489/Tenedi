import fs from 'fs';
import path from 'path';
import { parseEDI } from '../../src/transforms/edi-parser';
import { jediToSystem } from '../../src/transforms/jedi-to-system';
import { applyProfile, type ClientProfile } from '../../src/transforms/profile';
import { MapRegistry } from '../../src/maps/registry';
import { customTransforms } from '../../src/maps/transforms/index';
import type { TransformMap, FieldMapping } from '../../src/types/maps';

// ── Fixture discovery (data-driven) ──────────────────────────────────────────
//
// Directory layout:
//   fixtures/{partner}/{variant}/input.edi + mapping.json + system.json
//   fixtures/{partner}/{variant}/profiles/{client}.json  (optional layer 2)
//
// Adding a new partner or fixture variant = new directory, zero code changes.

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface FixtureDir {
  name: string;
  dir: string;
  ediPath: string;
  mappingPath: string;
  systemPath: string;
  profilesDir: string;
}

function discoverFixtures(): FixtureDir[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  const results: FixtureDir[] = [];

  for (const partnerEntry of fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!partnerEntry.isDirectory()) continue;
    const partnerPath = path.join(FIXTURES_DIR, partnerEntry.name);

    for (const variantEntry of fs.readdirSync(partnerPath, { withFileTypes: true })) {
      if (!variantEntry.isDirectory()) continue;
      const dir = path.join(partnerPath, variantEntry.name);
      const f: FixtureDir = {
        name: `${partnerEntry.name}/${variantEntry.name}`,
        dir,
        ediPath: path.join(dir, 'input.edi'),
        mappingPath: path.join(dir, 'mapping.json'),
        systemPath: path.join(dir, 'system.json'),
        profilesDir: path.join(dir, 'profiles'),
      };
      if (fs.existsSync(f.ediPath) && fs.existsSync(f.mappingPath) && fs.existsSync(f.systemPath)) {
        results.push(f);
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

interface ProfileFixture {
  name: string;
  profile: ClientProfile;
  expected: Record<string, unknown>;
}

function discoverProfiles(profilesDir: string): ProfileFixture[] {
  if (!fs.existsSync(profilesDir)) return [];
  return fs.readdirSync(profilesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf-8'));
      return {
        name: path.basename(f, '.json'),
        profile: { client: data.client, fieldMappings: data.fieldMappings },
        expected: data.expected,
      };
    })
    .filter(p => p.expected);
}

function runTransform(fixture: FixtureDir): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(fixture.mappingPath, 'utf-8'));
  const edi = fs.readFileSync(fixture.ediPath, 'utf-8');
  const parsed = parseEDI(edi);

  // If mapping specifies a custom transform, use it instead of jediToSystem
  if (raw.customTransformId && customTransforms[raw.customTransformId]) {
    return customTransforms[raw.customTransformId](parsed);
  }

  const map: TransformMap = {
    id: raw.id,
    transactionSet: raw.transactionSet,
    direction: raw.direction,
    version: 1,
    publishedAt: new Date(),
    mappings: raw.mappings as FieldMapping[],
    dslSource: raw.dslSource,
  };
  const tx = parsed.interchange.functional_groups[0].transactions[0];
  return jediToSystem(tx, map);
}

// ── Layer 1: Map assertion (describe.each over fixture folders) ──────────────

const fixtures = discoverFixtures();

describe.each(fixtures)('Map assertion — $name', (fixture) => {
  let systemJson: Record<string, unknown>;
  let expectedSystem: Record<string, unknown>;

  beforeAll(() => {
    systemJson = runTransform(fixture);
    expectedSystem = JSON.parse(fs.readFileSync(fixture.systemPath, 'utf-8'));
  });

  test('transform output matches system.json', () => {
    expect(systemJson).toEqual(expectedSystem);
  });

  // ── Layer 2: Profile assertion (describe.each over profiles/) ────────────

  const profiles = discoverProfiles(fixture.profilesDir);

  if (profiles.length > 0) {
    describe.each(profiles)('Profile — $name', (prof) => {
      test('applyProfile output matches expected', () => {
        const result = applyProfile(systemJson, prof.profile);
        expect(result).toEqual(prof.expected);
      });
    });
  }
});

// ── applyProfile unit tests ──────────────────────────────────────────────────

describe('applyProfile', () => {
  const sampleSystem: Record<string, unknown> = {
    standardCarrierAlphaCode: 'CEVX',
    order: { secondaryRefNumber: 'BOL-99001', deadlineDate: '20260325' },
    packages: [{ weight: 1500 }],
  };

  test('correctly remaps fields per client profile', () => {
    const profile: ClientProfile = {
      client: 'test-client',
      fieldMappings: {
        carrier: 'standardCarrierAlphaCode',
        ref: 'order.secondaryRefNumber',
        weight: 'packages.0.weight',
      },
    };
    const result = applyProfile(sampleSystem, profile);
    expect(result).toEqual({ carrier: 'CEVX', ref: 'BOL-99001', weight: 1500 });
  });

  test('omits fields when systemJson path is missing', () => {
    const profile: ClientProfile = {
      client: 'sparse',
      fieldMappings: {
        carrier: 'standardCarrierAlphaCode',
        missing: 'nonexistent.path',
      },
    };
    const result = applyProfile(sampleSystem, profile);
    expect(result).toEqual({ carrier: 'CEVX' });
    expect(result).not.toHaveProperty('missing');
  });

  test('returns systemJson unchanged when no profile provided', () => {
    expect(sampleSystem).toEqual({
      standardCarrierAlphaCode: 'CEVX',
      order: { secondaryRefNumber: 'BOL-99001', deadlineDate: '20260325' },
      packages: [{ weight: 1500 }],
    });
  });
});

// ── Partner-specific registry lookup ─────────────────────────────────────────

describe('MapRegistry.getForPartner', () => {
  const registry = new MapRegistry();

  beforeAll(() => {
    registry.publish({
      id: 'seed-204-inbound',
      transactionSet: '204',
      direction: 'inbound',
      dslSource: '# default 204',
      mappings: [{ jediPath: 'heading.b2.b2_element_02', systemPath: 'standardCarrierAlphaCode' }],
    });
    registry.publish({
      id: 'cevapd-204-inbound',
      transactionSet: '204',
      direction: 'inbound',
      dslSource: '# cevapd 204',
      customTransformId: 'cevapd-204',
      mappings: [],
    });
  });

  test('returns cevapd map for CEVAPD partner', () => {
    expect(registry.getForPartner('204', 'inbound', 'CEVAPD').id).toBe('cevapd-204-inbound');
  });

  test('cevapd map has customTransformId', () => {
    expect(registry.getForPartner('204', 'inbound', 'CEVAPD').customTransformId).toBe('cevapd-204');
  });

  test('returns default map for unknown partner', () => {
    expect(registry.getForPartner('204', 'inbound', 'UNKNOWN').id).toBe('seed-204-inbound');
  });

  test('returns default map when partnerId is empty', () => {
    expect(registry.getForPartner('204', 'inbound', '').id).toBe('seed-204-inbound');
  });
});
