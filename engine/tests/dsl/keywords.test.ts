import { mapKeyword } from '../../src/dsl/keywords/map';
import { concatKeyword } from '../../src/dsl/keywords/concat';
import { lookupKeyword } from '../../src/dsl/keywords/lookup';
import { exprKeyword } from '../../src/dsl/keywords/expr';
import { tokenize } from '../../src/dsl/tokenizer';
import { emitJSONata } from '../../src/dsl/emitter';

describe('Individual keywords', () => {
  test('mapKeyword.aiGeneratable is true', () => {
    expect(mapKeyword.aiGeneratable).toBe(true);
  });

  test('exprKeyword.aiGeneratable is false', () => {
    expect(exprKeyword.aiGeneratable).toBe(false);
  });

  test('concatKeyword parses separator and sources correctly', () => {
    const tokens = tokenize('$concat "-" firstName lastName to fullName');
    const { node } = concatKeyword.parse(tokens, 0);
    expect(node.sources).toEqual(['firstName', 'lastName']);
    expect(node.separator).toBe('-');
    expect(node.target).toBe('fullName');
  });

  test('lookupKeyword parses tableName, source, target', () => {
    const tokens = tokenize('$lookup ServiceTable code to label');
    const { node } = lookupKeyword.parse(tokens, 0);
    expect(node.tableName).toBe('ServiceTable');
    expect(node.source).toBe('code');
    expect(node.target).toBe('label');
  });

  test('emitJSONata map node produces correct output', () => {
    const node = { type: 'map' as const, source: 'a', target: 'x' };
    const out = emitJSONata(node);
    expect(out).toContain('"x"');
    expect(out).toContain('`a`');
  });

  test('emitJSONata lookup node produces $lookup', () => {
    const node = { type: 'lookup' as const, tableName: 'MyTable', source: 'code', target: 'label' };
    const out = emitJSONata(node);
    expect(out).toContain('$lookup($MyTable');
    expect(out).toContain('`code`');
  });

  test('emitJSONata overwrite node produces $last', () => {
    const node = { type: 'overwrite' as const, source: 'arr', target: 'last' };
    const out = emitJSONata(node);
    expect(out).toContain('$last(`arr`)');
  });

  test('emitJSONata sum_of node produces $sum', () => {
    const node = { type: 'sum_of' as const, source: 'amounts', target: 'total' };
    const out = emitJSONata(node);
    expect(out).toContain('$sum(`amounts`)');
  });
});
