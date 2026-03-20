import type { DSLKeyword } from '../compiler';
import type { Token } from '../tokenizer';
import type { ASTNode } from '../ast';

// $if <source> present [to <target>] [$else $omit | $else "<default>"]
// $if <source> equals "<value>" [to <target>] [$else $omit | $else "<default>"]
export const ifElseKeyword: DSLKeyword = {
  token: '$if',
  aiGeneratable: true,

  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number } {
    let i = cursor + 1;
    const source = tokens[i++].value;
    const condition = tokens[i++].value; // 'present' or 'equals'

    let conditionValue: string | undefined;
    if (condition === 'equals') {
      conditionValue = tokens[i++].value;
    }

    let target: string | undefined;
    if (tokens[i]?.value === 'to') {
      i++;
      target = tokens[i++].value;
    }

    let elseBranch: ASTNode | 'omit' | string | undefined;
    if (tokens[i]?.value === '$else') {
      i++;
      if (tokens[i]?.value === '$omit') {
        elseBranch = 'omit';
        i++;
      } else if (tokens[i]?.type === 'STRING') {
        elseBranch = tokens[i++].value;
      }
    }

    const nodeType = condition === 'present' ? 'if_present' : 'if_equals';
    return {
      node: {
        type: nodeType,
        source,
        target: target ?? source,
        conditionValue,
        elseBranch,
      },
      advance: i - cursor,
    };
  },

  compile(node: ASTNode): string {
    return `"${node.target}": \`${node.source}\``;
  },
};
