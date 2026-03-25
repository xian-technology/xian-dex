DEX_PAIRS = "con_pairs"

toks_to_pair = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='toks_to_pair')
pairsmap = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='pairs')

token_interface = [
    importlib.Func('transfer_from', args=('amount', 'to', 'main_account')),
    importlib.Func('transfer', args=('amount', 'to')),
    importlib.Func('balance_of', args=('address',)),
    #importlib.Var('balances', Hash),
]

def PAIRS():
	return importlib.import_module(DEX_PAIRS)


def canonicalize_tokens(tokenA: str, tokenB: str):
	if tokenB < tokenA:
		return tokenB, tokenA, True
	return tokenA, tokenB, False


def actual_balance(token: str, address: str):
	t = importlib.import_module(token)
	assert importlib.enforce_interface(t, token_interface)
	balance = t.balance_of(address)
	return 0 if balance is None else balance


def transfer_into_pairs(token: str, src: str, amount: float):
	balance_before = actual_balance(token, DEX_PAIRS)
	safeTransferFrom(token, src, DEX_PAIRS, amount)
	return actual_balance(token, DEX_PAIRS) - balance_before

def safeTransferFrom(token: str, src: str, to: str, value: float):
	t = importlib.import_module(token)
	assert importlib.enforce_interface(t, token_interface)
	t.transfer_from(value, to, src)
	
def quote(amountA: float, reserveA: float, reserveB: float):
	assert amountA > 0, 'SNAKX: INSUFFICIENT_AMOUNT'
	assert reserveA > 0 and reserveB > 0, 'SNAKX: INSUFFICIENT_LIQUIDITY'
	return (amountA * reserveB) / reserveA;


def internal_addLiquidity(
tokenA: str,
tokenB: str,
amountADesired: float,
amountBDesired: float,
amountAMin: float,
amountBMin: float):
	pairs = PAIRS()
	
	desired_pair = toks_to_pair[tokenA, tokenB]
	if (desired_pair == None):
		desired_pair = pairs.createPair(tokenA, tokenB)
	reserveA, reserveB, ignore = pairs.getReserves(desired_pair)

	if (reserveA == 0 and reserveB == 0):
		return amountADesired, amountBDesired
	else:
		amountBOptimal = quote(amountADesired, reserveA, reserveB)
		if (amountBOptimal <= amountBDesired):
			assert amountBOptimal >= amountBMin, 'SNAKX: INSUFFICIENT_B_AMOUNT'
			return amountADesired, amountBOptimal
		else:
			amountAOptimal = quote(amountBDesired, reserveB, reserveA)

			assert amountAOptimal <= amountADesired
			assert amountAOptimal >= amountAMin, 'SNAKX: INSUFFICIENT_A_AMOUNT'
			return amountAOptimal, amountBDesired
			
			
@export
def addLiquidity(
	tokenA: str,
	tokenB: str,
	amountADesired: float,
	amountBDesired: float,
	amountAMin: float,
	amountBMin: float,
	to: str,
	deadline: datetime.datetime
	):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()

	tokenA, tokenB, reversed_order = canonicalize_tokens(tokenA, tokenB)
	if reversed_order:
		amountADesired, amountBDesired = amountBDesired, amountADesired
		amountAMin, amountBMin = amountBMin, amountAMin
	amountA, amountB = internal_addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin)

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
	liquidity: float,
	amountAMin: float,
	amountBMin: float,
	to: str,
	deadline: datetime.datetime
	):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()

	tokenA, tokenB, reversed_order = canonicalize_tokens(tokenA, tokenB)
	if reversed_order:
		amountAMin, amountBMin = amountBMin, amountAMin
	desired_pair = toks_to_pair[tokenA, tokenB]
	assert desired_pair != None, "SNAKX: NO_PAIR"

	balanceA_before = actual_balance(tokenA, to)
	balanceB_before = actual_balance(tokenB, to)
	#liqTransfer_from(desired_pair, liquidity, ctx.this, ctx.caller)
	pairs.liqTransfer_from(desired_pair, liquidity, DEX_PAIRS, ctx.caller)
	pairs.burn(desired_pair, to)

	actual_amountA = actual_balance(tokenA, to) - balanceA_before
	actual_amountB = actual_balance(tokenB, to) - balanceB_before
	assert actual_amountA >= amountAMin, 'SNAKX: INSUFFICIENT_A_AMOUNT'
	assert actual_amountB >= amountBMin, 'SNAKX: INSUFFICIENT_B_AMOUNT'

	if reversed_order:
		return actual_amountB, actual_amountA

	return actual_amountA, actual_amountB
	
@export
def getAmountOut(amountIn: float, reserveIn: float, reserveOut: float):
	assert amountIn > 0, 'SNAKX: INSUFFICIENT_INPUT_AMOUNT'
	assert reserveIn > 0 and reserveOut > 0, 'SNAKX: INSUFFICIENT_LIQUIDITY'
	amountInWithFee = amountIn * 0.997;
	numerator = amountInWithFee * reserveOut;
	denominator = reserveIn + amountInWithFee;
	return numerator / denominator
#(x*997*y)/(z*1000+997*x) = (x*0.997*y)/(z+0.997*x)
	
@export
def getAmountsOut(amountIn: float, src: str, path: list):
	assert len(path) >= 1, 'SNAKX: INVALID_PATH'
	pairs = PAIRS()
	amounts = [amountIn]
	
	for x in range(0, len(path)):
		tok0 = pairsmap[path[x], "token0"]
		
		order = (src == tok0)
		
		reserveIn, reserveOut, ignore = pairs.getReserves(path[x])
		if(not order):
			reserveIn, reserveOut = reserveOut, reserveIn
		
		src = pairsmap[path[x], "token1"] if order else tok0
			
		amounts.append(getAmountOut(amounts[x], reserveIn, reserveOut))
		
	return amounts

@export
def swapExactTokenForToken(
	amountIn: float,
	amountOutMin: float,
	pair: int,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	reserve0, reserve1, ignore = pairs.getReserves(pair)
	order = (src == pairsmap[pair, "token0"])
	if(not order):
		reserve0, reserve1 = reserve1, reserve0
	amount = getAmountOut(amountIn, reserve0, reserve1)
	assert amount >= amountOutMin, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'
	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if order:
		pairs.sync2(pair, actual_amount_in, 0)
	else:
		pairs.sync2(pair, 0, actual_amount_in)
	out0 = 0 if order else amount
	out1 = amount if order else 0
	pairs.swap(pair, out0, out1, to)
	
	return amount
	
@export
def swapExactTokenForTokenSupportingFeeOnTransferTokens(
	amountIn: float,
	amountOutMin: float,
	pair: int,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	
	TOK0 = pairsmap[pair, "token0"]
	
	order = (src == TOK0)
	
	t = importlib.import_module(TOK0 if not order else pairsmap[pair, "token1"])
	assert importlib.enforce_interface(t, token_interface)
	
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
	
	amount = getAmountOut(sur0 if order else sur1, reserve0, reserve1)
	
	out0 = 0 if order else amount
	out1 = amount if order else 0
	pairs.swap(pair, out0, out1, to)
	
	rv = t.balance_of(to) - balanceBefore
	assert rv >= amountOutMin, "SNAKX: INSUFFICIENT_OUTPUT_AMOUNT"
	return rv
	
	
def internal_swap(amounts: list[float], src: str, path: list[int], to: str):
	assert len(amounts) == len(path) + 1, 'SNAKX: INVALID_LENGTHS'
	pairs = PAIRS()
	
	for x in range(0, len(path)-1):
		tok0 = pairsmap[path[x], "token0"]
		
		order = (src == tok0)
		
		out0 = 0 if order else amounts[x+1]
		out1 = amounts[x+1] if order else 0
		
		src = pairsmap[path[x], "token1"] if order else tok0
			
		pairs.swapToPair(path[x], out0, out1, path[x+1])
		
		
	tok0 = pairsmap[path[-1], "token0"]
	order = (src == tok0)
		
	out0 = 0 if order else amounts[-1]
	out1 = amounts[-1] if order else 0
			
	pairs.swap(path[-1], out0, out1, to)
	
def internal_swap_fee(amounts: list[float], amountOutMin: float, src: str, path: list[int], to: str):
	assert len(amounts) == len(path) + 1, 'SNAKX: INVALID_LENGTHS'
	pairs = PAIRS()
	
	for x in range(0, len(path)-1):
		tok0 = pairsmap[path[x], "token0"]
		
		order = (src == tok0)
		
		out0 = 0 if order else amounts[x+1]
		out1 = amounts[x+1] if order else 0
		
		src = pairsmap[path[x], "token1"] if order else tok0
			
		pairs.swapToPair(path[x], out0, out1, path[x+1])
		
		
	tok0 = pairsmap[path[-1], "token0"]
	order = (src == tok0)
	
	t = importlib.import_module(tok0 if not order else pairsmap[path[-1], "token1"])
	assert importlib.enforce_interface(t, token_interface)
	
	balanceBefore = t.balance_of(to)
		
	out0 = 0 if order else amounts[-1]
	out1 = amounts[-1] if order else 0
			
	pairs.swap(path[-1], out0, out1, to)
	
	rv = t.balance_of(to) - balanceBefore
	assert rv >= amountOutMin, "SNAKX: INSUFFICIENT_OUTPUT_AMOUNT"
	return rv
	
@export
def swapExactTokensForTokensSupportingFeeOnTransferTokens(
	amountIn: float,
	amountOutMin: float,
	path: list,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	if len(path) == 1:
		return swapExactTokenForTokenSupportingFeeOnTransferTokens(amountIn, amountOutMin, path[0], src, to, deadline)
	
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	
	TOK0 = pairsmap[path[0], "token0"]
	
	order = (src == TOK0)
	
	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if order:
		pairs.sync2(path[0], actual_amount_in, 0)
	else:
		pairs.sync2(path[0], 0, actual_amount_in)
	
	sur0, sur1 = pairs.getSurplus(path[0])
	
	amounts = getAmountsOut(sur0 if order else sur1, src, path)
	
	assert amounts[-1] >= amountOutMin, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'
	
	return internal_swap_fee(amounts, amountOutMin, src, path, to)
	
@export
def swapExactTokensForTokens(
	amountIn: float,
	amountOutMin: float,
	path: list,
	src: str,
	to: str,
	deadline: datetime.datetime
):
	assert now < deadline, 'SNAKX: EXPIRED'
	pairs = PAIRS()
	
	amounts = getAmountsOut(amountIn, src, path)
	assert amounts[-1] >= amountOutMin, 'SNAKX: INSUFFICIENT_OUTPUT_AMOUNT'

	actual_amount_in = transfer_into_pairs(src, ctx.caller, amountIn)
	if pairsmap[path[0], "token0"] == src:
		pairs.sync2(path[0], actual_amount_in, 0)
	else:
		pairs.sync2(path[0], 0, actual_amount_in)
	internal_swap(amounts, src, path, to)
	
	return amounts[-1]
