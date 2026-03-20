import { tokenize, type Token } from './tokenizer';
import type { ASTNode } from './ast';
import { emitJSONata } from './emitter';
import { validateDSL, type ValidationResult } from './validator';

export interface DSLKeyword {
  token: string;
  parse(tokens: Token[], cursor: number): { node: ASTNode; advance: number };
  compile(node: ASTNode): string;
  aiGeneratable: boolean;
}

export class DSLCompiler {
  private keywords = new Map<string, DSLKeyword>();

  register(keyword: DSLKeyword): this {
    this.keywords.set(keyword.token, keyword);
    return this;
  }

  compile(dsl: string): string {
    const lines = dsl
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    const statements: string[] = [];

    for (const line of lines) {
      const tokens = tokenize(line);
      if (tokens.length === 0 || tokens[0].type === 'EOF') continue;

      const keyword = this.keywords.get(tokens[0].value);
      if (!keyword) {
        throw new Error(`Unknown DSL keyword: "${tokens[0].value}" in line: "${line}"`);
      }

      const { node } = keyword.parse(tokens, 0);
      statements.push(emitJSONata(node));
    }

    return statements.join(',\n');
  }

  async validate(dsl: string, sampleJedi: Record<string, unknown>): Promise<ValidationResult> {
    return validateDSL(this, dsl, sampleJedi);
  }

  aiVocabulary(): string[] {
    return Array.from(this.keywords.values())
      .filter(k => k.aiGeneratable)
      .map(k => k.token);
  }
}
