"""End-to-end proof that the bridge works with the built hook bundles and a
git-span executable on PATH.

Requires `yarn build:hooks` output (hooks/bin) and `git-span` on PATH;
skipped otherwise.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from minisweagent_gitspan.bridge import default_hooks_dir
from minisweagent_gitspan.environment import HookedLocalEnvironment

pytestmark = pytest.mark.skipif(
    not (default_hooks_dir() / "snapshot.mjs").is_file() or shutil.which("git-span") is None,
    reason="hook bundles not built (yarn build:hooks) or git-span not on PATH",
)

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "test",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "test",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
        env=GIT_ENV,
    )


def test_advisor_hold_and_allow_through_real_bundles(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    (repo / "seed.txt").write_text("seed\n")
    git(repo, "add", "seed.txt")
    git(repo, "commit", "-qm", "init")
    git(repo, "span", "add", "test-span", "seed.txt")
    git(repo, "span", "why", "test-span", "the seed file")
    git(repo, "add", ".span")
    git(repo, "commit", "-qm", "span")
    # Create drift: the anchored file changes.
    (repo / "seed.txt").write_text("seed\nchanged\n")

    env = HookedLocalEnvironment(cwd=str(repo))
    try:
        denied = env.execute({"command": "git commit -am x"})
        allowed = env.execute({"command": "echo hi"})
    finally:
        env.finish_session()
        # Clean up the per-session snapshot state this run created.
        shutil.rmtree(Path.home() / ".cache" / "git-span" / "session" / env.session_id, ignore_errors=True)

    assert denied["returncode"] == 1
    assert "test-span" in denied["output"]
    assert "drift" in denied["output"] or "out of date" in denied["output"]

    assert allowed["returncode"] == 0
    assert allowed["output"].startswith("hi\n")
