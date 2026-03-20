import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $lookup <TableName> <source> to <target>
export const lookupKeyword: DSLKeyword = {
  token: '$lookup',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const tableName = tokens[i++].value;
    const source = tokens[i++].value;

    if (tokens[i]?.value !== 'to') throw new Error(`Expected 'to' in $lookup, got '${tokens[i]?.value}'`);
    i++;
    const target = tokens[i++].value;

    return {
      node: { type: 'lookup', tableName, source, target },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": $lookup($${node.tableName}, \`${node.source}\`)`;
  },
};
