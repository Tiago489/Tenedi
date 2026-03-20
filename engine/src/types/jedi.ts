export interface JediInterchange {
  interchange_control_header_ISA: Record<string, string>;
  functional_groups: JediFunctionalGroup[];
  interchange_control_trailer_IEA: Record<string, string>;
}

export interface JediFunctionalGroup {
  functional_group_header_GS: Record<string, string>;
  transactions: JediTransaction[];
  functional_group_trailer_GE: Record<string, string>;
}

export interface JediTransaction {
  transaction_set_header_ST: {
    transaction_set_identifier_code_01: string;
    transaction_set_control_number_02: string;
  };
  heading?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  transaction_set_trailer_SE: Record<string, string>;
  _raw?: RawSegment[];
}

export interface RawSegment {
  tag: string;
  elements: string[];
  loopId?: string;
}

export interface ParsedEDI {
  raw: string;
  interchange: JediInterchange;
  transactionSets: string[];
}
