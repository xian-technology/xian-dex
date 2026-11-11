DEX_CONTRACT = "con_dex"
DEX_PAIRS = "con_pairs"

toks_to_pair = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='toks_to_pair')
pairs = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='pairs')


def require_trade_window(deadline: datetime.datetime):
    assert deadline is not None, "Deadline is required"
    assert now < deadline, "Trade deadline has expired"


def pair_for(token_x: str, token_y: str):
    token_a, token_b = (
        (token_x, token_y) if token_x < token_y else (token_y, token_x)
    )
    pair_id = toks_to_pair[token_a, token_b]
    assert pair_id is not None, "Pair does not exist"
    return pair_id


def pull_and_approve(token: str, amount: decimal):
    token_contract = importlib.import_module(token)
    token_contract.transfer_from(
        amount=amount,
        to=ctx.this,
        main_account=ctx.caller
    )
    token_contract.approve(amount=amount, to=DEX_CONTRACT)


@export
def buy(
    buy_token: str,
    sell_token: str,
    amount: decimal,
    max_input: decimal,
    deadline: datetime.datetime
):
    # The signer's max_input is the price bound: it is fixed at signing time,
    # so a reserve change before execution can only make the trade revert.
    assert amount > 0, "Amount must be positive"
    assert max_input > 0, "max_input must be positive"
    require_trade_window(deadline)

    pair_id = pair_for(buy_token, sell_token)
    dex = importlib.import_module(DEX_CONTRACT)
    dex_pairs = importlib.import_module(DEX_PAIRS)
    reserve_0, reserve_1, not_used = dex_pairs.getReserves(pair_id)
    if pairs[pair_id, "token0"] == buy_token:
        reserve_buy, reserve_sell = reserve_0, reserve_1
    else:
        reserve_buy, reserve_sell = reserve_1, reserve_0

    # getAmountIn returns the smallest input the router turns into `amount`.
    input_amount = dex.getAmountIn(
        amountOut=amount,
        reserveIn=reserve_sell,
        reserveOut=reserve_buy,
        feeBps=dex.getTradeFeeBps(account=ctx.signer),
        tokenIn=sell_token,
        tokenOut=buy_token,
    )
    assert input_amount <= max_input, (
        f"Required input {input_amount} exceeds max_input {max_input}"
    )

    pull_and_approve(sell_token, input_amount)
    # The input is quoted against the reserves this swap executes on, so the
    # pool releases `amount`; buy-token transfer taxes are not the pool's to bound.
    output_amount = dex.swapExactTokenForTokenSupportingFeeOnTransferTokens(
        amountIn=input_amount,
        amountOutMin=0,
        pair=pair_id,
        src=sell_token,
        to=ctx.caller,
        deadline=deadline
    )

    return input_amount, output_amount


@export
def sell(
    sell_token: str,
    buy_token: str,
    amount: decimal,
    min_out: decimal,
    deadline: datetime.datetime
):
    # The signer's min_out is the price bound, measured at the recipient.
    assert amount > 0, "Amount must be positive"
    assert min_out > 0, "min_out must be positive"
    require_trade_window(deadline)

    pair_id = pair_for(buy_token, sell_token)
    pull_and_approve(sell_token, amount)
    output_amount = importlib.import_module(
        DEX_CONTRACT
    ).swapExactTokenForTokenSupportingFeeOnTransferTokens(
        amountIn=amount,
        amountOutMin=min_out,
        pair=pair_id,
        src=sell_token,
        to=ctx.caller,
        deadline=deadline
    )

    return amount, output_amount
