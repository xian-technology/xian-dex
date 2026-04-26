from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from contracting.compilation.compiler import ContractingCompiler
from xian_linter import lint_code_inline

ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = ROOT / "src"
BUNDLE_PATH = ROOT / "contract-bundle.json"


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def validate_contract_source(path: Path) -> None:
    code = path.read_text()
    errors = lint_code_inline(code)
    if errors:
        print(path.relative_to(ROOT))
        for error in errors:
            pos = error.position
            print(
                f"  {error.code} {pos.line if pos else '?'}:{pos.col if pos else '?'} "
                f"{error.message}"
            )
        raise SystemExit(1)

    compiler = ContractingCompiler(module_name=path.stem)
    compiler.parse_to_code(code)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_bundle_manifest() -> None:
    if not BUNDLE_PATH.exists():
        fail("contract-bundle.json not found")

    payload = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    if payload.get("schema") != "xian.contract_bundle.v1":
        fail("contract-bundle.json has unsupported schema")
    if payload.get("schema_version") != 1:
        fail("contract-bundle.json schema_version must be 1")

    contracts = payload.get("contracts")
    if (
        not isinstance(contracts, list)
        or not contracts
        or any(not isinstance(item, dict) for item in contracts)
    ):
        fail("contract-bundle.json contracts must be a non-empty list")

    names: set[str] = set()
    for contract in contracts:
        name = contract.get("name")
        rel_path = contract.get("path")
        expected_sha256 = contract.get("sha256")
        if not isinstance(name, str) or not name:
            fail("contract-bundle.json contract name must be a non-empty string")
        if name in names:
            fail(f"contract-bundle.json has duplicate contract name: {name}")
        names.add(name)
        if not isinstance(rel_path, str) or not rel_path:
            fail(f"{name} path must be a non-empty string")
        path = (ROOT / rel_path).resolve()
        try:
            path.relative_to(ROOT)
        except ValueError:
            fail(f"{name} path escapes repository: {rel_path}")
        if not path.exists():
            fail(f"{name} bundle source does not exist: {rel_path}")
        if not isinstance(expected_sha256, str) or len(expected_sha256) != 64:
            fail(f"{name} sha256 must be a 64-character string")
        actual_sha256 = sha256_file(path)
        if actual_sha256 != expected_sha256:
            fail(
                f"{name} sha256 mismatch: expected {expected_sha256}, "
                f"got {actual_sha256}"
            )


def main() -> None:
    if not SRC_ROOT.exists():
        fail("src/ directory not found")

    contract_files = sorted(SRC_ROOT.glob("con_*.py"))
    if not contract_files:
        fail("src/ contains no con_*.py contract files")

    for path in contract_files:
        validate_contract_source(path)

    print(f"Validated {len(contract_files)} DEX contract source files.")
    validate_bundle_manifest()
    print("Validated contract-bundle.json.")


if __name__ == "__main__":
    main()
