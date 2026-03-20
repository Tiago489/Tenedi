export type ASTNodeType =
  | 'map'
  | 'if_present'
  | 'if_equals'
  | 'concat'
  | 'lookup'
  | 'overwrite'
  | 'as'
  | 'sum_of'
  | 'substring'
  | 'expr'
  | 'program';

export interface ASTNode {
  type: ASTNodeType;
  source?: string;
  target?: string;
  condition?: string;
  conditionValue?: string;
  thenBranch?: ASTNode;
  elseBranch?: ASTNode | 'omit' | string;
  separator?: string;
  sources?: string[];
  tableName?: string;
  modifier?: string;
  start?: number;
  length?: number;
  rawExpr?: string;
  children?: ASTNode[];
}

export interface ProgramNode {
  type: 'program';
  statements: ASTNode[];
}
