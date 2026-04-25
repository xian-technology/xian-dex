from __future__ import annotations

import sys
from pathlib import Path

from contracting.compilation.compiler import ContractingCompiler
from xian_linter import lint_code_inline

ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = ROOT / "src"


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


def main() -> None:
    if not SRC_ROOT.exists():
        fail("src/ directory not found")

    contract_files = sorted(SRC_ROOT.glob("con_*.py"))
    if not contract_files:
        fail("src/ contains no con_*.py contract files")

    for path in contract_files:
        validate_contract_source(path)

    print(f"Validated {len(contract_files)} DEX contract source files.")


if __name__ == "__main__":
    main()
