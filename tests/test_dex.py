import os
import tempfile
import unittest
from pathlib import Path

from contracting.local import ContractingClient
from xian_runtime_types.decimal import ContractingDecimal
from xian_runtime_types.time import Datetime

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = Path(
    os.environ.get("XIAN_WORKSPACE_ROOT", ROOT.parent)
).expanduser()
XIAN_CONTRACTS_ROOT = Path(
    os.environ.get(
        "XIAN_CONTRACTS_ROOT",
        WORKSPACE_ROOT / "xian-contracts" / "contracts",
    )
).expanduser()
DEX_PAIRS_PATH = ROOT / "src" / "con_pairs.py"
DEX_ROUTER_PATH = ROOT / "src" / "con_dex.py"
LP_TOKEN_PATH = ROOT / "src" / "con_lp_token.py"
XSC001_PATH = XIAN_CONTRACTS_ROOT / "xsc001" / "src" / "con_xsc001.py"
SHIELDED_NOTE_TOKEN_PATH = (
    XIAN_CONTRACTS_ROOT
    / "shielded-note-token"
    / "src"
    / "con_shielded_note_token.py"
)

PLAIN_TOKEN = """
balances = Hash(default_value=0)
approved = Hash(default_value=0)

@construct
def seed():
    balances[ctx.caller] = 100000000

@export
def transfer(amount: float, to: str):
    assert amount > 0
    assert balances[ctx.caller] >= amount
    balances[ctx.caller] -= amount
    balances[to] += amount

@export
def approve(amount: float, to: str):
    assert amount >= 0
    approved[ctx.caller, to] = amount

@export
def transfer_from(amount: float, to: str, main_account: str):
    assert amount > 0
    assert approved[main_account, ctx.caller] >= amount
    assert balances[main_account] >= amount
    approved[main_account, ctx.caller] -= amount
    balances[main_account] -= amount
    balances[to] += amount

@export
def balance_of(address: str):
    return balances[address]
"""

TAXED_TOKEN = """
balances = Hash(default_value=0)
approved = Hash(default_value=0)

FEE_RATE = 0.05

@construct
def seed():
    balances[ctx.caller] = 100000000

def apply_transfer(amount: float, src: str, to: str):
    assert amount > 0
    assert balances[src] >= amount
    fee = amount * FEE_RATE
    received = amount - fee
    balances[src] -= amount
    balances[to] += received
    return received

@export
def transfer(amount: float, to: str):
    return apply_transfer(amount, ctx.caller, to)

@export
def approve(amount: float, to: str):
    assert amount >= 0
    approved[ctx.caller, to] = amount

@export
def transfer_from(amount: float, to: str, main_account: str):
    assert approved[main_account, ctx.caller] >= amount
    approved[main_account, ctx.caller] -= amount
    return apply_transfer(amount, main_account, to)

@export
def balance_of(address: str):
    return balances[address]
"""

ZK_REGISTRY_STUB = """
@export
def get_vk_info(vk_id: str):
    return None
"""

MALICIOUS_LP_TOKEN = """
balances = Hash(default_value=0)
approvals = Hash(default_value=0)
metadata = Hash()

@construct
def seed():
    metadata["token_name"] = "Malicious LP"
    metadata["token_symbol"] = "MAL-LP"
    metadata["token_logo_url"] = ""
    metadata["token_logo_svg"] = ""
    metadata["token_website"] = ""
    metadata["precision"] = 8
    metadata["total_supply"] = 0

@export
def change_metadata(key: str, value: Any):
    metadata[key] = value

@export
def get_metadata():
    return {
        "token_name": metadata["token_name"],
        "token_symbol": metadata["token_symbol"],
        "token_logo_url": metadata["token_logo_url"],
        "token_logo_svg": metadata["token_logo_svg"],
        "token_website": metadata["token_website"],
        "precision": metadata["precision"],
        "total_supply": metadata["total_supply"],
    }

@export
def balance_of(address: str):
    if address == "con_pairs":
        return 100000000
    return balances[address]

@export
def transfer(amount: float, to: str):
    assert amount > 0
    assert balances[ctx.caller] >= amount
    balances[ctx.caller] -= amount
    balances[to] += amount

@export
def approve(amount: float, to: str):
    assert amount >= 0
    approvals[ctx.caller, to] = amount

@export
def transfer_from(amount: float, to: str, main_account: str):
    return True

@export
def mint(amount: float, to: str):
    assert amount > 0
    balances[to] += amount
    metadata["total_supply"] += amount

@export
def burn(amount: float):
    return True
"""


class TestDexRouter(unittest.TestCase):
    def setUp(self):
        self._storage_home = tempfile.TemporaryDirectory()
        self.client = ContractingClient(
            storage_home=Path(self._storage_home.name)
        )
        self.client.flush()

        with DEX_PAIRS_PATH.open() as f:
            self.client.submit(f.read(), name="con_pairs")
        with DEX_ROUTER_PATH.open() as f:
            self.client.submit(f.read(), name="con_dex")

        self.client.submit(PLAIN_TOKEN, name="currency")
        self.client.submit(PLAIN_TOKEN, name="con_plain_mid")
        self.client.submit(PLAIN_TOKEN, name="con_plain_out")
        self.client.submit(TAXED_TOKEN, name="con_tax_token")

        self.pairs = self.client.get_contract_proxy("con_pairs")
        self.dex = self.client.get_contract_proxy("con_dex")
        self.currency = self.client.get_contract_proxy("currency")
        self.plain_mid = self.client.get_contract_proxy("con_plain_mid")
        self.plain_out = self.client.get_contract_proxy("con_plain_out")
        self.tax = self.client.get_contract_proxy("con_tax_token")

        self.operator = "sys"
        self.lp = "a" * 64
        self.trader = "b" * 64
        self.market_maker = "c" * 64
        self.now = Datetime(2026, 1, 1)
        self.deadline = Datetime(2026, 1, 2)
        self.lp_token_count = 0

        for account in (self.lp, self.trader, self.market_maker):
            self.currency.transfer(
                amount=5000, to=account, signer=self.operator
            )
            self.plain_mid.transfer(
                amount=5000, to=account, signer=self.operator
            )
            self.plain_out.transfer(
                amount=5000, to=account, signer=self.operator
            )
            self.tax.transfer(amount=5000, to=account, signer=self.operator)
            self.currency.approve(amount=5000, to="con_dex", signer=account)
            self.plain_mid.approve(amount=5000, to="con_dex", signer=account)
            self.plain_out.approve(amount=5000, to="con_dex", signer=account)
            self.tax.approve(amount=5000, to="con_dex", signer=account)

    def tearDown(self):
        try:
            self.client.flush()
        finally:
            self.client.raw_driver._store.close()
            self._storage_home.cleanup()

    def assertAmountEqual(self, actual, expected):
        actual_value = ContractingDecimal(str(actual))
        expected_value = ContractingDecimal(str(expected))
        difference = actual_value - expected_value
        if difference < 0:
            difference = -difference
        self.assertLessEqual(difference, ContractingDecimal("0.00001"))

    def reserve_product(self, pair):
        reserve0, reserve1, _ = self.pairs.getReserves(
            pair=pair,
            signer=self.operator,
        )
        return ContractingDecimal(str(reserve0)) * ContractingDecimal(
            str(reserve1)
        )

    def submit_lp_token(
        self,
        name=None,
        token_name="Currency / Tax LP",
        token_symbol="CUR-TAX-LP",
    ):
        if name is None:
            self.lp_token_count += 1
            name = f"con_lp_test_{self.lp_token_count}"
        with LP_TOKEN_PATH.open() as f:
            self.client.submit(
                f.read(),
                name=name,
                constructor_args={
                    "token_name": token_name,
                    "token_symbol": token_symbol,
                    "operator_address": self.operator,
                    "minter_address": "con_pairs",
                },
                signer=self.operator,
        )
        return self.client.get_contract_proxy(name)

    def submit_malicious_lp_token(self, name="con_lp_malicious"):
        self.client.submit(
            MALICIOUS_LP_TOKEN,
            name=name,
            signer=self.operator,
        )
        return self.client.get_contract_proxy(name)

    def create_pair(self, tokenA, tokenB, lp_token_name=None):
        if lp_token_name is None:
            self.lp_token_count += 1
            lp_token_name = f"con_lp_pair_{self.lp_token_count}"
        lp_token = self.submit_lp_token(name=lp_token_name)
        token0, token1 = sorted((tokenA, tokenB))
        self.pairs.registerLpToken(
            tokenA=token0,
            tokenB=token1,
            lpToken=lp_token_name,
            signer=self.operator,
        )
        pair = self.pairs.createPair(
            tokenA=token0,
            tokenB=token1,
            signer=self.operator,
        )
        return pair, lp_token, lp_token_name

    def bootstrap_pair(self):
        pair_id, lp_token, _ = self.create_pair(
            "con_tax_token",
            "currency",
            "con_lp_currency_tax",
        )
        return lp_token, pair_id

    def bootstrap_shielded_public_tokens(self):
        self.client.submit(ZK_REGISTRY_STUB, name="zk_registry")
        with SHIELDED_NOTE_TOKEN_PATH.open() as f:
            shielded_source = f.read()

        self.client.submit(
            shielded_source,
            name="con_private_a",
            constructor_args={
                "token_name": "Private A",
                "token_symbol": "PRA",
                "operator_address": self.operator,
            },
            signer=self.operator,
        )
        self.client.submit(
            shielded_source,
            name="con_private_b",
            constructor_args={
                "token_name": "Private B",
                "token_symbol": "PRB",
                "operator_address": self.operator,
            },
            signer=self.operator,
        )

        self.private_a = self.client.get_contract_proxy("con_private_a")
        self.private_b = self.client.get_contract_proxy("con_private_b")

        for account in (self.lp, self.trader, self.market_maker):
            self.private_a.mint_public(
                amount=5000, to=account, signer=self.operator
            )
            self.private_b.mint_public(
                amount=5000, to=account, signer=self.operator
            )
            self.private_a.approve(amount=5000, to="con_dex", signer=account)
            self.private_b.approve(amount=5000, to="con_dex", signer=account)

        _, lp_token, _ = self.create_pair(
            "con_private_a",
            "con_private_b",
        )
        pair_id = self.pairs.pairFor(
            tokenA="con_private_a",
            tokenB="con_private_b",
            signer=self.operator,
        )
        return lp_token, pair_id

    @unittest.skipUnless(
        XSC001_PATH.exists(),
        f"missing sibling xian-contracts XSC001 fixture: {XSC001_PATH}",
    )
    def test_bound_lp_token_is_xsc001_and_receives_minted_liquidity(self):
        with XSC001_PATH.open() as f:
            self.client.submit(f.read(), name="con_xsc001")
        lp_token, pair_id = self.bootstrap_pair()

        self.assertTrue(
            self.client.get_contract_proxy("con_xsc001").is_XSC001(
                contract="con_lp_currency_tax",
                signer=self.operator,
            )
        )
        self.assertEqual(
            self.pairs.lpTokenFor(pair=pair_id, signer=self.operator),
            "con_lp_currency_tax",
        )

        added = self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        liquidity = added[2]

        self.assertAmountEqual(
            lp_token.balance_of(address=self.lp, signer=self.operator),
            liquidity,
        )

        pair_supply = self.client.get_var(
            "con_pairs", "pairs", [pair_id, "totalSupply"]
        )
        metadata = lp_token.get_metadata(signer=self.operator)
        self.assertAmountEqual(metadata["total_supply"], pair_supply)

    def test_add_liquidity_can_auto_create_pair_with_standard_lp_token(self):
        lp_token = self.submit_lp_token(
            name="con_lp_auto",
            token_name="Auto LP",
            token_symbol="AUTO-LP",
        )
        self.pairs.registerLpToken(
            tokenA="currency",
            tokenB="con_tax_token",
            lpToken="con_lp_auto",
            signer=self.operator,
        )

        added = self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        pair_id = self.pairs.pairFor(
            tokenA="currency",
            tokenB="con_tax_token",
            signer=self.operator,
        )

        self.assertEqual(
            self.pairs.lpTokenFor(pair=pair_id, signer=self.operator),
            "con_lp_auto",
        )
        self.assertAmountEqual(
            lp_token.balance_of(address=self.lp, signer=self.operator),
            added[2],
        )

    def test_add_liquidity_requires_registered_lp_token_for_new_pair(self):
        self.submit_lp_token(name="con_lp_unregistered")
        with self.assertRaisesRegex(
            AssertionError, "SNAKX: LP_TOKEN_NOT_REGISTERED"
        ):
            self.dex.addLiquidity(
                tokenA="currency",
                tokenB="con_plain_mid",
                amountADesired=1000,
                amountBDesired=1000,
                amountAMin=1000,
                amountBMin=1000,
                to=self.lp,
                deadline=self.deadline,
                lpToken="con_lp_unregistered",
                signer=self.lp,
                environment={"now": self.now},
            )

    def test_register_lp_token_is_owner_only(self):
        self.submit_lp_token(name="con_lp_owner_only")

        with self.assertRaisesRegex(AssertionError, "SNAKX: FORBIDDEN"):
            self.pairs.registerLpToken(
                tokenA="currency",
                tokenB="con_tax_token",
                lpToken="con_lp_owner_only",
                signer=self.trader,
            )

        self.assertIsNone(
            self.pairs.registeredLpTokenFor(
                tokenA="currency",
                tokenB="con_tax_token",
                signer=self.operator,
            )
        )

    def test_create_pair_rejects_unregistered_malicious_lp_token(self):
        self.submit_malicious_lp_token()

        with self.assertRaisesRegex(
            AssertionError, "SNAKX: LP_TOKEN_NOT_REGISTERED"
        ):
            self.pairs.createPair(
                tokenA="con_tax_token",
                tokenB="currency",
                lpToken="con_lp_malicious",
                signer=self.trader,
            )

        self.assertIsNone(
            self.pairs.pairFor(
                tokenA="currency",
                tokenB="con_tax_token",
                signer=self.operator,
            )
        )

    def test_create_pair_rejects_malicious_lp_after_canonical_registration(self):
        self.submit_lp_token(name="con_lp_canonical")
        self.submit_malicious_lp_token()
        self.pairs.registerLpToken(
            tokenA="currency",
            tokenB="con_tax_token",
            lpToken="con_lp_canonical",
            signer=self.operator,
        )

        with self.assertRaisesRegex(AssertionError, "SNAKX: LP_TOKEN_MISMATCH"):
            self.pairs.createPair(
                tokenA="con_tax_token",
                tokenB="currency",
                lpToken="con_lp_malicious",
                signer=self.trader,
            )

        pair_id = self.pairs.createPair(
            tokenA="con_tax_token",
            tokenB="currency",
            signer=self.trader,
        )
        self.assertEqual(
            self.pairs.lpTokenFor(pair=pair_id, signer=self.operator),
            "con_lp_canonical",
        )

    def test_standard_lp_transfer_and_remove_liquidity_use_token_allowance(
        self,
    ):
        lp_token, pair_id = self.bootstrap_pair()
        added = self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        moved = added[2] / 2

        lp_token.transfer(amount=moved, to=self.trader, signer=self.lp)
        self.assertAmountEqual(
            lp_token.balance_of(address=self.trader, signer=self.operator),
            moved,
        )

        with self.assertRaises(AssertionError):
            self.dex.removeLiquidity(
                tokenA="currency",
                tokenB="con_tax_token",
                liquidity=moved,
                amountAMin=1,
                amountBMin=1,
                to=self.trader,
                deadline=self.deadline,
                signer=self.trader,
                environment={"now": self.now},
            )

        lp_token.approve(amount=moved, to="con_dex", signer=self.trader)
        currency_before = self.currency.balance_of(
            address=self.trader, signer=self.operator
        )
        tax_before = self.tax.balance_of(
            address=self.trader, signer=self.operator
        )

        removed = self.dex.removeLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            liquidity=moved,
            amountAMin=1,
            amountBMin=1,
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        self.assertAmountEqual(
            lp_token.balance_of(address=self.trader, signer=self.operator),
            0,
        )
        self.assertAmountEqual(
            lp_token.allowance(
                owner=self.trader,
                spender="con_dex",
                signer=self.operator,
            ),
            0,
        )
        self.assertAmountEqual(
            self.currency.balance_of(address=self.trader, signer=self.operator)
            - currency_before,
            removed[0],
        )
        self.assertAmountEqual(
            self.tax.balance_of(address=self.trader, signer=self.operator)
            - tax_before,
            removed[1],
        )
        self.assertGreater(removed[0], ContractingDecimal("0"))
        self.assertGreater(removed[1], ContractingDecimal("0"))

        self.assertAmountEqual(
            lp_token.balance_of(address="con_pairs", signer=self.operator),
            0,
        )
        self.assertEqual(
            self.pairs.lpTokenFor(pair=pair_id, signer=self.operator),
            "con_lp_currency_tax",
        )

    def test_add_liquidity_uses_caller_order_and_actual_received_amounts(self):
        lp_token, pair_id = self.bootstrap_pair()

        with self.assertRaises(AssertionError):
            self.dex.addLiquidity(
                tokenA="currency",
                tokenB="con_tax_token",
                amountADesired=1000,
                amountBDesired=1000,
                amountAMin=1000,
                amountBMin=990,
                to=self.lp,
                deadline=self.deadline,
                signer=self.lp,
                environment={"now": self.now},
            )

        added = self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.assertAmountEqual(added[0], "1000")
        self.assertAmountEqual(added[1], "950")

        reserves = self.pairs.getReserves(pair=pair_id, signer=self.operator)
        self.assertAmountEqual(reserves[0], "950")
        self.assertAmountEqual(reserves[1], "1000")

    def test_remove_liquidity_uses_actual_received_amounts(self):
        lp_token, pair_id = self.bootstrap_pair()
        added = self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        liquidity = added[2]
        lp_token.approve(amount=liquidity, to="con_dex", signer=self.lp)

        with self.assertRaises(AssertionError):
            self.dex.removeLiquidity(
                tokenA="currency",
                tokenB="con_tax_token",
                liquidity=liquidity,
                amountAMin=1,
                amountBMin=940,
                to=self.lp,
                deadline=self.deadline,
                signer=self.lp,
                environment={"now": self.now},
            )

        lp_token.approve(amount=liquidity, to="con_dex", signer=self.lp)

        currency_before = self.currency.balance_of(
            address=self.lp, signer=self.operator
        )
        tax_before = self.tax.balance_of(address=self.lp, signer=self.operator)
        removed = self.dex.removeLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            liquidity=liquidity,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        currency_delta = (
            self.currency.balance_of(address=self.lp, signer=self.operator)
            - currency_before
        )
        tax_delta = (
            self.tax.balance_of(address=self.lp, signer=self.operator)
            - tax_before
        )
        self.assertAmountEqual(removed[0], currency_delta)
        self.assertAmountEqual(removed[1], tax_delta)
        self.assertGreater(removed[0], ContractingDecimal("0"))
        self.assertGreater(removed[1], ContractingDecimal("0"))

    def test_single_path_supporting_fee_swap_returns_output_amount(self):
        _, pair_id = self.bootstrap_pair()
        self.dex.addLiquidity(
            tokenA="con_tax_token",
            tokenB="currency",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        tax_before = self.tax.balance_of(
            address=self.trader, signer=self.operator
        )
        output = self.dex.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn=100,
            amountOutMin=1,
            path=[pair_id],
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        self.assertIsNotNone(output)
        self.assertGreater(output, ContractingDecimal("0"))
        self.assertAmountEqual(
            self.tax.balance_of(address=self.trader, signer=self.operator)
            - tax_before,
            output,
        )

    def test_unsolicited_token_transfer_is_not_credited_to_pair(self):
        _, pair_id = self.bootstrap_pair()
        self.currency.transfer(amount=200, to="con_pairs", signer=self.operator)

        added = self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=100,
            amountBDesired=100,
            amountAMin=90,
            amountBMin=90,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.assertAmountEqual(added[0], "100")
        self.assertAmountEqual(added[1], "95")
        reserves = self.pairs.getReserves(pair=pair_id, signer=self.operator)
        self.assertAmountEqual(reserves[0], "95")
        self.assertAmountEqual(reserves[1], "100")

    def test_sync2_is_router_only(self):
        _, pair_id = self.bootstrap_pair()
        with self.assertRaises(AssertionError):
            self.pairs.sync2(
                pair=pair_id, amount0=1, amount1=0, signer=self.operator
            )

    def test_multi_hop_path_validation_and_execution(self):
        pair_ab, _, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        pair_bc, _, _ = self.create_pair(
            "con_plain_mid",
            "con_plain_out",
        )
        disconnected, _, _ = self.create_pair(
            "con_plain_out",
            "con_tax_token",
        )

        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        self.dex.addLiquidity(
            tokenA="con_plain_mid",
            tokenB="con_plain_out",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        quoted = self.dex.getAmountsOut(
            amountIn=100,
            src="currency",
            path=[pair_ab, pair_bc],
            signer=self.trader,
        )
        self.assertEqual(len(quoted), 3)
        self.assertGreater(quoted[-1], ContractingDecimal("0"))

        out_before = self.plain_out.balance_of(
            address=self.trader, signer=self.operator
        )
        output = self.dex.swapExactTokensForTokens(
            amountIn=100,
            amountOutMin=1,
            path=[pair_ab, pair_bc],
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        self.assertAmountEqual(
            self.plain_out.balance_of(address=self.trader, signer=self.operator)
            - out_before,
            output,
        )

        with self.assertRaises(AssertionError):
            self.dex.getAmountsOut(
                amountIn=100,
                src="currency",
                path=[pair_ab, disconnected],
                signer=self.trader,
            )

    def test_protocol_fee_mints_liquidity_to_owner(self):
        pair, lp_token, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        owner_lp_before = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )

        self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=pair,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=100,
            amountBDesired=100,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        owner_lp_after = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )
        self.assertGreater(owner_lp_after, owner_lp_before)

    def test_protocol_fee_can_be_disabled_without_owner_liquidity_mint(self):
        pair, lp_token, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.pairs.enableFee(en=False, signer=self.operator)
        owner_lp_before = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )

        self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=pair,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=100,
            amountBDesired=100,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        owner_lp_after = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )
        self.assertEqual(owner_lp_after, owner_lp_before)
        self.assertEqual(
            self.client.get_var("con_pairs", "pairs", [pair, "kLast"]),
            0,
        )

    def test_protocol_fee_reenable_discards_fee_off_growth(self):
        pair, lp_token, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.pairs.enableFee(en=False, signer=self.operator)
        self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=pair,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        self.pairs.enableFee(en=True, signer=self.operator)

        owner_lp_before = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=100,
            amountBDesired=100,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        owner_lp_after_reenable = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )
        self.assertEqual(owner_lp_after_reenable, owner_lp_before)

        self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=pair,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=100,
            amountBDesired=100,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        owner_lp_after_fee_on_growth = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )
        self.assertGreater(owner_lp_after_fee_on_growth, owner_lp_after_reenable)

    def test_idempotent_fee_enable_preserves_accrued_protocol_fees(self):
        pair, lp_token, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=pair,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        # Reapplying the current setting is not a toggle and must not reset the
        # pair baseline that captures fee-on growth.
        self.pairs.enableFee(en=True, signer=self.operator)
        owner_lp_before = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=100,
            amountBDesired=100,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        owner_lp_after = lp_token.balance_of(
            address="sys",
            signer=self.operator,
        )

        self.assertGreater(owner_lp_after, owner_lp_before)

    def test_swap_sequence_preserves_constant_product_invariant(self):
        pair, _, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=2000,
            amountBDesired=2000,
            amountAMin=2000,
            amountBMin=2000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        previous_product = self.reserve_product(pair)
        for src, amount in (
            ("currency", 100),
            ("con_plain_mid", 80),
            ("currency", 125),
            ("con_plain_mid", 55),
            ("currency", 210),
        ):
            self.dex.swapExactTokenForToken(
                amountIn=amount,
                amountOutMin=1,
                pair=pair,
                src=src,
                to=self.trader,
                deadline=self.deadline,
                signer=self.trader,
                environment={"now": self.now},
            )
            current_product = self.reserve_product(pair)
            self.assertGreaterEqual(
                current_product + ContractingDecimal("0.00001"),
                previous_product,
            )
            previous_product = current_product

    def test_large_multi_hop_route_enforces_slippage(self):
        self.client.submit(PLAIN_TOKEN, name="con_plain_tail")
        plain_tail = self.client.get_contract_proxy("con_plain_tail")
        for account in (self.lp, self.trader, self.market_maker):
            plain_tail.transfer(amount=5000, to=account, signer=self.operator)
            plain_tail.approve(amount=5000, to="con_dex", signer=account)

        pair_ab, _, _ = self.create_pair("con_plain_mid", "currency")
        pair_bc, _, _ = self.create_pair("con_plain_mid", "con_plain_out")
        pair_cd, _, _ = self.create_pair("con_plain_out", "con_plain_tail")

        for token_a, token_b in (
            ("currency", "con_plain_mid"),
            ("con_plain_mid", "con_plain_out"),
            ("con_plain_out", "con_plain_tail"),
        ):
            self.dex.addLiquidity(
                tokenA=token_a,
                tokenB=token_b,
                amountADesired=2500,
                amountBDesired=2500,
                amountAMin=2500,
                amountBMin=2500,
                to=self.lp,
                deadline=self.deadline,
                signer=self.lp,
                environment={"now": self.now},
            )

        path = [pair_ab, pair_bc, pair_cd]
        quoted = self.dex.getAmountsOut(
            amountIn=500,
            src="currency",
            path=path,
            signer=self.trader,
        )[-1]
        with self.assertRaises(AssertionError):
            self.dex.swapExactTokensForTokens(
                amountIn=500,
                amountOutMin=quoted + ContractingDecimal("0.00001"),
                path=path,
                src="currency",
                to=self.trader,
                deadline=self.deadline,
                signer=self.trader,
                environment={"now": self.now},
            )

        out_before = plain_tail.balance_of(
            address=self.trader,
            signer=self.operator,
        )
        output = self.dex.swapExactTokensForTokens(
            amountIn=500,
            amountOutMin=quoted,
            path=path,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        self.assertAmountEqual(
            plain_tail.balance_of(address=self.trader, signer=self.operator)
            - out_before,
            output,
        )

    def test_supporting_fee_multi_hop_rejects_fee_on_transfer_bridge_token(
        self,
    ):
        pair_ab, _, _ = self.create_pair(
            "con_tax_token",
            "currency",
        )
        pair_bc, _, _ = self.create_pair(
            "con_plain_out",
            "con_tax_token",
        )

        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        self.dex.addLiquidity(
            tokenA="con_plain_out",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.dex.set_fee_on_transfer_token(
            token="con_tax_token",
            enabled=True,
            signer=self.operator,
        )

        with self.assertRaises(AssertionError):
            self.dex.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountIn=100,
                amountOutMin=1,
                path=[pair_ab, pair_bc],
                src="currency",
                to=self.trader,
                deadline=self.deadline,
                signer=self.trader,
                environment={"now": self.now},
            )

    def test_plain_swap_rejects_flagged_fee_token(self):
        _, pair_id = self.bootstrap_pair()
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.dex.set_fee_on_transfer_token(
            token="con_tax_token",
            enabled=True,
            signer=self.operator,
        )

        with self.assertRaises(AssertionError):
            self.dex.swapExactTokenForToken(
                amountIn=100,
                amountOutMin=1,
                pair=pair_id,
                src="currency",
                to=self.trader,
                deadline=self.deadline,
                signer=self.trader,
                environment={"now": self.now},
            )

    def test_supporting_fee_multi_hop_allows_fee_token_as_final_output(self):
        pair_ab, _, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        pair_bc, _, _ = self.create_pair(
            "con_plain_mid",
            "con_tax_token",
        )

        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        self.dex.addLiquidity(
            tokenA="con_plain_mid",
            tokenB="con_tax_token",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=900,
            amountBMin=900,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.dex.set_fee_on_transfer_token(
            token="con_tax_token",
            enabled=True,
            signer=self.operator,
        )

        tax_before = self.tax.balance_of(
            address=self.trader, signer=self.operator
        )
        output = self.dex.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn=100,
            amountOutMin=1,
            path=[pair_ab, pair_bc],
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        self.assertGreater(output, ContractingDecimal("0"))
        self.assertAmountEqual(
            self.tax.balance_of(address=self.trader, signer=self.operator)
            - tax_before,
            output,
        )

    def test_set_fee_on_transfer_token_is_owner_only_and_toggleable(self):
        with self.assertRaises(AssertionError):
            self.dex.set_fee_on_transfer_token(
                token="con_tax_token",
                enabled=True,
                signer=self.trader,
            )

        self.dex.set_fee_on_transfer_token(
            token="con_tax_token",
            enabled=True,
            signer=self.operator,
        )
        self.assertTrue(
            self.client.get_var(
                "con_dex", "fee_on_transfer_tokens", ["con_tax_token"]
            )
        )

        self.dex.set_fee_on_transfer_token(
            token="con_tax_token",
            enabled=False,
            signer=self.operator,
        )
        self.assertFalse(
            self.client.get_var(
                "con_dex", "fee_on_transfer_tokens", ["con_tax_token"]
            )
        )

    def test_set_zero_fee_trader_is_owner_only_and_toggleable(self):
        self.assertEqual(
            self.dex.getTradeFeeBps(
                account=self.market_maker, signer=self.operator
            ),
            30,
        )

        with self.assertRaises(AssertionError):
            self.dex.set_zero_fee_trader(
                account=self.market_maker,
                enabled=True,
                signer=self.trader,
            )

        self.dex.set_zero_fee_trader(
            account=self.market_maker,
            enabled=True,
            signer=self.operator,
        )
        self.assertEqual(
            self.dex.getTradeFeeBps(
                account=self.market_maker, signer=self.operator
            ),
            0,
        )
        self.assertEqual(self.dex.getTradeFeeBps(signer=self.market_maker), 0)

        self.dex.set_zero_fee_trader(
            account=self.market_maker,
            enabled=False,
            signer=self.operator,
        )
        self.assertEqual(
            self.dex.getTradeFeeBps(
                account=self.market_maker, signer=self.operator
            ),
            30,
        )

    def test_zero_fee_trader_gets_better_quote_and_execution(self):
        standard_pair, _, _ = self.create_pair(
            "con_plain_mid",
            "currency",
        )
        zero_fee_pair, _, _ = self.create_pair(
            "con_plain_out",
            "currency",
        )

        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_mid",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_out",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        standard_quote = self.dex.getAmountsOut(
            amountIn=100,
            src="currency",
            path=[standard_pair],
            signer=self.trader,
        )[-1]

        self.dex.set_zero_fee_trader(
            account=self.market_maker,
            enabled=True,
            signer=self.operator,
        )
        zero_fee_quote = self.dex.getAmountsOut(
            amountIn=100,
            src="currency",
            path=[zero_fee_pair],
            signer=self.market_maker,
        )[-1]
        self.assertGreater(zero_fee_quote, standard_quote)

        standard_before = self.plain_mid.balance_of(
            address=self.trader, signer=self.operator
        )
        zero_fee_before = self.plain_out.balance_of(
            address=self.market_maker, signer=self.operator
        )

        standard_output = self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=standard_pair,
            src="currency",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        zero_fee_output = self.dex.swapExactTokenForToken(
            amountIn=100,
            amountOutMin=1,
            pair=zero_fee_pair,
            src="currency",
            to=self.market_maker,
            deadline=self.deadline,
            signer=self.market_maker,
            environment={"now": self.now},
        )

        self.assertGreater(zero_fee_output, standard_output)
        self.assertAmountEqual(
            self.plain_mid.balance_of(address=self.trader, signer=self.operator)
            - standard_before,
            standard_output,
        )
        self.assertAmountEqual(
            self.plain_out.balance_of(
                address=self.market_maker, signer=self.operator
            )
            - zero_fee_before,
            zero_fee_output,
        )

    @unittest.skipUnless(
        SHIELDED_NOTE_TOKEN_PATH.exists(),
        "missing sibling xian-contracts shielded note token fixture: "
        f"{SHIELDED_NOTE_TOKEN_PATH}",
    )
    def test_shielded_public_token_pair_supports_liquidity_swap_and_remove(
        self,
    ):
        lp_token, pair_id = self.bootstrap_shielded_public_tokens()

        added = self.dex.addLiquidity(
            tokenA="con_private_a",
            tokenB="con_private_b",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )
        self.assertEqual(added[0], 1000)
        self.assertEqual(added[1], 1000)

        quoted = self.dex.getAmountsOut(
            amountIn=101,
            src="con_private_a",
            path=[pair_id],
            signer=self.trader,
        )
        self.assertEqual(len(quoted), 2)
        self.assertEqual(int(quoted[-1]), quoted[-1])
        self.assertGreater(quoted[-1], 0)

        private_b_before = self.private_b.balance_of(
            address=self.trader,
            signer=self.operator,
        )
        output = self.dex.swapExactTokenForToken(
            amountIn=101,
            amountOutMin=1,
            pair=pair_id,
            src="con_private_a",
            to=self.trader,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )
        self.assertEqual(int(output), output)
        self.assertEqual(
            self.private_b.balance_of(address=self.trader, signer=self.operator)
            - private_b_before,
            output,
        )

        liquidity = added[2]
        lp_token.approve(amount=liquidity, to="con_dex", signer=self.lp)
        private_a_before = self.private_a.balance_of(
            address=self.lp,
            signer=self.operator,
        )
        private_b_before = self.private_b.balance_of(
            address=self.lp,
            signer=self.operator,
        )
        removed = self.dex.removeLiquidity(
            tokenA="con_private_a",
            tokenB="con_private_b",
            liquidity=liquidity / 2,
            amountAMin=1,
            amountBMin=1,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

        self.assertEqual(int(removed[0]), removed[0])
        self.assertEqual(int(removed[1]), removed[1])
        self.assertEqual(
            self.private_a.balance_of(address=self.lp, signer=self.operator)
            - private_a_before,
            removed[0],
        )
        self.assertEqual(
            self.private_b.balance_of(address=self.lp, signer=self.operator)
            - private_b_before,
            removed[1],
        )


if __name__ == "__main__":
    unittest.main()
