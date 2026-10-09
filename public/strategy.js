(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Strategy = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function movingAverage(closes, period, kind) {
    const out = new Array(closes.length).fill(null);
    if (period < 2 || closes.length < period) return out;

    if (kind === "ema") {
      let seed = 0;
      for (let i = 0; i < period; i++) seed += closes[i];
      let ema = seed / period;
      out[period - 1] = ema;
      const k = 2 / (period + 1);
      for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
        out[i] = ema;
      }
      return out;
    }

    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function runBacktest(bars, options) {
    const period = options.period;
    const kind = options.kind === "hold" ? "hold" : options.kind === "ema" ? "ema" : "sma";
    const fee = options.fee == null ? 0.001 : options.fee;
    const initial = options.initial == null ? 10000 : options.initial;
    const closes = bars.map(function (bar) { return bar.close; });
    const ma = movingAverage(closes, period, kind);
    const start = options.startIndex == null
      ? Math.max(0, bars.length - (options.windowSize || bars.length))
      : Math.max(0, Math.min(options.startIndex, bars.length - 1));
    const end = options.endIndex == null
      ? bars.length - 1
      : Math.max(start, Math.min(options.endIndex, bars.length - 1));

    if (kind === "hold") {
      const buyPrice = bars[start].open;
      const coinHeld = (initial * (1 - fee)) / buyPrice;
      const points = [];
      let peak = initial;
      let maxDd = 0;
      for (let i = start; i <= end; i++) {
        const equity = coinHeld * bars[i].close;
        points.push({ index: i, equity: equity });
        peak = Math.max(peak, equity);
        maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);
      }
      const endEquity = points.length ? points[points.length - 1].equity : initial;
      return {
        ma: new Array(bars.length).fill(null),
        kind: "hold",
        period: period,
        start: start,
        end: end,
        points: points,
        trades: [{
          side: "buy",
          signalIndex: start,
          fillIndex: start,
          price: buyPrice,
          equity: points.length ? points[0].equity : initial,
        }],
        maxDd: maxDd,
        initial: initial,
        endEquity: endEquity,
        pnl: endEquity / initial - 1,
        holding: true,
        fee: fee,
      };
    }

    let cash = initial;
    let coin = 0;
    let pending = null;
    const points = [];
    const trades = [];
    let peak = initial;
    let maxDd = 0;

    for (let i = 0; i < bars.length; i++) {
      if (i > end) break;
      if (pending && i >= start) {
        const price = bars[i].open;
        if (pending.side === "buy" && coin === 0 && cash > 0) {
          coin = (cash * (1 - fee)) / price;
          cash = 0;
          trades.push({
            side: "buy",
            signalIndex: pending.signal,
            fillIndex: i,
            price: price,
            equity: null,
          });
        } else if (pending.side === "sell" && coin > 0) {
          cash = coin * price * (1 - fee);
          coin = 0;
          trades.push({
            side: "sell",
            signalIndex: pending.signal,
            fillIndex: i,
            price: price,
            equity: cash,
          });
        }
        pending = null;
      }

      if (i < start) continue;

      const equity = cash + coin * bars[i].close;
      if (trades.length && trades[trades.length - 1].equity == null) {
        trades[trades.length - 1].equity = equity;
      }
      points.push({ index: i, equity: equity });
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);

      if (i + 1 > end || ma[i] == null || ma[i - 1] == null) continue;

      const close = closes[i];
      const prev = closes[i - 1];
      if (coin > 0 && close < ma[i]) pending = { side: "sell", signal: i };
      else if (coin === 0 && close > ma[i] && prev <= ma[i - 1]) pending = { side: "buy", signal: i };
    }

    const endEquity = points.length ? points[points.length - 1].equity : initial;

    return {
      ma: ma,
      kind: kind,
      period: period,
      start: start,
      end: end,
      points: points,
      trades: trades,
      maxDd: maxDd,
      initial: initial,
      endEquity: endEquity,
      pnl: endEquity / initial - 1,
      holding: coin > 0,
      fee: fee,
    };
  }

  function runScalp(bars, options) {
    const fee = options.fee == null ? 0.001 : options.fee;
    const initial = options.initial == null ? 10000 : options.initial;
    const fastPeriod = 60;
    const slowPeriod = 180;
    const closes = bars.map(function (bar) { return bar.close; });
    const fast = movingAverage(closes, fastPeriod, "ema");
    const slow = movingAverage(closes, slowPeriod, "ema");
    const start = options.startIndex == null
      ? 0
      : Math.max(0, Math.min(options.startIndex, bars.length - 1));
    const end = options.endIndex == null
      ? bars.length - 1
      : Math.max(start, Math.min(options.endIndex, bars.length - 1));
    let cash = initial;
    let coin = 0;
    let pending = null;
    const points = [];
    const trades = [];
    let peak = initial;
    let maxDd = 0;

    for (let i = 0; i < bars.length; i++) {
      if (i > end) break;
      if (pending && i >= start) {
        const price = bars[i].open;
        if (pending.side === "buy" && coin === 0 && Math.round(cash) > 0) {
          coin = (cash * (1 - fee)) / price;
          cash = 0;
          trades.push({
            side: "buy",
            signalIndex: pending.signal,
            fillIndex: i,
            price: price,
            equity: null,
          });
        } else if (pending.side === "sell" && coin > 0 && Math.round(coin * price) > 0) {
          cash = coin * price * (1 - fee);
          coin = 0;
          trades.push({
            side: "sell",
            signalIndex: pending.signal,
            fillIndex: i,
            price: price,
            equity: cash,
          });
        }
        pending = null;
      }

      if (i < start) continue;

      const equity = cash + coin * bars[i].close;
      if (trades.length && trades[trades.length - 1].equity == null) {
        trades[trades.length - 1].equity = equity;
      }
      points.push({ index: i, equity: equity });
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);

      if (i + 1 > end || fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) continue;
      const worth = coin > 0 ? coin * bars[i].close : cash;
      if (Math.round(worth) <= 0) continue;
      const crossedUp = fast[i] > slow[i] && fast[i - 1] <= slow[i - 1];
      const crossedDown = fast[i] < slow[i] && fast[i - 1] >= slow[i - 1];
      if (coin === 0 && crossedUp) pending = { side: "buy", signal: i };
      else if (coin > 0 && crossedDown) pending = { side: "sell", signal: i };
    }

    const endEquity = points.length ? points[points.length - 1].equity : initial;
    return {
      ma: fast,
      trend: slow,
      fastPeriod: fastPeriod,
      slowPeriod: slowPeriod,
      kind: "scalp",
      period: fastPeriod,
      start: start,
      end: end,
      points: points,
      trades: trades,
      maxDd: maxDd,
      initial: initial,
      endEquity: endEquity,
      pnl: endEquity / initial - 1,
      holding: coin > 0,
      fee: fee,
    };
  }

  return { movingAverage: movingAverage, runBacktest: runBacktest, runScalp: runScalp };
});
