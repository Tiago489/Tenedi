import type { ASTNode } from './ast';

export function emitJSONata(node: ASTNode): string {
  switch (node.type) {
    case 'map': {
      const src = formatPath(node.source!);
      const base = applyAs(src, node.modifier);
      return `"${node.target}": ${base}`;
    }

    case 'if_present': {
      const src = formatPath(node.source!);
      const elseVal = formatElse(node.elseBranch);
      return `"${node.target}": (${src} != null ? ${src} : ${elseVal})`;
    }

    case 'if_equals': {
      const src = formatPath(node.source!);
      const elseVal = formatElse(node.elseBranch);
      return `"${node.target}": (${src} = "${node.conditionValue}" ? ${src} : ${elseVal})`;
    }

    case 'concat': {
      const sep = node.separator ?? '';
      const parts = (node.sources ?? []).map(formatPath);
      const joined = parts.join(` & "${sep}" & `);
      return `"${node.target}": ${joined}`;
    }

    case 'lookup': {
      const src = formatPath(node.source!);
      return `"${node.target}": $lookup($${node.tableName}, ${src})`;
    }

    case 'overwrite': {
      const src = formatPath(node.source!);
      return `"${node.target}": $last(${src})`;
    }

    case 'sum_of': {
      const src = formatPath(node.source!);
      return `"${node.target}": $sum(${src})`;
    }

    case 'substring': {
      const src = formatPath(node.source!);
      return `"${node.target}": $substring(${src}, ${node.start ?? 0}, ${node.length ?? 255})`;
    }

    case 'expr': {
      return `"${node.target}": ${node.rawExpr}`;
    }

    default:
      throw new Error(`Unknown AST node type: ${(node as ASTNode).type}`);
  }
}

function formatPath(path: string): string {
  // Dot-path: wrap each segment in backticks
  return path.split('.').map(p => `\`${p}\``).join('.');
}

function applyAs(src: string, modifier?: string): string {
  if (!modifier) return src;
  switch (modifier) {
    case 'string':    return `$string(${src})`;
    case 'number':    return `$number(${src})`;
    case 'date':      return `$toMillis(${src}, "[Y0001][M01][D01]")`;
    case 'uppercase': return `$uppercase(${src})`;
    case 'trimmed':   return `$trim(${src})`;
    case 'timestamp': return `$now()`;
    default: throw new Error(`Unknown $as modifier: ${modifier}`);
  }
}

function formatElse(elseBranch: ASTNode | 'omit' | string | undefined): string {
  if (elseBranch === 'omit' || elseBranch === undefined) return '$undefined()';
  if (typeof elseBranch === 'string') return `"${elseBranch}"`;
  return emitJSONata(elseBranch);
}
