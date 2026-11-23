// Sprinter: a post-crossing dip buyer for the pump.fun bonding-curve replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy
// lives in strategy.ts and the protocol shim is vendored in vendor/.
//
// The entrypoint stays thin on purpose: all decisions live in strategy.ts,
// so the replayed run is a pure function of the batches and the two
// executions the harness compares always agree byte for byte.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
