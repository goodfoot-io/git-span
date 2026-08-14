#!/usr/bin/env python3
"""Production-CLI acceptance benchmark for `git span context`.

The retained spike answers whether the architecture is viable. This harness
answers the separate release question: does the binary actually shipped by
this checkout preserve the strict answer and beat the subprocess lifecycle?
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

SAMPLES = 31
CELLS = {
    "clean": ["file1.txt#L2-L3"],
    "moved": ["file1.txt#L3-L4"],
    "semantic": ["file1.txt#L2-L3"],
    "no-overlap": ["file2.txt#L12-L14"],
    "multi-span": ["file1.txt"],
    "multi-path": ["file1.txt#L2-L3", "file2.txt#L3-L4"],
}


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[bytes]:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    result = subprocess.run(command, cwd=cwd, env=merged, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"{command!r} failed ({result.returncode}): {result.stderr.decode(errors='replace')}")
    return result


def timed(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> tuple[float, subprocess.CompletedProcess[bytes]]:
    started = time.perf_counter_ns()
    result = run(command, cwd, env)
    return (time.perf_counter_ns() - started) / 1_000_000, result


def run_drift(command: list[str], cwd: Path) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"{command!r} failed ({result.returncode}): {result.stderr.decode(errors='replace')}")
    return result


def percentile(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * percentile))]


def seed(repo: Path, binary: str) -> None:
    run(["git", "init", "--initial-branch=main"], repo)
    run(["git", "config", "user.name", "Context Benchmark"], repo)
    run(["git", "config", "user.email", "context@example.com"], repo)
    (repo / "file1.txt").write_text("".join(f"line{i}\n" for i in range(1, 21)))
    (repo / "file2.txt").write_text("".join(f"other{i}\n" for i in range(1, 21)))
    run(["git", "add", "."], repo)
    run(["git", "commit", "-m", "fixture"], repo)
    run(["git", "commit-graph", "write", "--reachable", "--changed-paths"], repo)
    for name, addresses in {
        "alpha": ["file1.txt#L2-L3"],
        "beta": ["file1.txt#L8-L9"],
        "gamma": ["file2.txt#L3-L4"],
    }.items():
        run([binary, "add", name, *addresses], repo)
        run([binary, "why", name, f"why {name}"], repo)


def context(binary: str, repo: Path, addresses: list[str], strict: bool = False) -> subprocess.CompletedProcess[bytes]:
    env = {"GIT_SPAN_CONTEXT_DISABLE_SERVICE": "1"} if strict else None
    return run([binary, "context", *addresses, "--format", "json"], repo, env)


def old_lifecycle(binary: str, repo: Path, addresses: list[str]) -> None:
    # This is the fully rendered process topology used by the hook: fix,
    # listing, drift classification, then why for every selected span.
    run_drift([binary, "drift", "--fix"], repo)
    listing = run([binary, "list", *addresses, "--porcelain"], repo)
    run_drift([binary, "drift", *addresses, "--format", "porcelain"], repo)
    names = sorted({line.split("\t", 1)[0] for line in listing.stdout.decode().splitlines() if line})
    for name in names:
        run_drift([binary, "why", name], repo)


def benchmark(binary: str) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="git-span-context-acceptance-") as temporary:
        root = Path(temporary)
        results: dict[str, object] = {}
        for cell, addresses in CELLS.items():
            repo = root / cell
            repo.mkdir()
            seed(repo, binary)
            if cell == "moved":
                original = (repo / "file1.txt").read_text()
                (repo / "file1.txt").write_text("prefix\n" + original)
            elif cell == "semantic":
                lines = (repo / "file1.txt").read_text().splitlines(keepends=True)
                lines[1:3] = ["meaningfully changed\n", "different content\n"]
                (repo / "file1.txt").write_text("".join(lines))
            oracle = context(binary, repo, addresses, strict=True).stdout
            context(binary, repo, addresses)
            context_samples: list[float] = []
            legacy_samples: list[float] = []
            for _ in range(SAMPLES):
                elapsed, answer = timed([binary, "context", *addresses, "--format", "json"], repo)
                if answer.stdout != oracle:
                    raise RuntimeError(f"{cell}: watched answer differs from strict authoritative answer")
                context_samples.append(elapsed)
            for _ in range(SAMPLES):
                started = time.perf_counter_ns()
                old_lifecycle(binary, repo, addresses)
                legacy_samples.append((time.perf_counter_ns() - started) / 1_000_000)
            cp50, cp95 = statistics.median(context_samples), percentile(context_samples, 0.95)
            lp50, lp95 = statistics.median(legacy_samples), percentile(legacy_samples, 0.95)
            p50_gain = 1.0 - cp50 / lp50
            p95_gain = 1.0 - cp95 / lp95
            if p50_gain < 0.30 or p95_gain < 0.20:
                raise RuntimeError(f"{cell}: latency gate failed (p50 {p50_gain:.1%}, p95 {p95_gain:.1%})")
            results[cell] = {
                "samples": SAMPLES,
                "context_p50_ms": cp50,
                "context_p95_ms": cp95,
                "legacy_p50_ms": lp50,
                "legacy_p95_ms": lp95,
                "p50_improvement": p50_gain,
                "p95_improvement": p95_gain,
            }
        lifecycle = root / "lifecycle"
        lifecycle.mkdir()
        seed(lifecycle, binary)
        cold_ms, cold = timed([binary, "context", "file1.txt", "--format", "json"], lifecycle)
        warm = context(binary, lifecycle, ["file1.txt"])
        fallback_ms, fallback = timed(
            [binary, "context", "file1.txt", "--format", "json"],
            lifecycle,
            {"GIT_SPAN_CONTEXT_DISABLE_SERVICE": "1"},
        )
        if warm.stdout != fallback.stdout:
            raise RuntimeError("strict fallback differs from the warm service")
        with (lifecycle / "file1.txt").open("a") as source:
            source.write("invalidate\n")
        rebuild_ms, rebuilt = timed([binary, "context", "file1.txt", "--format", "json"], lifecycle)
        if rebuilt.returncode != 0:
            raise RuntimeError("invalidated generation did not rebuild")

        original = (lifecycle / "file1.txt").read_text()
        (lifecycle / "file1.txt").write_text("prefix\n" + original)
        context(binary, lifecycle, ["file1.txt"])
        operation_id = str(uuid.uuid4())
        repair_ms, repaired = timed(
            [binary, "context", "file1.txt", "--format", "json", "--fix", "--operation-id", operation_id],
            lifecycle,
        )
        mutation = json.loads(repaired.stdout)["mutation"]
        if not mutation["requested"]:
            raise RuntimeError("repair path omitted mutation facts")

        run([binary, "add", "alternate", "file2.txt#L1-L2"], lifecycle, {"GIT_SPAN_DIR": "alternate-spans"})
        switched = run(
            [binary, "context", "file2.txt#L1-L2", "--format", "json"],
            lifecycle,
            {"GIT_SPAN_DIR": "alternate-spans"},
        )
        if json.loads(switched.stdout)["spans"][0]["name"] != "alternate":
            raise RuntimeError("span-root switch reused the wrong service")

        linked = root / "linked"
        run(["git", "worktree", "add", "-b", "context-linked", str(linked)], lifecycle)
        run([binary, "add", "linked", "file2.txt#L5-L6"], linked)
        linked_answer = run([binary, "context", "file2.txt#L5-L6", "--format", "json"], linked)
        if json.loads(linked_answer.stdout)["spans"][0]["name"] != "linked":
            raise RuntimeError("linked worktree reused the primary service")

        paths = {
            "cold_bootstrap_ms": cold_ms,
            "invalidated_rebuild_ms": rebuild_ms,
            "strict_fallback_ms": fallback_ms,
            "repair_ms": repair_ms,
            "cold_bytes": len(cold.stdout),
            "root_switch": "pass",
            "linked_worktree": "pass",
        }
        return {"schema_version": 1, "run_id": str(uuid.uuid4()), "cells": results, "paths": paths}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    document = benchmark(str(Path(args.binary).resolve()))
    rendered = json.dumps(document, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(rendered)
    print(rendered, end="")


if __name__ == "__main__":
    main()
