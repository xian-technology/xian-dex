from __future__ import annotations

import ast
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from contracting.compilation.compiler import ContractingCompiler
from xian_linter import lint_code_inline

ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = ROOT / "src"
BUNDLE_PATH = ROOT / "contract-bundle.json"
INTERFACE_PATH = ROOT / "dex-interface.json"


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


def _decorator_name(decorator: ast.expr) -> str | None:
    if isinstance(decorator, ast.Name):
        return decorator.id
    return None


def _source_default(node: ast.expr) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    return {"source": ast.unparse(node)}


def _source_functions(path: Path) -> list[dict[str, Any]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    functions: list[dict[str, Any]] = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef) or "export" not in {
            _decorator_name(decorator) for decorator in node.decorator_list
        }:
            continue
        args = node.args.posonlyargs + node.args.args
        required_count = len(args) - len(node.args.defaults)
        arguments = []
        for index, arg in enumerate(args):
            item: dict[str, Any] = {
                "name": arg.arg,
                "type": ast.unparse(arg.annotation) if arg.annotation else "Any",
                "required": index < required_count,
            }
            if index >= required_count:
                item["default"] = _source_default(
                    node.args.defaults[index - required_count]
                )
            arguments.append(item)
        functions.append({"name": node.name, "arguments": arguments})
    return functions


def _event_field_type(node: ast.expr) -> str:
    if isinstance(node, ast.Tuple):
        return "|".join(ast.unparse(item) for item in node.elts)
    return ast.unparse(node)


def _source_events(path: Path) -> list[dict[str, Any]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    events: list[dict[str, Any]] = []
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        value = node.value
        if not (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id == "LogEvent"
            and len(value.args) >= 2
            and isinstance(value.args[0], ast.Constant)
            and isinstance(value.args[1], ast.Dict)
        ):
            continue
        fields = []
        for key_node, field_node in zip(value.args[1].keys, value.args[1].values):
            if not isinstance(key_node, ast.Constant) or not isinstance(
                key_node.value, str
            ):
                fail(f"{path.name} has a LogEvent field with a non-string name")
            indexed = False
            type_node = field_node
            if isinstance(field_node, ast.Dict):
                field_values = {
                    key.value: val
                    for key, val in zip(field_node.keys, field_node.values)
                    if isinstance(key, ast.Constant) and isinstance(key.value, str)
                }
                type_node = field_values.get("type")
                if type_node is None:
                    fail(f"{path.name} event {value.args[0].value} field {key_node.value} has no type")
                idx_node = field_values.get("idx")
                if isinstance(idx_node, ast.Constant):
                    indexed = idx_node.value is True
            fields.append(
                {
                    "name": key_node.value,
                    "type": _event_field_type(type_node),
                    "indexed": indexed,
                }
            )
        events.append({"name": value.args[0].value, "fields": fields})
    return events


def _error_template(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value))
            elif isinstance(value, ast.FormattedValue):
                parts.append("{" + ast.unparse(value.value) + "}")
        return "".join(parts)
    return None


def _source_errors(path: Path) -> tuple[list[str], int]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    errors: set[str] = set()
    unlabeled_assertions = 0
    for node in ast.walk(tree):
        message: ast.expr | None = None
        if isinstance(node, ast.Assert):
            if node.msg is None:
                unlabeled_assertions += 1
            else:
                message = node.msg
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "locked_assert"
            and len(node.args) >= 2
        ):
            message = node.args[1]
        template = _error_template(message)
        if template is not None:
            errors.add(template)
    return sorted(errors), unlabeled_assertions


def _require_non_empty_string(value: Any, context: str) -> None:
    if not isinstance(value, str) or not value:
        fail(f"{context} must be a non-empty string")


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
            fail(
                "contract-bundle.json contract name must be a non-empty string"
            )
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


def validate_interface_manifest() -> None:
    if not INTERFACE_PATH.exists():
        fail("dex-interface.json not found")

    payload = json.loads(INTERFACE_PATH.read_text(encoding="utf-8"))
    if payload.get("schema") != "xian.dex_interface.v1":
        fail("dex-interface.json has unsupported schema")
    if payload.get("schema_version") != 1:
        fail("dex-interface.json schema_version must be 1")

    bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    bundle_ref = payload.get("bundle")
    if not isinstance(bundle_ref, dict):
        fail("dex-interface.json bundle must be an object")
    expected_bundle_ref = {
        "path": BUNDLE_PATH.name,
        "schema": bundle.get("schema"),
        "name": bundle.get("name"),
        "version": bundle.get("version"),
    }
    if bundle_ref != expected_bundle_ref:
        fail(
            "dex-interface.json bundle metadata drifted from contract-bundle.json: "
            f"expected {expected_bundle_ref}, got {bundle_ref}"
        )

    safety = payload.get("safety")
    if not isinstance(safety, dict) or not safety:
        fail("dex-interface.json safety must be a non-empty object")
    safety_policies = safety.get("policies")
    if not isinstance(safety_policies, dict) or not safety_policies:
        fail("dex-interface.json safety.policies must be a non-empty object")
    if any(
        not isinstance(policy_id, str)
        or not policy_id
        or not isinstance(description, str)
        or not description
        for policy_id, description in safety_policies.items()
    ):
        fail("dex-interface.json safety policies must have string ids and descriptions")
    examples = payload.get("examples")
    if not isinstance(examples, list) or not examples:
        fail("dex-interface.json examples must be a non-empty list")
    for index, example in enumerate(examples):
        if not isinstance(example, dict):
            fail(f"dex-interface.json example {index} must be an object")
        _require_non_empty_string(example.get("name"), f"example {index} name")
        steps = example.get("steps")
        if not isinstance(steps, list) or not steps:
            fail(f"dex-interface.json example {index} steps must be a non-empty list")

    interface_contracts = payload.get("contracts")
    if not isinstance(interface_contracts, list) or not interface_contracts:
        fail("dex-interface.json contracts must be a non-empty list")
    interface_by_name: dict[str, dict[str, Any]] = {}
    for contract in interface_contracts:
        if not isinstance(contract, dict):
            fail("dex-interface.json contracts entries must be objects")
        name = contract.get("name")
        _require_non_empty_string(name, "interface contract name")
        if name in interface_by_name:
            fail(f"dex-interface.json has duplicate contract name: {name}")
        interface_by_name[name] = contract

    bundle_by_name = {item["name"]: item for item in bundle["contracts"]}
    if set(interface_by_name) != set(bundle_by_name):
        fail(
            "dex-interface.json contract names drifted from contract-bundle.json: "
            f"expected {sorted(bundle_by_name)}, got {sorted(interface_by_name)}"
        )

    for name, bundle_contract in bundle_by_name.items():
        contract = interface_by_name[name]
        for key in ("role", "path"):
            if contract.get(key) != bundle_contract.get(key):
                fail(
                    f"{name} interface {key} drifted from contract-bundle.json: "
                    f"expected {bundle_contract.get(key)!r}, got {contract.get(key)!r}"
                )
        expected_deploy_default = bundle_contract.get("deploy_default", True)
        if contract.get("deploy_default") is not expected_deploy_default:
            fail(
                f"{name} interface deploy_default drifted from contract-bundle.json"
            )
        if contract.get("source_sha256") != bundle_contract.get("sha256"):
            fail(f"{name} interface source_sha256 drifted from contract-bundle.json")

        source_path = ROOT / bundle_contract["path"]
        actual_sha256 = sha256_file(source_path)
        if contract.get("source_sha256") != actual_sha256:
            fail(
                f"{name} interface source_sha256 drifted from "
                f"{source_path.relative_to(ROOT)}"
            )
        source_functions = _source_functions(source_path)
        functions = contract.get("functions")
        if not isinstance(functions, list):
            fail(f"{name} functions must be a list")
        function_signatures = []
        seen_functions: set[str] = set()
        for function in functions:
            if not isinstance(function, dict):
                fail(f"{name} function entries must be objects")
            function_name = function.get("name")
            _require_non_empty_string(function_name, f"{name} function name")
            if function_name in seen_functions:
                fail(f"{name} has duplicate function: {function_name}")
            seen_functions.add(function_name)
            if function.get("interaction") not in ("read", "write"):
                fail(f"{name}.{function_name} interaction must be read or write")
            _require_non_empty_string(
                function.get("returns"), f"{name}.{function_name} returns"
            )
            function_safety = function.get("safety", [])
            if not isinstance(function_safety, list) or any(
                not isinstance(item, str) or not item for item in function_safety
            ):
                fail(f"{name}.{function_name} safety must be a list of strings")
            unknown_policies = set(function_safety) - set(safety_policies)
            if unknown_policies:
                fail(
                    f"{name}.{function_name} references unknown safety policies: "
                    f"{sorted(unknown_policies)}"
                )
            function_signatures.append(
                {"name": function_name, "arguments": function.get("arguments")}
            )
        if function_signatures != source_functions:
            fail(
                f"{name} exported function signatures drifted from {source_path.relative_to(ROOT)}"
            )

        events = contract.get("events")
        if events != _source_events(source_path):
            fail(f"{name} event schemas drifted from {source_path.relative_to(ROOT)}")

        source_errors, unlabeled_assertions = _source_errors(source_path)
        errors = contract.get("errors")
        if not isinstance(errors, dict):
            fail(f"{name} errors must be an object")
        if errors.get("messages") != source_errors:
            fail(f"{name} error messages drifted from {source_path.relative_to(ROOT)}")
        if errors.get("unlabeled_assertions") != unlabeled_assertions:
            fail(
                f"{name} unlabeled assertion count drifted from "
                f"{source_path.relative_to(ROOT)}"
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
    validate_interface_manifest()
    print("Validated dex-interface.json.")


if __name__ == "__main__":
    main()
