import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $concat "<sep>" <source1> <source2> ... to <target>
export const concatKeyword: DSLKeyword = {
  token: '$concat',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const separator = tokens[i++].value; // STRING token
    const sources: string[] = [];

    while (tokens[i]?.type === 'IDENTIFIER' && tokens[i]?.value !== 'to') {
      sources.push(tokens[i++].value);
    }

    if (tokens[i]?.value !== 'to') throw new Error(`Expected 'to' in $concat, got '${tokens[i]?.value}'`);
    i++;
    const target = tokens[i++].value;

    return {
      node: { type: 'concat', separator, sources, target },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    const parts = (node.sources ?? []).map(s => `\`${s}\``);
    return `"${node.target}": ${parts.join(` & "${node.separator}" & `)}`;
  },
};
