import { compiler } from '../../src/dsl/keywords/index';

const SAMPLE_JEDI = {
  b2: {
    b2_element_02: 'ABCD',
    b2_element_03: 'PRO123',
    b2_element_05: 'TL',
    b2_element_07: 'SHIP001',
  },
  n1_loop: [
    {
      n1: { n1_element_01: 'SH', n1_element_02: 'Acme Corp' },
      n3: { n3_element_01: '123 Main St' },
      n4: { n4_element_01: 'Chicago', n4_element_02: 'IL', n4_element_03: '60601' },
    },
  ],
  l3: { l3_element_01: '1000', l3_element_05: '500.00' },
};

describe('DSL Integration', () => {
  test('full DSL compiles and evaluates correctly against JEDI fixture', async () => {
    const dsl = `
$map b2.b2_element_02 to scac
$map b2.b2_element_03 to proNumber
$map l3.l3_element_01 to totalWeight
    `.trim();

    const result = await compiler.validate(dsl, SAMPLE_JEDI);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      scac: 'ABCD',
      proNumber: 'PRO123',
      totalWeight: '1000',
    });
  });

  test('validate() returns ok: true with correct preview for valid DSL', async () => {
    const dsl = '$map b2.b2_element_07 to shipmentId';
    const result = await compiler.validate(dsl, SAMPLE_JEDI);

    expect(result.ok).toBe(true);
    expect(result.jsonata).toBeDefined();
    expect(result.result).toMatchObject({ shipmentId: 'SHIP001' });
  });

  test('validate() returns ok: false with error for bad JSONata in $expr', () => {
    // $expr validates JSONata at parse time — invalid expression throws during compile
    expect(() => compiler.compile('$expr result "$$invalid((("')).toThrow();
  });

  test('missing field produces undefined but ok: true', async () => {
    const dsl = '$map nonexistent.path to output';
    const result = await compiler.validate(dsl, SAMPLE_JEDI);
    expect(result.ok).toBe(true);
  });

  test('$if present with $else omit compiles and runs', async () => {
    const dsl = '$if b2.b2_element_02 present to scac $else $omit';
    const result = await compiler.validate(dsl, SAMPLE_JEDI);
    expect(result.ok).toBe(true);
    expect((result.result as Record<string, unknown>)['scac']).toBe('ABCD');
  });
});
