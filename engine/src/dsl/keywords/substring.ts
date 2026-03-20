import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $substring <source> <start> <length> to <target>
export const substringKeyword: DSLKeyword = {
  token: '$substring',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const source = tokens[i++].value;
    const start = parseInt(tokens[i++].value, 10);
    const length = parseInt(tokens[i++].value, 10);

    if (tokens[i]?.value !== 'to') throw new Error(`Expected 'to' in $substring, got '${tokens[i]?.value}'`);
    i++;
    const target = tokens[i++].value;

    return {
      node: { type: 'substring', source, target, start, length },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": $substring(\`${node.source}\`, ${node.start}, ${node.length})`;
  },
};
