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

/**
 * A numeric audit at or above this is not worth naming as a drag on the
 * category score; below it, it is a plausible reason the category fell short.
 */
const NUMERIC_DRAG_CEILING = 0.9;

function formatScore(score: number | null): string {
  return score === null ? 'n/a' : score.toFixed(3);
}

/**
 * Gating classification. `numeric` audits never fail individually — they
 * reach the verdict only through the category threshold.
 */
function status(audit: AgenticAuditResult): string {
  if (audit.scoreDisplayMode === 'error') return 'ERROR';
  if (audit.scoreDisplayMode === 'notApplicable' || audit.score === null) return 'N/A';
  if (audit.scoreDisplayMode === 'numeric') return 'PASS';
  return audit.score >= 1 ? 'PASS' : 'FAIL';
}

/**
 * Human-readable label, deliberately not the gating classification: printing
 * `PASS` next to a 0.540 CLS hid the one audit responsible for a failing
 * target. `SCORED`/`SCORED (LOW)` says "counted toward the category, not a
 * verdict of its own" without touching what {@link status} decides.
 */
function reportLabel(audit: AgenticAuditResult): string {
  const auditStatus = status(audit);
  if (auditStatus !== 'PASS' || audit.scoreDisplayMode !== 'numeric') return auditStatus;
  return isDragging(audit) ? 'SCORED (LOW)' : 'SCORED';
}

function isDragging(audit: AgenticAuditResult): boolean {
  return audit.scoreDisplayMode === 'numeric' && audit.score !== null && audit.score < NUMERIC_DRAG_CEILING;
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
    // Name the numeric audits that pulled the category down: they are the only
    // audits that can fail a target without producing a failure line of their
    // own, so without this the report says a score is too low and nothing else.
    const dragging = report.audits.filter(isDragging);
    const contributors =
      dragging.length > 0
        ? ` — pulled down by ${dragging.map((audit) => `${audit.id} (${formatScore(audit.score)})`).join(', ')}`
        : '';
    failures.push(
      `category score ${report.categoryScore.toFixed(3)} is below threshold ${options.threshold.toFixed(3)}${contributors}`
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
      `  ${audit.id} — ${audit.title}: ${reportLabel(audit)} (${formatScore(audit.score)})${detail ? ` — ${detail}` : ''}`
    );
    if (auditStatus === 'ERROR') failures.push(`${audit.id} errored${detail ? `: ${detail}` : ''}`);
    else if (auditStatus === 'FAIL') failures.push(`${audit.id} failed${detail ? `: ${detail}` : ''}`);
    else if (auditStatus === 'N/A' && REQUIRED_AUDITS.has(audit.id as AgenticAuditId)) {
      failures.push(`${audit.id} is unexpectedly not applicable`);
    }
  }
  return { passed: failures.length === 0, failures, output: lines.join('\n') };
}
