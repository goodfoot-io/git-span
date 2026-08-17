export const EXPECTED_AUDIT_IDS = [
  'agent-accessibility-tree',
  'webmcp-form-coverage',
  'webmcp-registered-tools',
  'webmcp-schema-validity',
  'cumulative-layout-shift',
  'llms-txt'
] as const;
export type AgenticAuditId = (typeof EXPECTED_AUDIT_IDS)[number];

export interface AgenticAuditResult {
  id: string;
  title: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue?: string;
  explanation?: string;
}

export interface AgenticReport {
  target: string;
  lighthouseVersion: string;
  chromeMajor: number;
  categoryScore: number | null;
  categoryScoreDisplayMode: string;
  audits: AgenticAuditResult[];
}

export interface Evaluation {
  passed: boolean;
  failures: string[];
  output: string;
}

export interface EvaluationOptions {
  threshold: number;
  lighthouseVersion: string;
  minimumChromeMajor: number;
}

const REQUIRED_AUDITS = new Set<AgenticAuditId>(['agent-accessibility-tree', 'cumulative-layout-shift', 'llms-txt']);

function formatScore(score: number | null): string {
  return score === null ? 'n/a' : score.toFixed(3);
}

function status(audit: AgenticAuditResult): string {
  if (audit.scoreDisplayMode === 'error') return 'ERROR';
  if (audit.scoreDisplayMode === 'notApplicable' || audit.score === null) return 'N/A';
  if (audit.scoreDisplayMode === 'numeric') return 'PASS';
  return audit.score >= 1 ? 'PASS' : 'FAIL';
}

export function evaluateAgenticReport(report: AgenticReport, options: EvaluationOptions): Evaluation {
  const failures: string[] = [];
  if (report.lighthouseVersion !== options.lighthouseVersion) {
    failures.push(`Lighthouse version ${report.lighthouseVersion} does not match pinned ${options.lighthouseVersion}`);
  }
  if (report.chromeMajor < options.minimumChromeMajor) {
    failures.push(`Chrome ${report.chromeMajor} is below required Chrome ${options.minimumChromeMajor}`);
  }
  if (report.categoryScoreDisplayMode !== 'fraction') {
    failures.push(`category display mode ${report.categoryScoreDisplayMode} is not fraction`);
  }
  if (report.categoryScore === null) failures.push('category score is unavailable');
  else if (report.categoryScore < options.threshold) {
    failures.push(
      `category score ${report.categoryScore.toFixed(3)} is below threshold ${options.threshold.toFixed(3)}`
    );
  }
  const actualIds = new Set(report.audits.map(({ id }) => id));
  for (const id of EXPECTED_AUDIT_IDS) {
    if (!actualIds.has(id)) failures.push(`missing audit: ${id}`);
  }
  for (const id of actualIds) {
    if (!(EXPECTED_AUDIT_IDS as readonly string[]).includes(id)) failures.push(`unexpected audit: ${id}`);
  }
  const lines = [
    `Agentic Browsing: ${report.target}`,
    `  score ${formatScore(report.categoryScore)} / threshold ${options.threshold.toFixed(3)}`
  ];
  for (const audit of report.audits) {
    const auditStatus = status(audit);
    const detail = audit.explanation ?? audit.displayValue;
    lines.push(
      `  ${audit.id} — ${audit.title}: ${auditStatus} (${formatScore(audit.score)})${detail ? ` — ${detail}` : ''}`
    );
    if (auditStatus === 'ERROR') failures.push(`${audit.id} errored${detail ? `: ${detail}` : ''}`);
    else if (auditStatus === 'FAIL') failures.push(`${audit.id} failed${detail ? `: ${detail}` : ''}`);
    else if (auditStatus === 'N/A' && REQUIRED_AUDITS.has(audit.id as AgenticAuditId)) {
      failures.push(`${audit.id} is unexpectedly not applicable`);
    }
  }
  return { passed: failures.length === 0, failures, output: lines.join('\n') };
}
