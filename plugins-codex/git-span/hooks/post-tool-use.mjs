#!/usr/bin/env -S node --enable-source-maps
// src/codex/post-tool-use.ts
import { resolve as resolvePath3 } from "node:path";

// ../../node_modules/@goodfoot/codex-hooks/dist/hooks.js
function attachMetadata(hookEventName, config, handler) {
  const hook = handler;
  hook.hookEventName = hookEventName;
  hook.timeout = config.timeout;
  hook.statusMessage = config.statusMessage;
  if ("matcher" in config && typeof config.matcher === "string") {
    hook.matcher = config.matcher;
  }
  return hook;
}
function postToolUseHook(config, handler) {
  return attachMetadata("PostToolUse", config, handler);
}

// ../../node_modules/@goodfoot/codex-hooks/dist/outputs.js
function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}
function buildOutput(type, stdout, stderr) {
  return {
    _type: type,
    stdout: omitUndefined(stdout),
    ...stderr !== void 0 ? { stderr } : {}
  };
}
function postToolUseOutput(options = {}) {
  const hasSpecific = options.additionalContext !== void 0 || options.updatedMCPToolOutput !== void 0;
  const hookSpecificOutput = hasSpecific ? omitUndefined({
    hookEventName: "PostToolUse",
    additionalContext: options.additionalContext,
    updatedMCPToolOutput: options.updatedMCPToolOutput
  }) : void 0;
  return buildOutput("PostToolUse", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
function isAbsolutePosix(p) {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}
function abspathAgainst(base, target) {
  const t = toPosix(target);
  if (isAbsolutePosix(t)) return t;
  const b = toPosix(base).replace(/\/+$/, "");
  return `${b}/${t}`;
}
function resolveRepoRoot(dir) {
  if (!dir) return null;
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? toPosix(trimmed) : null;
  } catch {
    return null;
  }
}
var SPAN_ROOT = ".span";
function resolveSpanRoot(repoRoot) {
  const envDir = process.env["GIT_SPAN_DIR"];
  if (envDir && envDir.trim().length > 0) {
    return toPosix(envDir.trim()).replace(/\/+$/, "");
  }
  try {
    const out = execFileSync("git", ["-C", repoRoot, "config", "git-span.dir"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = toPosix(out.trim()).replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  } catch (err) {
    void err;
  }
  return SPAN_ROOT;
}
function isInsideSpanRoot(repoRelPath, spanRoot = SPAN_ROOT) {
  const root = spanRoot.replace(/\/+$/, "");
  return repoRelPath === root || repoRelPath.startsWith(`${root}/`);
}
function isGitIgnored(repoRoot, repoRelPath) {
  try {
    execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", repoRelPath], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch (err) {
    void err;
    return false;
  }
}
function relativeToRepo(repoRoot, absPath) {
  const root = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}
function rangesIntersect(a, b) {
  return a.start <= b.end && a.end >= b.start;
}
function parsePorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("	");
    if (parts.length < 3) continue;
    const [name, path, range] = parts;
    const dashIdx = range.indexOf("-");
    if (dashIdx === -1) continue;
    const start = parseInt(range.slice(0, dashIdx), 10);
    const end = parseInt(range.slice(dashIdx + 1), 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end });
  }
  return rows;
}
var PORCELAIN_STATUSES = [
  "FRESH",
  "RESOLVED_PENDING_COMMIT",
  "MOVED",
  "CHANGED",
  "DELETED",
  "CONFLICT",
  "SUBMODULE",
  "LFS_NOT_FETCHED",
  "LFS_NOT_INSTALLED",
  "PROMISOR_MISSING",
  "SPARSE_EXCLUDED",
  "FILTER_FAILED",
  "IO_ERROR"
];
var PORCELAIN_STATUS_SET = new Set(PORCELAIN_STATUSES);
function parsePorcelainStatus(raw) {
  return PORCELAIN_STATUS_SET.has(raw) ? raw : null;
}
function isDebt(status) {
  switch (status) {
    case "FRESH":
    case "MOVED":
    case "RESOLVED_PENDING_COMMIT":
      return false;
    default:
      return true;
  }
}
function humanStatusLabel(status) {
  return status.toLowerCase().replace(/_/g, " ");
}
function parseDriftPorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("	");
    if (parts.length < 6) continue;
    const [statusCol, , name, path, startCol, endCol] = parts;
    const status = parsePorcelainStatus(statusCol);
    if (!status) continue;
    const start = startCol === "(whole)" ? 0 : parseInt(startCol, 10);
    const end = endCol === "-" ? 0 : parseInt(endCol, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end, status });
  }
  return rows;
}
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");
function sessionDir(sessionId) {
  return nodePath.join(SESSION_BASE_DIR, sanitizeSessionId(sessionId));
}
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function pruneStaleSessions(now = Date.now(), maxAgeMs = THIRTY_DAYS_MS) {
  let entries;
  try {
    entries = fs.readdirSync(SESSION_BASE_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(SESSION_BASE_DIR, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
    }
  }
}

// src/common/parse-command.ts
import { isAbsolute as isAbsolute2, resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { readFileSync, statSync as statSync2 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync2(absolutePath).isFile()) return null;
    const content = readFileSync(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync2("git", ["show", `${rev}:${path}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (out.length === 0) return 0;
    const withoutTrailingNewline = out.endsWith("\n") ? out.slice(0, -1) : out;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}

// src/common/shell-split.ts
var COMMAND_OPENER_WORDS = /* @__PURE__ */ new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "("]);
var WORD_END = /[\s;&|()<>]/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function splitTopLevel(cmd) {
  const parts = [];
  let buf = "";
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let braceDepth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp = "start";
  let malformed;
  let listStart = 0;
  const reject = (v) => {
    malformed = v;
    parts.length = listStart;
    i = n;
  };
  const isUnconsumedOperator = () => (pendingOp === "pipe" || pendingOp === "and" || pendingOp === "or") && buf.trim() === "";
  const lastWord = () => buf.trimEnd().match(/\S+$/)?.[0] ?? "";
  const DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;
  const lastWordIsDanglingRedirect = () => DANGLING_REDIRECT_WORD.test(lastWord());
  const isWordStart = () => buf === "" || /\s$/.test(buf);
  const startsRedirectAt = (i2) => {
    const c = cmd[i2];
    if (c === ">" || c === "<") return true;
    if (c === "&") return cmd[i2 + 1] === ">";
    if (c >= "0" && c <= "9") {
      let j = i2;
      while (j < n && cmd[j] >= "0" && cmd[j] <= "9") j += 1;
      return cmd[j] === ">" || cmd[j] === "<";
    }
    return false;
  };
  const isCommandPosition = () => buf.trim() === "" || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord());
  const flush = (nextOp) => {
    const s = buf.trim();
    if (s) {
      if (pendingOp === "pipe" && (s === "!" || /^!\s/.test(s))) {
        reject("pipe-bang");
        return;
      }
      parts.push({ text: s, precededBy: pendingOp, ...bufHeredoc ? { heredoc: true } : {} });
    }
    buf = "";
    bufHeredoc = false;
    pendingOp = nextOp;
  };
  const levels = [[]];
  const top = () => {
    const lv = levels[levels.length - 1];
    return lv.length > 0 ? lv[lv.length - 1] : void 0;
  };
  let afterKeyword = false;
  let functionSeen = false;
  let nameSeen = false;
  let caseRegion = null;
  const heredocs = [];
  let inBody = false;
  let bufHeredoc = false;
  while (i < n) {
    const c = cmd[i];
    if (inSquote) {
      buf += c;
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      buf += c;
      if (c === "\\" && i + 1 < n) {
        buf += cmd[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      buf += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (braceDepth > 0) {
      if (c === "}") braceDepth -= 1;
      buf += c;
      i += 1;
      continue;
    }
    if (inBody) {
      const lineEnd = cmd.indexOf("\n", i);
      const line = lineEnd === -1 ? cmd.slice(i) : cmd.slice(i, lineEnd);
      if (heredocs[0].close.test(line)) {
        heredocs.shift();
        if (heredocs.length === 0) inBody = false;
      }
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += line;
        if (lineEnd !== -1) buf += "\n";
      }
      i = lineEnd === -1 ? n : lineEnd + 1;
      continue;
    }
    if (c === "\n" && heredocs.length > 0) {
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += c;
        inBody = true;
        i += 1;
        continue;
      }
      if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
        reject("dangling-operator");
        break;
      }
      flush("newline");
      inBody = true;
      i += 1;
      continue;
    }
    if (c === "#" && depth === 0 && isWordStart()) {
      while (i < n && cmd[i] !== "\n") i += 1;
      continue;
    }
    if (caseRegion) {
      const r = caseRegion;
      if (r.localDepth === 0) {
        const s2 = cmd.slice(i, i + 2);
        const s3 = cmd.slice(i, i + 3);
        if (s3 === ";;&" || s2 === ";;" || s2 === ";&") {
          r.pos = "pattern-start";
          buf += s3 === ";;&" ? s3 : s2;
          i += s3 === ";;&" ? 3 : 2;
          continue;
        }
        if (c === ";") {
          r.pos = "command";
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        const last = buf[buf.length - 1];
        if (c === "&" && cmd[i + 1] !== ">" && cmd[i + 1] !== "&" && last !== ">" && last !== "<") {
          r.pos = "command";
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === "\n") {
          if (r.pos === "pattern") {
            reject("unclosed-case");
            break;
          }
          if (r.pos === "command") r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === "#" && isWordStart()) {
          while (i < n && cmd[i] !== "\n") i += 1;
          continue;
        }
        if (isWordStart() && !WORD_END.test(c)) {
          let j = i;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          const w = cmd.slice(i, j);
          if (w === "esac" && (r.pos === "pattern-start" || r.pos === "command" && r.cmdEmpty)) {
            caseRegion = null;
            afterKeyword = false;
          } else if (w === "in" && r.pos === "subject") {
            r.pos = "pattern-start";
          } else if (r.pos === "pattern-start") {
            r.pos = "pattern";
          } else if (r.pos === "command") {
            r.cmdEmpty = false;
          }
          buf += w;
          i = j;
          continue;
        }
      }
    }
    if (c === "(") {
      if (caseRegion) {
        caseRegion.localDepth += 1;
      } else {
        const t = top();
        if (t?.kind === "brace") t.body = true;
        depth += 1;
        levels.push([]);
      }
      afterKeyword = false;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ")") {
      if (caseRegion) {
        if (caseRegion.localDepth === 0) {
          caseRegion.pos = "command";
          caseRegion.cmdEmpty = true;
        } else {
          caseRegion.localDepth -= 1;
        }
      } else {
        if (depth === 0) {
          reject("unbalanced-paren");
          break;
        }
        if (levels[levels.length - 1].length > 0) {
          reject("unclosed-construct");
          break;
        }
        depth -= 1;
        levels.pop();
      }
      buf += c;
      i += 1;
      continue;
    }
    if (!caseRegion && !WORD_END.test(c) && (isWordStart() || /[()]$/.test(buf)) && !(c === "$" && cmd[i + 1] === "{")) {
      let j = i;
      while (j < n && !WORD_END.test(cmd[j])) j += 1;
      const w = cmd.slice(i, j);
      const isFnShape = () => /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord()) || lastWord() === "()";
      if (w === "in" && top() !== void 0 && ["for", "select"].includes(top().kind)) {
      } else if (w === "{" && (isCommandPosition() || isFnShape() || functionSeen && nameSeen)) {
        if (functionSeen && nameSeen) {
          functionSeen = false;
          nameSeen = false;
        }
        if (top()?.kind === "brace") top().body = true;
        levels[levels.length - 1].push({ kind: "brace", body: false });
        afterKeyword = true;
      } else if (w === "}" && isCommandPosition()) {
        const t = top();
        if (afterKeyword || t === void 0 || t.kind !== "brace" || !t.body) {
          reject("unclosed-construct");
          break;
        }
        levels[levels.length - 1].pop();
        afterKeyword = false;
      } else if (isCommandPosition()) {
        if (w === "case") {
          caseRegion = { pos: "subject", cmdEmpty: false, localDepth: 0 };
          afterKeyword = false;
        } else if (w === "function") {
          functionSeen = true;
          nameSeen = false;
          afterKeyword = false;
        } else if (w === "if") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "if", body: false });
          afterKeyword = true;
        } else if (w === "while" || w === "until") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "loop", body: false });
          afterKeyword = true;
        } else if (w === "for") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "for", body: false });
          afterKeyword = true;
        } else if (w === "select") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "select", body: false });
          afterKeyword = true;
        } else if (w === "do") {
          const t = top();
          if (t === void 0 || !["for", "loop", "select"].includes(t.kind)) {
            reject("unclosed-construct");
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === "then") {
          const t = top();
          if (t === void 0 || t.kind !== "if") {
            reject("unclosed-construct");
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === "else" || w === "elif") {
          const t = top();
          if (t === void 0 || t.kind !== "if" || !t.body) {
            reject("unclosed-construct");
            break;
          }
          afterKeyword = true;
        } else if (w === "in") {
          const t = top();
          if (t === void 0 || !["for", "select"].includes(t.kind)) {
            reject("unclosed-construct");
            break;
          }
        } else if (w === "fi") {
          const t = top();
          if (t === void 0 || t.kind !== "if" || !t.body) {
            reject("unclosed-construct");
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === "done") {
          const t = top();
          if (t === void 0 || !["for", "loop", "select"].includes(t.kind) || !t.body) {
            reject("unclosed-construct");
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === "esac") {
          reject("unclosed-construct");
          break;
        } else {
          afterKeyword = false;
          if (top()?.kind === "brace") top().body = true;
          if (functionSeen) {
            if (nameSeen) {
              functionSeen = false;
              nameSeen = false;
            } else {
              nameSeen = true;
            }
          }
        }
      } else {
        afterKeyword = false;
        if (functionSeen) {
          if (nameSeen) {
            functionSeen = false;
            nameSeen = false;
          } else {
            nameSeen = true;
          }
        }
      }
      buf += w;
      i = j;
      continue;
    }
    if (caseRegion === null && levels[levels.length - 1].length > 0 && (c === ";" || c === "&") && afterKeyword) {
      reject("unclosed-construct");
      break;
    }
    if (depth === 0) {
      if (isWordStart() && lastWordIsDanglingRedirect() && startsRedirectAt(i)) {
        reject("dangling-operator");
        break;
      }
      if (c === "$" && cmd[i + 1] === "{") {
        braceDepth += 1;
        buf += c;
        i += 1;
        continue;
      }
      if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
        let j = i + 2;
        let allowTabs = false;
        if (cmd[j] === "-") {
          allowTabs = true;
          j += 1;
        }
        while (cmd[j] === " " || cmd[j] === "	") j += 1;
        let delim = "";
        if (cmd[j] === "'" || cmd[j] === '"') {
          const q = cmd.indexOf(cmd[j], j + 1);
          if (q === -1) {
            delim = cmd.slice(j + 1);
            j = n;
          } else {
            delim = cmd.slice(j + 1, q);
            j = q + 1;
          }
        } else {
          const wordStart = j;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          delim = cmd.slice(wordStart, j);
        }
        if (delim !== "") {
          heredocs.push({
            close: new RegExp(`^${allowTabs ? "	*" : ""}${escapeRegExp(delim)}[ \\t]*$`)
          });
          bufHeredoc = true;
          if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
            buf += cmd.slice(i, j);
          }
          i = j;
          continue;
        }
      }
      if (caseRegion === null && levels[levels.length - 1].length === 0) {
        if (cmd.slice(i, i + 2) === "&&") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("and");
          i += 2;
          continue;
        }
        if (cmd.slice(i, i + 2) === "||") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("or");
          i += 2;
          continue;
        }
        if (cmd.slice(i, i + 2) === "|&") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("pipe");
          i += 2;
          continue;
        }
        if (c === ";") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("semicolon");
          i += 1;
          continue;
        }
        if (c === "|") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("pipe");
          i += 1;
          continue;
        }
        if (c === "\n") {
          if (isUnconsumedOperator()) {
            i += 1;
            continue;
          }
          if (lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("newline");
          listStart = parts.length;
          i += 1;
          continue;
        }
        if (c === "&") {
          const next = cmd[i + 1];
          const last = buf[buf.length - 1];
          if (next !== ">" && last !== ">" && last !== "<") {
            if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
              reject("dangling-operator");
              break;
            }
            flush("background");
            i += 1;
            continue;
          }
        }
      }
    }
    buf += c;
    i += 1;
  }
  if (malformed) return { stages: parts, malformed };
  if (inSquote || inDquote) {
    reject("unclosed-quote");
  } else if (braceDepth > 0) {
    reject("unclosed-brace");
  } else if (caseRegion !== null) {
    reject("unclosed-case");
  } else if (depth > 0) {
    reject("unbalanced-paren");
  } else if (levels[levels.length - 1].length > 0) {
    reject("unclosed-construct");
  } else if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
    reject("dangling-operator");
  } else if (inBody || heredocs.length > 0) {
    flush("newline");
    malformed = "unterminated-heredoc";
  } else {
    flush("newline");
  }
  return { stages: parts, malformed };
}
var LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
function stripLeadingAssignments(simpleCmd) {
  return simpleCmd.replace(LEADING_ASSIGNMENT, "");
}
function splitWords(s) {
  const words = [];
  let cur = "";
  let has = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (has) {
        words.push(cur);
        cur = "";
        has = false;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      has = true;
      i += 1;
      const end = s.indexOf("'", i);
      if (end === -1) return null;
      cur += s.slice(i, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      has = true;
      i += 1;
      while (i < n && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < n && '"\\$`'.includes(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else {
          cur += s[i];
          i += 1;
        }
      }
      if (i >= n) return null;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      has = true;
      cur += s[i + 1];
      i += 2;
      continue;
    }
    has = true;
    cur += c;
    i += 1;
  }
  if (has) words.push(cur);
  return words;
}
function hasUnquotedRedirect(simpleCmd) {
  let inSquote = false;
  let inDquote = false;
  for (let i = 0; i < simpleCmd.length; i++) {
    const c = simpleCmd[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i + 1 < simpleCmd.length && '"\\$`'.includes(simpleCmd[i + 1])) {
        i += 1;
      } else if (c === '"') {
        inDquote = false;
      }
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      continue;
    }
    if (c === "\\" && i + 1 < simpleCmd.length) {
      i += 1;
      continue;
    }
    if (c === "<") return true;
  }
  return false;
}
function argvOf(simpleCmd) {
  return splitWords(stripLeadingAssignments(simpleCmd).trim());
}
var REDIRECT_TWO_TOKEN = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))$/;
var REDIRECT_DUP = /^(?:[0-9]+)?[<>]&(?:[0-9]+|-)$/;
var REDIRECT_FUSED = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))[^<>&|]/;
var HEREDOC_TWO_TOKEN = /^(?:<<-?|<<<)$/;
var HEREDOC_FUSED = /^(?:<<-?|<<<)[^<>&|]/;
var REDIRECT_TOKEN = (w) => REDIRECT_TWO_TOKEN.test(w) || REDIRECT_DUP.test(w) || REDIRECT_FUSED.test(w) || HEREDOC_TWO_TOKEN.test(w) || HEREDOC_FUSED.test(w);
function stripRedirects(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REDIRECT_TWO_TOKEN.test(a) || HEREDOC_TWO_TOKEN.test(a)) {
      const next = argv[i + 1];
      if (next !== void 0 && !REDIRECT_TOKEN(next)) {
        i += 1;
      } else {
        out.push(a);
      }
      continue;
    }
    if (REDIRECT_DUP.test(a) || REDIRECT_FUSED.test(a) || HEREDOC_FUSED.test(a)) continue;
    out.push(a);
  }
  return out;
}
var WRAPPER_BUILTINS = /* @__PURE__ */ new Set([
  "exit",
  "exec",
  "true",
  "false",
  ":",
  "cd",
  "set",
  "unset",
  "export",
  "readonly",
  "return",
  "break",
  "continue"
]);
var RECOGNIZED_EXTERNAL_NAMES = /* @__PURE__ */ new Set([
  "sed",
  "head",
  "tail",
  "cat",
  "nl",
  "git",
  "true",
  "false",
  "timeout",
  "env",
  "command"
]);
var TIMEOUT_DURATION = /^\d+(?:\.\d+)?[smhd]?$/;
var ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;
function stripWrappersOnce(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  if (i >= argv.length) return argv.slice(i);
  const head = argv[i];
  if (head === "command") {
    const next = argv[i + 1];
    if (next === "-v" || next === "-V") return null;
    if (next === "-p") return argv.slice(i + 2);
    if (next !== void 0 && !next.startsWith("-")) return argv.slice(i + 1);
    return null;
  }
  if (head === "builtin") {
    const next = argv[i + 1];
    if (next !== void 0 && WRAPPER_BUILTINS.has(next)) return argv.slice(i + 2);
    return null;
  }
  if (head === "env") {
    let j = i + 1;
    while (j < argv.length && ENV_ASSIGNMENT.test(argv[j])) j++;
    if (j === i + 1) return null;
    return argv.slice(j);
  }
  if (head === "timeout") {
    let j = i + 1;
    while (j < argv.length && argv[j].startsWith("--")) j++;
    if (j >= argv.length || !TIMEOUT_DURATION.test(argv[j])) return null;
    return argv.slice(j + 1);
  }
  if (head.startsWith("/")) {
    const base = head.slice(head.lastIndexOf("/") + 1);
    if (RECOGNIZED_EXTERNAL_NAMES.has(base)) return [base, ...argv.slice(i + 1)];
    return null;
  }
  if (head.includes("/")) return null;
  return argv.slice(i);
}
function stripWrappers(argv) {
  let current = argv;
  for (let iter = 0; iter < argv.length + 2; iter++) {
    const next = stripWrappersOnce(current);
    if (next === null) return argv;
    if (next.length === current.length && next.every((w, k) => w === current[k])) return current;
    current = next;
  }
  return argv;
}

// src/common/variable-expand.ts
var DEFAULT_PATH_ALLOWLIST = [
  "HOME",
  "PWD",
  "WORKSPACE_PATH",
  "CARD_REPO_PATH",
  "REPO_ROOT",
  "BASE_BRANCH"
];
var BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
var BRACED_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function expandVariables(text, variables, env) {
  const resolve2 = (name) => {
    const fromTable = variables.get(name);
    if (fromTable !== void 0) return fromTable;
    const fromEnv = env[name];
    return fromEnv !== void 0 ? fromEnv : void 0;
  };
  let out = "";
  let i = 0;
  const n = text.length;
  let inSingle = false;
  let inDouble = false;
  while (i < n) {
    const c = text[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      out += c;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        inDouble = false;
        out += c;
        i++;
        continue;
      }
      if (c === "\\" && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === "\\") {
        out += c;
        i++;
        continue;
      }
      if (c === "$") {
        const ref = expandRef(text, i, resolve2);
        out += ref.text;
        i = ref.next;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += c;
      if (i + 1 < n) {
        out += text[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (c === "$") {
      const ref = expandRef(text, i, resolve2);
      out += ref.text;
      i = ref.next;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function expandRef(text, start, resolve2) {
  const rest = text.slice(start + 1);
  if (rest.startsWith("(")) return { text: "$", next: start + 1 };
  if (rest.startsWith("{")) {
    const close = text.indexOf("}", start + 2);
    if (close === -1) return { text: "$", next: start + 1 };
    const inner = text.slice(start + 2, close);
    if (BRACED_NAME.test(inner)) {
      const value2 = resolve2(inner);
      if (value2 !== void 0) return { text: value2, next: close + 1 };
    }
    return { text: "$", next: start + 1 };
  }
  const name = BARE_NAME.exec(rest);
  if (name === null) return { text: "$", next: start + 1 };
  const value = resolve2(name[0]);
  if (value !== void 0) return { text: value, next: start + 1 + name[0].length };
  return { text: "$", next: start + 1 };
}

// src/common/parse-command.ts
var ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
var SET_OPTION_NAMES = /* @__PURE__ */ new Set([
  "allexport",
  "braceexpand",
  "emacs",
  "errexit",
  "errtrace",
  "functrace",
  "hashall",
  "histexpand",
  "history",
  "ignoreeof",
  "interactive-comments",
  "keyword",
  "lexical-word-processing",
  "monitor",
  "noclobber",
  "noexec",
  "noglob",
  "nolog",
  "notify",
  "nounset",
  "onecmd",
  "physical",
  "pipefail",
  "posix",
  "privileged",
  "verbose",
  "vi",
  "xtrace"
]);
var SET_FLAG_LETTERS = "aBbCeEfhHikmnopPtTuvx";
var RECOGNIZED_BUILTINS = /* @__PURE__ */ new Set([
  "true",
  ":",
  "false",
  "set",
  "exit",
  "exec",
  "return",
  "break",
  "continue",
  "cd",
  "export",
  "command",
  "builtin"
]);
function walkStrip(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  while (i < argv.length && argv[i] === "command") i++;
  while (i < argv.length && argv[i] === "builtin" && argv[i + 1] !== void 0 && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}
function stripForEmission(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  while (i < argv.length && (argv[i] === "command" || argv[i] === "exec")) i++;
  while (i < argv.length && argv[i] === "builtin" && argv[i + 1] !== void 0 && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}
function setFlagsKnown(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-") || a.startsWith("+")) {
      const chars = a.slice(1);
      if (chars.length === 0) return false;
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === "o") {
          const name = args[i + 1];
          if (name === void 0 || !SET_OPTION_NAMES.has(name)) return false;
          i++;
        } else if (!SET_FLAG_LETTERS.includes(c)) {
          return false;
        }
      }
    }
  }
  return true;
}
var CONSTRUCT_OPENERS = /* @__PURE__ */ new Set(["if", "while", "until", "for", "case", "select"]);
var CONSTRUCT_CLOSERS = /* @__PURE__ */ new Set(["fi", "done", "esac"]);
function scanTokens(text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  let parenDepth = 0;
  let braceDepth = 0;
  let constructDepth = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === "{") {
      if (c === "(") parenDepth++;
      else braceDepth++;
      i++;
      continue;
    }
    if (c === ")" || c === "}") {
      if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
      else braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (";&|<>".includes(c)) {
      i++;
      continue;
    }
    const start = i;
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    toks.push({ word: w.word, start, end: w.end, depth: parenDepth, braceDepth, constructDepth, quoted: w.quoted });
    if (parenDepth === 0 && braceDepth === 0 && !w.quoted) {
      if (CONSTRUCT_OPENERS.has(w.word)) constructDepth++;
      else if (CONSTRUCT_CLOSERS.has(w.word)) constructDepth = Math.max(0, constructDepth - 1);
    }
  }
  return toks;
}
function readWordAt(text, i) {
  if (i >= text.length) return null;
  let word = "";
  let quoted = false;
  const n = text.length;
  while (i < n && !/\s/.test(text[i]) && !"(){};&|<>".includes(text[i])) {
    const ch = text[i];
    if (ch === "'") {
      quoted = true;
      i++;
      while (i < n && text[i] !== "'") {
        word += text[i];
        i++;
      }
      if (i < n) i++;
    } else if (ch === '"') {
      quoted = true;
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
          word += text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i++;
        }
      }
      if (i < n) i++;
    } else if (ch === "\\" && i + 1 < n) {
      word += text[i + 1];
      i += 2;
    } else {
      word += ch;
      i++;
    }
  }
  return { word, end: i, quoted };
}
function extractGroupBody(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inQuote = null;
  for (let p = start; p < text.length; p++) {
    const ch = text[p];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && p + 1 < text.length && '"\\$`'.includes(text[p + 1])) p++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === "\\") {
      p++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, p);
    }
  }
  return null;
}
function classifyStage(text) {
  const t = text.trimStart();
  if (t.startsWith("{")) return "brace";
  if (t.startsWith("(")) return "subshell";
  const kw = t.match(/^(if|while|until|for|case|select)\b/);
  if (kw !== null) return kw[1];
  if (/^(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{/.test(t)) return "def";
  return "plain";
}
function parseDef(text) {
  const m = text.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
  if (m === null) return null;
  const body = extractGroupBody(text, "{", "}");
  if (body === null) return null;
  return { name: m[1], body };
}
function parseIf(text) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== "if") return null;
  const thenIdx = toks.findIndex((t) => t.word === "then" && t.constructDepth === 1);
  if (thenIdx === -1) return null;
  const thenTok = toks[thenIdx];
  const condition = text.slice(toks[0].end, thenTok.start);
  const boundaries = [];
  for (let idx = thenIdx + 1; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.constructDepth !== 1 || t.word !== "elif" && t.word !== "else" && t.word !== "fi") continue;
    if (t.word === "elif") {
      const eThenIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === "then" && tt.constructDepth === 1);
      if (eThenIdx === -1) return null;
      boundaries.push({ word: "elif", tok: t }, { word: "then", tok: toks[eThenIdx] });
      idx = eThenIdx;
      continue;
    }
    boundaries.push({ word: t.word, tok: t });
    if (t.word === "else") {
      const fiIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === "fi" && tt.constructDepth === 1);
      if (fiIdx === -1) return null;
      boundaries.push({ word: "fi", tok: toks[fiIdx] });
      break;
    }
    break;
  }
  if (boundaries.length === 0) return null;
  const thenBody = text.slice(thenTok.end, boundaries[0].tok.start);
  const elifs = [];
  let elseBody = null;
  for (let b = 0; b < boundaries.length; b++) {
    const { word, tok } = boundaries[b];
    if (word === "elif") {
      const eThen = boundaries[b + 1];
      if (eThen === void 0 || eThen.word !== "then") return null;
      const nextStart = boundaries[b + 2]?.tok.start ?? text.length;
      elifs.push({ condition: text.slice(tok.end, eThen.tok.start), body: text.slice(eThen.tok.end, nextStart) });
      b++;
    } else if (word === "else") {
      const fi = boundaries[b + 1];
      if (fi === void 0 || fi.word !== "fi") return null;
      elseBody = text.slice(tok.end, fi.tok.start);
      break;
    }
  }
  return { condition, thenBody, elifs, elseBody };
}
function parseLoop(text, keyword) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== keyword) return null;
  const doTok = toks.find((t) => t.word === "do" && t.constructDepth === 1);
  if (doTok === void 0) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === "done" && t.constructDepth === 1);
  if (doneTok === void 0) return null;
  return { condition: text.slice(toks[0].end, doTok.start), body: text.slice(doTok.end, doneTok.start) };
}
function parseFor(text) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== "for") return null;
  const nameTok = toks[1];
  if (nameTok === void 0) return null;
  const doTok = toks.find((t) => t.word === "do" && t.constructDepth === 1 && t.start > nameTok.end);
  if (doTok === void 0) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === "done" && t.constructDepth === 1);
  if (doneTok === void 0) return null;
  const inTok = toks.find(
    (t) => t.start > nameTok.end && t.start < doTok.start && t.word === "in" && t.constructDepth === 1
  );
  let list = null;
  if (inTok !== void 0) {
    list = toks.filter((t) => t.start > inTok.end && t.start < doTok.start).map((t) => t.word);
  }
  return { list, body: text.slice(doTok.end, doneTok.start), wholeInterior: text.slice(nameTok.end, doneTok.start) };
}
function parseCase(text) {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  skipWs();
  const lead = readWordAt(text, i);
  if (lead === null || lead.word !== "case") return null;
  i = lead.end;
  let parenDepth = 0;
  const subjectWords = [];
  while (i < n) {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (c === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      i++;
      continue;
    }
    if (";&|<>".includes(c)) {
      i++;
      continue;
    }
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    if (parenDepth === 0 && !w.quoted && w.word === "in") break;
    subjectWords.push(w.word);
  }
  if (i >= n) return null;
  const branches = [];
  let fallthrough = false;
  while (true) {
    skipWs();
    if (i >= n) return null;
    const w = readWordAt(text, i);
    if (w !== null && !w.quoted && w.word === "esac") {
      return { subject: subjectWords.join(" "), branches, fallthrough };
    }
    let patEnd = -1;
    {
      let p = i;
      let depth = 0;
      let inQuote = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === "\\" && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === "\\") {
          p += 2;
          continue;
        }
        if (ch === "(") {
          depth++;
          p++;
          continue;
        }
        if (ch === ")") {
          if (depth === 0) {
            patEnd = p;
            break;
          }
          depth--;
          p++;
          continue;
        }
        p++;
      }
    }
    if (patEnd === -1) return null;
    const pattern = text.slice(i, patEnd).trim();
    i = patEnd + 1;
    let bodyEnd = -1;
    let term = "";
    {
      let p = i;
      let depth = 0;
      let bdepth = 0;
      let inQuote = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === "\\" && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === "\\") {
          p += 2;
          continue;
        }
        if (ch === "(") {
          depth++;
          p++;
          continue;
        }
        if (ch === ")") {
          depth = Math.max(0, depth - 1);
          p++;
          continue;
        }
        if (ch === "{") {
          bdepth++;
          p++;
          continue;
        }
        if (ch === "}") {
          bdepth = Math.max(0, bdepth - 1);
          p++;
          continue;
        }
        if (depth === 0 && bdepth === 0 && ch === ";") {
          const next = text[p + 1];
          if (next === ";" || next === "&") {
            term = next === ";" ? text[p + 2] === "&" ? ";;&" : ";;" : ";&";
            bodyEnd = p;
            break;
          }
        }
        p++;
      }
    }
    if (term === "") return null;
    branches.push({ pattern, body: text.slice(i, bodyEnd).trim() });
    i = bodyEnd + term.length;
    if (term === ";&" || term === ";;&") fallthrough = true;
  }
}
function resolveSubject(subject, assignments) {
  const m = subject.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/) ?? subject.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (m !== null) {
    const v = assignments.get(m[1]);
    return v !== void 0 ? v : null;
  }
  if (/[$`]/.test(subject)) return null;
  return subject;
}
function splitPatternAlternatives(pattern) {
  const parts = [];
  let cur = "";
  let inQuote = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        cur += ch;
        cur += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < pattern.length) {
      cur += ch;
      cur += pattern[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}
function analyzePattern(pattern) {
  let literal = "";
  let glob = false;
  let inQuote = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        literal += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        continue;
      }
      literal += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < pattern.length) {
      literal += pattern[i + 1];
      i++;
      continue;
    }
    if ("*?[".includes(ch)) {
      glob = true;
      literal += ch;
      continue;
    }
    literal += ch;
  }
  return { literal, glob };
}
function evalPattern(pattern, subject) {
  const alts = splitPatternAlternatives(pattern);
  let matched = false;
  for (const alt of alts) {
    const { literal, glob } = analyzePattern(alt);
    if (glob) {
      if (!matched) return "glob";
    } else if (literal === subject) {
      matched = true;
    } else if (matched) {
      return "undecidable";
    }
  }
  return matched ? "match" : "no-match";
}
var ExecutionWalker = class {
  chain = "success";
  errexit = false;
  pipefail = false;
  assignments = /* @__PURE__ */ new Map();
  defs = /* @__PURE__ */ new Map();
  dead = null;
  returned = false;
  fnDepth = 0;
  loopStack = [];
  expanded = [];
  verdicts = [];
  dirFrame = 0;
  defProbeStack = /* @__PURE__ */ new Set();
  walkInput(stages) {
    this.walkList(stages, { liveness: true, discard: false, sideEffects: true, inputFacing: true });
    return this.expanded;
  }
  stopped() {
    if (this.dead !== null || this.returned) return true;
    const top = this.loopStack[this.loopStack.length - 1];
    return top !== void 0 && (top.bodyTerminated || top.ambiguousStop);
  }
  /** Walk one list (a fresh `&&`/`||` chain); returns the list's final chain status. */
  walkList(stages, opts) {
    const savedChain = this.chain;
    this.chain = "success";
    let i = 0;
    while (i < stages.length && !this.stopped()) {
      const end = this.groupEnd(stages, i);
      const next = end < stages.length ? stages[end] : null;
      this.processGroup(stages.slice(i, end), next, opts);
      i = end;
    }
    const result = this.chain;
    while (i < stages.length) {
      if (opts.inputFacing) this.verdicts.push("no");
      i++;
    }
    this.chain = savedChain;
    return result;
  }
  groupEnd(stages, start) {
    let end = start;
    while (end + 1 < stages.length && stages[end + 1].precededBy === "pipe") end++;
    return end + 1;
  }
  processGroup(group, next, opts) {
    const first = group[0];
    let executes;
    switch (first.precededBy) {
      case "and":
        executes = this.chain === "success" ? true : this.chain === "failure" ? false : "unknown";
        break;
      case "or":
        executes = this.chain === "failure" ? true : this.chain === "success" ? false : "unknown";
        break;
      default:
        executes = true;
    }
    const exec = executes === true ? "yes" : executes === false ? "no" : "unknown";
    const backgrounded = first.precededBy === "background" || next !== null && next.precededBy === "background";
    if (opts.inputFacing) {
      for (let i = 0; i < group.length; i++) this.verdicts.push(exec);
    }
    const firstArgv = argvOf(first.text);
    let bangCount = 0;
    let memberArgv = firstArgv;
    if (firstArgv !== null) {
      while (memberArgv[bangCount] === "!") bangCount++;
      memberArgv = memberArgv.slice(bangCount);
    }
    const inverted = bangCount % 2 === 1;
    if (exec === "no") return;
    const statuses = [];
    const inPipeline = group.length > 1;
    for (let m = 0; m < group.length; m++) {
      statuses.push(
        this.processMember(group[m], {
          exec,
          inPipeline,
          backgrounded,
          memberArgv: m === 0 ? memberArgv : null,
          opts
        })
      );
    }
    let groupStatus;
    if (this.pipefail && group.length > 1) {
      if (statuses.every((s) => s === "success")) groupStatus = "success";
      else if (statuses.some((s) => s === "failure")) groupStatus = "failure";
      else groupStatus = "unknown";
    } else {
      groupStatus = statuses[statuses.length - 1];
    }
    if (inverted) {
      groupStatus = groupStatus === "success" ? "failure" : groupStatus === "failure" ? "success" : "unknown";
    }
    if (opts.liveness && this.errexit && groupStatus !== "success") {
      const chainFinal = next === null || next.precededBy !== "and" && next.precededBy !== "or";
      if (chainFinal && !inverted && !backgrounded) this.dead = "errexit";
    }
    if (exec === "yes") this.chain = groupStatus;
    else this.chain = "unknown";
  }
  processMember(member, ctx) {
    const kind = classifyStage(member.text);
    if (kind === "plain") return this.processPlainMember(member, ctx);
    return this.processConstruct(member, kind, ctx);
  }
  processPlainMember(member, ctx) {
    const { exec, inPipeline, backgrounded, memberArgv, opts } = ctx;
    const argv = memberArgv ?? argvOf(member.text);
    const stripped = argv === null ? null : walkStrip(argv);
    if (exec === "yes" && !inPipeline && opts.sideEffects) {
      this.applySideEffects(member, argv, stripped);
    }
    const status = this.knownStatus(argv);
    if (!inPipeline && exec !== "no" && stripped !== null && (stripped[0] === "exit" || stripped[0] === "exec")) {
      this.dead = "exit";
    }
    if (!inPipeline && exec === "yes" && this.fnDepth > 0 && stripped !== null && stripped[0] === "return") {
      this.returned = true;
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== void 0) top.outcome = "return";
    }
    if (!inPipeline && exec !== "no" && stripped !== null && (stripped[0] === "break" || stripped[0] === "continue")) {
      this.applyBreakContinue(stripped, exec);
    }
    if (exec !== "no" && stripped !== null && stripped.length > 0) {
      this.applyCall(stripped[0], inPipeline, backgrounded);
    }
    if (!opts.discard) {
      this.expanded.push({
        text: member.text,
        precededBy: member.precededBy,
        exec,
        inPipeline,
        dirFrame: this.dirFrame,
        assignments: new Map(this.assignments)
      });
    }
    return status;
  }
  applyBreakContinue(stripped, exec) {
    const depth = Number.parseInt(stripped[1] ?? "1", 10);
    if (Number.isNaN(depth) || depth < 1) return;
    if (this.loopStack.length === 0 || depth > this.loopStack.length) return;
    if (exec === "unknown") {
      for (let d = 0; d < depth; d++) {
        const frame = this.loopStack[this.loopStack.length - 1 - d];
        if (frame.outcome === "none") {
          frame.outcome = "ambiguous";
          frame.ambiguousStop = true;
        }
      }
      return;
    }
    const isContinue = stripped[0] === "continue";
    for (let d = 0; d < depth; d++) {
      const frame = this.loopStack[this.loopStack.length - 1 - d];
      frame.outcome = isContinue ? "continue" : "break";
      frame.bodyTerminated = true;
    }
  }
  /** A may-run call to a registered definition fires per its body's dead kind. */
  applyCall(name, inPipeline, backgrounded) {
    if (!this.defs.has(name) || backgrounded) return;
    if (this.defProbeStack.has(name)) return;
    const body = this.defs.get(name);
    this.defProbeStack.add(name);
    const kind = this.defBodyFireKind(body);
    this.defProbeStack.delete(name);
    if (kind === null) return;
    if (kind === "never-return") {
      this.dead = "never-return";
    } else if (!inPipeline) {
      this.dead = kind;
    }
  }
  /** Whether a definition body, walked as its own function, ends dead. */
  defBodyFireKind(body) {
    const res = splitTopLevel(body);
    if (res.malformed !== void 0) return "malformed";
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    this.dead = null;
    this.returned = false;
    this.fnDepth = this.fnDepth + 1;
    this.loopStack = [];
    this.walkList(res.stages, { liveness: true, discard: true, sideEffects: true, inputFacing: false });
    const kind = this.dead;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    return kind;
  }
  knownStatus(argv) {
    if (argv === null || argv.length === 0) return "success";
    const a = walkStrip(stripWrappers(stripRedirects(argv)));
    if (a.length === 0) return "success";
    if (a[0] === "true" || a[0] === ":") return "success";
    if (a[0] === "false") return "failure";
    if (a.every((w) => ASSIGNMENT_RE.test(w))) return "success";
    if (a[0] === "export" && a.length > 1 && a.slice(1).every((w) => ASSIGNMENT_RE.test(w))) return "success";
    if (a[0] === "set") return setFlagsKnown(a.slice(1)) ? "success" : "unknown";
    return "unknown";
  }
  applySideEffects(member, argv, stripped) {
    if (argv === null || argv.length === 0) return;
    const words = splitWords(member.text);
    if (words !== null && words.length > 0) {
      let k = 0;
      while (k < words.length && ASSIGNMENT_RE.test(words[k])) k++;
      if (k === words.length) {
        for (const w of words) {
          const eq = w.indexOf("=");
          this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
        }
      } else if (words[0] === "export") {
        for (const w of words.slice(1)) {
          if (ASSIGNMENT_RE.test(w)) {
            const eq = w.indexOf("=");
            this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
          }
        }
      }
    }
    if (stripped !== null && stripped[0] === "set") this.applySetFlags(stripped.slice(1));
    if (stripped !== null && stripped[0] === "unset") {
      for (const w of stripped.slice(1)) {
        if (!w.startsWith("-")) this.assignments.delete(w);
      }
    }
  }
  applySetFlags(args) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--") continue;
      if (!(a.startsWith("-") || a.startsWith("+"))) continue;
      const on = a.startsWith("-");
      const chars = a.slice(1);
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === "o") {
          const name = args[i + 1];
          if (name === void 0) return;
          if (name === "errexit") this.errexit = on;
          else if (name === "noerrexit") this.errexit = !on;
          else if (name === "pipefail") this.pipefail = on;
          else if (name === "nopipefail") this.pipefail = !on;
          i++;
          break;
        }
        if (c === "e") this.errexit = on;
      }
    }
  }
  processConstruct(member, kind, ctx) {
    const { exec, backgrounded, opts } = ctx;
    const discard = opts.discard || exec !== "yes";
    const sideEffects = opts.sideEffects && exec === "yes";
    switch (kind) {
      case "if": {
        const parsed = parseIf(member.text);
        if (parsed === null) return "unknown";
        const regions = [
          parsed.condition,
          parsed.thenBody,
          ...parsed.elifs.flatMap((e) => [e.condition, e.body]),
          ...parsed.elseBody !== null ? [parsed.elseBody] : []
        ];
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === "unknown") return this.opaquePath(regions, ctx);
        if (condStatus === "success") {
          return this.walkBranch(parsed.thenBody, discard, sideEffects);
        }
        for (const elif of parsed.elifs) {
          const eStatus = this.walkList(splitTopLevel(elif.condition).stages, {
            liveness: false,
            discard: true,
            sideEffects: true,
            inputFacing: false
          });
          if (eStatus === "unknown") return this.opaquePath(regions, ctx);
          if (eStatus === "success") return this.walkBranch(elif.body, discard, sideEffects);
        }
        if (parsed.elseBody !== null) return this.walkBranch(parsed.elseBody, discard, sideEffects);
        return "success";
      }
      case "while":
      case "until": {
        const parsed = parseLoop(member.text, kind);
        if (parsed === null) return "unknown";
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === "unknown") return this.opaquePath([parsed.condition, parsed.body], ctx);
        const bodyRuns = kind === "while" ? condStatus === "success" : condStatus === "failure";
        if (!bodyRuns) return "success";
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        const frame = { outcome: "none", bodyTerminated: false, ambiguousStop: false };
        this.loopStack.push(frame);
        this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        this.loopStack.pop();
        switch (frame.outcome) {
          case "break":
            return "success";
          case "continue":
          case "none":
            if (this.dead === null && !backgrounded) this.dead = "never-return";
            return "unknown";
          case "ambiguous":
          case "return":
            return "unknown";
        }
        return "unknown";
      }
      case "for": {
        const parsed = parseFor(member.text);
        if (parsed === null) return "unknown";
        if (parsed.list === null || parsed.list.some((w) => /[$`]/.test(w))) {
          return this.opaquePath([parsed.wholeInterior], ctx);
        }
        if (parsed.list.length === 0) return "success";
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case "case": {
        const parsed = parseCase(member.text);
        if (parsed === null) return "unknown";
        const regions = parsed.branches.map((b) => b.body);
        if (parsed.fallthrough || resolveSubject(parsed.subject, this.assignments) === null) {
          return this.opaquePath(regions, ctx);
        }
        const subject = resolveSubject(parsed.subject, this.assignments);
        let matchedBranch = -1;
        let undecidable = false;
        for (let b = 0; b < parsed.branches.length; b++) {
          const r = evalPattern(parsed.branches[b].pattern, subject);
          if (r === "match") {
            matchedBranch = b;
            break;
          }
          if (r === "glob" || r === "undecidable") {
            undecidable = true;
            break;
          }
        }
        if (undecidable) return this.opaquePath(regions, ctx);
        if (matchedBranch !== -1) {
          return this.walkBranch(parsed.branches[matchedBranch].body, discard, sideEffects);
        }
        return "success";
      }
      case "select": {
        const parsed = parseLoop(member.text, "while");
        return this.opaquePath(parsed !== null ? [parsed.body] : [], ctx);
      }
      case "brace": {
        const interior = extractGroupBody(member.text, "{", "}");
        if (interior === null) return "unknown";
        const res = splitTopLevel(interior);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case "subshell": {
        const interior = extractGroupBody(member.text, "(", ")");
        if (interior === null) return "unknown";
        const res = splitTopLevel(interior);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        const savedErrexit = this.errexit;
        const savedPipefail = this.pipefail;
        const savedAssignments = this.assignments;
        const savedDefs = this.defs;
        const savedReturned = this.returned;
        const savedFnDepth = this.fnDepth;
        const savedLoopStack = this.loopStack;
        const savedDirFrame = this.dirFrame;
        const savedDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = new Map(savedAssignments);
        this.defs = new Map(savedDefs);
        this.returned = false;
        this.fnDepth = 0;
        this.loopStack = [];
        this.dirFrame = savedDirFrame + 1;
        this.dead = null;
        const status = this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        const innerDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = savedAssignments;
        this.defs = savedDefs;
        this.returned = savedReturned;
        this.fnDepth = savedFnDepth;
        this.loopStack = savedLoopStack;
        this.dirFrame = savedDirFrame;
        this.dead = savedDead;
        if (innerDead === "never-return") this.dead = "never-return";
        return status;
      }
      case "def": {
        if (sideEffects) {
          const def = parseDef(member.text);
          if (def !== null) this.defs.set(def.name, def.body);
        }
        return "success";
      }
    }
    return "unknown";
  }
  walkBranch(body, discard, sideEffects) {
    const res = splitTopLevel(body);
    if (res.malformed !== void 0) {
      this.dead = "malformed";
      return "unknown";
    }
    return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
  }
  /**
   * The opaque-construct treatment (plan §2): re-split each region and walk it
   * with the same machinery so an `exit`/`exec` that may have run, or a
   * never-exit loop, fires fail-closed; hidden break/continue words reach the
   * scanned loop as an ambiguous termination. State is snapshot-restored.
   */
  opaquePath(regions, ctx) {
    const findings = this.scanOpaque(regions);
    if (findings.fire !== null) {
      if (findings.fire === "never-return") {
        if (!ctx.backgrounded) this.dead = "never-return";
      } else if (!ctx.inPipeline && !ctx.backgrounded) {
        this.dead = findings.fire;
      }
    }
    if (findings.breakTarget !== "none") {
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== void 0) {
        top.outcome = "ambiguous";
        top.ambiguousStop = true;
      }
    }
    return "unknown";
  }
  scanOpaque(regions) {
    const report = {
      fire: null,
      breakTarget: "none"
    };
    const savedChain = this.chain;
    const savedErrexit = this.errexit;
    const savedPipefail = this.pipefail;
    const savedAssignments = this.assignments;
    const savedDefs = this.defs;
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    const savedDirFrame = this.dirFrame;
    const savedVerdicts = this.verdicts.length;
    const savedExpanded = this.expanded.length;
    const savedDefProbe = new Set(this.defProbeStack);
    for (const region of regions) {
      const res = splitTopLevel(region);
      if (res.malformed !== void 0) {
        report.fire = "malformed";
        break;
      }
      this.dead = null;
      this.returned = false;
      this.loopStack = savedLoopStack.map((f) => ({ ...f }));
      this.walkList(res.stages, { liveness: true, discard: true, sideEffects: false, inputFacing: false });
      if (this.dead !== null) {
        if (report.fire === null || this.dead === "never-return" || this.dead === "malformed") report.fire = this.dead;
      }
      if (report.breakTarget === "none") {
        const innermost = this.loopStack[this.loopStack.length - 1];
        if (innermost !== void 0 && (innermost.outcome === "break" || innermost.outcome === "continue")) {
          report.breakTarget = innermost.outcome;
        }
      }
    }
    this.chain = savedChain;
    this.errexit = savedErrexit;
    this.pipefail = savedPipefail;
    this.assignments = savedAssignments;
    this.defs = savedDefs;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    this.dirFrame = savedDirFrame;
    this.verdicts.length = savedVerdicts;
    this.expanded.length = savedExpanded;
    this.defProbeStack.clear();
    for (const name of savedDefProbe) this.defProbeStack.add(name);
    return report;
  }
};
function resolveSpec(spec, totalLines) {
  switch (spec.kind) {
    case "literal":
      return { lineStart: spec.start, lineEnd: spec.end };
    case "upperBoundFromStart": {
      const total = totalLines();
      return { lineStart: 1, lineEnd: total !== null ? Math.min(spec.end, total) : spec.end };
    }
    case "toEof": {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: spec.start, lineEnd: Math.max(spec.start, total) };
    }
    case "lastNLines": {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: Math.max(1, total - spec.count + 1), lineEnd: total };
    }
    case "appendLines": {
      const total = totalLines() ?? 0;
      return { lineStart: total + 1, lineEnd: total + spec.count };
    }
  }
}
function hasShellExpansion(s) {
  return /[$`]/.test(s);
}
function looksUnresolvable(s) {
  return hasShellExpansion(s) || /[*?]/.test(s);
}
var SED_RANGE = /^(\d+)(?:,(\d+|\$))?p$/;
function sedScriptSegments(script) {
  return script.split(";");
}
function matchSed(argv) {
  if (argv[0] !== "sed") return [];
  const rest = argv.slice(1);
  if (!rest.includes("-n")) return [];
  let scriptIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "-n") continue;
    if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
      scriptIdx = i;
      break;
    }
  }
  if (scriptIdx === -1) return [];
  const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
  if (fileCandidates.length !== 1) return [];
  const fileArg = fileCandidates[0];
  const results = [];
  for (const segment of sedScriptSegments(rest[scriptIdx])) {
    const match = segment.match(SED_RANGE);
    if (!match) continue;
    const start = Number.parseInt(match[1], 10);
    const endToken = match[2];
    const spec = endToken === void 0 ? { kind: "literal", start, end: start } : endToken === "$" ? { kind: "toEof", start } : { kind: "literal", start, end: Number.parseInt(endToken, 10) };
    results.push({ kind: "candidate", idiom: "sed-n-range", fileArg, spec, resolverKind: "fs" });
  }
  return results;
}
function parseHeadTailFlags(rest, barePlusIsCount) {
  const files = [];
  let count = null;
  let fromStart = false;
  let disqualified = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-f" || a === "-F" || a === "--follow" || a.startsWith("--follow=")) {
      disqualified = true;
      continue;
    }
    if (a === "-z" || a === "--zero-terminated") {
      disqualified = true;
      continue;
    }
    if (a === "-c" || a === "--bytes") {
      disqualified = true;
      i += 1;
      continue;
    }
    if (/^(-c|--bytes=)/.test(a)) {
      disqualified = true;
      continue;
    }
    if (a === "-q" || a === "-v" || a === "--quiet" || a === "--silent" || a === "--verbose") continue;
    if (a === "-n") {
      const v = rest[i + 1];
      if (v !== void 0 && /^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
        i += 1;
      }
      continue;
    }
    if (a.startsWith("--lines=")) {
      const v = a.slice("--lines=".length);
      if (/^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
      }
      continue;
    }
    if (/^-n\+?\d+$/.test(a)) {
      const v = a.slice(2);
      fromStart = v.startsWith("+");
      count = Number.parseInt(v.replace("+", ""), 10);
      continue;
    }
    if (/^\+\d+$/.test(a)) {
      if (barePlusIsCount) {
        fromStart = true;
        count = Number.parseInt(a.slice(1), 10);
      } else {
        files.push(a);
      }
      continue;
    }
    if (/^-\d+$/.test(a)) {
      count = Number.parseInt(a.slice(1), 10);
      continue;
    }
    if (a === "-") {
      files.push(a);
      continue;
    }
    if (a.startsWith("-")) continue;
    files.push(a);
  }
  return { count, fromStart, disqualified, files };
}
function matchHead(argv) {
  if (argv[0] !== "head") return [];
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1), false);
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-" && !/^\+\d+$/.test(f));
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "head-file",
    fileArg,
    spec: { kind: "upperBoundFromStart", end: n },
    resolverKind: "fs"
  }));
}
function matchTail(argv) {
  if (argv[0] !== "tail") return [];
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), true);
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-");
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  const spec = fromStart ? { kind: "toEof", start: n } : { kind: "lastNLines", count: n };
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "tail-file",
    fileArg,
    spec,
    resolverKind: "fs"
  }));
}
function findGitSubcommand(rest) {
  let cDir = null;
  let cDirUnresolvable = false;
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === "-C") {
      const v = rest[i + 1];
      if (v === void 0) return null;
      if (hasShellExpansion(v)) cDirUnresolvable = true;
      else cDir = v;
      i += 2;
      continue;
    }
    if (a === "-c") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    return { subIdx: i, subcommand: a, cDir, cDirUnresolvable };
  }
  return null;
}
var REV_PATH = /^([^\s:]+):(.+)$/;
function matchGitShow(argv) {
  if (argv[0] !== "git") return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (!sub || sub.subcommand !== "show") return [];
  const after = argv.slice(1).slice(sub.subIdx + 1).filter((a) => !a.startsWith("-"));
  const revPathArg = after.find((a) => REV_PATH.test(a));
  if (!revPathArg) return [];
  const m = revPathArg.match(REV_PATH);
  if (!m) return [];
  const [, rev, path] = m;
  if (sub.cDirUnresolvable || hasShellExpansion(rev)) {
    return [
      {
        kind: "unresolved",
        idiom: "git-show-rev-path",
        fileArg: path,
        reason: "git -C target or revision contains an unresolved shell variable"
      }
    ];
  }
  return [
    {
      kind: "candidate",
      idiom: "git-show-rev-path",
      fileArg: path,
      spec: { kind: "toEof", start: 1 },
      resolverKind: { kind: "git", rev },
      dirOverride: sub.cDir ?? void 0
    }
  ];
}
function matchGitLogL(argv) {
  if (argv[0] !== "git") return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (!sub || sub.subcommand !== "log") return [];
  const after = argv.slice(1).slice(sub.subIdx + 1);
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    let spec = null;
    if (a === "-L") spec = after[i + 1] ?? null;
    else if (a.startsWith("-L")) spec = a.slice(2);
    if (!spec) continue;
    const m = spec.match(/^(\d+),(\d+):(.+)$/);
    if (!m) continue;
    const [, s, e, path] = m;
    if (sub.cDirUnresolvable) {
      return [
        {
          kind: "unresolved",
          idiom: "git-log-L",
          fileArg: path,
          reason: "git -C target contains an unresolved shell variable"
        }
      ];
    }
    return [
      {
        kind: "candidate",
        idiom: "git-log-L",
        fileArg: path,
        spec: { kind: "literal", start: Number.parseInt(s, 10), end: Number.parseInt(e, 10) },
        resolverKind: "fs",
        dirOverride: sub.cDir ?? void 0
      }
    ];
  }
  return [];
}
var HEREDOC_OPEN = /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/g;
function escapeRegExp2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractHeredocWrites(raw) {
  const writes = [];
  let masked = "";
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const openEnd = openMatch.index + openMatch[0].length;
    if (!delim || openMatch.index < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const nl = raw.slice(openEnd).match(/^[ \t]*\r?\n/);
    const bodyStart = nl !== null ? openEnd + nl[0].length : openEnd;
    const remainder = raw.slice(bodyStart);
    const closeRe = new RegExp(`^${dash ? "\\t*" : ""}${escapeRegExp2(delim)}[ \\t]*$`, "m");
    const closeMatch = closeRe.exec(remainder);
    let body;
    let matchEnd;
    if (closeMatch) {
      body = remainder.slice(0, closeMatch.index).replace(/\n$/, "");
      matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    } else if (nl === null) {
      body = "";
      matchEnd = openEnd;
    } else {
      body = remainder.replace(/\n$/, "");
      matchEnd = raw.length;
    }
    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect, target, body });
    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}
var NL_ARG_FLAGS = /* @__PURE__ */ new Set(["-b", "-i", "-l", "-s", "-v", "-w"]);
var STDOUT_REDIRECT_TWO_TOKEN = /^(?:>>?|&>>?|1>>?|>\|)$/;
var STDOUT_REDIRECT_FUSED = /^(?:>>?|&>>?|1>>?)[^<>&|]/;
var STDOUT_REDIRECT_FUSED_PIPE = /^>\|[^<>&|]/;
var hasStdoutRedirect = (raw) => raw.some(
  (w) => STDOUT_REDIRECT_TWO_TOKEN.test(w) || STDOUT_REDIRECT_FUSED.test(w) || STDOUT_REDIRECT_FUSED_PIPE.test(w)
);
function analyzeSource(argv) {
  if (argv[0] === "cat" || argv[0] === "nl") {
    const files = [];
    if (argv[0] === "cat") {
      for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("-") && a !== "-") continue;
        files.push(a);
      }
    } else {
      for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-") {
          files.push(a);
          continue;
        }
        if (a.startsWith("-")) {
          if (NL_ARG_FLAGS.has(a)) i += 1;
          continue;
        }
        files.push(a);
      }
    }
    const real = files.filter((f) => f !== "-");
    if (real.length === 0) return { kind: "none" };
    const idiom = argv[0] === "cat" ? "cat-file" : "nl-file";
    if (real.length === 1 && !files.includes("-")) {
      return { kind: "narrowable", fileArg: real[0], idiom, resolverKind: "fs" };
    }
    return { kind: "unnarrowable", files: real.map((fileArg) => ({ fileArg, idiom })) };
  }
  if (argv[0] === "git") {
    const outcomes = matchGitShow(argv);
    if (outcomes.length === 1) {
      const o = outcomes[0];
      if (o.kind === "unresolved") {
        return { kind: "gitUnresolved", fileArg: o.fileArg, reason: o.reason };
      }
      if (o.kind === "candidate" && o.resolverKind !== "fs") {
        return {
          kind: "git",
          fileArg: o.fileArg,
          idiom: "git-show-rev-path",
          rev: o.resolverKind.rev,
          resolverKind: o.resolverKind,
          dirOverride: o.dirOverride
        };
      }
    }
  }
  return { kind: "none" };
}
function classifyStdinSelector(argv) {
  if (argv[0] === "head" || argv[0] === "tail") {
    const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), argv[0] === "tail");
    if (disqualified) return null;
    const fileArgs = files.filter((f) => f !== "-");
    if (fileArgs.length > 0) return null;
    return argv[0] === "head" ? { kind: "head", count: count ?? 10 } : { kind: "tail", count: count ?? 10, fromStart };
  }
  if (argv[0] === "sed") {
    const rest = argv.slice(1);
    if (!rest.includes("-n")) return null;
    let scriptIdx = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-n") continue;
      if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
        scriptIdx = i;
        break;
      }
    }
    if (scriptIdx === -1) return null;
    const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
    if (fileCandidates.length !== 0) return null;
    const ranges = [];
    for (const segment of sedScriptSegments(rest[scriptIdx])) {
      const m = segment.match(SED_RANGE);
      if (!m) continue;
      const start = Number.parseInt(m[1], 10);
      ranges.push({ start, end: m[2] === void 0 ? start : m[2] === "$" ? "$" : Number.parseInt(m[2], 10) });
    }
    if (ranges.length === 0) return null;
    return { kind: "sed", ranges };
  }
  return null;
}
var LINE_SELECTORS = [matchSed, matchHead, matchTail];
function parseCommandDetailed(command, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const allowlist = opts.allowlist ?? DEFAULT_PATH_ALLOWLIST;
  const env = opts.env ?? Object.fromEntries(allowlist.map((n) => [n, process.env[n]]));
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const { stages: simpleCommands, malformed } = splitTopLevel(masked);
  void malformed;
  const expanded = new ExecutionWalker().walkInput(simpleCommands);
  const results = [];
  const fsLineCache = /* @__PURE__ */ new Map();
  const gitLineCache = /* @__PURE__ */ new Map();
  const cachedFsTotalLines = (absPath) => () => {
    if (!fsLineCache.has(absPath)) fsLineCache.set(absPath, countFileLines(absPath));
    return fsLineCache.get(absPath) ?? null;
  };
  const cachedGitTotalLines = (gitCwd, rev, path) => () => {
    const key = `${gitCwd}\0${rev}\0${path}`;
    if (!gitLineCache.has(key)) gitLineCache.set(key, countGitBlobLines(gitCwd, rev, path));
    return gitLineCache.get(key) ?? null;
  };
  const dirFrames = [{ dir: cwd, certain: true, prev: void 0 }];
  const gitDirOf = (c, frame) => {
    if (c.dirOverride === void 0) return frame.certain ? frame.dir : void 0;
    if (isAbsolute2(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : void 0;
  };
  let window = null;
  const wholeFileCandidate = (s) => ({
    kind: "candidate",
    idiom: s.idiom,
    fileArg: s.fileArg,
    spec: { kind: "toEof", start: 1 },
    resolverKind: "fs"
  });
  const sourceCandidate = (src) => ({
    kind: "candidate",
    idiom: src.idiom,
    fileArg: src.fileArg,
    spec: { kind: "toEof", start: 1 },
    resolverKind: src.resolverKind,
    dirOverride: src.dirOverride
  });
  const emitWindowTouch = (w) => {
    const spec = w.consumed ? { kind: "literal", start: w.lo, end: w.hi } : { kind: "toEof", start: 1 };
    emitCandidate(
      {
        kind: "candidate",
        idiom: w.idiom,
        fileArg: w.fileArg,
        spec,
        resolverKind: w.resolverKind,
        dirOverride: w.dirOverride
      },
      { dir: w.dir, certain: w.certain }
    );
  };
  const initWindow = (src, frame) => {
    if (gitDirOf(src, frame) === void 0 || !frame.certain && src.resolverKind === "fs" && !isAbsolute2(src.fileArg)) {
      emitCandidate(sourceCandidate(src), frame);
      return;
    }
    const total = (src.resolverKind === "fs" ? cachedFsTotalLines(resolvePath(frame.dir, src.fileArg)) : cachedGitTotalLines(gitDirOf(src, frame), src.resolverKind.rev, src.fileArg))();
    if (total === null) {
      emitCandidate(sourceCandidate(src), frame);
      return;
    }
    window = {
      idiom: src.idiom,
      fileArg: src.fileArg,
      dir: frame.dir,
      certain: frame.certain,
      dirOverride: src.dirOverride,
      resolverKind: src.resolverKind,
      lo: 1,
      hi: total,
      consumed: false
    };
  };
  const applyWindowTransform = (sel) => {
    const w = window;
    const lo = w.lo;
    const hi = w.hi;
    let nLo;
    let nHi;
    if (sel.kind === "head") {
      nLo = lo;
      nHi = lo + sel.count - 1;
    } else if (sel.kind === "tail") {
      if (sel.fromStart) {
        nLo = lo + sel.count - 1;
        nHi = hi;
      } else {
        nLo = hi - sel.count + 1;
        nHi = hi;
      }
    } else {
      nLo = lo + sel.ranges[0].start - 1;
      nHi = sel.ranges[0].end === "$" ? hi : lo + sel.ranges[0].end - 1;
    }
    nLo = Math.max(nLo, lo);
    nHi = Math.min(nHi, hi);
    if (nLo > nHi) return false;
    w.lo = nLo;
    w.hi = nHi;
    w.consumed = true;
    return true;
  };
  const emitMultiRange = (ranges) => {
    const w = window;
    let emitted = false;
    for (const r of ranges) {
      const mLo = Math.max(w.lo, w.lo + r.start - 1);
      const mHi = Math.min(w.hi, r.end === "$" ? w.hi : w.lo + r.end - 1);
      if (mLo > mHi) continue;
      emitted = true;
      emitCandidate(
        {
          kind: "candidate",
          idiom: w.idiom,
          fileArg: w.fileArg,
          spec: { kind: "literal", start: mLo, end: mHi },
          resolverKind: w.resolverKind,
          dirOverride: w.dirOverride
        },
        { dir: w.dir, certain: w.certain }
      );
    }
    if (!emitted) emitWindowTouch(w);
  };
  const emitCandidate = (c, frame) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "path contains an unexpanded shell variable or glob"
      });
      return;
    }
    if (c.resolverKind === "fs") {
      if (!frame.certain && !isAbsolute2(c.fileArg)) {
        results.push({
          status: "unresolved",
          idiom: c.idiom,
          fileArg: c.fileArg,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        return;
      }
    } else if (gitDirOf(c, frame) === void 0) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "the git -C target cannot be resolved against the tracked directory"
      });
      return;
    }
    const resolutionDir = c.resolverKind === "fs" ? frame.dir : gitDirOf(c, frame);
    const absolutePath = resolvePath(resolutionDir, c.fileArg);
    const totalLines = c.resolverKind === "fs" ? cachedFsTotalLines(absolutePath) : cachedGitTotalLines(resolutionDir, c.resolverKind.rev, c.fileArg);
    const range = resolveSpec(c.spec, totalLines);
    if (range === null) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: absolutePath,
        reason: "could not determine end-of-file line count (file unreadable, empty, or git rev/path not found)"
      });
      return;
    }
    results.push({
      status: "resolved",
      idiom: c.idiom,
      span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
    });
  };
  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i];
    while (dirFrames.length > item.dirFrame + 1) dirFrames.pop();
    while (dirFrames.length < item.dirFrame + 1) dirFrames.push({ ...dirFrames[dirFrames.length - 1] });
    const frame = dirFrames[dirFrames.length - 1];
    const stageEnv = { ...env, PWD: frame.dir };
    const pipePrecedes = item.precededBy === "pipe";
    const pipeFollows = expanded[i + 1] !== void 0 && expanded[i + 1].precededBy === "pipe";
    if (!pipePrecedes && window !== null) {
      emitWindowTouch(window);
      window = null;
    }
    const cdArgv = stripForEmission(stripRedirects(argvOf(item.text) ?? []));
    if (cdArgv[0] === "cd" && !item.inPipeline) {
      if (item.exec === "yes") {
        const expandedArgv = stripForEmission(
          stripRedirects(argvOf(expandVariables(item.text, item.assignments, stageEnv)) ?? [])
        );
        const target = expandedArgv[1];
        if (target === void 0 || target === "~" || target.startsWith("~/")) {
          const home = expandVariables("$HOME", item.assignments, stageEnv);
          if (looksUnresolvable(home)) frame.certain = false;
          else {
            frame.prev = frame.dir;
            frame.dir = resolvePath(frame.dir, target === void 0 ? home : home + target.slice(1));
            frame.certain = true;
          }
        } else if (target === "-") {
          if (frame.prev !== void 0) {
            const old = frame.dir;
            frame.dir = frame.prev;
            frame.prev = old;
          }
        } else if (target.startsWith("~")) {
          frame.certain = false;
        } else if (looksUnresolvable(target)) {
          frame.certain = false;
        } else {
          frame.prev = frame.dir;
          frame.dir = resolvePath(frame.dir, target);
          frame.certain = true;
        }
      } else if (item.exec === "unknown") {
        frame.certain = false;
      }
      continue;
    }
    if (item.exec !== "yes") {
      continue;
    }
    const heredocRef = item.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      if (looksUnresolvable(w.target)) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: w.target,
          reason: "path contains an unexpanded shell variable or glob"
        });
        continue;
      }
      if (!frame.certain && !isAbsolute2(w.target)) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: w.target,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        continue;
      }
      const absolutePath = resolvePath(frame.dir, w.target);
      const bodyLines = w.body.length === 0 ? 0 : w.body.split("\n").length;
      if (bodyLines === 0) {
        if (w.redirect !== ">") continue;
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: { lineStart: 1, lineEnd: 1, absolutePath, body: "", redirect: w.redirect }
        });
        continue;
      }
      const spec = w.redirect === ">" ? { kind: "literal", start: 1, end: bodyLines } : { kind: "appendLines", count: bodyLines };
      const range = resolveSpec(spec, cachedFsTotalLines(absolutePath));
      if (range === null) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: absolutePath,
          reason: "append target: could not read existing file to find its current length"
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath, body: w.body, redirect: w.redirect }
        });
      }
      continue;
    }
    const rawArgv = argvOf(expandVariables(item.text, item.assignments, stageEnv)) ?? [];
    const stripped = stripForEmission(stripWrappers(stripRedirects(rawArgv)));
    if (stripped.length === 0) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      continue;
    }
    if (stripped.some((w) => w.startsWith(">") || w.startsWith("<"))) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      continue;
    }
    if (!pipePrecedes && pipeFollows && (stripped[0] === "cat" || stripped[0] === "nl" || stripped[0] === "git")) {
      const src = analyzeSource(stripped);
      switch (src.kind) {
        case "none":
          break;
        // fall through to the ordinary dispatch
        case "gitUnresolved":
          results.push({
            status: "unresolved",
            idiom: "git-show-rev-path",
            fileArg: src.fileArg,
            reason: src.reason
          });
          continue;
        case "unnarrowable": {
          for (const f of src.files) emitCandidate(wholeFileCandidate(f), frame);
          continue;
        }
        case "narrowable":
        case "git": {
          if (hasStdoutRedirect(rawArgv)) {
            emitCandidate(sourceCandidate(src), frame);
          } else {
            initWindow(src, frame);
          }
          continue;
        }
      }
    }
    if (pipePrecedes && window !== null) {
      const sel = classifyStdinSelector(stripped);
      if (sel !== null) {
        if (sel.kind === "sed" && sel.ranges.length > 1) {
          emitMultiRange(sel.ranges);
          window = null;
        } else {
          applyWindowTransform(sel);
          if (hasStdoutRedirect(rawArgv)) {
            emitWindowTouch(window);
            window = null;
          }
        }
      } else {
        emitWindowTouch(window);
        window = null;
      }
    }
    if (stripped[0] === "cat" || stripped[0] === "nl") {
      const src = analyzeSource(stripped);
      if (src.kind === "narrowable") {
        emitCandidate(wholeFileCandidate({ fileArg: src.fileArg, idiom: src.idiom }), frame);
      } else if (src.kind === "unnarrowable") {
        for (const f of src.files) emitCandidate(wholeFileCandidate(f), frame);
      }
    } else {
      for (const matcher of [...LINE_SELECTORS, matchGitShow, matchGitLogL]) {
        for (const outcome of matcher(stripped)) {
          if (outcome.kind === "unresolved") {
            results.push({
              status: "unresolved",
              idiom: outcome.idiom,
              fileArg: outcome.fileArg,
              reason: outcome.reason
            });
          } else {
            emitCandidate(outcome, frame);
          }
        }
      }
    }
  }
  if (window !== null) {
    emitWindowTouch(window);
  }
  return results;
}

// src/common/parse-response.ts
import { existsSync, statSync as statSync3 } from "node:fs";
import { dirname as dirname2, join as join2, resolve as resolvePath2, sep } from "node:path";
var MAX_RESPONSE_SPANS = 50;
var SEARCH_BINS = /* @__PURE__ */ new Set(["rg", "grep", "egrep", "fgrep"]);
var VALUE_SHORT_FLAGS = /* @__PURE__ */ new Set(["A", "B", "C", "e", "f", "m", "g", "t", "T"]);
var VALUE_LONG_FLAGS = /* @__PURE__ */ new Set([
  "after-context",
  "before-context",
  "context",
  "max-count",
  "regexp",
  "file",
  "glob",
  "iglob",
  "type",
  "type-not",
  "include",
  "exclude",
  "exclude-dir",
  "exclude-from"
]);
function hasShellExpansion2(s) {
  return /[$`]/.test(s);
}
function isPathspecMagic(p) {
  return /^:[/!^.(]/.test(p);
}
function analyzeSearchArgv(argv, start) {
  const positionals = [];
  let contextFlags = false;
  let numbered = false;
  let withFilename = false;
  let patternFromFlag = false;
  let stdinRedirect = false;
  let i = start;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("<")) {
      stdinRedirect = true;
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (name === "after-context" || name === "before-context" || name === "context") contextFlags = true;
      if (name === "line-number") numbered = true;
      if (name === "with-filename") withFilename = true;
      if (name === "regexp" || name === "file") patternFromFlag = true;
      if (eq === -1 && VALUE_LONG_FLAGS.has(name)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (a.startsWith("-") && a !== "-" && a.length > 1) {
      let consumesNext = false;
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === "A" || c === "B" || c === "C") contextFlags = true;
        if (c === "n") numbered = true;
        if (c === "H") withFilename = true;
        if (c === "e" || c === "f") patternFromFlag = true;
        if (VALUE_SHORT_FLAGS.has(c)) {
          consumesNext = j === a.length - 1;
          break;
        }
      }
      i += consumesNext ? 2 : 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  const firstPositional = patternFromFlag ? 0 : 1;
  const pathArgs = positionals.length > firstPositional ? positionals.slice(firstPositional).filter((p) => !isPathspecMagic(p)) : [];
  const pathspecMagic = positionals.length > firstPositional && positionals.slice(firstPositional).some((p) => isPathspecMagic(p));
  return { pathArgs, contextFlags, numbered, withFilename, pathspecMagic, stdinRedirect };
}
function findGitSubcommand2(argv) {
  let dir = null;
  let dirUnresolvable = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "-C") {
      const v = argv[i + 1];
      if (v === void 0) return null;
      if (hasShellExpansion2(v)) dirUnresolvable = true;
      else dir = v;
      i += 2;
      continue;
    }
    if (a === "-c") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    return { dir, dirUnresolvable, subcommand: a, start: i + 1 };
  }
  return null;
}
function hasDiffPatchFlag(argv, start) {
  for (let i = start; i < argv.length; i++) {
    if (argv[i] === "-p" || argv[i] === "--patch") return true;
  }
  return false;
}
function hasRevPathArg(argv, start) {
  const valueFlags = /* @__PURE__ */ new Set(["--format", "--pretty", "--output", "--word-diff-regex"]);
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(":")) return true;
  }
  return false;
}
function hasFlag(argv, start, flag) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return false;
    if (a === flag) return true;
  }
  return false;
}
function hasDiffRevPathArg(argv, start, cwd) {
  const valueFlags = /* @__PURE__ */ new Set([
    "--output",
    "--src-prefix",
    "--dst-prefix",
    "-L",
    "-S",
    "-G",
    "--grep",
    "--author",
    "--committer",
    "--since",
    "--until",
    "--before",
    "--after"
  ]);
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(":") && !existsSync(resolvePath2(cwd, a))) return true;
  }
  return false;
}
function diffRelativeBase(argv, start, effectiveDir, repoRoot) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return null;
    if (a === "--relative") return { base: effectiveDir, root: effectiveDir };
    if (a.startsWith("--relative=")) {
      const value = a.slice("--relative=".length);
      if (repoRoot === null || hasShellExpansion2(value) || value === "") return "unresolvable";
      const base = resolvePath2(repoRoot, value);
      return { base, root: base };
    }
  }
  return null;
}
var VERBATIM_PASS_BINS = /* @__PURE__ */ new Set(["head", "tail", "wc", "sort", "uniq", "cut"]);
function isRenumberingFilter(argv) {
  const bin = argv[0];
  if (bin === "nl") return true;
  if (bin === "sed") return !isVerbatimSedStage(argv);
  if (bin === "awk") return !isVerbatimAwkStage(argv);
  if (bin === "perl") return !isVerbatimPerlStage(argv);
  if (bin === "tr") return !isVerbatimTrStage(argv);
  if (bin === "cat") {
    if (argv.some((a) => a === "--number" || a.startsWith("-") && !a.startsWith("--") && a.includes("n")))
      return true;
    return hasFileOperand(argv);
  }
  if (SEARCH_BINS.has(bin)) {
    if (argv.some((a) => a === "--line-number" || a.startsWith("-") && !a.startsWith("--") && a.includes("n")))
      return true;
    return hasGrepFileOperand(argv);
  }
  if (VERBATIM_PASS_BINS.has(bin)) return hasFileOperand(argv);
  return true;
}
function hasFileOperand(argv) {
  let afterTerminator = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      afterTerminator = true;
      continue;
    }
    if (a === "-") continue;
    if (afterTerminator || !a.startsWith("-")) return true;
  }
  return false;
}
function hasGrepFileOperand(argv) {
  let patternFromFlag = false;
  let seenPattern = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) {
        if (!patternFromFlag && !seenPattern) seenPattern = true;
        else return true;
      }
      return false;
    }
    if (a === "-e" || a === "-f" || a === "--regexp" || a === "--file") {
      patternFromFlag = true;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      if (a.startsWith("--")) {
        if (a.startsWith("--regexp=") || a.startsWith("--file=")) patternFromFlag = true;
      } else if (a.length > 2 && (a[1] === "e" || a[1] === "f")) {
        patternFromFlag = true;
      }
      continue;
    }
    if (!patternFromFlag && !seenPattern) seenPattern = true;
    else return true;
  }
  return false;
}
function isVerbatimSedScript(script, suppressAutoPrint) {
  if (suppressAutoPrint) {
    return /^\d+p$/.test(script) || /^\d+,\d+p$/.test(script) || /^\d+,\$p$/.test(script);
  }
  return /^\d+q$/.test(script) || /^\d+d$/.test(script);
}
function isVerbatimSedStage(argv) {
  let script = null;
  let suppressAutoPrint = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n") {
      suppressAutoPrint = true;
      continue;
    }
    if (a.startsWith("-") && a !== "-") return false;
    if (script !== null) return false;
    script = a;
  }
  return script !== null && isVerbatimSedScript(script, suppressAutoPrint);
}
function isVerbatimAwkStage(argv) {
  if (argv.length !== 2) return false;
  const program = argv[1];
  return /^NR\s*(<=|>=|==|!=|<|>)\s*\d+$/.test(program) || /^NR\s*%\s*\d+\s*(==|!=)\s*\d+$/.test(program);
}
function verbatimPerlScript(argv) {
  if (argv.length === 3 && argv[1] === "-ne") return argv[2];
  if (argv.length === 4 && argv[1] === "-n" && argv[2] === "-e") return argv[3];
  return null;
}
function isVerbatimPerlStage(argv) {
  const script = verbatimPerlScript(argv);
  if (script === null) return false;
  return /^\s*print\s+(?:if|unless)\s+\$\.\s*(<=|>=|==|!=|<|>)\s*\d+\s*;?\s*$/.test(script);
}
function isVerbatimTrStage(argv) {
  if (argv.length !== 3 || argv[1] !== "-d") return false;
  const set = argv[2];
  return !/[0-9:]/.test(set) && !set.includes("\\n");
}
function completeLines(stdout) {
  const lines = stdout.split("\n");
  lines.pop();
  return lines;
}
function recordsAreOneFile(stdout) {
  const lines = completeLines(stdout);
  if (lines.length === 0) return false;
  return lines.every((line) => line === "" || line === "--" || parseOneFileRecord(line) !== null);
}
function detectLayout(stdout, info, oneFileEligible) {
  if (stdout.includes("\0")) return "null-separated";
  const lines = completeLines(stdout);
  const first = lines.find((line) => line !== "");
  if (first === void 0) return null;
  if (/^\d+[-:]/.test(first)) {
    if (oneFileEligible && recordsAreOneFile(stdout)) return "one-file";
  }
  if (/^[^:]+:\d+/.test(first)) return info.contextFlags ? "context" : "recursive";
  if (info.contextFlags && lines.some((line) => line !== "" && /^[^:]+:\d+/.test(line))) return "context";
  if (/^[^-:]+-\d+-/.test(first)) return info.contextFlags ? "context" : null;
  if (info.numbered && /^[^:]+$/.test(first)) return "heading";
  return null;
}
function parseRecord(line, sep2) {
  const first = line.indexOf(sep2);
  if (first === -1) return null;
  const second = line.indexOf(sep2, first + 1);
  if (second === -1) return null;
  const path = line.slice(0, first);
  const lineToken = line.slice(first + 1, second);
  const text = line.slice(second + 1);
  if (path === "" || path.includes(":")) return null;
  if (!/^\d+$/.test(lineToken)) return null;
  const lineNumber = Number.parseInt(lineToken, 10);
  if (lineNumber <= 0) return null;
  return { path, line: lineNumber, text };
}
function parseOneFileRecord(line) {
  const m = /^(\d+)([:-])/.exec(line);
  if (m === null) return null;
  const lineNumber = Number.parseInt(m[1], 10);
  if (lineNumber <= 0) return null;
  return { line: lineNumber, text: line.slice(m[0].length) };
}
function parseContextRecord(line, knownPaths) {
  for (const path of knownPaths) {
    if (!line.startsWith(`${path}-`)) continue;
    const tail = line.slice(path.length + 1);
    const m = /^(\d+)-/.exec(tail);
    if (m === null) continue;
    const lineNumber = Number.parseInt(m[1], 10);
    if (lineNumber <= 0) continue;
    return { path, line: lineNumber, text: tail.slice(m[0].length) };
  }
  return null;
}
function lineCount(text) {
  if (text === "") return 0;
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split("\n").length;
}
function decodeSearchLayout(layout, stdout, singleFileArg) {
  const records = [];
  switch (layout) {
    case "recursive":
      for (const line of completeLines(stdout)) {
        const rec = parseRecord(line, ":");
        if (rec !== null) records.push(rec);
      }
      break;
    case "context": {
      const lines = completeLines(stdout);
      const known = /* @__PURE__ */ new Set();
      for (const line of lines) {
        if (line === "--") continue;
        const rec = parseRecord(line, ":");
        if (rec !== null) known.add(rec.path);
      }
      const knownSorted = [...known].sort((a, b) => b.length - a.length);
      for (const line of lines) {
        if (line === "--") continue;
        const rec = parseRecord(line, ":") ?? parseContextRecord(line, knownSorted) ?? parseRecord(line, "-");
        if (rec !== null) records.push(rec);
      }
      break;
    }
    case "heading":
      {
        let current = null;
        for (const line of completeLines(stdout)) {
          if (line === "") continue;
          const rec = parseOneFileRecord(line);
          if (rec === null) {
            current = line;
          } else if (current !== null) {
            records.push({ path: current, line: rec.line, text: rec.text });
          }
        }
      }
      break;
    case "one-file":
      if (singleFileArg !== null) {
        for (const line of completeLines(stdout)) {
          const rec = parseOneFileRecord(line);
          if (rec !== null) records.push({ path: singleFileArg, line: rec.line, text: rec.text });
        }
      }
      break;
    case "null-separated":
      {
        const parts = stdout.split("\0");
        if (!stdout.endsWith("\0")) parts.pop();
        for (const part of parts) {
          if (part === "") continue;
          const rec = parseRecord(part, ":");
          if (rec === null || rec.line !== 1) continue;
          records.push({ path: rec.path, line: null, text: rec.text });
        }
      }
      break;
  }
  return records;
}
function insideRoot(abs, roots) {
  for (const root of roots) {
    if (abs === root || abs.startsWith(root + sep)) return true;
  }
  return false;
}
function isFile(abs) {
  try {
    return statSync3(abs).isFile();
  } catch {
    return false;
  }
}
function findGitRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync(join2(dir, ".git"))) return dir;
    const parent = dirname2(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function capSpans(spans) {
  if (spans.length <= MAX_RESPONSE_SPANS) return spans;
  const ordered = [...spans].sort(
    (a, b) => a.absolutePath.localeCompare(b.absolutePath) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd
  );
  return ordered.slice(0, MAX_RESPONSE_SPANS);
}
function coalesce(lines) {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n <= end + 1) {
      if (n > end) end = n;
    } else {
      ranges.push([start, end]);
      start = n;
      end = n;
    }
  }
  ranges.push([start, end]);
  return ranges;
}
function spansFor(perFile, baseDir, roots) {
  const spans = [];
  for (const [path, lines] of perFile) {
    const abs = resolvePath2(baseDir, path);
    if (!insideRoot(abs, roots)) continue;
    for (const [lineStart, lineEnd] of coalesce([...lines])) {
      spans.push({ lineStart, lineEnd, absolutePath: abs });
    }
  }
  return spans;
}
var HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function stripDiffPrefix(p) {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}
function parseDiffHeader(line) {
  if (line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) return { kind: "combined" };
  if (!line.startsWith("diff --git ")) return null;
  const tokens = line.slice("diff --git ".length).trim().split(/\s+/);
  if (tokens.length !== 2 || tokens[0].startsWith('"') || tokens[1].startsWith('"')) return { kind: "unparseable" };
  return { kind: "file", oldPath: stripDiffPrefix(tokens[0]), newPath: stripDiffPrefix(tokens[1]) };
}
function parseDiffSide(line, marker) {
  if (!line.startsWith(`${marker} `)) return null;
  const p = line.slice(marker.length + 1);
  if (p.startsWith('"')) return { kind: "unparseable" };
  return { kind: "side", path: p === "/dev/null" ? null : stripDiffPrefix(p) };
}
function decodeUnifiedDiff(stdout) {
  const perFile = /* @__PURE__ */ new Map();
  let current = null;
  for (const line of completeLines(stdout)) {
    const header = parseDiffHeader(line);
    if (header !== null) {
      current = {
        oldPath: header.kind === "file" ? header.oldPath : null,
        newPath: header.kind === "file" ? header.newPath : null,
        rename: false,
        binary: false,
        combined: header.kind === "combined",
        submodule: false,
        unusable: header.kind === "unparseable",
        sawHunk: false
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("Binary files ")) {
      current.binary = true;
      continue;
    }
    const isBodyLine = line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\");
    if (!isBodyLine && line.includes("mode 160000")) {
      current.submodule = true;
      continue;
    }
    if (line.includes("Subproject commit")) {
      current.submodule = true;
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("copy from ") || line.startsWith("copy to ")) {
      current.rename = true;
      continue;
    }
    if (!current.sawHunk) {
      const oldSide = parseDiffSide(line, "---");
      if (oldSide !== null) {
        if (oldSide.kind === "unparseable") current.unusable = true;
        else current.oldPath = oldSide.path;
        continue;
      }
      const newSide = parseDiffSide(line, "+++");
      if (newSide !== null) {
        if (newSide.kind === "unparseable") current.unusable = true;
        else current.newPath = newSide.path;
        continue;
      }
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      current.sawHunk = true;
      emitHunkRange(perFile, current, hunk);
    }
  }
  return perFile;
}
function emitHunkRange(perFile, record, hunk) {
  if (record.binary || record.combined || record.submodule || record.unusable) return;
  const oldStart = Number.parseInt(hunk[1], 10);
  const oldCount = hunk[2] === void 0 ? 1 : Number.parseInt(hunk[2], 10);
  const newStart = Number.parseInt(hunk[3], 10);
  const newCount = hunk[4] === void 0 ? 1 : Number.parseInt(hunk[4], 10);
  if (record.rename) {
    if (record.newPath !== null) addLines(perFile, record.newPath, newStart, newCount);
    return;
  }
  if (record.oldPath !== null) addLines(perFile, record.oldPath, oldStart, oldCount);
  if (record.newPath !== null) addLines(perFile, record.newPath, newStart, newCount);
}
function addLines(perFile, path, start, count) {
  if (start < 1 || count <= 0) return;
  let lines = perFile.get(path);
  if (lines === void 0) {
    lines = /* @__PURE__ */ new Set();
    perFile.set(path, lines);
  }
  for (let n = start; n < start + count; n++) lines.add(n);
}
function matchBlameRange(argv, start) {
  let spec = null;
  let specIdx = -1;
  const positionals = [];
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) positionals.push({ arg: argv[j], idx: j });
      break;
    }
    if (a === "-L") {
      spec = argv[i + 1] ?? null;
      specIdx = i;
      i += 1;
      continue;
    }
    if (a.startsWith("-L")) {
      spec = a.slice(2);
      specIdx = i;
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push({ arg: a, idx: i });
  }
  if (spec === null) return null;
  const m = /^(\d+),(\d+)$/.exec(spec);
  if (m === null) return null;
  const files = positionals.filter((p) => p.idx > specIdx);
  if (files.length !== 1) return null;
  return {
    lineStart: Number.parseInt(m[1], 10),
    lineEnd: Number.parseInt(m[2], 10),
    fileArg: files[0].arg
  };
}
function parseResponse(input) {
  const { command, cwd, stdout } = input;
  let currentDir = cwd;
  let gated = null;
  let gatedPrecededBy = "start";
  let gatedRedirect = false;
  let gatedHeredoc = false;
  const split = splitTopLevel(command);
  if (split.malformed !== void 0) return [];
  const parts = split.stages;
  for (let i = 0; i < parts.length; i++) {
    const simple = parts[i];
    const argv = argvOf(simple.text);
    if (argv === null || argv.length === 0) continue;
    if (argv[0] === "cd") {
      if (gated === null) {
        const target = argv[1];
        if (target !== void 0 && target !== "-" && !hasShellExpansion2(target)) {
          currentDir = resolvePath2(currentDir, target);
        }
      }
      continue;
    }
    if (gated !== null) continue;
    if (SEARCH_BINS.has(argv[0])) {
      gated = { kind: "search", argv, start: 1, dir: null, dirUnresolvable: false };
    } else if (argv[0] === "git") {
      const sub = findGitSubcommand2(argv);
      if (sub !== null) {
        const base2 = { argv, start: sub.start, dir: sub.dir, dirUnresolvable: sub.dirUnresolvable };
        if (sub.subcommand === "grep") gated = { kind: "search", ...base2 };
        else if (sub.subcommand === "show" && !hasRevPathArg(argv, sub.start)) gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "diff") gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "log" && hasDiffPatchFlag(argv, sub.start)) gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "blame") gated = { kind: "blame", ...base2 };
      }
    }
    if (gated === null) continue;
    gatedPrecededBy = simple.precededBy;
    gatedRedirect = hasUnquotedRedirect(simple.text);
    gatedHeredoc = simple.heredoc ?? false;
    for (let j = 0; j < parts.length; j++) {
      if (j === i) continue;
      if (j < i) {
        let consumed = true;
        for (let k = j + 1; k <= i && consumed; k++) {
          if (parts[k].precededBy !== "pipe") consumed = false;
        }
        if (consumed) continue;
      }
      const siblingText = parts[j].text;
      const siblingArgv = argvOf(siblingText);
      if (siblingArgv === null || siblingArgv.length === 0 || siblingArgv[0] === "cd") continue;
      if (hasUnquotedRedirect(siblingText)) return [];
      if (parts[j].heredoc) return [];
      if (isRenumberingFilter(siblingArgv)) return [];
    }
  }
  if (gated === null || gated.dirUnresolvable) return [];
  const effectiveDir = gated.dir !== null ? resolvePath2(currentDir, gated.dir) : currentDir;
  if (gated.kind === "blame") {
    const m = matchBlameRange(gated.argv, gated.start);
    if (m === null || hasShellExpansion2(m.fileArg) || /[*?]/.test(m.fileArg)) return [];
    return [{ lineStart: m.lineStart, lineEnd: m.lineEnd, absolutePath: resolvePath2(effectiveDir, m.fileArg) }];
  }
  if (stdout.includes("\x1B")) return [];
  if (input.truncated) return [];
  if (gated.kind === "diff") {
    if (hasDiffRevPathArg(gated.argv, gated.start, effectiveDir)) return [];
    const repoRoot = findGitRoot(effectiveDir);
    if (repoRoot === null) return [];
    const relative = diffRelativeBase(gated.argv, gated.start, effectiveDir, repoRoot);
    if (relative === "unresolvable") return [];
    const base2 = relative !== null ? relative.base : repoRoot;
    const roots2 = relative !== null ? [relative.root] : [repoRoot];
    return capSpans(spansFor(decodeUnifiedDiff(stdout), base2, roots2));
  }
  const info = analyzeSearchArgv(gated.argv, gated.start);
  const stdinFed = gated.kind === "search" && gated.argv[0] !== "git" && info.pathArgs.length === 0 && (gatedPrecededBy === "pipe" || info.stdinRedirect || gatedRedirect || gatedHeredoc);
  if (stdinFed) return [];
  const isGitGrep = gated.kind === "search" && gated.argv[0] === "git";
  const fullName = isGitGrep && hasFlag(gated.argv, gated.start, "--full-name");
  const magic = isGitGrep && info.pathspecMagic;
  const worktreeRoot = magic || fullName ? findGitRoot(effectiveDir) : null;
  if ((magic || fullName) && worktreeRoot === null) return [];
  const base = fullName && worktreeRoot !== null ? worktreeRoot : effectiveDir;
  const roots = magic && worktreeRoot !== null ? [worktreeRoot] : info.pathArgs.length > 0 ? info.pathArgs.map((p) => resolvePath2(effectiveDir, p)) : [effectiveDir];
  const singleFileArg = info.pathArgs.length === 1 ? info.pathArgs[0] : null;
  const oneFileEligible = info.numbered && !info.withFilename && singleFileArg !== null && isFile(resolvePath2(effectiveDir, singleFileArg));
  const layout = detectLayout(stdout, info, oneFileEligible);
  const perFile = /* @__PURE__ */ new Map();
  if (layout !== null) {
    for (const rec of decodeSearchLayout(layout, stdout, singleFileArg)) {
      if (layout === "recursive" && !isFile(resolvePath2(base, rec.path))) continue;
      if (rec.line === null) {
        const total = lineCount(rec.text);
        let lines = perFile.get(rec.path);
        if (lines === void 0) {
          lines = /* @__PURE__ */ new Set();
          perFile.set(rec.path, lines);
        }
        for (let n = 1; n <= total; n++) lines.add(n);
      } else {
        let lines = perFile.get(rec.path);
        if (lines === void 0) {
          lines = /* @__PURE__ */ new Set();
          perFile.set(rec.path, lines);
        }
        lines.add(rec.line);
      }
    }
  }
  const spans = spansFor(perFile, base, roots);
  if (perFile.size === 0 && !info.numbered && stdout !== "" && stdout.endsWith("\n") && singleFileArg !== null) {
    const abs = resolvePath2(effectiveDir, singleFileArg);
    const total = countFileLines(abs);
    if (total !== null && total > 0) {
      spans.push({ lineStart: 1, lineEnd: total, absolutePath: abs });
    }
  }
  return capSpans(spans);
}

// src/common/span-surface.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs3 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");

// src/common/span-surface.ts
function memoFilePath(sessionId) {
  return nodePath3.join(sessionDir(sessionId), "touch-memo.json");
}
function createDiskMemoStore(logger2) {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessions();
      try {
        const raw = fs3.readFileSync(memoFilePath(sessionId), "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.surfaced)) {
          return new Set(parsed.surfaced);
        }
      } catch (err) {
        logger2.warn("memo read failed (treating as empty)", { err });
      }
      return /* @__PURE__ */ new Set();
    },
    addSurfaced(sessionId, names) {
      pruneStaleSessions();
      const existing = this.getSurfaced(sessionId);
      for (const n of names) existing.add(n);
      const memoDir = sessionDir(sessionId);
      const memoPath = memoFilePath(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs3.mkdirSync(memoDir, { recursive: true });
        fs3.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs3.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger2.warn("memo write failed", { err });
      }
    }
  };
}
function resolveTouchScope(cwd, absPath) {
  const cwdRepoRoot = cwd ? resolveRepoRoot(cwd) : null;
  if (!cwdRepoRoot) return null;
  const absDir = toPosix(nodePath3.dirname(absPath));
  const fileRepoRoot = resolveRepoRoot(absDir);
  if (fileRepoRoot !== cwdRepoRoot) return null;
  const repoRoot = cwdRepoRoot;
  const repoRelPath = relativeToRepo(repoRoot, absPath);
  if (isGitIgnored(repoRoot, repoRelPath)) return null;
  const spanRoot = resolveSpanRoot(repoRoot);
  if (isInsideSpanRoot(repoRelPath, spanRoot)) return null;
  return { repoRoot, repoRelPath };
}

// src/common/touch-core.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import * as fs4 from "node:fs";
import { basename as basename2 } from "node:path";

// src/common/anchor-tree.ts
function collapseByPath(rows) {
  const order = [];
  const byPath = /* @__PURE__ */ new Map();
  for (const row of rows) {
    let anchor = byPath.get(row.path);
    if (!anchor) {
      anchor = { path: row.path, ranges: [] };
      byPath.set(row.path, anchor);
      order.push(row.path);
    }
    anchor.ranges.push({ range: row.range, suffix: row.suffix });
  }
  return order.map((path) => byPath.get(path));
}
function splitSegments(path) {
  if (path.length === 0) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) return null;
  return segments;
}
function findOrCreateDir(parent, name) {
  for (const child of parent.children) {
    if (child.kind === "dir" && child.name === name) return child;
  }
  const node = { kind: "dir", name, children: [] };
  parent.children.push(node);
  return node;
}
function insertAnchor(root, segments, anchor) {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = findOrCreateDir(cur, segments[i]);
  }
  cur.children.push({ kind: "leaf", name: segments[segments.length - 1], anchor });
}
function buildForest(anchors) {
  const root = { kind: "dir", name: "", children: [] };
  for (const anchor of anchors) {
    const segments = splitSegments(anchor.path);
    if (segments === null) {
      root.children.push({ kind: "leaf", name: anchor.path, anchor });
      continue;
    }
    insertAnchor(root, segments, anchor);
  }
  return root.children;
}
function foldChain(node) {
  let name = node.name;
  let cur = node;
  while (cur.kind === "dir" && cur.children.length === 1) {
    const child = cur.children[0];
    name = `${name}/${child.name}`;
    cur = child;
  }
  return { name, node: cur };
}
function rangeRank(range) {
  switch (range.kind) {
    case "whole-file":
      return 0;
    case "range":
      return 1;
    case "truncated":
      return 2;
  }
}
function compareRangeEntries(a, b) {
  const rank = rangeRank(a.range) - rangeRank(b.range);
  if (rank !== 0) return rank;
  if (a.range.kind === "range" && b.range.kind === "range") {
    return a.range.start - b.range.start || a.range.end - b.range.end;
  }
  return 0;
}
function labelFor(range, sole) {
  switch (range.kind) {
    case "range":
      return `#L${range.start}-L${range.end}`;
    case "whole-file":
      return sole ? null : "(whole file)";
    case "truncated":
      return "(truncated in source \u2014 anchor incomplete)";
  }
}
var cachedSegmenter;
function graphemeSegmenter() {
  if (cachedSegmenter === void 0) {
    try {
      cachedSegmenter = { value: new Intl.Segmenter("en", { granularity: "grapheme" }) };
    } catch {
      cachedSegmenter = { value: null };
    }
  }
  return cachedSegmenter.value;
}
var WIDE_RANGES = [
  [4352, 4447],
  [9001, 9002],
  [9728, 10175],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [43360, 43391],
  [44032, 55203],
  [63744, 64255],
  [65040, 65049],
  [65072, 65135],
  [65280, 65376],
  [65504, 65510],
  [94208, 101119],
  [127462, 127487],
  [127744, 128591],
  [128640, 128767],
  [129280, 129535],
  [129648, 129791],
  [131072, 196605],
  [196608, 262141]
];
function isWideCodePoint(cp) {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}
function displayWidth(name) {
  const segmenter = graphemeSegmenter();
  let width = 0;
  if (segmenter === null) {
    for (const codePoint of name) {
      width += isWideCodePoint(codePoint.codePointAt(0) ?? 0) ? 2 : 1;
    }
    return width;
  }
  for (const { segment } of segmenter.segment(name)) {
    width += isWideCodePoint(segment.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}
var MAX_ALIGN_COLUMN = 48;
function computeGroupTarget(items) {
  let max = 0;
  for (const item of items) {
    if (item.node.kind === "leaf" && printsRangeColumn(item.node.anchor)) {
      max = Math.max(max, displayWidth(item.name));
    }
  }
  return max > MAX_ALIGN_COLUMN ? 0 : max;
}
function printsRangeColumn(anchor) {
  const { ranges } = anchor;
  if (ranges.length === 0) return false;
  return ranges.some((entry) => labelFor(entry.range, ranges.length === 1) !== null);
}
function computePad(nameWidth, target) {
  if (nameWidth >= target) return " ";
  return " ".repeat(target - nameWidth + 1);
}
function renderLeafLines(name, anchor, ownPrefix, childPrefix, groupTarget) {
  const { ranges } = anchor;
  if (ranges.length === 0) return [`${ownPrefix}${name}`];
  const sorted = [...ranges].sort(compareRangeEntries);
  const sole = sorted.length === 1;
  const nameWidth = displayWidth(name);
  const pad = computePad(nameWidth, groupTarget);
  const blank = " ".repeat(nameWidth + pad.length);
  return sorted.map((entry, i) => {
    const label = labelFor(entry.range, sole);
    if (label === null) return `${ownPrefix}${name}${entry.suffix}`;
    const base = i === 0 ? `${ownPrefix}${name}${pad}` : `${childPrefix}${blank}`;
    return `${base}${label}${entry.suffix}`;
  });
}
function renderNodes(nodes, prefix) {
  const lines = [];
  const items = nodes.map(foldChain);
  const groupTarget = computeGroupTarget(items);
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const ownPrefix = `${prefix}${isLast ? "\u2514\u2500 " : "\u251C\u2500 "}`;
    const childPrefix = `${prefix}${isLast ? "   " : "\u2502  "}`;
    if (item.node.kind === "leaf") {
      lines.push(...renderLeafLines(item.name, item.node.anchor, ownPrefix, childPrefix, groupTarget));
    } else {
      lines.push(`${ownPrefix}${item.name}/`);
      lines.push(...renderNodes(item.node.children, childPrefix));
    }
  });
  return lines;
}
function renderAnchorTree(anchors) {
  const forest = buildForest(anchors);
  return renderNodes(forest, "");
}

// src/common/touch-core.ts
function toNeedleLines(written) {
  if (written.length === 0) return [];
  const trimmed = written.endsWith("\n") ? written.slice(0, -1) : written;
  if (trimmed.length === 0) return [];
  return trimmed.split("\n");
}
function recoverRange(written, onDiskContent) {
  const needle = toNeedleLines(written);
  if (needle.length === 0) return "whole-file";
  const haystack = onDiskContent.split("\n");
  const last = haystack.length - needle.length;
  const starts = [];
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i);
      if (starts.length > 1) break;
    }
  }
  if (starts.length === 1) {
    return { start: starts[0] + 1, end: starts[0] + needle.length };
  }
  return "whole-file";
}
function driftKey(name, status) {
  return `${name}	${status}`;
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function cleanHeader(fileName) {
  return `${fileName} has implicit dependencies:`;
}
function cleanFooter(fileName) {
  return `If you change ${fileName} check the other files to confirm they still work together.`;
}
function driftHeader(driftedCount, kind) {
  if (kind === "write") {
    return driftedCount === 1 ? "This edit put an implicit dependency out of date:" : "This edit put implicit dependencies out of date:";
  }
  return driftedCount === 1 ? "This file has an implicit dependency out of date:" : "This file has implicit dependencies out of date:";
}
function driftFooter(driftedNames) {
  if (driftedNames.length === 1) {
    const name = driftedNames[0];
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return "For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.";
}
function rangeLabel(row) {
  if (row.start === 0 && row.end === 0) return { kind: "whole-file" };
  return { kind: "range", start: row.start, end: row.end };
}
function anchorBullets(anchors, debtRows) {
  const rows = anchors.map((anchor) => {
    const soleOnPath = anchors.filter((a) => a.path === anchor.path).length === 1;
    const statuses = /* @__PURE__ */ new Set();
    for (const row of debtRows) {
      if (row.path !== anchor.path) continue;
      if (soleOnPath || row.start === anchor.start && row.end === anchor.end) {
        statuses.add(row.status);
      }
    }
    const sorted = [...statuses].sort();
    const suffix = sorted.length > 0 ? ` \u2014 ${sorted.map(humanStatusLabel).join(", ")}` : "";
    return { path: anchor.path, range: rangeLabel(anchor), suffix };
  });
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    return anchors.map((anchor, i) => `- ${anchorText(anchor)}${rows[i].suffix}`);
  }
}
function renderSpanSection(name, anchors, debtRows, why) {
  const lines = [`## ${name}`, ...anchorBullets(anchors, debtRows)];
  if (why) lines.push("", why);
  return lines.join("\n");
}
function buildBlock(sections, header, footer) {
  const body = `${header}

${sections.join("\n\n---\n\n")}

---

${footer}`;
  return `
<git-span>
${body}
</git-span>
`;
}
function intersects(row, range) {
  if (range === "whole-file") return true;
  if (row.start === 0 && row.end === 0) return true;
  return rangesIntersect(range, { start: row.start, end: row.end });
}
function recoverRangeFromDisk(written, filePath) {
  if (written.length === 0) return "whole-file";
  let content;
  try {
    content = fs4.readFileSync(filePath, "utf8");
  } catch {
    return "whole-file";
  }
  return recoverRange(written, content);
}
var DEFAULT_READ_LIMIT = 2e3;
function recoverReadRange(offset, limit, filePath) {
  if (offset === void 0 && limit === void 0) return "whole-file";
  const start = offset ?? 1;
  let lineCount2;
  try {
    const content = fs4.readFileSync(filePath, "utf8");
    lineCount2 = content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return "whole-file";
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount2, start));
  return { start, end };
}
function onTouchedFile(row, filePath) {
  return filePath === row.path || filePath.endsWith(`/${row.path}`);
}
async function computeSurface(input, executors, memo, range) {
  const covering = await executors.list(input.filePath, input.cwd);
  if (covering.length === 0) return null;
  const anchorsByName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const rows = anchorsByName.get(row.name) ?? [];
    rows.push(row);
    anchorsByName.set(row.name, rows);
  }
  const touchedNames = [...anchorsByName.keys()].filter(
    (name) => (anchorsByName.get(name) ?? []).some((row) => onTouchedFile(row, input.filePath) && intersects(row, range))
  );
  if (touchedNames.length === 0) return null;
  const driftRows = await executors.drift([input.filePath], input.cwd);
  const driftByName = /* @__PURE__ */ new Map();
  for (const row of driftRows) {
    const rows = driftByName.get(row.name) ?? [];
    rows.push(row);
    driftByName.set(row.name, rows);
  }
  const surfaced = memo.getSurfaced(input.sessionId);
  const toRecord = [];
  const sections = [];
  const driftedNames = [];
  for (const name of touchedNames) {
    const spanDrift = driftByName.get(name) ?? [];
    const debtRows = spanDrift.filter((row) => isDebt(row.status));
    if (spanDrift.length > 0 && debtRows.length === 0) continue;
    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(name, status)));
    const isNewName = !surfaced.has(name);
    if (!isNewName && unsurfacedDebt.length === 0) continue;
    const why = await executors.why(name, input.cwd);
    sections.push(renderSpanSection(name, anchorsByName.get(name) ?? [], debtRows, why));
    if (debtStatuses.length > 0) driftedNames.push(name);
    if (isNewName) toRecord.push(name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(name, status));
  }
  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord);
  const fileName = basename2(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}
async function runTouchHook(input, executors, memo) {
  let treeModified = false;
  try {
    let range = "whole-file";
    if (input.kind === "write") {
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = recoverRangeFromDisk(input.written, input.filePath);
    } else {
      range = recoverReadRange(input.offset, input.limit, input.filePath);
    }
    const additionalContext = await computeSurface(input, executors, memo, range);
    return { additionalContext, treeModified };
  } catch {
    return { additionalContext: null, treeModified };
  }
}
var DEFAULT_TIMEOUT_MS = 1e4;
function repoRelArg(filePath, cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) return null;
  return { repoRoot, relPath: relativeToRepo(repoRoot, filePath) };
}
function spanStatusSnapshot(repoRoot) {
  const spanRoot = resolveSpanRoot(repoRoot);
  try {
    return execFileSync4("git", ["-C", repoRoot, "status", "--porcelain", "--", spanRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_TIMEOUT_MS
    });
  } catch {
    return "";
  }
}
function createDefaultTouchExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    fix: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return { modified: false };
      const before = spanStatusSnapshot(resolved.repoRoot);
      try {
        execFileSync4("git", ["span", "drift", resolved.relPath, "--fix"], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
      }
      const after = spanStatusSnapshot(resolved.repoRoot);
      return { modified: before !== after };
    },
    list: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return [];
      try {
        const out = execFileSync4("git", ["span", "list", "--porcelain", resolved.relPath], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    },
    drift: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out;
      try {
        out = execFileSync4("git", ["span", "drift", "--format", "porcelain", ...scoped], {
          cwd: runCwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
        const captured = err.stdout;
        if (typeof captured === "string") {
          out = captured;
        } else {
          return [];
        }
      }
      return parseDriftPorcelain(out);
    },
    why: async (name, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      try {
        const out = execFileSync4("git", ["span", "why", name], {
          cwd: repoRoot ?? cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        const text = out.trimEnd();
        if (text.length === 0 || text === `\`${name}\` has no why recorded.`) return null;
        return text;
      } catch {
        return null;
      }
    }
  };
}

// src/codex/apply-patch.ts
import * as fs5 from "node:fs";
var END_PATCH_MARKER = "*** End Patch";
var ADD_FILE_MARKER = "*** Add File: ";
var DELETE_FILE_MARKER = "*** Delete File: ";
var UPDATE_FILE_MARKER = "*** Update File: ";
var MOVE_TO_MARKER = "*** Move to: ";
var EOF_MARKER = "*** End of File";
var CHANGE_CONTEXT_MARKER = "@@ ";
var EMPTY_CHANGE_CONTEXT_MARKER = "@@";
function defaultReadPreEditFile(path) {
  try {
    return fs5.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function toPosix2(p) {
  return p.replace(/\\/g, "/");
}
function scanHunks(command) {
  const hunks = [];
  let openUpdate = null;
  for (const raw of command.split("\n")) {
    const headerLine = openUpdate ? raw.replace(/[ \t\r]+$/, "") : raw.trim();
    if (headerLine === END_PATCH_MARKER) {
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(ADD_FILE_MARKER)) {
      hunks.push({ kind: "add", path: headerLine.slice(ADD_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(DELETE_FILE_MARKER)) {
      hunks.push({ kind: "delete", path: headerLine.slice(DELETE_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(UPDATE_FILE_MARKER)) {
      const hunk = {
        kind: "update",
        path: headerLine.slice(UPDATE_FILE_MARKER.length),
        movePath: null,
        chunks: []
      };
      hunks.push(hunk);
      openUpdate = hunk;
      continue;
    }
    if (openUpdate) {
      processUpdateLine(openUpdate, raw);
    }
  }
  return hunks;
}
function ensureChunk(hunk) {
  const last = hunk.chunks[hunk.chunks.length - 1];
  if (last) return last;
  const chunk = { changeContext: null, oldLines: [], newLines: [] };
  hunk.chunks.push(chunk);
  return chunk;
}
function processUpdateLine(hunk, raw) {
  const trimmedEnd = raw.replace(/[ \t\r]+$/, "");
  if (trimmedEnd === EOF_MARKER) return;
  if (hunk.chunks.length === 0 && hunk.movePath === null && trimmedEnd.startsWith(MOVE_TO_MARKER)) {
    hunk.movePath = trimmedEnd.slice(MOVE_TO_MARKER.length);
    return;
  }
  if (trimmedEnd === EMPTY_CHANGE_CONTEXT_MARKER) {
    hunk.chunks.push({ changeContext: null, oldLines: [], newLines: [] });
    return;
  }
  if (trimmedEnd.startsWith(CHANGE_CONTEXT_MARKER)) {
    hunk.chunks.push({ changeContext: trimmedEnd.slice(CHANGE_CONTEXT_MARKER.length), oldLines: [], newLines: [] });
    return;
  }
  if (raw === "") {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push("");
    chunk.newLines.push("");
    return;
  }
  const first = raw[0];
  if (first === " ") {
    const chunk = ensureChunk(hunk);
    const content = raw.slice(1);
    chunk.oldLines.push(content);
    chunk.newLines.push(content);
    return;
  }
  if (first === "+") {
    const chunk = ensureChunk(hunk);
    chunk.newLines.push(raw.slice(1));
    return;
  }
  if (first === "-") {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push(raw.slice(1));
    return;
  }
}
function splitLines(content) {
  return content.split("\n");
}
function lineIndices(lines, value) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === value) out.push(i);
  }
  return out;
}
function contiguousMatches(haystack, needle) {
  const out = [];
  if (needle.length === 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}
function locateChunk(preLines, chunk) {
  const block = chunk.oldLines;
  if (block.length === 0) {
    const ctx2 = chunk.changeContext;
    if (ctx2 !== null && ctx2 !== "") {
      const ctxIdxs = lineIndices(preLines, ctx2);
      if (ctxIdxs.length === 1) {
        const line = ctxIdxs[0] + 1;
        return { start: line, end: line };
      }
    }
    return null;
  }
  const starts = contiguousMatches(preLines, block);
  if (starts.length === 1) {
    const s = starts[0];
    return { start: s + 1, end: s + block.length };
  }
  if (starts.length === 0) return null;
  const ctx = chunk.changeContext;
  if (ctx !== null && ctx !== "") {
    for (const c of lineIndices(preLines, ctx)) {
      const after = starts.find((s) => s >= c);
      if (after !== void 0) {
        return { start: after + 1, end: after + block.length };
      }
    }
  }
  return null;
}
function recoverRange2(preLines, chunks) {
  let union = null;
  for (const chunk of chunks) {
    const r = locateChunk(preLines, chunk);
    if (r === null) return null;
    union = union === null ? r : { start: Math.min(union.start, r.start), end: Math.max(union.end, r.end) };
  }
  return union;
}
function parseApplyPatch(command, readPreEditFile = defaultReadPreEditFile) {
  const anchors = [];
  for (const hunk of scanHunks(command)) {
    if (hunk.kind === "add") {
      anchors.push({ path: toPosix2(hunk.path), kind: "create" });
      continue;
    }
    if (hunk.kind === "delete") {
      anchors.push({ path: toPosix2(hunk.path), kind: "whole-write" });
      continue;
    }
    const targetPath = toPosix2(hunk.movePath ?? hunk.path);
    if (hunk.movePath !== null) {
      anchors.push({ path: targetPath, kind: "whole-write" });
      continue;
    }
    const content = readPreEditFile(hunk.path);
    const range = content === null ? null : recoverRange2(splitLines(content), hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: "write", range });
    } else {
      anchors.push({ path: targetPath, kind: "whole-write" });
    }
  }
  return anchors;
}

// src/codex/post-tool-use.ts
var APPLY_PATCH_SUCCESS_PREFIX = "Success. Updated the following files:";
var RESPONSE_TEXT_FIELDS = ["output", "stdout", "content", "text"];
function narrowApplyPatchCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "command" in toolInput) {
    const command = toolInput.command;
    if (typeof command === "string") return command;
  }
  return null;
}
function narrowExecCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "arguments" in toolInput) {
    const args = toolInput.arguments;
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        if (parsed !== null && typeof parsed === "object" && typeof parsed.cmd === "string") {
          return { cmd: parsed.cmd, workdir: typeof parsed.workdir === "string" ? parsed.workdir : null };
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}
function quoteObjectKeys(literal) {
  let out = "";
  let i = 0;
  const n = literal.length;
  while (i < n) {
    const c = literal[i];
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i += 1;
      while (i < n) {
        if (literal[i] === "\\" && i + 1 < n) i += 2;
        else if (literal[i] === quote) {
          i += 1;
          break;
        } else i += 1;
      }
      out += literal.slice(start, i);
      continue;
    }
    const key = literal.slice(i).match(/^(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (key) {
      out += `${key[1]}"${key[2]}":`;
      i += key[0].length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
function narrowCodeModeExec(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "input" in toolInput) {
    const input = toolInput.input;
    if (typeof input === "string") {
      const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
      if (match) {
        try {
          const parsed = JSON.parse(quoteObjectKeys(match[1]));
          if (parsed !== null && typeof parsed === "object" && typeof parsed.cmd === "string") {
            return {
              matched: true,
              cmd: parsed.cmd,
              workdir: typeof parsed.workdir === "string" ? parsed.workdir : null
            };
          }
          return { matched: true, cmd: null, workdir: null };
        } catch {
          return { matched: true, cmd: null, workdir: null };
        }
      }
    }
  }
  return { matched: false, cmd: null, workdir: null };
}
function normalizeShellResponse(toolResponse) {
  if (typeof toolResponse === "string") return { stdout: toolResponse };
  if (Array.isArray(toolResponse)) {
    const text = [];
    for (const block of toolResponse) {
      if (block !== null && typeof block === "object") {
        const value = block.text;
        if (typeof value === "string") text.push(value);
      }
    }
    return { stdout: text.join("") };
  }
  if (toolResponse !== null && typeof toolResponse === "object") {
    const record = toolResponse;
    for (const field of RESPONSE_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === "string") {
        return {
          stdout: value,
          stderr: typeof record.stderr === "string" ? record.stderr : void 0,
          exitStatus: typeof record.exitCode === "number" ? record.exitCode : typeof record.exitStatus === "number" ? record.exitStatus : void 0,
          truncated: record.rawOutputPath !== void 0,
          interrupted: record.interrupted === true || record.timedOutAfterMs !== void 0
        };
      }
    }
  }
  return null;
}
function classifyApplyPatchResponse(toolResponse) {
  if (Array.isArray(toolResponse)) return "unknown";
  const normalized = normalizeShellResponse(toolResponse);
  if (normalized === null) return "unknown";
  return normalized.stdout.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? "success" : "failure";
}
var noRangeRecovery = () => null;
function createHandler(executors = createDefaultTouchExecutors(), memoFactory = createDiskMemoStore) {
  return async (input, ctx) => {
    const tool_name = input.tool_name;
    const cwd = input.cwd ?? "";
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger);
    if (tool_name === "Bash" || tool_name === "exec_command" || tool_name === "exec") {
      let command2 = null;
      let workdir = null;
      if (tool_name === "Bash") {
        const raw = input.tool_input?.command;
        command2 = typeof raw === "string" ? raw : null;
      } else {
        const classic = narrowExecCommand(input.tool_input);
        command2 = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
      }
      if (command2 === null && tool_name === "exec") {
        const codeMode = narrowCodeModeExec(input.tool_input);
        if (codeMode.matched && codeMode.cmd === null) {
          ctx.logger.warn(
            "Codex code-mode exec envelope matched but its exec_command argument could not be parsed; no shell touch",
            {
              toolInputType: typeof input.tool_input,
              toolInputKeys: input.tool_input !== null && typeof input.tool_input === "object" ? Object.keys(input.tool_input) : void 0
            }
          );
        }
        command2 = codeMode.cmd;
        workdir = codeMode.workdir;
      }
      if (!command2) return void 0;
      const effectiveCwd = workdir !== null && !/[`$]/.test(workdir) ? resolvePath3(cwd, workdir) : cwd;
      const matches = parseCommandDetailed(command2, { cwd: effectiveCwd });
      const blocks2 = [];
      for (const match of matches) {
        if (match.status !== "resolved") continue;
        const span = match.span;
        const absPath = abspathAgainst(effectiveCwd, span.absolutePath);
        const scope = resolveTouchScope(effectiveCwd, absPath);
        if (!scope) continue;
        let touchInput;
        if (match.idiom === "heredoc-write") {
          const written = span.redirect === ">" ? "" : span.body ?? "";
          touchInput = { kind: "write", sessionId, cwd: effectiveCwd, filePath: absPath, written };
        } else {
          touchInput = {
            kind: "read",
            sessionId,
            cwd: effectiveCwd,
            filePath: absPath,
            offset: span.lineStart,
            limit: span.lineEnd - span.lineStart + 1
          };
        }
        const output = await runTouchHook(touchInput, executors, memo);
        if (output.additionalContext) blocks2.push(output.additionalContext);
      }
      const response = normalizeShellResponse(input.tool_response);
      if (response !== null) {
        for (const span of parseResponse({ command: command2, cwd, ...response })) {
          const absPath = abspathAgainst(cwd, span.absolutePath);
          const scope = resolveTouchScope(cwd, absPath);
          if (!scope) continue;
          const output = await runTouchHook(
            {
              kind: "read",
              sessionId,
              cwd,
              filePath: absPath,
              offset: span.lineStart,
              limit: span.lineEnd - span.lineStart + 1
            },
            executors,
            memo
          );
          if (output.additionalContext) blocks2.push(output.additionalContext);
        }
      }
      if (blocks2.length === 0) return void 0;
      const combined2 = blocks2.join("");
      return postToolUseOutput({ additionalContext: combined2, systemMessage: combined2 });
    }
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return void 0;
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === "failure") return void 0;
    if (classification === "unknown") {
      ctx.logger.warn("Codex apply_patch tool_response shape unrecognized; running touch defensively", {
        toolResponseType: typeof input.tool_response,
        toolResponseKeys: input.tool_response !== null && typeof input.tool_response === "object" ? Object.keys(input.tool_response) : void 0
      });
    }
    const anchors = parseApplyPatch(command, noRangeRecovery);
    const blocks = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      const output = await runTouchHook(
        { kind: "write", sessionId, cwd, filePath: absPath, written: "" },
        executors,
        memo
      );
      if (output.additionalContext) blocks.push(output.additionalContext);
    }
    if (blocks.length === 0) return void 0;
    const combined = blocks.join("");
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}
var post_tool_use_default = postToolUseHook({ matcher: "apply_patch|exec_command|exec|Bash", timeout: 1e4 }, createHandler());

// ../../node_modules/@goodfoot/codex-hooks/dist/constants.js
var EVENTS_WITH_TEXT_OUTPUT = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit", "SubagentStart"]);

// ../../node_modules/@goodfoot/codex-hooks/dist/logger.js
import { closeSync, existsSync as existsSync2, mkdirSync as mkdirSync2, openSync, writeSync } from "node:fs";
import { dirname as dirname4 } from "node:path";
var DEFAULT_LOG_ENV_VAR = "CODEX_HOOKS_LOG_FILE";
var Logger = class {
  handlers = /* @__PURE__ */ new Map();
  fileInitialized = false;
  logFileFd = null;
  logFilePath = null;
  currentHookType;
  currentInput;
  constructor(config = {}) {
    this.logFilePath = config.logFilePath ?? process.env[config.logEnvVar ?? DEFAULT_LOG_ENV_VAR] ?? null;
  }
  setContext(hookType, input) {
    this.currentHookType = hookType;
    this.currentInput = input;
  }
  clearContext() {
    this.currentHookType = void 0;
    this.currentInput = void 0;
  }
  on(level, handler) {
    const existing = this.handlers.get(level) ?? /* @__PURE__ */ new Set();
    existing.add(handler);
    this.handlers.set(level, existing);
    return () => {
      existing.delete(handler);
      if (existing.size === 0) {
        this.handlers.delete(level);
      }
    };
  }
  debug(message, context) {
    this.emit("debug", message, context);
  }
  info(message, context) {
    this.emit("info", message, context);
  }
  warn(message, context) {
    this.emit("warn", message, context);
  }
  error(message, context) {
    this.emit("error", message, context);
  }
  logError(error, message, context) {
    this.emit("error", `${message}: ${error instanceof Error ? error.message : String(error)}`, context);
  }
  close() {
    if (this.logFileFd !== null) {
      closeSync(this.logFileFd);
      this.logFileFd = null;
    }
  }
  emit(level, message, context) {
    const event = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      hookType: this.currentHookType,
      message,
      ...this.currentInput !== void 0 ? { input: this.currentInput } : {},
      ...context !== void 0 ? { context } : {}
    };
    this.writeToFile(event);
    this.handlers.get(level)?.forEach((handler) => {
      handler(event);
    });
  }
  writeToFile(event) {
    if (this.logFilePath === null) {
      return;
    }
    if (!this.fileInitialized) {
      this.fileInitialized = true;
      const logDir = dirname4(this.logFilePath);
      if (!existsSync2(logDir)) {
        mkdirSync2(logDir, { recursive: true });
      }
      this.logFileFd = openSync(this.logFilePath, "a");
    }
    if (this.logFileFd !== null) {
      writeSync(this.logFileFd, `${JSON.stringify(event)}
`);
    }
  }
};
var logger = new Logger();

// ../../node_modules/@goodfoot/codex-hooks/dist/outputs.js
var EXIT_CODES2 = {
  SUCCESS: 0,
  ERROR: 1,
  BLOCK: 2
};
var BlockError2 = class extends Error {
  reason;
  constructor(reason) {
    super(reason);
    this.name = "BlockError";
    this.reason = reason;
  }
};
function omitUndefined2(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}
function buildOutput2(type, stdout, stderr) {
  return {
    _type: type,
    stdout: omitUndefined2(stdout),
    ...stderr !== void 0 ? { stderr } : {}
  };
}
function userPromptSubmitOutput2(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "UserPromptSubmit",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput2("UserPromptSubmit", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
}
function sessionStartOutput2(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "SessionStart",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput2("SessionStart", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    hookSpecificOutput
  });
}
function subagentStartOutput2(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "SubagentStart",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput2("SubagentStart", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    hookSpecificOutput
  });
}

// ../../node_modules/@goodfoot/codex-hooks/dist/runtime.js
async function readStdin() {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve2(chunks.join("")));
    process.stdin.on("error", reject);
  });
}
function parseStdinInput(stdinContent) {
  return JSON.parse(stdinContent);
}
function writeStdout(output) {
  process.stdout.write(JSON.stringify(output.stdout));
}
function normalizeStringOutput(hookEventName, result) {
  if (!EVENTS_WITH_TEXT_OUTPUT.has(hookEventName)) {
    throw new Error(`${hookEventName} hooks cannot return plain text`);
  }
  if (hookEventName === "SessionStart") {
    return sessionStartOutput2({ additionalContext: result });
  }
  if (hookEventName === "SubagentStart") {
    return subagentStartOutput2({ additionalContext: result });
  }
  return userPromptSubmitOutput2({ additionalContext: result });
}
function convertToHookOutput(output) {
  return output.stderr !== void 0 ? { stdout: output.stdout, stderr: output.stderr } : { stdout: output.stdout };
}
async function execute(hookFn) {
  try {
    const stdinContent = await readStdin();
    const input = parseStdinInput(stdinContent);
    logger.setContext(hookFn.hookEventName, input);
    const context = { logger };
    const result = await hookFn(input, context);
    let output = { stdout: {} };
    if (typeof result === "string") {
      output = convertToHookOutput(normalizeStringOutput(hookFn.hookEventName, result));
    } else if (result !== void 0) {
      output = convertToHookOutput(result);
    }
    writeStdout(output);
    process.exit(EXIT_CODES2.SUCCESS);
  } catch (error) {
    if (error instanceof BlockError2) {
      process.stderr.write(`${error.reason}
`);
      process.exit(EXIT_CODES2.BLOCK);
    }
    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}
`);
    } else {
      process.stderr.write(`${String(error)}
`);
    }
    process.exit(EXIT_CODES2.ERROR);
  } finally {
    logger.clearContext();
    logger.close();
  }
}

// src/codex/post-tool-use-entry.ts
execute(post_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2hvb2tzLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9vdXRwdXRzLmpzIiwgInNyYy9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLnRzIiwgInNyYy9jb21tb24vcGFyc2UtY29tbWFuZC50cyIsICJzcmMvY29tbW9uL2NvbW1hbmQtcmVzb2x2ZS50cyIsICJzcmMvY29tbW9uL3NoZWxsLXNwbGl0LnRzIiwgInNyYy9jb21tb24vdmFyaWFibGUtZXhwYW5kLnRzIiwgInNyYy9jb21tb24vcGFyc2UtcmVzcG9uc2UudHMiLCAic3JjL2NvbW1vbi9zcGFuLXN1cmZhY2UudHMiLCAic3JjL2NvbW1vbi9zcGFuLWlnbm9yZS50cyIsICJzcmMvY29tbW9uL3RvdWNoLWNvcmUudHMiLCAic3JjL2NvbW1vbi9hbmNob3ItdHJlZS50cyIsICJzcmMvY29kZXgvYXBwbHktcGF0Y2gudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvbG9nZ2VyLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9vdXRwdXRzLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzIiwgInNyYy9jb2RleC9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIENvZGV4IFBvc3RUb29sVXNlIHRvdWNoIGhvb2sgXHUyMDE0IGhlYWwgKyBzdXJmYWNlIGFmdGVyIGEgY29uZmlybWVkIGBhcHBseV9wYXRjaGAsXG4gKiBvciBhIHNoZWxsL2V4ZWMgY2FsbCB3aG9zZSBjb21tYW5kIHN0YXRpY2FsbHkgcmVzb2x2ZXMgdG8gZmlsZStsaW5lIGlkaW9tcy5cbiAqXG4gKiBQb3N0VG9vbFVzZSBmaXJlcyBhZnRlciBgYXBwbHlfcGF0Y2hgIGhhcyBydW4sIHNvIHRoaXMgaXMgdGhlIGFjY3VyYXRlIGhvbWUgZm9yXG4gKiB0aGUgdG91Y2ggc2lnbmFsOiB0aGUgZmlsZSBpcyBhbHJlYWR5IHdyaXR0ZW4sIHNvIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdFxuICogPGZpbGU+IC0tZml4YCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGFnYWluc3QgcmVhbCBieXRlcyBhbmQgdGhlIHN1cmZhY2VkIGJsb2NrXG4gKiByZWZsZWN0cyB0aGUgaGVhbGVkIGFuY2hvcnMuIFRoZSBoYW5kbGVyIG5hcnJvd3MgdGhlIGBhcHBseV9wYXRjaGAgZW52ZWxvcGVcbiAqIChgdG9vbF9pbnB1dC5jb21tYW5kYCwgU0RLLXR5cGVkIGB1bmtub3duYCkgaW50byBwZXItZmlsZSBhbmNob3JzIHZpYSB0aGVcbiAqIHNoYXJlZCBbYXBwbHktcGF0Y2ggcGFyc2VyXSguL2FwcGx5LXBhdGNoLnRzKSwgYW5kIHJlY292ZXJzIHNoZWxsIGNvbW1hbmRzXG4gKiBmcm9tIGVpdGhlciBDb2RleCBlbnZlbG9wZSAoY2xhc3NpYyBgZXhlY19jb21tYW5kYCBKU09OIGBhcmd1bWVudHNgLCBvclxuICogY29kZS1tb2RlIGBleGVjYCB3cmFwcGluZyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWApIHZpYSB0aGUgc2hhcmVkXG4gKiBbY29tbWFuZCBwYXJzZXJdKC4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLnRzKTsgZWFjaCB0b3VjaGVkIGZpbGUgaXMgc2NvcGVkIHRvXG4gKiB0aGUgQ1dEIHJlcG8sIGFuZCBkcml2ZXMgdGhlIGhhcm5lc3MtYWdub3N0aWMge0BsaW5rIHJ1blRvdWNoSG9va30gY29yZSBcdTIwMTQgdGhlXG4gKiBzYW1lIGNvcmUgdGhlIENsYXVkZSBhZGFwdGVyIHVzZXMuXG4gKlxuICogVHdvIENvZGV4LXNwZWNpZmljIGNvbmNlcm5zIGFyZSBwcmVzZXJ2ZWQgZnJvbSB0aGlzIGZpbGUncyBqb3VybmFsaW5nXG4gKiBwcmVkZWNlc3NvcjpcbiAqXG4gKiAxLiAqKlN1Y2Nlc3MgY2xhc3NpZmljYXRpb24uKiogVGhlIHBhcnNlZCBlbnZlbG9wZSBkZXNjcmliZXMgKmludGVudCosIG5vdFxuICogICAgKm91dGNvbWUqLiBDb2RleCBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gdG9vbCBzdWNjZXNzLCBidXQgYXMgYVxuICogICAgZHVyYWJpbGl0eSBiZWx0IHdlIGNsYXNzaWZ5IGB0b29sX3Jlc3BvbnNlYCB2aWFcbiAqICAgIHtAbGluayBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZX06IGEgY29uZmlybWVkIHJlamVjdGlvbiAoYCdmYWlsdXJlJ2ApXG4gKiAgICBzdXBwcmVzc2VzIHRoZSB0b3VjaCAobm8gcGhhbnRvbSBoZWFsL3N1cmZhY2Ugb24gYSBwYXRjaCB0aGF0IG5ldmVyXG4gKiAgICBhcHBsaWVkKTsgYSBzdWNjZXNzIG9yIGFuIHVucmVjb2duaXplZCBzaGFwZSAoYCd1bmtub3duJ2AsIHdhcm5lZCkgcHJvY2VlZHMuXG4gKiAyLiAqKk5vIHBvc3QtZWRpdCByYW5nZSByZWNvdmVyeSBmcm9tIHRoZSBlbnZlbG9wZS4qKiBQb3N0VG9vbFVzZSBydW5zIGFmdGVyXG4gKiAgICB0aGUgcGF0Y2ggcmV3cm90ZSB0aGUgZmlsZSwgc28gdGhlIGh1bmsncyBwcmUtZWRpdCBibG9jayBubyBsb25nZXIgc2l0c1xuICogICAgd2hlcmUgdGhlIGVkaXQgaGFwcGVuZWQgYW5kIGNvdWxkIG1pcy1hbmNob3IgYSBkdXBsaWNhdGUuIFRoZSB0b3VjaCBpc1xuICogICAgc2NvcGVkIGZpbGUtd2lkZSAoYHdyaXR0ZW46ICcnYCBcdTIxOTIgd2hvbGUtZmlsZSksIHdoaWNoIGlzIGV4YWN0bHkgdGhlXG4gKiAgICBiZWhhdmlvciB7QGxpbmsgcnVuVG91Y2hIb29rfSB0YWtlcyBmb3IgYW4gZW1wdHkgd3JpdGUuXG4gKlxuICogVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGluIHRoZSBoYW5kbGVyIGNvbmZpZyAodGhlIENMSSBlbWl0cyBgMTBgIHNlY29uZHMpXG4gKiBcdTIwMTQgc2VlIHRoZSB0aW1lb3V0LXVuaXRzIHNwaWtlIG5vdGU7IHRoZSBzb3VyY2UgdmFsdWUgbXVzdCBzdGF5IGluIG1zIHNvIHRoZVxuICogQ29kZXggYnVpbGQncyBzZWNvbmRzIGNvbnZlcnNpb24gYXQgZW1pdCByZW1haW5zIGNvcnJlY3QuXG4gKi9cblxuaW1wb3J0IHsgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgcGFyc2VSZXNwb25zZSwgdHlwZSBSZXNwb25zZVBhcnNlSW5wdXQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtcmVzcG9uc2UuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXRcbn0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuaW1wb3J0IHsgcGFyc2VBcHBseVBhdGNoIH0gZnJvbSAnLi9hcHBseS1wYXRjaC5qcyc7XG5cbi8qKlxuICogVGhlIHByZWZpeCBhcHBseV9wYXRjaCdzIHN0ZG91dCBjYXJyaWVzIHdoZW4gXHUyMDE0IGFuZCBvbmx5IHdoZW4gXHUyMDE0IHRoZSBwYXRjaFxuICogYXBwbGllZCAoY29kZXgtcnMvYXBwbHktcGF0Y2ggYHByaW50X3N1bW1hcnlgKS4gQ29kZXggc3VyZmFjZXMgdGhhdCBzdGRvdXRcbiAqIHZlcmJhdGltIGFzIHRoZSBQb3N0VG9vbFVzZSBgdG9vbF9yZXNwb25zZWAgKGEgYmFyZSBzdHJpbmcgdG9kYXkpLiBGaXhlZFxuICogYWNyb3NzIEFkZC9Nb2RpZnkvRGVsZXRlOyB0aGUgaGVhZGVyIGlzIGZvbGxvd2VkIGJ5IGBBL00vRCA8cGF0aD5gIGxpbmVzLlxuICovXG5jb25zdCBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCA9ICdTdWNjZXNzLiBVcGRhdGVkIHRoZSBmb2xsb3dpbmcgZmlsZXM6JztcblxuLyoqXG4gKiBUaGUgY29tbW9uIGZpZWxkcyBhbiBvYmplY3Qtd3JhcHBlZCB0b29sX3Jlc3BvbnNlIG1pZ2h0IGNhcnJ5IHRoZSB0b29sJ3MgdGV4dFxuICogb3V0cHV0IHVuZGVyLCBpZiBDb2RleCBldmVyIHN0b3BzIHN1cmZhY2luZyBpdCBhcyBhIGJhcmUgc3RyaW5nLiBPcmRlcmVkIGJ5XG4gKiBsaWtlbGlob29kOyB0aGUgZmlyc3QgZmllbGQgd2hvc2UgdmFsdWUgaXMgYSBzdHJpbmcgd2lucy5cbiAqL1xuY29uc3QgUkVTUE9OU0VfVEVYVF9GSUVMRFMgPSBbJ291dHB1dCcsICdzdGRvdXQnLCAnY29udGVudCcsICd0ZXh0J10gYXMgY29uc3Q7XG5cbi8qKiBOYXJyb3cgdGhlIFNESydzIGB1bmtub3duYCB0b29sX2lucHV0IHRvIHRoZSBgYXBwbHlfcGF0Y2hgIGB7IGNvbW1hbmQgfWAgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93QXBwbHlQYXRjaENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICAgIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY2xhc3NpYyBgZXhlY19jb21tYW5kYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY0IDAuMTMwLjApOlxuICogYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gKnN0cmluZyogb2Ygc2hhcGVcbiAqIGB7XCJjbWRcIjogXCIuLi5cIiwgXCJ3b3JrZGlyXCI6IFwiLi4uXCJ9YCBcdTIwMTQgcGFyc2UgaXQgYW5kIHJldHVybiB0aGUgYGNtZGAgYW5kXG4gKiBgd29ya2RpcmAuIFJldHVybnMgYG51bGxgIGZvciBhbnkgb3RoZXIgc2hhcGUgKG5vdCBKU09OLCBubyBgY21kYCBmaWVsZCwgb3JcbiAqIG5vdCB0aGlzIGVudmVsb3BlKTsgYHdvcmtkaXJgIGlzIGBudWxsYCB3aGVuIGFic2VudCBvciBub3QgYSBzdHJpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dFeGVjQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiB7IGNtZDogc3RyaW5nOyB3b3JrZGlyOiBzdHJpbmcgfCBudWxsIH0gfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnYXJndW1lbnRzJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBhcmdzID0gKHRvb2xJbnB1dCBhcyB7IGFyZ3VtZW50czogdW5rbm93biB9KS5hcmd1bWVudHM7XG4gICAgaWYgKHR5cGVvZiBhcmdzID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhcmdzKTtcbiAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4geyBjbWQ6IHBhcnNlZC5jbWQsIHdvcmtkaXI6IHR5cGVvZiBwYXJzZWQud29ya2RpciA9PT0gJ3N0cmluZycgPyBwYXJzZWQud29ya2RpciA6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgcmVzdWx0IG9mIG5hcnJvd2luZyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZS4gYG1hdGNoZWRgIHNlcGFyYXRlc1xuICogXCJ0aGUgZW52ZWxvcGUgd2FzIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwgd2hvc2UgYXJndW1lbnQgY291bGQgbm90XG4gKiBiZSByZWNvdmVyZWRcIiAoYSB2YXJpYWJsZS90ZW1wbGF0ZS1idWlsdCBjb21tYW5kIFx1MjAxNCBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZSlcbiAqIGZyb20gXCJ0aGUgZW52ZWxvcGUgaXMgbm90IGNvZGUtbW9kZSBleGVjIGF0IGFsbFwiLCBzbyB0aGUgaGFuZGxlciBjYW4gd2FybiBvblxuICogdGhlIGZvcm1lciBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRpbmcgaXQgd2l0aCB0aGUgbGF0dGVyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIC8qKiBXaGV0aGVyIGB0b29sX2lucHV0LmlucHV0YCBjb250YWluZWQgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbC4gKi9cbiAgbWF0Y2hlZDogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWNvdmVyZWQgYGNtZGAgc3RyaW5nLCBvciBgbnVsbGAgd2hlbiBtYXRjaGVkIGJ1dCB1bnBhcnNhYmxlIC8gYWJzZW50LiAqL1xuICBjbWQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGB3b3JrZGlyYCBzdHJpbmcsIG9yIGBudWxsYCB3aGVuIGFic2VudCBvciBub3QgYSBzdHJpbmcuICovXG4gIHdvcmtkaXI6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUXVvdGUgYmFyZSBpZGVudGlmaWVyIGtleXMgaW4gYSBKUyBvYmplY3QgbGl0ZXJhbCBzbyBgSlNPTi5wYXJzZWAgY2FuIHJlYWRcbiAqIGl0LiBSZWFsIGNvZGUtbW9kZSBjYWxsIHNpdGVzIGVtaXQgSlMtc3R5bGUgdW5xdW90ZWQga2V5c1xuICogKGB7Y21kOlwic2VkIC1uICcxLDI0MHAnIC9wYXRoXCIsLi4ufWApLCB3aGljaCBpcyB2YWxpZCBKUyBidXQgaW52YWxpZCBKU09OLlxuICogU3RyaW5nIHZhbHVlcyAoc2luZ2xlLSBvciBkb3VibGUtcXVvdGVkKSBhcmUgY29waWVkIHZlcmJhdGltIFx1MjAxNCBpbmNsdWRpbmcgYW55XG4gKiBgLCBrZXk6YC1zaGFwZWQgdGV4dCBpbnNpZGUgdGhlbSBcdTIwMTQgYW5kIGFscmVhZHktcXVvdGVkIGtleXMgcGFzcyB0aHJvdWdoXG4gKiB1bnRvdWNoZWQuXG4gKi9cbmZ1bmN0aW9uIHF1b3RlT2JqZWN0S2V5cyhsaXRlcmFsOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGxpdGVyYWwubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gbGl0ZXJhbFtpXTtcbiAgICBpZiAoYyA9PT0gJ1wiJyB8fCBjID09PSBcIidcIikge1xuICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgY29uc3Qgc3RhcnQgPSBpO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuKSB7XG4gICAgICAgIGlmIChsaXRlcmFsW2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSBpICs9IDI7XG4gICAgICAgIGVsc2UgaWYgKGxpdGVyYWxbaV0gPT09IHF1b3RlKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2UgaSArPSAxO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGxpdGVyYWwuc2xpY2Uoc3RhcnQsIGkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGtleSA9IGxpdGVyYWwuc2xpY2UoaSkubWF0Y2goL14oXFx7fCwpXFxzKihbQS1aYS16XyRdW0EtWmEtejAtOV8kXSopXFxzKjovKTtcbiAgICBpZiAoa2V5KSB7XG4gICAgICBvdXQgKz0gYCR7a2V5WzFdfVwiJHtrZXlbMl19XCI6YDtcbiAgICAgIGkgKz0ga2V5WzBdLmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvdXQgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NSAwLjE0NC4wKTpcbiAqIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2UgdGhhdCBjYWxscyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgXHUyMDE0XG4gKiByZWNvdmVyIHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudCB2aWEgYmFsYW5jZWQtYnJhY2UgbWF0Y2hpbmcsIHF1b3RlIGl0c1xuICogdW5xdW90ZWQgSlMga2V5cywgYW5kIHBhcnNlIGl0LiBBIGNvbW1hbmQgYnVpbHQgZnJvbSB2YXJpYWJsZXMgb3IgdGVtcGxhdGVcbiAqIGxpdGVyYWxzIGlzIHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlOiB0aGUgY2FsbCBzdGlsbCAqbWF0Y2hlZCogYnV0IHlpZWxkc1xuICogYGNtZDogbnVsbGAsIHJlcG9ydGVkIGRpc3RpbmN0bHkgZnJvbSBhIG5vbi1jb2RlLW1vZGUgZW52ZWxvcGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dDb2RlTW9kZUV4ZWModG9vbElucHV0OiB1bmtub3duKTogQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnaW5wdXQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGlucHV0ID0gKHRvb2xJbnB1dCBhcyB7IGlucHV0OiB1bmtub3duIH0pLmlucHV0O1xuICAgIGlmICh0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBNYXRjaCB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pIFx1MjAxNCBleHRyYWN0IHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudFxuICAgICAgY29uc3QgbWF0Y2ggPSBpbnB1dC5tYXRjaCgvdG9vbHNcXC5leGVjX2NvbW1hbmRcXChcXHMqKFxceyg/Oltee31dfFxceyg/Oltee31dfFxce1tee31dKlxcfSkqXFx9KSpcXH0pXFxzKlxcKS8pO1xuICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShxdW90ZU9iamVjdEtleXMobWF0Y2hbMV0pKTtcbiAgICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbWF0Y2hlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgY21kOiBwYXJzZWQuY21kLFxuICAgICAgICAgICAgICB3b3JrZGlyOiB0eXBlb2YgcGFyc2VkLndvcmtkaXIgPT09ICdzdHJpbmcnID8gcGFyc2VkLndvcmtkaXIgOiBudWxsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwsIHdvcmtkaXI6IG51bGwgfTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbWF0Y2hlZCwgYnV0IHRoZSBsaXRlcmFsIGRpZCBub3QgcGFyc2UgXHUyMDE0IHRoZSBjYWxsIGlzIHN0aWxsIGFcbiAgICAgICAgICAvLyBjb2RlLW1vZGUgZXhlYyB3aG9zZSBjb21tYW5kIGNhbm5vdCBiZSByZWNvdmVyZWQgc3RhdGljYWxseS5cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwsIHdvcmtkaXI6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYXRjaGVkOiBmYWxzZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG59XG5cbi8qKiBUaGUgc2hlbGwgYHRvb2xfcmVzcG9uc2VgIGZpZWxkcyBhIHJlc3BvbnNlLWF3YXJlIHBhcnNlIGNvbnRyaWJ1dGVzLCBiZWZvcmUgYGNvbW1hbmRgL2Bjd2RgIGFyZSBhdHRhY2hlZCBhdCB0aGUgY2FsbCBzaXRlLiAqL1xudHlwZSBOb3JtYWxpemVkU2hlbGxSZXNwb25zZSA9IFBpY2s8XG4gIFJlc3BvbnNlUGFyc2VJbnB1dCxcbiAgJ3N0ZG91dCcgfCAnc3RkZXJyJyB8ICdleGl0U3RhdHVzJyB8ICd0cnVuY2F0ZWQnIHwgJ2ludGVycnVwdGVkJ1xuPjtcblxuLyoqXG4gKiBUb2xlcmFudGx5IG5vcm1hbGl6ZSB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IGFuZCBtZXRhZGF0YSBvdXQgb2YgYVxuICogYHRvb2xfcmVzcG9uc2VgIG9mIHVuY2VydGFpbiBzaGFwZSAoU0RLLXR5cGVkIGB1bmtub3duYCk6IGEgYmFyZSBzdHJpbmdcbiAqICh0b2RheSdzIENvZGV4KSBpcyB1c2VkIGFzLWlzOyBhIHRleHQtYmxvY2sgYXJyYXkgam9pbnMgaXRzIGJsb2NrczsgYW5cbiAqIG9iamVjdCBpcyBwcm9iZWQgZm9yIHRoZSBmaXJzdCB7QGxpbmsgUkVTUE9OU0VfVEVYVF9GSUVMRFN9IGVudHJ5IHRoYXRcbiAqIGhvbGRzIGEgc3RyaW5nLCBjYXJyeWluZyBhbG9uZyBgc3RkZXJyYCwgYGV4aXRDb2RlYC9gZXhpdFN0YXR1c2AsIGFuZCB0aGVcbiAqIHR3by1yZWdpbWUgbWFya2VycyB3aGVuIHRoZSBlbnZlbG9wZSBoYXMgdGhlbSBcdTIwMTQgYHJhd091dHB1dFBhdGhgIHNldCAodGhlXG4gKiBpbmxpbmUgc3Rkb3V0IGlzIG9ubHkgYSBwcmV2aWV3KSBiZWNvbWVzIGB0cnVuY2F0ZWQ6IHRydWVgOyBgaW50ZXJydXB0ZWRgXG4gKiBvciBgdGltZWRPdXRBZnRlck1zYCAodGhlIGNvbW1hbmQgd2FzIGN1dCBvZmYgbWlkLXJ1bikgYmVjb21lc1xuICogYGludGVycnVwdGVkOiB0cnVlYCwgdGhlIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lIFx1MjAxNCB0aGUgc2FtZSBub3JtYWxpemF0aW9uXG4gKiB0aGUgQ2xhdWRlIGFkYXB0ZXIgYXBwbGllcyB0byBpdHMgQmFzaCBlbnZlbG9wZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBub1xuICogdGV4dCBjYW4gYmUgcmVjb3ZlcmVkICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvXG4gKiBub24tb2JqZWN0KSwgd2hpY2ggdGhlIGNhbGxlciB0cmVhdHMgYXMgYW4gKnVucmVjb2duaXplZCogXHUyMDE0IG5vdCAqZmFpbGVkKiBcdTIwMTRcbiAqIHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTaGVsbFJlc3BvbnNlKHRvb2xSZXNwb25zZTogdW5rbm93bik6IE5vcm1hbGl6ZWRTaGVsbFJlc3BvbnNlIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnc3RyaW5nJykgcmV0dXJuIHsgc3Rkb3V0OiB0b29sUmVzcG9uc2UgfTtcbiAgaWYgKEFycmF5LmlzQXJyYXkodG9vbFJlc3BvbnNlKSkge1xuICAgIGNvbnN0IHRleHQ6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBibG9jayBvZiB0b29sUmVzcG9uc2UpIHtcbiAgICAgIGlmIChibG9jayAhPT0gbnVsbCAmJiB0eXBlb2YgYmxvY2sgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gKGJsb2NrIGFzIHsgdGV4dD86IHVua25vd24gfSkudGV4dDtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHRleHQucHVzaCh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IHN0ZG91dDogdGV4dC5qb2luKCcnKSB9O1xuICB9XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSB0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBSRVNQT05TRV9URVhUX0ZJRUxEUykge1xuICAgICAgY29uc3QgdmFsdWUgPSByZWNvcmRbZmllbGRdO1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGRvdXQ6IHZhbHVlLFxuICAgICAgICAgIHN0ZGVycjogdHlwZW9mIHJlY29yZC5zdGRlcnIgPT09ICdzdHJpbmcnID8gcmVjb3JkLnN0ZGVyciA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBleGl0U3RhdHVzOlxuICAgICAgICAgICAgdHlwZW9mIHJlY29yZC5leGl0Q29kZSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICAgPyByZWNvcmQuZXhpdENvZGVcbiAgICAgICAgICAgICAgOiB0eXBlb2YgcmVjb3JkLmV4aXRTdGF0dXMgPT09ICdudW1iZXInXG4gICAgICAgICAgICAgICAgPyByZWNvcmQuZXhpdFN0YXR1c1xuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHRydW5jYXRlZDogcmVjb3JkLnJhd091dHB1dFBhdGggIT09IHVuZGVmaW5lZCxcbiAgICAgICAgICBpbnRlcnJ1cHRlZDogcmVjb3JkLmludGVycnVwdGVkID09PSB0cnVlIHx8IHJlY29yZC50aW1lZE91dEFmdGVyTXMgIT09IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBDbGFzc2lmeSBhbiBgYXBwbHlfcGF0Y2hgIGB0b29sX3Jlc3BvbnNlYCBmb3IgdGhlIHRvdWNoIGdhdGU6XG4gKlxuICogLSBgJ3N1Y2Nlc3MnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGZyb20gYSBiYXJlIHN0cmluZyBvciBhIHRleHQtZmllbGRcbiAqICAgb2JqZWN0IGFuZCBjYXJyaWVzIHtAbGluayBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWH0uXG4gKiAtIGAnZmFpbHVyZSdgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgZnJvbSBhIGJhcmUgc3RyaW5nIG9yIGEgdGV4dC1maWVsZFxuICogICBvYmplY3QgYnV0IGxhY2tzIHRoZSBoZWFkZXI6IGEgZ2VudWluZSByZWplY3Rpb24gb3IgZXJyb3IuIFRoZSBPTkxZXG4gKiAgIGNsYXNzaWZpY2F0aW9uIHRoYXQgc3VwcHJlc3NlcyB0aGUgdG91Y2guXG4gKiAtIGAndW5rbm93bidgIFx1MjAxNCBubyB0ZXh0IGNvdWxkIGJlIHJlY292ZXJlZCAodW5yZWNvZ25pemVkIHNoYXBlKSwgb3IgdGhlXG4gKiAgIHJlc3BvbnNlIGlzIGEgYmxvY2svdGV4dCBhcnJheS4gV2UgcHJvY2VlZCBkZWZlbnNpdmVseSBoZXJlIHJhdGhlciB0aGFuXG4gKiAgIHJpc2sgbWlzc2luZyBhIHJlYWwgZWRpdCdzIGhlYWwvc3VyZmFjZTsgQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZVxuICogICBvbmx5IG9uIHN1Y2Nlc3MsIHNvIHRoaXMgY2Fubm90IGhlYWwvc3VyZmFjZSBhIHBhdGNoIHRoYXQgbmV2ZXIgYXBwbGllZC5cbiAqXG4gKiBUaGUgYXJyYXkgY2hlY2sgcmVzdG9yZXMgdGhlIHByZS1ub3JtYWxpemVyIGNvbnRyYWN0OiB0aGUgYmFzZWxpbmVcbiAqIGBleHRyYWN0UmVzcG9uc2VUZXh0YCByZXR1cm5lZCBgbnVsbGAgZm9yIGV2ZXJ5IGFycmF5IHNoYXBlICh0ZXh0LWJsb2NrLFxuICogZW1wdHksIG5vbi10ZXh0KSwgc28gYXJyYXlzIGNsYXNzaWZpZWQgYCd1bmtub3duJ2AgYW5kIHByb2NlZWRlZCB3aXRoIGFcbiAqIHdhcm5pbmcuIGBub3JtYWxpemVTaGVsbFJlc3BvbnNlYCBkZWxpYmVyYXRlbHkgd2lkZW5lZCB0byBhcnJheXMgZm9yIHRoZVxuICogc2hlbGwtcGFyc2UgZXZpZGVuY2Ugc291cmNlLCBzbyBjbGFzc2lmaWNhdGlvbiByZWFkcyB0aGUgcmF3IGVudmVsb3BlIHRvXG4gKiBrZWVwIHRoZSBhcHBseV9wYXRjaCBnYXRlIGJlaGF2aW9yLWlkZW50aWNhbCBcdTIwMTQgYSBqb2luZWQgYXJyYXkgd2hvc2UgdGV4dFxuICogbWVyZWx5IGxhY2tzIHRoZSBzdWNjZXNzIGhlYWRlciBtdXN0IG5ldmVyIGJlIG1pc3Rha2VuIGZvciBhIGNvbmZpcm1lZFxuICogcmVqZWN0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodG9vbFJlc3BvbnNlKSkgcmV0dXJuICd1bmtub3duJztcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVNoZWxsUmVzcG9uc2UodG9vbFJlc3BvbnNlKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiBub3JtYWxpemVkLnN0ZG91dC5zdGFydHNXaXRoKEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYKSA/ICdzdWNjZXNzJyA6ICdmYWlsdXJlJztcbn1cblxuLyoqIEEgcmVhZGVyIHRoYXQgYWx3YXlzIGRlY2xpbmVzLCBmb3JjaW5nIHRoZSBwYXJzZXIgdG8gd2hvbGUtZmlsZSBhbmNob3JzLiAqL1xuY29uc3Qgbm9SYW5nZVJlY292ZXJ5ID0gKCk6IG51bGwgPT4gbnVsbDtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCB0b29sX25hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IGlucHV0LnNlc3Npb25faWQ7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuXG4gICAgLy8gU2hlbGwgdG91Y2g6IGV4dHJhY3QgdGhlIGNvbW1hbmQgZnJvbSB3aGljaGV2ZXIgZW52ZWxvcGUgc2hhcGUgdGhlIGhhcm5lc3NcbiAgICAvLyBkZWxpdmVycywgcGFyc2UsIGFuZCBydW4gZWFjaCByZXNvbHZlZCBzcGFuIHRocm91Z2ggdGhlIHNoYXJlZCB0b3VjaCBjb3JlLlxuICAgIC8vIFRoZSBicmFuY2ggYWxzbyBub3JtYWxpemVzIGB0b29sX3Jlc3BvbnNlYCB2aWEgYG5vcm1hbGl6ZVNoZWxsUmVzcG9uc2VgXG4gICAgLy8gYW5kIG1lcmdlcyBgcGFyc2VSZXNwb25zZWAncyBzcGFucyBpbiBhcyByZWFkIHRvdWNoZXMgKHRoZSB0b29sX3Jlc3BvbnNlXG4gICAgLy8gcGFzcyBiZWxvdykuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBsZXQgd29ya2Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgY2FycmllcyBgd29ya2RpcmAgYmVzaWRlIGBjbWRgXG4gICAgICAgIC8vIChwbGFuIFx1MDBBNzgpIFx1MjAxNCB0aHJlYWQgaXQgdGhyb3VnaCBsaWtlIHRoZSBjb2RlLW1vZGUgZW52ZWxvcGUgYmVsb3cuXG4gICAgICAgIGNvbnN0IGNsYXNzaWMgPSBuYXJyb3dFeGVjQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgY29tbWFuZCA9IGNsYXNzaWM/LmNtZCA/PyBudWxsO1xuICAgICAgICB3b3JrZGlyID0gY2xhc3NpYz8ud29ya2RpciA/PyBudWxsO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICAgIHdvcmtkaXIgPSBjb2RlTW9kZS53b3JrZGlyO1xuICAgICAgfVxuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICAvLyBQbGFuIFx1MDBBNzg6IGEgd29ya2RpciBwcmVzZW50IGFuZCBmcmVlIG9mIGAkYC9iYWNrdGljayBhYnNvbHV0aXplcyBhZ2FpbnN0XG4gICAgICAvLyB0aGUgZW52ZWxvcGUncyBvd24gYGlucHV0LmN3ZGAgXHUyMDE0IHRoZSBzaGVsbCB0b29sIHJlc29sdmVzIGEgcmVsYXRpdmVcbiAgICAgIC8vIHdvcmtkaXIgYWdhaW5zdCB0aGF0IHNhbWUgYmFzZSBcdTIwMTQgYW5kIGlzIHRoZSBzaW5nbGUgZnJhbWUgZm9yIHRoZSB3aG9sZVxuICAgICAgLy8gdG91Y2ggKHBhcnNlIGJhc2UsIGFic29sdXRpemF0aW9uLCBzY29wZSBjaGVjaywgYW5kIHRoZSB0b3VjaCByZWNvcmQnc1xuICAgICAgLy8gY3dkLCB3aGljaCB0aGUgZXhlY3V0b3JzIGRyaXZlIHRoZWlyIGdpdCBzcGFuIHJ1bnMgZnJvbSkuIEFcbiAgICAgIC8vIHRlbXBsYXRlLWxpdGVyYWwgd29ya2RpciAoY29udGFpbmluZyBgJGAvYmFja3RpY2spIGlzIHVucmVzb2x2YWJsZSBhbmRcbiAgICAgIC8vIGZhbGxzIGJhY2sgdG8gaG9vayBgY3dkYC5cbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUN3ZCA9IHdvcmtkaXIgIT09IG51bGwgJiYgIS9bYCRdLy50ZXN0KHdvcmtkaXIpID8gcmVzb2x2ZVBhdGgoY3dkLCB3b3JrZGlyKSA6IGN3ZDtcblxuICAgICAgY29uc3QgbWF0Y2hlcyA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIHsgY3dkOiBlZmZlY3RpdmVDd2QgfSk7XG4gICAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIG1hdGNoZXMpIHtcbiAgICAgICAgaWYgKG1hdGNoLnN0YXR1cyAhPT0gJ3Jlc29sdmVkJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHNwYW4gPSBtYXRjaC5zcGFuO1xuICAgICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoZWZmZWN0aXZlQ3dkLCBzcGFuLmFic29sdXRlUGF0aCk7XG4gICAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoZWZmZWN0aXZlQ3dkLCBhYnNQYXRoKTtcbiAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgIGxldCB0b3VjaElucHV0OiB7XG4gICAgICAgICAga2luZDogJ3JlYWQnIHwgJ3dyaXRlJztcbiAgICAgICAgICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgICAgICAgICBjd2Q6IHN0cmluZztcbiAgICAgICAgICBmaWxlUGF0aDogc3RyaW5nO1xuICAgICAgICAgIG9mZnNldD86IG51bWJlcjtcbiAgICAgICAgICBsaW1pdD86IG51bWJlcjtcbiAgICAgICAgICB3cml0dGVuPzogc3RyaW5nO1xuICAgICAgICB9O1xuICAgICAgICBpZiAobWF0Y2guaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJykge1xuICAgICAgICAgIC8vIGA+YCBvdmVyd3JpdGVzOiB3aG9sZS1maWxlIHNjb3BlIHNvIGRlbGV0ZWQgc3BhbnMgYmV5b25kIHRoZSBuZXdcbiAgICAgICAgICAvLyBFT0YgYXJlIHN1cmZhY2VkLiBgPj5gIGFwcGVuZHM6IG5hcnJvdyB0byB0aGUgYXBwZW5kZWQgbGluZXMuXG4gICAgICAgICAgY29uc3Qgd3JpdHRlbiA9IHNwYW4ucmVkaXJlY3QgPT09ICc+JyA/ICcnIDogKHNwYW4uYm9keSA/PyAnJyk7XG4gICAgICAgICAgdG91Y2hJbnB1dCA9IHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2Q6IGVmZmVjdGl2ZUN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW4gfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0b3VjaElucHV0ID0ge1xuICAgICAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgY3dkOiBlZmZlY3RpdmVDd2QsXG4gICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2hJbnB1dCBhcyBUb3VjaElucHV0LCBleGVjdXRvcnMsIG1lbW8pO1xuICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgfVxuICAgICAgLy8gVGhlIHRvb2xfcmVzcG9uc2UgaXMgYSBzZWNvbmQgZXZpZGVuY2Ugc291cmNlIGZvciB0aGUgc2hlbGw6XG4gICAgICAvLyByZXNwb25zZS1kZXJpdmFibGUgY29tbWFuZHMgKGdyZXAvcmlwZ3JlcCB3aXRoIG51bWJlcmVkIG91dHB1dCxcbiAgICAgIC8vIGdpdCBkaWZmL3Nob3cvbG9nIC1wLCBnaXQgYmxhbWUgLUwpIGxvY2F0ZSB0aGVpciByZWFkIHdpbmRvd3MgaW4gdGhlXG4gICAgICAvLyBvdXRwdXQsIHdoaWNoIHRoZSBjb21tYW5kIHRleHQgYWxvbmUgY2Fubm90LiBOb3JtYWxpemUgdGhlIGVudmVsb3BlLFxuICAgICAgLy8gbWVyZ2UgaXRzIHNwYW5zIHdpdGggdGhlIGNvbW1hbmQtZGVyaXZlZCBvbmVzLCBhbmQgcnVuIGVhY2ggYXMgYVxuICAgICAgLy8gcmVhZCB0b3VjaDsgdGhlIG1lbW8gZGVkdXBlcyBkdXBsaWNhdGUgc3VyZmFjZXMgYWNyb3NzIHRoZSBzb3VyY2VzLlxuICAgICAgLy8gQW4gdW5yZWNvZ25pemVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIGNvbW1hbmQtb25seSBwYXJzaW5nLlxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBub3JtYWxpemVTaGVsbFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgICAgaWYgKHJlc3BvbnNlICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3BhbiBvZiBwYXJzZVJlc3BvbnNlKHsgY29tbWFuZCwgY3dkLCAuLi5yZXNwb25zZSB9KSkge1xuICAgICAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICAgICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgY3dkLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgICAgb2Zmc2V0OiBzcGFuLmxpbmVTdGFydCxcbiAgICAgICAgICAgICAgbGltaXQ6IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgICAgIG1lbW9cbiAgICAgICAgICApO1xuICAgICAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIFN1cHByZXNzIG9ubHkgYSAqY29uZmlybWVkKiBub24tc3VjY2Vzcy4gQW4gdW5yZWNvZ25pemVkIHJlc3BvbnNlIHNoYXBlXG4gICAgLy8gcHJvY2VlZHMgKHdpdGggYSB3YXJuaW5nKSByYXRoZXIgdGhhbiByaXNrIHNraXBwaW5nIGEgcmVhbCBlZGl0J3MgdG91Y2guXG4gICAgY29uc3QgY2xhc3NpZmljYXRpb24gPSBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZShpbnB1dC50b29sX3Jlc3BvbnNlKTtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICdmYWlsdXJlJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICd1bmtub3duJykge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdDb2RleCBhcHBseV9wYXRjaCB0b29sX3Jlc3BvbnNlIHNoYXBlIHVucmVjb2duaXplZDsgcnVubmluZyB0b3VjaCBkZWZlbnNpdmVseScsIHtcbiAgICAgICAgdG9vbFJlc3BvbnNlVHlwZTogdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UsXG4gICAgICAgIHRvb2xSZXNwb25zZUtleXM6XG4gICAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9yZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBPbmUgZW52ZWxvcGUgbWF5IHRvdWNoIHNldmVyYWwgZmlsZXM7IGZvcmNlIHdob2xlLWZpbGUgYW5jaG9ycyAoQ29kZXggbmV2ZXJcbiAgICAvLyByZWNvdmVycyBhIHBvc3QtZWRpdCByYW5nZSkgYW5kIHJ1biB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgcGVyIHRvdWNoZWQgZmlsZS5cbiAgICAvLyBUaGUgc2hhcmVkIG1lbW8gZGVkdXBlcyBzcGFuIHJlbmRlcnMgYWNyb3NzIGFuY2hvcnMgYW5kIHRoZSBzZXNzaW9uLlxuICAgIGNvbnN0IGFuY2hvcnMgPSBwYXJzZUFwcGx5UGF0Y2goY29tbWFuZCwgbm9SYW5nZVJlY292ZXJ5KTtcbiAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoOiBhYnNQYXRoLCB3cml0dGVuOiAnJyB9LFxuICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgIG1lbW9cbiAgICAgICk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdhcHBseV9wYXRjaHxleGVjX2NvbW1hbmR8ZXhlY3xCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiZnVuY3Rpb24gYXR0YWNoTWV0YWRhdGEoaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9vayA9IGhhbmRsZXI7XG4gICAgaG9vay5ob29rRXZlbnROYW1lID0gaG9va0V2ZW50TmFtZTtcbiAgICBob29rLnRpbWVvdXQgPSBjb25maWcudGltZW91dDtcbiAgICBob29rLnN0YXR1c01lc3NhZ2UgPSBjb25maWcuc3RhdHVzTWVzc2FnZTtcbiAgICBpZiAoXCJtYXRjaGVyXCIgaW4gY29uZmlnICYmIHR5cGVvZiBjb25maWcubWF0Y2hlciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBob29rLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICB9XG4gICAgcmV0dXJuIGhvb2s7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlVzZXJQcm9tcHRTdWJtaXRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlNlc3Npb25TdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VEcmlmdFBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRHJpZnRQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRHJpZnRQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBEcmlmdFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGVtYmVkZGVkIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50XG4gKiBsYW5ndWFnZSdzIEFTVCwgbm90IGEgc2hlbGwgY29uY2VybiksIHNlZCAtaSAobm8gbGluZS1hZGRyZXNzZWQgdXNhZ2VcbiAqIG9ic2VydmVkIFx1MjAxNCBhbGwgcGF0dGVybi1vbmx5IHN1YnN0aXR1dGlvbnMgd2l0aCBubyBzdGF0aWMgcmFuZ2UpLCBwbGFpblxuICogYGVjaG9gL2BwcmludGZgIHJlZGlyZWN0cyAocmFyZSBhbmQgc2VtYW50aWNhbGx5IGFtYmlndW91cyBpbiB0aGUgY29ycHVzKS5cbiAqXG4gKiBUaGUgZ3JlcCBmYW1pbHkgKGdyZXAgLW4vLUEvLUIvLUMpIGlzIG5vdCBpbiB0aGF0IGxpc3QsIGJ1dCBpdCBpcyBub3RcbiAqIGNsYXNzaWZpZWQgaGVyZSBlaXRoZXI6IGl0cyB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2ggcG9zaXRpb24sIHdoaWNoIGlzXG4gKiBkYXRhLWRlcGVuZGVudCBhbmQgbGl2ZXMgaW4gdGhlIHJlc3BvbnNlLCBub3QgdGhlIGNvbW1hbmQgdGV4dC4gVGhvc2Ugc3BhbnNcbiAqIGFyZSByZXNwb25zZS1kZXJpdmVkIFx1MjAxNCBgcGFyc2VSZXNwb25zZWAgaW4gLi9wYXJzZS1yZXNwb25zZS5qcyByZWFkcyB0aGVtXG4gKiBvdXQgb2YgdGhlIGNvbW1hbmQncyBgdG9vbF9yZXNwb25zZWAuIFRoZSBgZ2l0IGxvZyAtTGAgLyBgZ2l0IHNob3dcbiAqIHJldjpwYXRoYCBpZGlvbXMgYmVsb3cgcmVtYWluIGNvbW1hbmQtdGV4dC1kZXJpdmVkLlxuICovXG5pbXBvcnQgeyBpc0Fic29sdXRlLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7XG4gIGFyZ3ZPZixcbiAgdHlwZSBPcGVyYXRvcixcbiAgdHlwZSBTaW1wbGVDb21tYW5kLFxuICBzcGxpdFRvcExldmVsLFxuICBzcGxpdFdvcmRzLFxuICBzdHJpcFJlZGlyZWN0cyxcbiAgc3RyaXBXcmFwcGVyc1xufSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IERFRkFVTFRfUEFUSF9BTExPV0xJU1QsIGV4cGFuZFZhcmlhYmxlcyB9IGZyb20gJy4vdmFyaWFibGUtZXhwYW5kLmpzJztcblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZFNwYW4ge1xuICBsaW5lU3RhcnQ6IG51bWJlcjtcbiAgbGluZUVuZDogbnVtYmVyO1xuICBhYnNvbHV0ZVBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBleGFjdCBib2R5IG9mIGEgYGhlcmVkb2Mtd3JpdGVgIHNwYW4gXHUyMDE0IHRoZSBjb250ZW50IHRoZSBoZXJlZG9jIHdyaXRlcy5cbiAgICogQWJzZW50ICh1bmRlZmluZWQpIGZvciByZWFkIGlkaW9tcy5cbiAgICovXG4gIGJvZHk/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgaGVyZWRvYyByZWRpcmVjdCBvcGVyYXRvci4gYD5gIG1lYW5zIHRoZSBmaWxlIHdhcyBvdmVyd3JpdHRlblxuICAgKiAod2hvbGUtZmlsZSBzY29wZSBcdTIwMTQgYW55IHNwYW4gYmV5b25kIHRoZSBuZXcgRU9GIHdhcyBkZWxldGVkIGFuZCBtdXN0XG4gICAqIHN1cmZhY2UpOyBgPj5gIG1lYW5zIHRoZSBib2R5IHdhcyBhcHBlbmRlZCAobmFycm93IHRvIHRoZSBhcHBlbmQgcmFuZ2UpLlxuICAgKiBBYnNlbnQgKHVuZGVmaW5lZCkgZm9yIHJlYWQgaWRpb21zLlxuICAgKi9cbiAgcmVkaXJlY3Q/OiAnPicgfCAnPj4nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnO1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKiBPcHRpb25zIGZvciB0aGUgQmFzaCBjb21tYW5kIHBhcnNlciAocGxhbiBcdTAwQTc4KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VPcHRpb25zIHtcbiAgLyoqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0byByZXNvbHZlIHJlbGF0aXZlIHBhdGhzIGFnYWluc3Q7IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYC4gKi9cbiAgY3dkPzogc3RyaW5nO1xuICAvKiogVGhlIGhvb2sgcHJvY2VzcyBlbnYsIGZvciBhbGxvd2xpc3RlZCBwYXRoLXZhcmlhYmxlIHJlc29sdXRpb247IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmVudmAuICovXG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD47XG4gIC8qKiBWYXJpYWJsZSBuYW1lcyBhbGxvd2VkIHRvIHJlc29sdmUgZnJvbSBgZW52YDsgZGVmYXVsdHMgdG8gYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgLiAqL1xuICBhbGxvd2xpc3Q/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIFdoZXRoZXIgYSBzaW1wbGUgY29tbWFuZCBpcyBrbm93biB0byBoYXZlIGV4ZWN1dGVkLCBwcm92YWJseSBub3QsIG9yIHVuZGV0ZXJtaW5hYmxlIChwbGFuIFx1MDBBNzIpLiAqL1xuZXhwb3J0IHR5cGUgRXhlY1N0YXR1cyA9ICd5ZXMnIHwgJ25vJyB8ICd1bmtub3duJztcblxuLyoqIFRoZSBleGVjdXRpb24tYXdhcmUgd2FsaydzIHZlcmRpY3QgZm9yIG9uZSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTcyKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VFeGVjIHtcbiAgLyoqIGAneWVzJ2AgXHUyMDE0IHByb3ZhYmx5IGV4ZWN1dGVkOyBgJ25vJ2AgXHUyMDE0IHByb3ZhYmx5IG5vdDsgYCd1bmtub3duJ2AgXHUyMDE0IHVuZGV0ZXJtaW5hYmxlIChmYWlsIGNsb3NlZCkuICovXG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG59XG5cbi8qKlxuICogQ29tcHV0ZSwgcGVyIHNpbXBsZSBjb21tYW5kLCB3aGV0aGVyIGl0IGV4ZWN1dGVkIChwbGFuIFx1MDBBNzIpOiBwaXBlbGluZVxuICogZ3JvdXBpbmcsIGAmJmAvYHx8YCBjaGFpbiBnYXRpbmcgYWdhaW5zdCBrbm93biBzdGF0dXNlcywgYCFgIGdyb3VwLWxldmVsXG4gKiBuZWdhdGlvbiwgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIHRlcm1pbmF0b3IgYW5kIG5ldmVyLXJldHVyblxuICogZmlyZXMsIGFuZCB0aGUgZGVjaWRhYmxlLWNvbnRyb2wgY29uc3RydWN0IGNsYXNzZXMuIElPLWZyZWUgYW5kIGV4cG9ydGVkIHNvXG4gKiB0aGUgeHRyYWNlIG9yYWNsZSBjYW4gY29tcGFyZSBleGVjdXRlZCBzZXRzIGFnYWluc3QgcmVhbCBiYXNoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5hbHl6ZUV4ZWN1dGlvbihzaW1wbGVDb21tYW5kczogU2ltcGxlQ29tbWFuZFtdLCBfb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBTdGFnZUV4ZWNbXSB7XG4gIGNvbnN0IHdhbGtlciA9IG5ldyBFeGVjdXRpb25XYWxrZXIoKTtcbiAgd2Fsa2VyLndhbGtJbnB1dChzaW1wbGVDb21tYW5kcyk7XG4gIHJldHVybiB3YWxrZXIudmVyZGljdHMubWFwKChleGVjKSA9PiAoeyBleGVjIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeGVjdXRpb24gd2FsayAocGxhbiBcdTAwQTcyKTogcGVyLXNpbXBsZS1jb21tYW5kIEV4ZWNTdGF0dXMsIGRyaXZlbiBieSBwaXBlbGluZVxuLy8gZ3JvdXBpbmcsICYmL3x8IGNoYWluIHN0YXR1cywgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIGFuZCB0aGVcbi8vIGRlY2lkYWJsZS1jb250cm9sIGNvbnN0cnVjdCBjbGFzc2VzLiBUaGUgd2FsayBhbHNvIGV4cGFuZHMgZGVjaWRhYmxlXG4vLyBjb25zdHJ1Y3QgaW50ZXJpb3JzIGludG8gdGhlIHN0YWdlIHN0cmVhbSB0aGUgZW1pc3Npb24gcmVwbGF5IGNvbnN1bWVzLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgQ2hhaW5TdGF0dXMgPSAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bic7XG5cbnR5cGUgRGVhZEtpbmQgPSAnZXhpdCcgfCAnbmV2ZXItcmV0dXJuJyB8ICdlcnJleGl0JyB8ICdtYWxmb3JtZWQnO1xuXG4vKiogT25lIHN0YWdlIHRoZSB3YWxrIGNvbnRyaWJ1dGVzIHRvIHRoZSBlbWlzc2lvbiByZXBsYXkuICovXG5pbnRlcmZhY2UgRXhwYW5kZWRTdGFnZSB7XG4gIHRleHQ6IHN0cmluZztcbiAgcHJlY2VkZWRCeTogT3BlcmF0b3I7XG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gIC8qKiBBIG1lbWJlciBvZiBhIG11bHRpLW1lbWJlciBwaXBlbGluZTogc2lkZSBlZmZlY3RzIGFuZCBgZXhpdGAvYGV4ZWNgIHRlcm1pbmF0b3JzIGFyZSBzdXBwcmVzc2VkLiAqL1xuICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAvKiogVGhlIGVtaXNzaW9uJ3MgYGNkYCBmcmFtZTogKzEgaW5zaWRlIGEgc3Vic2hlbGwgaW50ZXJpb3IsIGRpc2NhcmRlZCBhdCB0aGUgY2xvc2UuICovXG4gIGRpckZyYW1lOiBudW1iZXI7XG4gIC8qKiBUaGUgc2NyaXB0IHZhcmlhYmxlIHRhYmxlIGFzIG9mIHRoaXMgc3RhZ2UgKHBsYW4gXHUwMEE3Nyk6IHRoZSBleGVjdXRlZCBub24tcGlwZSBhc3NpZ25tZW50cyBzZWVuIHNvIGZhciwgaW4gb3JkZXIuICovXG4gIGFzc2lnbm1lbnRzOiBSZWFkb25seU1hcDxzdHJpbmcsIHN0cmluZz47XG59XG5cbmludGVyZmFjZSBMb29wRnJhbWUge1xuICBvdXRjb21lOiAnbm9uZScgfCAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdhbWJpZ3VvdXMnIHwgJ3JldHVybic7XG4gIC8qKiBBIGRlY2lzaXZlIG93bi1kZXB0aCBicmVhay9jb250aW51ZSBmaXJlZDogdGhlIHJlc3Qgb2YgdGhlIGJvZHkgbGlzdCBpcyBkZWFkLiAqL1xuICBib2R5VGVybWluYXRlZDogYm9vbGVhbjtcbiAgLyoqIEEgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIG1hZGUgdGhlIGd1YXJkIG9ud2FyZCB1bnRvdWNoYWJsZS4gKi9cbiAgYW1iaWd1b3VzU3RvcDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFdhbGtPcHRpb25zIHtcbiAgLyoqIEVycmV4aXQgbGl2ZW5lc3MgaXMgc3VzcGVuZGVkIGluc2lkZSBpZi93aGlsZS91bnRpbCBjb25kaXRpb25zIChiYXNoIGV4ZW1wdHMgdGhlbSkuICovXG4gIGxpdmVuZXNzOiBib29sZWFuO1xuICAvKiogVGhlIGV4cGFuZGVkIHN0YWdlIHN0cmVhbSBpcyBkaXNjYXJkZWQgKGNvbmRpdGlvbnMsIHNjYW5zLCBkZWYtYm9keSBwcm9iZXMpLiAqL1xuICBkaXNjYXJkOiBib29sZWFuO1xuICAvKiogU2lkZSBlZmZlY3RzIChhc3NpZ25tZW50cywgc2V0IHRvZ2dsZXMsIGRlZiByZWdpc3RyYXRpb24pIGFyZSBhcHBsaWVkLiAqL1xuICBzaWRlRWZmZWN0czogYm9vbGVhbjtcbiAgLyoqIFRoaXMgbGlzdCBpcyB0aGUgdG9wLWxldmVsIGlucHV0OiByZWNvcmQgdGhlIHBlci1pbnB1dCB2ZXJkaWN0cy4gKi9cbiAgaW5wdXRGYWNpbmc6IGJvb2xlYW47XG59XG5cbmNvbnN0IEFTU0lHTk1FTlRfUkUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqIFRoZSBgLW9gL2Arb2Agb3B0aW9uIG5hbWVzIG9mIGBzZXRgIHRoYXQgYmFzaCBkb2N1bWVudHMgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX09QVElPTl9OQU1FUyA9IG5ldyBTZXQoW1xuICAnYWxsZXhwb3J0JyxcbiAgJ2JyYWNlZXhwYW5kJyxcbiAgJ2VtYWNzJyxcbiAgJ2VycmV4aXQnLFxuICAnZXJydHJhY2UnLFxuICAnZnVuY3RyYWNlJyxcbiAgJ2hhc2hhbGwnLFxuICAnaGlzdGV4cGFuZCcsXG4gICdoaXN0b3J5JyxcbiAgJ2lnbm9yZWVvZicsXG4gICdpbnRlcmFjdGl2ZS1jb21tZW50cycsXG4gICdrZXl3b3JkJyxcbiAgJ2xleGljYWwtd29yZC1wcm9jZXNzaW5nJyxcbiAgJ21vbml0b3InLFxuICAnbm9jbG9iYmVyJyxcbiAgJ25vZXhlYycsXG4gICdub2dsb2InLFxuICAnbm9sb2cnLFxuICAnbm90aWZ5JyxcbiAgJ25vdW5zZXQnLFxuICAnb25lY21kJyxcbiAgJ3BoeXNpY2FsJyxcbiAgJ3BpcGVmYWlsJyxcbiAgJ3Bvc2l4JyxcbiAgJ3ByaXZpbGVnZWQnLFxuICAndmVyYm9zZScsXG4gICd2aScsXG4gICd4dHJhY2UnXG5dKTtcblxuLyoqIGJhc2gncyBkb2N1bWVudGVkIHNpbmdsZS1sZXR0ZXIgYHNldGAgZmxhZ3MgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX0ZMQUdfTEVUVEVSUyA9ICdhQmJDZUVmaEhpa21ub3BQdFR1dngnO1xuXG4vKiogQnVpbHRpbnMgdGhlIHdhbGsncyByZXN0cmljdGVkIGBidWlsdGluYCB3cmFwcGVyIHN0cmlwIGZvcndhcmRzIChwbGFuIFx1MDBBNzIsIHdyYXBwZXIgZGlzY2lwbGluZSkuICovXG5jb25zdCBSRUNPR05JWkVEX0JVSUxUSU5TID0gbmV3IFNldChbXG4gICd0cnVlJyxcbiAgJzonLFxuICAnZmFsc2UnLFxuICAnc2V0JyxcbiAgJ2V4aXQnLFxuICAnZXhlYycsXG4gICdyZXR1cm4nLFxuICAnYnJlYWsnLFxuICAnY29udGludWUnLFxuICAnY2QnLFxuICAnZXhwb3J0JyxcbiAgJ2NvbW1hbmQnLFxuICAnYnVpbHRpbidcbl0pO1xuXG4vKiogV2Fsay1zaWRlIHdyYXBwZXIgc3RyaXA6IGAhYCwgYGNvbW1hbmRgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKS4gKi9cbmZ1bmN0aW9uIHdhbGtTdHJpcChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdjb21tYW5kJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdidWlsdGluJyAmJiBhcmd2W2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIFJFQ09HTklaRURfQlVJTFRJTlMuaGFzKGFyZ3ZbaSArIDFdKSlcbiAgICBpKys7XG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKiogRW1pc3Npb24tc2lkZSBzdHJpcDogbGVhZGluZyBgIWAsIGBjb21tYW5kYCwgYGV4ZWNgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKSBiZWZvcmUgbWF0Y2hlciBkaXNwYXRjaC4gKi9cbmZ1bmN0aW9uIHN0cmlwRm9yRW1pc3Npb24oYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnIScpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiAoYXJndltpXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbaV0gPT09ICdleGVjJykpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnYnVpbHRpbicgJiYgYXJndltpICsgMV0gIT09IHVuZGVmaW5lZCAmJiBSRUNPR05JWkVEX0JVSUxUSU5TLmhhcyhhcmd2W2kgKyAxXSkpXG4gICAgaSsrO1xuICByZXR1cm4gYXJndi5zbGljZShpKTtcbn1cblxuLyoqIEV2ZXJ5IGFyZyBhIHJlY29nbml6ZWQgYHNldGAgZmxhZyBncm91cCAoYC1vYCBjb25zdW1lcyBpdHMgbmFtZSksIGAtLWAsIG9yIGEgcG9zaXRpb25hbCB3b3JkLiAqL1xuZnVuY3Rpb24gc2V0RmxhZ3NLbm93bihhcmdzOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpIHx8IGEuc3RhcnRzV2l0aCgnKycpKSB7XG4gICAgICBjb25zdCBjaGFycyA9IGEuc2xpY2UoMSk7XG4gICAgICBpZiAoY2hhcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNoYXJzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjaGFyc1trXTtcbiAgICAgICAgaWYgKGMgPT09ICdvJykge1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkIHx8ICFTRVRfT1BUSU9OX05BTUVTLmhhcyhuYW1lKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgfSBlbHNlIGlmICghU0VUX0ZMQUdfTEVUVEVSUy5pbmNsdWRlcyhjKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBBIHBvc2l0aW9uYWwgcGFyYW1ldGVyIHdvcmQgXHUyMDE0IGBzZXQgZm9vYCBleGl0cyAwLlxuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEEgcXVvdGUtYXdhcmUgc2NhbiBvZiBhIGNvbnN0cnVjdCdzIHRleHQgdGhhdCB5aWVsZHMgaXRzIHdvcmRzIChxdW90ZVxuICogY29udGVudCBzdHJpcHBlZCkgd2l0aCB0aGUgcGFyZW4vYnJhY2UvY29uc3RydWN0IGRlcHRocyBhdCBlYWNoIHdvcmQsIHNvXG4gKiBgdGhlbmAvYGRvYC9gZG9uZWAvYGZpYC9gZXNhY2AvYGluYCBrZXl3b3JkcyBhcmUgcmVjb2duaXplZCBvbmx5IGF0IHRoZVxuICogbGV2ZWwgdGhhdCBvd25zIHRoZW0uXG4gKi9cbmludGVyZmFjZSBXb3JkVG9rIHtcbiAgd29yZDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbiAgZGVwdGg6IG51bWJlcjtcbiAgYnJhY2VEZXB0aDogbnVtYmVyO1xuICBjb25zdHJ1Y3REZXB0aDogbnVtYmVyO1xuICBxdW90ZWQ6IGJvb2xlYW47XG59XG5cbmNvbnN0IENPTlNUUlVDVF9PUEVORVJTID0gbmV3IFNldChbJ2lmJywgJ3doaWxlJywgJ3VudGlsJywgJ2ZvcicsICdjYXNlJywgJ3NlbGVjdCddKTtcbmNvbnN0IENPTlNUUlVDVF9DTE9TRVJTID0gbmV3IFNldChbJ2ZpJywgJ2RvbmUnLCAnZXNhYyddKTtcblxuZnVuY3Rpb24gc2NhblRva2Vucyh0ZXh0OiBzdHJpbmcpOiBXb3JkVG9rW10ge1xuICBjb25zdCB0b2tzOiBXb3JkVG9rW10gPSBbXTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIGxldCBwYXJlbkRlcHRoID0gMDtcbiAgbGV0IGJyYWNlRGVwdGggPSAwO1xuICBsZXQgY29uc3RydWN0RGVwdGggPSAwO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcgfHwgYyA9PT0gJ3snKSB7XG4gICAgICBpZiAoYyA9PT0gJygnKSBwYXJlbkRlcHRoKys7XG4gICAgICBlbHNlIGJyYWNlRGVwdGgrKztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknIHx8IGMgPT09ICd9Jykge1xuICAgICAgaWYgKGMgPT09ICcpJykgcGFyZW5EZXB0aCA9IE1hdGgubWF4KDAsIHBhcmVuRGVwdGggLSAxKTtcbiAgICAgIGVsc2UgYnJhY2VEZXB0aCA9IE1hdGgubWF4KDAsIGJyYWNlRGVwdGggLSAxKTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJzsmfDw+Jy5pbmNsdWRlcyhjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyA9PT0gbnVsbCkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGkgPSB3LmVuZDtcbiAgICB0b2tzLnB1c2goeyB3b3JkOiB3LndvcmQsIHN0YXJ0LCBlbmQ6IHcuZW5kLCBkZXB0aDogcGFyZW5EZXB0aCwgYnJhY2VEZXB0aCwgY29uc3RydWN0RGVwdGgsIHF1b3RlZDogdy5xdW90ZWQgfSk7XG4gICAgaWYgKHBhcmVuRGVwdGggPT09IDAgJiYgYnJhY2VEZXB0aCA9PT0gMCAmJiAhdy5xdW90ZWQpIHtcbiAgICAgIGlmIChDT05TVFJVQ1RfT1BFTkVSUy5oYXMody53b3JkKSkgY29uc3RydWN0RGVwdGgrKztcbiAgICAgIGVsc2UgaWYgKENPTlNUUlVDVF9DTE9TRVJTLmhhcyh3LndvcmQpKSBjb25zdHJ1Y3REZXB0aCA9IE1hdGgubWF4KDAsIGNvbnN0cnVjdERlcHRoIC0gMSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0b2tzO1xufVxuXG4vKiogUmVhZCBvbmUgd29yZCBhdCBgaWAgKHF1b3RlLWF3YXJlLCBzZXBhcmF0b3ItdGVybWluYXRlZCk7IHJldHVybnMgaXRzIGNvbnRlbnQgYW5kIHNwYW4uICovXG5mdW5jdGlvbiByZWFkV29yZEF0KHRleHQ6IHN0cmluZywgaTogbnVtYmVyKTogeyB3b3JkOiBzdHJpbmc7IGVuZDogbnVtYmVyOyBxdW90ZWQ6IGJvb2xlYW4gfSB8IG51bGwge1xuICBpZiAoaSA+PSB0ZXh0Lmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIGxldCB3b3JkID0gJyc7XG4gIGxldCBxdW90ZWQgPSBmYWxzZTtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4gJiYgIS9cXHMvLnRlc3QodGV4dFtpXSkgJiYgIScoKXt9OyZ8PD4nLmluY2x1ZGVzKHRleHRbaV0pKSB7XG4gICAgY29uc3QgY2ggPSB0ZXh0W2ldO1xuICAgIGlmIChjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBpKys7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgdGV4dFtpXSAhPT0gXCInXCIpIHtcbiAgICAgICAgd29yZCArPSB0ZXh0W2ldO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgICBpZiAoaSA8IG4pIGkrKztcbiAgICB9IGVsc2UgaWYgKGNoID09PSAnXCInKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgaSsrO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHRleHRbaV0gIT09ICdcIicpIHtcbiAgICAgICAgaWYgKHRleHRbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W2kgKyAxXSkpIHtcbiAgICAgICAgICB3b3JkICs9IHRleHRbaSArIDFdO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3b3JkICs9IHRleHRbaV07XG4gICAgICAgICAgaSsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA8IG4pIGkrKztcbiAgICB9IGVsc2UgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICB3b3JkICs9IHRleHRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB3b3JkICs9IGNoO1xuICAgICAgaSsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyB3b3JkLCBlbmQ6IGksIHF1b3RlZCB9O1xufVxuXG4vKiogVGhlIGludGVyaW9yIGJldHdlZW4gdGhlIGZpcnN0IGBvcGVuYCBjaGFyIGFuZCBpdHMgbWF0Y2hpbmcgYGNsb3NlYCwgcXVvdGVzIGF3YXJlLiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdyb3VwQm9keSh0ZXh0OiBzdHJpbmcsIG9wZW46ICd7JyB8ICcoJywgY2xvc2U6ICd9JyB8ICcpJyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBzdGFydCA9IHRleHQuaW5kZXhPZihvcGVuKTtcbiAgaWYgKHN0YXJ0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgcCA9IHN0YXJ0OyBwIDwgdGV4dC5sZW5ndGg7IHArKykge1xuICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBwICsgMSA8IHRleHQubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSBwKys7XG4gICAgICBlbHNlIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICBwKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBvcGVuKSBkZXB0aCsrO1xuICAgIGVsc2UgaWYgKGNoID09PSBjbG9zZSkge1xuICAgICAgZGVwdGgtLTtcbiAgICAgIGlmIChkZXB0aCA9PT0gMCkgcmV0dXJuIHRleHQuc2xpY2Uoc3RhcnQgKyAxLCBwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbnR5cGUgQ29uc3RydWN0S2luZCA9ICdpZicgfCAnd2hpbGUnIHwgJ3VudGlsJyB8ICdmb3InIHwgJ2Nhc2UnIHwgJ3NlbGVjdCcgfCAnYnJhY2UnIHwgJ3N1YnNoZWxsJyB8ICdkZWYnIHwgJ3BsYWluJztcblxuZnVuY3Rpb24gY2xhc3NpZnlTdGFnZSh0ZXh0OiBzdHJpbmcpOiBDb25zdHJ1Y3RLaW5kIHtcbiAgY29uc3QgdCA9IHRleHQudHJpbVN0YXJ0KCk7XG4gIGlmICh0LnN0YXJ0c1dpdGgoJ3snKSkgcmV0dXJuICdicmFjZSc7XG4gIGlmICh0LnN0YXJ0c1dpdGgoJygnKSkgcmV0dXJuICdzdWJzaGVsbCc7XG4gIGNvbnN0IGt3ID0gdC5tYXRjaCgvXihpZnx3aGlsZXx1bnRpbHxmb3J8Y2FzZXxzZWxlY3QpXFxiLyk7XG4gIGlmIChrdyAhPT0gbnVsbCkgcmV0dXJuIGt3WzFdIGFzIENvbnN0cnVjdEtpbmQ7XG4gIGlmICgvXig/OmZ1bmN0aW9uXFxzKyk/W0EtWmEtel9dW0EtWmEtejAtOV9dKlxcKFxcKVxccypcXHsvLnRlc3QodCkpIHJldHVybiAnZGVmJztcbiAgcmV0dXJuICdwbGFpbic7XG59XG5cbi8qKiBBIGZ1bmN0aW9uIGRlZmluaXRpb24ncyBuYW1lIGFuZCBib2R5IHRleHQgKGJyYWNlLWdyb3VwIGludGVyaW9yKS4gKi9cbmZ1bmN0aW9uIHBhcnNlRGVmKHRleHQ6IHN0cmluZyk6IHsgbmFtZTogc3RyaW5nOyBib2R5OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCBtID0gdGV4dC5tYXRjaCgvXig/OmZ1bmN0aW9uXFxzKyk/KFtBLVphLXpfXVtBLVphLXowLTlfXSopXFxzKig/OlxcKFxcKSk/XFxzKlxcey8pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGJvZHkgPSBleHRyYWN0R3JvdXBCb2R5KHRleHQsICd7JywgJ30nKTtcbiAgaWYgKGJvZHkgPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBuYW1lOiBtWzFdLCBib2R5IH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRJZiB7XG4gIGNvbmRpdGlvbjogc3RyaW5nO1xuICB0aGVuQm9keTogc3RyaW5nO1xuICBlbGlmczogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXTtcbiAgZWxzZUJvZHk6IHN0cmluZyB8IG51bGw7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSWYodGV4dDogc3RyaW5nKTogUGFyc2VkSWYgfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09ICdpZicpIHJldHVybiBudWxsO1xuICBjb25zdCB0aGVuSWR4ID0gdG9rcy5maW5kSW5kZXgoKHQpID0+IHQud29yZCA9PT0gJ3RoZW4nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAodGhlbklkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBjb25zdCB0aGVuVG9rID0gdG9rc1t0aGVuSWR4XTtcbiAgY29uc3QgY29uZGl0aW9uID0gdGV4dC5zbGljZSh0b2tzWzBdLmVuZCwgdGhlblRvay5zdGFydCk7XG5cbiAgY29uc3QgYm91bmRhcmllczogeyB3b3JkOiBzdHJpbmc7IHRvazogV29yZFRvayB9W10gPSBbXTtcbiAgZm9yIChsZXQgaWR4ID0gdGhlbklkeCArIDE7IGlkeCA8IHRva3MubGVuZ3RoOyBpZHgrKykge1xuICAgIGNvbnN0IHQgPSB0b2tzW2lkeF07XG4gICAgaWYgKHQuY29uc3RydWN0RGVwdGggIT09IDEgfHwgKHQud29yZCAhPT0gJ2VsaWYnICYmIHQud29yZCAhPT0gJ2Vsc2UnICYmIHQud29yZCAhPT0gJ2ZpJykpIGNvbnRpbnVlO1xuICAgIGlmICh0LndvcmQgPT09ICdlbGlmJykge1xuICAgICAgY29uc3QgZVRoZW5JZHggPSB0b2tzLmZpbmRJbmRleCgodHQsIGlpKSA9PiBpaSA+IGlkeCAmJiB0dC53b3JkID09PSAndGhlbicgJiYgdHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICAgICAgaWYgKGVUaGVuSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBib3VuZGFyaWVzLnB1c2goeyB3b3JkOiAnZWxpZicsIHRvazogdCB9LCB7IHdvcmQ6ICd0aGVuJywgdG9rOiB0b2tzW2VUaGVuSWR4XSB9KTtcbiAgICAgIGlkeCA9IGVUaGVuSWR4O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGJvdW5kYXJpZXMucHVzaCh7IHdvcmQ6IHQud29yZCwgdG9rOiB0IH0pO1xuICAgIGlmICh0LndvcmQgPT09ICdlbHNlJykge1xuICAgICAgY29uc3QgZmlJZHggPSB0b2tzLmZpbmRJbmRleCgodHQsIGlpKSA9PiBpaSA+IGlkeCAmJiB0dC53b3JkID09PSAnZmknICYmIHR0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgICAgIGlmIChmaUlkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgYm91bmRhcmllcy5wdXNoKHsgd29yZDogJ2ZpJywgdG9rOiB0b2tzW2ZpSWR4XSB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBicmVhaztcbiAgfVxuICBpZiAoYm91bmRhcmllcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRoZW5Cb2R5ID0gdGV4dC5zbGljZSh0aGVuVG9rLmVuZCwgYm91bmRhcmllc1swXS50b2suc3RhcnQpO1xuICBjb25zdCBlbGlmczogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXSA9IFtdO1xuICBsZXQgZWxzZUJvZHk6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBiID0gMDsgYiA8IGJvdW5kYXJpZXMubGVuZ3RoOyBiKyspIHtcbiAgICBjb25zdCB7IHdvcmQsIHRvayB9ID0gYm91bmRhcmllc1tiXTtcbiAgICBpZiAod29yZCA9PT0gJ2VsaWYnKSB7XG4gICAgICBjb25zdCBlVGhlbiA9IGJvdW5kYXJpZXNbYiArIDFdO1xuICAgICAgaWYgKGVUaGVuID09PSB1bmRlZmluZWQgfHwgZVRoZW4ud29yZCAhPT0gJ3RoZW4nKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IG5leHRTdGFydCA9IGJvdW5kYXJpZXNbYiArIDJdPy50b2suc3RhcnQgPz8gdGV4dC5sZW5ndGg7XG4gICAgICBlbGlmcy5wdXNoKHsgY29uZGl0aW9uOiB0ZXh0LnNsaWNlKHRvay5lbmQsIGVUaGVuLnRvay5zdGFydCksIGJvZHk6IHRleHQuc2xpY2UoZVRoZW4udG9rLmVuZCwgbmV4dFN0YXJ0KSB9KTtcbiAgICAgIGIrKztcbiAgICB9IGVsc2UgaWYgKHdvcmQgPT09ICdlbHNlJykge1xuICAgICAgY29uc3QgZmkgPSBib3VuZGFyaWVzW2IgKyAxXTtcbiAgICAgIGlmIChmaSA9PT0gdW5kZWZpbmVkIHx8IGZpLndvcmQgIT09ICdmaScpIHJldHVybiBudWxsO1xuICAgICAgZWxzZUJvZHkgPSB0ZXh0LnNsaWNlKHRvay5lbmQsIGZpLnRvay5zdGFydCk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgY29uZGl0aW9uLCB0aGVuQm9keSwgZWxpZnMsIGVsc2VCb2R5IH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlTG9vcCh0ZXh0OiBzdHJpbmcsIGtleXdvcmQ6ICd3aGlsZScgfCAndW50aWwnKTogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09IGtleXdvcmQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb1RvayA9IHRva3MuZmluZCgodCkgPT4gdC53b3JkID09PSAnZG8nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9Ub2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvbmVUb2sgPSB0b2tzLmZpbmQoKHQpID0+IHQuc3RhcnQgPiBkb1Rvay5lbmQgJiYgdC53b3JkID09PSAnZG9uZScgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb25lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBjb25kaXRpb246IHRleHQuc2xpY2UodG9rc1swXS5lbmQsIGRvVG9rLnN0YXJ0KSwgYm9keTogdGV4dC5zbGljZShkb1Rvay5lbmQsIGRvbmVUb2suc3RhcnQpIH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRGb3Ige1xuICBsaXN0OiBzdHJpbmdbXSB8IG51bGw7XG4gIGJvZHk6IHN0cmluZztcbiAgd2hvbGVJbnRlcmlvcjogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBwYXJzZUZvcih0ZXh0OiBzdHJpbmcpOiBQYXJzZWRGb3IgfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09ICdmb3InKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbmFtZVRvayA9IHRva3NbMV07XG4gIGlmIChuYW1lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb1RvayA9IHRva3MuZmluZCgodCkgPT4gdC53b3JkID09PSAnZG8nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEgJiYgdC5zdGFydCA+IG5hbWVUb2suZW5kKTtcbiAgaWYgKGRvVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb25lVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LnN0YXJ0ID4gZG9Ub2suZW5kICYmIHQud29yZCA9PT0gJ2RvbmUnICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9uZVRvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW5Ub2sgPSB0b2tzLmZpbmQoXG4gICAgKHQpID0+IHQuc3RhcnQgPiBuYW1lVG9rLmVuZCAmJiB0LnN0YXJ0IDwgZG9Ub2suc3RhcnQgJiYgdC53b3JkID09PSAnaW4nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDFcbiAgKTtcbiAgbGV0IGxpc3Q6IHN0cmluZ1tdIHwgbnVsbCA9IG51bGw7XG4gIGlmIChpblRvayAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbGlzdCA9IHRva3MuZmlsdGVyKCh0KSA9PiB0LnN0YXJ0ID4gaW5Ub2suZW5kICYmIHQuc3RhcnQgPCBkb1Rvay5zdGFydCkubWFwKCh0KSA9PiB0LndvcmQpO1xuICB9XG4gIHJldHVybiB7IGxpc3QsIGJvZHk6IHRleHQuc2xpY2UoZG9Ub2suZW5kLCBkb25lVG9rLnN0YXJ0KSwgd2hvbGVJbnRlcmlvcjogdGV4dC5zbGljZShuYW1lVG9rLmVuZCwgZG9uZVRvay5zdGFydCkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZENhc2Uge1xuICBzdWJqZWN0OiBzdHJpbmc7XG4gIGJyYW5jaGVzOiB7IHBhdHRlcm46IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXTtcbiAgZmFsbHRocm91Z2g6IGJvb2xlYW47XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ2FzZSh0ZXh0OiBzdHJpbmcpOiBQYXJzZWRDYXNlIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICBjb25zdCBza2lwV3MgPSAoKSA9PiB7XG4gICAgd2hpbGUgKGkgPCBuICYmIC9cXHMvLnRlc3QodGV4dFtpXSkpIGkrKztcbiAgfTtcbiAgc2tpcFdzKCk7XG4gIGNvbnN0IGxlYWQgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICBpZiAobGVhZCA9PT0gbnVsbCB8fCBsZWFkLndvcmQgIT09ICdjYXNlJykgcmV0dXJuIG51bGw7XG4gIGkgPSBsZWFkLmVuZDtcblxuICAvLyBUaGUgc3ViamVjdCB3b3JkcyB1cCB0byB0aGUgYGluYCBhdCBwYXJlbiBkZXB0aCAwIChxdW90ZSBjb250ZW50IG9ubHkpLlxuICBsZXQgcGFyZW5EZXB0aCA9IDA7XG4gIGNvbnN0IHN1YmplY3RXb3Jkczogc3RyaW5nW10gPSBbXTtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgc2tpcFdzKCk7XG4gICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgYyA9IHRleHRbaV07XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgcGFyZW5EZXB0aCsrO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIHBhcmVuRGVwdGggPSBNYXRoLm1heCgwLCBwYXJlbkRlcHRoIC0gMSk7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCc7Jnw8PicuaW5jbHVkZXMoYykpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyA9PT0gbnVsbCkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGkgPSB3LmVuZDtcbiAgICBpZiAocGFyZW5EZXB0aCA9PT0gMCAmJiAhdy5xdW90ZWQgJiYgdy53b3JkID09PSAnaW4nKSBicmVhaztcbiAgICBzdWJqZWN0V29yZHMucHVzaCh3LndvcmQpO1xuICB9XG4gIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGJyYW5jaGVzOiB7IHBhdHRlcm46IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXSA9IFtdO1xuICBsZXQgZmFsbHRocm91Z2ggPSBmYWxzZTtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBza2lwV3MoKTtcbiAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyAhPT0gbnVsbCAmJiAhdy5xdW90ZWQgJiYgdy53b3JkID09PSAnZXNhYycpIHtcbiAgICAgIHJldHVybiB7IHN1YmplY3Q6IHN1YmplY3RXb3Jkcy5qb2luKCcgJyksIGJyYW5jaGVzLCBmYWxsdGhyb3VnaCB9O1xuICAgIH1cbiAgICAvLyBUaGUgcGF0dGVybjogZXZlcnl0aGluZyB1cCB0byB0aGUgYClgIGF0IHBhcmVuIGRlcHRoIDAuXG4gICAgbGV0IHBhdEVuZCA9IC0xO1xuICAgIHtcbiAgICAgIGxldCBwID0gaTtcbiAgICAgIGxldCBkZXB0aCA9IDA7XG4gICAgICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICB3aGlsZSAocCA8IG4pIHtcbiAgICAgICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgICAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgcCArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSB7XG4gICAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKCcpIHtcbiAgICAgICAgICBkZXB0aCsrO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcpJykge1xuICAgICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgICAgcGF0RW5kID0gcDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZXB0aC0tO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBwKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwYXRFbmQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXR0ZXJuID0gdGV4dC5zbGljZShpLCBwYXRFbmQpLnRyaW0oKTtcbiAgICBpID0gcGF0RW5kICsgMTtcblxuICAgIC8vIFRoZSBib2R5OiBldmVyeXRoaW5nIHVwIHRvIHRoZSBgOztgL2A7JmAvYDs7JmAgYXQgcGFyZW4vYnJhY2UgZGVwdGggMC5cbiAgICBsZXQgYm9keUVuZCA9IC0xO1xuICAgIGxldCB0ZXJtID0gJyc7XG4gICAge1xuICAgICAgbGV0IHAgPSBpO1xuICAgICAgbGV0IGRlcHRoID0gMDtcbiAgICAgIGxldCBiZGVwdGggPSAwO1xuICAgICAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgd2hpbGUgKHAgPCBuKSB7XG4gICAgICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICAgICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIHAgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbcCArIDFdKSkge1xuICAgICAgICAgICAgcCArPSAyO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgICAgICBpblF1b3RlID0gY2g7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICAgICAgcCArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJygnKSB7XG4gICAgICAgICAgZGVwdGgrKztcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKScpIHtcbiAgICAgICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ3snKSB7XG4gICAgICAgICAgYmRlcHRoKys7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ30nKSB7XG4gICAgICAgICAgYmRlcHRoID0gTWF0aC5tYXgoMCwgYmRlcHRoIC0gMSk7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCAmJiBiZGVwdGggPT09IDAgJiYgY2ggPT09ICc7Jykge1xuICAgICAgICAgIGNvbnN0IG5leHQgPSB0ZXh0W3AgKyAxXTtcbiAgICAgICAgICBpZiAobmV4dCA9PT0gJzsnIHx8IG5leHQgPT09ICcmJykge1xuICAgICAgICAgICAgdGVybSA9IG5leHQgPT09ICc7JyA/ICh0ZXh0W3AgKyAyXSA9PT0gJyYnID8gJzs7JicgOiAnOzsnKSA6ICc7Jic7XG4gICAgICAgICAgICBib2R5RW5kID0gcDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBwKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0ZXJtID09PSAnJykgcmV0dXJuIG51bGw7XG4gICAgYnJhbmNoZXMucHVzaCh7IHBhdHRlcm4sIGJvZHk6IHRleHQuc2xpY2UoaSwgYm9keUVuZCkudHJpbSgpIH0pO1xuICAgIGkgPSBib2R5RW5kICsgdGVybS5sZW5ndGg7XG4gICAgaWYgKHRlcm0gPT09ICc7JicgfHwgdGVybSA9PT0gJzs7JicpIGZhbGx0aHJvdWdoID0gdHJ1ZTtcbiAgfVxufVxuXG4vKiogUmVzb2x2ZSBhIGBjYXNlYCBzdWJqZWN0IGFnYWluc3QgdGhlIHJlY29yZGVkIGFzc2lnbm1lbnRzIChwbGFuIFx1MDBBNzEsIGRlY2lkYWJsZSBjYXNlKS4gKi9cbmZ1bmN0aW9uIHJlc29sdmVTdWJqZWN0KHN1YmplY3Q6IHN0cmluZywgYXNzaWdubWVudHM6IE1hcDxzdHJpbmcsIHN0cmluZz4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbSA9IHN1YmplY3QubWF0Y2goL15cXCQoW0EtWmEtel9dW0EtWmEtejAtOV9dKikkLykgPz8gc3ViamVjdC5tYXRjaCgvXlxcJFxceyhbQS1aYS16X11bQS1aYS16MC05X10qKVxcfSQvKTtcbiAgaWYgKG0gIT09IG51bGwpIHtcbiAgICBjb25zdCB2ID0gYXNzaWdubWVudHMuZ2V0KG1bMV0pO1xuICAgIHJldHVybiB2ICE9PSB1bmRlZmluZWQgPyB2IDogbnVsbDtcbiAgfVxuICBpZiAoL1skYF0vLnRlc3Qoc3ViamVjdCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc3ViamVjdDtcbn1cblxuLyoqXG4gKiBBbHRlcm5hdGl2ZSBzcGxpdCBvZiBhIGBjYXNlYCBwYXR0ZXJuIG9uIHVucXVvdGVkIGB8YC4gVGhlIGFsdGVybmF0aXZlcyBhcmVcbiAqIHJldHVybmVkIHZlcmJhdGltIFx1MjAxNCBxdW90ZXMgYW5kIGJhY2tzbGFzaCBlc2NhcGVzIHByZXNlcnZlZCBcdTIwMTQgc29cbiAqIGBhbmFseXplUGF0dGVybmAncyBxdW90ZSBoYW5kbGluZyBpcyB0aGUgc2luZ2xlIGludGVycHJldGVyOiBzdHJpcHBpbmcgdGhlbVxuICogaGVyZSB3b3VsZCB0dXJuIGAnYSonYCBpbnRvIGFuIHVucXVvdGVkIGdsb2IgYW5kIGBcXHxgIGludG8gYSBzcGxpdCBwb2ludC5cbiAqL1xuZnVuY3Rpb24gc3BsaXRQYXR0ZXJuQWx0ZXJuYXRpdmVzKHBhdHRlcm46IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXIgPSAnJztcbiAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhdHRlcm4ubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHBhdHRlcm5baV07XG4gICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHBhdHRlcm5baSArIDFdKSkge1xuICAgICAgICBjdXIgKz0gY2g7XG4gICAgICAgIGN1ciArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkge1xuICAgICAgICBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgY3VyICs9IGNoO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGN1ciArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjdXIgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCkge1xuICAgICAgY3VyICs9IGNoO1xuICAgICAgY3VyICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ3wnKSB7XG4gICAgICBwYXJ0cy5wdXNoKGN1cik7XG4gICAgICBjdXIgPSAnJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXIgKz0gY2g7XG4gIH1cbiAgcGFydHMucHVzaChjdXIpO1xuICByZXR1cm4gcGFydHM7XG59XG5cbi8qKlxuICogUXVvdGUtYXdhcmUgcGF0dGVybiBhbmFseXNpczogdGhlIGxpdGVyYWwgdmFsdWUgKHF1b3RlcyBzdHJpcHBlZCwgYmFja3NsYXNoXG4gKiBlc2NhcGVzIHJlc29sdmVkKSBhbmQgd2hldGhlciBhbnkgdW5xdW90ZWQgZ2xvYiBjaGFyIGFwcGVhcnMuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IHsgbGl0ZXJhbDogc3RyaW5nOyBnbG9iOiBib29sZWFuIH0ge1xuICBsZXQgbGl0ZXJhbCA9ICcnO1xuICBsZXQgZ2xvYiA9IGZhbHNlO1xuICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGF0dGVybi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gcGF0dGVybltpXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXMocGF0dGVybltpICsgMV0pKSB7XG4gICAgICAgIGxpdGVyYWwgKz0gcGF0dGVybltpICsgMV07XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY2ggPT09IGluUXVvdGUpIHtcbiAgICAgICAgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGl0ZXJhbCArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCkge1xuICAgICAgbGl0ZXJhbCArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJyo/WycuaW5jbHVkZXMoY2gpKSB7XG4gICAgICBnbG9iID0gdHJ1ZTtcbiAgICAgIGxpdGVyYWwgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgbGl0ZXJhbCArPSBjaDtcbiAgfVxuICByZXR1cm4geyBsaXRlcmFsLCBnbG9iIH07XG59XG5cbnR5cGUgUGF0dGVyblJlc3VsdCA9ICdtYXRjaCcgfCAnbm8tbWF0Y2gnIHwgJ2dsb2InIHwgJ3VuZGVjaWRhYmxlJztcblxuLyoqXG4gKiBGaXh0dXJlLXBpbm5lZCBgY2FzZWAgcGF0dGVybiBldmFsdWF0aW9uIChwbGFuIFx1MDBBNzEsIGRlY2lkYWJsZSBjYXNlKTogYSBgfGBcbiAqIHBhdHRlcm4gaXMgZGVjaWRhYmxlIGlmZiBpdHMgZmlyc3QgYWx0ZXJuYXRpdmUgaXMgYSBsaXRlcmFsIG1hdGNoIGFuZCBldmVyeVxuICogYWx0ZXJuYXRpdmUgYWZ0ZXIgdGhlIGZpcnN0IGlzIGEgZ2xvYiAoZGVhZCk7IGEgZ2xvYiBiZWZvcmUgYW55IGxpdGVyYWxcbiAqIG1hdGNoIGlzIHVuZGVjaWRhYmxlLCBhbmQgYSBsYXRlciBsaXRlcmFsIG5vbi1tYXRjaCBhZnRlciBhIGxpdGVyYWwgbWF0Y2hcbiAqIGlzIHVuZGVjaWRhYmxlICh0aGUgYWxsLWxpdGVyYWwgYGF8YmAgZmFpbC1jbG9zZWQgZGl2ZXJnZW5jZSBcdTIwMTQgYmFzaCBydW5zXG4gKiB0aGUgYnJhbmNoKS5cbiAqL1xuZnVuY3Rpb24gZXZhbFBhdHRlcm4ocGF0dGVybjogc3RyaW5nLCBzdWJqZWN0OiBzdHJpbmcpOiBQYXR0ZXJuUmVzdWx0IHtcbiAgY29uc3QgYWx0cyA9IHNwbGl0UGF0dGVybkFsdGVybmF0aXZlcyhwYXR0ZXJuKTtcbiAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBhbHQgb2YgYWx0cykge1xuICAgIGNvbnN0IHsgbGl0ZXJhbCwgZ2xvYiB9ID0gYW5hbHl6ZVBhdHRlcm4oYWx0KTtcbiAgICBpZiAoZ2xvYikge1xuICAgICAgaWYgKCFtYXRjaGVkKSByZXR1cm4gJ2dsb2InO1xuICAgIH0gZWxzZSBpZiAobGl0ZXJhbCA9PT0gc3ViamVjdCkge1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSBlbHNlIGlmIChtYXRjaGVkKSB7XG4gICAgICByZXR1cm4gJ3VuZGVjaWRhYmxlJztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1hdGNoZWQgPyAnbWF0Y2gnIDogJ25vLW1hdGNoJztcbn1cblxuLyoqIFRoZSBleGVjdXRpb24gd2FsaydzIHNoYXJlZCBzdGF0ZSwgb25lIGluc3RhbmNlIHBlciBgcGFyc2VDb21tYW5kRGV0YWlsZWRgIGNhbGwuICovXG5jbGFzcyBFeGVjdXRpb25XYWxrZXIge1xuICBjaGFpbjogQ2hhaW5TdGF0dXMgPSAnc3VjY2Vzcyc7XG4gIGVycmV4aXQgPSBmYWxzZTtcbiAgcGlwZWZhaWwgPSBmYWxzZTtcbiAgYXNzaWdubWVudHMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBkZWZzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZGVhZDogRGVhZEtpbmQgfCBudWxsID0gbnVsbDtcbiAgcmV0dXJuZWQgPSBmYWxzZTtcbiAgZm5EZXB0aCA9IDA7XG4gIGxvb3BTdGFjazogTG9vcEZyYW1lW10gPSBbXTtcbiAgcmVhZG9ubHkgZXhwYW5kZWQ6IEV4cGFuZGVkU3RhZ2VbXSA9IFtdO1xuICByZWFkb25seSB2ZXJkaWN0czogRXhlY1N0YXR1c1tdID0gW107XG4gIGRpckZyYW1lID0gMDtcbiAgcmVhZG9ubHkgZGVmUHJvYmVTdGFjayA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIHdhbGtJbnB1dChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSk6IEV4cGFuZGVkU3RhZ2VbXSB7XG4gICAgdGhpcy53YWxrTGlzdChzdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IGZhbHNlLCBzaWRlRWZmZWN0czogdHJ1ZSwgaW5wdXRGYWNpbmc6IHRydWUgfSk7XG4gICAgcmV0dXJuIHRoaXMuZXhwYW5kZWQ7XG4gIH1cblxuICBwcml2YXRlIHN0b3BwZWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKHRoaXMuZGVhZCAhPT0gbnVsbCB8fCB0aGlzLnJldHVybmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB0b3AgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICByZXR1cm4gdG9wICE9PSB1bmRlZmluZWQgJiYgKHRvcC5ib2R5VGVybWluYXRlZCB8fCB0b3AuYW1iaWd1b3VzU3RvcCk7XG4gIH1cblxuICAvKiogV2FsayBvbmUgbGlzdCAoYSBmcmVzaCBgJiZgL2B8fGAgY2hhaW4pOyByZXR1cm5zIHRoZSBsaXN0J3MgZmluYWwgY2hhaW4gc3RhdHVzLiAqL1xuICBwcml2YXRlIHdhbGtMaXN0KHN0YWdlczogU2ltcGxlQ29tbWFuZFtdLCBvcHRzOiBXYWxrT3B0aW9ucyk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBzYXZlZENoYWluID0gdGhpcy5jaGFpbjtcbiAgICB0aGlzLmNoYWluID0gJ3N1Y2Nlc3MnO1xuICAgIGxldCBpID0gMDtcbiAgICB3aGlsZSAoaSA8IHN0YWdlcy5sZW5ndGggJiYgIXRoaXMuc3RvcHBlZCgpKSB7XG4gICAgICBjb25zdCBlbmQgPSB0aGlzLmdyb3VwRW5kKHN0YWdlcywgaSk7XG4gICAgICBjb25zdCBuZXh0ID0gZW5kIDwgc3RhZ2VzLmxlbmd0aCA/IHN0YWdlc1tlbmRdIDogbnVsbDtcbiAgICAgIHRoaXMucHJvY2Vzc0dyb3VwKHN0YWdlcy5zbGljZShpLCBlbmQpLCBuZXh0LCBvcHRzKTtcbiAgICAgIGkgPSBlbmQ7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuY2hhaW47XG4gICAgd2hpbGUgKGkgPCBzdGFnZXMubGVuZ3RoKSB7XG4gICAgICBpZiAob3B0cy5pbnB1dEZhY2luZykgdGhpcy52ZXJkaWN0cy5wdXNoKCdubycpO1xuICAgICAgaSsrO1xuICAgIH1cbiAgICB0aGlzLmNoYWluID0gc2F2ZWRDaGFpbjtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBncm91cEVuZChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gICAgbGV0IGVuZCA9IHN0YXJ0O1xuICAgIHdoaWxlIChlbmQgKyAxIDwgc3RhZ2VzLmxlbmd0aCAmJiBzdGFnZXNbZW5kICsgMV0ucHJlY2VkZWRCeSA9PT0gJ3BpcGUnKSBlbmQrKztcbiAgICByZXR1cm4gZW5kICsgMTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc0dyb3VwKGdyb3VwOiBTaW1wbGVDb21tYW5kW10sIG5leHQ6IFNpbXBsZUNvbW1hbmQgfCBudWxsLCBvcHRzOiBXYWxrT3B0aW9ucyk6IHZvaWQge1xuICAgIGNvbnN0IGZpcnN0ID0gZ3JvdXBbMF07XG4gICAgbGV0IGV4ZWN1dGVzOiBib29sZWFuIHwgJ3Vua25vd24nO1xuICAgIHN3aXRjaCAoZmlyc3QucHJlY2VkZWRCeSkge1xuICAgICAgY2FzZSAnYW5kJzpcbiAgICAgICAgZXhlY3V0ZXMgPSB0aGlzLmNoYWluID09PSAnc3VjY2VzcycgPyB0cnVlIDogdGhpcy5jaGFpbiA9PT0gJ2ZhaWx1cmUnID8gZmFsc2UgOiAndW5rbm93bic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnb3InOlxuICAgICAgICBleGVjdXRlcyA9IHRoaXMuY2hhaW4gPT09ICdmYWlsdXJlJyA/IHRydWUgOiB0aGlzLmNoYWluID09PSAnc3VjY2VzcycgPyBmYWxzZSA6ICd1bmtub3duJztcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBleGVjdXRlcyA9IHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGV4ZWM6IEV4ZWNTdGF0dXMgPSBleGVjdXRlcyA9PT0gdHJ1ZSA/ICd5ZXMnIDogZXhlY3V0ZXMgPT09IGZhbHNlID8gJ25vJyA6ICd1bmtub3duJztcbiAgICBjb25zdCBiYWNrZ3JvdW5kZWQgPSBmaXJzdC5wcmVjZWRlZEJ5ID09PSAnYmFja2dyb3VuZCcgfHwgKG5leHQgIT09IG51bGwgJiYgbmV4dC5wcmVjZWRlZEJ5ID09PSAnYmFja2dyb3VuZCcpO1xuICAgIGlmIChvcHRzLmlucHV0RmFjaW5nKSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSsrKSB0aGlzLnZlcmRpY3RzLnB1c2goZXhlYyk7XG4gICAgfVxuXG4gICAgLy8gYCFgIGlzIGEgZ3JvdXAtbGV2ZWwgbW9kaWZpZXI6IHRoZSBjb3VudCBvZiBsZWFkaW5nIGAhYCB3b3JkcyBvbiB0aGVcbiAgICAvLyBmaXJzdCBtZW1iZXIncyBhcmd2IG5lZ2F0ZXMgdGhlIGdyb3VwJ3MgZmluYWwgc3RhdHVzIChvZGQgbmVnYXRlcykuXG4gICAgY29uc3QgZmlyc3RBcmd2ID0gYXJndk9mKGZpcnN0LnRleHQpO1xuICAgIGxldCBiYW5nQ291bnQgPSAwO1xuICAgIGxldCBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGwgPSBmaXJzdEFyZ3Y7XG4gICAgaWYgKGZpcnN0QXJndiAhPT0gbnVsbCkge1xuICAgICAgd2hpbGUgKG1lbWJlckFyZ3YhW2JhbmdDb3VudF0gPT09ICchJykgYmFuZ0NvdW50Kys7XG4gICAgICBtZW1iZXJBcmd2ID0gbWVtYmVyQXJndiEuc2xpY2UoYmFuZ0NvdW50KTtcbiAgICB9XG4gICAgY29uc3QgaW52ZXJ0ZWQgPSBiYW5nQ291bnQgJSAyID09PSAxO1xuXG4gICAgaWYgKGV4ZWMgPT09ICdubycpIHJldHVybjtcblxuICAgIGNvbnN0IHN0YXR1c2VzOiBDaGFpblN0YXR1c1tdID0gW107XG4gICAgY29uc3QgaW5QaXBlbGluZSA9IGdyb3VwLmxlbmd0aCA+IDE7XG4gICAgZm9yIChsZXQgbSA9IDA7IG0gPCBncm91cC5sZW5ndGg7IG0rKykge1xuICAgICAgc3RhdHVzZXMucHVzaChcbiAgICAgICAgdGhpcy5wcm9jZXNzTWVtYmVyKGdyb3VwW21dLCB7XG4gICAgICAgICAgZXhlYyxcbiAgICAgICAgICBpblBpcGVsaW5lLFxuICAgICAgICAgIGJhY2tncm91bmRlZCxcbiAgICAgICAgICBtZW1iZXJBcmd2OiBtID09PSAwID8gbWVtYmVyQXJndiA6IG51bGwsXG4gICAgICAgICAgb3B0c1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBUaGUgZ3JvdXAgc3RhdHVzOiB0aGUgbGFzdCBtZW1iZXIncywgdW5sZXNzIHBpcGVmYWlsIG1ha2VzIGl0IHRoZSB3b3JzdCBtZW1iZXIuXG4gICAgbGV0IGdyb3VwU3RhdHVzOiBDaGFpblN0YXR1cztcbiAgICBpZiAodGhpcy5waXBlZmFpbCAmJiBncm91cC5sZW5ndGggPiAxKSB7XG4gICAgICBpZiAoc3RhdHVzZXMuZXZlcnkoKHMpID0+IHMgPT09ICdzdWNjZXNzJykpIGdyb3VwU3RhdHVzID0gJ3N1Y2Nlc3MnO1xuICAgICAgZWxzZSBpZiAoc3RhdHVzZXMuc29tZSgocykgPT4gcyA9PT0gJ2ZhaWx1cmUnKSkgZ3JvdXBTdGF0dXMgPSAnZmFpbHVyZSc7XG4gICAgICBlbHNlIGdyb3VwU3RhdHVzID0gJ3Vua25vd24nO1xuICAgIH0gZWxzZSB7XG4gICAgICBncm91cFN0YXR1cyA9IHN0YXR1c2VzW3N0YXR1c2VzLmxlbmd0aCAtIDFdO1xuICAgIH1cbiAgICBpZiAoaW52ZXJ0ZWQpIHtcbiAgICAgIGdyb3VwU3RhdHVzID0gZ3JvdXBTdGF0dXMgPT09ICdzdWNjZXNzJyA/ICdmYWlsdXJlJyA6IGdyb3VwU3RhdHVzID09PSAnZmFpbHVyZScgPyAnc3VjY2VzcycgOiAndW5rbm93bic7XG4gICAgfVxuXG4gICAgLy8gRXJyZXhpdCBsaXZlbmVzczogYW4gZXhlY3V0aW5nIGdyb3VwIHdob3NlIG5vbi1leGVtcHQgbWVtYmVycyBkaWQgbm90XG4gICAgLy8gYWxsIHN1Y2NlZWQga2lsbHMgdGhlIHNoZWxsOyBldmVyeSBsYXRlciBzdGFnZSBpcyAnbm8nLlxuICAgIGlmIChvcHRzLmxpdmVuZXNzICYmIHRoaXMuZXJyZXhpdCAmJiBncm91cFN0YXR1cyAhPT0gJ3N1Y2Nlc3MnKSB7XG4gICAgICBjb25zdCBjaGFpbkZpbmFsID0gbmV4dCA9PT0gbnVsbCB8fCAobmV4dC5wcmVjZWRlZEJ5ICE9PSAnYW5kJyAmJiBuZXh0LnByZWNlZGVkQnkgIT09ICdvcicpO1xuICAgICAgaWYgKGNoYWluRmluYWwgJiYgIWludmVydGVkICYmICFiYWNrZ3JvdW5kZWQpIHRoaXMuZGVhZCA9ICdlcnJleGl0JztcbiAgICB9XG5cbiAgICBpZiAoZXhlYyA9PT0gJ3llcycpIHRoaXMuY2hhaW4gPSBncm91cFN0YXR1cztcbiAgICBlbHNlIHRoaXMuY2hhaW4gPSAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NNZW1iZXIoXG4gICAgbWVtYmVyOiBTaW1wbGVDb21tYW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBraW5kID0gY2xhc3NpZnlTdGFnZShtZW1iZXIudGV4dCk7XG4gICAgaWYgKGtpbmQgPT09ICdwbGFpbicpIHJldHVybiB0aGlzLnByb2Nlc3NQbGFpbk1lbWJlcihtZW1iZXIsIGN0eCk7XG4gICAgcmV0dXJuIHRoaXMucHJvY2Vzc0NvbnN0cnVjdChtZW1iZXIsIGtpbmQsIGN0eCk7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NQbGFpbk1lbWJlcihcbiAgICBtZW1iZXI6IFNpbXBsZUNvbW1hbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHsgZXhlYywgaW5QaXBlbGluZSwgYmFja2dyb3VuZGVkLCBtZW1iZXJBcmd2LCBvcHRzIH0gPSBjdHg7XG4gICAgY29uc3QgYXJndiA9IG1lbWJlckFyZ3YgPz8gYXJndk9mKG1lbWJlci50ZXh0KTtcbiAgICBjb25zdCBzdHJpcHBlZCA9IGFyZ3YgPT09IG51bGwgPyBudWxsIDogd2Fsa1N0cmlwKGFyZ3YpO1xuXG4gICAgLy8gU2lkZSBlZmZlY3RzIG9ubHkgZnJvbSBleGVjdXRlZCwgbm9uLXBpcGUgc3RhZ2VzLlxuICAgIGlmIChleGVjID09PSAneWVzJyAmJiAhaW5QaXBlbGluZSAmJiBvcHRzLnNpZGVFZmZlY3RzKSB7XG4gICAgICB0aGlzLmFwcGx5U2lkZUVmZmVjdHMobWVtYmVyLCBhcmd2LCBzdHJpcHBlZCk7XG4gICAgfVxuXG4gICAgLy8gVGhlIGtub3duIHN0YXR1cy5cbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmtub3duU3RhdHVzKGFyZ3YpO1xuXG4gICAgLy8gVGhlIHRlcm1pbmF0b3I6IGFuIGV4ZWN1dGVkIG9yIHVua25vd24tZXhlY3V0aW9uIG5vbi1waXBlIHN0YWdlIHdob3NlXG4gICAgLy8gdGVybWluYXRvciB3b3JkIChiYXJlLCBvciBiZWhpbmQgYGNvbW1hbmRgL2BidWlsdGluYCkgaXMgYGV4aXRgL2BleGVjYC5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiAoc3RyaXBwZWRbMF0gPT09ICdleGl0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ2V4ZWMnKSkge1xuICAgICAgdGhpcy5kZWFkID0gJ2V4aXQnO1xuICAgIH1cblxuICAgIC8vIFJldHVybi1zdG9wcGluZzogYSBwcm92YWJseS1maXJpbmcgY29tbWFuZC1wb3NpdGlvbiBgcmV0dXJuYCBhdFxuICAgIC8vIGZ1bmN0aW9uLWJvZHkgZGVwdGggZXhpdHMgdGhlIGZ1bmN0aW9uIFx1MjAxNCBldmVyeXRoaW5nIGFmdGVyIG5ldmVyIHJ1bnMuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgPT09ICd5ZXMnICYmIHRoaXMuZm5EZXB0aCA+IDAgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICdyZXR1cm4nKSB7XG4gICAgICB0aGlzLnJldHVybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHRvcCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgaWYgKHRvcCAhPT0gdW5kZWZpbmVkKSB0b3Aub3V0Y29tZSA9ICdyZXR1cm4nO1xuICAgIH1cblxuICAgIC8vIEJyZWFrL2NvbnRpbnVlIGV2ZW50cyAoYSBoaWRkZW4gYCd1bmtub3duJ2AtZXhlYyBvbmUgbWFrZXMgdGhlIGd1YXJkXG4gICAgLy8gdW50b3VjaGFibGUgXHUyMDE0IGFtYmlndW91cyBcdTIwMTQgcGVyIHRoZSBsb29wLXNjYW4gZGlzY2lwbGluZSkuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgIT09ICdubycgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgKHN0cmlwcGVkWzBdID09PSAnYnJlYWsnIHx8IHN0cmlwcGVkWzBdID09PSAnY29udGludWUnKSkge1xuICAgICAgdGhpcy5hcHBseUJyZWFrQ29udGludWUoc3RyaXBwZWQsIGV4ZWMpO1xuICAgIH1cblxuICAgIC8vIEEgY2FsbCB0byBhIHJlZ2lzdGVyZWQgZGVmaW5pdGlvbi5cbiAgICBpZiAoZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZC5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFwcGx5Q2FsbChzdHJpcHBlZFswXSwgaW5QaXBlbGluZSwgYmFja2dyb3VuZGVkKTtcbiAgICB9XG5cbiAgICBpZiAoIW9wdHMuZGlzY2FyZCkge1xuICAgICAgdGhpcy5leHBhbmRlZC5wdXNoKHtcbiAgICAgICAgdGV4dDogbWVtYmVyLnRleHQsXG4gICAgICAgIHByZWNlZGVkQnk6IG1lbWJlci5wcmVjZWRlZEJ5LFxuICAgICAgICBleGVjLFxuICAgICAgICBpblBpcGVsaW5lLFxuICAgICAgICBkaXJGcmFtZTogdGhpcy5kaXJGcmFtZSxcbiAgICAgICAgYXNzaWdubWVudHM6IG5ldyBNYXAodGhpcy5hc3NpZ25tZW50cylcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUJyZWFrQ29udGludWUoc3RyaXBwZWQ6IHN0cmluZ1tdLCBleGVjOiBFeGVjU3RhdHVzKTogdm9pZCB7XG4gICAgY29uc3QgZGVwdGggPSBOdW1iZXIucGFyc2VJbnQoc3RyaXBwZWRbMV0gPz8gJzEnLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkZXB0aCkgfHwgZGVwdGggPCAxKSByZXR1cm47XG4gICAgaWYgKHRoaXMubG9vcFN0YWNrLmxlbmd0aCA9PT0gMCB8fCBkZXB0aCA+IHRoaXMubG9vcFN0YWNrLmxlbmd0aCkgcmV0dXJuO1xuICAgIGlmIChleGVjID09PSAndW5rbm93bicpIHtcbiAgICAgIGZvciAobGV0IGQgPSAwOyBkIDwgZGVwdGg7IGQrKykge1xuICAgICAgICBjb25zdCBmcmFtZSA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDEgLSBkXTtcbiAgICAgICAgaWYgKGZyYW1lLm91dGNvbWUgPT09ICdub25lJykge1xuICAgICAgICAgIGZyYW1lLm91dGNvbWUgPSAnYW1iaWd1b3VzJztcbiAgICAgICAgICBmcmFtZS5hbWJpZ3VvdXNTdG9wID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBpc0NvbnRpbnVlID0gc3RyaXBwZWRbMF0gPT09ICdjb250aW51ZSc7XG4gICAgZm9yIChsZXQgZCA9IDA7IGQgPCBkZXB0aDsgZCsrKSB7XG4gICAgICBjb25zdCBmcmFtZSA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDEgLSBkXTtcbiAgICAgIGZyYW1lLm91dGNvbWUgPSBpc0NvbnRpbnVlID8gJ2NvbnRpbnVlJyA6ICdicmVhayc7XG4gICAgICBmcmFtZS5ib2R5VGVybWluYXRlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgbWF5LXJ1biBjYWxsIHRvIGEgcmVnaXN0ZXJlZCBkZWZpbml0aW9uIGZpcmVzIHBlciBpdHMgYm9keSdzIGRlYWQga2luZC4gKi9cbiAgcHJpdmF0ZSBhcHBseUNhbGwobmFtZTogc3RyaW5nLCBpblBpcGVsaW5lOiBib29sZWFuLCBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZGVmcy5oYXMobmFtZSkgfHwgYmFja2dyb3VuZGVkKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGVmUHJvYmVTdGFjay5oYXMobmFtZSkpIHJldHVybjsgLy8gcmVjdXJzaW9uOiB0aGUgaW5uZXIgY2FsbCByZXR1cm5zIG5vcm1hbGx5XG4gICAgY29uc3QgYm9keSA9IHRoaXMuZGVmcy5nZXQobmFtZSkhO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5hZGQobmFtZSk7XG4gICAgY29uc3Qga2luZCA9IHRoaXMuZGVmQm9keUZpcmVLaW5kKGJvZHkpO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5kZWxldGUobmFtZSk7XG4gICAgaWYgKGtpbmQgPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoa2luZCA9PT0gJ25ldmVyLXJldHVybicpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgIH0gZWxzZSBpZiAoIWluUGlwZWxpbmUpIHtcbiAgICAgIHRoaXMuZGVhZCA9IGtpbmQ7XG4gICAgfVxuICB9XG5cbiAgLyoqIFdoZXRoZXIgYSBkZWZpbml0aW9uIGJvZHksIHdhbGtlZCBhcyBpdHMgb3duIGZ1bmN0aW9uLCBlbmRzIGRlYWQuICovXG4gIHByaXZhdGUgZGVmQm9keUZpcmVLaW5kKGJvZHk6IHN0cmluZyk6IERlYWRLaW5kIHwgbnVsbCB7XG4gICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChib2R5KTtcbiAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gJ21hbGZvcm1lZCc7XG4gICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgIGNvbnN0IHNhdmVkRm5EZXB0aCA9IHRoaXMuZm5EZXB0aDtcbiAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgIHRoaXMuZGVhZCA9IG51bGw7XG4gICAgdGhpcy5yZXR1cm5lZCA9IGZhbHNlO1xuICAgIHRoaXMuZm5EZXB0aCA9IHRoaXMuZm5EZXB0aCArIDE7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBbXTtcbiAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IHRydWUsIHNpZGVFZmZlY3RzOiB0cnVlLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgY29uc3Qga2luZCA9IHRoaXMuZGVhZDtcbiAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgcmV0dXJuIGtpbmQ7XG4gIH1cblxuICBwcml2YXRlIGtub3duU3RhdHVzKGFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCk6IENoYWluU3RhdHVzIHtcbiAgICBpZiAoYXJndiA9PT0gbnVsbCB8fCBhcmd2Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICAvLyBSZWRpcmVjdHMgYW5kIHRyYW5zcGFyZW50IHdyYXBwZXJzIGFyZSBzdHJpcHBlZCBiZWZvcmUgc3RhdHVzIGV2YWx1YXRpb25cbiAgICAvLyAocGxhbiBcdTAwQTc0L1x1MDBBNzUpOiBgZW52IEZPTz0xIHRydWVgIGFuZCBgdGltZW91dCA1IHRydWVgIGFyZSBrbm93biBzdWNjZXNzZXMsXG4gICAgLy8gYHRydWUgPiBvdXRgIGtlZXBzIGl0cyBzdWNjZXNzLCBhbmQgYSBmYWlsLWNsb3NlZCB3cmFwcGVyIChgZW52IC1pIFx1MjAyNmApXG4gICAgLy8gc3RheXMgdW5rbm93bi5cbiAgICBjb25zdCBhID0gd2Fsa1N0cmlwKHN0cmlwV3JhcHBlcnMoc3RyaXBSZWRpcmVjdHMoYXJndikpKTtcbiAgICBpZiAoYS5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICd0cnVlJyB8fCBhWzBdID09PSAnOicpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdmYWxzZScpIHJldHVybiAnZmFpbHVyZSc7XG4gICAgaWYgKGEuZXZlcnkoKHcpID0+IEFTU0lHTk1FTlRfUkUudGVzdCh3KSkpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdleHBvcnQnICYmIGEubGVuZ3RoID4gMSAmJiBhLnNsaWNlKDEpLmV2ZXJ5KCh3KSA9PiBBU1NJR05NRU5UX1JFLnRlc3QodykpKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIGlmIChhWzBdID09PSAnc2V0JykgcmV0dXJuIHNldEZsYWdzS25vd24oYS5zbGljZSgxKSkgPyAnc3VjY2VzcycgOiAndW5rbm93bic7XG4gICAgcmV0dXJuICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlTaWRlRWZmZWN0cyhtZW1iZXI6IFNpbXBsZUNvbW1hbmQsIGFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCwgc3RyaXBwZWQ6IHN0cmluZ1tdIHwgbnVsbCk6IHZvaWQge1xuICAgIGlmIChhcmd2ID09PSBudWxsIHx8IGFyZ3YubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgLy8gQXNzaWdubWVudCByZWNvcmRpbmcgKGxhc3QgZGVmaW5pdGlvbiB3aW5zLCBmZWVkaW5nIGNhc2Ugc3ViamVjdHMpLlxuICAgIGNvbnN0IHdvcmRzID0gc3BsaXRXb3JkcyhtZW1iZXIudGV4dCk7XG4gICAgaWYgKHdvcmRzICE9PSBudWxsICYmIHdvcmRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxldCBrID0gMDtcbiAgICAgIHdoaWxlIChrIDwgd29yZHMubGVuZ3RoICYmIEFTU0lHTk1FTlRfUkUudGVzdCh3b3Jkc1trXSkpIGsrKztcbiAgICAgIGlmIChrID09PSB3b3Jkcy5sZW5ndGgpIHtcbiAgICAgICAgZm9yIChjb25zdCB3IG9mIHdvcmRzKSB7XG4gICAgICAgICAgY29uc3QgZXEgPSB3LmluZGV4T2YoJz0nKTtcbiAgICAgICAgICB0aGlzLmFzc2lnbm1lbnRzLnNldCh3LnNsaWNlKDAsIGVxKSwgdy5zbGljZShlcSArIDEpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh3b3Jkc1swXSA9PT0gJ2V4cG9ydCcpIHtcbiAgICAgICAgZm9yIChjb25zdCB3IG9mIHdvcmRzLnNsaWNlKDEpKSB7XG4gICAgICAgICAgaWYgKEFTU0lHTk1FTlRfUkUudGVzdCh3KSkge1xuICAgICAgICAgICAgY29uc3QgZXEgPSB3LmluZGV4T2YoJz0nKTtcbiAgICAgICAgICAgIHRoaXMuYXNzaWdubWVudHMuc2V0KHcuc2xpY2UoMCwgZXEpLCB3LnNsaWNlKGVxICsgMSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICdzZXQnKSB0aGlzLmFwcGx5U2V0RmxhZ3Moc3RyaXBwZWQuc2xpY2UoMSkpO1xuICAgIC8vIFRhYmxlIGxpZmVjeWNsZSAocGxhbiBcdTAwQTc3KTogYW4gZXhlY3V0ZWQgbm9uLXBpcGUgYHVuc2V0IE5BTUVgIGRlbGV0ZXMgdGhlXG4gICAgLy8gZW50cnksIHNvIGBYPS9hOyB1bnNldCBYOyBjYXQgJFgvZmAgc3RheXMgdW5yZXNvbHZlZCBpbnN0ZWFkIG9mXG4gICAgLy8gcmVzdXJyZWN0aW5nIHRoZSBzdGFsZSB2YWx1ZS4gYGV4cG9ydCBOQU1FYCB3aXRob3V0IGEgdmFsdWUgaXMgYSBuby1vcFxuICAgIC8vIGZvciB0aGUgdGFibGUgKGJhc2gga2VlcHMgdGhlIHZhbHVlLCBqdXN0IG1hcmtzIGl0IGV4cG9ydGVkKS5cbiAgICBpZiAoc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICd1bnNldCcpIHtcbiAgICAgIGZvciAoY29uc3QgdyBvZiBzdHJpcHBlZC5zbGljZSgxKSkge1xuICAgICAgICBpZiAoIXcuc3RhcnRzV2l0aCgnLScpKSB0aGlzLmFzc2lnbm1lbnRzLmRlbGV0ZSh3KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5U2V0RmxhZ3MoYXJnczogc3RyaW5nW10pOiB2b2lkIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgICAgaWYgKGEgPT09ICctLScpIGNvbnRpbnVlO1xuICAgICAgaWYgKCEoYS5zdGFydHNXaXRoKCctJykgfHwgYS5zdGFydHNXaXRoKCcrJykpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG9uID0gYS5zdGFydHNXaXRoKCctJyk7XG4gICAgICBjb25zdCBjaGFycyA9IGEuc2xpY2UoMSk7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNoYXJzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjaGFyc1trXTtcbiAgICAgICAgaWYgKGMgPT09ICdvJykge1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG4gICAgICAgICAgaWYgKG5hbWUgPT09ICdlcnJleGl0JykgdGhpcy5lcnJleGl0ID0gb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ25vZXJyZXhpdCcpIHRoaXMuZXJyZXhpdCA9ICFvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAncGlwZWZhaWwnKSB0aGlzLnBpcGVmYWlsID0gb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ25vcGlwZWZhaWwnKSB0aGlzLnBpcGVmYWlsID0gIW9uO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ2UnKSB0aGlzLmVycmV4aXQgPSBvbjtcbiAgICAgICAgLy8gRXZlcnkgb3RoZXIgcmVjb2duaXplZCBsZXR0ZXIgaXMgYSBuby1vcCBmb3IgdGhlIHdhbGsuXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzQ29uc3RydWN0KFxuICAgIG1lbWJlcjogU2ltcGxlQ29tbWFuZCxcbiAgICBraW5kOiBDb25zdHJ1Y3RLaW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCB7IGV4ZWMsIGJhY2tncm91bmRlZCwgb3B0cyB9ID0gY3R4O1xuICAgIGNvbnN0IGRpc2NhcmQgPSBvcHRzLmRpc2NhcmQgfHwgZXhlYyAhPT0gJ3llcyc7XG4gICAgY29uc3Qgc2lkZUVmZmVjdHMgPSBvcHRzLnNpZGVFZmZlY3RzICYmIGV4ZWMgPT09ICd5ZXMnO1xuXG4gICAgc3dpdGNoIChraW5kKSB7XG4gICAgICBjYXNlICdpZic6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VJZihtZW1iZXIudGV4dCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlZ2lvbnMgPSBbXG4gICAgICAgICAgcGFyc2VkLmNvbmRpdGlvbixcbiAgICAgICAgICBwYXJzZWQudGhlbkJvZHksXG4gICAgICAgICAgLi4ucGFyc2VkLmVsaWZzLmZsYXRNYXAoKGUpID0+IFtlLmNvbmRpdGlvbiwgZS5ib2R5XSksXG4gICAgICAgICAgLi4uKHBhcnNlZC5lbHNlQm9keSAhPT0gbnVsbCA/IFtwYXJzZWQuZWxzZUJvZHldIDogW10pXG4gICAgICAgIF07XG4gICAgICAgIGNvbnN0IGNvbmRTdGF0dXMgPSB0aGlzLndhbGtMaXN0KHNwbGl0VG9wTGV2ZWwocGFyc2VkLmNvbmRpdGlvbikuc3RhZ2VzLCB7XG4gICAgICAgICAgbGl2ZW5lc3M6IGZhbHNlLFxuICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgc2lkZUVmZmVjdHM6IHRydWUsXG4gICAgICAgICAgaW5wdXRGYWNpbmc6IGZhbHNlXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoY29uZFN0YXR1cyA9PT0gJ3Vua25vd24nKSByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAnc3VjY2VzcycpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy53YWxrQnJhbmNoKHBhcnNlZC50aGVuQm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZWxpZiBvZiBwYXJzZWQuZWxpZnMpIHtcbiAgICAgICAgICBjb25zdCBlU3RhdHVzID0gdGhpcy53YWxrTGlzdChzcGxpdFRvcExldmVsKGVsaWYuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICAgIGxpdmVuZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIGlucHV0RmFjaW5nOiBmYWxzZVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChlU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgICBpZiAoZVN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSByZXR1cm4gdGhpcy53YWxrQnJhbmNoKGVsaWYuYm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJzZWQuZWxzZUJvZHkgIT09IG51bGwpIHJldHVybiB0aGlzLndhbGtCcmFuY2gocGFyc2VkLmVsc2VCb2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgICBjYXNlICd3aGlsZSc6XG4gICAgICBjYXNlICd1bnRpbCc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VMb29wKG1lbWJlci50ZXh0LCBraW5kKTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgY29uZFN0YXR1cyA9IHRoaXMud2Fsa0xpc3Qoc3BsaXRUb3BMZXZlbChwYXJzZWQuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICBsaXZlbmVzczogZmFsc2UsXG4gICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICBpbnB1dEZhY2luZzogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgoW3BhcnNlZC5jb25kaXRpb24sIHBhcnNlZC5ib2R5XSwgY3R4KTtcbiAgICAgICAgY29uc3QgYm9keVJ1bnMgPSBraW5kID09PSAnd2hpbGUnID8gY29uZFN0YXR1cyA9PT0gJ3N1Y2Nlc3MnIDogY29uZFN0YXR1cyA9PT0gJ2ZhaWx1cmUnO1xuICAgICAgICBpZiAoIWJvZHlSdW5zKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHBhcnNlZC5ib2R5KTtcbiAgICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZnJhbWU6IExvb3BGcmFtZSA9IHsgb3V0Y29tZTogJ25vbmUnLCBib2R5VGVybWluYXRlZDogZmFsc2UsIGFtYmlndW91c1N0b3A6IGZhbHNlIH07XG4gICAgICAgIHRoaXMubG9vcFN0YWNrLnB1c2goZnJhbWUpO1xuICAgICAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrLnBvcCgpO1xuICAgICAgICBzd2l0Y2ggKGZyYW1lLm91dGNvbWUpIHtcbiAgICAgICAgICBjYXNlICdicmVhayc6XG4gICAgICAgICAgICByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICAgIGNhc2UgJ2NvbnRpbnVlJzpcbiAgICAgICAgICBjYXNlICdub25lJzpcbiAgICAgICAgICAgIGlmICh0aGlzLmRlYWQgPT09IG51bGwgJiYgIWJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICAgIGNhc2UgJ2FtYmlndW91cyc6XG4gICAgICAgICAgY2FzZSAncmV0dXJuJzpcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2Zvcic6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VGb3IobWVtYmVyLnRleHQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBpZiAocGFyc2VkLmxpc3QgPT09IG51bGwgfHwgcGFyc2VkLmxpc3Quc29tZSgodykgPT4gL1skYF0vLnRlc3QodykpKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChbcGFyc2VkLndob2xlSW50ZXJpb3JdLCBjdHgpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJzZWQubGlzdC5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocGFyc2VkLmJvZHkpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgICAgY2FzZSAnY2FzZSc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VDYXNlKG1lbWJlci50ZXh0KTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVnaW9ucyA9IHBhcnNlZC5icmFuY2hlcy5tYXAoKGIpID0+IGIuYm9keSk7XG4gICAgICAgIGlmIChwYXJzZWQuZmFsbHRocm91Z2ggfHwgcmVzb2x2ZVN1YmplY3QocGFyc2VkLnN1YmplY3QsIHRoaXMuYXNzaWdubWVudHMpID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHN1YmplY3QgPSByZXNvbHZlU3ViamVjdChwYXJzZWQuc3ViamVjdCwgdGhpcy5hc3NpZ25tZW50cykhO1xuICAgICAgICBsZXQgbWF0Y2hlZEJyYW5jaCA9IC0xO1xuICAgICAgICBsZXQgdW5kZWNpZGFibGUgPSBmYWxzZTtcbiAgICAgICAgZm9yIChsZXQgYiA9IDA7IGIgPCBwYXJzZWQuYnJhbmNoZXMubGVuZ3RoOyBiKyspIHtcbiAgICAgICAgICBjb25zdCByID0gZXZhbFBhdHRlcm4ocGFyc2VkLmJyYW5jaGVzW2JdLnBhdHRlcm4sIHN1YmplY3QpO1xuICAgICAgICAgIGlmIChyID09PSAnbWF0Y2gnKSB7XG4gICAgICAgICAgICBtYXRjaGVkQnJhbmNoID0gYjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAociA9PT0gJ2dsb2InIHx8IHIgPT09ICd1bmRlY2lkYWJsZScpIHtcbiAgICAgICAgICAgIHVuZGVjaWRhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAodW5kZWNpZGFibGUpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgaWYgKG1hdGNoZWRCcmFuY2ggIT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChwYXJzZWQuYnJhbmNoZXNbbWF0Y2hlZEJyYW5jaF0uYm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgICBjYXNlICdzZWxlY3QnOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlTG9vcChtZW1iZXIudGV4dCwgJ3doaWxlJyk7XG4gICAgICAgIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocGFyc2VkICE9PSBudWxsID8gW3BhcnNlZC5ib2R5XSA6IFtdLCBjdHgpO1xuICAgICAgfVxuICAgICAgY2FzZSAnYnJhY2UnOiB7XG4gICAgICAgIGNvbnN0IGludGVyaW9yID0gZXh0cmFjdEdyb3VwQm9keShtZW1iZXIudGV4dCwgJ3snLCAnfScpO1xuICAgICAgICBpZiAoaW50ZXJpb3IgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoaW50ZXJpb3IpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgICAgY2FzZSAnc3Vic2hlbGwnOiB7XG4gICAgICAgIGNvbnN0IGludGVyaW9yID0gZXh0cmFjdEdyb3VwQm9keShtZW1iZXIudGV4dCwgJygnLCAnKScpO1xuICAgICAgICBpZiAoaW50ZXJpb3IgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoaW50ZXJpb3IpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzYXZlZEVycmV4aXQgPSB0aGlzLmVycmV4aXQ7XG4gICAgICAgIGNvbnN0IHNhdmVkUGlwZWZhaWwgPSB0aGlzLnBpcGVmYWlsO1xuICAgICAgICBjb25zdCBzYXZlZEFzc2lnbm1lbnRzID0gdGhpcy5hc3NpZ25tZW50cztcbiAgICAgICAgY29uc3Qgc2F2ZWREZWZzID0gdGhpcy5kZWZzO1xuICAgICAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICAgICAgY29uc3Qgc2F2ZWRGbkRlcHRoID0gdGhpcy5mbkRlcHRoO1xuICAgICAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgICAgICBjb25zdCBzYXZlZERpckZyYW1lID0gdGhpcy5kaXJGcmFtZTtcbiAgICAgICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgICAgICB0aGlzLmVycmV4aXQgPSBzYXZlZEVycmV4aXQ7XG4gICAgICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgICAgICB0aGlzLmFzc2lnbm1lbnRzID0gbmV3IE1hcChzYXZlZEFzc2lnbm1lbnRzKTtcbiAgICAgICAgdGhpcy5kZWZzID0gbmV3IE1hcChzYXZlZERlZnMpO1xuICAgICAgICB0aGlzLnJldHVybmVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZm5EZXB0aCA9IDA7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrID0gW107XG4gICAgICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lICsgMTtcbiAgICAgICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgICBjb25zdCBpbm5lckRlYWQgPSB0aGlzLmRlYWQ7XG4gICAgICAgIHRoaXMuZXJyZXhpdCA9IHNhdmVkRXJyZXhpdDtcbiAgICAgICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgICAgIHRoaXMuYXNzaWdubWVudHMgPSBzYXZlZEFzc2lnbm1lbnRzO1xuICAgICAgICB0aGlzLmRlZnMgPSBzYXZlZERlZnM7XG4gICAgICAgIHRoaXMucmV0dXJuZWQgPSBzYXZlZFJldHVybmVkO1xuICAgICAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lO1xuICAgICAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgICAgIC8vIEEgc3Vic2hlbGwgaXMgYSBwcm9jZXNzIGJvdW5kYXJ5IGZvciB0aGUgZXhpdCBmaXJlIGJ1dCBub3QgZm9yIHRoZVxuICAgICAgICAvLyBuZXZlci1yZXR1cm4gZmlyZTogdGhlIHNoZWxsIHN5bmNocm9ub3VzbHkgd2FpdHMgZm9yIHRoZSBzdWJzaGVsbC5cbiAgICAgICAgaWYgKGlubmVyRGVhZCA9PT0gJ25ldmVyLXJldHVybicpIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgICAgICByZXR1cm4gc3RhdHVzO1xuICAgICAgfVxuICAgICAgY2FzZSAnZGVmJzoge1xuICAgICAgICAvLyBUaGUgZGVmaW5pdGlvbiByZWdpc3RlcnMgd2l0aCB0aGUgd2FsayBzY29wZSB3aGVuIGV4ZWN1dGVkLlxuICAgICAgICBpZiAoc2lkZUVmZmVjdHMpIHtcbiAgICAgICAgICBjb25zdCBkZWYgPSBwYXJzZURlZihtZW1iZXIudGV4dCk7XG4gICAgICAgICAgaWYgKGRlZiAhPT0gbnVsbCkgdGhpcy5kZWZzLnNldChkZWYubmFtZSwgZGVmLmJvZHkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHdhbGtCcmFuY2goYm9keTogc3RyaW5nLCBkaXNjYXJkOiBib29sZWFuLCBzaWRlRWZmZWN0czogYm9vbGVhbik6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGJvZHkpO1xuICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgb3BhcXVlLWNvbnN0cnVjdCB0cmVhdG1lbnQgKHBsYW4gXHUwMEE3Mik6IHJlLXNwbGl0IGVhY2ggcmVnaW9uIGFuZCB3YWxrIGl0XG4gICAqIHdpdGggdGhlIHNhbWUgbWFjaGluZXJ5IHNvIGFuIGBleGl0YC9gZXhlY2AgdGhhdCBtYXkgaGF2ZSBydW4sIG9yIGFcbiAgICogbmV2ZXItZXhpdCBsb29wLCBmaXJlcyBmYWlsLWNsb3NlZDsgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIHdvcmRzIHJlYWNoIHRoZVxuICAgKiBzY2FubmVkIGxvb3AgYXMgYW4gYW1iaWd1b3VzIHRlcm1pbmF0aW9uLiBTdGF0ZSBpcyBzbmFwc2hvdC1yZXN0b3JlZC5cbiAgICovXG4gIHByaXZhdGUgb3BhcXVlUGF0aChcbiAgICByZWdpb25zOiBzdHJpbmdbXSxcbiAgICBjdHg6IHsgZXhlYzogRXhlY1N0YXR1czsgaW5QaXBlbGluZTogYm9vbGVhbjsgYmFja2dyb3VuZGVkOiBib29sZWFuOyBvcHRzOiBXYWxrT3B0aW9ucyB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBmaW5kaW5ncyA9IHRoaXMuc2Nhbk9wYXF1ZShyZWdpb25zKTtcbiAgICBpZiAoZmluZGluZ3MuZmlyZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGZpbmRpbmdzLmZpcmUgPT09ICduZXZlci1yZXR1cm4nKSB7XG4gICAgICAgIGlmICghY3R4LmJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICB9IGVsc2UgaWYgKCFjdHguaW5QaXBlbGluZSAmJiAhY3R4LmJhY2tncm91bmRlZCkge1xuICAgICAgICB0aGlzLmRlYWQgPSBmaW5kaW5ncy5maXJlO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZmluZGluZ3MuYnJlYWtUYXJnZXQgIT09ICdub25lJykge1xuICAgICAgY29uc3QgdG9wID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICBpZiAodG9wICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdG9wLm91dGNvbWUgPSAnYW1iaWd1b3VzJztcbiAgICAgICAgdG9wLmFtYmlndW91c1N0b3AgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2FuT3BhcXVlKHJlZ2lvbnM6IHN0cmluZ1tdKTogeyBmaXJlOiBEZWFkS2luZCB8IG51bGw7IGJyZWFrVGFyZ2V0OiAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdub25lJyB9IHtcbiAgICBjb25zdCByZXBvcnQ6IHsgZmlyZTogRGVhZEtpbmQgfCBudWxsOyBicmVha1RhcmdldDogJ2JyZWFrJyB8ICdjb250aW51ZScgfCAnbm9uZScgfSA9IHtcbiAgICAgIGZpcmU6IG51bGwsXG4gICAgICBicmVha1RhcmdldDogJ25vbmUnXG4gICAgfTtcbiAgICBjb25zdCBzYXZlZENoYWluID0gdGhpcy5jaGFpbjtcbiAgICBjb25zdCBzYXZlZEVycmV4aXQgPSB0aGlzLmVycmV4aXQ7XG4gICAgY29uc3Qgc2F2ZWRQaXBlZmFpbCA9IHRoaXMucGlwZWZhaWw7XG4gICAgY29uc3Qgc2F2ZWRBc3NpZ25tZW50cyA9IHRoaXMuYXNzaWdubWVudHM7XG4gICAgY29uc3Qgc2F2ZWREZWZzID0gdGhpcy5kZWZzO1xuICAgIGNvbnN0IHNhdmVkRGVhZCA9IHRoaXMuZGVhZDtcbiAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICBjb25zdCBzYXZlZEZuRGVwdGggPSB0aGlzLmZuRGVwdGg7XG4gICAgY29uc3Qgc2F2ZWRMb29wU3RhY2sgPSB0aGlzLmxvb3BTdGFjaztcbiAgICBjb25zdCBzYXZlZERpckZyYW1lID0gdGhpcy5kaXJGcmFtZTtcbiAgICBjb25zdCBzYXZlZFZlcmRpY3RzID0gdGhpcy52ZXJkaWN0cy5sZW5ndGg7XG4gICAgY29uc3Qgc2F2ZWRFeHBhbmRlZCA9IHRoaXMuZXhwYW5kZWQubGVuZ3RoO1xuICAgIGNvbnN0IHNhdmVkRGVmUHJvYmUgPSBuZXcgU2V0KHRoaXMuZGVmUHJvYmVTdGFjayk7XG5cbiAgICBmb3IgKGNvbnN0IHJlZ2lvbiBvZiByZWdpb25zKSB7XG4gICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHJlZ2lvbik7XG4gICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlcG9ydC5maXJlID0gJ21hbGZvcm1lZCc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICAgIHRoaXMucmV0dXJuZWQgPSBmYWxzZTtcbiAgICAgIC8vIEVhY2ggcmVnaW9uIHdhbGtzIGFnYWluc3QgYSBmcmVzaCBjb3B5IG9mIHRoZSBlbmNsb3NpbmcgbG9vcCBmcmFtZXMgc29cbiAgICAgIC8vIGl0cyBoaWRkZW4gYnJlYWsvY29udGludWUgZXZlbnRzIGFyZSByZXBvcnRlZCwgbmV2ZXIgYXBwbGllZC5cbiAgICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2subWFwKChmKSA9PiAoeyAuLi5mIH0pKTtcbiAgICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogdHJ1ZSwgc2lkZUVmZmVjdHM6IGZhbHNlLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICBpZiAodGhpcy5kZWFkICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChyZXBvcnQuZmlyZSA9PT0gbnVsbCB8fCB0aGlzLmRlYWQgPT09ICduZXZlci1yZXR1cm4nIHx8IHRoaXMuZGVhZCA9PT0gJ21hbGZvcm1lZCcpIHJlcG9ydC5maXJlID0gdGhpcy5kZWFkO1xuICAgICAgfVxuICAgICAgaWYgKHJlcG9ydC5icmVha1RhcmdldCA9PT0gJ25vbmUnKSB7XG4gICAgICAgIGNvbnN0IGlubmVybW9zdCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoaW5uZXJtb3N0ICE9PSB1bmRlZmluZWQgJiYgKGlubmVybW9zdC5vdXRjb21lID09PSAnYnJlYWsnIHx8IGlubmVybW9zdC5vdXRjb21lID09PSAnY29udGludWUnKSkge1xuICAgICAgICAgIHJlcG9ydC5icmVha1RhcmdldCA9IGlubmVybW9zdC5vdXRjb21lO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFpbiA9IHNhdmVkQ2hhaW47XG4gICAgdGhpcy5lcnJleGl0ID0gc2F2ZWRFcnJleGl0O1xuICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgIHRoaXMuYXNzaWdubWVudHMgPSBzYXZlZEFzc2lnbm1lbnRzO1xuICAgIHRoaXMuZGVmcyA9IHNhdmVkRGVmcztcbiAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWU7XG4gICAgdGhpcy52ZXJkaWN0cy5sZW5ndGggPSBzYXZlZFZlcmRpY3RzO1xuICAgIHRoaXMuZXhwYW5kZWQubGVuZ3RoID0gc2F2ZWRFeHBhbmRlZDtcbiAgICB0aGlzLmRlZlByb2JlU3RhY2suY2xlYXIoKTtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2Ygc2F2ZWREZWZQcm9iZSkgdGhpcy5kZWZQcm9iZVN0YWNrLmFkZChuYW1lKTtcbiAgICByZXR1cm4gcmVwb3J0O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKipcbiAqIFBhcnNlIGBoZWFkYC9gdGFpbGAgZmxhZ3MgYW5kIGZpbGUgYXJncy4gQSBiYXJlIGArTmAgaXMgYSBmcm9tLU4gY291bnQgb25seVxuICogZm9yIGB0YWlsYCAoYHRhaWwgKzUgZmAgc3RhcnRzIGF0IGxpbmUgNSk7IEdOVSBgaGVhZGAgdHJlYXRzIGJhcmUgYCtOYCBhcyBhXG4gKiAqZmlsZSogKGNvcmV1dGlscyA5LjcgXHUyMDE0IHByb2JlOiBgaGVhZCArNSBmYCBlcnJvcnMgXCJjYW5ub3Qgb3BlbiAnKzUnXCIgYW5kXG4gKiByZWFkcyBmJ3MgZmlyc3QgMTAgbGluZXMpLCBzbyBgYmFyZVBsdXNJc0NvdW50YCBpcyBmYWxzZSBmb3IgaGVhZCBhbmQgdGhlXG4gKiB3b3JkIGZhbGxzIHRocm91Z2ggdG8gdGhlIGZpbGUgbGlzdC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VIZWFkVGFpbEZsYWdzKFxuICByZXN0OiBzdHJpbmdbXSxcbiAgYmFyZVBsdXNJc0NvdW50OiBib29sZWFuXG4pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGlmIChiYXJlUGx1c0lzQ291bnQpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCBmYWxzZSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgLy8gQmFyZSBgK05gIGlzIGEgR05VLWhlYWQgZmlsZSBhcnRpZmFjdCwgbmV2ZXIgYSByZWFsIHJlYWQgXHUyMDE0IGRyb3AgaXQuXG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nICYmICEvXlxcK1xcZCskLy50ZXN0KGYpKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ2hlYWQtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JywgZW5kOiBuIH0gYXMgTGluZVJhbmdlU3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFRhaWwoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICd0YWlsJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCB0cnVlKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IGZyb21TdGFydCA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IG4gfSA6IHsga2luZDogJ2xhc3ROTGluZXMnLCBjb3VudDogbiB9O1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ3RhaWwtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRHaXRTdWJjb21tYW5kKFxuICByZXN0OiBzdHJpbmdbXVxuKTogeyBzdWJJZHg6IG51bWJlcjsgc3ViY29tbWFuZDogc3RyaW5nOyBjRGlyOiBzdHJpbmcgfCBudWxsOyBjRGlyVW5yZXNvbHZhYmxlOiBib29sZWFuIH0gfCBudWxsIHtcbiAgbGV0IGNEaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgY0RpclVucmVzb2x2YWJsZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgcmVzdC5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1DJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoaGFzU2hlbGxFeHBhbnNpb24odikpIGNEaXJVbnJlc29sdmFibGUgPSB0cnVlO1xuICAgICAgZWxzZSBjRGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IHN1YklkeDogaSwgc3ViY29tbWFuZDogYSwgY0RpciwgY0RpclVucmVzb2x2YWJsZSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5jb25zdCBSRVZfUEFUSCA9IC9eKFteXFxzOl0rKTooLispJC87XG5cbmZ1bmN0aW9uIG1hdGNoR2l0U2hvdyhhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnc2hvdycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2XG4gICAgLnNsaWNlKDEpXG4gICAgLnNsaWNlKHN1Yi5zdWJJZHggKyAxKVxuICAgIC5maWx0ZXIoKGEpID0+ICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGNvbnN0IHJldlBhdGhBcmcgPSBhZnRlci5maW5kKChhKSA9PiBSRVZfUEFUSC50ZXN0KGEpKTtcbiAgaWYgKCFyZXZQYXRoQXJnKSByZXR1cm4gW107XG4gIGNvbnN0IG0gPSByZXZQYXRoQXJnLm1hdGNoKFJFVl9QQVRIKTtcbiAgaWYgKCFtKSByZXR1cm4gW107XG4gIGNvbnN0IFssIHJldiwgcGF0aF0gPSBtO1xuICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUgfHwgaGFzU2hlbGxFeHBhbnNpb24ocmV2KSkge1xuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgb3IgcmV2aXNpb24gY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXG4gICAge1xuICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICByZXNvbHZlcktpbmQ6IHsga2luZDogJ2dpdCcsIHJldiB9LFxuICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgIH1cbiAgXTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hHaXRMb2dMKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdsb2cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndi5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYWZ0ZXIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYWZ0ZXJbaV07XG4gICAgbGV0IHNwZWM6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhID09PSAnLUwnKSBzcGVjID0gYWZ0ZXJbaSArIDFdID8/IG51bGw7XG4gICAgZWxzZSBpZiAoYS5zdGFydHNXaXRoKCctTCcpKSBzcGVjID0gYS5zbGljZSgyKTtcbiAgICBpZiAoIXNwZWMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG0gPSBzcGVjLm1hdGNoKC9eKFxcZCspLChcXGQrKTooLispJC8pO1xuICAgIGlmICghbSkgY29udGludWU7XG4gICAgY29uc3QgWywgcywgZSwgcGF0aF0gPSBtO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICAgIH1cbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogTnVtYmVyLnBhcnNlSW50KHMsIDEwKSwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZSwgMTApIH0sXG4gICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJyxcbiAgICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlcmVkb2Mgd3JpdGVzIChgY2F0ID4gZmlsZSA8PEVPRiAuLi4gRU9GYCk6IGhhbmRsZWQgYXMgYSBkZWRpY2F0ZWQgcmF3LXRleHRcbi8vIHBhc3MgYmVjYXVzZSB0aGUgYm9keSBjYW4gaXRzZWxmIGNvbnRhaW4gJiYvOy98L25ld2xpbmVzIHRoYXQgd291bGRcbi8vIG90aGVyd2lzZSBjb25mdXNlIHNwbGl0VG9wTGV2ZWwuIE1hdGNoZWQgc3BhbnMgYXJlIG1hc2tlZCBvdXQgb2YgdGhlIHN0cmluZ1xuLy8gKHJlcGxhY2VkIHdpdGggYW4gaW5kZXhlZCBwbGFjZWhvbGRlciBzaW1wbGUtY29tbWFuZCkgYmVmb3JlIHRoZSByZXN0IG9mXG4vLyB0aGUgcGlwZWxpbmUgcnVucywgYW5kIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSBtYWluIHdhbGsgc28gdGhlXG4vLyB3cml0ZSBpcyByZXNvbHZlZCBhZ2FpbnN0IHRoZSBjb3JyZWN0IGBjZGAtdHJhY2tlZCBkaXJlY3RvcnkuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIEhlcmVkb2NXcml0ZSB7XG4gIHJlZGlyZWN0OiAnPicgfCAnPj4nO1xuICB0YXJnZXQ6IHN0cmluZztcbiAgYm9keTogc3RyaW5nO1xufVxuXG5jb25zdCBIRVJFRE9DX09QRU4gPVxuICAvXFxiY2F0WyBcXHRdKyg+ezEsMn0pWyBcXHRdKihcXFMrKVsgXFx0XSo8PCgtPylbIFxcdF0qKD86JyhbXiddKiknfFwiKFteXCJdKilcInwoW0EtWmEtel9dW0EtWmEtejAtOV9dKikpL2c7XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IDA7XG4gIGxldCBvcGVuTWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGwgPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB3aGlsZSAob3Blbk1hdGNoICE9PSBudWxsKSB7XG4gICAgY29uc3QgWywgcmVkaXJlY3QsIHRhcmdldCwgZGFzaCwgZHExLCBkcTIsIGJhcmVdID0gb3Blbk1hdGNoO1xuICAgIGNvbnN0IGRlbGltID0gZHExID8/IGRxMiA/PyBiYXJlO1xuICAgIGNvbnN0IG9wZW5FbmQgPSBvcGVuTWF0Y2guaW5kZXggKyBvcGVuTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIGlmICghZGVsaW0gfHwgb3Blbk1hdGNoLmluZGV4IDwgY3Vyc29yKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gb3Blbk1hdGNoLmluZGV4ICsgMTtcbiAgICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVGhlIGJvZHkgcmVnaW9uIHN0YXJ0cyByaWdodCBhZnRlciB0aGUgZGVsaW1pdGVyIGxpbmUncyBuZXdsaW5lLiBBblxuICAgIC8vIGFic2VudCBuZXdsaW5lIChpbnB1dCBlbmRzIGF0IHRoZSBkZWxpbWl0ZXIsIG9yIGAmJmAvYDtgIGNvbnRpbnVlcyB0aGVcbiAgICAvLyBsaW5lKSBpcyBhIHNhbWUtbGluZSB1bnRlcm1pbmF0ZWQgaGVyZWRvYyB3aXRoIGFuIGVtcHR5IGJvZHkgXHUyMDE0IHRoZSBgPmBcbiAgICAvLyByZWRpcmVjdCBzdGlsbCB0cnVuY2F0ZXMgdGhlIGZpbGUsIGFuZCB0aGUgY29udGludWF0aW9uIHN0YXlzIGNvbW1hbmRzLlxuICAgIGNvbnN0IG5sID0gcmF3LnNsaWNlKG9wZW5FbmQpLm1hdGNoKC9eWyBcXHRdKlxccj9cXG4vKTtcbiAgICBjb25zdCBib2R5U3RhcnQgPSBubCAhPT0gbnVsbCA/IG9wZW5FbmQgKyBubFswXS5sZW5ndGggOiBvcGVuRW5kO1xuICAgIGNvbnN0IHJlbWFpbmRlciA9IHJhdy5zbGljZShib2R5U3RhcnQpO1xuICAgIGNvbnN0IGNsb3NlUmUgPSBuZXcgUmVnRXhwKGBeJHtkYXNoID8gJ1xcXFx0KicgOiAnJ30ke2VzY2FwZVJlZ0V4cChkZWxpbSl9WyBcXFxcdF0qJGAsICdtJyk7XG4gICAgY29uc3QgY2xvc2VNYXRjaCA9IGNsb3NlUmUuZXhlYyhyZW1haW5kZXIpO1xuICAgIGxldCBib2R5OiBzdHJpbmc7XG4gICAgbGV0IG1hdGNoRW5kOiBudW1iZXI7XG4gICAgaWYgKGNsb3NlTWF0Y2gpIHtcbiAgICAgIGJvZHkgPSByZW1haW5kZXIuc2xpY2UoMCwgY2xvc2VNYXRjaC5pbmRleCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICAgIG1hdGNoRW5kID0gYm9keVN0YXJ0ICsgY2xvc2VNYXRjaC5pbmRleCArIGNsb3NlTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIH0gZWxzZSBpZiAobmwgPT09IG51bGwpIHtcbiAgICAgIGJvZHkgPSAnJztcbiAgICAgIG1hdGNoRW5kID0gb3BlbkVuZDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVW50ZXJtaW5hdGVkIHdpdGggYSBib2R5IHJlZ2lvbjogdGhlIGRhdGEgcmVnaW9uIHJ1bnMgdG8gRU9GLlxuICAgICAgYm9keSA9IHJlbWFpbmRlci5yZXBsYWNlKC9cXG4kLywgJycpO1xuICAgICAgbWF0Y2hFbmQgPSByYXcubGVuZ3RoO1xuICAgIH1cblxuICAgIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yLCBvcGVuTWF0Y2guaW5kZXgpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgY3Vyc29yID0gbWF0Y2hFbmQ7XG4gICAgd3JpdGVzLnB1c2goeyByZWRpcmVjdDogcmVkaXJlY3QgYXMgJz4nIHwgJz4+JywgdGFyZ2V0LCBib2R5IH0pO1xuXG4gICAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IG1hdGNoRW5kO1xuICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFdpbmRvdyBhbGdlYnJhIChwbGFuIFx1MDBBNzMpOiBzb3VyY2UgYW5hbHlzaXMgYW5kIHN0ZGluLXNlbGVjdG9yIGNsYXNzaWZpY2F0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGBubGAncyBhcmctdGFraW5nIGZsYWdzIFx1MjAxNCBlYWNoIGNvbnN1bWVzIHRoZSBmb2xsb3dpbmcgd29yZCAocGxhbiBcdTAwQTczKS4gKi9cbmNvbnN0IE5MX0FSR19GTEFHUyA9IG5ldyBTZXQoWyctYicsICctaScsICctbCcsICctcycsICctdicsICctdyddKTtcblxuLyoqIFN0ZG91dC1mb3JtIHJlZGlyZWN0IG9wZXJhdG9ycyBvbiB0aGUgcHJlLXN0cmlwIGFyZ3YgKHBsYW4gXHUwMEE3MyBzZXZlcmFuY2UpOiBgPmAsIGA+PmAsIGAmPmAsIGAmPj5gLCBgMT5gLCBgMT4+YCwgYD58YC4gKi9cbmNvbnN0IFNURE9VVF9SRURJUkVDVF9UV09fVE9LRU4gPSAvXig/Oj4+P3wmPj4/fDE+Pj98PlxcfCkkLztcbmNvbnN0IFNURE9VVF9SRURJUkVDVF9GVVNFRCA9IC9eKD86Pj4/fCY+Pj98MT4+PylbXjw+JnxdLztcbmNvbnN0IFNURE9VVF9SRURJUkVDVF9GVVNFRF9QSVBFID0gL14+XFx8W148PiZ8XS87XG5cbi8qKiBXaGV0aGVyIGEgcHJlLXN0cmlwIGFyZ3YgY2FycmllcyBhIHN0ZG91dC1mb3JtIHJlZGlyZWN0IChzdGRlcnIgYDI+YCBhbmQgZHVwIGAyPiYxYCBuZXZlciBzZXZlcikuICovXG5jb25zdCBoYXNTdGRvdXRSZWRpcmVjdCA9IChyYXc6IHN0cmluZ1tdKTogYm9vbGVhbiA9PlxuICByYXcuc29tZShcbiAgICAodykgPT4gU1RET1VUX1JFRElSRUNUX1RXT19UT0tFTi50ZXN0KHcpIHx8IFNURE9VVF9SRURJUkVDVF9GVVNFRC50ZXN0KHcpIHx8IFNURE9VVF9SRURJUkVDVF9GVVNFRF9QSVBFLnRlc3QodylcbiAgKTtcblxudHlwZSBTb3VyY2VBbmFseXNpcyA9XG4gIHwgeyBraW5kOiAnbm9uZScgfVxuICB8IHsga2luZDogJ3VubmFycm93YWJsZSc7IGZpbGVzOiB7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZScgfVtdIH1cbiAgfCB7IGtpbmQ6ICduYXJyb3dhYmxlJzsgZmlsZUFyZzogc3RyaW5nOyBpZGlvbTogJ2NhdC1maWxlJyB8ICdubC1maWxlJzsgcmVzb2x2ZXJLaW5kOiAnZnMnOyBkaXJPdmVycmlkZT86IHN0cmluZyB9XG4gIHwge1xuICAgICAga2luZDogJ2dpdCc7XG4gICAgICBmaWxlQXJnOiBzdHJpbmc7XG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJztcbiAgICAgIHJldjogc3RyaW5nO1xuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICAgICAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG4gICAgfVxuICB8IHsga2luZDogJ2dpdFVucmVzb2x2ZWQnOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKiBBIHNvdXJjZSB0aGF0IG9wZW5zIGEgbmFycm93YWJsZSB3aW5kb3c6IGEgc2luZ2xlLWZpbGUgYGNhdGAvYG5sYCBvciBhIGBnaXQgc2hvdyByZXY6cGF0aGAuICovXG50eXBlIE5hcnJvd2FibGVTb3VyY2UgPSBFeHRyYWN0PFNvdXJjZUFuYWx5c2lzLCB7IGtpbmQ6ICduYXJyb3dhYmxlJyB8ICdnaXQnIH0+O1xuXG4vKipcbiAqIFRoZSBwaXBlbGluZS1zb3VyY2UgYW5hbHlzaXMgKHBsYW4gXHUwMEE3Myk6IGEgYGNhdGAvYG5sYCB3aG9zZSBmaWxlIGFyZ3MgXHUyMDE0XG4gKiBldmVyeSBub24tZmxhZyB3b3JkLCB3aGVyZSBhIGAtYC1wcmVmaXhlZCB3b3JkIGlzIGEgZmxhZyBhbmQgYSBiYXJlIGAtYCBpc1xuICogYSBzdGRpbiBtYXJrZXIgXHUyMDE0IGFyZSBhbGwgZmlsZXMtb3ItYC1gIHdpdGggYXQgbGVhc3Qgb25lIGZpbGUsIG9yIGFcbiAqIGBnaXQgc2hvdyByZXY6cGF0aGAuIEEgc2luZ2xlLWZpbGUgc291cmNlIGlzIG5hcnJvd2FibGU7IGEgbXVsdGktZmlsZSBvclxuICogc3RkaW4tbWl4ZWQgc291cmNlIGlzIHVuLW5hcnJvd2FibGUgKGVhY2ggZmlsZSBlbWl0cyBpdHMgb3duIGNvbnNlcnZhdGl2ZVxuICogd2hvbGUtZmlsZSByZWFkLCBhbmQgc3RkaW4gc2VsZWN0b3JzIG5ldmVyIG5hcnJvdyBpdCkuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVTb3VyY2UoYXJndjogc3RyaW5nW10pOiBTb3VyY2VBbmFseXNpcyB7XG4gIGlmIChhcmd2WzBdID09PSAnY2F0JyB8fCBhcmd2WzBdID09PSAnbmwnKSB7XG4gICAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnKSB7XG4gICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIGNvbnRpbnVlOyAvLyBhIGZsYWcgXHUyMDE0IGNhdCBmbGFncyBuZXZlciB0YWtlIGFyZ3VtZW50c1xuICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgICAgIGlmIChOTF9BUkdfRkxBR1MuaGFzKGEpKSBpICs9IDE7IC8vIGFyZy10YWtpbmcgZmxhZyBjb25zdW1lcyB0aGUgbmV4dCB3b3JkXG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcmVhbCA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgICBpZiAocmVhbC5sZW5ndGggPT09IDApIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xuICAgIGNvbnN0IGlkaW9tID0gYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnO1xuICAgIGlmIChyZWFsLmxlbmd0aCA9PT0gMSAmJiAhZmlsZXMuaW5jbHVkZXMoJy0nKSkge1xuICAgICAgcmV0dXJuIHsga2luZDogJ25hcnJvd2FibGUnLCBmaWxlQXJnOiByZWFsWzBdLCBpZGlvbSwgcmVzb2x2ZXJLaW5kOiAnZnMnIH07XG4gICAgfVxuICAgIHJldHVybiB7IGtpbmQ6ICd1bm5hcnJvd2FibGUnLCBmaWxlczogcmVhbC5tYXAoKGZpbGVBcmcpID0+ICh7IGZpbGVBcmcsIGlkaW9tIH0pKSB9O1xuICB9XG4gIGlmIChhcmd2WzBdID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IG91dGNvbWVzID0gbWF0Y2hHaXRTaG93KGFyZ3YpO1xuICAgIGlmIChvdXRjb21lcy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IG8gPSBvdXRjb21lc1swXTtcbiAgICAgIGlmIChvLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICByZXR1cm4geyBraW5kOiAnZ2l0VW5yZXNvbHZlZCcsIGZpbGVBcmc6IG8uZmlsZUFyZywgcmVhc29uOiBvLnJlYXNvbiB9O1xuICAgICAgfVxuICAgICAgaWYgKG8ua2luZCA9PT0gJ2NhbmRpZGF0ZScgJiYgby5yZXNvbHZlcktpbmQgIT09ICdmcycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBraW5kOiAnZ2l0JyxcbiAgICAgICAgICBmaWxlQXJnOiBvLmZpbGVBcmcsXG4gICAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgICAgcmV2OiBvLnJlc29sdmVyS2luZC5yZXYsXG4gICAgICAgICAgcmVzb2x2ZXJLaW5kOiBvLnJlc29sdmVyS2luZCxcbiAgICAgICAgICBkaXJPdmVycmlkZTogby5kaXJPdmVycmlkZVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxudHlwZSBTdGRpblNlbGVjdG9yID1cbiAgfCB7IGtpbmQ6ICdoZWFkJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndGFpbCc7IGNvdW50OiBudW1iZXI7IGZyb21TdGFydDogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiAnc2VkJzsgcmFuZ2VzOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIHwgJyQnIH1bXSB9O1xuXG4vKipcbiAqIFdoZXRoZXIgYSB3cmFwcGVyLXN0cmlwcGVkIHN0YWdlIGlzIGEgc3RkaW4gbGluZS1zZWxlY3RvciAocGxhbiBcdTAwQTczKTogYVxuICogYHNlZCAtbmAgcmFuZ2Ugc2NyaXB0LCBgaGVhZGAsIG9yIGB0YWlsYCB3aXRoIG5vIGZpbGUgYXJncyAoYSBiYXJlIGAtYCBpcyBhXG4gKiBzdGRpbiBtYXJrZXIsIG5vdCBhIGZpbGUpLiBBIHJlY29nbml6ZWQgc2VsZWN0b3IgY2FycnlpbmcgaXRzIG93biBmaWxlIGFyZ3NcbiAqIGlzIGEgbm9uLWNvbnN1bWVyIFx1MjAxNCBpdCBuZXZlciByZWFkcyB0aGUgcGlwZSBcdTIwMTQgYW5kIHJldHVybnMgbnVsbC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlTdGRpblNlbGVjdG9yKGFyZ3Y6IHN0cmluZ1tdKTogU3RkaW5TZWxlY3RvciB8IG51bGwge1xuICBpZiAoYXJndlswXSA9PT0gJ2hlYWQnIHx8IGFyZ3ZbMF0gPT09ICd0YWlsJykge1xuICAgIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIGFyZ3ZbMF0gPT09ICd0YWlsJyk7XG4gICAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIG51bGw7IC8vIGJ5dGUvemVyby10ZXJtaW5hdGVkIHJlYWRzIGFyZSBub3QgbGluZSBzZWxlY3RvcnNcbiAgICBjb25zdCBmaWxlQXJncyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgICBpZiAoZmlsZUFyZ3MubGVuZ3RoID4gMCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIGFyZ3ZbMF0gPT09ICdoZWFkJyA/IHsga2luZDogJ2hlYWQnLCBjb3VudDogY291bnQgPz8gMTAgfSA6IHsga2luZDogJ3RhaWwnLCBjb3VudDogY291bnQgPz8gMTAsIGZyb21TdGFydCB9O1xuICB9XG4gIGlmIChhcmd2WzBdID09PSAnc2VkJykge1xuICAgIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICAgIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIG51bGw7XG4gICAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHJlc3RbaV0gPT09ICctbicpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzY3JpcHRJZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICAgIGlmIChmaWxlQ2FuZGlkYXRlcy5sZW5ndGggIT09IDApIHJldHVybiBudWxsOyAvLyBub24tY29uc3VtZXIgXHUyMDE0IHJlYWRzIGl0cyBmaWxlLCBuZXZlciB0aGUgcGlwZVxuICAgIGNvbnN0IHJhbmdlczogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB8ICckJyB9W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgICAgY29uc3QgbSA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICAgIGlmICghbSkgY29udGludWU7XG4gICAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgICByYW5nZXMucHVzaCh7IHN0YXJ0LCBlbmQ6IG1bMl0gPT09IHVuZGVmaW5lZCA/IHN0YXJ0IDogbVsyXSA9PT0gJyQnID8gJyQnIDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKSB9KTtcbiAgICB9XG4gICAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IGtpbmQ6ICdzZWQnLCByYW5nZXMgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBvcHRzOiBQYXJzZU9wdGlvbnMgPSB7fSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgLy8gUGxhbiBcdTAwQTc3OiB0aGUgcGFyc2VyIGRlZmF1bHRzIGBlbnZgIHRvIHRoZSBob29rIHByb2Nlc3MgZW52LCBnYXRlZCBieSB0aGVcbiAgLy8gYWxsb3dsaXN0IFx1MjAxNCBvbmx5IGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYCBuYW1lcyBtYXkgcmVzb2x2ZSBmcm9tIGl0LiBBblxuICAvLyBleHBsaWNpdGx5IGluamVjdGVkIGVudiAodGVzdHMsIGFkYXB0ZXJzKSBpcyBjb25zdWx0ZWQgd2hvbGVzYWxlLlxuICBjb25zdCBhbGxvd2xpc3QgPSBvcHRzLmFsbG93bGlzdCA/PyBERUZBVUxUX1BBVEhfQUxMT1dMSVNUO1xuICBjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gPVxuICAgIG9wdHMuZW52ID8/IE9iamVjdC5mcm9tRW50cmllcyhhbGxvd2xpc3QubWFwKChuKSA9PiBbbiwgcHJvY2Vzcy5lbnZbbl1dKSk7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCB7IHN0YWdlczogc2ltcGxlQ29tbWFuZHMsIG1hbGZvcm1lZCB9ID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIC8vIFZlcmRpY3QgY29uc3VtcHRpb24gKHBsYW4gXHUwMEE3MSwgbGlzdC1zY29wZSArIHRlcm1pbmFsIHNlbWFudGljcyk6IHRoZVxuICAvLyBzcGxpdHRlciBoYXMgYWxyZWFkeSBkcm9wcGVkIHRoZSByZWplY3RpbmcgbGlzdCdzIHN0YWdlcyBhbmQgdHJ1bmNhdGVkIGF0XG4gIC8vIHRoZSBmaXJzdCBtYWxmb3JtZWQgbGlzdCwgc28gYHNpbXBsZUNvbW1hbmRzYCBpcyBleGFjdGx5IHRoZSBjb21wbGV0ZWRcbiAgLy8gZWFybGllciBsaXN0cyBhbmQgd2Fsa3Mgbm9ybWFsbHkgYmVsb3cgXHUyMDE0IHRoZSBmdWxsLWxpbmUga2luZHNcbiAgLy8gKCd1bmNsb3NlZC1xdW90ZScsICd1bmJhbGFuY2VkLXBhcmVuJywgJ2RhbmdsaW5nLW9wZXJhdG9yJywgJ3BpcGUtYmFuZycsXG4gIC8vICd1bmNsb3NlZC1icmFjZScsICd1bmNsb3NlZC1jYXNlJywgJ3VuY2xvc2VkLWNvbnN0cnVjdCcpIGVtaXQgbm8gdG91Y2hlc1xuICAvLyB3aXRob3V0IGZ1cnRoZXIgaGFuZGxpbmcuICd1bnRlcm1pbmF0ZWQtaGVyZWRvYycgKHRoZSBwYXJ0aWFsLCBhcnJpdmluZ1xuICAvLyB3aXRoIHRoZSBoZXJlZG9jIG1hY2hpbmVyeSBpbiBhIGxhdGVyIHBoYXNlKSBrZWVwcyB0aGUgY3VycmVudCBiZWhhdmlvcjpcbiAgLy8gaXRzIHN0YWdlIGxpc3QgcnVucyB0aHJvdWdoIHRoZSBkZWxpbWl0ZXIncyBsaW5lIGFuZCBsaWtld2lzZSBhbmFseXplc1xuICAvLyBhcy1pcy5cbiAgdm9pZCBtYWxmb3JtZWQ7XG5cbiAgLy8gVGhlIGV4ZWN1dGlvbiB3YWxrIChwbGFuIFx1MDBBNzIpIGRlY2lkZXMgd2hpY2ggc3RhZ2VzIHJhbiBhbmQgZXhwYW5kcyB0aGVcbiAgLy8gZGVjaWRhYmxlIGNvbnN0cnVjdCBpbnRlcmlvcnMgaW4gdGhlaXIgcGxhY2UuIE9ubHkgYCd5ZXMnYCBzdGFnZXMgZW1pdC5cbiAgY29uc3QgZXhwYW5kZWQgPSBuZXcgRXhlY3V0aW9uV2Fsa2VyKCkud2Fsa0lucHV0KHNpbXBsZUNvbW1hbmRzKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVxcdTAwMDAke3Jldn1cXHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICAvLyBgY2RgIGZyYW1lcyAocGxhbiBcdTAwQTc2KTogdGhlIHdhbGsgYXNzaWducyBlYWNoIHN0YWdlIHRoZSBzdWJzaGVsbCBmcmFtZSBpdFxuICAvLyByYW4gaW47IGEgc3Vic2hlbGwncyBgY2RgIHJlLWJhc2VzIHdpdGhpbiBpdHMgZnJlc2ggZnJhbWUsIGRpc2NhcmRlZCBhdFxuICAvLyB0aGUgY2xvc2UuIEVhY2ggZnJhbWUgdHJhY2tzIHRoZSBjb21wb3NlZCBlZmZlY3RpdmUgZGlyZWN0b3J5LCBpdHNcbiAgLy8gY2VydGFpbnR5IChhbiBleGVjdXRlZCBvciBtYXktaGF2ZS1ydW4gYGNkYCB3aXRoIGFuIHVucmVzb2x2YWJsZSB0YXJnZXRcbiAgLy8gcG9pc29ucyBpdCBcdTIwMTQgcmVsYXRpdmUgcmVzb2x1dGlvbiBmYWlscyBjbG9zZWQpLCBhbmQgdGhlIHByZS1gY2RgIHBhdGhcbiAgLy8gKGBjZCAtYCdzIE9MRFBXRCkuXG4gIGludGVyZmFjZSBEaXJGcmFtZSB7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgICBwcmV2OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgZGlyRnJhbWVzOiBEaXJGcmFtZVtdID0gW3sgZGlyOiBjd2QsIGNlcnRhaW46IHRydWUsIHByZXY6IHVuZGVmaW5lZCB9XTtcblxuICAvKiogVGhlIHBhcnRzIG9mIGEgZnJhbWUgdGhlIHJlc29sdXRpb24gcGF0aHMgbmVlZCAobm8gT0xEUFdEKS4gKi9cbiAgaW50ZXJmYWNlIEZyYW1lIHtcbiAgICBkaXI6IHN0cmluZztcbiAgICBjZXJ0YWluOiBib29sZWFuO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBlZmZlY3RpdmUgZ2l0IHJlcG8gZGlyIGZvciBhIGNhbmRpZGF0ZSAocGxhbiBcdTAwQTc2KTogYW4gYWJzb2x1dGUgYC1DYFxuICAgKiB0YXJnZXQgaXMgc2VsZi1jb250YWluZWQ7IGEgcmVsYXRpdmUgb25lIGNvbXBvc2VzIHdpdGggdGhlIHRyYWNrZWRcbiAgICogZGlyZWN0b3J5OyBubyBgLUNgIHVzZXMgdGhlIHRyYWNrZWQgZGlyZWN0b3J5IGl0c2VsZi4gVW5kZWZpbmVkIHdoZW4gdGhlXG4gICAqIGZyYW1lIGlzIHVuY2VydGFpbiBcdTIwMTQgdGhlIHJlcG8gbG9jYXRpb24gaXMgdW5rbm93biwgZmFpbCBjbG9zZWQuXG4gICAqL1xuICBjb25zdCBnaXREaXJPZiA9IChjOiB7IGRpck92ZXJyaWRlPzogc3RyaW5nIH0sIGZyYW1lOiBGcmFtZSk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgaWYgKGMuZGlyT3ZlcnJpZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyYW1lLmNlcnRhaW4gPyBmcmFtZS5kaXIgOiB1bmRlZmluZWQ7XG4gICAgaWYgKGlzQWJzb2x1dGUoYy5kaXJPdmVycmlkZSkpIHJldHVybiBjLmRpck92ZXJyaWRlO1xuICAgIHJldHVybiBmcmFtZS5jZXJ0YWluID8gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCBjLmRpck92ZXJyaWRlKSA6IHVuZGVmaW5lZDtcbiAgfTtcblxuICAvKiogVGhlIHJ1bm5pbmcgd2luZG93IG9mIHRoZSBjdXJyZW50IHBpcGVsaW5lIGdyb3VwIChwbGFuIFx1MDBBNzMpLiAqL1xuICBpbnRlcmZhY2UgV2luZG93U3RhdGUge1xuICAgIGlkaW9tOiBJZGlvbTtcbiAgICBmaWxlQXJnOiBzdHJpbmc7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgICBkaXJPdmVycmlkZT86IHN0cmluZztcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgfCB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICAgIGxvOiBudW1iZXI7XG4gICAgaGk6IG51bWJlcjtcbiAgICBjb25zdW1lZDogYm9vbGVhbjtcbiAgfVxuICBsZXQgd2luZG93OiBXaW5kb3dTdGF0ZSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0IHdob2xlRmlsZUNhbmRpZGF0ZSA9IChzOiB7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZScgfSk6IFJhd0NhbmRpZGF0ZSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgIGlkaW9tOiBzLmlkaW9tLFxuICAgIGZpbGVBcmc6IHMuZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gIH0pO1xuXG4gIC8qKiBBIHNvdXJjZSdzIHdob2xlLWZpbGUgcmVhZCBhcyBhIGNhbmRpZGF0ZSAoZnMgb3IgZ2l0IHJlc29sdmVyKS4gKi9cbiAgY29uc3Qgc291cmNlQ2FuZGlkYXRlID0gKHNyYzogTmFycm93YWJsZVNvdXJjZSk6IFJhd0NhbmRpZGF0ZSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgIGlkaW9tOiBzcmMuaWRpb20sXG4gICAgZmlsZUFyZzogc3JjLmZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgIHJlc29sdmVyS2luZDogc3JjLnJlc29sdmVyS2luZCxcbiAgICBkaXJPdmVycmlkZTogc3JjLmRpck92ZXJyaWRlXG4gIH0pO1xuXG4gIC8qKiBFbWl0IHRoZSB3aW5kb3cncyB0b3VjaDogb25lIG5hcnJvdyByYW5nZSB3aGVuIGEgc3RkaW4gc2VsZWN0b3IgY29uc3VtZWQgaXQsIGVsc2UgdGhlIHdob2xlLWZpbGUgcmVhZC4gKi9cbiAgY29uc3QgZW1pdFdpbmRvd1RvdWNoID0gKHc6IFdpbmRvd1N0YXRlKSA9PiB7XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IHcuY29uc3VtZWQgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IHcubG8sIGVuZDogdy5oaSB9IDogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9O1xuICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogdy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogdy5maWxlQXJnLFxuICAgICAgICBzcGVjLFxuICAgICAgICByZXNvbHZlcktpbmQ6IHcucmVzb2x2ZXJLaW5kLFxuICAgICAgICBkaXJPdmVycmlkZTogdy5kaXJPdmVycmlkZVxuICAgICAgfSxcbiAgICAgIHsgZGlyOiB3LmRpciwgY2VydGFpbjogdy5jZXJ0YWluIH1cbiAgICApO1xuICB9O1xuXG4gIC8qKlxuICAgKiBPcGVuIGEgd2luZG93IG92ZXIgYSBuYXJyb3dhYmxlIHNvdXJjZS4gQW4gdW5yZXNvbHZhYmxlIHNvdXJjZSBcdTIwMTQgYW5cbiAgICogdW5leHBhbmRlZCBwYXRoLCBhbiB1bmNlcnRhaW4gdHJhY2tlZCBkaXJlY3RvcnksIG9yIGFuIHVucmVzb2x2YWJsZVxuICAgKiBgZ2l0IC1DYCB0YXJnZXQgKHBsYW4gXHUwMEE3NikgXHUyMDE0IGVtaXRzIGFuIGB1bnJlc29sdmVkYCBlbnRyeSBhbmQgbm8gd2luZG93OlxuICAgKiBkb3duc3RyZWFtIHN0ZGluIHNlbGVjdG9ycyBjb25zdW1lIG5vdGhpbmcgKHBsYW4gXHUwMEE3MykuXG4gICAqL1xuICBjb25zdCBpbml0V2luZG93ID0gKHNyYzogTmFycm93YWJsZVNvdXJjZSwgZnJhbWU6IEZyYW1lKSA9PiB7XG4gICAgaWYgKFxuICAgICAgZ2l0RGlyT2Yoc3JjLCBmcmFtZSkgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgKCFmcmFtZS5jZXJ0YWluICYmIHNyYy5yZXNvbHZlcktpbmQgPT09ICdmcycgJiYgIWlzQWJzb2x1dGUoc3JjLmZpbGVBcmcpKVxuICAgICkge1xuICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpOyAvLyB0aGUgZ2F0ZSByZXBvcnRzIHRoZSB1bnJlc29sdmVkIGVudHJ5XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRvdGFsID0gKFxuICAgICAgc3JjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhyZXNvbHZlUGF0aChmcmFtZS5kaXIsIHNyYy5maWxlQXJnKSlcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKGdpdERpck9mKHNyYywgZnJhbWUpISwgc3JjLnJlc29sdmVyS2luZC5yZXYsIHNyYy5maWxlQXJnKVxuICAgICkoKTtcbiAgICBpZiAodG90YWwgPT09IG51bGwpIHtcbiAgICAgIGVtaXRDYW5kaWRhdGUoc291cmNlQ2FuZGlkYXRlKHNyYyksIGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgd2luZG93ID0ge1xuICAgICAgaWRpb206IHNyYy5pZGlvbSxcbiAgICAgIGZpbGVBcmc6IHNyYy5maWxlQXJnLFxuICAgICAgZGlyOiBmcmFtZS5kaXIsXG4gICAgICBjZXJ0YWluOiBmcmFtZS5jZXJ0YWluLFxuICAgICAgZGlyT3ZlcnJpZGU6IHNyYy5kaXJPdmVycmlkZSxcbiAgICAgIHJlc29sdmVyS2luZDogc3JjLnJlc29sdmVyS2luZCxcbiAgICAgIGxvOiAxLFxuICAgICAgaGk6IHRvdGFsLFxuICAgICAgY29uc3VtZWQ6IGZhbHNlXG4gICAgfTtcbiAgfTtcblxuICAvKipcbiAgICogQXBwbHkgYSBzdGRpbiBzZWxlY3RvcidzIHRyYW5zZm9ybSB0byB0aGUgbGl2ZSB3aW5kb3csIGNsYW1wZWQgdG8gdGhlXG4gICAqIGN1cnJlbnQgd2luZG93LiBBIG5hcnJvd2luZyB0cmFuc2Zvcm0gbWFya3MgdGhlIHdpbmRvdyBjb25zdW1lZCAodGhlXG4gICAqIGVtaXR0ZWQgdG91Y2ggaXMgdGhlIG5hcnJvdyByYW5nZSwgbm90IHRoZSB3aG9sZS1maWxlIHJlYWQpLiBSZXR1cm5zXG4gICAqIGZhbHNlIHdoZW4gdGhlIHRyYW5zZm9ybSBlbXB0aWVzIHRoZSB3aW5kb3cgXHUyMDE0IHRoZSBwcmUtdHJhbnNmb3JtIHdpbmRvd1xuICAgKiBzdXJ2aXZlcyAod2hhdCBhIHJlYWRlciBhY3R1YWxseSBjb25zdW1lZCkgYW5kIHN0YXlzIHVuY29uc3VtZWQuXG4gICAqL1xuICBjb25zdCBhcHBseVdpbmRvd1RyYW5zZm9ybSA9IChzZWw6IFN0ZGluU2VsZWN0b3IpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCB3ID0gd2luZG93ITtcbiAgICBjb25zdCBsbyA9IHcubG87XG4gICAgY29uc3QgaGkgPSB3LmhpO1xuICAgIGxldCBuTG86IG51bWJlcjtcbiAgICBsZXQgbkhpOiBudW1iZXI7XG4gICAgaWYgKHNlbC5raW5kID09PSAnaGVhZCcpIHtcbiAgICAgIG5MbyA9IGxvO1xuICAgICAgbkhpID0gbG8gKyBzZWwuY291bnQgLSAxO1xuICAgIH0gZWxzZSBpZiAoc2VsLmtpbmQgPT09ICd0YWlsJykge1xuICAgICAgaWYgKHNlbC5mcm9tU3RhcnQpIHtcbiAgICAgICAgbkxvID0gbG8gKyBzZWwuY291bnQgLSAxO1xuICAgICAgICBuSGkgPSBoaTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5MbyA9IGhpIC0gc2VsLmNvdW50ICsgMTtcbiAgICAgICAgbkhpID0gaGk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5MbyA9IGxvICsgc2VsLnJhbmdlc1swXS5zdGFydCAtIDE7XG4gICAgICBuSGkgPSBzZWwucmFuZ2VzWzBdLmVuZCA9PT0gJyQnID8gaGkgOiBsbyArIHNlbC5yYW5nZXNbMF0uZW5kIC0gMTtcbiAgICB9XG4gICAgbkxvID0gTWF0aC5tYXgobkxvLCBsbyk7XG4gICAgbkhpID0gTWF0aC5taW4obkhpLCBoaSk7XG4gICAgaWYgKG5MbyA+IG5IaSkgcmV0dXJuIGZhbHNlO1xuICAgIHcubG8gPSBuTG87XG4gICAgdy5oaSA9IG5IaTtcbiAgICB3LmNvbnN1bWVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICAvKiogQSBtdWx0aS1yYW5nZSBzdGRpbiBzZWQgZGVsaXZlcnMgZWFjaCByYW5nZSBhcyBpdHMgb3duIHRvdWNoIGFuZCBzZXZlcnM7IGVtcHR5IGNsYW1wcyBkcm9wLiAqL1xuICBjb25zdCBlbWl0TXVsdGlSYW5nZSA9IChyYW5nZXM6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfCAnJCcgfVtdKSA9PiB7XG4gICAgY29uc3QgdyA9IHdpbmRvdyE7XG4gICAgbGV0IGVtaXR0ZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHIgb2YgcmFuZ2VzKSB7XG4gICAgICBjb25zdCBtTG8gPSBNYXRoLm1heCh3LmxvLCB3LmxvICsgci5zdGFydCAtIDEpO1xuICAgICAgY29uc3QgbUhpID0gTWF0aC5taW4ody5oaSwgci5lbmQgPT09ICckJyA/IHcuaGkgOiB3LmxvICsgci5lbmQgLSAxKTtcbiAgICAgIGlmIChtTG8gPiBtSGkpIGNvbnRpbnVlO1xuICAgICAgZW1pdHRlZCA9IHRydWU7XG4gICAgICBlbWl0Q2FuZGlkYXRlKFxuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgaWRpb206IHcuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogdy5maWxlQXJnLFxuICAgICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogbUxvLCBlbmQ6IG1IaSB9LFxuICAgICAgICAgIHJlc29sdmVyS2luZDogdy5yZXNvbHZlcktpbmQsXG4gICAgICAgICAgZGlyT3ZlcnJpZGU6IHcuZGlyT3ZlcnJpZGVcbiAgICAgICAgfSxcbiAgICAgICAgeyBkaXI6IHcuZGlyLCBjZXJ0YWluOiB3LmNlcnRhaW4gfVxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKCFlbWl0dGVkKSBlbWl0V2luZG93VG91Y2godyk7IC8vIGV2ZXJ5IHJhbmdlIGRyb3BwZWQgXHUyMDE0IHRoZSBwcmUtdHJhbnNmb3JtIHdpbmRvdyBzdXJ2aXZlc1xuICB9O1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoYzogUmF3Q2FuZGlkYXRlLCBmcmFtZTogRnJhbWUpID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFBsYW4gXHUwMEE3NiBjZXJ0YWludHk6IGEgcmVsYXRpdmUgcGF0aCBhZ2FpbnN0IGFuIHVuY2VydGFpbiBkaXJlY3RvcnksIG9yIGFcbiAgICAvLyBnaXQgY2FuZGlkYXRlIHdob3NlIHJlcG8gZnJhbWUgY2Fubm90IGJlIGNvbXBvc2VkLCBpcyB1bnJlc29sdmFibGUgXHUyMDE0XG4gICAgLy8gbmV2ZXIgYSBndWVzc2VkIHRvdWNoLiBBYnNvbHV0ZSBwYXRocyBhcmUgdW5hZmZlY3RlZC5cbiAgICBpZiAoYy5yZXNvbHZlcktpbmQgPT09ICdmcycpIHtcbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZShjLmZpbGVBcmcpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGdpdERpck9mKGMsIGZyYW1lKSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAndGhlIGdpdCAtQyB0YXJnZXQgY2Fubm90IGJlIHJlc29sdmVkIGFnYWluc3QgdGhlIHRyYWNrZWQgZGlyZWN0b3J5J1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIEEgZ2l0IGNhbmRpZGF0ZSdzIHBhdGggcmVzb2x2ZXMgaW5zaWRlIGl0cyByZXBvIGRpciAoYC1DYCB0YXJnZXQgb3IgdGhlXG4gICAgLy8gdHJhY2tlZCBkaXJlY3RvcnkpLCBub3QgdGhlIHByb2Nlc3MgZGlyIFx1MjAxNCBwbGFuIFx1MDBBNzYuXG4gICAgY29uc3QgcmVzb2x1dGlvbkRpciA9IGMucmVzb2x2ZXJLaW5kID09PSAnZnMnID8gZnJhbWUuZGlyIDogZ2l0RGlyT2YoYywgZnJhbWUpITtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChyZXNvbHV0aW9uRGlyLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMocmVzb2x1dGlvbkRpciwgYy5yZXNvbHZlcktpbmQucmV2LCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoYy5zcGVjLCB0b3RhbExpbmVzKTtcbiAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYWJzb2x1dGVQYXRoLFxuICAgICAgICByZWFzb246ICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIGdpdCByZXYvcGF0aCBub3QgZm91bmQpJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCB9XG4gICAgfSk7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBleHBhbmRlZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGl0ZW0gPSBleHBhbmRlZFtpXTtcbiAgICB3aGlsZSAoZGlyRnJhbWVzLmxlbmd0aCA+IGl0ZW0uZGlyRnJhbWUgKyAxKSBkaXJGcmFtZXMucG9wKCk7XG4gICAgd2hpbGUgKGRpckZyYW1lcy5sZW5ndGggPCBpdGVtLmRpckZyYW1lICsgMSkgZGlyRnJhbWVzLnB1c2goeyAuLi5kaXJGcmFtZXNbZGlyRnJhbWVzLmxlbmd0aCAtIDFdIH0pO1xuICAgIGNvbnN0IGZyYW1lID0gZGlyRnJhbWVzW2RpckZyYW1lcy5sZW5ndGggLSAxXTtcblxuICAgIC8vIGAkUFdEYCByZXNvbHZlcyB0byB0aGUgdHJhY2tlZCBkaXJlY3RvcnksIG5vdCB0aGUgc3RhbGUgaG9vayBlbnYgKHBsYW5cbiAgICAvLyBcdTAwQTc2KSBcdTIwMTQgdGhlIHBlci1zdGFnZSBlbnYgb3ZlcnJpZGVzIGl0IHdpdGggdGhlIGNvbXBvc2VkIGZyYW1lLlxuICAgIGNvbnN0IHN0YWdlRW52ID0geyAuLi5lbnYsIFBXRDogZnJhbWUuZGlyIH07XG5cbiAgICBjb25zdCBwaXBlUHJlY2VkZXMgPSBpdGVtLnByZWNlZGVkQnkgPT09ICdwaXBlJztcbiAgICBjb25zdCBwaXBlRm9sbG93cyA9IGV4cGFuZGVkW2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIGV4cGFuZGVkW2kgKyAxXS5wcmVjZWRlZEJ5ID09PSAncGlwZSc7XG5cbiAgICAvLyBBIHBpcGVsaW5lIGdyb3VwIGlzIGRvbmUgYXQgaXRzIG5leHQgbm9uLXBpcGUgc3RhZ2U6IGZsdXNoIHRoZSB3aW5kb3dcbiAgICAvLyAob25lIG5hcnJvdyB0b3VjaCBpZiBhIHN0ZGluIHNlbGVjdG9yIGNvbnN1bWVkIHRoZSBzb3VyY2UsIGVsc2UgdGhlXG4gICAgLy8gY29uc2VydmF0aXZlIHdob2xlLWZpbGUgcmVhZCBcdTIwMTQgcGxhbiBcdTAwQTczLCBlbWl0KS5cbiAgICBpZiAoIXBpcGVQcmVjZWRlcyAmJiB3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgd2luZG93ID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBgY2RgIGJvb2trZWVwaW5nIChwbGFuIFx1MDBBNzYpIHJ1bnMgYmVmb3JlIHRoZSBleGVjIGdhdGU6IGEgbWF5LWhhdmUtcnVuXG4gICAgLy8gKGAndW5rbm93bidgKSBjZCBwb2lzb25zIGNlcnRhaW50eSBldmVuIHRob3VnaCBpdHMgb3duIHN0YWdlIGVtaXRzXG4gICAgLy8gbm90aGluZywgYW5kIGEgc2tpcHBlZCAoYCdubydgKSBjZCBsZWF2ZXMgdGhlIGRpciB1bmNoYW5nZWQuXG4gICAgY29uc3QgY2RBcmd2ID0gc3RyaXBGb3JFbWlzc2lvbihzdHJpcFJlZGlyZWN0cyhhcmd2T2YoaXRlbS50ZXh0KSA/PyBbXSkpO1xuICAgIGlmIChjZEFyZ3ZbMF0gPT09ICdjZCcgJiYgIWl0ZW0uaW5QaXBlbGluZSkge1xuICAgICAgaWYgKGl0ZW0uZXhlYyA9PT0gJ3llcycpIHtcbiAgICAgICAgLy8gVGhlIHRhcmdldCBleHBhbmRzIGxpa2UgYW55IG90aGVyIHdvcmQgXHUyMDE0IGBjZCBcIiRXT1JLU1BBQ0VfUEFUSFwiYFxuICAgICAgICAvLyBmaW5hbGx5IHdvcmtzIChwbGFuIFx1MDBBNzcpLiBCYXJlIGBjZGAgaXMgYCRIT01FYCB2aWEgdGhlIHNhbWVcbiAgICAgICAgLy8gZXhwYW5zaW9uIG1hY2hpbmVyeS5cbiAgICAgICAgY29uc3QgZXhwYW5kZWRBcmd2ID0gc3RyaXBGb3JFbWlzc2lvbihcbiAgICAgICAgICBzdHJpcFJlZGlyZWN0cyhhcmd2T2YoZXhwYW5kVmFyaWFibGVzKGl0ZW0udGV4dCwgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpKSA/PyBbXSlcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXhwYW5kZWRBcmd2WzFdO1xuICAgICAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQgfHwgdGFyZ2V0ID09PSAnficgfHwgdGFyZ2V0LnN0YXJ0c1dpdGgoJ34vJykpIHtcbiAgICAgICAgICAvLyBCYXJlIGBjZGAgaXMgYCRIT01FYDsgYSBgfmAvYH4vXHUyMDI2YCB0YXJnZXQgaXMgdGhlIHNhbWUgdGlsZGVcbiAgICAgICAgICAvLyBleHBhbnNpb24gKHBsYW4gXHUwMEE3NikgXHUyMDE0IHRoZSBhbGxvd2xpc3RlZCBIT01FIHZpYSB0aGUgZXhwYW5zaW9uXG4gICAgICAgICAgLy8gbWFjaGluZXJ5LCBjZXJ0YWluIHdoZW4gaXQgcmVzb2x2ZXMsIHVuY2VydGFpbiBvdGhlcndpc2UuXG4gICAgICAgICAgY29uc3QgaG9tZSA9IGV4cGFuZFZhcmlhYmxlcygnJEhPTUUnLCBpdGVtLmFzc2lnbm1lbnRzLCBzdGFnZUVudik7XG4gICAgICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGhvbWUpKSBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBmcmFtZS5wcmV2ID0gZnJhbWUuZGlyO1xuICAgICAgICAgICAgZnJhbWUuZGlyID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB0YXJnZXQgPT09IHVuZGVmaW5lZCA/IGhvbWUgOiBob21lICsgdGFyZ2V0LnNsaWNlKDEpKTtcbiAgICAgICAgICAgIGZyYW1lLmNlcnRhaW4gPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQgPT09ICctJykge1xuICAgICAgICAgIC8vIGBjZCAtYCBpcyBiYXNoJ3MgT0xEUFdEIFx1MjAxNCB0aGUgcHJldmlvdXMgdHJhY2tlZCBwYXRoLiBXaXRoIG5vXG4gICAgICAgICAgLy8gcHJldmlvdXMgcGF0aCB0aGUgY2QgZmFpbHMgYW5kIHRoZSBzaGVsbCBzdGF5cyBwdXQuXG4gICAgICAgICAgaWYgKGZyYW1lLnByZXYgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3Qgb2xkID0gZnJhbWUuZGlyO1xuICAgICAgICAgICAgZnJhbWUuZGlyID0gZnJhbWUucHJldjtcbiAgICAgICAgICAgIGZyYW1lLnByZXYgPSBvbGQ7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC5zdGFydHNXaXRoKCd+JykpIHtcbiAgICAgICAgICAvLyBBIGB+dXNlcmAtc3R5bGUgdGFyZ2V0IHJlc29sdmVzIHRvIHRoYXQgdXNlcidzIGhvbWUgXHUyMDE0IHVua25vd24gdG9cbiAgICAgICAgICAvLyB0aGUgd2FsazogYmFzaCBtb3ZlZCB0byBhbiB1bmtub3duIGRpciBvciBmYWlsZWQgYW5kIHN0YXllZCwgYm90aFxuICAgICAgICAgIC8vIGxpdmUsIHNvIGNlcnRhaW50eSBpcyBwb2lzb25lZC5cbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAobG9va3NVbnJlc29sdmFibGUodGFyZ2V0KSkge1xuICAgICAgICAgIC8vIFZhcmlhYmxlL2dsb2IgdGFyZ2V0OiBiYXNoIGVpdGhlciBtb3ZlZCB0byBhbiB1bmtub3duIGRpciBvclxuICAgICAgICAgIC8vIGZhaWxlZCBhbmQgc3RheWVkIFx1MjAxNCBib3RoIGxpdmUsIHNvIGNlcnRhaW50eSBpcyBwb2lzb25lZC5cbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZnJhbWUucHJldiA9IGZyYW1lLmRpcjtcbiAgICAgICAgICBmcmFtZS5kaXIgPSByZXNvbHZlUGF0aChmcmFtZS5kaXIsIHRhcmdldCk7XG4gICAgICAgICAgZnJhbWUuY2VydGFpbiA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaXRlbS5leGVjID09PSAndW5rbm93bicpIHtcbiAgICAgICAgZnJhbWUuY2VydGFpbiA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7IC8vIGEgY2QgbmV2ZXIgbWF0Y2hlcyBhIHNvdXJjZS9jb25zdW1lciBpZGlvbVxuICAgIH1cblxuICAgIGlmIChpdGVtLmV4ZWMgIT09ICd5ZXMnKSB7XG4gICAgICAvLyBBIGRlYWQgb3IgdW5rbm93biBzdGFnZSBuZXZlciBydW5zIFx1MjAxNCBubyB0b3VjaCwgbm8gc2lkZSBlZmZlY3RzLlxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IGl0ZW0udGV4dC5tYXRjaCgvXl9faGVyZWRvY18oXFxkKylfXyQvKTtcbiAgICBpZiAoaGVyZWRvY1JlZikge1xuICAgICAgLy8gVGhlIGhlcmVkb2Mtd3JpdGUgc3RhZ2UgZG9lc24ndCByZWFkIHRoZSBwaXBlIFx1MjAxNCBhbGlnbm1lbnQgc2V2ZXJzLlxuICAgICAgaWYgKHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHcudGFyZ2V0KSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogdy50YXJnZXQsXG4gICAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZSh3LnRhcmdldCkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IHcudGFyZ2V0LFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB3LnRhcmdldCk7XG4gICAgICBjb25zdCBib2R5TGluZXMgPSB3LmJvZHkubGVuZ3RoID09PSAwID8gMCA6IHcuYm9keS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICAgICAgaWYgKGJvZHlMaW5lcyA9PT0gMCkge1xuICAgICAgICAvLyBgY2F0ID4gZiA8PCdFT0YnYCB3aXRoIGFuIGVtcHR5IGJvZHkgdHJ1bmNhdGVzIHRoZSBmaWxlIHRvIGVtcHR5IFx1MjAxNCBhXG4gICAgICAgIC8vIHJlYWwgd3JpdGUgdGhhdCBtdXN0IHByb2R1Y2UgYSB0b3VjaCAod2hvbGUtZmlsZSwgdmlhIGBib2R5OiAnJ2ApLlxuICAgICAgICAvLyBgPj5gIHdpdGggYW4gZW1wdHkgYm9keSBhcHBlbmRzIG5vdGhpbmcgYW5kIGlzIGEgZ2VudWluZSBuby1vcC5cbiAgICAgICAgaWYgKHcucmVkaXJlY3QgIT09ICc+JykgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IDEsIGFic29sdXRlUGF0aCwgYm9keTogJycsIHJlZGlyZWN0OiB3LnJlZGlyZWN0IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICAgIHcucmVkaXJlY3QgPT09ICc+JyA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogMSwgZW5kOiBib2R5TGluZXMgfSA6IHsga2luZDogJ2FwcGVuZExpbmVzJywgY291bnQ6IGJvZHlMaW5lcyB9O1xuICAgICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhzcGVjLCBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKSk7XG4gICAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgICByZWFzb246ICdhcHBlbmQgdGFyZ2V0OiBjb3VsZCBub3QgcmVhZCBleGlzdGluZyBmaWxlIHRvIGZpbmQgaXRzIGN1cnJlbnQgbGVuZ3RoJ1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCwgbGluZUVuZDogcmFuZ2UubGluZUVuZCwgYWJzb2x1dGVQYXRoLCBib2R5OiB3LmJvZHksIHJlZGlyZWN0OiB3LnJlZGlyZWN0IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBEaXNwYXRjaCBhcmd2IChwbGFuIFx1MDBBNzcpOiB0aGUgc3RhZ2UncyByYXcgdGV4dCBpcyBleHBhbmRlZCBiZWZvcmVcbiAgICAvLyB0b2tlbml6aW5nIFx1MjAxNCBhIHJlc29sdmVkIGBjYXQgXCIkV09SS1NQQUNFX1BBVEgvZlwiYCBuYXJyb3dzIHRocm91Z2ggYVxuICAgIC8vIHBpcGVsaW5lIGV4YWN0bHkgbGlrZSBgY2F0IGZgLiBSZWRpcmVjdHMgYXJlIHN0cmlwcGVkIGZpcnN0ICh0aGVcbiAgICAvLyByZWFkLXNpZGUgcmVjb3ZlcnksIFx1MDBBNzQpLCB0aGVuIHRoZSB0cmFuc3BhcmVudCB3cmFwcGVycyAoXHUwMEE3NSksIHRoZW4gdGhlXG4gICAgLy8gZW1pc3Npb24tc2lkZSBgIWAvYGNvbW1hbmRgL2BleGVjYCBzdHJpcCBcdTIwMTQgc28gYGNvbW1hbmQgLXAgc2VkIFx1MjAyNmAgc3RpbGxcbiAgICAvLyByZWFjaGVzIGBzZWRgLlxuICAgIGNvbnN0IHJhd0FyZ3YgPSBhcmd2T2YoZXhwYW5kVmFyaWFibGVzKGl0ZW0udGV4dCwgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpKSA/PyBbXTtcbiAgICBjb25zdCBzdHJpcHBlZCA9IHN0cmlwRm9yRW1pc3Npb24oc3RyaXBXcmFwcGVycyhzdHJpcFJlZGlyZWN0cyhyYXdBcmd2KSkpO1xuICAgIGlmIChzdHJpcHBlZC5sZW5ndGggPT09IDApIHtcbiAgICAgIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBBIHJlc2lkdWFsIHJlZGlyZWN0IHRva2VuIChgPnxgLCBhbnl0aGluZyBlbHNlIGJlZ2lubmluZyB3aXRoIGA+YC9gPGBcbiAgICAvLyB0aGF0IHN0cmlwUmVkaXJlY3RzIGxlZnQgYWxvbmUsIFx1MDBBNzQpIGZhaWxzIGNsb3NlZDogdGhlIHN0YWdlIG1hdGNoZXNcbiAgICAvLyBub3RoaW5nIFx1MjAxNCBubyBzb3VyY2UsIG5vIHNlbGVjdG9yLCBubyB0b3VjaC5cbiAgICBpZiAoc3RyaXBwZWQuc29tZSgodykgPT4gdy5zdGFydHNXaXRoKCc+JykgfHwgdy5zdGFydHNXaXRoKCc8JykpKSB7XG4gICAgICBpZiAod2luZG93ICE9PSBudWxsKSB7XG4gICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVGhlIHNvdXJjZSBvZiBhIHBpcGVsaW5lIGdyb3VwIChwbGFuIFx1MDBBNzMpOiBhIG5hcnJvd2FibGUgYGNhdGAvYG5sYCBvclxuICAgIC8vIGBnaXQgc2hvd2Agb3BlbnMgdGhlIHdpbmRvdyBhbmQgZGVmZXJzIGl0cyB3aG9sZS1maWxlIHJlYWQ7IGFcbiAgICAvLyBtdWx0aS1maWxlL3N0ZGluLW1peGVkIHNvdXJjZSBlbWl0cyBlYWNoIGZpbGUncyBjb25zZXJ2YXRpdmUgd2hvbGUtZmlsZVxuICAgIC8vIHJlYWQgYW5kIG5ldmVyIG5hcnJvd3M7IGEgc3Rkb3V0LWZvcm0gcmVkaXJlY3Qgb24gdGhlIHNvdXJjZSBlbXB0aWVzXG4gICAgLy8gdGhlIHBpcGUgXHUyMDE0IGl0cyB3aG9sZS1maWxlIHJlYWQgc3RhbmRzIGFuZCBkb3duc3RyZWFtIGNvbnN1bWVzIG5vdGhpbmcuXG4gICAgaWYgKCFwaXBlUHJlY2VkZXMgJiYgcGlwZUZvbGxvd3MgJiYgKHN0cmlwcGVkWzBdID09PSAnY2F0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ25sJyB8fCBzdHJpcHBlZFswXSA9PT0gJ2dpdCcpKSB7XG4gICAgICBjb25zdCBzcmMgPSBhbmFseXplU291cmNlKHN0cmlwcGVkKTtcbiAgICAgIHN3aXRjaCAoc3JjLmtpbmQpIHtcbiAgICAgICAgY2FzZSAnbm9uZSc6XG4gICAgICAgICAgYnJlYWs7IC8vIGZhbGwgdGhyb3VnaCB0byB0aGUgb3JkaW5hcnkgZGlzcGF0Y2hcbiAgICAgICAgY2FzZSAnZ2l0VW5yZXNvbHZlZCc6XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgICAgICBmaWxlQXJnOiBzcmMuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogc3JjLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICBjYXNlICd1bm5hcnJvd2FibGUnOiB7XG4gICAgICAgICAgZm9yIChjb25zdCBmIG9mIHNyYy5maWxlcykgZW1pdENhbmRpZGF0ZSh3aG9sZUZpbGVDYW5kaWRhdGUoZiksIGZyYW1lKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjYXNlICduYXJyb3dhYmxlJzpcbiAgICAgICAgY2FzZSAnZ2l0Jzoge1xuICAgICAgICAgIGlmIChoYXNTdGRvdXRSZWRpcmVjdChyYXdBcmd2KSkge1xuICAgICAgICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbml0V2luZG93KHNyYywgZnJhbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEEgcGlwZSBtZW1iZXIgb2YgYSBsaXZlIHdpbmRvdyAocGxhbiBcdTAwQTczLCBjb25zdW1lcnMpOiBhIHN0ZGluXG4gICAgLy8gbGluZS1zZWxlY3RvciB0cmFuc2Zvcm1zIHRoZSB3aW5kb3cgd2hpbGUgYWxpZ25lZDsgYSBub24tY29uc3VtZXIgb3JcbiAgICAvLyB1bnJlY29nbml6ZWQgc3RhZ2Ugc2V2ZXJzIFx1MjAxNCB0aGUgdG91Y2ggaXMgdGhlIHdpbmRvdyBhdCB0aGUgc2V2ZXIgcG9pbnRcbiAgICAvLyBhbmQgbGF0ZXIgc3RhZ2VzIGFyZSBpZ25vcmVkIGZvciB3aW5kb3cgcHVycG9zZXMuIEEgc3Rkb3V0LWZvcm1cbiAgICAvLyByZWRpcmVjdCBvbiB0aGUgc3RhZ2Ugb25seSBtb3ZlcyBpdHMgb3duIG91dHB1dCBcdTIwMTQgaXQgcmVhZHMgbm9ybWFsbHksXG4gICAgLy8gdGhlbiBzZXZlcnMuXG4gICAgaWYgKHBpcGVQcmVjZWRlcyAmJiB3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHNlbCA9IGNsYXNzaWZ5U3RkaW5TZWxlY3RvcihzdHJpcHBlZCk7XG4gICAgICBpZiAoc2VsICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChzZWwua2luZCA9PT0gJ3NlZCcgJiYgc2VsLnJhbmdlcy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgZW1pdE11bHRpUmFuZ2Uoc2VsLnJhbmdlcyk7XG4gICAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhcHBseVdpbmRvd1RyYW5zZm9ybShzZWwpO1xuICAgICAgICAgIGlmIChoYXNTdGRvdXRSZWRpcmVjdChyYXdBcmd2KSkge1xuICAgICAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT3JkaW5hcnkgZGlzcGF0Y2g6IGEgY2F0L25sIHN0YWdlJ3Mgb3duIHdob2xlLWZpbGUgcmVhZCAoYSBsb25lIHN0YWdlXG4gICAgLy8gb3IgYSBub24tc291cmNlIHBpcGUgbWVtYmVyKSwgYW5kIHRoZSBsaW5lLXNlbGVjdG9yL2dpdCBpZGlvbXMuXG4gICAgaWYgKHN0cmlwcGVkWzBdID09PSAnY2F0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ25sJykge1xuICAgICAgY29uc3Qgc3JjID0gYW5hbHl6ZVNvdXJjZShzdHJpcHBlZCk7XG4gICAgICBpZiAoc3JjLmtpbmQgPT09ICduYXJyb3dhYmxlJykge1xuICAgICAgICBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZSh7IGZpbGVBcmc6IHNyYy5maWxlQXJnLCBpZGlvbTogc3JjLmlkaW9tIH0pLCBmcmFtZSk7XG4gICAgICB9IGVsc2UgaWYgKHNyYy5raW5kID09PSAndW5uYXJyb3dhYmxlJykge1xuICAgICAgICBmb3IgKGNvbnN0IGYgb2Ygc3JjLmZpbGVzKSBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZShmKSwgZnJhbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoc3RyaXBwZWQpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgZnJhbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIFBhc3MgYG9wdHMuY3dkYCAoZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgKSBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnM7IGBvcHRzLmVudmAvYG9wdHMuYWxsb3dsaXN0YCBmZWVkIHRoZSBQaGFzZSAzIGFsbG93bGlzdGVkIHZhcmlhYmxlIHJlc29sdXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgb3B0cyk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqL1xuXG4vKipcbiAqIFRoZSBub3JtYWxpemVkIGJvdW5kYXJ5IG9wZXJhdG9ycyBgc3BsaXRUb3BMZXZlbGAgZW1pdHMgXHUyMDE0IHRoZSBzaW5nbGVcbiAqIHJlcHJlc2VudGF0aW9uIGJvdGggYWRhcHRlcnMgY29uc3VtZS5cbiAqL1xuZXhwb3J0IHR5cGUgT3BlcmF0b3IgPSAncGlwZScgfCAnYW5kJyB8ICdvcicgfCAnc2VtaWNvbG9uJyB8ICduZXdsaW5lJyB8ICdiYWNrZ3JvdW5kJyB8ICdzdGFydCc7XG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZCAoJ3BpcGUnIGZvciBhIHBpcGVsaW5lIHN0YWdlLCAnYW5kJyBmb3IgYCYmYCwgJ29yJyBmb3IgYHx8YCwgJ3NlbWljb2xvbicgZm9yIGA7YCwgJ25ld2xpbmUnIGZvciBhIG5ld2xpbmUgc2VwYXJhdG9yLCAnYmFja2dyb3VuZCcgZm9yIGAmYCwgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQpLiAqL1xuICBwcmVjZWRlZEJ5OiBPcGVyYXRvcjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBzdGFnZSdzIHN0ZGluIGlzIGZlZCBieSBhIGA8PGAvYDw8LWAgaGVyZWRvYyBib2R5LiBUaGVcbiAgICogb3BlcmF0b3IrZGVsaW1pdGVyIGFyZSBzdHJpcHBlZCBmcm9tIGB0ZXh0YCAodGhlIHN0YWdlIGtlZXBzIGEgcGxhaW5cbiAgICogYXJndiksIHNvIGEgY29uc3VtZXIgdGhhdCBzY2FucyBmb3IgYW4gdW5xdW90ZWQgYDxgIGFzIGEgc3RkaW4gcmVkaXJlY3RcbiAgICogY2Fubm90IHNlZSB0aGUgaGVyZWRvYyBpbiB0aGUgdGV4dCBcdTIwMTQgdGhpcyBmbGFnIHN1cmZhY2VzIGl0LlxuICAgKi9cbiAgaGVyZWRvYz86IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgdmVyZGljdCBraW5kcyBgc3BsaXRUb3BMZXZlbGAgY2FuIHJldHVybiB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IgKHBsYW4gXHUwMEE3MSkuICovXG5leHBvcnQgdHlwZSBNYWxmb3JtZWRWZXJkaWN0ID1cbiAgfCAndW5jbG9zZWQtcXVvdGUnXG4gIHwgJ3VuYmFsYW5jZWQtcGFyZW4nXG4gIHwgJ2RhbmdsaW5nLW9wZXJhdG9yJ1xuICB8ICdwaXBlLWJhbmcnXG4gIHwgJ3VudGVybWluYXRlZC1oZXJlZG9jJ1xuICB8ICd1bmNsb3NlZC1icmFjZSdcbiAgfCAndW5jbG9zZWQtY2FzZSdcbiAgfCAndW5jbG9zZWQtY29uc3RydWN0JztcblxuLyoqIFRoZSByZXN1bHQgb2YgYSB0b3AtbGV2ZWwgc3BsaXQ6IHRoZSBzdGFnZSBsaXN0LCBwbHVzIGEgYG1hbGZvcm1lZGAgdmVyZGljdCB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwbGl0UmVzdWx0IHtcbiAgc3RhZ2VzOiBTaW1wbGVDb21tYW5kW107XG4gIC8qKlxuICAgKiBTZXQgd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yIFx1MjAxNCBiYXNoIHJlamVjdHMgdGhlIGVudGlyZSBsaXN0IGF0XG4gICAqIHBhcnNlIHRpbWUgKGV4aXQgMiwgbm90aGluZyBleGVjdXRlZCksIHNvIGFueSBzdGFnZS1kZXJpdmVkIHRvdWNoIHdvdWxkIGJlXG4gICAqIGEgcGhhbnRvbS4gVGhlIHJlamVjdGlvbiBpcyBsaXN0LXNjb3BlZCBhbmQgdGVybWluYWwgKHBsYW4gXHUwMEE3MSk6IHRoZSBzdGFnZVxuICAgKiBsaXN0IGtlZXBzIGV2ZXJ5IHN0YWdlIGZyb20gY29tcGxldGVkIGVhcmxpZXIgbGlzdHMsIGRyb3BzIHRoZSByZWplY3RpbmdcbiAgICogbGlzdCdzIG93biBzdGFnZXMsIGFuZCBzdG9wcyBhdCBpdCBcdTIwMTQgZXZlcnkgbGF0ZXIgdW5pdCBpcyBkZWFkLlxuICAgKi9cbiAgbWFsZm9ybWVkPzogTWFsZm9ybWVkVmVyZGljdDtcbn1cblxuLyoqIFRoZSBjb25zdHJ1Y3Qga2luZHMgdGhlIGtpbmQtbWF0Y2hlZCBzdGFjayB0cmFja3MgKHBsYW4gXHUwMEE3MykuICovXG50eXBlIENvbnN0cnVjdEtpbmQgPSAnaWYnIHwgJ2xvb3AnIHwgJ2ZvcicgfCAnc2VsZWN0JyB8ICdicmFjZSc7XG5cbi8qKiBPbmUgb3BlbiBjb25zdHJ1Y3Q6IGl0cyBraW5kLCBhbmQgd2hldGhlciBhIGJvZHkgd29yZCBoYXMgYmVlbiBzZWVuLiAqL1xuaW50ZXJmYWNlIE9wZW5Db25zdHJ1Y3Qge1xuICBraW5kOiBDb25zdHJ1Y3RLaW5kO1xuICAvKipcbiAgICogV2hldGhlciBhIGJvZHkgaGFzIHN0YXJ0ZWQuIEZvciBgaWZgIHRoZSBib2R5IHN0YXJ0cyBhdCBgdGhlbmAvYGVsc2VgL1xuICAgKiBgZWxpZmAsIGZvciBsb29wcyBhdCBgZG9gLCBmb3IgYnJhY2UgZ3JvdXBzIGF0IGFueSBjb21tYW5kIHdvcmQgXHUyMDE0IGFcbiAgICogY2xvc2VyIHdpdGggbm8gYm9keSAoYGlmIHg7IGZpYCwgYHsgfWApIGlzIGEgQmFzaCBwYXJzZSBlcnJvci5cbiAgICovXG4gIGJvZHk6IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgY2FzZSByZWdpb24ncyBwb3NpdGlvbiBzdGF0ZSAocGxhbiBcdTAwQTczKS4gKi9cbnR5cGUgQ2FzZVBvcyA9ICdzdWJqZWN0JyB8ICdwYXR0ZXJuLXN0YXJ0JyB8ICdwYXR0ZXJuJyB8ICdjb21tYW5kJztcblxuLyoqIEFuIG9wZW4gY2FzZSByZWdpb246IG9wYXF1ZSBjb250ZW50IG93bmVkIGJ5IHRoZSBjYXNlIHNjYW4uICovXG5pbnRlcmZhY2UgQ2FzZVJlZ2lvbiB7XG4gIHBvczogQ2FzZVBvcztcbiAgLyoqIEluIGEgYGNvbW1hbmRgIHBvc2l0aW9uOiB3aGV0aGVyIHRoZSBjdXJyZW50IGxpc3QgaXRlbSBpcyBzdGlsbCBlbXB0eSAob25seSBgKWAsIGA7YCwgYCZgLCBhbmQgbmV3bGluZXMgcmVzZXQgaXQpLiAqL1xuICBjbWRFbXB0eTogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWdpb24ncyBvd24gcGFyZW4gZGVwdGggXHUyMDE0IGdsb2JhbCBwYXJlbiBkZXB0aCBpcyBmcm96ZW4gd2hpbGUgdGhlIHJlZ2lvbiBpcyBvcGVuICh0aGUgcmVnaW9uIGlzIG5vdCBhIHN0YWNrOyBpdCBvdXRsaXZlcyBwYXJlbiBjbG9zZXMpLiAqL1xuICBsb2NhbERlcHRoOiBudW1iZXI7XG59XG5cbi8qKiBBIHBlbmRpbmcgaGVyZWRvYyB3aG9zZSBib2R5IGhhcyBub3Qgc3RhcnRlZCB5ZXQgKG9yIHdob3NlIGJvZHkgaXMgYmVpbmcgc2Nhbm5lZCkuICovXG5pbnRlcmZhY2UgUGVuZGluZ0hlcmVkb2Mge1xuICAvKiogVGhlIGxpbmUgdGhhdCBjbG9zZXMgdGhlIGJvZHk6IHRoZSBkZWxpbWl0ZXIsIG9wdGlvbmFsbHkgYFxcdGAtcHJlZml4ZWQgZm9yIGA8PC1gLCB3aXRoIG9wdGlvbmFsIHRyYWlsaW5nIHdoaXRlc3BhY2UuICovXG4gIGNsb3NlOiBSZWdFeHA7XG59XG5cbi8qKiBUaGUgd29yZHMgdGhhdCBwdXQgdGhlIHBhcnNlciBiYWNrIGF0IGNvbW1hbmQgc3RhcnQgd2hlbiB0aGV5IGFyZSB0aGUgYnVmZmVyJ3MgbGFzdCB3b3JkIChwbGFuIFx1MDBBNzMpLiAqL1xuY29uc3QgQ09NTUFORF9PUEVORVJfV09SRFMgPSBuZXcgU2V0KFsnZG8nLCAndGhlbicsICdlbHNlJywgJ2VsaWYnLCAnaWYnLCAnd2hpbGUnLCAndW50aWwnLCAnIScsICd0aW1lJywgJ3snLCAnKCddKTtcblxuLyoqIFdvcmQgY2hhcnMgZW5kIGF0IHdoaXRlc3BhY2UgYW5kIHRoZSBvcGVyYXRvci9wYXJlbi9yZWRpcmVjdCBtZXRhY2hhcnMuICovXG5jb25zdCBXT1JEX0VORCA9IC9bXFxzOyZ8KCk8Pl0vO1xuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbn1cblxuLyoqXG4gKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LFxuICogOywgfCwgfCYsICYsIGFuZCBuZXdsaW5lIGJvdW5kYXJpZXMuIFF1b3RlcyBhbmQgJCgpL2BgLygpIG5lc3RpbmcgYXJlXG4gKiByZXNwZWN0ZWQgKG5vdCBzcGxpdCBpbnNpZGUpOyBgI2AgY29tbWVudHMgYW5kIGAke1x1MjAyNn1gIGJyYWNlIGNvbnRlbnQgYXJlXG4gKiBvcGFxdWUsIHBpcGUvYW5kL29yIG5ld2xpbmVzIGFyZSBsaW5lIGNvbnRpbnVhdGlvbnMsIGFuZCBCYXNoIHBhcnNlIGVycm9yc1xuICogKHBsYW4gXHUwMEE3MSkgY29tZSBiYWNrIGFzIGEgYG1hbGZvcm1lZGAgdmVyZGljdCB3aXRoIHRoZSBzdGFnZSBsaXN0IHRydW5jYXRlZFxuICogYXQgdGhlIHJlamVjdGluZyBsaXN0LlxuICpcbiAqIFBoYXNlIDIgKHBsYW4gXHUwMEE3MykgYWRkcyB0aHJlZSBtYWNoaW5lczpcbiAqXG4gKiAtIFRoZSBraW5kLW1hdGNoZWQgY29uc3RydWN0IHN0YWNrOiBgaWZgL2B3aGlsZWAvYHVudGlsYC9gZm9yYC9gc2VsZWN0YC9cbiAqICAgYHtgL2B9YC9gZnVuY3Rpb25gIG9wZW4gY29uc3RydWN0IGZyYW1lcyBhdCBjb21tYW5kIHBvc2l0aW9uLCBjb250ZXh0XG4gKiAgIGtleXdvcmRzIChgZG9gLCBgdGhlbmAsIGBlbHNlYCwgYGVsaWZgLCBgaW5gKSBhbmQgY2xvc2VycyAoYGZpYCwgYGRvbmVgLFxuICogICBgZXNhY2AsIGB9YCkgcmVxdWlyZSBhIG1hdGNoaW5nIG9wZW5lciBvbiB0b3Agb2YgdGhlIHN0YWNrICh3aXRoIHRoZVxuICogICByaWdodCBib2R5IHN0YXRlKSwgYW5kIHdoaWxlIGEgY29uc3RydWN0IGlzIG9wZW4gYXQgZGVwdGggMCB0aGUgYm91bmRhcnlcbiAqICAgb3BlcmF0b3JzIGFyZSB0ZXh0IFx1MjAxNCB0aGUgY29uc3RydWN0IGZvbGRzIHRvIG9uZSBzdGFnZS4gRWFjaCBgKGAgcHVzaGVzIGFcbiAqICAgZnJlc2ggc3RhY2sgYW5kIGVhY2ggYClgIGZpcmVzICd1bmNsb3NlZC1jb25zdHJ1Y3QnIHdoZW4gaXRzIGxldmVsIGlzXG4gKiAgIG5vbi1lbXB0eSAoZmlyZS1iZWZvcmUtcmVzdG9yZSkuXG4gKlxuICogLSBUaGUgY2FzZS1yZWdpb24gbWFjaGluZTogYGNhc2VgIGluIGNvbW1hbmQgcG9zaXRpb24gb3BlbnMgYSByZWdpb24gY2xvc2VkXG4gKiAgIGJ5IGEgbWF0Y2hpbmcgYGVzYWNgLiBUaGUgcmVnaW9uJ3MgY29udGVudCBpcyBvcGFxdWUgXHUyMDE0IHBhdHRlcm4gYClgcyBhbmRcbiAqICAgYHxgcyBhcmUgcGF0dGVybiBzeW50YXgsIG5vdCBwYXJlbnMvcGlwZXMgXHUyMDE0IHdpdGggaXRzIG93biBwYXJlbiBkZXB0aFxuICogICAodGhlIGdsb2JhbCBkZXB0aCBmcmVlemVzIHdoaWxlIG9wZW4pLCBgOztgL2A7JmAvYDs7JmAgcmV0dXJuaW5nIHRvXG4gKiAgIHBhdHRlcm4tc3RhcnQgYW5kIGApYCwgYDtgLCBgJmAsIGFuZCBuZXdsaW5lcyB0byBjb21tYW5kIHN0YXJ0LiBBIHJlZ2lvblxuICogICBvcGVuIGF0IEVPRiBpcyAndW5jbG9zZWQtY2FzZScuXG4gKlxuICogLSBUaGUgaGVyZWRvYyBtYWNoaW5lcnk6IGA8PGAvYDw8LWAgYXQgZGVwdGggMCB3aXRoIGEgZGVsaW1pdGVyIHdvcmQgc3RyaXBzXG4gKiAgIHRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgZnJvbSB0aGUgc3RhZ2UgdGV4dCAodGhlIHN0YWdlIGtlZXBzIGEgcGxhaW4gYXJndilcbiAqICAgYW5kIHNjYW5zIGJvZHkgbGluZXMgcmF3IHVudGlsIHRoZSBkZWxpbWl0ZXIgbGluZTsgYW4gdW50ZXJtaW5hdGVkXG4gKiAgIGhlcmVkb2MgaXMgdGhlICd1bnRlcm1pbmF0ZWQtaGVyZWRvYycgcGFydGlhbCBcdTIwMTQgdGhlIGRlbGltaXRlcidzIGxpbmUgKGFuZFxuICogICBldmVyeXRoaW5nIGJlZm9yZSBpdCkgYW5hbHl6ZXMgbm9ybWFsbHkgYW5kIHRoZSBib2R5IHByb2R1Y2VzIG5vIHN0YWdlcy5cbiAqICAgVGhlIHN0cmlwcGVkIHN0YWdlIGNhcnJpZXMgdGhlIGBoZXJlZG9jYCBmbGFnIHNvIGNvbnN1bWVycyBjYW4gc2VlIHRoYXRcbiAqICAgaXRzIHN0ZGluIGlzIHRoZSBib2R5LCBub3QgYSBwaXBlIG9yIGEgZmlsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0VG9wTGV2ZWwoY21kOiBzdHJpbmcpOiBTcGxpdFJlc3VsdCB7XG4gIGNvbnN0IHBhcnRzOiBTaW1wbGVDb21tYW5kW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBjbWQubGVuZ3RoO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgYnJhY2VEZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogT3BlcmF0b3IgPSAnc3RhcnQnO1xuICAvKiogU2V0IHdoZW4gdGhlIGN1cnJlbnQgbGlzdCBpcyBhIEJhc2ggcGFyc2UgZXJyb3I7IHRoZSBzY2FuIHN0b3BzIGF0IGl0IChwbGFuIFx1MDBBNzEsIGxpc3Qtc2NvcGUgKyB0ZXJtaW5hbCkuICovXG4gIGxldCBtYWxmb3JtZWQ6IE1hbGZvcm1lZFZlcmRpY3QgfCB1bmRlZmluZWQ7XG4gIC8qKiBJbmRleCBpbnRvIGBwYXJ0c2Agd2hlcmUgdGhlIGN1cnJlbnQgbGlzdCBiZWdhbiBcdTIwMTQgdGhlIHJlamVjdGluZyBsaXN0J3Mgc3RhZ2VzIGFyZSBkcm9wcGVkIGJ5IHJvbGxpbmcgYmFjayB0byBpdC4gKi9cbiAgbGV0IGxpc3RTdGFydCA9IDA7XG5cbiAgLyoqIFJlcG9ydCBhIG1hbGZvcm1lZCBsaXN0OiBkcm9wIGl0cyBzdGFnZXMgKGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzIHN0YXkpLCBhbmQgc3RvcCB0aGUgc2NhbiBcdTIwMTQgYmFzaCBhYm9ydHMgYXQgdGhlIGZpcnN0IHBhcnNlIGVycm9yLiAqL1xuICBjb25zdCByZWplY3QgPSAodjogTWFsZm9ybWVkVmVyZGljdCkgPT4ge1xuICAgIG1hbGZvcm1lZCA9IHY7XG4gICAgcGFydHMubGVuZ3RoID0gbGlzdFN0YXJ0O1xuICAgIGkgPSBuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgcGlwZS9hbmQvb3Igb3BlcmF0b3IgaXMgcGVuZGluZyB3aXRoIGEgd2hpdGVzcGFjZS1vbmx5IGJ1ZmZlclxuICAgKiBzaW5jZSBpdC4gQSBoZWxwZXIgcmF0aGVyIHRoYW4gYW4gaW5saW5lIGNvbXBhcmlzb246IFR5cGVTY3JpcHQnc1xuICAgKiBjb250cm9sLWZsb3cgbmFycm93aW5nIGNhbm5vdCBzZWUgdGhlIGFzc2lnbm1lbnRzIGBmbHVzaGAgbWFrZXMgdG9cbiAgICogYHBlbmRpbmdPcGAgZnJvbSBpbnNpZGUgaXRzIGNsb3N1cmUsIGFuZCB3b3VsZCBvdGhlcndpc2UgbmFycm93IHRoZVxuICAgKiBkaXJlY3QgY29tcGFyaXNvbiB0byB0aGUgaW5pdGlhbGl6ZXIgYCdzdGFydCdgLlxuICAgKi9cbiAgY29uc3QgaXNVbmNvbnN1bWVkT3BlcmF0b3IgPSAoKTogYm9vbGVhbiA9PlxuICAgIChwZW5kaW5nT3AgPT09ICdwaXBlJyB8fCBwZW5kaW5nT3AgPT09ICdhbmQnIHx8IHBlbmRpbmdPcCA9PT0gJ29yJykgJiYgYnVmLnRyaW0oKSA9PT0gJyc7XG5cbiAgLyoqIFRoZSBidWZmZXIncyBsYXN0IHdoaXRlc3BhY2UtZGVsaW1pdGVkIHdvcmQgKCcnIHdoZW4gdGhlIGJ1ZmZlciBpcyBlbXB0eSkuICovXG4gIGNvbnN0IGxhc3RXb3JkID0gKCk6IHN0cmluZyA9PiBidWYudHJpbUVuZCgpLm1hdGNoKC9cXFMrJC8pPy5bMF0gPz8gJyc7XG5cbiAgLyoqXG4gICAqIFJlZGlyZWN0IG9wZXJhdG9ycyB0aGF0IGFyZSBtaXNzaW5nIHRoZWlyIHRhcmdldCB3b3JkIHdoZW4gdGhleSBhcmUgdGhlXG4gICAqIGJ1ZmZlcidzIGxhc3Qgd29yZCAocGxhbiBcdTAwQTcxKTogYSB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIHdvcmQsIHNvIGV2ZXJ5XG4gICAqIG5vbi1zZWxmLWNvbXBsZXRlIGZvcm0gaXMgYSBwYXJzZSBlcnJvci4gRHVwIGZvcm1zIHdpdGggYm90aCBmZHMgcHJlc2VudFxuICAgKiAoYDI+JjFgLCBgPiYtYCwgYDM8JjBgKSBhbmQgZnVzZWQgd29yZHMgKGA+b3V0YCwgYDI+ZXJyYCwgYDw8RU9GYCxcbiAgICogYCY+b3V0YCkgYXJlIGNvbXBsZXRlIGFuZCBuZXZlciBtYXRjaC5cbiAgICovXG4gIGNvbnN0IERBTkdMSU5HX1JFRElSRUNUX1dPUkQgPSAvXig/Oj58Pj58Jj58Jj4+fD5cXHx8PHw8Pnw8PHw8PC18PDw8fD4mfFxcZCsoPzo+fD4+fD5cXHx8PHw8Pnw8PHw8PC18PDw8fD4mfDwmKSkkLztcblxuICBjb25zdCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCA9ICgpOiBib29sZWFuID0+IERBTkdMSU5HX1JFRElSRUNUX1dPUkQudGVzdChsYXN0V29yZCgpKTtcblxuICAvKiogV2hldGhlciB0aGUgY3VycmVudCBjaGFyIHN0YXJ0cyBhIG5ldyB3b3JkIGluIHRoZSBidWZmZXIgKGVtcHR5IGJ1ZmZlciwgb3IgcHJlY2VkZWQgYnkgd2hpdGVzcGFjZSkuICovXG4gIGNvbnN0IGlzV29yZFN0YXJ0ID0gKCk6IGJvb2xlYW4gPT4gYnVmID09PSAnJyB8fCAvXFxzJC8udGVzdChidWYpO1xuXG4gIC8qKiBXaGV0aGVyIGEgcmVkaXJlY3QgdG9rZW4gYmVnaW5zIGF0IGBpYDogYSBgPmAvYDxgIGZvcm0sIGAmPmAsIG9yIGEgZGlnaXQtcHJlZml4ZWQgZm9ybSBsaWtlIGAyPmAvYDI+JjFgLiAqL1xuICBjb25zdCBzdGFydHNSZWRpcmVjdEF0ID0gKGk6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGMgPT09ICc+JyB8fCBjID09PSAnPCcpIHJldHVybiB0cnVlO1xuICAgIGlmIChjID09PSAnJicpIHJldHVybiBjbWRbaSArIDFdID09PSAnPic7XG4gICAgaWYgKGMgPj0gJzAnICYmIGMgPD0gJzknKSB7XG4gICAgICBsZXQgaiA9IGk7XG4gICAgICB3aGlsZSAoaiA8IG4gJiYgY21kW2pdID49ICcwJyAmJiBjbWRbal0gPD0gJzknKSBqICs9IDE7XG4gICAgICByZXR1cm4gY21kW2pdID09PSAnPicgfHwgY21kW2pdID09PSAnPCc7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciBhIG5ldyBjb21tYW5kIGNhbiBzdGFydCBoZXJlOiB0aGUgYnVmZmVyIGlzIGVtcHR5LCBhIGJvdW5kYXJ5XG4gICAqIG9wZXJhdG9yIG9yIGAoYC9gKWAgcHJlY2VkZXMsIHRoZSBidWZmZXIgZW5kcyB3aXRoIGEgbmV3bGluZSAoYSBuZXdsaW5lXG4gICAqIGluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCBpcyB0ZXh0IGJ1dCBzdGlsbCBlbmRzIHRoZSBsaXN0IGl0ZW0pLCBvciB0aGVcbiAgICogbGFzdCB3b3JkIGV4cGVjdHMgYSBjb21tYW5kIGJvZHkgKGB0aGVuYCwgYGRvYCwgYHtgLCBcdTIwMjYpLlxuICAgKi9cbiAgY29uc3QgaXNDb21tYW5kUG9zaXRpb24gPSAoKTogYm9vbGVhbiA9PlxuICAgIGJ1Zi50cmltKCkgPT09ICcnIHx8IC9cXG4kLy50ZXN0KGJ1ZikgfHwgL1s7JnwoKV0kLy50ZXN0KGJ1Zi50cmltRW5kKCkpIHx8IENPTU1BTkRfT1BFTkVSX1dPUkRTLmhhcyhsYXN0V29yZCgpKTtcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IE9wZXJhdG9yKSA9PiB7XG4gICAgY29uc3QgcyA9IGJ1Zi50cmltKCk7XG4gICAgaWYgKHMpIHtcbiAgICAgIC8vIGAhYCBpbiBwaXBlIHBvc2l0aW9uIGlzIGEgcGFyc2UgZXJyb3IgKHBsYW4gXHUwMEE3MSk6IHRoZSBmaXJzdCB3b3JkIG9mIGFcbiAgICAgIC8vIHBpcGUtcHJlY2VkZWQgc3RhZ2UgbWF5IG5vdCBiZSBgIWAgKGBmYWxzZSB8ICEgdHJ1ZWAsIGBjYXQgZiB8XFxuISB0cnVlYCkuXG4gICAgICBpZiAocGVuZGluZ09wID09PSAncGlwZScgJiYgKHMgPT09ICchJyB8fCAvXiFcXHMvLnRlc3QocykpKSB7XG4gICAgICAgIHJlamVjdCgncGlwZS1iYW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goeyB0ZXh0OiBzLCBwcmVjZWRlZEJ5OiBwZW5kaW5nT3AsIC4uLihidWZIZXJlZG9jID8geyBoZXJlZG9jOiB0cnVlIH0gOiB7fSkgfSk7XG4gICAgfVxuICAgIGJ1ZiA9ICcnO1xuICAgIGJ1ZkhlcmVkb2MgPSBmYWxzZTtcbiAgICBwZW5kaW5nT3AgPSBuZXh0T3A7XG4gIH07XG5cbiAgLy8gVGhlIGtpbmQtbWF0Y2hlZCBjb25zdHJ1Y3Qgc3RhY2ssIG9uZSBsaXN0IHBlciBwYXJlbiBsZXZlbDogYChgIHB1c2hlcyBhXG4gIC8vIGZyZXNoIGxldmVsLCBgKWAgcG9wcyBpdCBhbmQgZmlyZXMgd2hlbiBpdCBpcyBub24tZW1wdHkgXHUyMDE0IGFuIHVuY2xvc2VkXG4gIC8vIGNvbnN0cnVjdCBjYW5ub3Qgb3V0bGl2ZSB0aGUgc3Vic2hlbGwgdGhhdCBjbG9zZWQgKHBsYW4gXHUwMEE3MykuXG4gIGNvbnN0IGxldmVsczogT3BlbkNvbnN0cnVjdFtdW10gPSBbW11dO1xuICBjb25zdCB0b3AgPSAoKTogT3BlbkNvbnN0cnVjdCB8IHVuZGVmaW5lZCA9PiB7XG4gICAgY29uc3QgbHYgPSBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdO1xuICAgIHJldHVybiBsdi5sZW5ndGggPiAwID8gbHZbbHYubGVuZ3RoIC0gMV0gOiB1bmRlZmluZWQ7XG4gIH07XG4gIC8qKiBTZXQgYnkgb3BlbmVycyBhbmQgYm9keSBrZXl3b3JkcywgY2xlYXJlZCBieSBvdGhlciB3b3JkcyBhbmQgYChgIFx1MjAxNCBhbiBvcGVyYXRvciBvciBjbG9zZXIgZGlyZWN0bHkgYWZ0ZXIgaXQgaXMgYW4gZW1wdHktbGlzdCBwYXJzZSBlcnJvciAoYGlmIHRydWU7IHRoZW47IGZpYCwgYHsgOyB9YCkuICovXG4gIGxldCBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgLyoqIGBmdW5jdGlvbmAgc2VlbjsgdGhlIG5leHQgd29yZCBpcyB0aGUgZnVuY3Rpb24gbmFtZSwgYW5kIGB7YCByaWdodCBhZnRlciBpdCBvcGVucyB0aGUgZGVmaW5pdGlvbiBib2R5LiAqL1xuICBsZXQgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gIGxldCBuYW1lU2VlbiA9IGZhbHNlO1xuXG4gIC8vIFRoZSBvcGVuIGNhc2UgcmVnaW9uLCBpZiBhbnkgKHBsYW4gXHUwMEE3MykuIFdoaWxlIG9wZW4sIGl0cyBjb250ZW50IGlzIG9wYXF1ZVxuICAvLyB0byBldmVyeSBvdGhlciBtYWNoaW5lOiB0aGUgZ2xvYmFsIHBhcmVuIGRlcHRoIGlzIGZyb3plbiwgdGhlIGNvbnN0cnVjdFxuICAvLyBzdGFjayBpcyB1bnRvdWNoZWQsIGFuZCBib3VuZGFyeSBvcGVyYXRvcnMgYXJlIHRleHQuXG4gIGxldCBjYXNlUmVnaW9uOiBDYXNlUmVnaW9uIHwgbnVsbCA9IG51bGw7XG5cbiAgLy8gUGVuZGluZyBoZXJlZG9jcyAocGxhbiBcdTAwQTczKTogYDw8YC9gPDwtYCBhdCBkZXB0aCAwIHdpdGggYSBkZWxpbWl0ZXIgd29yZC5cbiAgY29uc3QgaGVyZWRvY3M6IFBlbmRpbmdIZXJlZG9jW10gPSBbXTtcbiAgLyoqIEluIHRoZSBib2R5IG9mIGEgcGVuZGluZyBoZXJlZG9jIFx1MjAxNCBsaW5lcyBhcmUgc2Nhbm5lZCByYXcgZm9yIHRoZSBjbG9zZSBsaW5lLiAqL1xuICBsZXQgaW5Cb2R5ID0gZmFsc2U7XG4gIC8qKiBXaGV0aGVyIHRoZSBzdGFnZSBjdXJyZW50bHkgaW4gdGhlIGJ1ZmZlciBmZWVkcyBpdHMgc3RkaW4gZnJvbSBhIGhlcmVkb2MgYm9keSAoc3VyZmFjZWQgb24gdGhlIGZsdXNoZWQgU2ltcGxlQ29tbWFuZCkuICovXG4gIGxldCBidWZIZXJlZG9jID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBidWYgKz0gY21kW2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBidWYgKz0gYyArIGNtZFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gYCR7XHUyMDI2fWAgY29udGVudCBpcyBvcGFxdWUgKHBsYW4gXHUwMEE3MSk6IG5lc3RlZCBleHBhbnNpb25zIG5lc3QsIGFuZCB3aGlsZVxuICAgIC8vIHRoZSBicmFjZSBkZXB0aCBpcyBwb3NpdGl2ZSBub3RoaW5nIGluc2lkZSBjb3VudHMgcGFyZW5zLCBzcGxpdHNcbiAgICAvLyBvcGVyYXRvcnMsIHN0YXJ0cyBjb21tZW50cywgb3IgcmVjb2duaXplcyBjb25zdHJ1Y3RzIFx1MjAxNCBgJHt4JSl9YCxcbiAgICAvLyBgJHt4Ly8oL31gLCBhbmQgYCR7eDotJChlY2hvIHkpfWAgYXJlIGFsbCB2YWxpZC5cbiAgICBpZiAoYnJhY2VEZXB0aCA+IDApIHtcbiAgICAgIGlmIChjID09PSAnfScpIGJyYWNlRGVwdGggLT0gMTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEhlcmVkb2MgYm9keSBtb2RlOiBzY2FuIGxpbmVzIHJhdyB1bnRpbCB0aGUgZmlyc3QgcGVuZGluZyBoZXJlZG9jJ3NcbiAgICAvLyBjbG9zZSBsaW5lIChhIGxpbmUgdGhhdCBpcyBleGFjdGx5IHRoZSBkZWxpbWl0ZXIsIG9wdGlvbmFsbHkgdGFiLVxuICAgIC8vIHByZWZpeGVkIGZvciBgPDwtYCwgd2l0aCBvcHRpb25hbCB0cmFpbGluZyB3aGl0ZXNwYWNlKS4gVGhlIGJvZHkgaXNcbiAgICAvLyBvcGFxdWUgXHUyMDE0IGl0IHByb2R1Y2VzIG5vIHN0YWdlcyBcdTIwMTQgYW5kIHVudGVybWluYXRlZCBib2RpZXMgZW5kIGF0IEVPRi5cbiAgICBpZiAoaW5Cb2R5KSB7XG4gICAgICBjb25zdCBsaW5lRW5kID0gY21kLmluZGV4T2YoJ1xcbicsIGkpO1xuICAgICAgY29uc3QgbGluZSA9IGxpbmVFbmQgPT09IC0xID8gY21kLnNsaWNlKGkpIDogY21kLnNsaWNlKGksIGxpbmVFbmQpO1xuICAgICAgaWYgKGhlcmVkb2NzWzBdLmNsb3NlLnRlc3QobGluZSkpIHtcbiAgICAgICAgaGVyZWRvY3Muc2hpZnQoKTtcbiAgICAgICAgaWYgKGhlcmVkb2NzLmxlbmd0aCA9PT0gMCkgaW5Cb2R5ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwIHx8IGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICAgICAgLy8gSW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IHRoZSBib2R5IGxpbmUgZm9sZHMgaW50byB0aGUgY29uc3RydWN0J3NcbiAgICAgICAgLy8gaW50ZXJpb3IgdGV4dCAoYSBuZXdsaW5lIGluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCBpcyBub3QgYVxuICAgICAgICAvLyBib3VuZGFyeSwgcGxhbiBcdTAwQTcxKSBcdTIwMTQgdGhlIGludGVyaW9yIHJlLXNwbGl0IHJlLXNjYW5zIGl0IGFzIGJvZHkuXG4gICAgICAgIGJ1ZiArPSBsaW5lO1xuICAgICAgICBpZiAobGluZUVuZCAhPT0gLTEpIGJ1ZiArPSAnXFxuJztcbiAgICAgIH1cbiAgICAgIGkgPSBsaW5lRW5kID09PSAtMSA/IG4gOiBsaW5lRW5kICsgMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUaGUgbmV3bGluZSByaWdodCBhZnRlciBhIGhlcmVkb2MncyBkZWxpbWl0ZXIgbGluZSBlbmRzIHRoZSBkZWxpbWl0ZXInc1xuICAgIC8vIGxpbmUgXHUyMDE0IGl0IHNwbGl0cyBub3JtYWxseSAoYSBjb21wbGV0ZWQgbGlzdCwgYnV0IHdpdGhvdXQgYWR2YW5jaW5nXG4gICAgLy8gYGxpc3RTdGFydGA6IGEgY29tcGxldGVuZXNzIHZpb2xhdGlvbiB0aGF0IHJlamVjdHMgbGF0ZXIgZHJvcHMgdGhlXG4gICAgLy8gZGVsaW1pdGVyJ3MtbGluZSBzdGFnZSB0b28pIFx1MjAxNCBhbmQgc3RhcnRzIHRoZSBib2R5LiBJbnNpZGUgYW4gb3BlblxuICAgIC8vIGNvbnN0cnVjdCB0aGUgbmV3bGluZSBpcyBub3QgYSBib3VuZGFyeTogdGhlIGRlbGltaXRlcidzIGxpbmUsIHRoZVxuICAgIC8vIGJvZHksIGFuZCB0aGUgY2xvc2UgbGluZSBhbGwgZm9sZCBpbnRvIHRoZSBjb25zdHJ1Y3QncyBvbmUgc3RhZ2UsIGFuZFxuICAgIC8vIHRoZSB3YWxrJ3MgaW50ZXJpb3IgcmUtc3BsaXQgYXBwbGllcyB0aGUgc2FtZSBoZXJlZG9jIG1hY2hpbmVyeSB0aGVyZS5cbiAgICBpZiAoYyA9PT0gJ1xcbicgJiYgaGVyZWRvY3MubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICBpbkJvZHkgPSB0cnVlO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICAgIGluQm9keSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gYCNgIGJlZ2lucyBhIGNvbW1lbnQgd2hlbiBpdCBzdGFydHMgYSB3b3JkIGF0IGRlcHRoIDAgKGVtcHR5IGJ1ZmZlciBvclxuICAgIC8vIHByZWNlZGVkIGJ5IHdoaXRlc3BhY2UpOyBjb21tZW50cyBydW4gdG8gdGhlIG5ld2xpbmUsIGtlZXBpbmcgdGhlIGJ1ZmZlclxuICAgIC8vIGVtcHR5IGZvciB0aGUgY29udGludWF0aW9uIHJ1bGUuIE1pZC13b3JkIGFuZCBxdW90ZWQgYCNgIGFyZSB0ZXh0LCBhbmRcbiAgICAvLyBjb21tZW50cyBpbnNpZGUgcGFyZW5zIGFyZSBvcGFxdWUgbGlrZSBldmVyeXRoaW5nIGVsc2UgdGhlcmUgKHBsYW4gXHUwMEE3MSkuXG4gICAgaWYgKGMgPT09ICcjJyAmJiBkZXB0aCA9PT0gMCAmJiBpc1dvcmRTdGFydCgpKSB7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgY21kW2ldICE9PSAnXFxuJykgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRoZSBjYXNlLXJlZ2lvbiBzY2FuIG93bnMgZXZlcnl0aGluZyBhdCBpdHMgbG9jYWwgZGVwdGggMCBcdTIwMTQgcGF0dGVyblxuICAgIC8vIHN5bnRheCwgbGlzdCB0ZXJtaW5hdG9ycywgYW5kIHdvcmRzIFx1MjAxNCB3aGlsZSB0aGUgcmVnaW9uIGlzIG9wZW4uXG4gICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgIGNvbnN0IHIgPSBjYXNlUmVnaW9uO1xuICAgICAgaWYgKHIubG9jYWxEZXB0aCA9PT0gMCkge1xuICAgICAgICBjb25zdCBzMiA9IGNtZC5zbGljZShpLCBpICsgMik7XG4gICAgICAgIGNvbnN0IHMzID0gY21kLnNsaWNlKGksIGkgKyAzKTtcbiAgICAgICAgLy8gYDs7YC9gOyZgL2A7OyZgIGVuZCB0aGUgY3VycmVudCBwYXR0ZXJuIGxpc3QgXHUyMDE0IGJhY2sgdG8gcGF0dGVybi1zdGFydC5cbiAgICAgICAgaWYgKHMzID09PSAnOzsmJyB8fCBzMiA9PT0gJzs7JyB8fCBzMiA9PT0gJzsmJykge1xuICAgICAgICAgIHIucG9zID0gJ3BhdHRlcm4tc3RhcnQnO1xuICAgICAgICAgIGJ1ZiArPSBzMyA9PT0gJzs7JicgPyBzMyA6IHMyO1xuICAgICAgICAgIGkgKz0gczMgPT09ICc7OyYnID8gMyA6IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYDtgIHJldHVybnMgdG8gY29tbWFuZCBzdGFydCAoYSBgOztgIHdhcyBoYW5kbGVkIGFib3ZlKS5cbiAgICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICAgIHIucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBBIHNpbmdsZSBgJmAgKG5vdCBwYXJ0IG9mIGEgcmVkaXJlY3Qgb3IgYCYmYCkgaXMgdGhlIGJhY2tncm91bmRcbiAgICAgICAgLy8gb3BlcmF0b3IgXHUyMDE0IGFsc28gY29tbWFuZCBzdGFydC5cbiAgICAgICAgY29uc3QgbGFzdCA9IGJ1ZltidWYubGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChjID09PSAnJicgJiYgY21kW2kgKyAxXSAhPT0gJz4nICYmIGNtZFtpICsgMV0gIT09ICcmJyAmJiBsYXN0ICE9PSAnPicgJiYgbGFzdCAhPT0gJzwnKSB7XG4gICAgICAgICAgci5wb3MgPSAnY29tbWFuZCc7XG4gICAgICAgICAgci5jbWRFbXB0eSA9IHRydWU7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAgIC8vIEEgcGF0dGVybiBjYW5ub3QgY29udGludWUgYWNyb3NzIGEgbmV3bGluZSAoYmFzaCBlcnJvcnMpLCBidXQgYVxuICAgICAgICAgIC8vIG5ld2xpbmUgYWZ0ZXIgYGluYCBvciBpbnNpZGUgYSBsaXN0IGl0ZW0gaXMgZmluZS5cbiAgICAgICAgICBpZiAoci5wb3MgPT09ICdwYXR0ZXJuJykge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jYXNlJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHIucG9zID09PSAnY29tbWFuZCcpIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJyMnICYmIGlzV29yZFN0YXJ0KCkpIHtcbiAgICAgICAgICAvLyBBIGNvbW1lbnQgaW5zaWRlIHRoZSByZWdpb24gcnVucyB0byB0aGUgbmV3bGluZSBsaWtlIG91dHNpZGUuXG4gICAgICAgICAgd2hpbGUgKGkgPCBuICYmIGNtZFtpXSAhPT0gJ1xcbicpIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNXb3JkU3RhcnQoKSAmJiAhV09SRF9FTkQudGVzdChjKSkge1xuICAgICAgICAgIGxldCBqID0gaTtcbiAgICAgICAgICB3aGlsZSAoaiA8IG4gJiYgIVdPUkRfRU5ELnRlc3QoY21kW2pdKSkgaiArPSAxO1xuICAgICAgICAgIGNvbnN0IHcgPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICAgICAgLy8gYGVzYWNgIGNsb3NlcyBhdCBhIHBhdHRlcm4tbGlzdCBzdGFydCBvciBhdCB0aGUgc3RhcnQgb2YgYSBsaXN0XG4gICAgICAgICAgLy8gaXRlbTsgZWxzZXdoZXJlIGl0IGlzIGFuIG9yZGluYXJ5IHdvcmQgKGBlY2hvIGVzYWNgLCBgYXxlc2FjKWApLFxuICAgICAgICAgIC8vIGFzIGlzIGBjYXNlYCBpbiB0aGUgc3ViamVjdCAoYGNhc2UgZXNhYyBpbiBcdTIwMjZgKS5cbiAgICAgICAgICBpZiAodyA9PT0gJ2VzYWMnICYmIChyLnBvcyA9PT0gJ3BhdHRlcm4tc3RhcnQnIHx8IChyLnBvcyA9PT0gJ2NvbW1hbmQnICYmIHIuY21kRW1wdHkpKSkge1xuICAgICAgICAgICAgY2FzZVJlZ2lvbiA9IG51bGw7XG4gICAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpbicgJiYgci5wb3MgPT09ICdzdWJqZWN0Jykge1xuICAgICAgICAgICAgci5wb3MgPSAncGF0dGVybi1zdGFydCc7XG4gICAgICAgICAgfSBlbHNlIGlmIChyLnBvcyA9PT0gJ3BhdHRlcm4tc3RhcnQnKSB7XG4gICAgICAgICAgICByLnBvcyA9ICdwYXR0ZXJuJztcbiAgICAgICAgICB9IGVsc2UgaWYgKHIucG9zID09PSAnY29tbWFuZCcpIHtcbiAgICAgICAgICAgIHIuY21kRW1wdHkgPSBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnVmICs9IHc7XG4gICAgICAgICAgaSA9IGo7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIExvY2FsIGRlcHRoID4gMCBvciBub24td29yZCBjaGFycyBmYWxsIHRocm91Z2ggdG8gdGhlIHBhcmVuIGJyYW5jaGVzXG4gICAgICAvLyBhbmQgdGhlIGdlbmVyaWMgYnVmZmVyLlxuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBpZiAoY2FzZVJlZ2lvbikge1xuICAgICAgICBjYXNlUmVnaW9uLmxvY2FsRGVwdGggKz0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEEgc3Vic2hlbGwgc3RhcnRzIGEgY29tbWFuZCBcdTIwMTQgYGlmIHRydWU7IHRoZW4gKCBlY2hvIGhpICk7IGZpYCBpc1xuICAgICAgICAvLyB2YWxpZCB3aGlsZSBgaWYgdHJ1ZTsgdGhlbjsgZmlgIGlzIG5vdDsgdGhlIHNhbWUgc3Vic2hlbGwgY291bnRzIGFzXG4gICAgICAgIC8vIGEgYm9keSB3b3JkIGZvciBhbiBlbmNsb3NpbmcgYnJhY2UgZ3JvdXAgKGB7ICggZWNobyBoaSApOyB9YCkuXG4gICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgaWYgKHQ/LmtpbmQgPT09ICdicmFjZScpIHQuYm9keSA9IHRydWU7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIGxldmVscy5wdXNoKFtdKTtcbiAgICAgIH1cbiAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgICAgLy8gQXQgbG9jYWwgZGVwdGggMCBhIGApYCBpcyB0aGUgcGF0dGVybiB0ZXJtaW5hdG9yIChvciB0aGUgZW5kIG9mIGFcbiAgICAgICAgLy8gbGlzdCBpdGVtKSBcdTIwMTQgdGhlIHJlZ2lvbiBvd25zIGl0IGFuZCB0aGUgZ2xvYmFsIGRlcHRoIHN0YXlzIGZyb3plbi5cbiAgICAgICAgaWYgKGNhc2VSZWdpb24ubG9jYWxEZXB0aCA9PT0gMCkge1xuICAgICAgICAgIGNhc2VSZWdpb24ucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIGNhc2VSZWdpb24uY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhc2VSZWdpb24ubG9jYWxEZXB0aCAtPSAxO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBIHN0cmF5IGApYCBhdCBkZXB0aCAwIChhbmQgYnJhY2UgZGVwdGggMCwgb3V0c2lkZSBxdW90ZXMpIGlzIGEgcGFyc2VcbiAgICAgICAgLy8gZXJyb3IgXHUyMDE0IGBlY2hvIHgpICYmIFx1MjAyNmAgKHBsYW4gXHUwMEE3MSkuIGApYCBpbnNpZGUgcXVvdGVzLCBgJHtcdTIwMjZ9YCwgYW5kXG4gICAgICAgIC8vIGhlcmVkb2MgYm9kaWVzIG5ldmVyIHJlYWNoZXMgdGhpcyBicmFuY2guXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgIHJlamVjdCgndW5iYWxhbmNlZC1wYXJlbicpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZpcmUtYmVmb3JlLXJlc3RvcmU6IGFuIHVuY2xvc2VkIGNvbnN0cnVjdCBvbiB0aGUgY2xvc2luZyBsZXZlbFxuICAgICAgICAvLyBjYW5ub3Qgb3V0bGl2ZSB0aGUgc3Vic2hlbGwgKHBsYW4gXHUwMEE3MykuXG4gICAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICAgIGxldmVscy5wb3AoKTtcbiAgICAgIH1cbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIENvbnN0cnVjdCBrZXl3b3JkcyBhbmQgdGhlIGNhc2UtcmVnaW9uIG9wZW5lcjogcmVjb2duaXplZCBhdCB3b3JkXG4gICAgLy8gc3RhcnRzIGF0IGFueSBwYXJlbiBkZXB0aCAoY29uc3RydWN0cyB0cmFjayB0aHJvdWdoIHN1YnNoZWxscyksIG91dHNpZGVcbiAgICAvLyBxdW90ZXMsICR7XHUyMDI2fSwgaGVyZWRvYyBib2RpZXMsIGFuZCBvcGVuIGNhc2UgcmVnaW9ucyAodGhlIHJlZ2lvbiBzY2FuXG4gICAgLy8gYWJvdmUgb3ducyB0aG9zZSB3b3JkcykuIFdvcmQtZW5kIGNoYXJzIChgO2AsIGAmYCwgYHxgLCBgPGAsIGA+YClcbiAgICAvLyBuZXZlciBiZWdpbiBhIHdvcmQgaGVyZS5cbiAgICBpZiAoXG4gICAgICAhY2FzZVJlZ2lvbiAmJlxuICAgICAgIVdPUkRfRU5ELnRlc3QoYykgJiZcbiAgICAgIChpc1dvcmRTdGFydCgpIHx8IC9bKCldJC8udGVzdChidWYpKSAmJlxuICAgICAgIShjID09PSAnJCcgJiYgY21kW2kgKyAxXSA9PT0gJ3snKVxuICAgICkge1xuICAgICAgbGV0IGogPSBpO1xuICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgIGNvbnN0IHcgPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICBjb25zdCBpc0ZuU2hhcGUgPSAoKTogYm9vbGVhbiA9PiAvXltBLVphLXpfXVtBLVphLXowLTlfXSpcXChcXCkkLy50ZXN0KGxhc3RXb3JkKCkpIHx8IGxhc3RXb3JkKCkgPT09ICcoKSc7XG4gICAgICBpZiAodyA9PT0gJ2luJyAmJiB0b3AoKSAhPT0gdW5kZWZpbmVkICYmIFsnZm9yJywgJ3NlbGVjdCddLmluY2x1ZGVzKHRvcCgpIS5raW5kKSkge1xuICAgICAgICAvLyBUaGUgZm9yL3NlbGVjdCB3b3JkLWxpc3Qgc2VwYXJhdG9yIFx1MjAxNCByZWNvZ25pemVkIHdoZXJldmVyIGl0IGFwcGVhcnNcbiAgICAgICAgLy8gd2hpbGUgYSBmb3Ivc2VsZWN0IGlzIG9wZW4gKGBmb3IgaSBpbiBhIGJgLCBgc2VsZWN0IHggaW4gYWApLlxuICAgICAgfSBlbHNlIGlmICh3ID09PSAneycgJiYgKGlzQ29tbWFuZFBvc2l0aW9uKCkgfHwgaXNGblNoYXBlKCkgfHwgKGZ1bmN0aW9uU2VlbiAmJiBuYW1lU2VlbikpKSB7XG4gICAgICAgIC8vIGB7YCBvcGVucyBhIGJyYWNlIGdyb3VwIGF0IGNvbW1hbmQgcG9zaXRpb24sIG9yIHJpZ2h0IGFmdGVyIGFcbiAgICAgICAgLy8gZnVuY3Rpb24gbmFtZSAoYGYoKSB7YCwgYGYoKXtgLCBgZnVuY3Rpb24gZiB7YCkuIGB7Y2F0YCBpcyBhIHdvcmQuXG4gICAgICAgIGlmIChmdW5jdGlvblNlZW4gJiYgbmFtZVNlZW4pIHtcbiAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnYnJhY2UnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ30nICYmIGlzQ29tbWFuZFBvc2l0aW9uKCkpIHtcbiAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICBpZiAoYWZ0ZXJLZXl3b3JkIHx8IHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdicmFjZScgfHwgIXQuYm9keSkge1xuICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICB9IGVsc2UgaWYgKGlzQ29tbWFuZFBvc2l0aW9uKCkpIHtcbiAgICAgICAgaWYgKHcgPT09ICdjYXNlJykge1xuICAgICAgICAgIGNhc2VSZWdpb24gPSB7IHBvczogJ3N1YmplY3QnLCBjbWRFbXB0eTogZmFsc2UsIGxvY2FsRGVwdGg6IDAgfTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgZnVuY3Rpb25TZWVuID0gdHJ1ZTtcbiAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpZicpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnaWYnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICd3aGlsZScgfHwgdyA9PT0gJ3VudGlsJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdsb29wJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZm9yJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdmb3InLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdzZWxlY3QnKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ3NlbGVjdCcsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2RvJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdsb29wJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgdC5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICd0aGVuJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJykge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0LmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2Vsc2UnIHx8IHcgPT09ICdlbGlmJykge1xuICAgICAgICAgIC8vIGVsc2UvZWxpZiByZXF1aXJlIGEgYm9keSBhbHJlYWR5IFx1MjAxNCBhbiBlbXB0eSBpZi1saXN0IGlzIGFuIGVycm9yLlxuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJyB8fCAhdC5ib2R5KSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2luJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdmaScpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdkb25lJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdsb29wJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdlc2FjJykge1xuICAgICAgICAgIC8vIE5vIG9wZW4gcmVnaW9uIFx1MjAxNCBhIHN0cmF5IGVzYWMgaXMgYSBwYXJzZSBlcnJvci5cbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGlmIChmdW5jdGlvblNlZW4pIHtcbiAgICAgICAgICAgIGlmIChuYW1lU2Vlbikge1xuICAgICAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG5hbWVTZWVuID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFuIGFyZ3VtZW50LXBvc2l0aW9uIHdvcmQ6IG5vdGhpbmcgb3BlbnMsIHRoZSBlbXB0eS1ib2R5IGZsYWdcbiAgICAgICAgLy8gY2xlYXJzLCBhbmQgdGhlIGZ1bmN0aW9uLW5hbWUgaGFuZG9mZiBhZHZhbmNlcy5cbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIGlmIChmdW5jdGlvblNlZW4pIHtcbiAgICAgICAgICBpZiAobmFtZVNlZW4pIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICAgICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmFtZVNlZW4gPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnVmICs9IHc7XG4gICAgICBpID0gajtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBBIGA7YC9gJmAgZGlyZWN0bHkgYWZ0ZXIgYW4gb3BlbmVyIG9yIGJvZHkga2V5d29yZCBpcyBhbiBlbXB0eS1saXN0XG4gICAgLy8gcGFyc2UgZXJyb3IgYXQgYW55IGRlcHRoIChgaWYgdHJ1ZTsgdGhlbjsgZmlgLCBgeyA7IH1gLFxuICAgIC8vIGBmb3IgaSBpbiBhIGI7IGRvOyBkb25lYCwgYCggaWYgdHJ1ZTsgdGhlbjsgZmkgKWApLlxuICAgIGlmIChjYXNlUmVnaW9uID09PSBudWxsICYmIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCAmJiAoYyA9PT0gJzsnIHx8IGMgPT09ICcmJykgJiYgYWZ0ZXJLZXl3b3JkKSB7XG4gICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZWRpcmVjdCB0b2tlbiB3aXRoIG5vIHRhcmdldCB3b3JkLCBpbW1lZGlhdGVseSBmb2xsb3dlZCBieSBhbm90aGVyXG4gICAgICAvLyByZWRpcmVjdCB0b2tlbiBtaWQtc3RhZ2UsIGlzIGEgcGFyc2UgZXJyb3I6IGBjYXQgZiA+ID4gb3V0YCxcbiAgICAgIC8vIGBjYXQgZiA+IDI+JjFgLCBgY2F0IGYgPiAmPm91dGAsIGBjYXQgZiA+IDw8PCB4YCAocGxhbiBcdTAwQTcxKS5cbiAgICAgIGlmIChpc1dvcmRTdGFydCgpICYmIGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkgJiYgc3RhcnRzUmVkaXJlY3RBdChpKSkge1xuICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICckJyAmJiBjbWRbaSArIDFdID09PSAneycpIHtcbiAgICAgICAgYnJhY2VEZXB0aCArPSAxO1xuICAgICAgICBidWYgKz0gYztcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIEhlcmVkb2MgcmVjb2duaXRpb24gKHBsYW4gXHUwMEE3Myk6IGA8PGAvYDw8LWAgKG5vdCBgPDw8YCkgYXQgZGVwdGggMCB3aXRoXG4gICAgICAvLyBhIGRlbGltaXRlciB3b3JkLiBUaGUgb3BlcmF0b3IrZGVsaW1pdGVyIGFyZSBzdHJpcHBlZCBmcm9tIHRoZSBzdGFnZVxuICAgICAgLy8gdGV4dCBcdTIwMTQgdGhlIHN0YWdlIGtlZXBzIGEgcGxhaW4gYXJndiAoYGNhdCBmYCBzdGF5cyBgY2F0IGZgKS5cbiAgICAgIGlmIChjID09PSAnPCcgJiYgY21kW2kgKyAxXSA9PT0gJzwnICYmIGNtZFtpICsgMl0gIT09ICc8Jykge1xuICAgICAgICBsZXQgaiA9IGkgKyAyO1xuICAgICAgICBsZXQgYWxsb3dUYWJzID0gZmFsc2U7XG4gICAgICAgIGlmIChjbWRbal0gPT09ICctJykge1xuICAgICAgICAgIGFsbG93VGFicyA9IHRydWU7XG4gICAgICAgICAgaiArPSAxO1xuICAgICAgICB9XG4gICAgICAgIHdoaWxlIChjbWRbal0gPT09ICcgJyB8fCBjbWRbal0gPT09ICdcXHQnKSBqICs9IDE7XG4gICAgICAgIGxldCBkZWxpbSA9ICcnO1xuICAgICAgICBpZiAoY21kW2pdID09PSBcIidcIiB8fCBjbWRbal0gPT09ICdcIicpIHtcbiAgICAgICAgICBjb25zdCBxID0gY21kLmluZGV4T2YoY21kW2pdLCBqICsgMSk7XG4gICAgICAgICAgaWYgKHEgPT09IC0xKSB7XG4gICAgICAgICAgICBkZWxpbSA9IGNtZC5zbGljZShqICsgMSk7XG4gICAgICAgICAgICBqID0gbjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVsaW0gPSBjbWQuc2xpY2UoaiArIDEsIHEpO1xuICAgICAgICAgICAgaiA9IHEgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCB3b3JkU3RhcnQgPSBqO1xuICAgICAgICAgIHdoaWxlIChqIDwgbiAmJiAhV09SRF9FTkQudGVzdChjbWRbal0pKSBqICs9IDE7XG4gICAgICAgICAgZGVsaW0gPSBjbWQuc2xpY2Uod29yZFN0YXJ0LCBqKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaW0gIT09ICcnKSB7XG4gICAgICAgICAgaGVyZWRvY3MucHVzaCh7XG4gICAgICAgICAgICBjbG9zZTogbmV3IFJlZ0V4cChgXiR7YWxsb3dUYWJzID8gJ1xcdConIDogJyd9JHtlc2NhcGVSZWdFeHAoZGVsaW0pfVsgXFxcXHRdKiRgKVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIC8vIFRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgbGVhdmUgdGhlIHN0YWdlIHRleHQgYmVsb3csIHNvIG1hcmsgdGhlXG4gICAgICAgICAgLy8gc3RhZ2U6IGl0cyBzdGRpbiBjb21lcyBmcm9tIHRoZSBoZXJlZG9jIGJvZHksIGFuZCBjb25zdW1lcnMgdGhhdFxuICAgICAgICAgIC8vIHJlYWQgYDxgIGZyb20gdGhlIHRleHQgd291bGQgb3RoZXJ3aXNlIG5ldmVyIHNlZSB0aGUgcmVkaXJlY3QuXG4gICAgICAgICAgYnVmSGVyZWRvYyA9IHRydWU7XG4gICAgICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgICAgICAvLyBJbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgdGhlIG9wZXJhdG9yK2RlbGltaXRlciBzdGF5IGluIHRoZVxuICAgICAgICAgICAgLy8gc3RhZ2UgdGV4dCBcdTIwMTQgdGhlIHdhbGsncyBpbnRlcmlvciByZS1zcGxpdCByZS1yZWNvZ25pemVzIHRoZVxuICAgICAgICAgICAgLy8gaGVyZWRvYyB0aGVyZSAocGxhbiBcdTAwQTczKS5cbiAgICAgICAgICAgIGJ1ZiArPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICAgICAgfVxuICAgICAgICAgIGkgPSBqO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBXaGlsZSBhIGNvbnN0cnVjdCBpcyBvcGVuIGF0IGRlcHRoIDAgdGhlIGJvdW5kYXJ5IG9wZXJhdG9ycyBhcmUgdGV4dCBcdTIwMTRcbiAgICAgIC8vIHRoZSBjb25zdHJ1Y3QgaXMgb25lIHN0YWdlLlxuICAgICAgaWYgKGNhc2VSZWdpb24gPT09IG51bGwgJiYgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICcmJicpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ2FuZCcpO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3x8Jykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnb3InKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ3BpcGUnKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnc2VtaWNvbG9uJyk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ3BpcGUnKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAgICAgLy8gQSBuZXdsaW5lIGlzIGEgbGluZSBjb250aW51YXRpb24gXHUyMDE0IG5vdCBhIHN0YXRlbWVudCBzZXBhcmF0b3IgXHUyMDE0IHdoZW5cbiAgICAgICAgICAvLyBhIHBpcGUvYW5kL29yIG9wZXJhdG9yIGlzIHBlbmRpbmcgd2l0aCBhIHdoaXRlc3BhY2Utb25seSBidWZmZXJcbiAgICAgICAgICAvLyBzaW5jZSBpdCAoYGNhdCBhLnR4dCB8XFxuc2VkIC4uLmAsIGBmYWxzZSAmJlxcbnNlZCAuLi5gKS4gYGNhdCBmIHwgaGVhZCAtMVxcbmNhdCBnYFxuICAgICAgICAgIC8vIGlzIHRoZXJlZm9yZSB0d28gbGlzdHMsIGFuZCBhIHJlZGlyZWN0IHRhcmdldCBuZXZlciBjb250aW51ZXMgb250b1xuICAgICAgICAgIC8vIGEgbGF0ZXIgbGluZSAocGxhbiBcdTAwQTcxKS5cbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICAgICAgICBsaXN0U3RhcnQgPSBwYXJ0cy5sZW5ndGg7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgICAgICAvLyBBIGJhcmUgYCZgIGlzIGEgYmFja2dyb3VuZCBvcGVyYXRvciBvbmx5IHdoZW4gaXQgaXMgbm90IHBhcnQgb2YgYVxuICAgICAgICAgIC8vIHJlZGlyZWN0IHRva2VuOiB0aGUgbmV4dCBjaGFyYWN0ZXIgaXMgYD5gIChgJj5gL2AmPj5gKSwgb3IgdGhlXG4gICAgICAgICAgLy8gYnVmZmVyJ3MgbGFzdCBjaGFyYWN0ZXIgaXMgYD5gIG9yIGA8YCAoYDI+JjFgLCBgPiYgZmlsZWAsIGAzPCYwYCkuXG4gICAgICAgICAgLy8gU3BsaXR0aW5nIGluc2lkZSB0aG9zZSB0b2tlbnMgd291bGQgcHJvZHVjZSBqdW5rIHN0YWdlcy5cbiAgICAgICAgICBjb25zdCBuZXh0ID0gY21kW2kgKyAxXTtcbiAgICAgICAgICBjb25zdCBsYXN0ID0gYnVmW2J1Zi5sZW5ndGggLSAxXTtcbiAgICAgICAgICBpZiAobmV4dCAhPT0gJz4nICYmIGxhc3QgIT09ICc+JyAmJiBsYXN0ICE9PSAnPCcpIHtcbiAgICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZsdXNoKCdiYWNrZ3JvdW5kJyk7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG5cbiAgLy8gRW5kIG9mIGlucHV0OiB0aGUgRU9GLXN0YXRlIHZlcmRpY3RzIFx1MjAxNCBhbiB1bmNsb3NlZCBxdW90ZSwgYnJhY2UsIGNhc2VcbiAgLy8gcmVnaW9uLCBwYXJlbiBsZXZlbCwgb3IgY29uc3RydWN0IFx1MjAxNCB0aGVuIHRoZSB1bmNvbnN1bWVkLW9wZXJhdG9yIGNoZWNrcyxcbiAgLy8gdGhlbiB0aGUgdW50ZXJtaW5hdGVkLWhlcmVkb2MgcGFydGlhbCwgdGhlbiB0aGUgZmluYWwgZmx1c2guIEEgdmVyZGljdFxuICAvLyBzZXQgbWlkLXNjYW4gYWxyZWFkeSBkcm9wcGVkIHRoZSByZWplY3RpbmcgbGlzdCBhbmQgZW5kZWQgdGhlIGxvb3AsIHNvXG4gIC8vIGBwYXJ0c2AgaXMgZXhhY3RseSB0aGUgY29tcGxldGVkIGVhcmxpZXIgbGlzdHMgaGVyZS5cbiAgaWYgKG1hbGZvcm1lZCkgcmV0dXJuIHsgc3RhZ2VzOiBwYXJ0cywgbWFsZm9ybWVkIH07XG4gIGlmIChpblNxdW90ZSB8fCBpbkRxdW90ZSkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtcXVvdGUnKTtcbiAgfSBlbHNlIGlmIChicmFjZURlcHRoID4gMCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtYnJhY2UnKTtcbiAgfSBlbHNlIGlmIChjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgcmVqZWN0KCd1bmNsb3NlZC1jYXNlJyk7XG4gIH0gZWxzZSBpZiAoZGVwdGggPiAwKSB7XG4gICAgcmVqZWN0KCd1bmJhbGFuY2VkLXBhcmVuJyk7XG4gIH0gZWxzZSBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwKSB7XG4gICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgfSBlbHNlIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gIH0gZWxzZSBpZiAoaW5Cb2R5IHx8IGhlcmVkb2NzLmxlbmd0aCA+IDApIHtcbiAgICAvLyBVbnRlcm1pbmF0ZWQgaGVyZWRvYyBcdTIwMTQgYmFzaCB3YXJucywgcnVucyB0aGUgZGVsaW1pdGVyJ3MgbGluZSwgYW5kXG4gICAgLy8gdHJlYXRzIHRoZSB0YWlsIGFzIGJvZHk6IHRoZSBwYXJ0aWFsLiBUaGUgZGVsaW1pdGVyJ3MtbGluZSBzdGFnZShzKVxuICAgIC8vIGFuYWx5emUgYXMtaXM7IHRoZSBib2R5IHByb2R1Y2VzIG5vIHN0YWdlcyAocGxhbiBcdTAwQTczKS5cbiAgICBmbHVzaCgnbmV3bGluZScpO1xuICAgIG1hbGZvcm1lZCA9ICd1bnRlcm1pbmF0ZWQtaGVyZWRvYyc7XG4gIH0gZWxzZSB7XG4gICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgfVxuICByZXR1cm4geyBzdGFnZXM6IHBhcnRzLCBtYWxmb3JtZWQgfTtcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBRdW90ZS1hd2FyZSB3aGl0ZXNwYWNlIHRva2VuaXplciwgcm91Z2hseSBtYXRjaGluZyBgc2hsZXguc3BsaXQocywgcG9zaXg9VHJ1ZSlgLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRXb3JkcyhzOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB3b3Jkczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1ciA9ICcnO1xuICBsZXQgaGFzID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBpZiAoaGFzKSB7XG4gICAgICAgIHdvcmRzLnB1c2goY3VyKTtcbiAgICAgICAgY3VyID0gJyc7XG4gICAgICAgIGhhcyA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnN0IGVuZCA9IHMuaW5kZXhPZihcIidcIiwgaSk7XG4gICAgICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBjdXIgKz0gcy5zbGljZShpLCBlbmQpO1xuICAgICAgaSA9IGVuZCArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgc1tpXSAhPT0gJ1wiJykge1xuICAgICAgICBpZiAoc1tpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaSArIDFdKSkge1xuICAgICAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3VyICs9IHNbaV07XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBoYXMgPSB0cnVlO1xuICAgIGN1ciArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBpZiAoaGFzKSB3b3Jkcy5wdXNoKGN1cik7XG4gIHJldHVybiB3b3Jkcztcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGFuIFVOUVVPVEVEIGA8YCBcdTIwMTQgYSBzdGRpbiByZWRpcmVjdCwgc3RhbmRhbG9uZSAoYDwgZmlsZWApIG9yIGdsdWVkXG4gKiBpbnNpZGUgYSB0b2tlbiAoYGhlYWQgLTI8ZmAsIGByZyBuZWVkbGU8ZmAsIGEgY29uc3VtZWQgYC1lYC9gLWZgIHZhbHVlIGxpa2VcbiAqIGAtZSBuZWVkbGU8ZmApIFx1MjAxNCBhcHBlYXJzIGluIGEgc2ltcGxlIGNvbW1hbmQuIEJhc2ggdHJlYXRzIGA8YCBhcyBhIHJlZGlyZWN0XG4gKiBvcGVyYXRvciBvbmx5IG91dHNpZGUgcXVvdGVzLCBzbyB0aGUgc2NhbiBpcyBxdW90ZS1hd2FyZTogYSBsaXRlcmFsIGA8YCBpblxuICogYSBwYXR0ZXJuIGxpa2UgYHJnIC1uICc8ZGl2PidgIG9yIGFuIGF3ayBzY3JpcHQgbGlrZSBgJ05SPD0yJ2AgbXVzdCBuZXZlclxuICogYmUgbWlzdGFrZW4gZm9yIGEgcmVkaXJlY3QuIFByb2Nlc3Mgc3Vic3RpdHV0aW9uIGA8KFx1MjAyNilgIGFuZCBoZXJlLXN0cmluZ3NcbiAqIGA8PDxgIGFsc28gYmVnaW4gd2l0aCBhbiB1bnF1b3RlZCBgPGAgXHUyMDE0IGJvdGggY291bnQgYXMgcmVkaXJlY3RzIGhlcmUgKGZhaWxcbiAqIGNsb3NlZDsgYSByZWFkLXRvdWNoIGJpbiBuZXZlciBsZWdpdGltYXRlbHkgbmVlZHMgdGhlbSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoYXNVbnF1b3RlZFJlZGlyZWN0KHNpbXBsZUNtZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzaW1wbGVDbWQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gc2ltcGxlQ21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgLy8gTm8gZXNjYXBlcyBpbnNpZGUgc2luZ2xlIHF1b3RlcyBcdTIwMTQgdGhlIG5leHQgYCdgIGFsd2F5cyBjbG9zZXMuXG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICAvLyBJbnNpZGUgZG91YmxlIHF1b3RlcyBhIGJhY2tzbGFzaCBvbmx5IGVzY2FwZXMgYFwiYCwgYFxcYCwgYCRgLCBhbmRcbiAgICAgIC8vIGJhY2t0aWNrOyBldmVyeXRoaW5nIGVsc2UgKGluY2x1ZGluZyBgPGApIGlzIGxpdGVyYWwuXG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgc2ltcGxlQ21kLmxlbmd0aCAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNpbXBsZUNtZFtpICsgMV0pKSB7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH0gZWxzZSBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgICBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IHNpbXBsZUNtZC5sZW5ndGgpIHtcbiAgICAgIC8vIEFuIGVzY2FwZWQgY2hhcmFjdGVyIGlzIGxpdGVyYWwgXHUyMDE0IGBcXDxgIGlzIG5vdCBhIHJlZGlyZWN0LlxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHNwbGl0LiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgcmV0dXJuIHNwbGl0V29yZHMoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xufVxuXG4vKipcbiAqIFJlZGlyZWN0IG9wZXJhdG9ycyB0aGF0IGRyb3AgdG9nZXRoZXIgd2l0aCB0aGVpciBwbGFpbiB0YXJnZXQgd29yZCAocGxhbiBcdTAwQTc0XG4gKiB0d28tdG9rZW4gc2hhcGVzKTogYD5gLCBgPj5gLCBgPGAsIGA8PmAsIGAmPmAsIGAmPj5gLCBhbmQgZGlnaXQtcHJlZml4ZWRcbiAqIGZvcm1zIGxpa2UgYDI+YC9gMj4+YC9gMzxgLiBgPnxgIGlzIGRlbGliZXJhdGVseSBhYnNlbnQgXHUyMDE0IGl0IGZhaWxzIGNsb3NlZC5cbiAqL1xuY29uc3QgUkVESVJFQ1RfVFdPX1RPS0VOID0gL14oPzo+Pj98PD58PHwmPj4/fFswLTldKyg/Oj4+P3w8Pnw8KSkkLztcblxuLyoqIER1cCBmb3JtcyB0aGF0IGRyb3AgYWxvbmUgKHBsYW4gXHUwMEE3NCk6IGAyPiYxYCwgYD4mLWAsIGAzPCYwYC4gKi9cbmNvbnN0IFJFRElSRUNUX0RVUCA9IC9eKD86WzAtOV0rKT9bPD5dJig/OlswLTldK3wtKSQvO1xuXG4vKiogRnVzZWQgb3BlcmF0b3IrdGFyZ2V0IHdvcmRzIHRoYXQgZHJvcCB3aG9sZSAocGxhbiBcdTAwQTc0KTogYD5vdXRgLCBgMj5lcnJgLCBgJj5vdXRgLiAqL1xuY29uc3QgUkVESVJFQ1RfRlVTRUQgPSAvXig/Oj4+P3w8Pnw8fCY+Pj98WzAtOV0rKD86Pj4/fDw+fDwpKVtePD4mfF0vO1xuXG4vKiogSGVyZWRvYy9oZXJlLXN0cmluZyBvcGVyYXRvcnMgd2l0aCBhIHNlcGFyYXRlIHRhcmdldCB3b3JkOiBgPDxgLCBgPDwtYCwgYDw8PGAuICovXG5jb25zdCBIRVJFRE9DX1RXT19UT0tFTiA9IC9eKD86PDwtP3w8PDwpJC87XG5cbi8qKiBGdXNlZCBoZXJlZG9jIHdvcmRzIChwbGFuIFx1MDBBNzQpOiBgPDxFT0ZgLCBgPDwtRU9GYCwgYDw8PHhgLiAqL1xuY29uc3QgSEVSRURPQ19GVVNFRCA9IC9eKD86PDwtP3w8PDwpW148PiZ8XS87XG5cbi8qKiBXaGV0aGVyIGEgd29yZCBpcyBpdHNlbGYgYSByZWRpcmVjdCB0b2tlbiBcdTIwMTQgbmV2ZXIgYSB2YWxpZCByZWRpcmVjdCB0YXJnZXQuICovXG5jb25zdCBSRURJUkVDVF9UT0tFTiA9ICh3OiBzdHJpbmcpOiBib29sZWFuID0+XG4gIFJFRElSRUNUX1RXT19UT0tFTi50ZXN0KHcpIHx8XG4gIFJFRElSRUNUX0RVUC50ZXN0KHcpIHx8XG4gIFJFRElSRUNUX0ZVU0VELnRlc3QodykgfHxcbiAgSEVSRURPQ19UV09fVE9LRU4udGVzdCh3KSB8fFxuICBIRVJFRE9DX0ZVU0VELnRlc3Qodyk7XG5cbi8qKlxuICogU3RyaXAgcmVkaXJlY3QgdG9rZW5zIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIGFyZ3Ygc28gdGhlIHJlYWQtc2lkZVxuICogbWF0Y2hlcnMgc2VlIHRoZSB3b3JkcyB0aGF0IHdlcmUgYWN0dWFsbHkgcmVhZCAocGxhbiBcdTAwQTc0KTogdHdvLXRva2VuXG4gKiBvcGVyYXRvcnMgKGA+YCwgYD4+YCwgYDxgLCBgPD5gLCBgJj5gLCBgJj4+YCwgZGlnaXQtcHJlZml4ZWQgYDI+YC9gMj4+YC9cbiAqIGAzPGAsIC4uLikgZHJvcCB0b2dldGhlciB3aXRoIHRoZWlyIHBsYWluIHRhcmdldCB3b3JkLCBkdXAgZm9ybXMgKGAyPiYxYCxcbiAqIGA+Ji1gLCBgMzwmMGApIGRyb3AgYWxvbmUsIGZ1c2VkIGZvcm1zIChgPm91dGAsIGAyPmVycmAsIGAmPm91dGApIGRyb3AgYXNcbiAqIG9uZSB3b3JkLCBhbmQgaGVyZWRvYy9oZXJlLXN0cmluZyBvcGVyYXRvcnMgZHJvcCB3aXRoIHRoZWlyIHRhcmdldCB3b3JkIGluXG4gKiBib3RoIHNwZWxsaW5ncy4gQSB0d28tdG9rZW4gb3BlcmF0b3IncyB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIGZpbGUgd29yZCBcdTIwMTQgYVxuICogZm9sbG93aW5nIHJlZGlyZWN0IHRva2VuIChgY2F0IGYgPiAyPiYxYCkgaXMgYmFzaCdzIFwic3ludGF4IGVycm9yIG5lYXJcbiAqIHVuZXhwZWN0ZWQgdG9rZW5cIiBhbmQgbGVhdmVzIHRoZSBvcGVyYXRvciBkYW5nbGluZywgdW5tYXRjaGVkLiBBbnl0aGluZ1xuICogZWxzZSBiZWdpbm5pbmcgd2l0aCBgPmAvYDxgIChub3RhYmx5IGA+fGApIGlzIGxlZnQgYWxvbmUgXHUyMDE0IHRoZSBjYWxsZXJcbiAqIHRyZWF0cyBhIHJlc2lkdWFsIHJlZGlyZWN0IHdvcmQgYXMgYW4gdW5tYXRjaGVkIHN0YWdlLiBBcHBsaWVkIHRvIGV2ZXJ5XG4gKiBzdGFnZSBcdTIwMTQgc291cmNlcywgc2VsZWN0b3JzLCBhbmQgcHJlZGljYXRlcyBcdTIwMTQgYmVmb3JlIHN0YXR1cyBldmFsdWF0aW9uIGFuZFxuICogbWF0Y2hlciBkaXNwYXRjaC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwUmVkaXJlY3RzKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChSRURJUkVDVF9UV09fVE9LRU4udGVzdChhKSB8fCBIRVJFRE9DX1RXT19UT0tFTi50ZXN0KGEpKSB7XG4gICAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07XG4gICAgICAvLyBUaGUgb3BlcmF0b3IncyB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIGZpbGUgd29yZCBcdTIwMTQgYSBmb2xsb3dpbmcgcmVkaXJlY3RcbiAgICAgIC8vIHRva2VuIG1lYW5zIHRoZSBvcGVyYXRvciBkYW5nbGVzIGFuZCB0aGUgY29tbWFuZCBuZXZlciBydW5zLiBUaGVcbiAgICAgIC8vIGRhbmdsaW5nIG9wZXJhdG9yIGl0c2VsZiBpcyBsZWZ0IGluIHBsYWNlIHNvIHRoZSBjYWxsZXIgcmVqZWN0cyB0aGVcbiAgICAgIC8vIHN0YWdlIGFzIHVubWF0Y2hlZC5cbiAgICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIVJFRElSRUNUX1RPS0VOKG5leHQpKSB7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG91dC5wdXNoKGEpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChSRURJUkVDVF9EVVAudGVzdChhKSB8fCBSRURJUkVDVF9GVVNFRC50ZXN0KGEpIHx8IEhFUkVET0NfRlVTRUQudGVzdChhKSkgY29udGludWU7XG4gICAgb3V0LnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFNoZWxsIGJ1aWx0aW5zIHRoZSB3YWxrIHJlY29nbml6ZXMgYSBgYnVpbHRpbmAgd3JhcHBlciBtYXkgZm9yd2FyZCAocGxhbiBcdTAwQTc1KS4gKi9cbmNvbnN0IFdSQVBQRVJfQlVJTFRJTlMgPSBuZXcgU2V0KFtcbiAgJ2V4aXQnLFxuICAnZXhlYycsXG4gICd0cnVlJyxcbiAgJ2ZhbHNlJyxcbiAgJzonLFxuICAnY2QnLFxuICAnc2V0JyxcbiAgJ3Vuc2V0JyxcbiAgJ2V4cG9ydCcsXG4gICdyZWFkb25seScsXG4gICdyZXR1cm4nLFxuICAnYnJlYWsnLFxuICAnY29udGludWUnXG5dKTtcblxuLyoqIEV4dGVybmFscyB3aG9zZSBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGhzIHN0cmlwIHRvIHRoZWlyIGJhc2VuYW1lIChwbGFuIFx1MDBBNzUpLiAqL1xuY29uc3QgUkVDT0dOSVpFRF9FWFRFUk5BTF9OQU1FUyA9IG5ldyBTZXQoW1xuICAnc2VkJyxcbiAgJ2hlYWQnLFxuICAndGFpbCcsXG4gICdjYXQnLFxuICAnbmwnLFxuICAnZ2l0JyxcbiAgJ3RydWUnLFxuICAnZmFsc2UnLFxuICAndGltZW91dCcsXG4gICdlbnYnLFxuICAnY29tbWFuZCdcbl0pO1xuXG4vKiogQSBgdGltZW91dGAgZHVyYXRpb24gd29yZDogYDVgLCBgNS41c2AsIGAxbWAsIGAyaGAsIC4uLiAqL1xuY29uc3QgVElNRU9VVF9EVVJBVElPTiA9IC9eXFxkKyg/OlxcLlxcZCspP1tzbWhkXT8kLztcblxuLyoqIEEgbGl0ZXJhbCBgTkFNRT12YWx1ZWAgZW52LXByZWZpeCB3b3JkLiAqL1xuY29uc3QgRU5WX0FTU0lHTk1FTlQgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LiokLztcblxuLyoqXG4gKiBPbmUgc3RyaXAgc3RlcC4gUmV0dXJucyBudWxsIHdoZW4gdGhlIHdyYXBwZXIgaXMgbm90IGNsZWFuIChmYWlsIGNsb3NlZCBcdTIwMTRcbiAqIHRoZSBjYWxsZXIgcmVzdG9yZXMgdGhlIG9yaWdpbmFsIGFyZ3YsIHNvIG5vdGhpbmcgaXMgZm9yd2FyZGVkIHRvIHRoZVxuICogbWF0Y2hlcnMpLCBvciB0aGUgYXJndiB3aXRoIG9uZSB3cmFwcGVyIGxheWVyIHJlbW92ZWQuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwV3JhcHBlcnNPbmNlKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10gfCBudWxsIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICBpZiAoaSA+PSBhcmd2Lmxlbmd0aCkgcmV0dXJuIGFyZ3Yuc2xpY2UoaSk7XG4gIGNvbnN0IGhlYWQgPSBhcmd2W2ldO1xuICBpZiAoaGVhZCA9PT0gJ2NvbW1hbmQnKSB7XG4gICAgY29uc3QgbmV4dCA9IGFyZ3ZbaSArIDFdO1xuICAgIGlmIChuZXh0ID09PSAnLXYnIHx8IG5leHQgPT09ICctVicpIHJldHVybiBudWxsOyAvLyBhIHF1ZXJ5IFx1MjAxNCBydW5zIG5vdGhpbmdcbiAgICBpZiAobmV4dCA9PT0gJy1wJykgcmV0dXJuIGFyZ3Yuc2xpY2UoaSArIDIpO1xuICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIW5leHQuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gYXJndi5zbGljZShpICsgMSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKGhlYWQgPT09ICdidWlsdGluJykge1xuICAgIGNvbnN0IG5leHQgPSBhcmd2W2kgKyAxXTtcbiAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmIFdSQVBQRVJfQlVJTFRJTlMuaGFzKG5leHQpKSByZXR1cm4gYXJndi5zbGljZShpICsgMik7XG4gICAgcmV0dXJuIG51bGw7IC8vIGBidWlsdGluIHNlZGAgZXJyb3JzIFx1MjAxNCBuZXZlciBmb3J3YXJkIGEgbm9uLWJ1aWx0aW4gd29yZFxuICB9XG4gIGlmIChoZWFkID09PSAnZW52Jykge1xuICAgIGxldCBqID0gaSArIDE7XG4gICAgd2hpbGUgKGogPCBhcmd2Lmxlbmd0aCAmJiBFTlZfQVNTSUdOTUVOVC50ZXN0KGFyZ3Zbal0pKSBqKys7XG4gICAgaWYgKGogPT09IGkgKyAxKSByZXR1cm4gbnVsbDsgLy8gYC1pYCwgYC11IFhgLCBhIG5vbi1hc3NpZ25tZW50IHdvcmQgXHUyMDE0IG5vdCBhIGNsZWFuIHdyYXBwZXJcbiAgICByZXR1cm4gYXJndi5zbGljZShqKTtcbiAgfVxuICBpZiAoaGVhZCA9PT0gJ3RpbWVvdXQnKSB7XG4gICAgbGV0IGogPSBpICsgMTtcbiAgICB3aGlsZSAoaiA8IGFyZ3YubGVuZ3RoICYmIGFyZ3Zbal0uc3RhcnRzV2l0aCgnLS0nKSkgaisrO1xuICAgIGlmIChqID49IGFyZ3YubGVuZ3RoIHx8ICFUSU1FT1VUX0RVUkFUSU9OLnRlc3QoYXJndltqXSkpIHJldHVybiBudWxsOyAvLyBubyBkdXJhdGlvbiBcdTIwMTQgbm90aGluZyBydW5zXG4gICAgcmV0dXJuIGFyZ3Yuc2xpY2UoaiArIDEpO1xuICB9XG4gIGlmIChoZWFkLnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGNvbnN0IGJhc2UgPSBoZWFkLnNsaWNlKGhlYWQubGFzdEluZGV4T2YoJy8nKSArIDEpO1xuICAgIGlmIChSRUNPR05JWkVEX0VYVEVSTkFMX05BTUVTLmhhcyhiYXNlKSkgcmV0dXJuIFtiYXNlLCAuLi5hcmd2LnNsaWNlKGkgKyAxKV07XG4gICAgcmV0dXJuIG51bGw7IC8vIGAvdXNyL2Jpbi9leGl0YCBhbmQgZnJpZW5kcyBhcmUgbm90IHJlY29nbml6ZWQgZXh0ZXJuYWxzXG4gIH1cbiAgaWYgKGhlYWQuaW5jbHVkZXMoJy8nKSkgcmV0dXJuIG51bGw7IC8vIGEgcmVsYXRpdmUgY29sbGlkaW5nIHBhdGggaXMgYSBsb2NhbCBiaW5hcnksIG5vdCB0aGUgY29yZXV0aWxcbiAgcmV0dXJuIGFyZ3Yuc2xpY2UoaSk7XG59XG5cbi8qKlxuICogU3RyaXAgdHJhbnNwYXJlbnQgd3JhcHBlciBwcmVmaXhlcyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyBhcmd2IHNvIG1hdGNoZXJcbiAqIGRpc3BhdGNoIHNlZXMgdGhlIHVuZGVybHlpbmcgY29tbWFuZCB3b3JkIChwbGFuIFx1MDBBNzUpOiBgY29tbWFuZGAgKHN0b3BwaW5nIGF0XG4gKiB0aGUgcXVlcnkgZm9ybXMgYC12YC9gLVZgKSwgYGJ1aWx0aW5gIHJlc3RyaWN0ZWQgdG8gdGhlIHdhbGsncyByZWNvZ25pemVkXG4gKiBidWlsdGlucywgYGVudiBOQU1FPXZhbHVlYCBwcmVmaXhlcywgYHRpbWVvdXRgIHBsdXMgaXRzIGAtLSpgIGZsYWdzIGFuZCBvbmVcbiAqIGR1cmF0aW9uLCBhbmQgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRocyB3aG9zZSBiYXNlbmFtZSBpcyBpbiB0aGUgcmVjb2duaXplZFxuICogc2V0IFx1MjAxNCBpdGVyYXRpbmcgdW50aWwgZml4ZWQtcG9pbnQgc28gc3RhY2tlZCB3cmFwcGVycyBzdGlsbCByZWFjaCB0aGUgd29yZC5cbiAqIEFueSB1bmNsZWFuIHdyYXBwZXIgZmFpbHMgY2xvc2VkOiB0aGUgb3JpZ2luYWwgYXJndiBpcyByZXR1cm5lZCB1bmNoYW5nZWQsXG4gKiBzbyB0aGUgc3RhZ2UgbWF0Y2hlcyBub3RoaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBXcmFwcGVycyhhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGN1cnJlbnQgPSBhcmd2O1xuICBmb3IgKGxldCBpdGVyID0gMDsgaXRlciA8IGFyZ3YubGVuZ3RoICsgMjsgaXRlcisrKSB7XG4gICAgY29uc3QgbmV4dCA9IHN0cmlwV3JhcHBlcnNPbmNlKGN1cnJlbnQpO1xuICAgIGlmIChuZXh0ID09PSBudWxsKSByZXR1cm4gYXJndjtcbiAgICBpZiAobmV4dC5sZW5ndGggPT09IGN1cnJlbnQubGVuZ3RoICYmIG5leHQuZXZlcnkoKHcsIGspID0+IHcgPT09IGN1cnJlbnRba10pKSByZXR1cm4gY3VycmVudDtcbiAgICBjdXJyZW50ID0gbmV4dDtcbiAgfVxuICByZXR1cm4gYXJndjtcbn1cbiIsICIvKipcbiAqIFZhcmlhYmxlIHJlc29sdXRpb24gZm9yIHRoZSBleGVjdXRpb24tYXdhcmUgQmFzaCB0b3VjaCBwYXJzZXIgKHBsYW4gXHUwMEE3NykuXG4gKlxuICogRXhwYW5zaW9uIHJ1bnMgb3ZlciB0aGUgcmF3IHNpbXBsZS1jb21tYW5kIHRleHQgKmJlZm9yZSogdG9rZW5pemluZywgd2l0aCBhXG4gKiBxdW90ZS1hd2FyZSBzY2FubmVyOiBzaW5nbGUtcXVvdGVkIHNwYW5zIHN0YXkgbGl0ZXJhbCwgZG91YmxlLXF1b3RlZCBhbmRcbiAqIHVucXVvdGVkIHNwYW5zIGV4cGFuZCBgJFZBUmAgYW5kIGAke1ZBUn1gIChncmVlZHkgaWRlbnRpZmllciksIGFuZCBhXG4gKiBiYWNrc2xhc2gtZXNjYXBlZCBgJGAgc3RheXMgbGl0ZXJhbC4gRXhwYW5kaW5nIGJlZm9yZSB0b2tlbml6aW5nIGtlZXBzIGFuXG4gKiBleHBhbmRlZCB2YWx1ZSdzIGAmJmAvc3BhY2VzIG91dCBvZiB0aGUgc3BsaXR0ZXIncyByZWFjaC4gVmFsdWUgcHJlY2VkZW5jZVxuICogaXMgc2NyaXB0IHZhcmlhYmxlIHRhYmxlID4gZW52ID4gdW5yZXNvbHZlZCBcdTIwMTQgYSBuYW1lIGFic2VudCBmcm9tIGJvdGggaXNcbiAqIGxlZnQgYXMgdGhlIHJlc2lkdWFsIGAkYCwgd2hpY2ggdHJpcHMgdGhlIHBhcnNlcidzIGBsb29rc1VucmVzb2x2YWJsZWAgcGF0aFxuICogKGZhaWwgY2xvc2VkLCBubyB0b3VjaCkuXG4gKlxuICogVGhlIGVudiBpcyBleHBlY3RlZCB0byBiZSBwcmUtY3VyYXRlZDogYHBhcnNlQ29tbWFuZERldGFpbGVkYCBnYXRlcyBpdHNcbiAqIGBwcm9jZXNzLmVudmAgZGVmYXVsdCBieSBgUGFyc2VPcHRpb25zLmFsbG93bGlzdGAgKHNvIG9ubHkgdGhlXG4gKiBgREVGQVVMVF9QQVRIX0FMTE9XTElTVGAgbmFtZXMgZXZlciByZXNvbHZlIGZyb20gdGhlIGhvb2sgZW52KSwgd2hpbGUgYW5cbiAqIGV4cGxpY2l0bHkgaW5qZWN0ZWQgZW52IFx1MjAxNCBhcyBpbiB0ZXN0cyBcdTIwMTQgaXMgY29uc3VsdGVkIHdob2xlc2FsZS5cbiAqL1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgYWxsb3dsaXN0IG9mIGhvb2stZW52IHZhcmlhYmxlIG5hbWVzIHBhdGggYXJndW1lbnRzIG1heSByZXNvbHZlXG4gKiBmcm9tIFx1MjAxNCBpZGVudGljYWwgYWNyb3NzIGhhcm5lc3NlcyBzbyB0aGUgc2FtZSBjb21tYW5kIHN0cmluZyBwcm9kdWNlcyB0aGVcbiAqIHNhbWUgdG91Y2hlcyBldmVyeXdoZXJlLiBBbiBhbGxvd2xpc3RlZCBuYW1lIGFic2VudCBmcm9tIGEgcGFydGljdWxhciBob29rXG4gKiBlbnYgc3RheXMgdW5yZXNvbHZlZCAoZmFpbCBjbG9zZWQpLCBzbyB0aGUgbGlzdCBpcyBzYWZlIHRvIHNoYXJlLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9QQVRIX0FMTE9XTElTVCA9IFtcbiAgJ0hPTUUnLFxuICAnUFdEJyxcbiAgJ1dPUktTUEFDRV9QQVRIJyxcbiAgJ0NBUkRfUkVQT19QQVRIJyxcbiAgJ1JFUE9fUk9PVCcsXG4gICdCQVNFX0JSQU5DSCdcbl0gYXMgY29uc3Q7XG5cbi8qKiBBIGJhcmUgcmVmZXJlbmNlIG5hbWU6IGdyZWVkeSBpZGVudGlmaWVyIGFmdGVyIGAkYC4gKi9cbmNvbnN0IEJBUkVfTkFNRSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKi87XG5cbi8qKiBBIGJyYWNlZCByZWZlcmVuY2UgbXVzdCBiZSBleGFjdGx5IGFuIGlkZW50aWZpZXIgXHUyMDE0IGAkeyFYfWAsIGAke1g6LWR9YCwgYCR7I1h9YCBuZXZlciBleHBhbmQuICovXG5jb25zdCBCUkFDRURfTkFNRSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKiQvO1xuXG4vKipcbiAqIEV4cGFuZCBgJFZBUmAgLyBgJHtWQVJ9YCByZWZlcmVuY2VzIGluIGEgc2ltcGxlIGNvbW1hbmQncyByYXcgdGV4dCAocGxhblxuICogXHUwMEE3NykuIGAkKFx1MjAyNilgLCBgJCgoXHUyMDI2KSlgLCBgJHshWH1gIGluZGlyZWN0IGV4cGFuc2lvbiwgYCR7WDpcdTIwMjZ9YCBvcGVyYXRvcnMsXG4gKiBzcGVjaWFsIHBhcmFtZXRlcnMsIGFuZCB1bmtub3duIHZhcmlhYmxlcyBzdGF5IHVudG91Y2hlZC5cbiAqXG4gKiBAcGFyYW0gdGV4dCBUaGUgcmF3IHNpbXBsZS1jb21tYW5kIHRleHQsIGJlZm9yZSB0b2tlbml6aW5nLlxuICogQHBhcmFtIHZhcmlhYmxlcyBUaGUgc2NyaXB0IHZhcmlhYmxlIHRhYmxlIGZyb20gZXhlY3V0ZWQgbm9uLXBpcGUgYXNzaWdubWVudFxuICogICBzdGFnZXMsIGluIG9yZGVyICh0YWtlcyBwcmVjZWRlbmNlIG92ZXIgYGVudmApLlxuICogQHBhcmFtIGVudiBUaGUgY3VyYXRlZCBlbnZpcm9ubWVudCAodGhlIHBhcnNlciBnYXRlcyBpdHMgYHByb2Nlc3MuZW52YFxuICogICBkZWZhdWx0IGJ5IGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYDsgYW4gaW5qZWN0ZWQgZW52IGlzIHVzZWQgd2hvbGVzYWxlKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZFZhcmlhYmxlcyhcbiAgdGV4dDogc3RyaW5nLFxuICB2YXJpYWJsZXM6IFJlYWRvbmx5TWFwPHN0cmluZywgc3RyaW5nPixcbiAgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+XG4pOiBzdHJpbmcge1xuICBjb25zdCByZXNvbHZlID0gKG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgY29uc3QgZnJvbVRhYmxlID0gdmFyaWFibGVzLmdldChuYW1lKTtcbiAgICBpZiAoZnJvbVRhYmxlICE9PSB1bmRlZmluZWQpIHJldHVybiBmcm9tVGFibGU7XG4gICAgY29uc3QgZnJvbUVudiA9IGVudltuYW1lXTtcbiAgICByZXR1cm4gZnJvbUVudiAhPT0gdW5kZWZpbmVkID8gZnJvbUVudiA6IHVuZGVmaW5lZDtcbiAgfTtcblxuICBsZXQgb3V0ID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICBsZXQgaW5TaW5nbGUgPSBmYWxzZTtcbiAgbGV0IGluRG91YmxlID0gZmFsc2U7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSB0ZXh0W2ldO1xuICAgIGlmIChpblNpbmdsZSkge1xuICAgICAgLy8gU2luZ2xlLXF1b3RlZCBzcGFucyBhcmUgZnVsbHkgbGl0ZXJhbCBcdTIwMTQgYCRgIGFuZCBgXFxgIGluY2x1ZGVkLlxuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNpbmdsZSA9IGZhbHNlO1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRG91YmxlKSB7XG4gICAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgICBpbkRvdWJsZSA9IGZhbHNlO1xuICAgICAgICBvdXQgKz0gYztcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtpICsgMV0pKSB7XG4gICAgICAgIC8vIEluc2lkZSBkb3VibGUgcXVvdGVzIGJhY2tzbGFzaCBlc2NhcGVzIGBcImAgYFxcYCBgJGAgYGAgYCBgYCBcdTIwMTQgdGhlXG4gICAgICAgIC8vIGVzY2FwZWQgY2hhcmFjdGVyIHN0YXlzIGxpdGVyYWwgKG5vIGV4cGFuc2lvbiBvZiBgXFwkYCkuXG4gICAgICAgIG91dCArPSB0ZXh0W2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcpIHtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyQnKSB7XG4gICAgICAgIGNvbnN0IHJlZiA9IGV4cGFuZFJlZih0ZXh0LCBpLCByZXNvbHZlKTtcbiAgICAgICAgb3V0ICs9IHJlZi50ZXh0O1xuICAgICAgICBpID0gcmVmLm5leHQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVW5xdW90ZWQuXG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNpbmdsZSA9IHRydWU7XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5Eb3VibGUgPSB0cnVlO1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJykge1xuICAgICAgLy8gQSBiYWNrc2xhc2ggZXNjYXBlcyB0aGUgbmV4dCBjaGFyYWN0ZXIgXHUyMDE0IGBcXCRgIHN0YXlzIGxpdGVyYWwgKHRoZVxuICAgICAgLy8gdG9rZW5pemVyIHJlc29sdmVzIHRoZSBlc2NhcGUpLlxuICAgICAgb3V0ICs9IGM7XG4gICAgICBpZiAoaSArIDEgPCBuKSB7XG4gICAgICAgIG91dCArPSB0ZXh0W2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJCcpIHtcbiAgICAgIGNvbnN0IHJlZiA9IGV4cGFuZFJlZih0ZXh0LCBpLCByZXNvbHZlKTtcbiAgICAgIG91dCArPSByZWYudGV4dDtcbiAgICAgIGkgPSByZWYubmV4dDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvdXQgKz0gYztcbiAgICBpKys7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSByZWZlcmVuY2Ugc3RhcnRpbmcgYXQgYHRleHRbc3RhcnRdYCAoYSBgJGApLiBBIGtub3duIG5hbWUnc1xuICogdmFsdWUgcmVwbGFjZXMgdGhlIHdob2xlIHJlZmVyZW5jZTsgYW55dGhpbmcgZWxzZSBcdTIwMTQgY29tbWFuZCBzdWJzdGl0dXRpb24sXG4gKiBhcml0aG1ldGljLCBpbmRpcmVjdCBleHBhbnNpb24sIHBhcmFtZXRlciBvcGVyYXRvcnMsIHNwZWNpYWwgcGFyYW1ldGVycyxcbiAqIHVua25vd24gb3IgdW5zZXQgbmFtZXMgXHUyMDE0IGlzIHJldHVybmVkIHZlcmJhdGltICh0aGUgYCRgIG9ubHkpLCBzbyB0aGVcbiAqIGNhbGxlcidzIHNjYW4gY29udGludWVzIGFuZCB0aGUgcmVzaWR1YWwgdGV4dCBpcyB1bmNoYW5nZWQuXG4gKi9cbmZ1bmN0aW9uIGV4cGFuZFJlZihcbiAgdGV4dDogc3RyaW5nLFxuICBzdGFydDogbnVtYmVyLFxuICByZXNvbHZlOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCB1bmRlZmluZWRcbik6IHsgdGV4dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJlc3QgPSB0ZXh0LnNsaWNlKHN0YXJ0ICsgMSk7XG4gIGlmIChyZXN0LnN0YXJ0c1dpdGgoJygnKSkgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gYCQoXHUyMDI2KWAgLyBgJCgoXHUyMDI2KSlgIFx1MjAxNCB1bnRvdWNoZWRcbiAgaWYgKHJlc3Quc3RhcnRzV2l0aCgneycpKSB7XG4gICAgY29uc3QgY2xvc2UgPSB0ZXh0LmluZGV4T2YoJ30nLCBzdGFydCArIDIpO1xuICAgIGlmIChjbG9zZSA9PT0gLTEpIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIHVudGVybWluYXRlZCBgJCB7YCBcdTIwMTQgdW50b3VjaGVkXG4gICAgY29uc3QgaW5uZXIgPSB0ZXh0LnNsaWNlKHN0YXJ0ICsgMiwgY2xvc2UpO1xuICAgIGlmIChCUkFDRURfTkFNRS50ZXN0KGlubmVyKSkge1xuICAgICAgY29uc3QgdmFsdWUgPSByZXNvbHZlKGlubmVyKTtcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4geyB0ZXh0OiB2YWx1ZSwgbmV4dDogY2xvc2UgKyAxIH07XG4gICAgfVxuICAgIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIGAkeyFYfWAsIGAke1g6XHUyMDI2fWAsIHVua25vd24gbmFtZXMgXHUyMDE0IHVudG91Y2hlZFxuICB9XG4gIGNvbnN0IG5hbWUgPSBCQVJFX05BTUUuZXhlYyhyZXN0KTtcbiAgaWYgKG5hbWUgPT09IG51bGwpIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIHNwZWNpYWwgcGFyYW1ldGVycywgYmFyZSBgJGAgXHUyMDE0IHVudG91Y2hlZFxuICBjb25zdCB2YWx1ZSA9IHJlc29sdmUobmFtZVswXSk7XG4gIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4geyB0ZXh0OiB2YWx1ZSwgbmV4dDogc3RhcnQgKyAxICsgbmFtZVswXS5sZW5ndGggfTtcbiAgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gdW5rbm93biBuYW1lIFx1MjAxNCB0aGUgcmVzaWR1YWwgYCRgIHRyaXBzIGxvb2tzVW5yZXNvbHZhYmxlXG59XG4iLCAiLyoqXG4gKiBSZXNwb25zZS1hd2FyZSBkZXJpdmF0aW9uIG9mIHJlYWQtdG91Y2ggc3BhbnMgZnJvbSBCYXNoIGB0b29sX3Jlc3BvbnNlYFxuICogb3V0cHV0LCBmb3IgdGhlIGdyZXAvcmlwZ3JlcCBjb21tYW5kIGZhbWlsaWVzIHRoYXQgcGFyc2UtY29tbWFuZC50c1xuICogZGVsaWJlcmF0ZWx5IGNhbm5vdCBjbGFzc2lmeSBmcm9tIGNvbW1hbmQgdGV4dCBhbG9uZTogdGhlIHdpbmRvdyBpcyBhbmNob3JlZFxuICogdG8gbWF0Y2ggcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50IGFuZCBsaXZlcyBpbiB0aGUgcmVzcG9uc2UsIG5vdFxuICogdGhlIGNvbW1hbmQuIHBhcnNlUmVzcG9uc2UgaXMgdGhlIHNlY29uZCBldmlkZW5jZSBzb3VyY2UgdGhlIENsYXVkZSBhbmRcbiAqIENvZGV4IGFkYXB0ZXJzIG1lcmdlIHdpdGggcGFyc2VDb21tYW5kJ3Mgc3BhbnMuXG4gKlxuICogVGhlIGNvbW1vbi8gbGF5ZXIgY29udmVudGlvbiBpcyBsb2FkLWJlYXJpbmc6IG1vZHVsZXMgaW1wb3J0IG9ubHkgYG5vZGU6YFxuICogYnVpbHRpbnMgYW5kIHNpYmxpbmcgbW9kdWxlcyBcdTIwMTQgemVybyBTREsgaW1wb3J0cy4gRW52ZWxvcGUgbm9ybWFsaXphdGlvblxuICogKGB0b29sX3Jlc3BvbnNlYCBcdTIxOTIgUmVzcG9uc2VQYXJzZUlucHV0KSBoYXBwZW5zIGluIHRoZSBhZGFwdGVycywgd2hpY2ggaGFuZFxuICogdGhlIGFscmVhZHktbm9ybWFsaXplZCBzaGFwZSBkb3duIGhlcmUuXG4gKlxuICogUGhhc2UgM2Egb2YgdGhlIFRERCBib290c3RyYXAgKHBsYW5zL2luaXRpYWwubWQpIGlzIGxpdmU6IGNvbW1hbmQgZ2F0aW5nLFxuICogc2NvcGUgcmVzdHJpY3Rpb24gYWdhaW5zdCB0aGUgY29tbWFuZCdzIGRlY2xhcmVkIHJvb3RzLCBBTlNJIHJlamVjdGlvbiwgdGhlXG4gKiBmaXZlIHNlYXJjaC1sYXlvdXQgZGVjb2RlcnMsIHdob2xlLWZpbGUgZmFsbGJhY2ssIGFuZCBjb2FsZXNjaW5nLiBQaGFzZSAzYlxuICogYWRkZWQgdGhlIHVuaWZpZWQtZGlmZiBkZWNvZGVyIChgZ2l0IGRpZmZgLCBkaWZmLWZvcm0gYGdpdCBzaG93YCwgYGdpdCBsb2dcbiAqIC1wYCkgd2l0aCBiaW5hcnkvY29tYmluZWQvc3VibW9kdWxlIHJlamVjdGlvbiwgYW5kIFBoYXNlIDNjIHRoZVxuICogYGdpdCBibGFtZSAtTCBOLE0gZmlsZWAgY29tbWFuZC10ZXh0IG1hdGNoZXIuIFRoZSBldmFsdWF0aW9uIGZpeGVzIGFkZCB0aGVcbiAqIGRlY2lzaW9ucyB0aGUgcGxhbidzIHJpc2sgc2VjdGlvbiBkZWZlcnJlZCwgYWxsIGRvY3VtZW50ZWQgaGVyZTpcbiAqXG4gKiAtICoqVHJ1bmNhdGlvbiwgdHdvIHJlZ2ltZXMqKiAocGxhbiBzdGVwIDYpOiBgdHJ1bmNhdGVkOiB0cnVlYCAodGhlXG4gKiAgIGFkYXB0ZXIncyBgcmF3T3V0cHV0UGF0aGAgcHJldmlldyBtYXJrZXIpIG1lYW5zIHBhcnNlIG5vdGhpbmcgXHUyMDE0XG4gKiAgIHJlc3BvbnNlLWRlcml2ZWQgZGVjb2RlIGZhaWxzIGNsb3NlZC4gYGludGVycnVwdGVkOiB0cnVlYCBpcyB0aGVcbiAqICAgcGxhbidzIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lOiBmdWxseS10ZXJtaW5hdGVkIHJlY29yZHMgcGFyc2UgYW5kIHRoZVxuICogICBpbmNvbXBsZXRlIHRhaWwgZHJvcHMgdmlhIHRoZSB1bmNvbmRpdGlvbmFsIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSxcbiAqICAgc28gdGhlIGZsYWcgY2hhbmdlcyBub3RoaW5nIHRoZSBkZWZhdWx0IHBhdGggYWxyZWFkeSBkb2VzIFx1MjAxNCBpdCBpc1xuICogICBjb250cmFjdCBkb2N1bWVudGF0aW9uIHRoZSBhZGFwdGVycyBtYXAgYGludGVycnVwdGVkYCBvbnRvIChhIGxhdGVyXG4gKiAgIHBoYXNlIGNoYW5nZXMgdGhlIGFkYXB0ZXJzOyB1bnRpbCB0aGVuIHRoZXkgY29sbGFwc2UgaXQgaW50b1xuICogICBgdHJ1bmNhdGVkYCwgd2hpY2ggZmFpbHMgY2xvc2VkIHNhZmVseSkuIE5laXRoZXIgY29udGVudCBnYXRlIGFwcGxpZXNcbiAqICAgdG8gdGhlIGNvbW1hbmQtdGV4dC1kZXJpdmVkIGBnaXQgYmxhbWUgLUwgTixNYCBtYXRjaGVyLCB3aG9zZSBldmlkZW5jZVxuICogICBpcyB0aGUgY29tbWFuZCwgbm90IHRoZSByZXNwb25zZSBcdTIwMTQgdGhlIGJsYW1lIGJyYW5jaCBydW5zIGFib3ZlIGJvdGhcbiAqICAgdGhlIEFOU0kgcmVqZWN0aW9uIGFuZCB0aGUgdHJ1bmNhdGVkIGdhdGUuXG4gKiAtICoqU3BhbiBjYXAqKjogYE1BWF9SRVNQT05TRV9TUEFOU2AgYm91bmRzIGhvdyBtYW55IGRpc3RpbmN0IHNwYW5zIGFcbiAqICAgcmVzcG9uc2UgbWF5IGVtaXQuIE1lYXN1cmVkIHRocm91Z2ggdGhlIGRlcGxveWVkIGhvb2ssIGVhY2ggc3BhbiBjb3N0c1xuICogICB+NDYgbXMgb2Ygc3VicHJvY2VzcyBleGVjcyBpbiB0aGUgdG91Y2ggY29yZSAocmVzb2x2ZVRvdWNoU2NvcGUgKyBgZ2l0XG4gKiAgIHNwYW4gbGlzdGAgcGVyIHNwYW47IHRoZSBzZXNzaW9uIG1lbW8gbWFrZXMgcmVwZWF0IHJ1bnMgY2hlYXAsIGJ1dCBmaXJzdFxuICogICBydW5zIHBheSB0aGUgZnVsbCBwcmljZSksIGFnYWluc3QgYSAxMCBzIGhvb2tzLmpzb24gdGltZW91dC4gNTAgc3BhbnMgXHUyMjQ4XG4gKiAgIDIuMyBzIHdvcnN0IGNhc2UgXHUyMDE0IHdlbGwgdW5kZXIgdGhlIHRpbWVvdXQgd2l0aCBtYXJnaW4gZXZlbiB3aXRoIHRoZVxuICogICBjb21tYW5kLWRlcml2ZWQgc3BhbnMgb24gdG9wLiBCZXlvbmQgdGhlIGNhcCB0aGUgYm91bmRlZCBzZXQgaXMgZW1pdHRlZFxuICogICAodGhlIGZpcnN0IDUwIGluIGRldGVybWluaXN0aWMgcGF0aCBvcmRlcikgYW5kIHRoZSByZXN0IGZhaWwgY2xvc2VkOlxuICogICBldmVyeSBlbWl0dGVkIHNwYW4gaXMgYSBnZW51aW5lIGZ1bGx5LW9ic2VydmVkIHJlY29yZCwgc28gZW1pdHRpbmcgdGhlXG4gKiAgIGJvdW5kZWQgc2V0IGludmVudHMgbm90aGluZywgYW5kIGRyb3BwaW5nIHRoZSBleGNlc3Mga2VlcHMgaG9vayBsYXRlbmN5XG4gKiAgIGJvdW5kZWQgb24gZXhhY3RseSB0aGUgcGF0aG9sb2dpY2FsIHNlYXJjaGVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIHN0YWxsXG4gKiAgIHRoZSBhZ2VudCBsb29wLiBPbmUgY29hbGVzY2VkIHNwYW4gY292ZXJpbmcgYSBodWdlIHdpbmRvdyBjb3VudHMgb25jZS5cbiAqIC0gKipQaXBlbGluZXMqKjogdGhlIHJlc3BvbnNlIGlzIGF0dHJpYnV0ZWQgdG8gdGhlIEZJUlNUIGdhdGVkIHN0YWdlXG4gKiAgIChsZWZ0LXRvLXJpZ2h0IHdhbGs7IGlmIG5vIHN0YWdlIGdhdGVzLCBub3RoaW5nIHRvIHBhcnNlKS4gSW4gYSBwaXBlbGluZVxuICogICB0aGUgZmluYWwgc3RhZ2UncyBzdGRvdXQgaXMgdGhlIGdhdGVkIHN0YWdlJ3Mgb3V0cHV0IHdoZW4gZXZlcnkgbGF0ZXJcbiAqICAgc3RhZ2UgaXMgUFJPVkFCTFkgVkVSQkFUSU0gXHUyMDE0IHRoZSBhbGxvd2xpc3QgaXMgdGhlIGNsb3NhYmxlIHNldDpcbiAqICAgaGVhZC90YWlsL3djL3NvcnQvdW5pcS9jdXQgKHRydW5jYXRlL3Jlb3JkZXIvZGVkdXBlIFx1MjAxNCBlYWNoIHN1cnZpdmluZ1xuICogICBsaW5lJ3MgY29udGVudCBpcyB2ZXJiYXRpbSksIHBsYWluIGBjYXRgIChubyBgLW5gL2AtLW51bWJlcmApLCB0aGUgZ3JlcFxuICogICBmYW1pbHkgd2l0aG91dCBudW1iZXJlZCBldmlkZW5jZSAoYC1uYC9gLS1saW5lLW51bWJlcmApIGFuZCB3aXRob3V0XG4gKiAgIGZpbGUgb3BlcmFuZHMgYmV5b25kIHRoZSBwYXR0ZXJuIHNsb3QsIGFuZCB0aGUgZXhwcmVzc2lvbi1hbGxvd2xpc3RlZFxuICogICBzZWQvYXdrL3BlcmwvdHIgY2FydmUtb3V0cyAobnVtZXJpYy1hZGRyZXNzIGBwYC9gcWAvYGRgIHNjcmlwdHMsXG4gKiAgIGNvbmRpdGlvbi1vbmx5IE5SLWNvbXBhcmlzb24vcGFyaXR5IGF3ayBwcm9ncmFtcywgc3RyZWFtLXBvc2l0aW9uXG4gKiAgIGBwcmludCBpZi91bmxlc3MgJC4gTiBkYCBwZXJsIHNjcmlwdHMsIGFuZCBkaWdpdC9jb2xvbi9uZXdsaW5lLWZyZWVcbiAqICAgYHRyIC1kYCBkZWxldGlvbnMgXHUyMDE0IGFsbCBwcm92YWJseSBwYXNzIHdob2xlIHJlY29yZHMgdGhyb3VnaFxuICogICBieXRlLXZlcmJhdGltKS4gRXZlcnkgYWxsb3dsaXN0ZWQgc3RhZ2UgbXVzdCBjYXJyeSBOTyBGSUxFIE9QRVJBTkRTOiBhXG4gKiAgIHRva2VuIHRoYXQgaXMgbm90IGEgZmxhZyBuYW1lcyBhIGZpbGUgdGhlIHN0YWdlIHJlYWRzIGluc3RlYWQgb2YgdGhlXG4gKiAgIHBpcGUsIHNvIHRoZSByZXNwb25zZSdzIHJlY29yZHMgY29tZSBmcm9tIHRoYXQgZmlsZSwgbm90IHRoZSBnYXRlZFxuICogICBzdGFnZSwgYW5kIGEgY3JhZnRlZCByZWNvcmQgZGVjb2RlcyBhcyBhIHBoYW50b20gdG91Y2ggXHUyMDE0IHRoYXQgZm9ybVxuICogICBmYWlscyBjbG9zZWQgd2l0aCB0aGUgcmVzdC4gVGhlIHNhbWUgcnVsZSBjb3ZlcnMgYW4gVU5RVU9URUQgYDxgIFx1MjAxNCBhXG4gKiAgIHN0ZGluIHJlZGlyZWN0LCBzdGFuZGFsb25lIG9yIEdMVUVEIGluc2lkZSBhIHRva2VuIChgaGVhZCAtMjxjcmFmdGVkLnR4dGAsXG4gKiAgIGBncmVwIG5lZWRsZTxjcmFmdGVkLnR4dGAsIGEgY29uc3VtZWQgYC1lYC9gLWZgIHZhbHVlKSBcdTIwMTQgYmVjYXVzZSB0aGVcbiAqICAgc3RhZ2UgdGhlbiByZWFkcyBhIGZpbGUgaW5zdGVhZCBvZiB0aGUgcGlwZTsgdGhlIGhhc1VucXVvdGVkUmVkaXJlY3RcbiAqICAgc2NhbiBpcyBxdW90ZS1hd2FyZSwgc28gYSBxdW90ZWQgbGl0ZXJhbCBgPGAgaW4gYSBwYXR0ZXJuXG4gKiAgIChgcmcgLW4gJzxkaXY+J2ApIGlzIG5vdCBhIHJlZGlyZWN0LiBBIGA8PGAvYDw8LWAgSEVSRURPQyBzdGFnZVxuICogICAoYGNhdCA8PCdFT0YnYCkgcmVhZHMgaXRzIHN0ZGluIGZyb20gdGhlIGJvZHkgdGV4dCBcdTIwMTQgYSBjcmFmdGVkIGJvZHkgaXNcbiAqICAgdGhlIHNhbWUgZmFicmljYXRlZC1yZWNvcmQgc291cmNlIGFzIGEgY3JhZnRlZCBmaWxlIFx1MjAxNCBhbmQgdGhlIHNwbGl0dGVyXG4gKiAgIHN0cmlwcyB0aGUgb3BlcmF0b3IgZnJvbSB0aGUgdGV4dCwgc28gdGhlIHBlci1zdGFnZSBgaGVyZWRvY2AgZmxhZ1xuICogICBkcml2ZXMgdGhlIHNhbWUgZmFpbC1jbG9zZWQgcnVsZS4gVGhlIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSBoYW5kbGVzXG4gKiAgIHRoZSBjdXQuIEV2ZXJ5dGhpbmcgZWxzZSBmYWlscyBDTE9TRUQgXHUyMDE0IHRoZSBkZWZhdWx0IGlzIGludmVydGVkLCBzb1xuICogICBhbnkgc3RhZ2Ugbm90IHByb3ZhYmx5IHZlcmJhdGltIChweXRob24sIHJ1YnksIG1hd2ssIGdhd2ssIHBhc3RlLCBhbmRcbiAqICAgdGhlIHJlc3Qgb2YgYW4gdW5ib3VuZGVkIHJlbnVtYmVyZXIgc2V0KSBtYXkgcmVudW1iZXIgb3IgcmV3cml0ZSB0aGVcbiAqICAgcmVjb3JkcywgdGhlIHJlc3BvbnNlIHRoZW4gY2FycmllcyBzdHJlYW0gcG9zaXRpb25zIGluc3RlYWQgb2YgZmlsZVxuICogICBsaW5lcywgYW5kIHRoZSBwaXBlbGluZSBhdHRyaWJ1dGVzIG5vdGhpbmcuXG4gKiAgIEluIGEgYDtgL2AmJmAvYHx8YC9gJmAvbmV3bGluZSBjaGFpbiB0aGUgc2FtZSBwcm92YWJseS12ZXJiYXRpbSBjaGVja1xuICogICBhcHBsaWVzIHRvIEVWRVJZIHNpYmxpbmcgc3RhZ2UsIGluIGVpdGhlciBkaXJlY3Rpb246IGEgc2libGluZydzIG91dHB1dFxuICogICBtaXhlcyBpbnRvIHRoZSBzYW1lIHJlc3BvbnNlLCBzbyBhIGNyYWZ0ZWQgZmlsZSByZWFkIGJ5IGFueSBvZiB0aGVtXG4gKiAgIGRlY29kZXMgYXMgcGhhbnRvbSB0b3VjaGVzIFx1MjAxNCBhIGNoYWluIGlzIGF0dHJpYnV0YWJsZSBvbmx5IHdoZW4gZXZlcnlcbiAqICAgc2libGluZyBwYXNzZXMgdGhlIGFsbG93bGlzdCAoYGNkYCBzdGFnZXMsIHdob3NlIG91dHB1dCBpcyBlbXB0eSxcbiAqICAgZXhjZXB0ZWQpLiBBIGB8YC1qb2luZWQgZmVlZGVyIGVhcmxpZXIgaW4gdGhlIHBpcGVsaW5lIGlzIGNvbnN1bWVkIGJ5XG4gKiAgIHRoZSBnYXRlZCBzdGFnZSBcdTIwMTQgYSBzZWFyY2ggd2l0aCBleHBsaWNpdCByb290cyBpZ25vcmVzIHN0ZGluIFx1MjAxNCBhbmQgaXRzXG4gKiAgIHJlY29yZHMgbmV2ZXIgcmVhY2ggdGhlIHJlc3BvbnNlOyBpdCBzdGF5cyBvcGVuLlxuICogICBgY2RgIHRyYWNraW5nIGFwcGxpZXMgb25seSB1bnRpbCB0aGUgZmlyc3RcbiAqICAgZ2F0ZWQgc3RhZ2UgaXMgZm91bmQgXHUyMDE0IHRoZSBldmlkZW5jZSB3YXMgcHJvZHVjZWQgaW4gdGhhdCBkaXJlY3RvcnkuXG4gKiAtICoqU3RkaW4tZmVkIHNlYXJjaCBmYWlscyBjbG9zZWQqKjogYSBub24tZ2l0IHNlYXJjaCBiaW4gKGByZ2AvYGdyZXBgL1xuICogICBgZWdyZXBgL2BmZ3JlcGApIHdpdGggbm8gcGF0aCBhcmdzIHdob3NlIGlucHV0IGlzIHBpcGVkIG9yIHJlZGlyZWN0ZWRcbiAqICAgKGBwcmludGYgJ1x1MjAyNicgfCByZyAtbiBuZWVkbGVgLCBgPCBmaWxlYCwgYDw8PGAsIGA8KFx1MjAyNilgLCBhbmQgdGhlIEdMVUVEXG4gKiAgIGZvcm1zIFx1MjAxNCBgcmcgbmVlZGxlPGZpbGVgLCBgaGVhZCAtMjxmaWxlYCwgYSBjb25zdW1lZCBgLWVgL2AtZmAgdmFsdWVcbiAqICAgbGlrZSBgLWUgbmVlZGxlPGZpbGVgIFx1MjAxNCB3aGVyZSB0aGUgcmVkaXJlY3QgaXMgaW52aXNpYmxlIHRvIGFyZ3ZcbiAqICAgc3BsaXR0aW5nIGFuZCBvbmx5IHRoZSBxdW90ZS1hd2FyZSBoYXNVbnF1b3RlZFJlZGlyZWN0IHNjYW4gc2VlcyBpdCwgb3JcbiAqICAgYSBgPDxgL2A8PC1gIEhFUkVET0MgYm9keSBcdTIwMTQgd2hlcmUgdGhlIHNwbGl0dGVyIHN0cmlwcyB0aGUgb3BlcmF0b3IgZnJvbVxuICogICB0aGUgdGV4dCBhbmQgb25seSB0aGUgcGVyLXN0YWdlIGBoZXJlZG9jYCBmbGFnIHNlZXMgaXQpIHJlYWRzIFNURElOLFxuICogICBub3QgZmlsZXMgXHUyMDE0IHRoZSByZXNwb25zZSdzIHJlY29yZHMgYXJlIHN0cmVhbSBwb3NpdGlvbnMsIGFuZCBkZWNvZGluZ1xuICogICB0aGVtIGFzIHBhdGhzIGZhYnJpY2F0ZXMgdG91Y2hlcyAoYSBzdGRpbiBsaW5lIG51bWJlciBsaWtlIFwiOVwiIGJlY29tZXNcbiAqICAgYSBwYXRoLCBhbmQgd2l0aCBhIHJlYWwgZmlsZSBuYW1lZCBgOWAgYXQgdGhlIGN3ZCB0aGUgcGhhbnRvbVxuICogICBzdXJmYWNlcykuXG4gKiAgIFN1Y2ggYW4gaW52b2NhdGlvbiB5aWVsZHMgbm8gcmVzcG9uc2UtZGVyaXZlZCBzcGFucy4gRXhwbGljaXQgcGF0aCBhcmdzXG4gKiAgIG1lYW4gdGhlIGJpbiBzZWFyY2hlcyBmaWxlcyAodGhlIHJlZGlyZWN0L3BpcGUgaXMgdGhlbiBpcnJlbGV2YW50KSwgYW5kXG4gKiAgIGBnaXQgZ3JlcGAgbmV2ZXIgcmVhZHMgc3RkaW4gXHUyMDE0IGJvdGggcHJlc2VydmVkLiBUaGlzIGludmFyaWFudCBiaW5kcyBvbmx5XG4gKiAgIHRoZSBkaXJlY3RseS1nYXRlZCBzdGFnZTogdGhlIGF0dHJpYnV0aW9uIHdhbGsgc3RvcHMgYXQgdGhlIGZpcnN0IGdhdGVkXG4gKiAgIHN0YWdlLCBzbyBhbiB1bi1nYXRlZCBmZWVkZXIgZWFybGllciBpbiB0aGUgcGlwZWxpbmUgKGUuZy5cbiAqICAgYGZpbmQgfCB4YXJncyByZyBcdTIwMjZgKSBuZXZlciByZWFjaGVzIHRoZSBzdGRpbiBydWxlLCBhbmQgaXRzIGZlZWQtc2hhcGVcbiAqICAgaXMgbm8gZXZpZGVuY2UgYWJvdXQgdGhlIHNlYXJjaCdzIHN0ZGluLlxuICogLSAqKkRlY29kZWQgcGF0aHMgbXVzdCBiZSByZWFsIGZpbGVzKio6IGFzIGEgZmFtaWx5LXdpZGUgYmFja3N0b3AsIGFcbiAqICAgcmVjdXJzaXZlLWxheW91dCByZWNvcmQgd2hvc2UgZGVjb2RlZCBwYXRoIGlzIG5vdCBhbiBleGlzdGluZyByZWd1bGFyXG4gKiAgIGZpbGUgKHRoZSBzYW1lIGBpc0ZpbGVgIGNoZWNrIHRoZSBvbmUtZmlsZSBlbGlnaWJpbGl0eSB1c2VzLCByZXNvbHZpbmdcbiAqICAgYWdhaW5zdCB0aGUgcmVjb3JkIGJhc2UpIGRyb3BzIGluc3RlYWQgb2YgZmFicmljYXRpbmcgYSB0b3VjaC5cbiAqIC0gKipgZ2l0IHNob3cgPHJldj46PHBhdGg+YCoqIChyYXcgYmxvYiBjb250ZW50KSBpcyBleGNsdWRlZCBmcm9tIHRoZSBkaWZmXG4gKiAgIGdhdGU7IGEgZGlmZi1zaGFwZWQgYmxvYiBtdXN0IG5ldmVyIGRlY29kZSBpbnRvIGZhYnJpY2F0ZWQgdG91Y2hlcy4gVGhlXG4gKiAgIGNvbnRlbnQgaWRpb20gaXMgZGV0ZWN0YWJsZSBmcm9tIHRoZSBjb21tYW5kOiBhIGBzaG93YCBwb3NpdGlvbmFsXG4gKiAgIGNvbnRhaW5pbmcgYDpgIGlzIGEgcmV2OnBhdGgsIG5vdCBhIHJldmlzaW9uLlxuICogLSAqKkRpZmYgcGF0aHMgYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSoqOiBnaXQgZW1pdHMgYGEvc3JjL3gudHNgIGluIGRpZmZcbiAqICAgb3V0cHV0IHJlZ2FyZGxlc3Mgb2YgY3dkLCBzbyBkaWZmIGRlY29kZSBhbmNob3JzIHRvIHRoZSB3b3JrdHJlZSByb290XG4gKiAgIChmb3VuZCBieSB3YWxraW5nIHVwIGZyb20gdGhlIGVmZmVjdGl2ZSBkaXIgZm9yIGEgYC5naXRgIGVudHJ5IFx1MjAxNCBub1xuICogICBzdWJwcm9jZXNzLCB0aGUgY29tbW9uIGxheWVyIGltcG9ydHMgb25seSBub2RlOiBidWlsdGlucykuIFR3b1xuICogICBleGNlcHRpb25zIHJlLWFuY2hvciB0aGUgb3V0cHV0OiBgLS1yZWxhdGl2ZWAgKGJhcmUpIGVtaXRzIHBhdGhzXG4gKiAgIHJlbGF0aXZlIHRvIHRoZSBjd2QgYW5kIGV4Y2x1ZGVzIGNoYW5nZXMgb3V0c2lkZSBpdCwgYW5kXG4gKiAgIGAtLXJlbGF0aXZlPTxwYXRoPmAgZW1pdHMgcGF0aHMgcmVsYXRpdmUgdG8gYDxwYXRoPmAgcmVzb2x2ZWQgYWdhaW5zdFxuICogICB0aGUgd29ya3RyZWUgcm9vdCAodmVyaWZpZWQgYWdhaW5zdCBnaXQgMi40Ny4zKSBcdTIwMTQgYm90aCBkZWNvZGUgYWdhaW5zdFxuICogICB0aGF0IGJhc2UgaW5zdGVhZC4gYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gICh0d28tYXJnXG4gKiAgIGJsb2ItYmxvYikgZW1pdHMgYSBub3JtYWwgdW5pZmllZCBkaWZmIG5hbWluZyB0aGUgYmxvYiBwYXRocyB3aGlsZSBnaXRcbiAqICAgcmVhZHMgb25seSBoaXN0b3JpY2FsIGJsb2JzLCBuZXZlciB0aGUgd29ya2luZy10cmVlIGZpbGVzIFx1MjAxNCBhIGRpZmZcbiAqICAgd2hvc2UgcG9zaXRpb25hbHMgY2FycnkgYHJldjpwYXRoYCBzcGVjcyAoYW55IGA6YC1jb250YWluaW5nIHBvc2l0aW9uYWxcbiAqICAgdGhhdCBpcyBub3QgYW4gZXhpc3RpbmcgZmlsZSkgZGVjb2RlcyBub3RoaW5nLlxuICogLSAqKlVubnVtYmVyZWQgb3V0cHV0IG5ldmVyIHBhcnNlcyBhcyBudW1iZXJlZCoqOiB0aGUgb25lLWZpbGUgbGF5b3V0XG4gKiAgIHJlcXVpcmVzIGNvbW1hbmQtc2lkZSBudW1iZXJlZCBldmlkZW5jZSAoYC1uYC9gLS1saW5lLW51bWJlcmApLCBleGFjdGx5XG4gKiAgIG9uZSBleHBsaWNpdCBmaWxlIGFyZ3VtZW50IHRoYXQgaXMgYSByZWFsIGZpbGUsIG5vIGAtSGBcbiAqICAgKC0td2l0aC1maWxlbmFtZSwgd2hpY2ggZm9yY2VzIHBhdGggcHJlZml4ZXMpLCBhbmQgY3Jvc3MtcmVjb3JkXG4gKiAgIGNvbnNpc3RlbmN5IChldmVyeSByZWNvcmQgcGFyc2VzIGFzIGBsaW5lOnRleHRgKS4gVGhlIGhlYWRpbmcgbGF5b3V0XG4gKiAgIHJlcXVpcmVzIHRoZSBudW1iZXJlZCBldmlkZW5jZSB0b28uIEEgZGlnaXRzLWxlYWRpbmcgcmVjb3JkIHRoYXQgZmFpbHNcbiAqICAgdGhlc2UgY2hlY2tzIGZhbGxzIHRocm91Z2ggdG8gdGhlIHJlY3Vyc2l2ZSBsYXlvdXQgXHUyMDE0IGEgcHVyZS1kaWdpdHNcbiAqICAgZmlsZW5hbWUgKFwiOVwiLCBcIjEyM1wiKSBlbWl0dGVkIGZpcnN0IG11c3Qgbm90IGNvbGxhcHNlIGEgd2hvbGUgc2VhcmNoIHRvXG4gKiAgIHRoZSBvbmUtZmlsZSBsYXlvdXQsIGFuZCBjb250ZW50IHRoYXQgbWVyZWx5IGxvb2tzIG51bWJlcmVkIG11c3Qgbm90XG4gKiAgIGludmVudCBwb3NpdGlvbnMuIEdpdCBwYXRoc3BlYyBtYWdpYyAoYDovYCwgYDohYCwgYDpeYCwgYDooLi4uKWApIGlzIG5vdFxuICogICBhIGZpbGVzeXN0ZW0gcGF0aCBhbmQgbmV2ZXIgYmVjb21lcyBhIHBlcm1pdHRlZCByb290LiBgZ2l0IGdyZXAgPHJldj5gXG4gKiAgIGZ1c2VzIHRoZSByZXYgaW50byByZWNvcmQgcGF0aHMgKGBIRUFEOmEudHM6MzpcdTIwMjZgKTsgdGhvc2UgcmVjb3JkcyBkcm9wIGFzXG4gKiAgIHBhdGgtYW1iaWd1b3VzIFx1MjAxNCBmYWlsLWNsb3NlZCBhbmQgZGVmZW5zaWJsZSwgc2luY2UgdGhlIHJldiBpcyBrbm93biBidXRcbiAqICAgc3RyaXBwaW5nIGl0IHdvdWxkIGd1ZXNzIGF0IGEgcGF0aCB0aGUgcmVzcG9uc2UgZG9lcyBub3QgY2FycnkuXG4gKiAtICoqV2hvbGUtdHJlZSBgZ2l0IGdyZXBgIGZyb20gYSBzdWJkaXIgYW5jaG9ycyB0byB0aGUgd29ya3RyZWUgcm9vdCoqOlxuICogICBwYXRoc3BlYyBtYWdpYyAoYDovYCwgYDohYCwgYDpeYCwgYDooLi4uKWApIHNlYXJjaGVzIHRoZSB3aG9sZSB0cmVlIGFuZFxuICogICBlbWl0cyBjd2QtcmVsYXRpdmUgcmVjb3JkcyB3aXRoIGAuLi9gIHByZWZpeGVzOyBgLS1mdWxsLW5hbWVgICh0aGUgcmVhbFxuICogICBnaXQgb3B0aW9uIFx1MjAxNCBgLS1mdWxsLXRyZWVgIGRvZXMgbm90IGV4aXN0IG9uIGdpdCAyLjQ3LjMgYW5kIGVycm9ycyB3aXRoXG4gKiAgIGEgdXNhZ2UgcmVzcG9uc2UgdGhhdCBwYXJzZXMgdG8gbm90aGluZykgcmUtYW5jaG9ycyByZWNvcmRzIHRvXG4gKiAgIHJlcG8tcm9vdC1yZWxhdGl2ZSBwYXRocy4gQm90aCBhbmNob3IgdGhlIHBlcm1pdHRlZCByb290IFx1MjAxNCBhbmQsIGZvclxuICogICBgLS1mdWxsLW5hbWVgLCB0aGUgcmVzb2x1dGlvbiBiYXNlIFx1MjAxNCB0byB0aGUgd29ya3RyZWUgcm9vdCwgc28gZXZlcnlcbiAqICAgaW4tcmVwbyByZWNvcmQgcGFzc2VzIGNvbnRhaW5tZW50LiBQbGFpbiBzdWJkaXIgYGdpdCBncmVwYCAobm9cbiAqICAgcGF0aHNwZWMpIGlzIHNjb3BlZCB0byB0aGUgc3ViZGlyIGJ5IGdpdCBpdHNlbGYgYW5kIGtlZXBzIHRoZVxuICogICBlZmZlY3RpdmUtZGlyIHJvb3QuXG4gKiAtICoqQ29udGV4dCByZWNvcmRzIHdpdGggZGFzaGVzIGluIHRoZSBwYXRoKiogZGVjb2RlIGJ5IGFuY2hvcmluZyB0byB0aGVcbiAqICAgZXhhY3QgcGF0aHMgdGhlIHJlc3BvbnNlJ3MgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmRzIGVzdGFibGlzaCxcbiAqICAgd2l0aCB0aGUgZGFzaCBzcGxpdCBhcyB0aGUgZGFzaC1mcmVlIGZhbGxiYWNrIFx1MjAxNCBhIGAtQ2Agd2luZG93IG9uXG4gKiAgIGBzcmMvbXktZmlsZS50c2AgbXVzdCBub3QgY29sbGFwc2UgdG8gdGhlIGJhcmUgbWF0Y2ggbGluZS5cbiAqXG4gKiBUaGUgYWNjZXB0YW5jZSBjaGVja3MgaW4gdGVzdC9jb21tb24vcGFyc2UtcmVzcG9uc2UudGVzdC50cyB3ZXJlIHdyaXR0ZW5cbiAqIGluIFBoYXNlIDIuXG4gKi9cbmltcG9ydCB7IGV4aXN0c1N5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY291bnRGaWxlTGluZXMgfSBmcm9tICcuL2NvbW1hbmQtcmVzb2x2ZS5qcyc7XG5pbXBvcnQgdHlwZSB7IFJlc29sdmVkU3BhbiB9IGZyb20gJy4vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyBhcmd2T2YsIGhhc1VucXVvdGVkUmVkaXJlY3QsIHR5cGUgT3BlcmF0b3IsIHNwbGl0VG9wTGV2ZWwgfSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcblxuLyoqXG4gKiBUaGUgbm9ybWFsaXplZCB0b29sLXJlc3BvbnNlIGlucHV0IHRoZSBhZGFwdGVycyBoYW5kIHRoZSBzaGFyZWQgcGFyc2VyLlxuICogYHN0ZG91dGAgaXMgdGhlIChwb3NzaWJseSBwcmV2aWV3KSBvdXRwdXQgdGV4dDsgYHN0ZGVycmAgYW5kIGBleGl0U3RhdHVzYFxuICogYXJlIGNhcnJpZWQgZm9yIGRpYWdub3N0aWNzIGFuZCBhcmUgbmV2ZXIgcGFyc2UgZ2F0ZXMgXHUyMDE0IGBnaXQgZGlmZlxuICogLS1leGl0LWNvZGVgIGV4aXRzIDEgb24gZGlmZmVyZW5jZXMsIHNvIGV4aXQgc3RhdHVzIG11c3Qgbm90IGJlIHRyZWF0ZWQgYXNcbiAqIGZhaWx1cmUuIFBsYW4gc3RlcCA2J3MgdHdvIHRydW5jYXRpb24gcmVnaW1lcyBhcmUgZGlzdGluY3QgZmllbGRzOlxuICpcbiAqIC0gYHRydW5jYXRlZGAgKENsYXVkZSBgcmF3T3V0cHV0UGF0aGAgc2V0IFx1MjFEMiBpbmxpbmUgc3Rkb3V0IGlzIG9ubHkgYVxuICogICBwcmV2aWV3KSBpcyBzdHJpY3QgbW9kZTogcmVzcG9uc2UtZGVyaXZlZCBkZWNvZGUgcGFyc2VzIG5vdGhpbmcgYW5kXG4gKiAgIGludmVudHMgbm8gdG91Y2hlcy4gVGhlIGNvbW1hbmQtdGV4dC1kZXJpdmVkIGBnaXQgYmxhbWUgLUxgIG1hdGNoZXIgaXNcbiAqICAgZXhlbXB0IFx1MjAxNCBpdHMgZXZpZGVuY2UgaXMgdGhlIGNvbW1hbmQsIG5vdCB0aGUgcmVzcG9uc2UuXG4gKiAtIGBpbnRlcnJ1cHRlZGAgaXMgdGhlIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lOiBmdWxseS10ZXJtaW5hdGVkIHJlY29yZHNcbiAqICAgcGFyc2UgYW5kIHRoZSBpbmNvbXBsZXRlIHRhaWwgZHJvcHMuIFRoZSB1bmNvbmRpdGlvbmFsIHRlcm1pbmF0aW5nLVxuICogICBuZXdsaW5lIHJ1bGUgYWxyZWFkeSBkb2VzIGV4YWN0bHkgdGhhdCwgc28gdGhlIGZsYWcgaXMgY29udHJhY3RcbiAqICAgZG9jdW1lbnRhdGlvbiB0aGUgYWRhcHRlcnMgbWFwIGBpbnRlcnJ1cHRlZDogdHJ1ZWAgb250bzsgaXQgbmV2ZXJcbiAqICAgc3VwcHJlc3NlcyBhIHJlc3BvbnNlIHRoZSBkZWZhdWx0IHBhdGggd291bGQgcGFyc2UuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVzcG9uc2VQYXJzZUlucHV0IHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBjd2Q6IHN0cmluZztcbiAgc3Rkb3V0OiBzdHJpbmc7XG4gIHN0ZGVycj86IHN0cmluZztcbiAgZXhpdFN0YXR1cz86IG51bWJlcjsgLy8gbWV0YWRhdGEgb25seSBcdTIwMTQgbmV2ZXIgZ2F0ZXMgKGdpdCBkaWZmIGV4aXRzIDEgb24gZGlmZmVyZW5jZXMpXG4gIHRydW5jYXRlZD86IGJvb2xlYW47XG4gIGludGVycnVwdGVkPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBUaGUgbWF4aW11bSBudW1iZXIgb2YgZGlzdGluY3Qgc3BhbnMgYHBhcnNlUmVzcG9uc2VgIG1heSBlbWl0LiBNZWFzdXJlZFxuICogdGhyb3VnaCB0aGUgZGVwbG95ZWQgaG9vaywgZWFjaCBzcGFuIGNvc3RzIH40NiBtcyBvZiBzdWJwcm9jZXNzIGV4ZWNzIGluXG4gKiB0aGUgdG91Y2ggY29yZSAocmVzb2x2ZVRvdWNoU2NvcGUgKyBgZ2l0IHNwYW4gbGlzdGAgcGVyIHNwYW47IHRoZSBzZXNzaW9uXG4gKiBtZW1vIG1ha2VzIHJlcGVhdCBydW5zIGNoZWFwLCBidXQgZmlyc3QgcnVucyBwYXkgdGhlIGZ1bGwgcHJpY2UpIGFnYWluc3QgYVxuICogMTAgcyBob29rcy5qc29uIHRpbWVvdXQgXHUyMDE0IDUwIHNwYW5zIFx1MjI0OCAyLjMgcyB3b3JzdCBjYXNlLCB3ZWxsIHVuZGVyIHRoZVxuICogdGltZW91dCB3aXRoIG1hcmdpbiBldmVuIHdpdGggdGhlIGNvbW1hbmQtZGVyaXZlZCBzcGFucyBvbiB0b3AuIFRoZSBwbGFuJ3NcbiAqIHJpc2sgc2VjdGlvbiBkZWZlcnJlZCB0aGlzIGNhcCAoXCJmYWlsIGNsb3NlZCBiZXlvbmQgaXRcIikgdG8gYSBQaGFzZSAzYVxuICogbWVhc3VyZW1lbnQ7IHRoZSBnb2xkZW4gbWF0cml4J3MgbGFyZ2VzdCByZWFsaXN0aWMgb3V0cHV0cyBzdGF5IGZhciBiZWxvd1xuICogaXQsIHNvIGl0IGJpbmRzIG9ubHkgcGF0aG9sb2dpY2FsIHNlYXJjaGVzLlxuICovXG5leHBvcnQgY29uc3QgTUFYX1JFU1BPTlNFX1NQQU5TID0gNTA7XG5cbi8qKlxuICogQSBzaW5nbGUgZGVjb2RlZCBzZWFyY2gtb3V0cHV0IHJlY29yZC4gVGhlIHBhdGgvbGluZSBzcGxpdCBpcyBsYXlvdXQtXG4gKiBkZXBlbmRlbnQ6IGBwYXRoOmxpbmU6dGV4dGAgKHJlY3Vyc2l2ZSksIGBwYXRoLWxpbmU6dGV4dGAgKGNvbnRleHQgbGluZXMgaW5cbiAqIC1BLy1CLy1DIGdyb3VwcyBjYXJyeSBubyBudW1iZXIgXHUyMDE0IGBsaW5lYCBpcyBudWxsIGFuZCB0aGUgcmVjb3JkIGFkdmFuY2VzXG4gKiB0aGUgcGVyLWZpbGUgY291bnRlciBpbnN0ZWFkKSwgYGxpbmU6dGV4dGAgKG9uZS1maWxlIGxheW91dCksIG9yIGFcbiAqIE5VTC10ZXJtaW5hdGVkIGBwYXRoOjE6XHUyMDI2YCByZWNvcmQgKGAtemApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNlYXJjaFJlY29yZCB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFRoZSByZWNvcmQncyBsaW5lIG51bWJlciwgb3IgbnVsbCBmb3IgY29udGV4dCBsaW5lcyB3aXRob3V0IG9uZS4gKi9cbiAgbGluZTogbnVtYmVyIHwgbnVsbDtcbiAgdGV4dDogc3RyaW5nO1xufVxuXG4vKiogVGhlIHJlY29nbml6ZWQgc2VhcmNoIG91dHB1dCBsYXlvdXRzIHRoZSBkZWNvZGVycyBkaXN0aW5ndWlzaC4gKi9cbmV4cG9ydCB0eXBlIFNlYXJjaExheW91dCA9ICdyZWN1cnNpdmUnIHwgJ2NvbnRleHQnIHwgJ2hlYWRpbmcnIHwgJ251bGwtc2VwYXJhdGVkJyB8ICdvbmUtZmlsZSc7XG5cbi8qKlxuICogT25lIGZpbGUncyBzZWN0aW9uIG9mIGEgdW5pZmllZC1kaWZmIHJlc3BvbnNlLiBgb2xkUGF0aGAvYG5ld1BhdGhgIGFyZSB0aGVcbiAqIGBhL2AtYGIvYC1wcmVmaXhlZCBzaWRlcyB3aXRoIHRoZSBwcmVmaXggc3RyaXBwZWQ7IG51bGwgZm9yIGAvZGV2L251bGxgXG4gKiAobmV3LWZpbGUgLyBkZWxldGVkLWZpbGUgc2lkZXMpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIERpZmZGaWxlUmVjb3JkIHtcbiAgb2xkUGF0aDogc3RyaW5nIHwgbnVsbDtcbiAgbmV3UGF0aDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFJlbmFtZS9jb3B5IG1ldGFkYXRhIChgcmVuYW1lIGZyb21gL2ByZW5hbWUgdG9gLCBgY29weSBmcm9tYC9gY29weSB0b2ApOlxuICAgKiB0aGUgbmV3IHBhdGggaXMgdGhlIHRvdWNoIHRhcmdldC5cbiAgICovXG4gIHJlbmFtZTogeyBmcm9tOiBzdHJpbmc7IHRvOiBzdHJpbmcgfSB8IG51bGw7XG4gIGJpbmFyeTogYm9vbGVhbjtcbiAgY29tYmluZWQ6IGJvb2xlYW47XG4gIHN1Ym1vZHVsZTogYm9vbGVhbjtcbiAgaHVua3M6IERpZmZIdW5rW107XG59XG5cbi8qKlxuICogQSB1bmlmaWVkLWRpZmYgaHVuayBoZWFkZXIgKGBAQCAtYSxiICtjLGQgQEBgKTsgYW4gb21pdHRlZCBjb3VudCBtZWFucyAxLlxuICogUGVyLXNpZGUgcmFuZ2VzIGFyZSBgb2xkU3RhcnQuLm9sZFN0YXJ0K29sZENvdW50LTFgIG9uIHRoZSBvbGQgcGF0aCBhbmRcbiAqIGBuZXdTdGFydC4ubmV3U3RhcnQrbmV3Q291bnQtMWAgb24gdGhlIG5ldyBwYXRoLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIERpZmZIdW5rIHtcbiAgb2xkU3RhcnQ6IG51bWJlcjtcbiAgb2xkQ291bnQ6IG51bWJlcjtcbiAgbmV3U3RhcnQ6IG51bWJlcjtcbiAgbmV3Q291bnQ6IG51bWJlcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb21tYW5kIGFuYWx5c2lzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgU0VBUkNIX0JJTlMgPSBuZXcgU2V0KFsncmcnLCAnZ3JlcCcsICdlZ3JlcCcsICdmZ3JlcCddKTtcblxuLyoqXG4gKiBTaG9ydCBvcHRpb25zIHRoYXQgY29uc3VtZSBhIHZhbHVlIChyZy9ncmVwKTogLUEvLUIvLUMgKGNvbnRleHQpLCAtZS8tZlxuICogKHBhdHRlcm4vZmlsZSksIC1tIChtYXggY291bnQpLCAtZy8tdC8tVCAocmcgdHlwZS9nbG9iKS4gQW55dGhpbmcgZWxzZSBpbiBhXG4gKiBzaG9ydCBjbHVzdGVyIGlzIGEgcGxhaW4gZmxhZy5cbiAqL1xuY29uc3QgVkFMVUVfU0hPUlRfRkxBR1MgPSBuZXcgU2V0KFsnQScsICdCJywgJ0MnLCAnZScsICdmJywgJ20nLCAnZycsICd0JywgJ1QnXSk7XG5cbi8qKiBMb25nIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgdmFsdWUgYXJndW1lbnQuICovXG5jb25zdCBWQUxVRV9MT05HX0ZMQUdTID0gbmV3IFNldChbXG4gICdhZnRlci1jb250ZXh0JyxcbiAgJ2JlZm9yZS1jb250ZXh0JyxcbiAgJ2NvbnRleHQnLFxuICAnbWF4LWNvdW50JyxcbiAgJ3JlZ2V4cCcsXG4gICdmaWxlJyxcbiAgJ2dsb2InLFxuICAnaWdsb2InLFxuICAndHlwZScsXG4gICd0eXBlLW5vdCcsXG4gICdpbmNsdWRlJyxcbiAgJ2V4Y2x1ZGUnLFxuICAnZXhjbHVkZS1kaXInLFxuICAnZXhjbHVkZS1mcm9tJ1xuXSk7XG5cbmZ1bmN0aW9uIGhhc1NoZWxsRXhwYW5zaW9uKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL1skYF0vLnRlc3Qocyk7XG59XG5cbmludGVyZmFjZSBTZWFyY2hBcmd2SW5mbyB7XG4gIC8qKlxuICAgKiBQb3NpdGlvbmFsIHBhdGggYXJnczsgZW1wdHkgd2hlbiB0aGUgY29tbWFuZCBuYW1lZCBub25lLiBUaGUgZmlyc3RcbiAgICogcG9zaXRpb25hbCBpcyB0aGUgcGF0dGVybiB1bmxlc3MgdGhlIHBhdHRlcm4gY2FtZSBmcm9tIGEgZmxhZyB2YWx1ZVxuICAgKiAoYC1lYC9gLWZgL2AtLXJlZ2V4cGAvYC0tZmlsZWApLCBpbiB3aGljaCBjYXNlIGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYVxuICAgKiBwYXRoLlxuICAgKi9cbiAgcGF0aEFyZ3M6IHN0cmluZ1tdO1xuICAvKiogV2hldGhlciAtQS8tQi8tQyAoYW55IGNvbnRleHQgd2luZG93KSB3YXMgcmVxdWVzdGVkLiAqL1xuICBjb250ZXh0RmxhZ3M6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBjb21tYW5kIHJlcXVlc3RlZCBsaW5lIG51bWJlcnMgKGAtbmAvYC0tbGluZS1udW1iZXJgKS4gcmcgYW5kXG4gICAqIGdyZXAgYm90aCBkZWZhdWx0IHRvIE5PIGxpbmUgbnVtYmVycyB3aGVuIHBpcGVkLCBzbyB0aGlzIGlzIHRoZVxuICAgKiBjb21tYW5kLXNpZGUgZXZpZGVuY2UgdGhhdCBgbGluZTp0ZXh0YC1vbmx5IG91dHB1dCBpcyBudW1iZXJlZCBvdXRwdXQgXHUyMDE0XG4gICAqIHRoZSBvbmUtZmlsZSBhbmQgaGVhZGluZyBsYXlvdXRzIHJlZnVzZSB0byBhcHBseSB3aXRob3V0IGl0LiBBIG51bWJlcmVkXG4gICAqIGNvbW1hbmQgd2hvc2UgcmVjb3JkcyBhbGwgZmFpbCB0byBkZWNvZGUgbXVzdCBub3QgZmFsbCBiYWNrIHRvIGFcbiAgICogd2hvbGUtZmlsZSBzcGFuIFx1MjAxNCB0aGUgcmVjb3JkcyBtYXkgaGF2ZSBiZWVuIHJlbnVtYmVyZWQgb3IgZGVzdHJveWVkIGJ5IGFcbiAgICogbGF0ZXIgcGlwZWxpbmUgc3RhZ2UuXG4gICAqL1xuICBudW1iZXJlZDogYm9vbGVhbjtcbiAgLyoqIFdoZXRoZXIgYC1IYC9gLS13aXRoLWZpbGVuYW1lYCB3YXMgcmVxdWVzdGVkIFx1MjAxNCByZWNvcmRzIGNhcnJ5IHBhdGggcHJlZml4ZXMgZXZlbiBmb3IgYSBzaW5nbGUgZmlsZS4gKi9cbiAgd2l0aEZpbGVuYW1lOiBib29sZWFuO1xuICAvKipcbiAgICogV2hldGhlciBhbnkgcG9zaXRpb25hbCB3YXMgZ2l0IHBhdGhzcGVjIG1hZ2ljIChgOi9gLCBgOiFgLCBgOl5gLFxuICAgKiBgOiguLi4pYCkgXHUyMDE0IGEgd2hvbGUtdHJlZSBvciBleGNsdXNpb24gc3BlYywgbmV2ZXIgYSBmaWxlc3lzdGVtIHJvb3QuXG4gICAqIFdoZW4gcHJlc2VudCwgZ2l0IGdyZXAgc2VhcmNoZXMgYmV5b25kIHRoZSBjd2QsIHNvIHRoZSBwZXJtaXR0ZWQgcm9vdFxuICAgKiBhbmNob3JzIHRvIHRoZSB3b3JrdHJlZSByb290IGluc3RlYWQgb2YgdGhlIGVmZmVjdGl2ZSBkaXIuXG4gICAqL1xuICBwYXRoc3BlY01hZ2ljOiBib29sZWFuO1xuICAvKipcbiAgICogV2hldGhlciBhIHN0ZGluIHJlZGlyZWN0IChgPGAsIGA8PDxgLCBgPChcdTIwMjZgKSBhcHBlYXJzOiB0aGUgYmluIHJlYWRzXG4gICAqIFNURElOLCBhbmQgdGhlIHRva2VucyBhZnRlciB0aGUgcmVkaXJlY3QgYXJlIGl0cyB0YXJnZXRzLCBuZXZlciBzZWFyY2hcbiAgICogcm9vdHMgXHUyMDE0IHRoZSBwb3NpdGlvbmFsIHNjYW4gc3RvcHMgdGhlcmUuXG4gICAqL1xuICBzdGRpblJlZGlyZWN0OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYHBgIGlzIGEgZ2l0IHBhdGhzcGVjIG1hZ2ljIHByZWZpeCAoYDovYCwgYDohYCwgYDpeYCwgYDooLi4uKWApIFx1MjAxNFxuICogYSBub24tZmlsZXN5c3RlbSBwYXRoIGZvcm0gdGhhdCBtdXN0IG5ldmVyIGJlY29tZSBhIHBlcm1pdHRlZCByb290LiBBXG4gKiBsaXRlcmFsIGBjd2QvOi9gIHJvb3Qgd291bGQgcmVqZWN0IGV2ZXJ5IGRlY29kZWQgcmVjb3JkOyB0cmVhdGluZyBwYXRoc3BlY1xuICogbWFnaWMgbGlrZSBubyBwYXRoIGFyZ3MgbGV0cyByb290cyBmYWxsIGJhY2sgdG8gdGhlIGVmZmVjdGl2ZSBjd2QuXG4gKi9cbmZ1bmN0aW9uIGlzUGF0aHNwZWNNYWdpYyhwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eOlsvIV4uKF0vLnRlc3QocCk7XG59XG5cbi8qKlxuICogU2NhbiBhIHNlYXJjaCBjb21tYW5kJ3MgYXJndiAoc3RhcnRpbmcgYWZ0ZXIgdGhlIGJpbmFyeSwgb3IgYWZ0ZXIgdGhlXG4gKiBgZ3JlcGAgc3ViY29tbWFuZCBmb3IgZ2l0IGdyZXApIGZvciB0aGUgcG9zaXRpb25hbCBhcmdzIGFuZCBjb250ZXh0IGZsYWdzLFxuICogY29uc3VtaW5nIG9wdGlvbiB2YWx1ZXMgc28gdGhleSBhcmUgbmV2ZXIgbWlzdGFrZW4gZm9yIHBvc2l0aW9uYWxzLlxuICovXG5mdW5jdGlvbiBhbmFseXplU2VhcmNoQXJndihhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IFNlYXJjaEFyZ3ZJbmZvIHtcbiAgY29uc3QgcG9zaXRpb25hbHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb250ZXh0RmxhZ3MgPSBmYWxzZTtcbiAgbGV0IG51bWJlcmVkID0gZmFsc2U7XG4gIGxldCB3aXRoRmlsZW5hbWUgPSBmYWxzZTtcbiAgbGV0IHBhdHRlcm5Gcm9tRmxhZyA9IGZhbHNlO1xuICBsZXQgc3RkaW5SZWRpcmVjdCA9IGZhbHNlO1xuICBsZXQgaSA9IHN0YXJ0O1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIHBvc2l0aW9uYWxzLnB1c2goLi4uYXJndi5zbGljZShpICsgMSkpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJzwnKSkge1xuICAgICAgLy8gQSBzdGRpbiByZWRpcmVjdCAoYDxgLCBgPDw8YCwgYDwoXHUyMDI2YCk6IHRoZSBiaW4gcmVhZHMgc3RkaW4sIGFuZCB0aGVcbiAgICAgIC8vIGZvbGxvd2luZyB0b2tlbnMgYXJlIHJlZGlyZWN0IHRhcmdldHMsIG5vdCBzZWFyY2ggcm9vdHMuXG4gICAgICBzdGRpblJlZGlyZWN0ID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLScpKSB7XG4gICAgICBjb25zdCBlcSA9IGEuaW5kZXhPZignPScpO1xuICAgICAgY29uc3QgbmFtZSA9IGVxID09PSAtMSA/IGEuc2xpY2UoMikgOiBhLnNsaWNlKDIsIGVxKTtcbiAgICAgIGlmIChuYW1lID09PSAnYWZ0ZXItY29udGV4dCcgfHwgbmFtZSA9PT0gJ2JlZm9yZS1jb250ZXh0JyB8fCBuYW1lID09PSAnY29udGV4dCcpIGNvbnRleHRGbGFncyA9IHRydWU7XG4gICAgICBpZiAobmFtZSA9PT0gJ2xpbmUtbnVtYmVyJykgbnVtYmVyZWQgPSB0cnVlO1xuICAgICAgaWYgKG5hbWUgPT09ICd3aXRoLWZpbGVuYW1lJykgd2l0aEZpbGVuYW1lID0gdHJ1ZTtcbiAgICAgIGlmIChuYW1lID09PSAncmVnZXhwJyB8fCBuYW1lID09PSAnZmlsZScpIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7XG4gICAgICBpZiAoZXEgPT09IC0xICYmIFZBTFVFX0xPTkdfRkxBR1MuaGFzKG5hbWUpKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpICYmIGEgIT09ICctJyAmJiBhLmxlbmd0aCA+IDEpIHtcbiAgICAgIGxldCBjb25zdW1lc05leHQgPSBmYWxzZTtcbiAgICAgIGZvciAobGV0IGogPSAxOyBqIDwgYS5sZW5ndGg7IGorKykge1xuICAgICAgICBjb25zdCBjID0gYVtqXTtcbiAgICAgICAgaWYgKGMgPT09ICdBJyB8fCBjID09PSAnQicgfHwgYyA9PT0gJ0MnKSBjb250ZXh0RmxhZ3MgPSB0cnVlO1xuICAgICAgICBpZiAoYyA9PT0gJ24nKSBudW1iZXJlZCA9IHRydWU7XG4gICAgICAgIGlmIChjID09PSAnSCcpIHdpdGhGaWxlbmFtZSA9IHRydWU7XG4gICAgICAgIGlmIChjID09PSAnZScgfHwgYyA9PT0gJ2YnKSBwYXR0ZXJuRnJvbUZsYWcgPSB0cnVlO1xuICAgICAgICBpZiAoVkFMVUVfU0hPUlRfRkxBR1MuaGFzKGMpKSB7XG4gICAgICAgICAgLy8gQSB2YWx1ZS10YWtpbmcgZmxhZyBjb25zdW1lcyB0aGUgcmVzdCBvZiB0aGUgY2x1c3RlciBhcyBpdHMgdmFsdWVcbiAgICAgICAgICAvLyAoLUMxKSBvciwgd2hlbiBsYXN0LCB0aGUgbmV4dCBhcmd1bWVudCAoLUMgMSkuXG4gICAgICAgICAgY29uc3VtZXNOZXh0ID0gaiA9PT0gYS5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpICs9IGNvbnN1bWVzTmV4dCA/IDIgOiAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgaSArPSAxO1xuICB9XG4gIC8vIFRoZSBmaXJzdCBwb3NpdGlvbmFsIGlzIHRoZSBwYXR0ZXJuIFx1MjAxNCB1bmxlc3MgdGhlIHBhdHRlcm4gY2FtZSBmcm9tIGFcbiAgLy8gZmxhZyB2YWx1ZSAoYC1lYC9gLWZgL2AtLXJlZ2V4cGAvYC0tZmlsZWAsIHNlcGFyYXRlIG9yIGdsdWVkKSwgaW4gd2hpY2hcbiAgLy8gY2FzZSBldmVyeSBwb3NpdGlvbmFsIGlzIGFuIGV4cGxpY2l0IHNlYXJjaCByb290LCBleGFjdGx5IGFzXG4gIC8vIGhhc0dyZXBGaWxlT3BlcmFuZCB0cmVhdHMgYSBncmVwLWZhbWlseSBwaXBlbGluZSBzdGFnZS4gR2l0IHBhdGhzcGVjXG4gIC8vIG1hZ2ljIGlzIG5vdCBhIGZpbGVzeXN0ZW0gcGF0aCBhbmQgbmV2ZXIgYmVjb21lcyBhIHJvb3QgXHUyMDE0IGJ1dCBpdHNcbiAgLy8gcHJlc2VuY2UgaXMgdHJhY2tlZCwgYmVjYXVzZSBpdCBtYWtlcyBnaXQgZ3JlcCBzZWFyY2ggdGhlIHdob2xlIHRyZWVcbiAgLy8gZnJvbSBhIHN1YmRpci5cbiAgY29uc3QgZmlyc3RQb3NpdGlvbmFsID0gcGF0dGVybkZyb21GbGFnID8gMCA6IDE7XG4gIGNvbnN0IHBhdGhBcmdzID1cbiAgICBwb3NpdGlvbmFscy5sZW5ndGggPiBmaXJzdFBvc2l0aW9uYWwgPyBwb3NpdGlvbmFscy5zbGljZShmaXJzdFBvc2l0aW9uYWwpLmZpbHRlcigocCkgPT4gIWlzUGF0aHNwZWNNYWdpYyhwKSkgOiBbXTtcbiAgY29uc3QgcGF0aHNwZWNNYWdpYyA9XG4gICAgcG9zaXRpb25hbHMubGVuZ3RoID4gZmlyc3RQb3NpdGlvbmFsICYmIHBvc2l0aW9uYWxzLnNsaWNlKGZpcnN0UG9zaXRpb25hbCkuc29tZSgocCkgPT4gaXNQYXRoc3BlY01hZ2ljKHApKTtcbiAgcmV0dXJuIHsgcGF0aEFyZ3MsIGNvbnRleHRGbGFncywgbnVtYmVyZWQsIHdpdGhGaWxlbmFtZSwgcGF0aHNwZWNNYWdpYywgc3RkaW5SZWRpcmVjdCB9O1xufVxuXG5pbnRlcmZhY2UgR2l0U3ViY29tbWFuZEluZm8ge1xuICAvKiogVGhlIGBnaXQgLUNgIGRpcmVjdG9yeSwgd2hlbiBwcmVzZW50IGFuZCBzdGF0aWNhbGx5IHJlc29sdmFibGUuICovXG4gIGRpcjogc3RyaW5nIHwgbnVsbDtcbiAgZGlyVW5yZXNvbHZhYmxlOiBib29sZWFuO1xuICAvKiogVGhlIHN1YmNvbW1hbmQgdG9rZW4gKGBncmVwYCwgYGRpZmZgLCBgc2hvd2AsIGBsb2dgLCBgYmxhbWVgLCBcdTIwMjYpLiAqL1xuICBzdWJjb21tYW5kOiBzdHJpbmc7XG4gIC8qKiBJbmRleCBqdXN0IHBhc3QgdGhlIHN1YmNvbW1hbmQsIHdoZXJlIGl0cyBhcmd2IGJlZ2lucy4gKi9cbiAgc3RhcnQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBMb2NhdGUgdGhlIHN1YmNvbW1hbmQgdG9rZW4gb2YgYSBgZ2l0YCBjb21tYW5kLCBob25vcmluZyBgLUNgL2AtY2AgbGlrZVxuICogcGFyc2UtY29tbWFuZC50cydzIGZpbmRHaXRTdWJjb21tYW5kLiBSZXR1cm5zIG51bGwgd2hlbiBubyBzdWJjb21tYW5kXG4gKiB0b2tlbiBhcHBlYXJzIChiYXJlIGBnaXRgKS4gV2hpY2ggc3ViY29tbWFuZHMgcmVzcG9uc2UtZGVjb2RlIGlzIHRoZVxuICogZ2F0ZSdzIGNhbGwsIG5vdCB0aGlzIHNjYW5uZXIncy5cbiAqL1xuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoYXJndjogc3RyaW5nW10pOiBHaXRTdWJjb21tYW5kSW5mbyB8IG51bGwge1xuICBsZXQgZGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGRpclVucmVzb2x2YWJsZSA9IGZhbHNlO1xuICBsZXQgaSA9IDE7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy1DJykge1xuICAgICAgY29uc3QgdiA9IGFyZ3ZbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoaGFzU2hlbGxFeHBhbnNpb24odikpIGRpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGRpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICByZXR1cm4geyBkaXIsIGRpclVucmVzb2x2YWJsZSwgc3ViY29tbWFuZDogYSwgc3RhcnQ6IGkgKyAxIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKiBBIHJlc3BvbnNlLWRlcml2YWJsZSBjb21tYW5kIHRoYXQgcGFzc2VkIHRoZSBnYXRlLCB3aXRoIGl0cyBkZWNvZGVyJ3MgaW5wdXRzLiAqL1xudHlwZSBHYXRlZENvbW1hbmQgPSB7XG4gIGtpbmQ6ICdzZWFyY2gnIHwgJ2RpZmYnIHwgJ2JsYW1lJztcbiAgYXJndjogc3RyaW5nW107XG4gIC8qKiBJbmRleCBqdXN0IHBhc3QgdGhlIGJpbmFyeSAoc2VhcmNoKSBvciBzdWJjb21tYW5kIChnaXQpLCB3aGVyZSBpdHMgYXJndiBiZWdpbnMuICovXG4gIHN0YXJ0OiBudW1iZXI7XG4gIC8qKiBUaGUgYGdpdCAtQ2AgZGlyZWN0b3J5LCB3aGVuIHByZXNlbnQgYW5kIHN0YXRpY2FsbHkgcmVzb2x2YWJsZS4gKi9cbiAgZGlyOiBzdHJpbmcgfCBudWxsO1xuICBkaXJVbnJlc29sdmFibGU6IGJvb2xlYW47XG59O1xuXG4vKiogV2hldGhlciBhIGBnaXQgbG9nYCBpbnZvY2F0aW9uIGlzIGRpZmYtZm9ybSAoYC1wYC9gLS1wYXRjaGAgcHJlc2VudCkuICovXG5mdW5jdGlvbiBoYXNEaWZmUGF0Y2hGbGFnKGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoYXJndltpXSA9PT0gJy1wJyB8fCBhcmd2W2ldID09PSAnLS1wYXRjaCcpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgYGdpdCBzaG93YCBpbnZvY2F0aW9uIGlzIHRoZSBgPHJldj46PHBhdGg+YCBjb250ZW50IGlkaW9tIHdob3NlXG4gKiBzdGRvdXQgaXMgdGhlIGJsb2IncyBSQVcgY29udGVudCwgbmV2ZXIgZGlmZi1mb3JtLiBgZ2l0IHNob3dgIHBvc2l0aW9uYWxzXG4gKiBhcmUgcmV2aXNpb25zLCBhbmQgb25seSBhIHJldjpwYXRoIHNwZWMgZW1iZWRzIGEgY29sb24gXHUyMDE0IGEgZGlmZi1zaGFwZWRcbiAqIHZlbmRvcmVkIGJsb2IgKGEgLnBhdGNoLCBhIGZvcm1hdC1wYXRjaCBhcmNoaXZlKSBtdXN0IG5vdCBkZWNvZGUgaW50b1xuICogZmFicmljYXRlZCB0b3VjaGVzIG9uIHRoZSBmaWxlcyBpdHMgY29udGVudCBuYW1lcy4gT3B0aW9uIHZhbHVlcyBhcmVcbiAqIHNraXBwZWQgc28gYC0tZm9ybWF0ICVIOiVzYCAod2hpY2ggbGVnaXRpbWF0ZWx5IGNvbnRhaW5zIGEgY29sb24pIGNhbm5vdFxuICogZmFsc2UtcG9zaXRpdmU7IGFmdGVyIGAtLWAgdGhlIHRva2VucyBhcmUgbGl0ZXJhbCBwYXRoc3BlY3MsIG5vdCByZXZzLlxuICogT25seSBmbGFncyB0aGF0IGNvbnN1bWUgYSBTRVBBUkFURSBhcmd1bWVudCBza2lwIHRoZWlyIHZhbHVlOiBgLS1zdGF0YCBhbmRcbiAqIGAtLWRpcnN0YXRgIHRha2UgdGhlaXJzIHZpYSBgPWAgKGAtLWRpcnN0YXQ9ZmlsZXMsMTBgKSBvciBub3QgYXQgYWxsLCBzbyBhXG4gKiBgZ2l0IHNob3cgLS1zdGF0IDxyZXY+OjxwYXRoPmAgbXVzdCBub3Qgc3dhbGxvdyB0aGUgcmV2OnBhdGggYXMgYSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gaGFzUmV2UGF0aEFyZyhhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBjb25zdCB2YWx1ZUZsYWdzID0gbmV3IFNldChbJy0tZm9ybWF0JywgJy0tcHJldHR5JywgJy0tb3V0cHV0JywgJy0td29yZC1kaWZmLXJlZ2V4J10pO1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nKSB7XG4gICAgICBpZiAoIWEuaW5jbHVkZXMoJz0nKSAmJiB2YWx1ZUZsYWdzLmhhcyhhKSkgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLmluY2x1ZGVzKCc6JykpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBleGFjdCBsb25nIGZsYWcgYGZsYWdgIGFwcGVhcnMgaW4gdGhlIGNvbW1hbmQncyBhcmd2IChzdG9wcGluZ1xuICogYXQgYC0tYCwgYWZ0ZXIgd2hpY2ggdG9rZW5zIGFyZSBsaXRlcmFsIHBhdGhzcGVjcywgbm90IG9wdGlvbnMpLiBVc2VkIGZvclxuICogdGhlIGRpZmYgYC0tcmVsYXRpdmVgIGFuZCBnaXQtZ3JlcCBgLS1mdWxsLW5hbWVgIGNhcnZlLW91dHMuXG4gKi9cbmZ1bmN0aW9uIGhhc0ZsYWcoYXJndjogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGZsYWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoYSA9PT0gZmxhZykgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IGRpZmZgIGludm9jYXRpb24ncyBwb3NpdGlvbmFsIGFyZ3VtZW50cyBjYXJyeSBgcmV2OnBhdGhgXG4gKiBzcGVjcy4gYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gIGNvbXBhcmVzIHR3byBoaXN0b3JpY2FsIGJsb2JzXG4gKiBhbmQgZW1pdHMgYSBub3JtYWwgdW5pZmllZCBkaWZmIHdob3NlIHBhdGhzIG5hbWUgdGhlIGJsb2IgcGF0aHMsIG5vdFxuICogd29ya2luZy10cmVlIGZpbGVzIFx1MjAxNCBkZWNvZGluZyBpdCBmYWJyaWNhdGVzIHRvdWNoZXMgb24gYSBmaWxlIGdpdCBuZXZlclxuICogcmVhZCAodW5saWtlIHRoZSBzaW5nbGUtYXJnIGZvcm0sIHdoaWNoIGVycm9ycyBpbnN0ZWFkIG9mIGVtaXR0aW5nXG4gKiBjb250ZW50KS4gQSBwb3NpdGlvbmFsIGNvbnRhaW5pbmcgYDpgIGlzIGEgcmV2OnBhdGggdW5sZXNzIGFuIGV4aXN0aW5nXG4gKiBmaWxlIGNhcnJpZXMgdGhhdCBsaXRlcmFsIG5hbWUgKGBnaXQgZGlmZiAuL3dlaXJkOm5hbWUudHNgIFx1MjAxNCBhIGxpdGVyYWxcbiAqIGNvbG9uIHBhdGggbmVlZHMgdGhlIGAuL2AgcHJlZml4IHRvIHN1cnZpdmUgZ2l0J3MgcmV2aXNpb24gcGFyc2luZyk7XG4gKiBhZnRlciBgLS1gIHRoZSB0b2tlbnMgYXJlIGxpdGVyYWwgcGF0aHNwZWNzIGFuZCB0aGUgc2NhbiBzdG9wcy4gRmxhZ3NcbiAqIHRoYXQgY29uc3VtZSBhIFNFUEFSQVRFIGFyZ3VtZW50IHNraXAgdGhlaXIgdmFsdWUgc28gYW4gb3V0cHV0IHBhdGhcbiAqIGNhbm5vdCBmYWxzZS1wb3NpdGl2ZS5cbiAqL1xuZnVuY3Rpb24gaGFzRGlmZlJldlBhdGhBcmcoYXJndjogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGN3ZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIC8vIFZhbHVlLWNvbnN1bWluZyBmbGFncyB3aG9zZSBTRVBBUkFURSB2YWx1ZSB0b2tlbiBtdXN0IG5ldmVyIGJlIHNjYW5uZWRcbiAgLy8gYXMgYSBwb3NpdGlvbmFsOiBgLUwgPHJhbmdlPjo8ZmlsZT5gIChnaXQgbG9nL2JsYW1lIFx1MjAxNCB0aGUgcmFuZ2UncyBgOmAgaXNcbiAgLy8gYSBsaW5lLXJhbmdlIHNlcGFyYXRvciwgbm90IGEgcmV2OnBhdGgpLCB0aGUgcGlja2F4ZSBgLVNgL2AtR2AgYW5kIHRoZVxuICAvLyBsb2cgZmlsdGVycyBgLS1ncmVwYC9gLS1hdXRob3JgL2AtLWNvbW1pdHRlcmAsIGFuZCB0aGUgZGF0ZSBsaW1pdHNcbiAgLy8gYC0tc2luY2VgL2AtLXVudGlsYC9gLS1iZWZvcmVgL2AtLWFmdGVyYCwgd2hvc2Ugc3BhY2UtZm9ybSBJU08gdGltZXN0YW1wXG4gIC8vIHZhbHVlcyAoYC0tc2luY2UgJzIwMjQtMDEtMDFUMTI6MDA6MDAnYCkgY29udGFpbiBjb2xvbnMgXHUyMDE0IGFcbiAgLy8gYGdpdCBsb2cgLXAgLVMgJzphdXRoJ2AgYXJjaGFlb2xvZ3kgaW52b2NhdGlvbiBpcyBleGl0LTAgdmFsaWQgYW5kIGl0c1xuICAvLyB2YWx1ZSB0b2tlbiBtdXN0IG5vdCByZWplY3QgdGhlIHdob2xlIGRlY29kZS4gRXhhY3QtdG9rZW4gbWVtYmVyc2hpcFxuICAvLyBrZWVwcyBnbHVlZCBmb3JtcyBzYWZlIGJ5IGNvbnN0cnVjdGlvbjogYC1TOmF1dGhgIGlzIG5ldmVyIGluIHRoZSBzZXRcbiAgLy8gYW5kIHNraXBzIG5vIHRva2VuLlxuICBjb25zdCB2YWx1ZUZsYWdzID0gbmV3IFNldChbXG4gICAgJy0tb3V0cHV0JyxcbiAgICAnLS1zcmMtcHJlZml4JyxcbiAgICAnLS1kc3QtcHJlZml4JyxcbiAgICAnLUwnLFxuICAgICctUycsXG4gICAgJy1HJyxcbiAgICAnLS1ncmVwJyxcbiAgICAnLS1hdXRob3InLFxuICAgICctLWNvbW1pdHRlcicsXG4gICAgJy0tc2luY2UnLFxuICAgICctLXVudGlsJyxcbiAgICAnLS1iZWZvcmUnLFxuICAgICctLWFmdGVyJ1xuICBdKTtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpICYmIGEgIT09ICctJykge1xuICAgICAgaWYgKCFhLmluY2x1ZGVzKCc9JykgJiYgdmFsdWVGbGFncy5oYXMoYSkpIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5pbmNsdWRlcygnOicpICYmICFleGlzdHNTeW5jKHJlc29sdmVQYXRoKGN3ZCwgYSkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogVGhlIHBhdGggYmFzZSBgZ2l0IGRpZmYgLS1yZWxhdGl2ZVs9PHBhdGg+XWAgYW5jaG9ycyBpdHMgb3V0cHV0IHRvOiBudWxsXG4gKiB3aGVuIHRoZSBmbGFnIGlzIGFic2VudCAocmVwby1yb290LXJlbGF0aXZlIHBhdGhzIFx1MjAxNCB0aGUgZGVmYXVsdCk7IHRoZVxuICogZWZmZWN0aXZlIGRpciBmb3IgdGhlIGJhcmUgZm9ybSwgd2hvc2UgcGF0aHMgYXJlIGN3ZC1yZWxhdGl2ZSBhbmQgZXhjbHVkZVxuICogY2hhbmdlcyBvdXRzaWRlIHRoZSBjd2Q7IG9yIGA8cGF0aD5gIHJlc29sdmVkIGFnYWluc3QgdGhlIHdvcmt0cmVlIHJvb3RcbiAqIGZvciB0aGUgdmFsdWUgZm9ybSAodmVyaWZpZWQgYWdhaW5zdCBnaXQgMi40Ny4zIFx1MjAxNCB0aGUgdmFsdWUgaXNcbiAqIHJvb3QtcmVsYXRpdmUsIG5vdCBjd2QtcmVsYXRpdmUpLiBgJ3VucmVzb2x2YWJsZSdgIHdoZW4gdGhlIHZhbHVlIGZvcm0nc1xuICogcGF0aCBjYW5ub3QgYmUgc3RhdGljYWxseSByZXNvbHZlZCAoc2hlbGwgZXhwYW5zaW9uKSBvciBubyB3b3JrdHJlZSByb290XG4gKiBleGlzdHMgXHUyMDE0IGZhaWwgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBkaWZmUmVsYXRpdmVCYXNlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgc3RhcnQ6IG51bWJlcixcbiAgZWZmZWN0aXZlRGlyOiBzdHJpbmcsXG4gIHJlcG9Sb290OiBzdHJpbmcgfCBudWxsXG4pOiB7IGJhc2U6IHN0cmluZzsgcm9vdDogc3RyaW5nIH0gfCAndW5yZXNvbHZhYmxlJyB8IG51bGwge1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHJldHVybiBudWxsO1xuICAgIGlmIChhID09PSAnLS1yZWxhdGl2ZScpIHJldHVybiB7IGJhc2U6IGVmZmVjdGl2ZURpciwgcm9vdDogZWZmZWN0aXZlRGlyIH07XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1yZWxhdGl2ZT0nKSkge1xuICAgICAgY29uc3QgdmFsdWUgPSBhLnNsaWNlKCctLXJlbGF0aXZlPScubGVuZ3RoKTtcbiAgICAgIGlmIChyZXBvUm9vdCA9PT0gbnVsbCB8fCBoYXNTaGVsbEV4cGFuc2lvbih2YWx1ZSkgfHwgdmFsdWUgPT09ICcnKSByZXR1cm4gJ3VucmVzb2x2YWJsZSc7XG4gICAgICBjb25zdCBiYXNlID0gcmVzb2x2ZVBhdGgocmVwb1Jvb3QsIHZhbHVlKTtcbiAgICAgIHJldHVybiB7IGJhc2UsIHJvb3Q6IGJhc2UgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogUG9zdC1nYXRlZCBwaXBlbGluZSBzdGFnZXMgdGhhdCBwcm92YWJseSBvbmx5IHRydW5jYXRlLCByZW9yZGVyLCBvclxuICogZGVkdXBlIHRoZSBlYXJsaWVyIHN0YWdlJ3MgcmVjb3JkcyBcdTIwMTQgZWFjaCBzdXJ2aXZpbmcgbGluZSdzIGNvbnRlbnQgaXNcbiAqIGJ5dGUtdmVyYmF0aW0sIHNvIHRoZSBkZWNvZGVkIHNwYW5zIHN0YXkgZ2VudWluZS4gVGhlIHVuY29uZGl0aW9uYWxcbiAqIG1lbWJlcnMgb2YgdGhlIGNsb3NhYmxlIGFsbG93bGlzdCBmb3IgdGhlIGludmVydGVkIGRlZmF1bHQgb2ZcbiAqIGlzUmVudW1iZXJpbmdGaWx0ZXI7IHRoZSBjb25kaXRpb25hbCBjYXJ2ZS1vdXRzIChzZWQvYXdrL3BlcmwvdHIgd2l0aFxuICogYWxsb3dsaXN0ZWQgc2NyaXB0cykgYXJlIGhhbmRsZWQgYnkgdGhlaXIgb3duIHN0YWdlIGNoZWNrcyBiZWxvdy4gRXZlcnlcbiAqIGFsbG93bGlzdGVkIHN0YWdlIGlzIGFkZGl0aW9uYWxseSByZXF1aXJlZCB0byBjYXJyeSBubyBmaWxlIG9wZXJhbmRzXG4gKiAoaGFzRmlsZU9wZXJhbmQpIFx1MjAxNCBhIHRva2VuIHRoYXQgaXMgbm90IGEgZmxhZyBuYW1lcyBhIGZpbGUgdGhlIHN0YWdlXG4gKiByZWFkcyBpbnN0ZWFkIG9mIHRoZSBwaXBlLlxuICovXG5jb25zdCBWRVJCQVRJTV9QQVNTX0JJTlMgPSBuZXcgU2V0KFsnaGVhZCcsICd0YWlsJywgJ3djJywgJ3NvcnQnLCAndW5pcScsICdjdXQnXSk7XG5cbi8qKlxuICogV2hldGhlciBhIHBvc3QtZmlyc3QtZ2F0ZWQtc3RhZ2UgcGlwZWxpbmUgc3RhZ2UgcmVudW1iZXJzIG9yIHJlc3RydWN0dXJlc1xuICogdGhlIGVhcmxpZXIgc3RhZ2UncyByZWNvcmRzIHNvIHRoZSByZXNwb25zZSBubyBsb25nZXIgY2FycmllcyB0aGUgZmlsZVxuICogbGluZXMgdGhlIGdhdGVkIHN0YWdlIHByb2R1Y2VkLiBUaGUgREVGQVVMVCBJUyBJTlZFUlRFRCAoZmFpbCBjbG9zZWQpOlxuICogYSBzdGFnZSBpcyBhbGxvd2VkIG9ubHkgd2hlbiBpdCBpcyBwcm92YWJseSB2ZXJiYXRpbSBcdTIwMTQgcmVudW1iZXJpbmcgaXMgYVxuICogcHJvcGVydHkgb2YgdGhlIGJpbmFyeSwgYW5kIHRoZSByZW51bWJlcmVyIHNldCAocGVybCwgcHl0aG9uLCBydWJ5LCBtYXdrLFxuICogZ2F3aywgbmF3aywgdHIsIHBhc3RlLCBcdTIwMjYpIGlzIHVuYm91bmRlZCwgc28gYSBkZW55IGxpc3QgY2FuIG5ldmVyIGJlXG4gKiBjbG9zZWQgYW5kIGFueSBiaW4gb3V0c2lkZSB0aGUgYWxsb3dsaXN0IGlzIHRyZWF0ZWQgYXMgYSByZW51bWJlcmVyLlxuICogVGhlIGFsbG93bGlzdCBpcyBwaXBlbGluZS1zaGFwZSBvbmx5IChhIHJlbnVtYmVyZWQgcmVjb3JkIGlzIGJ5dGUtXG4gKiBpZGVudGljYWwgdG8gbGVnaXQgb3V0cHV0LCBzbyBjb250ZW50L3JlY29yZC1zaGFwZSBkaXNjcmltaW5hdGlvbiBpc1xuICogdW5zb3VuZCk6IGdyZXAvZWdyZXAvZmdyZXAvcmcgV0lUSE9VVCBudW1iZXJlZCBldmlkZW5jZVxuICogKGAtbmAvYC0tbGluZS1udW1iZXJgIFx1MjAxNCBhIHBsYWluIGZpbHRlciBwYXNzZXMgcmVjb3JkcyB0aHJvdWdoIHZlcmJhdGltKVxuICogYW5kIFdJVEhPVVQgZmlsZSBvcGVyYW5kcyBiZXlvbmQgdGhlIHBhdHRlcm4gc2xvdCwgcGxhaW4gYGNhdGAgKG5vXG4gKiBgLW5gL2AtLW51bWJlcmAsIG5vIGZpbGUgb3BlcmFuZHMpLCBoZWFkL3RhaWwvd2Mvc29ydC91bmlxL2N1dFxuICogKHRydW5jYXRlL3Jlb3JkZXIvZGVkdXBlLCBubyBmaWxlIG9wZXJhbmRzKSwgYW5kIGBzZWRgL2Bhd2tgL2BwZXJsYC9gdHJgXG4gKiB3aG9zZSBzY3JpcHQvcHJvZ3JhbSBwcm92YWJseSBwYXNzZXMgd2hvbGUgcmVjb3JkcyB0aHJvdWdoIGJ5dGUtdmVyYmF0aW1cbiAqIChpc1ZlcmJhdGltU2VkU3RhZ2UgLyBpc1ZlcmJhdGltQXdrU3RhZ2UgLyBpc1ZlcmJhdGltUGVybFN0YWdlIC9cbiAqIGlzVmVyYmF0aW1UclN0YWdlIFx1MjAxNCBudW1lcmljLWFkZHJlc3MgYHBgL2BxYC9gZGAgZm9ybXMsIGNvbmRpdGlvbi1vbmx5XG4gKiBOUi1jb21wYXJpc29uL3Bhcml0eSBwcm9ncmFtcywgc3RyZWFtLXBvc2l0aW9uIGBwcmludCBpZi91bmxlc3MgJC4gTiBkYFxuICogcGVybCBzY3JpcHRzLCBhbmQgZGlnaXQvY29sb24vbmV3bGluZS1mcmVlIGB0ciAtZGAgZGVsZXRpb25zIG91dHB1dCB0aGVcbiAqIHNhbWUgYnl0ZXMgdGhlIGVhcmxpZXIgc3RhZ2UgZW1pdHRlZCwgc28gdGhlIGRlY29kZWQgc3BhbnMgc3RheVxuICogZ2VudWluZSkuIEEgRklMRSBPUEVSQU5EIFx1MjAxNCBhIHRva2VuIHRoYXQgaXMgbm90IGEgZmxhZyBcdTIwMTQgbWFrZXMgdGhlIHN0YWdlXG4gKiByZWFkIHRoYXQgZmlsZSBpbnN0ZWFkIG9mIHRoZSBwaXBlOiB0aGUgcmVzcG9uc2UncyByZWNvcmRzIHRoZW4gY29tZVxuICogZnJvbSB0aGUgZmlsZSwgbm90IHRoZSBnYXRlZCBzdGFnZSwgYW5kIGEgY3JhZnRlZCByZWNvcmQgZGVjb2RlcyBhcyBhXG4gKiBwaGFudG9tIHRvdWNoLCBzbyBldmVyeSBhbGxvd2xpc3RlZCBiaW4gZmFpbHMgY2xvc2VkIG9uIGZpbGUgb3BlcmFuZHNcbiAqICh0aGUgc2NyaXB0ZWQgYmlucyBieSBhcmd2LXNoYXBlLCB0aGUgcmVzdCB2aWEgaGFzRmlsZU9wZXJhbmQpLiBgbmxgXG4gKiBhbHdheXMgcmVudW1iZXJzLlxuICovXG5mdW5jdGlvbiBpc1JlbnVtYmVyaW5nRmlsdGVyKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGNvbnN0IGJpbiA9IGFyZ3ZbMF07XG4gIGlmIChiaW4gPT09ICdubCcpIHJldHVybiB0cnVlO1xuICBpZiAoYmluID09PSAnc2VkJykgcmV0dXJuICFpc1ZlcmJhdGltU2VkU3RhZ2UoYXJndik7XG4gIGlmIChiaW4gPT09ICdhd2snKSByZXR1cm4gIWlzVmVyYmF0aW1Bd2tTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ3BlcmwnKSByZXR1cm4gIWlzVmVyYmF0aW1QZXJsU3RhZ2UoYXJndik7XG4gIGlmIChiaW4gPT09ICd0cicpIHJldHVybiAhaXNWZXJiYXRpbVRyU3RhZ2UoYXJndik7XG4gIGlmIChiaW4gPT09ICdjYXQnKSB7XG4gICAgaWYgKGFyZ3Yuc29tZSgoYSkgPT4gYSA9PT0gJy0tbnVtYmVyJyB8fCAoYS5zdGFydHNXaXRoKCctJykgJiYgIWEuc3RhcnRzV2l0aCgnLS0nKSAmJiBhLmluY2x1ZGVzKCduJykpKSlcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBoYXNGaWxlT3BlcmFuZChhcmd2KTtcbiAgfVxuICBpZiAoU0VBUkNIX0JJTlMuaGFzKGJpbikpIHtcbiAgICBpZiAoYXJndi5zb21lKChhKSA9PiBhID09PSAnLS1saW5lLW51bWJlcicgfHwgKGEuc3RhcnRzV2l0aCgnLScpICYmICFhLnN0YXJ0c1dpdGgoJy0tJykgJiYgYS5pbmNsdWRlcygnbicpKSkpXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gaGFzR3JlcEZpbGVPcGVyYW5kKGFyZ3YpO1xuICB9XG4gIC8vIFRoZSBpbnZlcnRlZCBkZWZhdWx0OiBhbnkgYmluIG91dHNpZGUgdGhlIGtub3duLXZlcmJhdGltIGFsbG93bGlzdFxuICAvLyAoaGVhZC90YWlsL3djL3NvcnQvdW5pcS9jdXQpIGZhaWxzIGNsb3NlZCBcdTIwMTQgYW5kIHRoZSBhbGxvd2xpc3QgYmluc1xuICAvLyB0aGVtc2VsdmVzIGZhaWwgY2xvc2VkIG9uIGZpbGUgb3BlcmFuZHMuXG4gIGlmIChWRVJCQVRJTV9QQVNTX0JJTlMuaGFzKGJpbikpIHJldHVybiBoYXNGaWxlT3BlcmFuZChhcmd2KTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogV2hldGhlciBhbnkgYXJndiB0b2tlbiBpcyBhIEZJTEUgT1BFUkFORCBmb3IgYSBzdGFnZSB0aGF0IG90aGVyd2lzZSByZWFkc1xuICogdGhlIHBpcGUuIEEgdG9rZW4gdGhhdCBpcyBub3QgYSBmbGFnIG5hbWVzIGEgZmlsZSAoYWZ0ZXIgdGhlIGAtLWBcbiAqIHRlcm1pbmF0b3IgZXZlcnkgdG9rZW4gaXMgYSBwb3NpdGlvbmFsLCBzaW5jZSBvcHRpb24gcGFyc2luZyBoYXMgZW5kZWQpO1xuICogYC1gIG5hbWVzIHN0ZGluLCB3aGljaCBpcyB0aGUgcGlwZSBpdHNlbGYsIGFuZCBgLS1gIGlzIG9ubHkgdGhlXG4gKiB0ZXJtaW5hdG9yIFx1MjAxNCBib3RoIHN0YXkgb3Blbi4gRXhhbXBsZTogYHJnIC1uIG5lZWRsZSBmIHwgaGVhZCAtMmAgY2Fycmllc1xuICogbm8gZmlsZSBvcGVyYW5kIGFuZCBwYXNzZXMgdmVyYmF0aW0sIGJ1dCBgcmcgLW4gbmVlZGxlIGYgfCBoZWFkIC0yXG4gKiBjcmFmdGVkLnR4dGAgcmVhZHMgY3JhZnRlZC50eHQgaW5zdGVhZCBvZiB0aGUgcGlwZSBcdTIwMTQgaXRzIHJlY29yZHMgYXJlIG5vdFxuICogdGhlIGdhdGVkIHN0YWdlJ3MsIHNvIHRoZSBwaXBlbGluZSBtdXN0IGZhaWwgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBoYXNGaWxlT3BlcmFuZChhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBsZXQgYWZ0ZXJUZXJtaW5hdG9yID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlclRlcm1pbmF0b3IgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLScpIGNvbnRpbnVlOyAvLyBzdGRpbiBcdTIwMTQgdGhlIHBpcGVcbiAgICBpZiAoYWZ0ZXJUZXJtaW5hdG9yIHx8ICFhLnN0YXJ0c1dpdGgoJy0nKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBncmVwLWZhbWlseSBzdGFnZSdzIGFyZ3YgbmFtZXMgYSBGSUxFIE9QRVJBTkQgXHUyMDE0IHRoZSBzdGFnZSB0aGVuXG4gKiByZWFkcyB0aGF0IGZpbGUgaW5zdGVhZCBvZiB0aGUgcGlwZS4gV2l0aG91dCBgLWVgL2AtZmAgdGhlIGZpcnN0XG4gKiBwb3NpdGlvbmFsIGlzIHRoZSBQQVRURVJOIChgcmcgbmVlZGxlYC9gZ3JlcCBuZWVkbGVgIGluIGEgcGlwZWxpbmUgcmVhZHNcbiAqIHN0ZGluIGFuZCBwYXNzZXMgcmVjb3JkcyB0aHJvdWdoIHZlcmJhdGltKSwgc28gYSBmaWxlIG9wZXJhbmQgaXMgYW55XG4gKiBwb3NpdGlvbmFsIEJFWU9ORCB0aGUgcGF0dGVybiBzbG90OyB3aXRoIHRoZSBwYXR0ZXJuIGNvbWluZyBmcm9tIGEgZmxhZ1xuICogdmFsdWUgKGAtZSBQQVRgLCBgLWYgUEFURklMRWAsIGAtLXJlZ2V4cGAsIGAtLWZpbGVgLCBnbHVlZCBgLWVQQVRgIC9cbiAqIGAtZlBBVEZJTEVgIC8gYC0tcmVnZXhwPVBBVGAgLyBgLS1maWxlPVBBVEZJTEVgKSBldmVyeSBwb3NpdGlvbmFsIGlzIGFcbiAqIGZpbGUuIFRoZSB2YWx1ZXMgY29uc3VtZWQgYnkgYC1lYC9gLWZgIGFuZCB0aGVpciBsb25nIGZvcm1zIGFyZSBwYXR0ZXJuXG4gKiBzb3VyY2VzIFx1MjAxNCBuZXZlciBmaWxlIG9wZXJhbmRzLlxuICovXG5mdW5jdGlvbiBoYXNHcmVwRmlsZU9wZXJhbmQoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgbGV0IHBhdHRlcm5Gcm9tRmxhZyA9IGZhbHNlO1xuICBsZXQgc2VlblBhdHRlcm4gPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIC8vIE9wdGlvbiBwYXJzaW5nIGVuZHM7IGV2ZXJ5IHJlbWFpbmluZyB0b2tlbiBpcyBhIHBvc2l0aW9uYWwuXG4gICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBhcmd2Lmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICghcGF0dGVybkZyb21GbGFnICYmICFzZWVuUGF0dGVybikgc2VlblBhdHRlcm4gPSB0cnVlO1xuICAgICAgICBlbHNlIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1lJyB8fCBhID09PSAnLWYnIHx8IGEgPT09ICctLXJlZ2V4cCcgfHwgYSA9PT0gJy0tZmlsZScpIHtcbiAgICAgIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7XG4gICAgICBpKys7IC8vIGNvbnN1bWUgdGhlIHZhbHVlIHRva2VuICh0aGUgcGF0dGVybiBvciB0aGUgcGF0dGVybiBmaWxlKVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLS0nKSkge1xuICAgICAgICBpZiAoYS5zdGFydHNXaXRoKCctLXJlZ2V4cD0nKSB8fCBhLnN0YXJ0c1dpdGgoJy0tZmlsZT0nKSkgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoYS5sZW5ndGggPiAyICYmIChhWzFdID09PSAnZScgfHwgYVsxXSA9PT0gJ2YnKSkge1xuICAgICAgICBwYXR0ZXJuRnJvbUZsYWcgPSB0cnVlOyAvLyBnbHVlZCBzaG9ydCB2YWx1ZSBmb3JtOiAtZVBBVCAvIC1mUEFURklMRVxuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghcGF0dGVybkZyb21GbGFnICYmICFzZWVuUGF0dGVybikgc2VlblBhdHRlcm4gPSB0cnVlO1xuICAgIGVsc2UgcmV0dXJuIHRydWU7IC8vIGEgcG9zaXRpb25hbCBiZXlvbmQgdGhlIHBhdHRlcm4gaXMgYSBmaWxlIG9wZXJhbmRcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciBgc2NyaXB0YCBwcm92YWJseSBwcmludHMgb3Igb21pdHMgd2hvbGUgaW5wdXQgcmVjb3JkcyBieXRlLVxuICogdmVyYmF0aW0gKG51bWVyaWMgYWRkcmVzc2VzIG9ubHkpLiBXaXRoIGAtbmAgKGF1dG8tcHJpbnQgc3VwcHJlc3NlZCkgdGhlXG4gKiBzY3JpcHQgbXVzdCBleHBsaWNpdGx5IHByaW50OiBgcGAgKHNpbmdsZSByZWNvcmQpLCBgLHBgIChhIHJlY29yZCByYW5nZSksXG4gKiBvciBgLCRwYCAoYSByZWNvcmQgdG8gdGhlIGVuZCkuIFdpdGhvdXQgYC1uYCB0aGUgZGVmYXVsdCBhdXRvLXByaW50IGtlZXBzXG4gKiByZWNvcmRzIHZlcmJhdGltLCBzbyBgcWAgKHF1aXQgYWZ0ZXIgYSByZWNvcmQgXHUyMDE0IGEgcHJlZml4IGN1dCkgYW5kIGBkYFxuICogKGRlbGV0ZSBhIHNpbmdsZSByZWNvcmQgXHUyMDE0IGEgc3Vic2V0IGN1dCkgcXVhbGlmeS4gUGF0dGVybiBhZGRyZXNzZXMgYW5kXG4gKiBhbnkgcmV3cml0ZSBjb21tYW5kIChgcy8vL2AsIGB5Ly8vYCwgYD1gLCBgYWAvYGlgL2BjYCkgY2hhbmdlIG9yIGluc2VydFxuICogcmVjb3JkIGNvbnRlbnQgYW5kIGFyZSBuZXZlciBhbGxvd2xpc3RlZC5cbiAqL1xuZnVuY3Rpb24gaXNWZXJiYXRpbVNlZFNjcmlwdChzY3JpcHQ6IHN0cmluZywgc3VwcHJlc3NBdXRvUHJpbnQ6IGJvb2xlYW4pOiBib29sZWFuIHtcbiAgaWYgKHN1cHByZXNzQXV0b1ByaW50KSB7XG4gICAgcmV0dXJuIC9eXFxkK3AkLy50ZXN0KHNjcmlwdCkgfHwgL15cXGQrLFxcZCtwJC8udGVzdChzY3JpcHQpIHx8IC9eXFxkKyxcXCRwJC8udGVzdChzY3JpcHQpO1xuICB9XG4gIHJldHVybiAvXlxcZCtxJC8udGVzdChzY3JpcHQpIHx8IC9eXFxkK2QkLy50ZXN0KHNjcmlwdCk7XG59XG5cbi8qKlxuICogV2hldGhlciBhIHBvc3QtZ2F0ZWQgYHNlZGAgc3RhZ2UncyB3aG9sZSBhcmd2IHByb3ZhYmx5IHBhc3NlcyB0aGUgZWFybGllclxuICogcmVjb3JkcyB0aHJvdWdoIGJ5dGUtdmVyYmF0aW0uIFRoZSBzY3JpcHQgbXVzdCBiZSB0aGUgZmlyc3Qgbm9uLWZsYWdcbiAqIHBvc2l0aW9uYWw7IG9ubHkgYC1uYCBtYXkgcHJlY2VkZSBpdCwgYW5kIGFueSBmdXJ0aGVyIHBvc2l0aW9uYWwgKGFcbiAqIHNlY29uZCBzY3JpcHQsIG9yIGZpbGUgYXJncyBcdTIwMTQgdGhlIHN0YWdlIHRoZW4gcmVhZHMgZmlsZXMsIG5vdCB0aGUgcGlwZSlcbiAqIGZhaWxzIGNsb3NlZC4gQW55IG90aGVyIGZsYWcgKGAtZWAsIGAtZmAsIGAtRWAsIGAtdWAsIGAtemAsIFx1MjAyNikgY2hhbmdlc1xuICogc2NyaXB0IHNlbWFudGljcyBvciByZWNvcmQgc2VwYXJhdGlvbiBhbmQgZmFpbHMgY2xvc2VkLiBgMSwyIWRgIGlzXG4gKiBkZWxpYmVyYXRlbHkgTk9UIGFsbG93bGlzdGVkIFx1MjAxNCBhIHJhbmdlLWNvbXBsZW1lbnQgZGVsZXRlIGhhcHBlbnMgdG9cbiAqIHByZXNlcnZlIHJlY29yZHMsIGJ1dCB0aGUgYWxsb3dsaXN0IGFkbWl0cyBvbmx5IHRoZSBwcm92YWJsZSBudW1lcmljXG4gKiBmb3Jtcywgc28gaXQgZmFpbHMgY2xvc2VkIGxpa2UgZXZlcnl0aGluZyBlbHNlLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltU2VkU3RhZ2UoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgbGV0IHNjcmlwdDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzdXBwcmVzc0F1dG9QcmludCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgc3VwcHJlc3NBdXRvUHJpbnQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoc2NyaXB0ICE9PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgc2NyaXB0ID0gYTtcbiAgfVxuICByZXR1cm4gc2NyaXB0ICE9PSBudWxsICYmIGlzVmVyYmF0aW1TZWRTY3JpcHQoc2NyaXB0LCBzdXBwcmVzc0F1dG9QcmludCk7XG59XG5cbi8qKlxuICogV2hldGhlciBhIHBvc3QtZ2F0ZWQgYGF3a2Agc3RhZ2UncyBwcm9ncmFtIHByb3ZhYmx5IHNlbGVjdHMgd2hvbGUgcmVjb3Jkc1xuICogd2l0aCB0aGUgZGVmYXVsdCBwcmludCBhY3Rpb24sIHNvIHRoZSBvdXRwdXQgYnl0ZXMgYXJlIHZlcmJhdGltLiBUaGVcbiAqIHByb2dyYW0gbXVzdCBiZSB0aGUgc29sZSBwb3NpdGlvbmFsIChubyBgLUZgL2AtdmAvYC1mYCBmbGFncywgbm8gZmlsZVxuICogYXJncykgYW5kIG1hdGNoIGEgY29uZGl0aW9uLW9ubHkgZm9ybTogYE5SIE9QIE5gIHdpdGggT1AgaW5cbiAqIHtgPGAsIGA8PWAsIGA+YCwgYD49YCwgYD09YCwgYCE9YH0gYWdhaW5zdCBkZWNpbWFsIGRpZ2l0cyAocmVjb3JkLW51bWJlclxuICogd2luZG93cyksIG9yIGBOUiAlIE4gPT0gTWAgLyBgTlIgJSBOICE9IE1gIChwYXJpdHkgc3Vic2V0cykuIE5PIGJyYWNlcyxcbiAqIE5PIGFjdGlvbnMsIE5PIGZpZWxkL3JlY29yZCByZWZlcmVuY2VzIChgJGApLCBOTyBgcHJpbnRgLCBOTyBgc3ViYC9cbiAqIGBnc3ViYCBcdTIwMTQgYW55IG9mIHRob3NlIHJld3JpdGVzIG9yIHJlbnVtYmVycyBhbmQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltQXdrU3RhZ2UoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKGFyZ3YubGVuZ3RoICE9PSAyKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHByb2dyYW0gPSBhcmd2WzFdO1xuICByZXR1cm4gL15OUlxccyooPD18Pj18PT18IT18PHw+KVxccypcXGQrJC8udGVzdChwcm9ncmFtKSB8fCAvXk5SXFxzKiVcXHMqXFxkK1xccyooPT18IT0pXFxzKlxcZCskLy50ZXN0KHByb2dyYW0pO1xufVxuXG4vKipcbiAqIFRoZSBzY3JpcHQgb2YgYSBwb3N0LWdhdGVkIGBwZXJsYCBzdGFnZSdzIGFyZ3Ygd2hlbiBpdHMgZm9ybSBpcyBleGFjdGx5XG4gKiBgcGVybCAtbmUgPHNjcmlwdD5gIG9yIGBwZXJsIC1uIC1lIDxzY3JpcHQ+YCBcdTIwMTQgbm90aGluZyBlbHNlLiBBbnkgb3RoZXJcbiAqIGZsYWcgKGAtcGAsIGAtYWAsIGAtRmAsIFx1MjAyNikgb3IgYW55IHBvc2l0aW9uYWwgYmV5b25kIHRoZSBzY3JpcHQgKGZpbGUgYXJnc1xuICogXHUyMDE0IHRoZSBzdGFnZSB0aGVuIHJlYWRzIGZpbGVzLCBub3QgdGhlIHBpcGUpIHJldHVybnMgbnVsbCBhbmQgZmFpbHNcbiAqIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gdmVyYmF0aW1QZXJsU2NyaXB0KGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChhcmd2Lmxlbmd0aCA9PT0gMyAmJiBhcmd2WzFdID09PSAnLW5lJykgcmV0dXJuIGFyZ3ZbMl07XG4gIGlmIChhcmd2Lmxlbmd0aCA9PT0gNCAmJiBhcmd2WzFdID09PSAnLW4nICYmIGFyZ3ZbMl0gPT09ICctZScpIHJldHVybiBhcmd2WzNdO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1nYXRlZCBgcGVybGAgc3RhZ2UgcHJvdmFibHkgcHJpbnRzIHdob2xlIGlucHV0IHJlY29yZHNcbiAqIGJ5dGUtdmVyYmF0aW0gKHN0cmVhbS1wb3NpdGlvbiBzZWxlY3Rpb24gb25seSkuIGAtbmAgd3JhcHMgdGhlIHNjcmlwdCBpblxuICogYSBsaW5lIGxvb3Agd2l0aG91dCBhdXRvLXByaW50aW5nLCBhbmQgdGhlIHNjcmlwdCBtdXN0IGJlIGEgYmFyZSBgcHJpbnRgXG4gKiBndWFyZGVkIGJ5IGEgc3RyZWFtLXBvc2l0aW9uIGNvbmRpdGlvbiAoYHByaW50IGlmICQuIDw9IDJgLCBgcHJpbnQgdW5sZXNzXG4gKiAkLiA+IDJgLCBgcHJpbnQgaWYgJC4gPT0gMmApIFx1MjAxNCBiYXJlIGBwcmludGAgZW1pdHMgYCRfYCB2ZXJiYXRpbSBpbmNsdWRpbmdcbiAqIGl0cyB0cmFpbGluZyBuZXdsaW5lLCBzbyByZWNvcmRzIHN0YXkgY29tcGxldGUgZm9yIHRoZSB0ZXJtaW5hdGluZy1uZXdsaW5lXG4gKiBydWxlIGFuZCB0aGVpciBwb3NpdGlvbnMgYXJlIGV4YWN0bHkgdGhlIGVhcmxpZXIgc3RhZ2UncyBmaWxlIGxpbmVzLlxuICogQW55dGhpbmcgZWxzZSBcdTIwMTQgaW5jbHVkaW5nIGBwcmludCBcIiQuOiRfXCJgIChyZW51bWJlcnMpLCBgLXBgLCBhbnkgb3RoZXJcbiAqIGV4cHJlc3Npb24sIGFueSBmaWxlIGFyZ3MgXHUyMDE0IGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gaXNWZXJiYXRpbVBlcmxTdGFnZShhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBzY3JpcHQgPSB2ZXJiYXRpbVBlcmxTY3JpcHQoYXJndik7XG4gIGlmIChzY3JpcHQgPT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIC9eXFxzKnByaW50XFxzKyg/OmlmfHVubGVzcylcXHMrXFwkXFwuXFxzKig8PXw+PXw9PXwhPXw8fD4pXFxzKlxcZCtcXHMqOz9cXHMqJC8udGVzdChzY3JpcHQpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBwb3N0LWdhdGVkIGB0cmAgc3RhZ2UgcHJvdmFibHkgZGVsZXRlcyBhIGNoYXJhY3RlciBzZXQgdGhhdFxuICogbGVhdmVzIHRoZSBlYXJsaWVyIHJlY29yZHMnIHNoYXBlIGFuZCBsaW5lIG51bWJlcnMgdW50b3VjaGVkLiBPbmx5IHRoZVxuICogZXhhY3QgYHRyIC1kIDxzZXQ+YCBmb3JtIHF1YWxpZmllcyAob25lIHNldCB0b2tlbiwgbm8gb3RoZXIgZmxhZ3MsIG5vXG4gKiBmaWxlIGFyZ3MpOyB0aGUgc2V0IG11c3QgY29udGFpbiBOT05FIG9mIGAwLTlgIChkZWxldGluZyBkaWdpdHNcbiAqIHJlbnVtYmVycyksIGA6YCAoZGVsZXRpbmcgY29sb25zIGRlc3Ryb3lzIHRoZSByZWNvcmQgc2hhcGUgXHUyMDE0IHRoaXMgYWxzb1xuICogYmxvY2tzIGBbOlx1MjAyNjpdYCBjbGFzcyBzeW50YXgpLCBvciB0aGUgYFxcbmAgZXNjYXBlIChkZWxldGluZyBuZXdsaW5lc1xuICogbWVyZ2VzIHJlY29yZHMpLiBBbGxvd2VkOiBgdHIgLWQgJ1xccidgICh0aGUgQ1JMRiBpZGlvbSksIGB0ciAtZCAnICdgLFxuICogYHRyIC1kICdcXHRcXHInYCwgYHRyIC1kICdhLXonYC4gQW55IHN1YnN0aXR1dGlvbiBmb3JtIChgdHIgJzEnICc5J2AgXHUyMDE0XG4gKiByZXdyaXRlcyBkaWdpdHMgaW5zaWRlIGxpbmUgbnVtYmVycyksIGAtc2AvYC1jYCwgb3IgYW55dGhpbmcgZWxzZSBmYWlsc1xuICogY2xvc2VkLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltVHJTdGFnZShhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAoYXJndi5sZW5ndGggIT09IDMgfHwgYXJndlsxXSAhPT0gJy1kJykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzZXQgPSBhcmd2WzJdO1xuICByZXR1cm4gIS9bMC05Ol0vLnRlc3Qoc2V0KSAmJiAhc2V0LmluY2x1ZGVzKCdcXFxcbicpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExheW91dCBkZXRlY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBsaW5lcyBvZiBgc3Rkb3V0YCB3aG9zZSB0ZXJtaW5hdGluZyBuZXdsaW5lIGlzIHByZXNlbnQgaW4gdGhlIHJlc3BvbnNlXG4gKiB0ZXh0LiBUaGUgZmluYWwgc3BsaXQgZWxlbWVudCBpcyBlaXRoZXIgdGhlIGVtcHR5IHN0cmluZyBsZWZ0IGJ5IGEgdHJhaWxpbmdcbiAqIG5ld2xpbmUgb3IgYW4gdW50ZXJtaW5hdGVkIHBhcnRpYWwgcmVjb3JkIFx1MjAxNCBlaXRoZXIgd2F5IGl0IGlzIG5vdCBhIHJlY29yZCxcbiAqIHNvIGl0IGlzIGFsd2F5cyBkcm9wcGVkICh0aGUgdW5pdmVyc2FsIHRydW5jYXRpb24gcnVsZSkuXG4gKi9cbmZ1bmN0aW9uIGNvbXBsZXRlTGluZXMoc3Rkb3V0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmVzID0gc3Rkb3V0LnNwbGl0KCdcXG4nKTtcbiAgbGluZXMucG9wKCk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGV2ZXJ5IG5vbi1lbXB0eSByZWNvcmQgb2YgYSBgbGluZTp0ZXh0YCByZXNwb25zZSBwYXJzZXMgYXNcbiAqIG51bWJlcmVkIFx1MjAxNCB0aGUgY3Jvc3MtcmVjb3JkIGNvbnNpc3RlbmN5IGNoZWNrIHRoYXQga2VlcHMgb25lLWZpbGVcbiAqIGF0dHJpYnV0aW9uIGZyb20gcmVzdGluZyBvbiBhIHNpbmdsZSByZWNvcmQncyBzaGFwZS4gQSBiYXJlIGAtLWAgbGluZSBpc1xuICogdGhlIGdyb3VwIHNlcGFyYXRvciBhIGNvbnRleHQgcnVuIChgLUFgL2AtQmAvYC1DYCkgZW1pdHMgYmV0d2VlblxuICogbm9uLWFkamFjZW50IHdpbmRvd3M6IGl0IGlzIG5vdCBhIHJlY29yZCBhbmQgY2FuIG5ldmVyIGJlY29tZSBhIHRvdWNoLCBzb1xuICogdG9sZXJhdGluZyBpdCBjYW5ub3QgZmFicmljYXRlIFx1MjAxNCB3aGlsZSByZWplY3RpbmcgaXQgc2VuZHMgdGhlIHdob2xlXG4gKiByZXNwb25zZSB0byBsYXlvdXQgbnVsbCAoemVybyBzcGFucykgYW5kLCB3b3JzZSwgbGV0cyBhIHRydW5jYXRlZCBwcmVmaXhcbiAqIGRlY29kZSByZWNvcmRzIHRoZSBjb21wbGV0ZSBvdXRwdXQgcmVmdXNlcyAoY3V0dGluZyBtdXN0IG5ldmVyIGFkZCkuXG4gKi9cbmZ1bmN0aW9uIHJlY29yZHNBcmVPbmVGaWxlKHN0ZG91dDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IGxpbmVzID0gY29tcGxldGVMaW5lcyhzdGRvdXQpO1xuICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBsaW5lcy5ldmVyeSgobGluZSkgPT4gbGluZSA9PT0gJycgfHwgbGluZSA9PT0gJy0tJyB8fCBwYXJzZU9uZUZpbGVSZWNvcmQobGluZSkgIT09IG51bGwpO1xufVxuXG4vKipcbiAqIERlY2lkZSB3aGljaCBzZWFyY2ggbGF5b3V0IGEgcmVzcG9uc2UgdXNlcyBmcm9tIHRoZSBzaGFwZSBvZiBpdHMgZmlyc3RcbiAqIHJlY29yZCwgY29uc3VsdGluZyB0aGUgY29tbWFuZCdzIGNvbnRleHQgZmxhZ3MgdG8gYnJlYWsgdGhlIHJlY3Vyc2l2ZSAvXG4gKiBjb250ZXh0IGFtYmlndWl0eSAoYm90aCBlbWl0IGBwYXRoOmxpbmU6dGV4dGAgbWF0Y2ggcmVjb3JkcykuIEZhaWwgY2xvc2VkOlxuICogYW4gdW5yZWNvZ25pemVkIGZpcnN0IHJlY29yZCBtZWFucyBub3RoaW5nIGluIHRoaXMgcmVzcG9uc2UgaXMgdHJ1c3RlZC5cbiAqXG4gKiBUaGUgYGxpbmU6dGV4dGAtb25seSBsYXlvdXRzIChvbmUtZmlsZSwgaGVhZGluZykgcmVxdWlyZSBjb21tYW5kLXNpZGVcbiAqIG51bWJlcmVkIGV2aWRlbmNlOiByZyBhbmQgZ3JlcCBkZWZhdWx0IHRvIE5PIGxpbmUgbnVtYmVycyB3aGVuIHBpcGVkLCBzbyBhXG4gKiBkaWdpdHMtbGVhZGluZyByZWNvcmQgd2l0aG91dCBgLW5gL2AtLWxpbmUtbnVtYmVyYCBpcyBjb250ZW50LCBub3QgYVxuICogcG9zaXRpb24gXHUyMDE0IGBncmVwIFRPRE8gbm90ZXMubWRgIHdob3NlIG1hdGNoaW5nIGxpbmUgaXMgYDEyMzogVE9ETyBpdGVtYFxuICogbXVzdCBub3QgdG91Y2ggbGluZSAxMjMsIGFuZCBgcmcgLWwgYWxwaGEgMjAyNC1sb2cudHh0YCBtdXN0IG5vdCB0b3VjaFxuICogbGluZSAyMDI0LiBUaGUgb25lLWZpbGUgbGF5b3V0IGFkZGl0aW9uYWxseSByZXF1aXJlcyBleGFjdGx5IG9uZSBleHBsaWNpdFxuICogZmlsZSBhcmd1bWVudCB0aGF0IGlzIGEgcmVhbCBmaWxlIChhIGRpcmVjdG9yeSBvciBubyBhcmdzIG1lYW5zIHJlY29yZHNcbiAqIGNhcnJ5IHBhdGggcHJlZml4ZXMgXHUyMDE0IGEgcHVyZS1kaWdpdHMgZmlsZW5hbWUgZW1pdHRlZCBmaXJzdCBtdXN0IGZhbGxcbiAqIHRocm91Z2ggdG8gcmVjdXJzaXZlKSwgbm8gYC1IYC9gLS13aXRoLWZpbGVuYW1lYCAod2hpY2ggZm9yY2VzIHBhdGhcbiAqIHByZWZpeGVzKSwgYW5kIGNyb3NzLXJlY29yZCBjb25zaXN0ZW5jeSB2aWEgYHJlY29yZHNBcmVPbmVGaWxlYC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0TGF5b3V0KHN0ZG91dDogc3RyaW5nLCBpbmZvOiBTZWFyY2hBcmd2SW5mbywgb25lRmlsZUVsaWdpYmxlOiBib29sZWFuKTogU2VhcmNoTGF5b3V0IHwgbnVsbCB7XG4gIGlmIChzdGRvdXQuaW5jbHVkZXMoJ1xcMCcpKSByZXR1cm4gJ251bGwtc2VwYXJhdGVkJztcbiAgY29uc3QgbGluZXMgPSBjb21wbGV0ZUxpbmVzKHN0ZG91dCk7XG4gIGNvbnN0IGZpcnN0ID0gbGluZXMuZmluZCgobGluZSkgPT4gbGluZSAhPT0gJycpO1xuICBpZiAoZmlyc3QgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGlmICgvXlxcZCtbLTpdLy50ZXN0KGZpcnN0KSkge1xuICAgIGlmIChvbmVGaWxlRWxpZ2libGUgJiYgcmVjb3Jkc0FyZU9uZUZpbGUoc3Rkb3V0KSkgcmV0dXJuICdvbmUtZmlsZSc7XG4gICAgLy8gTm90IHRoZSBvbmUtZmlsZSBsYXlvdXQ6IGZhbGwgdGhyb3VnaCBcdTIwMTQgYSBkaWdpdHMtbGVhZGluZyByZWNvcmQgaXNcbiAgICAvLyBtb3JlIHBsYXVzaWJseSB0aGUgYHBhdGg6bGluZTp0ZXh0YCByZWNvcmQgb2YgYSBkaWdpdHMtbmFtZWQgZmlsZSxcbiAgICAvLyB3aGljaCB0aGUgcmVjdXJzaXZlIGNoZWNrcyBiZWxvdyBwaWNrIHVwLlxuICB9XG4gIGlmICgvXlteOl0rOlxcZCsvLnRlc3QoZmlyc3QpKSByZXR1cm4gaW5mby5jb250ZXh0RmxhZ3MgPyAnY29udGV4dCcgOiAncmVjdXJzaXZlJztcbiAgLy8gQSBjb250ZXh0IHdpbmRvdyBjYW4gb3BlbiB3aXRoIGEgY29udGV4dCByZWNvcmQgKGl0cyAtQiBzaWRlKSwgd2hvc2VcbiAgLy8gYHBhdGgtbGluZS10ZXh0YCBzaGFwZSBpcyBhbWJpZ3VvdXMgd2hlbiB0aGUgcGF0aCBpdHNlbGYgY29udGFpbnMgYVxuICAvLyBkYXNoIFx1MjAxNCBgc3JjL215LWZpbGUudHMtMi1vbmVgIHNwbGl0cyBpbnNpZGUgdGhlIHBhdGguIEV2ZXJ5IGNvbnRleHRcbiAgLy8gZ3JvdXAgaXMgYW5jaG9yZWQgdG8gYSBgcGF0aDpsaW5lOnRleHRgIG1hdGNoIHJlY29yZCB3aG9zZSBjb2xvbiBzcGxpdFxuICAvLyBpcyB1bmFtYmlndW91cywgc28gdGhlIHJlc3BvbnNlJ3Mgb3duIG1hdGNoIHJlY29yZHMgZGV0ZWN0IHRoZSBsYXlvdXQuXG4gIGlmIChpbmZvLmNvbnRleHRGbGFncyAmJiBsaW5lcy5zb21lKChsaW5lKSA9PiBsaW5lICE9PSAnJyAmJiAvXlteOl0rOlxcZCsvLnRlc3QobGluZSkpKSByZXR1cm4gJ2NvbnRleHQnO1xuICBpZiAoL15bXi06XSstXFxkKy0vLnRlc3QoZmlyc3QpKSByZXR1cm4gaW5mby5jb250ZXh0RmxhZ3MgPyAnY29udGV4dCcgOiBudWxsO1xuICBpZiAoaW5mby5udW1iZXJlZCAmJiAvXlteOl0rJC8udGVzdChmaXJzdCkpIHJldHVybiAnaGVhZGluZyc7XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlY29yZCBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCBhIHJlY29yZCBvbiBpdHMgZmlyc3QgdHdvIG9jY3VycmVuY2VzIG9mIGBzZXBgICh0aGUgbGF5b3V0J3NcbiAqIHBhdGgvbGluZS90ZXh0IHNlcGFyYXRvcnMpLCBzbyBzZXBhcmF0b3JzIGluc2lkZSB0aGUgdGV4dCBhcmUgc2FmZS4gQSBwYXRoXG4gKiBjb250YWluaW5nIGEgY29sb24sIGEgbm9uLW51bWVyaWMgbGluZSB0b2tlbiwgb3IgYW4gZW1wdHkgcGF0aCBpc1xuICogcGF0aC1hbWJpZ3VvdXMgYW5kIGRyb3BwZWQuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUmVjb3JkKGxpbmU6IHN0cmluZywgc2VwOiBzdHJpbmcpOiB7IHBhdGg6IHN0cmluZzsgbGluZTogbnVtYmVyOyB0ZXh0OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCBmaXJzdCA9IGxpbmUuaW5kZXhPZihzZXApO1xuICBpZiAoZmlyc3QgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2Vjb25kID0gbGluZS5pbmRleE9mKHNlcCwgZmlyc3QgKyAxKTtcbiAgaWYgKHNlY29uZCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBjb25zdCBwYXRoID0gbGluZS5zbGljZSgwLCBmaXJzdCk7XG4gIGNvbnN0IGxpbmVUb2tlbiA9IGxpbmUuc2xpY2UoZmlyc3QgKyAxLCBzZWNvbmQpO1xuICBjb25zdCB0ZXh0ID0gbGluZS5zbGljZShzZWNvbmQgKyAxKTtcbiAgaWYgKHBhdGggPT09ICcnIHx8IHBhdGguaW5jbHVkZXMoJzonKSkgcmV0dXJuIG51bGw7XG4gIGlmICghL15cXGQrJC8udGVzdChsaW5lVG9rZW4pKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbGluZU51bWJlciA9IE51bWJlci5wYXJzZUludChsaW5lVG9rZW4sIDEwKTtcbiAgaWYgKGxpbmVOdW1iZXIgPD0gMCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHBhdGgsIGxpbmU6IGxpbmVOdW1iZXIsIHRleHQgfTtcbn1cblxuLyoqIE9uZSBudW1iZXJlZCByZWNvcmQgaW4gdGhlIG9uZS1maWxlL2hlYWRpbmcgYGxpbmU6dGV4dGAgb3IgYGxpbmUtdGV4dGAgc3R5bGUuICovXG5mdW5jdGlvbiBwYXJzZU9uZUZpbGVSZWNvcmQobGluZTogc3RyaW5nKTogeyBsaW5lOiBudW1iZXI7IHRleHQ6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IG0gPSAvXihcXGQrKShbOi1dKS8uZXhlYyhsaW5lKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgaWYgKGxpbmVOdW1iZXIgPD0gMCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IGxpbmU6IGxpbmVOdW1iZXIsIHRleHQ6IGxpbmUuc2xpY2UobVswXS5sZW5ndGgpIH07XG59XG5cbi8qKlxuICogRGVjb2RlIGEgY29udGV4dCByZWNvcmQgKGBwYXRoLWxpbmUtdGV4dGApIGJ5IGFuY2hvcmluZyBpdCB0byB0aGUgZXhhY3RcbiAqIHBhdGhzIHRoZSByZXNwb25zZSdzIGBwYXRoOmxpbmU6dGV4dGAgbWF0Y2ggcmVjb3JkcyBlc3RhYmxpc2hlZDogdGhlXG4gKiByZWNvcmQgbXVzdCBzdGFydCB3aXRoIGEga25vd24gcGF0aCBmb2xsb3dlZCBieSBgLWxpbmUtdGV4dGAuIExvbmdlc3QgcGF0aFxuICogZmlyc3QsIHNvIGEgcGF0aCB0aGF0IGlzIGEgcHJlZml4IG9mIGFub3RoZXIgKGBhLWIudHNgIHZzIGBhLWItYy50c2ApXG4gKiBjYW4ndCBzaGFkb3cgaXQuIEEgZGFzaCBpbnNpZGUgYSBwYXRoIG1ha2VzIHRoZSBwbGFpbiBkYXNoIHNwbGl0XG4gKiBhbWJpZ3VvdXMgKGBzcmMvbXktZmlsZS50cy00LWN0eGAgc3BsaXRzIGluc2lkZSB0aGUgcGF0aCBhbmQgaXRzIGxpbmVcbiAqIHRva2VuIGNvbWVzIG91dCBub24tbnVtZXJpYyksIHdoaWNoIGlzIHdoeSB0aGUga25vd24tcGF0aCBhbmNob3IgZXhpc3RzLlxuICovXG5mdW5jdGlvbiBwYXJzZUNvbnRleHRSZWNvcmQobGluZTogc3RyaW5nLCBrbm93blBhdGhzOiBzdHJpbmdbXSk6IHsgcGF0aDogc3RyaW5nOyBsaW5lOiBudW1iZXI7IHRleHQ6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGZvciAoY29uc3QgcGF0aCBvZiBrbm93blBhdGhzKSB7XG4gICAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoYCR7cGF0aH0tYCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHRhaWwgPSBsaW5lLnNsaWNlKHBhdGgubGVuZ3RoICsgMSk7XG4gICAgY29uc3QgbSA9IC9eKFxcZCspLS8uZXhlYyh0YWlsKTtcbiAgICBpZiAobSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgY29uc3QgbGluZU51bWJlciA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgaWYgKGxpbmVOdW1iZXIgPD0gMCkgY29udGludWU7XG4gICAgcmV0dXJuIHsgcGF0aCwgbGluZTogbGluZU51bWJlciwgdGV4dDogdGFpbC5zbGljZShtWzBdLmxlbmd0aCkgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIDEtYmFzZWQgbGluZSBjb3VudCBvZiByZXNwb25zZSB0ZXh0IHRoYXQgaG9sZHMgYW4gZW50aXJlIGZpbGUncyBjb250ZW50LiAqL1xuZnVuY3Rpb24gbGluZUNvdW50KHRleHQ6IHN0cmluZyk6IG51bWJlciB7XG4gIGlmICh0ZXh0ID09PSAnJykgcmV0dXJuIDA7XG4gIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSB0ZXh0LmVuZHNXaXRoKCdcXG4nKSA/IHRleHQuc2xpY2UoMCwgLTEpIDogdGV4dDtcbiAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMYXlvdXQgZGVjb2RlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIERlY29kZSBgc3Rkb3V0YCBpbnRvIHNlYXJjaCByZWNvcmRzIGZvciBgbGF5b3V0YC4gT25lLWZpbGUgcmVjb3JkcyBhcmVcbiAqIGF0dHJpYnV0ZWQgdG8gYHNpbmdsZUZpbGVBcmdgICh0aGUgY29tbWFuZCdzIHNvbGUgZXhwbGljaXQgZmlsZSk7IGZvciBhbnlcbiAqIG90aGVyIGxheW91dCB0aGUgcmVjb3JkIHBhdGhzIGFyZSB0aGUgcmVzcG9uc2UncyBvd24uIE51bGwtc2VwYXJhdGVkXG4gKiByZWNvcmRzIGNhcnJ5IGBsaW5lOiBudWxsYCBhbmQgdGhlIGZ1bGwgZmlsZSBjb250ZW50IGluIGB0ZXh0YCwgYmVjYXVzZSB0aGVcbiAqIG9ubHkgd2VsbC1kZWZpbmVkIHRvdWNoIGZvciBhIGBwYXRoOjE6XHUyMDI2YCByZWNvcmQgaG9sZGluZyBhbiBlbnRpcmUgZmlsZSBpc1xuICogdGhlIHdob2xlIGZpbGUuXG4gKi9cbmZ1bmN0aW9uIGRlY29kZVNlYXJjaExheW91dChsYXlvdXQ6IFNlYXJjaExheW91dCwgc3Rkb3V0OiBzdHJpbmcsIHNpbmdsZUZpbGVBcmc6IHN0cmluZyB8IG51bGwpOiBTZWFyY2hSZWNvcmRbXSB7XG4gIGNvbnN0IHJlY29yZHM6IFNlYXJjaFJlY29yZFtdID0gW107XG4gIHN3aXRjaCAobGF5b3V0KSB7XG4gICAgY2FzZSAncmVjdXJzaXZlJzpcbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBjb21wbGV0ZUxpbmVzKHN0ZG91dCkpIHtcbiAgICAgICAgY29uc3QgcmVjID0gcGFyc2VSZWNvcmQobGluZSwgJzonKTtcbiAgICAgICAgaWYgKHJlYyAhPT0gbnVsbCkgcmVjb3Jkcy5wdXNoKHJlYyk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdjb250ZXh0Jzoge1xuICAgICAgLy8gTWF0Y2ggcmVjb3JkcyBhcmUgYHBhdGg6bGluZTp0ZXh0YDsgY29udGV4dCByZWNvcmRzIGFyZVxuICAgICAgLy8gYHBhdGgtbGluZS10ZXh0YCAodGhlIHNlcGFyYXRvciBpcyBhIGRhc2ggd2hlcmV2ZXIgYSBtYXRjaCByZWNvcmRcbiAgICAgIC8vIHdvdWxkIHVzZSBhIGNvbG9uKS4gQm90aCBjYXJyeSB0aGUgcmVhbCBsaW5lIG51bWJlcjsgYC0tYCBncm91cFxuICAgICAgLy8gc2VwYXJhdG9ycyBhcmUgbm90IHJlY29yZHMuIEEgZGFzaCBpbnNpZGUgYSBwYXRoIGJyZWFrcyB0aGUgZGFzaFxuICAgICAgLy8gc3BsaXQsIHNvIHRoZSByZXNwb25zZSdzIG1hdGNoIHJlY29yZHMgZmlyc3QgZXN0YWJsaXNoIHRoZSBmaWxlcydcbiAgICAgIC8vIGV4YWN0IHBhdGhzIGFuZCBlYWNoIGNvbnRleHQgcmVjb3JkIGlzIGFuY2hvcmVkIHRvIGEga25vd24gcGF0aFxuICAgICAgLy8gcHJlZml4IGJlZm9yZSBpdHMgYC1saW5lLXRleHRgIHRhaWwsIHdpdGggdGhlIGRhc2gtZnJlZSBkZWZhdWx0IGFzXG4gICAgICAvLyB0aGUgZmFsbGJhY2suIENvbnRleHQgcmVjb3JkcyBjYW4gcHJlY2VkZSB0aGVpciBtYXRjaCAoLUIgd2luZG93cyksXG4gICAgICAvLyBzbyB0aGUga25vd24gc2V0IGlzIGJ1aWx0IGluIGEgZmlyc3QgcGFzcyBvdmVyIGFsbCBsaW5lcy5cbiAgICAgIGNvbnN0IGxpbmVzID0gY29tcGxldGVMaW5lcyhzdGRvdXQpO1xuICAgICAgY29uc3Qga25vd24gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICBpZiAobGluZSA9PT0gJy0tJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlUmVjb3JkKGxpbmUsICc6Jyk7XG4gICAgICAgIGlmIChyZWMgIT09IG51bGwpIGtub3duLmFkZChyZWMucGF0aCk7XG4gICAgICB9XG4gICAgICBjb25zdCBrbm93blNvcnRlZCA9IFsuLi5rbm93bl0uc29ydCgoYSwgYikgPT4gYi5sZW5ndGggLSBhLmxlbmd0aCk7XG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgaWYgKGxpbmUgPT09ICctLScpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCByZWMgPSBwYXJzZVJlY29yZChsaW5lLCAnOicpID8/IHBhcnNlQ29udGV4dFJlY29yZChsaW5lLCBrbm93blNvcnRlZCkgPz8gcGFyc2VSZWNvcmQobGluZSwgJy0nKTtcbiAgICAgICAgaWYgKHJlYyAhPT0gbnVsbCkgcmVjb3Jkcy5wdXNoKHJlYyk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnaGVhZGluZyc6XG4gICAgICAvLyBBIGZpbGUgaGVhZGVyIGxpbmUsIHRoZW4gYGxpbmU6dGV4dGAgcmVjb3JkczsgYmxhbmsgbGluZXMgc2VwYXJhdGVcbiAgICAgIC8vIGZpbGUgc2VjdGlvbnM7IGFueSBub24tcmVjb3JkIGxpbmUgc3RhcnRzIHRoZSBuZXh0IGZpbGUncyBzZWN0aW9uLlxuICAgICAge1xuICAgICAgICBsZXQgY3VycmVudDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBjb21wbGV0ZUxpbmVzKHN0ZG91dCkpIHtcbiAgICAgICAgICBpZiAobGluZSA9PT0gJycpIGNvbnRpbnVlO1xuICAgICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlT25lRmlsZVJlY29yZChsaW5lKTtcbiAgICAgICAgICBpZiAocmVjID09PSBudWxsKSB7XG4gICAgICAgICAgICBjdXJyZW50ID0gbGluZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGN1cnJlbnQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHJlY29yZHMucHVzaCh7IHBhdGg6IGN1cnJlbnQsIGxpbmU6IHJlYy5saW5lLCB0ZXh0OiByZWMudGV4dCB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ29uZS1maWxlJzpcbiAgICAgIGlmIChzaW5nbGVGaWxlQXJnICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBjb21wbGV0ZUxpbmVzKHN0ZG91dCkpIHtcbiAgICAgICAgICBjb25zdCByZWMgPSBwYXJzZU9uZUZpbGVSZWNvcmQobGluZSk7XG4gICAgICAgICAgaWYgKHJlYyAhPT0gbnVsbCkgcmVjb3Jkcy5wdXNoKHsgcGF0aDogc2luZ2xlRmlsZUFyZywgbGluZTogcmVjLmxpbmUsIHRleHQ6IHJlYy50ZXh0IH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdudWxsLXNlcGFyYXRlZCc6XG4gICAgICAvLyBgZ3JlcCAtemA6IGVhY2ggbWF0Y2hpbmcgZmlsZSBhcnJpdmVzIGFzIG9uZSBOVUwtdGVybWluYXRlZFxuICAgICAgLy8gYHBhdGg6MTo8ZW50aXJlIGZpbGUgY29udGVudD5gIHJlY29yZC4gVGhlIHJlY29yZCBpcyBmdWxseSBvYnNlcnZlZFxuICAgICAgLy8gb25seSB3aGVuIGl0cyB0ZXJtaW5hdGluZyBOVUwgaXMgcHJlc2VudC5cbiAgICAgIHtcbiAgICAgICAgY29uc3QgcGFydHMgPSBzdGRvdXQuc3BsaXQoJ1xcMCcpO1xuICAgICAgICBpZiAoIXN0ZG91dC5lbmRzV2l0aCgnXFwwJykpIHBhcnRzLnBvcCgpO1xuICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgICBpZiAocGFydCA9PT0gJycpIGNvbnRpbnVlO1xuICAgICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlUmVjb3JkKHBhcnQsICc6Jyk7XG4gICAgICAgICAgaWYgKHJlYyA9PT0gbnVsbCB8fCByZWMubGluZSAhPT0gMSkgY29udGludWU7XG4gICAgICAgICAgcmVjb3Jkcy5wdXNoKHsgcGF0aDogcmVjLnBhdGgsIGxpbmU6IG51bGwsIHRleHQ6IHJlYy50ZXh0IH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgfVxuICByZXR1cm4gcmVjb3Jkcztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTY29wZSByZXN0cmljdGlvbiBhbmQgY29hbGVzY2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGBhYnNgIHJlc29sdmVzIGluc2lkZSBvbmUgb2YgdGhlIHBlcm1pdHRlZCByb290cyAocGF0aC1wcmVmaXggY29udGFpbm1lbnQpLiAqL1xuZnVuY3Rpb24gaW5zaWRlUm9vdChhYnM6IHN0cmluZywgcm9vdHM6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3Qgcm9vdCBvZiByb290cykge1xuICAgIGlmIChhYnMgPT09IHJvb3QgfHwgYWJzLnN0YXJ0c1dpdGgocm9vdCArIHNlcCkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFdoZXRoZXIgYGFic2AgaXMgYW4gZXhpc3RpbmcgcmVndWxhciBmaWxlIChmb2xsb3dpbmcgc3ltbGlua3MpLiAqL1xuZnVuY3Rpb24gaXNGaWxlKGFiczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHN0YXRTeW5jKGFicykuaXNGaWxlKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgd29ya3RyZWUgcm9vdCBjb250YWluaW5nIGBzdGFydERpcmAsIGZvdW5kIGJ5IHdhbGtpbmcgdXAgZm9yIHRoZVxuICogZmlyc3QgZGlyZWN0b3J5IGhvbGRpbmcgYSBgLmdpdGAgZW50cnkgXHUyMDE0IGEgZGlyZWN0b3J5IGluIGEgcmVndWxhciByZXBvLCBhXG4gKiBgZ2l0ZGlyOmAgZmlsZSBpbiBhIGxpbmtlZCB3b3JrdHJlZSBvciBzdWJtb2R1bGUuIERpZmYtZm9ybSBvdXRwdXQgcGF0aHNcbiAqIGFyZSByZXBvLXJvb3QtcmVsYXRpdmUgcmVnYXJkbGVzcyBvZiBjd2QsIHNvIGRpZmYgZGVjb2RlIHJlc29sdmVzIGFnYWluc3RcbiAqIHRoaXMgcm9vdCByYXRoZXIgdGhhbiB0aGUgZWZmZWN0aXZlIGRpcjsgc2VhcmNoLWxheW91dCBwYXRocyBhcmVcbiAqIGN3ZC1yZWxhdGl2ZSBhbmQgc3RheSBhbmNob3JlZCB0byB0aGUgZWZmZWN0aXZlIGRpci4gTm8gc3VicHJvY2VzcyBcdTIwMTQgdGhlXG4gKiBjb21tb24gbGF5ZXIgaW1wb3J0cyBvbmx5IG5vZGU6IGJ1aWx0aW5zLiBOdWxsIHdoZW4gYHN0YXJ0RGlyYCBpcyBub3RcbiAqIGluc2lkZSBhbnkgd29ya3RyZWU7IGRpZmYgb3V0cHV0IGlzIHRoZW4gc3VzcGVjdCBhbmQgdGhlIHBhcnNlIGZhaWxzXG4gKiBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGZpbmRHaXRSb290KHN0YXJ0RGlyOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgbGV0IGRpciA9IHN0YXJ0RGlyO1xuICBmb3IgKDs7KSB7XG4gICAgaWYgKGV4aXN0c1N5bmMoam9pbihkaXIsICcuZ2l0JykpKSByZXR1cm4gZGlyO1xuICAgIGNvbnN0IHBhcmVudCA9IGRpcm5hbWUoZGlyKTtcbiAgICBpZiAocGFyZW50ID09PSBkaXIpIHJldHVybiBudWxsO1xuICAgIGRpciA9IHBhcmVudDtcbiAgfVxufVxuXG4vKipcbiAqIE9yZGVyIHNwYW5zIGRldGVybWluaXN0aWNhbGx5IGFuZCBjYXAgdGhlIGNvdW50IChmYWlsLWNsb3NlZCBiZXlvbmRcbiAqIGBNQVhfUkVTUE9OU0VfU1BBTlNgKTogdGhlIGZpcnN0IDUwIHNwYW5zIGluIHBhdGggb3JkZXIgYXJlIGVtaXR0ZWQsIHRoZVxuICogcmVzdCBhcmUgZHJvcHBlZC4gTm9ybWFsIHBhcnNlcyBrZWVwIHRoZWlyIGVtaXNzaW9uIG9yZGVyIFx1MjAxNCB0aGUgc29ydCBvbmx5XG4gKiBlbmdhZ2VzIHdoZW4gdGhlIGNhcCBiaW5kcy5cbiAqL1xuZnVuY3Rpb24gY2FwU3BhbnMoc3BhbnM6IFJlc29sdmVkU3BhbltdKTogUmVzb2x2ZWRTcGFuW10ge1xuICBpZiAoc3BhbnMubGVuZ3RoIDw9IE1BWF9SRVNQT05TRV9TUEFOUykgcmV0dXJuIHNwYW5zO1xuICBjb25zdCBvcmRlcmVkID0gWy4uLnNwYW5zXS5zb3J0KFxuICAgIChhLCBiKSA9PiBhLmFic29sdXRlUGF0aC5sb2NhbGVDb21wYXJlKGIuYWJzb2x1dGVQYXRoKSB8fCBhLmxpbmVTdGFydCAtIGIubGluZVN0YXJ0IHx8IGEubGluZUVuZCAtIGIubGluZUVuZFxuICApO1xuICByZXR1cm4gb3JkZXJlZC5zbGljZSgwLCBNQVhfUkVTUE9OU0VfU1BBTlMpO1xufVxuXG4vKipcbiAqIENvYWxlc2NlIHBlci1maWxlIGxpbmUgbnVtYmVycyBpbnRvIGNvbnRpZ3VvdXMgcmFuZ2VzOyBhZGphY2VudCBhbmRcbiAqIG92ZXJsYXBwaW5nIGxpbmVzIG1lcmdlLCBhbmQgZHVwbGljYXRlcyBuZXZlciBjcmVhdGUgZHVwbGljYXRlIHN1cmZhY2VzLlxuICovXG5mdW5jdGlvbiBjb2FsZXNjZShsaW5lczogbnVtYmVyW10pOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiB7XG4gIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3Qgc29ydGVkID0gWy4uLmxpbmVzXS5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG4gIGNvbnN0IHJhbmdlczogQXJyYXk8W251bWJlciwgbnVtYmVyXT4gPSBbXTtcbiAgbGV0IHN0YXJ0ID0gc29ydGVkWzBdO1xuICBsZXQgZW5kID0gc29ydGVkWzBdO1xuICBmb3IgKGNvbnN0IG4gb2Ygc29ydGVkLnNsaWNlKDEpKSB7XG4gICAgaWYgKG4gPD0gZW5kICsgMSkge1xuICAgICAgaWYgKG4gPiBlbmQpIGVuZCA9IG47XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlcy5wdXNoKFtzdGFydCwgZW5kXSk7XG4gICAgICBzdGFydCA9IG47XG4gICAgICBlbmQgPSBuO1xuICAgIH1cbiAgfVxuICByYW5nZXMucHVzaChbc3RhcnQsIGVuZF0pO1xuICByZXR1cm4gcmFuZ2VzO1xufVxuXG4vKipcbiAqIFJlc29sdmUgcGVyLWZpbGUgbGluZSBzZXRzIGludG8gc3BhbnM6IHBhdGhzIHJlc29sdmUgYWdhaW5zdCBgYmFzZURpcmAsXG4gKiBtdXN0IHNpdCBpbnNpZGUgb25lIG9mIHRoZSBwZXJtaXR0ZWQgYHJvb3RzYCAoYSB0cmF2ZXJzYWwgcGF0aCBub3JtYWxpemVzXG4gKiBvdXRzaWRlIHRoZW0gYW5kIGlzIHJlamVjdGVkKSwgYW5kIHRoZWlyIGxpbmVzIGNvYWxlc2NlIGludG8gY29udGlndW91c1xuICogcmFuZ2VzLlxuICovXG5mdW5jdGlvbiBzcGFuc0ZvcihwZXJGaWxlOiBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4sIGJhc2VEaXI6IHN0cmluZywgcm9vdHM6IHN0cmluZ1tdKTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBzcGFuczogUmVzb2x2ZWRTcGFuW10gPSBbXTtcbiAgZm9yIChjb25zdCBbcGF0aCwgbGluZXNdIG9mIHBlckZpbGUpIHtcbiAgICBjb25zdCBhYnMgPSByZXNvbHZlUGF0aChiYXNlRGlyLCBwYXRoKTtcbiAgICBpZiAoIWluc2lkZVJvb3QoYWJzLCByb290cykpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgW2xpbmVTdGFydCwgbGluZUVuZF0gb2YgY29hbGVzY2UoWy4uLmxpbmVzXSkpIHtcbiAgICAgIHNwYW5zLnB1c2goeyBsaW5lU3RhcnQsIGxpbmVFbmQsIGFic29sdXRlUGF0aDogYWJzIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVW5pZmllZC1kaWZmIGRlY29kZXIgKGBnaXQgZGlmZmAsIGRpZmYtZm9ybSBgZ2l0IHNob3dgLCBgZ2l0IGxvZyAtcGApXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBBIHVuaWZpZWQtZGlmZiBodW5rIGhlYWRlcjogYEBAIC1hWyxiXSArY1ssZF0gQEBgOyBvbWl0dGVkIGNvdW50cyBtZWFuIDEuXG4gKiBBIGN1dC1vZmYgaGVhZGVyIChtaXNzaW5nIHRoZSBjbG9zaW5nIGBAQGApIGRvZXMgbm90IG1hdGNoIGFuZCBpdHMgaHVuayBpc1xuICogaWdub3JlZC4gQ29tYmluZWQtZGlmZiBgQEBAYCBoZWFkZXJzIGRvIG5vdCBtYXRjaCAodGhlaXIgcmVjb3JkcyBhcmVcbiAqIHJlamVjdGVkIGF0IHRoZSBgZGlmZiAtLWNjYCBsaW5lIGFueXdheSkuXG4gKi9cbmNvbnN0IEhVTktfSEVBREVSID0gL15AQCAtKFxcZCspKD86LChcXGQrKSk/IFxcKyhcXGQrKSg/OiwoXFxkKykpPyBAQC87XG5cbi8qKiBTdHJpcCB0aGUgYGEvYC9gYi9gIHByZWZpeCBhIHVuaWZpZWQtZGlmZiBwYXRoIGNhcnJpZXMuICovXG5mdW5jdGlvbiBzdHJpcERpZmZQcmVmaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnYS8nKSB8fCBwLnN0YXJ0c1dpdGgoJ2IvJykgPyBwLnNsaWNlKDIpIDogcDtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIGBkaWZmIC0tZ2l0IGEvb2xkIGIvbmV3YCBmaWxlIGhlYWRlciwgYGRpZmYgLS1jY2AvYC0tY29tYmluZWRgXG4gKiAoYSByZWFsIG1lcmdlLWNvbmZsaWN0IGNvbWJpbmVkIGRpZmY6IG5vIHJhbmdlcyksIG9yIHJldHVybiBudWxsIGZvclxuICogbm9uLWhlYWRlciBsaW5lcy4gQSBoZWFkZXIgd2hvc2UgcGF0aHMgYXJlIHF1b3RlZCBpcyB1bnBhcnNlYWJsZSBcdTIwMTQgdGhlXG4gKiBwbGFuJ3MgZmFpbC1jbG9zZWQgcnVsZSBmb3IgcXVvdGVkL3VuZXNjYXBhYmxlIHBhdGhzLlxuICovXG5mdW5jdGlvbiBwYXJzZURpZmZIZWFkZXIoXG4gIGxpbmU6IHN0cmluZ1xuKTpcbiAgfCB7IGtpbmQ6ICdmaWxlJzsgb2xkUGF0aDogc3RyaW5nIHwgbnVsbDsgbmV3UGF0aDogc3RyaW5nIHwgbnVsbCB9XG4gIHwgeyBraW5kOiAnY29tYmluZWQnIH1cbiAgfCB7IGtpbmQ6ICd1bnBhcnNlYWJsZScgfVxuICB8IG51bGwge1xuICBpZiAobGluZS5zdGFydHNXaXRoKCdkaWZmIC0tY2MgJykgfHwgbGluZS5zdGFydHNXaXRoKCdkaWZmIC0tY29tYmluZWQgJykpIHJldHVybiB7IGtpbmQ6ICdjb21iaW5lZCcgfTtcbiAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoJ2RpZmYgLS1naXQgJykpIHJldHVybiBudWxsO1xuICBjb25zdCB0b2tlbnMgPSBsaW5lLnNsaWNlKCdkaWZmIC0tZ2l0ICcubGVuZ3RoKS50cmltKCkuc3BsaXQoL1xccysvKTtcbiAgaWYgKHRva2Vucy5sZW5ndGggIT09IDIgfHwgdG9rZW5zWzBdLnN0YXJ0c1dpdGgoJ1wiJykgfHwgdG9rZW5zWzFdLnN0YXJ0c1dpdGgoJ1wiJykpIHJldHVybiB7IGtpbmQ6ICd1bnBhcnNlYWJsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ2ZpbGUnLCBvbGRQYXRoOiBzdHJpcERpZmZQcmVmaXgodG9rZW5zWzBdKSwgbmV3UGF0aDogc3RyaXBEaWZmUHJlZml4KHRva2Vuc1sxXSkgfTtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIGAtLS0gYS9wYXRoYCAvIGArKysgYi9wYXRoYCBzaWRlIGxpbmUuIGAvZGV2L251bGxgIG1lYW5zIHRoZSBzaWRlXG4gKiBkb2VzIG5vdCBleGlzdCAobmV3LWZpbGUgLyBkZWxldGlvbiBzaWRlcykuIEEgcXVvdGVkIHBhdGggaXMgdW5wYXJzZWFibGUuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlRGlmZlNpZGUoXG4gIGxpbmU6IHN0cmluZyxcbiAgbWFya2VyOiAnLS0tJyB8ICcrKysnXG4pOiB7IGtpbmQ6ICdzaWRlJzsgcGF0aDogc3RyaW5nIHwgbnVsbCB9IHwgeyBraW5kOiAndW5wYXJzZWFibGUnIH0gfCBudWxsIHtcbiAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoYCR7bWFya2VyfSBgKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHAgPSBsaW5lLnNsaWNlKG1hcmtlci5sZW5ndGggKyAxKTtcbiAgaWYgKHAuc3RhcnRzV2l0aCgnXCInKSkgcmV0dXJuIHsga2luZDogJ3VucGFyc2VhYmxlJyB9O1xuICByZXR1cm4geyBraW5kOiAnc2lkZScsIHBhdGg6IHAgPT09ICcvZGV2L251bGwnID8gbnVsbCA6IHN0cmlwRGlmZlByZWZpeChwKSB9O1xufVxuXG4vKiogT25lIGZpbGUgc2VjdGlvbiBvZiBhIHJlc3BvbnNlLCBpbiB0aGUgZGVjb2RlcidzIHdvcmtpbmcgc3RhdGUuICovXG5pbnRlcmZhY2UgRGlmZlJlY29yZFN0YXRlIHtcbiAgb2xkUGF0aDogc3RyaW5nIHwgbnVsbDtcbiAgbmV3UGF0aDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIFJlbmFtZS9jb3B5IG1ldGFkYXRhIHByZXNlbnQgKGByZW5hbWUgZnJvbWAvYHJlbmFtZSB0b2AsIGBjb3B5IGZyb21gL2Bjb3B5IHRvYCk6IHRoZSBuZXcgcGF0aCBpcyB0aGUgb25seSB0b3VjaCB0YXJnZXQuICovXG4gIHJlbmFtZTogYm9vbGVhbjtcbiAgYmluYXJ5OiBib29sZWFuO1xuICBjb21iaW5lZDogYm9vbGVhbjtcbiAgc3VibW9kdWxlOiBib29sZWFuO1xuICAvKiogQSBxdW90ZWQvdW5lc2NhcGFibGUgcGF0aDogdGhlIHJlY29yZCBwcm9kdWNlcyBubyByYW5nZS4gKi9cbiAgdW51c2FibGU6IGJvb2xlYW47XG4gIC8qKiBBIGh1bmsgaGVhZGVyIGhhcyBiZWVuIHNlZW46IGxhdGVyIGAtLS1gL2ArKytgLWxvb2tpbmcgbGluZXMgYXJlIGh1bmsgYm9keSBsaW5lcywgbm90IHNpZGUgaGVhZGVycy4gKi9cbiAgc2F3SHVuazogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBEZWNvZGUgYSB1bmlmaWVkLWRpZmYgcmVzcG9uc2UgaW50byBwZXItcGF0aCBsaW5lIHNldHMuIE9ubHkgaHVuayBoZWFkZXJzXG4gKiBjYXJyeSBwb3NpdGlvbmFsIGRhdGEgXHUyMDE0IGJvZHkgbGluZXMgYXJlIGlnbm9yZWQgXHUyMDE0IGFuZCBlYWNoIGhlYWRlcidzIHNpZGVcbiAqIHJhbmdlcyBhdHRhY2ggdG8gaXRzIHNpZGUncyBwYXRoIChgL2Rldi9udWxsYCBzaWRlcyBoYXZlIG5vIHBhdGgpLlxuICogQmluYXJ5LCBjb21iaW5lZCwgc3VibW9kdWxlLCBhbmQgdW5wYXJzZWFibGUgcmVjb3JkcyBlbWl0IG5vdGhpbmc7XG4gKiByZW5hbWUvY29weSByZWNvcmRzIGVtaXQgdGhlIG5ldyBzaWRlIG9ubHkuIGBpbmRleGAgbGluZXMgYW5kXG4gKiBgXFwgTm8gbmV3bGluZSBhdCBlbmQgb2YgZmlsZWAgbWFya2VycyBhcmUgbWV0YWRhdGEgYW5kIGZhbGwgdGhyb3VnaC4gVGhlXG4gKiB1bml2ZXJzYWwgdGVybWluYXRpbmctbmV3bGluZSBydWxlIGFwcGxpZXMgdmlhIGNvbXBsZXRlTGluZXMuXG4gKi9cbmZ1bmN0aW9uIGRlY29kZVVuaWZpZWREaWZmKHN0ZG91dDogc3RyaW5nKTogTWFwPHN0cmluZywgU2V0PG51bWJlcj4+IHtcbiAgY29uc3QgcGVyRmlsZSA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4oKTtcbiAgbGV0IGN1cnJlbnQ6IERpZmZSZWNvcmRTdGF0ZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGxpbmUgb2YgY29tcGxldGVMaW5lcyhzdGRvdXQpKSB7XG4gICAgY29uc3QgaGVhZGVyID0gcGFyc2VEaWZmSGVhZGVyKGxpbmUpO1xuICAgIGlmIChoZWFkZXIgIT09IG51bGwpIHtcbiAgICAgIGN1cnJlbnQgPSB7XG4gICAgICAgIG9sZFBhdGg6IGhlYWRlci5raW5kID09PSAnZmlsZScgPyBoZWFkZXIub2xkUGF0aCA6IG51bGwsXG4gICAgICAgIG5ld1BhdGg6IGhlYWRlci5raW5kID09PSAnZmlsZScgPyBoZWFkZXIubmV3UGF0aCA6IG51bGwsXG4gICAgICAgIHJlbmFtZTogZmFsc2UsXG4gICAgICAgIGJpbmFyeTogZmFsc2UsXG4gICAgICAgIGNvbWJpbmVkOiBoZWFkZXIua2luZCA9PT0gJ2NvbWJpbmVkJyxcbiAgICAgICAgc3VibW9kdWxlOiBmYWxzZSxcbiAgICAgICAgdW51c2FibGU6IGhlYWRlci5raW5kID09PSAndW5wYXJzZWFibGUnLFxuICAgICAgICBzYXdIdW5rOiBmYWxzZVxuICAgICAgfTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnQmluYXJ5IGZpbGVzICcpKSB7XG4gICAgICBjdXJyZW50LmJpbmFyeSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gU3VibW9kdWxlIG1hcmtlcnM6IGEgYG1vZGUgMTYwMDAwYCBtZXRhZGF0YSBsaW5lLCBvciBgU3VicHJvamVjdFxuICAgIC8vIGNvbW1pdGAgbGluZXMgKHRoZWlyIG93biArLy0gYm9keSBsaW5lcykuIFRoZSBtb2RlIGNoZWNrIGV4Y2x1ZGVzXG4gICAgLy8gaHVuayBib2R5IGxpbmVzIHNvIGZpbGUgY29udGVudCB0aGF0IG1lbnRpb25zIHRoZSBtb2RlIGNhbid0IHJlamVjdFxuICAgIC8vIGEgcmVhbCByZWNvcmQuXG4gICAgY29uc3QgaXNCb2R5TGluZSA9IGxpbmUuc3RhcnRzV2l0aCgnICcpIHx8IGxpbmUuc3RhcnRzV2l0aCgnKycpIHx8IGxpbmUuc3RhcnRzV2l0aCgnLScpIHx8IGxpbmUuc3RhcnRzV2l0aCgnXFxcXCcpO1xuICAgIGlmICghaXNCb2R5TGluZSAmJiBsaW5lLmluY2x1ZGVzKCdtb2RlIDE2MDAwMCcpKSB7XG4gICAgICBjdXJyZW50LnN1Ym1vZHVsZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuaW5jbHVkZXMoJ1N1YnByb2plY3QgY29tbWl0JykpIHtcbiAgICAgIGN1cnJlbnQuc3VibW9kdWxlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSBmcm9tICcpIHx8XG4gICAgICBsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSB0byAnKSB8fFxuICAgICAgbGluZS5zdGFydHNXaXRoKCdjb3B5IGZyb20gJykgfHxcbiAgICAgIGxpbmUuc3RhcnRzV2l0aCgnY29weSB0byAnKVxuICAgICkge1xuICAgICAgY3VycmVudC5yZW5hbWUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghY3VycmVudC5zYXdIdW5rKSB7XG4gICAgICBjb25zdCBvbGRTaWRlID0gcGFyc2VEaWZmU2lkZShsaW5lLCAnLS0tJyk7XG4gICAgICBpZiAob2xkU2lkZSAhPT0gbnVsbCkge1xuICAgICAgICBpZiAob2xkU2lkZS5raW5kID09PSAndW5wYXJzZWFibGUnKSBjdXJyZW50LnVudXNhYmxlID0gdHJ1ZTtcbiAgICAgICAgZWxzZSBjdXJyZW50Lm9sZFBhdGggPSBvbGRTaWRlLnBhdGg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgbmV3U2lkZSA9IHBhcnNlRGlmZlNpZGUobGluZSwgJysrKycpO1xuICAgICAgaWYgKG5ld1NpZGUgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKG5ld1NpZGUua2luZCA9PT0gJ3VucGFyc2VhYmxlJykgY3VycmVudC51bnVzYWJsZSA9IHRydWU7XG4gICAgICAgIGVsc2UgY3VycmVudC5uZXdQYXRoID0gbmV3U2lkZS5wYXRoO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgaHVuayA9IEhVTktfSEVBREVSLmV4ZWMobGluZSk7XG4gICAgaWYgKGh1bmsgIT09IG51bGwpIHtcbiAgICAgIGN1cnJlbnQuc2F3SHVuayA9IHRydWU7XG4gICAgICBlbWl0SHVua1JhbmdlKHBlckZpbGUsIGN1cnJlbnQsIGh1bmspO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGVyRmlsZTtcbn1cblxuLyoqIEF0dHJpYnV0ZSBvbmUgaHVuayBoZWFkZXIncyBwZXItc2lkZSByYW5nZXMgdG8gaXRzIHJlY29yZCdzIHBhdGhzLiAqL1xuZnVuY3Rpb24gZW1pdEh1bmtSYW5nZShwZXJGaWxlOiBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4sIHJlY29yZDogRGlmZlJlY29yZFN0YXRlLCBodW5rOiBSZWdFeHBFeGVjQXJyYXkpOiB2b2lkIHtcbiAgaWYgKHJlY29yZC5iaW5hcnkgfHwgcmVjb3JkLmNvbWJpbmVkIHx8IHJlY29yZC5zdWJtb2R1bGUgfHwgcmVjb3JkLnVudXNhYmxlKSByZXR1cm47XG4gIGNvbnN0IG9sZFN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KGh1bmtbMV0sIDEwKTtcbiAgY29uc3Qgb2xkQ291bnQgPSBodW5rWzJdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbMl0sIDEwKTtcbiAgY29uc3QgbmV3U3RhcnQgPSBOdW1iZXIucGFyc2VJbnQoaHVua1szXSwgMTApO1xuICBjb25zdCBuZXdDb3VudCA9IGh1bmtbNF0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1s0XSwgMTApO1xuICAvLyBSZW5hbWUvY29weTogdGhlIG5ldyBwYXRoIGlzIHRoZSB0b3VjaCB0YXJnZXQ7IHRoZSBvbGQgc2lkZSBpcyBkcm9wcGVkXG4gIC8vICh0aGUgb2xkIHBhdGggbWF5IG5vdCBleGlzdCBvbiBkaXNrIFx1MjAxNCBpdCB3YXMgcmVuYW1lZCBhd2F5KS5cbiAgaWYgKHJlY29yZC5yZW5hbWUpIHtcbiAgICBpZiAocmVjb3JkLm5ld1BhdGggIT09IG51bGwpIGFkZExpbmVzKHBlckZpbGUsIHJlY29yZC5uZXdQYXRoLCBuZXdTdGFydCwgbmV3Q291bnQpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAocmVjb3JkLm9sZFBhdGggIT09IG51bGwpIGFkZExpbmVzKHBlckZpbGUsIHJlY29yZC5vbGRQYXRoLCBvbGRTdGFydCwgb2xkQ291bnQpO1xuICBpZiAocmVjb3JkLm5ld1BhdGggIT09IG51bGwpIGFkZExpbmVzKHBlckZpbGUsIHJlY29yZC5uZXdQYXRoLCBuZXdTdGFydCwgbmV3Q291bnQpO1xufVxuXG4vKiogQWRkIGBjb3VudGAgY29uc2VjdXRpdmUgMS1iYXNlZCBsaW5lcyBzdGFydGluZyBhdCBgc3RhcnRgIHRvIGBwYXRoYCdzIHNldC4gKi9cbmZ1bmN0aW9uIGFkZExpbmVzKHBlckZpbGU6IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PiwgcGF0aDogc3RyaW5nLCBzdGFydDogbnVtYmVyLCBjb3VudDogbnVtYmVyKTogdm9pZCB7XG4gIGlmIChzdGFydCA8IDEgfHwgY291bnQgPD0gMCkgcmV0dXJuO1xuICBsZXQgbGluZXMgPSBwZXJGaWxlLmdldChwYXRoKTtcbiAgaWYgKGxpbmVzID09PSB1bmRlZmluZWQpIHtcbiAgICBsaW5lcyA9IG5ldyBTZXQoKTtcbiAgICBwZXJGaWxlLnNldChwYXRoLCBsaW5lcyk7XG4gIH1cbiAgZm9yIChsZXQgbiA9IHN0YXJ0OyBuIDwgc3RhcnQgKyBjb3VudDsgbisrKSBsaW5lcy5hZGQobik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gYGdpdCBibGFtZSAtTGAgY29tbWFuZC10ZXh0IG1hdGNoZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIE1hdGNoIGEgYGdpdCBibGFtZSAtTCBOLE0gPGZpbGU+YCBpbnZvY2F0aW9uIGZyb20gY29tbWFuZCB0ZXh0OiB0aGUgZXhhY3RcbiAqIGxpdGVyYWwgYE4sTWAgcmFuZ2UgZnJvbSB0aGUgYC1MYCB2YWx1ZSBhbmQgdGhlIHNpbmdsZSBwYXRoIHBvc2l0aW9uYWxcbiAqIHRoYXQgZm9sbG93cyBpdCAoZWFybGllciBwb3NpdGlvbmFscyBhcmUgcmV2aXNpb25zKS4gYGdpdCBsb2cgLUxgIGVtYmVkc1xuICogdGhlIHBhdGggaW4gaXRzIHNwZWMgYW5kIHBhcnNlLWNvbW1hbmQudHMgYWxyZWFkeSBjb3ZlcnMgaXQ7IGJsYW1lIHRha2VzXG4gKiB0aGUgcGF0aCBhcyBhIHBvc2l0aW9uYWwsIHdoaWNoIHRoZSBjb21tYW5kLW9ubHkgcGFyc2VyIGRvZXMgbm90IGhhbmRsZS5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hCbGFtZVJhbmdlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgc3RhcnQ6IG51bWJlclxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyOyBmaWxlQXJnOiBzdHJpbmcgfSB8IG51bGwge1xuICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzcGVjSWR4ID0gLTE7XG4gIGNvbnN0IHBvc2l0aW9uYWxzOiBBcnJheTx7IGFyZzogc3RyaW5nOyBpZHg6IG51bWJlciB9PiA9IFtdO1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGFyZ3YubGVuZ3RoOyBqKyspIHBvc2l0aW9uYWxzLnB1c2goeyBhcmc6IGFyZ3Zbal0sIGlkeDogaiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1MJykge1xuICAgICAgc3BlYyA9IGFyZ3ZbaSArIDFdID8/IG51bGw7XG4gICAgICBzcGVjSWR4ID0gaTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctTCcpKSB7XG4gICAgICBzcGVjID0gYS5zbGljZSgyKTtcbiAgICAgIHNwZWNJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgcG9zaXRpb25hbHMucHVzaCh7IGFyZzogYSwgaWR4OiBpIH0pO1xuICB9XG4gIGlmIChzcGVjID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbSA9IC9eKFxcZCspLChcXGQrKSQvLmV4ZWMoc3BlYyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZmlsZXMgPSBwb3NpdGlvbmFscy5maWx0ZXIoKHApID0+IHAuaWR4ID4gc3BlY0lkeCk7XG4gIGlmIChmaWxlcy5sZW5ndGggIT09IDEpIHJldHVybiBudWxsO1xuICByZXR1cm4ge1xuICAgIGxpbmVTdGFydDogTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKSxcbiAgICBsaW5lRW5kOiBOdW1iZXIucGFyc2VJbnQobVsyXSwgMTApLFxuICAgIGZpbGVBcmc6IGZpbGVzWzBdLmFyZ1xuICB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9yY2hlc3RyYXRvclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRGVyaXZlcyBwcmVjaXNlIHBlci1maWxlIHJlYWQgcmFuZ2VzIGZyb20gYSByZXNwb25zZS1wcm9kdWNpbmcgY29tbWFuZDpcbiAqIGNvbW1hbmQgZ2F0aW5nLCBzY29wZSByZXN0cmljdGlvbiBhZ2FpbnN0IHRoZSBjb21tYW5kJ3MgZGVjbGFyZWQgcm9vdHMsXG4gKiBzZWFyY2gtbGF5b3V0IGRlY29kaW5nLCB1bmlmaWVkLWRpZmYgZGVjb2RpbmcsIGNvYWxlc2NpbmcsIGFuZCB0aGVcbiAqIGZhaWwtY2xvc2VkIHRydW5jYXRpb24vaG9zdGlsZS1vdXRwdXQgcnVsZXMuIFJldHVybnMgW10gZm9yIGFueXRoaW5nIG5vdFxuICogcmVzcG9uc2UtZGVyaXZhYmxlIG9yIG5vdCBmdWxseSBvYnNlcnZlZC5cbiAqXG4gKiBQaGFzZSAzYSBjb3ZlcnMgdGhlIGdyZXAvcmlwZ3JlcCBmYW1pbHkgKGByZ2AsIGBncmVwYCwgYGVncmVwYCwgYGZncmVwYCxcbiAqIGBnaXQgZ3JlcGApOyBQaGFzZSAzYiB0aGUgZGlmZi1mb3JtIGBnaXQgZGlmZmAvYGdpdCBzaG93YC9gZ2l0IGxvZyAtcGBcbiAqIHVuaWZpZWQtZGlmZiBkZWNvZGVyOyBQaGFzZSAzYyB0aGUgYGdpdCBibGFtZSAtTCBOLE0gZmlsZWAgY29tbWFuZC10ZXh0XG4gKiBtYXRjaGVyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VSZXNwb25zZShpbnB1dDogUmVzcG9uc2VQYXJzZUlucHV0KTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCB7IGNvbW1hbmQsIGN3ZCwgc3Rkb3V0IH0gPSBpbnB1dDtcblxuICAvLyBXYWxrIHRoZSBzaW1wbGUgY29tbWFuZHMgdHJhY2tpbmcgYGNkYCwgZXhhY3RseSBsaWtlIHBhcnNlLWNvbW1hbmQudHMuXG4gIC8vIFRoZSByZXNwb25zZSBpcyBhdHRyaWJ1dGVkIHRvIHRoZSBGSVJTVCBnYXRlZCBzdGFnZSAobGVmdC10by1yaWdodDsgYVxuICAvLyBsYXRlciBzdGFnZSBuZXZlciBvdmVycmlkZXMgYW4gZWFybGllciBnYXRlZCBvbmUpOiBpbiBhIHBpcGVsaW5lIHRoZVxuICAvLyBmaW5hbCBzdGFnZSdzIHN0ZG91dCBpcyB0aGUgZ2F0ZWQgc3RhZ2UncyBvdXRwdXQgXHUyMDE0IGhlYWQvdGFpbC93Yy9zb3J0L1xuICAvLyB1bmlxL2N1dCBvbmx5IHRydW5jYXRlLCByZW9yZGVyLCBvciBkZWR1cGUsIGFuZCB0aGUgdGVybWluYXRpbmctbmV3bGluZVxuICAvLyBydWxlIGhhbmRsZXMgdGhlIGN1dCBcdTIwMTQgd2hpbGUgYSByZW51bWJlcmluZyBzdGFnZSAoZ3JlcCAtbiwgbmwsIGNhdCAtbixcbiAgLy8gYXdrLCBzZWQpIHR1cm5zIHRoZSByZWNvcmRzIGludG8gc3RyZWFtIHBvc2l0aW9ucywgc28gc3VjaCBwaXBlbGluZXNcbiAgLy8gZmFpbCBjbG9zZWQgYmVsb3cuIEluIGEgYDtgL2AmJmAvYHx8YC9gJmAvbmV3bGluZSBjaGFpbiBldmVyeSBzaWJsaW5nXG4gIC8vIHN0YWdlJ3Mgb3V0cHV0IG1peGVzIGludG8gdGhlIFNBTUUgcmVzcG9uc2UsIHNvIHRoZSBjaGFpbiBpc1xuICAvLyBhdHRyaWJ1dGFibGUgb25seSB3aGVuIGV2ZXJ5IHNpYmxpbmcgKGVpdGhlciBkaXJlY3Rpb24pIHBhc3NlcyB0aGUgc2FtZVxuICAvLyBwcm92YWJseS12ZXJiYXRpbSBjaGVjayB0aGUgcGlwZSBzdGFnZXMgZ2V0IFx1MjAxNCBhIGNyYWZ0ZWQgZmlsZSByZWFkIGJ5XG4gIC8vIGFueSBzaWJsaW5nIHdvdWxkIGRlY29kZSBhcyBwaGFudG9tIHRvdWNoZXMgb3RoZXJ3aXNlLiBgY2RgIHRyYWNraW5nXG4gIC8vIGFwcGxpZXMgb25seVxuICAvLyB1bnRpbCB0aGUgZmlyc3QgZ2F0ZWQgc3RhZ2UgaXMgZm91bmQ6IHRoZSBldmlkZW5jZSB3YXMgcHJvZHVjZWQgaW4gdGhhdFxuICAvLyBkaXJlY3RvcnksIGFuZCBhIGBjZGAgaW4gYSBsYXRlciBzdGFnZSBzYXlzIG5vdGhpbmcgYWJvdXQgd2hlcmUgdGhlXG4gIC8vIHJlc3BvbnNlIHdhcyBtYWRlLlxuICBsZXQgY3VycmVudERpciA9IGN3ZDtcbiAgbGV0IGdhdGVkOiBHYXRlZENvbW1hbmQgfCBudWxsID0gbnVsbDtcbiAgLy8gV2hldGhlciB0aGUgZ2F0ZWQgc3RhZ2UncyBzdGRpbiBjYW1lIGZyb20gYSBwaXBlIFx1MjAxNCB0aGUgc2lnbmFsIHRoYXQgaXRzXG4gIC8vIHJlY29yZHMgYXJlIHN0cmVhbSBwb3NpdGlvbnMgd2hlbiBubyBzZWFyY2ggcm9vdHMgd2VyZSBnaXZlbi5cbiAgbGV0IGdhdGVkUHJlY2VkZWRCeTogT3BlcmF0b3IgPSAnc3RhcnQnO1xuICAvLyBXaGV0aGVyIHRoZSBnYXRlZCBzdGFnZSdzIG93biB0ZXh0IGNhcnJpZXMgYW4gVU5RVU9URUQgYDxgIFx1MjAxNCBhIHN0ZGluXG4gIC8vIHJlZGlyZWN0LCBzdGFuZGFsb25lIG9yIGdsdWVkIGluc2lkZSBhIHRva2VuIChgcmcgbmVlZGxlPGNyYWZ0ZWQudHh0YCxcbiAgLy8gYSBjb25zdW1lZCBgLWVgL2AtZmAgdmFsdWUpLiBUaGUgc3RkaW4tZmVkIHJ1bGUgbXVzdCBzZWUgaXQgZXZlbiB3aGVuXG4gIC8vIG5vIHN0YW5kYWxvbmUgYDxgIHRva2VuIHN1cnZpdmVzIGFyZ3Ygc3BsaXR0aW5nLiBRdW90ZS1hd2FyZTogYSBxdW90ZWRcbiAgLy8gbGl0ZXJhbCBgPGAgaW4gYSBwYXR0ZXJuIChgcmcgLW4gJzxkaXY+J2ApIGlzIG5vdCBhIHJlZGlyZWN0LlxuICBsZXQgZ2F0ZWRSZWRpcmVjdCA9IGZhbHNlO1xuICAvLyBXaGV0aGVyIHRoZSBnYXRlZCBzdGFnZSdzIHN0ZGluIGNvbWVzIGZyb20gYSBgPDxgL2A8PC1gIEhFUkVET0MgYm9keSBcdTIwMTRcbiAgLy8gdGhlIHNwbGl0dGVyIHN0cmlwcyB0aGUgb3BlcmF0b3IrZGVsaW1pdGVyIGZyb20gdGhlIHN0YWdlIHRleHQsIHNvIG9ubHlcbiAgLy8gdGhlIHBlci1zdGFnZSBmbGFnIHNlZXMgdGhlIHJlZGlyZWN0LlxuICBsZXQgZ2F0ZWRIZXJlZG9jID0gZmFsc2U7XG4gIGNvbnN0IHNwbGl0ID0gc3BsaXRUb3BMZXZlbChjb21tYW5kKTtcbiAgLy8gQSBCYXNoIHBhcnNlIGVycm9yIG1lYW5zIG5vdGhpbmcgZXhlY3V0ZWQgKGJhc2ggZXhpdHMgMiBhdCBwYXJzZSB0aW1lKSBcdTIwMTRcbiAgLy8gdGhlIHJlc3BvbnNlIGNvdWxkIG5vdCBoYXZlIGJlZW4gcHJvZHVjZWQgYnkgdGhpcyBjb21tYW5kLCBzbyBmYWlsXG4gIC8vIGNsb3NlZCByYXRoZXIgdGhhbiBhdHRyaWJ1dGUgaXQgdG8gaGFsZi1wYXJzZWQgc3RhZ2VzLlxuICBpZiAoc3BsaXQubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcGFydHMgPSBzcGxpdC5zdGFnZXM7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBzaW1wbGUgPSBwYXJ0c1tpXTtcbiAgICBjb25zdCBhcmd2ID0gYXJndk9mKHNpbXBsZS50ZXh0KTtcbiAgICBpZiAoYXJndiA9PT0gbnVsbCB8fCBhcmd2Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjZCcpIHtcbiAgICAgIGlmIChnYXRlZCA9PT0gbnVsbCkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBhcmd2WzFdO1xuICAgICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgICBjdXJyZW50RGlyID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChnYXRlZCAhPT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKFNFQVJDSF9CSU5TLmhhcyhhcmd2WzBdKSkge1xuICAgICAgZ2F0ZWQgPSB7IGtpbmQ6ICdzZWFyY2gnLCBhcmd2LCBzdGFydDogMSwgZGlyOiBudWxsLCBkaXJVbnJlc29sdmFibGU6IGZhbHNlIH07XG4gICAgfSBlbHNlIGlmIChhcmd2WzBdID09PSAnZ2l0Jykge1xuICAgICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndik7XG4gICAgICBpZiAoc3ViICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSB7IGFyZ3YsIHN0YXJ0OiBzdWIuc3RhcnQsIGRpcjogc3ViLmRpciwgZGlyVW5yZXNvbHZhYmxlOiBzdWIuZGlyVW5yZXNvbHZhYmxlIH07XG4gICAgICAgIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ2dyZXAnKSBnYXRlZCA9IHsga2luZDogJ3NlYXJjaCcsIC4uLmJhc2UgfTtcbiAgICAgICAgLy8gYGdpdCBzaG93IDxyZXY+OjxwYXRoPmAgc3RyZWFtcyB0aGUgYmxvYidzIFJBVyBjb250ZW50LCBuZXZlciBhXG4gICAgICAgIC8vIGRpZmYgXHUyMDE0IGEgZGlmZi1zaGFwZWQgYmxvYiBtdXN0IG5vdCBkZWNvZGUgaW50byBmYWJyaWNhdGVkIHRvdWNoZXNcbiAgICAgICAgLy8gb24gdGhlIGZpbGVzIGl0cyBjb250ZW50IG5hbWVzLCBzbyB0aGUgY29udGVudCBpZGlvbSBpcyBleGNsdWRlZFxuICAgICAgICAvLyBmcm9tIHRoZSBkaWZmIGdhdGUuIGBnaXQgZGlmZiA8cmV2Pjo8cGF0aD5gIGVycm9ycyBpbnN0ZWFkIG9mXG4gICAgICAgIC8vIGVtaXR0aW5nIGNvbnRlbnQsIHNvIG9ubHkgYHNob3dgIG5lZWRzIHRoZSBjaGVjazsgdGhlIHR3by1hcmdcbiAgICAgICAgLy8gYmxvYi1ibG9iIGZvcm0gYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gIERPRVMgZW1pdCBhXG4gICAgICAgIC8vIGRpZmYgbmFtaW5nIHdvcmtpbmctdHJlZSBwYXRocyBnaXQgbmV2ZXIgcmVhZCBhbmQgaXMgcmVqZWN0ZWQgaW5cbiAgICAgICAgLy8gdGhlIGRpZmYgYnJhbmNoIGJlbG93LlxuICAgICAgICBlbHNlIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ3Nob3cnICYmICFoYXNSZXZQYXRoQXJnKGFyZ3YsIHN1Yi5zdGFydCkpIGdhdGVkID0geyBraW5kOiAnZGlmZicsIC4uLmJhc2UgfTtcbiAgICAgICAgZWxzZSBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdkaWZmJykgZ2F0ZWQgPSB7IGtpbmQ6ICdkaWZmJywgLi4uYmFzZSB9O1xuICAgICAgICBlbHNlIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ2xvZycgJiYgaGFzRGlmZlBhdGNoRmxhZyhhcmd2LCBzdWIuc3RhcnQpKSBnYXRlZCA9IHsga2luZDogJ2RpZmYnLCAuLi5iYXNlIH07XG4gICAgICAgIGVsc2UgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAnYmxhbWUnKSBnYXRlZCA9IHsga2luZDogJ2JsYW1lJywgLi4uYmFzZSB9O1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZ2F0ZWQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGdhdGVkUHJlY2VkZWRCeSA9IHNpbXBsZS5wcmVjZWRlZEJ5O1xuICAgIGdhdGVkUmVkaXJlY3QgPSBoYXNVbnF1b3RlZFJlZGlyZWN0KHNpbXBsZS50ZXh0KTtcbiAgICBnYXRlZEhlcmVkb2MgPSBzaW1wbGUuaGVyZWRvYyA/PyBmYWxzZTtcbiAgICAvLyBFdmVyeSBPVEhFUiBzdGFnZSdzIHJlY29yZHMgY2FuIHJlYWNoIHRoZSByZXNwb25zZSwgc28gZWFjaCBtdXN0IGJlXG4gICAgLy8gcHJvdmFibHkgdmVyYmF0aW0gXHUyMDE0IHRoZSBkZWZhdWx0IG9mIGlzUmVudW1iZXJpbmdGaWx0ZXIgaXMgY2xvc2VkLCBzb1xuICAgIC8vIGFueSBiaW4gb3V0c2lkZSB0aGUgdmVyYmF0aW0gYWxsb3dsaXN0IChweXRob24sIHJ1YnksIG1hd2ssIFx1MjAyNikgbWF5XG4gICAgLy8gcmVudW1iZXIgb3IgcmV3cml0ZSB0aGUgcmVjb3JkcywgZGVzdHJveSB0aGUgZmlsZS1saW5lIG1hcHBpbmcgdGhleVxuICAgIC8vIGNhcnJ5LCBhbmQgdGhlIHBpcGVsaW5lIGZhaWxzIGNsb3NlZDogYXR0cmlidXRlIG5vdGhpbmcuIFRoYXQgY292ZXJzXG4gICAgLy8gdGhlIHBpcGUgc3RhZ2VzIG9mIHRoZSBzYW1lIHBpcGVsaW5lIEFORCB0aGUgY2hhaW4gc2libGluZ3Mgam9pbmVkXG4gICAgLy8gYnkgYDtgLCBgJiZgLCBgfHxgLCBgJmAsIG9yIGEgbmV3bGluZSBcdTIwMTQgaW4gZWl0aGVyIGRpcmVjdGlvbiBcdTIwMTQgd2hvc2VcbiAgICAvLyBvdXRwdXQgbWl4ZXMgaW50byB0aGUgc2FtZSByZXNwb25zZTogYSBjcmFmdGVkIGZpbGUgcmVhZCBieSBhbnlcbiAgICAvLyBzaWJsaW5nIGRlY29kZXMgYXMgcGhhbnRvbSB0b3VjaGVzLCBzbyBhIGNoYWluIGlzIGF0dHJpYnV0YWJsZSBvbmx5XG4gICAgLy8gd2hlbiBldmVyeSBzaWJsaW5nIHBhc3NlcyB0aGUgc2FtZSB2ZXJiYXRpbSBjaGVjay4gYGNkYCBzdGFnZXMgYXJlXG4gICAgLy8gc2tpcHBlZCBhYm92ZSAodGhlaXIgb3V0cHV0IGlzIGVtcHR5KSwgYW5kIGEgYHxgLWpvaW5lZCBmZWVkZXJcbiAgICAvLyBFQVJMSUVSIGluIHRoZSBwaXBlbGluZSBpcyBjb25zdW1lZCBieSB0aGUgZ2F0ZWQgc3RhZ2UgXHUyMDE0IGEgc2VhcmNoXG4gICAgLy8gd2l0aCBleHBsaWNpdCByb290cyBpZ25vcmVzIHN0ZGluLCBzbyB0aGUgZmVlZGVyJ3MgcmVjb3JkcyBuZXZlclxuICAgIC8vIHJlYWNoIHRoZSByZXNwb25zZS5cbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IHBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaiA9PT0gaSkgY29udGludWU7XG4gICAgICBpZiAoaiA8IGkpIHtcbiAgICAgICAgLy8gQSBmZWVkZXIncyBvdXRwdXQgaXMgY29uc3VtZWQgb25seSB3aGVuIEVWRVJZIHBhcnQgYmV0d2VlbiBpdFxuICAgICAgICAvLyBhbmQgdGhlIGdhdGVkIHN0YWdlIGlzIHBpcGUtam9pbmVkIFx1MjAxNCBhIGA7YC9gJiZgL1x1MjAyNiBhbnl3aGVyZSBpblxuICAgICAgICAvLyBiZXR3ZWVuIG1ha2VzIGl0IGEgY2hhaW4gc2libGluZyB3aG9zZSBvdXRwdXQgcmVhY2hlcyB0aGVcbiAgICAgICAgLy8gcmVzcG9uc2UgKHRocm91Z2ggdGhlIHN0YWdlcyBiZXR3ZWVuIHRoZW0pLlxuICAgICAgICBsZXQgY29uc3VtZWQgPSB0cnVlO1xuICAgICAgICBmb3IgKGxldCBrID0gaiArIDE7IGsgPD0gaSAmJiBjb25zdW1lZDsgaysrKSB7XG4gICAgICAgICAgaWYgKHBhcnRzW2tdLnByZWNlZGVkQnkgIT09ICdwaXBlJykgY29uc3VtZWQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY29uc3VtZWQpIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc2libGluZ1RleHQgPSBwYXJ0c1tqXS50ZXh0O1xuICAgICAgY29uc3Qgc2libGluZ0FyZ3YgPSBhcmd2T2Yoc2libGluZ1RleHQpO1xuICAgICAgaWYgKHNpYmxpbmdBcmd2ID09PSBudWxsIHx8IHNpYmxpbmdBcmd2Lmxlbmd0aCA9PT0gMCB8fCBzaWJsaW5nQXJndlswXSA9PT0gJ2NkJykgY29udGludWU7XG4gICAgICAvLyBBbiB1bnF1b3RlZCBgPGAgXHUyMDE0IGV2ZW4gR0xVRUQgaW5zaWRlIGEgZmxhZywgcGF0dGVybiwgb3IgdmFsdWUgdG9rZW5cbiAgICAgIC8vIChgaGVhZCAtMjxjcmFmdGVkLnR4dGAsIGBncmVwIG5lZWRsZTxjcmFmdGVkLnR4dGAsIGAtZSBuZWVkbGU8ZmApIFx1MjAxNFxuICAgICAgLy8gcmVkaXJlY3RzIHRoZSBzdGFnZSdzIHN0ZGluIHRvIGEgZmlsZSwgc28gaXRzIHJlY29yZHMgY29tZSBmcm9tIHRoYXRcbiAgICAgIC8vIGZpbGUsIG5vdCB0aGUgcGlwZTogYSBjcmFmdGVkIHJlY29yZCBkZWNvZGVzIGFzIGEgcGhhbnRvbSB0b3VjaCwgc29cbiAgICAgIC8vIGZhaWwgY2xvc2VkIGxpa2UgYW55IG90aGVyIGZpbGUgb3BlcmFuZC4gUXVvdGUtYXdhcmU6IGEgcXVvdGVkXG4gICAgICAvLyBsaXRlcmFsIGA8YCBpbiBhIHBhdHRlcm4gKGByZyAtbiAnPGRpdj4nYCkgaXMgbm90IGEgcmVkaXJlY3QuXG4gICAgICBpZiAoaGFzVW5xdW90ZWRSZWRpcmVjdChzaWJsaW5nVGV4dCkpIHJldHVybiBbXTtcbiAgICAgIC8vIEEgaGVyZWRvYyAoYGNhdCA8PCdFT0YnYCkgZmVlZHMgdGhlIHN0YWdlJ3Mgc3RkaW4gZnJvbSBpdHMgQk9EWSBcdTIwMTQgYVxuICAgICAgLy8gY3JhZnRlZCBib2R5IGlzIHRoZSBzYW1lIGZhYnJpY2F0ZWQtcmVjb3JkIHNvdXJjZSBhcyBhIGNyYWZ0ZWQgZmlsZS5cbiAgICAgIC8vIFRoZSBzcGxpdHRlciBzdHJpcHMgYDw8YCBmcm9tIHRoZSB0ZXh0LCBzbyBvbmx5IHRoZSBwZXItc3RhZ2UgZmxhZ1xuICAgICAgLy8gc2VlcyB0aGUgcmVkaXJlY3QuXG4gICAgICBpZiAocGFydHNbal0uaGVyZWRvYykgcmV0dXJuIFtdO1xuICAgICAgaWYgKGlzUmVudW1iZXJpbmdGaWx0ZXIoc2libGluZ0FyZ3YpKSByZXR1cm4gW107XG4gICAgfVxuICB9XG4gIGlmIChnYXRlZCA9PT0gbnVsbCB8fCBnYXRlZC5kaXJVbnJlc29sdmFibGUpIHJldHVybiBbXTtcblxuICAvLyBUaGUgZGlyZWN0b3J5IHNlYXJjaCBwYXRocyBhcmUgcmVsYXRpdmUgdG8gXHUyMDE0IHRoZSBgZ2l0IC1DYCB0YXJnZXQgd2hlblxuICAvLyBwcmVzZW50LCBvdGhlcndpc2UgdGhlIHNoZWxsIGN3ZCBhZnRlciBhbnkgYGNkYC5cbiAgY29uc3QgZWZmZWN0aXZlRGlyID0gZ2F0ZWQuZGlyICE9PSBudWxsID8gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgZ2F0ZWQuZGlyKSA6IGN1cnJlbnREaXI7XG5cbiAgLy8gYGdpdCBibGFtZSAtTCBOLE0gZmlsZWAgcmVzb2x2ZXMgc3RyYWlnaHQgZnJvbSB0aGUgY29tbWFuZCB0ZXh0OyB0aGVcbiAgLy8gcmVzcG9uc2UncyBjb250ZW50IGlzIGlycmVsZXZhbnQgdG8gaXQsIHNvIHRoZSBBTlNJIHJlamVjdGlvbiBhbmQgdGhlXG4gIC8vIHRydW5jYXRpb24gZ2F0ZSBiZWxvdyBcdTIwMTQgYm90aCByZXNwb25zZS1kZXJpdmVkIGRlY29kZSBnYXRlcyBcdTIwMTQgbXVzdCBub3RcbiAgLy8gc3VwcHJlc3MgaXQuXG4gIGlmIChnYXRlZC5raW5kID09PSAnYmxhbWUnKSB7XG4gICAgY29uc3QgbSA9IG1hdGNoQmxhbWVSYW5nZShnYXRlZC5hcmd2LCBnYXRlZC5zdGFydCk7XG4gICAgaWYgKG0gPT09IG51bGwgfHwgaGFzU2hlbGxFeHBhbnNpb24obS5maWxlQXJnKSB8fCAvWyo/XS8udGVzdChtLmZpbGVBcmcpKSByZXR1cm4gW107XG4gICAgcmV0dXJuIFt7IGxpbmVTdGFydDogbS5saW5lU3RhcnQsIGxpbmVFbmQ6IG0ubGluZUVuZCwgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChlZmZlY3RpdmVEaXIsIG0uZmlsZUFyZykgfV07XG4gIH1cblxuICAvLyBBTlNJIGVzY2FwZSBieXRlcyByZWplY3QgdGhlIHdob2xlIHBhcnNlOiBuZWl0aGVyIHJnL2dyZXAgbm9yIGdpdCBlbWl0XG4gIC8vIGNvbG9yIHdoZW4gcGlwZWQsIHNvIGFuIEVTQyBieXRlIG1lYW5zIHNvbWV0aGluZyBkZWxpYmVyYXRlIGlzIGdvaW5nIG9uLlxuICBpZiAoc3Rkb3V0LmluY2x1ZGVzKCdcXHUwMDFiJykpIHJldHVybiBbXTtcblxuICAvLyBUaGUgYWRhcHRlci1zdXBwbGllZCB0cnVuY2F0ZWQgZmxhZyAoQ2xhdWRlIHJhd091dHB1dFBhdGggc2V0IFx1MjFEMiBpbmxpbmVcbiAgLy8gc3Rkb3V0IGlzIG9ubHkgYSBwcmV2aWV3KSBkZWNsYXJlcyB0aGUgcmVzcG9uc2UtZGVyaXZlZCBkZWNvZGVcbiAgLy8gdW50cnVzdHdvcnRoeSBcdTIwMTQgZmFpbCBjbG9zZWQsIHBhcnNlIG5vdGhpbmcsIGludmVudCBubyB0b3VjaGVzLlxuICAvLyBgaW50ZXJydXB0ZWRgIGlzIHRoZSBwbGFuJ3MgY29tcGxldGUtcmVjb3JkcyByZWdpbWU6IGZ1bGx5LXRlcm1pbmF0ZWRcbiAgLy8gcmVjb3JkcyBwYXJzZSBhbmQgdGhlIGluY29tcGxldGUgdGFpbCBkcm9wcyB2aWEgdGhlIHVuY29uZGl0aW9uYWxcbiAgLy8gdGVybWluYXRpbmctbmV3bGluZSBydWxlLCB3aGljaCB0aGUgZGVmYXVsdCBwYXRoIGFscmVhZHkgYXBwbGllcy5cbiAgaWYgKGlucHV0LnRydW5jYXRlZCkgcmV0dXJuIFtdO1xuXG4gIGlmIChnYXRlZC5raW5kID09PSAnZGlmZicpIHtcbiAgICAvLyBUd28tYXJnIGJsb2ItYmxvYiBgZ2l0IGRpZmYgPHJldj46PHBhdGg+IDxyZXY+OjxwYXRoPmAgZW1pdHMgYSBub3JtYWxcbiAgICAvLyB1bmlmaWVkIGRpZmYgbmFtaW5nIHdvcmtpbmctdHJlZSBwYXRocyB3aGlsZSBnaXQgcmVhZHMgb25seSBoaXN0b3JpY2FsXG4gICAgLy8gYmxvYnMgXHUyMDE0IGRlY29kaW5nIGl0IHdvdWxkIGZhYnJpY2F0ZSB0b3VjaGVzIG9uIGZpbGVzIGdpdCBuZXZlciByZWFkLFxuICAgIC8vIHNvIGEgcG9zaXRpb25hbCBjYXJyeWluZyBgcmV2OnBhdGhgIChhbnkgYDpgLWNvbnRhaW5pbmcgcG9zaXRpb25hbFxuICAgIC8vIHRoYXQgaXMgbm90IGFuIGV4aXN0aW5nIGZpbGUpIHJlamVjdHMgdGhlIGRlY29kZSBvdXRyaWdodC5cbiAgICBpZiAoaGFzRGlmZlJldlBhdGhBcmcoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQsIGVmZmVjdGl2ZURpcikpIHJldHVybiBbXTtcbiAgICAvLyBEaWZmLWZvcm0gcGF0aHMgYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSByZWdhcmRsZXNzIG9mIGN3ZCwgc28gdGhleVxuICAgIC8vIHJlc29sdmUgYWdhaW5zdCB0aGUgd29ya3RyZWUgcm9vdCBkaXNjb3ZlcmVkIGZyb20gdGhlIGVmZmVjdGl2ZSBkaXJcbiAgICAvLyAoYSBgLmdpdGAgZW50cnkgbWFya3MgaXQgXHUyMDE0IG5vIHN1YnByb2Nlc3MpLiBUaGUgcmVwbyByb290IGlzIGFsc28gdGhlXG4gICAgLy8gcGVybWl0dGVkIHJvb3Q6IGEgdHJhdmVyc2FsIHBhdGggbm9ybWFsaXplcyBvdXRzaWRlIGl0IGFuZCBpcyByZWplY3RlZFxuICAgIC8vIGJ5IHRoZSBzYW1lIGNvbnRhaW5tZW50IGNoZWNrLiBgLS1yZWxhdGl2ZWAgKGJhcmUpIHJlLWFuY2hvcnMgdG8gdGhlXG4gICAgLy8gY3dkIGFuZCBgLS1yZWxhdGl2ZT08cGF0aD5gIHRvIGEgcGF0aCByZXNvbHZlZCBhZ2FpbnN0IHRoZSB3b3JrdHJlZVxuICAgIC8vIHJvb3QgXHUyMDE0IGJvdGggZGVjb2RlIGFnYWluc3QgdGhhdCBiYXNlIGluc3RlYWQgKGEgc2hlbGwtZXhwYW5kZWQgb3JcbiAgICAvLyBlbXB0eSB2YWx1ZSBpcyB1bnJlc29sdmFibGUgYW5kIGZhaWxzIGNsb3NlZCkuXG4gICAgY29uc3QgcmVwb1Jvb3QgPSBmaW5kR2l0Um9vdChlZmZlY3RpdmVEaXIpO1xuICAgIGlmIChyZXBvUm9vdCA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuICAgIGNvbnN0IHJlbGF0aXZlID0gZGlmZlJlbGF0aXZlQmFzZShnYXRlZC5hcmd2LCBnYXRlZC5zdGFydCwgZWZmZWN0aXZlRGlyLCByZXBvUm9vdCk7XG4gICAgaWYgKHJlbGF0aXZlID09PSAndW5yZXNvbHZhYmxlJykgcmV0dXJuIFtdO1xuICAgIGNvbnN0IGJhc2UgPSByZWxhdGl2ZSAhPT0gbnVsbCA/IHJlbGF0aXZlLmJhc2UgOiByZXBvUm9vdDtcbiAgICBjb25zdCByb290cyA9IHJlbGF0aXZlICE9PSBudWxsID8gW3JlbGF0aXZlLnJvb3RdIDogW3JlcG9Sb290XTtcbiAgICByZXR1cm4gY2FwU3BhbnMoc3BhbnNGb3IoZGVjb2RlVW5pZmllZERpZmYoc3Rkb3V0KSwgYmFzZSwgcm9vdHMpKTtcbiAgfVxuXG4gIGNvbnN0IGluZm8gPSBhbmFseXplU2VhcmNoQXJndihnYXRlZC5hcmd2LCBnYXRlZC5zdGFydCk7XG5cbiAgLy8gQSBub24tZ2l0IHNlYXJjaCBiaW4gd2l0aCBubyBwYXRoIGFyZ3MgcmVhZHMgaXRzIHJlY29yZHMgZnJvbSB3aGF0ZXZlclxuICAvLyBzdGRpbiBjYXJyaWVzIHdoZW4gaXQgaXMgcGlwZWQgb3IgcmVkaXJlY3RlZCBpbiAoYHxgLCBgPCBmaWxlYCxcbiAgLy8gYDw8PGAsIGA8KFx1MjAyNilgKSBcdTIwMTQgbGluZSBudW1iZXJzIGFyZSB0aGVuIHN0cmVhbSBwb3NpdGlvbnMsIG5vdCBmaWxlXG4gIC8vIGxpbmVzLCBhbmQgZGVjb2RpbmcgdGhlbSBmYWJyaWNhdGVzIHRvdWNoZXMgKGEgc3RkaW4gbGluZSBcIjlcIiBiZWNvbWVzIGFcbiAgLy8gcGF0aCwgYW5kIHdpdGggYSByZWFsIGZpbGUgbmFtZWQgYDlgIGF0IHRoZSBjd2QgdGhlIHBoYW50b20gc3VyZmFjZXMpLlxuICAvLyBnYXRlZFJlZGlyZWN0IGV4dGVuZHMgdGhlIHJ1bGUgdG8gYSByZWRpcmVjdCBHTFVFRCBpbnNpZGUgYSB0b2tlblxuICAvLyAoYHJnIG5lZWRsZTxjcmFmdGVkLnR4dGAsIGEgY29uc3VtZWQgYC1lYC9gLWZgIHZhbHVlKTogYXJndiBzcGxpdHRpbmdcbiAgLy8gbmV2ZXIgc3VyZmFjZXMgYSBzdGFuZGFsb25lIGA8YCB0b2tlbiwgc28gb25seSB0aGUgcXVvdGUtYXdhcmUgcmF3LXRleHRcbiAgLy8gc2NhbiBzZWVzIGl0LiBnYXRlZEhlcmVkb2MgZXh0ZW5kcyBpdCB0byBhIGA8PGAvYDw8LWAgSEVSRURPQyBib2R5IFx1MjAxNCB0aGVcbiAgLy8gc3BsaXR0ZXIgc3RyaXBzIHRoZSBvcGVyYXRvciBmcm9tIHRoZSB0ZXh0LCBzbyBvbmx5IHRoZSBwZXItc3RhZ2UgZmxhZ1xuICAvLyBzZWVzIHRoZSByZWRpcmVjdC4gRmFpbCBjbG9zZWQ6IG5vIHJlc3BvbnNlLWRlcml2ZWQgc3BhbnMuIEV4cGxpY2l0XG4gIC8vIHBhdGggYXJncyBzY29wZSB0aGUgc2VhcmNoIHRvIGZpbGVzICh0aGUgcmVkaXJlY3QvcGlwZSBpcyB0aGVuXG4gIC8vIGlycmVsZXZhbnQpLCBhbmQgYGdpdCBncmVwYCBuZXZlciByZWFkcyBzdGRpbiBcdTIwMTQgYm90aCBzdGF5IG9wZW4uXG4gIGNvbnN0IHN0ZGluRmVkID1cbiAgICBnYXRlZC5raW5kID09PSAnc2VhcmNoJyAmJlxuICAgIGdhdGVkLmFyZ3ZbMF0gIT09ICdnaXQnICYmXG4gICAgaW5mby5wYXRoQXJncy5sZW5ndGggPT09IDAgJiZcbiAgICAoZ2F0ZWRQcmVjZWRlZEJ5ID09PSAncGlwZScgfHwgaW5mby5zdGRpblJlZGlyZWN0IHx8IGdhdGVkUmVkaXJlY3QgfHwgZ2F0ZWRIZXJlZG9jKTtcbiAgaWYgKHN0ZGluRmVkKSByZXR1cm4gW107XG5cbiAgLy8gZ2l0IGdyZXAgc2NvcGluZzogcGxhaW4gaW52b2NhdGlvbiBmcm9tIGEgc3ViZGlyIGlzIHNjb3BlZCB0byB0aGUgc3ViZGlyXG4gIC8vIGJ5IGdpdCBpdHNlbGYgKHJlY29yZHMgYXJlIGN3ZC1yZWxhdGl2ZSwgcm9vdCBzdGF5cyB0aGUgZWZmZWN0aXZlIGRpcik7XG4gIC8vIHBhdGhzcGVjIG1hZ2ljIChgOi9gLCBgOiFgLCBgOl5gLCBgOiguLi4pYCkgc2VhcmNoZXMgdGhlIHdob2xlIHRyZWUgYW5kXG4gIC8vIGVtaXRzIGN3ZC1yZWxhdGl2ZSByZWNvcmRzIHdpdGggYC4uL2AgcHJlZml4ZXMsIHNvIHRoZSBwZXJtaXR0ZWQgcm9vdFxuICAvLyB3aWRlbnMgdG8gdGhlIHdvcmt0cmVlIHJvb3Q7IGAtLWZ1bGwtbmFtZWAgcmUtYW5jaG9ycyByZWNvcmRzIHRvXG4gIC8vIHJlcG8tcm9vdC1yZWxhdGl2ZSBwYXRocywgd2hpY2ggcmVzb2x2ZXMgYWdhaW5zdCB0aGUgd29ya3RyZWUgcm9vdCB0b28uXG4gIGNvbnN0IGlzR2l0R3JlcCA9IGdhdGVkLmtpbmQgPT09ICdzZWFyY2gnICYmIGdhdGVkLmFyZ3ZbMF0gPT09ICdnaXQnO1xuICBjb25zdCBmdWxsTmFtZSA9IGlzR2l0R3JlcCAmJiBoYXNGbGFnKGdhdGVkLmFyZ3YsIGdhdGVkLnN0YXJ0LCAnLS1mdWxsLW5hbWUnKTtcbiAgY29uc3QgbWFnaWMgPSBpc0dpdEdyZXAgJiYgaW5mby5wYXRoc3BlY01hZ2ljO1xuICBjb25zdCB3b3JrdHJlZVJvb3QgPSBtYWdpYyB8fCBmdWxsTmFtZSA/IGZpbmRHaXRSb290KGVmZmVjdGl2ZURpcikgOiBudWxsO1xuICBpZiAoKG1hZ2ljIHx8IGZ1bGxOYW1lKSAmJiB3b3JrdHJlZVJvb3QgPT09IG51bGwpIHJldHVybiBbXTtcblxuICAvLyBXaGVyZSBkZWNvZGVkIHJlY29yZCBwYXRocyByZXNvbHZlIGZyb206IHRoZSBlZmZlY3RpdmUgY3dkIGZvciBwbGFpblxuICAvLyBhbmQgbWFnaWMgZ2l0IGdyZXAgKHJlY29yZHMgYXJlIGN3ZC1yZWxhdGl2ZSksIHRoZSB3b3JrdHJlZSByb290IGZvclxuICAvLyBgLS1mdWxsLW5hbWVgIChyZWNvcmRzIGFyZSByZXBvLXJvb3QtcmVsYXRpdmUpLlxuICBjb25zdCBiYXNlID0gZnVsbE5hbWUgJiYgd29ya3RyZWVSb290ICE9PSBudWxsID8gd29ya3RyZWVSb290IDogZWZmZWN0aXZlRGlyO1xuXG4gIC8vIFBlcm1pdHRlZCByb290czogdGhlIGNvbW1hbmQncyBleHBsaWNpdCBzZWFyY2ggcm9vdHMsIG9yIHRoZSBlZmZlY3RpdmVcbiAgLy8gY3dkIHdoZW4gbm8gcGF0aCBhcmdzIGFyZSBnaXZlbiAocmcvZ3JlcCBzZWFyY2ggaXQgYnkgZGVmYXVsdCkgXHUyMDE0IGV4Y2VwdFxuICAvLyBnaXQgZ3JlcCB3aXRoIHBhdGhzcGVjIG1hZ2ljLCB3aGljaCBzZWFyY2hlcyB0aGUgd2hvbGUgdHJlZSBhbmQgbXVzdCBiZVxuICAvLyBwZXJtaXR0ZWQgYWdhaW5zdCB0aGUgd29ya3RyZWUgcm9vdC5cbiAgY29uc3Qgcm9vdHMgPVxuICAgIG1hZ2ljICYmIHdvcmt0cmVlUm9vdCAhPT0gbnVsbFxuICAgICAgPyBbd29ya3RyZWVSb290XVxuICAgICAgOiBpbmZvLnBhdGhBcmdzLmxlbmd0aCA+IDBcbiAgICAgICAgPyBpbmZvLnBhdGhBcmdzLm1hcCgocCkgPT4gcmVzb2x2ZVBhdGgoZWZmZWN0aXZlRGlyLCBwKSlcbiAgICAgICAgOiBbZWZmZWN0aXZlRGlyXTtcblxuICBjb25zdCBzaW5nbGVGaWxlQXJnID0gaW5mby5wYXRoQXJncy5sZW5ndGggPT09IDEgPyBpbmZvLnBhdGhBcmdzWzBdIDogbnVsbDtcbiAgLy8gT25lLWZpbGUgZWxpZ2liaWxpdHk6IG51bWJlcmVkIGV2aWRlbmNlLCBleGFjdGx5IG9uZSBleHBsaWNpdCBmaWxlXG4gIC8vIGFyZ3VtZW50IHRoYXQgaXMgYSByZWFsIGZpbGUgKGEgZGlyZWN0b3J5IG9yIG5vIGFyZ3MgbWVhbnMgcmVjb3JkcyBjYXJyeVxuICAvLyBwYXRoIHByZWZpeGVzKSwgYW5kIG5vIC1ILy0td2l0aC1maWxlbmFtZSAod2hpY2ggZm9yY2VzIHBhdGggcHJlZml4ZXMpLlxuICBjb25zdCBvbmVGaWxlRWxpZ2libGUgPVxuICAgIGluZm8ubnVtYmVyZWQgJiYgIWluZm8ud2l0aEZpbGVuYW1lICYmIHNpbmdsZUZpbGVBcmcgIT09IG51bGwgJiYgaXNGaWxlKHJlc29sdmVQYXRoKGVmZmVjdGl2ZURpciwgc2luZ2xlRmlsZUFyZykpO1xuXG4gIGNvbnN0IGxheW91dCA9IGRldGVjdExheW91dChzdGRvdXQsIGluZm8sIG9uZUZpbGVFbGlnaWJsZSk7XG5cbiAgY29uc3QgcGVyRmlsZSA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4oKTtcbiAgaWYgKGxheW91dCAhPT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgcmVjIG9mIGRlY29kZVNlYXJjaExheW91dChsYXlvdXQsIHN0ZG91dCwgc2luZ2xlRmlsZUFyZykpIHtcbiAgICAgIC8vIERlY29kZWQgcGF0aHMgbXVzdCBiZSByZWFsIGZpbGVzOiBhIHJlY3Vyc2l2ZS1sYXlvdXQgcmVjb3JkIHdob3NlXG4gICAgICAvLyBwYXRoIGlzIG5vdCBhbiBleGlzdGluZyByZWd1bGFyIGZpbGUgKHJlc29sdmVkIGFnYWluc3QgdGhlIHJlY29yZFxuICAgICAgLy8gYmFzZSBcdTIwMTQgdGhlIGVmZmVjdGl2ZSBjd2QsIG9yIHRoZSB3b3JrdHJlZSByb290IHVuZGVyIGAtLWZ1bGwtbmFtZWApXG4gICAgICAvLyBkcm9wcyBpbnN0ZWFkIG9mIGZhYnJpY2F0aW5nIGEgdG91Y2guXG4gICAgICBpZiAobGF5b3V0ID09PSAncmVjdXJzaXZlJyAmJiAhaXNGaWxlKHJlc29sdmVQYXRoKGJhc2UsIHJlYy5wYXRoKSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHJlYy5saW5lID09PSBudWxsKSB7XG4gICAgICAgIC8vIFdob2xlLWZpbGUgbnVsbC1zZXBhcmF0ZWQgcmVjb3JkOiB0aGUgdGV4dCBob2xkcyB0aGUgZW50aXJlIGZpbGUuXG4gICAgICAgIGNvbnN0IHRvdGFsID0gbGluZUNvdW50KHJlYy50ZXh0KTtcbiAgICAgICAgbGV0IGxpbmVzID0gcGVyRmlsZS5nZXQocmVjLnBhdGgpO1xuICAgICAgICBpZiAobGluZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGxpbmVzID0gbmV3IFNldCgpO1xuICAgICAgICAgIHBlckZpbGUuc2V0KHJlYy5wYXRoLCBsaW5lcyk7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChsZXQgbiA9IDE7IG4gPD0gdG90YWw7IG4rKykgbGluZXMuYWRkKG4pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGV0IGxpbmVzID0gcGVyRmlsZS5nZXQocmVjLnBhdGgpO1xuICAgICAgICBpZiAobGluZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGxpbmVzID0gbmV3IFNldCgpO1xuICAgICAgICAgIHBlckZpbGUuc2V0KHJlYy5wYXRoLCBsaW5lcyk7XG4gICAgICAgIH1cbiAgICAgICAgbGluZXMuYWRkKHJlYy5saW5lKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBzcGFucyA9IHNwYW5zRm9yKHBlckZpbGUsIGJhc2UsIHJvb3RzKTtcblxuICAvLyBXaG9sZS1maWxlIGZhbGxiYWNrOiBub24tZW1wdHksIGZ1bGx5IG9ic2VydmVkIG91dHB1dCAoaXRzIHRlcm1pbmF0aW5nXG4gIC8vIG5ld2xpbmUgaXMgcHJlc2VudCkgd2l0aCBubyBwYXJzZWFibGUgbnVtYmVyZWQgcmVjb3JkLCBhbiB1bm51bWJlcmVkXG4gIC8vIGNvbW1hbmQgKGEgbnVtYmVyZWQgY29tbWFuZCBcdTIwMTQgZ3JlcCAtbiwgbmwsIGNhdCAtbiBcdTIwMTQgd2hvc2Ugb3V0cHV0XG4gIC8vIGNhcnJpZXMgbm8gcGFyc2VhYmxlIHJlY29yZCBtdXN0IG5vdCBmYWxsIGJhY2sgZWl0aGVyOiBpdHMgcmVjb3JkcyBhcmVcbiAgLy8gc3RyZWFtIHBvc2l0aW9ucyBvciBnYXJiYWdlLCBhbmQgdGhlIHdob2xlLWZpbGUgc3BhbiB3b3VsZCBmYWJyaWNhdGUgYVxuICAvLyByZWFkIHRoZSByZXNwb25zZSBuZXZlciBldmlkZW5jZWQpLCBhbmQgZXhhY3RseSBvbmUgZXhwbGljaXQgZmlsZVxuICAvLyByZXNvbHZlcyB0byBhIHdob2xlLWZpbGUgcmVhZCBvZiBpdC4gVGhlIHVuaXZlcnNhbCB0ZXJtaW5hdGluZy1uZXdsaW5lXG4gIC8vIHJ1bGUgYXBwbGllcyBoZXJlIHRvbzogYSBzdHJlYW0gY3V0IGJlZm9yZSBhbnkgY29tcGxldGUgcmVjb3JkIGlzIG5vdFxuICAvLyBmdWxseSBvYnNlcnZlZCwgc28gYSBwcmV2aWV3IG9mIGEgbnVtYmVyZWQgb3V0cHV0IG11c3Qgbm90IGJlIG1pc3Rha2VuXG4gIC8vIGZvciB1bm51bWJlcmVkIG91dHB1dCBhbmQgbXVzdCBub3QgaW52ZW50IGEgd2hvbGUtZmlsZSB0b3VjaC4gVGhlIGZpbGVcbiAgLy8gbXVzdCBiZSBhIHJlYWRhYmxlIGZpbGUgKGEgZGlyZWN0b3J5IGFyZyBsZWF2ZXMgdGhlIGZhbGxiYWNrXG4gIC8vIHVucmVzb2x2ZWQpLCBhbmQgaXQgbXVzdCBzaXQgaW5zaWRlIHRoZSBkZWNsYXJlZCByb290cyBcdTIwMTQgaXQgaXMgb25lIG9mXG4gIC8vIHRoZW0gYnkgY29uc3RydWN0aW9uLlxuICBpZiAocGVyRmlsZS5zaXplID09PSAwICYmICFpbmZvLm51bWJlcmVkICYmIHN0ZG91dCAhPT0gJycgJiYgc3Rkb3V0LmVuZHNXaXRoKCdcXG4nKSAmJiBzaW5nbGVGaWxlQXJnICE9PSBudWxsKSB7XG4gICAgY29uc3QgYWJzID0gcmVzb2x2ZVBhdGgoZWZmZWN0aXZlRGlyLCBzaW5nbGVGaWxlQXJnKTtcbiAgICBjb25zdCB0b3RhbCA9IGNvdW50RmlsZUxpbmVzKGFicyk7XG4gICAgaWYgKHRvdGFsICE9PSBudWxsICYmIHRvdGFsID4gMCkge1xuICAgICAgc3BhbnMucHVzaCh7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwsIGFic29sdXRlUGF0aDogYWJzIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjYXBTcGFucyhzcGFucyk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEluamVjdGVkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdHJ1Y3R1cmVkIHJlc3VsdCBvZiBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hGaXhSZXN1bHQge1xuICAvKipcbiAgICogV2hldGhlciBgLS1maXhgIHJlLWFuY2hvcmVkIGF0IGxlYXN0IG9uZSBzcGFuIGluIHRoZSB3b3JraW5nIHRyZWUuIERyaXZlc1xuICAgKiB7QGxpbmsgVG91Y2hPdXRwdXQudHJlZU1vZGlmaWVkfSBzbyBhIGNhbGxlci90ZXN0IGNhbiBhc3NlcnQgdGhlIGhlYWxpbmdcbiAgICogaGFwcGVuZWQgd2l0aG91dCBkaWZmaW5nIHRoZSB0cmVlIGl0c2VsZi5cbiAgICovXG4gIG1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSAod3JpdGUgcGF0aFxuICogb25seSksIHJlcG9ydGluZyB3aGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIGhlYWxlZC4gQXN5bmMgc28gdGhlIGV2ZW50dWFsXG4gKiBpbXBsZW1lbnRhdGlvbiBhbmQgaXRzIHRlc3RzIGNhbiBpbmplY3QgYSBmYWtlIHdpdGhvdXQgYSByZWFsIHN1YnByb2Nlc3MuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRml4RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8VG91Y2hGaXhSZXN1bHQ+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8ZmlsZT5gIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyXG4gKiBhbmNob3IgY292ZXJpbmcgdGhlIGZpbGUuIFN0cnVjdHVyZWQgKG5vdCByYXcgc3Rkb3V0KSBzbyB0aGUgbWVyZ2VkLWJsb2NrXG4gKiBjb21wdXRhdGlvbiBhbmQgaXRzIHRlc3RzIHNoYXJlIHRoZSBzYW1lIHNoYXBlLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaExpc3RFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPGFyZ3M+YCAoc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgb3JcbiAqIGl0cyBzcGFucykgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IsIGVtcHR5IHdoZW5cbiAqIGNsZWFuLiBTdGF0dXMgY2xhc3NpZmljYXRpb24gaXMgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWwgKGBNT1ZFRGAsXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaERyaWZ0RXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPERyaWZ0UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBiYXJlIGBnaXQgc3BhbiB3aHkgPG5hbWU+YCBhbmQgcmV0dXJuIHRoZSBzcGFuJ3MgcmVjb3JkZWQgd2h5IHNlbnRlbmNlLFxuICogb3IgYG51bGxgIHdoZW4gbm9uZSBpcyByZWNvcmRlZCBvciB0aGUgcmVhZCBmYWlscy4gRmVlZHMgdGhlIGh1bWFuLWZvcm1hdFxuICogc3BhbiByZW5kZXI7IGludm9rZWQgb25seSBmb3Igc3BhbnMgYWN0dWFsbHkgYmVpbmcgc3VyZmFjZWQgdGhpcyB0b3VjaC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hXaHlFeGVjdXRvciA9IChuYW1lOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZS4gS2VwdCBhcyBmb3VyIG5hcnJvdyBhc3luYyBmdW5jdGlvbnMgKHJhdGhlclxuICogdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgc28gdGVzdHMgaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGFcbiAqIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzIGl0c2VsZi4gVGhlIGByZWFkYCBwYXRoIG5ldmVyIGludm9rZXNcbiAqIGBmaXhgLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRXhlY3V0b3JzIHtcbiAgZml4OiBUb3VjaEZpeEV4ZWN1dG9yO1xuICBsaXN0OiBUb3VjaExpc3RFeGVjdXRvcjtcbiAgZHJpZnQ6IFRvdWNoRHJpZnRFeGVjdXRvcjtcbiAgd2h5OiBUb3VjaFdoeUV4ZWN1dG9yO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIG91dHB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGF0IHRoZSBjb3JlIGhhbmRzIGJhY2sgZm9yIHRoZSBhZGFwdGVyIHRvIHRyYW5zbGF0ZSBpbnRvIFNESyBvdXRwdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoT3V0cHV0IHtcbiAgLyoqXG4gICAqIFRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIChoZWFkZXIsIG9uZSBodW1hbi1mb3JtYXQgc2VjdGlvbiBwZXJcbiAgICogc3VyZmFjZWQgc3BhbiwgZm9vdGVyKSB0byBpbmplY3QgdmlhIHRoZSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCxcbiAgICogb3IgYG51bGxgIHdoZW4gdGhlcmUgaXMgbm90aGluZyB3b3J0aCBzdXJmYWNpbmcgdGhpcyB0b3VjaC5cbiAgICovXG4gIGFkZGl0aW9uYWxDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBtb2RpZmllZCBieSBhIHNjb3BlZCBgLS1maXhgIG9uIHRoZSB3cml0ZSBwYXRoLlxuICAgKiBBbHdheXMgYGZhbHNlYCBvbiB0aGUgcmVhZCBwYXRoIChyZWFkcyBuZXZlciBtdXRhdGUgdGhlIHRyZWUpLlxuICAgKi9cbiAgdHJlZU1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1lcmdlZC1ibG9jayBhc3NlbWJseVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgbWVtbyBrZXkgdW5kZXIgd2hpY2ggYSBzcGFuJ3MgcmVuZGVyIGZvciBhIGdpdmVuIGRyaWZ0IHN0YXR1cyBpcyBkZWR1cGVkLiAqL1xuZnVuY3Rpb24gZHJpZnRLZXkobmFtZTogc3RyaW5nLCBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIC8vIFNwYW4gbmFtZXMgY29tZSBmcm9tIHRhYi1kZWxpbWl0ZWQgcG9yY2VsYWluLCBzbyB0aGV5IG5ldmVyIGNvbnRhaW4gYSB0YWI7XG4gIC8vIGEgdGFiLWpvaW5lZCBrZXkgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhIGJhcmUgc3BhbiBuYW1lICh0aGUgc3VyZmFjaW5nIGtleSkuXG4gIHJldHVybiBgJHtuYW1lfVxcdCR7c3RhdHVzfWA7XG59XG5cbi8qKiBUaGUgYHBhdGgjTHN0YXJ0LUxlbmRgIChvciBiYXJlLXBhdGgsIHdob2xlLWZpbGUpIGFuY2hvciB0ZXh0IGZvciBhIHJvdy4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5IZWFkZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtmaWxlTmFtZX0gaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llczpgO1xufVxuXG5mdW5jdGlvbiBjbGVhbkZvb3RlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBJZiB5b3UgY2hhbmdlICR7ZmlsZU5hbWV9IGNoZWNrIHRoZSBvdGhlciBmaWxlcyB0byBjb25maXJtIHRoZXkgc3RpbGwgd29yayB0b2dldGhlci5gO1xufVxuXG4vKipcbiAqIFRoZSB3cml0ZSBwYXRoIG5hbWVzIHRoZSBlZGl0IGFzIHRoZSBjYXVzZTsgdGhlIHJlYWQgcGF0aCBvbmx5IHN1cmZhY2VzXG4gKiBwcmUtZXhpc3RpbmcgZHJpZnQgaXQgZGlkbid0IGNyZWF0ZSwgc28gaXQgbmFtZXMgdGhlIGRlcGVuZGVuY3kgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gZHJpZnRIZWFkZXIoZHJpZnRlZENvdW50OiBudW1iZXIsIGtpbmQ6IFRvdWNoSW5wdXRbJ2tpbmQnXSk6IHN0cmluZyB7XG4gIGlmIChraW5kID09PSAnd3JpdGUnKSB7XG4gICAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgICAgPyAnVGhpcyBlZGl0IHB1dCBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICAgIDogJ1RoaXMgZWRpdCBwdXQgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG4gIH1cbiAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgID8gJ1RoaXMgZmlsZSBoYXMgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgOiAnVGhpcyBmaWxlIGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6Jztcbn1cblxuZnVuY3Rpb24gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGlmIChkcmlmdGVkTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbmFtZSA9IGRyaWZ0ZWROYW1lc1swXTtcbiAgICByZXR1cm4gYFJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHN3YXAgdGhlIG9sZCBhbmNob3IgZm9yIHRoZSBuZXcgb25lIHdpdGggXFxgZ2l0IHNwYW4gcmVwbGFjZVxcYC4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBcXGBnaXQgc3BhbiBkcmlmdCAke25hbWV9XFxgIHRvIHJlcG9ydCB6ZXJvLCB0aGVuIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzLiBDb25mb3JtIGEgc2lkZSBvbmx5IHdoZW4gY29uZmlybWVkIGF1dGhvcml0eSBvciBhIHNhdGlzZmllZCBnYXRlIGRlY2lkZXMgaXQ7IHJlcG9ydCBhbWJpZ3VpdHkgb3IgYW4gb2Jzb2xldGUgY291cGxpbmcuYDtcbiAgfVxuICByZXR1cm4gJ0ZvciBlYWNoIG91dC1vZi1kYXRlIHNwYW46IHJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHN3YXAgdGhlIG9sZCBhbmNob3IgZm9yIHRoZSBuZXcgb25lIHdpdGggYGdpdCBzcGFuIHJlcGxhY2VgLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIGBnaXQgc3BhbiBkcmlmdCA8bmFtZT5gIHRvIHJlcG9ydCB6ZXJvLCB0aGVuIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzLiBDb25mb3JtIGEgc2lkZSBvbmx5IHdoZW4gY29uZmlybWVkIGF1dGhvcml0eSBvciBhIHNhdGlzZmllZCBnYXRlIGRlY2lkZXMgaXQ7IHJlcG9ydCBhbWJpZ3VpdHkgb3IgYW4gb2Jzb2xldGUgY291cGxpbmcuJztcbn1cblxuLyoqIFRoZSB7QGxpbmsgUmFuZ2VMYWJlbH0gZm9yIGEgcG9yY2VsYWluIHJvdyBcdTIwMTQgYDAtMGAgaXMgdGhlIHdob2xlLWZpbGUgYW5jaG9yLiAqL1xuZnVuY3Rpb24gcmFuZ2VMYWJlbChyb3c6IFBvcmNlbGFpblJvdyk6IFJhbmdlTGFiZWwge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9O1xuICByZXR1cm4geyBraW5kOiAncmFuZ2UnLCBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfTtcbn1cblxuLyoqXG4gKiBBIHNwYW4ncyBmdWxsIGFuY2hvciBsaXN0LCByZW5kZXJlZCBhcyBhIHNoYXJlZC1wcmVmaXggdHJlZSBieVxuICoge0BsaW5rIHJlbmRlckFuY2hvclRyZWV9LCB3aXRoIGVhY2ggYW5jaG9yIHRoYXQgY2FycmllcyBnZW51aW5lIGRyaWZ0XG4gKiBzdWZmaXhlZCBieSBpdHMgbG93ZXJjYXNlIHN0YXR1cyB0b2tlbihzKSAoYCBcdTIwMTQgY2hhbmdlZGApLlxuICpcbiAqIEEgZHJpZnQgcm93IG1hdGNoZXMgYW4gYW5jaG9yIGJ5IGV4YWN0IHBhdGgrcmFuZ2UsIG9yIGJ5IHBhdGggYWxvbmUgd2hlbiB0aGVcbiAqIHNwYW4gaGFzIGEgc2luZ2xlIGFuY2hvciBvbiB0aGF0IHBhdGggKHJhbmdlcyBjYW4gZGlzYWdyZWUgYWZ0ZXIgYSBoZWFsKS5cbiAqIGBzb2xlT25QYXRoYCBpcyBkZWxpYmVyYXRlbHkgY29tcHV0ZWQgb3ZlciB0aGUgKipmdWxsIGZsYXQgYW5jaG9yIGxpc3QqKixcbiAqIGJlZm9yZSBhbnkgZ3JvdXBpbmcgXHUyMDE0IHRoZSB0cmVlIGxheW91dCBtdXN0IG5ldmVyIGJlIGFibGUgdG8gY2hhbmdlICp3aGljaCpcbiAqIGFuY2hvcnMgZ2V0IGxhYmVsZWQsIG9ubHkgd2hlcmUgdGhleSBzaXQgb24gdGhlIHBhZ2UuXG4gKi9cbmZ1bmN0aW9uIGFuY2hvckJ1bGxldHMoYW5jaG9yczogUG9yY2VsYWluUm93W10sIGRlYnRSb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdKTogc3RyaW5nW10ge1xuICBjb25zdCByb3dzID0gYW5jaG9ycy5tYXAoKGFuY2hvcikgPT4ge1xuICAgIGNvbnN0IHNvbGVPblBhdGggPSBhbmNob3JzLmZpbHRlcigoYSkgPT4gYS5wYXRoID09PSBhbmNob3IucGF0aCkubGVuZ3RoID09PSAxO1xuICAgIGNvbnN0IHN0YXR1c2VzID0gbmV3IFNldDxQb3JjZWxhaW5TdGF0dXM+KCk7XG4gICAgZm9yIChjb25zdCByb3cgb2YgZGVidFJvd3MpIHtcbiAgICAgIGlmIChyb3cucGF0aCAhPT0gYW5jaG9yLnBhdGgpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNvbGVPblBhdGggfHwgKHJvdy5zdGFydCA9PT0gYW5jaG9yLnN0YXJ0ICYmIHJvdy5lbmQgPT09IGFuY2hvci5lbmQpKSB7XG4gICAgICAgIHN0YXR1c2VzLmFkZChyb3cuc3RhdHVzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnN0YXR1c2VzXS5zb3J0KCk7XG4gICAgY29uc3Qgc3VmZml4ID0gc29ydGVkLmxlbmd0aCA+IDAgPyBgIFx1MjAxNCAke3NvcnRlZC5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gIDogJyc7XG4gICAgcmV0dXJuIHsgcGF0aDogYW5jaG9yLnBhdGgsIHJhbmdlOiByYW5nZUxhYmVsKGFuY2hvciksIHN1ZmZpeCB9O1xuICB9KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVuZGVyQW5jaG9yVHJlZShjb2xsYXBzZUJ5UGF0aChyb3dzKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IGRvIG5vdCByZW1vdmUgaXRcbiAgICAvLyBvbiB0aGUgdGhlb3J5IHRoYXQgYSBkZWdyYWRlZCBmYWxsYmFjayBpcyBpdHNlbGYgZm9yYmlkZGVuLiBBbiB1bmNhdWdodFxuICAgIC8vIHRocm93IGhlcmUgZG9lcyBub3QgZGVncmFkZSB0byBhIGZsYXQgbGlzdDogaXQgZXNjYXBlcyB0b1xuICAgIC8vIGBydW5Ub3VjaEhvb2tgJ3MgY2F0Y2gsIHdoaWNoIHJlc29sdmVzIHRoZSB3aG9sZSBob29rIHRvXG4gICAgLy8gYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCwgc28gdGhlIGFnZW50IGlzIG5ldmVyIHRvbGQgYWJvdXQgdGhlIGRyaWZ0IGF0XG4gICAgLy8gYWxsLiBDYXRjaGluZyBsb2NhbGx5IG5hcnJvd3Mgd2hhdCBhIHJlbmRlcmluZyBkZWZlY3QgY2FuIGNvc3QgZnJvbSBcInRoZVxuICAgIC8vIHJlbWluZGVyIGRpc2FwcGVhcnNcIiB0byBcInRoZSByZW1pbmRlciBsb29rcyBsaWtlIGl0IGRpZCBiZWZvcmUgdGhlIHRyZWVcIi5cbiAgICAvLyBXaGV0aGVyIHRvIHN1cmZhY2UgYW5kIHdoYXQgc2hhcGUgdG8gc3VyZmFjZSBpbiBhcmUgZGlmZmVyZW50IHRoaW5ncywgYW5kXG4gICAgLy8gdGhpcyBjYXRjaCBvbmx5IGV2ZXIgdG91Y2hlcyB0aGUgbGF0dGVyLlxuICAgIC8vIGByb3dzYCBpcyBpbmRleC1hbGlnbmVkIHdpdGggYGFuY2hvcnNgLCBzbyB0aGlzIHJlcHJvZHVjZXMgdG9kYXkncyBmbGF0XG4gICAgLy8gYnVsbGV0IHJ1biBieXRlIGZvciBieXRlLCBzdWZmaXhlcyBpbmNsdWRlZC5cbiAgICByZXR1cm4gYW5jaG9ycy5tYXAoKGFuY2hvciwgaSkgPT4gYC0gJHthbmNob3JUZXh0KGFuY2hvcil9JHtyb3dzW2ldLnN1ZmZpeH1gKTtcbiAgfVxufVxuXG4vKipcbiAqIE9uZSBodW1hbi1mb3JtYXQgc3BhbiBzZWN0aW9uOiBgIyMgPG5hbWU+YCwgdGhlIGZ1bGwgYW5jaG9yIGxpc3QgKGRyaWZ0ZWRcbiAqIGFuY2hvcnMgc3RhdHVzLXN1ZmZpeGVkKSwgYW5kIHRoZSB3aHkgc2VudGVuY2Ugd2hlbiBvbmUgaXMgcmVjb3JkZWQuXG4gKlxuICogVGhlIG5hbWUgaGVhZGVyIGFuZCB0aGUgd2h5IHNlbnRlbmNlIGFyZSB0aGUgc2FtZSBzaGFwZSBgZ2l0IHNwYW4gbGlzdGBcbiAqIHJlbmRlcnM7IHRoZSBhbmNob3IgbGlzdCBkZWxpYmVyYXRlbHkgaXMgbm90IFx1MjAxNCBpdCByZW5kZXJzIGFzIGEgc2hhcmVkLXByZWZpeFxuICogdHJlZSAoe0BsaW5rIGFuY2hvckJ1bGxldHN9KSB3aGVyZSB0aGUgQ0xJIHByaW50cyBhIGZsYXQgYC0gcGF0aCNMcmFuZ2VgXG4gKiBidWxsZXQgcnVuLiBUaGUgQ0xJJ3Mgb3duIHRleHQgZm9ybWF0IGlzIHVudG91Y2hlZDsgb25seSB0aGlzIGhvb2snc1xuICogcmUtcHJlc2VudGF0aW9uIG9mIGl0IGdyb3Vwcy5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3BhblNlY3Rpb24oXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yczogUG9yY2VsYWluUm93W10sXG4gIGRlYnRSb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdLFxuICB3aHk6IHN0cmluZyB8IG51bGxcbik6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gW2AjIyAke25hbWV9YCwgLi4uYW5jaG9yQnVsbGV0cyhhbmNob3JzLCBkZWJ0Um93cyldO1xuICBpZiAod2h5KSBsaW5lcy5wdXNoKCcnLCB3aHkpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogQXNzZW1ibGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2s6IGhlYWRlciwgb25lIHNlY3Rpb24gcGVyIHN1cmZhY2VkXG4gKiBzcGFuIChzZXBhcmF0ZWQgYnkgYC0tLWApLCBhbmQgYSBzaW5nbGUgZm9vdGVyIGFmdGVyIGEgZmluYWwgYC0tLWAuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQmxvY2soc2VjdGlvbnM6IHN0cmluZ1tdLCBoZWFkZXI6IHN0cmluZywgZm9vdGVyOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBib2R5ID0gYCR7aGVhZGVyfVxcblxcbiR7c2VjdGlvbnMuam9pbignXFxuXFxuLS0tXFxuXFxuJyl9XFxuXFxuLS0tXFxuXFxuJHtmb290ZXJ9YDtcbiAgcmV0dXJuIGBcXG48Z2l0LXNwYW4+XFxuJHtib2R5fVxcbjwvZ2l0LXNwYW4+XFxuYDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBob29rIGVudHJ5IHBvaW50XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgaW4gc2NvcGUgZm9yIHRoZSByZWNvdmVyZWQgcmFuZ2UuICovXG5mdW5jdGlvbiBpbnRlcnNlY3RzKHJvdzogUG9yY2VsYWluUm93LCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnKTogYm9vbGVhbiB7XG4gIGlmIChyYW5nZSA9PT0gJ3dob2xlLWZpbGUnKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gdHJ1ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgcmV0dXJuIHJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgdG91Y2hlZCByYW5nZSBmcm9tIHRoZSBvbi1kaXNrIGZpbGUgZm9yIGEgd3JpdGUuIEFuIGVtcHR5IHdyaXRlIG9yXG4gKiBhbiB1bnJlYWRhYmxlIGZpbGUgKGUuZy4gYSBkZWxldGUsIG9yIHRoZSBmaWxlIHdhcyBuZXZlciB3cml0dGVuKSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AsIHNjb3BpbmcgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gXHUyMDE0IHRoZSBmYWlsLW9wZW5cbiAqIGJlaGF2aW9yLCBub3QgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZUZyb21EaXNrKHdyaXR0ZW46IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgbGV0IGNvbnRlbnQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIHJldHVybiByZWNvdmVyUmFuZ2Uod3JpdHRlbiwgY29udGVudCk7XG59XG5cbi8qKlxuICogVGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGRvY3VtZW50ZWQgZGVmYXVsdCBsaW5lIGNvdW50IHdoZW4gYG9mZnNldGAgaXNcbiAqIGdpdmVuIHdpdGhvdXQgYGxpbWl0YCAoXCJCeSBkZWZhdWx0LCBpdCByZWFkcyB1cCB0byAyMDAwIGxpbmVzXCIpLiBOYW1lZCBzb1xuICogdGhlIGFzc3VtcHRpb24gaXMgdmlzaWJsZSBhbmQgZWFzeSB0byB1cGRhdGUgaWYgdGhhdCBkZWZhdWx0IGV2ZXIgY2hhbmdlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVBRF9MSU1JVCA9IDIwMDA7XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgdG91Y2hlZCByYW5nZSBmb3IgYSByZWFkIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzXG4gKiBgb2Zmc2V0YC9gbGltaXRgIGlucHV0cy4gTmVpdGhlciBwcmVzZW50IG1lYW5zIGEgZ2VudWluZSB3aG9sZS1maWxlIHJlYWQgXHUyMDE0XG4gKiBldmVyeSBjb3ZlcmluZyBzcGFuIHN0YXlzIGluIHNjb3BlLCBtYXRjaGluZyB0b2RheSdzIGJlaGF2aW9yLiBPdGhlcndpc2VcbiAqIHRoZSByYW5nZSBzdGFydHMgYXQgYG9mZnNldGAgKGRlZmF1bHQgbGluZSAxKSBhbmQgcnVucyBmb3IgYGxpbWl0YCBsaW5lc1xuICogKGRlZmF1bHQge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH0pLCBjbGFtcGVkIHRvIHRoZSBmaWxlJ3MgYWN0dWFsIGxpbmVcbiAqIGNvdW50IHNvIGEgc2hvcnQgZmlsZSB3aXRoIGEgbGFyZ2UgYG9mZnNldGAvYGxpbWl0YCBkb2Vzbid0IG92ZXJzaG9vdC5cbiAqIENsYW1waW5nIHJlcXVpcmVzIHJlYWRpbmcgdGhlIGZpbGU7IGFuIHVucmVhZGFibGUgZmlsZSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AgXHUyMDE0IHRoZSBzYW1lIGZhaWwtb3BlbiBiZWhhdmlvciB0aGUgd3JpdGUgcGF0aCB1c2VzLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmVhZFJhbmdlKFxuICBvZmZzZXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgbGltaXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgZmlsZVBhdGg6IHN0cmluZ1xuKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkICYmIGxpbWl0ID09PSB1bmRlZmluZWQpIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGNvbnN0IHN0YXJ0ID0gb2Zmc2V0ID8/IDE7XG4gIGxldCBsaW5lQ291bnQ6IG51bWJlcjtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgIGxpbmVDb3VudCA9IGNvbnRlbnQubGVuZ3RoID09PSAwID8gMCA6IGNvbnRlbnQuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICBjb25zdCBlbmQgPSBNYXRoLm1pbihzdGFydCArIChsaW1pdCA/PyBERUZBVUxUX1JFQURfTElNSVQpIC0gMSwgTWF0aC5tYXgobGluZUNvdW50LCBzdGFydCkpO1xuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbi8qKlxuICogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBhbiBhbmNob3IgaW4gdGhlIHRvdWNoZWQgZmlsZSBpdHNlbGYuIGBsaXN0XG4gKiAtLXBvcmNlbGFpbiA8ZmlsZT5gIHJldHVybnMgZXZlcnkgYW5jaG9yIG9mIGVhY2ggbWF0Y2hpbmcgc3BhbiBcdTIwMTQgY3Jvc3MtZmlsZVxuICogYW5jaG9ycyBpbmNsdWRlZCBcdTIwMTQgYnV0IG9ubHkgYW5jaG9ycyBpbiB0aGUgdG91Y2hlZCBmaWxlIHBhcnRpY2lwYXRlIGluIHRoZVxuICogcmFuZ2UtaW50ZXJzZWN0aW9uIHNjb3BlIHRlc3QuIFJvdyBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZTsgdGhlIHRvdWNoZWQgcGF0aFxuICogaXMgYWJzb2x1dGUsIHNvIG1hdGNoIG9uIGFuIGV4YWN0IG9yIGAvYC1zZXBhcmF0ZWQgc3VmZml4LlxuICovXG5mdW5jdGlvbiBvblRvdWNoZWRGaWxlKHJvdzogUG9yY2VsYWluUm93LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBmaWxlUGF0aCA9PT0gcm93LnBhdGggfHwgZmlsZVBhdGguZW5kc1dpdGgoYC8ke3Jvdy5wYXRofWApO1xufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZSB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlcmUgaXNcbiAqIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nLiBTaGFyZWQgYnkgYm90aCBwYXRoczsgdGhlIHdyaXRlIHBhdGggcGFzc2VzIGFcbiAqIHJlY292ZXJlZCByYW5nZSBmb3IgcHJlY2lzaW9uLCB0aGUgcmVhZCBwYXRoIHNjb3BlcyBmaWxlLXdpZGUuXG4gKlxuICogQSBzcGFuIHJlbmRlcnMgYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIChuYW1lLCBhbGwgYW5jaG9ycyB3aXRoXG4gKiBkcmlmdGVkIG9uZXMgc3RhdHVzLXN1ZmZpeGVkLCB3aHkpIHdoZW4gaXRzIG5hbWUgaGFzIG5vdCBiZWVuIHN1cmZhY2VkIHRoaXNcbiAqIHNlc3Npb24sIG9yIHdoZW4gaXQgY2FycmllcyBhIGRyaWZ0IHN0YXR1cyBub3QgeWV0IHN1cmZhY2VkIGZvciBpdCBcdTIwMTQgc28gYVxuICogc3BhbiBmaXJzdCBzZWVuIGhlYWx0aHkgcmUtcmVuZGVycyBpbiBmdWxsIHdoZW4gZHJpZnQgbGF0ZXIgYXBwZWFycy4gQSBzcGFuXG4gKiB3aG9zZSBvbmx5IGRyaWZ0IGlzIHBvc2l0aW9uYWwgKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBcdTIwMTQgbmV2ZXJcbiAqIGBpc0RlYnRgKSBpcyBmaWx0ZXJlZCBvdXQgZW50aXJlbHk6IHBvc2l0aW9uYWwgZHJpZnQgbmV2ZXIgc3VyZmFjZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVTdXJmYWNlKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnXG4pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgaWYgKGNvdmVyaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gR3JvdXAgZXZlcnkgYW5jaG9yIGJ5IHNwYW47IGEgc3BhbiBpcyBpbiBzY29wZSB3aGVuIG9uZSBvZiBpdHMgYW5jaG9ycyBvblxuICAvLyB0aGUgdG91Y2hlZCBmaWxlIGludGVyc2VjdHMgdGhlIHJlY292ZXJlZCByYW5nZS5cbiAgY29uc3QgYW5jaG9yc0J5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgY292ZXJpbmcpIHtcbiAgICBjb25zdCByb3dzID0gYW5jaG9yc0J5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGFuY2hvcnNCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuICBjb25zdCB0b3VjaGVkTmFtZXMgPSBbLi4uYW5jaG9yc0J5TmFtZS5rZXlzKCldLmZpbHRlcigobmFtZSkgPT5cbiAgICAoYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10pLnNvbWUoKHJvdykgPT4gb25Ub3VjaGVkRmlsZShyb3csIGlucHV0LmZpbGVQYXRoKSAmJiBpbnRlcnNlY3RzKHJvdywgcmFuZ2UpKVxuICApO1xuICBpZiAodG91Y2hlZE5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZHJpZnRSb3dzID0gYXdhaXQgZXhlY3V0b3JzLmRyaWZ0KFtpbnB1dC5maWxlUGF0aF0sIGlucHV0LmN3ZCk7XG4gIGNvbnN0IGRyaWZ0QnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIERyaWZ0UG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGRyaWZ0Um93cykge1xuICAgIGNvbnN0IHJvd3MgPSBkcmlmdEJ5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGRyaWZ0QnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cblxuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9SZWNvcmQ6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHNlY3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBkcmlmdGVkTmFtZXM6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBuYW1lIG9mIHRvdWNoZWROYW1lcykge1xuICAgIGNvbnN0IHNwYW5EcmlmdCA9IGRyaWZ0QnlOYW1lLmdldChuYW1lKSA/PyBbXTtcbiAgICBjb25zdCBkZWJ0Um93cyA9IHNwYW5EcmlmdC5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBpZiAoc3BhbkRyaWZ0Lmxlbmd0aCA+IDAgJiYgZGVidFJvd3MubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gcG9zaXRpb25hbC1vbmx5IGRyaWZ0IG5ldmVyIHN1cmZhY2VzXG5cbiAgICBjb25zdCBkZWJ0U3RhdHVzZXMgPSBbLi4ubmV3IFNldChkZWJ0Um93cy5tYXAoKHJvdykgPT4gcm93LnN0YXR1cykpXS5zb3J0KCk7XG4gICAgY29uc3QgdW5zdXJmYWNlZERlYnQgPSBkZWJ0U3RhdHVzZXMuZmlsdGVyKChzdGF0dXMpID0+ICFzdXJmYWNlZC5oYXMoZHJpZnRLZXkobmFtZSwgc3RhdHVzKSkpO1xuICAgIGNvbnN0IGlzTmV3TmFtZSA9ICFzdXJmYWNlZC5oYXMobmFtZSk7XG4gICAgaWYgKCFpc05ld05hbWUgJiYgdW5zdXJmYWNlZERlYnQubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gZnVsbHkgc3VyZmFjZWQgYWxyZWFkeVxuXG4gICAgY29uc3Qgd2h5ID0gYXdhaXQgZXhlY3V0b3JzLndoeShuYW1lLCBpbnB1dC5jd2QpO1xuICAgIHNlY3Rpb25zLnB1c2gocmVuZGVyU3BhblNlY3Rpb24obmFtZSwgYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10sIGRlYnRSb3dzLCB3aHkpKTtcbiAgICBpZiAoZGVidFN0YXR1c2VzLmxlbmd0aCA+IDApIGRyaWZ0ZWROYW1lcy5wdXNoKG5hbWUpO1xuXG4gICAgaWYgKGlzTmV3TmFtZSkgdG9SZWNvcmQucHVzaChuYW1lKTtcbiAgICBmb3IgKGNvbnN0IHN0YXR1cyBvZiB1bnN1cmZhY2VkRGVidCkgdG9SZWNvcmQucHVzaChkcmlmdEtleShuYW1lLCBzdGF0dXMpKTtcbiAgfVxuXG4gIGlmIChzZWN0aW9ucy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBtZW1vLmFkZFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCwgdG9SZWNvcmQpO1xuICBjb25zdCBmaWxlTmFtZSA9IGJhc2VuYW1lKGlucHV0LmZpbGVQYXRoKTtcbiAgY29uc3QgaGVhZGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEhlYWRlcihkcmlmdGVkTmFtZXMubGVuZ3RoLCBpbnB1dC5raW5kKSA6IGNsZWFuSGVhZGVyKGZpbGVOYW1lKTtcbiAgY29uc3QgZm9vdGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXMpIDogY2xlYW5Gb290ZXIoZmlsZU5hbWUpO1xuICByZXR1cm4gYnVpbGRCbG9jayhzZWN0aW9ucywgaGVhZGVyLCBmb290ZXIpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgdG91Y2ggaG9vayBmb3IgYSBzaW5nbGUgdG9vbCBjYWxsLCBicmFuY2hpbmcgb24ge0BsaW5rIFRvdWNoSW5wdXQua2luZH0uXG4gKlxuICogLSAqKldyaXRlIHBhdGgqKjogcnVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGApIHNjb3BlZFxuICogICB0byB0aGUgdG91Y2hlZCBmaWxlIHRvIGhlYWwgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlLCB0aGVuXG4gKiAgIGNvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgYWdhaW5zdCB0aGUgaGVhbGVkIGFuY2hvcnMsIHJlbmRlcmluZ1xuICogICBlYWNoIHN1cmZhY2VkIHNwYW4gYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHdpdGggYW55IHJlbWFpbmluZ1xuICogICBzZW1hbnRpYyBkcmlmdCBzdGF0dXMtc3VmZml4ZWQgb24gaXRzIGFuY2hvcnMuIENhZGVuY2UgaXMgZGVkdXBlZCB0aHJvdWdoXG4gKiAgIGBtZW1vYCBwZXIgc3BhbiBuYW1lIGFuZCBwZXIgKHNwYW4sIHN0YXR1cykuXG4gKiAtICoqUmVhZCBwYXRoKio6IG5ldmVyIGludm9rZXMgYGZpeGAgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWU7IHN1cmZhY2VzIHRoZVxuICogICBzcGFucyBvdmVybGFwcGluZyB0aGUgcmVhZCdzIGBvZmZzZXRgL2BsaW1pdGAgd2luZG93IChzZWVcbiAqICAge0BsaW5rIHJlY292ZXJSZWFkUmFuZ2V9OyBhIHJlYWQgd2l0aCBuZWl0aGVyIGlzIHdob2xlLWZpbGUsIG1hdGNoaW5nXG4gKiAgIHRvZGF5J3MgYmVoYXZpb3IpIHdpdGggcG9zaXRpb25hbCBzdGF0dXNlcyBmaWx0ZXJlZCBvdXQgdmlhIGBpc0RlYnQoKWAuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZVxuKTogUHJvbWlzZTxUb3VjaE91dHB1dD4ge1xuICBsZXQgdHJlZU1vZGlmaWVkID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgbGV0IHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScgPSAnd2hvbGUtZmlsZSc7XG4gICAgaWYgKGlucHV0LmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgIGNvbnN0IGZpeCA9IGF3YWl0IGV4ZWN1dG9ycy5maXgoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gICAgICB0cmVlTW9kaWZpZWQgPSBmaXgubW9kaWZpZWQ7XG4gICAgICByYW5nZSA9IHJlY292ZXJSYW5nZUZyb21EaXNrKGlucHV0LndyaXR0ZW4sIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmVhZFJhbmdlKGlucHV0Lm9mZnNldCwgaW5wdXQubGltaXQsIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9XG4gICAgY29uc3QgYWRkaXRpb25hbENvbnRleHQgPSBhd2FpdCBjb21wdXRlU3VyZmFjZShpbnB1dCwgZXhlY3V0b3JzLCBtZW1vLCByYW5nZSk7XG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQsIHRyZWVNb2RpZmllZCB9O1xuICB9IGNhdGNoIHtcbiAgICAvLyBGYWlsIG9wZW46IG5ldmVyIGxldCBhIHRvdWNoLWNvcmUgZXJyb3IgcHJvcGFnYXRlIHVwIGFuZCBibG9jayB0aGUgdG9vbFxuICAgIC8vIGNhbGwuIFRoZSB0cmVlIG1heSBhbHJlYWR5IGhhdmUgYmVlbiBoZWFsZWQgKHRyZWVNb2RpZmllZCBwcmVzZXJ2ZWQpLlxuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUmVzb2x2ZSB0aGUgdG91Y2hlZCBmaWxlIHRvIGEgcGF0aCByZWxhdGl2ZSB0byBpdHMgcmVwbyByb290LCBmb3IgYGdpdCBzcGFuYC4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxBcmcoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpOiB7IHJlcG9Sb290OiBzdHJpbmc7IHJlbFBhdGg6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuICByZXR1cm4geyByZXBvUm9vdCwgcmVsUGF0aDogcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGZpbGVQYXRoKSB9O1xufVxuXG4vKipcbiAqIEEgc25hcHNob3Qgb2YgdGhlIHNwYW4gcm9vdCdzIHdvcmtpbmctdHJlZSBzdGF0dXMsIHVzZWQgdG8gZGV0ZWN0IHdoZXRoZXIgYVxuICogYC0tZml4YCByZS1hbmNob3JlZCBhbnl0aGluZy4gQ29tcGFyZWQgYmVmb3JlL2FmdGVyOyBhbiB1bnJlc29sdmFibGUgcmVwbyBvclxuICogYSBmYWlsZWQgc3RhdHVzIHlpZWxkcyBhIHN0YWJsZSBlbXB0eSBzdHJpbmcgKFx1MjE5MiBgbW9kaWZpZWQ6IGZhbHNlYCkuXG4gKi9cbmZ1bmN0aW9uIHNwYW5TdGF0dXNTbmFwc2hvdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICB0cnkge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICctLScsIHNwYW5Sb290XSwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGV4ZWN1dGlvbiBzdXJmYWNlOiB0aHJlZSBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnMgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBgY3JlYXRlRGVmYXVsdCpFeGVjdXRvcmAgc3R5bGUuIEVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW4gb25cbiAqIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4gKiBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBwYXJzZSBmYWlsdXJlKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHRcbiAqIHNvIHtAbGluayBydW5Ub3VjaEhvb2t9J3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogVG91Y2hFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiB7IG1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgYmVmb3JlID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgcmVzb2x2ZWQucmVsUGF0aCwgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZyxcbiAgICAgICAgLy8gYW5kIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlIHBhcnNlci5cbiAqXG4gKiBUdXJucyBhIENvZGV4IGBhcHBseV9wYXRjaGAgYHRvb2xfaW5wdXQuY29tbWFuZGAgcGF0Y2ggc3RyaW5nIGludG8gdGhlXG4gKiBgQW5jaG9yU3BlY1tdYCBzaGFwZSB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgYWxyZWFkeSBjb25zdW1lcyBcdTIwMTQgdGhlIG9uZVxuICogZ2VudWluZWx5IG5ldyBhbGdvcml0aG0gdGhlIENvZGV4IGFkYXB0ZXIgbmVlZHMuIEl0IHJlcGxhY2VzIHRoZSBzdHJ1Y3R1cmVkXG4gKiBgZmlsZV9wYXRoYC9gb2xkX3N0cmluZ2AvYG9mZnNldGAgcmVhZGluZyB0aGUgQ2xhdWRlIFBvc3RUb29sVXNlIHRvdWNoIGhvb2tcbiAqIGRvZXMsIGJlY2F1c2UgQ29kZXggZGVsaXZlcnMgZXZlcnkgZWRpdCBhcyBhIHNpbmdsZSBhcHBseV9wYXRjaCBlbnZlbG9wZVxuICogcmF0aGVyIHRoYW4gYSB0eXBlZCB0b29sIGlucHV0LlxuICpcbiAqIFRoZSBtb2R1bGUgaXMgcHVyZTogaXQgaW1wb3J0cyBvbmx5IHRoZSBrZXJuZWwgYW5jaG9yIHR5cGVzIGFuZCBuZXZlciB0b3VjaGVzXG4gKiB0aGUgQ29kZXggU0RLLCBzbyBpdCBpcyBESS10ZXN0YWJsZSBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZVxuICogc2hhcmVkIGtlcm5lbC4gUmFuZ2UgcmVjb3ZlcnkgaXMgYmVzdC1lZmZvcnQgXHUyMDE0IHRoZSBhcHBseV9wYXRjaCBmb3JtYXQgY2Fycmllc1xuICogYEBAYCBjb250ZXh0IGFuZCBgK2AvYC1gL3NwYWNlIGNoYW5nZSBsaW5lcyBidXQgbm8gZXhwbGljaXQgbGluZSBudW1iZXJzLCBzbyBhXG4gKiByYW5nZSBjYW4gb25seSBiZSByZWNvdmVyZWQgYnkgbG9jYXRpbmcgYSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlXG4gKiBvbi1kaXNrIGZpbGUuIFRoYXQgZmlsZSByZWFkIGlzIGluamVjdGVkIChgcmVhZFByZUVkaXRGaWxlYCkgc28gdGhlIGZ1bmN0aW9uXG4gKiBzdGF5cyBwdXJlIGFuZCB0ZXN0YWJsZS4gT24gQU5ZIGFtYmlndWl0eSAobm8gcmVhZGVyLCBmaWxlIG1pc3NpbmcsIGNvbnRleHRcbiAqIG5vdCBmb3VuZCwgZnV6enkvZHVwbGljYXRlIG1hdGNoKSB0aGUgcGFyc2VyIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3JcbiAqIHJhdGhlciB0aGFuIHRocm93aW5nIFx1MjAxNCB3aG9sZS1maWxlIGFuY2hvcnMgYXJlIGZpcnN0LWNsYXNzIGFuZCB0b3VjaCB0cmFja2luZ1xuICogbXVzdCBuZXZlciBiZSBibG9ja2VkLlxuICpcbiAqIFRoZSBncmFtbWFyIGlzIGNyb3NzLWNoZWNrZWQgYWdhaW5zdCBDb2RleCdzIG93biBhcHBseV9wYXRjaCBjcmF0ZVxuICogKGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy97cGFyc2VyLHN0cmVhbWluZ19wYXJzZXJ9LnJzKS4gVHdvIHN1YnRsZXRpZXMgYXJlXG4gKiBtaXJyb3JlZCBkZWxpYmVyYXRlbHk6IGh1bmstaGVhZGVyIG1hcmtlcnMgYXJlIG9ubHkgcmVjb2duaXplZCBhdCB0aGUgc3RhcnQgb2ZcbiAqIGEgbGluZSB3aXRoIG5vIGxlYWRpbmcgd2hpdGVzcGFjZSB3aGlsZSBpbnNpZGUgYW4gVXBkYXRlIGh1bmsgKGEgbGVhZGluZyBzcGFjZVxuICogZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSksIGFuZCBhIGJhcmUgZW1wdHkgbGluZSBpbnNpZGUgYW4gVXBkYXRlXG4gKiBodW5rIGlzIHRyZWF0ZWQgYXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldyBjb250ZW50LlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHR5cGUgeyBBbmNob3JTcGVjLCBMaW5lUmFuZ2UgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcblxuLyoqXG4gKiBSZWFkcyB0aGUgcHJlLWVkaXQgKG9uLWRpc2ssIGJlZm9yZSB0aGUgcGF0Y2ggYXBwbGllcykgY29udGVudCBvZiB0aGUgZmlsZSBhdFxuICogYHBhdGhgLCBvciByZXR1cm5zIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSByZWFkLiBJbmplY3RlZCBzbyB0aGUgcGFyc2VyIHN0YXlzXG4gKiBwdXJlOyBjYWxsIHNpdGVzIGRlZmF1bHQgdG8gYSByZWFsIGZpbGVzeXN0ZW0gcmVhZC5cbiAqL1xuZXhwb3J0IHR5cGUgUmVhZFByZUVkaXRGaWxlID0gKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHcmFtbWFyIG1hcmtlcnMgKG1pcnJvcnMgY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3BhcnNlci5ycylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBFTkRfUEFUQ0hfTUFSS0VSID0gJyoqKiBFbmQgUGF0Y2gnO1xuY29uc3QgQUREX0ZJTEVfTUFSS0VSID0gJyoqKiBBZGQgRmlsZTogJztcbmNvbnN0IERFTEVURV9GSUxFX01BUktFUiA9ICcqKiogRGVsZXRlIEZpbGU6ICc7XG5jb25zdCBVUERBVEVfRklMRV9NQVJLRVIgPSAnKioqIFVwZGF0ZSBGaWxlOiAnO1xuY29uc3QgTU9WRV9UT19NQVJLRVIgPSAnKioqIE1vdmUgdG86ICc7XG5jb25zdCBFT0ZfTUFSS0VSID0gJyoqKiBFbmQgb2YgRmlsZSc7XG5jb25zdCBDSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAgJztcbmNvbnN0IEVNUFRZX0NIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW50ZXJtZWRpYXRlIGh1bmsgbW9kZWxcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgVXBkYXRlQ2h1bmsge1xuICAvKiogT3B0aW9uYWwgYEBAIDxjb250ZXh0PmAgbGluZSB1c2VkIHRvIGRpc2FtYmlndWF0ZSB0aGUgYmxvY2sncyBsb2NhdGlvbi4gKi9cbiAgY2hhbmdlQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIFByZS1lZGl0IGxpbmVzIHRoaXMgY2h1bmsgY292ZXJzIChjb250ZXh0IGAgYCArIHJlbW92ZWQgYC1gKSwgaW4gb3JkZXIuICovXG4gIG9sZExpbmVzOiBzdHJpbmdbXTtcbiAgLyoqIFBvc3QtZWRpdCBsaW5lcyAoY29udGV4dCBgIGAgKyBhZGRlZCBgK2ApOyByZXRhaW5lZCBmb3IgY29tcGxldGVuZXNzLiAqL1xuICBuZXdMaW5lczogc3RyaW5nW107XG59XG5cbnR5cGUgSHVuayA9XG4gIHwgeyBraW5kOiAnYWRkJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICdkZWxldGUnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ3VwZGF0ZSc7IHBhdGg6IHN0cmluZzsgbW92ZVBhdGg6IHN0cmluZyB8IG51bGw7IGNodW5rczogVXBkYXRlQ2h1bmtbXSB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgcmVhZGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWFsLWZpbGVzeXN0ZW0gcmVhZGVyIHVzZWQgd2hlbiBubyByZWFkZXIgaXMgaW5qZWN0ZWQuIEJlc3QtZWZmb3J0OiBhbnlcbiAqIGZhaWx1cmUgKG1pc3NpbmcgZmlsZSwgcGVybWlzc2lvbiBlcnJvcikgeWllbGRzIGBudWxsYCwgd2hpY2ggdGhlIHBhcnNlclxuICogZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRSZWFkUHJlRWRpdEZpbGUocGF0aDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhwYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFbnZlbG9wZSBzY2FubmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU2NhbiB0aGUgcGF0Y2ggdGV4dCBpbnRvIGh1bmtzLiBMZW5pZW50IGJ5IGRlc2lnbjogdW5yZWNvZ25pemVkIGxpbmVzIGFyZVxuICogaWdub3JlZCByYXRoZXIgdGhhbiByZWplY3RlZCwgYW5kIEJlZ2luL0VuZC9FbnZpcm9ubWVudCBsaW5lcyBhcmUgc2tpcHBlZCwgc29cbiAqIGEgbWFsZm9ybWVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIHdoYXRldmVyIGh1bmtzIGNvdWxkIGJlIHJlY292ZXJlZCAob2Z0ZW5cbiAqIG5vbmUgXHUyMTkyIGBbXWApIGluc3RlYWQgb2YgdGhyb3dpbmcuXG4gKi9cbmZ1bmN0aW9uIHNjYW5IdW5rcyhjb21tYW5kOiBzdHJpbmcpOiBIdW5rW10ge1xuICBjb25zdCBodW5rczogSHVua1tdID0gW107XG4gIC8vIFRoZSBjdXJyZW50bHktb3BlbiBVcGRhdGUgaHVuaywgb3IgbnVsbC4gQWRkL0RlbGV0ZSBodW5rcyBoYXZlIG5vIGJvZHksIHNvXG4gIC8vIHRoZXkgY2xvc2UgaW1tZWRpYXRlbHkgYW5kIHJlc2V0IHRoaXMgdG8gbnVsbC5cbiAgbGV0IG9wZW5VcGRhdGU6IChIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KSB8IG51bGwgPSBudWxsO1xuXG4gIGZvciAoY29uc3QgcmF3IG9mIGNvbW1hbmQuc3BsaXQoJ1xcbicpKSB7XG4gICAgLy8gSGVhZGVyIGRldGVjdGlvbiBpcyB3aGl0ZXNwYWNlLXNlbnNpdGl2ZSBpbnNpZGUgYW4gVXBkYXRlIGh1bms6IENvZGV4IHVzZXNcbiAgICAvLyB0cmltX2VuZCB0aGVyZSAobGVhZGluZyBzcGFjZSBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSBhbmQgZnVsbFxuICAgIC8vIHRyaW0gZWxzZXdoZXJlLiBNYXRjaCB0aGF0IHNvIGluZGVudGVkIG1hcmtlcnMgaW5zaWRlIGEgaHVuayBzdGF5IGNvbnRlbnQuXG4gICAgY29uc3QgaGVhZGVyTGluZTogc3RyaW5nID0gb3BlblVwZGF0ZSA/IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKSA6IHJhdy50cmltKCk7XG5cbiAgICBpZiAoaGVhZGVyTGluZSA9PT0gRU5EX1BBVENIX01BUktFUikge1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChBRERfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2FkZCcsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoQUREX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKERFTEVURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnZGVsZXRlJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShERUxFVEVfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoVVBEQVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgY29uc3QgaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSA9IHtcbiAgICAgICAga2luZDogJ3VwZGF0ZScsXG4gICAgICAgIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoVVBEQVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCksXG4gICAgICAgIG1vdmVQYXRoOiBudWxsLFxuICAgICAgICBjaHVua3M6IFtdXG4gICAgICB9O1xuICAgICAgaHVua3MucHVzaChodW5rKTtcbiAgICAgIG9wZW5VcGRhdGUgPSBodW5rO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKG9wZW5VcGRhdGUpIHtcbiAgICAgIHByb2Nlc3NVcGRhdGVMaW5lKG9wZW5VcGRhdGUsIHJhdyk7XG4gICAgfVxuICAgIC8vIEFueSBvdGhlciBsaW5lIG91dHNpZGUgYW4gVXBkYXRlIGh1bmsgKEJlZ2luIFBhdGNoLCBFbnZpcm9ubWVudCBJRCwgQWRkXG4gICAgLy8gRmlsZSBgK2AgY29udGVudCwgc3RyYXkgdGV4dCkgaXMgaWdub3JlZC5cbiAgfVxuXG4gIHJldHVybiBodW5rcztcbn1cblxuZnVuY3Rpb24gZW5zdXJlQ2h1bmsoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSk6IFVwZGF0ZUNodW5rIHtcbiAgY29uc3QgbGFzdCA9IGh1bmsuY2h1bmtzW2h1bmsuY2h1bmtzLmxlbmd0aCAtIDFdO1xuICBpZiAobGFzdCkgcmV0dXJuIGxhc3Q7XG4gIGNvbnN0IGNodW5rOiBVcGRhdGVDaHVuayA9IHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfTtcbiAgaHVuay5jaHVua3MucHVzaChjaHVuayk7XG4gIHJldHVybiBjaHVuaztcbn1cblxuLyoqIEFwcGx5IG9uZSBib2R5IGxpbmUgb2YgYW4gVXBkYXRlIGh1bmsgdG8gaXRzIGNodW5rIGxpc3QuICovXG5mdW5jdGlvbiBwcm9jZXNzVXBkYXRlTGluZShodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9LCByYXc6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCB0cmltbWVkRW5kID0gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpO1xuXG4gIGlmICh0cmltbWVkRW5kID09PSBFT0ZfTUFSS0VSKSByZXR1cm47IC8vIGVuZC1vZi1maWxlIGhpbnQ7IG5vdCBuZWVkZWQgZm9yIHJhbmdlc1xuXG4gIC8vIGAqKiogTW92ZSB0bzpgIGlzIG9ubHkgbWVhbmluZ2Z1bCBiZWZvcmUgYW55IGNoYW5nZSBjb250ZW50LlxuICBpZiAoaHVuay5jaHVua3MubGVuZ3RoID09PSAwICYmIGh1bmsubW92ZVBhdGggPT09IG51bGwgJiYgdHJpbW1lZEVuZC5zdGFydHNXaXRoKE1PVkVfVE9fTUFSS0VSKSkge1xuICAgIGh1bmsubW92ZVBhdGggPSB0cmltbWVkRW5kLnNsaWNlKE1PVkVfVE9fTUFSS0VSLmxlbmd0aCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVNUFRZX0NIQU5HRV9DT05URVhUX01BUktFUikge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRyaW1tZWRFbmQuc3RhcnRzV2l0aChDSEFOR0VfQ09OVEVYVF9NQVJLRVIpKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IHRyaW1tZWRFbmQuc2xpY2UoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSLmxlbmd0aCksIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEEgYmFyZSBlbXB0eSBsaW5lIGlzIGFuIGVtcHR5IGNvbnRleHQgbGluZSAocHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3KS5cbiAgaWYgKHJhdyA9PT0gJycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goJycpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goJycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmaXJzdCA9IHJhd1swXTtcbiAgaWYgKGZpcnN0ID09PSAnICcpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByYXcuc2xpY2UoMSk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaChjb250ZW50KTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoZmlyc3QgPT09ICcrJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChyYXcuc2xpY2UoMSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoZmlyc3QgPT09ICctJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaChyYXcuc2xpY2UoMSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBVbnJlY29nbml6ZWQgY29udGVudCBsaW5lIFx1MjAxNCBpZ25vcmUgbGVuaWVudGx5IHJhdGhlciB0aGFuIHRocm93LlxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFNwbGl0IGZpbGUgY29udGVudCBpbnRvIGxpbmVzIGZvciBtYXRjaGluZy4gQSB0cmFpbGluZyBuZXdsaW5lIHlpZWxkcyBhXG4gKiB0cmFpbGluZyBlbXB0eSBlbGVtZW50LCB3aGljaCBpcyBoYXJtbGVzcyBmb3Igc3ViLXNsaWNlIG1hdGNoaW5nLiAqL1xuZnVuY3Rpb24gc3BsaXRMaW5lcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBjb250ZW50LnNwbGl0KCdcXG4nKTtcbn1cblxuLyoqIEluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGB2YWx1ZWAgYXBwZWFycyBhcyBhIGZ1bGwgbGluZSBpbiBgbGluZXNgLiAqL1xuZnVuY3Rpb24gbGluZUluZGljZXMobGluZXM6IHN0cmluZ1tdLCB2YWx1ZTogc3RyaW5nKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAobGluZXNbaV0gPT09IHZhbHVlKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU3RhcnQgaW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYG5lZWRsZWAgbWF0Y2hlcyBjb250aWd1b3VzbHkgaW4gYGhheXN0YWNrYC4gKi9cbmZ1bmN0aW9uIGNvbnRpZ3VvdXNNYXRjaGVzKGhheXN0YWNrOiBzdHJpbmdbXSwgbmVlZGxlOiBzdHJpbmdbXSk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBpZiAobmVlZGxlLmxlbmd0aCA9PT0gMCB8fCBuZWVkbGUubGVuZ3RoID4gaGF5c3RhY2subGVuZ3RoKSByZXR1cm4gb3V0O1xuICBjb25zdCBsYXN0ID0gaGF5c3RhY2subGVuZ3RoIC0gbmVlZGxlLmxlbmd0aDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTG9jYXRlIGEgc2luZ2xlIGNodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlIGZpbGUsIHJldHVybmluZyBpdHMgMS1iYXNlZFxuICogbGluZSByYW5nZSBvciBudWxsIHdoZW4gaXQgY2Fubm90IGJlIGxvY2F0ZWQgdW5hbWJpZ3VvdXNseS5cbiAqXG4gKiAtIE5vbi1lbXB0eSBibG9jazogcmVxdWlyZSBhIHVuaXF1ZSBjb250aWd1b3VzIG1hdGNoLCBvciBcdTIwMTQgd2hlbiBkdXBsaWNhdGVkIFx1MjAxNFxuICogICBhIGBAQGAgY2hhbmdlLWNvbnRleHQgbGluZSB0aGF0IHNlbGVjdHMgdGhlIG9jY3VycmVuY2UgYWZ0ZXIgaXQuXG4gKiAtIEVtcHR5IGJsb2NrIChwdXJlIGluc2VydGlvbik6IGFuY2hvciBvbiBhIHVuaXF1ZSBjaGFuZ2UtY29udGV4dCBsaW5lIGlmIG9uZVxuICogICBpcyBnaXZlbjsgb3RoZXJ3aXNlIGl0IGlzIHVubG9jYXRhYmxlLlxuICovXG5mdW5jdGlvbiBsb2NhdGVDaHVuayhwcmVMaW5lczogc3RyaW5nW10sIGNodW5rOiBVcGRhdGVDaHVuayk6IExpbmVSYW5nZSB8IG51bGwge1xuICBjb25zdCBibG9jayA9IGNodW5rLm9sZExpbmVzO1xuXG4gIGlmIChibG9jay5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICAgIGlmIChjdHggIT09IG51bGwgJiYgY3R4ICE9PSAnJykge1xuICAgICAgY29uc3QgY3R4SWR4cyA9IGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpO1xuICAgICAgaWYgKGN0eElkeHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBjdHhJZHhzWzBdICsgMTtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGxpbmUsIGVuZDogbGluZSB9O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHN0YXJ0cyA9IGNvbnRpZ3VvdXNNYXRjaGVzKHByZUxpbmVzLCBibG9jayk7XG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgcyA9IHN0YXJ0c1swXTtcbiAgICByZXR1cm4geyBzdGFydDogcyArIDEsIGVuZDogcyArIGJsb2NrLmxlbmd0aCB9O1xuICB9XG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBEdXBsaWNhdGVkIGJsb2NrOiB1c2UgdGhlIGNoYW5nZSBjb250ZXh0IHRvIHNlbGVjdCB0aGUgbWF0Y2ggYWZ0ZXIgaXQuXG4gIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gIGlmIChjdHggIT09IG51bGwgJiYgY3R4ICE9PSAnJykge1xuICAgIGZvciAoY29uc3QgYyBvZiBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KSkge1xuICAgICAgY29uc3QgYWZ0ZXIgPSBzdGFydHMuZmluZCgocykgPT4gcyA+PSBjKTtcbiAgICAgIGlmIChhZnRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBhZnRlciArIDEsIGVuZDogYWZ0ZXIgKyBibG9jay5sZW5ndGggfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7IC8vIGFtYmlndW91cyBcdTIxOTIgY2FsbGVyIGRlZ3JhZGVzIHRvIHdob2xlLWZpbGVcbn1cblxuLyoqXG4gKiBSZWNvdmVyIGEgc2luZ2xlIGxpbmUgcmFuZ2Ugc3Bhbm5pbmcgYWxsIG9mIGFuIHVwZGF0ZSdzIGNodW5rcy4gUmV0dXJucyBudWxsXG4gKiAoXHUyMTkyIHdob2xlLWZpbGUgZmFsbGJhY2spIGlmIGFueSBjaHVuayBjYW5ub3QgYmUgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bmtzOiBVcGRhdGVDaHVua1tdKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGxldCB1bmlvbjogTGluZVJhbmdlIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgY29uc3QgciA9IGxvY2F0ZUNodW5rKHByZUxpbmVzLCBjaHVuayk7XG4gICAgaWYgKHIgPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgIHVuaW9uID0gdW5pb24gPT09IG51bGwgPyByIDogeyBzdGFydDogTWF0aC5taW4odW5pb24uc3RhcnQsIHIuc3RhcnQpLCBlbmQ6IE1hdGgubWF4KHVuaW9uLmVuZCwgci5lbmQpIH07XG4gIH1cbiAgcmV0dXJuIHVuaW9uO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyBBUElcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFBhcnNlIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBjb21tYW5kIHN0cmluZyBpbnRvIGFuIGFuY2hvciBwZXIgdG91Y2hlZCBmaWxlLlxuICpcbiAqIC0gYCoqKiBBZGQgRmlsZTpgIFx1MjE5MiBgY3JlYXRlYCAod2hvbGUtZmlsZSlcbiAqIC0gYCoqKiBEZWxldGUgRmlsZTpgIFx1MjE5MiBgd2hvbGUtd3JpdGVgICh3aG9sZS1maWxlOyB0aGUgZmlsZSBubyBsb25nZXIgZXhpc3RzKVxuICogLSBgKioqIFVwZGF0ZSBGaWxlOmAgXHUyMTkyIGB3cml0ZWAgd2l0aCBhIHJlY292ZXJlZCBsaW5lIHJhbmdlIHdoZW4gdGhlIGh1bmsnc1xuICogICBwcmUtZWRpdCBibG9jayBjYW4gYmUgbG9jYXRlZCB2aWEgYHJlYWRQcmVFZGl0RmlsZWAsIG90aGVyd2lzZSBgd2hvbGUtd3JpdGVgLlxuICogICBBIHJlbmFtZWQgdXBkYXRlIChgKioqIE1vdmUgdG86YCkgYW5jaG9ycyB0aGUgZGVzdGluYXRpb24gcGF0aCBhc1xuICogICBgd2hvbGUtd3JpdGVgIHNpbmNlIHByZS1lZGl0IGxpbmUgbnVtYmVycyBjYW5ub3QgYmUgbWFwcGVkIGFjcm9zcyBhIHJlbmFtZS5cbiAqXG4gKiBOZXZlciB0aHJvd3M6IGEgbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHlpZWxkcyBgW11gLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VBcHBseVBhdGNoKFxuICBjb21tYW5kOiBzdHJpbmcsXG4gIHJlYWRQcmVFZGl0RmlsZTogUmVhZFByZUVkaXRGaWxlID0gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZVxuKTogQW5jaG9yU3BlY1tdIHtcbiAgY29uc3QgYW5jaG9yczogQW5jaG9yU3BlY1tdID0gW107XG5cbiAgZm9yIChjb25zdCBodW5rIG9mIHNjYW5IdW5rcyhjb21tYW5kKSkge1xuICAgIGlmIChodW5rLmtpbmQgPT09ICdhZGQnKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0b1Bvc2l4KGh1bmsucGF0aCksIGtpbmQ6ICdjcmVhdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChodW5rLmtpbmQgPT09ICdkZWxldGUnKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0b1Bvc2l4KGh1bmsucGF0aCksIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGU6IGFuY2hvciBvbiB0aGUgZGVzdGluYXRpb24gcGF0aCAocG9zdC1lZGl0IGxvY2F0aW9uKS5cbiAgICBjb25zdCB0YXJnZXRQYXRoID0gdG9Qb3NpeChodW5rLm1vdmVQYXRoID8/IGh1bmsucGF0aCk7XG5cbiAgICAvLyBBIHJlbmFtZSBkZWZlYXRzIHByZS1lZGl0IGxpbmUgbWFwcGluZyBcdTIwMTQgYW5jaG9yIHdob2xlLWZpbGUgb24gdGhlIHRhcmdldC5cbiAgICBpZiAoaHVuay5tb3ZlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFJhbmdlIHJlY292ZXJ5IHJlYWRzIHRoZSBwcmUtZWRpdCBjb250ZW50IGF0IHRoZSBvcmlnaW5hbCAocHJlLW1vdmUpIHBhdGguXG4gICAgY29uc3QgY29udGVudCA9IHJlYWRQcmVFZGl0RmlsZShodW5rLnBhdGgpO1xuICAgIGNvbnN0IHJhbmdlID0gY29udGVudCA9PT0gbnVsbCA/IG51bGwgOiByZWNvdmVyUmFuZ2Uoc3BsaXRMaW5lcyhjb250ZW50KSwgaHVuay5jaHVua3MpO1xuICAgIGlmIChyYW5nZSAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dyaXRlJywgcmFuZ2UgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFuY2hvcnM7XG59XG4iLCAiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFvQ0EsU0FBUyxXQUFXQSxvQkFBbUI7OztBQ3BDdkMsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBSU8sU0FBUyxnQkFBZ0IsUUFBUSxTQUFTO0FBQzdDLFNBQU8sZUFBZSxlQUFlLFFBQVEsT0FBTztBQUN4RDs7O0FDRkEsU0FBUyxjQUFjLE9BQU87QUFDMUIsU0FBTyxPQUFPLFlBQVksT0FBTyxRQUFRLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLEtBQUssTUFBTSxVQUFVLE1BQVMsQ0FBQztBQUM5RjtBQUNBLFNBQVMsWUFBWSxNQUFNLFFBQVEsUUFBUTtBQUN2QyxTQUFPO0FBQUEsSUFDSCxPQUFPO0FBQUEsSUFDUCxRQUFRLGNBQWMsTUFBTTtBQUFBLElBQzVCLEdBQUksV0FBVyxTQUFZLEVBQUUsT0FBTyxJQUFJLENBQUM7QUFBQSxFQUM3QztBQUNKO0FBbUNPLFNBQVMsa0JBQWtCLFVBQVUsQ0FBQyxHQUFHO0FBQzVDLFFBQU0sY0FBYyxRQUFRLHNCQUFzQixVQUFhLFFBQVEseUJBQXlCO0FBQ2hHLFFBQU0scUJBQXFCLGNBQ3JCLGNBQWM7QUFBQSxJQUNaLGVBQWU7QUFBQSxJQUNmLG1CQUFtQixRQUFRO0FBQUEsSUFDM0Isc0JBQXNCLFFBQVE7QUFBQSxFQUNsQyxDQUFDLElBQ0M7QUFDTixTQUFPLFlBQVksZUFBZTtBQUFBLElBQzlCLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFlBQVksUUFBUTtBQUFBLElBQ3BCLGdC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LENBQUk7QUFBQSxJQUM1RCxPQUNLO0FBQ0QsY0FBUSxPQUFPLE1BQU0sR0FBRyxPQUFPLEtBQUssQ0FBQztBQUFBLENBQUk7QUFBQSxJQUM3QztBQUNBLFlBQVEsS0FBS0EsWUFBVyxLQUFLO0FBQUEsRUFDakMsVUFDQTtBQUNJLFdBQU8sYUFBYTtBQUNwQixXQUFPLE1BQU07QUFBQSxFQUNqQjtBQUNKOzs7QUNqRUEsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZVBhdGgiLCAiaXNBYnNvbHV0ZSIsICJleGVjRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiaSIsICJyZXNvbHZlIiwgInZhbHVlIiwgImVzY2FwZVJlZ0V4cCIsICJpc0Fic29sdXRlIiwgInN0YXRTeW5jIiwgImRpcm5hbWUiLCAiam9pbiIsICJyZXNvbHZlUGF0aCIsICJoYXNTaGVsbEV4cGFuc2lvbiIsICJmaW5kR2l0U3ViY29tbWFuZCIsICJyZXNvbHZlUGF0aCIsICJzZXAiLCAic3RhdFN5bmMiLCAiam9pbiIsICJkaXJuYW1lIiwgImJhc2UiLCAicm9vdHMiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAibGluZUNvdW50IiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJyZXNvbHZlUGF0aCIsICJibG9ja3MiLCAiY29tYmluZWQiLCAiZXhpc3RzU3luYyIsICJta2RpclN5bmMiLCAiZGlybmFtZSIsICJFWElUX0NPREVTIiwgIkJsb2NrRXJyb3IiLCAib21pdFVuZGVmaW5lZCIsICJidWlsZE91dHB1dCIsICJ1c2VyUHJvbXB0U3VibWl0T3V0cHV0IiwgImJ1aWxkT3V0cHV0IiwgInNlc3Npb25TdGFydE91dHB1dCIsICJzdWJhZ2VudFN0YXJ0T3V0cHV0IiwgInJlc29sdmUiLCAic2Vzc2lvblN0YXJ0T3V0cHV0IiwgInN1YmFnZW50U3RhcnRPdXRwdXQiLCAidXNlclByb21wdFN1Ym1pdE91dHB1dCIsICJFWElUX0NPREVTIiwgIkJsb2NrRXJyb3IiXQp9Cg==
