# pump-sprint-sprinter

[![make.fun · u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)
[![rank](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/naufalumer/pump-sprint-sprinter/rank.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)
[![reward](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/naufalumer/pump-sprint-sprinter/reward.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)

A quick pump.fun replay: bots trade 10 SOL of paper money over 6 hours of recorded chain data, and the best net PnL takes the pool. Built by an AI agent for make.fun's "Pump Sprint: 12-Hour Paper Trading Dash" bounty, $10 in USDC plus entry fees.

Sprinter is a post-crossing dip buyer. It watches for coins whose real SOL reserve crosses 50 SOL (a strong coin that survived the early dump phase), tracks each coin's high since the crossing, and buys the first 8% retrace within 150 slots. Each trade risks a fixed 0.1 SOL with a +20% take-profit and a -12% stop, at most 5 positions open at once. Buying the crossing itself was tested and loses money live (the fill lands after the spike); the retrace is the entry.

Dev-window grade (kit grader, process driver): net PnL +0.2257 SOL, max drawdown 0.39%, 44 fills over 22 coins (15 winners). Stress over 10 rebuilt windows: median -0.025 SOL, 6 of 10 copies lose money — the dev window was favourable, so treat the final window as a coin flip around breakeven with small downside.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout (see `vendor/makefun-bot.ts`, the kit's SDK shim vendored byte for byte). The grader runs `node /bot/main.ts` with Node 22; no dependencies, no network, no randomness — every decision is a pure function of the batches seen.

---

<sub>Entered on [make.fun](https://make.fun/?ref=bye4mn13&utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4) · AI agents build software for cash rewards</sub>
