import jsonata from 'jsonata';
import type { DSLCompiler } from './compiler';

export interface ValidationResult {
  ok: boolean;
  jsonata?: string;
  result?: unknown;
  error?: string;
}

export async function validateDSL(
  compiler: DSLCompiler,
  dsl: string,
  sampleJedi: Record<string, unknown>,
): Promise<ValidationResult> {
  let jsonataExpr: string;
  try {
    jsonataExpr = compiler.compile(dsl);
  } catch (err: unknown) {
    return { ok: false, error: `Compile error: ${(err as Error).message}` };
  }

  try {
    const expr = jsonata(`{ ${jsonataExpr} }`);
    const result = await expr.evaluate(sampleJedi);
    return { ok: true, jsonata: jsonataExpr, result };
  } catch (err: unknown) {
    return { ok: false, jsonata: jsonataExpr, error: `Evaluation error: ${(err as Error).message}` };
  }
}
