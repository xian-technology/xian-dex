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


def test_core_recipe_forwards_default_auto_chi_budget() -> None:
    args = bootstrap._build_parser().parse_args(["--recipe", "core"])
    command = bootstrap._build_command(args, Path("/workspace/xian-stack"))

    mode_index = command.index("--chi-budget-mode")
    assert command[mode_index + 1] == "auto"
    assert "--deploy-helper" in command
    assert "--no-seed-demo-pool" in command

def test_local_demo_recipe_forwards_fixed_chi_budget_opt_in() -> None:
    args = bootstrap._build_parser().parse_args(
        ["--recipe", "local-demo", "--chi-budget-mode", "fixed"]
    )
    command = bootstrap._build_command(args, Path("/workspace/xian-stack"))

    mode_index = command.index("--chi-budget-mode")
    assert command[mode_index + 1] == "fixed"
    assert "--deploy-helper" in command
    assert "--seed-demo-pool" in command


def test_dry_run_summary_reports_chi_budget_mode(monkeypatch, capsys) -> None:
    stack_dir = Path(__file__).resolve().parents[2] / "xian-stack"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "bootstrap_dex.py",
            "--stack-dir",
            str(stack_dir),
            "--chi-budget-mode",
            "fixed",
            "--dry-run",
        ],
    )

    bootstrap.main()

    assert json.loads(capsys.readouterr().out)["chi_budget_mode"] == "fixed"
