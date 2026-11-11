import decimal
import random
import tempfile
import unittest
from pathlib import Path

from contracting.local import ContractingClient
from xian_runtime_types.decimal import ContractingDecimal

ROOT = Path(__file__).resolve().parents[1]

PRECISION_TOKEN = """
metadata = Hash()

@construct
def seed(precision: int):
    metadata["precision"] = precision

@export
def get_metadata():
    return {"precision": metadata["precision"]}
"""

NO_PRECISION_TOKEN = """
@export
def balance_of(address: str):
    return 0
"""

PRECISIONS = (None, 0, 2, 6, 8, 18)
WIDE = decimal.Context(prec=200)


def token_name(precision):
    return "con_no_precision" if precision is None else f"con_precision_{precision}"


def unit(precision):
    return decimal.Decimal(1).scaleb(-(30 if precision is None else precision))


def floor_to(value, precision):
    return decimal.Decimal(str(value)).quantize(
        unit(precision), rounding=decimal.ROUND_FLOOR, context=WIDE
    )


def random_amount(rng, precision, low_exponent, high_exponent):
    magnitude = decimal.Decimal(10).scaleb(rng.randint(low_exponent, high_exponent) - 1)
    mantissa = WIDE.divide(decimal.Decimal(rng.randint(1, 10**12)), decimal.Decimal(10**12))
    return max(floor_to(WIDE.multiply(magnitude, mantissa), precision), unit(precision))


class TestExactOutputQuote(unittest.TestCase):
    """getAmountIn must be the exact inverse of the router's exact-input quote."""

    @classmethod
    def setUpClass(cls):
        cls._storage_home = tempfile.TemporaryDirectory()
        cls.client = ContractingClient(storage_home=Path(cls._storage_home.name))
        cls.client.flush()
        for name in ("con_pairs", "con_dex"):
            cls.client.submit((ROOT / "src" / f"{name}.py").read_text(), name=name)
        cls.client.submit(NO_PRECISION_TOKEN, name="con_no_precision")
        for precision in PRECISIONS[1:]:
            cls.client.submit(
                PRECISION_TOKEN,
                name=token_name(precision),
                constructor_args={"precision": precision},
            )
        cls.dex = cls.client.get_contract_proxy("con_dex")

    @classmethod
    def tearDownClass(cls):
        try:
            cls.client.flush()
        finally:
            cls.client.raw_driver._store.close()
            cls._storage_home.cleanup()

    def quote_out(self, amount_in, reserve_in, reserve_out, fee_bps, out_precision):
        raw = self.dex.getAmountOut(
            amountIn=ContractingDecimal(str(amount_in)),
            reserveIn=ContractingDecimal(str(reserve_in)),
            reserveOut=ContractingDecimal(str(reserve_out)),
            feeBps=fee_bps,
        )
        return floor_to(raw, out_precision)

    def assert_exact_inverse(
        self, amount_out, reserve_in, reserve_out, fee_bps, in_precision, out_precision
    ):
        amount_in = decimal.Decimal(
            str(
                self.dex.getAmountIn(
                    amountOut=ContractingDecimal(str(amount_out)),
                    reserveIn=ContractingDecimal(str(reserve_in)),
                    reserveOut=ContractingDecimal(str(reserve_out)),
                    feeBps=fee_bps,
                    tokenIn=token_name(in_precision),
                    tokenOut=token_name(out_precision),
                )
            )
        )
        context = (
            amount_out,
            reserve_in,
            reserve_out,
            fee_bps,
            in_precision,
            out_precision,
            amount_in,
        )
        self.assertEqual(floor_to(amount_in, in_precision), amount_in, context)
        self.assertGreaterEqual(
            self.quote_out(amount_in, reserve_in, reserve_out, fee_bps, out_precision),
            amount_out,
            context,
        )
        smaller = WIDE.subtract(amount_in, unit(in_precision))
        if smaller > 0:
            self.assertLess(
                self.quote_out(smaller, reserve_in, reserve_out, fee_bps, out_precision),
                amount_out,
                context,
            )

    def test_amount_in_is_the_minimal_sufficient_input_for_random_markets(self):
        rng = random.Random(20261112)
        checked = 0
        while checked < 240:
            in_precision = rng.choice(PRECISIONS)
            out_precision = rng.choice(PRECISIONS)
            fee_bps = rng.choice((0, 30))
            reserve_in = random_amount(rng, in_precision, -3, 12)
            reserve_out = random_amount(rng, out_precision, -3, 12)
            share = WIDE.divide(
                decimal.Decimal(rng.choice((1, 10, 500, 5000, 9990, 999999))),
                decimal.Decimal(10**6),
            )
            # Sometimes request more digits than the output token can carry.
            amount_out = WIDE.multiply(reserve_out, share).quantize(
                unit(None), rounding=decimal.ROUND_FLOOR, context=WIDE
            )
            if rng.random() < 0.7:
                amount_out = floor_to(amount_out, out_precision)
            target = amount_out.quantize(
                unit(out_precision), rounding=decimal.ROUND_CEILING, context=WIDE
            )
            if amount_out <= 0 or target >= reserve_out:
                continue
            with self.subTest(sample=checked):
                self.assert_exact_inverse(
                    amount_out, reserve_in, reserve_out, fee_bps, in_precision, out_precision
                )
            checked += 1

    def test_amount_in_covers_known_truncation_cases(self):
        # Equal 1000/1000 reserves: the analytic input truncates one unit short.
        self.assert_exact_inverse(
            decimal.Decimal(50), decimal.Decimal(1000), decimal.Decimal(1000), 30, None, None
        )
        # Output nearly drains a sub-unit reserve.
        self.assert_exact_inverse(
            decimal.Decimal("0.0999"), decimal.Decimal("0.5"), decimal.Decimal("0.1"), 30, 8, 8
        )
        # Integer-precision tokens on both sides.
        self.assert_exact_inverse(
            decimal.Decimal(7), decimal.Decimal(1000), decimal.Decimal(100), 0, 0, 0
        )

    def test_amount_in_without_tokens_uses_the_full_decimal_grid(self):
        amount_in = self.dex.getAmountIn(amountOut=50, reserveIn=1000, reserveOut=1000, feeBps=30)
        self.assertGreaterEqual(self.quote_out(amount_in, 1000, 1000, 30, None), 50)
        self.assertLess(
            self.quote_out(
                WIDE.subtract(decimal.Decimal(str(amount_in)), unit(None)), 1000, 1000, 30, None
            ),
            50,
        )

    def test_amount_in_rejects_outputs_the_pool_cannot_release(self):
        with self.assertRaisesRegex(AssertionError, "SNAKX: INSUFFICIENT_LIQUIDITY"):
            self.dex.getAmountIn(amountOut=100, reserveIn=1000, reserveOut=100, feeBps=30)
        # Rounding the requested output up to the token grid reaches the reserve.
        with self.assertRaisesRegex(AssertionError, "SNAKX: INSUFFICIENT_LIQUIDITY"):
            self.dex.getAmountIn(
                amountOut=ContractingDecimal("99.5"),
                reserveIn=1000,
                reserveOut=100,
                feeBps=30,
                tokenOut=token_name(0),
            )


if __name__ == "__main__":
    unittest.main()
