#!/usr/bin/env node
// Migrate git-mesh from the legacy ref-backed catalog to the tracked-file
// layout described in card main-78: one UTF-8 text file per mesh under the
// mesh root (default `.mesh`).
//
// This decodes the legacy catalog blobs DIRECTLY in JS with rkyv-js, so it
// does NOT depend on the old `git mesh` binary being installed on the three
// testing installations. Because rkyv-js ships TypeScript sources and is not
// on npm, this file is not run directly on the targets — build the
// self-contained bundle first:
//
//   yarn build:migration
//   node scripts/dist/mesh-ref-to-tracked-file.cjs --dry-run
//
// During development you can also run the bundle in-repo. Running this .mjs
// directly only works after `yarn build:migration` has produced the bundle,
// or via the build script's --run flag.
//
// Flags:
//   --dry-run      Print every file that would be written (full content) and
//                  every ref that would be deleted; touch nothing.
//   --mesh-dir     Override the mesh root. Precedence (main-78):
//                  --mesh-dir > GIT_MESH_DIR > `git config git-mesh.dir` >
//                  `.mesh`.
//   --prune-refs   After writing files, delete the legacy ref namespaces
//                  (refs/meshes/v1/*, refs/anchors/v1/*,
//                  refs/meshes-index/v1/*).

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, isAbsolute, normalize } from 'node:path';
import * as r from 'rkyv-js';

// --- Legacy MeshArchive schema (rkyv 0.8), in field-declaration order --------
// Mirrors packages/git-mesh/src/mesh/archive.rs at commit ce4060e. The
// compatibility `anchors: Vec<String>` field is reconstructed on read and is
// NOT serialized, so it is absent here.
const AnchorExtent = r.taggedEnum({
  WholeFile: r.unit,
  LineRange: r.struct({ start: r.u32, end: r.u32 }),
});
const AnchorEntry = r.struct({
  anchor_sha: r.string,
  created_at: r.string,
  path: r.string,
  extent: AnchorExtent,
  blob: r.string,
});
const CopyDetection = r.taggedEnum({
  Off: r.unit,
  SameCommit: r.unit,
  AnyFileInCommit: r.unit,
  AnyFileInRepo: r.unit,
});
const MeshConfig = r.struct({
  copy_detection: CopyDetection,
  ignore_whitespace: r.bool,
  follow_moves: r.bool,
});
const MeshArchive = r.struct({
  name: r.string,
  anchors_v2: r.vec(r.tuple(r.string, AnchorEntry)),
  message: r.string,
  config: MeshConfig,
});

const FORMAT_VERSION = 0x00;
const HEADER_LEN = 8;

// --- args / git helpers -----------------------------------------------------
const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'mesh-dir': { type: 'string' },
    'prune-refs': { type: 'boolean', default: false },
  },
});
const dryRun = values['dry-run'];

function git(args, { buffer = false, input } = {}) {
  return execFileSync('git', args, {
    input,
    encoding: buffer ? 'buffer' : 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
}
function gitTry(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

const repoRoot = git(['rev-parse', '--show-toplevel']).trim();

// --- mesh root resolution + validation (main-78) ----------------------------
function resolveMeshRoot() {
  const candidate =
    values['mesh-dir'] ??
    process.env.GIT_MESH_DIR ??
    gitTry(['config', 'git-mesh.dir']) ??
    '.mesh';
  if (isAbsolute(candidate)) {
    throw new Error(`mesh root must be repo-relative, got absolute: ${candidate}`);
  }
  const norm = normalize(candidate);
  if (norm === '..' || norm.startsWith('../') || norm.split('/').includes('..')) {
    throw new Error(`mesh root must not contain "..": ${candidate}`);
  }
  if (norm === '.git' || norm.startsWith('.git/')) {
    throw new Error(`mesh root must not live inside .git: ${candidate}`);
  }
  return norm;
}
const meshRoot = resolveMeshRoot();

// --- read + decode the legacy catalog ---------------------------------------
function catalogMeshBlobs() {
  const commit = gitTry(['for-each-ref', '--format=%(objectname)', 'refs/meshes/v1/catalog']);
  if (!commit) return [];
  const tree = git(['ls-tree', 'refs/meshes/v1/catalog^{tree}']);
  const out = [];
  for (const line of tree.split('\n')) {
    if (!line) continue;
    // "<mode> <type> <oid>\t<entry>"
    const tab = line.indexOf('\t');
    const entry = line.slice(tab + 1);
    const oid = line.slice(0, tab).split(/\s+/)[2];
    if (!entry.endsWith('.mesh')) continue;
    const name = entry.slice(0, -'.mesh'.length).split('++').join('/');
    out.push({ name, oid });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function decodeMesh(oid) {
  const buf = git(['cat-file', 'blob', oid], { buffer: true });
  if (buf.length < HEADER_LEN || buf[0] !== FORMAT_VERSION) {
    throw new Error(`unexpected mesh blob header for ${oid} (byte0=${buf[0]})`);
  }
  const payload = buf.subarray(HEADER_LEN); // raw rkyv 0.8 buffer, root at end
  return r.decode(MeshArchive, payload);
}

// --- content hashing of the anchored extent ---------------------------------
// main-78 stores `<algorithm>:<hex>`. The legacy store pinned each anchor to a
// blob OID; we hash the exact bytes of the extent from that blob (raw, not
// normalized). The new binary owns normalization and will reclassify as
// `Changed` if its normalization differs — acceptable for the test installs.
function extentSha256(blobOid, extent) {
  const buf = git(['cat-file', 'blob', blobOid], { buffer: true });
  let slice;
  if (extent.tag === 'WholeFile') {
    slice = buf;
  } else {
    const { start, end } = extent.value; // 1-based inclusive
    let line = 1;
    let startByte = start === 1 ? 0 : null;
    let endByte = buf.length;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        if (line === end) {
          endByte = i + 1;
          break;
        }
        line++;
        if (line === start) startByte = i + 1;
      }
    }
    if (startByte === null) startByte = buf.length;
    slice = buf.subarray(startByte, endByte);
  }
  return 'sha256:' + createHash('sha256').update(slice).digest('hex');
}

function anchorAddress(a) {
  if (a.extent.tag === 'WholeFile') return a.path;
  return `${a.path}#L${a.extent.value.start}-L${a.extent.value.end}`;
}

function renderMeshFile(mesh) {
  const lines = mesh.anchors_v2.map(([, a]) => `${anchorAddress(a)} ${extentSha256(a.blob, a.extent)}`);
  const why = mesh.message.replace(/\s+$/, '');
  return `${lines.join('\n')}\n\n${why}\n`;
}

// --- run --------------------------------------------------------------------
const blobs = catalogMeshBlobs();
if (blobs.length === 0) {
  console.log('No legacy catalog found; nothing to migrate.');
}

let written = 0;
for (const { name, oid } of blobs) {
  let mesh;
  try {
    mesh = decodeMesh(oid);
  } catch (err) {
    console.warn(`[${name}] decode failed: ${err.message}; skipping`);
    continue;
  }
  if (!mesh.anchors_v2.length) {
    console.warn(`[${name}] no anchors; skipping`);
    continue;
  }
  const relPath = join(meshRoot, name);
  const absPath = join(repoRoot, relPath);
  const content = renderMeshFile(mesh);

  if (dryRun) {
    console.log(`--- [dry-run] would write ${relPath} ---`);
    console.log(content.replace(/\n$/, ''));
  } else {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    console.log(`wrote ${relPath} (${mesh.anchors_v2.length} anchor(s))`);
  }
  written++;
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}${written}/${blobs.length} mesh file(s) under ${meshRoot}/`,
);
console.log(
  dryRun
    ? '[dry-run] after a real run: git add the mesh root and commit.'
    : `Next: git add ${meshRoot} && git commit -m "Migrate meshes to tracked files"`,
);

// --- optional: prune legacy ref namespaces ----------------------------------
if (values['prune-refs']) {
  const namespaces = ['refs/meshes/v1/', 'refs/anchors/v1/', 'refs/meshes-index/v1/'];
  const refs = [];
  for (const ns of namespaces) {
    const o = gitTry(['for-each-ref', '--format=%(refname)', ns]) ?? '';
    for (const ref of o.split('\n')) if (ref) refs.push(ref);
  }
  if (refs.length === 0) {
    console.log('No legacy refs to prune.');
  } else if (dryRun) {
    console.log(`[dry-run] would delete ${refs.length} legacy ref(s):`);
    for (const ref of refs) console.log(`  ${ref}`);
  } else {
    git(['update-ref', '--stdin'], { input: refs.map((ref) => `delete ${ref}`).join('\n') + '\n' });
    console.log(`Deleted ${refs.length} legacy ref(s).`);
  }
}
