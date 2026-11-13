from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "validate_contracts.py"
SPEC = importlib.util.spec_from_file_location("validate_contracts", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
validate_contracts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_contracts)


def test_interface_manifest_matches_bundle_and_contract_sources() -> None:
    validate_contracts.validate_bundle_manifest()
    validate_contracts.validate_interface_manifest()


def test_interface_manifest_rejects_export_drift(
    tmp_path, monkeypatch, capsys
) -> None:
    payload = json.loads(validate_contracts.INTERFACE_PATH.read_text(encoding="utf-8"))
    payload["contracts"][0]["functions"].pop()
    drifted_interface = tmp_path / "dex-interface.json"
    drifted_interface.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(validate_contracts, "INTERFACE_PATH", drifted_interface)

    with pytest.raises(SystemExit):
        validate_contracts.validate_interface_manifest()
    assert "exported function signatures drifted" in capsys.readouterr().err


# A paid-metered chain caps each transaction at 200,000 chi by default; a deploy
# budget above that is refused at CheckTx before the contract can run.
DEFAULT_MAX_TX_CHI = 200_000


def test_bundle_deploy_budgets_fit_the_default_chain_tx_cap():
    bundle = json.loads((Path(__file__).resolve().parents[1] / "contract-bundle.json").read_text())
    over_cap = {
        contract["name"]: contract["default_chi"]
        for contract in bundle["contracts"]
        if (contract.get("default_chi") or 0) > DEFAULT_MAX_TX_CHI
    }
    assert over_cap == {}
