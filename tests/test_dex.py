import unittest
from pathlib import Path

from contracting.client import ContractingClient
from xian_runtime_types.decimal import ContractingDecimal
from xian_runtime_types.time import Datetime

ROOT = Path(__file__).resolve().parents[1]
DEX_PAIRS_PATH = ROOT / "src" / "con_pairs.py"
DEX_ROUTER_PATH = ROOT / "src" / "con_dex.py"

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


class TestDexRouter(unittest.TestCase):
    def setUp(self):
        self.client = ContractingClient()
        self.client.flush()

        with DEX_PAIRS_PATH.open() as f:
            self.client.submit(f.read(), name="con_pairs")
        with DEX_ROUTER_PATH.open() as f:
            self.client.submit(f.read(), name="con_dex")

        self.client.submit(PLAIN_TOKEN, name="currency")
        self.client.submit(PLAIN_TOKEN, name="con_plain_mid")
        self.client.submit(PLAIN_TOKEN, name="con_plain_out")
        self.client.submit(TAXED_TOKEN, name="con_tax_token")

        self.pairs = self.client.get_contract("con_pairs")
        self.dex = self.client.get_contract("con_dex")
        self.currency = self.client.get_contract("currency")
        self.plain_mid = self.client.get_contract("con_plain_mid")
        self.plain_out = self.client.get_contract("con_plain_out")
        self.tax = self.client.get_contract("con_tax_token")

        self.operator = "sys"
        self.lp = "a" * 64
        self.trader = "b" * 64
        self.now = Datetime(2026, 1, 1)
        self.deadline = Datetime(2026, 1, 2)

        for account in (self.lp, self.trader):
            self.currency.transfer(amount=5000, to=account, signer=self.operator)
            self.plain_mid.transfer(amount=5000, to=account, signer=self.operator)
            self.plain_out.transfer(amount=5000, to=account, signer=self.operator)
            self.tax.transfer(amount=5000, to=account, signer=self.operator)
            self.currency.approve(amount=5000, to="con_dex", signer=account)
            self.plain_mid.approve(amount=5000, to="con_dex", signer=account)
            self.plain_out.approve(amount=5000, to="con_dex", signer=account)
            self.tax.approve(amount=5000, to="con_dex", signer=account)

    def tearDown(self):
        self.client.flush()

    def assertAmountEqual(self, actual, expected):
        actual_value = ContractingDecimal(str(actual))
        expected_value = ContractingDecimal(str(expected))
        difference = actual_value - expected_value
        if difference < 0:
            difference = -difference
        self.assertLessEqual(difference, ContractingDecimal("0.00001"))

    def bootstrap_pair(self):
        pair = self.pairs.createPair(
            tokenA="con_tax_token",
            tokenB="currency",
            signer=self.operator,
        )
        pair_id = self.pairs.pairFor(
            tokenA="con_tax_token",
            tokenB="currency",
            signer=self.operator,
        )
        return pair, pair_id

    def test_add_liquidity_uses_caller_order_and_actual_received_amounts(self):
        _, pair_id = self.bootstrap_pair()

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
        _, pair_id = self.bootstrap_pair()
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
        self.pairs.liqApprove(
            pair=pair_id,
            amount=liquidity,
            to="con_dex",
            signer=self.lp,
        )

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

        self.pairs.liqApprove(
            pair=pair_id,
            amount=liquidity,
            to="con_dex",
            signer=self.lp,
        )

        currency_before = self.currency.balance_of(address=self.lp, signer=self.operator)
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

        currency_delta = self.currency.balance_of(address=self.lp, signer=self.operator) - currency_before
        tax_delta = self.tax.balance_of(address=self.lp, signer=self.operator) - tax_before
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

        tax_before = self.tax.balance_of(address=self.trader, signer=self.operator)
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
            self.tax.balance_of(address=self.trader, signer=self.operator) - tax_before,
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
            self.pairs.sync2(pair=pair_id, amount0=1, amount1=0, signer=self.operator)

    def test_multi_hop_path_validation_and_execution(self):
        pair_ab = self.pairs.createPair(
            tokenA="con_plain_mid",
            tokenB="currency",
            signer=self.operator,
        )
        pair_bc = self.pairs.createPair(
            tokenA="con_plain_mid",
            tokenB="con_plain_out",
            signer=self.operator,
        )
        disconnected = self.pairs.createPair(
            tokenA="con_plain_out",
            tokenB="con_tax_token",
            signer=self.operator,
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

        out_before = self.plain_out.balance_of(address=self.trader, signer=self.operator)
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
            self.plain_out.balance_of(address=self.trader, signer=self.operator) - out_before,
            output,
        )

        with self.assertRaises(AssertionError):
            self.dex.getAmountsOut(
                amountIn=100,
                src="currency",
                path=[pair_ab, disconnected],
                signer=self.trader,
            )

    def test_liq_approve_can_clear_allowance(self):
        _, pair_id = self.bootstrap_pair()
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

        self.pairs.liqApprove(pair=pair_id, amount=liquidity, to="con_dex", signer=self.lp)
        self.pairs.liqApprove(pair=pair_id, amount=0, to="con_dex", signer=self.lp)

        with self.assertRaises(AssertionError):
            self.dex.removeLiquidity(
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

    def test_liq_transfer_moves_lp_balance_between_accounts(self):
        _, pair_id = self.bootstrap_pair()
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
        moved = liquidity / 2

        lp_before = self.client.get_var("con_pairs", "pairs", [pair_id, "balances", self.lp]) or 0
        trader_before = self.client.get_var("con_pairs", "pairs", [pair_id, "balances", self.trader]) or 0

        self.pairs.liqTransfer(
            pair=pair_id,
            amount=moved,
            to=self.trader,
            signer=self.lp,
        )

        lp_after = self.client.get_var("con_pairs", "pairs", [pair_id, "balances", self.lp]) or 0
        trader_after = self.client.get_var("con_pairs", "pairs", [pair_id, "balances", self.trader]) or 0
        self.assertAmountEqual(lp_before - lp_after, moved)
        self.assertAmountEqual(trader_after - trader_before, moved)

    def test_liq_transfer_from_consumes_allowance(self):
        _, pair_id = self.bootstrap_pair()
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
        approved = liquidity / 3

        self.pairs.liqApprove(
            pair=pair_id,
            amount=approved,
            to=self.trader,
            signer=self.lp,
        )

        self.pairs.liqTransfer_from(
            pair=pair_id,
            amount=approved,
            to=self.trader,
            main_account=self.lp,
            signer=self.trader,
        )

        remaining_allowance = self.client.get_var(
            "con_pairs", "pairs", [pair_id, "balances", self.lp, self.trader]
        ) or 0
        trader_balance = self.client.get_var("con_pairs", "pairs", [pair_id, "balances", self.trader]) or 0
        self.assertAmountEqual(remaining_allowance, 0)
        self.assertAmountEqual(trader_balance, approved)

        with self.assertRaises(AssertionError):
            self.pairs.liqTransfer_from(
                pair=pair_id,
                amount=ContractingDecimal("0.000001"),
                to=self.trader,
                main_account=self.lp,
                signer=self.trader,
            )

    def test_protocol_fee_mints_liquidity_to_owner(self):
        pair = self.pairs.createPair(
            tokenA="con_plain_mid",
            tokenB="currency",
            signer=self.operator,
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

        owner_lp_before = self.client.get_var("con_pairs", "pairs", [pair, "balances", "sys"]) or 0

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

        owner_lp_after = self.client.get_var("con_pairs", "pairs", [pair, "balances", "sys"]) or 0
        self.assertGreater(owner_lp_after, owner_lp_before)

    def test_supporting_fee_multi_hop_rejects_fee_on_transfer_bridge_token(self):
        pair_ab = self.pairs.createPair(
            tokenA="con_tax_token",
            tokenB="currency",
            signer=self.operator,
        )
        pair_bc = self.pairs.createPair(
            tokenA="con_plain_out",
            tokenB="con_tax_token",
            signer=self.operator,
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

    def test_supporting_fee_multi_hop_allows_fee_token_as_final_output(self):
        pair_ab = self.pairs.createPair(
            tokenA="con_plain_mid",
            tokenB="currency",
            signer=self.operator,
        )
        pair_bc = self.pairs.createPair(
            tokenA="con_plain_mid",
            tokenB="con_tax_token",
            signer=self.operator,
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

        tax_before = self.tax.balance_of(address=self.trader, signer=self.operator)
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
            self.tax.balance_of(address=self.trader, signer=self.operator) - tax_before,
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
            self.client.get_var("con_dex", "fee_on_transfer_tokens", ["con_tax_token"])
        )

        self.dex.set_fee_on_transfer_token(
            token="con_tax_token",
            enabled=False,
            signer=self.operator,
        )
        self.assertFalse(
            self.client.get_var("con_dex", "fee_on_transfer_tokens", ["con_tax_token"])
        )


if __name__ == "__main__":
    unittest.main()
