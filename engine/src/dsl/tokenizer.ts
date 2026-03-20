export type TokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const KEYWORDS = new Set([
  '$map', '$if', '$else', '$omit', '$concat', '$lookup',
  '$overwrite', '$as', '$sum-of', '$substring', '$expr',
  'to', 'present', 'equals',
]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = input.trim();

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i])) { i++; continue; }

    // String literal
    if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j++;
        j++;
      }
      tokens.push({ type: 'STRING', value: src.slice(i + 1, j), pos: i });
      i = j + 1;
      continue;
    }

    // Number
    if (/\d/.test(src[i])) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      tokens.push({ type: 'NUMBER', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // Keyword or identifier (starts with $ or letter)
    if (src[i] === '$' || /[a-zA-Z_]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[\w$\-.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const type: TokenType = KEYWORDS.has(word) ? 'KEYWORD' : 'IDENTIFIER';
      tokens.push({ type, value: word, pos: i });
      i = j;
      continue;
    }

    i++;
  }

  tokens.push({ type: 'EOF', value: '', pos: src.length });
  return tokens;
}
