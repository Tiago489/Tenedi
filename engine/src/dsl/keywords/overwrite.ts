import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $overwrite <source> to <target>
export const overwriteKeyword: DSLKeyword = {
  token: '$overwrite',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const source = tokens[i++].value;

    if (tokens[i]?.value !== 'to') throw new Error(`Expected 'to' in $overwrite, got '${tokens[i]?.value}'`);
    i++;
    const target = tokens[i++].value;

    return {
      node: { type: 'overwrite', source, target },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": $last(\`${node.source}\`)`;
  },
};
