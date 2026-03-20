import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $map <source> to <target> [$as <modifier>]
export const mapKeyword: DSLKeyword = {
  token: '$map',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const source = tokens[i++].value;
    if (tokens[i].value !== 'to') throw new Error(`Expected 'to' after $map source, got '${tokens[i].value}'`);
    i++;
    const target = tokens[i++].value;

    let modifier: string | undefined;
    if (tokens[i]?.value === '$as') {
      i++;
      modifier = tokens[i++].value;
    }

    return {
      node: { type: 'map', source, target, modifier },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": \`${node.source}\``;
  },
};
