#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE = ROOT / "contract-bundle.json"

RECIPES: dict[str, dict[str, bool]] = {
    "core": {
        "deploy_helper": True,
        "seed_demo_pool": False,
        "top_up_liquidity": False,
        "emit_test_swap": False,
    },
    "local-demo": {
        "deploy_helper": True,
        "seed_demo_pool": True,
        "top_up_liquidity": False,
        "emit_test_swap": False,
    },
    "production": {
        "deploy_helper": True,
        "seed_demo_pool": False,
        "top_up_liquidity": False,
        "emit_test_swap": False,
    },
}


def _env_str(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value is not None and value.strip():
            return value.strip()
    return default


def _resolve_stack_dir(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)

    env_value = _env_str("XIAN_STACK_DIR")
    if env_value is not None:
        candidates.append(Path(env_value))

    candidates.append(ROOT.parent / "xian-stack")

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if (resolved / "scripts" / "backend.py").exists():
            return resolved

    raise FileNotFoundError(
        "unable to resolve xian-stack; pass --stack-dir or set XIAN_STACK_DIR"
    )


def _bool_arg(name: str, value: bool) -> str:
    return f"--{name}" if value else f"--no-{name}"


def _build_command(args: argparse.Namespace, stack_dir: Path) -> list[str]:
    recipe = RECIPES[args.recipe]
    command = [
        "uv",
        "run",
        "--project",
        str(stack_dir),
        "python",
        str(stack_dir / "scripts" / "backend.py"),
        "localnet-dex-bootstrap",
        _bool_arg("deploy-helper", recipe["deploy_helper"]),
        _bool_arg("seed-demo-pool", recipe["seed_demo_pool"]),
        _bool_arg("top-up-liquidity", recipe["top_up_liquidity"] or args.top_up_liquidity),
        _bool_arg("emit-test-swap", recipe["emit_test_swap"] or args.emit_test_swap),
        "--chi-budget-mode",
        args.chi_budget_mode,
    ]
    if args.dex_contracts_dir is not None:
        command.extend(
            ["--dex-contracts-dir", str(args.dex_contracts_dir.expanduser().resolve())]
        )
    else:
        command.extend(["--dex-bundle", str(args.dex_bundle.expanduser().resolve())])
    if args.rpc_url is not None:
        command.extend(["--rpc-url", args.rpc_url])
    if args.chain_id is not None:
        command.extend(["--chain-id", args.chain_id])
    if args.deployer_private_key is not None:
        command.extend(["--deployer-private-key", args.deployer_private_key])
    return command


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Deploy the Xian DEX contract bundle to a running network."
    )
    parser.add_argument("--recipe", choices=sorted(RECIPES), default="core")
    parser.add_argument("--stack-dir", type=Path)
    parser.add_argument(
        "--dex-bundle",
        type=Path,
        default=Path(
            _env_str(
                "XIAN_DEX_BUNDLE",
                "XIAN_CONTRACT_PACK_BUNDLE",
                default=str(DEFAULT_BUNDLE),
            )
        ),
    )
    contracts_dir = _env_str("XIAN_DEX_CONTRACTS_DIR")
    parser.add_argument(
        "--dex-contracts-dir",
        type=Path,
        default=Path(contracts_dir) if contracts_dir is not None else None,
        help="development override for raw DEX contract sources",
    )
    parser.add_argument(
        "--rpc-url",
        default=_env_str(
            "XIAN_DEX_BOOTSTRAP_RPC_URL",
            "XIAN_NODE_URL",
            default="http://127.0.0.1:26657",
        ),
    )
    parser.add_argument(
        "--chain-id",
        default=_env_str("XIAN_DEX_BOOTSTRAP_CHAIN_ID", "XIAN_CHAIN_ID"),
    )
    parser.add_argument(
        "--deployer-private-key",
        default=_env_str("XIAN_DEX_DEPLOYER_PRIVATE_KEY", "XIAN_WALLET_PRIVATE_KEY"),
    )
    parser.add_argument(
        "--top-up-liquidity",
        action="store_true",
        help="add liquidity to an existing local demo pool",
    )
    parser.add_argument(
        "--emit-test-swap",
        action="store_true",
        help="emit a small local demo swap after installation",
    )
    parser.add_argument(
        "--chi-budget-mode",
        choices=("auto", "fixed"),
        default="auto",
        help=(
            "use xian-py simulation-based chi estimation (default), or the "
            "bundle/bootstrap fixed budgets"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the resolved stack command without submitting transactions",
    )
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    stack_dir = _resolve_stack_dir(args.stack_dir)
    command = _build_command(args, stack_dir)
    payload: dict[str, Any] = {
        "product": "dex",
        "recipe": args.recipe,
        "stack_dir": str(stack_dir),
        "chi_budget_mode": args.chi_budget_mode,
        "command": command,
    }
    if args.dex_contracts_dir is not None:
        payload["dex_contracts_dir"] = str(args.dex_contracts_dir.expanduser().resolve())
    else:
        payload["dex_bundle"] = str(args.dex_bundle.expanduser().resolve())
    if args.dry_run:
        payload["dry_run"] = True
        print(json.dumps(payload, indent=2, sort_keys=True))
        return

    result = subprocess.run(
        command,
        cwd=stack_dir,
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        stack_payload = json.loads(result.stdout) if result.stdout.strip() else {}
    except json.JSONDecodeError:
        stack_payload = {"stdout": result.stdout}
    if result.stderr:
        stack_payload["stderr"] = result.stderr
    stack_payload.update(payload)
    print(json.dumps(stack_payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
