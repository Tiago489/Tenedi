import { DSLCompiler } from '../compiler';
import { mapKeyword } from './map';
import { ifElseKeyword } from './if-else';
import { concatKeyword } from './concat';
import { lookupKeyword } from './lookup';
import { overwriteKeyword } from './overwrite';
import { asKeyword } from './as';
import { sumOfKeyword } from './sum-of';
import { substringKeyword } from './substring';
import { exprKeyword } from './expr';

export const compiler = new DSLCompiler()
  .register(mapKeyword)
  .register(ifElseKeyword)
  .register(concatKeyword)
  .register(lookupKeyword)
  .register(overwriteKeyword)
  .register(asKeyword)
  .register(sumOfKeyword)
  .register(substringKeyword)
  .register(exprKeyword);

export { DSLCompiler } from '../compiler';
