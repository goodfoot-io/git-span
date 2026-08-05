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
      parts.push({ text: s, precededBy: pendingOp });
    }
    buf = "";
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
  return lines.every((line) => line === "" || parseOneFileRecord(line) !== null);
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
  const stdinFed = gated.kind === "search" && gated.argv[0] !== "git" && info.pathArgs.length === 0 && (gatedPrecededBy === "pipe" || info.stdinRedirect || gatedRedirect);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2hvb2tzLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9vdXRwdXRzLmpzIiwgInNyYy9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLnRzIiwgInNyYy9jb21tb24vcGFyc2UtY29tbWFuZC50cyIsICJzcmMvY29tbW9uL2NvbW1hbmQtcmVzb2x2ZS50cyIsICJzcmMvY29tbW9uL3NoZWxsLXNwbGl0LnRzIiwgInNyYy9jb21tb24vdmFyaWFibGUtZXhwYW5kLnRzIiwgInNyYy9jb21tb24vcGFyc2UtcmVzcG9uc2UudHMiLCAic3JjL2NvbW1vbi9zcGFuLXN1cmZhY2UudHMiLCAic3JjL2NvbW1vbi9zcGFuLWlnbm9yZS50cyIsICJzcmMvY29tbW9uL3RvdWNoLWNvcmUudHMiLCAic3JjL2NvbW1vbi9hbmNob3ItdHJlZS50cyIsICJzcmMvY29kZXgvYXBwbHktcGF0Y2gudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvbG9nZ2VyLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9vdXRwdXRzLmpzIiwgIi4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzIiwgInNyYy9jb2RleC9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIENvZGV4IFBvc3RUb29sVXNlIHRvdWNoIGhvb2sgXHUyMDE0IGhlYWwgKyBzdXJmYWNlIGFmdGVyIGEgY29uZmlybWVkIGBhcHBseV9wYXRjaGAsXG4gKiBvciBhIHNoZWxsL2V4ZWMgY2FsbCB3aG9zZSBjb21tYW5kIHN0YXRpY2FsbHkgcmVzb2x2ZXMgdG8gZmlsZStsaW5lIGlkaW9tcy5cbiAqXG4gKiBQb3N0VG9vbFVzZSBmaXJlcyBhZnRlciBgYXBwbHlfcGF0Y2hgIGhhcyBydW4sIHNvIHRoaXMgaXMgdGhlIGFjY3VyYXRlIGhvbWUgZm9yXG4gKiB0aGUgdG91Y2ggc2lnbmFsOiB0aGUgZmlsZSBpcyBhbHJlYWR5IHdyaXR0ZW4sIHNvIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdFxuICogPGZpbGU+IC0tZml4YCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGFnYWluc3QgcmVhbCBieXRlcyBhbmQgdGhlIHN1cmZhY2VkIGJsb2NrXG4gKiByZWZsZWN0cyB0aGUgaGVhbGVkIGFuY2hvcnMuIFRoZSBoYW5kbGVyIG5hcnJvd3MgdGhlIGBhcHBseV9wYXRjaGAgZW52ZWxvcGVcbiAqIChgdG9vbF9pbnB1dC5jb21tYW5kYCwgU0RLLXR5cGVkIGB1bmtub3duYCkgaW50byBwZXItZmlsZSBhbmNob3JzIHZpYSB0aGVcbiAqIHNoYXJlZCBbYXBwbHktcGF0Y2ggcGFyc2VyXSguL2FwcGx5LXBhdGNoLnRzKSwgYW5kIHJlY292ZXJzIHNoZWxsIGNvbW1hbmRzXG4gKiBmcm9tIGVpdGhlciBDb2RleCBlbnZlbG9wZSAoY2xhc3NpYyBgZXhlY19jb21tYW5kYCBKU09OIGBhcmd1bWVudHNgLCBvclxuICogY29kZS1tb2RlIGBleGVjYCB3cmFwcGluZyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWApIHZpYSB0aGUgc2hhcmVkXG4gKiBbY29tbWFuZCBwYXJzZXJdKC4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLnRzKTsgZWFjaCB0b3VjaGVkIGZpbGUgaXMgc2NvcGVkIHRvXG4gKiB0aGUgQ1dEIHJlcG8sIGFuZCBkcml2ZXMgdGhlIGhhcm5lc3MtYWdub3N0aWMge0BsaW5rIHJ1blRvdWNoSG9va30gY29yZSBcdTIwMTQgdGhlXG4gKiBzYW1lIGNvcmUgdGhlIENsYXVkZSBhZGFwdGVyIHVzZXMuXG4gKlxuICogVHdvIENvZGV4LXNwZWNpZmljIGNvbmNlcm5zIGFyZSBwcmVzZXJ2ZWQgZnJvbSB0aGlzIGZpbGUncyBqb3VybmFsaW5nXG4gKiBwcmVkZWNlc3NvcjpcbiAqXG4gKiAxLiAqKlN1Y2Nlc3MgY2xhc3NpZmljYXRpb24uKiogVGhlIHBhcnNlZCBlbnZlbG9wZSBkZXNjcmliZXMgKmludGVudCosIG5vdFxuICogICAgKm91dGNvbWUqLiBDb2RleCBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gdG9vbCBzdWNjZXNzLCBidXQgYXMgYVxuICogICAgZHVyYWJpbGl0eSBiZWx0IHdlIGNsYXNzaWZ5IGB0b29sX3Jlc3BvbnNlYCB2aWFcbiAqICAgIHtAbGluayBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZX06IGEgY29uZmlybWVkIHJlamVjdGlvbiAoYCdmYWlsdXJlJ2ApXG4gKiAgICBzdXBwcmVzc2VzIHRoZSB0b3VjaCAobm8gcGhhbnRvbSBoZWFsL3N1cmZhY2Ugb24gYSBwYXRjaCB0aGF0IG5ldmVyXG4gKiAgICBhcHBsaWVkKTsgYSBzdWNjZXNzIG9yIGFuIHVucmVjb2duaXplZCBzaGFwZSAoYCd1bmtub3duJ2AsIHdhcm5lZCkgcHJvY2VlZHMuXG4gKiAyLiAqKk5vIHBvc3QtZWRpdCByYW5nZSByZWNvdmVyeSBmcm9tIHRoZSBlbnZlbG9wZS4qKiBQb3N0VG9vbFVzZSBydW5zIGFmdGVyXG4gKiAgICB0aGUgcGF0Y2ggcmV3cm90ZSB0aGUgZmlsZSwgc28gdGhlIGh1bmsncyBwcmUtZWRpdCBibG9jayBubyBsb25nZXIgc2l0c1xuICogICAgd2hlcmUgdGhlIGVkaXQgaGFwcGVuZWQgYW5kIGNvdWxkIG1pcy1hbmNob3IgYSBkdXBsaWNhdGUuIFRoZSB0b3VjaCBpc1xuICogICAgc2NvcGVkIGZpbGUtd2lkZSAoYHdyaXR0ZW46ICcnYCBcdTIxOTIgd2hvbGUtZmlsZSksIHdoaWNoIGlzIGV4YWN0bHkgdGhlXG4gKiAgICBiZWhhdmlvciB7QGxpbmsgcnVuVG91Y2hIb29rfSB0YWtlcyBmb3IgYW4gZW1wdHkgd3JpdGUuXG4gKlxuICogVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGluIHRoZSBoYW5kbGVyIGNvbmZpZyAodGhlIENMSSBlbWl0cyBgMTBgIHNlY29uZHMpXG4gKiBcdTIwMTQgc2VlIHRoZSB0aW1lb3V0LXVuaXRzIHNwaWtlIG5vdGU7IHRoZSBzb3VyY2UgdmFsdWUgbXVzdCBzdGF5IGluIG1zIHNvIHRoZVxuICogQ29kZXggYnVpbGQncyBzZWNvbmRzIGNvbnZlcnNpb24gYXQgZW1pdCByZW1haW5zIGNvcnJlY3QuXG4gKi9cblxuaW1wb3J0IHsgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgcGFyc2VSZXNwb25zZSwgdHlwZSBSZXNwb25zZVBhcnNlSW5wdXQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtcmVzcG9uc2UuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXRcbn0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuaW1wb3J0IHsgcGFyc2VBcHBseVBhdGNoIH0gZnJvbSAnLi9hcHBseS1wYXRjaC5qcyc7XG5cbi8qKlxuICogVGhlIHByZWZpeCBhcHBseV9wYXRjaCdzIHN0ZG91dCBjYXJyaWVzIHdoZW4gXHUyMDE0IGFuZCBvbmx5IHdoZW4gXHUyMDE0IHRoZSBwYXRjaFxuICogYXBwbGllZCAoY29kZXgtcnMvYXBwbHktcGF0Y2ggYHByaW50X3N1bW1hcnlgKS4gQ29kZXggc3VyZmFjZXMgdGhhdCBzdGRvdXRcbiAqIHZlcmJhdGltIGFzIHRoZSBQb3N0VG9vbFVzZSBgdG9vbF9yZXNwb25zZWAgKGEgYmFyZSBzdHJpbmcgdG9kYXkpLiBGaXhlZFxuICogYWNyb3NzIEFkZC9Nb2RpZnkvRGVsZXRlOyB0aGUgaGVhZGVyIGlzIGZvbGxvd2VkIGJ5IGBBL00vRCA8cGF0aD5gIGxpbmVzLlxuICovXG5jb25zdCBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCA9ICdTdWNjZXNzLiBVcGRhdGVkIHRoZSBmb2xsb3dpbmcgZmlsZXM6JztcblxuLyoqXG4gKiBUaGUgY29tbW9uIGZpZWxkcyBhbiBvYmplY3Qtd3JhcHBlZCB0b29sX3Jlc3BvbnNlIG1pZ2h0IGNhcnJ5IHRoZSB0b29sJ3MgdGV4dFxuICogb3V0cHV0IHVuZGVyLCBpZiBDb2RleCBldmVyIHN0b3BzIHN1cmZhY2luZyBpdCBhcyBhIGJhcmUgc3RyaW5nLiBPcmRlcmVkIGJ5XG4gKiBsaWtlbGlob29kOyB0aGUgZmlyc3QgZmllbGQgd2hvc2UgdmFsdWUgaXMgYSBzdHJpbmcgd2lucy5cbiAqL1xuY29uc3QgUkVTUE9OU0VfVEVYVF9GSUVMRFMgPSBbJ291dHB1dCcsICdzdGRvdXQnLCAnY29udGVudCcsICd0ZXh0J10gYXMgY29uc3Q7XG5cbi8qKiBOYXJyb3cgdGhlIFNESydzIGB1bmtub3duYCB0b29sX2lucHV0IHRvIHRoZSBgYXBwbHlfcGF0Y2hgIGB7IGNvbW1hbmQgfWAgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93QXBwbHlQYXRjaENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICAgIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY2xhc3NpYyBgZXhlY19jb21tYW5kYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY0IDAuMTMwLjApOlxuICogYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gKnN0cmluZyogb2Ygc2hhcGVcbiAqIGB7XCJjbWRcIjogXCIuLi5cIiwgXCJ3b3JrZGlyXCI6IFwiLi4uXCJ9YCBcdTIwMTQgcGFyc2UgaXQgYW5kIHJldHVybiB0aGUgYGNtZGAgYW5kXG4gKiBgd29ya2RpcmAuIFJldHVybnMgYG51bGxgIGZvciBhbnkgb3RoZXIgc2hhcGUgKG5vdCBKU09OLCBubyBgY21kYCBmaWVsZCwgb3JcbiAqIG5vdCB0aGlzIGVudmVsb3BlKTsgYHdvcmtkaXJgIGlzIGBudWxsYCB3aGVuIGFic2VudCBvciBub3QgYSBzdHJpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dFeGVjQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiB7IGNtZDogc3RyaW5nOyB3b3JrZGlyOiBzdHJpbmcgfCBudWxsIH0gfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnYXJndW1lbnRzJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBhcmdzID0gKHRvb2xJbnB1dCBhcyB7IGFyZ3VtZW50czogdW5rbm93biB9KS5hcmd1bWVudHM7XG4gICAgaWYgKHR5cGVvZiBhcmdzID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhcmdzKTtcbiAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4geyBjbWQ6IHBhcnNlZC5jbWQsIHdvcmtkaXI6IHR5cGVvZiBwYXJzZWQud29ya2RpciA9PT0gJ3N0cmluZycgPyBwYXJzZWQud29ya2RpciA6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgcmVzdWx0IG9mIG5hcnJvd2luZyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZS4gYG1hdGNoZWRgIHNlcGFyYXRlc1xuICogXCJ0aGUgZW52ZWxvcGUgd2FzIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwgd2hvc2UgYXJndW1lbnQgY291bGQgbm90XG4gKiBiZSByZWNvdmVyZWRcIiAoYSB2YXJpYWJsZS90ZW1wbGF0ZS1idWlsdCBjb21tYW5kIFx1MjAxNCBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZSlcbiAqIGZyb20gXCJ0aGUgZW52ZWxvcGUgaXMgbm90IGNvZGUtbW9kZSBleGVjIGF0IGFsbFwiLCBzbyB0aGUgaGFuZGxlciBjYW4gd2FybiBvblxuICogdGhlIGZvcm1lciBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRpbmcgaXQgd2l0aCB0aGUgbGF0dGVyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIC8qKiBXaGV0aGVyIGB0b29sX2lucHV0LmlucHV0YCBjb250YWluZWQgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbC4gKi9cbiAgbWF0Y2hlZDogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWNvdmVyZWQgYGNtZGAgc3RyaW5nLCBvciBgbnVsbGAgd2hlbiBtYXRjaGVkIGJ1dCB1bnBhcnNhYmxlIC8gYWJzZW50LiAqL1xuICBjbWQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGB3b3JrZGlyYCBzdHJpbmcsIG9yIGBudWxsYCB3aGVuIGFic2VudCBvciBub3QgYSBzdHJpbmcuICovXG4gIHdvcmtkaXI6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUXVvdGUgYmFyZSBpZGVudGlmaWVyIGtleXMgaW4gYSBKUyBvYmplY3QgbGl0ZXJhbCBzbyBgSlNPTi5wYXJzZWAgY2FuIHJlYWRcbiAqIGl0LiBSZWFsIGNvZGUtbW9kZSBjYWxsIHNpdGVzIGVtaXQgSlMtc3R5bGUgdW5xdW90ZWQga2V5c1xuICogKGB7Y21kOlwic2VkIC1uICcxLDI0MHAnIC9wYXRoXCIsLi4ufWApLCB3aGljaCBpcyB2YWxpZCBKUyBidXQgaW52YWxpZCBKU09OLlxuICogU3RyaW5nIHZhbHVlcyAoc2luZ2xlLSBvciBkb3VibGUtcXVvdGVkKSBhcmUgY29waWVkIHZlcmJhdGltIFx1MjAxNCBpbmNsdWRpbmcgYW55XG4gKiBgLCBrZXk6YC1zaGFwZWQgdGV4dCBpbnNpZGUgdGhlbSBcdTIwMTQgYW5kIGFscmVhZHktcXVvdGVkIGtleXMgcGFzcyB0aHJvdWdoXG4gKiB1bnRvdWNoZWQuXG4gKi9cbmZ1bmN0aW9uIHF1b3RlT2JqZWN0S2V5cyhsaXRlcmFsOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGxpdGVyYWwubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gbGl0ZXJhbFtpXTtcbiAgICBpZiAoYyA9PT0gJ1wiJyB8fCBjID09PSBcIidcIikge1xuICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgY29uc3Qgc3RhcnQgPSBpO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuKSB7XG4gICAgICAgIGlmIChsaXRlcmFsW2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSBpICs9IDI7XG4gICAgICAgIGVsc2UgaWYgKGxpdGVyYWxbaV0gPT09IHF1b3RlKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2UgaSArPSAxO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGxpdGVyYWwuc2xpY2Uoc3RhcnQsIGkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGtleSA9IGxpdGVyYWwuc2xpY2UoaSkubWF0Y2goL14oXFx7fCwpXFxzKihbQS1aYS16XyRdW0EtWmEtejAtOV8kXSopXFxzKjovKTtcbiAgICBpZiAoa2V5KSB7XG4gICAgICBvdXQgKz0gYCR7a2V5WzFdfVwiJHtrZXlbMl19XCI6YDtcbiAgICAgIGkgKz0ga2V5WzBdLmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvdXQgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NSAwLjE0NC4wKTpcbiAqIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2UgdGhhdCBjYWxscyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgXHUyMDE0XG4gKiByZWNvdmVyIHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudCB2aWEgYmFsYW5jZWQtYnJhY2UgbWF0Y2hpbmcsIHF1b3RlIGl0c1xuICogdW5xdW90ZWQgSlMga2V5cywgYW5kIHBhcnNlIGl0LiBBIGNvbW1hbmQgYnVpbHQgZnJvbSB2YXJpYWJsZXMgb3IgdGVtcGxhdGVcbiAqIGxpdGVyYWxzIGlzIHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlOiB0aGUgY2FsbCBzdGlsbCAqbWF0Y2hlZCogYnV0IHlpZWxkc1xuICogYGNtZDogbnVsbGAsIHJlcG9ydGVkIGRpc3RpbmN0bHkgZnJvbSBhIG5vbi1jb2RlLW1vZGUgZW52ZWxvcGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dDb2RlTW9kZUV4ZWModG9vbElucHV0OiB1bmtub3duKTogQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnaW5wdXQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGlucHV0ID0gKHRvb2xJbnB1dCBhcyB7IGlucHV0OiB1bmtub3duIH0pLmlucHV0O1xuICAgIGlmICh0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBNYXRjaCB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pIFx1MjAxNCBleHRyYWN0IHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudFxuICAgICAgY29uc3QgbWF0Y2ggPSBpbnB1dC5tYXRjaCgvdG9vbHNcXC5leGVjX2NvbW1hbmRcXChcXHMqKFxceyg/Oltee31dfFxceyg/Oltee31dfFxce1tee31dKlxcfSkqXFx9KSpcXH0pXFxzKlxcKS8pO1xuICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShxdW90ZU9iamVjdEtleXMobWF0Y2hbMV0pKTtcbiAgICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbWF0Y2hlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgY21kOiBwYXJzZWQuY21kLFxuICAgICAgICAgICAgICB3b3JrZGlyOiB0eXBlb2YgcGFyc2VkLndvcmtkaXIgPT09ICdzdHJpbmcnID8gcGFyc2VkLndvcmtkaXIgOiBudWxsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwsIHdvcmtkaXI6IG51bGwgfTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbWF0Y2hlZCwgYnV0IHRoZSBsaXRlcmFsIGRpZCBub3QgcGFyc2UgXHUyMDE0IHRoZSBjYWxsIGlzIHN0aWxsIGFcbiAgICAgICAgICAvLyBjb2RlLW1vZGUgZXhlYyB3aG9zZSBjb21tYW5kIGNhbm5vdCBiZSByZWNvdmVyZWQgc3RhdGljYWxseS5cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwsIHdvcmtkaXI6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYXRjaGVkOiBmYWxzZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG59XG5cbi8qKiBUaGUgc2hlbGwgYHRvb2xfcmVzcG9uc2VgIGZpZWxkcyBhIHJlc3BvbnNlLWF3YXJlIHBhcnNlIGNvbnRyaWJ1dGVzLCBiZWZvcmUgYGNvbW1hbmRgL2Bjd2RgIGFyZSBhdHRhY2hlZCBhdCB0aGUgY2FsbCBzaXRlLiAqL1xudHlwZSBOb3JtYWxpemVkU2hlbGxSZXNwb25zZSA9IFBpY2s8XG4gIFJlc3BvbnNlUGFyc2VJbnB1dCxcbiAgJ3N0ZG91dCcgfCAnc3RkZXJyJyB8ICdleGl0U3RhdHVzJyB8ICd0cnVuY2F0ZWQnIHwgJ2ludGVycnVwdGVkJ1xuPjtcblxuLyoqXG4gKiBUb2xlcmFudGx5IG5vcm1hbGl6ZSB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IGFuZCBtZXRhZGF0YSBvdXQgb2YgYVxuICogYHRvb2xfcmVzcG9uc2VgIG9mIHVuY2VydGFpbiBzaGFwZSAoU0RLLXR5cGVkIGB1bmtub3duYCk6IGEgYmFyZSBzdHJpbmdcbiAqICh0b2RheSdzIENvZGV4KSBpcyB1c2VkIGFzLWlzOyBhIHRleHQtYmxvY2sgYXJyYXkgam9pbnMgaXRzIGJsb2NrczsgYW5cbiAqIG9iamVjdCBpcyBwcm9iZWQgZm9yIHRoZSBmaXJzdCB7QGxpbmsgUkVTUE9OU0VfVEVYVF9GSUVMRFN9IGVudHJ5IHRoYXRcbiAqIGhvbGRzIGEgc3RyaW5nLCBjYXJyeWluZyBhbG9uZyBgc3RkZXJyYCwgYGV4aXRDb2RlYC9gZXhpdFN0YXR1c2AsIGFuZCB0aGVcbiAqIHR3by1yZWdpbWUgbWFya2VycyB3aGVuIHRoZSBlbnZlbG9wZSBoYXMgdGhlbSBcdTIwMTQgYHJhd091dHB1dFBhdGhgIHNldCAodGhlXG4gKiBpbmxpbmUgc3Rkb3V0IGlzIG9ubHkgYSBwcmV2aWV3KSBiZWNvbWVzIGB0cnVuY2F0ZWQ6IHRydWVgOyBgaW50ZXJydXB0ZWRgXG4gKiBvciBgdGltZWRPdXRBZnRlck1zYCAodGhlIGNvbW1hbmQgd2FzIGN1dCBvZmYgbWlkLXJ1bikgYmVjb21lc1xuICogYGludGVycnVwdGVkOiB0cnVlYCwgdGhlIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lIFx1MjAxNCB0aGUgc2FtZSBub3JtYWxpemF0aW9uXG4gKiB0aGUgQ2xhdWRlIGFkYXB0ZXIgYXBwbGllcyB0byBpdHMgQmFzaCBlbnZlbG9wZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBub1xuICogdGV4dCBjYW4gYmUgcmVjb3ZlcmVkICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvXG4gKiBub24tb2JqZWN0KSwgd2hpY2ggdGhlIGNhbGxlciB0cmVhdHMgYXMgYW4gKnVucmVjb2duaXplZCogXHUyMDE0IG5vdCAqZmFpbGVkKiBcdTIwMTRcbiAqIHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTaGVsbFJlc3BvbnNlKHRvb2xSZXNwb25zZTogdW5rbm93bik6IE5vcm1hbGl6ZWRTaGVsbFJlc3BvbnNlIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnc3RyaW5nJykgcmV0dXJuIHsgc3Rkb3V0OiB0b29sUmVzcG9uc2UgfTtcbiAgaWYgKEFycmF5LmlzQXJyYXkodG9vbFJlc3BvbnNlKSkge1xuICAgIGNvbnN0IHRleHQ6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBibG9jayBvZiB0b29sUmVzcG9uc2UpIHtcbiAgICAgIGlmIChibG9jayAhPT0gbnVsbCAmJiB0eXBlb2YgYmxvY2sgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gKGJsb2NrIGFzIHsgdGV4dD86IHVua25vd24gfSkudGV4dDtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHRleHQucHVzaCh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IHN0ZG91dDogdGV4dC5qb2luKCcnKSB9O1xuICB9XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSB0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBSRVNQT05TRV9URVhUX0ZJRUxEUykge1xuICAgICAgY29uc3QgdmFsdWUgPSByZWNvcmRbZmllbGRdO1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGRvdXQ6IHZhbHVlLFxuICAgICAgICAgIHN0ZGVycjogdHlwZW9mIHJlY29yZC5zdGRlcnIgPT09ICdzdHJpbmcnID8gcmVjb3JkLnN0ZGVyciA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBleGl0U3RhdHVzOlxuICAgICAgICAgICAgdHlwZW9mIHJlY29yZC5leGl0Q29kZSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICAgPyByZWNvcmQuZXhpdENvZGVcbiAgICAgICAgICAgICAgOiB0eXBlb2YgcmVjb3JkLmV4aXRTdGF0dXMgPT09ICdudW1iZXInXG4gICAgICAgICAgICAgICAgPyByZWNvcmQuZXhpdFN0YXR1c1xuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHRydW5jYXRlZDogcmVjb3JkLnJhd091dHB1dFBhdGggIT09IHVuZGVmaW5lZCxcbiAgICAgICAgICBpbnRlcnJ1cHRlZDogcmVjb3JkLmludGVycnVwdGVkID09PSB0cnVlIHx8IHJlY29yZC50aW1lZE91dEFmdGVyTXMgIT09IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBDbGFzc2lmeSBhbiBgYXBwbHlfcGF0Y2hgIGB0b29sX3Jlc3BvbnNlYCBmb3IgdGhlIHRvdWNoIGdhdGU6XG4gKlxuICogLSBgJ3N1Y2Nlc3MnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGZyb20gYSBiYXJlIHN0cmluZyBvciBhIHRleHQtZmllbGRcbiAqICAgb2JqZWN0IGFuZCBjYXJyaWVzIHtAbGluayBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWH0uXG4gKiAtIGAnZmFpbHVyZSdgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgZnJvbSBhIGJhcmUgc3RyaW5nIG9yIGEgdGV4dC1maWVsZFxuICogICBvYmplY3QgYnV0IGxhY2tzIHRoZSBoZWFkZXI6IGEgZ2VudWluZSByZWplY3Rpb24gb3IgZXJyb3IuIFRoZSBPTkxZXG4gKiAgIGNsYXNzaWZpY2F0aW9uIHRoYXQgc3VwcHJlc3NlcyB0aGUgdG91Y2guXG4gKiAtIGAndW5rbm93bidgIFx1MjAxNCBubyB0ZXh0IGNvdWxkIGJlIHJlY292ZXJlZCAodW5yZWNvZ25pemVkIHNoYXBlKSwgb3IgdGhlXG4gKiAgIHJlc3BvbnNlIGlzIGEgYmxvY2svdGV4dCBhcnJheS4gV2UgcHJvY2VlZCBkZWZlbnNpdmVseSBoZXJlIHJhdGhlciB0aGFuXG4gKiAgIHJpc2sgbWlzc2luZyBhIHJlYWwgZWRpdCdzIGhlYWwvc3VyZmFjZTsgQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZVxuICogICBvbmx5IG9uIHN1Y2Nlc3MsIHNvIHRoaXMgY2Fubm90IGhlYWwvc3VyZmFjZSBhIHBhdGNoIHRoYXQgbmV2ZXIgYXBwbGllZC5cbiAqXG4gKiBUaGUgYXJyYXkgY2hlY2sgcmVzdG9yZXMgdGhlIHByZS1ub3JtYWxpemVyIGNvbnRyYWN0OiB0aGUgYmFzZWxpbmVcbiAqIGBleHRyYWN0UmVzcG9uc2VUZXh0YCByZXR1cm5lZCBgbnVsbGAgZm9yIGV2ZXJ5IGFycmF5IHNoYXBlICh0ZXh0LWJsb2NrLFxuICogZW1wdHksIG5vbi10ZXh0KSwgc28gYXJyYXlzIGNsYXNzaWZpZWQgYCd1bmtub3duJ2AgYW5kIHByb2NlZWRlZCB3aXRoIGFcbiAqIHdhcm5pbmcuIGBub3JtYWxpemVTaGVsbFJlc3BvbnNlYCBkZWxpYmVyYXRlbHkgd2lkZW5lZCB0byBhcnJheXMgZm9yIHRoZVxuICogc2hlbGwtcGFyc2UgZXZpZGVuY2Ugc291cmNlLCBzbyBjbGFzc2lmaWNhdGlvbiByZWFkcyB0aGUgcmF3IGVudmVsb3BlIHRvXG4gKiBrZWVwIHRoZSBhcHBseV9wYXRjaCBnYXRlIGJlaGF2aW9yLWlkZW50aWNhbCBcdTIwMTQgYSBqb2luZWQgYXJyYXkgd2hvc2UgdGV4dFxuICogbWVyZWx5IGxhY2tzIHRoZSBzdWNjZXNzIGhlYWRlciBtdXN0IG5ldmVyIGJlIG1pc3Rha2VuIGZvciBhIGNvbmZpcm1lZFxuICogcmVqZWN0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodG9vbFJlc3BvbnNlKSkgcmV0dXJuICd1bmtub3duJztcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVNoZWxsUmVzcG9uc2UodG9vbFJlc3BvbnNlKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiBub3JtYWxpemVkLnN0ZG91dC5zdGFydHNXaXRoKEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYKSA/ICdzdWNjZXNzJyA6ICdmYWlsdXJlJztcbn1cblxuLyoqIEEgcmVhZGVyIHRoYXQgYWx3YXlzIGRlY2xpbmVzLCBmb3JjaW5nIHRoZSBwYXJzZXIgdG8gd2hvbGUtZmlsZSBhbmNob3JzLiAqL1xuY29uc3Qgbm9SYW5nZVJlY292ZXJ5ID0gKCk6IG51bGwgPT4gbnVsbDtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCB0b29sX25hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IGlucHV0LnNlc3Npb25faWQ7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuXG4gICAgLy8gU2hlbGwgdG91Y2g6IGV4dHJhY3QgdGhlIGNvbW1hbmQgZnJvbSB3aGljaGV2ZXIgZW52ZWxvcGUgc2hhcGUgdGhlIGhhcm5lc3NcbiAgICAvLyBkZWxpdmVycywgcGFyc2UsIGFuZCBydW4gZWFjaCByZXNvbHZlZCBzcGFuIHRocm91Z2ggdGhlIHNoYXJlZCB0b3VjaCBjb3JlLlxuICAgIC8vIFRoZSBicmFuY2ggYWxzbyBub3JtYWxpemVzIGB0b29sX3Jlc3BvbnNlYCB2aWEgYG5vcm1hbGl6ZVNoZWxsUmVzcG9uc2VgXG4gICAgLy8gYW5kIG1lcmdlcyBgcGFyc2VSZXNwb25zZWAncyBzcGFucyBpbiBhcyByZWFkIHRvdWNoZXMgKHRoZSB0b29sX3Jlc3BvbnNlXG4gICAgLy8gcGFzcyBiZWxvdykuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBsZXQgd29ya2Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgY2FycmllcyBgd29ya2RpcmAgYmVzaWRlIGBjbWRgXG4gICAgICAgIC8vIChwbGFuIFx1MDBBNzgpIFx1MjAxNCB0aHJlYWQgaXQgdGhyb3VnaCBsaWtlIHRoZSBjb2RlLW1vZGUgZW52ZWxvcGUgYmVsb3cuXG4gICAgICAgIGNvbnN0IGNsYXNzaWMgPSBuYXJyb3dFeGVjQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgY29tbWFuZCA9IGNsYXNzaWM/LmNtZCA/PyBudWxsO1xuICAgICAgICB3b3JrZGlyID0gY2xhc3NpYz8ud29ya2RpciA/PyBudWxsO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICAgIHdvcmtkaXIgPSBjb2RlTW9kZS53b3JrZGlyO1xuICAgICAgfVxuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICAvLyBQbGFuIFx1MDBBNzg6IGEgd29ya2RpciBwcmVzZW50IGFuZCBmcmVlIG9mIGAkYC9iYWNrdGljayBhYnNvbHV0aXplcyBhZ2FpbnN0XG4gICAgICAvLyB0aGUgZW52ZWxvcGUncyBvd24gYGlucHV0LmN3ZGAgXHUyMDE0IHRoZSBzaGVsbCB0b29sIHJlc29sdmVzIGEgcmVsYXRpdmVcbiAgICAgIC8vIHdvcmtkaXIgYWdhaW5zdCB0aGF0IHNhbWUgYmFzZSBcdTIwMTQgYW5kIGlzIHRoZSBzaW5nbGUgZnJhbWUgZm9yIHRoZSB3aG9sZVxuICAgICAgLy8gdG91Y2ggKHBhcnNlIGJhc2UsIGFic29sdXRpemF0aW9uLCBzY29wZSBjaGVjaywgYW5kIHRoZSB0b3VjaCByZWNvcmQnc1xuICAgICAgLy8gY3dkLCB3aGljaCB0aGUgZXhlY3V0b3JzIGRyaXZlIHRoZWlyIGdpdCBzcGFuIHJ1bnMgZnJvbSkuIEFcbiAgICAgIC8vIHRlbXBsYXRlLWxpdGVyYWwgd29ya2RpciAoY29udGFpbmluZyBgJGAvYmFja3RpY2spIGlzIHVucmVzb2x2YWJsZSBhbmRcbiAgICAgIC8vIGZhbGxzIGJhY2sgdG8gaG9vayBgY3dkYC5cbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUN3ZCA9IHdvcmtkaXIgIT09IG51bGwgJiYgIS9bYCRdLy50ZXN0KHdvcmtkaXIpID8gcmVzb2x2ZVBhdGgoY3dkLCB3b3JrZGlyKSA6IGN3ZDtcblxuICAgICAgY29uc3QgbWF0Y2hlcyA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIHsgY3dkOiBlZmZlY3RpdmVDd2QgfSk7XG4gICAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIG1hdGNoZXMpIHtcbiAgICAgICAgaWYgKG1hdGNoLnN0YXR1cyAhPT0gJ3Jlc29sdmVkJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHNwYW4gPSBtYXRjaC5zcGFuO1xuICAgICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoZWZmZWN0aXZlQ3dkLCBzcGFuLmFic29sdXRlUGF0aCk7XG4gICAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoZWZmZWN0aXZlQ3dkLCBhYnNQYXRoKTtcbiAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgIGxldCB0b3VjaElucHV0OiB7XG4gICAgICAgICAga2luZDogJ3JlYWQnIHwgJ3dyaXRlJztcbiAgICAgICAgICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgICAgICAgICBjd2Q6IHN0cmluZztcbiAgICAgICAgICBmaWxlUGF0aDogc3RyaW5nO1xuICAgICAgICAgIG9mZnNldD86IG51bWJlcjtcbiAgICAgICAgICBsaW1pdD86IG51bWJlcjtcbiAgICAgICAgICB3cml0dGVuPzogc3RyaW5nO1xuICAgICAgICB9O1xuICAgICAgICBpZiAobWF0Y2guaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJykge1xuICAgICAgICAgIC8vIGA+YCBvdmVyd3JpdGVzOiB3aG9sZS1maWxlIHNjb3BlIHNvIGRlbGV0ZWQgc3BhbnMgYmV5b25kIHRoZSBuZXdcbiAgICAgICAgICAvLyBFT0YgYXJlIHN1cmZhY2VkLiBgPj5gIGFwcGVuZHM6IG5hcnJvdyB0byB0aGUgYXBwZW5kZWQgbGluZXMuXG4gICAgICAgICAgY29uc3Qgd3JpdHRlbiA9IHNwYW4ucmVkaXJlY3QgPT09ICc+JyA/ICcnIDogKHNwYW4uYm9keSA/PyAnJyk7XG4gICAgICAgICAgdG91Y2hJbnB1dCA9IHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2Q6IGVmZmVjdGl2ZUN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW4gfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0b3VjaElucHV0ID0ge1xuICAgICAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgY3dkOiBlZmZlY3RpdmVDd2QsXG4gICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2hJbnB1dCBhcyBUb3VjaElucHV0LCBleGVjdXRvcnMsIG1lbW8pO1xuICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgfVxuICAgICAgLy8gVGhlIHRvb2xfcmVzcG9uc2UgaXMgYSBzZWNvbmQgZXZpZGVuY2Ugc291cmNlIGZvciB0aGUgc2hlbGw6XG4gICAgICAvLyByZXNwb25zZS1kZXJpdmFibGUgY29tbWFuZHMgKGdyZXAvcmlwZ3JlcCB3aXRoIG51bWJlcmVkIG91dHB1dCxcbiAgICAgIC8vIGdpdCBkaWZmL3Nob3cvbG9nIC1wLCBnaXQgYmxhbWUgLUwpIGxvY2F0ZSB0aGVpciByZWFkIHdpbmRvd3MgaW4gdGhlXG4gICAgICAvLyBvdXRwdXQsIHdoaWNoIHRoZSBjb21tYW5kIHRleHQgYWxvbmUgY2Fubm90LiBOb3JtYWxpemUgdGhlIGVudmVsb3BlLFxuICAgICAgLy8gbWVyZ2UgaXRzIHNwYW5zIHdpdGggdGhlIGNvbW1hbmQtZGVyaXZlZCBvbmVzLCBhbmQgcnVuIGVhY2ggYXMgYVxuICAgICAgLy8gcmVhZCB0b3VjaDsgdGhlIG1lbW8gZGVkdXBlcyBkdXBsaWNhdGUgc3VyZmFjZXMgYWNyb3NzIHRoZSBzb3VyY2VzLlxuICAgICAgLy8gQW4gdW5yZWNvZ25pemVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIGNvbW1hbmQtb25seSBwYXJzaW5nLlxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBub3JtYWxpemVTaGVsbFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgICAgaWYgKHJlc3BvbnNlICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3BhbiBvZiBwYXJzZVJlc3BvbnNlKHsgY29tbWFuZCwgY3dkLCAuLi5yZXNwb25zZSB9KSkge1xuICAgICAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICAgICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgY3dkLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgICAgb2Zmc2V0OiBzcGFuLmxpbmVTdGFydCxcbiAgICAgICAgICAgICAgbGltaXQ6IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgICAgIG1lbW9cbiAgICAgICAgICApO1xuICAgICAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIFN1cHByZXNzIG9ubHkgYSAqY29uZmlybWVkKiBub24tc3VjY2Vzcy4gQW4gdW5yZWNvZ25pemVkIHJlc3BvbnNlIHNoYXBlXG4gICAgLy8gcHJvY2VlZHMgKHdpdGggYSB3YXJuaW5nKSByYXRoZXIgdGhhbiByaXNrIHNraXBwaW5nIGEgcmVhbCBlZGl0J3MgdG91Y2guXG4gICAgY29uc3QgY2xhc3NpZmljYXRpb24gPSBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZShpbnB1dC50b29sX3Jlc3BvbnNlKTtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICdmYWlsdXJlJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICd1bmtub3duJykge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdDb2RleCBhcHBseV9wYXRjaCB0b29sX3Jlc3BvbnNlIHNoYXBlIHVucmVjb2duaXplZDsgcnVubmluZyB0b3VjaCBkZWZlbnNpdmVseScsIHtcbiAgICAgICAgdG9vbFJlc3BvbnNlVHlwZTogdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UsXG4gICAgICAgIHRvb2xSZXNwb25zZUtleXM6XG4gICAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9yZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBPbmUgZW52ZWxvcGUgbWF5IHRvdWNoIHNldmVyYWwgZmlsZXM7IGZvcmNlIHdob2xlLWZpbGUgYW5jaG9ycyAoQ29kZXggbmV2ZXJcbiAgICAvLyByZWNvdmVycyBhIHBvc3QtZWRpdCByYW5nZSkgYW5kIHJ1biB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgcGVyIHRvdWNoZWQgZmlsZS5cbiAgICAvLyBUaGUgc2hhcmVkIG1lbW8gZGVkdXBlcyBzcGFuIHJlbmRlcnMgYWNyb3NzIGFuY2hvcnMgYW5kIHRoZSBzZXNzaW9uLlxuICAgIGNvbnN0IGFuY2hvcnMgPSBwYXJzZUFwcGx5UGF0Y2goY29tbWFuZCwgbm9SYW5nZVJlY292ZXJ5KTtcbiAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoOiBhYnNQYXRoLCB3cml0dGVuOiAnJyB9LFxuICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgIG1lbW9cbiAgICAgICk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdhcHBseV9wYXRjaHxleGVjX2NvbW1hbmR8ZXhlY3xCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiZnVuY3Rpb24gYXR0YWNoTWV0YWRhdGEoaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9vayA9IGhhbmRsZXI7XG4gICAgaG9vay5ob29rRXZlbnROYW1lID0gaG9va0V2ZW50TmFtZTtcbiAgICBob29rLnRpbWVvdXQgPSBjb25maWcudGltZW91dDtcbiAgICBob29rLnN0YXR1c01lc3NhZ2UgPSBjb25maWcuc3RhdHVzTWVzc2FnZTtcbiAgICBpZiAoXCJtYXRjaGVyXCIgaW4gY29uZmlnICYmIHR5cGVvZiBjb25maWcubWF0Y2hlciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBob29rLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICB9XG4gICAgcmV0dXJuIGhvb2s7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlVzZXJQcm9tcHRTdWJtaXRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlNlc3Npb25TdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VEcmlmdFBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRHJpZnRQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRHJpZnRQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBEcmlmdFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGVtYmVkZGVkIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50XG4gKiBsYW5ndWFnZSdzIEFTVCwgbm90IGEgc2hlbGwgY29uY2VybiksIHNlZCAtaSAobm8gbGluZS1hZGRyZXNzZWQgdXNhZ2VcbiAqIG9ic2VydmVkIFx1MjAxNCBhbGwgcGF0dGVybi1vbmx5IHN1YnN0aXR1dGlvbnMgd2l0aCBubyBzdGF0aWMgcmFuZ2UpLCBwbGFpblxuICogYGVjaG9gL2BwcmludGZgIHJlZGlyZWN0cyAocmFyZSBhbmQgc2VtYW50aWNhbGx5IGFtYmlndW91cyBpbiB0aGUgY29ycHVzKS5cbiAqXG4gKiBUaGUgZ3JlcCBmYW1pbHkgKGdyZXAgLW4vLUEvLUIvLUMpIGlzIG5vdCBpbiB0aGF0IGxpc3QsIGJ1dCBpdCBpcyBub3RcbiAqIGNsYXNzaWZpZWQgaGVyZSBlaXRoZXI6IGl0cyB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2ggcG9zaXRpb24sIHdoaWNoIGlzXG4gKiBkYXRhLWRlcGVuZGVudCBhbmQgbGl2ZXMgaW4gdGhlIHJlc3BvbnNlLCBub3QgdGhlIGNvbW1hbmQgdGV4dC4gVGhvc2Ugc3BhbnNcbiAqIGFyZSByZXNwb25zZS1kZXJpdmVkIFx1MjAxNCBgcGFyc2VSZXNwb25zZWAgaW4gLi9wYXJzZS1yZXNwb25zZS5qcyByZWFkcyB0aGVtXG4gKiBvdXQgb2YgdGhlIGNvbW1hbmQncyBgdG9vbF9yZXNwb25zZWAuIFRoZSBgZ2l0IGxvZyAtTGAgLyBgZ2l0IHNob3dcbiAqIHJldjpwYXRoYCBpZGlvbXMgYmVsb3cgcmVtYWluIGNvbW1hbmQtdGV4dC1kZXJpdmVkLlxuICovXG5pbXBvcnQgeyBpc0Fic29sdXRlLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7XG4gIGFyZ3ZPZixcbiAgdHlwZSBPcGVyYXRvcixcbiAgdHlwZSBTaW1wbGVDb21tYW5kLFxuICBzcGxpdFRvcExldmVsLFxuICBzcGxpdFdvcmRzLFxuICBzdHJpcFJlZGlyZWN0cyxcbiAgc3RyaXBXcmFwcGVyc1xufSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IERFRkFVTFRfUEFUSF9BTExPV0xJU1QsIGV4cGFuZFZhcmlhYmxlcyB9IGZyb20gJy4vdmFyaWFibGUtZXhwYW5kLmpzJztcblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZFNwYW4ge1xuICBsaW5lU3RhcnQ6IG51bWJlcjtcbiAgbGluZUVuZDogbnVtYmVyO1xuICBhYnNvbHV0ZVBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBleGFjdCBib2R5IG9mIGEgYGhlcmVkb2Mtd3JpdGVgIHNwYW4gXHUyMDE0IHRoZSBjb250ZW50IHRoZSBoZXJlZG9jIHdyaXRlcy5cbiAgICogQWJzZW50ICh1bmRlZmluZWQpIGZvciByZWFkIGlkaW9tcy5cbiAgICovXG4gIGJvZHk/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgaGVyZWRvYyByZWRpcmVjdCBvcGVyYXRvci4gYD5gIG1lYW5zIHRoZSBmaWxlIHdhcyBvdmVyd3JpdHRlblxuICAgKiAod2hvbGUtZmlsZSBzY29wZSBcdTIwMTQgYW55IHNwYW4gYmV5b25kIHRoZSBuZXcgRU9GIHdhcyBkZWxldGVkIGFuZCBtdXN0XG4gICAqIHN1cmZhY2UpOyBgPj5gIG1lYW5zIHRoZSBib2R5IHdhcyBhcHBlbmRlZCAobmFycm93IHRvIHRoZSBhcHBlbmQgcmFuZ2UpLlxuICAgKiBBYnNlbnQgKHVuZGVmaW5lZCkgZm9yIHJlYWQgaWRpb21zLlxuICAgKi9cbiAgcmVkaXJlY3Q/OiAnPicgfCAnPj4nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnO1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKiBPcHRpb25zIGZvciB0aGUgQmFzaCBjb21tYW5kIHBhcnNlciAocGxhbiBcdTAwQTc4KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VPcHRpb25zIHtcbiAgLyoqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0byByZXNvbHZlIHJlbGF0aXZlIHBhdGhzIGFnYWluc3Q7IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYC4gKi9cbiAgY3dkPzogc3RyaW5nO1xuICAvKiogVGhlIGhvb2sgcHJvY2VzcyBlbnYsIGZvciBhbGxvd2xpc3RlZCBwYXRoLXZhcmlhYmxlIHJlc29sdXRpb247IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmVudmAuICovXG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD47XG4gIC8qKiBWYXJpYWJsZSBuYW1lcyBhbGxvd2VkIHRvIHJlc29sdmUgZnJvbSBgZW52YDsgZGVmYXVsdHMgdG8gYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgLiAqL1xuICBhbGxvd2xpc3Q/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIFdoZXRoZXIgYSBzaW1wbGUgY29tbWFuZCBpcyBrbm93biB0byBoYXZlIGV4ZWN1dGVkLCBwcm92YWJseSBub3QsIG9yIHVuZGV0ZXJtaW5hYmxlIChwbGFuIFx1MDBBNzIpLiAqL1xuZXhwb3J0IHR5cGUgRXhlY1N0YXR1cyA9ICd5ZXMnIHwgJ25vJyB8ICd1bmtub3duJztcblxuLyoqIFRoZSBleGVjdXRpb24tYXdhcmUgd2FsaydzIHZlcmRpY3QgZm9yIG9uZSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTcyKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VFeGVjIHtcbiAgLyoqIGAneWVzJ2AgXHUyMDE0IHByb3ZhYmx5IGV4ZWN1dGVkOyBgJ25vJ2AgXHUyMDE0IHByb3ZhYmx5IG5vdDsgYCd1bmtub3duJ2AgXHUyMDE0IHVuZGV0ZXJtaW5hYmxlIChmYWlsIGNsb3NlZCkuICovXG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG59XG5cbi8qKlxuICogQ29tcHV0ZSwgcGVyIHNpbXBsZSBjb21tYW5kLCB3aGV0aGVyIGl0IGV4ZWN1dGVkIChwbGFuIFx1MDBBNzIpOiBwaXBlbGluZVxuICogZ3JvdXBpbmcsIGAmJmAvYHx8YCBjaGFpbiBnYXRpbmcgYWdhaW5zdCBrbm93biBzdGF0dXNlcywgYCFgIGdyb3VwLWxldmVsXG4gKiBuZWdhdGlvbiwgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIHRlcm1pbmF0b3IgYW5kIG5ldmVyLXJldHVyblxuICogZmlyZXMsIGFuZCB0aGUgZGVjaWRhYmxlLWNvbnRyb2wgY29uc3RydWN0IGNsYXNzZXMuIElPLWZyZWUgYW5kIGV4cG9ydGVkIHNvXG4gKiB0aGUgeHRyYWNlIG9yYWNsZSBjYW4gY29tcGFyZSBleGVjdXRlZCBzZXRzIGFnYWluc3QgcmVhbCBiYXNoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5hbHl6ZUV4ZWN1dGlvbihzaW1wbGVDb21tYW5kczogU2ltcGxlQ29tbWFuZFtdLCBfb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBTdGFnZUV4ZWNbXSB7XG4gIGNvbnN0IHdhbGtlciA9IG5ldyBFeGVjdXRpb25XYWxrZXIoKTtcbiAgd2Fsa2VyLndhbGtJbnB1dChzaW1wbGVDb21tYW5kcyk7XG4gIHJldHVybiB3YWxrZXIudmVyZGljdHMubWFwKChleGVjKSA9PiAoeyBleGVjIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeGVjdXRpb24gd2FsayAocGxhbiBcdTAwQTcyKTogcGVyLXNpbXBsZS1jb21tYW5kIEV4ZWNTdGF0dXMsIGRyaXZlbiBieSBwaXBlbGluZVxuLy8gZ3JvdXBpbmcsICYmL3x8IGNoYWluIHN0YXR1cywgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIGFuZCB0aGVcbi8vIGRlY2lkYWJsZS1jb250cm9sIGNvbnN0cnVjdCBjbGFzc2VzLiBUaGUgd2FsayBhbHNvIGV4cGFuZHMgZGVjaWRhYmxlXG4vLyBjb25zdHJ1Y3QgaW50ZXJpb3JzIGludG8gdGhlIHN0YWdlIHN0cmVhbSB0aGUgZW1pc3Npb24gcmVwbGF5IGNvbnN1bWVzLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgQ2hhaW5TdGF0dXMgPSAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bic7XG5cbnR5cGUgRGVhZEtpbmQgPSAnZXhpdCcgfCAnbmV2ZXItcmV0dXJuJyB8ICdlcnJleGl0JyB8ICdtYWxmb3JtZWQnO1xuXG4vKiogT25lIHN0YWdlIHRoZSB3YWxrIGNvbnRyaWJ1dGVzIHRvIHRoZSBlbWlzc2lvbiByZXBsYXkuICovXG5pbnRlcmZhY2UgRXhwYW5kZWRTdGFnZSB7XG4gIHRleHQ6IHN0cmluZztcbiAgcHJlY2VkZWRCeTogT3BlcmF0b3I7XG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gIC8qKiBBIG1lbWJlciBvZiBhIG11bHRpLW1lbWJlciBwaXBlbGluZTogc2lkZSBlZmZlY3RzIGFuZCBgZXhpdGAvYGV4ZWNgIHRlcm1pbmF0b3JzIGFyZSBzdXBwcmVzc2VkLiAqL1xuICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAvKiogVGhlIGVtaXNzaW9uJ3MgYGNkYCBmcmFtZTogKzEgaW5zaWRlIGEgc3Vic2hlbGwgaW50ZXJpb3IsIGRpc2NhcmRlZCBhdCB0aGUgY2xvc2UuICovXG4gIGRpckZyYW1lOiBudW1iZXI7XG4gIC8qKiBUaGUgc2NyaXB0IHZhcmlhYmxlIHRhYmxlIGFzIG9mIHRoaXMgc3RhZ2UgKHBsYW4gXHUwMEE3Nyk6IHRoZSBleGVjdXRlZCBub24tcGlwZSBhc3NpZ25tZW50cyBzZWVuIHNvIGZhciwgaW4gb3JkZXIuICovXG4gIGFzc2lnbm1lbnRzOiBSZWFkb25seU1hcDxzdHJpbmcsIHN0cmluZz47XG59XG5cbmludGVyZmFjZSBMb29wRnJhbWUge1xuICBvdXRjb21lOiAnbm9uZScgfCAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdhbWJpZ3VvdXMnIHwgJ3JldHVybic7XG4gIC8qKiBBIGRlY2lzaXZlIG93bi1kZXB0aCBicmVhay9jb250aW51ZSBmaXJlZDogdGhlIHJlc3Qgb2YgdGhlIGJvZHkgbGlzdCBpcyBkZWFkLiAqL1xuICBib2R5VGVybWluYXRlZDogYm9vbGVhbjtcbiAgLyoqIEEgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIG1hZGUgdGhlIGd1YXJkIG9ud2FyZCB1bnRvdWNoYWJsZS4gKi9cbiAgYW1iaWd1b3VzU3RvcDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFdhbGtPcHRpb25zIHtcbiAgLyoqIEVycmV4aXQgbGl2ZW5lc3MgaXMgc3VzcGVuZGVkIGluc2lkZSBpZi93aGlsZS91bnRpbCBjb25kaXRpb25zIChiYXNoIGV4ZW1wdHMgdGhlbSkuICovXG4gIGxpdmVuZXNzOiBib29sZWFuO1xuICAvKiogVGhlIGV4cGFuZGVkIHN0YWdlIHN0cmVhbSBpcyBkaXNjYXJkZWQgKGNvbmRpdGlvbnMsIHNjYW5zLCBkZWYtYm9keSBwcm9iZXMpLiAqL1xuICBkaXNjYXJkOiBib29sZWFuO1xuICAvKiogU2lkZSBlZmZlY3RzIChhc3NpZ25tZW50cywgc2V0IHRvZ2dsZXMsIGRlZiByZWdpc3RyYXRpb24pIGFyZSBhcHBsaWVkLiAqL1xuICBzaWRlRWZmZWN0czogYm9vbGVhbjtcbiAgLyoqIFRoaXMgbGlzdCBpcyB0aGUgdG9wLWxldmVsIGlucHV0OiByZWNvcmQgdGhlIHBlci1pbnB1dCB2ZXJkaWN0cy4gKi9cbiAgaW5wdXRGYWNpbmc6IGJvb2xlYW47XG59XG5cbmNvbnN0IEFTU0lHTk1FTlRfUkUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqIFRoZSBgLW9gL2Arb2Agb3B0aW9uIG5hbWVzIG9mIGBzZXRgIHRoYXQgYmFzaCBkb2N1bWVudHMgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX09QVElPTl9OQU1FUyA9IG5ldyBTZXQoW1xuICAnYWxsZXhwb3J0JyxcbiAgJ2JyYWNlZXhwYW5kJyxcbiAgJ2VtYWNzJyxcbiAgJ2VycmV4aXQnLFxuICAnZXJydHJhY2UnLFxuICAnZnVuY3RyYWNlJyxcbiAgJ2hhc2hhbGwnLFxuICAnaGlzdGV4cGFuZCcsXG4gICdoaXN0b3J5JyxcbiAgJ2lnbm9yZWVvZicsXG4gICdpbnRlcmFjdGl2ZS1jb21tZW50cycsXG4gICdrZXl3b3JkJyxcbiAgJ2xleGljYWwtd29yZC1wcm9jZXNzaW5nJyxcbiAgJ21vbml0b3InLFxuICAnbm9jbG9iYmVyJyxcbiAgJ25vZXhlYycsXG4gICdub2dsb2InLFxuICAnbm9sb2cnLFxuICAnbm90aWZ5JyxcbiAgJ25vdW5zZXQnLFxuICAnb25lY21kJyxcbiAgJ3BoeXNpY2FsJyxcbiAgJ3BpcGVmYWlsJyxcbiAgJ3Bvc2l4JyxcbiAgJ3ByaXZpbGVnZWQnLFxuICAndmVyYm9zZScsXG4gICd2aScsXG4gICd4dHJhY2UnXG5dKTtcblxuLyoqIGJhc2gncyBkb2N1bWVudGVkIHNpbmdsZS1sZXR0ZXIgYHNldGAgZmxhZ3MgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX0ZMQUdfTEVUVEVSUyA9ICdhQmJDZUVmaEhpa21ub3BQdFR1dngnO1xuXG4vKiogQnVpbHRpbnMgdGhlIHdhbGsncyByZXN0cmljdGVkIGBidWlsdGluYCB3cmFwcGVyIHN0cmlwIGZvcndhcmRzIChwbGFuIFx1MDBBNzIsIHdyYXBwZXIgZGlzY2lwbGluZSkuICovXG5jb25zdCBSRUNPR05JWkVEX0JVSUxUSU5TID0gbmV3IFNldChbXG4gICd0cnVlJyxcbiAgJzonLFxuICAnZmFsc2UnLFxuICAnc2V0JyxcbiAgJ2V4aXQnLFxuICAnZXhlYycsXG4gICdyZXR1cm4nLFxuICAnYnJlYWsnLFxuICAnY29udGludWUnLFxuICAnY2QnLFxuICAnZXhwb3J0JyxcbiAgJ2NvbW1hbmQnLFxuICAnYnVpbHRpbidcbl0pO1xuXG4vKiogV2Fsay1zaWRlIHdyYXBwZXIgc3RyaXA6IGAhYCwgYGNvbW1hbmRgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKS4gKi9cbmZ1bmN0aW9uIHdhbGtTdHJpcChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdjb21tYW5kJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdidWlsdGluJyAmJiBhcmd2W2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIFJFQ09HTklaRURfQlVJTFRJTlMuaGFzKGFyZ3ZbaSArIDFdKSlcbiAgICBpKys7XG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKiogRW1pc3Npb24tc2lkZSBzdHJpcDogbGVhZGluZyBgIWAsIGBjb21tYW5kYCwgYGV4ZWNgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKSBiZWZvcmUgbWF0Y2hlciBkaXNwYXRjaC4gKi9cbmZ1bmN0aW9uIHN0cmlwRm9yRW1pc3Npb24oYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnIScpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiAoYXJndltpXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbaV0gPT09ICdleGVjJykpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnYnVpbHRpbicgJiYgYXJndltpICsgMV0gIT09IHVuZGVmaW5lZCAmJiBSRUNPR05JWkVEX0JVSUxUSU5TLmhhcyhhcmd2W2kgKyAxXSkpXG4gICAgaSsrO1xuICByZXR1cm4gYXJndi5zbGljZShpKTtcbn1cblxuLyoqIEV2ZXJ5IGFyZyBhIHJlY29nbml6ZWQgYHNldGAgZmxhZyBncm91cCAoYC1vYCBjb25zdW1lcyBpdHMgbmFtZSksIGAtLWAsIG9yIGEgcG9zaXRpb25hbCB3b3JkLiAqL1xuZnVuY3Rpb24gc2V0RmxhZ3NLbm93bihhcmdzOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpIHx8IGEuc3RhcnRzV2l0aCgnKycpKSB7XG4gICAgICBjb25zdCBjaGFycyA9IGEuc2xpY2UoMSk7XG4gICAgICBpZiAoY2hhcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNoYXJzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjaGFyc1trXTtcbiAgICAgICAgaWYgKGMgPT09ICdvJykge1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkIHx8ICFTRVRfT1BUSU9OX05BTUVTLmhhcyhuYW1lKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgfSBlbHNlIGlmICghU0VUX0ZMQUdfTEVUVEVSUy5pbmNsdWRlcyhjKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBBIHBvc2l0aW9uYWwgcGFyYW1ldGVyIHdvcmQgXHUyMDE0IGBzZXQgZm9vYCBleGl0cyAwLlxuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEEgcXVvdGUtYXdhcmUgc2NhbiBvZiBhIGNvbnN0cnVjdCdzIHRleHQgdGhhdCB5aWVsZHMgaXRzIHdvcmRzIChxdW90ZVxuICogY29udGVudCBzdHJpcHBlZCkgd2l0aCB0aGUgcGFyZW4vYnJhY2UvY29uc3RydWN0IGRlcHRocyBhdCBlYWNoIHdvcmQsIHNvXG4gKiBgdGhlbmAvYGRvYC9gZG9uZWAvYGZpYC9gZXNhY2AvYGluYCBrZXl3b3JkcyBhcmUgcmVjb2duaXplZCBvbmx5IGF0IHRoZVxuICogbGV2ZWwgdGhhdCBvd25zIHRoZW0uXG4gKi9cbmludGVyZmFjZSBXb3JkVG9rIHtcbiAgd29yZDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbiAgZGVwdGg6IG51bWJlcjtcbiAgYnJhY2VEZXB0aDogbnVtYmVyO1xuICBjb25zdHJ1Y3REZXB0aDogbnVtYmVyO1xuICBxdW90ZWQ6IGJvb2xlYW47XG59XG5cbmNvbnN0IENPTlNUUlVDVF9PUEVORVJTID0gbmV3IFNldChbJ2lmJywgJ3doaWxlJywgJ3VudGlsJywgJ2ZvcicsICdjYXNlJywgJ3NlbGVjdCddKTtcbmNvbnN0IENPTlNUUlVDVF9DTE9TRVJTID0gbmV3IFNldChbJ2ZpJywgJ2RvbmUnLCAnZXNhYyddKTtcblxuZnVuY3Rpb24gc2NhblRva2Vucyh0ZXh0OiBzdHJpbmcpOiBXb3JkVG9rW10ge1xuICBjb25zdCB0b2tzOiBXb3JkVG9rW10gPSBbXTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIGxldCBwYXJlbkRlcHRoID0gMDtcbiAgbGV0IGJyYWNlRGVwdGggPSAwO1xuICBsZXQgY29uc3RydWN0RGVwdGggPSAwO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcgfHwgYyA9PT0gJ3snKSB7XG4gICAgICBpZiAoYyA9PT0gJygnKSBwYXJlbkRlcHRoKys7XG4gICAgICBlbHNlIGJyYWNlRGVwdGgrKztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknIHx8IGMgPT09ICd9Jykge1xuICAgICAgaWYgKGMgPT09ICcpJykgcGFyZW5EZXB0aCA9IE1hdGgubWF4KDAsIHBhcmVuRGVwdGggLSAxKTtcbiAgICAgIGVsc2UgYnJhY2VEZXB0aCA9IE1hdGgubWF4KDAsIGJyYWNlRGVwdGggLSAxKTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJzsmfDw+Jy5pbmNsdWRlcyhjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyA9PT0gbnVsbCkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGkgPSB3LmVuZDtcbiAgICB0b2tzLnB1c2goeyB3b3JkOiB3LndvcmQsIHN0YXJ0LCBlbmQ6IHcuZW5kLCBkZXB0aDogcGFyZW5EZXB0aCwgYnJhY2VEZXB0aCwgY29uc3RydWN0RGVwdGgsIHF1b3RlZDogdy5xdW90ZWQgfSk7XG4gICAgaWYgKHBhcmVuRGVwdGggPT09IDAgJiYgYnJhY2VEZXB0aCA9PT0gMCAmJiAhdy5xdW90ZWQpIHtcbiAgICAgIGlmIChDT05TVFJVQ1RfT1BFTkVSUy5oYXMody53b3JkKSkgY29uc3RydWN0RGVwdGgrKztcbiAgICAgIGVsc2UgaWYgKENPTlNUUlVDVF9DTE9TRVJTLmhhcyh3LndvcmQpKSBjb25zdHJ1Y3REZXB0aCA9IE1hdGgubWF4KDAsIGNvbnN0cnVjdERlcHRoIC0gMSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0b2tzO1xufVxuXG4vKiogUmVhZCBvbmUgd29yZCBhdCBgaWAgKHF1b3RlLWF3YXJlLCBzZXBhcmF0b3ItdGVybWluYXRlZCk7IHJldHVybnMgaXRzIGNvbnRlbnQgYW5kIHNwYW4uICovXG5mdW5jdGlvbiByZWFkV29yZEF0KHRleHQ6IHN0cmluZywgaTogbnVtYmVyKTogeyB3b3JkOiBzdHJpbmc7IGVuZDogbnVtYmVyOyBxdW90ZWQ6IGJvb2xlYW4gfSB8IG51bGwge1xuICBpZiAoaSA+PSB0ZXh0Lmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIGxldCB3b3JkID0gJyc7XG4gIGxldCBxdW90ZWQgPSBmYWxzZTtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4gJiYgIS9cXHMvLnRlc3QodGV4dFtpXSkgJiYgIScoKXt9OyZ8PD4nLmluY2x1ZGVzKHRleHRbaV0pKSB7XG4gICAgY29uc3QgY2ggPSB0ZXh0W2ldO1xuICAgIGlmIChjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBpKys7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgdGV4dFtpXSAhPT0gXCInXCIpIHtcbiAgICAgICAgd29yZCArPSB0ZXh0W2ldO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgICBpZiAoaSA8IG4pIGkrKztcbiAgICB9IGVsc2UgaWYgKGNoID09PSAnXCInKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgaSsrO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHRleHRbaV0gIT09ICdcIicpIHtcbiAgICAgICAgaWYgKHRleHRbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W2kgKyAxXSkpIHtcbiAgICAgICAgICB3b3JkICs9IHRleHRbaSArIDFdO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3b3JkICs9IHRleHRbaV07XG4gICAgICAgICAgaSsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA8IG4pIGkrKztcbiAgICB9IGVsc2UgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICB3b3JkICs9IHRleHRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB3b3JkICs9IGNoO1xuICAgICAgaSsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyB3b3JkLCBlbmQ6IGksIHF1b3RlZCB9O1xufVxuXG4vKiogVGhlIGludGVyaW9yIGJldHdlZW4gdGhlIGZpcnN0IGBvcGVuYCBjaGFyIGFuZCBpdHMgbWF0Y2hpbmcgYGNsb3NlYCwgcXVvdGVzIGF3YXJlLiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdyb3VwQm9keSh0ZXh0OiBzdHJpbmcsIG9wZW46ICd7JyB8ICcoJywgY2xvc2U6ICd9JyB8ICcpJyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBzdGFydCA9IHRleHQuaW5kZXhPZihvcGVuKTtcbiAgaWYgKHN0YXJ0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgcCA9IHN0YXJ0OyBwIDwgdGV4dC5sZW5ndGg7IHArKykge1xuICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBwICsgMSA8IHRleHQubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSBwKys7XG4gICAgICBlbHNlIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICBwKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBvcGVuKSBkZXB0aCsrO1xuICAgIGVsc2UgaWYgKGNoID09PSBjbG9zZSkge1xuICAgICAgZGVwdGgtLTtcbiAgICAgIGlmIChkZXB0aCA9PT0gMCkgcmV0dXJuIHRleHQuc2xpY2Uoc3RhcnQgKyAxLCBwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbnR5cGUgQ29uc3RydWN0S2luZCA9ICdpZicgfCAnd2hpbGUnIHwgJ3VudGlsJyB8ICdmb3InIHwgJ2Nhc2UnIHwgJ3NlbGVjdCcgfCAnYnJhY2UnIHwgJ3N1YnNoZWxsJyB8ICdkZWYnIHwgJ3BsYWluJztcblxuZnVuY3Rpb24gY2xhc3NpZnlTdGFnZSh0ZXh0OiBzdHJpbmcpOiBDb25zdHJ1Y3RLaW5kIHtcbiAgY29uc3QgdCA9IHRleHQudHJpbVN0YXJ0KCk7XG4gIGlmICh0LnN0YXJ0c1dpdGgoJ3snKSkgcmV0dXJuICdicmFjZSc7XG4gIGlmICh0LnN0YXJ0c1dpdGgoJygnKSkgcmV0dXJuICdzdWJzaGVsbCc7XG4gIGNvbnN0IGt3ID0gdC5tYXRjaCgvXihpZnx3aGlsZXx1bnRpbHxmb3J8Y2FzZXxzZWxlY3QpXFxiLyk7XG4gIGlmIChrdyAhPT0gbnVsbCkgcmV0dXJuIGt3WzFdIGFzIENvbnN0cnVjdEtpbmQ7XG4gIGlmICgvXig/OmZ1bmN0aW9uXFxzKyk/W0EtWmEtel9dW0EtWmEtejAtOV9dKlxcKFxcKVxccypcXHsvLnRlc3QodCkpIHJldHVybiAnZGVmJztcbiAgcmV0dXJuICdwbGFpbic7XG59XG5cbi8qKiBBIGZ1bmN0aW9uIGRlZmluaXRpb24ncyBuYW1lIGFuZCBib2R5IHRleHQgKGJyYWNlLWdyb3VwIGludGVyaW9yKS4gKi9cbmZ1bmN0aW9uIHBhcnNlRGVmKHRleHQ6IHN0cmluZyk6IHsgbmFtZTogc3RyaW5nOyBib2R5OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCBtID0gdGV4dC5tYXRjaCgvXig/OmZ1bmN0aW9uXFxzKyk/KFtBLVphLXpfXVtBLVphLXowLTlfXSopXFxzKig/OlxcKFxcKSk/XFxzKlxcey8pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGJvZHkgPSBleHRyYWN0R3JvdXBCb2R5KHRleHQsICd7JywgJ30nKTtcbiAgaWYgKGJvZHkgPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBuYW1lOiBtWzFdLCBib2R5IH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRJZiB7XG4gIGNvbmRpdGlvbjogc3RyaW5nO1xuICB0aGVuQm9keTogc3RyaW5nO1xuICBlbGlmczogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXTtcbiAgZWxzZUJvZHk6IHN0cmluZyB8IG51bGw7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSWYodGV4dDogc3RyaW5nKTogUGFyc2VkSWYgfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09ICdpZicpIHJldHVybiBudWxsO1xuICBjb25zdCB0aGVuSWR4ID0gdG9rcy5maW5kSW5kZXgoKHQpID0+IHQud29yZCA9PT0gJ3RoZW4nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAodGhlbklkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBjb25zdCB0aGVuVG9rID0gdG9rc1t0aGVuSWR4XTtcbiAgY29uc3QgY29uZGl0aW9uID0gdGV4dC5zbGljZSh0b2tzWzBdLmVuZCwgdGhlblRvay5zdGFydCk7XG5cbiAgY29uc3QgYm91bmRhcmllczogeyB3b3JkOiBzdHJpbmc7IHRvazogV29yZFRvayB9W10gPSBbXTtcbiAgZm9yIChsZXQgaWR4ID0gdGhlbklkeCArIDE7IGlkeCA8IHRva3MubGVuZ3RoOyBpZHgrKykge1xuICAgIGNvbnN0IHQgPSB0b2tzW2lkeF07XG4gICAgaWYgKHQuY29uc3RydWN0RGVwdGggIT09IDEgfHwgKHQud29yZCAhPT0gJ2VsaWYnICYmIHQud29yZCAhPT0gJ2Vsc2UnICYmIHQud29yZCAhPT0gJ2ZpJykpIGNvbnRpbnVlO1xuICAgIGlmICh0LndvcmQgPT09ICdlbGlmJykge1xuICAgICAgY29uc3QgZVRoZW5JZHggPSB0b2tzLmZpbmRJbmRleCgodHQsIGlpKSA9PiBpaSA+IGlkeCAmJiB0dC53b3JkID09PSAndGhlbicgJiYgdHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICAgICAgaWYgKGVUaGVuSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBib3VuZGFyaWVzLnB1c2goeyB3b3JkOiAnZWxpZicsIHRvazogdCB9LCB7IHdvcmQ6ICd0aGVuJywgdG9rOiB0b2tzW2VUaGVuSWR4XSB9KTtcbiAgICAgIGlkeCA9IGVUaGVuSWR4O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGJvdW5kYXJpZXMucHVzaCh7IHdvcmQ6IHQud29yZCwgdG9rOiB0IH0pO1xuICAgIGlmICh0LndvcmQgPT09ICdlbHNlJykge1xuICAgICAgY29uc3QgZmlJZHggPSB0b2tzLmZpbmRJbmRleCgodHQsIGlpKSA9PiBpaSA+IGlkeCAmJiB0dC53b3JkID09PSAnZmknICYmIHR0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgICAgIGlmIChmaUlkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgYm91bmRhcmllcy5wdXNoKHsgd29yZDogJ2ZpJywgdG9rOiB0b2tzW2ZpSWR4XSB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBicmVhaztcbiAgfVxuICBpZiAoYm91bmRhcmllcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRoZW5Cb2R5ID0gdGV4dC5zbGljZSh0aGVuVG9rLmVuZCwgYm91bmRhcmllc1swXS50b2suc3RhcnQpO1xuICBjb25zdCBlbGlmczogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXSA9IFtdO1xuICBsZXQgZWxzZUJvZHk6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBiID0gMDsgYiA8IGJvdW5kYXJpZXMubGVuZ3RoOyBiKyspIHtcbiAgICBjb25zdCB7IHdvcmQsIHRvayB9ID0gYm91bmRhcmllc1tiXTtcbiAgICBpZiAod29yZCA9PT0gJ2VsaWYnKSB7XG4gICAgICBjb25zdCBlVGhlbiA9IGJvdW5kYXJpZXNbYiArIDFdO1xuICAgICAgaWYgKGVUaGVuID09PSB1bmRlZmluZWQgfHwgZVRoZW4ud29yZCAhPT0gJ3RoZW4nKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IG5leHRTdGFydCA9IGJvdW5kYXJpZXNbYiArIDJdPy50b2suc3RhcnQgPz8gdGV4dC5sZW5ndGg7XG4gICAgICBlbGlmcy5wdXNoKHsgY29uZGl0aW9uOiB0ZXh0LnNsaWNlKHRvay5lbmQsIGVUaGVuLnRvay5zdGFydCksIGJvZHk6IHRleHQuc2xpY2UoZVRoZW4udG9rLmVuZCwgbmV4dFN0YXJ0KSB9KTtcbiAgICAgIGIrKztcbiAgICB9IGVsc2UgaWYgKHdvcmQgPT09ICdlbHNlJykge1xuICAgICAgY29uc3QgZmkgPSBib3VuZGFyaWVzW2IgKyAxXTtcbiAgICAgIGlmIChmaSA9PT0gdW5kZWZpbmVkIHx8IGZpLndvcmQgIT09ICdmaScpIHJldHVybiBudWxsO1xuICAgICAgZWxzZUJvZHkgPSB0ZXh0LnNsaWNlKHRvay5lbmQsIGZpLnRvay5zdGFydCk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgY29uZGl0aW9uLCB0aGVuQm9keSwgZWxpZnMsIGVsc2VCb2R5IH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlTG9vcCh0ZXh0OiBzdHJpbmcsIGtleXdvcmQ6ICd3aGlsZScgfCAndW50aWwnKTogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09IGtleXdvcmQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb1RvayA9IHRva3MuZmluZCgodCkgPT4gdC53b3JkID09PSAnZG8nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9Ub2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvbmVUb2sgPSB0b2tzLmZpbmQoKHQpID0+IHQuc3RhcnQgPiBkb1Rvay5lbmQgJiYgdC53b3JkID09PSAnZG9uZScgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb25lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBjb25kaXRpb246IHRleHQuc2xpY2UodG9rc1swXS5lbmQsIGRvVG9rLnN0YXJ0KSwgYm9keTogdGV4dC5zbGljZShkb1Rvay5lbmQsIGRvbmVUb2suc3RhcnQpIH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRGb3Ige1xuICBsaXN0OiBzdHJpbmdbXSB8IG51bGw7XG4gIGJvZHk6IHN0cmluZztcbiAgd2hvbGVJbnRlcmlvcjogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBwYXJzZUZvcih0ZXh0OiBzdHJpbmcpOiBQYXJzZWRGb3IgfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09ICdmb3InKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbmFtZVRvayA9IHRva3NbMV07XG4gIGlmIChuYW1lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb1RvayA9IHRva3MuZmluZCgodCkgPT4gdC53b3JkID09PSAnZG8nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEgJiYgdC5zdGFydCA+IG5hbWVUb2suZW5kKTtcbiAgaWYgKGRvVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb25lVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LnN0YXJ0ID4gZG9Ub2suZW5kICYmIHQud29yZCA9PT0gJ2RvbmUnICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9uZVRvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW5Ub2sgPSB0b2tzLmZpbmQoXG4gICAgKHQpID0+IHQuc3RhcnQgPiBuYW1lVG9rLmVuZCAmJiB0LnN0YXJ0IDwgZG9Ub2suc3RhcnQgJiYgdC53b3JkID09PSAnaW4nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDFcbiAgKTtcbiAgbGV0IGxpc3Q6IHN0cmluZ1tdIHwgbnVsbCA9IG51bGw7XG4gIGlmIChpblRvayAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbGlzdCA9IHRva3MuZmlsdGVyKCh0KSA9PiB0LnN0YXJ0ID4gaW5Ub2suZW5kICYmIHQuc3RhcnQgPCBkb1Rvay5zdGFydCkubWFwKCh0KSA9PiB0LndvcmQpO1xuICB9XG4gIHJldHVybiB7IGxpc3QsIGJvZHk6IHRleHQuc2xpY2UoZG9Ub2suZW5kLCBkb25lVG9rLnN0YXJ0KSwgd2hvbGVJbnRlcmlvcjogdGV4dC5zbGljZShuYW1lVG9rLmVuZCwgZG9uZVRvay5zdGFydCkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZENhc2Uge1xuICBzdWJqZWN0OiBzdHJpbmc7XG4gIGJyYW5jaGVzOiB7IHBhdHRlcm46IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXTtcbiAgZmFsbHRocm91Z2g6IGJvb2xlYW47XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ2FzZSh0ZXh0OiBzdHJpbmcpOiBQYXJzZWRDYXNlIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICBjb25zdCBza2lwV3MgPSAoKSA9PiB7XG4gICAgd2hpbGUgKGkgPCBuICYmIC9cXHMvLnRlc3QodGV4dFtpXSkpIGkrKztcbiAgfTtcbiAgc2tpcFdzKCk7XG4gIGNvbnN0IGxlYWQgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICBpZiAobGVhZCA9PT0gbnVsbCB8fCBsZWFkLndvcmQgIT09ICdjYXNlJykgcmV0dXJuIG51bGw7XG4gIGkgPSBsZWFkLmVuZDtcblxuICAvLyBUaGUgc3ViamVjdCB3b3JkcyB1cCB0byB0aGUgYGluYCBhdCBwYXJlbiBkZXB0aCAwIChxdW90ZSBjb250ZW50IG9ubHkpLlxuICBsZXQgcGFyZW5EZXB0aCA9IDA7XG4gIGNvbnN0IHN1YmplY3RXb3Jkczogc3RyaW5nW10gPSBbXTtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgc2tpcFdzKCk7XG4gICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgYyA9IHRleHRbaV07XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgcGFyZW5EZXB0aCsrO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIHBhcmVuRGVwdGggPSBNYXRoLm1heCgwLCBwYXJlbkRlcHRoIC0gMSk7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCc7Jnw8PicuaW5jbHVkZXMoYykpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyA9PT0gbnVsbCkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGkgPSB3LmVuZDtcbiAgICBpZiAocGFyZW5EZXB0aCA9PT0gMCAmJiAhdy5xdW90ZWQgJiYgdy53b3JkID09PSAnaW4nKSBicmVhaztcbiAgICBzdWJqZWN0V29yZHMucHVzaCh3LndvcmQpO1xuICB9XG4gIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGJyYW5jaGVzOiB7IHBhdHRlcm46IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXSA9IFtdO1xuICBsZXQgZmFsbHRocm91Z2ggPSBmYWxzZTtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBza2lwV3MoKTtcbiAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyAhPT0gbnVsbCAmJiAhdy5xdW90ZWQgJiYgdy53b3JkID09PSAnZXNhYycpIHtcbiAgICAgIHJldHVybiB7IHN1YmplY3Q6IHN1YmplY3RXb3Jkcy5qb2luKCcgJyksIGJyYW5jaGVzLCBmYWxsdGhyb3VnaCB9O1xuICAgIH1cbiAgICAvLyBUaGUgcGF0dGVybjogZXZlcnl0aGluZyB1cCB0byB0aGUgYClgIGF0IHBhcmVuIGRlcHRoIDAuXG4gICAgbGV0IHBhdEVuZCA9IC0xO1xuICAgIHtcbiAgICAgIGxldCBwID0gaTtcbiAgICAgIGxldCBkZXB0aCA9IDA7XG4gICAgICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICB3aGlsZSAocCA8IG4pIHtcbiAgICAgICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgICAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgcCArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSB7XG4gICAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKCcpIHtcbiAgICAgICAgICBkZXB0aCsrO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcpJykge1xuICAgICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgICAgcGF0RW5kID0gcDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZXB0aC0tO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBwKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwYXRFbmQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXR0ZXJuID0gdGV4dC5zbGljZShpLCBwYXRFbmQpLnRyaW0oKTtcbiAgICBpID0gcGF0RW5kICsgMTtcblxuICAgIC8vIFRoZSBib2R5OiBldmVyeXRoaW5nIHVwIHRvIHRoZSBgOztgL2A7JmAvYDs7JmAgYXQgcGFyZW4vYnJhY2UgZGVwdGggMC5cbiAgICBsZXQgYm9keUVuZCA9IC0xO1xuICAgIGxldCB0ZXJtID0gJyc7XG4gICAge1xuICAgICAgbGV0IHAgPSBpO1xuICAgICAgbGV0IGRlcHRoID0gMDtcbiAgICAgIGxldCBiZGVwdGggPSAwO1xuICAgICAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgd2hpbGUgKHAgPCBuKSB7XG4gICAgICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICAgICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIHAgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbcCArIDFdKSkge1xuICAgICAgICAgICAgcCArPSAyO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgICAgICBpblF1b3RlID0gY2g7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICAgICAgcCArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJygnKSB7XG4gICAgICAgICAgZGVwdGgrKztcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKScpIHtcbiAgICAgICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ3snKSB7XG4gICAgICAgICAgYmRlcHRoKys7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ30nKSB7XG4gICAgICAgICAgYmRlcHRoID0gTWF0aC5tYXgoMCwgYmRlcHRoIC0gMSk7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCAmJiBiZGVwdGggPT09IDAgJiYgY2ggPT09ICc7Jykge1xuICAgICAgICAgIGNvbnN0IG5leHQgPSB0ZXh0W3AgKyAxXTtcbiAgICAgICAgICBpZiAobmV4dCA9PT0gJzsnIHx8IG5leHQgPT09ICcmJykge1xuICAgICAgICAgICAgdGVybSA9IG5leHQgPT09ICc7JyA/ICh0ZXh0W3AgKyAyXSA9PT0gJyYnID8gJzs7JicgOiAnOzsnKSA6ICc7Jic7XG4gICAgICAgICAgICBib2R5RW5kID0gcDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBwKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0ZXJtID09PSAnJykgcmV0dXJuIG51bGw7XG4gICAgYnJhbmNoZXMucHVzaCh7IHBhdHRlcm4sIGJvZHk6IHRleHQuc2xpY2UoaSwgYm9keUVuZCkudHJpbSgpIH0pO1xuICAgIGkgPSBib2R5RW5kICsgdGVybS5sZW5ndGg7XG4gICAgaWYgKHRlcm0gPT09ICc7JicgfHwgdGVybSA9PT0gJzs7JicpIGZhbGx0aHJvdWdoID0gdHJ1ZTtcbiAgfVxufVxuXG4vKiogUmVzb2x2ZSBhIGBjYXNlYCBzdWJqZWN0IGFnYWluc3QgdGhlIHJlY29yZGVkIGFzc2lnbm1lbnRzIChwbGFuIFx1MDBBNzEsIGRlY2lkYWJsZSBjYXNlKS4gKi9cbmZ1bmN0aW9uIHJlc29sdmVTdWJqZWN0KHN1YmplY3Q6IHN0cmluZywgYXNzaWdubWVudHM6IE1hcDxzdHJpbmcsIHN0cmluZz4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbSA9IHN1YmplY3QubWF0Y2goL15cXCQoW0EtWmEtel9dW0EtWmEtejAtOV9dKikkLykgPz8gc3ViamVjdC5tYXRjaCgvXlxcJFxceyhbQS1aYS16X11bQS1aYS16MC05X10qKVxcfSQvKTtcbiAgaWYgKG0gIT09IG51bGwpIHtcbiAgICBjb25zdCB2ID0gYXNzaWdubWVudHMuZ2V0KG1bMV0pO1xuICAgIHJldHVybiB2ICE9PSB1bmRlZmluZWQgPyB2IDogbnVsbDtcbiAgfVxuICBpZiAoL1skYF0vLnRlc3Qoc3ViamVjdCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc3ViamVjdDtcbn1cblxuLyoqXG4gKiBBbHRlcm5hdGl2ZSBzcGxpdCBvZiBhIGBjYXNlYCBwYXR0ZXJuIG9uIHVucXVvdGVkIGB8YC4gVGhlIGFsdGVybmF0aXZlcyBhcmVcbiAqIHJldHVybmVkIHZlcmJhdGltIFx1MjAxNCBxdW90ZXMgYW5kIGJhY2tzbGFzaCBlc2NhcGVzIHByZXNlcnZlZCBcdTIwMTQgc29cbiAqIGBhbmFseXplUGF0dGVybmAncyBxdW90ZSBoYW5kbGluZyBpcyB0aGUgc2luZ2xlIGludGVycHJldGVyOiBzdHJpcHBpbmcgdGhlbVxuICogaGVyZSB3b3VsZCB0dXJuIGAnYSonYCBpbnRvIGFuIHVucXVvdGVkIGdsb2IgYW5kIGBcXHxgIGludG8gYSBzcGxpdCBwb2ludC5cbiAqL1xuZnVuY3Rpb24gc3BsaXRQYXR0ZXJuQWx0ZXJuYXRpdmVzKHBhdHRlcm46IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXIgPSAnJztcbiAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhdHRlcm4ubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHBhdHRlcm5baV07XG4gICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHBhdHRlcm5baSArIDFdKSkge1xuICAgICAgICBjdXIgKz0gY2g7XG4gICAgICAgIGN1ciArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkge1xuICAgICAgICBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgY3VyICs9IGNoO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGN1ciArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjdXIgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCkge1xuICAgICAgY3VyICs9IGNoO1xuICAgICAgY3VyICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ3wnKSB7XG4gICAgICBwYXJ0cy5wdXNoKGN1cik7XG4gICAgICBjdXIgPSAnJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXIgKz0gY2g7XG4gIH1cbiAgcGFydHMucHVzaChjdXIpO1xuICByZXR1cm4gcGFydHM7XG59XG5cbi8qKlxuICogUXVvdGUtYXdhcmUgcGF0dGVybiBhbmFseXNpczogdGhlIGxpdGVyYWwgdmFsdWUgKHF1b3RlcyBzdHJpcHBlZCwgYmFja3NsYXNoXG4gKiBlc2NhcGVzIHJlc29sdmVkKSBhbmQgd2hldGhlciBhbnkgdW5xdW90ZWQgZ2xvYiBjaGFyIGFwcGVhcnMuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IHsgbGl0ZXJhbDogc3RyaW5nOyBnbG9iOiBib29sZWFuIH0ge1xuICBsZXQgbGl0ZXJhbCA9ICcnO1xuICBsZXQgZ2xvYiA9IGZhbHNlO1xuICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGF0dGVybi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gcGF0dGVybltpXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXMocGF0dGVybltpICsgMV0pKSB7XG4gICAgICAgIGxpdGVyYWwgKz0gcGF0dGVybltpICsgMV07XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY2ggPT09IGluUXVvdGUpIHtcbiAgICAgICAgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGl0ZXJhbCArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCkge1xuICAgICAgbGl0ZXJhbCArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJyo/WycuaW5jbHVkZXMoY2gpKSB7XG4gICAgICBnbG9iID0gdHJ1ZTtcbiAgICAgIGxpdGVyYWwgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgbGl0ZXJhbCArPSBjaDtcbiAgfVxuICByZXR1cm4geyBsaXRlcmFsLCBnbG9iIH07XG59XG5cbnR5cGUgUGF0dGVyblJlc3VsdCA9ICdtYXRjaCcgfCAnbm8tbWF0Y2gnIHwgJ2dsb2InIHwgJ3VuZGVjaWRhYmxlJztcblxuLyoqXG4gKiBGaXh0dXJlLXBpbm5lZCBgY2FzZWAgcGF0dGVybiBldmFsdWF0aW9uIChwbGFuIFx1MDBBNzEsIGRlY2lkYWJsZSBjYXNlKTogYSBgfGBcbiAqIHBhdHRlcm4gaXMgZGVjaWRhYmxlIGlmZiBpdHMgZmlyc3QgYWx0ZXJuYXRpdmUgaXMgYSBsaXRlcmFsIG1hdGNoIGFuZCBldmVyeVxuICogYWx0ZXJuYXRpdmUgYWZ0ZXIgdGhlIGZpcnN0IGlzIGEgZ2xvYiAoZGVhZCk7IGEgZ2xvYiBiZWZvcmUgYW55IGxpdGVyYWxcbiAqIG1hdGNoIGlzIHVuZGVjaWRhYmxlLCBhbmQgYSBsYXRlciBsaXRlcmFsIG5vbi1tYXRjaCBhZnRlciBhIGxpdGVyYWwgbWF0Y2hcbiAqIGlzIHVuZGVjaWRhYmxlICh0aGUgYWxsLWxpdGVyYWwgYGF8YmAgZmFpbC1jbG9zZWQgZGl2ZXJnZW5jZSBcdTIwMTQgYmFzaCBydW5zXG4gKiB0aGUgYnJhbmNoKS5cbiAqL1xuZnVuY3Rpb24gZXZhbFBhdHRlcm4ocGF0dGVybjogc3RyaW5nLCBzdWJqZWN0OiBzdHJpbmcpOiBQYXR0ZXJuUmVzdWx0IHtcbiAgY29uc3QgYWx0cyA9IHNwbGl0UGF0dGVybkFsdGVybmF0aXZlcyhwYXR0ZXJuKTtcbiAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBhbHQgb2YgYWx0cykge1xuICAgIGNvbnN0IHsgbGl0ZXJhbCwgZ2xvYiB9ID0gYW5hbHl6ZVBhdHRlcm4oYWx0KTtcbiAgICBpZiAoZ2xvYikge1xuICAgICAgaWYgKCFtYXRjaGVkKSByZXR1cm4gJ2dsb2InO1xuICAgIH0gZWxzZSBpZiAobGl0ZXJhbCA9PT0gc3ViamVjdCkge1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSBlbHNlIGlmIChtYXRjaGVkKSB7XG4gICAgICByZXR1cm4gJ3VuZGVjaWRhYmxlJztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1hdGNoZWQgPyAnbWF0Y2gnIDogJ25vLW1hdGNoJztcbn1cblxuLyoqIFRoZSBleGVjdXRpb24gd2FsaydzIHNoYXJlZCBzdGF0ZSwgb25lIGluc3RhbmNlIHBlciBgcGFyc2VDb21tYW5kRGV0YWlsZWRgIGNhbGwuICovXG5jbGFzcyBFeGVjdXRpb25XYWxrZXIge1xuICBjaGFpbjogQ2hhaW5TdGF0dXMgPSAnc3VjY2Vzcyc7XG4gIGVycmV4aXQgPSBmYWxzZTtcbiAgcGlwZWZhaWwgPSBmYWxzZTtcbiAgYXNzaWdubWVudHMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBkZWZzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZGVhZDogRGVhZEtpbmQgfCBudWxsID0gbnVsbDtcbiAgcmV0dXJuZWQgPSBmYWxzZTtcbiAgZm5EZXB0aCA9IDA7XG4gIGxvb3BTdGFjazogTG9vcEZyYW1lW10gPSBbXTtcbiAgcmVhZG9ubHkgZXhwYW5kZWQ6IEV4cGFuZGVkU3RhZ2VbXSA9IFtdO1xuICByZWFkb25seSB2ZXJkaWN0czogRXhlY1N0YXR1c1tdID0gW107XG4gIGRpckZyYW1lID0gMDtcbiAgcmVhZG9ubHkgZGVmUHJvYmVTdGFjayA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIHdhbGtJbnB1dChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSk6IEV4cGFuZGVkU3RhZ2VbXSB7XG4gICAgdGhpcy53YWxrTGlzdChzdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IGZhbHNlLCBzaWRlRWZmZWN0czogdHJ1ZSwgaW5wdXRGYWNpbmc6IHRydWUgfSk7XG4gICAgcmV0dXJuIHRoaXMuZXhwYW5kZWQ7XG4gIH1cblxuICBwcml2YXRlIHN0b3BwZWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKHRoaXMuZGVhZCAhPT0gbnVsbCB8fCB0aGlzLnJldHVybmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB0b3AgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICByZXR1cm4gdG9wICE9PSB1bmRlZmluZWQgJiYgKHRvcC5ib2R5VGVybWluYXRlZCB8fCB0b3AuYW1iaWd1b3VzU3RvcCk7XG4gIH1cblxuICAvKiogV2FsayBvbmUgbGlzdCAoYSBmcmVzaCBgJiZgL2B8fGAgY2hhaW4pOyByZXR1cm5zIHRoZSBsaXN0J3MgZmluYWwgY2hhaW4gc3RhdHVzLiAqL1xuICBwcml2YXRlIHdhbGtMaXN0KHN0YWdlczogU2ltcGxlQ29tbWFuZFtdLCBvcHRzOiBXYWxrT3B0aW9ucyk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBzYXZlZENoYWluID0gdGhpcy5jaGFpbjtcbiAgICB0aGlzLmNoYWluID0gJ3N1Y2Nlc3MnO1xuICAgIGxldCBpID0gMDtcbiAgICB3aGlsZSAoaSA8IHN0YWdlcy5sZW5ndGggJiYgIXRoaXMuc3RvcHBlZCgpKSB7XG4gICAgICBjb25zdCBlbmQgPSB0aGlzLmdyb3VwRW5kKHN0YWdlcywgaSk7XG4gICAgICBjb25zdCBuZXh0ID0gZW5kIDwgc3RhZ2VzLmxlbmd0aCA/IHN0YWdlc1tlbmRdIDogbnVsbDtcbiAgICAgIHRoaXMucHJvY2Vzc0dyb3VwKHN0YWdlcy5zbGljZShpLCBlbmQpLCBuZXh0LCBvcHRzKTtcbiAgICAgIGkgPSBlbmQ7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuY2hhaW47XG4gICAgd2hpbGUgKGkgPCBzdGFnZXMubGVuZ3RoKSB7XG4gICAgICBpZiAob3B0cy5pbnB1dEZhY2luZykgdGhpcy52ZXJkaWN0cy5wdXNoKCdubycpO1xuICAgICAgaSsrO1xuICAgIH1cbiAgICB0aGlzLmNoYWluID0gc2F2ZWRDaGFpbjtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBncm91cEVuZChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gICAgbGV0IGVuZCA9IHN0YXJ0O1xuICAgIHdoaWxlIChlbmQgKyAxIDwgc3RhZ2VzLmxlbmd0aCAmJiBzdGFnZXNbZW5kICsgMV0ucHJlY2VkZWRCeSA9PT0gJ3BpcGUnKSBlbmQrKztcbiAgICByZXR1cm4gZW5kICsgMTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc0dyb3VwKGdyb3VwOiBTaW1wbGVDb21tYW5kW10sIG5leHQ6IFNpbXBsZUNvbW1hbmQgfCBudWxsLCBvcHRzOiBXYWxrT3B0aW9ucyk6IHZvaWQge1xuICAgIGNvbnN0IGZpcnN0ID0gZ3JvdXBbMF07XG4gICAgbGV0IGV4ZWN1dGVzOiBib29sZWFuIHwgJ3Vua25vd24nO1xuICAgIHN3aXRjaCAoZmlyc3QucHJlY2VkZWRCeSkge1xuICAgICAgY2FzZSAnYW5kJzpcbiAgICAgICAgZXhlY3V0ZXMgPSB0aGlzLmNoYWluID09PSAnc3VjY2VzcycgPyB0cnVlIDogdGhpcy5jaGFpbiA9PT0gJ2ZhaWx1cmUnID8gZmFsc2UgOiAndW5rbm93bic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnb3InOlxuICAgICAgICBleGVjdXRlcyA9IHRoaXMuY2hhaW4gPT09ICdmYWlsdXJlJyA/IHRydWUgOiB0aGlzLmNoYWluID09PSAnc3VjY2VzcycgPyBmYWxzZSA6ICd1bmtub3duJztcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBleGVjdXRlcyA9IHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGV4ZWM6IEV4ZWNTdGF0dXMgPSBleGVjdXRlcyA9PT0gdHJ1ZSA/ICd5ZXMnIDogZXhlY3V0ZXMgPT09IGZhbHNlID8gJ25vJyA6ICd1bmtub3duJztcbiAgICBjb25zdCBiYWNrZ3JvdW5kZWQgPSBmaXJzdC5wcmVjZWRlZEJ5ID09PSAnYmFja2dyb3VuZCcgfHwgKG5leHQgIT09IG51bGwgJiYgbmV4dC5wcmVjZWRlZEJ5ID09PSAnYmFja2dyb3VuZCcpO1xuICAgIGlmIChvcHRzLmlucHV0RmFjaW5nKSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSsrKSB0aGlzLnZlcmRpY3RzLnB1c2goZXhlYyk7XG4gICAgfVxuXG4gICAgLy8gYCFgIGlzIGEgZ3JvdXAtbGV2ZWwgbW9kaWZpZXI6IHRoZSBjb3VudCBvZiBsZWFkaW5nIGAhYCB3b3JkcyBvbiB0aGVcbiAgICAvLyBmaXJzdCBtZW1iZXIncyBhcmd2IG5lZ2F0ZXMgdGhlIGdyb3VwJ3MgZmluYWwgc3RhdHVzIChvZGQgbmVnYXRlcykuXG4gICAgY29uc3QgZmlyc3RBcmd2ID0gYXJndk9mKGZpcnN0LnRleHQpO1xuICAgIGxldCBiYW5nQ291bnQgPSAwO1xuICAgIGxldCBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGwgPSBmaXJzdEFyZ3Y7XG4gICAgaWYgKGZpcnN0QXJndiAhPT0gbnVsbCkge1xuICAgICAgd2hpbGUgKG1lbWJlckFyZ3YhW2JhbmdDb3VudF0gPT09ICchJykgYmFuZ0NvdW50Kys7XG4gICAgICBtZW1iZXJBcmd2ID0gbWVtYmVyQXJndiEuc2xpY2UoYmFuZ0NvdW50KTtcbiAgICB9XG4gICAgY29uc3QgaW52ZXJ0ZWQgPSBiYW5nQ291bnQgJSAyID09PSAxO1xuXG4gICAgaWYgKGV4ZWMgPT09ICdubycpIHJldHVybjtcblxuICAgIGNvbnN0IHN0YXR1c2VzOiBDaGFpblN0YXR1c1tdID0gW107XG4gICAgY29uc3QgaW5QaXBlbGluZSA9IGdyb3VwLmxlbmd0aCA+IDE7XG4gICAgZm9yIChsZXQgbSA9IDA7IG0gPCBncm91cC5sZW5ndGg7IG0rKykge1xuICAgICAgc3RhdHVzZXMucHVzaChcbiAgICAgICAgdGhpcy5wcm9jZXNzTWVtYmVyKGdyb3VwW21dLCB7XG4gICAgICAgICAgZXhlYyxcbiAgICAgICAgICBpblBpcGVsaW5lLFxuICAgICAgICAgIGJhY2tncm91bmRlZCxcbiAgICAgICAgICBtZW1iZXJBcmd2OiBtID09PSAwID8gbWVtYmVyQXJndiA6IG51bGwsXG4gICAgICAgICAgb3B0c1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBUaGUgZ3JvdXAgc3RhdHVzOiB0aGUgbGFzdCBtZW1iZXIncywgdW5sZXNzIHBpcGVmYWlsIG1ha2VzIGl0IHRoZSB3b3JzdCBtZW1iZXIuXG4gICAgbGV0IGdyb3VwU3RhdHVzOiBDaGFpblN0YXR1cztcbiAgICBpZiAodGhpcy5waXBlZmFpbCAmJiBncm91cC5sZW5ndGggPiAxKSB7XG4gICAgICBpZiAoc3RhdHVzZXMuZXZlcnkoKHMpID0+IHMgPT09ICdzdWNjZXNzJykpIGdyb3VwU3RhdHVzID0gJ3N1Y2Nlc3MnO1xuICAgICAgZWxzZSBpZiAoc3RhdHVzZXMuc29tZSgocykgPT4gcyA9PT0gJ2ZhaWx1cmUnKSkgZ3JvdXBTdGF0dXMgPSAnZmFpbHVyZSc7XG4gICAgICBlbHNlIGdyb3VwU3RhdHVzID0gJ3Vua25vd24nO1xuICAgIH0gZWxzZSB7XG4gICAgICBncm91cFN0YXR1cyA9IHN0YXR1c2VzW3N0YXR1c2VzLmxlbmd0aCAtIDFdO1xuICAgIH1cbiAgICBpZiAoaW52ZXJ0ZWQpIHtcbiAgICAgIGdyb3VwU3RhdHVzID0gZ3JvdXBTdGF0dXMgPT09ICdzdWNjZXNzJyA/ICdmYWlsdXJlJyA6IGdyb3VwU3RhdHVzID09PSAnZmFpbHVyZScgPyAnc3VjY2VzcycgOiAndW5rbm93bic7XG4gICAgfVxuXG4gICAgLy8gRXJyZXhpdCBsaXZlbmVzczogYW4gZXhlY3V0aW5nIGdyb3VwIHdob3NlIG5vbi1leGVtcHQgbWVtYmVycyBkaWQgbm90XG4gICAgLy8gYWxsIHN1Y2NlZWQga2lsbHMgdGhlIHNoZWxsOyBldmVyeSBsYXRlciBzdGFnZSBpcyAnbm8nLlxuICAgIGlmIChvcHRzLmxpdmVuZXNzICYmIHRoaXMuZXJyZXhpdCAmJiBncm91cFN0YXR1cyAhPT0gJ3N1Y2Nlc3MnKSB7XG4gICAgICBjb25zdCBjaGFpbkZpbmFsID0gbmV4dCA9PT0gbnVsbCB8fCAobmV4dC5wcmVjZWRlZEJ5ICE9PSAnYW5kJyAmJiBuZXh0LnByZWNlZGVkQnkgIT09ICdvcicpO1xuICAgICAgaWYgKGNoYWluRmluYWwgJiYgIWludmVydGVkICYmICFiYWNrZ3JvdW5kZWQpIHRoaXMuZGVhZCA9ICdlcnJleGl0JztcbiAgICB9XG5cbiAgICBpZiAoZXhlYyA9PT0gJ3llcycpIHRoaXMuY2hhaW4gPSBncm91cFN0YXR1cztcbiAgICBlbHNlIHRoaXMuY2hhaW4gPSAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NNZW1iZXIoXG4gICAgbWVtYmVyOiBTaW1wbGVDb21tYW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBraW5kID0gY2xhc3NpZnlTdGFnZShtZW1iZXIudGV4dCk7XG4gICAgaWYgKGtpbmQgPT09ICdwbGFpbicpIHJldHVybiB0aGlzLnByb2Nlc3NQbGFpbk1lbWJlcihtZW1iZXIsIGN0eCk7XG4gICAgcmV0dXJuIHRoaXMucHJvY2Vzc0NvbnN0cnVjdChtZW1iZXIsIGtpbmQsIGN0eCk7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NQbGFpbk1lbWJlcihcbiAgICBtZW1iZXI6IFNpbXBsZUNvbW1hbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHsgZXhlYywgaW5QaXBlbGluZSwgYmFja2dyb3VuZGVkLCBtZW1iZXJBcmd2LCBvcHRzIH0gPSBjdHg7XG4gICAgY29uc3QgYXJndiA9IG1lbWJlckFyZ3YgPz8gYXJndk9mKG1lbWJlci50ZXh0KTtcbiAgICBjb25zdCBzdHJpcHBlZCA9IGFyZ3YgPT09IG51bGwgPyBudWxsIDogd2Fsa1N0cmlwKGFyZ3YpO1xuXG4gICAgLy8gU2lkZSBlZmZlY3RzIG9ubHkgZnJvbSBleGVjdXRlZCwgbm9uLXBpcGUgc3RhZ2VzLlxuICAgIGlmIChleGVjID09PSAneWVzJyAmJiAhaW5QaXBlbGluZSAmJiBvcHRzLnNpZGVFZmZlY3RzKSB7XG4gICAgICB0aGlzLmFwcGx5U2lkZUVmZmVjdHMobWVtYmVyLCBhcmd2LCBzdHJpcHBlZCk7XG4gICAgfVxuXG4gICAgLy8gVGhlIGtub3duIHN0YXR1cy5cbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmtub3duU3RhdHVzKGFyZ3YpO1xuXG4gICAgLy8gVGhlIHRlcm1pbmF0b3I6IGFuIGV4ZWN1dGVkIG9yIHVua25vd24tZXhlY3V0aW9uIG5vbi1waXBlIHN0YWdlIHdob3NlXG4gICAgLy8gdGVybWluYXRvciB3b3JkIChiYXJlLCBvciBiZWhpbmQgYGNvbW1hbmRgL2BidWlsdGluYCkgaXMgYGV4aXRgL2BleGVjYC5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiAoc3RyaXBwZWRbMF0gPT09ICdleGl0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ2V4ZWMnKSkge1xuICAgICAgdGhpcy5kZWFkID0gJ2V4aXQnO1xuICAgIH1cblxuICAgIC8vIFJldHVybi1zdG9wcGluZzogYSBwcm92YWJseS1maXJpbmcgY29tbWFuZC1wb3NpdGlvbiBgcmV0dXJuYCBhdFxuICAgIC8vIGZ1bmN0aW9uLWJvZHkgZGVwdGggZXhpdHMgdGhlIGZ1bmN0aW9uIFx1MjAxNCBldmVyeXRoaW5nIGFmdGVyIG5ldmVyIHJ1bnMuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgPT09ICd5ZXMnICYmIHRoaXMuZm5EZXB0aCA+IDAgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICdyZXR1cm4nKSB7XG4gICAgICB0aGlzLnJldHVybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHRvcCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgaWYgKHRvcCAhPT0gdW5kZWZpbmVkKSB0b3Aub3V0Y29tZSA9ICdyZXR1cm4nO1xuICAgIH1cblxuICAgIC8vIEJyZWFrL2NvbnRpbnVlIGV2ZW50cyAoYSBoaWRkZW4gYCd1bmtub3duJ2AtZXhlYyBvbmUgbWFrZXMgdGhlIGd1YXJkXG4gICAgLy8gdW50b3VjaGFibGUgXHUyMDE0IGFtYmlndW91cyBcdTIwMTQgcGVyIHRoZSBsb29wLXNjYW4gZGlzY2lwbGluZSkuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgIT09ICdubycgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgKHN0cmlwcGVkWzBdID09PSAnYnJlYWsnIHx8IHN0cmlwcGVkWzBdID09PSAnY29udGludWUnKSkge1xuICAgICAgdGhpcy5hcHBseUJyZWFrQ29udGludWUoc3RyaXBwZWQsIGV4ZWMpO1xuICAgIH1cblxuICAgIC8vIEEgY2FsbCB0byBhIHJlZ2lzdGVyZWQgZGVmaW5pdGlvbi5cbiAgICBpZiAoZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZC5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFwcGx5Q2FsbChzdHJpcHBlZFswXSwgaW5QaXBlbGluZSwgYmFja2dyb3VuZGVkKTtcbiAgICB9XG5cbiAgICBpZiAoIW9wdHMuZGlzY2FyZCkge1xuICAgICAgdGhpcy5leHBhbmRlZC5wdXNoKHtcbiAgICAgICAgdGV4dDogbWVtYmVyLnRleHQsXG4gICAgICAgIHByZWNlZGVkQnk6IG1lbWJlci5wcmVjZWRlZEJ5LFxuICAgICAgICBleGVjLFxuICAgICAgICBpblBpcGVsaW5lLFxuICAgICAgICBkaXJGcmFtZTogdGhpcy5kaXJGcmFtZSxcbiAgICAgICAgYXNzaWdubWVudHM6IG5ldyBNYXAodGhpcy5hc3NpZ25tZW50cylcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUJyZWFrQ29udGludWUoc3RyaXBwZWQ6IHN0cmluZ1tdLCBleGVjOiBFeGVjU3RhdHVzKTogdm9pZCB7XG4gICAgY29uc3QgZGVwdGggPSBOdW1iZXIucGFyc2VJbnQoc3RyaXBwZWRbMV0gPz8gJzEnLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkZXB0aCkgfHwgZGVwdGggPCAxKSByZXR1cm47XG4gICAgaWYgKHRoaXMubG9vcFN0YWNrLmxlbmd0aCA9PT0gMCB8fCBkZXB0aCA+IHRoaXMubG9vcFN0YWNrLmxlbmd0aCkgcmV0dXJuO1xuICAgIGlmIChleGVjID09PSAndW5rbm93bicpIHtcbiAgICAgIGZvciAobGV0IGQgPSAwOyBkIDwgZGVwdGg7IGQrKykge1xuICAgICAgICBjb25zdCBmcmFtZSA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDEgLSBkXTtcbiAgICAgICAgaWYgKGZyYW1lLm91dGNvbWUgPT09ICdub25lJykge1xuICAgICAgICAgIGZyYW1lLm91dGNvbWUgPSAnYW1iaWd1b3VzJztcbiAgICAgICAgICBmcmFtZS5hbWJpZ3VvdXNTdG9wID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBpc0NvbnRpbnVlID0gc3RyaXBwZWRbMF0gPT09ICdjb250aW51ZSc7XG4gICAgZm9yIChsZXQgZCA9IDA7IGQgPCBkZXB0aDsgZCsrKSB7XG4gICAgICBjb25zdCBmcmFtZSA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDEgLSBkXTtcbiAgICAgIGZyYW1lLm91dGNvbWUgPSBpc0NvbnRpbnVlID8gJ2NvbnRpbnVlJyA6ICdicmVhayc7XG4gICAgICBmcmFtZS5ib2R5VGVybWluYXRlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgbWF5LXJ1biBjYWxsIHRvIGEgcmVnaXN0ZXJlZCBkZWZpbml0aW9uIGZpcmVzIHBlciBpdHMgYm9keSdzIGRlYWQga2luZC4gKi9cbiAgcHJpdmF0ZSBhcHBseUNhbGwobmFtZTogc3RyaW5nLCBpblBpcGVsaW5lOiBib29sZWFuLCBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZGVmcy5oYXMobmFtZSkgfHwgYmFja2dyb3VuZGVkKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGVmUHJvYmVTdGFjay5oYXMobmFtZSkpIHJldHVybjsgLy8gcmVjdXJzaW9uOiB0aGUgaW5uZXIgY2FsbCByZXR1cm5zIG5vcm1hbGx5XG4gICAgY29uc3QgYm9keSA9IHRoaXMuZGVmcy5nZXQobmFtZSkhO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5hZGQobmFtZSk7XG4gICAgY29uc3Qga2luZCA9IHRoaXMuZGVmQm9keUZpcmVLaW5kKGJvZHkpO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5kZWxldGUobmFtZSk7XG4gICAgaWYgKGtpbmQgPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoa2luZCA9PT0gJ25ldmVyLXJldHVybicpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgIH0gZWxzZSBpZiAoIWluUGlwZWxpbmUpIHtcbiAgICAgIHRoaXMuZGVhZCA9IGtpbmQ7XG4gICAgfVxuICB9XG5cbiAgLyoqIFdoZXRoZXIgYSBkZWZpbml0aW9uIGJvZHksIHdhbGtlZCBhcyBpdHMgb3duIGZ1bmN0aW9uLCBlbmRzIGRlYWQuICovXG4gIHByaXZhdGUgZGVmQm9keUZpcmVLaW5kKGJvZHk6IHN0cmluZyk6IERlYWRLaW5kIHwgbnVsbCB7XG4gICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChib2R5KTtcbiAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gJ21hbGZvcm1lZCc7XG4gICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgIGNvbnN0IHNhdmVkRm5EZXB0aCA9IHRoaXMuZm5EZXB0aDtcbiAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgIHRoaXMuZGVhZCA9IG51bGw7XG4gICAgdGhpcy5yZXR1cm5lZCA9IGZhbHNlO1xuICAgIHRoaXMuZm5EZXB0aCA9IHRoaXMuZm5EZXB0aCArIDE7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBbXTtcbiAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IHRydWUsIHNpZGVFZmZlY3RzOiB0cnVlLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgY29uc3Qga2luZCA9IHRoaXMuZGVhZDtcbiAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgcmV0dXJuIGtpbmQ7XG4gIH1cblxuICBwcml2YXRlIGtub3duU3RhdHVzKGFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCk6IENoYWluU3RhdHVzIHtcbiAgICBpZiAoYXJndiA9PT0gbnVsbCB8fCBhcmd2Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICAvLyBSZWRpcmVjdHMgYW5kIHRyYW5zcGFyZW50IHdyYXBwZXJzIGFyZSBzdHJpcHBlZCBiZWZvcmUgc3RhdHVzIGV2YWx1YXRpb25cbiAgICAvLyAocGxhbiBcdTAwQTc0L1x1MDBBNzUpOiBgZW52IEZPTz0xIHRydWVgIGFuZCBgdGltZW91dCA1IHRydWVgIGFyZSBrbm93biBzdWNjZXNzZXMsXG4gICAgLy8gYHRydWUgPiBvdXRgIGtlZXBzIGl0cyBzdWNjZXNzLCBhbmQgYSBmYWlsLWNsb3NlZCB3cmFwcGVyIChgZW52IC1pIFx1MjAyNmApXG4gICAgLy8gc3RheXMgdW5rbm93bi5cbiAgICBjb25zdCBhID0gd2Fsa1N0cmlwKHN0cmlwV3JhcHBlcnMoc3RyaXBSZWRpcmVjdHMoYXJndikpKTtcbiAgICBpZiAoYS5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICd0cnVlJyB8fCBhWzBdID09PSAnOicpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdmYWxzZScpIHJldHVybiAnZmFpbHVyZSc7XG4gICAgaWYgKGEuZXZlcnkoKHcpID0+IEFTU0lHTk1FTlRfUkUudGVzdCh3KSkpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdleHBvcnQnICYmIGEubGVuZ3RoID4gMSAmJiBhLnNsaWNlKDEpLmV2ZXJ5KCh3KSA9PiBBU1NJR05NRU5UX1JFLnRlc3QodykpKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIGlmIChhWzBdID09PSAnc2V0JykgcmV0dXJuIHNldEZsYWdzS25vd24oYS5zbGljZSgxKSkgPyAnc3VjY2VzcycgOiAndW5rbm93bic7XG4gICAgcmV0dXJuICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlTaWRlRWZmZWN0cyhtZW1iZXI6IFNpbXBsZUNvbW1hbmQsIGFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCwgc3RyaXBwZWQ6IHN0cmluZ1tdIHwgbnVsbCk6IHZvaWQge1xuICAgIGlmIChhcmd2ID09PSBudWxsIHx8IGFyZ3YubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgLy8gQXNzaWdubWVudCByZWNvcmRpbmcgKGxhc3QgZGVmaW5pdGlvbiB3aW5zLCBmZWVkaW5nIGNhc2Ugc3ViamVjdHMpLlxuICAgIGNvbnN0IHdvcmRzID0gc3BsaXRXb3JkcyhtZW1iZXIudGV4dCk7XG4gICAgaWYgKHdvcmRzICE9PSBudWxsICYmIHdvcmRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxldCBrID0gMDtcbiAgICAgIHdoaWxlIChrIDwgd29yZHMubGVuZ3RoICYmIEFTU0lHTk1FTlRfUkUudGVzdCh3b3Jkc1trXSkpIGsrKztcbiAgICAgIGlmIChrID09PSB3b3Jkcy5sZW5ndGgpIHtcbiAgICAgICAgZm9yIChjb25zdCB3IG9mIHdvcmRzKSB7XG4gICAgICAgICAgY29uc3QgZXEgPSB3LmluZGV4T2YoJz0nKTtcbiAgICAgICAgICB0aGlzLmFzc2lnbm1lbnRzLnNldCh3LnNsaWNlKDAsIGVxKSwgdy5zbGljZShlcSArIDEpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh3b3Jkc1swXSA9PT0gJ2V4cG9ydCcpIHtcbiAgICAgICAgZm9yIChjb25zdCB3IG9mIHdvcmRzLnNsaWNlKDEpKSB7XG4gICAgICAgICAgaWYgKEFTU0lHTk1FTlRfUkUudGVzdCh3KSkge1xuICAgICAgICAgICAgY29uc3QgZXEgPSB3LmluZGV4T2YoJz0nKTtcbiAgICAgICAgICAgIHRoaXMuYXNzaWdubWVudHMuc2V0KHcuc2xpY2UoMCwgZXEpLCB3LnNsaWNlKGVxICsgMSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICdzZXQnKSB0aGlzLmFwcGx5U2V0RmxhZ3Moc3RyaXBwZWQuc2xpY2UoMSkpO1xuICAgIC8vIFRhYmxlIGxpZmVjeWNsZSAocGxhbiBcdTAwQTc3KTogYW4gZXhlY3V0ZWQgbm9uLXBpcGUgYHVuc2V0IE5BTUVgIGRlbGV0ZXMgdGhlXG4gICAgLy8gZW50cnksIHNvIGBYPS9hOyB1bnNldCBYOyBjYXQgJFgvZmAgc3RheXMgdW5yZXNvbHZlZCBpbnN0ZWFkIG9mXG4gICAgLy8gcmVzdXJyZWN0aW5nIHRoZSBzdGFsZSB2YWx1ZS4gYGV4cG9ydCBOQU1FYCB3aXRob3V0IGEgdmFsdWUgaXMgYSBuby1vcFxuICAgIC8vIGZvciB0aGUgdGFibGUgKGJhc2gga2VlcHMgdGhlIHZhbHVlLCBqdXN0IG1hcmtzIGl0IGV4cG9ydGVkKS5cbiAgICBpZiAoc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICd1bnNldCcpIHtcbiAgICAgIGZvciAoY29uc3QgdyBvZiBzdHJpcHBlZC5zbGljZSgxKSkge1xuICAgICAgICBpZiAoIXcuc3RhcnRzV2l0aCgnLScpKSB0aGlzLmFzc2lnbm1lbnRzLmRlbGV0ZSh3KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5U2V0RmxhZ3MoYXJnczogc3RyaW5nW10pOiB2b2lkIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgICAgaWYgKGEgPT09ICctLScpIGNvbnRpbnVlO1xuICAgICAgaWYgKCEoYS5zdGFydHNXaXRoKCctJykgfHwgYS5zdGFydHNXaXRoKCcrJykpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG9uID0gYS5zdGFydHNXaXRoKCctJyk7XG4gICAgICBjb25zdCBjaGFycyA9IGEuc2xpY2UoMSk7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNoYXJzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjaGFyc1trXTtcbiAgICAgICAgaWYgKGMgPT09ICdvJykge1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG4gICAgICAgICAgaWYgKG5hbWUgPT09ICdlcnJleGl0JykgdGhpcy5lcnJleGl0ID0gb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ25vZXJyZXhpdCcpIHRoaXMuZXJyZXhpdCA9ICFvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAncGlwZWZhaWwnKSB0aGlzLnBpcGVmYWlsID0gb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ25vcGlwZWZhaWwnKSB0aGlzLnBpcGVmYWlsID0gIW9uO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ2UnKSB0aGlzLmVycmV4aXQgPSBvbjtcbiAgICAgICAgLy8gRXZlcnkgb3RoZXIgcmVjb2duaXplZCBsZXR0ZXIgaXMgYSBuby1vcCBmb3IgdGhlIHdhbGsuXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzQ29uc3RydWN0KFxuICAgIG1lbWJlcjogU2ltcGxlQ29tbWFuZCxcbiAgICBraW5kOiBDb25zdHJ1Y3RLaW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCB7IGV4ZWMsIGJhY2tncm91bmRlZCwgb3B0cyB9ID0gY3R4O1xuICAgIGNvbnN0IGRpc2NhcmQgPSBvcHRzLmRpc2NhcmQgfHwgZXhlYyAhPT0gJ3llcyc7XG4gICAgY29uc3Qgc2lkZUVmZmVjdHMgPSBvcHRzLnNpZGVFZmZlY3RzICYmIGV4ZWMgPT09ICd5ZXMnO1xuXG4gICAgc3dpdGNoIChraW5kKSB7XG4gICAgICBjYXNlICdpZic6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VJZihtZW1iZXIudGV4dCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlZ2lvbnMgPSBbXG4gICAgICAgICAgcGFyc2VkLmNvbmRpdGlvbixcbiAgICAgICAgICBwYXJzZWQudGhlbkJvZHksXG4gICAgICAgICAgLi4ucGFyc2VkLmVsaWZzLmZsYXRNYXAoKGUpID0+IFtlLmNvbmRpdGlvbiwgZS5ib2R5XSksXG4gICAgICAgICAgLi4uKHBhcnNlZC5lbHNlQm9keSAhPT0gbnVsbCA/IFtwYXJzZWQuZWxzZUJvZHldIDogW10pXG4gICAgICAgIF07XG4gICAgICAgIGNvbnN0IGNvbmRTdGF0dXMgPSB0aGlzLndhbGtMaXN0KHNwbGl0VG9wTGV2ZWwocGFyc2VkLmNvbmRpdGlvbikuc3RhZ2VzLCB7XG4gICAgICAgICAgbGl2ZW5lc3M6IGZhbHNlLFxuICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgc2lkZUVmZmVjdHM6IHRydWUsXG4gICAgICAgICAgaW5wdXRGYWNpbmc6IGZhbHNlXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoY29uZFN0YXR1cyA9PT0gJ3Vua25vd24nKSByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAnc3VjY2VzcycpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy53YWxrQnJhbmNoKHBhcnNlZC50aGVuQm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZWxpZiBvZiBwYXJzZWQuZWxpZnMpIHtcbiAgICAgICAgICBjb25zdCBlU3RhdHVzID0gdGhpcy53YWxrTGlzdChzcGxpdFRvcExldmVsKGVsaWYuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICAgIGxpdmVuZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIGlucHV0RmFjaW5nOiBmYWxzZVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChlU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgICBpZiAoZVN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSByZXR1cm4gdGhpcy53YWxrQnJhbmNoKGVsaWYuYm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJzZWQuZWxzZUJvZHkgIT09IG51bGwpIHJldHVybiB0aGlzLndhbGtCcmFuY2gocGFyc2VkLmVsc2VCb2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgICBjYXNlICd3aGlsZSc6XG4gICAgICBjYXNlICd1bnRpbCc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VMb29wKG1lbWJlci50ZXh0LCBraW5kKTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgY29uZFN0YXR1cyA9IHRoaXMud2Fsa0xpc3Qoc3BsaXRUb3BMZXZlbChwYXJzZWQuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICBsaXZlbmVzczogZmFsc2UsXG4gICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICBpbnB1dEZhY2luZzogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgoW3BhcnNlZC5jb25kaXRpb24sIHBhcnNlZC5ib2R5XSwgY3R4KTtcbiAgICAgICAgY29uc3QgYm9keVJ1bnMgPSBraW5kID09PSAnd2hpbGUnID8gY29uZFN0YXR1cyA9PT0gJ3N1Y2Nlc3MnIDogY29uZFN0YXR1cyA9PT0gJ2ZhaWx1cmUnO1xuICAgICAgICBpZiAoIWJvZHlSdW5zKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHBhcnNlZC5ib2R5KTtcbiAgICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZnJhbWU6IExvb3BGcmFtZSA9IHsgb3V0Y29tZTogJ25vbmUnLCBib2R5VGVybWluYXRlZDogZmFsc2UsIGFtYmlndW91c1N0b3A6IGZhbHNlIH07XG4gICAgICAgIHRoaXMubG9vcFN0YWNrLnB1c2goZnJhbWUpO1xuICAgICAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrLnBvcCgpO1xuICAgICAgICBzd2l0Y2ggKGZyYW1lLm91dGNvbWUpIHtcbiAgICAgICAgICBjYXNlICdicmVhayc6XG4gICAgICAgICAgICByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICAgIGNhc2UgJ2NvbnRpbnVlJzpcbiAgICAgICAgICBjYXNlICdub25lJzpcbiAgICAgICAgICAgIGlmICh0aGlzLmRlYWQgPT09IG51bGwgJiYgIWJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICAgIGNhc2UgJ2FtYmlndW91cyc6XG4gICAgICAgICAgY2FzZSAncmV0dXJuJzpcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2Zvcic6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VGb3IobWVtYmVyLnRleHQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBpZiAocGFyc2VkLmxpc3QgPT09IG51bGwgfHwgcGFyc2VkLmxpc3Quc29tZSgodykgPT4gL1skYF0vLnRlc3QodykpKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChbcGFyc2VkLndob2xlSW50ZXJpb3JdLCBjdHgpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJzZWQubGlzdC5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocGFyc2VkLmJvZHkpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgICAgY2FzZSAnY2FzZSc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VDYXNlKG1lbWJlci50ZXh0KTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVnaW9ucyA9IHBhcnNlZC5icmFuY2hlcy5tYXAoKGIpID0+IGIuYm9keSk7XG4gICAgICAgIGlmIChwYXJzZWQuZmFsbHRocm91Z2ggfHwgcmVzb2x2ZVN1YmplY3QocGFyc2VkLnN1YmplY3QsIHRoaXMuYXNzaWdubWVudHMpID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHN1YmplY3QgPSByZXNvbHZlU3ViamVjdChwYXJzZWQuc3ViamVjdCwgdGhpcy5hc3NpZ25tZW50cykhO1xuICAgICAgICBsZXQgbWF0Y2hlZEJyYW5jaCA9IC0xO1xuICAgICAgICBsZXQgdW5kZWNpZGFibGUgPSBmYWxzZTtcbiAgICAgICAgZm9yIChsZXQgYiA9IDA7IGIgPCBwYXJzZWQuYnJhbmNoZXMubGVuZ3RoOyBiKyspIHtcbiAgICAgICAgICBjb25zdCByID0gZXZhbFBhdHRlcm4ocGFyc2VkLmJyYW5jaGVzW2JdLnBhdHRlcm4sIHN1YmplY3QpO1xuICAgICAgICAgIGlmIChyID09PSAnbWF0Y2gnKSB7XG4gICAgICAgICAgICBtYXRjaGVkQnJhbmNoID0gYjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAociA9PT0gJ2dsb2InIHx8IHIgPT09ICd1bmRlY2lkYWJsZScpIHtcbiAgICAgICAgICAgIHVuZGVjaWRhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAodW5kZWNpZGFibGUpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgaWYgKG1hdGNoZWRCcmFuY2ggIT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChwYXJzZWQuYnJhbmNoZXNbbWF0Y2hlZEJyYW5jaF0uYm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgICBjYXNlICdzZWxlY3QnOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlTG9vcChtZW1iZXIudGV4dCwgJ3doaWxlJyk7XG4gICAgICAgIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocGFyc2VkICE9PSBudWxsID8gW3BhcnNlZC5ib2R5XSA6IFtdLCBjdHgpO1xuICAgICAgfVxuICAgICAgY2FzZSAnYnJhY2UnOiB7XG4gICAgICAgIGNvbnN0IGludGVyaW9yID0gZXh0cmFjdEdyb3VwQm9keShtZW1iZXIudGV4dCwgJ3snLCAnfScpO1xuICAgICAgICBpZiAoaW50ZXJpb3IgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoaW50ZXJpb3IpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgICAgY2FzZSAnc3Vic2hlbGwnOiB7XG4gICAgICAgIGNvbnN0IGludGVyaW9yID0gZXh0cmFjdEdyb3VwQm9keShtZW1iZXIudGV4dCwgJygnLCAnKScpO1xuICAgICAgICBpZiAoaW50ZXJpb3IgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoaW50ZXJpb3IpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzYXZlZEVycmV4aXQgPSB0aGlzLmVycmV4aXQ7XG4gICAgICAgIGNvbnN0IHNhdmVkUGlwZWZhaWwgPSB0aGlzLnBpcGVmYWlsO1xuICAgICAgICBjb25zdCBzYXZlZEFzc2lnbm1lbnRzID0gdGhpcy5hc3NpZ25tZW50cztcbiAgICAgICAgY29uc3Qgc2F2ZWREZWZzID0gdGhpcy5kZWZzO1xuICAgICAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICAgICAgY29uc3Qgc2F2ZWRGbkRlcHRoID0gdGhpcy5mbkRlcHRoO1xuICAgICAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgICAgICBjb25zdCBzYXZlZERpckZyYW1lID0gdGhpcy5kaXJGcmFtZTtcbiAgICAgICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgICAgICB0aGlzLmVycmV4aXQgPSBzYXZlZEVycmV4aXQ7XG4gICAgICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgICAgICB0aGlzLmFzc2lnbm1lbnRzID0gbmV3IE1hcChzYXZlZEFzc2lnbm1lbnRzKTtcbiAgICAgICAgdGhpcy5kZWZzID0gbmV3IE1hcChzYXZlZERlZnMpO1xuICAgICAgICB0aGlzLnJldHVybmVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZm5EZXB0aCA9IDA7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrID0gW107XG4gICAgICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lICsgMTtcbiAgICAgICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgICBjb25zdCBpbm5lckRlYWQgPSB0aGlzLmRlYWQ7XG4gICAgICAgIHRoaXMuZXJyZXhpdCA9IHNhdmVkRXJyZXhpdDtcbiAgICAgICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgICAgIHRoaXMuYXNzaWdubWVudHMgPSBzYXZlZEFzc2lnbm1lbnRzO1xuICAgICAgICB0aGlzLmRlZnMgPSBzYXZlZERlZnM7XG4gICAgICAgIHRoaXMucmV0dXJuZWQgPSBzYXZlZFJldHVybmVkO1xuICAgICAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lO1xuICAgICAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgICAgIC8vIEEgc3Vic2hlbGwgaXMgYSBwcm9jZXNzIGJvdW5kYXJ5IGZvciB0aGUgZXhpdCBmaXJlIGJ1dCBub3QgZm9yIHRoZVxuICAgICAgICAvLyBuZXZlci1yZXR1cm4gZmlyZTogdGhlIHNoZWxsIHN5bmNocm9ub3VzbHkgd2FpdHMgZm9yIHRoZSBzdWJzaGVsbC5cbiAgICAgICAgaWYgKGlubmVyRGVhZCA9PT0gJ25ldmVyLXJldHVybicpIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgICAgICByZXR1cm4gc3RhdHVzO1xuICAgICAgfVxuICAgICAgY2FzZSAnZGVmJzoge1xuICAgICAgICAvLyBUaGUgZGVmaW5pdGlvbiByZWdpc3RlcnMgd2l0aCB0aGUgd2FsayBzY29wZSB3aGVuIGV4ZWN1dGVkLlxuICAgICAgICBpZiAoc2lkZUVmZmVjdHMpIHtcbiAgICAgICAgICBjb25zdCBkZWYgPSBwYXJzZURlZihtZW1iZXIudGV4dCk7XG4gICAgICAgICAgaWYgKGRlZiAhPT0gbnVsbCkgdGhpcy5kZWZzLnNldChkZWYubmFtZSwgZGVmLmJvZHkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHdhbGtCcmFuY2goYm9keTogc3RyaW5nLCBkaXNjYXJkOiBib29sZWFuLCBzaWRlRWZmZWN0czogYm9vbGVhbik6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGJvZHkpO1xuICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgb3BhcXVlLWNvbnN0cnVjdCB0cmVhdG1lbnQgKHBsYW4gXHUwMEE3Mik6IHJlLXNwbGl0IGVhY2ggcmVnaW9uIGFuZCB3YWxrIGl0XG4gICAqIHdpdGggdGhlIHNhbWUgbWFjaGluZXJ5IHNvIGFuIGBleGl0YC9gZXhlY2AgdGhhdCBtYXkgaGF2ZSBydW4sIG9yIGFcbiAgICogbmV2ZXItZXhpdCBsb29wLCBmaXJlcyBmYWlsLWNsb3NlZDsgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIHdvcmRzIHJlYWNoIHRoZVxuICAgKiBzY2FubmVkIGxvb3AgYXMgYW4gYW1iaWd1b3VzIHRlcm1pbmF0aW9uLiBTdGF0ZSBpcyBzbmFwc2hvdC1yZXN0b3JlZC5cbiAgICovXG4gIHByaXZhdGUgb3BhcXVlUGF0aChcbiAgICByZWdpb25zOiBzdHJpbmdbXSxcbiAgICBjdHg6IHsgZXhlYzogRXhlY1N0YXR1czsgaW5QaXBlbGluZTogYm9vbGVhbjsgYmFja2dyb3VuZGVkOiBib29sZWFuOyBvcHRzOiBXYWxrT3B0aW9ucyB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBmaW5kaW5ncyA9IHRoaXMuc2Nhbk9wYXF1ZShyZWdpb25zKTtcbiAgICBpZiAoZmluZGluZ3MuZmlyZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGZpbmRpbmdzLmZpcmUgPT09ICduZXZlci1yZXR1cm4nKSB7XG4gICAgICAgIGlmICghY3R4LmJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICB9IGVsc2UgaWYgKCFjdHguaW5QaXBlbGluZSAmJiAhY3R4LmJhY2tncm91bmRlZCkge1xuICAgICAgICB0aGlzLmRlYWQgPSBmaW5kaW5ncy5maXJlO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZmluZGluZ3MuYnJlYWtUYXJnZXQgIT09ICdub25lJykge1xuICAgICAgY29uc3QgdG9wID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICBpZiAodG9wICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdG9wLm91dGNvbWUgPSAnYW1iaWd1b3VzJztcbiAgICAgICAgdG9wLmFtYmlndW91c1N0b3AgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2FuT3BhcXVlKHJlZ2lvbnM6IHN0cmluZ1tdKTogeyBmaXJlOiBEZWFkS2luZCB8IG51bGw7IGJyZWFrVGFyZ2V0OiAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdub25lJyB9IHtcbiAgICBjb25zdCByZXBvcnQ6IHsgZmlyZTogRGVhZEtpbmQgfCBudWxsOyBicmVha1RhcmdldDogJ2JyZWFrJyB8ICdjb250aW51ZScgfCAnbm9uZScgfSA9IHtcbiAgICAgIGZpcmU6IG51bGwsXG4gICAgICBicmVha1RhcmdldDogJ25vbmUnXG4gICAgfTtcbiAgICBjb25zdCBzYXZlZENoYWluID0gdGhpcy5jaGFpbjtcbiAgICBjb25zdCBzYXZlZEVycmV4aXQgPSB0aGlzLmVycmV4aXQ7XG4gICAgY29uc3Qgc2F2ZWRQaXBlZmFpbCA9IHRoaXMucGlwZWZhaWw7XG4gICAgY29uc3Qgc2F2ZWRBc3NpZ25tZW50cyA9IHRoaXMuYXNzaWdubWVudHM7XG4gICAgY29uc3Qgc2F2ZWREZWZzID0gdGhpcy5kZWZzO1xuICAgIGNvbnN0IHNhdmVkRGVhZCA9IHRoaXMuZGVhZDtcbiAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICBjb25zdCBzYXZlZEZuRGVwdGggPSB0aGlzLmZuRGVwdGg7XG4gICAgY29uc3Qgc2F2ZWRMb29wU3RhY2sgPSB0aGlzLmxvb3BTdGFjaztcbiAgICBjb25zdCBzYXZlZERpckZyYW1lID0gdGhpcy5kaXJGcmFtZTtcbiAgICBjb25zdCBzYXZlZFZlcmRpY3RzID0gdGhpcy52ZXJkaWN0cy5sZW5ndGg7XG4gICAgY29uc3Qgc2F2ZWRFeHBhbmRlZCA9IHRoaXMuZXhwYW5kZWQubGVuZ3RoO1xuICAgIGNvbnN0IHNhdmVkRGVmUHJvYmUgPSBuZXcgU2V0KHRoaXMuZGVmUHJvYmVTdGFjayk7XG5cbiAgICBmb3IgKGNvbnN0IHJlZ2lvbiBvZiByZWdpb25zKSB7XG4gICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHJlZ2lvbik7XG4gICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlcG9ydC5maXJlID0gJ21hbGZvcm1lZCc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICAgIHRoaXMucmV0dXJuZWQgPSBmYWxzZTtcbiAgICAgIC8vIEVhY2ggcmVnaW9uIHdhbGtzIGFnYWluc3QgYSBmcmVzaCBjb3B5IG9mIHRoZSBlbmNsb3NpbmcgbG9vcCBmcmFtZXMgc29cbiAgICAgIC8vIGl0cyBoaWRkZW4gYnJlYWsvY29udGludWUgZXZlbnRzIGFyZSByZXBvcnRlZCwgbmV2ZXIgYXBwbGllZC5cbiAgICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2subWFwKChmKSA9PiAoeyAuLi5mIH0pKTtcbiAgICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogdHJ1ZSwgc2lkZUVmZmVjdHM6IGZhbHNlLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICBpZiAodGhpcy5kZWFkICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChyZXBvcnQuZmlyZSA9PT0gbnVsbCB8fCB0aGlzLmRlYWQgPT09ICduZXZlci1yZXR1cm4nIHx8IHRoaXMuZGVhZCA9PT0gJ21hbGZvcm1lZCcpIHJlcG9ydC5maXJlID0gdGhpcy5kZWFkO1xuICAgICAgfVxuICAgICAgaWYgKHJlcG9ydC5icmVha1RhcmdldCA9PT0gJ25vbmUnKSB7XG4gICAgICAgIGNvbnN0IGlubmVybW9zdCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoaW5uZXJtb3N0ICE9PSB1bmRlZmluZWQgJiYgKGlubmVybW9zdC5vdXRjb21lID09PSAnYnJlYWsnIHx8IGlubmVybW9zdC5vdXRjb21lID09PSAnY29udGludWUnKSkge1xuICAgICAgICAgIHJlcG9ydC5icmVha1RhcmdldCA9IGlubmVybW9zdC5vdXRjb21lO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFpbiA9IHNhdmVkQ2hhaW47XG4gICAgdGhpcy5lcnJleGl0ID0gc2F2ZWRFcnJleGl0O1xuICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgIHRoaXMuYXNzaWdubWVudHMgPSBzYXZlZEFzc2lnbm1lbnRzO1xuICAgIHRoaXMuZGVmcyA9IHNhdmVkRGVmcztcbiAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWU7XG4gICAgdGhpcy52ZXJkaWN0cy5sZW5ndGggPSBzYXZlZFZlcmRpY3RzO1xuICAgIHRoaXMuZXhwYW5kZWQubGVuZ3RoID0gc2F2ZWRFeHBhbmRlZDtcbiAgICB0aGlzLmRlZlByb2JlU3RhY2suY2xlYXIoKTtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2Ygc2F2ZWREZWZQcm9iZSkgdGhpcy5kZWZQcm9iZVN0YWNrLmFkZChuYW1lKTtcbiAgICByZXR1cm4gcmVwb3J0O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKipcbiAqIFBhcnNlIGBoZWFkYC9gdGFpbGAgZmxhZ3MgYW5kIGZpbGUgYXJncy4gQSBiYXJlIGArTmAgaXMgYSBmcm9tLU4gY291bnQgb25seVxuICogZm9yIGB0YWlsYCAoYHRhaWwgKzUgZmAgc3RhcnRzIGF0IGxpbmUgNSk7IEdOVSBgaGVhZGAgdHJlYXRzIGJhcmUgYCtOYCBhcyBhXG4gKiAqZmlsZSogKGNvcmV1dGlscyA5LjcgXHUyMDE0IHByb2JlOiBgaGVhZCArNSBmYCBlcnJvcnMgXCJjYW5ub3Qgb3BlbiAnKzUnXCIgYW5kXG4gKiByZWFkcyBmJ3MgZmlyc3QgMTAgbGluZXMpLCBzbyBgYmFyZVBsdXNJc0NvdW50YCBpcyBmYWxzZSBmb3IgaGVhZCBhbmQgdGhlXG4gKiB3b3JkIGZhbGxzIHRocm91Z2ggdG8gdGhlIGZpbGUgbGlzdC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VIZWFkVGFpbEZsYWdzKFxuICByZXN0OiBzdHJpbmdbXSxcbiAgYmFyZVBsdXNJc0NvdW50OiBib29sZWFuXG4pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGlmIChiYXJlUGx1c0lzQ291bnQpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCBmYWxzZSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgLy8gQmFyZSBgK05gIGlzIGEgR05VLWhlYWQgZmlsZSBhcnRpZmFjdCwgbmV2ZXIgYSByZWFsIHJlYWQgXHUyMDE0IGRyb3AgaXQuXG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nICYmICEvXlxcK1xcZCskLy50ZXN0KGYpKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ2hlYWQtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JywgZW5kOiBuIH0gYXMgTGluZVJhbmdlU3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFRhaWwoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICd0YWlsJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCB0cnVlKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IGZyb21TdGFydCA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IG4gfSA6IHsga2luZDogJ2xhc3ROTGluZXMnLCBjb3VudDogbiB9O1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ3RhaWwtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRHaXRTdWJjb21tYW5kKFxuICByZXN0OiBzdHJpbmdbXVxuKTogeyBzdWJJZHg6IG51bWJlcjsgc3ViY29tbWFuZDogc3RyaW5nOyBjRGlyOiBzdHJpbmcgfCBudWxsOyBjRGlyVW5yZXNvbHZhYmxlOiBib29sZWFuIH0gfCBudWxsIHtcbiAgbGV0IGNEaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgY0RpclVucmVzb2x2YWJsZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgcmVzdC5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1DJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoaGFzU2hlbGxFeHBhbnNpb24odikpIGNEaXJVbnJlc29sdmFibGUgPSB0cnVlO1xuICAgICAgZWxzZSBjRGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IHN1YklkeDogaSwgc3ViY29tbWFuZDogYSwgY0RpciwgY0RpclVucmVzb2x2YWJsZSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5jb25zdCBSRVZfUEFUSCA9IC9eKFteXFxzOl0rKTooLispJC87XG5cbmZ1bmN0aW9uIG1hdGNoR2l0U2hvdyhhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnc2hvdycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2XG4gICAgLnNsaWNlKDEpXG4gICAgLnNsaWNlKHN1Yi5zdWJJZHggKyAxKVxuICAgIC5maWx0ZXIoKGEpID0+ICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGNvbnN0IHJldlBhdGhBcmcgPSBhZnRlci5maW5kKChhKSA9PiBSRVZfUEFUSC50ZXN0KGEpKTtcbiAgaWYgKCFyZXZQYXRoQXJnKSByZXR1cm4gW107XG4gIGNvbnN0IG0gPSByZXZQYXRoQXJnLm1hdGNoKFJFVl9QQVRIKTtcbiAgaWYgKCFtKSByZXR1cm4gW107XG4gIGNvbnN0IFssIHJldiwgcGF0aF0gPSBtO1xuICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUgfHwgaGFzU2hlbGxFeHBhbnNpb24ocmV2KSkge1xuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgb3IgcmV2aXNpb24gY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXG4gICAge1xuICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICByZXNvbHZlcktpbmQ6IHsga2luZDogJ2dpdCcsIHJldiB9LFxuICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgIH1cbiAgXTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hHaXRMb2dMKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdsb2cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndi5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYWZ0ZXIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYWZ0ZXJbaV07XG4gICAgbGV0IHNwZWM6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhID09PSAnLUwnKSBzcGVjID0gYWZ0ZXJbaSArIDFdID8/IG51bGw7XG4gICAgZWxzZSBpZiAoYS5zdGFydHNXaXRoKCctTCcpKSBzcGVjID0gYS5zbGljZSgyKTtcbiAgICBpZiAoIXNwZWMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG0gPSBzcGVjLm1hdGNoKC9eKFxcZCspLChcXGQrKTooLispJC8pO1xuICAgIGlmICghbSkgY29udGludWU7XG4gICAgY29uc3QgWywgcywgZSwgcGF0aF0gPSBtO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICAgIH1cbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogTnVtYmVyLnBhcnNlSW50KHMsIDEwKSwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZSwgMTApIH0sXG4gICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJyxcbiAgICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlcmVkb2Mgd3JpdGVzIChgY2F0ID4gZmlsZSA8PEVPRiAuLi4gRU9GYCk6IGhhbmRsZWQgYXMgYSBkZWRpY2F0ZWQgcmF3LXRleHRcbi8vIHBhc3MgYmVjYXVzZSB0aGUgYm9keSBjYW4gaXRzZWxmIGNvbnRhaW4gJiYvOy98L25ld2xpbmVzIHRoYXQgd291bGRcbi8vIG90aGVyd2lzZSBjb25mdXNlIHNwbGl0VG9wTGV2ZWwuIE1hdGNoZWQgc3BhbnMgYXJlIG1hc2tlZCBvdXQgb2YgdGhlIHN0cmluZ1xuLy8gKHJlcGxhY2VkIHdpdGggYW4gaW5kZXhlZCBwbGFjZWhvbGRlciBzaW1wbGUtY29tbWFuZCkgYmVmb3JlIHRoZSByZXN0IG9mXG4vLyB0aGUgcGlwZWxpbmUgcnVucywgYW5kIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSBtYWluIHdhbGsgc28gdGhlXG4vLyB3cml0ZSBpcyByZXNvbHZlZCBhZ2FpbnN0IHRoZSBjb3JyZWN0IGBjZGAtdHJhY2tlZCBkaXJlY3RvcnkuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIEhlcmVkb2NXcml0ZSB7XG4gIHJlZGlyZWN0OiAnPicgfCAnPj4nO1xuICB0YXJnZXQ6IHN0cmluZztcbiAgYm9keTogc3RyaW5nO1xufVxuXG5jb25zdCBIRVJFRE9DX09QRU4gPVxuICAvXFxiY2F0WyBcXHRdKyg+ezEsMn0pWyBcXHRdKihcXFMrKVsgXFx0XSo8PCgtPylbIFxcdF0qKD86JyhbXiddKiknfFwiKFteXCJdKilcInwoW0EtWmEtel9dW0EtWmEtejAtOV9dKikpL2c7XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IDA7XG4gIGxldCBvcGVuTWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGwgPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB3aGlsZSAob3Blbk1hdGNoICE9PSBudWxsKSB7XG4gICAgY29uc3QgWywgcmVkaXJlY3QsIHRhcmdldCwgZGFzaCwgZHExLCBkcTIsIGJhcmVdID0gb3Blbk1hdGNoO1xuICAgIGNvbnN0IGRlbGltID0gZHExID8/IGRxMiA/PyBiYXJlO1xuICAgIGNvbnN0IG9wZW5FbmQgPSBvcGVuTWF0Y2guaW5kZXggKyBvcGVuTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIGlmICghZGVsaW0gfHwgb3Blbk1hdGNoLmluZGV4IDwgY3Vyc29yKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gb3Blbk1hdGNoLmluZGV4ICsgMTtcbiAgICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVGhlIGJvZHkgcmVnaW9uIHN0YXJ0cyByaWdodCBhZnRlciB0aGUgZGVsaW1pdGVyIGxpbmUncyBuZXdsaW5lLiBBblxuICAgIC8vIGFic2VudCBuZXdsaW5lIChpbnB1dCBlbmRzIGF0IHRoZSBkZWxpbWl0ZXIsIG9yIGAmJmAvYDtgIGNvbnRpbnVlcyB0aGVcbiAgICAvLyBsaW5lKSBpcyBhIHNhbWUtbGluZSB1bnRlcm1pbmF0ZWQgaGVyZWRvYyB3aXRoIGFuIGVtcHR5IGJvZHkgXHUyMDE0IHRoZSBgPmBcbiAgICAvLyByZWRpcmVjdCBzdGlsbCB0cnVuY2F0ZXMgdGhlIGZpbGUsIGFuZCB0aGUgY29udGludWF0aW9uIHN0YXlzIGNvbW1hbmRzLlxuICAgIGNvbnN0IG5sID0gcmF3LnNsaWNlKG9wZW5FbmQpLm1hdGNoKC9eWyBcXHRdKlxccj9cXG4vKTtcbiAgICBjb25zdCBib2R5U3RhcnQgPSBubCAhPT0gbnVsbCA/IG9wZW5FbmQgKyBubFswXS5sZW5ndGggOiBvcGVuRW5kO1xuICAgIGNvbnN0IHJlbWFpbmRlciA9IHJhdy5zbGljZShib2R5U3RhcnQpO1xuICAgIGNvbnN0IGNsb3NlUmUgPSBuZXcgUmVnRXhwKGBeJHtkYXNoID8gJ1xcXFx0KicgOiAnJ30ke2VzY2FwZVJlZ0V4cChkZWxpbSl9WyBcXFxcdF0qJGAsICdtJyk7XG4gICAgY29uc3QgY2xvc2VNYXRjaCA9IGNsb3NlUmUuZXhlYyhyZW1haW5kZXIpO1xuICAgIGxldCBib2R5OiBzdHJpbmc7XG4gICAgbGV0IG1hdGNoRW5kOiBudW1iZXI7XG4gICAgaWYgKGNsb3NlTWF0Y2gpIHtcbiAgICAgIGJvZHkgPSByZW1haW5kZXIuc2xpY2UoMCwgY2xvc2VNYXRjaC5pbmRleCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICAgIG1hdGNoRW5kID0gYm9keVN0YXJ0ICsgY2xvc2VNYXRjaC5pbmRleCArIGNsb3NlTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIH0gZWxzZSBpZiAobmwgPT09IG51bGwpIHtcbiAgICAgIGJvZHkgPSAnJztcbiAgICAgIG1hdGNoRW5kID0gb3BlbkVuZDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVW50ZXJtaW5hdGVkIHdpdGggYSBib2R5IHJlZ2lvbjogdGhlIGRhdGEgcmVnaW9uIHJ1bnMgdG8gRU9GLlxuICAgICAgYm9keSA9IHJlbWFpbmRlci5yZXBsYWNlKC9cXG4kLywgJycpO1xuICAgICAgbWF0Y2hFbmQgPSByYXcubGVuZ3RoO1xuICAgIH1cblxuICAgIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yLCBvcGVuTWF0Y2guaW5kZXgpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgY3Vyc29yID0gbWF0Y2hFbmQ7XG4gICAgd3JpdGVzLnB1c2goeyByZWRpcmVjdDogcmVkaXJlY3QgYXMgJz4nIHwgJz4+JywgdGFyZ2V0LCBib2R5IH0pO1xuXG4gICAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IG1hdGNoRW5kO1xuICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFdpbmRvdyBhbGdlYnJhIChwbGFuIFx1MDBBNzMpOiBzb3VyY2UgYW5hbHlzaXMgYW5kIHN0ZGluLXNlbGVjdG9yIGNsYXNzaWZpY2F0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGBubGAncyBhcmctdGFraW5nIGZsYWdzIFx1MjAxNCBlYWNoIGNvbnN1bWVzIHRoZSBmb2xsb3dpbmcgd29yZCAocGxhbiBcdTAwQTczKS4gKi9cbmNvbnN0IE5MX0FSR19GTEFHUyA9IG5ldyBTZXQoWyctYicsICctaScsICctbCcsICctcycsICctdicsICctdyddKTtcblxuLyoqIFN0ZG91dC1mb3JtIHJlZGlyZWN0IG9wZXJhdG9ycyBvbiB0aGUgcHJlLXN0cmlwIGFyZ3YgKHBsYW4gXHUwMEE3MyBzZXZlcmFuY2UpOiBgPmAsIGA+PmAsIGAmPmAsIGAmPj5gLCBgMT5gLCBgMT4+YCwgYD58YC4gKi9cbmNvbnN0IFNURE9VVF9SRURJUkVDVF9UV09fVE9LRU4gPSAvXig/Oj4+P3wmPj4/fDE+Pj98PlxcfCkkLztcbmNvbnN0IFNURE9VVF9SRURJUkVDVF9GVVNFRCA9IC9eKD86Pj4/fCY+Pj98MT4+PylbXjw+JnxdLztcbmNvbnN0IFNURE9VVF9SRURJUkVDVF9GVVNFRF9QSVBFID0gL14+XFx8W148PiZ8XS87XG5cbi8qKiBXaGV0aGVyIGEgcHJlLXN0cmlwIGFyZ3YgY2FycmllcyBhIHN0ZG91dC1mb3JtIHJlZGlyZWN0IChzdGRlcnIgYDI+YCBhbmQgZHVwIGAyPiYxYCBuZXZlciBzZXZlcikuICovXG5jb25zdCBoYXNTdGRvdXRSZWRpcmVjdCA9IChyYXc6IHN0cmluZ1tdKTogYm9vbGVhbiA9PlxuICByYXcuc29tZShcbiAgICAodykgPT4gU1RET1VUX1JFRElSRUNUX1RXT19UT0tFTi50ZXN0KHcpIHx8IFNURE9VVF9SRURJUkVDVF9GVVNFRC50ZXN0KHcpIHx8IFNURE9VVF9SRURJUkVDVF9GVVNFRF9QSVBFLnRlc3QodylcbiAgKTtcblxudHlwZSBTb3VyY2VBbmFseXNpcyA9XG4gIHwgeyBraW5kOiAnbm9uZScgfVxuICB8IHsga2luZDogJ3VubmFycm93YWJsZSc7IGZpbGVzOiB7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZScgfVtdIH1cbiAgfCB7IGtpbmQ6ICduYXJyb3dhYmxlJzsgZmlsZUFyZzogc3RyaW5nOyBpZGlvbTogJ2NhdC1maWxlJyB8ICdubC1maWxlJzsgcmVzb2x2ZXJLaW5kOiAnZnMnOyBkaXJPdmVycmlkZT86IHN0cmluZyB9XG4gIHwge1xuICAgICAga2luZDogJ2dpdCc7XG4gICAgICBmaWxlQXJnOiBzdHJpbmc7XG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJztcbiAgICAgIHJldjogc3RyaW5nO1xuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICAgICAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG4gICAgfVxuICB8IHsga2luZDogJ2dpdFVucmVzb2x2ZWQnOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKiBBIHNvdXJjZSB0aGF0IG9wZW5zIGEgbmFycm93YWJsZSB3aW5kb3c6IGEgc2luZ2xlLWZpbGUgYGNhdGAvYG5sYCBvciBhIGBnaXQgc2hvdyByZXY6cGF0aGAuICovXG50eXBlIE5hcnJvd2FibGVTb3VyY2UgPSBFeHRyYWN0PFNvdXJjZUFuYWx5c2lzLCB7IGtpbmQ6ICduYXJyb3dhYmxlJyB8ICdnaXQnIH0+O1xuXG4vKipcbiAqIFRoZSBwaXBlbGluZS1zb3VyY2UgYW5hbHlzaXMgKHBsYW4gXHUwMEE3Myk6IGEgYGNhdGAvYG5sYCB3aG9zZSBmaWxlIGFyZ3MgXHUyMDE0XG4gKiBldmVyeSBub24tZmxhZyB3b3JkLCB3aGVyZSBhIGAtYC1wcmVmaXhlZCB3b3JkIGlzIGEgZmxhZyBhbmQgYSBiYXJlIGAtYCBpc1xuICogYSBzdGRpbiBtYXJrZXIgXHUyMDE0IGFyZSBhbGwgZmlsZXMtb3ItYC1gIHdpdGggYXQgbGVhc3Qgb25lIGZpbGUsIG9yIGFcbiAqIGBnaXQgc2hvdyByZXY6cGF0aGAuIEEgc2luZ2xlLWZpbGUgc291cmNlIGlzIG5hcnJvd2FibGU7IGEgbXVsdGktZmlsZSBvclxuICogc3RkaW4tbWl4ZWQgc291cmNlIGlzIHVuLW5hcnJvd2FibGUgKGVhY2ggZmlsZSBlbWl0cyBpdHMgb3duIGNvbnNlcnZhdGl2ZVxuICogd2hvbGUtZmlsZSByZWFkLCBhbmQgc3RkaW4gc2VsZWN0b3JzIG5ldmVyIG5hcnJvdyBpdCkuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVTb3VyY2UoYXJndjogc3RyaW5nW10pOiBTb3VyY2VBbmFseXNpcyB7XG4gIGlmIChhcmd2WzBdID09PSAnY2F0JyB8fCBhcmd2WzBdID09PSAnbmwnKSB7XG4gICAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnKSB7XG4gICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIGNvbnRpbnVlOyAvLyBhIGZsYWcgXHUyMDE0IGNhdCBmbGFncyBuZXZlciB0YWtlIGFyZ3VtZW50c1xuICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgICAgIGlmIChOTF9BUkdfRkxBR1MuaGFzKGEpKSBpICs9IDE7IC8vIGFyZy10YWtpbmcgZmxhZyBjb25zdW1lcyB0aGUgbmV4dCB3b3JkXG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcmVhbCA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgICBpZiAocmVhbC5sZW5ndGggPT09IDApIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xuICAgIGNvbnN0IGlkaW9tID0gYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnO1xuICAgIGlmIChyZWFsLmxlbmd0aCA9PT0gMSAmJiAhZmlsZXMuaW5jbHVkZXMoJy0nKSkge1xuICAgICAgcmV0dXJuIHsga2luZDogJ25hcnJvd2FibGUnLCBmaWxlQXJnOiByZWFsWzBdLCBpZGlvbSwgcmVzb2x2ZXJLaW5kOiAnZnMnIH07XG4gICAgfVxuICAgIHJldHVybiB7IGtpbmQ6ICd1bm5hcnJvd2FibGUnLCBmaWxlczogcmVhbC5tYXAoKGZpbGVBcmcpID0+ICh7IGZpbGVBcmcsIGlkaW9tIH0pKSB9O1xuICB9XG4gIGlmIChhcmd2WzBdID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IG91dGNvbWVzID0gbWF0Y2hHaXRTaG93KGFyZ3YpO1xuICAgIGlmIChvdXRjb21lcy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IG8gPSBvdXRjb21lc1swXTtcbiAgICAgIGlmIChvLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICByZXR1cm4geyBraW5kOiAnZ2l0VW5yZXNvbHZlZCcsIGZpbGVBcmc6IG8uZmlsZUFyZywgcmVhc29uOiBvLnJlYXNvbiB9O1xuICAgICAgfVxuICAgICAgaWYgKG8ua2luZCA9PT0gJ2NhbmRpZGF0ZScgJiYgby5yZXNvbHZlcktpbmQgIT09ICdmcycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBraW5kOiAnZ2l0JyxcbiAgICAgICAgICBmaWxlQXJnOiBvLmZpbGVBcmcsXG4gICAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgICAgcmV2OiBvLnJlc29sdmVyS2luZC5yZXYsXG4gICAgICAgICAgcmVzb2x2ZXJLaW5kOiBvLnJlc29sdmVyS2luZCxcbiAgICAgICAgICBkaXJPdmVycmlkZTogby5kaXJPdmVycmlkZVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxudHlwZSBTdGRpblNlbGVjdG9yID1cbiAgfCB7IGtpbmQ6ICdoZWFkJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndGFpbCc7IGNvdW50OiBudW1iZXI7IGZyb21TdGFydDogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiAnc2VkJzsgcmFuZ2VzOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIHwgJyQnIH1bXSB9O1xuXG4vKipcbiAqIFdoZXRoZXIgYSB3cmFwcGVyLXN0cmlwcGVkIHN0YWdlIGlzIGEgc3RkaW4gbGluZS1zZWxlY3RvciAocGxhbiBcdTAwQTczKTogYVxuICogYHNlZCAtbmAgcmFuZ2Ugc2NyaXB0LCBgaGVhZGAsIG9yIGB0YWlsYCB3aXRoIG5vIGZpbGUgYXJncyAoYSBiYXJlIGAtYCBpcyBhXG4gKiBzdGRpbiBtYXJrZXIsIG5vdCBhIGZpbGUpLiBBIHJlY29nbml6ZWQgc2VsZWN0b3IgY2FycnlpbmcgaXRzIG93biBmaWxlIGFyZ3NcbiAqIGlzIGEgbm9uLWNvbnN1bWVyIFx1MjAxNCBpdCBuZXZlciByZWFkcyB0aGUgcGlwZSBcdTIwMTQgYW5kIHJldHVybnMgbnVsbC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlTdGRpblNlbGVjdG9yKGFyZ3Y6IHN0cmluZ1tdKTogU3RkaW5TZWxlY3RvciB8IG51bGwge1xuICBpZiAoYXJndlswXSA9PT0gJ2hlYWQnIHx8IGFyZ3ZbMF0gPT09ICd0YWlsJykge1xuICAgIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIGFyZ3ZbMF0gPT09ICd0YWlsJyk7XG4gICAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIG51bGw7IC8vIGJ5dGUvemVyby10ZXJtaW5hdGVkIHJlYWRzIGFyZSBub3QgbGluZSBzZWxlY3RvcnNcbiAgICBjb25zdCBmaWxlQXJncyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgICBpZiAoZmlsZUFyZ3MubGVuZ3RoID4gMCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIGFyZ3ZbMF0gPT09ICdoZWFkJyA/IHsga2luZDogJ2hlYWQnLCBjb3VudDogY291bnQgPz8gMTAgfSA6IHsga2luZDogJ3RhaWwnLCBjb3VudDogY291bnQgPz8gMTAsIGZyb21TdGFydCB9O1xuICB9XG4gIGlmIChhcmd2WzBdID09PSAnc2VkJykge1xuICAgIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICAgIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIG51bGw7XG4gICAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHJlc3RbaV0gPT09ICctbicpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzY3JpcHRJZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICAgIGlmIChmaWxlQ2FuZGlkYXRlcy5sZW5ndGggIT09IDApIHJldHVybiBudWxsOyAvLyBub24tY29uc3VtZXIgXHUyMDE0IHJlYWRzIGl0cyBmaWxlLCBuZXZlciB0aGUgcGlwZVxuICAgIGNvbnN0IHJhbmdlczogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB8ICckJyB9W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgICAgY29uc3QgbSA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICAgIGlmICghbSkgY29udGludWU7XG4gICAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgICByYW5nZXMucHVzaCh7IHN0YXJ0LCBlbmQ6IG1bMl0gPT09IHVuZGVmaW5lZCA/IHN0YXJ0IDogbVsyXSA9PT0gJyQnID8gJyQnIDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKSB9KTtcbiAgICB9XG4gICAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IGtpbmQ6ICdzZWQnLCByYW5nZXMgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBvcHRzOiBQYXJzZU9wdGlvbnMgPSB7fSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgLy8gUGxhbiBcdTAwQTc3OiB0aGUgcGFyc2VyIGRlZmF1bHRzIGBlbnZgIHRvIHRoZSBob29rIHByb2Nlc3MgZW52LCBnYXRlZCBieSB0aGVcbiAgLy8gYWxsb3dsaXN0IFx1MjAxNCBvbmx5IGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYCBuYW1lcyBtYXkgcmVzb2x2ZSBmcm9tIGl0LiBBblxuICAvLyBleHBsaWNpdGx5IGluamVjdGVkIGVudiAodGVzdHMsIGFkYXB0ZXJzKSBpcyBjb25zdWx0ZWQgd2hvbGVzYWxlLlxuICBjb25zdCBhbGxvd2xpc3QgPSBvcHRzLmFsbG93bGlzdCA/PyBERUZBVUxUX1BBVEhfQUxMT1dMSVNUO1xuICBjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gPVxuICAgIG9wdHMuZW52ID8/IE9iamVjdC5mcm9tRW50cmllcyhhbGxvd2xpc3QubWFwKChuKSA9PiBbbiwgcHJvY2Vzcy5lbnZbbl1dKSk7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCB7IHN0YWdlczogc2ltcGxlQ29tbWFuZHMsIG1hbGZvcm1lZCB9ID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIC8vIFZlcmRpY3QgY29uc3VtcHRpb24gKHBsYW4gXHUwMEE3MSwgbGlzdC1zY29wZSArIHRlcm1pbmFsIHNlbWFudGljcyk6IHRoZVxuICAvLyBzcGxpdHRlciBoYXMgYWxyZWFkeSBkcm9wcGVkIHRoZSByZWplY3RpbmcgbGlzdCdzIHN0YWdlcyBhbmQgdHJ1bmNhdGVkIGF0XG4gIC8vIHRoZSBmaXJzdCBtYWxmb3JtZWQgbGlzdCwgc28gYHNpbXBsZUNvbW1hbmRzYCBpcyBleGFjdGx5IHRoZSBjb21wbGV0ZWRcbiAgLy8gZWFybGllciBsaXN0cyBhbmQgd2Fsa3Mgbm9ybWFsbHkgYmVsb3cgXHUyMDE0IHRoZSBmdWxsLWxpbmUga2luZHNcbiAgLy8gKCd1bmNsb3NlZC1xdW90ZScsICd1bmJhbGFuY2VkLXBhcmVuJywgJ2RhbmdsaW5nLW9wZXJhdG9yJywgJ3BpcGUtYmFuZycsXG4gIC8vICd1bmNsb3NlZC1icmFjZScsICd1bmNsb3NlZC1jYXNlJywgJ3VuY2xvc2VkLWNvbnN0cnVjdCcpIGVtaXQgbm8gdG91Y2hlc1xuICAvLyB3aXRob3V0IGZ1cnRoZXIgaGFuZGxpbmcuICd1bnRlcm1pbmF0ZWQtaGVyZWRvYycgKHRoZSBwYXJ0aWFsLCBhcnJpdmluZ1xuICAvLyB3aXRoIHRoZSBoZXJlZG9jIG1hY2hpbmVyeSBpbiBhIGxhdGVyIHBoYXNlKSBrZWVwcyB0aGUgY3VycmVudCBiZWhhdmlvcjpcbiAgLy8gaXRzIHN0YWdlIGxpc3QgcnVucyB0aHJvdWdoIHRoZSBkZWxpbWl0ZXIncyBsaW5lIGFuZCBsaWtld2lzZSBhbmFseXplc1xuICAvLyBhcy1pcy5cbiAgdm9pZCBtYWxmb3JtZWQ7XG5cbiAgLy8gVGhlIGV4ZWN1dGlvbiB3YWxrIChwbGFuIFx1MDBBNzIpIGRlY2lkZXMgd2hpY2ggc3RhZ2VzIHJhbiBhbmQgZXhwYW5kcyB0aGVcbiAgLy8gZGVjaWRhYmxlIGNvbnN0cnVjdCBpbnRlcmlvcnMgaW4gdGhlaXIgcGxhY2UuIE9ubHkgYCd5ZXMnYCBzdGFnZXMgZW1pdC5cbiAgY29uc3QgZXhwYW5kZWQgPSBuZXcgRXhlY3V0aW9uV2Fsa2VyKCkud2Fsa0lucHV0KHNpbXBsZUNvbW1hbmRzKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVxcdTAwMDAke3Jldn1cXHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICAvLyBgY2RgIGZyYW1lcyAocGxhbiBcdTAwQTc2KTogdGhlIHdhbGsgYXNzaWducyBlYWNoIHN0YWdlIHRoZSBzdWJzaGVsbCBmcmFtZSBpdFxuICAvLyByYW4gaW47IGEgc3Vic2hlbGwncyBgY2RgIHJlLWJhc2VzIHdpdGhpbiBpdHMgZnJlc2ggZnJhbWUsIGRpc2NhcmRlZCBhdFxuICAvLyB0aGUgY2xvc2UuIEVhY2ggZnJhbWUgdHJhY2tzIHRoZSBjb21wb3NlZCBlZmZlY3RpdmUgZGlyZWN0b3J5LCBpdHNcbiAgLy8gY2VydGFpbnR5IChhbiBleGVjdXRlZCBvciBtYXktaGF2ZS1ydW4gYGNkYCB3aXRoIGFuIHVucmVzb2x2YWJsZSB0YXJnZXRcbiAgLy8gcG9pc29ucyBpdCBcdTIwMTQgcmVsYXRpdmUgcmVzb2x1dGlvbiBmYWlscyBjbG9zZWQpLCBhbmQgdGhlIHByZS1gY2RgIHBhdGhcbiAgLy8gKGBjZCAtYCdzIE9MRFBXRCkuXG4gIGludGVyZmFjZSBEaXJGcmFtZSB7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgICBwcmV2OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgZGlyRnJhbWVzOiBEaXJGcmFtZVtdID0gW3sgZGlyOiBjd2QsIGNlcnRhaW46IHRydWUsIHByZXY6IHVuZGVmaW5lZCB9XTtcblxuICAvKiogVGhlIHBhcnRzIG9mIGEgZnJhbWUgdGhlIHJlc29sdXRpb24gcGF0aHMgbmVlZCAobm8gT0xEUFdEKS4gKi9cbiAgaW50ZXJmYWNlIEZyYW1lIHtcbiAgICBkaXI6IHN0cmluZztcbiAgICBjZXJ0YWluOiBib29sZWFuO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBlZmZlY3RpdmUgZ2l0IHJlcG8gZGlyIGZvciBhIGNhbmRpZGF0ZSAocGxhbiBcdTAwQTc2KTogYW4gYWJzb2x1dGUgYC1DYFxuICAgKiB0YXJnZXQgaXMgc2VsZi1jb250YWluZWQ7IGEgcmVsYXRpdmUgb25lIGNvbXBvc2VzIHdpdGggdGhlIHRyYWNrZWRcbiAgICogZGlyZWN0b3J5OyBubyBgLUNgIHVzZXMgdGhlIHRyYWNrZWQgZGlyZWN0b3J5IGl0c2VsZi4gVW5kZWZpbmVkIHdoZW4gdGhlXG4gICAqIGZyYW1lIGlzIHVuY2VydGFpbiBcdTIwMTQgdGhlIHJlcG8gbG9jYXRpb24gaXMgdW5rbm93biwgZmFpbCBjbG9zZWQuXG4gICAqL1xuICBjb25zdCBnaXREaXJPZiA9IChjOiB7IGRpck92ZXJyaWRlPzogc3RyaW5nIH0sIGZyYW1lOiBGcmFtZSk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgaWYgKGMuZGlyT3ZlcnJpZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyYW1lLmNlcnRhaW4gPyBmcmFtZS5kaXIgOiB1bmRlZmluZWQ7XG4gICAgaWYgKGlzQWJzb2x1dGUoYy5kaXJPdmVycmlkZSkpIHJldHVybiBjLmRpck92ZXJyaWRlO1xuICAgIHJldHVybiBmcmFtZS5jZXJ0YWluID8gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCBjLmRpck92ZXJyaWRlKSA6IHVuZGVmaW5lZDtcbiAgfTtcblxuICAvKiogVGhlIHJ1bm5pbmcgd2luZG93IG9mIHRoZSBjdXJyZW50IHBpcGVsaW5lIGdyb3VwIChwbGFuIFx1MDBBNzMpLiAqL1xuICBpbnRlcmZhY2UgV2luZG93U3RhdGUge1xuICAgIGlkaW9tOiBJZGlvbTtcbiAgICBmaWxlQXJnOiBzdHJpbmc7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgICBkaXJPdmVycmlkZT86IHN0cmluZztcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgfCB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICAgIGxvOiBudW1iZXI7XG4gICAgaGk6IG51bWJlcjtcbiAgICBjb25zdW1lZDogYm9vbGVhbjtcbiAgfVxuICBsZXQgd2luZG93OiBXaW5kb3dTdGF0ZSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0IHdob2xlRmlsZUNhbmRpZGF0ZSA9IChzOiB7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZScgfSk6IFJhd0NhbmRpZGF0ZSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgIGlkaW9tOiBzLmlkaW9tLFxuICAgIGZpbGVBcmc6IHMuZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gIH0pO1xuXG4gIC8qKiBBIHNvdXJjZSdzIHdob2xlLWZpbGUgcmVhZCBhcyBhIGNhbmRpZGF0ZSAoZnMgb3IgZ2l0IHJlc29sdmVyKS4gKi9cbiAgY29uc3Qgc291cmNlQ2FuZGlkYXRlID0gKHNyYzogTmFycm93YWJsZVNvdXJjZSk6IFJhd0NhbmRpZGF0ZSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgIGlkaW9tOiBzcmMuaWRpb20sXG4gICAgZmlsZUFyZzogc3JjLmZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgIHJlc29sdmVyS2luZDogc3JjLnJlc29sdmVyS2luZCxcbiAgICBkaXJPdmVycmlkZTogc3JjLmRpck92ZXJyaWRlXG4gIH0pO1xuXG4gIC8qKiBFbWl0IHRoZSB3aW5kb3cncyB0b3VjaDogb25lIG5hcnJvdyByYW5nZSB3aGVuIGEgc3RkaW4gc2VsZWN0b3IgY29uc3VtZWQgaXQsIGVsc2UgdGhlIHdob2xlLWZpbGUgcmVhZC4gKi9cbiAgY29uc3QgZW1pdFdpbmRvd1RvdWNoID0gKHc6IFdpbmRvd1N0YXRlKSA9PiB7XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IHcuY29uc3VtZWQgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IHcubG8sIGVuZDogdy5oaSB9IDogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9O1xuICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogdy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogdy5maWxlQXJnLFxuICAgICAgICBzcGVjLFxuICAgICAgICByZXNvbHZlcktpbmQ6IHcucmVzb2x2ZXJLaW5kLFxuICAgICAgICBkaXJPdmVycmlkZTogdy5kaXJPdmVycmlkZVxuICAgICAgfSxcbiAgICAgIHsgZGlyOiB3LmRpciwgY2VydGFpbjogdy5jZXJ0YWluIH1cbiAgICApO1xuICB9O1xuXG4gIC8qKlxuICAgKiBPcGVuIGEgd2luZG93IG92ZXIgYSBuYXJyb3dhYmxlIHNvdXJjZS4gQW4gdW5yZXNvbHZhYmxlIHNvdXJjZSBcdTIwMTQgYW5cbiAgICogdW5leHBhbmRlZCBwYXRoLCBhbiB1bmNlcnRhaW4gdHJhY2tlZCBkaXJlY3RvcnksIG9yIGFuIHVucmVzb2x2YWJsZVxuICAgKiBgZ2l0IC1DYCB0YXJnZXQgKHBsYW4gXHUwMEE3NikgXHUyMDE0IGVtaXRzIGFuIGB1bnJlc29sdmVkYCBlbnRyeSBhbmQgbm8gd2luZG93OlxuICAgKiBkb3duc3RyZWFtIHN0ZGluIHNlbGVjdG9ycyBjb25zdW1lIG5vdGhpbmcgKHBsYW4gXHUwMEE3MykuXG4gICAqL1xuICBjb25zdCBpbml0V2luZG93ID0gKHNyYzogTmFycm93YWJsZVNvdXJjZSwgZnJhbWU6IEZyYW1lKSA9PiB7XG4gICAgaWYgKFxuICAgICAgZ2l0RGlyT2Yoc3JjLCBmcmFtZSkgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgKCFmcmFtZS5jZXJ0YWluICYmIHNyYy5yZXNvbHZlcktpbmQgPT09ICdmcycgJiYgIWlzQWJzb2x1dGUoc3JjLmZpbGVBcmcpKVxuICAgICkge1xuICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpOyAvLyB0aGUgZ2F0ZSByZXBvcnRzIHRoZSB1bnJlc29sdmVkIGVudHJ5XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRvdGFsID0gKFxuICAgICAgc3JjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhyZXNvbHZlUGF0aChmcmFtZS5kaXIsIHNyYy5maWxlQXJnKSlcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKGdpdERpck9mKHNyYywgZnJhbWUpISwgc3JjLnJlc29sdmVyS2luZC5yZXYsIHNyYy5maWxlQXJnKVxuICAgICkoKTtcbiAgICBpZiAodG90YWwgPT09IG51bGwpIHtcbiAgICAgIGVtaXRDYW5kaWRhdGUoc291cmNlQ2FuZGlkYXRlKHNyYyksIGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgd2luZG93ID0ge1xuICAgICAgaWRpb206IHNyYy5pZGlvbSxcbiAgICAgIGZpbGVBcmc6IHNyYy5maWxlQXJnLFxuICAgICAgZGlyOiBmcmFtZS5kaXIsXG4gICAgICBjZXJ0YWluOiBmcmFtZS5jZXJ0YWluLFxuICAgICAgZGlyT3ZlcnJpZGU6IHNyYy5kaXJPdmVycmlkZSxcbiAgICAgIHJlc29sdmVyS2luZDogc3JjLnJlc29sdmVyS2luZCxcbiAgICAgIGxvOiAxLFxuICAgICAgaGk6IHRvdGFsLFxuICAgICAgY29uc3VtZWQ6IGZhbHNlXG4gICAgfTtcbiAgfTtcblxuICAvKipcbiAgICogQXBwbHkgYSBzdGRpbiBzZWxlY3RvcidzIHRyYW5zZm9ybSB0byB0aGUgbGl2ZSB3aW5kb3csIGNsYW1wZWQgdG8gdGhlXG4gICAqIGN1cnJlbnQgd2luZG93LiBBIG5hcnJvd2luZyB0cmFuc2Zvcm0gbWFya3MgdGhlIHdpbmRvdyBjb25zdW1lZCAodGhlXG4gICAqIGVtaXR0ZWQgdG91Y2ggaXMgdGhlIG5hcnJvdyByYW5nZSwgbm90IHRoZSB3aG9sZS1maWxlIHJlYWQpLiBSZXR1cm5zXG4gICAqIGZhbHNlIHdoZW4gdGhlIHRyYW5zZm9ybSBlbXB0aWVzIHRoZSB3aW5kb3cgXHUyMDE0IHRoZSBwcmUtdHJhbnNmb3JtIHdpbmRvd1xuICAgKiBzdXJ2aXZlcyAod2hhdCBhIHJlYWRlciBhY3R1YWxseSBjb25zdW1lZCkgYW5kIHN0YXlzIHVuY29uc3VtZWQuXG4gICAqL1xuICBjb25zdCBhcHBseVdpbmRvd1RyYW5zZm9ybSA9IChzZWw6IFN0ZGluU2VsZWN0b3IpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCB3ID0gd2luZG93ITtcbiAgICBjb25zdCBsbyA9IHcubG87XG4gICAgY29uc3QgaGkgPSB3LmhpO1xuICAgIGxldCBuTG86IG51bWJlcjtcbiAgICBsZXQgbkhpOiBudW1iZXI7XG4gICAgaWYgKHNlbC5raW5kID09PSAnaGVhZCcpIHtcbiAgICAgIG5MbyA9IGxvO1xuICAgICAgbkhpID0gbG8gKyBzZWwuY291bnQgLSAxO1xuICAgIH0gZWxzZSBpZiAoc2VsLmtpbmQgPT09ICd0YWlsJykge1xuICAgICAgaWYgKHNlbC5mcm9tU3RhcnQpIHtcbiAgICAgICAgbkxvID0gbG8gKyBzZWwuY291bnQgLSAxO1xuICAgICAgICBuSGkgPSBoaTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5MbyA9IGhpIC0gc2VsLmNvdW50ICsgMTtcbiAgICAgICAgbkhpID0gaGk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5MbyA9IGxvICsgc2VsLnJhbmdlc1swXS5zdGFydCAtIDE7XG4gICAgICBuSGkgPSBzZWwucmFuZ2VzWzBdLmVuZCA9PT0gJyQnID8gaGkgOiBsbyArIHNlbC5yYW5nZXNbMF0uZW5kIC0gMTtcbiAgICB9XG4gICAgbkxvID0gTWF0aC5tYXgobkxvLCBsbyk7XG4gICAgbkhpID0gTWF0aC5taW4obkhpLCBoaSk7XG4gICAgaWYgKG5MbyA+IG5IaSkgcmV0dXJuIGZhbHNlO1xuICAgIHcubG8gPSBuTG87XG4gICAgdy5oaSA9IG5IaTtcbiAgICB3LmNvbnN1bWVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICAvKiogQSBtdWx0aS1yYW5nZSBzdGRpbiBzZWQgZGVsaXZlcnMgZWFjaCByYW5nZSBhcyBpdHMgb3duIHRvdWNoIGFuZCBzZXZlcnM7IGVtcHR5IGNsYW1wcyBkcm9wLiAqL1xuICBjb25zdCBlbWl0TXVsdGlSYW5nZSA9IChyYW5nZXM6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfCAnJCcgfVtdKSA9PiB7XG4gICAgY29uc3QgdyA9IHdpbmRvdyE7XG4gICAgbGV0IGVtaXR0ZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHIgb2YgcmFuZ2VzKSB7XG4gICAgICBjb25zdCBtTG8gPSBNYXRoLm1heCh3LmxvLCB3LmxvICsgci5zdGFydCAtIDEpO1xuICAgICAgY29uc3QgbUhpID0gTWF0aC5taW4ody5oaSwgci5lbmQgPT09ICckJyA/IHcuaGkgOiB3LmxvICsgci5lbmQgLSAxKTtcbiAgICAgIGlmIChtTG8gPiBtSGkpIGNvbnRpbnVlO1xuICAgICAgZW1pdHRlZCA9IHRydWU7XG4gICAgICBlbWl0Q2FuZGlkYXRlKFxuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgaWRpb206IHcuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogdy5maWxlQXJnLFxuICAgICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogbUxvLCBlbmQ6IG1IaSB9LFxuICAgICAgICAgIHJlc29sdmVyS2luZDogdy5yZXNvbHZlcktpbmQsXG4gICAgICAgICAgZGlyT3ZlcnJpZGU6IHcuZGlyT3ZlcnJpZGVcbiAgICAgICAgfSxcbiAgICAgICAgeyBkaXI6IHcuZGlyLCBjZXJ0YWluOiB3LmNlcnRhaW4gfVxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKCFlbWl0dGVkKSBlbWl0V2luZG93VG91Y2godyk7IC8vIGV2ZXJ5IHJhbmdlIGRyb3BwZWQgXHUyMDE0IHRoZSBwcmUtdHJhbnNmb3JtIHdpbmRvdyBzdXJ2aXZlc1xuICB9O1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoYzogUmF3Q2FuZGlkYXRlLCBmcmFtZTogRnJhbWUpID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFBsYW4gXHUwMEE3NiBjZXJ0YWludHk6IGEgcmVsYXRpdmUgcGF0aCBhZ2FpbnN0IGFuIHVuY2VydGFpbiBkaXJlY3RvcnksIG9yIGFcbiAgICAvLyBnaXQgY2FuZGlkYXRlIHdob3NlIHJlcG8gZnJhbWUgY2Fubm90IGJlIGNvbXBvc2VkLCBpcyB1bnJlc29sdmFibGUgXHUyMDE0XG4gICAgLy8gbmV2ZXIgYSBndWVzc2VkIHRvdWNoLiBBYnNvbHV0ZSBwYXRocyBhcmUgdW5hZmZlY3RlZC5cbiAgICBpZiAoYy5yZXNvbHZlcktpbmQgPT09ICdmcycpIHtcbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZShjLmZpbGVBcmcpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGdpdERpck9mKGMsIGZyYW1lKSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAndGhlIGdpdCAtQyB0YXJnZXQgY2Fubm90IGJlIHJlc29sdmVkIGFnYWluc3QgdGhlIHRyYWNrZWQgZGlyZWN0b3J5J1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIEEgZ2l0IGNhbmRpZGF0ZSdzIHBhdGggcmVzb2x2ZXMgaW5zaWRlIGl0cyByZXBvIGRpciAoYC1DYCB0YXJnZXQgb3IgdGhlXG4gICAgLy8gdHJhY2tlZCBkaXJlY3RvcnkpLCBub3QgdGhlIHByb2Nlc3MgZGlyIFx1MjAxNCBwbGFuIFx1MDBBNzYuXG4gICAgY29uc3QgcmVzb2x1dGlvbkRpciA9IGMucmVzb2x2ZXJLaW5kID09PSAnZnMnID8gZnJhbWUuZGlyIDogZ2l0RGlyT2YoYywgZnJhbWUpITtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChyZXNvbHV0aW9uRGlyLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMocmVzb2x1dGlvbkRpciwgYy5yZXNvbHZlcktpbmQucmV2LCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoYy5zcGVjLCB0b3RhbExpbmVzKTtcbiAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYWJzb2x1dGVQYXRoLFxuICAgICAgICByZWFzb246ICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIGdpdCByZXYvcGF0aCBub3QgZm91bmQpJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCB9XG4gICAgfSk7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBleHBhbmRlZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGl0ZW0gPSBleHBhbmRlZFtpXTtcbiAgICB3aGlsZSAoZGlyRnJhbWVzLmxlbmd0aCA+IGl0ZW0uZGlyRnJhbWUgKyAxKSBkaXJGcmFtZXMucG9wKCk7XG4gICAgd2hpbGUgKGRpckZyYW1lcy5sZW5ndGggPCBpdGVtLmRpckZyYW1lICsgMSkgZGlyRnJhbWVzLnB1c2goeyAuLi5kaXJGcmFtZXNbZGlyRnJhbWVzLmxlbmd0aCAtIDFdIH0pO1xuICAgIGNvbnN0IGZyYW1lID0gZGlyRnJhbWVzW2RpckZyYW1lcy5sZW5ndGggLSAxXTtcblxuICAgIC8vIGAkUFdEYCByZXNvbHZlcyB0byB0aGUgdHJhY2tlZCBkaXJlY3RvcnksIG5vdCB0aGUgc3RhbGUgaG9vayBlbnYgKHBsYW5cbiAgICAvLyBcdTAwQTc2KSBcdTIwMTQgdGhlIHBlci1zdGFnZSBlbnYgb3ZlcnJpZGVzIGl0IHdpdGggdGhlIGNvbXBvc2VkIGZyYW1lLlxuICAgIGNvbnN0IHN0YWdlRW52ID0geyAuLi5lbnYsIFBXRDogZnJhbWUuZGlyIH07XG5cbiAgICBjb25zdCBwaXBlUHJlY2VkZXMgPSBpdGVtLnByZWNlZGVkQnkgPT09ICdwaXBlJztcbiAgICBjb25zdCBwaXBlRm9sbG93cyA9IGV4cGFuZGVkW2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIGV4cGFuZGVkW2kgKyAxXS5wcmVjZWRlZEJ5ID09PSAncGlwZSc7XG5cbiAgICAvLyBBIHBpcGVsaW5lIGdyb3VwIGlzIGRvbmUgYXQgaXRzIG5leHQgbm9uLXBpcGUgc3RhZ2U6IGZsdXNoIHRoZSB3aW5kb3dcbiAgICAvLyAob25lIG5hcnJvdyB0b3VjaCBpZiBhIHN0ZGluIHNlbGVjdG9yIGNvbnN1bWVkIHRoZSBzb3VyY2UsIGVsc2UgdGhlXG4gICAgLy8gY29uc2VydmF0aXZlIHdob2xlLWZpbGUgcmVhZCBcdTIwMTQgcGxhbiBcdTAwQTczLCBlbWl0KS5cbiAgICBpZiAoIXBpcGVQcmVjZWRlcyAmJiB3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgd2luZG93ID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBgY2RgIGJvb2trZWVwaW5nIChwbGFuIFx1MDBBNzYpIHJ1bnMgYmVmb3JlIHRoZSBleGVjIGdhdGU6IGEgbWF5LWhhdmUtcnVuXG4gICAgLy8gKGAndW5rbm93bidgKSBjZCBwb2lzb25zIGNlcnRhaW50eSBldmVuIHRob3VnaCBpdHMgb3duIHN0YWdlIGVtaXRzXG4gICAgLy8gbm90aGluZywgYW5kIGEgc2tpcHBlZCAoYCdubydgKSBjZCBsZWF2ZXMgdGhlIGRpciB1bmNoYW5nZWQuXG4gICAgY29uc3QgY2RBcmd2ID0gc3RyaXBGb3JFbWlzc2lvbihzdHJpcFJlZGlyZWN0cyhhcmd2T2YoaXRlbS50ZXh0KSA/PyBbXSkpO1xuICAgIGlmIChjZEFyZ3ZbMF0gPT09ICdjZCcgJiYgIWl0ZW0uaW5QaXBlbGluZSkge1xuICAgICAgaWYgKGl0ZW0uZXhlYyA9PT0gJ3llcycpIHtcbiAgICAgICAgLy8gVGhlIHRhcmdldCBleHBhbmRzIGxpa2UgYW55IG90aGVyIHdvcmQgXHUyMDE0IGBjZCBcIiRXT1JLU1BBQ0VfUEFUSFwiYFxuICAgICAgICAvLyBmaW5hbGx5IHdvcmtzIChwbGFuIFx1MDBBNzcpLiBCYXJlIGBjZGAgaXMgYCRIT01FYCB2aWEgdGhlIHNhbWVcbiAgICAgICAgLy8gZXhwYW5zaW9uIG1hY2hpbmVyeS5cbiAgICAgICAgY29uc3QgZXhwYW5kZWRBcmd2ID0gc3RyaXBGb3JFbWlzc2lvbihcbiAgICAgICAgICBzdHJpcFJlZGlyZWN0cyhhcmd2T2YoZXhwYW5kVmFyaWFibGVzKGl0ZW0udGV4dCwgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpKSA/PyBbXSlcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXhwYW5kZWRBcmd2WzFdO1xuICAgICAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQgfHwgdGFyZ2V0ID09PSAnficgfHwgdGFyZ2V0LnN0YXJ0c1dpdGgoJ34vJykpIHtcbiAgICAgICAgICAvLyBCYXJlIGBjZGAgaXMgYCRIT01FYDsgYSBgfmAvYH4vXHUyMDI2YCB0YXJnZXQgaXMgdGhlIHNhbWUgdGlsZGVcbiAgICAgICAgICAvLyBleHBhbnNpb24gKHBsYW4gXHUwMEE3NikgXHUyMDE0IHRoZSBhbGxvd2xpc3RlZCBIT01FIHZpYSB0aGUgZXhwYW5zaW9uXG4gICAgICAgICAgLy8gbWFjaGluZXJ5LCBjZXJ0YWluIHdoZW4gaXQgcmVzb2x2ZXMsIHVuY2VydGFpbiBvdGhlcndpc2UuXG4gICAgICAgICAgY29uc3QgaG9tZSA9IGV4cGFuZFZhcmlhYmxlcygnJEhPTUUnLCBpdGVtLmFzc2lnbm1lbnRzLCBzdGFnZUVudik7XG4gICAgICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGhvbWUpKSBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBmcmFtZS5wcmV2ID0gZnJhbWUuZGlyO1xuICAgICAgICAgICAgZnJhbWUuZGlyID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB0YXJnZXQgPT09IHVuZGVmaW5lZCA/IGhvbWUgOiBob21lICsgdGFyZ2V0LnNsaWNlKDEpKTtcbiAgICAgICAgICAgIGZyYW1lLmNlcnRhaW4gPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQgPT09ICctJykge1xuICAgICAgICAgIC8vIGBjZCAtYCBpcyBiYXNoJ3MgT0xEUFdEIFx1MjAxNCB0aGUgcHJldmlvdXMgdHJhY2tlZCBwYXRoLiBXaXRoIG5vXG4gICAgICAgICAgLy8gcHJldmlvdXMgcGF0aCB0aGUgY2QgZmFpbHMgYW5kIHRoZSBzaGVsbCBzdGF5cyBwdXQuXG4gICAgICAgICAgaWYgKGZyYW1lLnByZXYgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3Qgb2xkID0gZnJhbWUuZGlyO1xuICAgICAgICAgICAgZnJhbWUuZGlyID0gZnJhbWUucHJldjtcbiAgICAgICAgICAgIGZyYW1lLnByZXYgPSBvbGQ7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC5zdGFydHNXaXRoKCd+JykpIHtcbiAgICAgICAgICAvLyBBIGB+dXNlcmAtc3R5bGUgdGFyZ2V0IHJlc29sdmVzIHRvIHRoYXQgdXNlcidzIGhvbWUgXHUyMDE0IHVua25vd24gdG9cbiAgICAgICAgICAvLyB0aGUgd2FsazogYmFzaCBtb3ZlZCB0byBhbiB1bmtub3duIGRpciBvciBmYWlsZWQgYW5kIHN0YXllZCwgYm90aFxuICAgICAgICAgIC8vIGxpdmUsIHNvIGNlcnRhaW50eSBpcyBwb2lzb25lZC5cbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAobG9va3NVbnJlc29sdmFibGUodGFyZ2V0KSkge1xuICAgICAgICAgIC8vIFZhcmlhYmxlL2dsb2IgdGFyZ2V0OiBiYXNoIGVpdGhlciBtb3ZlZCB0byBhbiB1bmtub3duIGRpciBvclxuICAgICAgICAgIC8vIGZhaWxlZCBhbmQgc3RheWVkIFx1MjAxNCBib3RoIGxpdmUsIHNvIGNlcnRhaW50eSBpcyBwb2lzb25lZC5cbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZnJhbWUucHJldiA9IGZyYW1lLmRpcjtcbiAgICAgICAgICBmcmFtZS5kaXIgPSByZXNvbHZlUGF0aChmcmFtZS5kaXIsIHRhcmdldCk7XG4gICAgICAgICAgZnJhbWUuY2VydGFpbiA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaXRlbS5leGVjID09PSAndW5rbm93bicpIHtcbiAgICAgICAgZnJhbWUuY2VydGFpbiA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7IC8vIGEgY2QgbmV2ZXIgbWF0Y2hlcyBhIHNvdXJjZS9jb25zdW1lciBpZGlvbVxuICAgIH1cblxuICAgIGlmIChpdGVtLmV4ZWMgIT09ICd5ZXMnKSB7XG4gICAgICAvLyBBIGRlYWQgb3IgdW5rbm93biBzdGFnZSBuZXZlciBydW5zIFx1MjAxNCBubyB0b3VjaCwgbm8gc2lkZSBlZmZlY3RzLlxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IGl0ZW0udGV4dC5tYXRjaCgvXl9faGVyZWRvY18oXFxkKylfXyQvKTtcbiAgICBpZiAoaGVyZWRvY1JlZikge1xuICAgICAgLy8gVGhlIGhlcmVkb2Mtd3JpdGUgc3RhZ2UgZG9lc24ndCByZWFkIHRoZSBwaXBlIFx1MjAxNCBhbGlnbm1lbnQgc2V2ZXJzLlxuICAgICAgaWYgKHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHcudGFyZ2V0KSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogdy50YXJnZXQsXG4gICAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZSh3LnRhcmdldCkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IHcudGFyZ2V0LFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB3LnRhcmdldCk7XG4gICAgICBjb25zdCBib2R5TGluZXMgPSB3LmJvZHkubGVuZ3RoID09PSAwID8gMCA6IHcuYm9keS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICAgICAgaWYgKGJvZHlMaW5lcyA9PT0gMCkge1xuICAgICAgICAvLyBgY2F0ID4gZiA8PCdFT0YnYCB3aXRoIGFuIGVtcHR5IGJvZHkgdHJ1bmNhdGVzIHRoZSBmaWxlIHRvIGVtcHR5IFx1MjAxNCBhXG4gICAgICAgIC8vIHJlYWwgd3JpdGUgdGhhdCBtdXN0IHByb2R1Y2UgYSB0b3VjaCAod2hvbGUtZmlsZSwgdmlhIGBib2R5OiAnJ2ApLlxuICAgICAgICAvLyBgPj5gIHdpdGggYW4gZW1wdHkgYm9keSBhcHBlbmRzIG5vdGhpbmcgYW5kIGlzIGEgZ2VudWluZSBuby1vcC5cbiAgICAgICAgaWYgKHcucmVkaXJlY3QgIT09ICc+JykgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IDEsIGFic29sdXRlUGF0aCwgYm9keTogJycsIHJlZGlyZWN0OiB3LnJlZGlyZWN0IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICAgIHcucmVkaXJlY3QgPT09ICc+JyA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogMSwgZW5kOiBib2R5TGluZXMgfSA6IHsga2luZDogJ2FwcGVuZExpbmVzJywgY291bnQ6IGJvZHlMaW5lcyB9O1xuICAgICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhzcGVjLCBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKSk7XG4gICAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgICByZWFzb246ICdhcHBlbmQgdGFyZ2V0OiBjb3VsZCBub3QgcmVhZCBleGlzdGluZyBmaWxlIHRvIGZpbmQgaXRzIGN1cnJlbnQgbGVuZ3RoJ1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCwgbGluZUVuZDogcmFuZ2UubGluZUVuZCwgYWJzb2x1dGVQYXRoLCBib2R5OiB3LmJvZHksIHJlZGlyZWN0OiB3LnJlZGlyZWN0IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBEaXNwYXRjaCBhcmd2IChwbGFuIFx1MDBBNzcpOiB0aGUgc3RhZ2UncyByYXcgdGV4dCBpcyBleHBhbmRlZCBiZWZvcmVcbiAgICAvLyB0b2tlbml6aW5nIFx1MjAxNCBhIHJlc29sdmVkIGBjYXQgXCIkV09SS1NQQUNFX1BBVEgvZlwiYCBuYXJyb3dzIHRocm91Z2ggYVxuICAgIC8vIHBpcGVsaW5lIGV4YWN0bHkgbGlrZSBgY2F0IGZgLiBSZWRpcmVjdHMgYXJlIHN0cmlwcGVkIGZpcnN0ICh0aGVcbiAgICAvLyByZWFkLXNpZGUgcmVjb3ZlcnksIFx1MDBBNzQpLCB0aGVuIHRoZSB0cmFuc3BhcmVudCB3cmFwcGVycyAoXHUwMEE3NSksIHRoZW4gdGhlXG4gICAgLy8gZW1pc3Npb24tc2lkZSBgIWAvYGNvbW1hbmRgL2BleGVjYCBzdHJpcCBcdTIwMTQgc28gYGNvbW1hbmQgLXAgc2VkIFx1MjAyNmAgc3RpbGxcbiAgICAvLyByZWFjaGVzIGBzZWRgLlxuICAgIGNvbnN0IHJhd0FyZ3YgPSBhcmd2T2YoZXhwYW5kVmFyaWFibGVzKGl0ZW0udGV4dCwgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpKSA/PyBbXTtcbiAgICBjb25zdCBzdHJpcHBlZCA9IHN0cmlwRm9yRW1pc3Npb24oc3RyaXBXcmFwcGVycyhzdHJpcFJlZGlyZWN0cyhyYXdBcmd2KSkpO1xuICAgIGlmIChzdHJpcHBlZC5sZW5ndGggPT09IDApIHtcbiAgICAgIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBBIHJlc2lkdWFsIHJlZGlyZWN0IHRva2VuIChgPnxgLCBhbnl0aGluZyBlbHNlIGJlZ2lubmluZyB3aXRoIGA+YC9gPGBcbiAgICAvLyB0aGF0IHN0cmlwUmVkaXJlY3RzIGxlZnQgYWxvbmUsIFx1MDBBNzQpIGZhaWxzIGNsb3NlZDogdGhlIHN0YWdlIG1hdGNoZXNcbiAgICAvLyBub3RoaW5nIFx1MjAxNCBubyBzb3VyY2UsIG5vIHNlbGVjdG9yLCBubyB0b3VjaC5cbiAgICBpZiAoc3RyaXBwZWQuc29tZSgodykgPT4gdy5zdGFydHNXaXRoKCc+JykgfHwgdy5zdGFydHNXaXRoKCc8JykpKSB7XG4gICAgICBpZiAod2luZG93ICE9PSBudWxsKSB7XG4gICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVGhlIHNvdXJjZSBvZiBhIHBpcGVsaW5lIGdyb3VwIChwbGFuIFx1MDBBNzMpOiBhIG5hcnJvd2FibGUgYGNhdGAvYG5sYCBvclxuICAgIC8vIGBnaXQgc2hvd2Agb3BlbnMgdGhlIHdpbmRvdyBhbmQgZGVmZXJzIGl0cyB3aG9sZS1maWxlIHJlYWQ7IGFcbiAgICAvLyBtdWx0aS1maWxlL3N0ZGluLW1peGVkIHNvdXJjZSBlbWl0cyBlYWNoIGZpbGUncyBjb25zZXJ2YXRpdmUgd2hvbGUtZmlsZVxuICAgIC8vIHJlYWQgYW5kIG5ldmVyIG5hcnJvd3M7IGEgc3Rkb3V0LWZvcm0gcmVkaXJlY3Qgb24gdGhlIHNvdXJjZSBlbXB0aWVzXG4gICAgLy8gdGhlIHBpcGUgXHUyMDE0IGl0cyB3aG9sZS1maWxlIHJlYWQgc3RhbmRzIGFuZCBkb3duc3RyZWFtIGNvbnN1bWVzIG5vdGhpbmcuXG4gICAgaWYgKCFwaXBlUHJlY2VkZXMgJiYgcGlwZUZvbGxvd3MgJiYgKHN0cmlwcGVkWzBdID09PSAnY2F0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ25sJyB8fCBzdHJpcHBlZFswXSA9PT0gJ2dpdCcpKSB7XG4gICAgICBjb25zdCBzcmMgPSBhbmFseXplU291cmNlKHN0cmlwcGVkKTtcbiAgICAgIHN3aXRjaCAoc3JjLmtpbmQpIHtcbiAgICAgICAgY2FzZSAnbm9uZSc6XG4gICAgICAgICAgYnJlYWs7IC8vIGZhbGwgdGhyb3VnaCB0byB0aGUgb3JkaW5hcnkgZGlzcGF0Y2hcbiAgICAgICAgY2FzZSAnZ2l0VW5yZXNvbHZlZCc6XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgICAgICBmaWxlQXJnOiBzcmMuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogc3JjLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICBjYXNlICd1bm5hcnJvd2FibGUnOiB7XG4gICAgICAgICAgZm9yIChjb25zdCBmIG9mIHNyYy5maWxlcykgZW1pdENhbmRpZGF0ZSh3aG9sZUZpbGVDYW5kaWRhdGUoZiksIGZyYW1lKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjYXNlICduYXJyb3dhYmxlJzpcbiAgICAgICAgY2FzZSAnZ2l0Jzoge1xuICAgICAgICAgIGlmIChoYXNTdGRvdXRSZWRpcmVjdChyYXdBcmd2KSkge1xuICAgICAgICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbml0V2luZG93KHNyYywgZnJhbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEEgcGlwZSBtZW1iZXIgb2YgYSBsaXZlIHdpbmRvdyAocGxhbiBcdTAwQTczLCBjb25zdW1lcnMpOiBhIHN0ZGluXG4gICAgLy8gbGluZS1zZWxlY3RvciB0cmFuc2Zvcm1zIHRoZSB3aW5kb3cgd2hpbGUgYWxpZ25lZDsgYSBub24tY29uc3VtZXIgb3JcbiAgICAvLyB1bnJlY29nbml6ZWQgc3RhZ2Ugc2V2ZXJzIFx1MjAxNCB0aGUgdG91Y2ggaXMgdGhlIHdpbmRvdyBhdCB0aGUgc2V2ZXIgcG9pbnRcbiAgICAvLyBhbmQgbGF0ZXIgc3RhZ2VzIGFyZSBpZ25vcmVkIGZvciB3aW5kb3cgcHVycG9zZXMuIEEgc3Rkb3V0LWZvcm1cbiAgICAvLyByZWRpcmVjdCBvbiB0aGUgc3RhZ2Ugb25seSBtb3ZlcyBpdHMgb3duIG91dHB1dCBcdTIwMTQgaXQgcmVhZHMgbm9ybWFsbHksXG4gICAgLy8gdGhlbiBzZXZlcnMuXG4gICAgaWYgKHBpcGVQcmVjZWRlcyAmJiB3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHNlbCA9IGNsYXNzaWZ5U3RkaW5TZWxlY3RvcihzdHJpcHBlZCk7XG4gICAgICBpZiAoc2VsICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChzZWwua2luZCA9PT0gJ3NlZCcgJiYgc2VsLnJhbmdlcy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgZW1pdE11bHRpUmFuZ2Uoc2VsLnJhbmdlcyk7XG4gICAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhcHBseVdpbmRvd1RyYW5zZm9ybShzZWwpO1xuICAgICAgICAgIGlmIChoYXNTdGRvdXRSZWRpcmVjdChyYXdBcmd2KSkge1xuICAgICAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT3JkaW5hcnkgZGlzcGF0Y2g6IGEgY2F0L25sIHN0YWdlJ3Mgb3duIHdob2xlLWZpbGUgcmVhZCAoYSBsb25lIHN0YWdlXG4gICAgLy8gb3IgYSBub24tc291cmNlIHBpcGUgbWVtYmVyKSwgYW5kIHRoZSBsaW5lLXNlbGVjdG9yL2dpdCBpZGlvbXMuXG4gICAgaWYgKHN0cmlwcGVkWzBdID09PSAnY2F0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ25sJykge1xuICAgICAgY29uc3Qgc3JjID0gYW5hbHl6ZVNvdXJjZShzdHJpcHBlZCk7XG4gICAgICBpZiAoc3JjLmtpbmQgPT09ICduYXJyb3dhYmxlJykge1xuICAgICAgICBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZSh7IGZpbGVBcmc6IHNyYy5maWxlQXJnLCBpZGlvbTogc3JjLmlkaW9tIH0pLCBmcmFtZSk7XG4gICAgICB9IGVsc2UgaWYgKHNyYy5raW5kID09PSAndW5uYXJyb3dhYmxlJykge1xuICAgICAgICBmb3IgKGNvbnN0IGYgb2Ygc3JjLmZpbGVzKSBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZShmKSwgZnJhbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoc3RyaXBwZWQpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgZnJhbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIFBhc3MgYG9wdHMuY3dkYCAoZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgKSBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnM7IGBvcHRzLmVudmAvYG9wdHMuYWxsb3dsaXN0YCBmZWVkIHRoZSBQaGFzZSAzIGFsbG93bGlzdGVkIHZhcmlhYmxlIHJlc29sdXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgb3B0cyk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqL1xuXG4vKipcbiAqIFRoZSBub3JtYWxpemVkIGJvdW5kYXJ5IG9wZXJhdG9ycyBgc3BsaXRUb3BMZXZlbGAgZW1pdHMgXHUyMDE0IHRoZSBzaW5nbGVcbiAqIHJlcHJlc2VudGF0aW9uIGJvdGggYWRhcHRlcnMgY29uc3VtZS5cbiAqL1xuZXhwb3J0IHR5cGUgT3BlcmF0b3IgPSAncGlwZScgfCAnYW5kJyB8ICdvcicgfCAnc2VtaWNvbG9uJyB8ICduZXdsaW5lJyB8ICdiYWNrZ3JvdW5kJyB8ICdzdGFydCc7XG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZCAoJ3BpcGUnIGZvciBhIHBpcGVsaW5lIHN0YWdlLCAnYW5kJyBmb3IgYCYmYCwgJ29yJyBmb3IgYHx8YCwgJ3NlbWljb2xvbicgZm9yIGA7YCwgJ25ld2xpbmUnIGZvciBhIG5ld2xpbmUgc2VwYXJhdG9yLCAnYmFja2dyb3VuZCcgZm9yIGAmYCwgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQpLiAqL1xuICBwcmVjZWRlZEJ5OiBPcGVyYXRvcjtcbn1cblxuLyoqIFRoZSB2ZXJkaWN0IGtpbmRzIGBzcGxpdFRvcExldmVsYCBjYW4gcmV0dXJuIHdoZW4gdGhlIGlucHV0IGlzIGEgQmFzaCBwYXJzZSBlcnJvciAocGxhbiBcdTAwQTcxKS4gKi9cbmV4cG9ydCB0eXBlIE1hbGZvcm1lZFZlcmRpY3QgPVxuICB8ICd1bmNsb3NlZC1xdW90ZSdcbiAgfCAndW5iYWxhbmNlZC1wYXJlbidcbiAgfCAnZGFuZ2xpbmctb3BlcmF0b3InXG4gIHwgJ3BpcGUtYmFuZydcbiAgfCAndW50ZXJtaW5hdGVkLWhlcmVkb2MnXG4gIHwgJ3VuY2xvc2VkLWJyYWNlJ1xuICB8ICd1bmNsb3NlZC1jYXNlJ1xuICB8ICd1bmNsb3NlZC1jb25zdHJ1Y3QnO1xuXG4vKiogVGhlIHJlc3VsdCBvZiBhIHRvcC1sZXZlbCBzcGxpdDogdGhlIHN0YWdlIGxpc3QsIHBsdXMgYSBgbWFsZm9ybWVkYCB2ZXJkaWN0IHdoZW4gdGhlIGlucHV0IGlzIGEgQmFzaCBwYXJzZSBlcnJvci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BsaXRSZXN1bHQge1xuICBzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXTtcbiAgLyoqXG4gICAqIFNldCB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IgXHUyMDE0IGJhc2ggcmVqZWN0cyB0aGUgZW50aXJlIGxpc3QgYXRcbiAgICogcGFyc2UgdGltZSAoZXhpdCAyLCBub3RoaW5nIGV4ZWN1dGVkKSwgc28gYW55IHN0YWdlLWRlcml2ZWQgdG91Y2ggd291bGQgYmVcbiAgICogYSBwaGFudG9tLiBUaGUgcmVqZWN0aW9uIGlzIGxpc3Qtc2NvcGVkIGFuZCB0ZXJtaW5hbCAocGxhbiBcdTAwQTcxKTogdGhlIHN0YWdlXG4gICAqIGxpc3Qga2VlcHMgZXZlcnkgc3RhZ2UgZnJvbSBjb21wbGV0ZWQgZWFybGllciBsaXN0cywgZHJvcHMgdGhlIHJlamVjdGluZ1xuICAgKiBsaXN0J3Mgb3duIHN0YWdlcywgYW5kIHN0b3BzIGF0IGl0IFx1MjAxNCBldmVyeSBsYXRlciB1bml0IGlzIGRlYWQuXG4gICAqL1xuICBtYWxmb3JtZWQ/OiBNYWxmb3JtZWRWZXJkaWN0O1xufVxuXG4vKiogVGhlIGNvbnN0cnVjdCBraW5kcyB0aGUga2luZC1tYXRjaGVkIHN0YWNrIHRyYWNrcyAocGxhbiBcdTAwQTczKS4gKi9cbnR5cGUgQ29uc3RydWN0S2luZCA9ICdpZicgfCAnbG9vcCcgfCAnZm9yJyB8ICdzZWxlY3QnIHwgJ2JyYWNlJztcblxuLyoqIE9uZSBvcGVuIGNvbnN0cnVjdDogaXRzIGtpbmQsIGFuZCB3aGV0aGVyIGEgYm9keSB3b3JkIGhhcyBiZWVuIHNlZW4uICovXG5pbnRlcmZhY2UgT3BlbkNvbnN0cnVjdCB7XG4gIGtpbmQ6IENvbnN0cnVjdEtpbmQ7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgYm9keSBoYXMgc3RhcnRlZC4gRm9yIGBpZmAgdGhlIGJvZHkgc3RhcnRzIGF0IGB0aGVuYC9gZWxzZWAvXG4gICAqIGBlbGlmYCwgZm9yIGxvb3BzIGF0IGBkb2AsIGZvciBicmFjZSBncm91cHMgYXQgYW55IGNvbW1hbmQgd29yZCBcdTIwMTQgYVxuICAgKiBjbG9zZXIgd2l0aCBubyBib2R5IChgaWYgeDsgZmlgLCBgeyB9YCkgaXMgYSBCYXNoIHBhcnNlIGVycm9yLlxuICAgKi9cbiAgYm9keTogYm9vbGVhbjtcbn1cblxuLyoqIFRoZSBjYXNlIHJlZ2lvbidzIHBvc2l0aW9uIHN0YXRlIChwbGFuIFx1MDBBNzMpLiAqL1xudHlwZSBDYXNlUG9zID0gJ3N1YmplY3QnIHwgJ3BhdHRlcm4tc3RhcnQnIHwgJ3BhdHRlcm4nIHwgJ2NvbW1hbmQnO1xuXG4vKiogQW4gb3BlbiBjYXNlIHJlZ2lvbjogb3BhcXVlIGNvbnRlbnQgb3duZWQgYnkgdGhlIGNhc2Ugc2Nhbi4gKi9cbmludGVyZmFjZSBDYXNlUmVnaW9uIHtcbiAgcG9zOiBDYXNlUG9zO1xuICAvKiogSW4gYSBgY29tbWFuZGAgcG9zaXRpb246IHdoZXRoZXIgdGhlIGN1cnJlbnQgbGlzdCBpdGVtIGlzIHN0aWxsIGVtcHR5IChvbmx5IGApYCwgYDtgLCBgJmAsIGFuZCBuZXdsaW5lcyByZXNldCBpdCkuICovXG4gIGNtZEVtcHR5OiBib29sZWFuO1xuICAvKiogVGhlIHJlZ2lvbidzIG93biBwYXJlbiBkZXB0aCBcdTIwMTQgZ2xvYmFsIHBhcmVuIGRlcHRoIGlzIGZyb3plbiB3aGlsZSB0aGUgcmVnaW9uIGlzIG9wZW4gKHRoZSByZWdpb24gaXMgbm90IGEgc3RhY2s7IGl0IG91dGxpdmVzIHBhcmVuIGNsb3NlcykuICovXG4gIGxvY2FsRGVwdGg6IG51bWJlcjtcbn1cblxuLyoqIEEgcGVuZGluZyBoZXJlZG9jIHdob3NlIGJvZHkgaGFzIG5vdCBzdGFydGVkIHlldCAob3Igd2hvc2UgYm9keSBpcyBiZWluZyBzY2FubmVkKS4gKi9cbmludGVyZmFjZSBQZW5kaW5nSGVyZWRvYyB7XG4gIC8qKiBUaGUgbGluZSB0aGF0IGNsb3NlcyB0aGUgYm9keTogdGhlIGRlbGltaXRlciwgb3B0aW9uYWxseSBgXFx0YC1wcmVmaXhlZCBmb3IgYDw8LWAsIHdpdGggb3B0aW9uYWwgdHJhaWxpbmcgd2hpdGVzcGFjZS4gKi9cbiAgY2xvc2U6IFJlZ0V4cDtcbn1cblxuLyoqIFRoZSB3b3JkcyB0aGF0IHB1dCB0aGUgcGFyc2VyIGJhY2sgYXQgY29tbWFuZCBzdGFydCB3aGVuIHRoZXkgYXJlIHRoZSBidWZmZXIncyBsYXN0IHdvcmQgKHBsYW4gXHUwMEE3MykuICovXG5jb25zdCBDT01NQU5EX09QRU5FUl9XT1JEUyA9IG5ldyBTZXQoWydkbycsICd0aGVuJywgJ2Vsc2UnLCAnZWxpZicsICdpZicsICd3aGlsZScsICd1bnRpbCcsICchJywgJ3RpbWUnLCAneycsICcoJ10pO1xuXG4vKiogV29yZCBjaGFycyBlbmQgYXQgd2hpdGVzcGFjZSBhbmQgdGhlIG9wZXJhdG9yL3BhcmVuL3JlZGlyZWN0IG1ldGFjaGFycy4gKi9cbmNvbnN0IFdPUkRfRU5EID0gL1tcXHM7JnwoKTw+XS87XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xufVxuXG4vKipcbiAqIFNwbGl0IGEgY29tbWFuZCBzdHJpbmcgaW50byBzaW1wbGUtY29tbWFuZCBzdWJzdHJpbmdzIGF0IHRvcC1sZXZlbCAmJiwgfHwsXG4gKiA7LCB8LCB8JiwgJiwgYW5kIG5ld2xpbmUgYm91bmRhcmllcy4gUXVvdGVzIGFuZCAkKCkvYGAvKCkgbmVzdGluZyBhcmVcbiAqIHJlc3BlY3RlZCAobm90IHNwbGl0IGluc2lkZSk7IGAjYCBjb21tZW50cyBhbmQgYCR7XHUyMDI2fWAgYnJhY2UgY29udGVudCBhcmVcbiAqIG9wYXF1ZSwgcGlwZS9hbmQvb3IgbmV3bGluZXMgYXJlIGxpbmUgY29udGludWF0aW9ucywgYW5kIEJhc2ggcGFyc2UgZXJyb3JzXG4gKiAocGxhbiBcdTAwQTcxKSBjb21lIGJhY2sgYXMgYSBgbWFsZm9ybWVkYCB2ZXJkaWN0IHdpdGggdGhlIHN0YWdlIGxpc3QgdHJ1bmNhdGVkXG4gKiBhdCB0aGUgcmVqZWN0aW5nIGxpc3QuXG4gKlxuICogUGhhc2UgMiAocGxhbiBcdTAwQTczKSBhZGRzIHRocmVlIG1hY2hpbmVzOlxuICpcbiAqIC0gVGhlIGtpbmQtbWF0Y2hlZCBjb25zdHJ1Y3Qgc3RhY2s6IGBpZmAvYHdoaWxlYC9gdW50aWxgL2Bmb3JgL2BzZWxlY3RgL1xuICogICBge2AvYH1gL2BmdW5jdGlvbmAgb3BlbiBjb25zdHJ1Y3QgZnJhbWVzIGF0IGNvbW1hbmQgcG9zaXRpb24sIGNvbnRleHRcbiAqICAga2V5d29yZHMgKGBkb2AsIGB0aGVuYCwgYGVsc2VgLCBgZWxpZmAsIGBpbmApIGFuZCBjbG9zZXJzIChgZmlgLCBgZG9uZWAsXG4gKiAgIGBlc2FjYCwgYH1gKSByZXF1aXJlIGEgbWF0Y2hpbmcgb3BlbmVyIG9uIHRvcCBvZiB0aGUgc3RhY2sgKHdpdGggdGhlXG4gKiAgIHJpZ2h0IGJvZHkgc3RhdGUpLCBhbmQgd2hpbGUgYSBjb25zdHJ1Y3QgaXMgb3BlbiBhdCBkZXB0aCAwIHRoZSBib3VuZGFyeVxuICogICBvcGVyYXRvcnMgYXJlIHRleHQgXHUyMDE0IHRoZSBjb25zdHJ1Y3QgZm9sZHMgdG8gb25lIHN0YWdlLiBFYWNoIGAoYCBwdXNoZXMgYVxuICogICBmcmVzaCBzdGFjayBhbmQgZWFjaCBgKWAgZmlyZXMgJ3VuY2xvc2VkLWNvbnN0cnVjdCcgd2hlbiBpdHMgbGV2ZWwgaXNcbiAqICAgbm9uLWVtcHR5IChmaXJlLWJlZm9yZS1yZXN0b3JlKS5cbiAqXG4gKiAtIFRoZSBjYXNlLXJlZ2lvbiBtYWNoaW5lOiBgY2FzZWAgaW4gY29tbWFuZCBwb3NpdGlvbiBvcGVucyBhIHJlZ2lvbiBjbG9zZWRcbiAqICAgYnkgYSBtYXRjaGluZyBgZXNhY2AuIFRoZSByZWdpb24ncyBjb250ZW50IGlzIG9wYXF1ZSBcdTIwMTQgcGF0dGVybiBgKWBzIGFuZFxuICogICBgfGBzIGFyZSBwYXR0ZXJuIHN5bnRheCwgbm90IHBhcmVucy9waXBlcyBcdTIwMTQgd2l0aCBpdHMgb3duIHBhcmVuIGRlcHRoXG4gKiAgICh0aGUgZ2xvYmFsIGRlcHRoIGZyZWV6ZXMgd2hpbGUgb3BlbiksIGA7O2AvYDsmYC9gOzsmYCByZXR1cm5pbmcgdG9cbiAqICAgcGF0dGVybi1zdGFydCBhbmQgYClgLCBgO2AsIGAmYCwgYW5kIG5ld2xpbmVzIHRvIGNvbW1hbmQgc3RhcnQuIEEgcmVnaW9uXG4gKiAgIG9wZW4gYXQgRU9GIGlzICd1bmNsb3NlZC1jYXNlJy5cbiAqXG4gKiAtIFRoZSBoZXJlZG9jIG1hY2hpbmVyeTogYDw8YC9gPDwtYCBhdCBkZXB0aCAwIHdpdGggYSBkZWxpbWl0ZXIgd29yZCBzdHJpcHNcbiAqICAgdGhlIG9wZXJhdG9yK2RlbGltaXRlciBmcm9tIHRoZSBzdGFnZSB0ZXh0IGFuZCBzY2FucyBib2R5IGxpbmVzIHJhdyB1bnRpbFxuICogICB0aGUgZGVsaW1pdGVyIGxpbmU7IGFuIHVudGVybWluYXRlZCBoZXJlZG9jIGlzIHRoZSAndW50ZXJtaW5hdGVkLWhlcmVkb2MnXG4gKiAgIHBhcnRpYWwgXHUyMDE0IHRoZSBkZWxpbWl0ZXIncyBsaW5lIChhbmQgZXZlcnl0aGluZyBiZWZvcmUgaXQpIGFuYWx5emVzXG4gKiAgIG5vcm1hbGx5IGFuZCB0aGUgYm9keSBwcm9kdWNlcyBubyBzdGFnZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU3BsaXRSZXN1bHQge1xuICBjb25zdCBwYXJ0czogU2ltcGxlQ29tbWFuZFtdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gY21kLmxlbmd0aDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGJyYWNlRGVwdGggPSAwO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBwZW5kaW5nT3A6IE9wZXJhdG9yID0gJ3N0YXJ0JztcbiAgLyoqIFNldCB3aGVuIHRoZSBjdXJyZW50IGxpc3QgaXMgYSBCYXNoIHBhcnNlIGVycm9yOyB0aGUgc2NhbiBzdG9wcyBhdCBpdCAocGxhbiBcdTAwQTcxLCBsaXN0LXNjb3BlICsgdGVybWluYWwpLiAqL1xuICBsZXQgbWFsZm9ybWVkOiBNYWxmb3JtZWRWZXJkaWN0IHwgdW5kZWZpbmVkO1xuICAvKiogSW5kZXggaW50byBgcGFydHNgIHdoZXJlIHRoZSBjdXJyZW50IGxpc3QgYmVnYW4gXHUyMDE0IHRoZSByZWplY3RpbmcgbGlzdCdzIHN0YWdlcyBhcmUgZHJvcHBlZCBieSByb2xsaW5nIGJhY2sgdG8gaXQuICovXG4gIGxldCBsaXN0U3RhcnQgPSAwO1xuXG4gIC8qKiBSZXBvcnQgYSBtYWxmb3JtZWQgbGlzdDogZHJvcCBpdHMgc3RhZ2VzIChjb21wbGV0ZWQgZWFybGllciBsaXN0cyBzdGF5KSwgYW5kIHN0b3AgdGhlIHNjYW4gXHUyMDE0IGJhc2ggYWJvcnRzIGF0IHRoZSBmaXJzdCBwYXJzZSBlcnJvci4gKi9cbiAgY29uc3QgcmVqZWN0ID0gKHY6IE1hbGZvcm1lZFZlcmRpY3QpID0+IHtcbiAgICBtYWxmb3JtZWQgPSB2O1xuICAgIHBhcnRzLmxlbmd0aCA9IGxpc3RTdGFydDtcbiAgICBpID0gbjtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciBhIHBpcGUvYW5kL29yIG9wZXJhdG9yIGlzIHBlbmRpbmcgd2l0aCBhIHdoaXRlc3BhY2Utb25seSBidWZmZXJcbiAgICogc2luY2UgaXQuIEEgaGVscGVyIHJhdGhlciB0aGFuIGFuIGlubGluZSBjb21wYXJpc29uOiBUeXBlU2NyaXB0J3NcbiAgICogY29udHJvbC1mbG93IG5hcnJvd2luZyBjYW5ub3Qgc2VlIHRoZSBhc3NpZ25tZW50cyBgZmx1c2hgIG1ha2VzIHRvXG4gICAqIGBwZW5kaW5nT3BgIGZyb20gaW5zaWRlIGl0cyBjbG9zdXJlLCBhbmQgd291bGQgb3RoZXJ3aXNlIG5hcnJvdyB0aGVcbiAgICogZGlyZWN0IGNvbXBhcmlzb24gdG8gdGhlIGluaXRpYWxpemVyIGAnc3RhcnQnYC5cbiAgICovXG4gIGNvbnN0IGlzVW5jb25zdW1lZE9wZXJhdG9yID0gKCk6IGJvb2xlYW4gPT5cbiAgICAocGVuZGluZ09wID09PSAncGlwZScgfHwgcGVuZGluZ09wID09PSAnYW5kJyB8fCBwZW5kaW5nT3AgPT09ICdvcicpICYmIGJ1Zi50cmltKCkgPT09ICcnO1xuXG4gIC8qKiBUaGUgYnVmZmVyJ3MgbGFzdCB3aGl0ZXNwYWNlLWRlbGltaXRlZCB3b3JkICgnJyB3aGVuIHRoZSBidWZmZXIgaXMgZW1wdHkpLiAqL1xuICBjb25zdCBsYXN0V29yZCA9ICgpOiBzdHJpbmcgPT4gYnVmLnRyaW1FbmQoKS5tYXRjaCgvXFxTKyQvKT8uWzBdID8/ICcnO1xuXG4gIC8qKlxuICAgKiBSZWRpcmVjdCBvcGVyYXRvcnMgdGhhdCBhcmUgbWlzc2luZyB0aGVpciB0YXJnZXQgd29yZCB3aGVuIHRoZXkgYXJlIHRoZVxuICAgKiBidWZmZXIncyBsYXN0IHdvcmQgKHBsYW4gXHUwMEE3MSk6IGEgdGFyZ2V0IG11c3QgYmUgYSBwbGFpbiB3b3JkLCBzbyBldmVyeVxuICAgKiBub24tc2VsZi1jb21wbGV0ZSBmb3JtIGlzIGEgcGFyc2UgZXJyb3IuIER1cCBmb3JtcyB3aXRoIGJvdGggZmRzIHByZXNlbnRcbiAgICogKGAyPiYxYCwgYD4mLWAsIGAzPCYwYCkgYW5kIGZ1c2VkIHdvcmRzIChgPm91dGAsIGAyPmVycmAsIGA8PEVPRmAsXG4gICAqIGAmPm91dGApIGFyZSBjb21wbGV0ZSBhbmQgbmV2ZXIgbWF0Y2guXG4gICAqL1xuICBjb25zdCBEQU5HTElOR19SRURJUkVDVF9XT1JEID0gL14oPzo+fD4+fCY+fCY+Pnw+XFx8fDx8PD58PDx8PDwtfDw8PHw+JnxcXGQrKD86Pnw+Pnw+XFx8fDx8PD58PDx8PDwtfDw8PHw+Jnw8JikpJC87XG5cbiAgY29uc3QgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QgPSAoKTogYm9vbGVhbiA9PiBEQU5HTElOR19SRURJUkVDVF9XT1JELnRlc3QobGFzdFdvcmQoKSk7XG5cbiAgLyoqIFdoZXRoZXIgdGhlIGN1cnJlbnQgY2hhciBzdGFydHMgYSBuZXcgd29yZCBpbiB0aGUgYnVmZmVyIChlbXB0eSBidWZmZXIsIG9yIHByZWNlZGVkIGJ5IHdoaXRlc3BhY2UpLiAqL1xuICBjb25zdCBpc1dvcmRTdGFydCA9ICgpOiBib29sZWFuID0+IGJ1ZiA9PT0gJycgfHwgL1xccyQvLnRlc3QoYnVmKTtcblxuICAvKiogV2hldGhlciBhIHJlZGlyZWN0IHRva2VuIGJlZ2lucyBhdCBgaWA6IGEgYD5gL2A8YCBmb3JtLCBgJj5gLCBvciBhIGRpZ2l0LXByZWZpeGVkIGZvcm0gbGlrZSBgMj5gL2AyPiYxYC4gKi9cbiAgY29uc3Qgc3RhcnRzUmVkaXJlY3RBdCA9IChpOiBudW1iZXIpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChjID09PSAnPicgfHwgYyA9PT0gJzwnKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoYyA9PT0gJyYnKSByZXR1cm4gY21kW2kgKyAxXSA9PT0gJz4nO1xuICAgIGlmIChjID49ICcwJyAmJiBjIDw9ICc5Jykge1xuICAgICAgbGV0IGogPSBpO1xuICAgICAgd2hpbGUgKGogPCBuICYmIGNtZFtqXSA+PSAnMCcgJiYgY21kW2pdIDw9ICc5JykgaiArPSAxO1xuICAgICAgcmV0dXJuIGNtZFtqXSA9PT0gJz4nIHx8IGNtZFtqXSA9PT0gJzwnO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBuZXcgY29tbWFuZCBjYW4gc3RhcnQgaGVyZTogdGhlIGJ1ZmZlciBpcyBlbXB0eSwgYSBib3VuZGFyeVxuICAgKiBvcGVyYXRvciBvciBgKGAvYClgIHByZWNlZGVzLCB0aGUgYnVmZmVyIGVuZHMgd2l0aCBhIG5ld2xpbmUgKGEgbmV3bGluZVxuICAgKiBpbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgaXMgdGV4dCBidXQgc3RpbGwgZW5kcyB0aGUgbGlzdCBpdGVtKSwgb3IgdGhlXG4gICAqIGxhc3Qgd29yZCBleHBlY3RzIGEgY29tbWFuZCBib2R5IChgdGhlbmAsIGBkb2AsIGB7YCwgXHUyMDI2KS5cbiAgICovXG4gIGNvbnN0IGlzQ29tbWFuZFBvc2l0aW9uID0gKCk6IGJvb2xlYW4gPT5cbiAgICBidWYudHJpbSgpID09PSAnJyB8fCAvXFxuJC8udGVzdChidWYpIHx8IC9bOyZ8KCldJC8udGVzdChidWYudHJpbUVuZCgpKSB8fCBDT01NQU5EX09QRU5FUl9XT1JEUy5oYXMobGFzdFdvcmQoKSk7XG5cbiAgY29uc3QgZmx1c2ggPSAobmV4dE9wOiBPcGVyYXRvcikgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSB7XG4gICAgICAvLyBgIWAgaW4gcGlwZSBwb3NpdGlvbiBpcyBhIHBhcnNlIGVycm9yIChwbGFuIFx1MDBBNzEpOiB0aGUgZmlyc3Qgd29yZCBvZiBhXG4gICAgICAvLyBwaXBlLXByZWNlZGVkIHN0YWdlIG1heSBub3QgYmUgYCFgIChgZmFsc2UgfCAhIHRydWVgLCBgY2F0IGYgfFxcbiEgdHJ1ZWApLlxuICAgICAgaWYgKHBlbmRpbmdPcCA9PT0gJ3BpcGUnICYmIChzID09PSAnIScgfHwgL14hXFxzLy50ZXN0KHMpKSkge1xuICAgICAgICByZWplY3QoJ3BpcGUtYmFuZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wIH0pO1xuICAgIH1cbiAgICBidWYgPSAnJztcbiAgICBwZW5kaW5nT3AgPSBuZXh0T3A7XG4gIH07XG5cbiAgLy8gVGhlIGtpbmQtbWF0Y2hlZCBjb25zdHJ1Y3Qgc3RhY2ssIG9uZSBsaXN0IHBlciBwYXJlbiBsZXZlbDogYChgIHB1c2hlcyBhXG4gIC8vIGZyZXNoIGxldmVsLCBgKWAgcG9wcyBpdCBhbmQgZmlyZXMgd2hlbiBpdCBpcyBub24tZW1wdHkgXHUyMDE0IGFuIHVuY2xvc2VkXG4gIC8vIGNvbnN0cnVjdCBjYW5ub3Qgb3V0bGl2ZSB0aGUgc3Vic2hlbGwgdGhhdCBjbG9zZWQgKHBsYW4gXHUwMEE3MykuXG4gIGNvbnN0IGxldmVsczogT3BlbkNvbnN0cnVjdFtdW10gPSBbW11dO1xuICBjb25zdCB0b3AgPSAoKTogT3BlbkNvbnN0cnVjdCB8IHVuZGVmaW5lZCA9PiB7XG4gICAgY29uc3QgbHYgPSBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdO1xuICAgIHJldHVybiBsdi5sZW5ndGggPiAwID8gbHZbbHYubGVuZ3RoIC0gMV0gOiB1bmRlZmluZWQ7XG4gIH07XG4gIC8qKiBTZXQgYnkgb3BlbmVycyBhbmQgYm9keSBrZXl3b3JkcywgY2xlYXJlZCBieSBvdGhlciB3b3JkcyBhbmQgYChgIFx1MjAxNCBhbiBvcGVyYXRvciBvciBjbG9zZXIgZGlyZWN0bHkgYWZ0ZXIgaXQgaXMgYW4gZW1wdHktbGlzdCBwYXJzZSBlcnJvciAoYGlmIHRydWU7IHRoZW47IGZpYCwgYHsgOyB9YCkuICovXG4gIGxldCBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgLyoqIGBmdW5jdGlvbmAgc2VlbjsgdGhlIG5leHQgd29yZCBpcyB0aGUgZnVuY3Rpb24gbmFtZSwgYW5kIGB7YCByaWdodCBhZnRlciBpdCBvcGVucyB0aGUgZGVmaW5pdGlvbiBib2R5LiAqL1xuICBsZXQgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gIGxldCBuYW1lU2VlbiA9IGZhbHNlO1xuXG4gIC8vIFRoZSBvcGVuIGNhc2UgcmVnaW9uLCBpZiBhbnkgKHBsYW4gXHUwMEE3MykuIFdoaWxlIG9wZW4sIGl0cyBjb250ZW50IGlzIG9wYXF1ZVxuICAvLyB0byBldmVyeSBvdGhlciBtYWNoaW5lOiB0aGUgZ2xvYmFsIHBhcmVuIGRlcHRoIGlzIGZyb3plbiwgdGhlIGNvbnN0cnVjdFxuICAvLyBzdGFjayBpcyB1bnRvdWNoZWQsIGFuZCBib3VuZGFyeSBvcGVyYXRvcnMgYXJlIHRleHQuXG4gIGxldCBjYXNlUmVnaW9uOiBDYXNlUmVnaW9uIHwgbnVsbCA9IG51bGw7XG5cbiAgLy8gUGVuZGluZyBoZXJlZG9jcyAocGxhbiBcdTAwQTczKTogYDw8YC9gPDwtYCBhdCBkZXB0aCAwIHdpdGggYSBkZWxpbWl0ZXIgd29yZC5cbiAgY29uc3QgaGVyZWRvY3M6IFBlbmRpbmdIZXJlZG9jW10gPSBbXTtcbiAgLyoqIEluIHRoZSBib2R5IG9mIGEgcGVuZGluZyBoZXJlZG9jIFx1MjAxNCBsaW5lcyBhcmUgc2Nhbm5lZCByYXcgZm9yIHRoZSBjbG9zZSBsaW5lLiAqL1xuICBsZXQgaW5Cb2R5ID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBidWYgKz0gY21kW2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBidWYgKz0gYyArIGNtZFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gYCR7XHUyMDI2fWAgY29udGVudCBpcyBvcGFxdWUgKHBsYW4gXHUwMEE3MSk6IG5lc3RlZCBleHBhbnNpb25zIG5lc3QsIGFuZCB3aGlsZVxuICAgIC8vIHRoZSBicmFjZSBkZXB0aCBpcyBwb3NpdGl2ZSBub3RoaW5nIGluc2lkZSBjb3VudHMgcGFyZW5zLCBzcGxpdHNcbiAgICAvLyBvcGVyYXRvcnMsIHN0YXJ0cyBjb21tZW50cywgb3IgcmVjb2duaXplcyBjb25zdHJ1Y3RzIFx1MjAxNCBgJHt4JSl9YCxcbiAgICAvLyBgJHt4Ly8oL31gLCBhbmQgYCR7eDotJChlY2hvIHkpfWAgYXJlIGFsbCB2YWxpZC5cbiAgICBpZiAoYnJhY2VEZXB0aCA+IDApIHtcbiAgICAgIGlmIChjID09PSAnfScpIGJyYWNlRGVwdGggLT0gMTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEhlcmVkb2MgYm9keSBtb2RlOiBzY2FuIGxpbmVzIHJhdyB1bnRpbCB0aGUgZmlyc3QgcGVuZGluZyBoZXJlZG9jJ3NcbiAgICAvLyBjbG9zZSBsaW5lIChhIGxpbmUgdGhhdCBpcyBleGFjdGx5IHRoZSBkZWxpbWl0ZXIsIG9wdGlvbmFsbHkgdGFiLVxuICAgIC8vIHByZWZpeGVkIGZvciBgPDwtYCwgd2l0aCBvcHRpb25hbCB0cmFpbGluZyB3aGl0ZXNwYWNlKS4gVGhlIGJvZHkgaXNcbiAgICAvLyBvcGFxdWUgXHUyMDE0IGl0IHByb2R1Y2VzIG5vIHN0YWdlcyBcdTIwMTQgYW5kIHVudGVybWluYXRlZCBib2RpZXMgZW5kIGF0IEVPRi5cbiAgICBpZiAoaW5Cb2R5KSB7XG4gICAgICBjb25zdCBsaW5lRW5kID0gY21kLmluZGV4T2YoJ1xcbicsIGkpO1xuICAgICAgY29uc3QgbGluZSA9IGxpbmVFbmQgPT09IC0xID8gY21kLnNsaWNlKGkpIDogY21kLnNsaWNlKGksIGxpbmVFbmQpO1xuICAgICAgaWYgKGhlcmVkb2NzWzBdLmNsb3NlLnRlc3QobGluZSkpIHtcbiAgICAgICAgaGVyZWRvY3Muc2hpZnQoKTtcbiAgICAgICAgaWYgKGhlcmVkb2NzLmxlbmd0aCA9PT0gMCkgaW5Cb2R5ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwIHx8IGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICAgICAgLy8gSW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IHRoZSBib2R5IGxpbmUgZm9sZHMgaW50byB0aGUgY29uc3RydWN0J3NcbiAgICAgICAgLy8gaW50ZXJpb3IgdGV4dCAoYSBuZXdsaW5lIGluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCBpcyBub3QgYVxuICAgICAgICAvLyBib3VuZGFyeSwgcGxhbiBcdTAwQTcxKSBcdTIwMTQgdGhlIGludGVyaW9yIHJlLXNwbGl0IHJlLXNjYW5zIGl0IGFzIGJvZHkuXG4gICAgICAgIGJ1ZiArPSBsaW5lO1xuICAgICAgICBpZiAobGluZUVuZCAhPT0gLTEpIGJ1ZiArPSAnXFxuJztcbiAgICAgIH1cbiAgICAgIGkgPSBsaW5lRW5kID09PSAtMSA/IG4gOiBsaW5lRW5kICsgMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUaGUgbmV3bGluZSByaWdodCBhZnRlciBhIGhlcmVkb2MncyBkZWxpbWl0ZXIgbGluZSBlbmRzIHRoZSBkZWxpbWl0ZXInc1xuICAgIC8vIGxpbmUgXHUyMDE0IGl0IHNwbGl0cyBub3JtYWxseSAoYSBjb21wbGV0ZWQgbGlzdCwgYnV0IHdpdGhvdXQgYWR2YW5jaW5nXG4gICAgLy8gYGxpc3RTdGFydGA6IGEgY29tcGxldGVuZXNzIHZpb2xhdGlvbiB0aGF0IHJlamVjdHMgbGF0ZXIgZHJvcHMgdGhlXG4gICAgLy8gZGVsaW1pdGVyJ3MtbGluZSBzdGFnZSB0b28pIFx1MjAxNCBhbmQgc3RhcnRzIHRoZSBib2R5LiBJbnNpZGUgYW4gb3BlblxuICAgIC8vIGNvbnN0cnVjdCB0aGUgbmV3bGluZSBpcyBub3QgYSBib3VuZGFyeTogdGhlIGRlbGltaXRlcidzIGxpbmUsIHRoZVxuICAgIC8vIGJvZHksIGFuZCB0aGUgY2xvc2UgbGluZSBhbGwgZm9sZCBpbnRvIHRoZSBjb25zdHJ1Y3QncyBvbmUgc3RhZ2UsIGFuZFxuICAgIC8vIHRoZSB3YWxrJ3MgaW50ZXJpb3IgcmUtc3BsaXQgYXBwbGllcyB0aGUgc2FtZSBoZXJlZG9jIG1hY2hpbmVyeSB0aGVyZS5cbiAgICBpZiAoYyA9PT0gJ1xcbicgJiYgaGVyZWRvY3MubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICBpbkJvZHkgPSB0cnVlO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICAgIGluQm9keSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gYCNgIGJlZ2lucyBhIGNvbW1lbnQgd2hlbiBpdCBzdGFydHMgYSB3b3JkIGF0IGRlcHRoIDAgKGVtcHR5IGJ1ZmZlciBvclxuICAgIC8vIHByZWNlZGVkIGJ5IHdoaXRlc3BhY2UpOyBjb21tZW50cyBydW4gdG8gdGhlIG5ld2xpbmUsIGtlZXBpbmcgdGhlIGJ1ZmZlclxuICAgIC8vIGVtcHR5IGZvciB0aGUgY29udGludWF0aW9uIHJ1bGUuIE1pZC13b3JkIGFuZCBxdW90ZWQgYCNgIGFyZSB0ZXh0LCBhbmRcbiAgICAvLyBjb21tZW50cyBpbnNpZGUgcGFyZW5zIGFyZSBvcGFxdWUgbGlrZSBldmVyeXRoaW5nIGVsc2UgdGhlcmUgKHBsYW4gXHUwMEE3MSkuXG4gICAgaWYgKGMgPT09ICcjJyAmJiBkZXB0aCA9PT0gMCAmJiBpc1dvcmRTdGFydCgpKSB7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgY21kW2ldICE9PSAnXFxuJykgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRoZSBjYXNlLXJlZ2lvbiBzY2FuIG93bnMgZXZlcnl0aGluZyBhdCBpdHMgbG9jYWwgZGVwdGggMCBcdTIwMTQgcGF0dGVyblxuICAgIC8vIHN5bnRheCwgbGlzdCB0ZXJtaW5hdG9ycywgYW5kIHdvcmRzIFx1MjAxNCB3aGlsZSB0aGUgcmVnaW9uIGlzIG9wZW4uXG4gICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgIGNvbnN0IHIgPSBjYXNlUmVnaW9uO1xuICAgICAgaWYgKHIubG9jYWxEZXB0aCA9PT0gMCkge1xuICAgICAgICBjb25zdCBzMiA9IGNtZC5zbGljZShpLCBpICsgMik7XG4gICAgICAgIGNvbnN0IHMzID0gY21kLnNsaWNlKGksIGkgKyAzKTtcbiAgICAgICAgLy8gYDs7YC9gOyZgL2A7OyZgIGVuZCB0aGUgY3VycmVudCBwYXR0ZXJuIGxpc3QgXHUyMDE0IGJhY2sgdG8gcGF0dGVybi1zdGFydC5cbiAgICAgICAgaWYgKHMzID09PSAnOzsmJyB8fCBzMiA9PT0gJzs7JyB8fCBzMiA9PT0gJzsmJykge1xuICAgICAgICAgIHIucG9zID0gJ3BhdHRlcm4tc3RhcnQnO1xuICAgICAgICAgIGJ1ZiArPSBzMyA9PT0gJzs7JicgPyBzMyA6IHMyO1xuICAgICAgICAgIGkgKz0gczMgPT09ICc7OyYnID8gMyA6IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYDtgIHJldHVybnMgdG8gY29tbWFuZCBzdGFydCAoYSBgOztgIHdhcyBoYW5kbGVkIGFib3ZlKS5cbiAgICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICAgIHIucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBBIHNpbmdsZSBgJmAgKG5vdCBwYXJ0IG9mIGEgcmVkaXJlY3Qgb3IgYCYmYCkgaXMgdGhlIGJhY2tncm91bmRcbiAgICAgICAgLy8gb3BlcmF0b3IgXHUyMDE0IGFsc28gY29tbWFuZCBzdGFydC5cbiAgICAgICAgY29uc3QgbGFzdCA9IGJ1ZltidWYubGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChjID09PSAnJicgJiYgY21kW2kgKyAxXSAhPT0gJz4nICYmIGNtZFtpICsgMV0gIT09ICcmJyAmJiBsYXN0ICE9PSAnPicgJiYgbGFzdCAhPT0gJzwnKSB7XG4gICAgICAgICAgci5wb3MgPSAnY29tbWFuZCc7XG4gICAgICAgICAgci5jbWRFbXB0eSA9IHRydWU7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAgIC8vIEEgcGF0dGVybiBjYW5ub3QgY29udGludWUgYWNyb3NzIGEgbmV3bGluZSAoYmFzaCBlcnJvcnMpLCBidXQgYVxuICAgICAgICAgIC8vIG5ld2xpbmUgYWZ0ZXIgYGluYCBvciBpbnNpZGUgYSBsaXN0IGl0ZW0gaXMgZmluZS5cbiAgICAgICAgICBpZiAoci5wb3MgPT09ICdwYXR0ZXJuJykge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jYXNlJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHIucG9zID09PSAnY29tbWFuZCcpIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJyMnICYmIGlzV29yZFN0YXJ0KCkpIHtcbiAgICAgICAgICAvLyBBIGNvbW1lbnQgaW5zaWRlIHRoZSByZWdpb24gcnVucyB0byB0aGUgbmV3bGluZSBsaWtlIG91dHNpZGUuXG4gICAgICAgICAgd2hpbGUgKGkgPCBuICYmIGNtZFtpXSAhPT0gJ1xcbicpIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNXb3JkU3RhcnQoKSAmJiAhV09SRF9FTkQudGVzdChjKSkge1xuICAgICAgICAgIGxldCBqID0gaTtcbiAgICAgICAgICB3aGlsZSAoaiA8IG4gJiYgIVdPUkRfRU5ELnRlc3QoY21kW2pdKSkgaiArPSAxO1xuICAgICAgICAgIGNvbnN0IHcgPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICAgICAgLy8gYGVzYWNgIGNsb3NlcyBhdCBhIHBhdHRlcm4tbGlzdCBzdGFydCBvciBhdCB0aGUgc3RhcnQgb2YgYSBsaXN0XG4gICAgICAgICAgLy8gaXRlbTsgZWxzZXdoZXJlIGl0IGlzIGFuIG9yZGluYXJ5IHdvcmQgKGBlY2hvIGVzYWNgLCBgYXxlc2FjKWApLFxuICAgICAgICAgIC8vIGFzIGlzIGBjYXNlYCBpbiB0aGUgc3ViamVjdCAoYGNhc2UgZXNhYyBpbiBcdTIwMjZgKS5cbiAgICAgICAgICBpZiAodyA9PT0gJ2VzYWMnICYmIChyLnBvcyA9PT0gJ3BhdHRlcm4tc3RhcnQnIHx8IChyLnBvcyA9PT0gJ2NvbW1hbmQnICYmIHIuY21kRW1wdHkpKSkge1xuICAgICAgICAgICAgY2FzZVJlZ2lvbiA9IG51bGw7XG4gICAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpbicgJiYgci5wb3MgPT09ICdzdWJqZWN0Jykge1xuICAgICAgICAgICAgci5wb3MgPSAncGF0dGVybi1zdGFydCc7XG4gICAgICAgICAgfSBlbHNlIGlmIChyLnBvcyA9PT0gJ3BhdHRlcm4tc3RhcnQnKSB7XG4gICAgICAgICAgICByLnBvcyA9ICdwYXR0ZXJuJztcbiAgICAgICAgICB9IGVsc2UgaWYgKHIucG9zID09PSAnY29tbWFuZCcpIHtcbiAgICAgICAgICAgIHIuY21kRW1wdHkgPSBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnVmICs9IHc7XG4gICAgICAgICAgaSA9IGo7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIExvY2FsIGRlcHRoID4gMCBvciBub24td29yZCBjaGFycyBmYWxsIHRocm91Z2ggdG8gdGhlIHBhcmVuIGJyYW5jaGVzXG4gICAgICAvLyBhbmQgdGhlIGdlbmVyaWMgYnVmZmVyLlxuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBpZiAoY2FzZVJlZ2lvbikge1xuICAgICAgICBjYXNlUmVnaW9uLmxvY2FsRGVwdGggKz0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEEgc3Vic2hlbGwgc3RhcnRzIGEgY29tbWFuZCBcdTIwMTQgYGlmIHRydWU7IHRoZW4gKCBlY2hvIGhpICk7IGZpYCBpc1xuICAgICAgICAvLyB2YWxpZCB3aGlsZSBgaWYgdHJ1ZTsgdGhlbjsgZmlgIGlzIG5vdDsgdGhlIHNhbWUgc3Vic2hlbGwgY291bnRzIGFzXG4gICAgICAgIC8vIGEgYm9keSB3b3JkIGZvciBhbiBlbmNsb3NpbmcgYnJhY2UgZ3JvdXAgKGB7ICggZWNobyBoaSApOyB9YCkuXG4gICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgaWYgKHQ/LmtpbmQgPT09ICdicmFjZScpIHQuYm9keSA9IHRydWU7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIGxldmVscy5wdXNoKFtdKTtcbiAgICAgIH1cbiAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgICAgLy8gQXQgbG9jYWwgZGVwdGggMCBhIGApYCBpcyB0aGUgcGF0dGVybiB0ZXJtaW5hdG9yIChvciB0aGUgZW5kIG9mIGFcbiAgICAgICAgLy8gbGlzdCBpdGVtKSBcdTIwMTQgdGhlIHJlZ2lvbiBvd25zIGl0IGFuZCB0aGUgZ2xvYmFsIGRlcHRoIHN0YXlzIGZyb3plbi5cbiAgICAgICAgaWYgKGNhc2VSZWdpb24ubG9jYWxEZXB0aCA9PT0gMCkge1xuICAgICAgICAgIGNhc2VSZWdpb24ucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIGNhc2VSZWdpb24uY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhc2VSZWdpb24ubG9jYWxEZXB0aCAtPSAxO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBIHN0cmF5IGApYCBhdCBkZXB0aCAwIChhbmQgYnJhY2UgZGVwdGggMCwgb3V0c2lkZSBxdW90ZXMpIGlzIGEgcGFyc2VcbiAgICAgICAgLy8gZXJyb3IgXHUyMDE0IGBlY2hvIHgpICYmIFx1MjAyNmAgKHBsYW4gXHUwMEE3MSkuIGApYCBpbnNpZGUgcXVvdGVzLCBgJHtcdTIwMjZ9YCwgYW5kXG4gICAgICAgIC8vIGhlcmVkb2MgYm9kaWVzIG5ldmVyIHJlYWNoZXMgdGhpcyBicmFuY2guXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgIHJlamVjdCgndW5iYWxhbmNlZC1wYXJlbicpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZpcmUtYmVmb3JlLXJlc3RvcmU6IGFuIHVuY2xvc2VkIGNvbnN0cnVjdCBvbiB0aGUgY2xvc2luZyBsZXZlbFxuICAgICAgICAvLyBjYW5ub3Qgb3V0bGl2ZSB0aGUgc3Vic2hlbGwgKHBsYW4gXHUwMEE3MykuXG4gICAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICAgIGxldmVscy5wb3AoKTtcbiAgICAgIH1cbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIENvbnN0cnVjdCBrZXl3b3JkcyBhbmQgdGhlIGNhc2UtcmVnaW9uIG9wZW5lcjogcmVjb2duaXplZCBhdCB3b3JkXG4gICAgLy8gc3RhcnRzIGF0IGFueSBwYXJlbiBkZXB0aCAoY29uc3RydWN0cyB0cmFjayB0aHJvdWdoIHN1YnNoZWxscyksIG91dHNpZGVcbiAgICAvLyBxdW90ZXMsICR7XHUyMDI2fSwgaGVyZWRvYyBib2RpZXMsIGFuZCBvcGVuIGNhc2UgcmVnaW9ucyAodGhlIHJlZ2lvbiBzY2FuXG4gICAgLy8gYWJvdmUgb3ducyB0aG9zZSB3b3JkcykuIFdvcmQtZW5kIGNoYXJzIChgO2AsIGAmYCwgYHxgLCBgPGAsIGA+YClcbiAgICAvLyBuZXZlciBiZWdpbiBhIHdvcmQgaGVyZS5cbiAgICBpZiAoXG4gICAgICAhY2FzZVJlZ2lvbiAmJlxuICAgICAgIVdPUkRfRU5ELnRlc3QoYykgJiZcbiAgICAgIChpc1dvcmRTdGFydCgpIHx8IC9bKCldJC8udGVzdChidWYpKSAmJlxuICAgICAgIShjID09PSAnJCcgJiYgY21kW2kgKyAxXSA9PT0gJ3snKVxuICAgICkge1xuICAgICAgbGV0IGogPSBpO1xuICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgIGNvbnN0IHcgPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICBjb25zdCBpc0ZuU2hhcGUgPSAoKTogYm9vbGVhbiA9PiAvXltBLVphLXpfXVtBLVphLXowLTlfXSpcXChcXCkkLy50ZXN0KGxhc3RXb3JkKCkpIHx8IGxhc3RXb3JkKCkgPT09ICcoKSc7XG4gICAgICBpZiAodyA9PT0gJ2luJyAmJiB0b3AoKSAhPT0gdW5kZWZpbmVkICYmIFsnZm9yJywgJ3NlbGVjdCddLmluY2x1ZGVzKHRvcCgpIS5raW5kKSkge1xuICAgICAgICAvLyBUaGUgZm9yL3NlbGVjdCB3b3JkLWxpc3Qgc2VwYXJhdG9yIFx1MjAxNCByZWNvZ25pemVkIHdoZXJldmVyIGl0IGFwcGVhcnNcbiAgICAgICAgLy8gd2hpbGUgYSBmb3Ivc2VsZWN0IGlzIG9wZW4gKGBmb3IgaSBpbiBhIGJgLCBgc2VsZWN0IHggaW4gYWApLlxuICAgICAgfSBlbHNlIGlmICh3ID09PSAneycgJiYgKGlzQ29tbWFuZFBvc2l0aW9uKCkgfHwgaXNGblNoYXBlKCkgfHwgKGZ1bmN0aW9uU2VlbiAmJiBuYW1lU2VlbikpKSB7XG4gICAgICAgIC8vIGB7YCBvcGVucyBhIGJyYWNlIGdyb3VwIGF0IGNvbW1hbmQgcG9zaXRpb24sIG9yIHJpZ2h0IGFmdGVyIGFcbiAgICAgICAgLy8gZnVuY3Rpb24gbmFtZSAoYGYoKSB7YCwgYGYoKXtgLCBgZnVuY3Rpb24gZiB7YCkuIGB7Y2F0YCBpcyBhIHdvcmQuXG4gICAgICAgIGlmIChmdW5jdGlvblNlZW4gJiYgbmFtZVNlZW4pIHtcbiAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnYnJhY2UnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ30nICYmIGlzQ29tbWFuZFBvc2l0aW9uKCkpIHtcbiAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICBpZiAoYWZ0ZXJLZXl3b3JkIHx8IHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdicmFjZScgfHwgIXQuYm9keSkge1xuICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICB9IGVsc2UgaWYgKGlzQ29tbWFuZFBvc2l0aW9uKCkpIHtcbiAgICAgICAgaWYgKHcgPT09ICdjYXNlJykge1xuICAgICAgICAgIGNhc2VSZWdpb24gPSB7IHBvczogJ3N1YmplY3QnLCBjbWRFbXB0eTogZmFsc2UsIGxvY2FsRGVwdGg6IDAgfTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgZnVuY3Rpb25TZWVuID0gdHJ1ZTtcbiAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpZicpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnaWYnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICd3aGlsZScgfHwgdyA9PT0gJ3VudGlsJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdsb29wJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZm9yJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdmb3InLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdzZWxlY3QnKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ3NlbGVjdCcsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2RvJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdsb29wJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgdC5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICd0aGVuJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJykge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0LmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2Vsc2UnIHx8IHcgPT09ICdlbGlmJykge1xuICAgICAgICAgIC8vIGVsc2UvZWxpZiByZXF1aXJlIGEgYm9keSBhbHJlYWR5IFx1MjAxNCBhbiBlbXB0eSBpZi1saXN0IGlzIGFuIGVycm9yLlxuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJyB8fCAhdC5ib2R5KSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2luJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdmaScpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdkb25lJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdsb29wJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdlc2FjJykge1xuICAgICAgICAgIC8vIE5vIG9wZW4gcmVnaW9uIFx1MjAxNCBhIHN0cmF5IGVzYWMgaXMgYSBwYXJzZSBlcnJvci5cbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGlmIChmdW5jdGlvblNlZW4pIHtcbiAgICAgICAgICAgIGlmIChuYW1lU2Vlbikge1xuICAgICAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG5hbWVTZWVuID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFuIGFyZ3VtZW50LXBvc2l0aW9uIHdvcmQ6IG5vdGhpbmcgb3BlbnMsIHRoZSBlbXB0eS1ib2R5IGZsYWdcbiAgICAgICAgLy8gY2xlYXJzLCBhbmQgdGhlIGZ1bmN0aW9uLW5hbWUgaGFuZG9mZiBhZHZhbmNlcy5cbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIGlmIChmdW5jdGlvblNlZW4pIHtcbiAgICAgICAgICBpZiAobmFtZVNlZW4pIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICAgICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmFtZVNlZW4gPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnVmICs9IHc7XG4gICAgICBpID0gajtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBBIGA7YC9gJmAgZGlyZWN0bHkgYWZ0ZXIgYW4gb3BlbmVyIG9yIGJvZHkga2V5d29yZCBpcyBhbiBlbXB0eS1saXN0XG4gICAgLy8gcGFyc2UgZXJyb3IgYXQgYW55IGRlcHRoIChgaWYgdHJ1ZTsgdGhlbjsgZmlgLCBgeyA7IH1gLFxuICAgIC8vIGBmb3IgaSBpbiBhIGI7IGRvOyBkb25lYCwgYCggaWYgdHJ1ZTsgdGhlbjsgZmkgKWApLlxuICAgIGlmIChjYXNlUmVnaW9uID09PSBudWxsICYmIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCAmJiAoYyA9PT0gJzsnIHx8IGMgPT09ICcmJykgJiYgYWZ0ZXJLZXl3b3JkKSB7XG4gICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZWRpcmVjdCB0b2tlbiB3aXRoIG5vIHRhcmdldCB3b3JkLCBpbW1lZGlhdGVseSBmb2xsb3dlZCBieSBhbm90aGVyXG4gICAgICAvLyByZWRpcmVjdCB0b2tlbiBtaWQtc3RhZ2UsIGlzIGEgcGFyc2UgZXJyb3I6IGBjYXQgZiA+ID4gb3V0YCxcbiAgICAgIC8vIGBjYXQgZiA+IDI+JjFgLCBgY2F0IGYgPiAmPm91dGAsIGBjYXQgZiA+IDw8PCB4YCAocGxhbiBcdTAwQTcxKS5cbiAgICAgIGlmIChpc1dvcmRTdGFydCgpICYmIGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkgJiYgc3RhcnRzUmVkaXJlY3RBdChpKSkge1xuICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICckJyAmJiBjbWRbaSArIDFdID09PSAneycpIHtcbiAgICAgICAgYnJhY2VEZXB0aCArPSAxO1xuICAgICAgICBidWYgKz0gYztcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIEhlcmVkb2MgcmVjb2duaXRpb24gKHBsYW4gXHUwMEE3Myk6IGA8PGAvYDw8LWAgKG5vdCBgPDw8YCkgYXQgZGVwdGggMCB3aXRoXG4gICAgICAvLyBhIGRlbGltaXRlciB3b3JkLiBUaGUgb3BlcmF0b3IrZGVsaW1pdGVyIGFyZSBzdHJpcHBlZCBmcm9tIHRoZSBzdGFnZVxuICAgICAgLy8gdGV4dCBcdTIwMTQgdGhlIHN0YWdlIGtlZXBzIGEgcGxhaW4gYXJndiAoYGNhdCBmYCBzdGF5cyBgY2F0IGZgKS5cbiAgICAgIGlmIChjID09PSAnPCcgJiYgY21kW2kgKyAxXSA9PT0gJzwnICYmIGNtZFtpICsgMl0gIT09ICc8Jykge1xuICAgICAgICBsZXQgaiA9IGkgKyAyO1xuICAgICAgICBsZXQgYWxsb3dUYWJzID0gZmFsc2U7XG4gICAgICAgIGlmIChjbWRbal0gPT09ICctJykge1xuICAgICAgICAgIGFsbG93VGFicyA9IHRydWU7XG4gICAgICAgICAgaiArPSAxO1xuICAgICAgICB9XG4gICAgICAgIHdoaWxlIChjbWRbal0gPT09ICcgJyB8fCBjbWRbal0gPT09ICdcXHQnKSBqICs9IDE7XG4gICAgICAgIGxldCBkZWxpbSA9ICcnO1xuICAgICAgICBpZiAoY21kW2pdID09PSBcIidcIiB8fCBjbWRbal0gPT09ICdcIicpIHtcbiAgICAgICAgICBjb25zdCBxID0gY21kLmluZGV4T2YoY21kW2pdLCBqICsgMSk7XG4gICAgICAgICAgaWYgKHEgPT09IC0xKSB7XG4gICAgICAgICAgICBkZWxpbSA9IGNtZC5zbGljZShqICsgMSk7XG4gICAgICAgICAgICBqID0gbjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVsaW0gPSBjbWQuc2xpY2UoaiArIDEsIHEpO1xuICAgICAgICAgICAgaiA9IHEgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCB3b3JkU3RhcnQgPSBqO1xuICAgICAgICAgIHdoaWxlIChqIDwgbiAmJiAhV09SRF9FTkQudGVzdChjbWRbal0pKSBqICs9IDE7XG4gICAgICAgICAgZGVsaW0gPSBjbWQuc2xpY2Uod29yZFN0YXJ0LCBqKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaW0gIT09ICcnKSB7XG4gICAgICAgICAgaGVyZWRvY3MucHVzaCh7XG4gICAgICAgICAgICBjbG9zZTogbmV3IFJlZ0V4cChgXiR7YWxsb3dUYWJzID8gJ1xcdConIDogJyd9JHtlc2NhcGVSZWdFeHAoZGVsaW0pfVsgXFxcXHRdKiRgKVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgfHwgY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gSW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IHRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgc3RheSBpbiB0aGVcbiAgICAgICAgICAgIC8vIHN0YWdlIHRleHQgXHUyMDE0IHRoZSB3YWxrJ3MgaW50ZXJpb3IgcmUtc3BsaXQgcmUtcmVjb2duaXplcyB0aGVcbiAgICAgICAgICAgIC8vIGhlcmVkb2MgdGhlcmUgKHBsYW4gXHUwMEE3MykuXG4gICAgICAgICAgICBidWYgKz0gY21kLnNsaWNlKGksIGopO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpID0gajtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gV2hpbGUgYSBjb25zdHJ1Y3QgaXMgb3BlbiBhdCBkZXB0aCAwIHRoZSBib3VuZGFyeSBvcGVyYXRvcnMgYXJlIHRleHQgXHUyMDE0XG4gICAgICAvLyB0aGUgY29uc3RydWN0IGlzIG9uZSBzdGFnZS5cbiAgICAgIGlmIChjYXNlUmVnaW9uID09PSBudWxsICYmIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnJiYnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdhbmQnKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8fCcpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ29yJyk7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfCYnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdwaXBlJyk7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ3NlbWljb2xvbicpO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdwaXBlJyk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAgIC8vIEEgbmV3bGluZSBpcyBhIGxpbmUgY29udGludWF0aW9uIFx1MjAxNCBub3QgYSBzdGF0ZW1lbnQgc2VwYXJhdG9yIFx1MjAxNCB3aGVuXG4gICAgICAgICAgLy8gYSBwaXBlL2FuZC9vciBvcGVyYXRvciBpcyBwZW5kaW5nIHdpdGggYSB3aGl0ZXNwYWNlLW9ubHkgYnVmZmVyXG4gICAgICAgICAgLy8gc2luY2UgaXQgKGBjYXQgYS50eHQgfFxcbnNlZCAuLi5gLCBgZmFsc2UgJiZcXG5zZWQgLi4uYCkuIGBjYXQgZiB8IGhlYWQgLTFcXG5jYXQgZ2BcbiAgICAgICAgICAvLyBpcyB0aGVyZWZvcmUgdHdvIGxpc3RzLCBhbmQgYSByZWRpcmVjdCB0YXJnZXQgbmV2ZXIgY29udGludWVzIG9udG9cbiAgICAgICAgICAvLyBhIGxhdGVyIGxpbmUgKHBsYW4gXHUwMEE3MSkuXG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gICAgICAgICAgbGlzdFN0YXJ0ID0gcGFydHMubGVuZ3RoO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgICAgLy8gQSBiYXJlIGAmYCBpcyBhIGJhY2tncm91bmQgb3BlcmF0b3Igb25seSB3aGVuIGl0IGlzIG5vdCBwYXJ0IG9mIGFcbiAgICAgICAgICAvLyByZWRpcmVjdCB0b2tlbjogdGhlIG5leHQgY2hhcmFjdGVyIGlzIGA+YCAoYCY+YC9gJj4+YCksIG9yIHRoZVxuICAgICAgICAgIC8vIGJ1ZmZlcidzIGxhc3QgY2hhcmFjdGVyIGlzIGA+YCBvciBgPGAgKGAyPiYxYCwgYD4mIGZpbGVgLCBgMzwmMGApLlxuICAgICAgICAgIC8vIFNwbGl0dGluZyBpbnNpZGUgdGhvc2UgdG9rZW5zIHdvdWxkIHByb2R1Y2UganVuayBzdGFnZXMuXG4gICAgICAgICAgY29uc3QgbmV4dCA9IGNtZFtpICsgMV07XG4gICAgICAgICAgY29uc3QgbGFzdCA9IGJ1ZltidWYubGVuZ3RoIC0gMV07XG4gICAgICAgICAgaWYgKG5leHQgIT09ICc+JyAmJiBsYXN0ICE9PSAnPicgJiYgbGFzdCAhPT0gJzwnKSB7XG4gICAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmbHVzaCgnYmFja2dyb3VuZCcpO1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuXG4gIC8vIEVuZCBvZiBpbnB1dDogdGhlIEVPRi1zdGF0ZSB2ZXJkaWN0cyBcdTIwMTQgYW4gdW5jbG9zZWQgcXVvdGUsIGJyYWNlLCBjYXNlXG4gIC8vIHJlZ2lvbiwgcGFyZW4gbGV2ZWwsIG9yIGNvbnN0cnVjdCBcdTIwMTQgdGhlbiB0aGUgdW5jb25zdW1lZC1vcGVyYXRvciBjaGVja3MsXG4gIC8vIHRoZW4gdGhlIHVudGVybWluYXRlZC1oZXJlZG9jIHBhcnRpYWwsIHRoZW4gdGhlIGZpbmFsIGZsdXNoLiBBIHZlcmRpY3RcbiAgLy8gc2V0IG1pZC1zY2FuIGFscmVhZHkgZHJvcHBlZCB0aGUgcmVqZWN0aW5nIGxpc3QgYW5kIGVuZGVkIHRoZSBsb29wLCBzb1xuICAvLyBgcGFydHNgIGlzIGV4YWN0bHkgdGhlIGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzIGhlcmUuXG4gIGlmIChtYWxmb3JtZWQpIHJldHVybiB7IHN0YWdlczogcGFydHMsIG1hbGZvcm1lZCB9O1xuICBpZiAoaW5TcXVvdGUgfHwgaW5EcXVvdGUpIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLXF1b3RlJyk7XG4gIH0gZWxzZSBpZiAoYnJhY2VEZXB0aCA+IDApIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLWJyYWNlJyk7XG4gIH0gZWxzZSBpZiAoY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtY2FzZScpO1xuICB9IGVsc2UgaWYgKGRlcHRoID4gMCkge1xuICAgIHJlamVjdCgndW5iYWxhbmNlZC1wYXJlbicpO1xuICB9IGVsc2UgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gIH0gZWxzZSBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICB9IGVsc2UgaWYgKGluQm9keSB8fCBoZXJlZG9jcy5sZW5ndGggPiAwKSB7XG4gICAgLy8gVW50ZXJtaW5hdGVkIGhlcmVkb2MgXHUyMDE0IGJhc2ggd2FybnMsIHJ1bnMgdGhlIGRlbGltaXRlcidzIGxpbmUsIGFuZFxuICAgIC8vIHRyZWF0cyB0aGUgdGFpbCBhcyBib2R5OiB0aGUgcGFydGlhbC4gVGhlIGRlbGltaXRlcidzLWxpbmUgc3RhZ2UocylcbiAgICAvLyBhbmFseXplIGFzLWlzOyB0aGUgYm9keSBwcm9kdWNlcyBubyBzdGFnZXMgKHBsYW4gXHUwMEE3MykuXG4gICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICBtYWxmb3JtZWQgPSAndW50ZXJtaW5hdGVkLWhlcmVkb2MnO1xuICB9IGVsc2Uge1xuICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhZ2VzOiBwYXJ0cywgbWFsZm9ybWVkIH07XG59XG5cbmNvbnN0IExFQURJTkdfQVNTSUdOTUVOVCA9IC9eKD86W0EtWmEtel9dW0EtWmEtejAtOV9dKj1cXFMqXFxzKykrLztcblxuLyoqIFN0cmlwIGxlYWRpbmcgRk9PPWJhciBWQVI9YmF6IGVudi1wcmVmaXggYXNzaWdubWVudHMgZnJvbSBhIHNpbXBsZSBjb21tYW5kLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNpbXBsZUNtZC5yZXBsYWNlKExFQURJTkdfQVNTSUdOTUVOVCwgJycpO1xufVxuXG4vKiogUXVvdGUtYXdhcmUgd2hpdGVzcGFjZSB0b2tlbml6ZXIsIHJvdWdobHkgbWF0Y2hpbmcgYHNobGV4LnNwbGl0KHMsIHBvc2l4PVRydWUpYC4gUmV0dXJucyBudWxsIG9uIHVuYmFsYW5jZWQgcXVvdGVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0V29yZHMoczogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3Qgd29yZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXIgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gc1tpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB3b3Jkcy5wdXNoKGN1cik7XG4gICAgICAgIGN1ciA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb25zdCBlbmQgPSBzLmluZGV4T2YoXCInXCIsIGkpO1xuICAgICAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgY3VyICs9IHMuc2xpY2UoaSwgZW5kKTtcbiAgICAgIGkgPSBlbmQgKyAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHNbaV0gIT09ICdcIicpIHtcbiAgICAgICAgaWYgKHNbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzW2kgKyAxXSkpIHtcbiAgICAgICAgICBjdXIgKz0gc1tpICsgMV07XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN1ciArPSBzW2ldO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBjdXIgKz0gc1tpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaGFzID0gdHJ1ZTtcbiAgICBjdXIgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgaWYgKGhhcykgd29yZHMucHVzaChjdXIpO1xuICByZXR1cm4gd29yZHM7XG59XG5cbi8qKlxuICogV2hldGhlciBhbiBVTlFVT1RFRCBgPGAgXHUyMDE0IGEgc3RkaW4gcmVkaXJlY3QsIHN0YW5kYWxvbmUgKGA8IGZpbGVgKSBvciBnbHVlZFxuICogaW5zaWRlIGEgdG9rZW4gKGBoZWFkIC0yPGZgLCBgcmcgbmVlZGxlPGZgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSBsaWtlXG4gKiBgLWUgbmVlZGxlPGZgKSBcdTIwMTQgYXBwZWFycyBpbiBhIHNpbXBsZSBjb21tYW5kLiBCYXNoIHRyZWF0cyBgPGAgYXMgYSByZWRpcmVjdFxuICogb3BlcmF0b3Igb25seSBvdXRzaWRlIHF1b3Rlcywgc28gdGhlIHNjYW4gaXMgcXVvdGUtYXdhcmU6IGEgbGl0ZXJhbCBgPGAgaW5cbiAqIGEgcGF0dGVybiBsaWtlIGByZyAtbiAnPGRpdj4nYCBvciBhbiBhd2sgc2NyaXB0IGxpa2UgYCdOUjw9MidgIG11c3QgbmV2ZXJcbiAqIGJlIG1pc3Rha2VuIGZvciBhIHJlZGlyZWN0LiBQcm9jZXNzIHN1YnN0aXR1dGlvbiBgPChcdTIwMjYpYCBhbmQgaGVyZS1zdHJpbmdzXG4gKiBgPDw8YCBhbHNvIGJlZ2luIHdpdGggYW4gdW5xdW90ZWQgYDxgIFx1MjAxNCBib3RoIGNvdW50IGFzIHJlZGlyZWN0cyBoZXJlIChmYWlsXG4gKiBjbG9zZWQ7IGEgcmVhZC10b3VjaCBiaW4gbmV2ZXIgbGVnaXRpbWF0ZWx5IG5lZWRzIHRoZW0pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaGFzVW5xdW90ZWRSZWRpcmVjdChzaW1wbGVDbWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ21kLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IHNpbXBsZUNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIC8vIE5vIGVzY2FwZXMgaW5zaWRlIHNpbmdsZSBxdW90ZXMgXHUyMDE0IHRoZSBuZXh0IGAnYCBhbHdheXMgY2xvc2VzLlxuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgLy8gSW5zaWRlIGRvdWJsZSBxdW90ZXMgYSBiYWNrc2xhc2ggb25seSBlc2NhcGVzIGBcImAsIGBcXGAsIGAkYCwgYW5kXG4gICAgICAvLyBiYWNrdGljazsgZXZlcnl0aGluZyBlbHNlIChpbmNsdWRpbmcgYDxgKSBpcyBsaXRlcmFsLlxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IHNpbXBsZUNtZC5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzaW1wbGVDbWRbaSArIDFdKSkge1xuICAgICAgICBpICs9IDE7XG4gICAgICB9IGVsc2UgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgICAgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBzaW1wbGVDbWQubGVuZ3RoKSB7XG4gICAgICAvLyBBbiBlc2NhcGVkIGNoYXJhY3RlciBpcyBsaXRlcmFsIFx1MjAxNCBgXFw8YCBpcyBub3QgYSByZWRpcmVjdC5cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBhcmd2IGZvciBhIHNpbXBsZSBjb21tYW5kOiBsZWFkaW5nIGFzc2lnbm1lbnRzIHN0cmlwcGVkLCBxdW90ZS1hd2FyZSBzcGxpdC4gUmV0dXJucyBudWxsIGlmIHRoZSBjb21tYW5kIGRvZXNuJ3QgdG9rZW5pemUgY2xlYW5seSAodW5iYWxhbmNlZCBxdW90ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFyZ3ZPZihzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIHJldHVybiBzcGxpdFdvcmRzKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZCkudHJpbSgpKTtcbn1cblxuLyoqXG4gKiBSZWRpcmVjdCBvcGVyYXRvcnMgdGhhdCBkcm9wIHRvZ2V0aGVyIHdpdGggdGhlaXIgcGxhaW4gdGFyZ2V0IHdvcmQgKHBsYW4gXHUwMEE3NFxuICogdHdvLXRva2VuIHNoYXBlcyk6IGA+YCwgYD4+YCwgYDxgLCBgPD5gLCBgJj5gLCBgJj4+YCwgYW5kIGRpZ2l0LXByZWZpeGVkXG4gKiBmb3JtcyBsaWtlIGAyPmAvYDI+PmAvYDM8YC4gYD58YCBpcyBkZWxpYmVyYXRlbHkgYWJzZW50IFx1MjAxNCBpdCBmYWlscyBjbG9zZWQuXG4gKi9cbmNvbnN0IFJFRElSRUNUX1RXT19UT0tFTiA9IC9eKD86Pj4/fDw+fDx8Jj4+P3xbMC05XSsoPzo+Pj98PD58PCkpJC87XG5cbi8qKiBEdXAgZm9ybXMgdGhhdCBkcm9wIGFsb25lIChwbGFuIFx1MDBBNzQpOiBgMj4mMWAsIGA+Ji1gLCBgMzwmMGAuICovXG5jb25zdCBSRURJUkVDVF9EVVAgPSAvXig/OlswLTldKyk/Wzw+XSYoPzpbMC05XSt8LSkkLztcblxuLyoqIEZ1c2VkIG9wZXJhdG9yK3RhcmdldCB3b3JkcyB0aGF0IGRyb3Agd2hvbGUgKHBsYW4gXHUwMEE3NCk6IGA+b3V0YCwgYDI+ZXJyYCwgYCY+b3V0YC4gKi9cbmNvbnN0IFJFRElSRUNUX0ZVU0VEID0gL14oPzo+Pj98PD58PHwmPj4/fFswLTldKyg/Oj4+P3w8Pnw8KSlbXjw+JnxdLztcblxuLyoqIEhlcmVkb2MvaGVyZS1zdHJpbmcgb3BlcmF0b3JzIHdpdGggYSBzZXBhcmF0ZSB0YXJnZXQgd29yZDogYDw8YCwgYDw8LWAsIGA8PDxgLiAqL1xuY29uc3QgSEVSRURPQ19UV09fVE9LRU4gPSAvXig/Ojw8LT98PDw8KSQvO1xuXG4vKiogRnVzZWQgaGVyZWRvYyB3b3JkcyAocGxhbiBcdTAwQTc0KTogYDw8RU9GYCwgYDw8LUVPRmAsIGA8PDx4YC4gKi9cbmNvbnN0IEhFUkVET0NfRlVTRUQgPSAvXig/Ojw8LT98PDw8KVtePD4mfF0vO1xuXG4vKiogV2hldGhlciBhIHdvcmQgaXMgaXRzZWxmIGEgcmVkaXJlY3QgdG9rZW4gXHUyMDE0IG5ldmVyIGEgdmFsaWQgcmVkaXJlY3QgdGFyZ2V0LiAqL1xuY29uc3QgUkVESVJFQ1RfVE9LRU4gPSAodzogc3RyaW5nKTogYm9vbGVhbiA9PlxuICBSRURJUkVDVF9UV09fVE9LRU4udGVzdCh3KSB8fFxuICBSRURJUkVDVF9EVVAudGVzdCh3KSB8fFxuICBSRURJUkVDVF9GVVNFRC50ZXN0KHcpIHx8XG4gIEhFUkVET0NfVFdPX1RPS0VOLnRlc3QodykgfHxcbiAgSEVSRURPQ19GVVNFRC50ZXN0KHcpO1xuXG4vKipcbiAqIFN0cmlwIHJlZGlyZWN0IHRva2VucyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyBhcmd2IHNvIHRoZSByZWFkLXNpZGVcbiAqIG1hdGNoZXJzIHNlZSB0aGUgd29yZHMgdGhhdCB3ZXJlIGFjdHVhbGx5IHJlYWQgKHBsYW4gXHUwMEE3NCk6IHR3by10b2tlblxuICogb3BlcmF0b3JzIChgPmAsIGA+PmAsIGA8YCwgYDw+YCwgYCY+YCwgYCY+PmAsIGRpZ2l0LXByZWZpeGVkIGAyPmAvYDI+PmAvXG4gKiBgMzxgLCAuLi4pIGRyb3AgdG9nZXRoZXIgd2l0aCB0aGVpciBwbGFpbiB0YXJnZXQgd29yZCwgZHVwIGZvcm1zIChgMj4mMWAsXG4gKiBgPiYtYCwgYDM8JjBgKSBkcm9wIGFsb25lLCBmdXNlZCBmb3JtcyAoYD5vdXRgLCBgMj5lcnJgLCBgJj5vdXRgKSBkcm9wIGFzXG4gKiBvbmUgd29yZCwgYW5kIGhlcmVkb2MvaGVyZS1zdHJpbmcgb3BlcmF0b3JzIGRyb3Agd2l0aCB0aGVpciB0YXJnZXQgd29yZCBpblxuICogYm90aCBzcGVsbGluZ3MuIEEgdHdvLXRva2VuIG9wZXJhdG9yJ3MgdGFyZ2V0IG11c3QgYmUgYSBwbGFpbiBmaWxlIHdvcmQgXHUyMDE0IGFcbiAqIGZvbGxvd2luZyByZWRpcmVjdCB0b2tlbiAoYGNhdCBmID4gMj4mMWApIGlzIGJhc2gncyBcInN5bnRheCBlcnJvciBuZWFyXG4gKiB1bmV4cGVjdGVkIHRva2VuXCIgYW5kIGxlYXZlcyB0aGUgb3BlcmF0b3IgZGFuZ2xpbmcsIHVubWF0Y2hlZC4gQW55dGhpbmdcbiAqIGVsc2UgYmVnaW5uaW5nIHdpdGggYD5gL2A8YCAobm90YWJseSBgPnxgKSBpcyBsZWZ0IGFsb25lIFx1MjAxNCB0aGUgY2FsbGVyXG4gKiB0cmVhdHMgYSByZXNpZHVhbCByZWRpcmVjdCB3b3JkIGFzIGFuIHVubWF0Y2hlZCBzdGFnZS4gQXBwbGllZCB0byBldmVyeVxuICogc3RhZ2UgXHUyMDE0IHNvdXJjZXMsIHNlbGVjdG9ycywgYW5kIHByZWRpY2F0ZXMgXHUyMDE0IGJlZm9yZSBzdGF0dXMgZXZhbHVhdGlvbiBhbmRcbiAqIG1hdGNoZXIgZGlzcGF0Y2guXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcFJlZGlyZWN0cyhhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoUkVESVJFQ1RfVFdPX1RPS0VOLnRlc3QoYSkgfHwgSEVSRURPQ19UV09fVE9LRU4udGVzdChhKSkge1xuICAgICAgY29uc3QgbmV4dCA9IGFyZ3ZbaSArIDFdO1xuICAgICAgLy8gVGhlIG9wZXJhdG9yJ3MgdGFyZ2V0IG11c3QgYmUgYSBwbGFpbiBmaWxlIHdvcmQgXHUyMDE0IGEgZm9sbG93aW5nIHJlZGlyZWN0XG4gICAgICAvLyB0b2tlbiBtZWFucyB0aGUgb3BlcmF0b3IgZGFuZ2xlcyBhbmQgdGhlIGNvbW1hbmQgbmV2ZXIgcnVucy4gVGhlXG4gICAgICAvLyBkYW5nbGluZyBvcGVyYXRvciBpdHNlbGYgaXMgbGVmdCBpbiBwbGFjZSBzbyB0aGUgY2FsbGVyIHJlamVjdHMgdGhlXG4gICAgICAvLyBzdGFnZSBhcyB1bm1hdGNoZWQuXG4gICAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFSRURJUkVDVF9UT0tFTihuZXh0KSkge1xuICAgICAgICBpICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvdXQucHVzaChhKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoUkVESVJFQ1RfRFVQLnRlc3QoYSkgfHwgUkVESVJFQ1RfRlVTRUQudGVzdChhKSB8fCBIRVJFRE9DX0ZVU0VELnRlc3QoYSkpIGNvbnRpbnVlO1xuICAgIG91dC5wdXNoKGEpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTaGVsbCBidWlsdGlucyB0aGUgd2FsayByZWNvZ25pemVzIGEgYGJ1aWx0aW5gIHdyYXBwZXIgbWF5IGZvcndhcmQgKHBsYW4gXHUwMEE3NSkuICovXG5jb25zdCBXUkFQUEVSX0JVSUxUSU5TID0gbmV3IFNldChbXG4gICdleGl0JyxcbiAgJ2V4ZWMnLFxuICAndHJ1ZScsXG4gICdmYWxzZScsXG4gICc6JyxcbiAgJ2NkJyxcbiAgJ3NldCcsXG4gICd1bnNldCcsXG4gICdleHBvcnQnLFxuICAncmVhZG9ubHknLFxuICAncmV0dXJuJyxcbiAgJ2JyZWFrJyxcbiAgJ2NvbnRpbnVlJ1xuXSk7XG5cbi8qKiBFeHRlcm5hbHMgd2hvc2UgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRocyBzdHJpcCB0byB0aGVpciBiYXNlbmFtZSAocGxhbiBcdTAwQTc1KS4gKi9cbmNvbnN0IFJFQ09HTklaRURfRVhURVJOQUxfTkFNRVMgPSBuZXcgU2V0KFtcbiAgJ3NlZCcsXG4gICdoZWFkJyxcbiAgJ3RhaWwnLFxuICAnY2F0JyxcbiAgJ25sJyxcbiAgJ2dpdCcsXG4gICd0cnVlJyxcbiAgJ2ZhbHNlJyxcbiAgJ3RpbWVvdXQnLFxuICAnZW52JyxcbiAgJ2NvbW1hbmQnXG5dKTtcblxuLyoqIEEgYHRpbWVvdXRgIGR1cmF0aW9uIHdvcmQ6IGA1YCwgYDUuNXNgLCBgMW1gLCBgMmhgLCAuLi4gKi9cbmNvbnN0IFRJTUVPVVRfRFVSQVRJT04gPSAvXlxcZCsoPzpcXC5cXGQrKT9bc21oZF0/JC87XG5cbi8qKiBBIGxpdGVyYWwgYE5BTUU9dmFsdWVgIGVudi1wcmVmaXggd29yZC4gKi9cbmNvbnN0IEVOVl9BU1NJR05NRU5UID0gL15bQS1aYS16X11bQS1aYS16MC05X10qPS4qJC87XG5cbi8qKlxuICogT25lIHN0cmlwIHN0ZXAuIFJldHVybnMgbnVsbCB3aGVuIHRoZSB3cmFwcGVyIGlzIG5vdCBjbGVhbiAoZmFpbCBjbG9zZWQgXHUyMDE0XG4gKiB0aGUgY2FsbGVyIHJlc3RvcmVzIHRoZSBvcmlnaW5hbCBhcmd2LCBzbyBub3RoaW5nIGlzIGZvcndhcmRlZCB0byB0aGVcbiAqIG1hdGNoZXJzKSwgb3IgdGhlIGFyZ3Ygd2l0aCBvbmUgd3JhcHBlciBsYXllciByZW1vdmVkLlxuICovXG5mdW5jdGlvbiBzdHJpcFdyYXBwZXJzT25jZShhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnIScpIGkrKztcbiAgaWYgKGkgPj0gYXJndi5sZW5ndGgpIHJldHVybiBhcmd2LnNsaWNlKGkpO1xuICBjb25zdCBoZWFkID0gYXJndltpXTtcbiAgaWYgKGhlYWQgPT09ICdjb21tYW5kJykge1xuICAgIGNvbnN0IG5leHQgPSBhcmd2W2kgKyAxXTtcbiAgICBpZiAobmV4dCA9PT0gJy12JyB8fCBuZXh0ID09PSAnLVYnKSByZXR1cm4gbnVsbDsgLy8gYSBxdWVyeSBcdTIwMTQgcnVucyBub3RoaW5nXG4gICAgaWYgKG5leHQgPT09ICctcCcpIHJldHVybiBhcmd2LnNsaWNlKGkgKyAyKTtcbiAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFuZXh0LnN0YXJ0c1dpdGgoJy0nKSkgcmV0dXJuIGFyZ3Yuc2xpY2UoaSArIDEpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmIChoZWFkID09PSAnYnVpbHRpbicpIHtcbiAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07XG4gICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiBXUkFQUEVSX0JVSUxUSU5TLmhhcyhuZXh0KSkgcmV0dXJuIGFyZ3Yuc2xpY2UoaSArIDIpO1xuICAgIHJldHVybiBudWxsOyAvLyBgYnVpbHRpbiBzZWRgIGVycm9ycyBcdTIwMTQgbmV2ZXIgZm9yd2FyZCBhIG5vbi1idWlsdGluIHdvcmRcbiAgfVxuICBpZiAoaGVhZCA9PT0gJ2VudicpIHtcbiAgICBsZXQgaiA9IGkgKyAxO1xuICAgIHdoaWxlIChqIDwgYXJndi5sZW5ndGggJiYgRU5WX0FTU0lHTk1FTlQudGVzdChhcmd2W2pdKSkgaisrO1xuICAgIGlmIChqID09PSBpICsgMSkgcmV0dXJuIG51bGw7IC8vIGAtaWAsIGAtdSBYYCwgYSBub24tYXNzaWdubWVudCB3b3JkIFx1MjAxNCBub3QgYSBjbGVhbiB3cmFwcGVyXG4gICAgcmV0dXJuIGFyZ3Yuc2xpY2Uoaik7XG4gIH1cbiAgaWYgKGhlYWQgPT09ICd0aW1lb3V0Jykge1xuICAgIGxldCBqID0gaSArIDE7XG4gICAgd2hpbGUgKGogPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2pdLnN0YXJ0c1dpdGgoJy0tJykpIGorKztcbiAgICBpZiAoaiA+PSBhcmd2Lmxlbmd0aCB8fCAhVElNRU9VVF9EVVJBVElPTi50ZXN0KGFyZ3Zbal0pKSByZXR1cm4gbnVsbDsgLy8gbm8gZHVyYXRpb24gXHUyMDE0IG5vdGhpbmcgcnVuc1xuICAgIHJldHVybiBhcmd2LnNsaWNlKGogKyAxKTtcbiAgfVxuICBpZiAoaGVhZC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBjb25zdCBiYXNlID0gaGVhZC5zbGljZShoZWFkLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbiAgICBpZiAoUkVDT0dOSVpFRF9FWFRFUk5BTF9OQU1FUy5oYXMoYmFzZSkpIHJldHVybiBbYmFzZSwgLi4uYXJndi5zbGljZShpICsgMSldO1xuICAgIHJldHVybiBudWxsOyAvLyBgL3Vzci9iaW4vZXhpdGAgYW5kIGZyaWVuZHMgYXJlIG5vdCByZWNvZ25pemVkIGV4dGVybmFsc1xuICB9XG4gIGlmIChoZWFkLmluY2x1ZGVzKCcvJykpIHJldHVybiBudWxsOyAvLyBhIHJlbGF0aXZlIGNvbGxpZGluZyBwYXRoIGlzIGEgbG9jYWwgYmluYXJ5LCBub3QgdGhlIGNvcmV1dGlsXG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKipcbiAqIFN0cmlwIHRyYW5zcGFyZW50IHdyYXBwZXIgcHJlZml4ZXMgZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgYXJndiBzbyBtYXRjaGVyXG4gKiBkaXNwYXRjaCBzZWVzIHRoZSB1bmRlcmx5aW5nIGNvbW1hbmQgd29yZCAocGxhbiBcdTAwQTc1KTogYGNvbW1hbmRgIChzdG9wcGluZyBhdFxuICogdGhlIHF1ZXJ5IGZvcm1zIGAtdmAvYC1WYCksIGBidWlsdGluYCByZXN0cmljdGVkIHRvIHRoZSB3YWxrJ3MgcmVjb2duaXplZFxuICogYnVpbHRpbnMsIGBlbnYgTkFNRT12YWx1ZWAgcHJlZml4ZXMsIGB0aW1lb3V0YCBwbHVzIGl0cyBgLS0qYCBmbGFncyBhbmQgb25lXG4gKiBkdXJhdGlvbiwgYW5kIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aHMgd2hvc2UgYmFzZW5hbWUgaXMgaW4gdGhlIHJlY29nbml6ZWRcbiAqIHNldCBcdTIwMTQgaXRlcmF0aW5nIHVudGlsIGZpeGVkLXBvaW50IHNvIHN0YWNrZWQgd3JhcHBlcnMgc3RpbGwgcmVhY2ggdGhlIHdvcmQuXG4gKiBBbnkgdW5jbGVhbiB3cmFwcGVyIGZhaWxzIGNsb3NlZDogdGhlIG9yaWdpbmFsIGFyZ3YgaXMgcmV0dXJuZWQgdW5jaGFuZ2VkLFxuICogc28gdGhlIHN0YWdlIG1hdGNoZXMgbm90aGluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwV3JhcHBlcnMoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGxldCBjdXJyZW50ID0gYXJndjtcbiAgZm9yIChsZXQgaXRlciA9IDA7IGl0ZXIgPCBhcmd2Lmxlbmd0aCArIDI7IGl0ZXIrKykge1xuICAgIGNvbnN0IG5leHQgPSBzdHJpcFdyYXBwZXJzT25jZShjdXJyZW50KTtcbiAgICBpZiAobmV4dCA9PT0gbnVsbCkgcmV0dXJuIGFyZ3Y7XG4gICAgaWYgKG5leHQubGVuZ3RoID09PSBjdXJyZW50Lmxlbmd0aCAmJiBuZXh0LmV2ZXJ5KCh3LCBrKSA9PiB3ID09PSBjdXJyZW50W2tdKSkgcmV0dXJuIGN1cnJlbnQ7XG4gICAgY3VycmVudCA9IG5leHQ7XG4gIH1cbiAgcmV0dXJuIGFyZ3Y7XG59XG4iLCAiLyoqXG4gKiBWYXJpYWJsZSByZXNvbHV0aW9uIGZvciB0aGUgZXhlY3V0aW9uLWF3YXJlIEJhc2ggdG91Y2ggcGFyc2VyIChwbGFuIFx1MDBBNzcpLlxuICpcbiAqIEV4cGFuc2lvbiBydW5zIG92ZXIgdGhlIHJhdyBzaW1wbGUtY29tbWFuZCB0ZXh0ICpiZWZvcmUqIHRva2VuaXppbmcsIHdpdGggYVxuICogcXVvdGUtYXdhcmUgc2Nhbm5lcjogc2luZ2xlLXF1b3RlZCBzcGFucyBzdGF5IGxpdGVyYWwsIGRvdWJsZS1xdW90ZWQgYW5kXG4gKiB1bnF1b3RlZCBzcGFucyBleHBhbmQgYCRWQVJgIGFuZCBgJHtWQVJ9YCAoZ3JlZWR5IGlkZW50aWZpZXIpLCBhbmQgYVxuICogYmFja3NsYXNoLWVzY2FwZWQgYCRgIHN0YXlzIGxpdGVyYWwuIEV4cGFuZGluZyBiZWZvcmUgdG9rZW5pemluZyBrZWVwcyBhblxuICogZXhwYW5kZWQgdmFsdWUncyBgJiZgL3NwYWNlcyBvdXQgb2YgdGhlIHNwbGl0dGVyJ3MgcmVhY2guIFZhbHVlIHByZWNlZGVuY2VcbiAqIGlzIHNjcmlwdCB2YXJpYWJsZSB0YWJsZSA+IGVudiA+IHVucmVzb2x2ZWQgXHUyMDE0IGEgbmFtZSBhYnNlbnQgZnJvbSBib3RoIGlzXG4gKiBsZWZ0IGFzIHRoZSByZXNpZHVhbCBgJGAsIHdoaWNoIHRyaXBzIHRoZSBwYXJzZXIncyBgbG9va3NVbnJlc29sdmFibGVgIHBhdGhcbiAqIChmYWlsIGNsb3NlZCwgbm8gdG91Y2gpLlxuICpcbiAqIFRoZSBlbnYgaXMgZXhwZWN0ZWQgdG8gYmUgcHJlLWN1cmF0ZWQ6IGBwYXJzZUNvbW1hbmREZXRhaWxlZGAgZ2F0ZXMgaXRzXG4gKiBgcHJvY2Vzcy5lbnZgIGRlZmF1bHQgYnkgYFBhcnNlT3B0aW9ucy5hbGxvd2xpc3RgIChzbyBvbmx5IHRoZVxuICogYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgIG5hbWVzIGV2ZXIgcmVzb2x2ZSBmcm9tIHRoZSBob29rIGVudiksIHdoaWxlIGFuXG4gKiBleHBsaWNpdGx5IGluamVjdGVkIGVudiBcdTIwMTQgYXMgaW4gdGVzdHMgXHUyMDE0IGlzIGNvbnN1bHRlZCB3aG9sZXNhbGUuXG4gKi9cblxuLyoqXG4gKiBUaGUgc2hhcmVkIGFsbG93bGlzdCBvZiBob29rLWVudiB2YXJpYWJsZSBuYW1lcyBwYXRoIGFyZ3VtZW50cyBtYXkgcmVzb2x2ZVxuICogZnJvbSBcdTIwMTQgaWRlbnRpY2FsIGFjcm9zcyBoYXJuZXNzZXMgc28gdGhlIHNhbWUgY29tbWFuZCBzdHJpbmcgcHJvZHVjZXMgdGhlXG4gKiBzYW1lIHRvdWNoZXMgZXZlcnl3aGVyZS4gQW4gYWxsb3dsaXN0ZWQgbmFtZSBhYnNlbnQgZnJvbSBhIHBhcnRpY3VsYXIgaG9va1xuICogZW52IHN0YXlzIHVucmVzb2x2ZWQgKGZhaWwgY2xvc2VkKSwgc28gdGhlIGxpc3QgaXMgc2FmZSB0byBzaGFyZS5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUEFUSF9BTExPV0xJU1QgPSBbXG4gICdIT01FJyxcbiAgJ1BXRCcsXG4gICdXT1JLU1BBQ0VfUEFUSCcsXG4gICdDQVJEX1JFUE9fUEFUSCcsXG4gICdSRVBPX1JPT1QnLFxuICAnQkFTRV9CUkFOQ0gnXG5dIGFzIGNvbnN0O1xuXG4vKiogQSBiYXJlIHJlZmVyZW5jZSBuYW1lOiBncmVlZHkgaWRlbnRpZmllciBhZnRlciBgJGAuICovXG5jb25zdCBCQVJFX05BTUUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSovO1xuXG4vKiogQSBicmFjZWQgcmVmZXJlbmNlIG11c3QgYmUgZXhhY3RseSBhbiBpZGVudGlmaWVyIFx1MjAxNCBgJHshWH1gLCBgJHtYOi1kfWAsIGAkeyNYfWAgbmV2ZXIgZXhwYW5kLiAqL1xuY29uc3QgQlJBQ0VEX05BTUUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSokLztcblxuLyoqXG4gKiBFeHBhbmQgYCRWQVJgIC8gYCR7VkFSfWAgcmVmZXJlbmNlcyBpbiBhIHNpbXBsZSBjb21tYW5kJ3MgcmF3IHRleHQgKHBsYW5cbiAqIFx1MDBBNzcpLiBgJChcdTIwMjYpYCwgYCQoKFx1MjAyNikpYCwgYCR7IVh9YCBpbmRpcmVjdCBleHBhbnNpb24sIGAke1g6XHUyMDI2fWAgb3BlcmF0b3JzLFxuICogc3BlY2lhbCBwYXJhbWV0ZXJzLCBhbmQgdW5rbm93biB2YXJpYWJsZXMgc3RheSB1bnRvdWNoZWQuXG4gKlxuICogQHBhcmFtIHRleHQgVGhlIHJhdyBzaW1wbGUtY29tbWFuZCB0ZXh0LCBiZWZvcmUgdG9rZW5pemluZy5cbiAqIEBwYXJhbSB2YXJpYWJsZXMgVGhlIHNjcmlwdCB2YXJpYWJsZSB0YWJsZSBmcm9tIGV4ZWN1dGVkIG5vbi1waXBlIGFzc2lnbm1lbnRcbiAqICAgc3RhZ2VzLCBpbiBvcmRlciAodGFrZXMgcHJlY2VkZW5jZSBvdmVyIGBlbnZgKS5cbiAqIEBwYXJhbSBlbnYgVGhlIGN1cmF0ZWQgZW52aXJvbm1lbnQgKHRoZSBwYXJzZXIgZ2F0ZXMgaXRzIGBwcm9jZXNzLmVudmBcbiAqICAgZGVmYXVsdCBieSBgREVGQVVMVF9QQVRIX0FMTE9XTElTVGA7IGFuIGluamVjdGVkIGVudiBpcyB1c2VkIHdob2xlc2FsZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRWYXJpYWJsZXMoXG4gIHRleHQ6IHN0cmluZyxcbiAgdmFyaWFibGVzOiBSZWFkb25seU1hcDxzdHJpbmcsIHN0cmluZz4sXG4gIGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPlxuKTogc3RyaW5nIHtcbiAgY29uc3QgcmVzb2x2ZSA9IChuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQgPT4ge1xuICAgIGNvbnN0IGZyb21UYWJsZSA9IHZhcmlhYmxlcy5nZXQobmFtZSk7XG4gICAgaWYgKGZyb21UYWJsZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gZnJvbVRhYmxlO1xuICAgIGNvbnN0IGZyb21FbnYgPSBlbnZbbmFtZV07XG4gICAgcmV0dXJuIGZyb21FbnYgIT09IHVuZGVmaW5lZCA/IGZyb21FbnYgOiB1bmRlZmluZWQ7XG4gIH07XG5cbiAgbGV0IG91dCA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSB0ZXh0Lmxlbmd0aDtcbiAgbGV0IGluU2luZ2xlID0gZmFsc2U7XG4gIGxldCBpbkRvdWJsZSA9IGZhbHNlO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoaW5TaW5nbGUpIHtcbiAgICAgIC8vIFNpbmdsZS1xdW90ZWQgc3BhbnMgYXJlIGZ1bGx5IGxpdGVyYWwgXHUyMDE0IGAkYCBhbmQgYFxcYCBpbmNsdWRlZC5cbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TaW5nbGUgPSBmYWxzZTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRvdWJsZSkge1xuICAgICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgICAgaW5Eb3VibGUgPSBmYWxzZTtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbaSArIDFdKSkge1xuICAgICAgICAvLyBJbnNpZGUgZG91YmxlIHF1b3RlcyBiYWNrc2xhc2ggZXNjYXBlcyBgXCJgIGBcXGAgYCRgIGBgIGAgYGAgXHUyMDE0IHRoZVxuICAgICAgICAvLyBlc2NhcGVkIGNoYXJhY3RlciBzdGF5cyBsaXRlcmFsIChubyBleHBhbnNpb24gb2YgYFxcJGApLlxuICAgICAgICBvdXQgKz0gdGV4dFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnKSB7XG4gICAgICAgIG91dCArPSBjO1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICckJykge1xuICAgICAgICBjb25zdCByZWYgPSBleHBhbmRSZWYodGV4dCwgaSwgcmVzb2x2ZSk7XG4gICAgICAgIG91dCArPSByZWYudGV4dDtcbiAgICAgICAgaSA9IHJlZi5uZXh0O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFVucXVvdGVkLlxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TaW5nbGUgPSB0cnVlO1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRG91YmxlID0gdHJ1ZTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcpIHtcbiAgICAgIC8vIEEgYmFja3NsYXNoIGVzY2FwZXMgdGhlIG5leHQgY2hhcmFjdGVyIFx1MjAxNCBgXFwkYCBzdGF5cyBsaXRlcmFsICh0aGVcbiAgICAgIC8vIHRva2VuaXplciByZXNvbHZlcyB0aGUgZXNjYXBlKS5cbiAgICAgIG91dCArPSBjO1xuICAgICAgaWYgKGkgKyAxIDwgbikge1xuICAgICAgICBvdXQgKz0gdGV4dFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyQnKSB7XG4gICAgICBjb25zdCByZWYgPSBleHBhbmRSZWYodGV4dCwgaSwgcmVzb2x2ZSk7XG4gICAgICBvdXQgKz0gcmVmLnRleHQ7XG4gICAgICBpID0gcmVmLm5leHQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3V0ICs9IGM7XG4gICAgaSsrO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgcmVmZXJlbmNlIHN0YXJ0aW5nIGF0IGB0ZXh0W3N0YXJ0XWAgKGEgYCRgKS4gQSBrbm93biBuYW1lJ3NcbiAqIHZhbHVlIHJlcGxhY2VzIHRoZSB3aG9sZSByZWZlcmVuY2U7IGFueXRoaW5nIGVsc2UgXHUyMDE0IGNvbW1hbmQgc3Vic3RpdHV0aW9uLFxuICogYXJpdGhtZXRpYywgaW5kaXJlY3QgZXhwYW5zaW9uLCBwYXJhbWV0ZXIgb3BlcmF0b3JzLCBzcGVjaWFsIHBhcmFtZXRlcnMsXG4gKiB1bmtub3duIG9yIHVuc2V0IG5hbWVzIFx1MjAxNCBpcyByZXR1cm5lZCB2ZXJiYXRpbSAodGhlIGAkYCBvbmx5KSwgc28gdGhlXG4gKiBjYWxsZXIncyBzY2FuIGNvbnRpbnVlcyBhbmQgdGhlIHJlc2lkdWFsIHRleHQgaXMgdW5jaGFuZ2VkLlxuICovXG5mdW5jdGlvbiBleHBhbmRSZWYoXG4gIHRleHQ6IHN0cmluZyxcbiAgc3RhcnQ6IG51bWJlcixcbiAgcmVzb2x2ZTogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgdW5kZWZpbmVkXG4pOiB7IHRleHQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0ge1xuICBjb25zdCByZXN0ID0gdGV4dC5zbGljZShzdGFydCArIDEpO1xuICBpZiAocmVzdC5zdGFydHNXaXRoKCcoJykpIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIGAkKFx1MjAyNilgIC8gYCQoKFx1MjAyNikpYCBcdTIwMTQgdW50b3VjaGVkXG4gIGlmIChyZXN0LnN0YXJ0c1dpdGgoJ3snKSkge1xuICAgIGNvbnN0IGNsb3NlID0gdGV4dC5pbmRleE9mKCd9Jywgc3RhcnQgKyAyKTtcbiAgICBpZiAoY2xvc2UgPT09IC0xKSByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyB1bnRlcm1pbmF0ZWQgYCQge2AgXHUyMDE0IHVudG91Y2hlZFxuICAgIGNvbnN0IGlubmVyID0gdGV4dC5zbGljZShzdGFydCArIDIsIGNsb3NlKTtcbiAgICBpZiAoQlJBQ0VEX05BTUUudGVzdChpbm5lcikpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVzb2x2ZShpbm5lcik7XG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgdGV4dDogdmFsdWUsIG5leHQ6IGNsb3NlICsgMSB9O1xuICAgIH1cbiAgICByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyBgJHshWH1gLCBgJHtYOlx1MjAyNn1gLCB1bmtub3duIG5hbWVzIFx1MjAxNCB1bnRvdWNoZWRcbiAgfVxuICBjb25zdCBuYW1lID0gQkFSRV9OQU1FLmV4ZWMocmVzdCk7XG4gIGlmIChuYW1lID09PSBudWxsKSByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyBzcGVjaWFsIHBhcmFtZXRlcnMsIGJhcmUgYCRgIFx1MjAxNCB1bnRvdWNoZWRcbiAgY29uc3QgdmFsdWUgPSByZXNvbHZlKG5hbWVbMF0pO1xuICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgdGV4dDogdmFsdWUsIG5leHQ6IHN0YXJ0ICsgMSArIG5hbWVbMF0ubGVuZ3RoIH07XG4gIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIHVua25vd24gbmFtZSBcdTIwMTQgdGhlIHJlc2lkdWFsIGAkYCB0cmlwcyBsb29rc1VucmVzb2x2YWJsZVxufVxuIiwgIi8qKlxuICogUmVzcG9uc2UtYXdhcmUgZGVyaXZhdGlvbiBvZiByZWFkLXRvdWNoIHNwYW5zIGZyb20gQmFzaCBgdG9vbF9yZXNwb25zZWBcbiAqIG91dHB1dCwgZm9yIHRoZSBncmVwL3JpcGdyZXAgY29tbWFuZCBmYW1pbGllcyB0aGF0IHBhcnNlLWNvbW1hbmQudHNcbiAqIGRlbGliZXJhdGVseSBjYW5ub3QgY2xhc3NpZnkgZnJvbSBjb21tYW5kIHRleHQgYWxvbmU6IHRoZSB3aW5kb3cgaXMgYW5jaG9yZWRcbiAqIHRvIG1hdGNoIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCBhbmQgbGl2ZXMgaW4gdGhlIHJlc3BvbnNlLCBub3RcbiAqIHRoZSBjb21tYW5kLiBwYXJzZVJlc3BvbnNlIGlzIHRoZSBzZWNvbmQgZXZpZGVuY2Ugc291cmNlIHRoZSBDbGF1ZGUgYW5kXG4gKiBDb2RleCBhZGFwdGVycyBtZXJnZSB3aXRoIHBhcnNlQ29tbWFuZCdzIHNwYW5zLlxuICpcbiAqIFRoZSBjb21tb24vIGxheWVyIGNvbnZlbnRpb24gaXMgbG9hZC1iZWFyaW5nOiBtb2R1bGVzIGltcG9ydCBvbmx5IGBub2RlOmBcbiAqIGJ1aWx0aW5zIGFuZCBzaWJsaW5nIG1vZHVsZXMgXHUyMDE0IHplcm8gU0RLIGltcG9ydHMuIEVudmVsb3BlIG5vcm1hbGl6YXRpb25cbiAqIChgdG9vbF9yZXNwb25zZWAgXHUyMTkyIFJlc3BvbnNlUGFyc2VJbnB1dCkgaGFwcGVucyBpbiB0aGUgYWRhcHRlcnMsIHdoaWNoIGhhbmRcbiAqIHRoZSBhbHJlYWR5LW5vcm1hbGl6ZWQgc2hhcGUgZG93biBoZXJlLlxuICpcbiAqIFBoYXNlIDNhIG9mIHRoZSBUREQgYm9vdHN0cmFwIChwbGFucy9pbml0aWFsLm1kKSBpcyBsaXZlOiBjb21tYW5kIGdhdGluZyxcbiAqIHNjb3BlIHJlc3RyaWN0aW9uIGFnYWluc3QgdGhlIGNvbW1hbmQncyBkZWNsYXJlZCByb290cywgQU5TSSByZWplY3Rpb24sIHRoZVxuICogZml2ZSBzZWFyY2gtbGF5b3V0IGRlY29kZXJzLCB3aG9sZS1maWxlIGZhbGxiYWNrLCBhbmQgY29hbGVzY2luZy4gUGhhc2UgM2JcbiAqIGFkZGVkIHRoZSB1bmlmaWVkLWRpZmYgZGVjb2RlciAoYGdpdCBkaWZmYCwgZGlmZi1mb3JtIGBnaXQgc2hvd2AsIGBnaXQgbG9nXG4gKiAtcGApIHdpdGggYmluYXJ5L2NvbWJpbmVkL3N1Ym1vZHVsZSByZWplY3Rpb24sIGFuZCBQaGFzZSAzYyB0aGVcbiAqIGBnaXQgYmxhbWUgLUwgTixNIGZpbGVgIGNvbW1hbmQtdGV4dCBtYXRjaGVyLiBUaGUgZXZhbHVhdGlvbiBmaXhlcyBhZGQgdGhlXG4gKiBkZWNpc2lvbnMgdGhlIHBsYW4ncyByaXNrIHNlY3Rpb24gZGVmZXJyZWQsIGFsbCBkb2N1bWVudGVkIGhlcmU6XG4gKlxuICogLSAqKlRydW5jYXRpb24sIHR3byByZWdpbWVzKiogKHBsYW4gc3RlcCA2KTogYHRydW5jYXRlZDogdHJ1ZWAgKHRoZVxuICogICBhZGFwdGVyJ3MgYHJhd091dHB1dFBhdGhgIHByZXZpZXcgbWFya2VyKSBtZWFucyBwYXJzZSBub3RoaW5nIFx1MjAxNFxuICogICByZXNwb25zZS1kZXJpdmVkIGRlY29kZSBmYWlscyBjbG9zZWQuIGBpbnRlcnJ1cHRlZDogdHJ1ZWAgaXMgdGhlXG4gKiAgIHBsYW4ncyBjb21wbGV0ZS1yZWNvcmRzIHJlZ2ltZTogZnVsbHktdGVybWluYXRlZCByZWNvcmRzIHBhcnNlIGFuZCB0aGVcbiAqICAgaW5jb21wbGV0ZSB0YWlsIGRyb3BzIHZpYSB0aGUgdW5jb25kaXRpb25hbCB0ZXJtaW5hdGluZy1uZXdsaW5lIHJ1bGUsXG4gKiAgIHNvIHRoZSBmbGFnIGNoYW5nZXMgbm90aGluZyB0aGUgZGVmYXVsdCBwYXRoIGFscmVhZHkgZG9lcyBcdTIwMTQgaXQgaXNcbiAqICAgY29udHJhY3QgZG9jdW1lbnRhdGlvbiB0aGUgYWRhcHRlcnMgbWFwIGBpbnRlcnJ1cHRlZGAgb250byAoYSBsYXRlclxuICogICBwaGFzZSBjaGFuZ2VzIHRoZSBhZGFwdGVyczsgdW50aWwgdGhlbiB0aGV5IGNvbGxhcHNlIGl0IGludG9cbiAqICAgYHRydW5jYXRlZGAsIHdoaWNoIGZhaWxzIGNsb3NlZCBzYWZlbHkpLiBOZWl0aGVyIGNvbnRlbnQgZ2F0ZSBhcHBsaWVzXG4gKiAgIHRvIHRoZSBjb21tYW5kLXRleHQtZGVyaXZlZCBgZ2l0IGJsYW1lIC1MIE4sTWAgbWF0Y2hlciwgd2hvc2UgZXZpZGVuY2VcbiAqICAgaXMgdGhlIGNvbW1hbmQsIG5vdCB0aGUgcmVzcG9uc2UgXHUyMDE0IHRoZSBibGFtZSBicmFuY2ggcnVucyBhYm92ZSBib3RoXG4gKiAgIHRoZSBBTlNJIHJlamVjdGlvbiBhbmQgdGhlIHRydW5jYXRlZCBnYXRlLlxuICogLSAqKlNwYW4gY2FwKio6IGBNQVhfUkVTUE9OU0VfU1BBTlNgIGJvdW5kcyBob3cgbWFueSBkaXN0aW5jdCBzcGFucyBhXG4gKiAgIHJlc3BvbnNlIG1heSBlbWl0LiBNZWFzdXJlZCB0aHJvdWdoIHRoZSBkZXBsb3llZCBob29rLCBlYWNoIHNwYW4gY29zdHNcbiAqICAgfjQ2IG1zIG9mIHN1YnByb2Nlc3MgZXhlY3MgaW4gdGhlIHRvdWNoIGNvcmUgKHJlc29sdmVUb3VjaFNjb3BlICsgYGdpdFxuICogICBzcGFuIGxpc3RgIHBlciBzcGFuOyB0aGUgc2Vzc2lvbiBtZW1vIG1ha2VzIHJlcGVhdCBydW5zIGNoZWFwLCBidXQgZmlyc3RcbiAqICAgcnVucyBwYXkgdGhlIGZ1bGwgcHJpY2UpLCBhZ2FpbnN0IGEgMTAgcyBob29rcy5qc29uIHRpbWVvdXQuIDUwIHNwYW5zIFx1MjI0OFxuICogICAyLjMgcyB3b3JzdCBjYXNlIFx1MjAxNCB3ZWxsIHVuZGVyIHRoZSB0aW1lb3V0IHdpdGggbWFyZ2luIGV2ZW4gd2l0aCB0aGVcbiAqICAgY29tbWFuZC1kZXJpdmVkIHNwYW5zIG9uIHRvcC4gQmV5b25kIHRoZSBjYXAgdGhlIGJvdW5kZWQgc2V0IGlzIGVtaXR0ZWRcbiAqICAgKHRoZSBmaXJzdCA1MCBpbiBkZXRlcm1pbmlzdGljIHBhdGggb3JkZXIpIGFuZCB0aGUgcmVzdCBmYWlsIGNsb3NlZDpcbiAqICAgZXZlcnkgZW1pdHRlZCBzcGFuIGlzIGEgZ2VudWluZSBmdWxseS1vYnNlcnZlZCByZWNvcmQsIHNvIGVtaXR0aW5nIHRoZVxuICogICBib3VuZGVkIHNldCBpbnZlbnRzIG5vdGhpbmcsIGFuZCBkcm9wcGluZyB0aGUgZXhjZXNzIGtlZXBzIGhvb2sgbGF0ZW5jeVxuICogICBib3VuZGVkIG9uIGV4YWN0bHkgdGhlIHBhdGhvbG9naWNhbCBzZWFyY2hlcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBzdGFsbFxuICogICB0aGUgYWdlbnQgbG9vcC4gT25lIGNvYWxlc2NlZCBzcGFuIGNvdmVyaW5nIGEgaHVnZSB3aW5kb3cgY291bnRzIG9uY2UuXG4gKiAtICoqUGlwZWxpbmVzKio6IHRoZSByZXNwb25zZSBpcyBhdHRyaWJ1dGVkIHRvIHRoZSBGSVJTVCBnYXRlZCBzdGFnZVxuICogICAobGVmdC10by1yaWdodCB3YWxrOyBpZiBubyBzdGFnZSBnYXRlcywgbm90aGluZyB0byBwYXJzZSkuIEluIGEgcGlwZWxpbmVcbiAqICAgdGhlIGZpbmFsIHN0YWdlJ3Mgc3Rkb3V0IGlzIHRoZSBnYXRlZCBzdGFnZSdzIG91dHB1dCB3aGVuIGV2ZXJ5IGxhdGVyXG4gKiAgIHN0YWdlIGlzIFBST1ZBQkxZIFZFUkJBVElNIFx1MjAxNCB0aGUgYWxsb3dsaXN0IGlzIHRoZSBjbG9zYWJsZSBzZXQ6XG4gKiAgIGhlYWQvdGFpbC93Yy9zb3J0L3VuaXEvY3V0ICh0cnVuY2F0ZS9yZW9yZGVyL2RlZHVwZSBcdTIwMTQgZWFjaCBzdXJ2aXZpbmdcbiAqICAgbGluZSdzIGNvbnRlbnQgaXMgdmVyYmF0aW0pLCBwbGFpbiBgY2F0YCAobm8gYC1uYC9gLS1udW1iZXJgKSwgdGhlIGdyZXBcbiAqICAgZmFtaWx5IHdpdGhvdXQgbnVtYmVyZWQgZXZpZGVuY2UgKGAtbmAvYC0tbGluZS1udW1iZXJgKSBhbmQgd2l0aG91dFxuICogICBmaWxlIG9wZXJhbmRzIGJleW9uZCB0aGUgcGF0dGVybiBzbG90LCBhbmQgdGhlIGV4cHJlc3Npb24tYWxsb3dsaXN0ZWRcbiAqICAgc2VkL2F3ay9wZXJsL3RyIGNhcnZlLW91dHMgKG51bWVyaWMtYWRkcmVzcyBgcGAvYHFgL2BkYCBzY3JpcHRzLFxuICogICBjb25kaXRpb24tb25seSBOUi1jb21wYXJpc29uL3Bhcml0eSBhd2sgcHJvZ3JhbXMsIHN0cmVhbS1wb3NpdGlvblxuICogICBgcHJpbnQgaWYvdW5sZXNzICQuIE4gZGAgcGVybCBzY3JpcHRzLCBhbmQgZGlnaXQvY29sb24vbmV3bGluZS1mcmVlXG4gKiAgIGB0ciAtZGAgZGVsZXRpb25zIFx1MjAxNCBhbGwgcHJvdmFibHkgcGFzcyB3aG9sZSByZWNvcmRzIHRocm91Z2hcbiAqICAgYnl0ZS12ZXJiYXRpbSkuIEV2ZXJ5IGFsbG93bGlzdGVkIHN0YWdlIG11c3QgY2FycnkgTk8gRklMRSBPUEVSQU5EUzogYVxuICogICB0b2tlbiB0aGF0IGlzIG5vdCBhIGZsYWcgbmFtZXMgYSBmaWxlIHRoZSBzdGFnZSByZWFkcyBpbnN0ZWFkIG9mIHRoZVxuICogICBwaXBlLCBzbyB0aGUgcmVzcG9uc2UncyByZWNvcmRzIGNvbWUgZnJvbSB0aGF0IGZpbGUsIG5vdCB0aGUgZ2F0ZWRcbiAqICAgc3RhZ2UsIGFuZCBhIGNyYWZ0ZWQgcmVjb3JkIGRlY29kZXMgYXMgYSBwaGFudG9tIHRvdWNoIFx1MjAxNCB0aGF0IGZvcm1cbiAqICAgZmFpbHMgY2xvc2VkIHdpdGggdGhlIHJlc3QuIFRoZSBzYW1lIHJ1bGUgY292ZXJzIGFuIFVOUVVPVEVEIGA8YCBcdTIwMTQgYVxuICogICBzdGRpbiByZWRpcmVjdCwgc3RhbmRhbG9uZSBvciBHTFVFRCBpbnNpZGUgYSB0b2tlbiAoYGhlYWQgLTI8Y3JhZnRlZC50eHRgLFxuICogICBgZ3JlcCBuZWVkbGU8Y3JhZnRlZC50eHRgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSkgXHUyMDE0IGJlY2F1c2UgdGhlXG4gKiAgIHN0YWdlIHRoZW4gcmVhZHMgYSBmaWxlIGluc3RlYWQgb2YgdGhlIHBpcGU7IHRoZSBoYXNVbnF1b3RlZFJlZGlyZWN0XG4gKiAgIHNjYW4gaXMgcXVvdGUtYXdhcmUsIHNvIGEgcXVvdGVkIGxpdGVyYWwgYDxgIGluIGEgcGF0dGVyblxuICogICAoYHJnIC1uICc8ZGl2PidgKSBpcyBub3QgYSByZWRpcmVjdC4gVGhlIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSBoYW5kbGVzXG4gKiAgIHRoZSBjdXQuIEV2ZXJ5dGhpbmcgZWxzZSBmYWlscyBDTE9TRUQgXHUyMDE0IHRoZSBkZWZhdWx0IGlzIGludmVydGVkLCBzb1xuICogICBhbnkgc3RhZ2Ugbm90IHByb3ZhYmx5IHZlcmJhdGltIChweXRob24sIHJ1YnksIG1hd2ssIGdhd2ssIHBhc3RlLCBhbmRcbiAqICAgdGhlIHJlc3Qgb2YgYW4gdW5ib3VuZGVkIHJlbnVtYmVyZXIgc2V0KSBtYXkgcmVudW1iZXIgb3IgcmV3cml0ZSB0aGVcbiAqICAgcmVjb3JkcywgdGhlIHJlc3BvbnNlIHRoZW4gY2FycmllcyBzdHJlYW0gcG9zaXRpb25zIGluc3RlYWQgb2YgZmlsZVxuICogICBsaW5lcywgYW5kIHRoZSBwaXBlbGluZSBhdHRyaWJ1dGVzIG5vdGhpbmcuXG4gKiAgIEluIGEgYDtgL2AmJmAvYHx8YC9gJmAvbmV3bGluZSBjaGFpbiB0aGUgc2FtZSBwcm92YWJseS12ZXJiYXRpbSBjaGVja1xuICogICBhcHBsaWVzIHRvIEVWRVJZIHNpYmxpbmcgc3RhZ2UsIGluIGVpdGhlciBkaXJlY3Rpb246IGEgc2libGluZydzIG91dHB1dFxuICogICBtaXhlcyBpbnRvIHRoZSBzYW1lIHJlc3BvbnNlLCBzbyBhIGNyYWZ0ZWQgZmlsZSByZWFkIGJ5IGFueSBvZiB0aGVtXG4gKiAgIGRlY29kZXMgYXMgcGhhbnRvbSB0b3VjaGVzIFx1MjAxNCBhIGNoYWluIGlzIGF0dHJpYnV0YWJsZSBvbmx5IHdoZW4gZXZlcnlcbiAqICAgc2libGluZyBwYXNzZXMgdGhlIGFsbG93bGlzdCAoYGNkYCBzdGFnZXMsIHdob3NlIG91dHB1dCBpcyBlbXB0eSxcbiAqICAgZXhjZXB0ZWQpLiBBIGB8YC1qb2luZWQgZmVlZGVyIGVhcmxpZXIgaW4gdGhlIHBpcGVsaW5lIGlzIGNvbnN1bWVkIGJ5XG4gKiAgIHRoZSBnYXRlZCBzdGFnZSBcdTIwMTQgYSBzZWFyY2ggd2l0aCBleHBsaWNpdCByb290cyBpZ25vcmVzIHN0ZGluIFx1MjAxNCBhbmQgaXRzXG4gKiAgIHJlY29yZHMgbmV2ZXIgcmVhY2ggdGhlIHJlc3BvbnNlOyBpdCBzdGF5cyBvcGVuLlxuICogICBgY2RgIHRyYWNraW5nIGFwcGxpZXMgb25seSB1bnRpbCB0aGUgZmlyc3RcbiAqICAgZ2F0ZWQgc3RhZ2UgaXMgZm91bmQgXHUyMDE0IHRoZSBldmlkZW5jZSB3YXMgcHJvZHVjZWQgaW4gdGhhdCBkaXJlY3RvcnkuXG4gKiAtICoqU3RkaW4tZmVkIHNlYXJjaCBmYWlscyBjbG9zZWQqKjogYSBub24tZ2l0IHNlYXJjaCBiaW4gKGByZ2AvYGdyZXBgL1xuICogICBgZWdyZXBgL2BmZ3JlcGApIHdpdGggbm8gcGF0aCBhcmdzIHdob3NlIGlucHV0IGlzIHBpcGVkIG9yIHJlZGlyZWN0ZWRcbiAqICAgKGBwcmludGYgJ1x1MjAyNicgfCByZyAtbiBuZWVkbGVgLCBgPCBmaWxlYCwgYDw8PGAsIGA8KFx1MjAyNilgLCBhbmQgdGhlIEdMVUVEXG4gKiAgIGZvcm1zIFx1MjAxNCBgcmcgbmVlZGxlPGZpbGVgLCBgaGVhZCAtMjxmaWxlYCwgYSBjb25zdW1lZCBgLWVgL2AtZmAgdmFsdWVcbiAqICAgbGlrZSBgLWUgbmVlZGxlPGZpbGVgIFx1MjAxNCB3aGVyZSB0aGUgcmVkaXJlY3QgaXMgaW52aXNpYmxlIHRvIGFyZ3ZcbiAqICAgc3BsaXR0aW5nIGFuZCBvbmx5IHRoZSBxdW90ZS1hd2FyZSBoYXNVbnF1b3RlZFJlZGlyZWN0IHNjYW4gc2VlcyBpdClcbiAqICAgcmVhZHMgU1RESU4sIG5vdCBmaWxlcyBcdTIwMTQgdGhlIHJlc3BvbnNlJ3MgcmVjb3JkcyBhcmUgc3RyZWFtIHBvc2l0aW9ucyxcbiAqICAgYW5kIGRlY29kaW5nIHRoZW0gYXMgcGF0aHMgZmFicmljYXRlcyB0b3VjaGVzIChhIHN0ZGluIGxpbmUgbnVtYmVyXG4gKiAgIGxpa2UgXCI5XCIgYmVjb21lcyBhIHBhdGgsIGFuZCB3aXRoIGEgcmVhbCBmaWxlIG5hbWVkIGA5YCBhdCB0aGUgY3dkIHRoZVxuICogICBwaGFudG9tIHN1cmZhY2VzKS5cbiAqICAgU3VjaCBhbiBpbnZvY2F0aW9uIHlpZWxkcyBubyByZXNwb25zZS1kZXJpdmVkIHNwYW5zLiBFeHBsaWNpdCBwYXRoIGFyZ3NcbiAqICAgbWVhbiB0aGUgYmluIHNlYXJjaGVzIGZpbGVzICh0aGUgcmVkaXJlY3QvcGlwZSBpcyB0aGVuIGlycmVsZXZhbnQpLCBhbmRcbiAqICAgYGdpdCBncmVwYCBuZXZlciByZWFkcyBzdGRpbiBcdTIwMTQgYm90aCBwcmVzZXJ2ZWQuIFRoaXMgaW52YXJpYW50IGJpbmRzIG9ubHlcbiAqICAgdGhlIGRpcmVjdGx5LWdhdGVkIHN0YWdlOiB0aGUgYXR0cmlidXRpb24gd2FsayBzdG9wcyBhdCB0aGUgZmlyc3QgZ2F0ZWRcbiAqICAgc3RhZ2UsIHNvIGFuIHVuLWdhdGVkIGZlZWRlciBlYXJsaWVyIGluIHRoZSBwaXBlbGluZSAoZS5nLlxuICogICBgZmluZCB8IHhhcmdzIHJnIFx1MjAyNmApIG5ldmVyIHJlYWNoZXMgdGhlIHN0ZGluIHJ1bGUsIGFuZCBpdHMgZmVlZC1zaGFwZVxuICogICBpcyBubyBldmlkZW5jZSBhYm91dCB0aGUgc2VhcmNoJ3Mgc3RkaW4uXG4gKiAtICoqRGVjb2RlZCBwYXRocyBtdXN0IGJlIHJlYWwgZmlsZXMqKjogYXMgYSBmYW1pbHktd2lkZSBiYWNrc3RvcCwgYVxuICogICByZWN1cnNpdmUtbGF5b3V0IHJlY29yZCB3aG9zZSBkZWNvZGVkIHBhdGggaXMgbm90IGFuIGV4aXN0aW5nIHJlZ3VsYXJcbiAqICAgZmlsZSAodGhlIHNhbWUgYGlzRmlsZWAgY2hlY2sgdGhlIG9uZS1maWxlIGVsaWdpYmlsaXR5IHVzZXMsIHJlc29sdmluZ1xuICogICBhZ2FpbnN0IHRoZSByZWNvcmQgYmFzZSkgZHJvcHMgaW5zdGVhZCBvZiBmYWJyaWNhdGluZyBhIHRvdWNoLlxuICogLSAqKmBnaXQgc2hvdyA8cmV2Pjo8cGF0aD5gKiogKHJhdyBibG9iIGNvbnRlbnQpIGlzIGV4Y2x1ZGVkIGZyb20gdGhlIGRpZmZcbiAqICAgZ2F0ZTsgYSBkaWZmLXNoYXBlZCBibG9iIG11c3QgbmV2ZXIgZGVjb2RlIGludG8gZmFicmljYXRlZCB0b3VjaGVzLiBUaGVcbiAqICAgY29udGVudCBpZGlvbSBpcyBkZXRlY3RhYmxlIGZyb20gdGhlIGNvbW1hbmQ6IGEgYHNob3dgIHBvc2l0aW9uYWxcbiAqICAgY29udGFpbmluZyBgOmAgaXMgYSByZXY6cGF0aCwgbm90IGEgcmV2aXNpb24uXG4gKiAtICoqRGlmZiBwYXRocyBhcmUgcmVwby1yb290LXJlbGF0aXZlKio6IGdpdCBlbWl0cyBgYS9zcmMveC50c2AgaW4gZGlmZlxuICogICBvdXRwdXQgcmVnYXJkbGVzcyBvZiBjd2QsIHNvIGRpZmYgZGVjb2RlIGFuY2hvcnMgdG8gdGhlIHdvcmt0cmVlIHJvb3RcbiAqICAgKGZvdW5kIGJ5IHdhbGtpbmcgdXAgZnJvbSB0aGUgZWZmZWN0aXZlIGRpciBmb3IgYSBgLmdpdGAgZW50cnkgXHUyMDE0IG5vXG4gKiAgIHN1YnByb2Nlc3MsIHRoZSBjb21tb24gbGF5ZXIgaW1wb3J0cyBvbmx5IG5vZGU6IGJ1aWx0aW5zKS4gVHdvXG4gKiAgIGV4Y2VwdGlvbnMgcmUtYW5jaG9yIHRoZSBvdXRwdXQ6IGAtLXJlbGF0aXZlYCAoYmFyZSkgZW1pdHMgcGF0aHNcbiAqICAgcmVsYXRpdmUgdG8gdGhlIGN3ZCBhbmQgZXhjbHVkZXMgY2hhbmdlcyBvdXRzaWRlIGl0LCBhbmRcbiAqICAgYC0tcmVsYXRpdmU9PHBhdGg+YCBlbWl0cyBwYXRocyByZWxhdGl2ZSB0byBgPHBhdGg+YCByZXNvbHZlZCBhZ2FpbnN0XG4gKiAgIHRoZSB3b3JrdHJlZSByb290ICh2ZXJpZmllZCBhZ2FpbnN0IGdpdCAyLjQ3LjMpIFx1MjAxNCBib3RoIGRlY29kZSBhZ2FpbnN0XG4gKiAgIHRoYXQgYmFzZSBpbnN0ZWFkLiBgZ2l0IGRpZmYgPHJldj46PHBhdGg+IDxyZXY+OjxwYXRoPmAgKHR3by1hcmdcbiAqICAgYmxvYi1ibG9iKSBlbWl0cyBhIG5vcm1hbCB1bmlmaWVkIGRpZmYgbmFtaW5nIHRoZSBibG9iIHBhdGhzIHdoaWxlIGdpdFxuICogICByZWFkcyBvbmx5IGhpc3RvcmljYWwgYmxvYnMsIG5ldmVyIHRoZSB3b3JraW5nLXRyZWUgZmlsZXMgXHUyMDE0IGEgZGlmZlxuICogICB3aG9zZSBwb3NpdGlvbmFscyBjYXJyeSBgcmV2OnBhdGhgIHNwZWNzIChhbnkgYDpgLWNvbnRhaW5pbmcgcG9zaXRpb25hbFxuICogICB0aGF0IGlzIG5vdCBhbiBleGlzdGluZyBmaWxlKSBkZWNvZGVzIG5vdGhpbmcuXG4gKiAtICoqVW5udW1iZXJlZCBvdXRwdXQgbmV2ZXIgcGFyc2VzIGFzIG51bWJlcmVkKio6IHRoZSBvbmUtZmlsZSBsYXlvdXRcbiAqICAgcmVxdWlyZXMgY29tbWFuZC1zaWRlIG51bWJlcmVkIGV2aWRlbmNlIChgLW5gL2AtLWxpbmUtbnVtYmVyYCksIGV4YWN0bHlcbiAqICAgb25lIGV4cGxpY2l0IGZpbGUgYXJndW1lbnQgdGhhdCBpcyBhIHJlYWwgZmlsZSwgbm8gYC1IYFxuICogICAoLS13aXRoLWZpbGVuYW1lLCB3aGljaCBmb3JjZXMgcGF0aCBwcmVmaXhlcyksIGFuZCBjcm9zcy1yZWNvcmRcbiAqICAgY29uc2lzdGVuY3kgKGV2ZXJ5IHJlY29yZCBwYXJzZXMgYXMgYGxpbmU6dGV4dGApLiBUaGUgaGVhZGluZyBsYXlvdXRcbiAqICAgcmVxdWlyZXMgdGhlIG51bWJlcmVkIGV2aWRlbmNlIHRvby4gQSBkaWdpdHMtbGVhZGluZyByZWNvcmQgdGhhdCBmYWlsc1xuICogICB0aGVzZSBjaGVja3MgZmFsbHMgdGhyb3VnaCB0byB0aGUgcmVjdXJzaXZlIGxheW91dCBcdTIwMTQgYSBwdXJlLWRpZ2l0c1xuICogICBmaWxlbmFtZSAoXCI5XCIsIFwiMTIzXCIpIGVtaXR0ZWQgZmlyc3QgbXVzdCBub3QgY29sbGFwc2UgYSB3aG9sZSBzZWFyY2ggdG9cbiAqICAgdGhlIG9uZS1maWxlIGxheW91dCwgYW5kIGNvbnRlbnQgdGhhdCBtZXJlbHkgbG9va3MgbnVtYmVyZWQgbXVzdCBub3RcbiAqICAgaW52ZW50IHBvc2l0aW9ucy4gR2l0IHBhdGhzcGVjIG1hZ2ljIChgOi9gLCBgOiFgLCBgOl5gLCBgOiguLi4pYCkgaXMgbm90XG4gKiAgIGEgZmlsZXN5c3RlbSBwYXRoIGFuZCBuZXZlciBiZWNvbWVzIGEgcGVybWl0dGVkIHJvb3QuIGBnaXQgZ3JlcCA8cmV2PmBcbiAqICAgZnVzZXMgdGhlIHJldiBpbnRvIHJlY29yZCBwYXRocyAoYEhFQUQ6YS50czozOlx1MjAyNmApOyB0aG9zZSByZWNvcmRzIGRyb3AgYXNcbiAqICAgcGF0aC1hbWJpZ3VvdXMgXHUyMDE0IGZhaWwtY2xvc2VkIGFuZCBkZWZlbnNpYmxlLCBzaW5jZSB0aGUgcmV2IGlzIGtub3duIGJ1dFxuICogICBzdHJpcHBpbmcgaXQgd291bGQgZ3Vlc3MgYXQgYSBwYXRoIHRoZSByZXNwb25zZSBkb2VzIG5vdCBjYXJyeS5cbiAqIC0gKipXaG9sZS10cmVlIGBnaXQgZ3JlcGAgZnJvbSBhIHN1YmRpciBhbmNob3JzIHRvIHRoZSB3b3JrdHJlZSByb290Kio6XG4gKiAgIHBhdGhzcGVjIG1hZ2ljIChgOi9gLCBgOiFgLCBgOl5gLCBgOiguLi4pYCkgc2VhcmNoZXMgdGhlIHdob2xlIHRyZWUgYW5kXG4gKiAgIGVtaXRzIGN3ZC1yZWxhdGl2ZSByZWNvcmRzIHdpdGggYC4uL2AgcHJlZml4ZXM7IGAtLWZ1bGwtbmFtZWAgKHRoZSByZWFsXG4gKiAgIGdpdCBvcHRpb24gXHUyMDE0IGAtLWZ1bGwtdHJlZWAgZG9lcyBub3QgZXhpc3Qgb24gZ2l0IDIuNDcuMyBhbmQgZXJyb3JzIHdpdGhcbiAqICAgYSB1c2FnZSByZXNwb25zZSB0aGF0IHBhcnNlcyB0byBub3RoaW5nKSByZS1hbmNob3JzIHJlY29yZHMgdG9cbiAqICAgcmVwby1yb290LXJlbGF0aXZlIHBhdGhzLiBCb3RoIGFuY2hvciB0aGUgcGVybWl0dGVkIHJvb3QgXHUyMDE0IGFuZCwgZm9yXG4gKiAgIGAtLWZ1bGwtbmFtZWAsIHRoZSByZXNvbHV0aW9uIGJhc2UgXHUyMDE0IHRvIHRoZSB3b3JrdHJlZSByb290LCBzbyBldmVyeVxuICogICBpbi1yZXBvIHJlY29yZCBwYXNzZXMgY29udGFpbm1lbnQuIFBsYWluIHN1YmRpciBgZ2l0IGdyZXBgIChub1xuICogICBwYXRoc3BlYykgaXMgc2NvcGVkIHRvIHRoZSBzdWJkaXIgYnkgZ2l0IGl0c2VsZiBhbmQga2VlcHMgdGhlXG4gKiAgIGVmZmVjdGl2ZS1kaXIgcm9vdC5cbiAqIC0gKipDb250ZXh0IHJlY29yZHMgd2l0aCBkYXNoZXMgaW4gdGhlIHBhdGgqKiBkZWNvZGUgYnkgYW5jaG9yaW5nIHRvIHRoZVxuICogICBleGFjdCBwYXRocyB0aGUgcmVzcG9uc2UncyBgcGF0aDpsaW5lOnRleHRgIG1hdGNoIHJlY29yZHMgZXN0YWJsaXNoLFxuICogICB3aXRoIHRoZSBkYXNoIHNwbGl0IGFzIHRoZSBkYXNoLWZyZWUgZmFsbGJhY2sgXHUyMDE0IGEgYC1DYCB3aW5kb3cgb25cbiAqICAgYHNyYy9teS1maWxlLnRzYCBtdXN0IG5vdCBjb2xsYXBzZSB0byB0aGUgYmFyZSBtYXRjaCBsaW5lLlxuICpcbiAqIFRoZSBhY2NlcHRhbmNlIGNoZWNrcyBpbiB0ZXN0L2NvbW1vbi9wYXJzZS1yZXNwb25zZS50ZXN0LnRzIHdlcmUgd3JpdHRlblxuICogaW4gUGhhc2UgMi5cbiAqL1xuaW1wb3J0IHsgZXhpc3RzU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4sIHJlc29sdmUgYXMgcmVzb2x2ZVBhdGgsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb3VudEZpbGVMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB0eXBlIHsgUmVzb2x2ZWRTcGFuIH0gZnJvbSAnLi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IGFyZ3ZPZiwgaGFzVW5xdW90ZWRSZWRpcmVjdCwgc3BsaXRUb3BMZXZlbCwgdHlwZSBPcGVyYXRvciB9IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuXG4vKipcbiAqIFRoZSBub3JtYWxpemVkIHRvb2wtcmVzcG9uc2UgaW5wdXQgdGhlIGFkYXB0ZXJzIGhhbmQgdGhlIHNoYXJlZCBwYXJzZXIuXG4gKiBgc3Rkb3V0YCBpcyB0aGUgKHBvc3NpYmx5IHByZXZpZXcpIG91dHB1dCB0ZXh0OyBgc3RkZXJyYCBhbmQgYGV4aXRTdGF0dXNgXG4gKiBhcmUgY2FycmllZCBmb3IgZGlhZ25vc3RpY3MgYW5kIGFyZSBuZXZlciBwYXJzZSBnYXRlcyBcdTIwMTQgYGdpdCBkaWZmXG4gKiAtLWV4aXQtY29kZWAgZXhpdHMgMSBvbiBkaWZmZXJlbmNlcywgc28gZXhpdCBzdGF0dXMgbXVzdCBub3QgYmUgdHJlYXRlZCBhc1xuICogZmFpbHVyZS4gUGxhbiBzdGVwIDYncyB0d28gdHJ1bmNhdGlvbiByZWdpbWVzIGFyZSBkaXN0aW5jdCBmaWVsZHM6XG4gKlxuICogLSBgdHJ1bmNhdGVkYCAoQ2xhdWRlIGByYXdPdXRwdXRQYXRoYCBzZXQgXHUyMUQyIGlubGluZSBzdGRvdXQgaXMgb25seSBhXG4gKiAgIHByZXZpZXcpIGlzIHN0cmljdCBtb2RlOiByZXNwb25zZS1kZXJpdmVkIGRlY29kZSBwYXJzZXMgbm90aGluZyBhbmRcbiAqICAgaW52ZW50cyBubyB0b3VjaGVzLiBUaGUgY29tbWFuZC10ZXh0LWRlcml2ZWQgYGdpdCBibGFtZSAtTGAgbWF0Y2hlciBpc1xuICogICBleGVtcHQgXHUyMDE0IGl0cyBldmlkZW5jZSBpcyB0aGUgY29tbWFuZCwgbm90IHRoZSByZXNwb25zZS5cbiAqIC0gYGludGVycnVwdGVkYCBpcyB0aGUgY29tcGxldGUtcmVjb3JkcyByZWdpbWU6IGZ1bGx5LXRlcm1pbmF0ZWQgcmVjb3Jkc1xuICogICBwYXJzZSBhbmQgdGhlIGluY29tcGxldGUgdGFpbCBkcm9wcy4gVGhlIHVuY29uZGl0aW9uYWwgdGVybWluYXRpbmctXG4gKiAgIG5ld2xpbmUgcnVsZSBhbHJlYWR5IGRvZXMgZXhhY3RseSB0aGF0LCBzbyB0aGUgZmxhZyBpcyBjb250cmFjdFxuICogICBkb2N1bWVudGF0aW9uIHRoZSBhZGFwdGVycyBtYXAgYGludGVycnVwdGVkOiB0cnVlYCBvbnRvOyBpdCBuZXZlclxuICogICBzdXBwcmVzc2VzIGEgcmVzcG9uc2UgdGhlIGRlZmF1bHQgcGF0aCB3b3VsZCBwYXJzZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZXNwb25zZVBhcnNlSW5wdXQge1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIGN3ZDogc3RyaW5nO1xuICBzdGRvdXQ6IHN0cmluZztcbiAgc3RkZXJyPzogc3RyaW5nO1xuICBleGl0U3RhdHVzPzogbnVtYmVyOyAvLyBtZXRhZGF0YSBvbmx5IFx1MjAxNCBuZXZlciBnYXRlcyAoZ2l0IGRpZmYgZXhpdHMgMSBvbiBkaWZmZXJlbmNlcylcbiAgdHJ1bmNhdGVkPzogYm9vbGVhbjtcbiAgaW50ZXJydXB0ZWQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFRoZSBtYXhpbXVtIG51bWJlciBvZiBkaXN0aW5jdCBzcGFucyBgcGFyc2VSZXNwb25zZWAgbWF5IGVtaXQuIE1lYXN1cmVkXG4gKiB0aHJvdWdoIHRoZSBkZXBsb3llZCBob29rLCBlYWNoIHNwYW4gY29zdHMgfjQ2IG1zIG9mIHN1YnByb2Nlc3MgZXhlY3MgaW5cbiAqIHRoZSB0b3VjaCBjb3JlIChyZXNvbHZlVG91Y2hTY29wZSArIGBnaXQgc3BhbiBsaXN0YCBwZXIgc3BhbjsgdGhlIHNlc3Npb25cbiAqIG1lbW8gbWFrZXMgcmVwZWF0IHJ1bnMgY2hlYXAsIGJ1dCBmaXJzdCBydW5zIHBheSB0aGUgZnVsbCBwcmljZSkgYWdhaW5zdCBhXG4gKiAxMCBzIGhvb2tzLmpzb24gdGltZW91dCBcdTIwMTQgNTAgc3BhbnMgXHUyMjQ4IDIuMyBzIHdvcnN0IGNhc2UsIHdlbGwgdW5kZXIgdGhlXG4gKiB0aW1lb3V0IHdpdGggbWFyZ2luIGV2ZW4gd2l0aCB0aGUgY29tbWFuZC1kZXJpdmVkIHNwYW5zIG9uIHRvcC4gVGhlIHBsYW4nc1xuICogcmlzayBzZWN0aW9uIGRlZmVycmVkIHRoaXMgY2FwIChcImZhaWwgY2xvc2VkIGJleW9uZCBpdFwiKSB0byBhIFBoYXNlIDNhXG4gKiBtZWFzdXJlbWVudDsgdGhlIGdvbGRlbiBtYXRyaXgncyBsYXJnZXN0IHJlYWxpc3RpYyBvdXRwdXRzIHN0YXkgZmFyIGJlbG93XG4gKiBpdCwgc28gaXQgYmluZHMgb25seSBwYXRob2xvZ2ljYWwgc2VhcmNoZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBNQVhfUkVTUE9OU0VfU1BBTlMgPSA1MDtcblxuLyoqXG4gKiBBIHNpbmdsZSBkZWNvZGVkIHNlYXJjaC1vdXRwdXQgcmVjb3JkLiBUaGUgcGF0aC9saW5lIHNwbGl0IGlzIGxheW91dC1cbiAqIGRlcGVuZGVudDogYHBhdGg6bGluZTp0ZXh0YCAocmVjdXJzaXZlKSwgYHBhdGgtbGluZTp0ZXh0YCAoY29udGV4dCBsaW5lcyBpblxuICogLUEvLUIvLUMgZ3JvdXBzIGNhcnJ5IG5vIG51bWJlciBcdTIwMTQgYGxpbmVgIGlzIG51bGwgYW5kIHRoZSByZWNvcmQgYWR2YW5jZXNcbiAqIHRoZSBwZXItZmlsZSBjb3VudGVyIGluc3RlYWQpLCBgbGluZTp0ZXh0YCAob25lLWZpbGUgbGF5b3V0KSwgb3IgYVxuICogTlVMLXRlcm1pbmF0ZWQgYHBhdGg6MTpcdTIwMjZgIHJlY29yZCAoYC16YCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2VhcmNoUmVjb3JkIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVGhlIHJlY29yZCdzIGxpbmUgbnVtYmVyLCBvciBudWxsIGZvciBjb250ZXh0IGxpbmVzIHdpdGhvdXQgb25lLiAqL1xuICBsaW5lOiBudW1iZXIgfCBudWxsO1xuICB0ZXh0OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgcmVjb2duaXplZCBzZWFyY2ggb3V0cHV0IGxheW91dHMgdGhlIGRlY29kZXJzIGRpc3Rpbmd1aXNoLiAqL1xuZXhwb3J0IHR5cGUgU2VhcmNoTGF5b3V0ID0gJ3JlY3Vyc2l2ZScgfCAnY29udGV4dCcgfCAnaGVhZGluZycgfCAnbnVsbC1zZXBhcmF0ZWQnIHwgJ29uZS1maWxlJztcblxuLyoqXG4gKiBPbmUgZmlsZSdzIHNlY3Rpb24gb2YgYSB1bmlmaWVkLWRpZmYgcmVzcG9uc2UuIGBvbGRQYXRoYC9gbmV3UGF0aGAgYXJlIHRoZVxuICogYGEvYC1gYi9gLXByZWZpeGVkIHNpZGVzIHdpdGggdGhlIHByZWZpeCBzdHJpcHBlZDsgbnVsbCBmb3IgYC9kZXYvbnVsbGBcbiAqIChuZXctZmlsZSAvIGRlbGV0ZWQtZmlsZSBzaWRlcykuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGlmZkZpbGVSZWNvcmQge1xuICBvbGRQYXRoOiBzdHJpbmcgfCBudWxsO1xuICBuZXdQYXRoOiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogUmVuYW1lL2NvcHkgbWV0YWRhdGEgKGByZW5hbWUgZnJvbWAvYHJlbmFtZSB0b2AsIGBjb3B5IGZyb21gL2Bjb3B5IHRvYCk6XG4gICAqIHRoZSBuZXcgcGF0aCBpcyB0aGUgdG91Y2ggdGFyZ2V0LlxuICAgKi9cbiAgcmVuYW1lOiB7IGZyb206IHN0cmluZzsgdG86IHN0cmluZyB9IHwgbnVsbDtcbiAgYmluYXJ5OiBib29sZWFuO1xuICBjb21iaW5lZDogYm9vbGVhbjtcbiAgc3VibW9kdWxlOiBib29sZWFuO1xuICBodW5rczogRGlmZkh1bmtbXTtcbn1cblxuLyoqXG4gKiBBIHVuaWZpZWQtZGlmZiBodW5rIGhlYWRlciAoYEBAIC1hLGIgK2MsZCBAQGApOyBhbiBvbWl0dGVkIGNvdW50IG1lYW5zIDEuXG4gKiBQZXItc2lkZSByYW5nZXMgYXJlIGBvbGRTdGFydC4ub2xkU3RhcnQrb2xkQ291bnQtMWAgb24gdGhlIG9sZCBwYXRoIGFuZFxuICogYG5ld1N0YXJ0Li5uZXdTdGFydCtuZXdDb3VudC0xYCBvbiB0aGUgbmV3IHBhdGguXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGlmZkh1bmsge1xuICBvbGRTdGFydDogbnVtYmVyO1xuICBvbGRDb3VudDogbnVtYmVyO1xuICBuZXdTdGFydDogbnVtYmVyO1xuICBuZXdDb3VudDogbnVtYmVyO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbW1hbmQgYW5hbHlzaXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBTRUFSQ0hfQklOUyA9IG5ldyBTZXQoWydyZycsICdncmVwJywgJ2VncmVwJywgJ2ZncmVwJ10pO1xuXG4vKipcbiAqIFNob3J0IG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgdmFsdWUgKHJnL2dyZXApOiAtQS8tQi8tQyAoY29udGV4dCksIC1lLy1mXG4gKiAocGF0dGVybi9maWxlKSwgLW0gKG1heCBjb3VudCksIC1nLy10Ly1UIChyZyB0eXBlL2dsb2IpLiBBbnl0aGluZyBlbHNlIGluIGFcbiAqIHNob3J0IGNsdXN0ZXIgaXMgYSBwbGFpbiBmbGFnLlxuICovXG5jb25zdCBWQUxVRV9TSE9SVF9GTEFHUyA9IG5ldyBTZXQoWydBJywgJ0InLCAnQycsICdlJywgJ2YnLCAnbScsICdnJywgJ3QnLCAnVCddKTtcblxuLyoqIExvbmcgb3B0aW9ucyB0aGF0IGNvbnN1bWUgYSBzZXBhcmF0ZSB2YWx1ZSBhcmd1bWVudC4gKi9cbmNvbnN0IFZBTFVFX0xPTkdfRkxBR1MgPSBuZXcgU2V0KFtcbiAgJ2FmdGVyLWNvbnRleHQnLFxuICAnYmVmb3JlLWNvbnRleHQnLFxuICAnY29udGV4dCcsXG4gICdtYXgtY291bnQnLFxuICAncmVnZXhwJyxcbiAgJ2ZpbGUnLFxuICAnZ2xvYicsXG4gICdpZ2xvYicsXG4gICd0eXBlJyxcbiAgJ3R5cGUtbm90JyxcbiAgJ2luY2x1ZGUnLFxuICAnZXhjbHVkZScsXG4gICdleGNsdWRlLWRpcicsXG4gICdleGNsdWRlLWZyb20nXG5dKTtcblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuaW50ZXJmYWNlIFNlYXJjaEFyZ3ZJbmZvIHtcbiAgLyoqXG4gICAqIFBvc2l0aW9uYWwgcGF0aCBhcmdzOyBlbXB0eSB3aGVuIHRoZSBjb21tYW5kIG5hbWVkIG5vbmUuIFRoZSBmaXJzdFxuICAgKiBwb3NpdGlvbmFsIGlzIHRoZSBwYXR0ZXJuIHVubGVzcyB0aGUgcGF0dGVybiBjYW1lIGZyb20gYSBmbGFnIHZhbHVlXG4gICAqIChgLWVgL2AtZmAvYC0tcmVnZXhwYC9gLS1maWxlYCksIGluIHdoaWNoIGNhc2UgZXZlcnkgcG9zaXRpb25hbCBpcyBhXG4gICAqIHBhdGguXG4gICAqL1xuICBwYXRoQXJnczogc3RyaW5nW107XG4gIC8qKiBXaGV0aGVyIC1BLy1CLy1DIChhbnkgY29udGV4dCB3aW5kb3cpIHdhcyByZXF1ZXN0ZWQuICovXG4gIGNvbnRleHRGbGFnczogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGNvbW1hbmQgcmVxdWVzdGVkIGxpbmUgbnVtYmVycyAoYC1uYC9gLS1saW5lLW51bWJlcmApLiByZyBhbmRcbiAgICogZ3JlcCBib3RoIGRlZmF1bHQgdG8gTk8gbGluZSBudW1iZXJzIHdoZW4gcGlwZWQsIHNvIHRoaXMgaXMgdGhlXG4gICAqIGNvbW1hbmQtc2lkZSBldmlkZW5jZSB0aGF0IGBsaW5lOnRleHRgLW9ubHkgb3V0cHV0IGlzIG51bWJlcmVkIG91dHB1dCBcdTIwMTRcbiAgICogdGhlIG9uZS1maWxlIGFuZCBoZWFkaW5nIGxheW91dHMgcmVmdXNlIHRvIGFwcGx5IHdpdGhvdXQgaXQuIEEgbnVtYmVyZWRcbiAgICogY29tbWFuZCB3aG9zZSByZWNvcmRzIGFsbCBmYWlsIHRvIGRlY29kZSBtdXN0IG5vdCBmYWxsIGJhY2sgdG8gYVxuICAgKiB3aG9sZS1maWxlIHNwYW4gXHUyMDE0IHRoZSByZWNvcmRzIG1heSBoYXZlIGJlZW4gcmVudW1iZXJlZCBvciBkZXN0cm95ZWQgYnkgYVxuICAgKiBsYXRlciBwaXBlbGluZSBzdGFnZS5cbiAgICovXG4gIG51bWJlcmVkOiBib29sZWFuO1xuICAvKiogV2hldGhlciBgLUhgL2AtLXdpdGgtZmlsZW5hbWVgIHdhcyByZXF1ZXN0ZWQgXHUyMDE0IHJlY29yZHMgY2FycnkgcGF0aCBwcmVmaXhlcyBldmVuIGZvciBhIHNpbmdsZSBmaWxlLiAqL1xuICB3aXRoRmlsZW5hbWU6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIGFueSBwb3NpdGlvbmFsIHdhcyBnaXQgcGF0aHNwZWMgbWFnaWMgKGA6L2AsIGA6IWAsIGA6XmAsXG4gICAqIGA6KC4uLilgKSBcdTIwMTQgYSB3aG9sZS10cmVlIG9yIGV4Y2x1c2lvbiBzcGVjLCBuZXZlciBhIGZpbGVzeXN0ZW0gcm9vdC5cbiAgICogV2hlbiBwcmVzZW50LCBnaXQgZ3JlcCBzZWFyY2hlcyBiZXlvbmQgdGhlIGN3ZCwgc28gdGhlIHBlcm1pdHRlZCByb290XG4gICAqIGFuY2hvcnMgdG8gdGhlIHdvcmt0cmVlIHJvb3QgaW5zdGVhZCBvZiB0aGUgZWZmZWN0aXZlIGRpci5cbiAgICovXG4gIHBhdGhzcGVjTWFnaWM6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgc3RkaW4gcmVkaXJlY3QgKGA8YCwgYDw8PGAsIGA8KFx1MjAyNmApIGFwcGVhcnM6IHRoZSBiaW4gcmVhZHNcbiAgICogU1RESU4sIGFuZCB0aGUgdG9rZW5zIGFmdGVyIHRoZSByZWRpcmVjdCBhcmUgaXRzIHRhcmdldHMsIG5ldmVyIHNlYXJjaFxuICAgKiByb290cyBcdTIwMTQgdGhlIHBvc2l0aW9uYWwgc2NhbiBzdG9wcyB0aGVyZS5cbiAgICovXG4gIHN0ZGluUmVkaXJlY3Q6IGJvb2xlYW47XG59XG5cbi8qKlxuICogV2hldGhlciBgcGAgaXMgYSBnaXQgcGF0aHNwZWMgbWFnaWMgcHJlZml4IChgOi9gLCBgOiFgLCBgOl5gLCBgOiguLi4pYCkgXHUyMDE0XG4gKiBhIG5vbi1maWxlc3lzdGVtIHBhdGggZm9ybSB0aGF0IG11c3QgbmV2ZXIgYmVjb21lIGEgcGVybWl0dGVkIHJvb3QuIEFcbiAqIGxpdGVyYWwgYGN3ZC86L2Agcm9vdCB3b3VsZCByZWplY3QgZXZlcnkgZGVjb2RlZCByZWNvcmQ7IHRyZWF0aW5nIHBhdGhzcGVjXG4gKiBtYWdpYyBsaWtlIG5vIHBhdGggYXJncyBsZXRzIHJvb3RzIGZhbGwgYmFjayB0byB0aGUgZWZmZWN0aXZlIGN3ZC5cbiAqL1xuZnVuY3Rpb24gaXNQYXRoc3BlY01hZ2ljKHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL146Wy8hXi4oXS8udGVzdChwKTtcbn1cblxuLyoqXG4gKiBTY2FuIGEgc2VhcmNoIGNvbW1hbmQncyBhcmd2IChzdGFydGluZyBhZnRlciB0aGUgYmluYXJ5LCBvciBhZnRlciB0aGVcbiAqIGBncmVwYCBzdWJjb21tYW5kIGZvciBnaXQgZ3JlcCkgZm9yIHRoZSBwb3NpdGlvbmFsIGFyZ3MgYW5kIGNvbnRleHQgZmxhZ3MsXG4gKiBjb25zdW1pbmcgb3B0aW9uIHZhbHVlcyBzbyB0aGV5IGFyZSBuZXZlciBtaXN0YWtlbiBmb3IgcG9zaXRpb25hbHMuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVTZWFyY2hBcmd2KGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogU2VhcmNoQXJndkluZm8ge1xuICBjb25zdCBwb3NpdGlvbmFsczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGNvbnRleHRGbGFncyA9IGZhbHNlO1xuICBsZXQgbnVtYmVyZWQgPSBmYWxzZTtcbiAgbGV0IHdpdGhGaWxlbmFtZSA9IGZhbHNlO1xuICBsZXQgcGF0dGVybkZyb21GbGFnID0gZmFsc2U7XG4gIGxldCBzdGRpblJlZGlyZWN0ID0gZmFsc2U7XG4gIGxldCBpID0gc3RhcnQ7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgcG9zaXRpb25hbHMucHVzaCguLi5hcmd2LnNsaWNlKGkgKyAxKSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnPCcpKSB7XG4gICAgICAvLyBBIHN0ZGluIHJlZGlyZWN0IChgPGAsIGA8PDxgLCBgPChcdTIwMjZgKTogdGhlIGJpbiByZWFkcyBzdGRpbiwgYW5kIHRoZVxuICAgICAgLy8gZm9sbG93aW5nIHRva2VucyBhcmUgcmVkaXJlY3QgdGFyZ2V0cywgbm90IHNlYXJjaCByb290cy5cbiAgICAgIHN0ZGluUmVkaXJlY3QgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tJykpIHtcbiAgICAgIGNvbnN0IGVxID0gYS5pbmRleE9mKCc9Jyk7XG4gICAgICBjb25zdCBuYW1lID0gZXEgPT09IC0xID8gYS5zbGljZSgyKSA6IGEuc2xpY2UoMiwgZXEpO1xuICAgICAgaWYgKG5hbWUgPT09ICdhZnRlci1jb250ZXh0JyB8fCBuYW1lID09PSAnYmVmb3JlLWNvbnRleHQnIHx8IG5hbWUgPT09ICdjb250ZXh0JykgY29udGV4dEZsYWdzID0gdHJ1ZTtcbiAgICAgIGlmIChuYW1lID09PSAnbGluZS1udW1iZXInKSBudW1iZXJlZCA9IHRydWU7XG4gICAgICBpZiAobmFtZSA9PT0gJ3dpdGgtZmlsZW5hbWUnKSB3aXRoRmlsZW5hbWUgPSB0cnVlO1xuICAgICAgaWYgKG5hbWUgPT09ICdyZWdleHAnIHx8IG5hbWUgPT09ICdmaWxlJykgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTtcbiAgICAgIGlmIChlcSA9PT0gLTEgJiYgVkFMVUVfTE9OR19GTEFHUy5oYXMobmFtZSkpIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nICYmIGEubGVuZ3RoID4gMSkge1xuICAgICAgbGV0IGNvbnN1bWVzTmV4dCA9IGZhbHNlO1xuICAgICAgZm9yIChsZXQgaiA9IDE7IGogPCBhLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBhW2pdO1xuICAgICAgICBpZiAoYyA9PT0gJ0EnIHx8IGMgPT09ICdCJyB8fCBjID09PSAnQycpIGNvbnRleHRGbGFncyA9IHRydWU7XG4gICAgICAgIGlmIChjID09PSAnbicpIG51bWJlcmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGMgPT09ICdIJykgd2l0aEZpbGVuYW1lID0gdHJ1ZTtcbiAgICAgICAgaWYgKGMgPT09ICdlJyB8fCBjID09PSAnZicpIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7XG4gICAgICAgIGlmIChWQUxVRV9TSE9SVF9GTEFHUy5oYXMoYykpIHtcbiAgICAgICAgICAvLyBBIHZhbHVlLXRha2luZyBmbGFnIGNvbnN1bWVzIHRoZSByZXN0IG9mIHRoZSBjbHVzdGVyIGFzIGl0cyB2YWx1ZVxuICAgICAgICAgIC8vICgtQzEpIG9yLCB3aGVuIGxhc3QsIHRoZSBuZXh0IGFyZ3VtZW50ICgtQyAxKS5cbiAgICAgICAgICBjb25zdW1lc05leHQgPSBqID09PSBhLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGkgKz0gY29uc3VtZXNOZXh0ID8gMiA6IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cbiAgLy8gVGhlIGZpcnN0IHBvc2l0aW9uYWwgaXMgdGhlIHBhdHRlcm4gXHUyMDE0IHVubGVzcyB0aGUgcGF0dGVybiBjYW1lIGZyb20gYVxuICAvLyBmbGFnIHZhbHVlIChgLWVgL2AtZmAvYC0tcmVnZXhwYC9gLS1maWxlYCwgc2VwYXJhdGUgb3IgZ2x1ZWQpLCBpbiB3aGljaFxuICAvLyBjYXNlIGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYW4gZXhwbGljaXQgc2VhcmNoIHJvb3QsIGV4YWN0bHkgYXNcbiAgLy8gaGFzR3JlcEZpbGVPcGVyYW5kIHRyZWF0cyBhIGdyZXAtZmFtaWx5IHBpcGVsaW5lIHN0YWdlLiBHaXQgcGF0aHNwZWNcbiAgLy8gbWFnaWMgaXMgbm90IGEgZmlsZXN5c3RlbSBwYXRoIGFuZCBuZXZlciBiZWNvbWVzIGEgcm9vdCBcdTIwMTQgYnV0IGl0c1xuICAvLyBwcmVzZW5jZSBpcyB0cmFja2VkLCBiZWNhdXNlIGl0IG1ha2VzIGdpdCBncmVwIHNlYXJjaCB0aGUgd2hvbGUgdHJlZVxuICAvLyBmcm9tIGEgc3ViZGlyLlxuICBjb25zdCBmaXJzdFBvc2l0aW9uYWwgPSBwYXR0ZXJuRnJvbUZsYWcgPyAwIDogMTtcbiAgY29uc3QgcGF0aEFyZ3MgPVxuICAgIHBvc2l0aW9uYWxzLmxlbmd0aCA+IGZpcnN0UG9zaXRpb25hbCA/IHBvc2l0aW9uYWxzLnNsaWNlKGZpcnN0UG9zaXRpb25hbCkuZmlsdGVyKChwKSA9PiAhaXNQYXRoc3BlY01hZ2ljKHApKSA6IFtdO1xuICBjb25zdCBwYXRoc3BlY01hZ2ljID1cbiAgICBwb3NpdGlvbmFscy5sZW5ndGggPiBmaXJzdFBvc2l0aW9uYWwgJiYgcG9zaXRpb25hbHMuc2xpY2UoZmlyc3RQb3NpdGlvbmFsKS5zb21lKChwKSA9PiBpc1BhdGhzcGVjTWFnaWMocCkpO1xuICByZXR1cm4geyBwYXRoQXJncywgY29udGV4dEZsYWdzLCBudW1iZXJlZCwgd2l0aEZpbGVuYW1lLCBwYXRoc3BlY01hZ2ljLCBzdGRpblJlZGlyZWN0IH07XG59XG5cbmludGVyZmFjZSBHaXRTdWJjb21tYW5kSW5mbyB7XG4gIC8qKiBUaGUgYGdpdCAtQ2AgZGlyZWN0b3J5LCB3aGVuIHByZXNlbnQgYW5kIHN0YXRpY2FsbHkgcmVzb2x2YWJsZS4gKi9cbiAgZGlyOiBzdHJpbmcgfCBudWxsO1xuICBkaXJVbnJlc29sdmFibGU6IGJvb2xlYW47XG4gIC8qKiBUaGUgc3ViY29tbWFuZCB0b2tlbiAoYGdyZXBgLCBgZGlmZmAsIGBzaG93YCwgYGxvZ2AsIGBibGFtZWAsIFx1MjAyNikuICovXG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgLyoqIEluZGV4IGp1c3QgcGFzdCB0aGUgc3ViY29tbWFuZCwgd2hlcmUgaXRzIGFyZ3YgYmVnaW5zLiAqL1xuICBzdGFydDogbnVtYmVyO1xufVxuXG4vKipcbiAqIExvY2F0ZSB0aGUgc3ViY29tbWFuZCB0b2tlbiBvZiBhIGBnaXRgIGNvbW1hbmQsIGhvbm9yaW5nIGAtQ2AvYC1jYCBsaWtlXG4gKiBwYXJzZS1jb21tYW5kLnRzJ3MgZmluZEdpdFN1YmNvbW1hbmQuIFJldHVybnMgbnVsbCB3aGVuIG5vIHN1YmNvbW1hbmRcbiAqIHRva2VuIGFwcGVhcnMgKGJhcmUgYGdpdGApLiBXaGljaCBzdWJjb21tYW5kcyByZXNwb25zZS1kZWNvZGUgaXMgdGhlXG4gKiBnYXRlJ3MgY2FsbCwgbm90IHRoaXMgc2Nhbm5lcidzLlxuICovXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChhcmd2OiBzdHJpbmdbXSk6IEdpdFN1YmNvbW1hbmRJbmZvIHwgbnVsbCB7XG4gIGxldCBkaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgZGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMTtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gYXJndltpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgZGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgZGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IGRpciwgZGlyVW5yZXNvbHZhYmxlLCBzdWJjb21tYW5kOiBhLCBzdGFydDogaSArIDEgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIEEgcmVzcG9uc2UtZGVyaXZhYmxlIGNvbW1hbmQgdGhhdCBwYXNzZWQgdGhlIGdhdGUsIHdpdGggaXRzIGRlY29kZXIncyBpbnB1dHMuICovXG50eXBlIEdhdGVkQ29tbWFuZCA9IHtcbiAga2luZDogJ3NlYXJjaCcgfCAnZGlmZicgfCAnYmxhbWUnO1xuICBhcmd2OiBzdHJpbmdbXTtcbiAgLyoqIEluZGV4IGp1c3QgcGFzdCB0aGUgYmluYXJ5IChzZWFyY2gpIG9yIHN1YmNvbW1hbmQgKGdpdCksIHdoZXJlIGl0cyBhcmd2IGJlZ2lucy4gKi9cbiAgc3RhcnQ6IG51bWJlcjtcbiAgLyoqIFRoZSBgZ2l0IC1DYCBkaXJlY3RvcnksIHdoZW4gcHJlc2VudCBhbmQgc3RhdGljYWxseSByZXNvbHZhYmxlLiAqL1xuICBkaXI6IHN0cmluZyB8IG51bGw7XG4gIGRpclVucmVzb2x2YWJsZTogYm9vbGVhbjtcbn07XG5cbi8qKiBXaGV0aGVyIGEgYGdpdCBsb2dgIGludm9jYXRpb24gaXMgZGlmZi1mb3JtIChgLXBgL2AtLXBhdGNoYCBwcmVzZW50KS4gKi9cbmZ1bmN0aW9uIGhhc0RpZmZQYXRjaEZsYWcoYXJndjogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBib29sZWFuIHtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGlmIChhcmd2W2ldID09PSAnLXAnIHx8IGFyZ3ZbaV0gPT09ICctLXBhdGNoJykgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IHNob3dgIGludm9jYXRpb24gaXMgdGhlIGA8cmV2Pjo8cGF0aD5gIGNvbnRlbnQgaWRpb20gd2hvc2VcbiAqIHN0ZG91dCBpcyB0aGUgYmxvYidzIFJBVyBjb250ZW50LCBuZXZlciBkaWZmLWZvcm0uIGBnaXQgc2hvd2AgcG9zaXRpb25hbHNcbiAqIGFyZSByZXZpc2lvbnMsIGFuZCBvbmx5IGEgcmV2OnBhdGggc3BlYyBlbWJlZHMgYSBjb2xvbiBcdTIwMTQgYSBkaWZmLXNoYXBlZFxuICogdmVuZG9yZWQgYmxvYiAoYSAucGF0Y2gsIGEgZm9ybWF0LXBhdGNoIGFyY2hpdmUpIG11c3Qgbm90IGRlY29kZSBpbnRvXG4gKiBmYWJyaWNhdGVkIHRvdWNoZXMgb24gdGhlIGZpbGVzIGl0cyBjb250ZW50IG5hbWVzLiBPcHRpb24gdmFsdWVzIGFyZVxuICogc2tpcHBlZCBzbyBgLS1mb3JtYXQgJUg6JXNgICh3aGljaCBsZWdpdGltYXRlbHkgY29udGFpbnMgYSBjb2xvbikgY2Fubm90XG4gKiBmYWxzZS1wb3NpdGl2ZTsgYWZ0ZXIgYC0tYCB0aGUgdG9rZW5zIGFyZSBsaXRlcmFsIHBhdGhzcGVjcywgbm90IHJldnMuXG4gKiBPbmx5IGZsYWdzIHRoYXQgY29uc3VtZSBhIFNFUEFSQVRFIGFyZ3VtZW50IHNraXAgdGhlaXIgdmFsdWU6IGAtLXN0YXRgIGFuZFxuICogYC0tZGlyc3RhdGAgdGFrZSB0aGVpcnMgdmlhIGA9YCAoYC0tZGlyc3RhdD1maWxlcywxMGApIG9yIG5vdCBhdCBhbGwsIHNvIGFcbiAqIGBnaXQgc2hvdyAtLXN0YXQgPHJldj46PHBhdGg+YCBtdXN0IG5vdCBzd2FsbG93IHRoZSByZXY6cGF0aCBhcyBhIHZhbHVlLlxuICovXG5mdW5jdGlvbiBoYXNSZXZQYXRoQXJnKGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHZhbHVlRmxhZ3MgPSBuZXcgU2V0KFsnLS1mb3JtYXQnLCAnLS1wcmV0dHknLCAnLS1vdXRwdXQnLCAnLS13b3JkLWRpZmYtcmVnZXgnXSk7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIHtcbiAgICAgIGlmICghYS5pbmNsdWRlcygnPScpICYmIHZhbHVlRmxhZ3MuaGFzKGEpKSBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuaW5jbHVkZXMoJzonKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGV4YWN0IGxvbmcgZmxhZyBgZmxhZ2AgYXBwZWFycyBpbiB0aGUgY29tbWFuZCdzIGFyZ3YgKHN0b3BwaW5nXG4gKiBhdCBgLS1gLCBhZnRlciB3aGljaCB0b2tlbnMgYXJlIGxpdGVyYWwgcGF0aHNwZWNzLCBub3Qgb3B0aW9ucykuIFVzZWQgZm9yXG4gKiB0aGUgZGlmZiBgLS1yZWxhdGl2ZWAgYW5kIGdpdC1ncmVwIGAtLWZ1bGwtbmFtZWAgY2FydmUtb3V0cy5cbiAqL1xuZnVuY3Rpb24gaGFzRmxhZyhhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgZmxhZzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChhID09PSBmbGFnKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciBhIGBnaXQgZGlmZmAgaW52b2NhdGlvbidzIHBvc2l0aW9uYWwgYXJndW1lbnRzIGNhcnJ5IGByZXY6cGF0aGBcbiAqIHNwZWNzLiBgZ2l0IGRpZmYgPHJldj46PHBhdGg+IDxyZXY+OjxwYXRoPmAgY29tcGFyZXMgdHdvIGhpc3RvcmljYWwgYmxvYnNcbiAqIGFuZCBlbWl0cyBhIG5vcm1hbCB1bmlmaWVkIGRpZmYgd2hvc2UgcGF0aHMgbmFtZSB0aGUgYmxvYiBwYXRocywgbm90XG4gKiB3b3JraW5nLXRyZWUgZmlsZXMgXHUyMDE0IGRlY29kaW5nIGl0IGZhYnJpY2F0ZXMgdG91Y2hlcyBvbiBhIGZpbGUgZ2l0IG5ldmVyXG4gKiByZWFkICh1bmxpa2UgdGhlIHNpbmdsZS1hcmcgZm9ybSwgd2hpY2ggZXJyb3JzIGluc3RlYWQgb2YgZW1pdHRpbmdcbiAqIGNvbnRlbnQpLiBBIHBvc2l0aW9uYWwgY29udGFpbmluZyBgOmAgaXMgYSByZXY6cGF0aCB1bmxlc3MgYW4gZXhpc3RpbmdcbiAqIGZpbGUgY2FycmllcyB0aGF0IGxpdGVyYWwgbmFtZSAoYGdpdCBkaWZmIC4vd2VpcmQ6bmFtZS50c2AgXHUyMDE0IGEgbGl0ZXJhbFxuICogY29sb24gcGF0aCBuZWVkcyB0aGUgYC4vYCBwcmVmaXggdG8gc3Vydml2ZSBnaXQncyByZXZpc2lvbiBwYXJzaW5nKTtcbiAqIGFmdGVyIGAtLWAgdGhlIHRva2VucyBhcmUgbGl0ZXJhbCBwYXRoc3BlY3MgYW5kIHRoZSBzY2FuIHN0b3BzLiBGbGFnc1xuICogdGhhdCBjb25zdW1lIGEgU0VQQVJBVEUgYXJndW1lbnQgc2tpcCB0aGVpciB2YWx1ZSBzbyBhbiBvdXRwdXQgcGF0aFxuICogY2Fubm90IGZhbHNlLXBvc2l0aXZlLlxuICovXG5mdW5jdGlvbiBoYXNEaWZmUmV2UGF0aEFyZyhhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgY3dkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gVmFsdWUtY29uc3VtaW5nIGZsYWdzIHdob3NlIFNFUEFSQVRFIHZhbHVlIHRva2VuIG11c3QgbmV2ZXIgYmUgc2Nhbm5lZFxuICAvLyBhcyBhIHBvc2l0aW9uYWw6IGAtTCA8cmFuZ2U+OjxmaWxlPmAgKGdpdCBsb2cvYmxhbWUgXHUyMDE0IHRoZSByYW5nZSdzIGA6YCBpc1xuICAvLyBhIGxpbmUtcmFuZ2Ugc2VwYXJhdG9yLCBub3QgYSByZXY6cGF0aCksIHRoZSBwaWNrYXhlIGAtU2AvYC1HYCBhbmQgdGhlXG4gIC8vIGxvZyBmaWx0ZXJzIGAtLWdyZXBgL2AtLWF1dGhvcmAvYC0tY29tbWl0dGVyYCwgYW5kIHRoZSBkYXRlIGxpbWl0c1xuICAvLyBgLS1zaW5jZWAvYC0tdW50aWxgL2AtLWJlZm9yZWAvYC0tYWZ0ZXJgLCB3aG9zZSBzcGFjZS1mb3JtIElTTyB0aW1lc3RhbXBcbiAgLy8gdmFsdWVzIChgLS1zaW5jZSAnMjAyNC0wMS0wMVQxMjowMDowMCdgKSBjb250YWluIGNvbG9ucyBcdTIwMTQgYVxuICAvLyBgZ2l0IGxvZyAtcCAtUyAnOmF1dGgnYCBhcmNoYWVvbG9neSBpbnZvY2F0aW9uIGlzIGV4aXQtMCB2YWxpZCBhbmQgaXRzXG4gIC8vIHZhbHVlIHRva2VuIG11c3Qgbm90IHJlamVjdCB0aGUgd2hvbGUgZGVjb2RlLiBFeGFjdC10b2tlbiBtZW1iZXJzaGlwXG4gIC8vIGtlZXBzIGdsdWVkIGZvcm1zIHNhZmUgYnkgY29uc3RydWN0aW9uOiBgLVM6YXV0aGAgaXMgbmV2ZXIgaW4gdGhlIHNldFxuICAvLyBhbmQgc2tpcHMgbm8gdG9rZW4uXG4gIGNvbnN0IHZhbHVlRmxhZ3MgPSBuZXcgU2V0KFtcbiAgICAnLS1vdXRwdXQnLFxuICAgICctLXNyYy1wcmVmaXgnLFxuICAgICctLWRzdC1wcmVmaXgnLFxuICAgICctTCcsXG4gICAgJy1TJyxcbiAgICAnLUcnLFxuICAgICctLWdyZXAnLFxuICAgICctLWF1dGhvcicsXG4gICAgJy0tY29tbWl0dGVyJyxcbiAgICAnLS1zaW5jZScsXG4gICAgJy0tdW50aWwnLFxuICAgICctLWJlZm9yZScsXG4gICAgJy0tYWZ0ZXInXG4gIF0pO1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nKSB7XG4gICAgICBpZiAoIWEuaW5jbHVkZXMoJz0nKSAmJiB2YWx1ZUZsYWdzLmhhcyhhKSkgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLmluY2x1ZGVzKCc6JykgJiYgIWV4aXN0c1N5bmMocmVzb2x2ZVBhdGgoY3dkLCBhKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUaGUgcGF0aCBiYXNlIGBnaXQgZGlmZiAtLXJlbGF0aXZlWz08cGF0aD5dYCBhbmNob3JzIGl0cyBvdXRwdXQgdG86IG51bGxcbiAqIHdoZW4gdGhlIGZsYWcgaXMgYWJzZW50IChyZXBvLXJvb3QtcmVsYXRpdmUgcGF0aHMgXHUyMDE0IHRoZSBkZWZhdWx0KTsgdGhlXG4gKiBlZmZlY3RpdmUgZGlyIGZvciB0aGUgYmFyZSBmb3JtLCB3aG9zZSBwYXRocyBhcmUgY3dkLXJlbGF0aXZlIGFuZCBleGNsdWRlXG4gKiBjaGFuZ2VzIG91dHNpZGUgdGhlIGN3ZDsgb3IgYDxwYXRoPmAgcmVzb2x2ZWQgYWdhaW5zdCB0aGUgd29ya3RyZWUgcm9vdFxuICogZm9yIHRoZSB2YWx1ZSBmb3JtICh2ZXJpZmllZCBhZ2FpbnN0IGdpdCAyLjQ3LjMgXHUyMDE0IHRoZSB2YWx1ZSBpc1xuICogcm9vdC1yZWxhdGl2ZSwgbm90IGN3ZC1yZWxhdGl2ZSkuIGAndW5yZXNvbHZhYmxlJ2Agd2hlbiB0aGUgdmFsdWUgZm9ybSdzXG4gKiBwYXRoIGNhbm5vdCBiZSBzdGF0aWNhbGx5IHJlc29sdmVkIChzaGVsbCBleHBhbnNpb24pIG9yIG5vIHdvcmt0cmVlIHJvb3RcbiAqIGV4aXN0cyBcdTIwMTQgZmFpbCBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGRpZmZSZWxhdGl2ZUJhc2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBzdGFydDogbnVtYmVyLFxuICBlZmZlY3RpdmVEaXI6IHN0cmluZyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyB8IG51bGxcbik6IHsgYmFzZTogc3RyaW5nOyByb290OiBzdHJpbmcgfSB8ICd1bnJlc29sdmFibGUnIHwgbnVsbCB7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIG51bGw7XG4gICAgaWYgKGEgPT09ICctLXJlbGF0aXZlJykgcmV0dXJuIHsgYmFzZTogZWZmZWN0aXZlRGlyLCByb290OiBlZmZlY3RpdmVEaXIgfTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXJlbGF0aXZlPScpKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGEuc2xpY2UoJy0tcmVsYXRpdmU9Jy5sZW5ndGgpO1xuICAgICAgaWYgKHJlcG9Sb290ID09PSBudWxsIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHZhbHVlKSB8fCB2YWx1ZSA9PT0gJycpIHJldHVybiAndW5yZXNvbHZhYmxlJztcbiAgICAgIGNvbnN0IGJhc2UgPSByZXNvbHZlUGF0aChyZXBvUm9vdCwgdmFsdWUpO1xuICAgICAgcmV0dXJuIHsgYmFzZSwgcm9vdDogYmFzZSB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBQb3N0LWdhdGVkIHBpcGVsaW5lIHN0YWdlcyB0aGF0IHByb3ZhYmx5IG9ubHkgdHJ1bmNhdGUsIHJlb3JkZXIsIG9yXG4gKiBkZWR1cGUgdGhlIGVhcmxpZXIgc3RhZ2UncyByZWNvcmRzIFx1MjAxNCBlYWNoIHN1cnZpdmluZyBsaW5lJ3MgY29udGVudCBpc1xuICogYnl0ZS12ZXJiYXRpbSwgc28gdGhlIGRlY29kZWQgc3BhbnMgc3RheSBnZW51aW5lLiBUaGUgdW5jb25kaXRpb25hbFxuICogbWVtYmVycyBvZiB0aGUgY2xvc2FibGUgYWxsb3dsaXN0IGZvciB0aGUgaW52ZXJ0ZWQgZGVmYXVsdCBvZlxuICogaXNSZW51bWJlcmluZ0ZpbHRlcjsgdGhlIGNvbmRpdGlvbmFsIGNhcnZlLW91dHMgKHNlZC9hd2svcGVybC90ciB3aXRoXG4gKiBhbGxvd2xpc3RlZCBzY3JpcHRzKSBhcmUgaGFuZGxlZCBieSB0aGVpciBvd24gc3RhZ2UgY2hlY2tzIGJlbG93LiBFdmVyeVxuICogYWxsb3dsaXN0ZWQgc3RhZ2UgaXMgYWRkaXRpb25hbGx5IHJlcXVpcmVkIHRvIGNhcnJ5IG5vIGZpbGUgb3BlcmFuZHNcbiAqIChoYXNGaWxlT3BlcmFuZCkgXHUyMDE0IGEgdG9rZW4gdGhhdCBpcyBub3QgYSBmbGFnIG5hbWVzIGEgZmlsZSB0aGUgc3RhZ2VcbiAqIHJlYWRzIGluc3RlYWQgb2YgdGhlIHBpcGUuXG4gKi9cbmNvbnN0IFZFUkJBVElNX1BBU1NfQklOUyA9IG5ldyBTZXQoWydoZWFkJywgJ3RhaWwnLCAnd2MnLCAnc29ydCcsICd1bmlxJywgJ2N1dCddKTtcblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1maXJzdC1nYXRlZC1zdGFnZSBwaXBlbGluZSBzdGFnZSByZW51bWJlcnMgb3IgcmVzdHJ1Y3R1cmVzXG4gKiB0aGUgZWFybGllciBzdGFnZSdzIHJlY29yZHMgc28gdGhlIHJlc3BvbnNlIG5vIGxvbmdlciBjYXJyaWVzIHRoZSBmaWxlXG4gKiBsaW5lcyB0aGUgZ2F0ZWQgc3RhZ2UgcHJvZHVjZWQuIFRoZSBERUZBVUxUIElTIElOVkVSVEVEIChmYWlsIGNsb3NlZCk6XG4gKiBhIHN0YWdlIGlzIGFsbG93ZWQgb25seSB3aGVuIGl0IGlzIHByb3ZhYmx5IHZlcmJhdGltIFx1MjAxNCByZW51bWJlcmluZyBpcyBhXG4gKiBwcm9wZXJ0eSBvZiB0aGUgYmluYXJ5LCBhbmQgdGhlIHJlbnVtYmVyZXIgc2V0IChwZXJsLCBweXRob24sIHJ1YnksIG1hd2ssXG4gKiBnYXdrLCBuYXdrLCB0ciwgcGFzdGUsIFx1MjAyNikgaXMgdW5ib3VuZGVkLCBzbyBhIGRlbnkgbGlzdCBjYW4gbmV2ZXIgYmVcbiAqIGNsb3NlZCBhbmQgYW55IGJpbiBvdXRzaWRlIHRoZSBhbGxvd2xpc3QgaXMgdHJlYXRlZCBhcyBhIHJlbnVtYmVyZXIuXG4gKiBUaGUgYWxsb3dsaXN0IGlzIHBpcGVsaW5lLXNoYXBlIG9ubHkgKGEgcmVudW1iZXJlZCByZWNvcmQgaXMgYnl0ZS1cbiAqIGlkZW50aWNhbCB0byBsZWdpdCBvdXRwdXQsIHNvIGNvbnRlbnQvcmVjb3JkLXNoYXBlIGRpc2NyaW1pbmF0aW9uIGlzXG4gKiB1bnNvdW5kKTogZ3JlcC9lZ3JlcC9mZ3JlcC9yZyBXSVRIT1VUIG51bWJlcmVkIGV2aWRlbmNlXG4gKiAoYC1uYC9gLS1saW5lLW51bWJlcmAgXHUyMDE0IGEgcGxhaW4gZmlsdGVyIHBhc3NlcyByZWNvcmRzIHRocm91Z2ggdmVyYmF0aW0pXG4gKiBhbmQgV0lUSE9VVCBmaWxlIG9wZXJhbmRzIGJleW9uZCB0aGUgcGF0dGVybiBzbG90LCBwbGFpbiBgY2F0YCAobm9cbiAqIGAtbmAvYC0tbnVtYmVyYCwgbm8gZmlsZSBvcGVyYW5kcyksIGhlYWQvdGFpbC93Yy9zb3J0L3VuaXEvY3V0XG4gKiAodHJ1bmNhdGUvcmVvcmRlci9kZWR1cGUsIG5vIGZpbGUgb3BlcmFuZHMpLCBhbmQgYHNlZGAvYGF3a2AvYHBlcmxgL2B0cmBcbiAqIHdob3NlIHNjcmlwdC9wcm9ncmFtIHByb3ZhYmx5IHBhc3NlcyB3aG9sZSByZWNvcmRzIHRocm91Z2ggYnl0ZS12ZXJiYXRpbVxuICogKGlzVmVyYmF0aW1TZWRTdGFnZSAvIGlzVmVyYmF0aW1Bd2tTdGFnZSAvIGlzVmVyYmF0aW1QZXJsU3RhZ2UgL1xuICogaXNWZXJiYXRpbVRyU3RhZ2UgXHUyMDE0IG51bWVyaWMtYWRkcmVzcyBgcGAvYHFgL2BkYCBmb3JtcywgY29uZGl0aW9uLW9ubHlcbiAqIE5SLWNvbXBhcmlzb24vcGFyaXR5IHByb2dyYW1zLCBzdHJlYW0tcG9zaXRpb24gYHByaW50IGlmL3VubGVzcyAkLiBOIGRgXG4gKiBwZXJsIHNjcmlwdHMsIGFuZCBkaWdpdC9jb2xvbi9uZXdsaW5lLWZyZWUgYHRyIC1kYCBkZWxldGlvbnMgb3V0cHV0IHRoZVxuICogc2FtZSBieXRlcyB0aGUgZWFybGllciBzdGFnZSBlbWl0dGVkLCBzbyB0aGUgZGVjb2RlZCBzcGFucyBzdGF5XG4gKiBnZW51aW5lKS4gQSBGSUxFIE9QRVJBTkQgXHUyMDE0IGEgdG9rZW4gdGhhdCBpcyBub3QgYSBmbGFnIFx1MjAxNCBtYWtlcyB0aGUgc3RhZ2VcbiAqIHJlYWQgdGhhdCBmaWxlIGluc3RlYWQgb2YgdGhlIHBpcGU6IHRoZSByZXNwb25zZSdzIHJlY29yZHMgdGhlbiBjb21lXG4gKiBmcm9tIHRoZSBmaWxlLCBub3QgdGhlIGdhdGVkIHN0YWdlLCBhbmQgYSBjcmFmdGVkIHJlY29yZCBkZWNvZGVzIGFzIGFcbiAqIHBoYW50b20gdG91Y2gsIHNvIGV2ZXJ5IGFsbG93bGlzdGVkIGJpbiBmYWlscyBjbG9zZWQgb24gZmlsZSBvcGVyYW5kc1xuICogKHRoZSBzY3JpcHRlZCBiaW5zIGJ5IGFyZ3Ytc2hhcGUsIHRoZSByZXN0IHZpYSBoYXNGaWxlT3BlcmFuZCkuIGBubGBcbiAqIGFsd2F5cyByZW51bWJlcnMuXG4gKi9cbmZ1bmN0aW9uIGlzUmVudW1iZXJpbmdGaWx0ZXIoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgY29uc3QgYmluID0gYXJndlswXTtcbiAgaWYgKGJpbiA9PT0gJ25sJykgcmV0dXJuIHRydWU7XG4gIGlmIChiaW4gPT09ICdzZWQnKSByZXR1cm4gIWlzVmVyYmF0aW1TZWRTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ2F3aycpIHJldHVybiAhaXNWZXJiYXRpbUF3a1N0YWdlKGFyZ3YpO1xuICBpZiAoYmluID09PSAncGVybCcpIHJldHVybiAhaXNWZXJiYXRpbVBlcmxTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ3RyJykgcmV0dXJuICFpc1ZlcmJhdGltVHJTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ2NhdCcpIHtcbiAgICBpZiAoYXJndi5zb21lKChhKSA9PiBhID09PSAnLS1udW1iZXInIHx8IChhLnN0YXJ0c1dpdGgoJy0nKSAmJiAhYS5zdGFydHNXaXRoKCctLScpICYmIGEuaW5jbHVkZXMoJ24nKSkpKVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGhhc0ZpbGVPcGVyYW5kKGFyZ3YpO1xuICB9XG4gIGlmIChTRUFSQ0hfQklOUy5oYXMoYmluKSkge1xuICAgIGlmIChhcmd2LnNvbWUoKGEpID0+IGEgPT09ICctLWxpbmUtbnVtYmVyJyB8fCAoYS5zdGFydHNXaXRoKCctJykgJiYgIWEuc3RhcnRzV2l0aCgnLS0nKSAmJiBhLmluY2x1ZGVzKCduJykpKSlcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBoYXNHcmVwRmlsZU9wZXJhbmQoYXJndik7XG4gIH1cbiAgLy8gVGhlIGludmVydGVkIGRlZmF1bHQ6IGFueSBiaW4gb3V0c2lkZSB0aGUga25vd24tdmVyYmF0aW0gYWxsb3dsaXN0XG4gIC8vIChoZWFkL3RhaWwvd2Mvc29ydC91bmlxL2N1dCkgZmFpbHMgY2xvc2VkIFx1MjAxNCBhbmQgdGhlIGFsbG93bGlzdCBiaW5zXG4gIC8vIHRoZW1zZWx2ZXMgZmFpbCBjbG9zZWQgb24gZmlsZSBvcGVyYW5kcy5cbiAgaWYgKFZFUkJBVElNX1BBU1NfQklOUy5oYXMoYmluKSkgcmV0dXJuIGhhc0ZpbGVPcGVyYW5kKGFyZ3YpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGFueSBhcmd2IHRva2VuIGlzIGEgRklMRSBPUEVSQU5EIGZvciBhIHN0YWdlIHRoYXQgb3RoZXJ3aXNlIHJlYWRzXG4gKiB0aGUgcGlwZS4gQSB0b2tlbiB0aGF0IGlzIG5vdCBhIGZsYWcgbmFtZXMgYSBmaWxlIChhZnRlciB0aGUgYC0tYFxuICogdGVybWluYXRvciBldmVyeSB0b2tlbiBpcyBhIHBvc2l0aW9uYWwsIHNpbmNlIG9wdGlvbiBwYXJzaW5nIGhhcyBlbmRlZCk7XG4gKiBgLWAgbmFtZXMgc3RkaW4sIHdoaWNoIGlzIHRoZSBwaXBlIGl0c2VsZiwgYW5kIGAtLWAgaXMgb25seSB0aGVcbiAqIHRlcm1pbmF0b3IgXHUyMDE0IGJvdGggc3RheSBvcGVuLiBFeGFtcGxlOiBgcmcgLW4gbmVlZGxlIGYgfCBoZWFkIC0yYCBjYXJyaWVzXG4gKiBubyBmaWxlIG9wZXJhbmQgYW5kIHBhc3NlcyB2ZXJiYXRpbSwgYnV0IGByZyAtbiBuZWVkbGUgZiB8IGhlYWQgLTJcbiAqIGNyYWZ0ZWQudHh0YCByZWFkcyBjcmFmdGVkLnR4dCBpbnN0ZWFkIG9mIHRoZSBwaXBlIFx1MjAxNCBpdHMgcmVjb3JkcyBhcmUgbm90XG4gKiB0aGUgZ2F0ZWQgc3RhZ2Uncywgc28gdGhlIHBpcGVsaW5lIG11c3QgZmFpbCBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGhhc0ZpbGVPcGVyYW5kKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGxldCBhZnRlclRlcm1pbmF0b3IgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyVGVybWluYXRvciA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykgY29udGludWU7IC8vIHN0ZGluIFx1MjAxNCB0aGUgcGlwZVxuICAgIGlmIChhZnRlclRlcm1pbmF0b3IgfHwgIWEuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciBhIGdyZXAtZmFtaWx5IHN0YWdlJ3MgYXJndiBuYW1lcyBhIEZJTEUgT1BFUkFORCBcdTIwMTQgdGhlIHN0YWdlIHRoZW5cbiAqIHJlYWRzIHRoYXQgZmlsZSBpbnN0ZWFkIG9mIHRoZSBwaXBlLiBXaXRob3V0IGAtZWAvYC1mYCB0aGUgZmlyc3RcbiAqIHBvc2l0aW9uYWwgaXMgdGhlIFBBVFRFUk4gKGByZyBuZWVkbGVgL2BncmVwIG5lZWRsZWAgaW4gYSBwaXBlbGluZSByZWFkc1xuICogc3RkaW4gYW5kIHBhc3NlcyByZWNvcmRzIHRocm91Z2ggdmVyYmF0aW0pLCBzbyBhIGZpbGUgb3BlcmFuZCBpcyBhbnlcbiAqIHBvc2l0aW9uYWwgQkVZT05EIHRoZSBwYXR0ZXJuIHNsb3Q7IHdpdGggdGhlIHBhdHRlcm4gY29taW5nIGZyb20gYSBmbGFnXG4gKiB2YWx1ZSAoYC1lIFBBVGAsIGAtZiBQQVRGSUxFYCwgYC0tcmVnZXhwYCwgYC0tZmlsZWAsIGdsdWVkIGAtZVBBVGAgL1xuICogYC1mUEFURklMRWAgLyBgLS1yZWdleHA9UEFUYCAvIGAtLWZpbGU9UEFURklMRWApIGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYVxuICogZmlsZS4gVGhlIHZhbHVlcyBjb25zdW1lZCBieSBgLWVgL2AtZmAgYW5kIHRoZWlyIGxvbmcgZm9ybXMgYXJlIHBhdHRlcm5cbiAqIHNvdXJjZXMgXHUyMDE0IG5ldmVyIGZpbGUgb3BlcmFuZHMuXG4gKi9cbmZ1bmN0aW9uIGhhc0dyZXBGaWxlT3BlcmFuZChhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBsZXQgcGF0dGVybkZyb21GbGFnID0gZmFsc2U7XG4gIGxldCBzZWVuUGF0dGVybiA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgLy8gT3B0aW9uIHBhcnNpbmcgZW5kczsgZXZlcnkgcmVtYWluaW5nIHRva2VuIGlzIGEgcG9zaXRpb25hbC5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGFyZ3YubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYgKCFwYXR0ZXJuRnJvbUZsYWcgJiYgIXNlZW5QYXR0ZXJuKSBzZWVuUGF0dGVybiA9IHRydWU7XG4gICAgICAgIGVsc2UgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWUnIHx8IGEgPT09ICctZicgfHwgYSA9PT0gJy0tcmVnZXhwJyB8fCBhID09PSAnLS1maWxlJykge1xuICAgICAgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTtcbiAgICAgIGkrKzsgLy8gY29uc3VtZSB0aGUgdmFsdWUgdG9rZW4gKHRoZSBwYXR0ZXJuIG9yIHRoZSBwYXR0ZXJuIGZpbGUpXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctLScpKSB7XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tcmVnZXhwPScpIHx8IGEuc3RhcnRzV2l0aCgnLS1maWxlPScpKSBwYXR0ZXJuRnJvbUZsYWcgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChhLmxlbmd0aCA+IDIgJiYgKGFbMV0gPT09ICdlJyB8fCBhWzFdID09PSAnZicpKSB7XG4gICAgICAgIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7IC8vIGdsdWVkIHNob3J0IHZhbHVlIGZvcm06IC1lUEFUIC8gLWZQQVRGSUxFXG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFwYXR0ZXJuRnJvbUZsYWcgJiYgIXNlZW5QYXR0ZXJuKSBzZWVuUGF0dGVybiA9IHRydWU7XG4gICAgZWxzZSByZXR1cm4gdHJ1ZTsgLy8gYSBwb3NpdGlvbmFsIGJleW9uZCB0aGUgcGF0dGVybiBpcyBhIGZpbGUgb3BlcmFuZFxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBzY3JpcHRgIHByb3ZhYmx5IHByaW50cyBvciBvbWl0cyB3aG9sZSBpbnB1dCByZWNvcmRzIGJ5dGUtXG4gKiB2ZXJiYXRpbSAobnVtZXJpYyBhZGRyZXNzZXMgb25seSkuIFdpdGggYC1uYCAoYXV0by1wcmludCBzdXBwcmVzc2VkKSB0aGVcbiAqIHNjcmlwdCBtdXN0IGV4cGxpY2l0bHkgcHJpbnQ6IGBwYCAoc2luZ2xlIHJlY29yZCksIGAscGAgKGEgcmVjb3JkIHJhbmdlKSxcbiAqIG9yIGAsJHBgIChhIHJlY29yZCB0byB0aGUgZW5kKS4gV2l0aG91dCBgLW5gIHRoZSBkZWZhdWx0IGF1dG8tcHJpbnQga2VlcHNcbiAqIHJlY29yZHMgdmVyYmF0aW0sIHNvIGBxYCAocXVpdCBhZnRlciBhIHJlY29yZCBcdTIwMTQgYSBwcmVmaXggY3V0KSBhbmQgYGRgXG4gKiAoZGVsZXRlIGEgc2luZ2xlIHJlY29yZCBcdTIwMTQgYSBzdWJzZXQgY3V0KSBxdWFsaWZ5LiBQYXR0ZXJuIGFkZHJlc3NlcyBhbmRcbiAqIGFueSByZXdyaXRlIGNvbW1hbmQgKGBzLy8vYCwgYHkvLy9gLCBgPWAsIGBhYC9gaWAvYGNgKSBjaGFuZ2Ugb3IgaW5zZXJ0XG4gKiByZWNvcmQgY29udGVudCBhbmQgYXJlIG5ldmVyIGFsbG93bGlzdGVkLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltU2VkU2NyaXB0KHNjcmlwdDogc3RyaW5nLCBzdXBwcmVzc0F1dG9QcmludDogYm9vbGVhbik6IGJvb2xlYW4ge1xuICBpZiAoc3VwcHJlc3NBdXRvUHJpbnQpIHtcbiAgICByZXR1cm4gL15cXGQrcCQvLnRlc3Qoc2NyaXB0KSB8fCAvXlxcZCssXFxkK3AkLy50ZXN0KHNjcmlwdCkgfHwgL15cXGQrLFxcJHAkLy50ZXN0KHNjcmlwdCk7XG4gIH1cbiAgcmV0dXJuIC9eXFxkK3EkLy50ZXN0KHNjcmlwdCkgfHwgL15cXGQrZCQvLnRlc3Qoc2NyaXB0KTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1nYXRlZCBgc2VkYCBzdGFnZSdzIHdob2xlIGFyZ3YgcHJvdmFibHkgcGFzc2VzIHRoZSBlYXJsaWVyXG4gKiByZWNvcmRzIHRocm91Z2ggYnl0ZS12ZXJiYXRpbS4gVGhlIHNjcmlwdCBtdXN0IGJlIHRoZSBmaXJzdCBub24tZmxhZ1xuICogcG9zaXRpb25hbDsgb25seSBgLW5gIG1heSBwcmVjZWRlIGl0LCBhbmQgYW55IGZ1cnRoZXIgcG9zaXRpb25hbCAoYVxuICogc2Vjb25kIHNjcmlwdCwgb3IgZmlsZSBhcmdzIFx1MjAxNCB0aGUgc3RhZ2UgdGhlbiByZWFkcyBmaWxlcywgbm90IHRoZSBwaXBlKVxuICogZmFpbHMgY2xvc2VkLiBBbnkgb3RoZXIgZmxhZyAoYC1lYCwgYC1mYCwgYC1FYCwgYC11YCwgYC16YCwgXHUyMDI2KSBjaGFuZ2VzXG4gKiBzY3JpcHQgc2VtYW50aWNzIG9yIHJlY29yZCBzZXBhcmF0aW9uIGFuZCBmYWlscyBjbG9zZWQuIGAxLDIhZGAgaXNcbiAqIGRlbGliZXJhdGVseSBOT1QgYWxsb3dsaXN0ZWQgXHUyMDE0IGEgcmFuZ2UtY29tcGxlbWVudCBkZWxldGUgaGFwcGVucyB0b1xuICogcHJlc2VydmUgcmVjb3JkcywgYnV0IHRoZSBhbGxvd2xpc3QgYWRtaXRzIG9ubHkgdGhlIHByb3ZhYmxlIG51bWVyaWNcbiAqIGZvcm1zLCBzbyBpdCBmYWlscyBjbG9zZWQgbGlrZSBldmVyeXRoaW5nIGVsc2UuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1TZWRTdGFnZShhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBsZXQgc2NyaXB0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHN1cHByZXNzQXV0b1ByaW50ID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBzdXBwcmVzc0F1dG9QcmludCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpICYmIGEgIT09ICctJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChzY3JpcHQgIT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICBzY3JpcHQgPSBhO1xuICB9XG4gIHJldHVybiBzY3JpcHQgIT09IG51bGwgJiYgaXNWZXJiYXRpbVNlZFNjcmlwdChzY3JpcHQsIHN1cHByZXNzQXV0b1ByaW50KTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1nYXRlZCBgYXdrYCBzdGFnZSdzIHByb2dyYW0gcHJvdmFibHkgc2VsZWN0cyB3aG9sZSByZWNvcmRzXG4gKiB3aXRoIHRoZSBkZWZhdWx0IHByaW50IGFjdGlvbiwgc28gdGhlIG91dHB1dCBieXRlcyBhcmUgdmVyYmF0aW0uIFRoZVxuICogcHJvZ3JhbSBtdXN0IGJlIHRoZSBzb2xlIHBvc2l0aW9uYWwgKG5vIGAtRmAvYC12YC9gLWZgIGZsYWdzLCBubyBmaWxlXG4gKiBhcmdzKSBhbmQgbWF0Y2ggYSBjb25kaXRpb24tb25seSBmb3JtOiBgTlIgT1AgTmAgd2l0aCBPUCBpblxuICoge2A8YCwgYDw9YCwgYD5gLCBgPj1gLCBgPT1gLCBgIT1gfSBhZ2FpbnN0IGRlY2ltYWwgZGlnaXRzIChyZWNvcmQtbnVtYmVyXG4gKiB3aW5kb3dzKSwgb3IgYE5SICUgTiA9PSBNYCAvIGBOUiAlIE4gIT0gTWAgKHBhcml0eSBzdWJzZXRzKS4gTk8gYnJhY2VzLFxuICogTk8gYWN0aW9ucywgTk8gZmllbGQvcmVjb3JkIHJlZmVyZW5jZXMgKGAkYCksIE5PIGBwcmludGAsIE5PIGBzdWJgL1xuICogYGdzdWJgIFx1MjAxNCBhbnkgb2YgdGhvc2UgcmV3cml0ZXMgb3IgcmVudW1iZXJzIGFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1Bd2tTdGFnZShhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAoYXJndi5sZW5ndGggIT09IDIpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcHJvZ3JhbSA9IGFyZ3ZbMV07XG4gIHJldHVybiAvXk5SXFxzKig8PXw+PXw9PXwhPXw8fD4pXFxzKlxcZCskLy50ZXN0KHByb2dyYW0pIHx8IC9eTlJcXHMqJVxccypcXGQrXFxzKig9PXwhPSlcXHMqXFxkKyQvLnRlc3QocHJvZ3JhbSk7XG59XG5cbi8qKlxuICogVGhlIHNjcmlwdCBvZiBhIHBvc3QtZ2F0ZWQgYHBlcmxgIHN0YWdlJ3MgYXJndiB3aGVuIGl0cyBmb3JtIGlzIGV4YWN0bHlcbiAqIGBwZXJsIC1uZSA8c2NyaXB0PmAgb3IgYHBlcmwgLW4gLWUgPHNjcmlwdD5gIFx1MjAxNCBub3RoaW5nIGVsc2UuIEFueSBvdGhlclxuICogZmxhZyAoYC1wYCwgYC1hYCwgYC1GYCwgXHUyMDI2KSBvciBhbnkgcG9zaXRpb25hbCBiZXlvbmQgdGhlIHNjcmlwdCAoZmlsZSBhcmdzXG4gKiBcdTIwMTQgdGhlIHN0YWdlIHRoZW4gcmVhZHMgZmlsZXMsIG5vdCB0aGUgcGlwZSkgcmV0dXJucyBudWxsIGFuZCBmYWlsc1xuICogY2xvc2VkLlxuICovXG5mdW5jdGlvbiB2ZXJiYXRpbVBlcmxTY3JpcHQoYXJndjogc3RyaW5nW10pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKGFyZ3YubGVuZ3RoID09PSAzICYmIGFyZ3ZbMV0gPT09ICctbmUnKSByZXR1cm4gYXJndlsyXTtcbiAgaWYgKGFyZ3YubGVuZ3RoID09PSA0ICYmIGFyZ3ZbMV0gPT09ICctbicgJiYgYXJndlsyXSA9PT0gJy1lJykgcmV0dXJuIGFyZ3ZbM107XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBwb3N0LWdhdGVkIGBwZXJsYCBzdGFnZSBwcm92YWJseSBwcmludHMgd2hvbGUgaW5wdXQgcmVjb3Jkc1xuICogYnl0ZS12ZXJiYXRpbSAoc3RyZWFtLXBvc2l0aW9uIHNlbGVjdGlvbiBvbmx5KS4gYC1uYCB3cmFwcyB0aGUgc2NyaXB0IGluXG4gKiBhIGxpbmUgbG9vcCB3aXRob3V0IGF1dG8tcHJpbnRpbmcsIGFuZCB0aGUgc2NyaXB0IG11c3QgYmUgYSBiYXJlIGBwcmludGBcbiAqIGd1YXJkZWQgYnkgYSBzdHJlYW0tcG9zaXRpb24gY29uZGl0aW9uIChgcHJpbnQgaWYgJC4gPD0gMmAsIGBwcmludCB1bmxlc3NcbiAqICQuID4gMmAsIGBwcmludCBpZiAkLiA9PSAyYCkgXHUyMDE0IGJhcmUgYHByaW50YCBlbWl0cyBgJF9gIHZlcmJhdGltIGluY2x1ZGluZ1xuICogaXRzIHRyYWlsaW5nIG5ld2xpbmUsIHNvIHJlY29yZHMgc3RheSBjb21wbGV0ZSBmb3IgdGhlIHRlcm1pbmF0aW5nLW5ld2xpbmVcbiAqIHJ1bGUgYW5kIHRoZWlyIHBvc2l0aW9ucyBhcmUgZXhhY3RseSB0aGUgZWFybGllciBzdGFnZSdzIGZpbGUgbGluZXMuXG4gKiBBbnl0aGluZyBlbHNlIFx1MjAxNCBpbmNsdWRpbmcgYHByaW50IFwiJC46JF9cImAgKHJlbnVtYmVycyksIGAtcGAsIGFueSBvdGhlclxuICogZXhwcmVzc2lvbiwgYW55IGZpbGUgYXJncyBcdTIwMTQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltUGVybFN0YWdlKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNjcmlwdCA9IHZlcmJhdGltUGVybFNjcmlwdChhcmd2KTtcbiAgaWYgKHNjcmlwdCA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gL15cXHMqcHJpbnRcXHMrKD86aWZ8dW5sZXNzKVxccytcXCRcXC5cXHMqKDw9fD49fD09fCE9fDx8PilcXHMqXFxkK1xccyo7P1xccyokLy50ZXN0KHNjcmlwdCk7XG59XG5cbi8qKlxuICogV2hldGhlciBhIHBvc3QtZ2F0ZWQgYHRyYCBzdGFnZSBwcm92YWJseSBkZWxldGVzIGEgY2hhcmFjdGVyIHNldCB0aGF0XG4gKiBsZWF2ZXMgdGhlIGVhcmxpZXIgcmVjb3Jkcycgc2hhcGUgYW5kIGxpbmUgbnVtYmVycyB1bnRvdWNoZWQuIE9ubHkgdGhlXG4gKiBleGFjdCBgdHIgLWQgPHNldD5gIGZvcm0gcXVhbGlmaWVzIChvbmUgc2V0IHRva2VuLCBubyBvdGhlciBmbGFncywgbm9cbiAqIGZpbGUgYXJncyk7IHRoZSBzZXQgbXVzdCBjb250YWluIE5PTkUgb2YgYDAtOWAgKGRlbGV0aW5nIGRpZ2l0c1xuICogcmVudW1iZXJzKSwgYDpgIChkZWxldGluZyBjb2xvbnMgZGVzdHJveXMgdGhlIHJlY29yZCBzaGFwZSBcdTIwMTQgdGhpcyBhbHNvXG4gKiBibG9ja3MgYFs6XHUyMDI2Ol1gIGNsYXNzIHN5bnRheCksIG9yIHRoZSBgXFxuYCBlc2NhcGUgKGRlbGV0aW5nIG5ld2xpbmVzXG4gKiBtZXJnZXMgcmVjb3JkcykuIEFsbG93ZWQ6IGB0ciAtZCAnXFxyJ2AgKHRoZSBDUkxGIGlkaW9tKSwgYHRyIC1kICcgJ2AsXG4gKiBgdHIgLWQgJ1xcdFxccidgLCBgdHIgLWQgJ2EteidgLiBBbnkgc3Vic3RpdHV0aW9uIGZvcm0gKGB0ciAnMScgJzknYCBcdTIwMTRcbiAqIHJld3JpdGVzIGRpZ2l0cyBpbnNpZGUgbGluZSBudW1iZXJzKSwgYC1zYC9gLWNgLCBvciBhbnl0aGluZyBlbHNlIGZhaWxzXG4gKiBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1UclN0YWdlKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGlmIChhcmd2Lmxlbmd0aCAhPT0gMyB8fCBhcmd2WzFdICE9PSAnLWQnKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNldCA9IGFyZ3ZbMl07XG4gIHJldHVybiAhL1swLTk6XS8udGVzdChzZXQpICYmICFzZXQuaW5jbHVkZXMoJ1xcXFxuJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGF5b3V0IGRldGVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGxpbmVzIG9mIGBzdGRvdXRgIHdob3NlIHRlcm1pbmF0aW5nIG5ld2xpbmUgaXMgcHJlc2VudCBpbiB0aGUgcmVzcG9uc2VcbiAqIHRleHQuIFRoZSBmaW5hbCBzcGxpdCBlbGVtZW50IGlzIGVpdGhlciB0aGUgZW1wdHkgc3RyaW5nIGxlZnQgYnkgYSB0cmFpbGluZ1xuICogbmV3bGluZSBvciBhbiB1bnRlcm1pbmF0ZWQgcGFydGlhbCByZWNvcmQgXHUyMDE0IGVpdGhlciB3YXkgaXQgaXMgbm90IGEgcmVjb3JkLFxuICogc28gaXQgaXMgYWx3YXlzIGRyb3BwZWQgKHRoZSB1bml2ZXJzYWwgdHJ1bmNhdGlvbiBydWxlKS5cbiAqL1xuZnVuY3Rpb24gY29tcGxldGVMaW5lcyhzdGRvdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXMgPSBzdGRvdXQuc3BsaXQoJ1xcbicpO1xuICBsaW5lcy5wb3AoKTtcbiAgcmV0dXJuIGxpbmVzO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgZXZlcnkgbm9uLWVtcHR5IHJlY29yZCBvZiBhIGBsaW5lOnRleHRgIHJlc3BvbnNlIHBhcnNlcyBhc1xuICogbnVtYmVyZWQgXHUyMDE0IHRoZSBjcm9zcy1yZWNvcmQgY29uc2lzdGVuY3kgY2hlY2sgdGhhdCBrZWVwcyBvbmUtZmlsZVxuICogYXR0cmlidXRpb24gZnJvbSByZXN0aW5nIG9uIGEgc2luZ2xlIHJlY29yZCdzIHNoYXBlLlxuICovXG5mdW5jdGlvbiByZWNvcmRzQXJlT25lRmlsZShzdGRvdXQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBsaW5lcyA9IGNvbXBsZXRlTGluZXMoc3Rkb3V0KTtcbiAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gbGluZXMuZXZlcnkoKGxpbmUpID0+IGxpbmUgPT09ICcnIHx8IHBhcnNlT25lRmlsZVJlY29yZChsaW5lKSAhPT0gbnVsbCk7XG59XG5cbi8qKlxuICogRGVjaWRlIHdoaWNoIHNlYXJjaCBsYXlvdXQgYSByZXNwb25zZSB1c2VzIGZyb20gdGhlIHNoYXBlIG9mIGl0cyBmaXJzdFxuICogcmVjb3JkLCBjb25zdWx0aW5nIHRoZSBjb21tYW5kJ3MgY29udGV4dCBmbGFncyB0byBicmVhayB0aGUgcmVjdXJzaXZlIC9cbiAqIGNvbnRleHQgYW1iaWd1aXR5IChib3RoIGVtaXQgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmRzKS4gRmFpbCBjbG9zZWQ6XG4gKiBhbiB1bnJlY29nbml6ZWQgZmlyc3QgcmVjb3JkIG1lYW5zIG5vdGhpbmcgaW4gdGhpcyByZXNwb25zZSBpcyB0cnVzdGVkLlxuICpcbiAqIFRoZSBgbGluZTp0ZXh0YC1vbmx5IGxheW91dHMgKG9uZS1maWxlLCBoZWFkaW5nKSByZXF1aXJlIGNvbW1hbmQtc2lkZVxuICogbnVtYmVyZWQgZXZpZGVuY2U6IHJnIGFuZCBncmVwIGRlZmF1bHQgdG8gTk8gbGluZSBudW1iZXJzIHdoZW4gcGlwZWQsIHNvIGFcbiAqIGRpZ2l0cy1sZWFkaW5nIHJlY29yZCB3aXRob3V0IGAtbmAvYC0tbGluZS1udW1iZXJgIGlzIGNvbnRlbnQsIG5vdCBhXG4gKiBwb3NpdGlvbiBcdTIwMTQgYGdyZXAgVE9ETyBub3Rlcy5tZGAgd2hvc2UgbWF0Y2hpbmcgbGluZSBpcyBgMTIzOiBUT0RPIGl0ZW1gXG4gKiBtdXN0IG5vdCB0b3VjaCBsaW5lIDEyMywgYW5kIGByZyAtbCBhbHBoYSAyMDI0LWxvZy50eHRgIG11c3Qgbm90IHRvdWNoXG4gKiBsaW5lIDIwMjQuIFRoZSBvbmUtZmlsZSBsYXlvdXQgYWRkaXRpb25hbGx5IHJlcXVpcmVzIGV4YWN0bHkgb25lIGV4cGxpY2l0XG4gKiBmaWxlIGFyZ3VtZW50IHRoYXQgaXMgYSByZWFsIGZpbGUgKGEgZGlyZWN0b3J5IG9yIG5vIGFyZ3MgbWVhbnMgcmVjb3Jkc1xuICogY2FycnkgcGF0aCBwcmVmaXhlcyBcdTIwMTQgYSBwdXJlLWRpZ2l0cyBmaWxlbmFtZSBlbWl0dGVkIGZpcnN0IG11c3QgZmFsbFxuICogdGhyb3VnaCB0byByZWN1cnNpdmUpLCBubyBgLUhgL2AtLXdpdGgtZmlsZW5hbWVgICh3aGljaCBmb3JjZXMgcGF0aFxuICogcHJlZml4ZXMpLCBhbmQgY3Jvc3MtcmVjb3JkIGNvbnNpc3RlbmN5IHZpYSBgcmVjb3Jkc0FyZU9uZUZpbGVgLlxuICovXG5mdW5jdGlvbiBkZXRlY3RMYXlvdXQoc3Rkb3V0OiBzdHJpbmcsIGluZm86IFNlYXJjaEFyZ3ZJbmZvLCBvbmVGaWxlRWxpZ2libGU6IGJvb2xlYW4pOiBTZWFyY2hMYXlvdXQgfCBudWxsIHtcbiAgaWYgKHN0ZG91dC5pbmNsdWRlcygnXFwwJykpIHJldHVybiAnbnVsbC1zZXBhcmF0ZWQnO1xuICBjb25zdCBsaW5lcyA9IGNvbXBsZXRlTGluZXMoc3Rkb3V0KTtcbiAgY29uc3QgZmlyc3QgPSBsaW5lcy5maW5kKChsaW5lKSA9PiBsaW5lICE9PSAnJyk7XG4gIGlmIChmaXJzdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eXFxkK1stOl0vLnRlc3QoZmlyc3QpKSB7XG4gICAgaWYgKG9uZUZpbGVFbGlnaWJsZSAmJiByZWNvcmRzQXJlT25lRmlsZShzdGRvdXQpKSByZXR1cm4gJ29uZS1maWxlJztcbiAgICAvLyBOb3QgdGhlIG9uZS1maWxlIGxheW91dDogZmFsbCB0aHJvdWdoIFx1MjAxNCBhIGRpZ2l0cy1sZWFkaW5nIHJlY29yZCBpc1xuICAgIC8vIG1vcmUgcGxhdXNpYmx5IHRoZSBgcGF0aDpsaW5lOnRleHRgIHJlY29yZCBvZiBhIGRpZ2l0cy1uYW1lZCBmaWxlLFxuICAgIC8vIHdoaWNoIHRoZSByZWN1cnNpdmUgY2hlY2tzIGJlbG93IHBpY2sgdXAuXG4gIH1cbiAgaWYgKC9eW146XSs6XFxkKy8udGVzdChmaXJzdCkpIHJldHVybiBpbmZvLmNvbnRleHRGbGFncyA/ICdjb250ZXh0JyA6ICdyZWN1cnNpdmUnO1xuICAvLyBBIGNvbnRleHQgd2luZG93IGNhbiBvcGVuIHdpdGggYSBjb250ZXh0IHJlY29yZCAoaXRzIC1CIHNpZGUpLCB3aG9zZVxuICAvLyBgcGF0aC1saW5lLXRleHRgIHNoYXBlIGlzIGFtYmlndW91cyB3aGVuIHRoZSBwYXRoIGl0c2VsZiBjb250YWlucyBhXG4gIC8vIGRhc2ggXHUyMDE0IGBzcmMvbXktZmlsZS50cy0yLW9uZWAgc3BsaXRzIGluc2lkZSB0aGUgcGF0aC4gRXZlcnkgY29udGV4dFxuICAvLyBncm91cCBpcyBhbmNob3JlZCB0byBhIGBwYXRoOmxpbmU6dGV4dGAgbWF0Y2ggcmVjb3JkIHdob3NlIGNvbG9uIHNwbGl0XG4gIC8vIGlzIHVuYW1iaWd1b3VzLCBzbyB0aGUgcmVzcG9uc2UncyBvd24gbWF0Y2ggcmVjb3JkcyBkZXRlY3QgdGhlIGxheW91dC5cbiAgaWYgKGluZm8uY29udGV4dEZsYWdzICYmIGxpbmVzLnNvbWUoKGxpbmUpID0+IGxpbmUgIT09ICcnICYmIC9eW146XSs6XFxkKy8udGVzdChsaW5lKSkpIHJldHVybiAnY29udGV4dCc7XG4gIGlmICgvXlteLTpdKy1cXGQrLS8udGVzdChmaXJzdCkpIHJldHVybiBpbmZvLmNvbnRleHRGbGFncyA/ICdjb250ZXh0JyA6IG51bGw7XG4gIGlmIChpbmZvLm51bWJlcmVkICYmIC9eW146XSskLy50ZXN0KGZpcnN0KSkgcmV0dXJuICdoZWFkaW5nJztcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVjb3JkIHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IGEgcmVjb3JkIG9uIGl0cyBmaXJzdCB0d28gb2NjdXJyZW5jZXMgb2YgYHNlcGAgKHRoZSBsYXlvdXQnc1xuICogcGF0aC9saW5lL3RleHQgc2VwYXJhdG9ycyksIHNvIHNlcGFyYXRvcnMgaW5zaWRlIHRoZSB0ZXh0IGFyZSBzYWZlLiBBIHBhdGhcbiAqIGNvbnRhaW5pbmcgYSBjb2xvbiwgYSBub24tbnVtZXJpYyBsaW5lIHRva2VuLCBvciBhbiBlbXB0eSBwYXRoIGlzXG4gKiBwYXRoLWFtYmlndW91cyBhbmQgZHJvcHBlZC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VSZWNvcmQobGluZTogc3RyaW5nLCBzZXA6IHN0cmluZyk6IHsgcGF0aDogc3RyaW5nOyBsaW5lOiBudW1iZXI7IHRleHQ6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IGZpcnN0ID0gbGluZS5pbmRleE9mKHNlcCk7XG4gIGlmIChmaXJzdCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBjb25zdCBzZWNvbmQgPSBsaW5lLmluZGV4T2Yoc2VwLCBmaXJzdCArIDEpO1xuICBpZiAoc2Vjb25kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhdGggPSBsaW5lLnNsaWNlKDAsIGZpcnN0KTtcbiAgY29uc3QgbGluZVRva2VuID0gbGluZS5zbGljZShmaXJzdCArIDEsIHNlY29uZCk7XG4gIGNvbnN0IHRleHQgPSBsaW5lLnNsaWNlKHNlY29uZCArIDEpO1xuICBpZiAocGF0aCA9PT0gJycgfHwgcGF0aC5pbmNsdWRlcygnOicpKSByZXR1cm4gbnVsbDtcbiAgaWYgKCEvXlxcZCskLy50ZXN0KGxpbmVUb2tlbikpIHJldHVybiBudWxsO1xuICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyLnBhcnNlSW50KGxpbmVUb2tlbiwgMTApO1xuICBpZiAobGluZU51bWJlciA8PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgcGF0aCwgbGluZTogbGluZU51bWJlciwgdGV4dCB9O1xufVxuXG4vKiogT25lIG51bWJlcmVkIHJlY29yZCBpbiB0aGUgb25lLWZpbGUvaGVhZGluZyBgbGluZTp0ZXh0YCBvciBgbGluZS10ZXh0YCBzdHlsZS4gKi9cbmZ1bmN0aW9uIHBhcnNlT25lRmlsZVJlY29yZChsaW5lOiBzdHJpbmcpOiB7IGxpbmU6IG51bWJlcjsgdGV4dDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgbSA9IC9eKFxcZCspKFs6LV0pLy5leGVjKGxpbmUpO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGxpbmVOdW1iZXIgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICBpZiAobGluZU51bWJlciA8PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgbGluZTogbGluZU51bWJlciwgdGV4dDogbGluZS5zbGljZShtWzBdLmxlbmd0aCkgfTtcbn1cblxuLyoqXG4gKiBEZWNvZGUgYSBjb250ZXh0IHJlY29yZCAoYHBhdGgtbGluZS10ZXh0YCkgYnkgYW5jaG9yaW5nIGl0IHRvIHRoZSBleGFjdFxuICogcGF0aHMgdGhlIHJlc3BvbnNlJ3MgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmRzIGVzdGFibGlzaGVkOiB0aGVcbiAqIHJlY29yZCBtdXN0IHN0YXJ0IHdpdGggYSBrbm93biBwYXRoIGZvbGxvd2VkIGJ5IGAtbGluZS10ZXh0YC4gTG9uZ2VzdCBwYXRoXG4gKiBmaXJzdCwgc28gYSBwYXRoIHRoYXQgaXMgYSBwcmVmaXggb2YgYW5vdGhlciAoYGEtYi50c2AgdnMgYGEtYi1jLnRzYClcbiAqIGNhbid0IHNoYWRvdyBpdC4gQSBkYXNoIGluc2lkZSBhIHBhdGggbWFrZXMgdGhlIHBsYWluIGRhc2ggc3BsaXRcbiAqIGFtYmlndW91cyAoYHNyYy9teS1maWxlLnRzLTQtY3R4YCBzcGxpdHMgaW5zaWRlIHRoZSBwYXRoIGFuZCBpdHMgbGluZVxuICogdG9rZW4gY29tZXMgb3V0IG5vbi1udW1lcmljKSwgd2hpY2ggaXMgd2h5IHRoZSBrbm93bi1wYXRoIGFuY2hvciBleGlzdHMuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlQ29udGV4dFJlY29yZChsaW5lOiBzdHJpbmcsIGtub3duUGF0aHM6IHN0cmluZ1tdKTogeyBwYXRoOiBzdHJpbmc7IGxpbmU6IG51bWJlcjsgdGV4dDogc3RyaW5nIH0gfCBudWxsIHtcbiAgZm9yIChjb25zdCBwYXRoIG9mIGtub3duUGF0aHMpIHtcbiAgICBpZiAoIWxpbmUuc3RhcnRzV2l0aChgJHtwYXRofS1gKSkgY29udGludWU7XG4gICAgY29uc3QgdGFpbCA9IGxpbmUuc2xpY2UocGF0aC5sZW5ndGggKyAxKTtcbiAgICBjb25zdCBtID0gL14oXFxkKyktLy5leGVjKHRhaWwpO1xuICAgIGlmIChtID09PSBudWxsKSBjb250aW51ZTtcbiAgICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBpZiAobGluZU51bWJlciA8PSAwKSBjb250aW51ZTtcbiAgICByZXR1cm4geyBwYXRoLCBsaW5lOiBsaW5lTnVtYmVyLCB0ZXh0OiB0YWlsLnNsaWNlKG1bMF0ubGVuZ3RoKSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogMS1iYXNlZCBsaW5lIGNvdW50IG9mIHJlc3BvbnNlIHRleHQgdGhhdCBob2xkcyBhbiBlbnRpcmUgZmlsZSdzIGNvbnRlbnQuICovXG5mdW5jdGlvbiBsaW5lQ291bnQodGV4dDogc3RyaW5nKTogbnVtYmVyIHtcbiAgaWYgKHRleHQgPT09ICcnKSByZXR1cm4gMDtcbiAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IHRleHQuZW5kc1dpdGgoJ1xcbicpID8gdGV4dC5zbGljZSgwLCAtMSkgOiB0ZXh0O1xuICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExheW91dCBkZWNvZGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRGVjb2RlIGBzdGRvdXRgIGludG8gc2VhcmNoIHJlY29yZHMgZm9yIGBsYXlvdXRgLiBPbmUtZmlsZSByZWNvcmRzIGFyZVxuICogYXR0cmlidXRlZCB0byBgc2luZ2xlRmlsZUFyZ2AgKHRoZSBjb21tYW5kJ3Mgc29sZSBleHBsaWNpdCBmaWxlKTsgZm9yIGFueVxuICogb3RoZXIgbGF5b3V0IHRoZSByZWNvcmQgcGF0aHMgYXJlIHRoZSByZXNwb25zZSdzIG93bi4gTnVsbC1zZXBhcmF0ZWRcbiAqIHJlY29yZHMgY2FycnkgYGxpbmU6IG51bGxgIGFuZCB0aGUgZnVsbCBmaWxlIGNvbnRlbnQgaW4gYHRleHRgLCBiZWNhdXNlIHRoZVxuICogb25seSB3ZWxsLWRlZmluZWQgdG91Y2ggZm9yIGEgYHBhdGg6MTpcdTIwMjZgIHJlY29yZCBob2xkaW5nIGFuIGVudGlyZSBmaWxlIGlzXG4gKiB0aGUgd2hvbGUgZmlsZS5cbiAqL1xuZnVuY3Rpb24gZGVjb2RlU2VhcmNoTGF5b3V0KGxheW91dDogU2VhcmNoTGF5b3V0LCBzdGRvdXQ6IHN0cmluZywgc2luZ2xlRmlsZUFyZzogc3RyaW5nIHwgbnVsbCk6IFNlYXJjaFJlY29yZFtdIHtcbiAgY29uc3QgcmVjb3JkczogU2VhcmNoUmVjb3JkW10gPSBbXTtcbiAgc3dpdGNoIChsYXlvdXQpIHtcbiAgICBjYXNlICdyZWN1cnNpdmUnOlxuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgICAgICBjb25zdCByZWMgPSBwYXJzZVJlY29yZChsaW5lLCAnOicpO1xuICAgICAgICBpZiAocmVjICE9PSBudWxsKSByZWNvcmRzLnB1c2gocmVjKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NvbnRleHQnOiB7XG4gICAgICAvLyBNYXRjaCByZWNvcmRzIGFyZSBgcGF0aDpsaW5lOnRleHRgOyBjb250ZXh0IHJlY29yZHMgYXJlXG4gICAgICAvLyBgcGF0aC1saW5lLXRleHRgICh0aGUgc2VwYXJhdG9yIGlzIGEgZGFzaCB3aGVyZXZlciBhIG1hdGNoIHJlY29yZFxuICAgICAgLy8gd291bGQgdXNlIGEgY29sb24pLiBCb3RoIGNhcnJ5IHRoZSByZWFsIGxpbmUgbnVtYmVyOyBgLS1gIGdyb3VwXG4gICAgICAvLyBzZXBhcmF0b3JzIGFyZSBub3QgcmVjb3Jkcy4gQSBkYXNoIGluc2lkZSBhIHBhdGggYnJlYWtzIHRoZSBkYXNoXG4gICAgICAvLyBzcGxpdCwgc28gdGhlIHJlc3BvbnNlJ3MgbWF0Y2ggcmVjb3JkcyBmaXJzdCBlc3RhYmxpc2ggdGhlIGZpbGVzJ1xuICAgICAgLy8gZXhhY3QgcGF0aHMgYW5kIGVhY2ggY29udGV4dCByZWNvcmQgaXMgYW5jaG9yZWQgdG8gYSBrbm93biBwYXRoXG4gICAgICAvLyBwcmVmaXggYmVmb3JlIGl0cyBgLWxpbmUtdGV4dGAgdGFpbCwgd2l0aCB0aGUgZGFzaC1mcmVlIGRlZmF1bHQgYXNcbiAgICAgIC8vIHRoZSBmYWxsYmFjay4gQ29udGV4dCByZWNvcmRzIGNhbiBwcmVjZWRlIHRoZWlyIG1hdGNoICgtQiB3aW5kb3dzKSxcbiAgICAgIC8vIHNvIHRoZSBrbm93biBzZXQgaXMgYnVpbHQgaW4gYSBmaXJzdCBwYXNzIG92ZXIgYWxsIGxpbmVzLlxuICAgICAgY29uc3QgbGluZXMgPSBjb21wbGV0ZUxpbmVzKHN0ZG91dCk7XG4gICAgICBjb25zdCBrbm93biA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgIGlmIChsaW5lID09PSAnLS0nKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcmVjID0gcGFyc2VSZWNvcmQobGluZSwgJzonKTtcbiAgICAgICAgaWYgKHJlYyAhPT0gbnVsbCkga25vd24uYWRkKHJlYy5wYXRoKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGtub3duU29ydGVkID0gWy4uLmtub3duXS5zb3J0KChhLCBiKSA9PiBiLmxlbmd0aCAtIGEubGVuZ3RoKTtcbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICBpZiAobGluZSA9PT0gJy0tJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlUmVjb3JkKGxpbmUsICc6JykgPz8gcGFyc2VDb250ZXh0UmVjb3JkKGxpbmUsIGtub3duU29ydGVkKSA/PyBwYXJzZVJlY29yZChsaW5lLCAnLScpO1xuICAgICAgICBpZiAocmVjICE9PSBudWxsKSByZWNvcmRzLnB1c2gocmVjKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICdoZWFkaW5nJzpcbiAgICAgIC8vIEEgZmlsZSBoZWFkZXIgbGluZSwgdGhlbiBgbGluZTp0ZXh0YCByZWNvcmRzOyBibGFuayBsaW5lcyBzZXBhcmF0ZVxuICAgICAgLy8gZmlsZSBzZWN0aW9uczsgYW55IG5vbi1yZWNvcmQgbGluZSBzdGFydHMgdGhlIG5leHQgZmlsZSdzIHNlY3Rpb24uXG4gICAgICB7XG4gICAgICAgIGxldCBjdXJyZW50OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgICAgICAgIGlmIChsaW5lID09PSAnJykgY29udGludWU7XG4gICAgICAgICAgY29uc3QgcmVjID0gcGFyc2VPbmVGaWxlUmVjb3JkKGxpbmUpO1xuICAgICAgICAgIGlmIChyZWMgPT09IG51bGwpIHtcbiAgICAgICAgICAgIGN1cnJlbnQgPSBsaW5lO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY3VycmVudCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmVjb3Jkcy5wdXNoKHsgcGF0aDogY3VycmVudCwgbGluZTogcmVjLmxpbmUsIHRleHQ6IHJlYy50ZXh0IH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnb25lLWZpbGUnOlxuICAgICAgaWYgKHNpbmdsZUZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlT25lRmlsZVJlY29yZChsaW5lKTtcbiAgICAgICAgICBpZiAocmVjICE9PSBudWxsKSByZWNvcmRzLnB1c2goeyBwYXRoOiBzaW5nbGVGaWxlQXJnLCBsaW5lOiByZWMubGluZSwgdGV4dDogcmVjLnRleHQgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ251bGwtc2VwYXJhdGVkJzpcbiAgICAgIC8vIGBncmVwIC16YDogZWFjaCBtYXRjaGluZyBmaWxlIGFycml2ZXMgYXMgb25lIE5VTC10ZXJtaW5hdGVkXG4gICAgICAvLyBgcGF0aDoxOjxlbnRpcmUgZmlsZSBjb250ZW50PmAgcmVjb3JkLiBUaGUgcmVjb3JkIGlzIGZ1bGx5IG9ic2VydmVkXG4gICAgICAvLyBvbmx5IHdoZW4gaXRzIHRlcm1pbmF0aW5nIE5VTCBpcyBwcmVzZW50LlxuICAgICAge1xuICAgICAgICBjb25zdCBwYXJ0cyA9IHN0ZG91dC5zcGxpdCgnXFwwJyk7XG4gICAgICAgIGlmICghc3Rkb3V0LmVuZHNXaXRoKCdcXDAnKSkgcGFydHMucG9wKCk7XG4gICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgICAgIGlmIChwYXJ0ID09PSAnJykgY29udGludWU7XG4gICAgICAgICAgY29uc3QgcmVjID0gcGFyc2VSZWNvcmQocGFydCwgJzonKTtcbiAgICAgICAgICBpZiAocmVjID09PSBudWxsIHx8IHJlYy5saW5lICE9PSAxKSBjb250aW51ZTtcbiAgICAgICAgICByZWNvcmRzLnB1c2goeyBwYXRoOiByZWMucGF0aCwgbGluZTogbnVsbCwgdGV4dDogcmVjLnRleHQgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICB9XG4gIHJldHVybiByZWNvcmRzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNjb3BlIHJlc3RyaWN0aW9uIGFuZCBjb2FsZXNjaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoZXRoZXIgYGFic2AgcmVzb2x2ZXMgaW5zaWRlIG9uZSBvZiB0aGUgcGVybWl0dGVkIHJvb3RzIChwYXRoLXByZWZpeCBjb250YWlubWVudCkuICovXG5mdW5jdGlvbiBpbnNpZGVSb290KGFiczogc3RyaW5nLCByb290czogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCByb290IG9mIHJvb3RzKSB7XG4gICAgaWYgKGFicyA9PT0gcm9vdCB8fCBhYnMuc3RhcnRzV2l0aChyb290ICsgc2VwKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogV2hldGhlciBgYWJzYCBpcyBhbiBleGlzdGluZyByZWd1bGFyIGZpbGUgKGZvbGxvd2luZyBzeW1saW5rcykuICovXG5mdW5jdGlvbiBpc0ZpbGUoYWJzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gc3RhdFN5bmMoYWJzKS5pc0ZpbGUoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCB3b3JrdHJlZSByb290IGNvbnRhaW5pbmcgYHN0YXJ0RGlyYCwgZm91bmQgYnkgd2Fsa2luZyB1cCBmb3IgdGhlXG4gKiBmaXJzdCBkaXJlY3RvcnkgaG9sZGluZyBhIGAuZ2l0YCBlbnRyeSBcdTIwMTQgYSBkaXJlY3RvcnkgaW4gYSByZWd1bGFyIHJlcG8sIGFcbiAqIGBnaXRkaXI6YCBmaWxlIGluIGEgbGlua2VkIHdvcmt0cmVlIG9yIHN1Ym1vZHVsZS4gRGlmZi1mb3JtIG91dHB1dCBwYXRoc1xuICogYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSByZWdhcmRsZXNzIG9mIGN3ZCwgc28gZGlmZiBkZWNvZGUgcmVzb2x2ZXMgYWdhaW5zdFxuICogdGhpcyByb290IHJhdGhlciB0aGFuIHRoZSBlZmZlY3RpdmUgZGlyOyBzZWFyY2gtbGF5b3V0IHBhdGhzIGFyZVxuICogY3dkLXJlbGF0aXZlIGFuZCBzdGF5IGFuY2hvcmVkIHRvIHRoZSBlZmZlY3RpdmUgZGlyLiBObyBzdWJwcm9jZXNzIFx1MjAxNCB0aGVcbiAqIGNvbW1vbiBsYXllciBpbXBvcnRzIG9ubHkgbm9kZTogYnVpbHRpbnMuIE51bGwgd2hlbiBgc3RhcnREaXJgIGlzIG5vdFxuICogaW5zaWRlIGFueSB3b3JrdHJlZTsgZGlmZiBvdXRwdXQgaXMgdGhlbiBzdXNwZWN0IGFuZCB0aGUgcGFyc2UgZmFpbHNcbiAqIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gZmluZEdpdFJvb3Qoc3RhcnREaXI6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBsZXQgZGlyID0gc3RhcnREaXI7XG4gIGZvciAoOzspIHtcbiAgICBpZiAoZXhpc3RzU3luYyhqb2luKGRpciwgJy5naXQnKSkpIHJldHVybiBkaXI7XG4gICAgY29uc3QgcGFyZW50ID0gZGlybmFtZShkaXIpO1xuICAgIGlmIChwYXJlbnQgPT09IGRpcikgcmV0dXJuIG51bGw7XG4gICAgZGlyID0gcGFyZW50O1xuICB9XG59XG5cbi8qKlxuICogT3JkZXIgc3BhbnMgZGV0ZXJtaW5pc3RpY2FsbHkgYW5kIGNhcCB0aGUgY291bnQgKGZhaWwtY2xvc2VkIGJleW9uZFxuICogYE1BWF9SRVNQT05TRV9TUEFOU2ApOiB0aGUgZmlyc3QgNTAgc3BhbnMgaW4gcGF0aCBvcmRlciBhcmUgZW1pdHRlZCwgdGhlXG4gKiByZXN0IGFyZSBkcm9wcGVkLiBOb3JtYWwgcGFyc2VzIGtlZXAgdGhlaXIgZW1pc3Npb24gb3JkZXIgXHUyMDE0IHRoZSBzb3J0IG9ubHlcbiAqIGVuZ2FnZXMgd2hlbiB0aGUgY2FwIGJpbmRzLlxuICovXG5mdW5jdGlvbiBjYXBTcGFucyhzcGFuczogUmVzb2x2ZWRTcGFuW10pOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGlmIChzcGFucy5sZW5ndGggPD0gTUFYX1JFU1BPTlNFX1NQQU5TKSByZXR1cm4gc3BhbnM7XG4gIGNvbnN0IG9yZGVyZWQgPSBbLi4uc3BhbnNdLnNvcnQoXG4gICAgKGEsIGIpID0+IGEuYWJzb2x1dGVQYXRoLmxvY2FsZUNvbXBhcmUoYi5hYnNvbHV0ZVBhdGgpIHx8IGEubGluZVN0YXJ0IC0gYi5saW5lU3RhcnQgfHwgYS5saW5lRW5kIC0gYi5saW5lRW5kXG4gICk7XG4gIHJldHVybiBvcmRlcmVkLnNsaWNlKDAsIE1BWF9SRVNQT05TRV9TUEFOUyk7XG59XG5cbi8qKlxuICogQ29hbGVzY2UgcGVyLWZpbGUgbGluZSBudW1iZXJzIGludG8gY29udGlndW91cyByYW5nZXM7IGFkamFjZW50IGFuZFxuICogb3ZlcmxhcHBpbmcgbGluZXMgbWVyZ2UsIGFuZCBkdXBsaWNhdGVzIG5ldmVyIGNyZWF0ZSBkdXBsaWNhdGUgc3VyZmFjZXMuXG4gKi9cbmZ1bmN0aW9uIGNvYWxlc2NlKGxpbmVzOiBudW1iZXJbXSk6IEFycmF5PFtudW1iZXIsIG51bWJlcl0+IHtcbiAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBzb3J0ZWQgPSBbLi4ubGluZXNdLnNvcnQoKGEsIGIpID0+IGEgLSBiKTtcbiAgY29uc3QgcmFuZ2VzOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiA9IFtdO1xuICBsZXQgc3RhcnQgPSBzb3J0ZWRbMF07XG4gIGxldCBlbmQgPSBzb3J0ZWRbMF07XG4gIGZvciAoY29uc3QgbiBvZiBzb3J0ZWQuc2xpY2UoMSkpIHtcbiAgICBpZiAobiA8PSBlbmQgKyAxKSB7XG4gICAgICBpZiAobiA+IGVuZCkgZW5kID0gbjtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2VzLnB1c2goW3N0YXJ0LCBlbmRdKTtcbiAgICAgIHN0YXJ0ID0gbjtcbiAgICAgIGVuZCA9IG47XG4gICAgfVxuICB9XG4gIHJhbmdlcy5wdXNoKFtzdGFydCwgZW5kXSk7XG4gIHJldHVybiByYW5nZXM7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBwZXItZmlsZSBsaW5lIHNldHMgaW50byBzcGFuczogcGF0aHMgcmVzb2x2ZSBhZ2FpbnN0IGBiYXNlRGlyYCxcbiAqIG11c3Qgc2l0IGluc2lkZSBvbmUgb2YgdGhlIHBlcm1pdHRlZCBgcm9vdHNgIChhIHRyYXZlcnNhbCBwYXRoIG5vcm1hbGl6ZXNcbiAqIG91dHNpZGUgdGhlbSBhbmQgaXMgcmVqZWN0ZWQpLCBhbmQgdGhlaXIgbGluZXMgY29hbGVzY2UgaW50byBjb250aWd1b3VzXG4gKiByYW5nZXMuXG4gKi9cbmZ1bmN0aW9uIHNwYW5zRm9yKHBlckZpbGU6IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PiwgYmFzZURpcjogc3RyaW5nLCByb290czogc3RyaW5nW10pOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCBsaW5lc10gb2YgcGVyRmlsZSkge1xuICAgIGNvbnN0IGFicyA9IHJlc29sdmVQYXRoKGJhc2VEaXIsIHBhdGgpO1xuICAgIGlmICghaW5zaWRlUm9vdChhYnMsIHJvb3RzKSkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBbbGluZVN0YXJ0LCBsaW5lRW5kXSBvZiBjb2FsZXNjZShbLi4ubGluZXNdKSkge1xuICAgICAgc3BhbnMucHVzaCh7IGxpbmVTdGFydCwgbGluZUVuZCwgYWJzb2x1dGVQYXRoOiBhYnMgfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzcGFucztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBVbmlmaWVkLWRpZmYgZGVjb2RlciAoYGdpdCBkaWZmYCwgZGlmZi1mb3JtIGBnaXQgc2hvd2AsIGBnaXQgbG9nIC1wYClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEEgdW5pZmllZC1kaWZmIGh1bmsgaGVhZGVyOiBgQEAgLWFbLGJdICtjWyxkXSBAQGA7IG9taXR0ZWQgY291bnRzIG1lYW4gMS5cbiAqIEEgY3V0LW9mZiBoZWFkZXIgKG1pc3NpbmcgdGhlIGNsb3NpbmcgYEBAYCkgZG9lcyBub3QgbWF0Y2ggYW5kIGl0cyBodW5rIGlzXG4gKiBpZ25vcmVkLiBDb21iaW5lZC1kaWZmIGBAQEBgIGhlYWRlcnMgZG8gbm90IG1hdGNoICh0aGVpciByZWNvcmRzIGFyZVxuICogcmVqZWN0ZWQgYXQgdGhlIGBkaWZmIC0tY2NgIGxpbmUgYW55d2F5KS5cbiAqL1xuY29uc3QgSFVOS19IRUFERVIgPSAvXkBAIC0oXFxkKykoPzosKFxcZCspKT8gXFwrKFxcZCspKD86LChcXGQrKSk/IEBALztcblxuLyoqIFN0cmlwIHRoZSBgYS9gL2BiL2AgcHJlZml4IGEgdW5pZmllZC1kaWZmIHBhdGggY2Fycmllcy4gKi9cbmZ1bmN0aW9uIHN0cmlwRGlmZlByZWZpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCdhLycpIHx8IHAuc3RhcnRzV2l0aCgnYi8nKSA/IHAuc2xpY2UoMikgOiBwO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgYGRpZmYgLS1naXQgYS9vbGQgYi9uZXdgIGZpbGUgaGVhZGVyLCBgZGlmZiAtLWNjYC9gLS1jb21iaW5lZGBcbiAqIChhIHJlYWwgbWVyZ2UtY29uZmxpY3QgY29tYmluZWQgZGlmZjogbm8gcmFuZ2VzKSwgb3IgcmV0dXJuIG51bGwgZm9yXG4gKiBub24taGVhZGVyIGxpbmVzLiBBIGhlYWRlciB3aG9zZSBwYXRocyBhcmUgcXVvdGVkIGlzIHVucGFyc2VhYmxlIFx1MjAxNCB0aGVcbiAqIHBsYW4ncyBmYWlsLWNsb3NlZCBydWxlIGZvciBxdW90ZWQvdW5lc2NhcGFibGUgcGF0aHMuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlRGlmZkhlYWRlcihcbiAgbGluZTogc3RyaW5nXG4pOlxuICB8IHsga2luZDogJ2ZpbGUnOyBvbGRQYXRoOiBzdHJpbmcgfCBudWxsOyBuZXdQYXRoOiBzdHJpbmcgfCBudWxsIH1cbiAgfCB7IGtpbmQ6ICdjb21iaW5lZCcgfVxuICB8IHsga2luZDogJ3VucGFyc2VhYmxlJyB9XG4gIHwgbnVsbCB7XG4gIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ2RpZmYgLS1jYyAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ2RpZmYgLS1jb21iaW5lZCAnKSkgcmV0dXJuIHsga2luZDogJ2NvbWJpbmVkJyB9O1xuICBpZiAoIWxpbmUuc3RhcnRzV2l0aCgnZGlmZiAtLWdpdCAnKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRva2VucyA9IGxpbmUuc2xpY2UoJ2RpZmYgLS1naXQgJy5sZW5ndGgpLnRyaW0oKS5zcGxpdCgvXFxzKy8pO1xuICBpZiAodG9rZW5zLmxlbmd0aCAhPT0gMiB8fCB0b2tlbnNbMF0uc3RhcnRzV2l0aCgnXCInKSB8fCB0b2tlbnNbMV0uc3RhcnRzV2l0aCgnXCInKSkgcmV0dXJuIHsga2luZDogJ3VucGFyc2VhYmxlJyB9O1xuICByZXR1cm4geyBraW5kOiAnZmlsZScsIG9sZFBhdGg6IHN0cmlwRGlmZlByZWZpeCh0b2tlbnNbMF0pLCBuZXdQYXRoOiBzdHJpcERpZmZQcmVmaXgodG9rZW5zWzFdKSB9O1xufVxuXG4vKipcbiAqIFBhcnNlIGEgYC0tLSBhL3BhdGhgIC8gYCsrKyBiL3BhdGhgIHNpZGUgbGluZS4gYC9kZXYvbnVsbGAgbWVhbnMgdGhlIHNpZGVcbiAqIGRvZXMgbm90IGV4aXN0IChuZXctZmlsZSAvIGRlbGV0aW9uIHNpZGVzKS4gQSBxdW90ZWQgcGF0aCBpcyB1bnBhcnNlYWJsZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VEaWZmU2lkZShcbiAgbGluZTogc3RyaW5nLFxuICBtYXJrZXI6ICctLS0nIHwgJysrKydcbik6IHsga2luZDogJ3NpZGUnOyBwYXRoOiBzdHJpbmcgfCBudWxsIH0gfCB7IGtpbmQ6ICd1bnBhcnNlYWJsZScgfSB8IG51bGwge1xuICBpZiAoIWxpbmUuc3RhcnRzV2l0aChgJHttYXJrZXJ9IGApKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcCA9IGxpbmUuc2xpY2UobWFya2VyLmxlbmd0aCArIDEpO1xuICBpZiAocC5zdGFydHNXaXRoKCdcIicpKSByZXR1cm4geyBraW5kOiAndW5wYXJzZWFibGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdzaWRlJywgcGF0aDogcCA9PT0gJy9kZXYvbnVsbCcgPyBudWxsIDogc3RyaXBEaWZmUHJlZml4KHApIH07XG59XG5cbi8qKiBPbmUgZmlsZSBzZWN0aW9uIG9mIGEgcmVzcG9uc2UsIGluIHRoZSBkZWNvZGVyJ3Mgd29ya2luZyBzdGF0ZS4gKi9cbmludGVyZmFjZSBEaWZmUmVjb3JkU3RhdGUge1xuICBvbGRQYXRoOiBzdHJpbmcgfCBudWxsO1xuICBuZXdQYXRoOiBzdHJpbmcgfCBudWxsO1xuICAvKiogUmVuYW1lL2NvcHkgbWV0YWRhdGEgcHJlc2VudCAoYHJlbmFtZSBmcm9tYC9gcmVuYW1lIHRvYCwgYGNvcHkgZnJvbWAvYGNvcHkgdG9gKTogdGhlIG5ldyBwYXRoIGlzIHRoZSBvbmx5IHRvdWNoIHRhcmdldC4gKi9cbiAgcmVuYW1lOiBib29sZWFuO1xuICBiaW5hcnk6IGJvb2xlYW47XG4gIGNvbWJpbmVkOiBib29sZWFuO1xuICBzdWJtb2R1bGU6IGJvb2xlYW47XG4gIC8qKiBBIHF1b3RlZC91bmVzY2FwYWJsZSBwYXRoOiB0aGUgcmVjb3JkIHByb2R1Y2VzIG5vIHJhbmdlLiAqL1xuICB1bnVzYWJsZTogYm9vbGVhbjtcbiAgLyoqIEEgaHVuayBoZWFkZXIgaGFzIGJlZW4gc2VlbjogbGF0ZXIgYC0tLWAvYCsrK2AtbG9va2luZyBsaW5lcyBhcmUgaHVuayBib2R5IGxpbmVzLCBub3Qgc2lkZSBoZWFkZXJzLiAqL1xuICBzYXdIdW5rOiBib29sZWFuO1xufVxuXG4vKipcbiAqIERlY29kZSBhIHVuaWZpZWQtZGlmZiByZXNwb25zZSBpbnRvIHBlci1wYXRoIGxpbmUgc2V0cy4gT25seSBodW5rIGhlYWRlcnNcbiAqIGNhcnJ5IHBvc2l0aW9uYWwgZGF0YSBcdTIwMTQgYm9keSBsaW5lcyBhcmUgaWdub3JlZCBcdTIwMTQgYW5kIGVhY2ggaGVhZGVyJ3Mgc2lkZVxuICogcmFuZ2VzIGF0dGFjaCB0byBpdHMgc2lkZSdzIHBhdGggKGAvZGV2L251bGxgIHNpZGVzIGhhdmUgbm8gcGF0aCkuXG4gKiBCaW5hcnksIGNvbWJpbmVkLCBzdWJtb2R1bGUsIGFuZCB1bnBhcnNlYWJsZSByZWNvcmRzIGVtaXQgbm90aGluZztcbiAqIHJlbmFtZS9jb3B5IHJlY29yZHMgZW1pdCB0aGUgbmV3IHNpZGUgb25seS4gYGluZGV4YCBsaW5lcyBhbmRcbiAqIGBcXCBObyBuZXdsaW5lIGF0IGVuZCBvZiBmaWxlYCBtYXJrZXJzIGFyZSBtZXRhZGF0YSBhbmQgZmFsbCB0aHJvdWdoLiBUaGVcbiAqIHVuaXZlcnNhbCB0ZXJtaW5hdGluZy1uZXdsaW5lIHJ1bGUgYXBwbGllcyB2aWEgY29tcGxldGVMaW5lcy5cbiAqL1xuZnVuY3Rpb24gZGVjb2RlVW5pZmllZERpZmYoc3Rkb3V0OiBzdHJpbmcpOiBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4ge1xuICBjb25zdCBwZXJGaWxlID0gbmV3IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PigpO1xuICBsZXQgY3VycmVudDogRGlmZlJlY29yZFN0YXRlIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgbGluZSBvZiBjb21wbGV0ZUxpbmVzKHN0ZG91dCkpIHtcbiAgICBjb25zdCBoZWFkZXIgPSBwYXJzZURpZmZIZWFkZXIobGluZSk7XG4gICAgaWYgKGhlYWRlciAhPT0gbnVsbCkge1xuICAgICAgY3VycmVudCA9IHtcbiAgICAgICAgb2xkUGF0aDogaGVhZGVyLmtpbmQgPT09ICdmaWxlJyA/IGhlYWRlci5vbGRQYXRoIDogbnVsbCxcbiAgICAgICAgbmV3UGF0aDogaGVhZGVyLmtpbmQgPT09ICdmaWxlJyA/IGhlYWRlci5uZXdQYXRoIDogbnVsbCxcbiAgICAgICAgcmVuYW1lOiBmYWxzZSxcbiAgICAgICAgYmluYXJ5OiBmYWxzZSxcbiAgICAgICAgY29tYmluZWQ6IGhlYWRlci5raW5kID09PSAnY29tYmluZWQnLFxuICAgICAgICBzdWJtb2R1bGU6IGZhbHNlLFxuICAgICAgICB1bnVzYWJsZTogaGVhZGVyLmtpbmQgPT09ICd1bnBhcnNlYWJsZScsXG4gICAgICAgIHNhd0h1bms6IGZhbHNlXG4gICAgICB9O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjdXJyZW50ID09PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdCaW5hcnkgZmlsZXMgJykpIHtcbiAgICAgIGN1cnJlbnQuYmluYXJ5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBTdWJtb2R1bGUgbWFya2VyczogYSBgbW9kZSAxNjAwMDBgIG1ldGFkYXRhIGxpbmUsIG9yIGBTdWJwcm9qZWN0XG4gICAgLy8gY29tbWl0YCBsaW5lcyAodGhlaXIgb3duICsvLSBib2R5IGxpbmVzKS4gVGhlIG1vZGUgY2hlY2sgZXhjbHVkZXNcbiAgICAvLyBodW5rIGJvZHkgbGluZXMgc28gZmlsZSBjb250ZW50IHRoYXQgbWVudGlvbnMgdGhlIG1vZGUgY2FuJ3QgcmVqZWN0XG4gICAgLy8gYSByZWFsIHJlY29yZC5cbiAgICBjb25zdCBpc0JvZHlMaW5lID0gbGluZS5zdGFydHNXaXRoKCcgJykgfHwgbGluZS5zdGFydHNXaXRoKCcrJykgfHwgbGluZS5zdGFydHNXaXRoKCctJykgfHwgbGluZS5zdGFydHNXaXRoKCdcXFxcJyk7XG4gICAgaWYgKCFpc0JvZHlMaW5lICYmIGxpbmUuaW5jbHVkZXMoJ21vZGUgMTYwMDAwJykpIHtcbiAgICAgIGN1cnJlbnQuc3VibW9kdWxlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5pbmNsdWRlcygnU3VicHJvamVjdCBjb21taXQnKSkge1xuICAgICAgY3VycmVudC5zdWJtb2R1bGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIGZyb20gJykgfHxcbiAgICAgIGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIHRvICcpIHx8XG4gICAgICBsaW5lLnN0YXJ0c1dpdGgoJ2NvcHkgZnJvbSAnKSB8fFxuICAgICAgbGluZS5zdGFydHNXaXRoKCdjb3B5IHRvICcpXG4gICAgKSB7XG4gICAgICBjdXJyZW50LnJlbmFtZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFjdXJyZW50LnNhd0h1bmspIHtcbiAgICAgIGNvbnN0IG9sZFNpZGUgPSBwYXJzZURpZmZTaWRlKGxpbmUsICctLS0nKTtcbiAgICAgIGlmIChvbGRTaWRlICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChvbGRTaWRlLmtpbmQgPT09ICd1bnBhcnNlYWJsZScpIGN1cnJlbnQudW51c2FibGUgPSB0cnVlO1xuICAgICAgICBlbHNlIGN1cnJlbnQub2xkUGF0aCA9IG9sZFNpZGUucGF0aDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBuZXdTaWRlID0gcGFyc2VEaWZmU2lkZShsaW5lLCAnKysrJyk7XG4gICAgICBpZiAobmV3U2lkZSAhPT0gbnVsbCkge1xuICAgICAgICBpZiAobmV3U2lkZS5raW5kID09PSAndW5wYXJzZWFibGUnKSBjdXJyZW50LnVudXNhYmxlID0gdHJ1ZTtcbiAgICAgICAgZWxzZSBjdXJyZW50Lm5ld1BhdGggPSBuZXdTaWRlLnBhdGg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBodW5rID0gSFVOS19IRUFERVIuZXhlYyhsaW5lKTtcbiAgICBpZiAoaHVuayAhPT0gbnVsbCkge1xuICAgICAgY3VycmVudC5zYXdIdW5rID0gdHJ1ZTtcbiAgICAgIGVtaXRIdW5rUmFuZ2UocGVyRmlsZSwgY3VycmVudCwgaHVuayk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwZXJGaWxlO1xufVxuXG4vKiogQXR0cmlidXRlIG9uZSBodW5rIGhlYWRlcidzIHBlci1zaWRlIHJhbmdlcyB0byBpdHMgcmVjb3JkJ3MgcGF0aHMuICovXG5mdW5jdGlvbiBlbWl0SHVua1JhbmdlKHBlckZpbGU6IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PiwgcmVjb3JkOiBEaWZmUmVjb3JkU3RhdGUsIGh1bms6IFJlZ0V4cEV4ZWNBcnJheSk6IHZvaWQge1xuICBpZiAocmVjb3JkLmJpbmFyeSB8fCByZWNvcmQuY29tYmluZWQgfHwgcmVjb3JkLnN1Ym1vZHVsZSB8fCByZWNvcmQudW51c2FibGUpIHJldHVybjtcbiAgY29uc3Qgb2xkU3RhcnQgPSBOdW1iZXIucGFyc2VJbnQoaHVua1sxXSwgMTApO1xuICBjb25zdCBvbGRDb3VudCA9IGh1bmtbMl0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1syXSwgMTApO1xuICBjb25zdCBuZXdTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzNdLCAxMCk7XG4gIGNvbnN0IG5ld0NvdW50ID0gaHVua1s0XSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzRdLCAxMCk7XG4gIC8vIFJlbmFtZS9jb3B5OiB0aGUgbmV3IHBhdGggaXMgdGhlIHRvdWNoIHRhcmdldDsgdGhlIG9sZCBzaWRlIGlzIGRyb3BwZWRcbiAgLy8gKHRoZSBvbGQgcGF0aCBtYXkgbm90IGV4aXN0IG9uIGRpc2sgXHUyMDE0IGl0IHdhcyByZW5hbWVkIGF3YXkpLlxuICBpZiAocmVjb3JkLnJlbmFtZSkge1xuICAgIGlmIChyZWNvcmQubmV3UGF0aCAhPT0gbnVsbCkgYWRkTGluZXMocGVyRmlsZSwgcmVjb3JkLm5ld1BhdGgsIG5ld1N0YXJ0LCBuZXdDb3VudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChyZWNvcmQub2xkUGF0aCAhPT0gbnVsbCkgYWRkTGluZXMocGVyRmlsZSwgcmVjb3JkLm9sZFBhdGgsIG9sZFN0YXJ0LCBvbGRDb3VudCk7XG4gIGlmIChyZWNvcmQubmV3UGF0aCAhPT0gbnVsbCkgYWRkTGluZXMocGVyRmlsZSwgcmVjb3JkLm5ld1BhdGgsIG5ld1N0YXJ0LCBuZXdDb3VudCk7XG59XG5cbi8qKiBBZGQgYGNvdW50YCBjb25zZWN1dGl2ZSAxLWJhc2VkIGxpbmVzIHN0YXJ0aW5nIGF0IGBzdGFydGAgdG8gYHBhdGhgJ3Mgc2V0LiAqL1xuZnVuY3Rpb24gYWRkTGluZXMocGVyRmlsZTogTWFwPHN0cmluZywgU2V0PG51bWJlcj4+LCBwYXRoOiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIsIGNvdW50OiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKHN0YXJ0IDwgMSB8fCBjb3VudCA8PSAwKSByZXR1cm47XG4gIGxldCBsaW5lcyA9IHBlckZpbGUuZ2V0KHBhdGgpO1xuICBpZiAobGluZXMgPT09IHVuZGVmaW5lZCkge1xuICAgIGxpbmVzID0gbmV3IFNldCgpO1xuICAgIHBlckZpbGUuc2V0KHBhdGgsIGxpbmVzKTtcbiAgfVxuICBmb3IgKGxldCBuID0gc3RhcnQ7IG4gPCBzdGFydCArIGNvdW50OyBuKyspIGxpbmVzLmFkZChuKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBgZ2l0IGJsYW1lIC1MYCBjb21tYW5kLXRleHQgbWF0Y2hlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogTWF0Y2ggYSBgZ2l0IGJsYW1lIC1MIE4sTSA8ZmlsZT5gIGludm9jYXRpb24gZnJvbSBjb21tYW5kIHRleHQ6IHRoZSBleGFjdFxuICogbGl0ZXJhbCBgTixNYCByYW5nZSBmcm9tIHRoZSBgLUxgIHZhbHVlIGFuZCB0aGUgc2luZ2xlIHBhdGggcG9zaXRpb25hbFxuICogdGhhdCBmb2xsb3dzIGl0IChlYXJsaWVyIHBvc2l0aW9uYWxzIGFyZSByZXZpc2lvbnMpLiBgZ2l0IGxvZyAtTGAgZW1iZWRzXG4gKiB0aGUgcGF0aCBpbiBpdHMgc3BlYyBhbmQgcGFyc2UtY29tbWFuZC50cyBhbHJlYWR5IGNvdmVycyBpdDsgYmxhbWUgdGFrZXNcbiAqIHRoZSBwYXRoIGFzIGEgcG9zaXRpb25hbCwgd2hpY2ggdGhlIGNvbW1hbmQtb25seSBwYXJzZXIgZG9lcyBub3QgaGFuZGxlLlxuICovXG5mdW5jdGlvbiBtYXRjaEJsYW1lUmFuZ2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBzdGFydDogbnVtYmVyXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXI7IGZpbGVBcmc6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNwZWNJZHggPSAtMTtcbiAgY29uc3QgcG9zaXRpb25hbHM6IEFycmF5PHsgYXJnOiBzdHJpbmc7IGlkeDogbnVtYmVyIH0+ID0gW107XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgYXJndi5sZW5ndGg7IGorKykgcG9zaXRpb25hbHMucHVzaCh7IGFyZzogYXJndltqXSwgaWR4OiBqIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChhID09PSAnLUwnKSB7XG4gICAgICBzcGVjID0gYXJndltpICsgMV0gPz8gbnVsbDtcbiAgICAgIHNwZWNJZHggPSBpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHtcbiAgICAgIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgICAgc3BlY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBwb3NpdGlvbmFscy5wdXNoKHsgYXJnOiBhLCBpZHg6IGkgfSk7XG4gIH1cbiAgaWYgKHNwZWMgPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBtID0gL14oXFxkKyksKFxcZCspJC8uZXhlYyhzcGVjKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBmaWxlcyA9IHBvc2l0aW9uYWxzLmZpbHRlcigocCkgPT4gcC5pZHggPiBzcGVjSWR4KTtcbiAgaWYgKGZpbGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7XG4gICAgbGluZVN0YXJ0OiBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApLFxuICAgIGxpbmVFbmQ6IE51bWJlci5wYXJzZUludChtWzJdLCAxMCksXG4gICAgZmlsZUFyZzogZmlsZXNbMF0uYXJnXG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3JjaGVzdHJhdG9yXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBEZXJpdmVzIHByZWNpc2UgcGVyLWZpbGUgcmVhZCByYW5nZXMgZnJvbSBhIHJlc3BvbnNlLXByb2R1Y2luZyBjb21tYW5kOlxuICogY29tbWFuZCBnYXRpbmcsIHNjb3BlIHJlc3RyaWN0aW9uIGFnYWluc3QgdGhlIGNvbW1hbmQncyBkZWNsYXJlZCByb290cyxcbiAqIHNlYXJjaC1sYXlvdXQgZGVjb2RpbmcsIHVuaWZpZWQtZGlmZiBkZWNvZGluZywgY29hbGVzY2luZywgYW5kIHRoZVxuICogZmFpbC1jbG9zZWQgdHJ1bmNhdGlvbi9ob3N0aWxlLW91dHB1dCBydWxlcy4gUmV0dXJucyBbXSBmb3IgYW55dGhpbmcgbm90XG4gKiByZXNwb25zZS1kZXJpdmFibGUgb3Igbm90IGZ1bGx5IG9ic2VydmVkLlxuICpcbiAqIFBoYXNlIDNhIGNvdmVycyB0aGUgZ3JlcC9yaXBncmVwIGZhbWlseSAoYHJnYCwgYGdyZXBgLCBgZWdyZXBgLCBgZmdyZXBgLFxuICogYGdpdCBncmVwYCk7IFBoYXNlIDNiIHRoZSBkaWZmLWZvcm0gYGdpdCBkaWZmYC9gZ2l0IHNob3dgL2BnaXQgbG9nIC1wYFxuICogdW5pZmllZC1kaWZmIGRlY29kZXI7IFBoYXNlIDNjIHRoZSBgZ2l0IGJsYW1lIC1MIE4sTSBmaWxlYCBjb21tYW5kLXRleHRcbiAqIG1hdGNoZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVJlc3BvbnNlKGlucHV0OiBSZXNwb25zZVBhcnNlSW5wdXQpOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IHsgY29tbWFuZCwgY3dkLCBzdGRvdXQgfSA9IGlucHV0O1xuXG4gIC8vIFdhbGsgdGhlIHNpbXBsZSBjb21tYW5kcyB0cmFja2luZyBgY2RgLCBleGFjdGx5IGxpa2UgcGFyc2UtY29tbWFuZC50cy5cbiAgLy8gVGhlIHJlc3BvbnNlIGlzIGF0dHJpYnV0ZWQgdG8gdGhlIEZJUlNUIGdhdGVkIHN0YWdlIChsZWZ0LXRvLXJpZ2h0OyBhXG4gIC8vIGxhdGVyIHN0YWdlIG5ldmVyIG92ZXJyaWRlcyBhbiBlYXJsaWVyIGdhdGVkIG9uZSk6IGluIGEgcGlwZWxpbmUgdGhlXG4gIC8vIGZpbmFsIHN0YWdlJ3Mgc3Rkb3V0IGlzIHRoZSBnYXRlZCBzdGFnZSdzIG91dHB1dCBcdTIwMTQgaGVhZC90YWlsL3djL3NvcnQvXG4gIC8vIHVuaXEvY3V0IG9ubHkgdHJ1bmNhdGUsIHJlb3JkZXIsIG9yIGRlZHVwZSwgYW5kIHRoZSB0ZXJtaW5hdGluZy1uZXdsaW5lXG4gIC8vIHJ1bGUgaGFuZGxlcyB0aGUgY3V0IFx1MjAxNCB3aGlsZSBhIHJlbnVtYmVyaW5nIHN0YWdlIChncmVwIC1uLCBubCwgY2F0IC1uLFxuICAvLyBhd2ssIHNlZCkgdHVybnMgdGhlIHJlY29yZHMgaW50byBzdHJlYW0gcG9zaXRpb25zLCBzbyBzdWNoIHBpcGVsaW5lc1xuICAvLyBmYWlsIGNsb3NlZCBiZWxvdy4gSW4gYSBgO2AvYCYmYC9gfHxgL2AmYC9uZXdsaW5lIGNoYWluIGV2ZXJ5IHNpYmxpbmdcbiAgLy8gc3RhZ2UncyBvdXRwdXQgbWl4ZXMgaW50byB0aGUgU0FNRSByZXNwb25zZSwgc28gdGhlIGNoYWluIGlzXG4gIC8vIGF0dHJpYnV0YWJsZSBvbmx5IHdoZW4gZXZlcnkgc2libGluZyAoZWl0aGVyIGRpcmVjdGlvbikgcGFzc2VzIHRoZSBzYW1lXG4gIC8vIHByb3ZhYmx5LXZlcmJhdGltIGNoZWNrIHRoZSBwaXBlIHN0YWdlcyBnZXQgXHUyMDE0IGEgY3JhZnRlZCBmaWxlIHJlYWQgYnlcbiAgLy8gYW55IHNpYmxpbmcgd291bGQgZGVjb2RlIGFzIHBoYW50b20gdG91Y2hlcyBvdGhlcndpc2UuIGBjZGAgdHJhY2tpbmdcbiAgLy8gYXBwbGllcyBvbmx5XG4gIC8vIHVudGlsIHRoZSBmaXJzdCBnYXRlZCBzdGFnZSBpcyBmb3VuZDogdGhlIGV2aWRlbmNlIHdhcyBwcm9kdWNlZCBpbiB0aGF0XG4gIC8vIGRpcmVjdG9yeSwgYW5kIGEgYGNkYCBpbiBhIGxhdGVyIHN0YWdlIHNheXMgbm90aGluZyBhYm91dCB3aGVyZSB0aGVcbiAgLy8gcmVzcG9uc2Ugd2FzIG1hZGUuXG4gIGxldCBjdXJyZW50RGlyID0gY3dkO1xuICBsZXQgZ2F0ZWQ6IEdhdGVkQ29tbWFuZCB8IG51bGwgPSBudWxsO1xuICAvLyBXaGV0aGVyIHRoZSBnYXRlZCBzdGFnZSdzIHN0ZGluIGNhbWUgZnJvbSBhIHBpcGUgXHUyMDE0IHRoZSBzaWduYWwgdGhhdCBpdHNcbiAgLy8gcmVjb3JkcyBhcmUgc3RyZWFtIHBvc2l0aW9ucyB3aGVuIG5vIHNlYXJjaCByb290cyB3ZXJlIGdpdmVuLlxuICBsZXQgZ2F0ZWRQcmVjZWRlZEJ5OiBPcGVyYXRvciA9ICdzdGFydCc7XG4gIC8vIFdoZXRoZXIgdGhlIGdhdGVkIHN0YWdlJ3Mgb3duIHRleHQgY2FycmllcyBhbiBVTlFVT1RFRCBgPGAgXHUyMDE0IGEgc3RkaW5cbiAgLy8gcmVkaXJlY3QsIHN0YW5kYWxvbmUgb3IgZ2x1ZWQgaW5zaWRlIGEgdG9rZW4gKGByZyBuZWVkbGU8Y3JhZnRlZC50eHRgLFxuICAvLyBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSkuIFRoZSBzdGRpbi1mZWQgcnVsZSBtdXN0IHNlZSBpdCBldmVuIHdoZW5cbiAgLy8gbm8gc3RhbmRhbG9uZSBgPGAgdG9rZW4gc3Vydml2ZXMgYXJndiBzcGxpdHRpbmcuIFF1b3RlLWF3YXJlOiBhIHF1b3RlZFxuICAvLyBsaXRlcmFsIGA8YCBpbiBhIHBhdHRlcm4gKGByZyAtbiAnPGRpdj4nYCkgaXMgbm90IGEgcmVkaXJlY3QuXG4gIGxldCBnYXRlZFJlZGlyZWN0ID0gZmFsc2U7XG4gIGNvbnN0IHNwbGl0ID0gc3BsaXRUb3BMZXZlbChjb21tYW5kKTtcbiAgLy8gQSBCYXNoIHBhcnNlIGVycm9yIG1lYW5zIG5vdGhpbmcgZXhlY3V0ZWQgKGJhc2ggZXhpdHMgMiBhdCBwYXJzZSB0aW1lKSBcdTIwMTRcbiAgLy8gdGhlIHJlc3BvbnNlIGNvdWxkIG5vdCBoYXZlIGJlZW4gcHJvZHVjZWQgYnkgdGhpcyBjb21tYW5kLCBzbyBmYWlsXG4gIC8vIGNsb3NlZCByYXRoZXIgdGhhbiBhdHRyaWJ1dGUgaXQgdG8gaGFsZi1wYXJzZWQgc3RhZ2VzLlxuICBpZiAoc3BsaXQubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcGFydHMgPSBzcGxpdC5zdGFnZXM7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBzaW1wbGUgPSBwYXJ0c1tpXTtcbiAgICBjb25zdCBhcmd2ID0gYXJndk9mKHNpbXBsZS50ZXh0KTtcbiAgICBpZiAoYXJndiA9PT0gbnVsbCB8fCBhcmd2Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjZCcpIHtcbiAgICAgIGlmIChnYXRlZCA9PT0gbnVsbCkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBhcmd2WzFdO1xuICAgICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgICBjdXJyZW50RGlyID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChnYXRlZCAhPT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKFNFQVJDSF9CSU5TLmhhcyhhcmd2WzBdKSkge1xuICAgICAgZ2F0ZWQgPSB7IGtpbmQ6ICdzZWFyY2gnLCBhcmd2LCBzdGFydDogMSwgZGlyOiBudWxsLCBkaXJVbnJlc29sdmFibGU6IGZhbHNlIH07XG4gICAgfSBlbHNlIGlmIChhcmd2WzBdID09PSAnZ2l0Jykge1xuICAgICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndik7XG4gICAgICBpZiAoc3ViICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSB7IGFyZ3YsIHN0YXJ0OiBzdWIuc3RhcnQsIGRpcjogc3ViLmRpciwgZGlyVW5yZXNvbHZhYmxlOiBzdWIuZGlyVW5yZXNvbHZhYmxlIH07XG4gICAgICAgIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ2dyZXAnKSBnYXRlZCA9IHsga2luZDogJ3NlYXJjaCcsIC4uLmJhc2UgfTtcbiAgICAgICAgLy8gYGdpdCBzaG93IDxyZXY+OjxwYXRoPmAgc3RyZWFtcyB0aGUgYmxvYidzIFJBVyBjb250ZW50LCBuZXZlciBhXG4gICAgICAgIC8vIGRpZmYgXHUyMDE0IGEgZGlmZi1zaGFwZWQgYmxvYiBtdXN0IG5vdCBkZWNvZGUgaW50byBmYWJyaWNhdGVkIHRvdWNoZXNcbiAgICAgICAgLy8gb24gdGhlIGZpbGVzIGl0cyBjb250ZW50IG5hbWVzLCBzbyB0aGUgY29udGVudCBpZGlvbSBpcyBleGNsdWRlZFxuICAgICAgICAvLyBmcm9tIHRoZSBkaWZmIGdhdGUuIGBnaXQgZGlmZiA8cmV2Pjo8cGF0aD5gIGVycm9ycyBpbnN0ZWFkIG9mXG4gICAgICAgIC8vIGVtaXR0aW5nIGNvbnRlbnQsIHNvIG9ubHkgYHNob3dgIG5lZWRzIHRoZSBjaGVjazsgdGhlIHR3by1hcmdcbiAgICAgICAgLy8gYmxvYi1ibG9iIGZvcm0gYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gIERPRVMgZW1pdCBhXG4gICAgICAgIC8vIGRpZmYgbmFtaW5nIHdvcmtpbmctdHJlZSBwYXRocyBnaXQgbmV2ZXIgcmVhZCBhbmQgaXMgcmVqZWN0ZWQgaW5cbiAgICAgICAgLy8gdGhlIGRpZmYgYnJhbmNoIGJlbG93LlxuICAgICAgICBlbHNlIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ3Nob3cnICYmICFoYXNSZXZQYXRoQXJnKGFyZ3YsIHN1Yi5zdGFydCkpIGdhdGVkID0geyBraW5kOiAnZGlmZicsIC4uLmJhc2UgfTtcbiAgICAgICAgZWxzZSBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdkaWZmJykgZ2F0ZWQgPSB7IGtpbmQ6ICdkaWZmJywgLi4uYmFzZSB9O1xuICAgICAgICBlbHNlIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ2xvZycgJiYgaGFzRGlmZlBhdGNoRmxhZyhhcmd2LCBzdWIuc3RhcnQpKSBnYXRlZCA9IHsga2luZDogJ2RpZmYnLCAuLi5iYXNlIH07XG4gICAgICAgIGVsc2UgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAnYmxhbWUnKSBnYXRlZCA9IHsga2luZDogJ2JsYW1lJywgLi4uYmFzZSB9O1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZ2F0ZWQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGdhdGVkUHJlY2VkZWRCeSA9IHNpbXBsZS5wcmVjZWRlZEJ5O1xuICAgIGdhdGVkUmVkaXJlY3QgPSBoYXNVbnF1b3RlZFJlZGlyZWN0KHNpbXBsZS50ZXh0KTtcbiAgICAvLyBFdmVyeSBPVEhFUiBzdGFnZSdzIHJlY29yZHMgY2FuIHJlYWNoIHRoZSByZXNwb25zZSwgc28gZWFjaCBtdXN0IGJlXG4gICAgLy8gcHJvdmFibHkgdmVyYmF0aW0gXHUyMDE0IHRoZSBkZWZhdWx0IG9mIGlzUmVudW1iZXJpbmdGaWx0ZXIgaXMgY2xvc2VkLCBzb1xuICAgIC8vIGFueSBiaW4gb3V0c2lkZSB0aGUgdmVyYmF0aW0gYWxsb3dsaXN0IChweXRob24sIHJ1YnksIG1hd2ssIFx1MjAyNikgbWF5XG4gICAgLy8gcmVudW1iZXIgb3IgcmV3cml0ZSB0aGUgcmVjb3JkcywgZGVzdHJveSB0aGUgZmlsZS1saW5lIG1hcHBpbmcgdGhleVxuICAgIC8vIGNhcnJ5LCBhbmQgdGhlIHBpcGVsaW5lIGZhaWxzIGNsb3NlZDogYXR0cmlidXRlIG5vdGhpbmcuIFRoYXQgY292ZXJzXG4gICAgLy8gdGhlIHBpcGUgc3RhZ2VzIG9mIHRoZSBzYW1lIHBpcGVsaW5lIEFORCB0aGUgY2hhaW4gc2libGluZ3Mgam9pbmVkXG4gICAgLy8gYnkgYDtgLCBgJiZgLCBgfHxgLCBgJmAsIG9yIGEgbmV3bGluZSBcdTIwMTQgaW4gZWl0aGVyIGRpcmVjdGlvbiBcdTIwMTQgd2hvc2VcbiAgICAvLyBvdXRwdXQgbWl4ZXMgaW50byB0aGUgc2FtZSByZXNwb25zZTogYSBjcmFmdGVkIGZpbGUgcmVhZCBieSBhbnlcbiAgICAvLyBzaWJsaW5nIGRlY29kZXMgYXMgcGhhbnRvbSB0b3VjaGVzLCBzbyBhIGNoYWluIGlzIGF0dHJpYnV0YWJsZSBvbmx5XG4gICAgLy8gd2hlbiBldmVyeSBzaWJsaW5nIHBhc3NlcyB0aGUgc2FtZSB2ZXJiYXRpbSBjaGVjay4gYGNkYCBzdGFnZXMgYXJlXG4gICAgLy8gc2tpcHBlZCBhYm92ZSAodGhlaXIgb3V0cHV0IGlzIGVtcHR5KSwgYW5kIGEgYHxgLWpvaW5lZCBmZWVkZXJcbiAgICAvLyBFQVJMSUVSIGluIHRoZSBwaXBlbGluZSBpcyBjb25zdW1lZCBieSB0aGUgZ2F0ZWQgc3RhZ2UgXHUyMDE0IGEgc2VhcmNoXG4gICAgLy8gd2l0aCBleHBsaWNpdCByb290cyBpZ25vcmVzIHN0ZGluLCBzbyB0aGUgZmVlZGVyJ3MgcmVjb3JkcyBuZXZlclxuICAgIC8vIHJlYWNoIHRoZSByZXNwb25zZS5cbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IHBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaiA9PT0gaSkgY29udGludWU7XG4gICAgICBpZiAoaiA8IGkpIHtcbiAgICAgICAgLy8gQSBmZWVkZXIncyBvdXRwdXQgaXMgY29uc3VtZWQgb25seSB3aGVuIEVWRVJZIHBhcnQgYmV0d2VlbiBpdFxuICAgICAgICAvLyBhbmQgdGhlIGdhdGVkIHN0YWdlIGlzIHBpcGUtam9pbmVkIFx1MjAxNCBhIGA7YC9gJiZgL1x1MjAyNiBhbnl3aGVyZSBpblxuICAgICAgICAvLyBiZXR3ZWVuIG1ha2VzIGl0IGEgY2hhaW4gc2libGluZyB3aG9zZSBvdXRwdXQgcmVhY2hlcyB0aGVcbiAgICAgICAgLy8gcmVzcG9uc2UgKHRocm91Z2ggdGhlIHN0YWdlcyBiZXR3ZWVuIHRoZW0pLlxuICAgICAgICBsZXQgY29uc3VtZWQgPSB0cnVlO1xuICAgICAgICBmb3IgKGxldCBrID0gaiArIDE7IGsgPD0gaSAmJiBjb25zdW1lZDsgaysrKSB7XG4gICAgICAgICAgaWYgKHBhcnRzW2tdLnByZWNlZGVkQnkgIT09ICdwaXBlJykgY29uc3VtZWQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY29uc3VtZWQpIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc2libGluZ1RleHQgPSBwYXJ0c1tqXS50ZXh0O1xuICAgICAgY29uc3Qgc2libGluZ0FyZ3YgPSBhcmd2T2Yoc2libGluZ1RleHQpO1xuICAgICAgaWYgKHNpYmxpbmdBcmd2ID09PSBudWxsIHx8IHNpYmxpbmdBcmd2Lmxlbmd0aCA9PT0gMCB8fCBzaWJsaW5nQXJndlswXSA9PT0gJ2NkJykgY29udGludWU7XG4gICAgICAvLyBBbiB1bnF1b3RlZCBgPGAgXHUyMDE0IGV2ZW4gR0xVRUQgaW5zaWRlIGEgZmxhZywgcGF0dGVybiwgb3IgdmFsdWUgdG9rZW5cbiAgICAgIC8vIChgaGVhZCAtMjxjcmFmdGVkLnR4dGAsIGBncmVwIG5lZWRsZTxjcmFmdGVkLnR4dGAsIGAtZSBuZWVkbGU8ZmApIFx1MjAxNFxuICAgICAgLy8gcmVkaXJlY3RzIHRoZSBzdGFnZSdzIHN0ZGluIHRvIGEgZmlsZSwgc28gaXRzIHJlY29yZHMgY29tZSBmcm9tIHRoYXRcbiAgICAgIC8vIGZpbGUsIG5vdCB0aGUgcGlwZTogYSBjcmFmdGVkIHJlY29yZCBkZWNvZGVzIGFzIGEgcGhhbnRvbSB0b3VjaCwgc29cbiAgICAgIC8vIGZhaWwgY2xvc2VkIGxpa2UgYW55IG90aGVyIGZpbGUgb3BlcmFuZC4gUXVvdGUtYXdhcmU6IGEgcXVvdGVkXG4gICAgICAvLyBsaXRlcmFsIGA8YCBpbiBhIHBhdHRlcm4gKGByZyAtbiAnPGRpdj4nYCkgaXMgbm90IGEgcmVkaXJlY3QuXG4gICAgICBpZiAoaGFzVW5xdW90ZWRSZWRpcmVjdChzaWJsaW5nVGV4dCkpIHJldHVybiBbXTtcbiAgICAgIGlmIChpc1JlbnVtYmVyaW5nRmlsdGVyKHNpYmxpbmdBcmd2KSkgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICBpZiAoZ2F0ZWQgPT09IG51bGwgfHwgZ2F0ZWQuZGlyVW5yZXNvbHZhYmxlKSByZXR1cm4gW107XG5cbiAgLy8gVGhlIGRpcmVjdG9yeSBzZWFyY2ggcGF0aHMgYXJlIHJlbGF0aXZlIHRvIFx1MjAxNCB0aGUgYGdpdCAtQ2AgdGFyZ2V0IHdoZW5cbiAgLy8gcHJlc2VudCwgb3RoZXJ3aXNlIHRoZSBzaGVsbCBjd2QgYWZ0ZXIgYW55IGBjZGAuXG4gIGNvbnN0IGVmZmVjdGl2ZURpciA9IGdhdGVkLmRpciAhPT0gbnVsbCA/IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGdhdGVkLmRpcikgOiBjdXJyZW50RGlyO1xuXG4gIC8vIGBnaXQgYmxhbWUgLUwgTixNIGZpbGVgIHJlc29sdmVzIHN0cmFpZ2h0IGZyb20gdGhlIGNvbW1hbmQgdGV4dDsgdGhlXG4gIC8vIHJlc3BvbnNlJ3MgY29udGVudCBpcyBpcnJlbGV2YW50IHRvIGl0LCBzbyB0aGUgQU5TSSByZWplY3Rpb24gYW5kIHRoZVxuICAvLyB0cnVuY2F0aW9uIGdhdGUgYmVsb3cgXHUyMDE0IGJvdGggcmVzcG9uc2UtZGVyaXZlZCBkZWNvZGUgZ2F0ZXMgXHUyMDE0IG11c3Qgbm90XG4gIC8vIHN1cHByZXNzIGl0LlxuICBpZiAoZ2F0ZWQua2luZCA9PT0gJ2JsYW1lJykge1xuICAgIGNvbnN0IG0gPSBtYXRjaEJsYW1lUmFuZ2UoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQpO1xuICAgIGlmIChtID09PSBudWxsIHx8IGhhc1NoZWxsRXhwYW5zaW9uKG0uZmlsZUFyZykgfHwgL1sqP10vLnRlc3QobS5maWxlQXJnKSkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBbeyBsaW5lU3RhcnQ6IG0ubGluZVN0YXJ0LCBsaW5lRW5kOiBtLmxpbmVFbmQsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZWZmZWN0aXZlRGlyLCBtLmZpbGVBcmcpIH1dO1xuICB9XG5cbiAgLy8gQU5TSSBlc2NhcGUgYnl0ZXMgcmVqZWN0IHRoZSB3aG9sZSBwYXJzZTogbmVpdGhlciByZy9ncmVwIG5vciBnaXQgZW1pdFxuICAvLyBjb2xvciB3aGVuIHBpcGVkLCBzbyBhbiBFU0MgYnl0ZSBtZWFucyBzb21ldGhpbmcgZGVsaWJlcmF0ZSBpcyBnb2luZyBvbi5cbiAgaWYgKHN0ZG91dC5pbmNsdWRlcygnXFx1MDAxYicpKSByZXR1cm4gW107XG5cbiAgLy8gVGhlIGFkYXB0ZXItc3VwcGxpZWQgdHJ1bmNhdGVkIGZsYWcgKENsYXVkZSByYXdPdXRwdXRQYXRoIHNldCBcdTIxRDIgaW5saW5lXG4gIC8vIHN0ZG91dCBpcyBvbmx5IGEgcHJldmlldykgZGVjbGFyZXMgdGhlIHJlc3BvbnNlLWRlcml2ZWQgZGVjb2RlXG4gIC8vIHVudHJ1c3R3b3J0aHkgXHUyMDE0IGZhaWwgY2xvc2VkLCBwYXJzZSBub3RoaW5nLCBpbnZlbnQgbm8gdG91Y2hlcy5cbiAgLy8gYGludGVycnVwdGVkYCBpcyB0aGUgcGxhbidzIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lOiBmdWxseS10ZXJtaW5hdGVkXG4gIC8vIHJlY29yZHMgcGFyc2UgYW5kIHRoZSBpbmNvbXBsZXRlIHRhaWwgZHJvcHMgdmlhIHRoZSB1bmNvbmRpdGlvbmFsXG4gIC8vIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSwgd2hpY2ggdGhlIGRlZmF1bHQgcGF0aCBhbHJlYWR5IGFwcGxpZXMuXG4gIGlmIChpbnB1dC50cnVuY2F0ZWQpIHJldHVybiBbXTtcblxuICBpZiAoZ2F0ZWQua2luZCA9PT0gJ2RpZmYnKSB7XG4gICAgLy8gVHdvLWFyZyBibG9iLWJsb2IgYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gIGVtaXRzIGEgbm9ybWFsXG4gICAgLy8gdW5pZmllZCBkaWZmIG5hbWluZyB3b3JraW5nLXRyZWUgcGF0aHMgd2hpbGUgZ2l0IHJlYWRzIG9ubHkgaGlzdG9yaWNhbFxuICAgIC8vIGJsb2JzIFx1MjAxNCBkZWNvZGluZyBpdCB3b3VsZCBmYWJyaWNhdGUgdG91Y2hlcyBvbiBmaWxlcyBnaXQgbmV2ZXIgcmVhZCxcbiAgICAvLyBzbyBhIHBvc2l0aW9uYWwgY2FycnlpbmcgYHJldjpwYXRoYCAoYW55IGA6YC1jb250YWluaW5nIHBvc2l0aW9uYWxcbiAgICAvLyB0aGF0IGlzIG5vdCBhbiBleGlzdGluZyBmaWxlKSByZWplY3RzIHRoZSBkZWNvZGUgb3V0cmlnaHQuXG4gICAgaWYgKGhhc0RpZmZSZXZQYXRoQXJnKGdhdGVkLmFyZ3YsIGdhdGVkLnN0YXJ0LCBlZmZlY3RpdmVEaXIpKSByZXR1cm4gW107XG4gICAgLy8gRGlmZi1mb3JtIHBhdGhzIGFyZSByZXBvLXJvb3QtcmVsYXRpdmUgcmVnYXJkbGVzcyBvZiBjd2QsIHNvIHRoZXlcbiAgICAvLyByZXNvbHZlIGFnYWluc3QgdGhlIHdvcmt0cmVlIHJvb3QgZGlzY292ZXJlZCBmcm9tIHRoZSBlZmZlY3RpdmUgZGlyXG4gICAgLy8gKGEgYC5naXRgIGVudHJ5IG1hcmtzIGl0IFx1MjAxNCBubyBzdWJwcm9jZXNzKS4gVGhlIHJlcG8gcm9vdCBpcyBhbHNvIHRoZVxuICAgIC8vIHBlcm1pdHRlZCByb290OiBhIHRyYXZlcnNhbCBwYXRoIG5vcm1hbGl6ZXMgb3V0c2lkZSBpdCBhbmQgaXMgcmVqZWN0ZWRcbiAgICAvLyBieSB0aGUgc2FtZSBjb250YWlubWVudCBjaGVjay4gYC0tcmVsYXRpdmVgIChiYXJlKSByZS1hbmNob3JzIHRvIHRoZVxuICAgIC8vIGN3ZCBhbmQgYC0tcmVsYXRpdmU9PHBhdGg+YCB0byBhIHBhdGggcmVzb2x2ZWQgYWdhaW5zdCB0aGUgd29ya3RyZWVcbiAgICAvLyByb290IFx1MjAxNCBib3RoIGRlY29kZSBhZ2FpbnN0IHRoYXQgYmFzZSBpbnN0ZWFkIChhIHNoZWxsLWV4cGFuZGVkIG9yXG4gICAgLy8gZW1wdHkgdmFsdWUgaXMgdW5yZXNvbHZhYmxlIGFuZCBmYWlscyBjbG9zZWQpLlxuICAgIGNvbnN0IHJlcG9Sb290ID0gZmluZEdpdFJvb3QoZWZmZWN0aXZlRGlyKTtcbiAgICBpZiAocmVwb1Jvb3QgPT09IG51bGwpIHJldHVybiBbXTtcbiAgICBjb25zdCByZWxhdGl2ZSA9IGRpZmZSZWxhdGl2ZUJhc2UoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQsIGVmZmVjdGl2ZURpciwgcmVwb1Jvb3QpO1xuICAgIGlmIChyZWxhdGl2ZSA9PT0gJ3VucmVzb2x2YWJsZScpIHJldHVybiBbXTtcbiAgICBjb25zdCBiYXNlID0gcmVsYXRpdmUgIT09IG51bGwgPyByZWxhdGl2ZS5iYXNlIDogcmVwb1Jvb3Q7XG4gICAgY29uc3Qgcm9vdHMgPSByZWxhdGl2ZSAhPT0gbnVsbCA/IFtyZWxhdGl2ZS5yb290XSA6IFtyZXBvUm9vdF07XG4gICAgcmV0dXJuIGNhcFNwYW5zKHNwYW5zRm9yKGRlY29kZVVuaWZpZWREaWZmKHN0ZG91dCksIGJhc2UsIHJvb3RzKSk7XG4gIH1cblxuICBjb25zdCBpbmZvID0gYW5hbHl6ZVNlYXJjaEFyZ3YoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQpO1xuXG4gIC8vIEEgbm9uLWdpdCBzZWFyY2ggYmluIHdpdGggbm8gcGF0aCBhcmdzIHJlYWRzIGl0cyByZWNvcmRzIGZyb20gd2hhdGV2ZXJcbiAgLy8gc3RkaW4gY2FycmllcyB3aGVuIGl0IGlzIHBpcGVkIG9yIHJlZGlyZWN0ZWQgaW4gKGB8YCwgYDwgZmlsZWAsXG4gIC8vIGA8PDxgLCBgPChcdTIwMjYpYCkgXHUyMDE0IGxpbmUgbnVtYmVycyBhcmUgdGhlbiBzdHJlYW0gcG9zaXRpb25zLCBub3QgZmlsZVxuICAvLyBsaW5lcywgYW5kIGRlY29kaW5nIHRoZW0gZmFicmljYXRlcyB0b3VjaGVzIChhIHN0ZGluIGxpbmUgXCI5XCIgYmVjb21lcyBhXG4gIC8vIHBhdGgsIGFuZCB3aXRoIGEgcmVhbCBmaWxlIG5hbWVkIGA5YCBhdCB0aGUgY3dkIHRoZSBwaGFudG9tIHN1cmZhY2VzKS5cbiAgLy8gZ2F0ZWRSZWRpcmVjdCBleHRlbmRzIHRoZSBydWxlIHRvIGEgcmVkaXJlY3QgR0xVRUQgaW5zaWRlIGEgdG9rZW5cbiAgLy8gKGByZyBuZWVkbGU8Y3JhZnRlZC50eHRgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSk6IGFyZ3Ygc3BsaXR0aW5nXG4gIC8vIG5ldmVyIHN1cmZhY2VzIGEgc3RhbmRhbG9uZSBgPGAgdG9rZW4sIHNvIG9ubHkgdGhlIHF1b3RlLWF3YXJlIHJhdy10ZXh0XG4gIC8vIHNjYW4gc2VlcyBpdC4gRmFpbCBjbG9zZWQ6IG5vIHJlc3BvbnNlLWRlcml2ZWQgc3BhbnMuIEV4cGxpY2l0IHBhdGhcbiAgLy8gYXJncyBzY29wZSB0aGUgc2VhcmNoIHRvIGZpbGVzICh0aGUgcmVkaXJlY3QvcGlwZSBpcyB0aGVuIGlycmVsZXZhbnQpLFxuICAvLyBhbmQgYGdpdCBncmVwYCBuZXZlciByZWFkcyBzdGRpbiBcdTIwMTQgYm90aCBzdGF5IG9wZW4uXG4gIGNvbnN0IHN0ZGluRmVkID1cbiAgICBnYXRlZC5raW5kID09PSAnc2VhcmNoJyAmJlxuICAgIGdhdGVkLmFyZ3ZbMF0gIT09ICdnaXQnICYmXG4gICAgaW5mby5wYXRoQXJncy5sZW5ndGggPT09IDAgJiZcbiAgICAoZ2F0ZWRQcmVjZWRlZEJ5ID09PSAncGlwZScgfHwgaW5mby5zdGRpblJlZGlyZWN0IHx8IGdhdGVkUmVkaXJlY3QpO1xuICBpZiAoc3RkaW5GZWQpIHJldHVybiBbXTtcblxuICAvLyBnaXQgZ3JlcCBzY29waW5nOiBwbGFpbiBpbnZvY2F0aW9uIGZyb20gYSBzdWJkaXIgaXMgc2NvcGVkIHRvIHRoZSBzdWJkaXJcbiAgLy8gYnkgZ2l0IGl0c2VsZiAocmVjb3JkcyBhcmUgY3dkLXJlbGF0aXZlLCByb290IHN0YXlzIHRoZSBlZmZlY3RpdmUgZGlyKTtcbiAgLy8gcGF0aHNwZWMgbWFnaWMgKGA6L2AsIGA6IWAsIGA6XmAsIGA6KC4uLilgKSBzZWFyY2hlcyB0aGUgd2hvbGUgdHJlZSBhbmRcbiAgLy8gZW1pdHMgY3dkLXJlbGF0aXZlIHJlY29yZHMgd2l0aCBgLi4vYCBwcmVmaXhlcywgc28gdGhlIHBlcm1pdHRlZCByb290XG4gIC8vIHdpZGVucyB0byB0aGUgd29ya3RyZWUgcm9vdDsgYC0tZnVsbC1uYW1lYCByZS1hbmNob3JzIHJlY29yZHMgdG9cbiAgLy8gcmVwby1yb290LXJlbGF0aXZlIHBhdGhzLCB3aGljaCByZXNvbHZlcyBhZ2FpbnN0IHRoZSB3b3JrdHJlZSByb290IHRvby5cbiAgY29uc3QgaXNHaXRHcmVwID0gZ2F0ZWQua2luZCA9PT0gJ3NlYXJjaCcgJiYgZ2F0ZWQuYXJndlswXSA9PT0gJ2dpdCc7XG4gIGNvbnN0IGZ1bGxOYW1lID0gaXNHaXRHcmVwICYmIGhhc0ZsYWcoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQsICctLWZ1bGwtbmFtZScpO1xuICBjb25zdCBtYWdpYyA9IGlzR2l0R3JlcCAmJiBpbmZvLnBhdGhzcGVjTWFnaWM7XG4gIGNvbnN0IHdvcmt0cmVlUm9vdCA9IG1hZ2ljIHx8IGZ1bGxOYW1lID8gZmluZEdpdFJvb3QoZWZmZWN0aXZlRGlyKSA6IG51bGw7XG4gIGlmICgobWFnaWMgfHwgZnVsbE5hbWUpICYmIHdvcmt0cmVlUm9vdCA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuXG4gIC8vIFdoZXJlIGRlY29kZWQgcmVjb3JkIHBhdGhzIHJlc29sdmUgZnJvbTogdGhlIGVmZmVjdGl2ZSBjd2QgZm9yIHBsYWluXG4gIC8vIGFuZCBtYWdpYyBnaXQgZ3JlcCAocmVjb3JkcyBhcmUgY3dkLXJlbGF0aXZlKSwgdGhlIHdvcmt0cmVlIHJvb3QgZm9yXG4gIC8vIGAtLWZ1bGwtbmFtZWAgKHJlY29yZHMgYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSkuXG4gIGNvbnN0IGJhc2UgPSBmdWxsTmFtZSAmJiB3b3JrdHJlZVJvb3QgIT09IG51bGwgPyB3b3JrdHJlZVJvb3QgOiBlZmZlY3RpdmVEaXI7XG5cbiAgLy8gUGVybWl0dGVkIHJvb3RzOiB0aGUgY29tbWFuZCdzIGV4cGxpY2l0IHNlYXJjaCByb290cywgb3IgdGhlIGVmZmVjdGl2ZVxuICAvLyBjd2Qgd2hlbiBubyBwYXRoIGFyZ3MgYXJlIGdpdmVuIChyZy9ncmVwIHNlYXJjaCBpdCBieSBkZWZhdWx0KSBcdTIwMTQgZXhjZXB0XG4gIC8vIGdpdCBncmVwIHdpdGggcGF0aHNwZWMgbWFnaWMsIHdoaWNoIHNlYXJjaGVzIHRoZSB3aG9sZSB0cmVlIGFuZCBtdXN0IGJlXG4gIC8vIHBlcm1pdHRlZCBhZ2FpbnN0IHRoZSB3b3JrdHJlZSByb290LlxuICBjb25zdCByb290cyA9XG4gICAgbWFnaWMgJiYgd29ya3RyZWVSb290ICE9PSBudWxsXG4gICAgICA/IFt3b3JrdHJlZVJvb3RdXG4gICAgICA6IGluZm8ucGF0aEFyZ3MubGVuZ3RoID4gMFxuICAgICAgICA/IGluZm8ucGF0aEFyZ3MubWFwKChwKSA9PiByZXNvbHZlUGF0aChlZmZlY3RpdmVEaXIsIHApKVxuICAgICAgICA6IFtlZmZlY3RpdmVEaXJdO1xuXG4gIGNvbnN0IHNpbmdsZUZpbGVBcmcgPSBpbmZvLnBhdGhBcmdzLmxlbmd0aCA9PT0gMSA/IGluZm8ucGF0aEFyZ3NbMF0gOiBudWxsO1xuICAvLyBPbmUtZmlsZSBlbGlnaWJpbGl0eTogbnVtYmVyZWQgZXZpZGVuY2UsIGV4YWN0bHkgb25lIGV4cGxpY2l0IGZpbGVcbiAgLy8gYXJndW1lbnQgdGhhdCBpcyBhIHJlYWwgZmlsZSAoYSBkaXJlY3Rvcnkgb3Igbm8gYXJncyBtZWFucyByZWNvcmRzIGNhcnJ5XG4gIC8vIHBhdGggcHJlZml4ZXMpLCBhbmQgbm8gLUgvLS13aXRoLWZpbGVuYW1lICh3aGljaCBmb3JjZXMgcGF0aCBwcmVmaXhlcykuXG4gIGNvbnN0IG9uZUZpbGVFbGlnaWJsZSA9XG4gICAgaW5mby5udW1iZXJlZCAmJiAhaW5mby53aXRoRmlsZW5hbWUgJiYgc2luZ2xlRmlsZUFyZyAhPT0gbnVsbCAmJiBpc0ZpbGUocmVzb2x2ZVBhdGgoZWZmZWN0aXZlRGlyLCBzaW5nbGVGaWxlQXJnKSk7XG5cbiAgY29uc3QgbGF5b3V0ID0gZGV0ZWN0TGF5b3V0KHN0ZG91dCwgaW5mbywgb25lRmlsZUVsaWdpYmxlKTtcblxuICBjb25zdCBwZXJGaWxlID0gbmV3IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PigpO1xuICBpZiAobGF5b3V0ICE9PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCByZWMgb2YgZGVjb2RlU2VhcmNoTGF5b3V0KGxheW91dCwgc3Rkb3V0LCBzaW5nbGVGaWxlQXJnKSkge1xuICAgICAgLy8gRGVjb2RlZCBwYXRocyBtdXN0IGJlIHJlYWwgZmlsZXM6IGEgcmVjdXJzaXZlLWxheW91dCByZWNvcmQgd2hvc2VcbiAgICAgIC8vIHBhdGggaXMgbm90IGFuIGV4aXN0aW5nIHJlZ3VsYXIgZmlsZSAocmVzb2x2ZWQgYWdhaW5zdCB0aGUgcmVjb3JkXG4gICAgICAvLyBiYXNlIFx1MjAxNCB0aGUgZWZmZWN0aXZlIGN3ZCwgb3IgdGhlIHdvcmt0cmVlIHJvb3QgdW5kZXIgYC0tZnVsbC1uYW1lYClcbiAgICAgIC8vIGRyb3BzIGluc3RlYWQgb2YgZmFicmljYXRpbmcgYSB0b3VjaC5cbiAgICAgIGlmIChsYXlvdXQgPT09ICdyZWN1cnNpdmUnICYmICFpc0ZpbGUocmVzb2x2ZVBhdGgoYmFzZSwgcmVjLnBhdGgpKSkgY29udGludWU7XG4gICAgICBpZiAocmVjLmxpbmUgPT09IG51bGwpIHtcbiAgICAgICAgLy8gV2hvbGUtZmlsZSBudWxsLXNlcGFyYXRlZCByZWNvcmQ6IHRoZSB0ZXh0IGhvbGRzIHRoZSBlbnRpcmUgZmlsZS5cbiAgICAgICAgY29uc3QgdG90YWwgPSBsaW5lQ291bnQocmVjLnRleHQpO1xuICAgICAgICBsZXQgbGluZXMgPSBwZXJGaWxlLmdldChyZWMucGF0aCk7XG4gICAgICAgIGlmIChsaW5lcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbGluZXMgPSBuZXcgU2V0KCk7XG4gICAgICAgICAgcGVyRmlsZS5zZXQocmVjLnBhdGgsIGxpbmVzKTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGxldCBuID0gMTsgbiA8PSB0b3RhbDsgbisrKSBsaW5lcy5hZGQobik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsZXQgbGluZXMgPSBwZXJGaWxlLmdldChyZWMucGF0aCk7XG4gICAgICAgIGlmIChsaW5lcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbGluZXMgPSBuZXcgU2V0KCk7XG4gICAgICAgICAgcGVyRmlsZS5zZXQocmVjLnBhdGgsIGxpbmVzKTtcbiAgICAgICAgfVxuICAgICAgICBsaW5lcy5hZGQocmVjLmxpbmUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHNwYW5zID0gc3BhbnNGb3IocGVyRmlsZSwgYmFzZSwgcm9vdHMpO1xuXG4gIC8vIFdob2xlLWZpbGUgZmFsbGJhY2s6IG5vbi1lbXB0eSwgZnVsbHkgb2JzZXJ2ZWQgb3V0cHV0IChpdHMgdGVybWluYXRpbmdcbiAgLy8gbmV3bGluZSBpcyBwcmVzZW50KSB3aXRoIG5vIHBhcnNlYWJsZSBudW1iZXJlZCByZWNvcmQsIGFuIHVubnVtYmVyZWRcbiAgLy8gY29tbWFuZCAoYSBudW1iZXJlZCBjb21tYW5kIFx1MjAxNCBncmVwIC1uLCBubCwgY2F0IC1uIFx1MjAxNCB3aG9zZSBvdXRwdXRcbiAgLy8gY2FycmllcyBubyBwYXJzZWFibGUgcmVjb3JkIG11c3Qgbm90IGZhbGwgYmFjayBlaXRoZXI6IGl0cyByZWNvcmRzIGFyZVxuICAvLyBzdHJlYW0gcG9zaXRpb25zIG9yIGdhcmJhZ2UsIGFuZCB0aGUgd2hvbGUtZmlsZSBzcGFuIHdvdWxkIGZhYnJpY2F0ZSBhXG4gIC8vIHJlYWQgdGhlIHJlc3BvbnNlIG5ldmVyIGV2aWRlbmNlZCksIGFuZCBleGFjdGx5IG9uZSBleHBsaWNpdCBmaWxlXG4gIC8vIHJlc29sdmVzIHRvIGEgd2hvbGUtZmlsZSByZWFkIG9mIGl0LiBUaGUgdW5pdmVyc2FsIHRlcm1pbmF0aW5nLW5ld2xpbmVcbiAgLy8gcnVsZSBhcHBsaWVzIGhlcmUgdG9vOiBhIHN0cmVhbSBjdXQgYmVmb3JlIGFueSBjb21wbGV0ZSByZWNvcmQgaXMgbm90XG4gIC8vIGZ1bGx5IG9ic2VydmVkLCBzbyBhIHByZXZpZXcgb2YgYSBudW1iZXJlZCBvdXRwdXQgbXVzdCBub3QgYmUgbWlzdGFrZW5cbiAgLy8gZm9yIHVubnVtYmVyZWQgb3V0cHV0IGFuZCBtdXN0IG5vdCBpbnZlbnQgYSB3aG9sZS1maWxlIHRvdWNoLiBUaGUgZmlsZVxuICAvLyBtdXN0IGJlIGEgcmVhZGFibGUgZmlsZSAoYSBkaXJlY3RvcnkgYXJnIGxlYXZlcyB0aGUgZmFsbGJhY2tcbiAgLy8gdW5yZXNvbHZlZCksIGFuZCBpdCBtdXN0IHNpdCBpbnNpZGUgdGhlIGRlY2xhcmVkIHJvb3RzIFx1MjAxNCBpdCBpcyBvbmUgb2ZcbiAgLy8gdGhlbSBieSBjb25zdHJ1Y3Rpb24uXG4gIGlmIChwZXJGaWxlLnNpemUgPT09IDAgJiYgIWluZm8ubnVtYmVyZWQgJiYgc3Rkb3V0ICE9PSAnJyAmJiBzdGRvdXQuZW5kc1dpdGgoJ1xcbicpICYmIHNpbmdsZUZpbGVBcmcgIT09IG51bGwpIHtcbiAgICBjb25zdCBhYnMgPSByZXNvbHZlUGF0aChlZmZlY3RpdmVEaXIsIHNpbmdsZUZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsID0gY291bnRGaWxlTGluZXMoYWJzKTtcbiAgICBpZiAodG90YWwgIT09IG51bGwgJiYgdG90YWwgPiAwKSB7XG4gICAgICBzcGFucy5wdXNoKHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiB0b3RhbCwgYWJzb2x1dGVQYXRoOiBhYnMgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNhcFNwYW5zKHNwYW5zKTtcbn1cbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgc3Bhbi1zdXJmYWNpbmcgY29yZS5cbiAqXG4gKiBHaXZlbiBhbiBhbHJlYWR5LXJlc29sdmVkIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgYSBsaW5lIHJhbmdlLCB0aGlzIG1vZHVsZVxuICogcnVucyB0aGUgc2hhcmVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCAvIGAuaG9va2lnbm9yZWAgLyBzZXNzaW9uLW1lbW8gL1xuICogYGdpdCBzcGFuIGRyaWZ0YCBwaXBlbGluZSBhbmQgYXNzZW1ibGVzIHRoZSBodW1hbi1yZWFkYWJsZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YFxuICogYmxvY2sgdGhhdCBib3RoIGFkYXB0ZXJzIHN1cmZhY2UgaW5saW5lIGJlZm9yZSBhbiBlZGl0LiBJdCBpbXBvcnRzIG5vdGhpbmdcbiAqIGZyb20gZWl0aGVyIGhvb2sgU0RLOiB0aGUgQ2xhdWRlIFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCBhIHJhbmdlIGRlcml2ZWQgZnJvbVxuICogYGZpbGVfcGF0aGAvYG9mZnNldGAvYG9sZF9zdHJpbmdgOyB0aGUgQ29kZXggUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IHRoZVxuICogcmFuZ2VzIHJlY292ZXJlZCBmcm9tIGFuIGBhcHBseV9wYXRjaGAgZW52ZWxvcGUuIEVhY2ggYWRhcHRlciB3cmFwcyB0aGVcbiAqIHJldHVybmVkIGJsb2NrIHN0cmluZyBpbiBpdHMgb3duIFNESyBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBUaGUgZXhlY3V0b3IvZHJpZnQvbWVtbyBkZXBlbmRlbmNpZXMgYXJlIGluamVjdGVkIHNvIHRoZSBwaXBlbGluZSBpcyB0ZXN0YWJsZVxuICogd2l0aCBmYWtlcyBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZSBzaGFyZWQga2VybmVsLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBpc0dpdElnbm9yZWQsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgcGFyc2VEcmlmdFBvcmNlbGFpbixcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBydW5lU3RhbGVTZXNzaW9ucyxcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3QsXG4gIHNlc3Npb25EaXIsXG4gIHRvUG9zaXhcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgdHlwZSBIb29rSWdub3JlTG9hZGVyLCBpc1NwYW5TdXBwcmVzc2VkIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbi8qKlxuICogTWluaW1hbCBsb2dnZXIgc3VyZmFjZSB0aGUgYGNvbW1vbi9gIGxheWVyIGxvZ3MgdGhyb3VnaDsgYm90aCBTREsgbG9nZ2Vyc1xuICogc2F0aXNmeSBpdC4gYHdhcm5gIGlzIHJlcXVpcmVkIFx1MjAxNCBldmVyeSBleGlzdGluZyBjYWxsIHNpdGUgcmVwb3J0cyBhIGZhaWx1cmUuXG4gKiBgaW5mb2AgaXMgb3B0aW9uYWwgc28gYSBmYWtlIGNhcnJ5aW5nIG9ubHkgYHdhcm5gIHN0aWxsIHNhdGlzZmllcyB0aGVcbiAqIGludGVyZmFjZTogaXQgZXhpc3RzIGZvciB0aGUgZGlhZ25vc3RpYyBicmVhZGNydW1icyBhICpzdWNjZXNzZnVsKiBydW4gbGVhdmVzXG4gKiBiZWhpbmQgKGFkdmlzb3ItY29yZSdzIGNodXJuLXN1cHByZXNzaW9uIGNvdW50KSwgd2hpY2ggYXJlIG5vdCB3YXJuaW5ncyBhbmRcbiAqIG11c3Qgbm90IHJlYWQgYXMgZmFpbHVyZXMgaW4gdGhlIGhvb2sgbG9nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvcmVMb2dnZXIge1xuICB3YXJuKG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbiAgaW5mbz8obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNwYW4gZXhlY3V0b3IgYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEV4ZWN1dGVzIGBnaXQgc3BhbiBsaXN0YCB3aXRoIGdpdmVuIGFyZ3MgaW4gYSBnaXZlbiBjd2QuXG4gKiBSZXR1cm5zIHN0ZG91dCBzdHJpbmcuIFRocm93cyBvbiBub24temVybyBleGl0LlxuICovXG5leHBvcnQgdHlwZSBTcGFuRXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0U3BhbkV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IFNwYW5FeGVjdXRvciB7XG4gIHJldHVybiAoYXJncywgY3dkKSA9PiB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAuLi5hcmdzXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICB9O1xufVxuXG4vKipcbiAqIFJ1bnMgYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8c2x1Z3M+YCBhbmQgcmV0dXJucyBpdHMgcG9yY2VsYWluIHN0ZG91dCBcdTIwMTRcbiAqIG9uZSByb3cgcGVyICpkcmlmdGVkKiBhbmNob3IgYW1vbmcgdGhlIGdpdmVuIHNwYW5zLCBlbXB0eSB3aGVuIGFsbCBhcmUgY2xlYW4uXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDAgaW4gcG9yY2VsYWluIG1vZGUgd2hldGhlciBvciBub3QgZHJpZnQgZXhpc3RzLCBidXQgd2VcbiAqIHN0aWxsIGNhcHR1cmUgc3Rkb3V0IGZyb20gYSB0aHJvd24gZXJyb3Igc28gYSBkcmlmdCBzaWduYWwgaXMgbmV2ZXIgbG9zdCB0byBhXG4gKiBub24temVybyBleGl0LiBUaHJvd3Mgb25seSB3aGVuIG5vIHN0ZG91dCBpcyBhdmFpbGFibGUgKGdlbnVpbmUgZmFpbHVyZSkuXG4gKi9cbmV4cG9ydCB0eXBlIERyaWZ0RXhlY3V0b3IgPSAoc2x1Z3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdERyaWZ0RXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogRHJpZnRFeGVjdXRvciB7XG4gIHJldHVybiAoc2x1Z3MsIGN3ZCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2x1Z3NdLCB7XG4gICAgICAgIGN3ZCxcbiAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3Qgb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICBpZiAodHlwZW9mIG91dCA9PT0gJ3N0cmluZycpIHJldHVybiBvdXQ7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gbWVtbyBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVtb1N0b3JlIHtcbiAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPjtcbiAgYWRkU3VyZmFjZWQoc2Vzc2lvbklkOiBzdHJpbmcsIG5hbWVzOiBzdHJpbmdbXSk6IHZvaWQ7XG59XG5cbi8vIExpdmVzIHVuZGVyIHRoZSBzaGFyZWQgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IChhZ2VudC1ob29rcy1jb21tb24udHMnc1xuLy8gc2Vzc2lvbkRpcikgXHUyMDE0IHJlbG9jYXRlZCBmcm9tIG9zLnRtcGRpcigpL2FnZW50LWhvb2tzLWdpdC1zcGFuLyBzb1xuLy8gcGVyLXNlc3Npb24gc3RhdGUgaGFzIG9uZSBob21lIGFuZCBpcyBjb3ZlcmVkIGJ5IHBydW5lU3RhbGVTZXNzaW9ucydzXG4vLyBvcHBvcnR1bmlzdGljID4zMC1kYXkgcHJ1bmluZy5cbmZ1bmN0aW9uIG1lbW9GaWxlUGF0aChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHNlc3Npb25EaXIoc2Vzc2lvbklkKSwgJ3RvdWNoLW1lbW8uanNvbicpO1xufVxuXG5leHBvcnQgdHlwZSBNZW1vTG9nZ2VyID0gQ29yZUxvZ2dlcjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXRTdXJmYWNlZChzZXNzaW9uSWQpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmF3ID0gZnMucmVhZEZpbGVTeW5jKG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpLCAndXRmOCcpO1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdykgYXMgeyBzdXJmYWNlZD86IHVua25vd24gfTtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkLnN1cmZhY2VkKSkge1xuICAgICAgICAgIHJldHVybiBuZXcgU2V0KHBhcnNlZC5zdXJmYWNlZCBhcyBzdHJpbmdbXSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyByZWFkIGZhaWxlZCAodHJlYXRpbmcgYXMgZW1wdHkpJywgeyBlcnIgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFNldCgpO1xuICAgIH0sXG4gICAgYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCBuYW1lcykge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgICAgIGZvciAoY29uc3QgbiBvZiBuYW1lcykgZXhpc3RpbmcuYWRkKG4pO1xuICAgICAgY29uc3QgbWVtb0RpciA9IHNlc3Npb25EaXIoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IG1lbW9QYXRoID0gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCB0bXBQYXRoID0gYCR7bWVtb1BhdGh9LnRtcGA7XG4gICAgICB0cnkge1xuICAgICAgICBmcy5ta2RpclN5bmMobWVtb0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmModG1wUGF0aCwgSlNPTi5zdHJpbmdpZnkoeyBzdXJmYWNlZDogWy4uLmV4aXN0aW5nXSB9KSwgJ3V0ZjgnKTtcbiAgICAgICAgZnMucmVuYW1lU3luYyh0bXBQYXRoLCBtZW1vUGF0aCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gd3JpdGUgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG4vKiogRmFjdG9yeSBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgYSBNZW1vU3RvcmUgZ2l2ZW4gYSBsb2dnZXIuICovXG5leHBvcnQgdHlwZSBNZW1vRmFjdG9yeSA9IChsb2dnZXI6IE1lbW9Mb2dnZXIpID0+IE1lbW9TdG9yZTtcblxuLyoqIERlZmF1bHQgZGlzay1iYWNrZWQgbWVtbyBmYWN0b3J5IHVzZWQgaW4gcHJvZHVjdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNrTWVtb0ZhY3RvcnkobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBzY29wZSByZXNvbHV0aW9uIChyZXBvLXNjb3BpbmcgKyBnaXRpZ25vcmUgKyBzcGFuLXJvb3QgZ3VhcmRzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hTY29wZSB7XG4gIHJlcG9Sb290OiBzdHJpbmc7XG4gIHJlcG9SZWxQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQm91bmQgYSB0b3VjaGVkIGZpbGUgdG8gdGhlIENXRCByZXBvLiBSZXNvbHZlIHRoZSByZXBvIHJvb3Qgb2YgdGhlIGN1cnJlbnRcbiAqIHdvcmtpbmcgZGlyZWN0b3J5IGFuZCByZXF1aXJlIHRoZSB0b3VjaGVkIGZpbGUgdG8gcmVzb2x2ZSB0byB0aGUgU0FNRSByZXBvXG4gKiByb290OyBkcm9wIGZpbGVzIGluIGEgZGlmZmVyZW50IHJlcG9zaXRvcnkvd29ya3RyZWUsIGdpdGlnbm9yZWQgZmlsZXMsIGFuZFxuICogZmlsZXMgdW5kZXIgdGhlIHNwYW4gcm9vdC4gUmV0dXJucyB0aGUgcmVzb2x2ZWQgYHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH1gXG4gKiBvciBudWxsIHdoZW4gdGhlIHRvdWNoIGlzIG91dCBvZiBzY29wZS5cbiAqXG4gKiBDb21wYXJpbmcgcmVzb2x2ZWQgYGdpdCAtLXNob3ctdG9wbGV2ZWxgIHRvcGxldmVscyAobm90IHBhdGggcHJlZml4ZXMpXG4gKiBkaXN0aW5ndWlzaGVzIHNlcGFyYXRlIHJlcG9zIGFuZCB3b3JrdHJlZXMgYW5kIGlzIHJvYnVzdCB0byBzeW1saW5rcy4gRmFpbFxuICogY2xvc2VkOiBpZiB0aGUgQ1dEIHJlcG8gY2FuJ3QgYmUgcmVzb2x2ZWQsIHRoZSB0b3VjaCBpcyBkcm9wcGVkIHJhdGhlciB0aGFuXG4gKiBmYWxsaW5nIGJhY2sgdG8gdGhlIGZpbGUncyBvd24gcmVwby5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUb3VjaFNjb3BlKGN3ZDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBUb3VjaFNjb3BlIHwgbnVsbCB7XG4gIGNvbnN0IGN3ZFJlcG9Sb290ID0gY3dkID8gcmVzb2x2ZVJlcG9Sb290KGN3ZCkgOiBudWxsO1xuICBpZiAoIWN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBhYnNEaXIgPSB0b1Bvc2l4KG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpO1xuICBjb25zdCBmaWxlUmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoYWJzRGlyKTtcbiAgaWYgKGZpbGVSZXBvUm9vdCAhPT0gY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHJlcG9Sb290ID0gY3dkUmVwb1Jvb3Q7XG4gIGNvbnN0IHJlcG9SZWxQYXRoID0gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGFic1BhdGgpO1xuXG4gIC8vIFNraXAgZ2l0aWdub3JlZCBmaWxlcyBlbnRpcmVseS4gQnVpbGQgb3V0cHV0LCBjYWNoZXMsIGFuZCBsb2dzIGFyZSBub3RcbiAgLy8gc3Bhbi1yZWxldmFudDogdGhleSBtdXN0IG5ldmVyIHN1cmZhY2Ugc3BhbiBvdmVybGFwcy5cbiAgaWYgKGlzR2l0SWdub3JlZChyZXBvUm9vdCwgcmVwb1JlbFBhdGgpKSByZXR1cm4gbnVsbDtcblxuICAvLyBTa2lwIHNwYW4gZG9jdW1lbnRzIGVudGlyZWx5LiBGaWxlcyB1bmRlciB0aGUgcmVzb2x2ZWQgc3BhbiByb290IGFyZSBtYW5hZ2VkXG4gIC8vIGJ5IGdpdCBzcGFuIGl0c2VsZiBhbmQgYXJlIG5vdCBhcHBsaWNhdGlvbiBzb3VyY2VzIHRoYXQgbmVlZCBzcGFuIGNvdmVyYWdlLlxuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIGlmIChpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoLCBzcGFuUm9vdCkpIHJldHVybiBudWxsO1xuXG4gIHJldHVybiB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFN1cmZhY2Ugcm91dGluZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBJbmplY3RlZCBkZXBlbmRlbmNpZXMgZm9yIHtAbGluayBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFuc30uICovXG5leHBvcnQgaW50ZXJmYWNlIFN1cmZhY2VEZXBzIHtcbiAgZXhlY3V0b3I6IFNwYW5FeGVjdXRvcjtcbiAgZHJpZnRFeGVjdXRvcjogRHJpZnRFeGVjdXRvcjtcbiAgbWVtbzogTWVtb1N0b3JlO1xuICBsb2FkUnVsZXM6IEhvb2tJZ25vcmVMb2FkZXI7XG4gIGxvZ2dlcjogQ29yZUxvZ2dlcjtcbn1cblxuLyoqXG4gKiBHaXZlbiBhIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgdGhlIGxpbmUgcmFuZ2UgYmVpbmcgdG91Y2hlZCB3aXRoaW4gYW5cbiAqIGFscmVhZHktcmVzb2x2ZWQgcmVwbywgcHJvZHVjZSB0aGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZVxuICogc3BhbnMgb3ZlcmxhcHBpbmcgdGhhdCByYW5nZSwgb3IgbnVsbCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgdG8gc3VyZmFjZS5cbiAqXG4gKiBUaGUgcGlwZWxpbmU6IGBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpbmAgXHUyMTkyIGtlZXAgbGluZS1yYW5nZWQgYW5jaG9ycyBvblxuICogdGhlIHNhbWUgZmlsZSB0aGF0IGludGVyc2VjdCB0aGUgcmFuZ2UgYW5kIGFyZSBub3QgYC5ob29raWdub3JlYC1zdXBwcmVzc2VkIFx1MjE5MlxuICogZHJvcCBzbHVncyBhbHJlYWR5IHN1cmZhY2VkIHRoaXMgc2Vzc2lvbiAobWVtbykgXHUyMTkyIHJlbmRlciBgZ2l0IHNwYW4gbGlzdFxuICogPG5hbWVzXHUyMDI2PmAgXHUyMTkyIGFwcGVuZCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlciBmb3IgYW55IGFscmVhZHktZHJpZnRlZFxuICogc3Bhbi4gT24gc3VjY2VzcyB0aGUgc3VyZmFjZWQgbmFtZXMgYXJlIHJlY29yZGVkIGluIHRoZSBtZW1vLiBFeGVjdXRvciBhbmRcbiAqIGRyaWZ0LXByb2JlIGZhaWx1cmVzIGFyZSBsb2dnZWQgYW5kIGRlZ3JhZGUgdG8gbnVsbCAvIHRoZSBwbGFpbiBibG9jazsgdGhleVxuICogbmV2ZXIgdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFucyhcbiAgZGVwczogU3VyZmFjZURlcHMsXG4gIHJlcG9Sb290OiBzdHJpbmcsXG4gIHJlcG9SZWxQYXRoOiBzdHJpbmcsXG4gIHJhbmdlOiBMaW5lUmFuZ2UsXG4gIHNlc3Npb25JZDogc3RyaW5nXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgeyBleGVjdXRvciwgZHJpZnRFeGVjdXRvciwgbWVtbywgbG9hZFJ1bGVzLCBsb2dnZXIgfSA9IGRlcHM7XG5cbiAgLy8gRmlsdGVyIHBhc3M6IGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluXG4gIGxldCBwb3JjZWxhaW5TdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBwb3JjZWxhaW5TdGRvdXQgPSBleGVjdXRvcihbJy0tcG9yY2VsYWluJywgcmVwb1JlbFBhdGhdLCByZXBvUm9vdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gUGF0aC1zY29wZWQgc3VwcHJlc3Npb246IGEgcmVwbydzIC5zcGFuLy5ob29raWdub3JlIGNhbiBob2xkIGJhY2sgc3BhbiBzbHVnXG4gIC8vIHByZWZpeGVzIGZvciBhbmNob3JzIHVuZGVyIGdpdmVuIHBhdGhzLiBBIHN1cHByZXNzZWQgc3BhbiBpcyBuZXZlciBzdXJmYWNlZC5cbiAgY29uc3QgaWdub3JlUnVsZXMgPSBsb2FkUnVsZXMocmVwb1Jvb3QpO1xuXG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gcGFyc2VQb3JjZWxhaW4ocG9yY2VsYWluU3Rkb3V0KTtcbiAgY29uc3QgY2FuZGlkYXRlTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGlmIChyb3cucGF0aCAhPT0gcmVwb1JlbFBhdGgpIGNvbnRpbnVlO1xuICAgIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgY29udGludWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gICAgaWYgKCFyYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pKSBjb250aW51ZTtcbiAgICBpZiAoaXNTcGFuU3VwcHJlc3NlZChpZ25vcmVSdWxlcywgcm93LnBhdGgsIHJvdy5uYW1lKSkgY29udGludWU7XG4gICAgY2FuZGlkYXRlTmFtZXMuYWRkKHJvdy5uYW1lKTtcbiAgfVxuXG4gIGlmIChjYW5kaWRhdGVOYW1lcy5zaXplID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBTdWJ0cmFjdCBhbHJlYWR5LXN1cmZhY2VkIG5hbWVzXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICBjb25zdCB0b1N1cmZhY2UgPSBbLi4uY2FuZGlkYXRlTmFtZXNdLmZpbHRlcigobikgPT4gIXN1cmZhY2VkLmhhcyhuKSkuc29ydCgpO1xuICBpZiAodG9TdXJmYWNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gUmVuZGVyIHBhc3M6IGdpdCBzcGFuIGxpc3QgPG5hbWUxPiA8bmFtZTI+IC4uLlxuICBsZXQgcmVuZGVyU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcmVuZGVyU3Rkb3V0ID0gZXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBsaXN0IChyZW5kZXIpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gT2YgdGhlIHNwYW5zIGJlaW5nIHN1cmZhY2VkLCBmbGFnIGFueSBhbHJlYWR5IGRyaWZ0ZWQgXHUyMDE0IHRoZSB0b3VjaGVkIGxpbmVzIGhhdmVcbiAgLy8gZHJpZnRlZCBmcm9tIHRoZWlyIGFuY2hvcmVkIHN0YXRlIFx1MjAxNCB3aXRoIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyLlxuICAvLyBEZXRlY3Rpb24gaXMgYXMtb2Ytbm93IChzdXJmYWNpbmcgcnVucyBiZWZvcmUgdGhlIGVkaXQgYXBwbGllcyksIHNvIHRoaXNcbiAgLy8gY2F0Y2hlcyBwcmUtZXhpc3RpbmcgZHJpZnQ7IGRyaWZ0IHRoaXMgc2Vzc2lvbiBjYXVzZXMgaXMgdGhlIFN0b3AgaG9vaydzIGpvYi5cbiAgLy8gRmFpbHVyZSB0byBjb21wdXRlIGRyaWZ0IGlzIG5vbi1mYXRhbDogZmFsbCBiYWNrIHRvIHRoZSBwbGFpbiBibG9jay5cbiAgbGV0IGRyaWZ0SGludCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnN0IGRyaWZ0TmFtZXMgPSBuZXcgU2V0KHBhcnNlRHJpZnRQb3JjZWxhaW4oZHJpZnRFeGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KSkubWFwKChyKSA9PiByLm5hbWUpKTtcbiAgICBjb25zdCBkcmlmdFN1cmZhY2VkID0gdG9TdXJmYWNlLmZpbHRlcigobikgPT4gZHJpZnROYW1lcy5oYXMobikpO1xuICAgIGlmIChkcmlmdFN1cmZhY2VkLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxpbmVzID0gZHJpZnRTdXJmYWNlZC5tYXAoKG4pID0+IGAgIGdpdCBzcGFuIGhpc3RvcnkgJHtufWApLmpvaW4oJ1xcbicpO1xuICAgICAgZHJpZnRIaW50ID0gYFxcbkRyaWZ0IFx1MjAxNCB0aGUgbGluZXMgeW91J3JlIHRvdWNoaW5nIGhhdmUgZHJpZnRlZCBmcm9tIHRoZXNlIHNwYW5zJyBhbmNob3JlZCBzdGF0ZS4gUmV2aWV3IGhvdyBlYWNoIHN1YnN5c3RlbSBldm9sdmVkIGJlZm9yZSBjaGFuZ2luZyBpdDpcXG4ke2xpbmVzfWA7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gZHJpZnQgKGhpc3RvcnkgaGludCkgZmFpbGVkJywgeyBlcnIgfSk7XG4gIH1cblxuICBjb25zdCB3cmFwcGVkID0gYFxcbjxnaXQtc3Bhbj5cXG4ke3JlbmRlclN0ZG91dH0ke2RyaWZ0SGludH1cXG48L2dpdC1zcGFuPlxcbmA7XG5cbiAgLy8gVXBkYXRlIG1lbW9cbiAgbWVtby5hZGRTdXJmYWNlZChzZXNzaW9uSWQsIHRvU3VyZmFjZSk7XG5cbiAgcmV0dXJuIHdyYXBwZWQ7XG59XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IGl0IGlzIG5ldmVyIHN1cmZhY2VkIGluIHRoZSBpbmxpbmVcbiAqIGA8Z2l0LXNwYW4+YCBibG9jayB0aGUgYFBvc3RUb29sVXNlYCB0b3VjaCBob29rIGVtaXRzLiBJdCBoYXMgbm8gZWZmZWN0IG9uXG4gKiB0aGUgYFByZVRvb2xVc2VgIGFkdmlzb3IsIHdob3NlIG93biB1bmNvdmVyZWQtd3JpdGVzIHN1cHByZXNzaW9uIGxpdmVzIGluXG4gKiBgLnNwYW4vLmFkdmlzb3JpZ25vcmVgIChzZWUgYGFkdmlzb3ItaWdub3JlLnRzYCkuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiAodGhpcyBtb2R1bGUncyBncmFtbWFyIFx1MjAxNCBzZWUgdGhlXG4gKiBtb2R1bGUgZG9jIGNvbW1lbnQpIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW4gaXRcbiAqIG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICpcbiAqIEV4cG9ydGVkIHNvIG90aGVyIHBhdGgtc2NvcGVkIGlnbm9yZS1maWxlIGNvbnZlbnRpb25zIChlLmcuIGAuYWR2aXNvcmlnbm9yZWBcbiAqIGluIGBhZHZpc29yLWlnbm9yZS50c2ApIGNhbiByZXVzZSB0aGUgZXhhY3QgbWF0Y2hpbmcgc2VtYW50aWNzIHJhdGhlciB0aGFuXG4gKiByZWltcGxlbWVudGluZyB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyB0b3VjaC1ob29rIGNvcmUuXG4gKlxuICogVGhpcyBtb2R1bGUgaW1wbGVtZW50cyB0aGUgUG9zdFRvb2xVc2UgXCJ0b3VjaCBzaWduYWxcIiB0aGF0IGJvdGggdGhlIENsYXVkZVxuICogKGBSZWFkfEVkaXR8V3JpdGVgKSBhbmQgQ29kZXggKGBhcHBseV9wYXRjaGApIGFkYXB0ZXJzIGRyaXZlLiBJdCBpbXBvcnRzXG4gKiBub3RoaW5nIGZyb20gZWl0aGVyIGhvb2sgU0RLIGFuZCBpcyB0eXBlZCBzdHJ1Y3R1cmFsbHksIHBlciB0aGUgYGNvbW1vbi9gXG4gKiBsYXllciBjb252ZW50aW9uOiBhZGFwdGVycyB0cmFuc2xhdGUgdGhlaXIgU0RLLXNwZWNpZmljIGhvb2sgaW5wdXQgaW50byBhXG4gKiB7QGxpbmsgVG91Y2hJbnB1dH0sIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgd3JhcCB0aGUgcmV0dXJuZWRcbiAqIHtAbGluayBUb3VjaE91dHB1dH0gaW4gdGhlaXIgb3duIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCArXG4gKiBgUG9yY2VsYWluU3RhdHVzYC9gRHJpZnRQb3JjZWxhaW5Sb3dgL2BQb3JjZWxhaW5Sb3dgL2BwYXJzZVBvcmNlbGFpbmAvXG4gKiBgcGFyc2VEcmlmdFBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGByYW5nZXNJbnRlcnNlY3RgIGFuZCB0aGVcbiAqIHJlcG8vc3Bhbi1yb290IHBhdGggdXRpbGl0aWVzIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBhbmQgdGhlIGBNZW1vU3RvcmVgXG4gKiBjYWRlbmNlIHN0b3JlIChzcGFuLXN1cmZhY2UudHMpLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGJhc2VuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIHR5cGUgRHJpZnRQb3JjZWxhaW5Sb3csXG4gIGh1bWFuU3RhdHVzTGFiZWwsXG4gIGlzRGVidCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICB0eXBlIFBvcmNlbGFpblN0YXR1cyxcbiAgcGFyc2VEcmlmdFBvcmNlbGFpbixcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGNvbGxhcHNlQnlQYXRoLCB0eXBlIFJhbmdlTGFiZWwsIHJlbmRlckFuY2hvclRyZWUgfSBmcm9tICcuL2FuY2hvci10cmVlLmpzJztcbmltcG9ydCB0eXBlIHsgTWVtb1N0b3JlIH0gZnJvbSAnLi9zcGFuLXN1cmZhY2UuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3QtZWRpdCByYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU3BsaXQgd3JpdHRlbiBjb250ZW50IGludG8gdGhlIGxpbmVzIHRvIGxvY2F0ZSBvbiBkaXNrLiBBIHNpbmdsZSB0cmFpbGluZ1xuICogbmV3bGluZSBpcyBkcm9wcGVkIHNvIGBcImFcXG5iXFxuXCJgIGFuZCBgXCJhXFxuYlwiYCBsb2NhdGUgaWRlbnRpY2FsbHk7IGFuIGVtcHR5XG4gKiAob3IgbmV3bGluZS1vbmx5KSB3cml0ZSBoYXMgbm8gbG9jYXRhYmxlIGJsb2NrLlxuICovXG5mdW5jdGlvbiB0b05lZWRsZUxpbmVzKHdyaXR0ZW46IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IHRyaW1tZWQgPSB3cml0dGVuLmVuZHNXaXRoKCdcXG4nKSA/IHdyaXR0ZW4uc2xpY2UoMCwgLTEpIDogd3JpdHRlbjtcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIHJldHVybiB0cmltbWVkLnNwbGl0KCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSBsaW5lIHJhbmdlIHRoYXQgd3JpdHRlbiBjb250ZW50IG5vdyBvY2N1cGllcyBpbiB0aGUgb24tZGlzayBmaWxlLFxuICogZm9yIGFuY2hvcmluZyB0aGUgdG91Y2hlZCByZWdpb24gYWZ0ZXIgYW4gZWRpdCBoYXMgYWxyZWFkeSBhcHBsaWVkLlxuICpcbiAqIFRoaXMgZ2VuZXJhbGl6ZXMgdGhlIHByZS1lZGl0IGBsb2NhdGVDaHVuaygpYCB0ZWNobmlxdWUgaW5cbiAqIFthcHBseS1wYXRjaC50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY29kZXgvYXBwbHktcGF0Y2gudHMjTDI1My1MMjg2KVxuICogKHByZXZpb3VzbHkgQ29kZXgtb25seSkgaW50byBhIHNoYXJlZCBwb3N0LWVkaXQgcHJpbWl0aXZlIGJvdGggaGFybmVzc2VzIHVzZTpcbiAqIHNwbGl0IGB3cml0dGVuYCBhbmQgYG9uRGlza0NvbnRlbnRgIGludG8gbGluZXMgYW5kIGxvY2F0ZSB0aGUgd3JpdHRlbiBibG9jayBhc1xuICogYSBjb250aWd1b3VzIHJ1biBpbnNpZGUgdGhlIG9uLWRpc2sgbGluZXMuXG4gKlxuICogLSBBIHNpbmdsZSBjb250aWd1b3VzIG1hdGNoIHlpZWxkcyBpdHMgMS1iYXNlZCBpbmNsdXNpdmUge0BsaW5rIExpbmVSYW5nZX0uXG4gKiAtIFdoZW4gdGhlIGJsb2NrIGlzIGFic2VudCwgb3IgYXBwZWFycyBtb3JlIHRoYW4gb25jZSAoY29udGV4dCB0byBkaXNhbWJpZ3VhdGVcbiAqICAgaXMgbm90IGF2YWlsYWJsZSBwb3N0LWVkaXQpLCByZWNvdmVyeSBpcyBhbWJpZ3VvdXMgYW5kIHRoZSByZXN1bHQgZGVncmFkZXNcbiAqICAgdG8gYCd3aG9sZS1maWxlJ2AgKHRoZSBzYW1lIGZhbGxiYWNrIGBsb2NhdGVDaHVuaygpYCBzaWduYWxzIHdpdGggYG51bGxgKS5cbiAqXG4gKiBOZXZlciB0aHJvd3M6IGFuIHVubG9jYXRhYmxlIHdyaXRlIGlzIGEgYCd3aG9sZS1maWxlJ2AgYW5zd2VyLCBub3QgYW4gZXJyb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvdmVyUmFuZ2Uod3JpdHRlbjogc3RyaW5nLCBvbkRpc2tDb250ZW50OiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBjb25zdCBuZWVkbGUgPSB0b05lZWRsZUxpbmVzKHdyaXR0ZW4pO1xuICBpZiAobmVlZGxlLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcblxuICBjb25zdCBoYXlzdGFjayA9IG9uRGlza0NvbnRlbnQuc3BsaXQoJ1xcbicpO1xuICBjb25zdCBsYXN0ID0gaGF5c3RhY2subGVuZ3RoIC0gbmVlZGxlLmxlbmd0aDtcbiAgY29uc3Qgc3RhcnRzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykge1xuICAgICAgc3RhcnRzLnB1c2goaSk7XG4gICAgICBpZiAoc3RhcnRzLmxlbmd0aCA+IDEpIGJyZWFrOyAvLyBkdXBsaWNhdGVkIFx1MjE5MiBhbWJpZ3VvdXMsIHN0b3AgZWFybHlcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiB7IHN0YXJ0OiBzdGFydHNbMF0gKyAxLCBlbmQ6IHN0YXJ0c1swXSArIG5lZWRsZS5sZW5ndGggfTtcbiAgfVxuICByZXR1cm4gJ3dob2xlLWZpbGUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGlucHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBXaGljaCBoYXJuZXNzIGV2ZW50IGZpcmVkLCBhcyB0aGUgdG91Y2ggY29yZSBzZWVzIGl0LiBUaGUgY29yZSBicmFuY2hlcyBvblxuICogdGhpczogYHdyaXRlYCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUgYW5kIG1heSBzdXJmYWNlIGFcbiAqIG1lcmdlZCBibG9jazsgYHJlYWRgIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWUgYW5kIGZpbHRlcnMgcG9zaXRpb25hbCBzdGF0dXNlc1xuICogb3V0IG9mIHdoYXQgaXQgc3VyZmFjZXMuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRXZlbnRLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJztcblxuLyoqIEZpZWxkcyBzaGFyZWQgYnkgZXZlcnkgdG91Y2gsIHJlZ2FyZGxlc3Mgb2Yga2luZC4gKi9cbmludGVyZmFjZSBUb3VjaElucHV0QmFzZSB7XG4gIC8qKiBIYXJuZXNzIHNlc3Npb24gaWQgXHUyMDE0IGtleXMgdGhlIHBlci1zZXNzaW9uIGNhZGVuY2Uge0BsaW5rIE1lbW9TdG9yZX0uICovXG4gIHNlc3Npb25JZDogc3RyaW5nO1xuICAvKipcbiAgICogV29ya2luZyBkaXJlY3RvcnkgdGhlIHRvb2wgcmFuIGluLCB1c2VkIHRvIGJvdW5kIHRoZSB0b3VjaCB0byB0aGUgQ1dEIHJlcG9cbiAgICogdmlhIGByZXNvbHZlVG91Y2hTY29wZSgpYCBiZWZvcmUgYW55IHNwYW4gaW52b2NhdGlvbi5cbiAgICovXG4gIGN3ZDogc3RyaW5nO1xuICAvKiogQWJzb2x1dGUsIGNhbm9uaWNhbGl6ZWQgcGF0aCBvZiB0aGUgdG91Y2hlZCBmaWxlLiAqL1xuICBmaWxlUGF0aDogc3RyaW5nO1xufVxuXG4vKiogQSByZWFkIHRvdWNoIChDbGF1ZGUgYFJlYWRgLCBvciBhIHJlYWQtc2hhcGVkIENvZGV4IGV2ZW50KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hSZWFkSW5wdXQgZXh0ZW5kcyBUb3VjaElucHV0QmFzZSB7XG4gIGtpbmQ6ICdyZWFkJztcbiAgLyoqXG4gICAqIDEtYmFzZWQgc3RhcnRpbmcgbGluZSBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYG9mZnNldGBcbiAgICogaW5wdXQuIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBvZmZzZXRgIChyZWFkcyBmcm9tIGxpbmUgMSkuXG4gICAqL1xuICBvZmZzZXQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBMaW5lIGNvdW50IG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgbGltaXRgIGlucHV0LlxuICAgKiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgbGltaXRgIFx1MjAxNCBzZWUge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH1cbiAgICogZm9yIGhvdyB0aGUgcmFuZ2UgaXMgY29tcHV0ZWQgaW4gdGhhdCBjYXNlLlxuICAgKi9cbiAgbGltaXQ/OiBudW1iZXI7XG59XG5cbi8qKiBBIHdyaXRlIHRvdWNoIChDbGF1ZGUgYEVkaXRgL2BXcml0ZWAsIENvZGV4IGBhcHBseV9wYXRjaGApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFdyaXRlSW5wdXQgZXh0ZW5kcyBUb3VjaElucHV0QmFzZSB7XG4gIGtpbmQ6ICd3cml0ZSc7XG4gIC8qKlxuICAgKiBUaGUgY29udGVudCBqdXN0IHdyaXR0ZW4gdG8gYGZpbGVQYXRoYCwgZmVkIHRvIHtAbGluayByZWNvdmVyUmFuZ2V9IHRvXG4gICAqIHJlLWFuY2hvciB0aGUgdG91Y2hlZCByZWdpb24gYWdhaW5zdCB0aGUgaGVhbGVkIG9uLWRpc2sgZmlsZS4gRm9yIGFcbiAgICogd2hvbGUtZmlsZSBjcmVhdGUgdGhpcyBpcyB0aGUgZW50aXJlIGZpbGUgYm9keTsgYW4gZW1wdHkgc3RyaW5nIG1lYW5zXG4gICAqIFwibm8gbG9jYXRhYmxlIGJsb2NrXCIgYW5kIHRoZSB0b3VjaCBpcyBzY29wZWQgZmlsZS13aWRlLlxuICAgKi9cbiAgd3JpdHRlbjogc3RyaW5nO1xufVxuXG4vKiogVGhlIGhhcm5lc3MtYWdub3N0aWMgdG91Y2ggdGhlIGNvcmUgY29uc3VtZXMuICovXG5leHBvcnQgdHlwZSBUb3VjaElucHV0ID0gVG91Y2hSZWFkSW5wdXQgfCBUb3VjaFdyaXRlSW5wdXQ7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRHJpZnRFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8RHJpZnRQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBkcmlmdDogVG91Y2hEcmlmdEV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgc3dhcCB0aGUgb2xkIGFuY2hvciBmb3IgdGhlIG5ldyBvbmUgd2l0aCBcXGBnaXQgc3BhbiByZXBsYWNlXFxgLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIFxcYGdpdCBzcGFuIGRyaWZ0ICR7bmFtZX1cXGAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy5gO1xuICB9XG4gIHJldHVybiAnRm9yIGVhY2ggb3V0LW9mLWRhdGUgc3BhbjogcmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgc3dhcCB0aGUgb2xkIGFuY2hvciBmb3IgdGhlIG5ldyBvbmUgd2l0aCBgZ2l0IHNwYW4gcmVwbGFjZWAuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgYGdpdCBzcGFuIGRyaWZ0IDxuYW1lPmAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy4nO1xufVxuXG4vKiogVGhlIHtAbGluayBSYW5nZUxhYmVsfSBmb3IgYSBwb3JjZWxhaW4gcm93IFx1MjAxNCBgMC0wYCBpcyB0aGUgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiByYW5nZUxhYmVsKHJvdzogUG9yY2VsYWluUm93KTogUmFuZ2VMYWJlbCB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ3dob2xlLWZpbGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdyYW5nZScsIHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9O1xufVxuXG4vKipcbiAqIEEgc3BhbidzIGZ1bGwgYW5jaG9yIGxpc3QsIHJlbmRlcmVkIGFzIGEgc2hhcmVkLXByZWZpeCB0cmVlIGJ5XG4gKiB7QGxpbmsgcmVuZGVyQW5jaG9yVHJlZX0sIHdpdGggZWFjaCBhbmNob3IgdGhhdCBjYXJyaWVzIGdlbnVpbmUgZHJpZnRcbiAqIHN1ZmZpeGVkIGJ5IGl0cyBsb3dlcmNhc2Ugc3RhdHVzIHRva2VuKHMpIChgIFx1MjAxNCBjaGFuZ2VkYCkuXG4gKlxuICogQSBkcmlmdCByb3cgbWF0Y2hlcyBhbiBhbmNob3IgYnkgZXhhY3QgcGF0aCtyYW5nZSwgb3IgYnkgcGF0aCBhbG9uZSB3aGVuIHRoZVxuICogc3BhbiBoYXMgYSBzaW5nbGUgYW5jaG9yIG9uIHRoYXQgcGF0aCAocmFuZ2VzIGNhbiBkaXNhZ3JlZSBhZnRlciBhIGhlYWwpLlxuICogYHNvbGVPblBhdGhgIGlzIGRlbGliZXJhdGVseSBjb21wdXRlZCBvdmVyIHRoZSAqKmZ1bGwgZmxhdCBhbmNob3IgbGlzdCoqLFxuICogYmVmb3JlIGFueSBncm91cGluZyBcdTIwMTQgdGhlIHRyZWUgbGF5b3V0IG11c3QgbmV2ZXIgYmUgYWJsZSB0byBjaGFuZ2UgKndoaWNoKlxuICogYW5jaG9ycyBnZXQgbGFiZWxlZCwgb25seSB3aGVyZSB0aGV5IHNpdCBvbiB0aGUgcGFnZS5cbiAqL1xuZnVuY3Rpb24gYW5jaG9yQnVsbGV0cyhhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSwgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSBhbmNob3JzLm1hcCgoYW5jaG9yKSA9PiB7XG4gICAgY29uc3Qgc29sZU9uUGF0aCA9IGFuY2hvcnMuZmlsdGVyKChhKSA9PiBhLnBhdGggPT09IGFuY2hvci5wYXRoKS5sZW5ndGggPT09IDE7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgU2V0PFBvcmNlbGFpblN0YXR1cz4oKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBkZWJ0Um93cykge1xuICAgICAgaWYgKHJvdy5wYXRoICE9PSBhbmNob3IucGF0aCkgY29udGludWU7XG4gICAgICBpZiAoc29sZU9uUGF0aCB8fCAocm93LnN0YXJ0ID09PSBhbmNob3Iuc3RhcnQgJiYgcm93LmVuZCA9PT0gYW5jaG9yLmVuZCkpIHtcbiAgICAgICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uc3RhdHVzZXNdLnNvcnQoKTtcbiAgICBjb25zdCBzdWZmaXggPSBzb3J0ZWQubGVuZ3RoID4gMCA/IGAgXHUyMDE0ICR7c29ydGVkLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWAgOiAnJztcbiAgICByZXR1cm4geyBwYXRoOiBhbmNob3IucGF0aCwgcmFuZ2U6IHJhbmdlTGFiZWwoYW5jaG9yKSwgc3VmZml4IH07XG4gIH0pO1xuICB0cnkge1xuICAgIHJldHVybiByZW5kZXJBbmNob3JUcmVlKGNvbGxhcHNlQnlQYXRoKHJvd3MpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgZG8gbm90IHJlbW92ZSBpdFxuICAgIC8vIG9uIHRoZSB0aGVvcnkgdGhhdCBhIGRlZ3JhZGVkIGZhbGxiYWNrIGlzIGl0c2VsZiBmb3JiaWRkZW4uIEFuIHVuY2F1Z2h0XG4gICAgLy8gdGhyb3cgaGVyZSBkb2VzIG5vdCBkZWdyYWRlIHRvIGEgZmxhdCBsaXN0OiBpdCBlc2NhcGVzIHRvXG4gICAgLy8gYHJ1blRvdWNoSG9va2AncyBjYXRjaCwgd2hpY2ggcmVzb2x2ZXMgdGhlIHdob2xlIGhvb2sgdG9cbiAgICAvLyBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgLCBzbyB0aGUgYWdlbnQgaXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgZHJpZnQgYXRcbiAgICAvLyBhbGwuIENhdGNoaW5nIGxvY2FsbHkgbmFycm93cyB3aGF0IGEgcmVuZGVyaW5nIGRlZmVjdCBjYW4gY29zdCBmcm9tIFwidGhlXG4gICAgLy8gcmVtaW5kZXIgZGlzYXBwZWFyc1wiIHRvIFwidGhlIHJlbWluZGVyIGxvb2tzIGxpa2UgaXQgZGlkIGJlZm9yZSB0aGUgdHJlZVwiLlxuICAgIC8vIFdoZXRoZXIgdG8gc3VyZmFjZSBhbmQgd2hhdCBzaGFwZSB0byBzdXJmYWNlIGluIGFyZSBkaWZmZXJlbnQgdGhpbmdzLCBhbmRcbiAgICAvLyB0aGlzIGNhdGNoIG9ubHkgZXZlciB0b3VjaGVzIHRoZSBsYXR0ZXIuXG4gICAgLy8gYHJvd3NgIGlzIGluZGV4LWFsaWduZWQgd2l0aCBgYW5jaG9yc2AsIHNvIHRoaXMgcmVwcm9kdWNlcyB0b2RheSdzIGZsYXRcbiAgICAvLyBidWxsZXQgcnVuIGJ5dGUgZm9yIGJ5dGUsIHN1ZmZpeGVzIGluY2x1ZGVkLlxuICAgIHJldHVybiBhbmNob3JzLm1hcCgoYW5jaG9yLCBpKSA9PiBgLSAke2FuY2hvclRleHQoYW5jaG9yKX0ke3Jvd3NbaV0uc3VmZml4fWApO1xuICB9XG59XG5cbi8qKlxuICogT25lIGh1bWFuLWZvcm1hdCBzcGFuIHNlY3Rpb246IGAjIyA8bmFtZT5gLCB0aGUgZnVsbCBhbmNob3IgbGlzdCAoZHJpZnRlZFxuICogYW5jaG9ycyBzdGF0dXMtc3VmZml4ZWQpLCBhbmQgdGhlIHdoeSBzZW50ZW5jZSB3aGVuIG9uZSBpcyByZWNvcmRlZC5cbiAqXG4gKiBUaGUgbmFtZSBoZWFkZXIgYW5kIHRoZSB3aHkgc2VudGVuY2UgYXJlIHRoZSBzYW1lIHNoYXBlIGBnaXQgc3BhbiBsaXN0YFxuICogcmVuZGVyczsgdGhlIGFuY2hvciBsaXN0IGRlbGliZXJhdGVseSBpcyBub3QgXHUyMDE0IGl0IHJlbmRlcnMgYXMgYSBzaGFyZWQtcHJlZml4XG4gKiB0cmVlICh7QGxpbmsgYW5jaG9yQnVsbGV0c30pIHdoZXJlIHRoZSBDTEkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xyYW5nZWBcbiAqIGJ1bGxldCBydW4uIFRoZSBDTEkncyBvd24gdGV4dCBmb3JtYXQgaXMgdW50b3VjaGVkOyBvbmx5IHRoaXMgaG9vaydzXG4gKiByZS1wcmVzZW50YXRpb24gb2YgaXQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiByZW5kZXJTcGFuU2VjdGlvbihcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSxcbiAgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10sXG4gIHdoeTogc3RyaW5nIHwgbnVsbFxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbYCMjICR7bmFtZX1gLCAuLi5hbmNob3JCdWxsZXRzKGFuY2hvcnMsIGRlYnRSb3dzKV07XG4gIGlmICh3aHkpIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBBc3NlbWJsZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jazogaGVhZGVyLCBvbmUgc2VjdGlvbiBwZXIgc3VyZmFjZWRcbiAqIHNwYW4gKHNlcGFyYXRlZCBieSBgLS0tYCksIGFuZCBhIHNpbmdsZSBmb290ZXIgYWZ0ZXIgYSBmaW5hbCBgLS0tYC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRCbG9jayhzZWN0aW9uczogc3RyaW5nW10sIGhlYWRlcjogc3RyaW5nLCBmb290ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJvZHkgPSBgJHtoZWFkZXJ9XFxuXFxuJHtzZWN0aW9ucy5qb2luKCdcXG5cXG4tLS1cXG5cXG4nKX1cXG5cXG4tLS1cXG5cXG4ke2Zvb3Rlcn1gO1xuICByZXR1cm4gYFxcbjxnaXQtc3Bhbj5cXG4ke2JvZHl9XFxuPC9naXQtc3Bhbj5cXG5gO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGhvb2sgZW50cnkgcG9pbnRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBpbiBzY29wZSBmb3IgdGhlIHJlY292ZXJlZCByYW5nZS4gKi9cbmZ1bmN0aW9uIGludGVyc2VjdHMocm93OiBQb3JjZWxhaW5Sb3csIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlID09PSAnd2hvbGUtZmlsZScpIHJldHVybiB0cnVlO1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB0cnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICByZXR1cm4gcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSB0b3VjaGVkIHJhbmdlIGZyb20gdGhlIG9uLWRpc2sgZmlsZSBmb3IgYSB3cml0ZS4gQW4gZW1wdHkgd3JpdGUgb3JcbiAqIGFuIHVucmVhZGFibGUgZmlsZSAoZS5nLiBhIGRlbGV0ZSwgb3IgdGhlIGZpbGUgd2FzIG5ldmVyIHdyaXR0ZW4pIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCwgc2NvcGluZyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmcgc3BhbiBcdTIwMTQgdGhlIGZhaWwtb3BlblxuICogYmVoYXZpb3IsIG5vdCBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlRnJvbURpc2sod3JpdHRlbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBsZXQgY29udGVudDogc3RyaW5nO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgcmV0dXJuIHJlY292ZXJSYW5nZSh3cml0dGVuLCBjb250ZW50KTtcbn1cblxuLyoqXG4gKiBUaGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgZG9jdW1lbnRlZCBkZWZhdWx0IGxpbmUgY291bnQgd2hlbiBgb2Zmc2V0YCBpc1xuICogZ2l2ZW4gd2l0aG91dCBgbGltaXRgIChcIkJ5IGRlZmF1bHQsIGl0IHJlYWRzIHVwIHRvIDIwMDAgbGluZXNcIikuIE5hbWVkIHNvXG4gKiB0aGUgYXNzdW1wdGlvbiBpcyB2aXNpYmxlIGFuZCBlYXN5IHRvIHVwZGF0ZSBpZiB0aGF0IGRlZmF1bHQgZXZlciBjaGFuZ2VzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUFEX0xJTUlUID0gMjAwMDtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSB0b3VjaGVkIHJhbmdlIGZvciBhIHJlYWQgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3NcbiAqIGBvZmZzZXRgL2BsaW1pdGAgaW5wdXRzLiBOZWl0aGVyIHByZXNlbnQgbWVhbnMgYSBnZW51aW5lIHdob2xlLWZpbGUgcmVhZCBcdTIwMTRcbiAqIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gc3RheXMgaW4gc2NvcGUsIG1hdGNoaW5nIHRvZGF5J3MgYmVoYXZpb3IuIE90aGVyd2lzZVxuICogdGhlIHJhbmdlIHN0YXJ0cyBhdCBgb2Zmc2V0YCAoZGVmYXVsdCBsaW5lIDEpIGFuZCBydW5zIGZvciBgbGltaXRgIGxpbmVzXG4gKiAoZGVmYXVsdCB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfSksIGNsYW1wZWQgdG8gdGhlIGZpbGUncyBhY3R1YWwgbGluZVxuICogY291bnQgc28gYSBzaG9ydCBmaWxlIHdpdGggYSBsYXJnZSBgb2Zmc2V0YC9gbGltaXRgIGRvZXNuJ3Qgb3ZlcnNob290LlxuICogQ2xhbXBpbmcgcmVxdWlyZXMgcmVhZGluZyB0aGUgZmlsZTsgYW4gdW5yZWFkYWJsZSBmaWxlIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCBcdTIwMTQgdGhlIHNhbWUgZmFpbC1vcGVuIGJlaGF2aW9yIHRoZSB3cml0ZSBwYXRoIHVzZXMuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSZWFkUmFuZ2UoXG4gIG9mZnNldDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGltaXQgPT09IHVuZGVmaW5lZCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgY29uc3Qgc3RhcnQgPSBvZmZzZXQgPz8gMTtcbiAgbGV0IGxpbmVDb3VudDogbnVtYmVyO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgbGluZUNvdW50ID0gY29udGVudC5sZW5ndGggPT09IDAgPyAwIDogY29udGVudC5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgKGxpbWl0ID8/IERFRkFVTFRfUkVBRF9MSU1JVCkgLSAxLCBNYXRoLm1heChsaW5lQ291bnQsIHN0YXJ0KSk7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGFuIGFuY2hvciBpbiB0aGUgdG91Y2hlZCBmaWxlIGl0c2VsZi4gYGxpc3RcbiAqIC0tcG9yY2VsYWluIDxmaWxlPmAgcmV0dXJucyBldmVyeSBhbmNob3Igb2YgZWFjaCBtYXRjaGluZyBzcGFuIFx1MjAxNCBjcm9zcy1maWxlXG4gKiBhbmNob3JzIGluY2x1ZGVkIFx1MjAxNCBidXQgb25seSBhbmNob3JzIGluIHRoZSB0b3VjaGVkIGZpbGUgcGFydGljaXBhdGUgaW4gdGhlXG4gKiByYW5nZS1pbnRlcnNlY3Rpb24gc2NvcGUgdGVzdC4gUm93IHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlOyB0aGUgdG91Y2hlZCBwYXRoXG4gKiBpcyBhYnNvbHV0ZSwgc28gbWF0Y2ggb24gYW4gZXhhY3Qgb3IgYC9gLXNlcGFyYXRlZCBzdWZmaXguXG4gKi9cbmZ1bmN0aW9uIG9uVG91Y2hlZEZpbGUocm93OiBQb3JjZWxhaW5Sb3csIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZpbGVQYXRoID09PSByb3cucGF0aCB8fCBmaWxlUGF0aC5lbmRzV2l0aChgLyR7cm93LnBhdGh9YCk7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBmb3IgdGhlIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGVyZSBpc1xuICogbm90aGluZyB3b3J0aCBzdXJmYWNpbmcuIFNoYXJlZCBieSBib3RoIHBhdGhzOyB0aGUgd3JpdGUgcGF0aCBwYXNzZXMgYVxuICogcmVjb3ZlcmVkIHJhbmdlIGZvciBwcmVjaXNpb24sIHRoZSByZWFkIHBhdGggc2NvcGVzIGZpbGUtd2lkZS5cbiAqXG4gKiBBIHNwYW4gcmVuZGVycyBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gKG5hbWUsIGFsbCBhbmNob3JzIHdpdGhcbiAqIGRyaWZ0ZWQgb25lcyBzdGF0dXMtc3VmZml4ZWQsIHdoeSkgd2hlbiBpdHMgbmFtZSBoYXMgbm90IGJlZW4gc3VyZmFjZWQgdGhpc1xuICogc2Vzc2lvbiwgb3Igd2hlbiBpdCBjYXJyaWVzIGEgZHJpZnQgc3RhdHVzIG5vdCB5ZXQgc3VyZmFjZWQgZm9yIGl0IFx1MjAxNCBzbyBhXG4gKiBzcGFuIGZpcnN0IHNlZW4gaGVhbHRoeSByZS1yZW5kZXJzIGluIGZ1bGwgd2hlbiBkcmlmdCBsYXRlciBhcHBlYXJzLiBBIHNwYW5cbiAqIHdob3NlIG9ubHkgZHJpZnQgaXMgcG9zaXRpb25hbCAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIFx1MjAxNCBuZXZlclxuICogYGlzRGVidGApIGlzIGZpbHRlcmVkIG91dCBlbnRpcmVseTogcG9zaXRpb25hbCBkcmlmdCBuZXZlciBzdXJmYWNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVN1cmZhY2UoXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZSdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICBpZiAoY292ZXJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBHcm91cCBldmVyeSBhbmNob3IgYnkgc3BhbjsgYSBzcGFuIGlzIGluIHNjb3BlIHdoZW4gb25lIG9mIGl0cyBhbmNob3JzIG9uXG4gIC8vIHRoZSB0b3VjaGVkIGZpbGUgaW50ZXJzZWN0cyB0aGUgcmVjb3ZlcmVkIHJhbmdlLlxuICBjb25zdCBhbmNob3JzQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IHJvd3MgPSBhbmNob3JzQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgYW5jaG9yc0J5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG4gIGNvbnN0IHRvdWNoZWROYW1lcyA9IFsuLi5hbmNob3JzQnlOYW1lLmtleXMoKV0uZmlsdGVyKChuYW1lKSA9PlxuICAgIChhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSkuc29tZSgocm93KSA9PiBvblRvdWNoZWRGaWxlKHJvdywgaW5wdXQuZmlsZVBhdGgpICYmIGludGVyc2VjdHMocm93LCByYW5nZSkpXG4gICk7XG4gIGlmICh0b3VjaGVkTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBkcmlmdFJvd3MgPSBhd2FpdCBleGVjdXRvcnMuZHJpZnQoW2lucHV0LmZpbGVQYXRoXSwgaW5wdXQuY3dkKTtcbiAgY29uc3QgZHJpZnRCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgRHJpZnRQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgZHJpZnRSb3dzKSB7XG4gICAgY29uc3Qgcm93cyA9IGRyaWZ0QnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgZHJpZnRCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQpO1xuICBjb25zdCB0b1JlY29yZDogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VjdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRyaWZ0ZWROYW1lczogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgdG91Y2hlZE5hbWVzKSB7XG4gICAgY29uc3Qgc3BhbkRyaWZ0ID0gZHJpZnRCeU5hbWUuZ2V0KG5hbWUpID8/IFtdO1xuICAgIGNvbnN0IGRlYnRSb3dzID0gc3BhbkRyaWZ0LmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChzcGFuRHJpZnQubGVuZ3RoID4gMCAmJiBkZWJ0Um93cy5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBwb3NpdGlvbmFsLW9ubHkgZHJpZnQgbmV2ZXIgc3VyZmFjZXNcblxuICAgIGNvbnN0IGRlYnRTdGF0dXNlcyA9IFsuLi5uZXcgU2V0KGRlYnRSb3dzLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICBjb25zdCB1bnN1cmZhY2VkRGVidCA9IGRlYnRTdGF0dXNlcy5maWx0ZXIoKHN0YXR1cykgPT4gIXN1cmZhY2VkLmhhcyhkcmlmdEtleShuYW1lLCBzdGF0dXMpKSk7XG4gICAgY29uc3QgaXNOZXdOYW1lID0gIXN1cmZhY2VkLmhhcyhuYW1lKTtcbiAgICBpZiAoIWlzTmV3TmFtZSAmJiB1bnN1cmZhY2VkRGVidC5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBmdWxseSBzdXJmYWNlZCBhbHJlYWR5XG5cbiAgICBjb25zdCB3aHkgPSBhd2FpdCBleGVjdXRvcnMud2h5KG5hbWUsIGlucHV0LmN3ZCk7XG4gICAgc2VjdGlvbnMucHVzaChyZW5kZXJTcGFuU2VjdGlvbihuYW1lLCBhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSwgZGVidFJvd3MsIHdoeSkpO1xuICAgIGlmIChkZWJ0U3RhdHVzZXMubGVuZ3RoID4gMCkgZHJpZnRlZE5hbWVzLnB1c2gobmFtZSk7XG5cbiAgICBpZiAoaXNOZXdOYW1lKSB0b1JlY29yZC5wdXNoKG5hbWUpO1xuICAgIGZvciAoY29uc3Qgc3RhdHVzIG9mIHVuc3VyZmFjZWREZWJ0KSB0b1JlY29yZC5wdXNoKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpO1xuICB9XG5cbiAgaWYgKHNlY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIG1lbW8uYWRkU3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkLCB0b1JlY29yZCk7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZW5hbWUoaW5wdXQuZmlsZVBhdGgpO1xuICBjb25zdCBoZWFkZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0SGVhZGVyKGRyaWZ0ZWROYW1lcy5sZW5ndGgsIGlucHV0LmtpbmQpIDogY2xlYW5IZWFkZXIoZmlsZU5hbWUpO1xuICBjb25zdCBmb290ZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lcykgOiBjbGVhbkZvb3RlcihmaWxlTmFtZSk7XG4gIHJldHVybiBidWlsZEJsb2NrKHNlY3Rpb25zLCBoZWFkZXIsIGZvb3Rlcik7XG59XG5cbi8qKlxuICogUnVuIHRoZSB0b3VjaCBob29rIGZvciBhIHNpbmdsZSB0b29sIGNhbGwsIGJyYW5jaGluZyBvbiB7QGxpbmsgVG91Y2hJbnB1dC5raW5kfS5cbiAqXG4gKiAtICoqV3JpdGUgcGF0aCoqOiBydW4gYGV4ZWN1dG9ycy5maXhgIChgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCkgc2NvcGVkXG4gKiAgIHRvIHRoZSB0b3VjaGVkIGZpbGUgdG8gaGVhbCBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUsIHRoZW5cbiAqICAgY29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBhZ2FpbnN0IHRoZSBoZWFsZWQgYW5jaG9ycywgcmVuZGVyaW5nXG4gKiAgIGVhY2ggc3VyZmFjZWQgc3BhbiBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gd2l0aCBhbnkgcmVtYWluaW5nXG4gKiAgIHNlbWFudGljIGRyaWZ0IHN0YXR1cy1zdWZmaXhlZCBvbiBpdHMgYW5jaG9ycy4gQ2FkZW5jZSBpcyBkZWR1cGVkIHRocm91Z2hcbiAqICAgYG1lbW9gIHBlciBzcGFuIG5hbWUgYW5kIHBlciAoc3Bhbiwgc3RhdHVzKS5cbiAqIC0gKipSZWFkIHBhdGgqKjogbmV2ZXIgaW52b2tlcyBgZml4YCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZTsgc3VyZmFjZXMgdGhlXG4gKiAgIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHNlZVxuICogICB7QGxpbmsgcmVjb3ZlclJlYWRSYW5nZX07IGEgcmVhZCB3aXRoIG5laXRoZXIgaXMgd2hvbGUtZmlsZSwgbWF0Y2hpbmdcbiAqICAgdG9kYXkncyBiZWhhdmlvcikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCB2aWEgYGlzRGVidCgpYC5cbiAqXG4gKiBGYWlscyBvcGVuOiBhbnkgZXhlY3V0b3IgcmVqZWN0aW9uIG9yIGludGVybmFsIGVycm9yIHlpZWxkc1xuICogYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCAobm8gc2lnbmFsLCBlZGl0aW5nIG5ldmVyIGJsb2NrZWQpIHJhdGhlciB0aGFuXG4gKiB0aHJvd2luZy4gYHRyZWVNb2RpZmllZGAgcmVmbGVjdHMgYSBzdWNjZXNzZnVsIGAtLWZpeGAgZXZlbiB3aGVuIHRoZVxuICogc3Vic2VxdWVudCBzdXJmYWNlIGNvbXB1dGF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVG91Y2hIb29rKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIHdoZW4gYC0tZml4YCBoZWFsZWQgc29tZXRoaW5nLFxuICAgICAgICAvLyBhbmQgbm9uLXplcm8gb24gZ2VudWluZSBmYWlsdXJlOyB0aGUgc25hcHNob3QgZGlmZiBpcyB0aGUgc291cmNlIG9mXG4gICAgICAgIC8vIHRydXRoIGZvciB3aGV0aGVyIHRoZSB0cmVlIGNoYW5nZWQsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgfVxuICAgICAgY29uc3QgYWZ0ZXIgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgcmV0dXJuIHsgbW9kaWZpZWQ6IGJlZm9yZSAhPT0gYWZ0ZXIgfTtcbiAgICB9LFxuXG4gICAgbGlzdDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCByZXNvbHZlZC5yZWxQYXRoXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcGFyc2VQb3JjZWxhaW4ob3V0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgfSxcblxuICAgIGRyaWZ0OiBhc3luYyAoYXJncywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgY29uc3QgcnVuQ3dkID0gcmVwb1Jvb3QgPz8gY3dkO1xuICAgICAgLy8gVGhlIGNvcmUgcGFzc2VzIGFuIGFic29sdXRlIGZpbGUgcGF0aDsgc2NvcGUgYGdpdCBzcGFuIGRyaWZ0YCB0byBpdFxuICAgICAgLy8gcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCBzbyB0aGUgcGF0aCBpbmRleCByZXNvbHZlcyBpdC5cbiAgICAgIGNvbnN0IHNjb3BlZCA9IHJlcG9Sb290ID8gYXJncy5tYXAoKGEpID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhKSkgOiBhcmdzO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2NvcGVkXSwge1xuICAgICAgICAgIGN3ZDogcnVuQ3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBjYXB0dXJlZCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBpZiAodHlwZW9mIGNhcHR1cmVkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIG91dCA9IGNhcHR1cmVkO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlRHJpZnRQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuXG4gICAgd2h5OiBhc3luYyAobmFtZSwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnd2h5JywgbmFtZV0sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290ID8/IGN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRleHQgPSBvdXQudHJpbUVuZCgpO1xuICAgICAgICAvLyBCYXJlIGBnaXQgc3BhbiB3aHlgIHByaW50cyB0aGlzIGV4YWN0IHNlbnRpbmVsIChleGl0IDApIHdoZW4gdGhlXG4gICAgICAgIC8vIHNwYW4gaGFzIG5vIHdoeSByZWNvcmRlZCBcdTIwMTQgdHJlYXQgaXQgYXMgXCJubyB3aHlcIiwgbm90IGFzIGNvbnRlbnQuXG4gICAgICAgIGlmICh0ZXh0Lmxlbmd0aCA9PT0gMCB8fCB0ZXh0ID09PSBgXFxgJHtuYW1lfVxcYCBoYXMgbm8gd2h5IHJlY29yZGVkLmApIHJldHVybiBudWxsO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgYm94LWRyYXdpbmcgdHJlZSByZW5kZXJlciBmb3IgYSBzcGFuJ3MgYW5jaG9yIGxpc3QsIHVzZWQgYnkgZXZlcnlcbiAqIGNhbGwgc2l0ZSB0aGF0IHRvZGF5IHByaW50cyBhIGZsYXQgYC0gcGF0aCNMc3RhcnQtTGVuZGAgYnVsbGV0IHJ1blxuICogKGB0b3VjaC1jb3JlLnRzYCdzIGBhbmNob3JCdWxsZXRzYCwgYW5kIGBhZHZpc29yLWNvcmUudHNgJ3NcbiAqIGBhbm5vdGF0ZUJsb2Nrc2AvYGdyb3VwQ292ZXJpbmdCeU5hbWVgKS4gQW5jaG9ycyB0aGF0IHNoYXJlIGEgZGlyZWN0b3J5XG4gKiBwcmVmaXggY29sbGFwc2UgaW50byBvbmUgdHJlZSBpbnN0ZWFkIG9mIGJlaW5nIHJlY29uc3RydWN0ZWQgYnkgZXllIGZyb20gYVxuICogZmxhdCBsaXN0IFx1MjAxNCB0aGUgbW90aXZhdGluZyBjYXNlIGlzIHBhcml0eSBhbmNob3JzIHVuZGVyIHBhcmFsbGVsXG4gKiBgcHVibGljL2NsYXVkZS8uLi5gL2BwdWJsaWMvY29kZXgvLi4uYCB0cmVlcy5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpcyBhIHB1cmUgcHJlc2VudGF0aW9uIHRyYW5zZm9ybTogaXQgbmV2ZXIgY29tcHV0ZXMgZHJpZnRcbiAqIHN0YXR1cyBvciBkZWNpZGVzIHdoaWNoIGFuY2hvcnMgYXJlIHN1cmZhY2VkLiBDYWxsZXJzIHByZWNvbXB1dGUgZWFjaCByb3cnc1xuICogYHN1ZmZpeGAgKGUuZy4gYCBcdTIwMTQgY2hhbmdlZGApIGV4YWN0bHkgYXMgdGhleSBkbyB0b2RheSwgYW5kIG9ubHkgdGhlICpzaGFwZSpcbiAqIG9mIHRoZSBwcmludGVkIGxpc3QgY2hhbmdlcy5cbiAqL1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyB0eXBlc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSG93IGEgc2luZ2xlIGFuY2hvcidzIGxpbmUgcmFuZ2UgaXMga25vd24uIGByYW5nZWAgYW5kIGB3aG9sZS1maWxlYCBhcmUgdGhlXG4gKiB0d28gc2hhcGVzIGV2ZXJ5IGFuY2hvciB0YWtlcyB0b2RheTsgYHRydW5jYXRlZGAgaXMgYSBkZWZlbnNpdmUgdGhpcmQgc2hhcGVcbiAqIHJlYWNoYWJsZSBvbmx5IGZyb20gcmUtcGFyc2luZyB0aGUgQ0xJJ3MgZmxhdCBodW1hbi1mb3JtYXQgdGV4dCAoYSBgI0xgXG4gKiBmcmFnbWVudCB0aGF0IGRvZXNuJ3QgY2xlYW5seSBtYXRjaCBgI0xzdGFydC1MZW5kYCkuXG4gKlxuICogVmVyaWZpZWQgaW52YXJpYW50OiB0aGUgc3RydWN0dXJlZC1kYXRhIGNhbGwgc2l0ZXMgY2FuIG5ldmVyIHByb2R1Y2VcbiAqIGB0cnVuY2F0ZWRgLiBgcGFyc2VQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpIGBjb250aW51ZWBzIHBhc3QgYW55XG4gKiByb3cgbWlzc2luZyBhIHZhbGlkIHJhbmdlLCBzbyBhbiBpbmNvbXBsZXRlIGBQb3JjZWxhaW5Sb3dgIGNhbiBuZXZlciBiZVxuICogY29uc3RydWN0ZWQ7IHRoZSBSdXN0IENMSSdzIG93biBwb3JjZWxhaW4gd3JpdGVyIGFsd2F5cyBlbWl0cyBhIHJhbmdlXG4gKiBjb2x1bW4gKGAwLTBgIGZvciB3aG9sZS1maWxlKS4gYHRydW5jYXRlZGAgaXMgcmVhY2hhYmxlIG9ubHkgZnJvbVxuICogYGFubm90YXRlQmxvY2tzYCcgZmxhdC10ZXh0IHBhcnNpbmcgb2YgYGJsb2Nrc1RleHRgIGluIGEgbGF0ZXIgcGhhc2UuXG4gKi9cbmV4cG9ydCB0eXBlIFJhbmdlTGFiZWwgPSB7IGtpbmQ6ICdyYW5nZSc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9IHwgeyBraW5kOiAndHJ1bmNhdGVkJyB9O1xuXG4vKiogT25lIHN0YWNrZWQgcmFuZ2UgdW5kZXIgYSBgVHJlZUFuY2hvcmAsIHdpdGggaXRzIHByZWNvbXB1dGVkIGRyaWZ0IHN1ZmZpeC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmFuZ2VFbnRyeSB7XG4gIHJhbmdlOiBSYW5nZUxhYmVsO1xuICAvKiogUHJlY29tcHV0ZWQgYCBcdTIwMTQgY2hhbmdlZGAgKGV0Yy4pLCBvciBgJydgIHdoZW4gdGhlIGFuY2hvciBjYXJyaWVzIG5vIGRyaWZ0LiAqL1xuICBzdWZmaXg6IHN0cmluZztcbn1cblxuLyoqIE9uZSBkaXN0aW5jdCBwYXRoJ3MgY29sbGFwc2VkIGFuY2hvciBlbnRyeSwgcmVhZHkgZm9yIHRyZWUgbGF5b3V0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUcmVlQW5jaG9yIHtcbiAgLyoqIFJlcG8tcmVsYXRpdmUsIHBvc2l4LXNlcGFyYXRlZCBwYXRoLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBTdGFja2VkIHJhbmdlcyBvbiB0aGlzIHBhdGguIEVtcHR5IG1lYW5zIFwicGF0aCBvbmx5LCBubyByYW5nZSBjb2x1bW4gYXRcbiAgICogYWxsXCIgXHUyMDE0IGEgYmFyZS1wYXRoIGxlYWYsIGRpc3RpbmN0IGZyb20gYSBzaW5nbGUgYHdob2xlLWZpbGVgIGVudHJ5ICh3aGljaFxuICAgKiByZW5kZXJzIHRoZSBwYXRoIHRvbywgYnV0IGlzIGFuIGV4cGxpY2l0IHJhbmdlLWtpbmQgY2xhc3NpZmljYXRpb24pLlxuICAgKi9cbiAgcmFuZ2VzOiBSYW5nZUVudHJ5W107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gY29sbGFwc2VCeVBhdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENvbGxhcHNlIHJvd3MgdGhhdCBuYW1lIHRoZSBzYW1lIHBhdGggaW50byBvbmUgYFRyZWVBbmNob3JgIHdpdGggc3RhY2tlZFxuICogcmFuZ2VzLCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzXG4gKiBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyIGRpc3RpbmN0IHBhdGggXHUyMDE0IHRoaXMgaXMgdGhlIG1hbmRhdG9yeVxuICogcHJlLXByb2Nlc3Npbmcgc3RlcCBldmVyeSBjYWxsZXIgcnVucyBmaXJzdCB0byBndWFyYW50ZWUgdGhhdC5cbiAqXG4gKiBNaXJyb3JzIHRoZSBvcmRlci1hcnJheS1wbHVzLU1hcCBpZGlvbSBhbHJlYWR5IHVzZWQgYnlcbiAqIGBkZWR1cGVCeUFuY2hvcigpYCAoYWR2aXNvci1jb3JlLnRzKSBmb3IgdGhlIHNhbWUgcmVhc29uOiB0aGUgQ0xJIGNhbiBlbWl0XG4gKiBtdWx0aXBsZSByb3dzIGZvciBvbmUgbG9naWNhbCBwYXRoLCBhbmQgdGhlICpwb3NpdGlvbiogb2YgYSBsYXRlclxuICogc2FtZS1wYXRoIHJvdyBpcyBzdWJzdW1lZCBpbnRvIHRoYXQgcGF0aCdzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBhcHBlbmRlZFxuICogYXQgaXRzIG93biBsYXRlciBwb3NpdGlvbi4gQ29uY3JldGVseTogYGEudHMjTDEtTDVgLCBgYi50cyNMMS1MNWAsXG4gKiBgYS50cyNMOS1MMTJgIGNvbGxhcHNlcyB0byBgW2EudHMgKHR3byBzdGFja2VkIHJhbmdlcyksIGIudHMgKG9uZSByYW5nZSldYFxuICogXHUyMDE0IGBhLnRzYCBzaXRzIGF0IHBvc2l0aW9uIDAsIGl0cyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgaXRzIGxhc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb2xsYXBzZUJ5UGF0aChyb3dzOiB7IHBhdGg6IHN0cmluZzsgcmFuZ2U6IFJhbmdlTGFiZWw7IHN1ZmZpeDogc3RyaW5nIH1bXSk6IFRyZWVBbmNob3JbXSB7XG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBieVBhdGggPSBuZXcgTWFwPHN0cmluZywgVHJlZUFuY2hvcj4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGxldCBhbmNob3IgPSBieVBhdGguZ2V0KHJvdy5wYXRoKTtcbiAgICBpZiAoIWFuY2hvcikge1xuICAgICAgYW5jaG9yID0geyBwYXRoOiByb3cucGF0aCwgcmFuZ2VzOiBbXSB9O1xuICAgICAgYnlQYXRoLnNldChyb3cucGF0aCwgYW5jaG9yKTtcbiAgICAgIG9yZGVyLnB1c2gocm93LnBhdGgpO1xuICAgIH1cbiAgICBhbmNob3IucmFuZ2VzLnB1c2goeyByYW5nZTogcm93LnJhbmdlLCBzdWZmaXg6IHJvdy5zdWZmaXggfSk7XG4gIH1cbiAgcmV0dXJuIG9yZGVyLm1hcCgocGF0aCkgPT4gYnlQYXRoLmdldChwYXRoKSBhcyBUcmVlQW5jaG9yKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUcmVlIGNvbnN0cnVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBMZWFmTm9kZSB7XG4gIGtpbmQ6ICdsZWFmJztcbiAgbmFtZTogc3RyaW5nO1xuICBhbmNob3I6IFRyZWVBbmNob3I7XG59XG5cbmludGVyZmFjZSBEaXJOb2RlIHtcbiAga2luZDogJ2Rpcic7XG4gIG5hbWU6IHN0cmluZztcbiAgY2hpbGRyZW46IFBhdGhUcmVlTm9kZVtdO1xufVxuXG50eXBlIFBhdGhUcmVlTm9kZSA9IExlYWZOb2RlIHwgRGlyTm9kZTtcblxuLyoqXG4gKiBTcGxpdCBhIHBhdGggaW50byBgL2Atc2VwYXJhdGVkIHNlZ21lbnRzLCBvciBgbnVsbGAgd2hlbiBkb2luZyBzbyB3b3VsZFxuICogZmVlZCBhbiBlbXB0eS1zdHJpbmcgc2VnbWVudCBpbnRvIHRoZSB0cmllIChhIGxlYWRpbmcgYC9gLCBhIHRyYWlsaW5nIGAvYCxcbiAqIGEgZG91YmxlZCBgLy9gLCBvciB0aGUgZW1wdHkgc3RyaW5nKS4gYG51bGxgIHNpZ25hbHMgdGhlIGNhbGxlciB0byByZW5kZXJcbiAqIHRoYXQgYW5jaG9yJ3MgZnVsbCBwYXRoIHN0cmluZyBhcyBhIHNpbmdsZSwgdW5zcGxpdCwgYXRvbWljIHRvcC1sZXZlbCBsZWFmXG4gKiBpbnN0ZWFkIG9mIGF0dGVtcHRpbmcgdG8gbmVzdCBpdCBcdTIwMTQgYSBrbm93bi1lbnVtZXJhYmxlIGNsYXNzIG9mIG1hbGZvcm1lZFxuICogcGF0aHMgZ2V0cyBhIHJlYWwgcnVsZSBoZXJlIHJhdGhlciB0aGFuIHRoZSBzcGxpdCBydW5uaW5nIGFueXdheSBhbmRcbiAqIGZhYnJpY2F0aW5nIGFuIGVtcHR5LW5hbWVkIGRpcmVjdG9yeSBub2RlLiBBIGJhcmUgZmlsZW5hbWUgd2l0aCBubyBgL2AgYXRcbiAqIGFsbCBwcm9kdWNlcyBleGFjdGx5IG9uZSBub24tZW1wdHkgc2VnbWVudCBhbmQgaXMgaGFuZGxlZCBieSB0aGUgb3JkaW5hcnlcbiAqIHBhdGggYmVsb3cgKGl0IGJlY29tZXMgYSB0b3AtbGV2ZWwgbGVhZiB3aXRoIG5vIGRpcmVjdG9yeSB0byBuZXN0IHVuZGVyIFx1MjAxNFxuICogYWxyZWFkeSBhdG9taWMsIG5vIHNwZWNpYWwgY2FzZSBuZWVkZWQpLlxuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBpZiAoc2VnbWVudHMuc29tZSgoc2VnbWVudCkgPT4gc2VnbWVudC5sZW5ndGggPT09IDApKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG5mdW5jdGlvbiBmaW5kT3JDcmVhdGVEaXIocGFyZW50OiBEaXJOb2RlLCBuYW1lOiBzdHJpbmcpOiBEaXJOb2RlIHtcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBwYXJlbnQuY2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQua2luZCA9PT0gJ2RpcicgJiYgY2hpbGQubmFtZSA9PT0gbmFtZSkgcmV0dXJuIGNoaWxkO1xuICB9XG4gIGNvbnN0IG5vZGU6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lLCBjaGlsZHJlbjogW10gfTtcbiAgcGFyZW50LmNoaWxkcmVuLnB1c2gobm9kZSk7XG4gIHJldHVybiBub2RlO1xufVxuXG4vKiogSW5zZXJ0IG9uZSBhbmNob3IgaW50byB0aGUgdHJpZSwgY3JlYXRpbmcvcmV1c2luZyBkaXJlY3Rvcnkgbm9kZXMgaW4gYXJyaXZhbCBvcmRlci4gKi9cbmZ1bmN0aW9uIGluc2VydEFuY2hvcihyb290OiBEaXJOb2RlLCBzZWdtZW50czogc3RyaW5nW10sIGFuY2hvcjogVHJlZUFuY2hvcik6IHZvaWQge1xuICBsZXQgY3VyID0gcm9vdDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjdXIgPSBmaW5kT3JDcmVhdGVEaXIoY3VyLCBzZWdtZW50c1tpXSk7XG4gIH1cbiAgY3VyLmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IHNlZ21lbnRzW3NlZ21lbnRzLmxlbmd0aCAtIDFdLCBhbmNob3IgfSk7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIHRvcC1sZXZlbCBmb3Jlc3QgZnJvbSBhIGBUcmVlQW5jaG9yW11gIGFscmVhZHkgY29sbGFwc2VkIGJ5XG4gKiBgY29sbGFwc2VCeVBhdGhgLiBTaWJsaW5nIG9yZGVyIGlzIG5ldmVyIHJlLXNvcnRlZCBcdTIwMTQgYSBwYXRoIGVpdGhlciBvcGVucyBhXG4gKiBuZXcgbm9kZSBhdCBpdHMgYXJyaXZhbCBwb3NpdGlvbiBvciBpcyBuZXN0ZWQgdW5kZXIgYSBkaXJlY3Rvcnkgbm9kZVxuICogY3JlYXRlZC9yZXVzZWQgYXQgdGhhdCBkaXJlY3RvcnkncyBvd24gZmlyc3Qtb2NjdXJyZW5jZSBwb3NpdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGb3Jlc3QoYW5jaG9yczogVHJlZUFuY2hvcltdKTogUGF0aFRyZWVOb2RlW10ge1xuICBjb25zdCByb290OiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZTogJycsIGNoaWxkcmVuOiBbXSB9O1xuICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgY29uc3Qgc2VnbWVudHMgPSBzcGxpdFNlZ21lbnRzKGFuY2hvci5wYXRoKTtcbiAgICBpZiAoc2VnbWVudHMgPT09IG51bGwpIHtcbiAgICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogYW5jaG9yLnBhdGgsIGFuY2hvciB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpbnNlcnRBbmNob3Iocm9vdCwgc2VnbWVudHMsIGFuY2hvcik7XG4gIH1cbiAgcmV0dXJuIHJvb3QuY2hpbGRyZW47XG59XG5cbi8qKiBBIG5vZGUgcGFpcmVkIHdpdGggdGhlIChwb3NzaWJseSBmb2xkZWQpIG5hbWUgaXQgZGlzcGxheXMgb24gaXRzIG93biBsaW5lLiAqL1xuaW50ZXJmYWNlIERpc3BsYXlJdGVtIHtcbiAgbmFtZTogc3RyaW5nO1xuICBub2RlOiBQYXRoVHJlZU5vZGU7XG59XG5cbi8qKlxuICogRm9sZCBhIGNoYWluIG9mIHNpbmdsZS1jaGlsZCBub2RlcyBpbnRvIG9uZSBjb21iaW5lZCBuYW1lXG4gKiAoYHB1YmxpYy9jbGF1ZGUvcnVudGltZS9za2lsbHMvY2FyZGAsIGBkaXJ0eS9tb2QucnNgLFxuICogYC5kZXZjb250YWluZXIvRG9ja2VyZmlsZWApLiBGb2xkaW5nIGNvbnRpbnVlcyB3aGlsZSB0aGUgY3VycmVudCBub2RlIGlzIGFcbiAqIGRpcmVjdG9yeSB3aXRoICoqZXhhY3RseSBvbmUgY2hpbGQqKiwgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoYXQgY2hpbGQgaXMgYVxuICogZGlyZWN0b3J5IG9yIGEgbGVhZjogYSBub2RlIHdpdGggb25lIGNoaWxkIGNvbnZleXMgbm8gZ3JvdXBpbmcgYnlcbiAqIGRlZmluaXRpb24sIHNvIGZvbGRpbmcgaXQgbG9zZXMgbm8gc3RydWN0dXJlIHdoaWxlIHJlbW92aW5nIGEgbGluZSB3aG9zZVxuICogb25seSBjb250ZW50IGlzIGEgY29ubmVjdG9yLiBTdG9wcyBhdCB0aGUgZmlyc3QgZGlyZWN0b3J5IHdpdGggMisgY2hpbGRyZW5cbiAqIChleHBhbmQgZnJvbSB0aGVyZSkgb3IgYXQgYSBsZWFmICh3aGljaCB0aGVuIHJlbmRlcnMgd2l0aCB0aGUgZm9sZGVkIG5hbWUpLlxuICpcbiAqIEZvbGRpbmcgbG9uZSAqbGVhdmVzKiBcdTIwMTQgbm90IGp1c3QgbG9uZSBkaXJlY3RvcmllcyBcdTIwMTQgaXMgd2hhdCBrZWVwcyB0aGUgdHJlZVxuICogbm8gdGFsbGVyIHRoYW4gdGhlIGZsYXQgYnVsbGV0IGxpc3QgaXQgcmVwbGFjZXMsIGFuZCB3aGF0IG1ha2VzIGEgc2luZ2xlXG4gKiBhbmNob3IgcmVuZGVyIGFzIHRoZSBvbmUtbGluZSB0cmVlIHRoZSBwbGFuIHByb21pc2VzIGV2ZW4gd2hlbiBpdHMgcGF0aCBoYXNcbiAqIGRpcmVjdG9yaWVzIGluIGl0LiBJdCBhbHNvIGtlZXBzIHRoZSBkaXNjcmltaW5hdGluZyBzZWdtZW50IG9uIHRoZSBzYW1lXG4gKiBsaW5lIGFzIGl0cyByYW5nZSAoYGRpcnR5L21vZC5ycyAjTDM5Mi1MMzk5YCkgZm9yIGBtb2QucnNgL2BpbmRleC50c2BcbiAqIGxheW91dHMsIHdoZXJlIHRoZSBmaWxlbmFtZSBhbG9uZSBpZGVudGlmaWVzIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIGZvbGRDaGFpbihub2RlOiBQYXRoVHJlZU5vZGUpOiBEaXNwbGF5SXRlbSB7XG4gIGxldCBuYW1lID0gbm9kZS5uYW1lO1xuICBsZXQgY3VyID0gbm9kZTtcbiAgd2hpbGUgKGN1ci5raW5kID09PSAnZGlyJyAmJiBjdXIuY2hpbGRyZW4ubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgY2hpbGQgPSBjdXIuY2hpbGRyZW5bMF07XG4gICAgbmFtZSA9IGAke25hbWV9LyR7Y2hpbGQubmFtZX1gO1xuICAgIGN1ciA9IGNoaWxkO1xuICB9XG4gIHJldHVybiB7IG5hbWUsIG5vZGU6IGN1ciB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlcmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFuayBvZiBhIHN0YWNrZWQgZW50cnkncyByYW5nZSBraW5kOiBgd2hvbGUtZmlsZWAgZmlyc3QsIHRoZW4gbnVtZXJpY1xuICogYHJhbmdlYHMsIHRoZW4gYHRydW5jYXRlZGAuIEEgd2hvbGUtZmlsZSBhbmNob3IgaXMgdGhlIENMSSdzIGAwLTBgIHJvdyBcdTIwMTQgaXRcbiAqIGNvdmVycyB0aGUgZW50aXJlIGZpbGUsIHNvIGl0IHNvcnRzIGFoZWFkIG9mIGV2ZXJ5IGxpbmUgcmFuZ2Ugb24gdGhhdCBmaWxlXG4gKiB0aGUgc2FtZSB3YXkgbGluZSAwIHdvdWxkLiBgdHJ1bmNhdGVkYCBjYXJyaWVzIG5vIHBvc2l0aW9uIGF0IGFsbCBhbmQgc29ydHNcbiAqIGxhc3QuXG4gKi9cbmZ1bmN0aW9uIHJhbmdlUmFuayhyYW5nZTogUmFuZ2VMYWJlbCk6IG51bWJlciB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIDA7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIDE7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAyO1xuICB9XG59XG5cbi8qKlxuICogU3RhY2tlZC1yYW5nZSBvcmRlciBpcyBieSBraW5kIHJhbmsgdGhlbiBudW1lcmljIChgc3RhcnRgIHRoZW4gYGVuZGApLFxuICogb3ZlcnJpZGluZyBhcnJpdmFsIG9yIGNvZGVwb2ludCBvcmRlciBcdTIwMTQgdGhlIG9ubHkgc29ydGluZyB0aGlzIG1vZHVsZSBkb2VzLFxuICogYW5kIHNjb3BlZCBzdHJpY3RseSB0byByYW5nZXMgc3RhY2tlZCBvbiBvbmUgcGF0aCAobmV2ZXIgdG8gc2libGluZyBwYXRoc1xuICogb3IgZGlyZWN0b3J5IG9yZGVyKS4gRXF1YWwtcmFua2VkIGVudHJpZXMgKHR3byBgdHJ1bmNhdGVkYHMsIG9yIHR3b1xuICogaWRlbnRpY2FsIHJhbmdlcykga2VlcCB0aGVpciBvd24gcmVsYXRpdmUgYXJyaXZhbCBvcmRlciwgc2luY2UgdGhlIHNvcnQgaXNcbiAqIHN0YWJsZS5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVJhbmdlRW50cmllcyhhOiBSYW5nZUVudHJ5LCBiOiBSYW5nZUVudHJ5KTogbnVtYmVyIHtcbiAgY29uc3QgcmFuayA9IHJhbmdlUmFuayhhLnJhbmdlKSAtIHJhbmdlUmFuayhiLnJhbmdlKTtcbiAgaWYgKHJhbmsgIT09IDApIHJldHVybiByYW5rO1xuICBpZiAoYS5yYW5nZS5raW5kID09PSAncmFuZ2UnICYmIGIucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJykge1xuICAgIHJldHVybiBhLnJhbmdlLnN0YXJ0IC0gYi5yYW5nZS5zdGFydCB8fCBhLnJhbmdlLmVuZCAtIGIucmFuZ2UuZW5kO1xuICB9XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSByYW5nZSBjb2x1bW4ncyB0ZXh0LCBvciBgbnVsbGAgd2hlbiB0aGUgZW50cnkgcHJpbnRzIGFzIGEgYmFyZSBwYXRoXG4gKiB3aXRoIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwuXG4gKlxuICogQSBgd2hvbGUtZmlsZWAgZW50cnkgaXMgdGhlIG9uZSBraW5kIHdob3NlIHJlbmRlcmluZyBkZXBlbmRzIG9uIGNvbnRleHQuXG4gKiBBbG9uZSBvbiBpdHMgcGF0aCBpdCBzdGF5cyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyIFx1MjAxNCB0aGF0IGlzIHdoYXQgdGhlXG4gKiBDTEkncyBvd24gZmxhdCBsaXN0IHByaW50cyBmb3IgYSB3aG9sZS1maWxlIGFuY2hvciwgYW5kIGFkZGluZyBhIG1hcmtlclxuICogdGhlcmUgd291bGQgYW5ub3RhdGUgdGhlIG92ZXJ3aGVsbWluZ2x5IGNvbW1vbiBjYXNlIGZvciB0aGUgYmVuZWZpdCBvZiB0aGVcbiAqIHJhcmUgb25lLiAqU3RhY2tlZCogYmVoaW5kIG90aGVyIHJhbmdlcyBvbiB0aGUgc2FtZSBwYXRoIGl0IG11c3QgY2FycnkgYW5cbiAqIGV4cGxpY2l0IG1hcmtlcjogd2l0aG91dCBvbmUgaXQgcmVuZGVycyBhcyBhIGNvbnRpbnVhdGlvbiBsaW5lIGhvbGRpbmdcbiAqIG5vdGhpbmcgYnV0IGluZGVudGF0aW9uIGFuZCBpdHMgZHJpZnQgc3VmZml4LCB3aGljaCBlcmFzZXMgdGhlIGFuY2hvclxuICogb3V0cmlnaHQgd2hlbiB0aGUgc3VmZml4IGlzIGVtcHR5IGFuZCBcdTIwMTQgd29yc2UgXHUyMDE0IGhhbmdzIGl0cyBgIFx1MjAxNCBjaGFuZ2VkYFxuICogdW5kZXIgYSBuZWlnaGJvdXJpbmcgcmFuZ2UsIGV4YWN0bHkgdGhlIHZpc3VhbCBncmFtbWFyIHRoYXQgbWVhbnMgXCJhbm90aGVyXG4gKiByYW5nZSBvbiB0aGlzIHNhbWUgZmlsZVwiLiBUaGUgcmVhZGVyIHdvdWxkIHRoZW4gcmVjb25jaWxlIHRoZSByYW5nZSB0aGF0XG4gKiBkaWQgbm90IGRyaWZ0LiBPZiB0aGUgdGhyZWUgZml4ZXMgYXZhaWxhYmxlIChwcmludCB0aGUgcGF0aCBvblxuICogY29udGludWF0aW9uIGxpbmVzLCBzb3J0IHdob2xlLWZpbGUgdG8gcG9zaXRpb24gMCwgb3Igc3BsaXQgaXQgaW50byBpdHMgb3duXG4gKiBsZWFmKSwgYW4gZXhwbGljaXQgbWFya2VyIGlzIHRoZSBvbmx5IG9uZSB0aGF0IG1ha2VzIHRoZSBlbnRyeSBpZGVudGlmaWFibGVcbiAqIGluICpldmVyeSogcG9zaXRpb24gcmF0aGVyIHRoYW4gb25seSBpbiB0aGUgcG9zaXRpb24gdGhlIHNvcnQgaGFwcGVucyB0b1xuICogcHV0IGl0IGluOyBzb3J0aW5nIGl0IGZpcnN0IChzZWUge0BsaW5rIHJhbmdlUmFua30pIGlzIGtlcHQgYXMgd2VsbCBiZWNhdXNlXG4gKiBcIndob2xlIGZpbGUsIHRoZW4gaXRzIHJhbmdlcyBpbiBsaW5lIG9yZGVyXCIgaXMgdGhlIG9yZGVyIGEgcmVhZGVyIGV4cGVjdHMsXG4gKiBub3QgYmVjYXVzZSBpZGVudGlmaWFiaWxpdHkgZGVwZW5kcyBvbiBpdC5cbiAqL1xuZnVuY3Rpb24gbGFiZWxGb3IocmFuZ2U6IFJhbmdlTGFiZWwsIHNvbGU6IGJvb2xlYW4pOiBzdHJpbmcgfCBudWxsIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIGAjTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIHNvbGUgPyBudWxsIDogJyh3aG9sZSBmaWxlKSc7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAnKHRydW5jYXRlZCBpbiBzb3VyY2UgXHUyMDE0IGFuY2hvciBpbmNvbXBsZXRlKSc7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb2x1bW4gbWF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGdyYXBoZW1lIHNlZ21lbnRlciwgY29uc3RydWN0ZWQgb24gZmlyc3QgdXNlIGFuZCB0aGVuIGNhY2hlZCBcdTIwMTQgaW5jbHVkaW5nXG4gKiBhIGNhY2hlZCBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgY29uc3RydWN0ZWQgYXQgYWxsLlxuICpcbiAqIExhenkgb24gcHVycG9zZS4gYEludGxgIGlzIG5vdCBwYXJ0IG9mIHRoZSBKYXZhU2NyaXB0IGxhbmd1YWdlIGNvcmU6IGEgTm9kZVxuICogYnVpbHQgYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIHdoYXRzb2V2ZXIsIGFuZCBgaG9va3MuanNvbmBcbiAqIGludm9rZXMgYSBiYXJlIGBub2RlYCBvZmYgdGhlIHVzZXIncyBgUEFUSGAsIHNvIGBlbmdpbmVzLm5vZGVgIGNvbnN0cmFpbnNcbiAqIG5vdGhpbmcgaGVyZS4gQ29uc3RydWN0aW5nIHRoaXMgYXQgbW9kdWxlIHNjb3BlIHB1dCBhIGBSZWZlcmVuY2VFcnJvcmAgaW5cbiAqIHRoZSBidW5kbGVzJyB0b3AtbGV2ZWwgc3RhdGVtZW50cywgd2hlcmUgaXQgdGhyb3dzIGF0ICppbXBvcnQqIFx1MjAxNCBiZWZvcmUgYW55XG4gKiBvZiB0aGUgZmFpbC1jbG9zZWQgYHRyeS9jYXRjaGAgYmxvY2tzIGluIGByZW5kZXJBbmNob3JSdW5gLCBgcmVuZGVyUGF0aFJ1bmBcbiAqIGFuZCBgYW5jaG9yQnVsbGV0c2AgZXhpc3QgdG8gY2F0Y2ggaXQuIFRoZSBob29rIHByb2Nlc3MgdGhlbiBkaWVkIHdpdGggZXhpdFxuICogMSwgd2hpY2ggQ2xhdWRlIENvZGUgdHJlYXRzIGFzIGEgbm9uLWJsb2NraW5nIGhvb2sgZXJyb3I6IHRoZSBjb21taXQgZ2F0ZVxuICogc2lsZW50bHkgYWxsb3dlZCB0aGUgY29tbWl0IGFuZCB0aGUgZHJpZnQgcmVtaW5kZXIgc2lsZW50bHkgdmFuaXNoZWQuXG4gKiBCdWlsZGluZyBpdCBpbnNpZGUgdGhlIHJlbmRlciBwYXRoIHB1dHMgYW55IGZhaWx1cmUgYmFjayBpbnNpZGUgdGhvc2VcbiAqIGNhdGNoZXMuXG4gKlxuICogRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgdGhlIHNhbWUgY2F0ZWdvcnkgYXNcbiAqIHRoZSBsb2NhbCBgdHJ5L2NhdGNoYCBibG9ja3MgYXQgdGhpcyBtb2R1bGUncyBjYWxsIHNpdGVzLCBhbmQgbG9hZC1iZWFyaW5nXG4gKiBmb3IgdGhlIHNhbWUgcmVhc29uLiBOb3RoaW5nIGluIHRoZSBjb2x1bW4tYWxpZ25tZW50IHBhdGggbWF5IGJlIGFibGUgdG9cbiAqIGNvc3QgdGhlIGNvbW1pdCBnYXRlIG9yIHRoZSBkcmlmdCByZW1pbmRlcjogaWYgZGlzcGxheSB3aWR0aCBjYW5ub3QgYmVcbiAqIG1lYXN1cmVkLCB0aGUgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBnYXRlIHN0aWxsIGhvbGRzOyBvbmx5IGFsaWdubWVudCBpc1xuICogbG9zdC5cbiAqL1xubGV0IGNhY2hlZFNlZ21lbnRlcjogeyB2YWx1ZTogSW50bC5TZWdtZW50ZXIgfCBudWxsIH0gfCB1bmRlZmluZWQ7XG5cbmZ1bmN0aW9uIGdyYXBoZW1lU2VnbWVudGVyKCk6IEludGwuU2VnbWVudGVyIHwgbnVsbCB7XG4gIGlmIChjYWNoZWRTZWdtZW50ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgIHRyeSB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBuZXcgSW50bC5TZWdtZW50ZXIoJ2VuJywgeyBncmFudWxhcml0eTogJ2dyYXBoZW1lJyB9KSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbnVsbCB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FjaGVkU2VnbWVudGVyLnZhbHVlO1xufVxuXG4vKipcbiAqIENvZGUgcG9pbnQgcmFuZ2VzIHJlbmRlcmVkIHR3byBjb2x1bW5zIHdpZGU6IHRoZSBFYXN0IEFzaWFuIFdpZGUgKFcpIGFuZFxuICogRnVsbHdpZHRoIChGKSBibG9ja3Mgb2YgVUFYICMxMSwgcGx1cyB0aGUgZW1vamkgYmxvY2tzIHRoYXQgdGVybWluYWxzIGFuZFxuICogcHJvcG9ydGlvbmFsIGFnZW50LWZhY2luZyByZW5kZXJlcnMgYm90aCBnaXZlIGRvdWJsZSB3aWR0aC4gRXZlcnl0aGluZyBlbHNlXG4gKiBjb3VudHMgYXMgb25lIGNvbHVtbi5cbiAqXG4gKiBTb3J0ZWQgYXNjZW5kaW5nIGFuZCBub24tb3ZlcmxhcHBpbmcgXHUyMDE0IHtAbGluayBpc1dpZGVDb2RlUG9pbnR9IHNob3J0LWNpcmN1aXRzXG4gKiBvbiB0aGUgZmlyc3QgcmFuZ2Ugc3RhcnRpbmcgcGFzdCB0aGUgY29kZSBwb2ludC5cbiAqL1xuY29uc3QgV0lERV9SQU5HRVM6IHJlYWRvbmx5IChyZWFkb25seSBbbnVtYmVyLCBudW1iZXJdKVtdID0gW1xuICBbMHgxMTAwLCAweDExNWZdLFxuICBbMHgyMzI5LCAweDIzMmFdLFxuICBbMHgyNjAwLCAweDI3YmZdLFxuICBbMHgyZTgwLCAweDMwM2VdLFxuICBbMHgzMDQxLCAweDMzZmZdLFxuICBbMHgzNDAwLCAweDRkYmZdLFxuICBbMHg0ZTAwLCAweDlmZmZdLFxuICBbMHhhMDAwLCAweGE0Y2ZdLFxuICBbMHhhOTYwLCAweGE5N2ZdLFxuICBbMHhhYzAwLCAweGQ3YTNdLFxuICBbMHhmOTAwLCAweGZhZmZdLFxuICBbMHhmZTEwLCAweGZlMTldLFxuICBbMHhmZTMwLCAweGZlNmZdLFxuICBbMHhmZjAwLCAweGZmNjBdLFxuICBbMHhmZmUwLCAweGZmZTZdLFxuICBbMHgxNzAwMCwgMHgxOGFmZl0sXG4gIFsweDFmMWU2LCAweDFmMWZmXSxcbiAgWzB4MWYzMDAsIDB4MWY2NGZdLFxuICBbMHgxZjY4MCwgMHgxZjZmZl0sXG4gIFsweDFmOTAwLCAweDFmOWZmXSxcbiAgWzB4MWZhNzAsIDB4MWZhZmZdLFxuICBbMHgyMDAwMCwgMHgyZmZmZF0sXG4gIFsweDMwMDAwLCAweDNmZmZkXVxuXTtcblxuZnVuY3Rpb24gaXNXaWRlQ29kZVBvaW50KGNwOiBudW1iZXIpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBbbG8sIGhpXSBvZiBXSURFX1JBTkdFUykge1xuICAgIGlmIChjcCA8IGxvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGNwIDw9IGhpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogRGlzcGxheSB3aWR0aCBvZiBhIG5hbWUgaW4gdGVybWluYWwgY29sdW1ucyBcdTIwMTQgdGhlIHVuaXQgdGhlIHJhbmdlIGNvbHVtbiBpc1xuICogYWN0dWFsbHkgYWxpZ25lZCBpbi4gTWVhc3VyZWQgb3ZlciBncmFwaGVtZSBjbHVzdGVycyAoc28gYSBkZWNvbXBvc2VkIGBcdTAwRTlgXG4gKiBvciBhIGNvbWJpbmluZy1tYXJrIHNlcXVlbmNlIGNvdW50cyBvbmNlLCBub3Qgb25jZSBwZXIgY29kZSBwb2ludCksIHdpdGhcbiAqIGVhY2ggY2x1c3RlciBjb250cmlidXRpbmcgdHdvIGNvbHVtbnMgd2hlbiBpdHMgYmFzZSBjb2RlIHBvaW50IGlzIEVhc3RcbiAqIEFzaWFuIFdpZGUvRnVsbHdpZHRoIG9yIGVtb2ppIGFuZCBvbmUgb3RoZXJ3aXNlLlxuICpcbiAqIE5laXRoZXIgVVRGLTE2IGAubGVuZ3RoYCBub3IgYEFycmF5LmZyb20obmFtZSkubGVuZ3RoYCBpcyB0aGlzIHVuaXQ6IHRoZVxuICogZmlyc3Qgb3Zlci1jb3VudHMgYSBzdXJyb2dhdGUgcGFpciwgdGhlIHNlY29uZCB1bmRlci1jb3VudHMgYSBDSksgaWRlb2dyYXBoXG4gKiBhbmQgb3Zlci1jb3VudHMgYSBkZWNvbXBvc2VkIGFjY2VudC5cbiAqXG4gKiBXaGVuIHtAbGluayBncmFwaGVtZVNlZ21lbnRlcn0gaXMgdW5hdmFpbGFibGUgKGEgTm9kZSBidWlsdFxuICogYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIGF0IGFsbCksIHRoaXMgZGVncmFkZXMgdG8gdGhlIGNydWRlclxuICogcGVyLWNvZGUtcG9pbnQgbWVhc3VyZSByYXRoZXIgdGhhbiB0aHJvd2luZy4gVGhhdCBtZWFzdXJlIG92ZXItY291bnRzIGFcbiAqIGRlY29tcG9zZWQgYWNjZW50IGFuZCBhIHJlZ2lvbmFsLWluZGljYXRvciBmbGFnIHBhaXIsIHNvIGFsaWdubWVudCBjYW4gYmUgYVxuICogY29sdW1uIG9yIHR3byBvZmYgXHUyMDE0IHdoaWNoIGlzIHRoZSBlbnRpcmUgY29zdCwgYW5kIGlzIHRoZSBjb3JyZWN0IHByaWNlIHRvXG4gKiBwYXk6IHRoZSBhbmNob3IgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBjb21taXQgZ2F0ZSBzdGlsbCBob2xkcy5cbiAqL1xuZnVuY3Rpb24gZGlzcGxheVdpZHRoKG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IHNlZ21lbnRlciA9IGdyYXBoZW1lU2VnbWVudGVyKCk7XG4gIGxldCB3aWR0aCA9IDA7XG4gIGlmIChzZWdtZW50ZXIgPT09IG51bGwpIHtcbiAgICBmb3IgKGNvbnN0IGNvZGVQb2ludCBvZiBuYW1lKSB7XG4gICAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoY29kZVBvaW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gICAgfVxuICAgIHJldHVybiB3aWR0aDtcbiAgfVxuICBmb3IgKGNvbnN0IHsgc2VnbWVudCB9IG9mIHNlZ21lbnRlci5zZWdtZW50KG5hbWUpKSB7XG4gICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KHNlZ21lbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgfVxuICByZXR1cm4gd2lkdGg7XG59XG5cbi8qKlxuICogQWxpZ25tZW50IGNlaWxpbmcuIEEgc2libGluZyBncm91cCB3aG9zZSB3aWRlc3QgcmFuZ2UtYmVhcmluZyBuYW1lIGV4Y2VlZHNcbiAqIHRoaXMgd2lkdGggZG9lcyBub3QgYWxpZ24gYXQgYWxsIFx1MjAxNCBldmVyeSBuYW1lIGluIGl0IHRha2VzIGEgc2luZ2xlIHNwYWNlXG4gKiBiZWZvcmUgaXRzIHJhbmdlLiBUaGUgYWx0ZXJuYXRpdmUgKHBhZCB0aGUgc2hvcnQgbmFtZXMgdG8gdGhlIGNlaWxpbmcgd2hpbGVcbiAqIHRoZSBsb25nIG9uZSBzaXRzIGF0IGl0cyBvd24gbmF0dXJhbCBjb2x1bW4pIHBheXMgbW9zdCBvZiB0aGUgd2lkdGggZm9yXG4gKiBhbGlnbm1lbnQgdGhhdCBhbGlnbnMgd2l0aCBub3RoaW5nLCB3aGljaCBpcyBzdHJpY3RseSB3b3JzZSB0aGFuIG5vdFxuICogYWxpZ25pbmcuIE5hbWVzIHRoZW1zZWx2ZXMgYXJlIG5ldmVyIHRydW5jYXRlZCBvciBlbGlkZWQgYXQgYW55IHdpZHRoLlxuICovXG5jb25zdCBNQVhfQUxJR05fQ09MVU1OID0gNDg7XG5cbi8qKlxuICogVGhlIGNvbHVtbiBldmVyeSByYW5nZS1iZWFyaW5nIG5hbWUgaW4gdGhpcyBzaWJsaW5nIGdyb3VwIHBhZHMgdG8sIG9yIGAwYFxuICogd2hlbiB0aGUgZ3JvdXAgZm9yZ29lcyBhbGlnbm1lbnQgKG5vIHJhbmdlLWJlYXJpbmcgbmFtZXMsIG9yIGEgbmFtZSBwYXN0XG4gKiB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0pLiBBbGlnbm1lbnQgc2NvcGUgaXMgdGhlIGdyb3VwJ3MgZGlyZWN0IGNoaWxkcmVuXG4gKiBvbmx5LCBuZXZlciB0aGUgd2hvbGUgdHJlZSBcdTIwMTQgd2hvbGUtdHJlZSBhbGlnbm1lbnQgd291bGQgbGV0IG9uZSBkZWVwbHlcbiAqIG5lc3RlZCBsb25nIG5hbWUgcGFkIGV2ZXJ5IHVucmVsYXRlZCBicmFuY2guXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVHcm91cFRhcmdldChpdGVtczogRGlzcGxheUl0ZW1bXSk6IG51bWJlciB7XG4gIGxldCBtYXggPSAwO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJyAmJiBwcmludHNSYW5nZUNvbHVtbihpdGVtLm5vZGUuYW5jaG9yKSkge1xuICAgICAgbWF4ID0gTWF0aC5tYXgobWF4LCBkaXNwbGF5V2lkdGgoaXRlbS5uYW1lKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXggPiBNQVhfQUxJR05fQ09MVU1OID8gMCA6IG1heDtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgYW5jaG9yIHByaW50cyBhIHJhbmdlIGNvbHVtbiBhdCBhbGwgXHUyMDE0IHRoZSBleGFjdCBjb25kaXRpb25cbiAqIHtAbGluayBsYWJlbEZvcn0gZW5jb2RlcywgaG9pc3RlZCBzbyB7QGxpbmsgY29tcHV0ZUdyb3VwVGFyZ2V0fSBtZWFzdXJlcyB0aGVcbiAqIHNhbWUgc2V0IG9mIG5hbWVzIGl0IHBhZHMuIEFuIGFuY2hvciB3aXRoIG5vIHJhbmdlcywgb3IgYSAqc29sZSogd2hvbGUtZmlsZVxuICogZW50cnkgKHdoaWNoIHJlbmRlcnMgYXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciksIGNvbnRyaWJ1dGVzIG5vIHJhbmdlXG4gKiBjb2x1bW4gYW5kIHNvIG11c3Qgbm90IGNvbnRyaWJ1dGUgdG8gdGhlIGdyb3VwIG1heCBlaXRoZXI6IG90aGVyd2lzZSBhXG4gKiB3aG9sZS1maWxlIGFuY2hvciBvbiBhIHBhdGggcGFzdCB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0gc2lsZW50bHkgc3VwcHJlc3Nlc1xuICogYWxpZ25tZW50IGZvciBpdHMgcmFuZ2UtYmVhcmluZyBzaWJsaW5ncyB3aGlsZSBpdHNlbGYgcHJpbnRpbmcgbm90aGluZyB0b1xuICogYWxpZ24uXG4gKi9cbmZ1bmN0aW9uIHByaW50c1JhbmdlQ29sdW1uKGFuY2hvcjogVHJlZUFuY2hvcik6IGJvb2xlYW4ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gcmFuZ2VzLnNvbWUoKGVudHJ5KSA9PiBsYWJlbEZvcihlbnRyeS5yYW5nZSwgcmFuZ2VzLmxlbmd0aCA9PT0gMSkgIT09IG51bGwpO1xufVxuXG4vKiogVGhlIHNwYWNpbmcgYmV0d2VlbiBhIG5hbWUgb2YgYG5hbWVXaWR0aGAgY29sdW1ucyBhbmQgaXRzIHJhbmdlIGNvbHVtbi4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVQYWQobmFtZVdpZHRoOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKG5hbWVXaWR0aCA+PSB0YXJnZXQpIHJldHVybiAnICc7XG4gIHJldHVybiAnICcucmVwZWF0KHRhcmdldCAtIG5hbWVXaWR0aCArIDEpO1xufVxuXG4vKipcbiAqIFJlbmRlciBvbmUgbGVhZidzIGxpbmUocykuIEFuIGVtcHR5IGByYW5nZXNgIGFycmF5IGlzIGEgYmFyZS1wYXRoIGxlYWYgd2l0aFxuICogbm8gcmFuZ2UgY29sdW1uIGF0IGFsbCAoZGlzdGluY3QgZnJvbSBhIGB3aG9sZS1maWxlYCBlbnRyeSwgd2hpY2ggaXMgYW5cbiAqIGV4cGxpY2l0IGNsYXNzaWZpY2F0aW9uIHRoYXQgYWxzbyBwcmludHMgd2l0aCB6ZXJvIG1hcmtlciB3aGVuIGl0IHN0YW5kc1xuICogYWxvbmUsIGJ1dCB0aHJvdWdoIHRoZSByYW5nZXMgcGlwZWxpbmUpLiBNdWx0aXBsZSBzdGFja2VkIHJhbmdlcyBwcmludFxuICogdW5kZXIgYSBjb250aW51YXRpb24gcHJlZml4IGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoZSBuYW1lOyBlYWNoIGNhcnJpZXMgaXRzXG4gKiBvd24gc3VmZml4IGluZGVwZW5kZW50bHksIGFuZCBlYWNoIGNhcnJpZXMgYSBsYWJlbCBpZGVudGlmeWluZyB3aGljaCBhbmNob3JcbiAqIHRoZSBzdWZmaXggYmVsb25ncyB0by5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyTGVhZkxpbmVzKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcjogVHJlZUFuY2hvcixcbiAgb3duUHJlZml4OiBzdHJpbmcsXG4gIGNoaWxkUHJlZml4OiBzdHJpbmcsXG4gIGdyb3VwVGFyZ2V0OiBudW1iZXJcbik6IHN0cmluZ1tdIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBbYCR7b3duUHJlZml4fSR7bmFtZX1gXTtcblxuICBjb25zdCBzb3J0ZWQgPSBbLi4ucmFuZ2VzXS5zb3J0KGNvbXBhcmVSYW5nZUVudHJpZXMpO1xuICBjb25zdCBzb2xlID0gc29ydGVkLmxlbmd0aCA9PT0gMTtcbiAgY29uc3QgbmFtZVdpZHRoID0gZGlzcGxheVdpZHRoKG5hbWUpO1xuICBjb25zdCBwYWQgPSBjb21wdXRlUGFkKG5hbWVXaWR0aCwgZ3JvdXBUYXJnZXQpO1xuICBjb25zdCBibGFuayA9ICcgJy5yZXBlYXQobmFtZVdpZHRoICsgcGFkLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHNvcnRlZC5tYXAoKGVudHJ5LCBpKSA9PiB7XG4gICAgY29uc3QgbGFiZWwgPSBsYWJlbEZvcihlbnRyeS5yYW5nZSwgc29sZSk7XG4gICAgaWYgKGxhYmVsID09PSBudWxsKSByZXR1cm4gYCR7b3duUHJlZml4fSR7bmFtZX0ke2VudHJ5LnN1ZmZpeH1gO1xuICAgIGNvbnN0IGJhc2UgPSBpID09PSAwID8gYCR7b3duUHJlZml4fSR7bmFtZX0ke3BhZH1gIDogYCR7Y2hpbGRQcmVmaXh9JHtibGFua31gO1xuICAgIHJldHVybiBgJHtiYXNlfSR7bGFiZWx9JHtlbnRyeS5zdWZmaXh9YDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck5vZGVzKG5vZGVzOiBQYXRoVHJlZU5vZGVbXSwgcHJlZml4OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBpdGVtcyA9IG5vZGVzLm1hcChmb2xkQ2hhaW4pO1xuICBjb25zdCBncm91cFRhcmdldCA9IGNvbXB1dGVHcm91cFRhcmdldChpdGVtcyk7XG4gIGl0ZW1zLmZvckVhY2goKGl0ZW0sIGkpID0+IHtcbiAgICBjb25zdCBpc0xhc3QgPSBpID09PSBpdGVtcy5sZW5ndGggLSAxO1xuICAgIGNvbnN0IG93blByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICdcdTI1MTRcdTI1MDAgJyA6ICdcdTI1MUNcdTI1MDAgJ31gO1xuICAgIGNvbnN0IGNoaWxkUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJyAgICcgOiAnXHUyNTAyICAnfWA7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicpIHtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTGVhZkxpbmVzKGl0ZW0ubmFtZSwgaXRlbS5ub2RlLmFuY2hvciwgb3duUHJlZml4LCBjaGlsZFByZWZpeCwgZ3JvdXBUYXJnZXQpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGluZXMucHVzaChgJHtvd25QcmVmaXh9JHtpdGVtLm5hbWV9L2ApO1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJOb2RlcyhpdGVtLm5vZGUuY2hpbGRyZW4sIGNoaWxkUHJlZml4KSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGxpbmVzO1xufVxuXG4vKipcbiAqIFJlbmRlciBhIGNvbGxhcHNlZCBhbmNob3IgbGlzdCBhcyBhIGJveC1kcmF3aW5nIHRyZWUsIGdyb3VwZWQgYnkgc2hhcmVkXG4gKiBwYXRoIHByZWZpeC4gRXZlcnkgYW5jaG9yIGxpc3QgcmVuZGVycyBhcyBhIHRyZWUgdW5jb25kaXRpb25hbGx5IFx1MjAxNCBhIHNpbmdsZVxuICogYW5jaG9yIGJlY29tZXMgYSBvbmUtbGluZSB0cmVlIHdoYXRldmVyIGl0cyBkZXB0aCAoc2VlIHtAbGluayBmb2xkQ2hhaW59KTtcbiAqIHRoZXJlIGlzIG5vIGZsYXQtYnVsbGV0IHBhdGggb3Igc2l6ZSBmbG9vciBpbiB0aGlzIG1vZHVsZS5cbiAqXG4gKiBIZWlnaHQgaXMgYm91bmRlZCBieSB7QGxpbmsgZm9sZENoYWlufTogYSBkaXJlY3RvcnkgbGluZSBvbmx5IGV2ZXIgYXBwZWFyc1xuICogd2hlcmUgaXQgZ2VudWluZWx5IGdyb3VwcyB0d28gb3IgbW9yZSBzaWJsaW5ncywgc28gdGhlIHRyZWUgYWRkcyBhdCBtb3N0XG4gKiBvbmUgbGluZSBwZXIgcmVhbCBncm91cGluZyBhbmQgbmV2ZXIgb25lIHBlciBwYXRoIHNlZ21lbnQuXG4gKlxuICogVG90YWwgZm9yIGFueSB3ZWxsLWZvcm1lZCBgVHJlZUFuY2hvcltdYDogZGVnZW5lcmF0ZSBwYXRocyAocnVsZSBlbmZvcmNlZFxuICogaW4ge0BsaW5rIHNwbGl0U2VnbWVudHN9KSBhcmUgbm9ybWFsaXplZCB0byBhdG9taWMgbGVhdmVzIHJhdGhlciB0aGFuXG4gKiB0aHJvd24gb24sIHNvIHRoaXMgZnVuY3Rpb24gbmV2ZXIgbmVlZHMgYW4gaW50ZXJuYWwgdHJ5L2NhdGNoLiBDYWxsZXJzIGFkZFxuICogdGhlaXIgb3duIGNhdGNoIGFyb3VuZCB0aGlzIGNhbGwgaW4gYSBsYXRlciBwaGFzZSAoZmFpbC1vcGVuIGRpc2NpcGxpbmVcbiAqIGxpdmVzIGF0IHRoZSBjYWxsIHNpdGUsIG5vdCBoZXJlKS5cbiAqXG4gKiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlcyBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyXG4gKiBkaXN0aW5jdCBgcGF0aGAgXHUyMDE0IHBhc3MgYW5jaG9ycyB0aHJvdWdoIHtAbGluayBjb2xsYXBzZUJ5UGF0aH0gZmlyc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJBbmNob3JUcmVlKGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZm9yZXN0ID0gYnVpbGRGb3Jlc3QoYW5jaG9ycyk7XG4gIHJldHVybiByZW5kZXJOb2Rlcyhmb3Jlc3QsICcnKTtcbn1cbiIsICIvKipcbiAqIENvZGV4IGBhcHBseV9wYXRjaGAgZW52ZWxvcGUgcGFyc2VyLlxuICpcbiAqIFR1cm5zIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBgdG9vbF9pbnB1dC5jb21tYW5kYCBwYXRjaCBzdHJpbmcgaW50byB0aGVcbiAqIGBBbmNob3JTcGVjW11gIHNoYXBlIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBhbHJlYWR5IGNvbnN1bWVzIFx1MjAxNCB0aGUgb25lXG4gKiBnZW51aW5lbHkgbmV3IGFsZ29yaXRobSB0aGUgQ29kZXggYWRhcHRlciBuZWVkcy4gSXQgcmVwbGFjZXMgdGhlIHN0cnVjdHVyZWRcbiAqIGBmaWxlX3BhdGhgL2BvbGRfc3RyaW5nYC9gb2Zmc2V0YCByZWFkaW5nIHRoZSBDbGF1ZGUgUG9zdFRvb2xVc2UgdG91Y2ggaG9va1xuICogZG9lcywgYmVjYXVzZSBDb2RleCBkZWxpdmVycyBldmVyeSBlZGl0IGFzIGEgc2luZ2xlIGFwcGx5X3BhdGNoIGVudmVsb3BlXG4gKiByYXRoZXIgdGhhbiBhIHR5cGVkIHRvb2wgaW5wdXQuXG4gKlxuICogVGhlIG1vZHVsZSBpcyBwdXJlOiBpdCBpbXBvcnRzIG9ubHkgdGhlIGtlcm5lbCBhbmNob3IgdHlwZXMgYW5kIG5ldmVyIHRvdWNoZXNcbiAqIHRoZSBDb2RleCBTREssIHNvIGl0IGlzIERJLXRlc3RhYmxlIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlXG4gKiBzaGFyZWQga2VybmVsLiBSYW5nZSByZWNvdmVyeSBpcyBiZXN0LWVmZm9ydCBcdTIwMTQgdGhlIGFwcGx5X3BhdGNoIGZvcm1hdCBjYXJyaWVzXG4gKiBgQEBgIGNvbnRleHQgYW5kIGArYC9gLWAvc3BhY2UgY2hhbmdlIGxpbmVzIGJ1dCBubyBleHBsaWNpdCBsaW5lIG51bWJlcnMsIHNvIGFcbiAqIHJhbmdlIGNhbiBvbmx5IGJlIHJlY292ZXJlZCBieSBsb2NhdGluZyBhIGh1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGVcbiAqIG9uLWRpc2sgZmlsZS4gVGhhdCBmaWxlIHJlYWQgaXMgaW5qZWN0ZWQgKGByZWFkUHJlRWRpdEZpbGVgKSBzbyB0aGUgZnVuY3Rpb25cbiAqIHN0YXlzIHB1cmUgYW5kIHRlc3RhYmxlLiBPbiBBTlkgYW1iaWd1aXR5IChubyByZWFkZXIsIGZpbGUgbWlzc2luZywgY29udGV4dFxuICogbm90IGZvdW5kLCBmdXp6eS9kdXBsaWNhdGUgbWF0Y2gpIHRoZSBwYXJzZXIgZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvclxuICogcmF0aGVyIHRoYW4gdGhyb3dpbmcgXHUyMDE0IHdob2xlLWZpbGUgYW5jaG9ycyBhcmUgZmlyc3QtY2xhc3MgYW5kIHRvdWNoIHRyYWNraW5nXG4gKiBtdXN0IG5ldmVyIGJlIGJsb2NrZWQuXG4gKlxuICogVGhlIGdyYW1tYXIgaXMgY3Jvc3MtY2hlY2tlZCBhZ2FpbnN0IENvZGV4J3Mgb3duIGFwcGx5X3BhdGNoIGNyYXRlXG4gKiAoY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3twYXJzZXIsc3RyZWFtaW5nX3BhcnNlcn0ucnMpLiBUd28gc3VidGxldGllcyBhcmVcbiAqIG1pcnJvcmVkIGRlbGliZXJhdGVseTogaHVuay1oZWFkZXIgbWFya2VycyBhcmUgb25seSByZWNvZ25pemVkIGF0IHRoZSBzdGFydCBvZlxuICogYSBsaW5lIHdpdGggbm8gbGVhZGluZyB3aGl0ZXNwYWNlIHdoaWxlIGluc2lkZSBhbiBVcGRhdGUgaHVuayAoYSBsZWFkaW5nIHNwYWNlXG4gKiBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSwgYW5kIGEgYmFyZSBlbXB0eSBsaW5lIGluc2lkZSBhbiBVcGRhdGVcbiAqIGh1bmsgaXMgdHJlYXRlZCBhcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgcHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3IGNvbnRlbnQuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgdHlwZSB7IEFuY2hvclNwZWMsIExpbmVSYW5nZSB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuXG4vKipcbiAqIFJlYWRzIHRoZSBwcmUtZWRpdCAob24tZGlzaywgYmVmb3JlIHRoZSBwYXRjaCBhcHBsaWVzKSBjb250ZW50IG9mIHRoZSBmaWxlIGF0XG4gKiBgcGF0aGAsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIHJlYWQuIEluamVjdGVkIHNvIHRoZSBwYXJzZXIgc3RheXNcbiAqIHB1cmU7IGNhbGwgc2l0ZXMgZGVmYXVsdCB0byBhIHJlYWwgZmlsZXN5c3RlbSByZWFkLlxuICovXG5leHBvcnQgdHlwZSBSZWFkUHJlRWRpdEZpbGUgPSAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdyYW1tYXIgbWFya2VycyAobWlycm9ycyBjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMvcGFyc2VyLnJzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEVORF9QQVRDSF9NQVJLRVIgPSAnKioqIEVuZCBQYXRjaCc7XG5jb25zdCBBRERfRklMRV9NQVJLRVIgPSAnKioqIEFkZCBGaWxlOiAnO1xuY29uc3QgREVMRVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBEZWxldGUgRmlsZTogJztcbmNvbnN0IFVQREFURV9GSUxFX01BUktFUiA9ICcqKiogVXBkYXRlIEZpbGU6ICc7XG5jb25zdCBNT1ZFX1RPX01BUktFUiA9ICcqKiogTW92ZSB0bzogJztcbmNvbnN0IEVPRl9NQVJLRVIgPSAnKioqIEVuZCBvZiBGaWxlJztcbmNvbnN0IENIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCAnO1xuY29uc3QgRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbnRlcm1lZGlhdGUgaHVuayBtb2RlbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBVcGRhdGVDaHVuayB7XG4gIC8qKiBPcHRpb25hbCBgQEAgPGNvbnRleHQ+YCBsaW5lIHVzZWQgdG8gZGlzYW1iaWd1YXRlIHRoZSBibG9jaydzIGxvY2F0aW9uLiAqL1xuICBjaGFuZ2VDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKiogUHJlLWVkaXQgbGluZXMgdGhpcyBjaHVuayBjb3ZlcnMgKGNvbnRleHQgYCBgICsgcmVtb3ZlZCBgLWApLCBpbiBvcmRlci4gKi9cbiAgb2xkTGluZXM6IHN0cmluZ1tdO1xuICAvKiogUG9zdC1lZGl0IGxpbmVzIChjb250ZXh0IGAgYCArIGFkZGVkIGArYCk7IHJldGFpbmVkIGZvciBjb21wbGV0ZW5lc3MuICovXG4gIG5ld0xpbmVzOiBzdHJpbmdbXTtcbn1cblxudHlwZSBIdW5rID1cbiAgfCB7IGtpbmQ6ICdhZGQnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2RlbGV0ZSc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAndXBkYXRlJzsgcGF0aDogc3RyaW5nOyBtb3ZlUGF0aDogc3RyaW5nIHwgbnVsbDsgY2h1bmtzOiBVcGRhdGVDaHVua1tdIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCByZWFkZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlYWwtZmlsZXN5c3RlbSByZWFkZXIgdXNlZCB3aGVuIG5vIHJlYWRlciBpcyBpbmplY3RlZC4gQmVzdC1lZmZvcnQ6IGFueVxuICogZmFpbHVyZSAobWlzc2luZyBmaWxlLCBwZXJtaXNzaW9uIGVycm9yKSB5aWVsZHMgYG51bGxgLCB3aGljaCB0aGUgcGFyc2VyXG4gKiBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVudmVsb3BlIHNjYW5uaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTY2FuIHRoZSBwYXRjaCB0ZXh0IGludG8gaHVua3MuIExlbmllbnQgYnkgZGVzaWduOiB1bnJlY29nbml6ZWQgbGluZXMgYXJlXG4gKiBpZ25vcmVkIHJhdGhlciB0aGFuIHJlamVjdGVkLCBhbmQgQmVnaW4vRW5kL0Vudmlyb25tZW50IGxpbmVzIGFyZSBza2lwcGVkLCBzb1xuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUgZGVncmFkZXMgdG8gd2hhdGV2ZXIgaHVua3MgY291bGQgYmUgcmVjb3ZlcmVkIChvZnRlblxuICogbm9uZSBcdTIxOTIgYFtdYCkgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuZnVuY3Rpb24gc2Nhbkh1bmtzKGNvbW1hbmQ6IHN0cmluZyk6IEh1bmtbXSB7XG4gIGNvbnN0IGh1bmtzOiBIdW5rW10gPSBbXTtcbiAgLy8gVGhlIGN1cnJlbnRseS1vcGVuIFVwZGF0ZSBodW5rLCBvciBudWxsLiBBZGQvRGVsZXRlIGh1bmtzIGhhdmUgbm8gYm9keSwgc29cbiAgLy8gdGhleSBjbG9zZSBpbW1lZGlhdGVseSBhbmQgcmVzZXQgdGhpcyB0byBudWxsLlxuICBsZXQgb3BlblVwZGF0ZTogKEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCByYXcgb2YgY29tbWFuZC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBIZWFkZXIgZGV0ZWN0aW9uIGlzIHdoaXRlc3BhY2Utc2Vuc2l0aXZlIGluc2lkZSBhbiBVcGRhdGUgaHVuazogQ29kZXggdXNlc1xuICAgIC8vIHRyaW1fZW5kIHRoZXJlIChsZWFkaW5nIHNwYWNlIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpIGFuZCBmdWxsXG4gICAgLy8gdHJpbSBlbHNld2hlcmUuIE1hdGNoIHRoYXQgc28gaW5kZW50ZWQgbWFya2VycyBpbnNpZGUgYSBodW5rIHN0YXkgY29udGVudC5cbiAgICBjb25zdCBoZWFkZXJMaW5lOiBzdHJpbmcgPSBvcGVuVXBkYXRlID8gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpIDogcmF3LnRyaW0oKTtcblxuICAgIGlmIChoZWFkZXJMaW5lID09PSBFTkRfUEFUQ0hfTUFSS0VSKSB7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKEFERF9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnYWRkJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShBRERfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoREVMRVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKERFTEVURV9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChVUERBVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBjb25zdCBodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9ID0ge1xuICAgICAgICBraW5kOiAndXBkYXRlJyxcbiAgICAgICAgcGF0aDogaGVhZGVyTGluZS5zbGljZShVUERBVEVfRklMRV9NQVJLRVIubGVuZ3RoKSxcbiAgICAgICAgbW92ZVBhdGg6IG51bGwsXG4gICAgICAgIGNodW5rczogW11cbiAgICAgIH07XG4gICAgICBodW5rcy5wdXNoKGh1bmspO1xuICAgICAgb3BlblVwZGF0ZSA9IGh1bms7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAob3BlblVwZGF0ZSkge1xuICAgICAgcHJvY2Vzc1VwZGF0ZUxpbmUob3BlblVwZGF0ZSwgcmF3KTtcbiAgICB9XG4gICAgLy8gQW55IG90aGVyIGxpbmUgb3V0c2lkZSBhbiBVcGRhdGUgaHVuayAoQmVnaW4gUGF0Y2gsIEVudmlyb25tZW50IElELCBBZGRcbiAgICAvLyBGaWxlIGArYCBjb250ZW50LCBzdHJheSB0ZXh0KSBpcyBpZ25vcmVkLlxuICB9XG5cbiAgcmV0dXJuIGh1bmtzO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVDaHVuayhodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KTogVXBkYXRlQ2h1bmsge1xuICBjb25zdCBsYXN0ID0gaHVuay5jaHVua3NbaHVuay5jaHVua3MubGVuZ3RoIC0gMV07XG4gIGlmIChsYXN0KSByZXR1cm4gbGFzdDtcbiAgY29uc3QgY2h1bms6IFVwZGF0ZUNodW5rID0geyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9O1xuICBodW5rLmNodW5rcy5wdXNoKGNodW5rKTtcbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vKiogQXBwbHkgb25lIGJvZHkgbGluZSBvZiBhbiBVcGRhdGUgaHVuayB0byBpdHMgY2h1bmsgbGlzdC4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NVcGRhdGVMaW5lKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0sIHJhdzogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRyaW1tZWRFbmQgPSByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJyk7XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVPRl9NQVJLRVIpIHJldHVybjsgLy8gZW5kLW9mLWZpbGUgaGludDsgbm90IG5lZWRlZCBmb3IgcmFuZ2VzXG5cbiAgLy8gYCoqKiBNb3ZlIHRvOmAgaXMgb25seSBtZWFuaW5nZnVsIGJlZm9yZSBhbnkgY2hhbmdlIGNvbnRlbnQuXG4gIGlmIChodW5rLmNodW5rcy5sZW5ndGggPT09IDAgJiYgaHVuay5tb3ZlUGF0aCA9PT0gbnVsbCAmJiB0cmltbWVkRW5kLnN0YXJ0c1dpdGgoTU9WRV9UT19NQVJLRVIpKSB7XG4gICAgaHVuay5tb3ZlUGF0aCA9IHRyaW1tZWRFbmQuc2xpY2UoTU9WRV9UT19NQVJLRVIubGVuZ3RoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHJpbW1lZEVuZC5zdGFydHNXaXRoKENIQU5HRV9DT05URVhUX01BUktFUikpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogdHJpbW1lZEVuZC5zbGljZShDSEFOR0VfQ09OVEVYVF9NQVJLRVIubGVuZ3RoKSwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQSBiYXJlIGVtcHR5IGxpbmUgaXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIChwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcpLlxuICBpZiAocmF3ID09PSAnJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaCgnJyk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaCgnJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpcnN0ID0gcmF3WzBdO1xuICBpZiAoZmlyc3QgPT09ICcgJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY29uc3QgY29udGVudCA9IHJhdy5zbGljZSgxKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goY29udGVudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJysnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJy0nKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFVucmVjb2duaXplZCBjb250ZW50IGxpbmUgXHUyMDE0IGlnbm9yZSBsZW5pZW50bHkgcmF0aGVyIHRoYW4gdGhyb3cuXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3BsaXQgZmlsZSBjb250ZW50IGludG8gbGluZXMgZm9yIG1hdGNoaW5nLiBBIHRyYWlsaW5nIG5ld2xpbmUgeWllbGRzIGFcbiAqIHRyYWlsaW5nIGVtcHR5IGVsZW1lbnQsIHdoaWNoIGlzIGhhcm1sZXNzIGZvciBzdWItc2xpY2UgbWF0Y2hpbmcuICovXG5mdW5jdGlvbiBzcGxpdExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGNvbnRlbnQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKiogSW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYHZhbHVlYCBhcHBlYXJzIGFzIGEgZnVsbCBsaW5lIGluIGBsaW5lc2AuICovXG5mdW5jdGlvbiBsaW5lSW5kaWNlcyhsaW5lczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXSA9PT0gdmFsdWUpIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTdGFydCBpbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgbmVlZGxlYCBtYXRjaGVzIGNvbnRpZ3VvdXNseSBpbiBgaGF5c3RhY2tgLiAqL1xuZnVuY3Rpb24gY29udGlndW91c01hdGNoZXMoaGF5c3RhY2s6IHN0cmluZ1tdLCBuZWVkbGU6IHN0cmluZ1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwIHx8IG5lZWRsZS5sZW5ndGggPiBoYXlzdGFjay5sZW5ndGgpIHJldHVybiBvdXQ7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBMb2NhdGUgYSBzaW5nbGUgY2h1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGUgZmlsZSwgcmV0dXJuaW5nIGl0cyAxLWJhc2VkXG4gKiBsaW5lIHJhbmdlIG9yIG51bGwgd2hlbiBpdCBjYW5ub3QgYmUgbG9jYXRlZCB1bmFtYmlndW91c2x5LlxuICpcbiAqIC0gTm9uLWVtcHR5IGJsb2NrOiByZXF1aXJlIGEgdW5pcXVlIGNvbnRpZ3VvdXMgbWF0Y2gsIG9yIFx1MjAxNCB3aGVuIGR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIGEgYEBAYCBjaGFuZ2UtY29udGV4dCBsaW5lIHRoYXQgc2VsZWN0cyB0aGUgb2NjdXJyZW5jZSBhZnRlciBpdC5cbiAqIC0gRW1wdHkgYmxvY2sgKHB1cmUgaW5zZXJ0aW9uKTogYW5jaG9yIG9uIGEgdW5pcXVlIGNoYW5nZS1jb250ZXh0IGxpbmUgaWYgb25lXG4gKiAgIGlzIGdpdmVuOyBvdGhlcndpc2UgaXQgaXMgdW5sb2NhdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGxvY2F0ZUNodW5rKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bms6IFVwZGF0ZUNodW5rKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGJsb2NrID0gY2h1bmsub2xkTGluZXM7XG5cbiAgaWYgKGJsb2NrLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gICAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgICBjb25zdCBjdHhJZHhzID0gbGluZUluZGljZXMocHJlTGluZXMsIGN0eCk7XG4gICAgICBpZiAoY3R4SWR4cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGN0eElkeHNbMF0gKyAxO1xuICAgICAgICByZXR1cm4geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgc3RhcnRzID0gY29udGlndW91c01hdGNoZXMocHJlTGluZXMsIGJsb2NrKTtcbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzID0gc3RhcnRzWzBdO1xuICAgIHJldHVybiB7IHN0YXJ0OiBzICsgMSwgZW5kOiBzICsgYmxvY2subGVuZ3RoIH07XG4gIH1cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIER1cGxpY2F0ZWQgYmxvY2s6IHVzZSB0aGUgY2hhbmdlIGNvbnRleHQgdG8gc2VsZWN0IHRoZSBtYXRjaCBhZnRlciBpdC5cbiAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpKSB7XG4gICAgICBjb25zdCBhZnRlciA9IHN0YXJ0cy5maW5kKChzKSA9PiBzID49IGMpO1xuICAgICAgaWYgKGFmdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGFmdGVyICsgMSwgZW5kOiBhZnRlciArIGJsb2NrLmxlbmd0aCB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDsgLy8gYW1iaWd1b3VzIFx1MjE5MiBjYWxsZXIgZGVncmFkZXMgdG8gd2hvbGUtZmlsZVxufVxuXG4vKipcbiAqIFJlY292ZXIgYSBzaW5nbGUgbGluZSByYW5nZSBzcGFubmluZyBhbGwgb2YgYW4gdXBkYXRlJ3MgY2h1bmtzLiBSZXR1cm5zIG51bGxcbiAqIChcdTIxOTIgd2hvbGUtZmlsZSBmYWxsYmFjaykgaWYgYW55IGNodW5rIGNhbm5vdCBiZSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2UocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVua3M6IFVwZGF0ZUNodW5rW10pOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgbGV0IHVuaW9uOiBMaW5lUmFuZ2UgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICBjb25zdCByID0gbG9jYXRlQ2h1bmsocHJlTGluZXMsIGNodW5rKTtcbiAgICBpZiAociA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgdW5pb24gPSB1bmlvbiA9PT0gbnVsbCA/IHIgOiB7IHN0YXJ0OiBNYXRoLm1pbih1bmlvbi5zdGFydCwgci5zdGFydCksIGVuZDogTWF0aC5tYXgodW5pb24uZW5kLCByLmVuZCkgfTtcbiAgfVxuICByZXR1cm4gdW5pb247XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUGFyc2UgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGNvbW1hbmQgc3RyaW5nIGludG8gYW4gYW5jaG9yIHBlciB0b3VjaGVkIGZpbGUuXG4gKlxuICogLSBgKioqIEFkZCBGaWxlOmAgXHUyMTkyIGBjcmVhdGVgICh3aG9sZS1maWxlKVxuICogLSBgKioqIERlbGV0ZSBGaWxlOmAgXHUyMTkyIGB3aG9sZS13cml0ZWAgKHdob2xlLWZpbGU7IHRoZSBmaWxlIG5vIGxvbmdlciBleGlzdHMpXG4gKiAtIGAqKiogVXBkYXRlIEZpbGU6YCBcdTIxOTIgYHdyaXRlYCB3aXRoIGEgcmVjb3ZlcmVkIGxpbmUgcmFuZ2Ugd2hlbiB0aGUgaHVuaydzXG4gKiAgIHByZS1lZGl0IGJsb2NrIGNhbiBiZSBsb2NhdGVkIHZpYSBgcmVhZFByZUVkaXRGaWxlYCwgb3RoZXJ3aXNlIGB3aG9sZS13cml0ZWAuXG4gKiAgIEEgcmVuYW1lZCB1cGRhdGUgKGAqKiogTW92ZSB0bzpgKSBhbmNob3JzIHRoZSBkZXN0aW5hdGlvbiBwYXRoIGFzXG4gKiAgIGB3aG9sZS13cml0ZWAgc2luY2UgcHJlLWVkaXQgbGluZSBudW1iZXJzIGNhbm5vdCBiZSBtYXBwZWQgYWNyb3NzIGEgcmVuYW1lLlxuICpcbiAqIE5ldmVyIHRocm93czogYSBtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggeWllbGRzIGBbXWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFwcGx5UGF0Y2goXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pOiBBbmNob3JTcGVjW10ge1xuICBjb25zdCBhbmNob3JzOiBBbmNob3JTcGVjW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGh1bmsgb2Ygc2Nhbkh1bmtzKGNvbW1hbmQpKSB7XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2FkZCcpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ2NyZWF0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZTogYW5jaG9yIG9uIHRoZSBkZXN0aW5hdGlvbiBwYXRoIChwb3N0LWVkaXQgbG9jYXRpb24pLlxuICAgIGNvbnN0IHRhcmdldFBhdGggPSB0b1Bvc2l4KGh1bmsubW92ZVBhdGggPz8gaHVuay5wYXRoKTtcblxuICAgIC8vIEEgcmVuYW1lIGRlZmVhdHMgcHJlLWVkaXQgbGluZSBtYXBwaW5nIFx1MjAxNCBhbmNob3Igd2hvbGUtZmlsZSBvbiB0aGUgdGFyZ2V0LlxuICAgIGlmIChodW5rLm1vdmVQYXRoICE9PSBudWxsKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gUmFuZ2UgcmVjb3ZlcnkgcmVhZHMgdGhlIHByZS1lZGl0IGNvbnRlbnQgYXQgdGhlIG9yaWdpbmFsIChwcmUtbW92ZSkgcGF0aC5cbiAgICBjb25zdCBjb250ZW50ID0gcmVhZFByZUVkaXRGaWxlKGh1bmsucGF0aCk7XG4gICAgY29uc3QgcmFuZ2UgPSBjb250ZW50ID09PSBudWxsID8gbnVsbCA6IHJlY292ZXJSYW5nZShzcGxpdExpbmVzKGNvbnRlbnQpLCBodW5rLmNodW5rcyk7XG4gICAgaWYgKHJhbmdlICE9PSBudWxsKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd3JpdGUnLCByYW5nZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYW5jaG9ycztcbn1cbiIsICJleHBvcnQgY29uc3QgUEFDS0FHRV9OQU1FID0gXCJAZ29vZGZvb3QvY29kZXgtaG9va3NcIjtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSA2MDBfMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfU1RBVFVTX01FU1NBR0UgPSB1bmRlZmluZWQ7XG5leHBvcnQgY29uc3QgREVGQVVMVF9FU0JVSUxEX0xPQURFUlMgPSB7XG4gICAgXCIubWRcIjogXCJ0ZXh0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEhPT0tfRkFDVE9SWV9UT19FVkVOVCA9IHtcbiAgICBwcmVUb29sVXNlSG9vazogXCJQcmVUb29sVXNlXCIsXG4gICAgcG9zdFRvb2xVc2VIb29rOiBcIlBvc3RUb29sVXNlXCIsXG4gICAgcGVybWlzc2lvblJlcXVlc3RIb29rOiBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgdXNlclByb21wdFN1Ym1pdEhvb2s6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgIHNlc3Npb25TdGFydEhvb2s6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgc3ViYWdlbnRTdGFydEhvb2s6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIHN0b3BIb29rOiBcIlN0b3BcIixcbiAgICBzdWJhZ2VudFN0b3BIb29rOiBcIlN1YmFnZW50U3RvcFwiLFxuICAgIHByZUNvbXBhY3RIb29rOiBcIlByZUNvbXBhY3RcIixcbiAgICBwb3N0Q29tcGFjdEhvb2s6IFwiUG9zdENvbXBhY3RcIixcbn07XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfTUFUQ0hFUiA9IG5ldyBTZXQoW1xuICAgIFwiUHJlVG9vbFVzZVwiLFxuICAgIFwiUG9zdFRvb2xVc2VcIixcbiAgICBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgXCJTZXNzaW9uU3RhcnRcIixcbiAgICBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBcIlN1YmFnZW50U3RvcFwiLFxuICAgIFwiUHJlQ29tcGFjdFwiLFxuICAgIFwiUG9zdENvbXBhY3RcIixcbl0pO1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUID0gbmV3IFNldChbXCJTZXNzaW9uU3RhcnRcIiwgXCJVc2VyUHJvbXB0U3VibWl0XCIsIFwiU3ViYWdlbnRTdGFydFwiXSk7XG4iLCAiaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmNvbnN0IERFRkFVTFRfTE9HX0VOVl9WQVIgPSBcIkNPREVYX0hPT0tTX0xPR19GSUxFXCI7XG5leHBvcnQgY2xhc3MgTG9nZ2VyIHtcbiAgICBoYW5kbGVycyA9IG5ldyBNYXAoKTtcbiAgICBmaWxlSW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgY3VycmVudElucHV0O1xuICAgIGNvbnN0cnVjdG9yKGNvbmZpZyA9IHt9KSB7XG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gcHJvY2Vzcy5lbnZbY29uZmlnLmxvZ0VudlZhciA/PyBERUZBVUxUX0xPR19FTlZfVkFSXSA/PyBudWxsO1xuICAgIH1cbiAgICBzZXRDb250ZXh0KGhvb2tUeXBlLCBpbnB1dCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IGhvb2tUeXBlO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IGlucHV0O1xuICAgIH1cbiAgICBjbGVhckNvbnRleHQoKSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCkgPz8gbmV3IFNldCgpO1xuICAgICAgICBleGlzdGluZy5hZGQoaGFuZGxlcik7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuc2V0KGxldmVsLCBleGlzdGluZyk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBleGlzdGluZy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgICAgICBpZiAoZXhpc3Rpbmcuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFuZGxlcnMuZGVsZXRlKGxldmVsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG4gICAgZGVidWcobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJkZWJ1Z1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgaW5mbyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImluZm9cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIHdhcm4obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJ3YXJuXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBlcnJvcihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBgJHttZXNzYWdlfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCwgY29udGV4dCk7XG4gICAgfVxuICAgIGNsb3NlKCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgLi4uKHRoaXMuY3VycmVudElucHV0ICE9PSB1bmRlZmluZWQgPyB7IGlucHV0OiB0aGlzLmN1cnJlbnRJbnB1dCB9IDoge30pLFxuICAgICAgICAgICAgLi4uKGNvbnRleHQgIT09IHVuZGVmaW5lZCA/IHsgY29udGV4dCB9IDoge30pLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpPy5mb3JFYWNoKChoYW5kbGVyKSA9PiB7XG4gICAgICAgICAgICBoYW5kbGVyKGV2ZW50KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHdyaXRlVG9GaWxlKGV2ZW50KSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVQYXRoID09PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLmZpbGVJbml0aWFsaXplZCkge1xuICAgICAgICAgICAgdGhpcy5maWxlSW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgbG9nRGlyID0gZGlybmFtZSh0aGlzLmxvZ0ZpbGVQYXRoKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhsb2dEaXIpKSB7XG4gICAgICAgICAgICAgICAgbWtkaXJTeW5jKGxvZ0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG9wZW5TeW5jKHRoaXMubG9nRmlsZVBhdGgsIFwiYVwiKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHdyaXRlU3luYyh0aGlzLmxvZ0ZpbGVGZCwgYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmApO1xuICAgICAgICB9XG4gICAgfVxufVxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoKTtcbiIsICJleHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICBTVUNDRVNTOiAwLFxuICAgIEVSUk9SOiAxLFxuICAgIEJMT0NLOiAyLFxufTtcbmV4cG9ydCBjbGFzcyBCbG9ja0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIHJlYXNvbjtcbiAgICBjb25zdHJ1Y3RvcihyZWFzb24pIHtcbiAgICAgICAgc3VwZXIocmVhc29uKTtcbiAgICAgICAgdGhpcy5uYW1lID0gXCJCbG9ja0Vycm9yXCI7XG4gICAgICAgIHRoaXMucmVhc29uID0gcmVhc29uO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG9taXRVbmRlZmluZWQodmFsdWUpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHZhbHVlKS5maWx0ZXIoKFssIGVudHJ5XSkgPT4gZW50cnkgIT09IHVuZGVmaW5lZCkpO1xufVxuZnVuY3Rpb24gYnVpbGRPdXRwdXQodHlwZSwgc3Rkb3V0LCBzdGRlcnIpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBfdHlwZTogdHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvbWl0VW5kZWZpbmVkKHN0ZG91dCksXG4gICAgICAgIC4uLihzdGRlcnIgIT09IHVuZGVmaW5lZCA/IHsgc3RkZXJyIH0gOiB7fSksXG4gICAgfTtcbn1cbmV4cG9ydCBmdW5jdGlvbiByYXdPdXRwdXQoc3Rkb3V0LCBzdGRlcnIpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJSYXdcIiwgc3Rkb3V0LCBzdGRlcnIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaGFzU3BlY2lmaWMgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvblJlYXNvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMudXBkYXRlZElucHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUHJlVG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uLFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvblJlYXNvbixcbiAgICAgICAgICAgIHVwZGF0ZWRJbnB1dDogb3B0aW9ucy51cGRhdGVkSW5wdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VMZWdhY3lCbG9ja091dHB1dChvcHRpb25zKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaGFzU3BlY2lmaWMgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWQgfHwgb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlBvc3RUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHVwZGF0ZWRNQ1BUb29sT3V0cHV0OiBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0VG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RPdXRwdXQob3B0aW9ucykge1xuICAgIGNvbnN0IGRlY2lzaW9uID0gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgIGJlaGF2aW9yOiBvcHRpb25zLmJlaGF2aW9yLFxuICAgICAgICBtZXNzYWdlOiBvcHRpb25zLm1lc3NhZ2UsXG4gICAgICAgIGludGVycnVwdDogb3B0aW9ucy5pbnRlcnJ1cHQsXG4gICAgICAgIHVwZGF0ZWRJbnB1dDogb3B0aW9ucy51cGRhdGVkSW5wdXQsXG4gICAgICAgIHVwZGF0ZWRQZXJtaXNzaW9uczogb3B0aW9ucy51cGRhdGVkUGVybWlzc2lvbnMsXG4gICAgfSk7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0ge1xuICAgICAgICBob29rRXZlbnROYW1lOiBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgICAgIGRlY2lzaW9uLFxuICAgIH07XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUGVybWlzc2lvblJlcXVlc3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlVzZXJQcm9tcHRTdWJtaXRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlNlc3Npb25TdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU2Vzc2lvblN0YXJ0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdWJhZ2VudFN0YXJ0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdWJhZ2VudFN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZUNvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbiIsICJpbXBvcnQgeyBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCB9IGZyb20gXCIuL2NvbnN0YW50cy5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBCbG9ja0Vycm9yLCBFWElUX0NPREVTLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHN1YmFnZW50U3RhcnRPdXRwdXQsIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQsIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuYXN5bmMgZnVuY3Rpb24gcmVhZFN0ZGluKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IGNodW5rcyA9IFtdO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLnNldEVuY29kaW5nKFwidXRmLThcIik7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJkYXRhXCIsIChjaHVuaykgPT4gY2h1bmtzLnB1c2goY2h1bmspKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVuZFwiLCAoKSA9PiByZXNvbHZlKGNodW5rcy5qb2luKFwiXCIpKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG59XG5mdW5jdGlvbiB3cml0ZVN0ZG91dChvdXRwdXQpIHtcbiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShKU09OLnN0cmluZ2lmeShvdXRwdXQuc3Rkb3V0KSk7XG59XG5mdW5jdGlvbiBub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0V2ZW50TmFtZSwgcmVzdWx0KSB7XG4gICAgaWYgKCFFVkVOVFNfV0lUSF9URVhUX09VVFBVVC5oYXMoaG9va0V2ZW50TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2hvb2tFdmVudE5hbWV9IGhvb2tzIGNhbm5vdCByZXR1cm4gcGxhaW4gdGV4dGApO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTZXNzaW9uU3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc2Vzc2lvblN0YXJ0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU3ViYWdlbnRTdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQob3V0cHV0KSB7XG4gICAgcmV0dXJuIG91dHB1dC5zdGRlcnIgIT09IHVuZGVmaW5lZCA/IHsgc3Rkb3V0OiBvdXRwdXQuc3Rkb3V0LCBzdGRlcnI6IG91dHB1dC5zdGRlcnIgfSA6IHsgc3Rkb3V0OiBvdXRwdXQuc3Rkb3V0IH07XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZShob29rRm4pIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGRpbkNvbnRlbnQgPSBhd2FpdCByZWFkU3RkaW4oKTtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KTtcbiAgICAgICAgbG9nZ2VyLnNldENvbnRleHQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgY29uc3QgY29udGV4dCA9IHsgbG9nZ2VyIH07XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhvb2tGbihpbnB1dCwgY29udGV4dCk7XG4gICAgICAgIGxldCBvdXRwdXQgPSB7IHN0ZG91dDoge30gfTtcbiAgICAgICAgaWYgKHR5cGVvZiByZXN1bHQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQobm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tGbi5ob29rRXZlbnROYW1lLCByZXN1bHQpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIHdyaXRlU3Rkb3V0KG91dHB1dCk7XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbiAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmxvY2tFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3IucmVhc29ufVxcbmApO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5zdGFjayA/PyBlcnJvci5tZXNzYWdlfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7U3RyaW5nKGVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5FUlJPUik7XG4gICAgfVxuICAgIGZpbmFsbHkge1xuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIH1cbn1cbiIsICJpbXBvcnQgaG9vayBmcm9tIFwiLi9wb3N0LXRvb2wtdXNlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQW9DQSxTQUFTLFdBQVdBLG9CQUFtQjs7O0FDcEN2QyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFJTyxTQUFTLGdCQUFnQixRQUFRLFNBQVM7QUFDN0MsU0FBTyxlQUFlLGVBQWUsUUFBUSxPQUFPO0FBQ3hEOzs7QUNGQSxTQUFTLGNBQWMsT0FBTztBQUMxQixTQUFPLE9BQU8sWUFBWSxPQUFPLFFBQVEsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLEVBQUUsS0FBSyxNQUFNLFVBQVUsTUFBUyxDQUFDO0FBQzlGO0FBQ0EsU0FBUyxZQUFZLE1BQU0sUUFBUSxRQUFRO0FBQ3ZDLFNBQU87QUFBQSxJQUNILE9BQU87QUFBQSxJQUNQLFFBQVEsY0FBYyxNQUFNO0FBQUEsSUFDNUIsR0FBSSxXQUFXLFNBQVksRUFBRSxPQUFPLElBQUksQ0FBQztBQUFBLEVBQzdDO0FBQ0o7QUFtQ08sU0FBUyxrQkFBa0IsVUFBVSxDQUFDLEdBQUc7QUFDNUMsUUFBTSxjQUFjLFFBQVEsc0JBQXNCLFVBQWEsUUFBUSx5QkFBeUI7QUFDaEcsUUFBTSxxQkFBcUIsY0FDckIsY0FBYztBQUFBLElBQ1osZUFBZTtBQUFBLElBQ2YsbUJBQW1CLFFBQVE7QUFBQSxJQUMzQixzQkFBc0IsUUFBUTtBQUFBLEVB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Q0EsWUFBUSxLQUFLQSxZQUFXLEtBQUs7QUFBQSxFQUNqQyxVQUNBO0FBQ0ksV0FBTyxhQUFhO0FBQ3BCLFdBQU8sTUFBTTtBQUFBLEVBQ2pCO0FBQ0o7OztBQ2pFQSxRQUFRLHFCQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlUGF0aCIsICJpc0Fic29sdXRlIiwgImV4ZWNGaWxlU3luYyIsICJzdGF0U3luYyIsICJpIiwgInJlc29sdmUiLCAidmFsdWUiLCAiZXNjYXBlUmVnRXhwIiwgImlzQWJzb2x1dGUiLCAic3RhdFN5bmMiLCAiZGlybmFtZSIsICJqb2luIiwgInJlc29sdmVQYXRoIiwgImhhc1NoZWxsRXhwYW5zaW9uIiwgImZpbmRHaXRTdWJjb21tYW5kIiwgInJlc29sdmVQYXRoIiwgInNlcCIsICJzdGF0U3luYyIsICJqb2luIiwgImRpcm5hbWUiLCAiYmFzZSIsICJyb290cyIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAibG9nZ2VyIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJiYXNlbmFtZSIsICJsaW5lQ291bnQiLCAiYmFzZW5hbWUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgInRvUG9zaXgiLCAiY3R4IiwgInJlY292ZXJSYW5nZSIsICJjb21tYW5kIiwgInJlc29sdmVQYXRoIiwgImJsb2NrcyIsICJjb21iaW5lZCIsICJleGlzdHNTeW5jIiwgIm1rZGlyU3luYyIsICJkaXJuYW1lIiwgIkVYSVRfQ09ERVMiLCAiQmxvY2tFcnJvciIsICJvbWl0VW5kZWZpbmVkIiwgImJ1aWxkT3V0cHV0IiwgInVzZXJQcm9tcHRTdWJtaXRPdXRwdXQiLCAiYnVpbGRPdXRwdXQiLCAic2Vzc2lvblN0YXJ0T3V0cHV0IiwgInN1YmFnZW50U3RhcnRPdXRwdXQiLCAicmVzb2x2ZSIsICJzZXNzaW9uU3RhcnRPdXRwdXQiLCAic3ViYWdlbnRTdGFydE91dHB1dCIsICJ1c2VyUHJvbXB0U3VibWl0T3V0cHV0IiwgIkVYSVRfQ09ERVMiLCAiQmxvY2tFcnJvciJdCn0K
