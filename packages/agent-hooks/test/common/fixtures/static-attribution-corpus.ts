import type { LineRange } from '../../../src/common/agent-hooks-common.js';
import type { Operation } from '../../../src/common/parse-command.js';
import type {
  AttributionLayer,
  PreStateRequirement,
  UnresolvedReasonCode
} from '../../../src/common/static-attribution.js';

export interface StaticAttributionSeed {
  readonly path: string;
  readonly content: string;
  readonly tracked: boolean;
}

export interface StaticAttributionExpectedOperation {
  readonly operation: Operation;
  readonly path: string;
  readonly ranges?: readonly LineRange[];
}

export interface StaticAttributionCorpusCase {
  readonly name: string;
  readonly layer: AttributionLayer;
  readonly command: string;
  readonly files: readonly StaticAttributionSeed[];
  readonly expectedOperations?: readonly StaticAttributionExpectedOperation[];
  readonly unresolvedReason?: UnresolvedReasonCode;
  readonly preStateRequirements?: readonly PreStateRequirement[];
}

const TEXT = 'alpha\nneedle one\nbeta\nneedle two\nomega\n';
const ONE_TRACKED_FILE: readonly StaticAttributionSeed[] = [{ path: 'src/a.txt', content: TEXT, tracked: true }];

/**
 * Anonymized command shapes distilled from the measured transcript corpus.
 * Paths, identifiers, and content are synthetic; commands are never executed
 * by this fixture. Every row declares either exact operations or one stable
 * fail-closed reason.
 */
export const STATIC_ATTRIBUTION_CORPUS: readonly StaticAttributionCorpusCase[] = [
  {
    name: 'deterministic literal overwrite control',
    layer: 'shell',
    command: "printf '%s\\n' done > src/a.txt",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'create-overwrite', path: 'src/a.txt' }]
  },
  {
    name: 'deterministic numeric sed control',
    layer: 'shell',
    command: "sed -i '3s/beta/BETA/' src/a.txt",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 3, end: 3 }] }]
  },
  {
    name: 'literal-list loop expands completely',
    layer: 'literal-loop',
    command: 'for f in src/a.txt src/b.txt; do sed -i "2s/needle/pin/" "$f"; done',
    files: [...ONE_TRACKED_FILE, { path: 'src/b.txt', content: TEXT, tracked: true }],
    expectedOperations: [
      { operation: 'modify', path: 'src/a.txt', ranges: [{ start: 2, end: 2 }] },
      { operation: 'modify', path: 'src/b.txt', ranges: [{ start: 2, end: 2 }] }
    ],
    preStateRequirements: ['match-locations']
  },
  {
    name: 'dynamic loop list is rejected',
    layer: 'literal-loop',
    command: 'for f in $FILES; do sed -i "s/old/new/" "$f"; done',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'dynamic-list'
  },
  {
    name: 'glob loop list is rejected',
    layer: 'literal-loop',
    command: 'for f in src/*.txt; do sed -i "s/old/new/" "$f"; done',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'glob-path'
  },
  {
    name: 'command-substitution loop list is rejected',
    layer: 'literal-loop',
    command: 'for f in $(find src -name "*.txt"); do sed -i "s/old/new/" "$f"; done',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'command-substitution'
  },
  {
    name: 'pattern sed widens across ambiguous matches',
    layer: 'pattern-substitution',
    command: "sed -i 's/needle/pin/' src/a.txt",
    files: ONE_TRACKED_FILE,
    expectedOperations: [
      {
        operation: 'modify',
        path: 'src/a.txt',
        ranges: [
          { start: 2, end: 2 },
          { start: 4, end: 4 }
        ]
      }
    ],
    preStateRequirements: ['match-locations']
  },
  {
    name: 'perl pi literal substitution',
    layer: 'pattern-substitution',
    command: "perl -pi -e 's/needle/pin/' src/a.txt",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 2, end: 4 }] }],
    preStateRequirements: ['match-locations']
  },
  {
    name: 'perl zero-pi literal substitution',
    layer: 'pattern-substitution',
    command: "perl -0pi -e 's/alpha\\nneedle/first\\npin/' src/a.txt",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 1, end: 2 }] }],
    preStateRequirements: ['match-locations', 'deleted-text']
  },
  {
    name: 'python literal replace',
    layer: 'python',
    command:
      "python3 - <<'PY'\nfrom pathlib import Path\np = Path('src/a.txt')\ns = p.read_text()\np.write_text(s.replace('beta', 'BETA'))\nPY",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 3, end: 3 }] }],
    preStateRequirements: ['match-locations']
  },
  {
    name: 'python append sink',
    layer: 'python',
    command: "python3 -c \"from pathlib import Path; p=Path('src/a.txt'); p.open('a').write('tail\\n')\"",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'append', path: 'src/a.txt', ranges: [{ start: 6, end: 6 }] }],
    preStateRequirements: ['pre-command-eof']
  },
  {
    name: 'python anchor slice reconstruction',
    layer: 'python',
    command:
      "python3 - <<'PY'\nfrom pathlib import Path\np=Path('src/a.txt')\ns=p.read_text()\ni=s.index('beta')\np.write_text(s[:i] + 'BETA' + s[i+4:])\nPY",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 3, end: 3 }] }],
    preStateRequirements: ['match-locations', 'deleted-text']
  },
  {
    name: 'python line-array edit',
    layer: 'python',
    command:
      "python3 - <<'PY'\nfrom pathlib import Path\np=Path('src/a.txt')\nlines=p.read_text().splitlines()\nlines[2]='BETA'\np.write_text('\\n'.join(lines)+'\\n')\nPY",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 3, end: 3 }] }],
    preStateRequirements: ['deleted-text']
  },
  {
    name: 'python structured literal-key update',
    layer: 'python',
    command:
      "python3 - <<'PY'\nimport json\nfrom pathlib import Path\np=Path('config.json')\nd=json.loads(p.read_text())\nd['enabled']=True\np.write_text(json.dumps(d))\nPY",
    files: [{ path: 'config.json', content: '{\n  "enabled": false,\n  "name": "demo"\n}\n', tracked: true }],
    expectedOperations: [{ operation: 'modify', path: 'config.json', ranges: [{ start: 2, end: 2 }] }],
    preStateRequirements: ['match-locations']
  },
  {
    name: 'python argv target is rejected',
    layer: 'python',
    command: 'python3 -c "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(\'x\')" src/a.txt',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'dynamic-path'
  },
  {
    name: 'node literal replace',
    layer: 'node',
    command:
      "node -e \"const fs=require('node:fs');const p='src/a.txt';const s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,s.replace('beta','BETA'))\"",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'modify', path: 'src/a.txt', ranges: [{ start: 3, end: 3 }] }],
    preStateRequirements: ['match-locations']
  },
  {
    name: 'node literal append',
    layer: 'node',
    command: "node -e \"require('node:fs').appendFileSync('src/a.txt','tail\\n')\"",
    files: ONE_TRACKED_FILE,
    expectedOperations: [{ operation: 'append', path: 'src/a.txt', ranges: [{ start: 6, end: 6 }] }],
    preStateRequirements: ['pre-command-eof']
  },
  {
    name: 'node computed target is rejected',
    layer: 'node',
    command: "node -e \"require('node:fs').writeFileSync(process.argv[1],'x')\" src/a.txt",
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'dynamic-path'
  },
  {
    name: 'history-changing rebase stays silent',
    layer: 'shell',
    command: 'git rebase main',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'history-operation'
  },
  {
    name: 'history-changing merge stays silent',
    layer: 'shell',
    command: 'git merge topic',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'history-operation'
  },
  {
    name: 'generator stays silent',
    layer: 'shell',
    command: 'yarn generate',
    files: ONE_TRACKED_FILE,
    unresolvedReason: 'generator-operation'
  },
  {
    name: 'tracked and untracked pair retains only tracked eligibility',
    layer: 'shell',
    command: 'printf x | tee src/a.txt scratch.txt >/dev/null',
    files: [...ONE_TRACKED_FILE, { path: 'scratch.txt', content: '', tracked: false }],
    expectedOperations: [{ operation: 'create-overwrite', path: 'src/a.txt' }],
    preStateRequirements: ['pre-tracked']
  }
];
