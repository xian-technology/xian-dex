balances = Hash(default_value=0)
approvals = Hash(default_value=0)
metadata = Hash()

operator = Variable()
minter = Variable()

TransferEvent = LogEvent(
    "Transfer",
    {
        "from": {"type": str, "idx": True},
        "to": {"type": str, "idx": True},
        "amount": (int, float, decimal),
    },
)
ApproveEvent = LogEvent(
    "Approve",
    {
        "from": {"type": str, "idx": True},
        "to": {"type": str, "idx": True},
        "amount": (int, float, decimal),
    },
)
MintEvent = LogEvent(
    "Mint",
    {
        "to": {"type": str, "idx": True},
        "amount": (int, float, decimal),
    },
)
BurnEvent = LogEvent(
    "Burn",
    {
        "from": {"type": str, "idx": True},
        "amount": (int, float, decimal),
    },
)


@construct
def seed(
    token_name: str = "SnakX LP Token",
    token_symbol: str = "SNAKX-LP",
    operator_address: str = None,
    minter_address: str = "con_pairs",
    token_logo_url: str = "",
    token_logo_svg: str = "",
    token_website: str = "",
):
    if operator_address is None or operator_address == "":
        operator_address = ctx.caller
    assert isinstance(operator_address, str) and operator_address != "", (
        "operator_address must be a non-empty string."
    )
    assert isinstance(minter_address, str) and minter_address != "", (
        "minter_address must be a non-empty string."
    )

    operator.set(operator_address)
    minter.set(minter_address)

    metadata["token_name"] = token_name
    metadata["token_symbol"] = token_symbol
    metadata["token_logo_url"] = token_logo_url
    metadata["token_logo_svg"] = token_logo_svg
    metadata["token_website"] = token_website
    metadata["precision"] = 8
    metadata["total_supply"] = 0


@export
def change_metadata(key: str, value: Any):
    assert ctx.caller == operator.get(), "Only operator can set metadata."
    assert key not in ("precision", "total_supply"), (
        "Managed metadata cannot be changed."
    )
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
    return balances[address]


@export
def allowance(owner: str, spender: str):
    return approvals[owner, spender]


@export
def transfer(amount: float, to: str):
    assert amount > 0, "Cannot send negative balances."
    assert balances[ctx.caller] >= amount, "Not enough coins to send."

    balances[ctx.caller] -= amount
    balances[to] += amount

    TransferEvent({"from": ctx.caller, "to": to, "amount": amount})


@export
def approve(amount: float, to: str):
    assert amount >= 0, "Cannot approve negative balances."

    approvals[ctx.caller, to] = amount
    ApproveEvent({"from": ctx.caller, "to": to, "amount": amount})


@export
def transfer_from(amount: float, to: str, main_account: str):
    assert amount > 0, "Cannot send negative balances."
    assert (
        approvals[main_account, ctx.caller] >= amount
    ), f"Not enough coins approved to send. You have {approvals[main_account, ctx.caller]} and are trying to spend {amount}"
    assert balances[main_account] >= amount, "Not enough coins to send."

    approvals[main_account, ctx.caller] -= amount
    balances[main_account] -= amount
    balances[to] += amount

    TransferEvent({"from": main_account, "to": to, "amount": amount})


@export
def change_minter(new_minter: str):
    assert ctx.caller == minter.get(), "Only minter can change minter."
    assert isinstance(new_minter, str) and new_minter != "", (
        "new_minter must be a non-empty string."
    )
    minter.set(new_minter)


@export
def mint(amount: float, to: str):
    assert ctx.caller == minter.get(), "Only minter can mint tokens."
    assert amount > 0, "Cannot mint negative balances."

    balances[to] += amount
    metadata["total_supply"] += amount

    MintEvent({"to": to, "amount": amount})
    TransferEvent({"from": "", "to": to, "amount": amount})


@export
def burn(amount: float):
    assert ctx.caller == minter.get(), "Only minter can burn tokens."
    assert amount > 0, "Cannot burn negative balances."
    assert balances[ctx.caller] >= amount, "Not enough coins to burn."

    balances[ctx.caller] -= amount
    metadata["total_supply"] -= amount
    assert metadata["total_supply"] >= 0, "Negative supply."

    BurnEvent({"from": ctx.caller, "amount": amount})
    TransferEvent({"from": ctx.caller, "to": "", "amount": amount})
