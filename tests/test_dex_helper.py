import unittest
from pathlib import Path

from contracting.client import ContractingClient
from xian_runtime_types.decimal import ContractingDecimal
from xian_runtime_types.time import Datetime

ROOT = Path(__file__).resolve().parents[1]
DEX_PAIRS_PATH = ROOT / "src" / "con_pairs.py"
DEX_ROUTER_PATH = ROOT / "src" / "con_dex.py"
DEX_HELPER_PATH = ROOT / "src" / "con_dex_helper.py"
LP_TOKEN_PATH = ROOT / "src" / "con_lp_token.py"

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


class TestDexHelper(unittest.TestCase):
    def setUp(self):
        self.client = ContractingClient()
        self.client.flush()

        with DEX_PAIRS_PATH.open() as f:
            self.client.submit(f.read(), name="con_pairs")
        with DEX_ROUTER_PATH.open() as f:
            self.client.submit(f.read(), name="con_dex")
        with DEX_HELPER_PATH.open() as f:
            self.client.submit(f.read(), name="con_dex_helper")

        self.client.submit(PLAIN_TOKEN, name="currency")
        self.client.submit(PLAIN_TOKEN, name="con_plain_out")
        self.client.submit(PLAIN_TOKEN, name="con_plain_alt")

        self.pairs = self.client.get_contract("con_pairs")
        self.dex = self.client.get_contract("con_dex")
        self.helper = self.client.get_contract("con_dex_helper")
        self.currency = self.client.get_contract("currency")
        self.out = self.client.get_contract("con_plain_out")
        self.alt = self.client.get_contract("con_plain_alt")

        self.operator = "sys"
        self.lp = "a" * 64
        self.trader = "b" * 64
        self.market_maker = "c" * 64
        self.now = Datetime(2026, 1, 1, 12, 0, 0)
        self.deadline = Datetime(2026, 1, 1, 12, 5, 0)
        self.expired_deadline = Datetime(2026, 1, 1, 11, 59, 0)

        for account in (self.lp, self.trader, self.market_maker):
            self.currency.transfer(
                amount=5000, to=account, signer=self.operator
            )
            self.out.transfer(amount=5000, to=account, signer=self.operator)
            self.alt.transfer(amount=5000, to=account, signer=self.operator)
            self.currency.approve(amount=5000, to="con_dex", signer=account)
            self.out.approve(amount=5000, to="con_dex", signer=account)
            self.alt.approve(amount=5000, to="con_dex", signer=account)
            self.currency.approve(
                amount=5000, to="con_dex_helper", signer=account
            )
            self.out.approve(amount=5000, to="con_dex_helper", signer=account)
            self.alt.approve(amount=5000, to="con_dex_helper", signer=account)

        self.submit_lp_token("con_lp_helper_out")
        self.pair_id = self.pairs.createPair(
            tokenA="con_plain_out",
            tokenB="currency",
            lpToken="con_lp_helper_out",
            signer=self.operator,
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

        self.submit_lp_token("con_lp_helper_alt")
        self.alt_pair_id = self.pairs.createPair(
            tokenA="con_plain_alt",
            tokenB="currency",
            lpToken="con_lp_helper_alt",
            signer=self.operator,
        )
        self.dex.addLiquidity(
            tokenA="currency",
            tokenB="con_plain_alt",
            amountADesired=1000,
            amountBDesired=1000,
            amountAMin=1000,
            amountBMin=1000,
            to=self.lp,
            deadline=self.deadline,
            signer=self.lp,
            environment={"now": self.now},
        )

    def tearDown(self):
        self.client.flush()

    def submit_lp_token(self, name):
        with LP_TOKEN_PATH.open() as f:
            self.client.submit(
                f.read(),
                name=name,
                constructor_args={
                    "token_name": name,
                    "token_symbol": name.upper(),
                    "operator_address": self.operator,
                    "minter_address": "con_pairs",
                },
                signer=self.operator,
            )

    def assertAmountEqual(self, actual, expected):
        actual_value = ContractingDecimal(str(actual))
        expected_value = ContractingDecimal(str(expected))
        difference = actual_value - expected_value
        if difference < 0:
            difference = -difference
        self.assertLessEqual(difference, ContractingDecimal("0.00001"))

    def test_helper_requires_future_absolute_deadline(self):
        with self.assertRaises(AssertionError):
            self.helper.buy(
                buy_token="con_plain_out",
                sell_token="currency",
                amount=25,
                slippage=5,
                deadline=self.expired_deadline,
                signer=self.trader,
                environment={"now": self.now},
            )

        with self.assertRaises(AssertionError):
            self.helper.sell(
                sell_token="con_plain_out",
                buy_token="currency",
                amount=25,
                slippage=5,
                deadline=self.expired_deadline,
                signer=self.trader,
                environment={"now": self.now},
            )

    def test_helper_buy_respects_zero_fee_signer_tier(self):
        standard_quote = self.helper.buy(
            buy_token="con_plain_out",
            sell_token="currency",
            amount=50,
            slippage=0,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        self.dex.set_zero_fee_trader(
            account=self.market_maker,
            enabled=True,
            signer=self.operator,
        )

        zero_fee_quote = self.helper.buy(
            buy_token="con_plain_alt",
            sell_token="currency",
            amount=50,
            slippage=0,
            deadline=self.deadline,
            signer=self.market_maker,
            environment={"now": self.now},
        )

        self.assertGreater(standard_quote[0], zero_fee_quote[0])
        self.assertGreater(zero_fee_quote[1], ContractingDecimal("0"))

    def test_helper_sell_respects_zero_fee_signer_tier(self):
        standard_trade = self.helper.sell(
            sell_token="con_plain_out",
            buy_token="currency",
            amount=50,
            slippage=0,
            deadline=self.deadline,
            signer=self.trader,
            environment={"now": self.now},
        )

        self.dex.set_zero_fee_trader(
            account=self.market_maker,
            enabled=True,
            signer=self.operator,
        )

        zero_fee_trade = self.helper.sell(
            sell_token="con_plain_alt",
            buy_token="currency",
            amount=50,
            slippage=0,
            deadline=self.deadline,
            signer=self.market_maker,
            environment={"now": self.now},
        )

        self.assertEqual(standard_trade[0], 50)
        self.assertEqual(zero_fee_trade[0], 50)
        self.assertGreater(zero_fee_trade[1], standard_trade[1])


if __name__ == "__main__":
    unittest.main()
