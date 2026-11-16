from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType


def _load_bootstrap_module() -> ModuleType:
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "bootstrap_dex.py"
    spec = importlib.util.spec_from_file_location("bootstrap_dex", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bootstrap = _load_bootstrap_module()


def test_core_recipe_lets_the_stack_simulate_chi() -> None:
    args = bootstrap._build_parser().parse_args(["--recipe", "core"])
    command = bootstrap._build_command(args, Path("/workspace/xian-stack"))

    assert "--chi-budget-mode" not in command
    assert "--deploy-helper" in command
    assert "--no-seed-demo-pool" in command


def test_local_demo_recipe_forwards_a_deployer_key_file_not_a_key() -> None:
    args = bootstrap._build_parser().parse_args(
        ["--recipe", "local-demo", "--deployer-key-file", "/secrets/deployer.key"]
    )
    command = bootstrap._build_command(args, Path("/workspace/xian-stack"))

    key_index = command.index("--deployer-key-file")
    assert command[key_index + 1] == "/secrets/deployer.key"
    assert "--seed-demo-pool" in command
    assert "--deployer-private-key" not in command


def test_a_key_or_fixed_chi_on_the_command_line_is_refused(capsys) -> None:
    # A key on the command line shows in ps and shell history; fixed budgets
    # pay half of every unused chi (revision 14).
    for removed in (["--deployer-private-key", "ab" * 32], ["--chi-budget-mode", "fixed"]):
        try:
            bootstrap._build_parser().parse_args(removed)
        except SystemExit:
            continue
        raise AssertionError(f"{removed[0]} was accepted")


def test_dry_run_summary_reports_the_stack_command(monkeypatch, capsys) -> None:
    stack_dir = Path(__file__).resolve().parents[2] / "xian-stack"
    monkeypatch.setattr(
        sys,
        "argv",
        ["bootstrap_dex.py", "--stack-dir", str(stack_dir), "--dry-run"],
    )

    bootstrap.main()

    summary = json.loads(capsys.readouterr().out)
    assert "chi_budget_mode" not in summary
    assert summary["command"][summary["command"].index("localnet-dex-bootstrap") - 1].endswith(
        "backend.py"
    )


def test_a_wallet_key_from_the_environment_reaches_the_stack_only_by_environment(monkeypatch) -> None:
    monkeypatch.delenv("XIAN_DEX_DEPLOYER_PRIVATE_KEY", raising=False)
    monkeypatch.setenv("XIAN_WALLET_PRIVATE_KEY", "cd" * 32)

    assert bootstrap._stack_environment()["XIAN_DEX_DEPLOYER_PRIVATE_KEY"] == "cd" * 32
    args = bootstrap._build_parser().parse_args(["--recipe", "core"])
    assert not any("cd" * 32 in part for part in bootstrap._build_command(args, Path("/s")))


def test_the_key_file_path_comes_from_the_environment(monkeypatch) -> None:
    monkeypatch.setenv("XIAN_DEX_DEPLOYER_KEY_FILE", "/secrets/deployer.key")

    args = bootstrap._build_parser().parse_args([])

    assert args.deployer_key_file == Path("/secrets/deployer.key")
