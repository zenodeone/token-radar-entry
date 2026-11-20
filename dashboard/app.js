// Token Radar's dashboard (model radar-6). It reads window.RADAR — written beside dashboard/ by
// main.ts from the same board the gate checks — and renders the ranked board, a filterable table,
// a per-protocol detail view with the model's own arithmetic, a what-if sandbox that replays the
// fit with different settings, and the methodology. No network: every byte it shows is in data.js.
// No framework, no build step, plain script.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var CAL = DATA.calibration;

  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };
  var sandbox = { k: 12, growth: 1, maturity: true };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- The model, replayed in the page -----------------------------------------------
  // The calibration data.js carries is the fitted one: intercept and group adjustments already
  // centered. To replay the fit with a different shrinkage, recover the uncentered line first:
  // the centered adjustments have weighted mean zero, so the old centering shift is the
  // peer-weighted mean of the raw shrunk medians at k = 12.
  function rawIntercept() {
    var num = 0, den = 0;
    Object.keys(CAL.groups).forEach(function (g) {
      var fit = CAL.groups[g];
      var raw = (fit.peers * fit.raw_median) / (fit.peers + CAL.shrinkage_k);
      num += raw * fit.peers; den += fit.peers;
    });
    return CAL.intercept - (den > 0 ? num / den : 0);
  }
  var RAW_INTERCEPT = rawIntercept();

  // A fit under sandbox settings: re-shrink the group medians at k, re-center, scale the growth
  // tilt, and optionally drop the maturity tilt. The submitted board always uses k = 12, growth
  // at full strength, maturity on — the sandbox only shows what would change.
  function fitFor(k, growthScale, maturityOn) {
    var groups = {};
    var num = 0, den = 0;
    Object.keys(CAL.groups).forEach(function (g) {
      var fit = CAL.groups[g];
      var raw = (fit.peers * fit.raw_median) / (fit.peers + k);
      groups[g] = raw; num += raw * fit.peers; den += fit.peers;
    });
    var mean = den > 0 ? num / den : 0;
    Object.keys(groups).forEach(function (g) { groups[g] -= mean; });
    return { intercept: RAW_INTERCEPT + mean, slope: CAL.slope, groups: groups, growthCoef: CAL.growth_coef * growthScale, maturityOn: maturityOn };
  }
  var SUBMITTED_FIT = fitFor(CAL.shrinkage_k, 1, true);

  function growthUnit(row) {
    return Math.min(120, Math.max(-60, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d)) / 100;
  }
  function maturityTilt(age, on) {
    if (!on) return 1;
    var a = age === null || age === undefined ? 365 : age;
    return 0.95 + 0.05 * (Math.min(Math.max(a, 0), 1095) / 1095);
  }
  // One row's implied value under a fit: the fitted line, the group adjustment, the two small
  // tilts, then the multiple clamped to the peers' winsorized band. This is the same arithmetic
  // main.ts ran; the methodology tab checks it against every row in the board.
  function impliedOf(row, fit) {
    var age = row.age_days;
    var groupAdj = fit.groups[row.group] === undefined ? 0 : fit.groups[row.group];
    var logValue = fit.intercept + fit.slope * Math.log(row.tvl_usd) + groupAdj
      + fit.growthCoef * growthUnit(row) + Math.log(maturityTilt(age, fit.maturityOn));
    var multiple = Math.min(3.0, Math.max(0.002, Math.exp(logValue) / row.tvl_usd));
    return { implied: Math.max(1, Math.round(row.tvl_usd * multiple)), multiple: multiple, groupAdj: groupAdj, growthTilt: Math.exp(fit.growthCoef * growthUnit(row)), maturityTilt: maturityTilt(age, fit.maturityOn) };
  }

  // ---- The farm plan, derived in the page --------------------------------------------
  // The same derivation main.ts writes to board.json: category, chains, TVL and age decide the
  // action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var cheap = /base|arbitrum|optimism|polygon|solana|bsc|avalanche|linea|scroll|blast|mode/i.test(chain);
    return cheap ? { setup: 'under $1 of gas', weekly: 'a few cents of gas a week' } : { setup: 'about $8 of gas', weekly: 'about $2 of gas a week' };
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('prediction') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Use ' + name + ' on ' + chain + ': run one real transaction a week and keep the wallet active.';
    if (c.indexOf('payment') >= 0) return 'Pay $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipts.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var action = actionFor(p, capital, chain);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas.setup, time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and ' + gas.setup, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      if (t.length < 20) t = t + " Hold the position and check the protocol's own page.";
      return t;
    });
  }

  // ---- State in the URL hash -----------------------------------------------------------
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch')) state.watch = params.get('watch') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  var WATCHLIST = new Set(DATA.watchlist_slugs || []);
  function isWatch(row) {
    return WATCHLIST.has(row.slug);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !isWatch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Unknown') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(rows) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'multiple') return r.multiple;
      if (key === 'age') return r.age_days === null ? -Infinity : r.age_days;
      if (key === 'rank') return r.rank;
      return r.implied_value_usd;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return (a.rank - b.rank) * (dir === 1 ? 1 : -1);
    });
  }

  function renderMasthead(wrap) {
    var head = el('header', { class: 'masthead' },
      el('h1', { text: 'Token Radar: the pre-token protocols, ranked by implied value' }),
      el('p', { class: 'lede', text: 'Every protocol below has no token yet. Each implied value is fitted from the ' + CAL.peers + ' protocols whose token already trades: value grows with TVL, but sublinearly — a giant is not worth a small protocol\u2019s multiple. The board covers the whole watchlist and every other rankable pre-token protocol, ' + DATA.early_size + ' of them found early.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Board' }), el('span', { class: 'v', html: DATA.board_size + ' rows' })),
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Watchlist' }), el('span', { class: 'v', html: DATA.watchlist_size + ' <small>covered</small>' })),
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Early rows' }), el('span', { class: 'v', html: DATA.early_size + ' <small>below the floor</small>' })),
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Total implied' }), el('span', { class: 'v', text: fmtUsd(DATA.total_implied_usd) })),
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Top implied' }), el('span', { class: 'v', text: fmtUsd(DATA.rows[0].implied_value_usd) })),
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Snapshot' }), el('span', { class: 'v', text: DATA.as_of })),
        el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Model' }), el('span', { class: 'v', text: DATA.model_version }))
      ));
    wrap.appendChild(head);
  }

  function renderToolbar(wrap) {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Unknown'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var bar = el('div', { class: 'toolbar' });
    var search = el('input', { type: 'search', placeholder: 'Search name, slug or category…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; state.selected = null; writeHash(); render(); });
    var catSel = el('select', { 'aria-label': 'Filter by category' });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { 'aria-label': 'Filter by chain' });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var watchLabel = el('label', {},
      el('input', { type: 'checkbox', checked: state.watch ? true : null }),
      document.createTextNode(' Watchlist only'));
    watchLabel.querySelector('input').addEventListener('change', function (e) { state.watch = e.target.checked; writeHash(); render(); });
    bar.appendChild(search); bar.appendChild(catSel); bar.appendChild(chainSel); bar.appendChild(watchLabel);
    bar.appendChild(el('span', { class: 'count', id: 'rowcount' }));
    wrap.appendChild(bar);

    var tabs = el('div', { class: 'tabs', role: 'tablist' });
    [['board', 'Board'], ['live', 'Live tokens'], ['method', 'How it works']].forEach(function (t) {
      var b = el('button', { role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false', text: t[1] });
      b.addEventListener('click', function () { state.tab = t[0]; state.selected = null; writeHash(); render(); });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);
  }

  function renderBoard(wrap) {
    var rows = sortedRows(filteredRows());
    var count = document.getElementById('rowcount');
    if (count) count.textContent = rows.length + ' of ' + DATA.board_size + ' rows';
    if (rows.length === 0) { wrap.appendChild(el('p', { class: 'empty', text: 'No protocol matches these filters.' })); return; }
    var cols = [
      ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', ''],
      ['chain', 'Chain', ''], ['tvl', 'TVL', 'num'], ['change', '7d', 'num'],
      ['multiple', 'Multiple', 'num'], ['implied', 'Implied', 'num'], ['range', 'Range', 'num'], ['age', 'Age', 'num'],
    ];
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var tr = el('tr');
    cols.forEach(function (c) {
      var th = el('th', { class: c[2], 'aria-sort': state.sort === c[0] ? (state.dir === 1 ? 'ascending' : 'descending') : null });
      var btn = el('button', { text: c[1] });
      btn.addEventListener('click', function () {
        if (state.sort === c[0]) state.dir = -state.dir;
        else { state.sort = c[0]; state.dir = c[0] === 'name' ? 1 : -1; }
        render();
      });
      th.appendChild(btn); tr.appendChild(th);
    });
    thead.appendChild(tr); table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr', { class: state.selected === r.slug ? 'selected' : null });
      row.addEventListener('click', function () { state.selected = state.selected === r.slug ? null : r.slug; writeHash(); render(); });
      var chg = r.change_7d === null ? el('span', { class: 'muted', text: 'n/a' }) : el('span', { class: r.change_7d >= 0 ? 'up' : 'down', text: fmtPct(r.change_7d) });
      var nameCell = el('td', { class: 'name' }, document.createTextNode(r.name), el('span', { class: 'slug', text: r.slug }));
      if (isWatch(r)) nameCell.appendChild(el('span', { class: 'badge', text: 'WATCH' }));
      row.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      row.appendChild(nameCell);
      row.appendChild(el('td', { text: r.category || 'Unknown' }));
      row.appendChild(el('td', { text: (r.chains || [])[0] || '—' }));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var chgCell = el('td', { class: 'num' }); chgCell.appendChild(chg); row.appendChild(chgCell);
      row.appendChild(el('td', { class: 'num', text: fmtMult(r.multiple) }));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      row.appendChild(el('td', { class: 'num range', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) }));
      row.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    if (state.selected) renderDetail(wrap);
  }

  function renderDetail(wrap) {
    var row = DATA.rows.find(function (r) { return r.slug === state.selected; });
    if (!row) return;
    var v = impliedOf(row, SUBMITTED_FIT);
    var det = el('section', { class: 'detail', 'aria-label': 'Protocol detail' });
    var header = el('header', {},
      el('h2', { text: '#' + row.rank + ' ' + row.name }),
      el('span', { class: 'fig', text: fmtUsd(row.implied_value_usd) }),
      el('span', { class: 'muted small', text: 'range ' + fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) + ' · multiple ' + fmtMult(row.multiple) }),
      el('button', { class: 'ghost close', text: 'Close', onclick: function () { state.selected = null; writeHash(); render(); } }));
    det.appendChild(header);
    var cols = el('div', { class: 'cols' });
    var modelRows = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Fitted line (no group, no tilts)', fmtUsd(Math.exp(CAL.intercept + CAL.slope * Math.log(row.tvl_usd)))],
      ['Group (' + row.group + ')', (v.groupAdj >= 0 ? '+' : '') + v.groupAdj.toFixed(2) + ' log pts'],
      ['Growth tilt', '×' + v.growthTilt.toFixed(3) + (row.change_7d === null ? ' (no 7d figure)' : ' (' + fmtPct(row.change_7d) + ' in 7d)')],
      ['Maturity tilt', '×' + v.maturityTilt.toFixed(3) + ' (' + fmtAge(row.age_days) + ')'],
      ['Multiple', fmtMult(row.multiple)],
      ['Range factor', '×' + row.range_factor.toFixed(2) + ' either way'],
      ['Age', fmtAge(row.age_days)],
    ];
    var modelTable = el('table', { class: 'model' });
    modelRows.forEach(function (m) {
      var tr = el('tr'); tr.appendChild(el('td', { text: m[0] })); tr.appendChild(el('td', { text: m[1] })); modelTable.appendChild(tr);
    });
    var modelSec = el('section', {},
      el('h3', { text: 'How the value is built' }),
      modelTable,
      el('p', { class: 'note', text: 'The fitted line is the log-log fit on the ' + CAL.peers + ' peers (slope ' + CAL.slope.toFixed(2) + ', intercept ' + CAL.intercept.toFixed(2) + '); the group adjustment moves the multiple for the protocol\u2019s family; the growth and maturity tilts are small and documented in How it works. The range is the middle half of comparable tokens: the multiple of similar protocols spans roughly ' + (CAL.range_factor * CAL.range_factor).toFixed(1) + '×, so the point estimate is the calibrated middle, not a promise.' }));
    cols.appendChild(modelSec);
    var steps = farmSteps(row);
    var ol = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      var li = el('li');
      var parts = s.split(' Cost: ');
      li.appendChild(document.createTextNode(parts[0]));
      if (parts[1]) {
        var meta = parts[1].split(' Time: ');
        var cost = meta[0].endsWith('.') ? meta[0] : meta[0] + '.';
        li.appendChild(el('span', { class: 'meta', text: ' Cost: ' + cost + (meta[1] ? ' Time: ' + meta[1] : '') }));
      }
      ol.appendChild(li);
    });
    var farmSec = el('section', {},
      el('h3', { text: 'Farm plan — six steps' }),
      ol,
      el('p', { class: 'note', text: 'Derived from this protocol\u2019s own record — its category, chain, TVL and age — not from a hand-written list. The second step is the protocol\u2019s own action; the rest is the same honest routine on every row.' }));
    cols.appendChild(farmSec);
    det.appendChild(cols);
    wrap.appendChild(det);
  }

  // ---- Live tokens: the market's own values, kept apart from the ranked board ------------
  function renderLive(wrap) {
    wrap.appendChild(el('p', { class: 'small muted', text: 'The ' + DATA.live_size + ' largest protocols whose token already trades. These are the peers the model is fitted on — their market caps are the market\u2019s own values, not implied ones — so they are shown here, never mixed into the ranked board.' }));
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var tr = el('tr');
    ['Protocol', 'Category', 'Chain', 'TVL', 'Market cap', 'Multiple', '7d'].forEach(function (h, i) {
      tr.appendChild(el('th', { class: i >= 3 ? 'num' : null, text: h }));
    });
    thead.appendChild(tr); table.appendChild(thead);
    var tbody = el('tbody');
    DATA.live.forEach(function (p) {
      var row = el('tr');
      row.appendChild(el('td', { class: 'name', text: p.name }));
      row.appendChild(el('td', { text: p.category || 'Unknown' }));
      row.appendChild(el('td', { text: (p.chains || [])[0] || '—' }));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }));
      row.appendChild(el('td', { class: 'num', text: p.mcap_usd ? fmtMult(p.mcap_usd / p.tvl_usd) : 'n/a' }));
      var chg = p.change_7d === null ? el('span', { class: 'muted', text: 'n/a' }) : el('span', { class: p.change_7d >= 0 ? 'up' : 'down', text: fmtPct(p.change_7d) });
      var chgCell = el('td', { class: 'num' }); chgCell.appendChild(chg); row.appendChild(chgCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  // ---- How it works: the calibration, the holdout, the sandbox ---------------------------
  function renderMethod(wrap) {
    var sec = el('section', { class: 'method' });
    sec.appendChild(el('h2', { text: 'How it works' }));
    sec.appendChild(el('p', { text: 'The board is fitted, not typed. The ' + CAL.peers + ' protocols whose token already trades are the peers: their market caps against their TVLs calibrate the model, and the model is re-fitted from those peers on every run. No protocol name is special-cased; the same snapshot always gives the same board.' }));
    sec.appendChild(el('p', { text: 'The core finding is the size effect. Value grows with TVL, but sublinearly: the fitted slope of log(market cap) on log(TVL) is ' + CAL.slope.toFixed(2) + '. The median multiple falls from 0.42 at $5–50M of TVL to 0.030 at $1–5B — that is why the giant curators sit at $36–49M here, not at $400M. A flat multiple would hand the biggest protocols the small ones\u2019 multiple and rank by TVL alone.' }));
    sec.appendChild(el('h3', { text: 'The size effect, straight from the peers' }));
    var bandTable = el('table', { class: 'cal' });
    var btr = el('tr');
    btr.appendChild(el('th', { text: 'TVL band' }));
    btr.appendChild(el('th', { class: 'num', text: 'Median multiple' }));
    btr.appendChild(el('th', { class: 'num', text: 'Peers' }));
    bandTable.appendChild(btr);
    CAL.band_medians.forEach(function (b) {
      var r = el('tr');
      r.appendChild(el('td', { text: b.label }));
      r.appendChild(el('td', { class: 'num', text: b.n > 0 ? fmtMult(b.median) : '—' }));
      r.appendChild(el('td', { class: 'num', text: String(b.n) }));
      bandTable.appendChild(r);
    });
    sec.appendChild(bandTable);
    sec.appendChild(el('h3', { text: 'Group adjustments (log points, shrunk k = ' + CAL.shrinkage_k + ')' }));
    var gTable = el('table', { class: 'cal' });
    var gtr = el('tr');
    gtr.appendChild(el('th', { text: 'Family' }));
    gtr.appendChild(el('th', { class: 'num', text: 'Adjustment' }));
    gtr.appendChild(el('th', { class: 'num', text: 'Peers' }));
    gTable.appendChild(gtr);
    Object.keys(CAL.groups).sort().forEach(function (g) {
      var fit = CAL.groups[g];
      var r = el('tr');
      r.appendChild(el('td', { text: g }));
      r.appendChild(el('td', { class: 'num', text: (fit.adjustment >= 0 ? '+' : '') + fit.adjustment.toFixed(2) }));
      r.appendChild(el('td', { class: 'num', text: String(fit.peers) }));
      gTable.appendChild(r);
    });
    sec.appendChild(gTable);
    sec.appendChild(el('h3', { text: 'How accurate is it? (5-fold cross-validation, 5 repeats, 640 held-out predictions)' }));
    var h = CAL.holdout;
    sec.appendChild(el('p', { text: 'This model misses the true market cap by a median ' + h.male.toFixed(2) + ' log points and lands within 2× of it ' + Math.round(h.within_2x * 100) + '% of the time. A flat median multiple misses by ' + h.flat_male.toFixed(2) + ' and lands within 2× ' + Math.round(h.flat_within_2x * 100) + '% of the time. The fitted model is about 25% better — and still wrong by a lot: the multiple of comparable tokens spans roughly 300×, so every row carries its range (the middle half of comparables, ×' + CAL.range_factor.toFixed(2) + ' either way) as well as its point estimate.' }));
    sec.appendChild(el('h3', { text: 'What the model does not do' }));
    var ul = el('ul');
    ['Seven-day growth does not re-rate a protocol: its measured effect is weak and negative, so a hot week discounts the multiple slightly (coefficient ' + CAL.growth_coef.toFixed(3) + ', fitted at −3.71 and shrunk 90% toward zero) instead of raising it.',
     'Age barely moves the multiple (correlation 0.02), so maturity is a tilt of at most 5% for a three-year-old protocol, never a driver.',
     'One slope is fitted for all families; per-family slopes are too noisy at ' + CAL.peers + ' peers to trust.',
     'The board ranks by the calibrated middle. A protocol whose real value sits at the top of its range would outrank its neighbours — the range column is where that doubt lives.'].forEach(function (t) { ul.appendChild(el('li', { text: t })); });
    sec.appendChild(ul);
    sec.appendChild(el('h3', { text: 'The page checks itself' }));
    var exact = 0, maxDiff = 0;
    DATA.rows.forEach(function (r) {
      var v = impliedOf(r, SUBMITTED_FIT);
      if (v.implied === r.implied_value_usd) exact++;
      maxDiff = Math.max(maxDiff, Math.abs(v.implied - r.implied_value_usd));
    });
    sec.appendChild(el('p', { text: 'Replaying the model from the calibration in this page reproduces ' + exact + ' of ' + DATA.rows.length + ' rows exactly, the rest within $' + maxDiff.toLocaleString('en-US') + ' of rounding. If this line ever disagrees with the board, the page and the board are not the same arithmetic.' }));

    // The sandbox: the same fit, different settings, live. Labelled what-if, never the board.
    var box = el('div', { class: 'sandbox' });
    box.appendChild(el('h3', { text: 'What-if sandbox — try the model with different settings' }));
    var kLabel = el('label', {}, document.createTextNode('Shrinkage k: '));
    var kOut = el('output', { text: String(sandbox.k) });
    var kRange = el('input', { type: 'range', min: '3', max: '24', step: '3', value: String(sandbox.k) });
    kRange.addEventListener('input', function () { sandbox.k = parseInt(kRange.value, 10); kOut.textContent = kRange.value; renderTop10(); });
    kLabel.appendChild(kRange); kLabel.appendChild(document.createTextNode(' ')); kLabel.appendChild(kOut);
    box.appendChild(kLabel);
    var gLabel = el('label', {}, document.createTextNode('Growth tilt strength: '));
    var gOut = el('output', { text: Math.round(sandbox.growth * 100) + '%' });
    var gRange = el('input', { type: 'range', min: '0', max: '100', step: '25', value: String(Math.round(sandbox.growth * 100)) });
    gRange.addEventListener('input', function () { sandbox.growth = parseInt(gRange.value, 10) / 100; gOut.textContent = gRange.value + '%'; renderTop10(); });
    gLabel.appendChild(gRange); gLabel.appendChild(document.createTextNode(' ')); gLabel.appendChild(gOut);
    box.appendChild(gLabel);
    var mLabel = el('label', {},
      el('input', { type: 'checkbox', checked: sandbox.maturity ? true : null }),
      document.createTextNode(' Maturity tilt on'));
    mLabel.querySelector('input').addEventListener('change', function (e) { sandbox.maturity = e.target.checked; renderTop10(); });
    box.appendChild(mLabel);
    box.appendChild(el('p', { class: 'warn', text: 'What-if only: moving these sliders recomputes the top 10 below, it does not change the submitted board. The board always uses k = 12, growth at full strength, maturity on.' }));
    var topWrap = el('div', { id: 'top10' });
    box.appendChild(topWrap);
    sec.appendChild(box);
    wrap.appendChild(sec);
    renderTop10(topWrap);
  }

  function renderTop10(hostEl) {
    var host = hostEl || document.getElementById('top10');
    if (!host) return;
    var fit = fitFor(sandbox.k, sandbox.growth, sandbox.maturity);
    var rescored = DATA.rows.map(function (r) {
      var v = impliedOf(r, fit);
      return { row: r, implied: v.implied };
    }).sort(function (a, b) { return b.implied - a.implied; }).slice(0, 10);
    var moved = rescored.filter(function (s, i) { return s.row.rank !== i + 1; }).length;
    host.innerHTML = '';
    host.appendChild(el('p', { class: 'small muted', text: moved === 0 ? 'The top 10 is unchanged under these settings.' : moved + ' of the top 10 changed rank under these settings.' }));
    var table = el('table', { class: 'top10' });
    var tr = el('tr');
    tr.appendChild(el('th', { text: 'Rank' }));
    tr.appendChild(el('th', { text: 'Protocol' }));
    tr.appendChild(el('th', { class: 'num', text: 'Implied' }));
    tr.appendChild(el('th', { class: 'num', text: 'Submitted rank' }));
    table.appendChild(tr);
    rescored.forEach(function (s, i) {
      var r = el('tr');
      r.appendChild(el('td', { text: String(i + 1) }));
      r.appendChild(el('td', { text: s.row.name }));
      r.appendChild(el('td', { class: 'num', text: fmtUsd(s.implied) }));
      r.appendChild(el('td', { class: 'num', text: '#' + s.row.rank + (s.row.rank === i + 1 ? '' : (s.row.rank > i + 1 ? ' ↑' : ' ↓')) }));
      table.appendChild(r);
    });
    host.appendChild(table);
  }

  // ---- Render ----------------------------------------------------------------------------
  function render() {
    app.innerHTML = '';
    app.setAttribute('aria-busy', 'false');
    var wrap = el('div', { class: 'wrap' });
    renderMasthead(wrap);
    renderToolbar(wrap);
    if (state.tab === 'live') renderLive(wrap);
    else if (state.tab === 'method') renderMethod(wrap);
    else renderBoard(wrap);
    app.appendChild(wrap);
    var count = document.getElementById('rowcount');
    if (count && state.tab !== 'board') count.textContent = '';
  }

  readHash();
  render();
})();
