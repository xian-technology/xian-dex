DEX_CONTRACT = "con_dex"
DEX_PAIRS = "con_pairs"

toks_to_pair = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='toks_to_pair')
pairs = ForeignHash(foreign_contract=DEX_PAIRS, foreign_name='pairs')

@export
def buy(
    buy_token: str, 
    sell_token: str, 
    amount: float, 
    slippage: float = 1, 
    deadline: datetime.datetime = None
):
    assert amount > 0, "Amount must be positive"
    assert 0 <= slippage <= 100, "Slippage must be between 0 and 100%"
    assert deadline is not None, "Deadline is required"
    assert now < deadline, "Trade deadline has expired"
    
    token_a, token_b = (
        (buy_token, sell_token) if buy_token < sell_token else (sell_token, buy_token)
    )
    
    pair_id = toks_to_pair[token_a, token_b]
    assert pair_id is not None, "Pair does not exist"
    
    dex = importlib.import_module(DEX_CONTRACT)
    dex_pairs = importlib.import_module(DEX_PAIRS)
    reserve_a, reserve_b, not_used = dex_pairs.getReserves(pair_id)
    
    if token_a == buy_token:
        reserve_buy, reserve_sell = reserve_a, reserve_b
    else:
        reserve_buy, reserve_sell = reserve_b, reserve_a

    fee_bps = dex.getTradeFeeBps(account=ctx.signer)
    input_amount = dex.getAmountIn(
        amountOut=amount,
        reserveIn=reserve_sell,
        reserveOut=reserve_buy,
        feeBps=fee_bps,
    )
    input_amount = input_amount * (1 + (slippage / 100))
    input_amount = input_amount * 1.0001  # small buffer
    
    sell_token_contract = importlib.import_module(sell_token)
    
    user_balance = sell_token_contract.balance_of(ctx.caller)
    assert user_balance >= input_amount, (
        f"Insufficient balance: have {user_balance}, need {input_amount}"
    )

    sell_token_contract.transfer_from(
        amount=input_amount, 
        to=ctx.this, 
        main_account=ctx.caller
    )

    sell_token_contract.approve(amount=input_amount, to=DEX_CONTRACT)

    output_amount = dex.swapExactTokenForTokenSupportingFeeOnTransferTokens(
        amountIn=input_amount,
        amountOutMin=amount * (1 - slippage / 100),
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
    amount: float, 
    slippage: float = 1, 
    deadline: datetime.datetime = None
):
    assert amount > 0, "Amount must be positive"
    assert 0 <= slippage <= 100, "Slippage must be between 0 and 100%"
    assert deadline is not None, "Deadline is required"
    assert now < deadline, "Trade deadline has expired"

    token_a, token_b = (
        (buy_token, sell_token) if buy_token < sell_token else (sell_token, buy_token)
    )

    pair_id = toks_to_pair[token_a, token_b]
    assert pair_id is not None, "Pair does not exist"
    
    dex = importlib.import_module(DEX_CONTRACT)
    dex_pairs = importlib.import_module(DEX_PAIRS)
    reserve_a, reserve_b, not_used = dex_pairs.getReserves(pair_id)
    
    if token_a == sell_token:
        reserve_sell, reserve_buy = reserve_a, reserve_b
    else:
        reserve_sell, reserve_buy = reserve_b, reserve_a
    
    fee_bps = dex.getTradeFeeBps(account=ctx.signer)
    expected_output = dex.getAmountOut(
        amountIn=amount,
        reserveIn=reserve_sell,
        reserveOut=reserve_buy,
        feeBps=fee_bps,
    )
    
    sell_token_contract = importlib.import_module(sell_token)
    
    sell_token_contract.transfer_from(
        amount=amount, 
        to=ctx.this, 
        main_account=ctx.caller
    )
    
    sell_token_contract.approve(amount=amount, to=DEX_CONTRACT)
    
    output_amount = dex.swapExactTokenForTokenSupportingFeeOnTransferTokens(
        amountIn=amount,
        amountOutMin=expected_output * (1 - slippage / 100),
        pair=pair_id,
        src=sell_token,
        to=ctx.caller,
        deadline=deadline
    )
    
    return amount, output_amount
