import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from 'chrome-launcher';
import lighthouse, { type RunnerResult } from 'lighthouse';
import { type AgenticAuditResult, type AgenticReport, evaluateAgenticReport } from '~/gate/evaluate';
import { readGateServerInfo } from '~/gate/globalSetup';

export const LIGHTHOUSE_VERSION = '13.4.1';
export const MINIMUM_CHROME_MAJOR = 150;
export const SCORE_THRESHOLD = 0.9;

const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 19;

/**
 * Node floor check (before Chrome ever launches — the `c058d7b` lesson: a
 * missing/old Node produces a confusing Chrome-launch failure instead of a
 * clear message) plus a readiness probe against the already-booted origin.
 */
async function preflight(): Promise<void> {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
  if (!match) {
    throw new NodeVersionError(`unable to parse Node version from ${process.version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < MINIMUM_NODE_MAJOR || (major === MINIMUM_NODE_MAJOR && minor < MINIMUM_NODE_MINOR)) {
    throw new NodeVersionError(
      `Node ${process.version} is below the required ${MINIMUM_NODE_MAJOR}.${MINIMUM_NODE_MINOR}`
    );
  }

  const { baseUrl } = readGateServerInfo();
  const response = await fetch(`${baseUrl}/`);
  if (!response.ok) {
    throw new Error(`agentic gate preflight: origin ${baseUrl} responded with ${response.status}`);
  }
}

class NodeVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeVersionError';
  }
}

/**
 * Resolves the Playwright-cached Chromium binary. The cache path includes a
 * version-specific revision directory (`chromium-1228`, etc.) so the exact
 * name can't be hardcoded. A Playwright bump leaves the old revision in place,
 * so the highest revision number is picked deliberately — `readdirSync` order
 * would otherwise decide which Chrome the gate audits with.
 */
function cachedChromiumPath(): string {
  const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
  let entries: string[];
  try {
    entries = readdirSync(cacheRoot);
  } catch (error) {
    throw new Error(`agentic gate: unable to read Playwright cache at ${cacheRoot}: ${String(error)}`);
  }
  const revision = entries
    .filter((entry) => /^chromium-\d+$/.test(entry))
    .sort((a, b) => Number(a.slice('chromium-'.length)) - Number(b.slice('chromium-'.length)))
    .at(-1);
  if (!revision) {
    throw new Error(
      `agentic gate: no chromium-* revision found under ${cacheRoot}; run \`npx playwright install chromium\`, ` +
        `or point CHROME_PATH at an existing Chrome binary`
    );
  }
  const chromePath = path.join(cacheRoot, revision, 'chrome-linux', 'chrome');
  if (!existsSync(chromePath)) {
    throw new Error(
      `agentic gate: Playwright revision ${revision} has no Chrome binary at ${chromePath} ` +
        `(re-run \`npx playwright install chromium\`, or point CHROME_PATH at an existing Chrome binary)`
    );
  }
  return chromePath;
}

/** Recursively flattens `details.items` string leaves, joined with `'; '`. */
function flattenDetailItems(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenDetailItems);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(flattenDetailItems);
  }
  return [];
}

function detailText(audit: RunnerResult['lhr']['audits'][string]): string | undefined {
  if (audit.explanation) return audit.explanation;
  if (audit.displayValue) return audit.displayValue;
  const details = audit.details as { items?: unknown } | undefined;
  if (details && 'items' in details) {
    const flattened = flattenDetailItems(details.items);
    if (flattened.length > 0) return flattened.join('; ');
  }
  return undefined;
}

/**
 * Builds a fail-closed {@link AgenticReport} from a raw Lighthouse result.
 * Throws on any signal that means the report can't be trusted: a runtime
 * error, any run warning, a missing `agentic-browsing` category, or an
 * `auditRefs` entry pointing at an audit that never ran.
 */
function normalize(target: string, lhr: RunnerResult['lhr']): AgenticReport {
  if (lhr.runtimeError) {
    throw new Error(`agentic gate: ${target} produced a runtime error: ${lhr.runtimeError.message}`);
  }
  if (lhr.runWarnings.length > 0) {
    throw new Error(`agentic gate: ${target} produced run warnings: ${lhr.runWarnings.join('; ')}`);
  }
  const category = lhr.categories['agentic-browsing'];
  if (!category) {
    throw new Error(`agentic gate: ${target} did not produce an agentic-browsing category`);
  }

  const audits: AgenticAuditResult[] = category.auditRefs.map(({ id }) => {
    const audit = lhr.audits[id];
    if (!audit) {
      throw new Error(`agentic gate: ${target} category references unresolved audit id "${id}"`);
    }
    return {
      id: audit.id,
      title: audit.title,
      score: audit.score,
      scoreDisplayMode: audit.scoreDisplayMode,
      displayValue: audit.displayValue,
      explanation: detailText(audit)
    };
  });

  const userAgentMatch = /Chrome\/(\d+)/.exec(lhr.environment.hostUserAgent);
  const chromeMajor = userAgentMatch ? Number(userAgentMatch[1]) : 0;

  return {
    target,
    lighthouseVersion: lhr.lighthouseVersion,
    chromeMajor,
    categoryScore: category.score,
    categoryScoreDisplayMode: category.categoryScoreDisplayMode ?? 'missing',
    audits
  };
}

/**
 * Runs the pinned Lighthouse `agentic-browsing` category against every
 * target URL, evaluates each report, prints per-target results immediately
 * so one weak page doesn't hide the rest, then throws one aggregate error
 * naming every failure if any target failed.
 */
export async function runAgenticGate(targets: string[]): Promise<void> {
  await preflight();

  const chrome = await launch({
    chromePath: process.env.CHROME_PATH ?? cachedChromiumPath(),
    chromeFlags: ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'],
    logLevel: 'silent'
  });

  const allFailures: string[] = [];
  try {
    for (const target of targets) {
      const result = await lighthouse(target, {
        port: chrome.port,
        logLevel: 'silent',
        onlyCategories: ['agentic-browsing'],
        output: 'json',
        locale: 'en-US',
        throttlingMethod: 'provided'
      });
      if (!result) {
        throw new Error(`agentic gate: lighthouse produced no result for ${target}`);
      }

      const report = normalize(target, result.lhr);
      const evaluation = evaluateAgenticReport(report, {
        threshold: SCORE_THRESHOLD,
        lighthouseVersion: LIGHTHOUSE_VERSION,
        minimumChromeMajor: MINIMUM_CHROME_MAJOR
      });

      // Print immediately so one weak page doesn't hide the rest.
      console.log(evaluation.output);

      for (const failure of evaluation.failures) {
        allFailures.push(`${target}: ${failure}`);
      }
    }
  } finally {
    await chrome.kill();
  }

  if (allFailures.length > 0) {
    const numbered = allFailures.map((failure, index) => `${index + 1}. ${failure}`).join('\n');
    throw new Error(`agentic gate: ${allFailures.length} failure(s):\n${numbered}`);
  }
}
