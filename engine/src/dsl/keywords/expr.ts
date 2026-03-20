import jsonata from 'jsonata';
import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $expr <target> "<raw JSONata>"  — Tier 3 / human-only escape hatch
export const exprKeyword: DSLKeyword = {
  token: '$expr',
  aiGeneratable: false, // NEVER used by AI

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const target = tokens[i++].value;
    const rawExpr = tokens[i++].value; // STRING token

    // Validate raw JSONata at parse time
    try {
      jsonata(rawExpr);
    } catch (err: unknown) {
      throw new Error(`$expr contains invalid JSONata: ${(err as Error).message}`);
    }

    return {
      node: { type: 'expr', target, rawExpr },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": ${node.rawExpr}`;
  },
};
