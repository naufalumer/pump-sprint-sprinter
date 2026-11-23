// Sprinter: post-crossing dip buyer for the pump.fun replay.
//
// Design note (from dev-window data): buying the 50-SOL reserve crossing
// itself loses money live, because the fill lands 2 slots after the spike
// that caused the crossing — the bot buys the top. But the same coins, bought
// on the first 8% retrace from their post-crossing high, bounce +20% most of
// the time (58% hit rate offline): the retrace, not the spike, is the entry.
// So this bot watches coins that crossed 50 SOL of real reserve, tracks their
// high since the crossing, and buys the first dip of 8% or more within 150
// slots, risking a fixed 0.1 SOL with a +20% take-profit and a -12% stop.
// One entry per coin, at most 5 open at once.
//
// Dev-window grade (kit's own grader, process driver): net PnL +0.2257 SOL,
// max drawdown 0.39%, 44 fills over 22 coins (15 winners), deterministic
// re-execution reproduced. Stress over 10 rebuilt windows: median -0.025 SOL,
// 6 of 10 copies lose money — the dev window was favourable, so the final
// window is a coin flip around breakeven with a small downside and a real
// upside. Nothing here promises a profit on unseen data.
//
// Deterministic by construction: no clock, no Math.random, no environment
// reads. Every decision is a pure function of the batches seen so far.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Real SOL reserve that marks a strong coin. */
  crossRealSol: number;
  /** The dip from the post-crossing high that triggers a buy (fraction). */
  dipFrac: number;
  /** Slots after the crossing during which a dip still counts. */
  dipWindow: number;
  /** Real SOL reserve must still be at least this at entry. */
  minRealSol: number;
  /** SOL staked on one coin. */
  stakeSol: number;
  /** Smallest single buy worth the transaction fee (SOL). */
  minBuySol: number;
  /** Slippage allowed on buys (bps). */
  buySlipBps: number;
  /** Slippage allowed on sells (bps). */
  sellSlipBps: number;
  /** Exit the whole position once up this far over cost (bps). */
  tpBps: number;
  /** Exit the whole position once down this far under cost (bps). */
  slBps: number;
  /** Trailing stop: once up trailArmBps, exit on a fall of trailBps from best. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
}

export const DEFAULT_PARAMS: Params = {
  crossRealSol: 50,
  dipFrac: 0.08,
  dipWindow: 150,
  minRealSol: 40,
  stakeSol: 0.1,
  minBuySol: 0.005,
  buySlipBps: 10000,
  sellSlipBps: 10000,
  tpBps: 2000,
  slBps: 1200,
  trailArmBps: 1000000,
  trailBps: 1000,
  maxHold: 200,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const BPS = 10000;

interface Coin {
  mint: Pubkey;
  creator: Pubkey;
  devSold: boolean;
  /** Slot the coin first reached crossRealSol; null until it does. */
  crossedAt: number | null;
  /** Highest price seen since the crossing. */
  highSinceCross: number;
  /** Already entered (or ruled out) — one shot per coin. */
  done: boolean;
}

interface Held {
  openedSlot: number;
  txPaidSol: number;
  bestSol: number;
  devSoldAtOpen: boolean;
}

function sellValueSol(tokens: number, vq: number, vt: number): number {
  if (tokens <= 0 || vt <= 0) return 0;
  // Tokens and reserves are raw units; the quote is lamports, so divide to SOL.
  return (((tokens * vq) / (vt + tokens)) * (1 - CURVE_FEE)) / LAMPORTS;
}

function priceOf(curve: { virtual_quote_reserves: bigint; virtual_token_reserves: bigint }): number {
  const vt = Number(curve.virtual_token_reserves);
  if (vt <= 0) return 0;
  return Number(curve.virtual_quote_reserves) / vt;
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const coins = new Map<Pubkey, Coin>();
  /** Coins that crossed, in crossing order: the only entry candidates. */
  const crossed = new Set<Pubkey>();
  const held = new Map<Pubkey, Held>();
  const selling = new Set<Pubkey>();

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const po of state.pending.values()) {
      if (po.order.mint === mint && po.order.side === side) return true;
    }
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          coins.set(e.mint, {
            mint: e.mint,
            creator: e.creator,
            devSold: false,
            crossedAt: null,
            highSinceCross: 0,
            done: false,
          });
        } else if (e.event === 'TradeEvent') {
          const c = coins.get(e.mint);
          if (c === undefined) continue;
          if (!e.is_buy && e.user === c.creator) c.devSold = true;
          const curve = state.curves.get(e.mint);
          if (curve !== undefined) {
            const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
            const price = priceOf(curve);
            if (c.crossedAt === null) {
              if (rqSol >= p.crossRealSol) {
                c.crossedAt = e.slot;
                c.highSinceCross = price;
                crossed.add(e.mint);
              }
            } else if (price > c.highSinceCross) {
              c.highSinceCross = price;
            }
          }
        } else {
          const c = coins.get(e.mint);
          if (c !== undefined) {
            c.done = true;
            crossed.delete(e.mint);
          }
        }
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txSol = Number(state.txFeeLamports()) / LAMPORTS;

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') {
          const h = held.get(f.mint);
          if (h !== undefined) h.txPaidSol += Number(f.tx_fee_lamports) / LAMPORTS;
          if (f.side === 'buy' && h === undefined) {
            held.set(f.mint, {
              openedSlot: f.slot,
              txPaidSol: Number(f.tx_fee_lamports) / LAMPORTS,
              bestSol: 0,
              devSoldAtOpen: coins.get(f.mint)?.devSold ?? false,
            });
          }
        }
      }
      for (const mint of [...selling]) {
        if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      }
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) {
          held.delete(mint);
        }
      }

      // Exits first.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: now, txPaidSol: txSol, bestSol: 0, devSoldAtOpen: c?.devSold ?? false };
          held.set(mint, h);
        }
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const tokens = Number(pos.token_amount);
        const value = sellValueSol(tokens, Number(curve.virtual_quote_reserves), Number(curve.virtual_token_reserves)) - txSol;
        const basis = Number(pos.cost_lamports) / LAMPORTS + h.txPaidSol;
        if (value > h.bestSol) h.bestSol = value;
        if (basis <= 0) continue;
        let exit = false;
        if (value >= basis * (1 + p.tpBps / BPS)) exit = true;
        if (value <= basis * (1 - p.slBps / BPS)) exit = true;
        if (h.bestSol >= basis * (1 + p.trailArmBps / BPS) && value <= h.bestSol * (1 - p.trailBps / BPS)) exit = true;
        if (now - h.openedSlot >= p.maxHold) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlipBps });
        selling.add(mint);
        if (c !== undefined) {
          c.done = true;
          crossed.delete(mint);
        }
      }

      // Entries: the first dip of dipFrac from the post-crossing high.
      let free = Number(state.freeCashLamports()) / LAMPORTS - txSol * orders.length;
      let open = state.committedPositionCount();
      for (const mint of [...crossed]) {
        if (orders.length >= cap) break;
        const c = coins.get(mint)!;
        if (c.done || c.crossedAt === null) {
          crossed.delete(mint);
          continue;
        }
        if (now - c.crossedAt > p.dipWindow) {
          c.done = true;
          crossed.delete(mint);
          continue;
        }
        if (open >= state.hello.caps.max_open_positions) break;
        if (held.has(mint) || selling.has(mint) || hasPending(state, mint, 'buy')) continue;
        if (state.positions.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rqSol < p.minRealSol) continue;
        const price = priceOf(curve);
        if (price <= 0 || c.highSinceCross <= 0) continue;
        if (price > c.highSinceCross * (1 - p.dipFrac)) continue;
        const capLamports = state.maxBuyLamports(mint);
        let amount = BigInt(Math.floor(p.stakeSol * LAMPORTS));
        if (amount > capLamports) amount = capLamports;
        if (amount < BigInt(Math.floor(p.minBuySol * LAMPORTS))) continue;
        if (free < Number(amount) / LAMPORTS + txSol) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
        free -= Number(amount) / LAMPORTS + txSol;
        open += 1;
        c.done = true;
        crossed.delete(mint);
      }
      return orders;
    },
  };
}
