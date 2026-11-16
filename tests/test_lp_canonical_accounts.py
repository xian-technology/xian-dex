from pathlib import Path

import pytest
from contracting.local import ContractingClient

SOURCE = (Path(__file__).resolve().parents[1] / "src" / "con_lp_token.py").read_text()
LOWER = "ab" * 32


@pytest.fixture
def token(tmp_path):
    client = ContractingClient(storage_home=tmp_path)
    client.submit(SOURCE, name="con_lp", constructor_args={"minter_address": "sys"})
    token = client.get_contract_proxy("con_lp")
    token.mint(amount=20, to="alice", signer="sys")
    token.approve(amount=20, to="bob", signer="alice")
    return token


@pytest.mark.parametrize("target", [LOWER.upper(), "aB" * 32])
@pytest.mark.parametrize("operation", ["transfer", "transfer_from", "mint", "approve"])
def test_lp_token_rejects_noncanonical_recipient_atomically(token, operation, target):
    arguments = {"amount": 5, "to": target}
    signer = "alice"
    if operation == "mint":
        signer = "sys"
    elif operation == "transfer_from":
        arguments["main_account"] = "alice"
        signer = "bob"

    with pytest.raises(AssertionError, match="canonical lowercase"):
        getattr(token, operation)(**arguments, signer=signer)

    assert token.balance_of(address="alice") == 20
    assert token.balance_of(address=target) == 0
    assert token.get_metadata()["total_supply"] == 20
    assert token.allowance(owner="alice", spender="bob") == 20


@pytest.mark.parametrize("target", [LOWER, "con_pairs", "G" * 64])
def test_lp_token_preserves_lowercase_keys_and_named_destinations(token, target):
    token.transfer(amount=5, to=target, signer="alice")
    assert token.balance_of(address=target) == 5


@pytest.mark.parametrize("field", ["operator_address", "minter_address"])
def test_lp_constructor_rejects_noncanonical_authority(tmp_path, field):
    client = ContractingClient(storage_home=tmp_path)
    with pytest.raises(AssertionError, match="canonical lowercase"):
        client.submit(SOURCE, name="con_lp", constructor_args={field: LOWER.upper()})
