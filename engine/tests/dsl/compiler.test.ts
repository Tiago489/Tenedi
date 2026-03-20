import { DSLCompiler } from '../../src/dsl/compiler';
import { mapKeyword } from '../../src/dsl/keywords/map';
import { ifElseKeyword } from '../../src/dsl/keywords/if-else';
import { concatKeyword } from '../../src/dsl/keywords/concat';
import { lookupKeyword } from '../../src/dsl/keywords/lookup';
import { overwriteKeyword } from '../../src/dsl/keywords/overwrite';
import { asKeyword } from '../../src/dsl/keywords/as';
import { sumOfKeyword } from '../../src/dsl/keywords/sum-of';
import { substringKeyword } from '../../src/dsl/keywords/substring';
import { exprKeyword } from '../../src/dsl/keywords/expr';

function makeCompiler(): DSLCompiler {
  return new DSLCompiler()
    .register(mapKeyword)
    .register(ifElseKeyword)
    .register(concatKeyword)
    .register(lookupKeyword)
    .register(overwriteKeyword)
    .register(asKeyword)
    .register(sumOfKeyword)
    .register(substringKeyword)
    .register(exprKeyword);
}

describe('DSLCompiler', () => {
  let compiler: DSLCompiler;

  beforeEach(() => { compiler = makeCompiler(); });

  test('$map compiles to key: value JSONata', () => {
    const out = compiler.compile('$map heading.b2 to shipment.scac');
    expect(out).toContain('"shipment.scac"');
    expect(out).toContain('`heading`');
  });

  test('$concat with separator produces correct & chain', () => {
    const out = compiler.compile('$concat " " firstName lastName to fullName');
    expect(out).toContain('"fullName"');
    expect(out).toContain('& " " &');
    expect(out).toContain('`firstName`');
    expect(out).toContain('`lastName`');
  });

  test('$lookup produces $lookup($TableName, x)', () => {
    const out = compiler.compile('$lookup ServiceTypeTable serviceCode to serviceDescription');
    expect(out).toContain('$lookup($ServiceTypeTable');
    expect(out).toContain('`serviceCode`');
    expect(out).toContain('"serviceDescription"');
  });

  test('$overwrite produces $last(x)', () => {
    const out = compiler.compile('$overwrite items to finalPrice');
    expect(out).toContain('$last(`items`)');
    expect(out).toContain('"finalPrice"');
  });

  test('$as number produces $number(x)', () => {
    const out = compiler.compile('$as number weight to weightNum');
    expect(out).toContain('$number(`weight`)');
  });

  test('$as string produces $string(x)', () => {
    const out = compiler.compile('$as string code to codeStr');
    expect(out).toContain('$string(`code`)');
  });

  test('$as uppercase produces $uppercase(x)', () => {
    const out = compiler.compile('$as uppercase name to nameUpper');
    expect(out).toContain('$uppercase(`name`)');
  });

  test('$as trimmed produces $trim(x)', () => {
    const out = compiler.compile('$as trimmed name to nameTrimmed');
    expect(out).toContain('$trim(`name`)');
  });

  test('$as date produces $toMillis(x, ...)', () => {
    const out = compiler.compile('$as date dateField to dateMs');
    expect(out).toContain('$toMillis(`dateField`');
  });

  test('$as timestamp produces $now()', () => {
    const out = compiler.compile('$as timestamp someField to ts');
    expect(out).toContain('$now()');
  });

  test('$if present $else $omit produces ternary with $undefined()', () => {
    const out = compiler.compile('$if myField present to result $else $omit');
    expect(out).toContain('$undefined()');
    expect(out).toContain('!= null');
  });

  test('$if present $else "default" produces ternary with string literal', () => {
    const out = compiler.compile('$if myField present to result $else "N/A"');
    expect(out).toContain('"N/A"');
    expect(out).toContain('!= null');
  });

  test('$if x equals "v" produces equality ternary', () => {
    const out = compiler.compile('$if status equals "A" to statusLabel $else "Unknown"');
    expect(out).toContain('= "A"');
    expect(out).toContain('"Unknown"');
  });

  test('$expr passes through verbatim', () => {
    const out = compiler.compile('$expr result "$sum(items)"');
    expect(out).toContain('$sum(items)');
    expect(out).toContain('"result"');
  });

  test('unknown keyword throws descriptive error', () => {
    expect(() => compiler.compile('$unknown foo to bar')).toThrow('Unknown DSL keyword');
  });

  test('aiVocabulary() excludes $expr', () => {
    const vocab = compiler.aiVocabulary();
    expect(vocab).not.toContain('$expr');
    expect(vocab).toContain('$map');
    expect(vocab).toContain('$if');
    expect(vocab).toContain('$lookup');
  });

  test('$sum-of produces $sum()', () => {
    const out = compiler.compile('$sum-of items to totalWeight');
    expect(out).toContain('$sum(`items`)');
    expect(out).toContain('"totalWeight"');
  });

  test('$substring produces $substring()', () => {
    const out = compiler.compile('$substring longField 0 10 to shortField');
    expect(out).toContain('$substring(`longField`, 0, 10)');
  });

  test('comments (#) are ignored', () => {
    const out = compiler.compile(`
      # This is a comment
      $map foo to bar
    `);
    expect(out).toContain('"bar"');
  });

  test('multiple statements are comma-joined', () => {
    const out = compiler.compile(`
      $map a to x
      $map b to y
    `);
    expect(out.split(',').length).toBeGreaterThanOrEqual(2);
  });
});
