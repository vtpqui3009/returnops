import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type MatrixCase = { id: string; title: string };
export const MAIN_FLOW_IDS = ['A-01', 'B-01', 'B-02', 'B-03', 'C-01', 'D-01', 'E-01', 'E-02'];
export const API_CASE_IDS = [...MAIN_FLOW_IDS,
  'B-N01', 'B-N02', 'B-N03', 'B-N04', 'B-N05', 'B-N06', 'C-N01', 'C-N02', 'D-N01',
  'E-N01', 'E-N02', 'E-N03', 'E-N04', 'E-N05', 'AUTH-N01', 'AUTH-N02', 'AUTH-N03',
  'R-N01', 'R-N02', 'R-N03', 'R-N04', 'R-N05', 'R-N06', 'DATA-N01', 'DATA-N02',
  'AGENT-N01', 'AGENT-N02', 'AGENT-N03', 'API-N01', 'SEC-N01'
];
export const HOSTED_CASE_IDS = ['DEP-N01', 'DEP-N02', 'AUTH-N03'];
export const E2E_CASE_IDS = [...MAIN_FLOW_IDS, 'UI-N01', 'UI-N02', 'UI-N03', 'SEC-N01'];
export const LOCAL_UI_CASE_IDS = [...E2E_CASE_IDS, 'R-N04'];
const API_PARTIAL_IDS = ['AUTH-N03', 'DATA-N01', 'R-N04', 'SEC-N01'];
const VARIANTS: Record<string, Record<string, string[]>> = {
  api: {
    'B-N05': ['change-before-review', 'change-during-evaluation'],
    'R-N05': ['concurrent', 'accept-first', 'reject-first']
  },
  'ui-local': {
    'UI-N01': ['write-retry', 'pending-ack'],
    'UI-N03': ['queue', 'learning', 'case-detail', 'owner-review']
  }
};

export function requiredVariants(layer: string, id: string): string[] {
  if (layer === 'api' && API_CASE_IDS.includes(id) && !API_PARTIAL_IDS.includes(id)) return VARIANTS.api[id] ?? ['default'];
  if (layer === 'ui-local' && LOCAL_UI_CASE_IDS.includes(id)) return VARIANTS['ui-local'][id] ?? ['default'];
  return [];
}
export function readCatalog(): MatrixCase[] {
  const content = readFileSync(fileURLToPath(new URL('../../docs/test-matrix.md', import.meta.url)), 'utf8');
  const rows = [...content.matchAll(/^\| ([A-Z]+-N?\d+) \| ([^\n]+)$/gm)];
  const cases = rows.map(match => ({ id: match[1], title: match[2].split('|')[0].trim() }));
  if (!cases.length || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Missing or duplicate matrix IDs.');
  return cases;
}
