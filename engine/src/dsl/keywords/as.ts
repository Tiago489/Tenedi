import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

const VALID_MODIFIERS = new Set(['string', 'number', 'date', 'uppercase', 'trimmed', 'timestamp']);

// $as <modifier> <source> to <target>
export const asKeyword: DSLKeyword = {
  token: '$as',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const modifier = tokens[i++].value;

    if (!VALID_MODIFIERS.has(modifier)) {
      throw new Error(`Unknown $as modifier: "${modifier}". Valid: ${[...VALID_MODIFIERS].join(', ')}`);
    }

    const source = tokens[i++].value;

    if (tokens[i]?.value !== 'to') throw new Error(`Expected 'to' in $as, got '${tokens[i]?.value}'`);
    i++;
    const target = tokens[i++].value;

    return {
      node: { type: 'map', source, target, modifier },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": \`${node.source}\``;
  },
};
