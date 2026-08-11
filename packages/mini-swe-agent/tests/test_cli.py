"""mswea/mswea-extra entry points inject the hook classes by import path."""

import sys

from minisweagent_gitspan import cli


def test_main_injects_agent_and_environment_classes(monkeypatch):
    captured = {}

    def fake_app():
        captured["argv"] = list(sys.argv)

    monkeypatch.setattr(cli, "app", fake_app)
    monkeypatch.setattr(sys, "argv", ["mswea", "-m", "deepseek/deepseek-v4-flash", "-t", "task"])

    cli.main()

    assert captured["argv"] == [
        "mswea",
        "--agent-class",
        "minisweagent_gitspan.agent.HookedAgent",
        "--environment-class",
        "minisweagent_gitspan.environment.HookedLocalEnvironment",
        "-m",
        "deepseek/deepseek-v4-flash",
        "-t",
        "task",
    ]


def test_main_extra_injects_docker_environment_for_programbench(monkeypatch):
    captured = {}

    def fake_mini_extra_main():
        captured["argv"] = list(sys.argv)

    monkeypatch.setattr(cli, "mini_extra_main", fake_mini_extra_main)
    monkeypatch.setattr(sys, "argv", ["mswea-extra", "programbench", "-m", "deepseek/deepseek-v4-flash"])

    cli.main_extra()

    assert captured["argv"] == [
        "mswea-extra",
        "programbench",
        "--environment-class",
        "minisweagent_gitspan.environment.HookedDockerEnvironment",
        "-m",
        "deepseek/deepseek-v4-flash",
    ]


def test_main_extra_respects_explicit_environment_class(monkeypatch):
    captured = {}

    def fake_mini_extra_main():
        captured["argv"] = list(sys.argv)

    monkeypatch.setattr(cli, "mini_extra_main", fake_mini_extra_main)
    monkeypatch.setattr(
        sys, "argv", ["mswea-extra", "programbench", "--environment-class", "some.OtherEnv", "-o", "results/"]
    )

    cli.main_extra()

    assert captured["argv"] == ["mswea-extra", "programbench", "--environment-class", "some.OtherEnv", "-o", "results/"]


def test_main_extra_leaves_other_subcommands_untouched(monkeypatch):
    captured = {}

    def fake_mini_extra_main():
        captured["argv"] = list(sys.argv)

    monkeypatch.setattr(cli, "mini_extra_main", fake_mini_extra_main)
    monkeypatch.setattr(sys, "argv", ["mswea-extra", "swebench", "-m", "x"])

    cli.main_extra()

    assert captured["argv"] == ["mswea-extra", "swebench", "-m", "x"]
