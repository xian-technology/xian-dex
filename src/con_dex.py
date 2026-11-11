DEX_PAIRS = "con_pairs"
DEFAULT_TRADE_FEE_BPS = 30
ZERO_TRADE_FEE_BPS = 0

toks_to_pair = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='toks_to_pair')
pairsmap = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='pairs')
owner = Variable()
fee_on_transfer_tokens = Hash(default_value=False)
zero_fee_signers = Hash(default_value=False)

ZeroFeeTraderUpdated = LogEvent(
    "ZeroFeeTraderUpdated",
    {
	"account": {'type': str, 'idx': True},
	"enabled": {'type': bool}
	}
)

REQUIRED_TOKEN_EXPORTS = ("transfer_from", "transfer", "balance_of")

@construct
def constructor():
	owner.set(ctx.signer)

def PAIRS():
	return importlib.import_module(DEX_PAIRS)


def assert_token_contract(token: str):
	for export_name in REQUIRED_TOKEN_EXPORTS:
		assert importlib.has_export(token, export_name), "SNAKX: INVALID_TOKEN"


def load_token(token: str):
	assert_token_contract(token)
	return importlib.import_module(token)


def token_precision(token: str):
	if not importlib.has_export(token, "get_metadata"):
		return None
	metadata = importlib.import_module(token).get_metadata()
	if metadata is None:
		return None
	precision = metadata["precision"] if "precision" in metadata else None
	if isinstance(precision, int) and precision >= 0:
		return precision
	return None


def normalize_token_amount(token: str, amount: decimal, round_up: bool = False):
	assert amount >= 0, "SNAKX: NEGATIVE_AMOUNT"
	precision = token_precision(token)
	if precision is None:
		return amount
	mode = "ceil" if round_up else "floor"
	result = quantize(amount, min(precision, 30), mode)
	if precision == 0:
		return int(result)
	return result


def validate_fee_bps(fee_bps: int):
	assert fee_bps == ZERO_TRADE_FEE_BPS or fee_bps == DEFAULT_TRADE_FEE_BPS, 'SNAKX: INVALID_FEE_BPS'


def trade_fee_bps_for(account: str):
	return ZERO_TRADE_FEE_BPS if zero_fee_signers[account] else DEFAULT_TRADE_FEE_BPS


def current_trade_fee_bps():
	return trade_fee_bps_for(ctx.signer)


def canonicalize_tokens(tokenA: str, tokenB: str):
	if tokenB < tokenA:
		return tokenB, tokenA, True
	return tokenA, tokenB, False


def actual_balance(token: str, address: str):
	t = load_token(token)
	balance = t.balance_of(address)
	return 0 if balance is None else balance


def transfer_into_pairs(token: str, src: str, amount: decimal):
	balance_before = actual_balance(token, DEX_PAIRS)
	safeTransferFrom(token, src, DEX_PAIRS, amount)
	return actual_balance(token, DEX_PAIRS) - balance_before


def transfer_lp_into_pairs(pair: int, src: str, amount: decimal):
	pairs = PAIRS()
	lp_token = pairs.lpTokenFor(pair)
	importlib.import_module(lp_token).transfer_from(amount, DEX_PAIRS, src)


def validate_path(src: str, path: list):
	current = src
	for pair in path:
		token0 = pairsmap[pair, "token0"]
		token1 = pairsmap[pair, "token1"]
		assert token0 is not None and token1 is not None, 'SNAKX: INVALID_PAIR'
		assert current == token0 or current == token1, 'SNAKX: INVALID_PATH'
		current = token1 if current == token0 else token0
	return current


def assert_supported_fee_path(src: str, path: list):
	current = src
	for index in range(0, len(path)):
		token0 = pairsmap[path[index], "token0"]
		token1 = pairsmap[path[index], "token1"]
		assert token0 is not None and token1 is not None, 'SNAKX: INVALID_PAIR'
		assert current == token0 or current == token1, 'SNAKX: INVALID_PATH'
		current = token1 if current == token0 else token0
		if index < len(path) - 1:
			assert not fee_on_transfer_tokens[current], 'SNAKX: UNSUPPORTED_INTERMEDIATE_FEE_TOKEN'


def assert_plain_path(src: str, path: list):
	current = src
	assert not fee_on_transfer_tokens[current], 'SNAKX: FEE_TOKEN_REQUIRES_SUPPORTING_ROUTE'
	for pair in path:
		token0 = pairsmap[pair, "token0"]
		token1 = pairsmap[pair, "token1"]
		assert token0 is not None and token1 is not None, 'SNAKX: INVALID_PAIR'
		assert current == token0 or current == token1, 'SNAKX: INVALID_PATH'
		current = token1 if current == token0 else token0
		assert not fee_on_transfer_tokens[current], 'SNAKX: FEE_TOKEN_REQUIRES_SUPPORTING_ROUTE'

def safeTransferFrom(token: str, src: str, to: str, value: decimal):
	value = normalize_token_amount(token, value)
	assert value > 0, 'SNAKX: INSUFFICIENT_INPUT_AMOUNT'
	t = load_token(token)
	t.transfer_from(value, to, src)
	
def quote(amountA: decimal, reserveA: decimal, reserveB: decimal):
	assert amountA > 0, 'SNAKX: INSUFFICIENT_AMOUNT'
	assert reserveA > 0 and reserveB > 0, 'SNAKX: INSUFFICIENT_LIQUIDITY'
	return (amountA * reserveB) / reserveA


@export
def set_fee_on_transfer_token(token: str, enabled: bool):
	assert ctx.caller == owner.get(), 'SNAKX: FORBIDDEN'
	fee_on_transfer_tokens[token] = enabled


@export
def set_zero_fee_trader(account: str, enabled: bool):
	assert ctx.caller == owner.get(), 'SNAKX: FORBIDDEN'
	zero_fee_signers[account] = enabled
	ZeroFeeTraderUpdated({"account": account, "enabled": enabled})


@export
def getTradeFeeBps(account: str = None):
	return trade_fee_bps_for(ctx.signer if account is None else account)


def internal_addLiquidity(
tokenA: str,
tokenB: str,
amountADesired: decimal,
amountBDesired: decimal,
amountAMin: decimal,
amountBMin: decimal,
lpToken: str = None):
	pairs = PAIRS()
	
	desired_pair = toks_to_pair[tokenA, tokenB]
	if (desired_pair == None):
		desired_pair = pairs.createPair(tokenA, tokenB, lpToken)
	elif lpToken is not None:
		assert pairs.lpTokenFor(desired_pair) == lpToken, "SNAKX: LP_TOKEN_MISMATCH"
	reserveA, reserveB, ignore = pairs.getReserves(desired_pair)

	if (reserveA == 0 and reserveB == 0):
		return amountADesired, amountBDesired
	else:
		amountBOptimal = normalize_token_amount(tokenB, quote(amountADesired, reserveA, reserveB))
		if (amountBOptimal <= amountBDesired):
			assert amountBOptimal >= amountBMin, 'SNAKX: INSUFFICIENT_B_AMOUNT'
			return amountADesired, amountBOptimal
		else:
			amountAOptimal = normalize_token_amount(tokenA, quote(amountBDesired, reserveB, reserveA))

			assert amountAOptimal <= amountADesired
			assert amountAOptimal >= amountAMin, 'SNAKX: INSUFFICIENT_A_AMOUNT'
			return amountAOptimal, amountBDesired
			
			
@export
def addLiquidity(
	tokenA: str,
	tokenB: str,
	amountADesired: decimal,
	amountBDesired: decimal,
	amountAMin: decimal,
	amountBMin: decimal,
	to: str,
	deadline: datetime.datetime,
	lpToken: str = None
	):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()

	tokenA, tokenB, reversed_order = canonicalize_tokens(tokenA, tokenB)
	if reversed_order:
		amountADesired, amountBDesired = amountBDesired, amountADesired
		amountAMin, amountBMin = amountBMin, amountAMin
	amountADesired = normalize_token_amount(tokenA, amountADesired)
	amountBDesired = normalize_token_amount(tokenB, amountBDesired)
	amountAMin = normalize_token_amount(tokenA, amountAMin)
	amountBMin = normalize_token_amount(tokenB, amountBMin)
	assert amountADesired > 0 and amountBDesired > 0, 'SNAKX: INSUFFICIENT_AMOUNT'
	amountA, amountB = internal_addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, lpToken)

	pair = toks_to_pair[tokenA, tokenB]
	
	actual_amountA = transfer_into_pairs(tokenA, ctx.caller, amountA)
	actual_amountB = transfer_into_pairs(tokenB, ctx.caller, amountB)
	pairs.sync2(pair, actual_amountA, actual_amountB)
	assert actual_amountA >= amountAMin, 'SNAKX: INSUFFICIENT_A_AMOUNT'
	assert actual_amountB >= amountBMin, 'SNAKX: INSUFFICIENT_B_AMOUNT'
	
	liquidity = pairs.mint(pair, to)

	if reversed_order:
		return actual_amountB, actual_amountA, liquidity

	return actual_amountA, actual_amountB, liquidity

@export
def removeLiquidity(
	tokenA: str,
	tokenB: str,
	liquidity: decimal,
	amountAMin: decimal,
	amountBMin: decimal,
	to: str,
	deadline: datetime.datetime
	):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()

	tokenA, tokenB, reversed_order = canonicalize_tokens(tokenA, tokenB)
	if reversed_order:
		amountAMin, amountBMin = amountBMin, amountAMin
	amountAMin = normalize_token_amount(tokenA, amountAMin)
	amountBMin = normalize_token_amount(tokenB, amountBMin)
	desired_pair = toks_to_pair[tokenA, tokenB]
	assert desired_pair != None, "SNAKX: NO_PAIR"

	balanceA_before = actual_balance(tokenA, to)
	balanceB_before = actual_balance(tokenB, to)
	transfer_lp_into_pairs(desired_pair, ctx.caller, liquidity)
	pairs.burn(desired_pair, to)

	actual_amountA = actual_balance(tokenA, to) - balanceA_before
	actual_amountB = actual_balance(tokenB, to) - balanceB_before
	assert actual_amountA >= amountAMin, 'SNAKX: INSUFFICIENT_A_AMOUNT'
	assert actual_amountB >= amountBMin, 'SNAKX: INSUFFICIENT_B_AMOUNT'

	if reversed_order:
		return actual_amountB, actual_amountA

	return actual_amountA, actual_amountB
	
def get_amount_out_for_fee(amountIn: decimal, reserveIn: decimal, reserveOut: decimal, fee_bps: int):
	validate_fee_bps(fee_bps)
	assert amountIn > 0, 'SNAKX: INSUFFICIENT_INPUT_AMOUNT'
	assert reserveIn > 0 and reserveOut > 0, 'SNAKX: INSUFFICIENT_LIQUIDITY'
	amountInWithFee = amountIn * ((10000 - fee_bps) / 10000)
	numerator = amountInWithFee * reserveOut
	denominator = reserveIn + amountInWithFee
	return numerator / denominator
#(x*997*y)/(z*1000+997*x) = (x*0.997*y)/(z+0.997*x)


DECIMAL_SCALE = 10 ** 30
FEE_DENOMINATOR = 10000
MAX_AMOUNT_IN_SEARCH_STEPS = 256


def to_units(value: decimal):
	# Contract decimals carry 30 fractional digits, so this is exact.
	return int(value * DECIMAL_SCALE)


def from_units(units: int):
	return decimal(str(units)) / DECIMAL_SCALE


def ceil_div(numerator: int, denominator: int):
	return -((-numerator) // denominator)


def amount_unit(token: str):
	# Smallest amount step the router keeps for token, in 1e-30 units.
	precision = None if token is None else token_precision(token)
	if precision is None:
		return 1
	return 10 ** (30 - min(precision, 30))


def ceil_to_unit(units: int, unit: int):
	return ceil_div(units, unit) * unit


def input_units_for_fee_adjusted(amount_with_fee: int, fee_bps: int, unit: int):
	# Smallest input on the token grid whose truncated fee-adjusted amount
	# (input * (1 - fee)) reaches amount_with_fee.
	return ceil_to_unit(
		ceil_div(amount_with_fee * FEE_DENOMINATOR, FEE_DENOMINATOR - fee_bps), unit
	)


def get_amount_in_for_fee(amountOut: decimal, reserveIn: decimal, reserveOut: decimal, fee_bps: int, tokenIn: str = None, tokenOut: str = None):
	validate_fee_bps(fee_bps)
	assert amountOut > 0, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'
	assert reserveIn > 0 and reserveOut > 0, 'SNAKX: INSUFFICIENT_LIQUIDITY'
	in_unit = amount_unit(tokenIn)
	# The router floors outputs to tokenOut's grid, so it must reach this target.
	target = ceil_to_unit(to_units(amountOut), amount_unit(tokenOut))
	reserve_in = to_units(reserveIn)
	reserve_out = to_units(reserveOut)
	assert reserve_out > target, 'SNAKX: INSUFFICIENT_LIQUIDITY'

	# get_amount_out_for_fee yields floor(floor(a * R_out / S) * S / (R_in + a))
	# for fee-adjusted amount a (all in 1e-30 units, S = 1e30). It reaches the
	# target only if a >= target * R_in / (R_out - target), and always does once
	# a >= (target * R_in + S) / (R_out - target). Search between those bounds
	# with the router's own quote so the result is its exact inverse.
	low = input_units_for_fee_adjusted(
		ceil_div(target * reserve_in, reserve_out - target), fee_bps, in_unit
	)
	if quote_reaches(low, reserveIn, reserveOut, fee_bps, tokenOut, amountOut):
		return from_units(low)
	high = input_units_for_fee_adjusted(
		ceil_div(target * reserve_in + DECIMAL_SCALE, reserve_out - target), fee_bps, in_unit
	)
	for step in range(MAX_AMOUNT_IN_SEARCH_STEPS):
		if high - low <= in_unit:
			return from_units(high)
		middle = low + ((high - low) // in_unit // 2) * in_unit
		if quote_reaches(middle, reserveIn, reserveOut, fee_bps, tokenOut, amountOut):
			high = middle
		else:
			low = middle
	assert False, 'SNAKX: AMOUNT_IN_SEARCH_EXHAUSTED'


def quote_reaches(input_units: int, reserveIn: decimal, reserveOut: decimal, fee_bps: int, tokenOut: str, amountOut: decimal):
	quoted = get_amount_out_for_fee(from_units(input_units), reserveIn, reserveOut, fee_bps)
	if tokenOut is not None:
		quoted = normalize_token_amount(tokenOut, quoted)
	return quoted >= amountOut


@export
def getAmountOut(amountIn: decimal, reserveIn: decimal, reserveOut: decimal, feeBps: int = DEFAULT_TRADE_FEE_BPS):
	return get_amount_out_for_fee(amountIn, reserveIn, reserveOut, feeBps)


@export
def getAmountIn(
	amountOut: decimal,
	reserveIn: decimal,
	reserveOut: decimal,
	feeBps: int = DEFAULT_TRADE_FEE_BPS,
	tokenIn: str = None,
	tokenOut: str = None
):
	# Minimal input (on tokenIn's precision grid) whose exact-input quote, floored
	# to tokenOut's precision, is at least amountOut. Omitted tokens use the full
	# 30-digit decimal grid.
	return get_amount_in_for_fee(amountOut, reserveIn, reserveOut, feeBps, tokenIn, tokenOut)


def get_amounts_out_for_fee(amountIn: decimal, src: str, path: list, fee_bps: int):
	validate_fee_bps(fee_bps)
	assert len(path) >= 1, 'SNAKX: INVALID_PATH'
	pairs = PAIRS()
	amounts = [amountIn]
	validate_path(src, path)
	
	for x in range(0, len(path)):
		tok0 = pairsmap[path[x], "token0"]
		
		order = (src == tok0)
		
		reserveIn, reserveOut, ignore = pairs.getReserves(path[x])
		if(not order):
			reserveIn, reserveOut = reserveOut, reserveIn
		
		src = pairsmap[path[x], "token1"] if order else tok0
			
		amounts.append(
			normalize_token_amount(
				src,
				get_amount_out_for_fee(amounts[x], reserveIn, reserveOut, fee_bps),
			)
		)
		
	return amounts

@export
def getAmountsOut(amountIn: decimal, src: str, path: list):
	return get_amounts_out_for_fee(
		normalize_token_amount(src, amountIn),
		src,
		path,
		current_trade_fee_bps(),
	)

@export
def swapExactTokenForToken(
	amountIn: decimal,
	amountOutMin: decimal,
	pair: int,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	assert_plain_path(src, [pair])
	fee_bps = current_trade_fee_bps()
	reserve0, reserve1, ignore = pairs.getReserves(pair)
	order = (src == pairsmap[pair, "token0"])
	token_out = pairsmap[pair, "token1"] if order else pairsmap[pair, "token0"]
	amountIn = normalize_token_amount(src, amountIn)
	amountOutMin = normalize_token_amount(token_out, amountOutMin)
	if(not order):
		reserve0, reserve1 = reserve1, reserve0
	amount = normalize_token_amount(
		token_out,
		get_amount_out_for_fee(amountIn, reserve0, reserve1, fee_bps),
	)
	assert amount >= amountOutMin, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'
	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if order:
		pairs.sync2(pair, actual_amount_in, 0)
	else:
		pairs.sync2(pair, 0, actual_amount_in)
	out0 = 0 if order else amount
	out1 = amount if order else 0
	pairs.routerSwap(pair, out0, out1, to, fee_bps)
	
	return amount
	
@export
def swapExactTokenForTokenSupportingFeeOnTransferTokens(
	amountIn: decimal,
	amountOutMin: decimal,
	pair: int,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	token_out = validate_path(src, [pair])
	fee_bps = current_trade_fee_bps()

	TOK0 = pairsmap[pair, "token0"]

	order = (src == TOK0)

	amountIn = normalize_token_amount(src, amountIn)
	amountOutMin = normalize_token_amount(token_out, amountOutMin)
	t = load_token(token_out)
	
	balanceBefore = t.balance_of(to)
	
	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if order:
		pairs.sync2(pair, actual_amount_in, 0)
	else:
		pairs.sync2(pair, 0, actual_amount_in)
	
	reserve0, reserve1, ignore = pairs.getReserves(pair)
	sur0, sur1 = pairs.getSurplus(pair)
	
	if(not order):
		reserve0, reserve1 = reserve1, reserve0
	
	amount = normalize_token_amount(
		token_out,
		get_amount_out_for_fee(sur0 if order else sur1, reserve0, reserve1, fee_bps),
	)
	
	out0 = 0 if order else amount
	out1 = amount if order else 0
	pairs.routerSwap(pair, out0, out1, to, fee_bps)
	
	rv = t.balance_of(to) - balanceBefore
	assert rv >= amountOutMin, "SNAKX: INSUFFICIENT_OUTPUT_AMOUNT"
	return rv
	
	
def internal_swap(amounts: list[decimal], src: str, path: list[int], to: str, fee_bps: int):
	assert len(amounts) == len(path) + 1, 'SNAKX: INVALID_LENGTHS'
	pairs = PAIRS()
	
	for x in range(0, len(path)-1):
		tok0 = pairsmap[path[x], "token0"]
		
		order = (src == tok0)
		
		out0 = 0 if order else amounts[x+1]
		out1 = amounts[x+1] if order else 0
		
		src = pairsmap[path[x], "token1"] if order else tok0
			
		pairs.routerSwapToPair(path[x], out0, out1, path[x+1], fee_bps)
		
		
	tok0 = pairsmap[path[-1], "token0"]
	order = (src == tok0)
		
	out0 = 0 if order else amounts[-1]
	out1 = amounts[-1] if order else 0
			
	pairs.routerSwap(path[-1], out0, out1, to, fee_bps)
	
def internal_swap_fee(amounts: list[decimal], amountOutMin: decimal, src: str, path: list[int], to: str, fee_bps: int):
	assert len(amounts) == len(path) + 1, 'SNAKX: INVALID_LENGTHS'
	pairs = PAIRS()
	
	for x in range(0, len(path)-1):
		tok0 = pairsmap[path[x], "token0"]
		
		order = (src == tok0)
		
		out0 = 0 if order else amounts[x+1]
		out1 = amounts[x+1] if order else 0
		
		src = pairsmap[path[x], "token1"] if order else tok0
			
		pairs.routerSwapToPair(path[x], out0, out1, path[x+1], fee_bps)
		
		
	tok0 = pairsmap[path[-1], "token0"]
	order = (src == tok0)
	
	t = load_token(tok0 if not order else pairsmap[path[-1], "token1"])
	
	balanceBefore = t.balance_of(to)
		
	out0 = 0 if order else amounts[-1]
	out1 = amounts[-1] if order else 0
			
	pairs.routerSwap(path[-1], out0, out1, to, fee_bps)
	
	rv = t.balance_of(to) - balanceBefore
	assert rv >= amountOutMin, "SNAKX: INSUFFICIENT_OUTPUT_AMOUNT"
	return rv
	
@export
def swapExactTokensForTokensSupportingFeeOnTransferTokens(
	amountIn: decimal,
	amountOutMin: decimal,
	path: list,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	if len(path) == 1:
		return swapExactTokenForTokenSupportingFeeOnTransferTokens(amountIn, amountOutMin, path[0], src, to, deadline)
	
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	assert_supported_fee_path(src, path)
	fee_bps = current_trade_fee_bps()
	amountIn = normalize_token_amount(src, amountIn)
	amountOutMin = normalize_token_amount(validate_path(src, path), amountOutMin)
	
	TOK0 = pairsmap[path[0], "token0"]
	
	order = (src == TOK0)
	
	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if order:
		pairs.sync2(path[0], actual_amount_in, 0)
	else:
		pairs.sync2(path[0], 0, actual_amount_in)
	
	sur0, sur1 = pairs.getSurplus(path[0])
	
	amounts = get_amounts_out_for_fee(sur0 if order else sur1, src, path, fee_bps)
	
	assert amounts[-1] >= amountOutMin, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'
	
	return internal_swap_fee(amounts, amountOutMin, src, path, to, fee_bps)
	
@export
def swapExactTokensForTokens(
	amountIn: decimal,
	amountOutMin: decimal,
	path: list,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	assert_plain_path(src, path)
	fee_bps = current_trade_fee_bps()
	amountIn = normalize_token_amount(src, amountIn)
	amountOutMin = normalize_token_amount(validate_path(src, path), amountOutMin)
	
	amounts = get_amounts_out_for_fee(amountIn, src, path, fee_bps)
	assert amounts[-1] >= amountOutMin, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'

	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if pairsmap[path[0], "token0"] == src:
		pairs.sync2(path[0], actual_amount_in, 0)
	else:
		pairs.sync2(path[0], 0, actual_amount_in)
	internal_swap(amounts, src, path, to, fee_bps)
	
	return amounts[-1]
