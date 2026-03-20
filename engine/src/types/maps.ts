export interface FieldMapping {
  jediPath: string;
  systemPath: string;
  transform?: keyof typeof TransformFunctions;
  default?: string;
}

export interface TransformMap {
  id: string;
  transactionSet: string;
  direction: 'inbound' | 'outbound';
  version: number;
  publishedAt: Date;
  mappings: FieldMapping[];
  dslSource?: string;
  validationSchema?: string;
}

export const TransformFunctions = {
  dateYYMMDD: (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`,
  dateMMDDYY: (v: string) => {
    const d = new Date(v);
    return `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`;
  },
  trimPad10: (v: string) => v.trim().substring(0, 10).padEnd(10),
  toUpperCase: (v: string) => v.toUpperCase(),
  toNumber: (v: string) => String(parseFloat(v)),
  trim: (v: string) => v.trim(),
  cents: (v: string) => String(Math.round(parseFloat(v) * 100)),
  fromCents: (v: string) => (parseInt(v, 10) / 100).toFixed(2),
} as const;
