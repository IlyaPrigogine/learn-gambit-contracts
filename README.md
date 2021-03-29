# Gambit Contracts

Contracts for the GMT Token and GMT Treasury.

## Install Dependencies

If npx is not installed yet:
`npm install -g npx`

Install packages:
`npm i`

## Compile Contracts

`npx hardhat compile`

## Run Tests

`npx hardhat test`

## Vault

The Vault contract handles buying USDG, selling USDG, swapping, increasing positions, decreasing positions and liquidations.

### Buying USDG
- USDG can be bought with any whitelisted token
- The oracle price is used to determine the amount of USDG that should be minted to the receiver, with 1 USDG being valued at 1 USD
- Fees are collected based on the `swapFeeBasisPoints`
- `usdgAmounts` is increased to track the USDG debt of the token
- `poolAmounts` is increased to track the amount of tokens that can be used for swaps or borrowed for margin trading

### Selling USDG
- USDG can be sold for any whitelisted token
- The oracle price is used to determine the amount of tokens that should be sent to the receiver
- For non-stableTokens, the amount of tokens sent out is additionally capped by the redemption collateral
- To calculate the redemption collateral:
  - Convert the value in `guaranteedUsd[token]` from USD to tokens
  - Add `poolAmounts[token]`
  - Subtract `reservedAmounts[token]`
- The reason for this calculation is because traders can open long positions by borrowing non-stable whitelisted tokens, when these tokens are borrowed the USD value in `guaranteedUsd[token]` is guaranteed until the positions are closed or liquidated
- `reservedAmounts[token]` tracks the amount of tokens in the pool reserved for open positions
- The redemption amount is capped by: `(USDG sold) / (USDG debt) * (redemption collateral) * (redemptionBasisPoints[token]) / BASIS_POINTS_DIVISOR`
- redemptionBasisPoints is can be adjusted to allow a larger or smaller amount of redemption
- Fees are collected based on the `swapFeeBasisPoints`
- `usdgAmounts` is decreased to reduce the USDG debt of the token
- `poolAmounts` is decreased to reflect the reduction in available collateral for redemption
