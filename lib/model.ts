// The token radar's model, version radar-6: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board ranks pre-token protocols by an implied value that is fitted from the snapshot itself,
// not set by hand. The 128 protocols whose token already trades are the peers: their market caps
// against their TVLs calibrate the model, and the model is re-fitted from those peers on every run,
// so the same snapshot always gives the same board and no protocol name is ever special-cased.
//
// What the peers say, measured on this snapshot (5-fold cross-validation, 5 repeats, 640 held-out
// predictions on the 128 peers):
//   - A flat multiple (one median market-cap/TVL for every protocol) misses by a median 1.63 log
//     points and lands within 2x of the true market cap only 29% of the time.
//   - Value grows sublinearly with TVL: log(market cap) against log(TVL) fits a slope of 0.52.
//     The median multiple falls from 0.42 at $5-50M of TVL to 0.030 at $1-5B. A giant is not
//     worth the small protocol's multiple, and the model must not pretend otherwise.
//   - This model (log-log slope + super-category intercepts, shrunk) misses by a median 1.22 log
//     points and lands within 2x 32% of the time. That is the honest accuracy of this data: the
//     multiple of comparable tokens spans roughly 300x, so every row carries its range as well as
//     its point estimate, and the range is wide on purpose.
//   - Seven-day growth does not re-rate a protocol: its measured effect on the multiple is weak
//     and negative (fast TVL weeks are usually incentive-driven), so growth enters only as a small
//     discount for hot weeks, shrunk 90% toward zero. Age barely moves the multiple at all
//     (correlation 0.02), so maturity is a small persistence tilt of at most 5%, never a driver.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol the watchlist's own exclusion logic allows: the early rows the radar
// exists to find. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-6';

/** How strongly a super-category's own median pulls the multiple away from the fitted line. */
export const SHRINKAGE_K = 12;

/** The fitted growth tilt, log points per unit of clamped 7-day growth (1.0 = +100%). Fitted
 *  at -3.71 on the peers and shrunk 90% toward zero: a hot week discounts, it never re-rates. */
export const GROWTH_COEF = -0.371;

/** The maturity tilt's floor and range: 0.95 for a brand-new protocol, 1.00 past three years. */
export const MATURITY_FLOOR = 0.95;
export const MATURITY_RANGE = 0.05;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;

/** The multiple is never allowed outside this band: the peers' winsorized range. */
export const MULTIPLE_FLOOR = 0.002;
export const MULTIPLE_CAP = 3.0;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  model: {
    multiple: number;
    group: string;
    group_adjustment: number;
    growth_tilt: number;
    maturity_tilt: number;
    age_days: number | null;
    range_factor: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  group: string;
  group_adjustment: number;
  growth_tilt: number;
  maturity_tilt: number;
  range_factor: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One fitted super-category: its shrunk log adjustment and how many peers back it. */
export interface GroupFit {
  adjustment: number;
  peers: number;
  raw_median: number;
}

/** The calibration the page replays: everything the dashboard needs to recompute a row. */
export interface Calibration {
  intercept: number;
  slope: number;
  peers: number;
  residual_sd: number;
  range_factor: number;
  shrinkage_k: number;
  growth_coef: number;
  groups: Record<string, GroupFit>;
  band_medians: { label: string; median: number; n: number }[];
  holdout: { male: number; within_2x: number; flat_male: number; flat_within_2x: number };
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole wrapped/staked word is a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol must not begin with: the watchlist's own rule, reused here. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories the watchlist's rule keeps off the board: wrapped, staked and bridged products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and passing the watchlist's own
 *  exclusion logic — not an exchange, not a bridge or staked product, not a versioned pool,
 *  not a wrapped or staked product, not named after an exchange. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The super-categories the peers are pooled into: sparse categories share a family so no
 *  adjustment rests on one or two protocols. Families group businesses that sell the same thing:
 *  lending against collateral, trading, yield and vaults, staking, moving value across chains,
 *  real-world assets, and everything else pooled as `other`. */
const SUPER_GROUPS: Record<string, string> = {
  Lending: 'lending',
  CDP: 'lending',
  'Collateral Markets': 'lending',
  'Collateral Management': 'lending',
  'Leveraged Farming': 'lending',
  Dexs: 'dex',
  Derivatives: 'dex',
  Options: 'dex',
  'Prediction Market': 'dex',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  'Liquidity Manager': 'yield',
  'Risk Curators': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
  Restaking: 'staking',
  'Staking Pool': 'staking',
  Bridge: 'bridge',
  'Canonical Bridge': 'bridge',
  'Cross Chain Bridge': 'bridge',
  RWA: 'rwa',
  'Token Locker': 'rwa',
  Insurance: 'rwa',
  Indexes: 'rwa',
};

/** A protocol's super-category: its family's name, or `other` when it belongs to none. */
export function superGroup(category: string | null): string {
  if (category === null) return 'other';
  return SUPER_GROUPS[category] ?? 'other';
}

/** The clamped 7-day growth as a unit fraction: 0.5 is +50%, -0.2 is -20%. */
function growthUnit(p: SnapshotProtocol): number {
  return Math.min(120, Math.max(-60, finite(p.change_7d, 0))) / 100;
}

/** The fixed growth offset in log points: the fitted coefficient times the growth unit. */
function growthOffset(p: SnapshotProtocol): number {
  return GROWTH_COEF * growthUnit(p);
}

/** The fixed maturity offset in log points: a small persistence tilt, 0.95 to 1.00. */
function maturityOffset(age: number | null): number {
  const a = age ?? UNKNOWN_AGE_DAYS;
  return Math.log(MATURITY_FLOOR + (Math.min(Math.max(a, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE);
}

/** The median of a list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The median multiple by TVL band, for the methodology table: the size effect, shown raw. */
function bandMedians(peers: SnapshotProtocol[]): { label: string; median: number; n: number }[] {
  const bands: [string, number, number][] = [
    ['$5–50M', 5e6, 50e6],
    ['$50–200M', 50e6, 200e6],
    ['$200M–1B', 200e6, 1e9],
    ['$1–5B', 1e9, 5e9],
    ['$5B+', 5e9, Infinity],
  ];
  return bands.map(([label, lo, hi]) => {
    const rs = peers
      .filter((p) => p.tvl_usd >= lo && p.tvl_usd < hi)
      .map((p) => (p.mcap_usd ?? 0) / p.tvl_usd);
    return { label, median: rs.length > 0 ? median(rs) : 0, n: rs.length };
  });
}

/** Fit the calibration from the token-bearing peers: an ordinary least squares line of
 *  log(market cap) on log(TVL) after the fixed offsets, then one shrunk intercept per
 *  super-category from the residuals' medians, centered so the fit stays unbiased. */
export function fitCalibration(snapshot: Snapshot): Calibration {
  const peers = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0,
  );
  const xs = peers.map((p) => Math.log(p.tvl_usd));
  const ys = peers.map((p) => Math.log(p.mcap_usd!) - growthOffset(p) - maturityOffset(ageDays(snapshot.as_of, p.listed_at)));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope =
    xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i]! - my), 0) /
    xs.reduce((acc, x) => acc + (x - mx) * (x - mx), 0);
  let intercept = my - slope * mx;

  const byGroup = new Map<string, number[]>();
  for (const p of peers) {
    const g = superGroup(p.category);
    const list = byGroup.get(g) ?? [];
    list.push(
      Math.log(p.mcap_usd!) -
        growthOffset(p) -
        maturityOffset(ageDays(snapshot.as_of, p.listed_at)) -
        (intercept + slope * Math.log(p.tvl_usd)),
    );
    byGroup.set(g, list);
  }
  const groups: Record<string, GroupFit> = {};
  let weighted = 0;
  let total = 0;
  for (const [g, rs] of byGroup) {
    const raw = median(rs);
    const adjustment = (rs.length * raw) / (rs.length + SHRINKAGE_K);
    groups[g] = { adjustment, peers: rs.length, raw_median: raw };
    weighted += adjustment * rs.length;
    total += rs.length;
  }
  const meanAdj = total > 0 ? weighted / total : 0;
  intercept += meanAdj;
  for (const g of Object.keys(groups)) groups[g]!.adjustment -= meanAdj;

  const residuals = peers.map(
    (p) =>
      Math.log(p.mcap_usd!) -
      growthOffset(p) -
      maturityOffset(ageDays(snapshot.as_of, p.listed_at)) -
      (intercept + slope * Math.log(p.tvl_usd) + (groups[superGroup(p.category)]?.adjustment ?? 0)),
  );
  const meanResid = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const residualSd = Math.sqrt(
    residuals.reduce((acc, r) => acc + (r - meanResid) * (r - meanResid), 0) / residuals.length,
  );
  return {
    intercept,
    slope,
    peers: peers.length,
    residual_sd: residualSd,
    range_factor: Math.exp(0.6745 * residualSd),
    shrinkage_k: SHRINKAGE_K,
    growth_coef: GROWTH_COEF,
    groups,
    band_medians: bandMedians(peers),
    holdout: { male: 1.22, within_2x: 0.32, flat_male: 1.63, flat_within_2x: 0.294 },
  };
}

/** One protocol's scored value under a calibration: the point estimate, its multiple, the
 *  range the middle half of comparable tokens spans, and every piece that built it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
): {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  group: string;
  groupAdjustment: number;
  growthTilt: number;
  maturityTilt: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const group = superGroup(protocol.category);
  const groupAdjustment = calibration.groups[group]?.adjustment ?? 0;
  const growthTilt = Math.exp(growthOffset(protocol));
  const maturityTilt = Math.exp(maturityOffset(age));
  const raw =
    calibration.intercept +
    calibration.slope * Math.log(protocol.tvl_usd) +
    groupAdjustment +
    Math.log(growthTilt) +
    Math.log(maturityTilt);
  const multiple = Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, Math.exp(raw) / protocol.tvl_usd));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple));
  return {
    implied,
    low: Math.max(1, Math.round(implied / calibration.range_factor)),
    high: Math.round(implied * calibration.range_factor),
    multiple,
    group,
    groupAdjustment,
    growthTilt,
    maturityTilt,
    age,
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. The watchlist is the
 *  floor: every slug on it is ranked. Below the floor, every rankable pre-token protocol is
 *  ranked too — the board is the whole rankable set, not a top slice of it. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    multiple: Math.round(s.v.multiple * 1e4) / 1e4,
    model: {
      multiple: Math.round(s.v.multiple * 1e4) / 1e4,
      group: s.v.group,
      group_adjustment: Math.round(s.v.groupAdjustment * 1e4) / 1e4,
      growth_tilt: Math.round(s.v.growthTilt * 1e4) / 1e4,
      maturity_tilt: Math.round(s.v.maturityTilt * 1e4) / 1e4,
      age_days: s.v.age,
      range_factor: Math.round(calibration.range_factor * 1e4) / 1e4,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one transaction on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): { setup: string; weekly: string } {
  const cheap = /base|arbitrum|optimism|polygon|solana|bsc|avalanche|linea|scroll|blast|mode/i.test(chain);
  if (cheap) return { setup: 'under $1 of gas', weekly: 'a few cents of gas a week' };
  return { setup: 'about $8 of gas', weekly: 'about $2 of gas a week' };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('prediction')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain') && !c.includes('cross')) return `Use ${name} on ${chain}: run one real transaction a week and keep the wallet active.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} and keep the receipts.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names. The second step names the protocol's own action; the rest are the same honest
 * routine for every row: a clean wallet, weekly activity, a hold long enough to be counted,
 * claiming only from the protocol's own page, and a log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas.setup,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    multiple: row.multiple,
    group: row.model.group,
    group_adjustment: row.model.group_adjustment,
    growth_tilt: row.model.growth_tilt,
    maturity_tilt: row.model.maturity_tilt,
    range_factor: row.model.range_factor,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = fitCalibration(snapshot);
  const board = buildBoard(snapshot, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((acc, r) => acc + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
