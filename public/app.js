(function () {
  const INITIAL = 10000;
  const state = {
    bars: [],
    mode: "daily",
    chartSymbol: "",
    symbol: "BTC-USD",
    symbolName: "비트코인",
    quote: "USD",
    venue: "야후 파이낸스",
    saved: { daily: null, scalp: null, stable: null },
    kind: "sma",
    period: 20,
    buyPrice: 1,
    sellPrice: 1.001,
    feePercent: 0,
    startIndex: 0,
    endIndex: 0,
    view: null,
    hover: null,
  };

  const board = document.getElementById("board");
  const status = document.getElementById("state");
  const priceCanvas = document.getElementById("price-chart");
  const equityCanvas = document.getElementById("equity-chart");

  function money(value) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function price(value) {
    const digits = state.mode === "stable" ? 4 : state.quote === "KRW" ? 0 : value >= 1000 ? 1 : value >= 1 ? 2 : 4;
    return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function cash(amount, signed) {
    const body = (signed && amount > 0 ? "+" : "") + money(amount);
    return state.quote === "KRW" ? body + "원" : body + " " + state.quote;
  }

  function axisTicks(min, max, count) {
    const span = max - min || 1;
    const raw = span / count;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const scaled = raw / pow;
    const nice = scaled >= 7.5 ? 10 : scaled >= 3.5 ? 5 : scaled >= 1.5 ? 2 : 1;
    const step = nice * pow;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let value = start; value <= max; value += step) ticks.push(value);
    return ticks;
  }

  function pct(value) {
    const sign = value > 0 ? "+" : "";
    return sign + (value * 100).toFixed(2) + "%";
  }

  function stampMs(value) {
    if (value.indexOf("T") !== -1) {
      const text = value.length === 16 ? value + ":00" : value;
      return Date.parse(text + "+09:00");
    }
    return Date.parse(value + "T00:00:00Z");
  }

  function annualReturn(pnl, startTime, endTime) {
    const elapsed = stampMs(endTime) - stampMs(startTime);
    const years = elapsed / (365.25 * 86400000);
    const growth = 1 + pnl;
    if (!(years > 0) || growth < 0) return pnl;
    if (growth === 0) return -1;
    return Math.pow(growth, 1 / years) - 1;
  }

  function tone(value) {
    return value > 0 ? "up" : value < 0 ? "down" : "";
  }

  function kindLabel() {
    if (state.kind === "hold") return "존버";
    return state.kind === "ema" ? "지수" : "단순";
  }

  function render() {
    const result = state.mode === "scalp"
      ? Strategy.runScalp(state.bars, {
        startIndex: state.startIndex,
        endIndex: state.endIndex,
        initial: INITIAL,
      })
      : state.mode === "stable"
      ? Strategy.runStable(state.bars, {
        buyPrice: state.buyPrice,
        sellPrice: state.sellPrice,
        fee: state.feePercent / 100,
        startIndex: state.startIndex,
        endIndex: state.endIndex,
        initial: INITIAL,
      })
      : Strategy.runBacktest(state.bars, {
        period: state.period,
        kind: state.kind,
        startIndex: state.startIndex,
        endIndex: state.endIndex,
        initial: INITIAL,
      });
    const last = state.bars[result.end];
    const first = state.bars[result.start];
    const pair = state.mode === "stable" ? state.symbolName : state.symbolName + " " + state.symbol;
    const clock = function (value) { return value.replace("T", " "); };
    document.getElementById("ma-legend").hidden = state.mode === "stable";
    document.getElementById("buy-level").hidden = state.mode !== "stable";
    document.getElementById("sell-level").hidden = state.mode !== "stable";
    if (state.mode === "scalp") {
      document.getElementById("page-title").textContent = "비트코인 초봉 단타";
      document.getElementById("price-title").textContent =
        pair + " " + clock(first.time) + " – " + clock(last.time);
      document.getElementById("range-note").textContent =
        state.venue + " " + pair + " 1초봉 " + clock(first.time) + "부터 " + clock(last.time) +
        "까지 " + (result.end - result.start + 1).toLocaleString("en-US") +
        "초, 한국시간. 1분 추세가 3분 추세를 위로 돌파하면 매수하고, 아래로 내려오면 매도합니다.";
    } else {
      document.getElementById("page-title").textContent = "현물 이평선 매매";
      document.getElementById("price-title").textContent =
        pair + " " + first.time + " – " + last.time;
      document.getElementById("range-note").textContent =
        state.venue + " " + pair + " 일봉 " + first.time + "부터 " + last.time +
        "까지 " + (result.end - result.start + 1) + "일. 선택한 기준으로 매매한 결과를 보여 줍니다.";
    }
    if (state.mode === "stable") {
      document.getElementById("page-title").textContent = "스테이블 코인";
      document.getElementById("price-title").textContent =
        pair + " " + first.time + " – " + last.time;
      document.getElementById("range-note").textContent =
        state.venue + " " + pair + " 일봉 " + first.time + "부터 " + last.time +
        "까지 " + (result.end - result.start + 1) + "일. 입력한 가격에 닿으면 매수하거나 매도합니다.";
    }

    document.getElementById("start-amount").innerHTML =
      "<span>시작 금액</span>" + cash(INITIAL);
    const profit = result.endEquity - INITIAL;
    const yearly = annualReturn(result.pnl, first.time, last.time);
    document.getElementById("stats").innerHTML = [
      stat(pct(result.pnl), "전략 수익률", tone(result.pnl)),
      stat(pct(yearly), "연평균 수익률", tone(yearly)),
      stat(cash(profit, true), "손익", tone(profit)),
      stat(cash(result.endEquity), result.holding ? "평가금, 보유 중" : "평가금, 현금"),
      stat(String(result.trades.filter(function (trade) { return trade.side === "buy"; }).length), "매수 횟수"),
      stat((result.maxDd * 100).toFixed(2) + "%", "최대 낙폭", result.maxDd > 0 ? "down" : ""),
    ].join("");

    const stake = cash(INITIAL);
    const particle = state.quote === "KRW" ? "을" : "를";
    document.getElementById("rules").innerHTML = state.mode === "stable"
      ? (result.valid
        ? "<li>현금일 때 그날 저가가 매수가 " + price(state.buyPrice) + " 이하면 그 가격에 전액 매수합니다.</li>" +
          "<li>USDC를 들고 있을 때 고가가 매도가 " + price(state.sellPrice) + " 이상이면 그 가격에 전량 매도합니다.</li>" +
          "<li>하루 안에 두 가격이 모두 닿으면, 들고 있던 물량은 먼저 팔고 비어 있으면 산 뒤 팝니다.</li>" +
          "<li>시작은 현금 " + stake + "입니다. 매수·매도 수수료는 " + state.feePercent + "%입니다.</li>"
        : "<li>매도가는 매수가보다 높아야 합니다.</li>")
      : state.mode === "scalp"
      ? "<li>짧은 추세는 최근 " + result.fastPeriod + "초, 긴 추세는 최근 " + result.slowPeriod + "초 지수이동평균입니다.</li>" +
        "<li>짧은 추세가 긴 추세를 위로 돌파하면 상승으로 보고, 다음 초 시가에 " + stake + particle + " 전액 매수합니다.</li>" +
        "<li>짧은 추세가 긴 추세 아래로 내려오면 하락으로 보고, 다음 초 시가에 전량 매도합니다.</li>" +
        "<li>추세가 유지되는 동안에는 다시 매매하지 않습니다. 평가금이 0 USDT가 되면 멈춥니다.</li>" +
        "<li>시작은 현금 " + stake + "입니다. 수수료는 매수·매도마다 0.10%이고, 현물만 거래합니다.</li>"
      : state.kind === "hold"
      ? "<li>구간 첫 시가에 " + stake + particle + " 전액 매수합니다.</li>" +
        "<li>구간이 끝날 때까지 매도하지 않고, 종료일 종가로 평가합니다.</li>" +
        "<li>매수 수수료 0.10%만 빠집니다.</li>"
      : "<li>일봉 종가가 확정된 뒤에 판단합니다.</li>" +
        "<li>종가가 이평을 위로 돌파하면 다음 시가에 전액 매수합니다.</li>" +
        "<li>종가가 이평 아래로 마감하면 다음 시가에 전량 매도합니다.</li>" +
        "<li>구간 시작은 현금 " + stake + "입니다. 수수료는 매수·매도마다 0.10%입니다.</li>";
    document.getElementById("equity-title").textContent = state.mode === "stable"
      ? "평가금 · 매수 " + price(state.buyPrice) + " · 매도 " + price(state.sellPrice)
      : state.mode === "scalp"
      ? "평가금 · 단타"
      : state.kind === "hold"
      ? "평가금 · 존버"
      : "평가금 · " + kindLabel() + " " + state.period + "일";

    let shownTrades = result.trades;
    if (state.mode === "scalp" && shownTrades.length > 150) {
      document.getElementById("trade-note").textContent =
        "체결 " + result.trades.length.toLocaleString("en-US") + "건 가운데 구간 시작부터 150건입니다.";
      shownTrades = shownTrades.slice(0, 150);
    } else {
      document.getElementById("trade-note").textContent = "";
    }
    const rows = shownTrades.map(function (trade) {
      const bar = state.bars[trade.fillIndex];
      const name = trade.side === "buy" ? "매수" : "매도";
      const cls = trade.side === "buy" ? "up" : "down";
      return "<tr><td class=\"" + cls + "\">" + name + "</td><td>" + bar.time.replace("T", " ") +
        "</td><td>" + price(trade.price) + "</td><td>" + (trade.equity == null ? "—" : money(trade.equity)) + "</td></tr>";
    });
    const startRow = "<tr><td>시작</td><td>" + state.bars[result.start].time.replace("T", " ") +
      "</td><td>—</td><td>" + money(INITIAL) + "</td></tr>";
    document.getElementById("trades").innerHTML = startRow + rows.join("");

    drawPrice(result);
    drawEquity(result);
    state.result = result;
  }

  function stat(value, label, className) {
    return "<div class=\"stat\"><b class=\"" + (className || "") + "\">" + value +
      "</b><em>" + label + "</em></div>";
  }

  function setupCanvas(canvas, cssHeight) {
    const width = canvas.clientWidth || 640;
    const height = cssHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx: ctx, width: width, height: height };
  }

  function visibleBounds(result) {
    let start = result.start;
    let end = result.end;
    if (state.view) {
      start = Math.max(start, Math.min(state.view.start, result.end));
      end = Math.min(end, Math.max(state.view.end, start));
    }
    if (end < start) return { start: result.start, end: result.end };
    return { start: start, end: end };
  }

  function sliceOf(result) {
    const bounds = visibleBounds(result);
    const bars = [];
    for (let i = bounds.start; i <= bounds.end; i++) {
      bars.push({
        bar: state.bars[i],
        ma: result.ma ? result.ma[i] : null,
        trend: result.trend ? result.trend[i] : null,
        index: i,
      });
    }
    return bars;
  }

  function rangeOf(bars) {
    let min = Infinity;
    let max = -Infinity;
    if (state.mode === "stable" && bars.length) {
      const lows = [];
      const highs = [];
      bars.forEach(function (item) {
        lows.push(item.bar.low);
        highs.push(item.bar.high);
      });
      lows.sort(function (a, b) { return a - b; });
      highs.sort(function (a, b) { return a - b; });
      const at = function (values, ratio) {
        return values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)))];
      };
      min = at(lows, 0.02);
      max = at(highs, 0.98);
      if (state.buyPrice > 0 && state.sellPrice > state.buyPrice) {
        min = Math.min(min, state.buyPrice, state.sellPrice);
        max = Math.max(max, state.buyPrice, state.sellPrice);
      }
    } else {
      bars.forEach(function (item) {
        let low = item.bar.low;
        let high = item.bar.high;
        if (item.ma != null) {
          low = Math.min(low, item.ma);
          high = Math.max(high, item.ma);
        }
        if (item.trend != null) {
          low = Math.min(low, item.trend);
          high = Math.max(high, item.trend);
        }
        min = Math.min(min, low);
        max = Math.max(max, high);
      });
    }
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.01 || 0.001;
    return { min: min - pad, max: max + pad };
  }

  function drawPrice(result) {
    const view = setupCanvas(priceCanvas, 420);
    const ctx = view.ctx;
    const pad = { l: 68, r: 16, t: 16, b: 28 };
    const plotW = view.width - pad.l - pad.r;
    const plotH = view.height - pad.t - pad.b;
    const bars = sliceOf(result);
    const range = rangeOf(bars);
    const slot = plotW / bars.length;

    function xAt(index) { return pad.l + slot * index + slot / 2; }
    function yAt(value) {
      return pad.t + (range.max - value) / (range.max - range.min) * plotH;
    }

    ctx.clearRect(0, 0, view.width, view.height);
    ctx.strokeStyle = "#2a2f36";
    ctx.fillStyle = "#9aa1a9";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    axisTicks(range.min, range.max, 4).forEach(function (value) {
      const y = yAt(value);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(view.width - pad.r, y);
      ctx.stroke();
      ctx.fillText(price(value), pad.l - 8, y + 4);
    });

    const dense = slot < 2.5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, plotW, plotH);
    ctx.clip();
    if (dense) {
      ctx.beginPath();
      ctx.strokeStyle = "#c8cdd4";
      ctx.lineWidth = 1.25;
      bars.forEach(function (item, index) {
        const x = xAt(index);
        const y = yAt(item.bar.close);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      bars.forEach(function (item, index) {
        const x = xAt(index);
        const up = item.bar.close >= item.bar.open;
        ctx.strokeStyle = up ? "#2fce85" : "#ef5b6a";
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(x, yAt(item.bar.high));
        ctx.lineTo(x, yAt(item.bar.low));
        ctx.stroke();
        const top = yAt(Math.max(item.bar.open, item.bar.close));
        const bottom = yAt(Math.min(item.bar.open, item.bar.close));
        const body = Math.max(1, bottom - top);
        const width = Math.max(1, slot * 0.62);
        ctx.fillRect(x - width / 2, top, width, body);
      });
    }

    function strokeSeries(pick, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      let started = false;
      bars.forEach(function (item, index) {
        const value = pick(item);
        if (value == null) return;
        const x = xAt(index);
        const y = yAt(value);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    strokeSeries(function (item) { return item.ma; }, "#e6b34d");
    strokeSeries(function (item) { return item.trend; }, "#7eb6ff");
    if (state.mode === "stable" && result.valid) {
      [result.buyPrice, result.sellPrice].forEach(function (level, index) {
        const y = yAt(level);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = index === 0 ? "#2fce85" : "#ef5b6a";
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(view.width - pad.r, y);
        ctx.stroke();
        ctx.restore();
      });
    }

    ["buy", "sell"].forEach(function (side) {
      const buy = side === "buy";
      ctx.beginPath();
      ctx.fillStyle = buy ? "#2fce85" : "#ef5b6a";
      result.trades.forEach(function (trade) {
        if (trade.side !== side) return;
        const local = trade.fillIndex - bars[0].index;
        if (local < 0 || local >= bars.length) return;
        const x = xAt(local);
        const anchor = dense ? bars[local].bar.close : (buy ? bars[local].bar.low : bars[local].bar.high);
        const y = yAt(anchor) + (buy ? 8 : -8);
        const size = dense ? 3.5 : 5;
        if (buy) {
          ctx.moveTo(x, y);
          ctx.lineTo(x - size, y + size);
          ctx.lineTo(x + size, y + size);
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x - size, y - size);
          ctx.lineTo(x + size, y - size);
        }
        ctx.closePath();
      });
      ctx.fill();
    });
    ctx.restore();

    ctx.fillStyle = "#9aa1a9";
    axisLabels(bars).forEach(function (label, index, labels) {
      const align = index === 0 ? "left" : index === labels.length - 1 ? "right" : "center";
      const x = align === "left" ? pad.l : align === "right" ? view.width - pad.r : xAt(label.index);
      ctx.textAlign = align;
      ctx.fillText(label.text, x, view.height - 8);
    });

    if (state.hover != null && state.hover.chart === "price" && bars[state.hover.index]) {
      const item = bars[state.hover.index];
      const x = xAt(state.hover.index);
      ctx.strokeStyle = "#9aa1a9";
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + plotH);
      ctx.stroke();
      const label = item.bar.time.replace("T", " ") + "  종가 " + price(item.bar.close) +
        (state.mode === "stable" ? "  저가 " + price(item.bar.low) + "  고가 " + price(item.bar.high)
          : item.trend == null ? (item.ma == null ? "" : "  이평 " + price(item.ma))
          : "  1분 " + price(item.ma) + "  3분 " + price(item.trend));
      ctx.fillStyle = "#181b1f";
      ctx.fillRect(pad.l + 8, 8, ctx.measureText(label).width + 12, 18);
      ctx.fillStyle = "#f3f4f6";
      ctx.textAlign = "left";
      ctx.fillText(label, pad.l + 14, 21);
    }

    priceCanvas._map = { bars: bars, slot: slot, pad: pad, plotW: plotW };
  }

  function drawEquity(result) {
    const view = setupCanvas(equityCanvas, 180);
    const ctx = view.ctx;
    const pad = { l: 68, r: 16, t: 12, b: 24 };
    const plotW = view.width - pad.l - pad.r;
    const plotH = view.height - pad.t - pad.b;
    const bounds = visibleBounds(result);
    const series = result.points.filter(function (point) {
      return point.index >= bounds.start && point.index <= bounds.end;
    });
    let min = Infinity;
    let max = -Infinity;
    series.forEach(function (point) {
      min = Math.min(min, point.equity);
      max = Math.max(max, point.equity);
    });
    if (!isFinite(min) || !isFinite(max)) {
      min = Math.min(INITIAL, result.endEquity);
      max = Math.max(INITIAL, result.endEquity);
    }
    const padValue = (max - min) * 0.08 || 1;
    min -= padValue;
    max += padValue;
    const slot = plotW / Math.max(series.length, 1);

    function xAt(index) { return pad.l + slot * index + slot / 2; }
    function yAt(value) { return pad.t + (max - value) / (max - min) * plotH; }

    ctx.clearRect(0, 0, view.width, view.height);
    ctx.strokeStyle = "#2a2f36";
    ctx.fillStyle = "#9aa1a9";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    axisTicks(min, max, 3).forEach(function (value) {
      const y = yAt(value);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(view.width - pad.r, y);
      ctx.stroke();
      ctx.fillText(money(value), pad.l - 8, y + 4);
    });

    function line(values, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      values.forEach(function (value, index) {
        const x = xAt(index);
        const y = yAt(value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    const yStart = yAt(INITIAL);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#9aa1a9";
    ctx.beginPath();
    ctx.moveTo(pad.l, yStart);
    ctx.lineTo(view.width - pad.r, yStart);
    ctx.stroke();
    ctx.restore();

    line(series.map(function (point) { return point.equity; }), "#e6b34d");

    ctx.fillStyle = "#9aa1a9";
    ctx.textAlign = "left";
    ctx.fillText("점선 시작 " + money(INITIAL), pad.l, view.height - 6);
    equityCanvas._map = { count: series.length, slot: slot, pad: pad };
  }

  function axisLabels(bars) {
    if (state.mode === "scalp") {
      const count = Math.min(4, bars.length);
      const labels = [];
      for (let step = 0; step < count; step += 1) {
        const index = count === 1 ? 0 : Math.round(step * (bars.length - 1) / (count - 1));
        labels.push({ index: index, text: bars[index].bar.time.slice(5, 16).replace("T", " ") });
      }
      return labels;
    }
    return yearLabels(bars);
  }

  function yearLabels(bars) {
    const labels = [];
    let seen = "";
    bars.forEach(function (item, index) {
      const year = item.bar.time.slice(0, 4);
      if (year === seen) return;
      seen = year;
      labels.push({ index: index, text: year });
    });
    return labels.length ? labels : [{ index: 0, text: bars[0].bar.time }];
  }

  function hoverIndex(canvas, event) {
    const map = canvas._map;
    if (!map) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = Math.floor((x - map.pad.l) / map.slot);
    const count = map.bars ? map.bars.length : map.count;
    if (index < 0 || index >= count) return null;
    return index;
  }

  function shownBounds() {
    if (!state.result) return { start: state.startIndex, end: state.endIndex };
    return visibleBounds(state.result);
  }

  function syncZoomCursor() {
    const zoomed = state.view != null;
    const cursor = zoomed ? "grab" : "crosshair";
    priceCanvas.style.cursor = cursor;
    equityCanvas.style.cursor = cursor;
  }

  function redrawCharts() {
    if (!state.result) return;
    syncZoomCursor();
    drawPrice(state.result);
    drawEquity(state.result);
  }

  function zoomChart(factor, focusRatio) {
    if (!state.bars.length || !state.result) return;
    const limitStart = state.startIndex;
    const limitEnd = state.endIndex;
    const limitSpan = Math.max(limitEnd - limitStart, 1);
    const shown = shownBounds();
    const span = Math.max(shown.end - shown.start, 1);
    const minSpan = Math.min(state.mode === "scalp" ? 59 : 29, limitSpan);
    let nextSpan = Math.round(span * factor);
    nextSpan = Math.max(minSpan, Math.min(limitSpan, nextSpan));
    if (nextSpan >= limitSpan) {
      if (!state.view) return;
      state.view = null;
      redrawCharts();
      return;
    }
    const ratio = Math.max(0, Math.min(1, focusRatio));
    const focus = shown.start + span * ratio;
    let nextStart = Math.round(focus - nextSpan * ratio);
    let nextEnd = nextStart + nextSpan;
    if (nextStart < limitStart) {
      nextEnd += limitStart - nextStart;
      nextStart = limitStart;
    }
    if (nextEnd > limitEnd) {
      nextStart -= nextEnd - limitEnd;
      nextEnd = limitEnd;
    }
    nextStart = Math.max(limitStart, nextStart);
    state.view = { start: nextStart, end: nextEnd };
    redrawCharts();
  }

  let zoomFrame = 0;
  let pendingZoom = null;
  function queueZoom(factor, focusRatio) {
    if (pendingZoom) pendingZoom.factor *= factor;
    else pendingZoom = { factor: factor, ratio: focusRatio };
    pendingZoom.ratio = focusRatio;
    if (zoomFrame) return;
    zoomFrame = requestAnimationFrame(function () {
      zoomFrame = 0;
      const next = pendingZoom;
      pendingZoom = null;
      if (next) zoomChart(next.factor, next.ratio);
    });
  }

  function chartFocus(canvas, event) {
    const map = canvas._map;
    if (!map) return 0.5;
    const count = map.bars ? map.bars.length : map.count;
    const rect = canvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - map.pad.l) / (map.slot * count);
    return Math.max(0, Math.min(1, ratio));
  }

  function onChartWheel(event) {
    if (!state.bars.length) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const factor = Math.max(0.5, Math.min(2, Math.exp(delta * 0.0015)));
    queueZoom(factor, chartFocus(event.currentTarget, event));
  }

  priceCanvas.addEventListener("wheel", onChartWheel, { passive: false });
  equityCanvas.addEventListener("wheel", onChartWheel, { passive: false });
  document.getElementById("zoom-in").addEventListener("click", function () { zoomChart(0.5, 0.5); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoomChart(2, 0.5); });

  let pan = null;
  function beginPan(event) {
    if (event.button !== 0 || !state.view || !event.currentTarget._map) return;
    pan = {
      x: event.clientX,
      start: state.view.start,
      end: state.view.end,
      slot: event.currentTarget._map.slot,
    };
    event.currentTarget.style.cursor = "grabbing";
  }
  function movePan(event) {
    if (!pan) return;
    const span = pan.end - pan.start;
    const shift = Math.round((pan.x - event.clientX) / Math.max(pan.slot, 0.01));
    let start = pan.start + shift;
    let end = start + span;
    if (start < state.startIndex) {
      start = state.startIndex;
      end = start + span;
    }
    if (end > state.endIndex) {
      end = state.endIndex;
      start = end - span;
    }
    state.view = { start: Math.max(state.startIndex, start), end: end };
    redrawCharts();
  }
  function endPan() {
    if (!pan) return;
    pan = null;
    syncZoomCursor();
  }
  priceCanvas.addEventListener("mousedown", beginPan);
  equityCanvas.addEventListener("mousedown", beginPan);
  window.addEventListener("mousemove", movePan);
  window.addEventListener("mouseup", endPan);
  priceCanvas.addEventListener("dblclick", function () {
    if (!state.view) return;
    state.view = null;
    redrawCharts();
  });

  priceCanvas.addEventListener("mousemove", function (event) {
    if (pan) return;
    const index = hoverIndex(priceCanvas, event);
    state.hover = index == null ? null : { chart: "price", index: index };
    if (state.result) drawPrice(state.result);
  });
  priceCanvas.addEventListener("mouseleave", function () {
    state.hover = null;
    if (state.result) drawPrice(state.result);
  });

  function selectKind(kind) {
    state.kind = kind;
    const hold = kind === "hold";
    document.querySelectorAll("#kinds button").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.kind === kind ? "true" : "false");
    });
    document.querySelectorAll("#periods button").forEach(function (button) {
      button.disabled = hold;
    });
    document.getElementById("custom-period").disabled = hold;
    render();
    renderFavorites();
  }

  function selectPeriod(period) {
    const next = Math.min(200, Math.max(2, period));
    state.period = next;
    document.getElementById("custom-period").value = String(next);
    document.querySelectorAll("#periods button").forEach(function (button) {
      button.setAttribute("aria-pressed", Number(button.dataset.period) === next ? "true" : "false");
    });
    render();
    renderFavorites();
  }

  document.getElementById("kinds").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (button) selectKind(button.dataset.kind);
  });
  document.getElementById("periods").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (button) selectPeriod(Number(button.dataset.period));
  });
  document.getElementById("custom-period").addEventListener("change", function (event) {
    selectPeriod(Number(event.target.value));
  });

  function setRange(start, end, anchor, preserve) {
    const shiftNote = document.getElementById("shift-note");
    if (shiftNote) shiftNote.hidden = true;
    state.view = null;
    const last = state.bars.length - 1;
    const minSpan = Math.min(state.mode === "scalp" ? 59 : 29, last);
    start = Math.max(0, Math.min(last, Math.round(start)));
    end = Math.max(0, Math.min(last, Math.round(end)));
    if (!preserve && end - start < minSpan) {
      if (anchor === "end") start = Math.max(0, end - minSpan);
      else end = Math.min(last, start + minSpan);
      if (end - start < minSpan) start = Math.max(0, end - minSpan);
    }
    state.startIndex = start;
    state.endIndex = end;
    ["start", "end"].forEach(function (name) {
      const index = name === "start" ? start : end;
      const bar = state.bars[index];
      const date = document.getElementById(name + "-date");
      const range = document.getElementById(name + "-range");
      date.min = state.bars[0].time;
      date.max = state.bars[last].time;
      date.value = bar.time;
      range.min = "0";
      range.max = String(last);
      range.value = String(index);
    });
    const dual = document.getElementById("dual-range");
    const fill = document.getElementById("dual-fill");
    const span = Math.max(dual.clientWidth - 16, 1);
    const left = 8 + (start / last) * span;
    const right = 8 + (end / last) * span;
    fill.style.left = left + "px";
    fill.style.width = Math.max(0, right - left) + "px";
    document.querySelectorAll("#windows button").forEach(function (button) {
      const years = Number(button.dataset.years || 0);
      const presetMode = state.mode === "stable" ? "daily" : state.mode;
      button.hidden = button.dataset.mode !== presetMode || (years > 0 && !assetCoversYears(years));
      if (button.hidden) {
        button.setAttribute("aria-pressed", "false");
        return;
      }
      const amount = button.dataset.seconds || button.dataset.days;
      let matches = false;
      if (years > 0) {
        const presetStart = indexOnOrAfter(yearsBefore(state.bars[end].time, years));
        matches = start === presetStart && end === state.endIndex;
      } else {
        const span = amount === "all" ? state.bars.length : Number(amount);
        const presetStart = amount === "all" ? 0 : Math.max(0, end - (span - 1));
        matches = start === presetStart && (amount === "all" ? end === last : end - start + 1 === Math.min(span, last + 1));
      }
      button.setAttribute("aria-pressed", matches ? "true" : "false");
    });
    render();
    renderFavorites();
  }

  function assetCoversYears(years) {
    if (state.bars.length < 2) return false;
    const span = state.bars[state.bars.length - 1].ts - state.bars[0].ts;
    return span >= years * 365.25 * 86400000;
  }

  function yearsBefore(time, years) {
    const date = new Date(time.slice(0, 10) + "T00:00:00Z");
    date.setUTCFullYear(date.getUTCFullYear() - years);
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return date.getUTCFullYear() + "-" + month + "-" + day + time.slice(10);
  }

  function indexOnOrAfter(iso) {
    const found = state.bars.findIndex(function (bar) { return bar.time >= iso; });
    return found === -1 ? state.bars.length - 1 : found;
  }

  function indexOnOrBefore(iso) {
    for (let index = state.bars.length - 1; index >= 0; index -= 1) {
      if (state.bars[index].time <= iso) return index;
    }
    return 0;
  }

  function indexNear(iso) {
    const target = stampMs(iso);
    let best = 0;
    let bestDist = Infinity;
    state.bars.forEach(function (bar, index) {
      const dist = Math.abs(bar.ts - target);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    return best;
  }

  const rangeFill = document.getElementById("dual-fill");
  let rangeShift = null;

  function indexAtPointer(clientX) {
    const dual = document.getElementById("dual-range");
    const span = Math.max(dual.clientWidth - 16, 1);
    const last = Math.max(state.bars.length - 1, 1);
    return ((clientX - dual.getBoundingClientRect().left - 8) / span) * last;
  }

  rangeFill.addEventListener("pointerdown", function (event) {
    if (!state.bars.length || event.button !== 0) return;
    rangeShift = {
      pointerId: event.pointerId,
      origin: indexAtPointer(event.clientX),
      start: state.startIndex,
      end: state.endIndex,
    };
    rangeFill.setPointerCapture(event.pointerId);
    rangeFill.classList.add("dragging");
    event.preventDefault();
  });
  rangeFill.addEventListener("pointermove", function (event) {
    if (!rangeShift || event.pointerId !== rangeShift.pointerId) return;
    const delta = Math.round(indexAtPointer(event.clientX) - rangeShift.origin);
    const width = rangeShift.end - rangeShift.start;
    const last = state.bars.length - 1;
    let start = rangeShift.start + delta;
    let end = rangeShift.end + delta;
    if (start < 0) {
      start = 0;
      end = width;
    }
    if (end > last) {
      end = last;
      start = Math.max(0, last - width);
    }
    if (start === state.startIndex && end === state.endIndex) return;
    setRange(start, end, "both", true);
  });
  function stopRangeShift(event) {
    if (!rangeShift || event.pointerId !== rangeShift.pointerId) return;
    rangeShift = null;
    rangeFill.classList.remove("dragging");
  }
  rangeFill.addEventListener("pointerup", stopRangeShift);
  rangeFill.addEventListener("pointercancel", stopRangeShift);

  function indexAtOrAfterTs(ts) {
    const found = state.bars.findIndex(function (bar) { return bar.ts >= ts; });
    return found === -1 ? state.bars.length - 1 : found;
  }

  function indexAtOrBeforeTs(ts) {
    for (let index = state.bars.length - 1; index >= 0; index -= 1) {
      if (state.bars[index].ts <= ts) return index;
    }
    return 0;
  }

  function dateParts(ts) {
    const date = new Date(ts);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  function calendarDiff(startTs, endTs) {
    const start = dateParts(startTs);
    const end = dateParts(endTs);
    let years = end.year - start.year;
    let months = end.month - start.month;
    let days = end.day - start.day;
    if (days < 0) {
      months -= 1;
      const previous = end.month === 0 ? 11 : end.month - 1;
      const year = end.month === 0 ? end.year - 1 : end.year;
      days += daysInMonth(year, previous);
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    return { years: years, months: months, days: days };
  }

  function addCalendar(ts, diff, sign) {
    const part = dateParts(ts);
    const totalMonths = part.year * 12 + part.month + sign * (diff.years * 12 + diff.months);
    const year = Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const day = Math.min(part.day, daysInMonth(year, month));
    return Date.UTC(year, month, day) + sign * diff.days * 86400000;
  }

  function shiftWindow(direction) {
    const note = document.getElementById("shift-note");
    const startBar = state.bars[state.startIndex];
    const endBar = state.bars[state.endIndex];
    let nextStartTs;
    let nextEndTs;
    if (state.mode === "scalp") {
      const duration = endBar.ts - startBar.ts;
      nextStartTs = direction < 0 ? startBar.ts - 1000 - duration : endBar.ts + 1000;
      nextEndTs = nextStartTs + duration;
    } else {
      const diff = calendarDiff(startBar.ts, endBar.ts);
      if (direction < 0) {
        nextEndTs = startBar.ts - 86400000;
        nextStartTs = addCalendar(nextEndTs, diff, -1);
      } else {
        nextStartTs = endBar.ts + 86400000;
        nextEndTs = addCalendar(nextStartTs, diff, 1);
      }
    }
    const firstTs = state.bars[0].ts;
    const lastTs = state.bars[state.bars.length - 1].ts;
    const fits = nextStartTs >= firstTs && nextEndTs <= lastTs;
    if (!fits) {
      note.hidden = false;
      note.textContent = direction < 0
        ? "이전으로 같은 길이만큼 옮길 수 없습니다."
        : "이후로 같은 길이만큼 옮길 수 없습니다.";
      return;
    }
    const start = indexAtOrAfterTs(nextStartTs);
    const end = indexAtOrBeforeTs(nextEndTs);
    if (end <= start) {
      note.hidden = false;
      note.textContent = direction < 0
        ? "이전으로 같은 길이만큼 옮길 수 없습니다."
        : "이후로 같은 길이만큼 옮길 수 없습니다.";
      return;
    }
    setRange(start, end, "both", true);
  }

  document.getElementById("shift-back").addEventListener("click", function () { shiftWindow(-1); });
  document.getElementById("shift-forward").addEventListener("click", function () { shiftWindow(1); });

  document.getElementById("start-range").addEventListener("pointerdown", function () {
    this.style.zIndex = "3";
    document.getElementById("end-range").style.zIndex = "2";
  });
  document.getElementById("end-range").addEventListener("pointerdown", function () {
    this.style.zIndex = "3";
    document.getElementById("start-range").style.zIndex = "2";
  });
  document.getElementById("start-range").addEventListener("input", function (event) {
    setRange(Number(event.target.value), state.endIndex, "start");
  });
  document.getElementById("end-range").addEventListener("input", function (event) {
    setRange(state.startIndex, Number(event.target.value), "end");
  });
  document.getElementById("start-date").addEventListener("change", function (event) {
    setRange(indexNear(event.target.value), state.endIndex, "start");
  });
  document.getElementById("end-date").addEventListener("change", function (event) {
    setRange(state.startIndex, indexNear(event.target.value), "end");
  });
  document.getElementById("windows").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button || button.hidden) return;
    const last = state.bars.length - 1;
    if (button.dataset.years) {
      const end = state.endIndex;
      const start = indexOnOrAfter(yearsBefore(state.bars[end].time, Number(button.dataset.years)));
      setRange(Math.min(start, end), end, "both");
      return;
    }
    if (button.dataset.seconds) {
      if (button.dataset.seconds === "all") {
        setRange(0, last, "both");
        return;
      }
      const span = Number(button.dataset.seconds);
      let end = state.endIndex;
      let start = end - (span - 1);
      if (start < 0) {
        start = 0;
        end = Math.min(last, span - 1);
      }
      setRange(start, end, "both");
      return;
    }
    if (button.dataset.days === "all") {
      setRange(0, last, "both");
      return;
    }
    const days = Number(button.dataset.days);
    let end = state.endIndex;
    let start = end - (days - 1);
    if (start < 0) {
      start = 0;
      end = Math.min(last, days - 1);
    }
    setRange(start, end, "both");
  });

  window.addEventListener("resize", function () {
    if (!state.bars.length) return;
    setRange(state.startIndex, state.endIndex, "both");
  });

  const symbolSelect = document.getElementById("symbols");

  let symbolToken = 0;

  function loadSymbol(symbol, favorite) {
    const request = ++symbolToken;
    symbolSelect.value = symbol;
    symbolSelect.disabled = true;
    fetch("api/klines?symbol=" + encodeURIComponent(symbol))
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (request !== symbolToken) return;
        if (data.error) throw new Error(data.error);
        if (!data.bars || data.bars.length < 30) throw new Error("일봉이 너무 적습니다.");
        const previous = favorite
          ? { start: favorite.start, end: favorite.end, favorite: favorite }
          : state.bars.length
          ? { start: state.bars[state.startIndex].time, end: state.bars[state.endIndex].time }
          : null;
        const snapshot = {
          bars: data.bars,
          symbol: data.symbol,
          symbolName: data.name,
          quote: data.quote || "USD",
          venue: data.venue || "",
          start: 0,
          end: data.bars.length - 1,
        };
        if (state.mode !== "daily") {
          state.saved.daily = snapshot;
          return;
        }
        state.loadedMode = "daily";
        state.chartSymbol = snapshot.symbol;
        state.symbol = snapshot.symbol;
        state.symbolName = snapshot.symbolName;
        state.quote = snapshot.quote;
        state.venue = snapshot.venue;
        state.bars = snapshot.bars;
        status.hidden = true;
        board.hidden = false;
        requestAnimationFrame(function () {
          if (request !== symbolToken) return;
          const savedFavorite = previous && previous.favorite;
          const first = state.bars[0].time;
          const last = state.bars[state.bars.length - 1].time;
          const startInside = previous && (savedFavorite || (previous.start >= first && previous.start <= last));
          let start = 0;
          let end = state.bars.length - 1;
          if (startInside) {
            const endTime = previous.end > last ? last : previous.end;
            const startTime = savedFavorite && previous.start < first ? first : previous.start;
            start = indexOnOrAfter(startTime);
            end = indexOnOrBefore(endTime);
            if (end <= start) {
              start = 0;
              end = state.bars.length - 1;
            }
          }
          state.startIndex = start;
          state.endIndex = end;
          if (savedFavorite) {
            selectKind(savedFavorite.kind);
            selectPeriod(Number(savedFavorite.period));
          }
          setRange(start, end, "both", startInside);
        });
      })
      .catch(function (error) {
        if (request !== symbolToken) return;
        symbolSelect.value = state.symbol;
        status.hidden = false;
        status.className = "status error";
        status.textContent = "시세를 가져오지 못했습니다. " + error.message;
      })
      .finally(function () {
        if (request === symbolToken) symbolSelect.disabled = false;
      });
  }

  const FAVORITES_KEY = "cointrading.favorites";

  function readFavorites() {
    try {
      const items = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      return Array.isArray(items) ? items : [];
    } catch (error) {
      return [];
    }
  }

  function writeFavorites(items) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  }

  function favoriteName(existing) {
    const ma = state.kind === "hold" ? "존버" : kindLabel() + state.period + "일";
    const pressed = document.querySelector("#windows button[aria-pressed='true']:not([hidden])");
    const start = state.bars[state.startIndex].time.slice(0, 10);
    const end = state.bars[state.endIndex].time.slice(0, 10);
    const span = pressed ? pressed.textContent : start + "~" + end;
    let name = state.symbolName + "_" + ma + "_" + span;
    if (existing.some(function (item) { return item.name === name; })) {
      name = state.symbolName + "_" + ma + "_" + start + "~" + end;
    }
    return name;
  }

  function favoriteActive(item) {
    if (state.mode !== "daily" || state.symbol !== item.symbol || !state.bars.length) return false;
    if (item.kind !== state.kind) return false;
    if (item.kind !== "hold" && Number(item.period) !== state.period) return false;
    return indexOnOrAfter(item.start) === state.startIndex && indexOnOrBefore(item.end) === state.endIndex;
  }

  let favoriteDrag = null;
  let favoriteIgnoreClick = false;

  function renderFavorites() {
    if (favoriteDrag) return;
    const list = document.getElementById("favorite-list");
    if (!list) return;
    const items = readFavorites();
    if (!items.length) {
      list.innerHTML = "<li class=\"favorite-empty\">저장된 즐겨찾기가 없습니다.</li>";
      return;
    }
    list.innerHTML = items.map(function (item) {
      const pressed = favoriteActive(item) ? "true" : "false";
      return "<li><button type=\"button\" class=\"favorite-open\" data-id=\"" + escapeHtml(item.id) +
        "\" aria-pressed=\"" + pressed + "\">" + escapeHtml(item.name) +
        "</button><button type=\"button\" class=\"favorite-remove\" data-id=\"" + escapeHtml(item.id) +
        "\" aria-label=\"" + escapeHtml(item.name) + " 삭제\">×</button></li>";
    }).join("");
  }

  function addFavorite() {
    if (state.mode !== "daily" || !state.bars.length) return;
    const start = state.bars[state.startIndex].time;
    const end = state.bars[state.endIndex].time;
    const items = readFavorites();
    const same = items.some(function (item) {
      return item.symbol === state.symbol && item.kind === state.kind && Number(item.period) === state.period &&
        item.start === start && item.end === end;
    });
    if (same) {
      renderFavorites();
      return;
    }
    items.unshift({
      id: String(Date.now()),
      name: favoriteName(items),
      symbol: state.symbol,
      kind: state.kind,
      period: state.period,
      start: start,
      end: end,
    });
    writeFavorites(items);
    renderFavorites();
  }

  function openFavorite(id) {
    const item = readFavorites().find(function (saved) { return saved.id === id; });
    if (!item || state.mode !== "daily") return;
    if (state.symbol === item.symbol && state.bars.length && state.loadedMode === "daily") {
      selectKind(item.kind);
      selectPeriod(Number(item.period));
      const start = indexOnOrAfter(item.start);
      const end = indexOnOrBefore(item.end);
      if (end > start) setRange(start, end, "both", true);
      else setRange(0, state.bars.length - 1, "both");
      return;
    }
    loadSymbol(item.symbol, item);
  }

  document.getElementById("favorite-add").addEventListener("click", addFavorite);
  const favoriteList = document.getElementById("favorite-list");

  function favoriteItemAt(x, y) {
    const under = document.elementFromPoint(x, y);
    const item = under && under.closest("#favorite-list li");
    if (!item || !item.querySelector(".favorite-open")) return null;
    return item;
  }

  favoriteList.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || event.target.closest(".favorite-remove")) return;
    const item = event.target.closest("li");
    const open = item && item.querySelector(".favorite-open");
    if (!open) return;
    favoriteDrag = {
      pointerId: event.pointerId,
      id: open.dataset.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  });

  window.addEventListener("pointermove", function (event) {
    if (!favoriteDrag || event.pointerId !== favoriteDrag.pointerId) return;
    const item = favoriteList.querySelector('.favorite-open[data-id="' + favoriteDrag.id + '"]');
    const row = item && item.closest("li");
    if (!row) return;
    const dx = event.clientX - favoriteDrag.startX;
    const dy = event.clientY - favoriteDrag.startY;
    if (!favoriteDrag.moved) {
      if (dx * dx + dy * dy < 25) return;
      favoriteDrag.moved = true;
      const rect = row.getBoundingClientRect();
      const ghost = row.cloneNode(true);
      ghost.classList.add("favorite-ghost");
      ghost.style.width = rect.width + "px";
      ghost.style.left = rect.left + "px";
      ghost.style.top = rect.top + "px";
      document.body.appendChild(ghost);
      favoriteDrag.ghost = ghost;
      favoriteDrag.offsetX = event.clientX - rect.left;
      favoriteDrag.offsetY = event.clientY - rect.top;
      row.classList.add("dragging");
    }
    favoriteDrag.ghost.style.left = (event.clientX - favoriteDrag.offsetX) + "px";
    favoriteDrag.ghost.style.top = (event.clientY - favoriteDrag.offsetY) + "px";
    const target = favoriteItemAt(event.clientX, event.clientY);
    if (!target || target === row) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    row.parentNode.insertBefore(row, before ? target : target.nextSibling);
  });

  function finishFavoriteDrag(event) {
    if (!favoriteDrag || event.pointerId !== favoriteDrag.pointerId) return;
    const moved = favoriteDrag.moved;
    if (favoriteDrag.ghost) favoriteDrag.ghost.remove();
    favoriteDrag = null;
    if (!moved) return;
    favoriteIgnoreClick = true;
    const ids = Array.prototype.map.call(favoriteList.querySelectorAll(".favorite-open"), function (button) {
      return button.dataset.id;
    });
    const items = readFavorites();
    const next = ids.map(function (id) {
      return items.find(function (item) { return item.id === id; });
    }).filter(Boolean);
    items.forEach(function (item) {
      if (next.indexOf(item) === -1) next.push(item);
    });
    writeFavorites(next);
    renderFavorites();
  }

  window.addEventListener("pointerup", finishFavoriteDrag);
  window.addEventListener("pointercancel", finishFavoriteDrag);

  favoriteList.addEventListener("click", function (event) {
    if (favoriteIgnoreClick) {
      favoriteIgnoreClick = false;
      event.preventDefault();
      return;
    }
    const remove = event.target.closest(".favorite-remove");
    if (remove) {
      writeFavorites(readFavorites().filter(function (item) { return item.id !== remove.dataset.id; }));
      renderFavorites();
      return;
    }
    const open = event.target.closest(".favorite-open");
    if (open) openFavorite(open.dataset.id);
  });

  function remember(mode) {
    state.saved[mode] = {
      bars: state.bars,
      start: state.startIndex,
      end: state.endIndex,
      symbol: state.symbol,
      symbolName: state.symbolName,
      quote: state.quote,
      venue: state.venue,
    };
  }

  function applyPage(mode) {
    document.querySelectorAll("[data-page]").forEach(function (element) {
      element.hidden = element.dataset.page.split(/\s+/).indexOf(mode) === -1;
    });
    document.querySelector(".controls").classList.toggle("framed", mode === "daily" || mode === "stable");
    if (mode === "news" || mode === "x") {
      board.hidden = true;
      status.hidden = true;
    }
  }

  function restore(mode) {
    const saved = state.saved[mode];
    state.loadedMode = mode;
    state.chartSymbol = saved.symbol;
    state.bars = saved.bars;
    state.symbol = saved.symbol;
    state.symbolName = saved.symbolName;
    state.quote = saved.quote;
    state.venue = saved.venue;
    if (mode === "daily") symbolSelect.value = saved.symbol;
    status.hidden = true;
    board.hidden = false;
    requestAnimationFrame(function () {
      setRange(saved.start, saved.end, "both", true);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
    });
  }

  let newsToken = 0;
  let articleToken = 0;
  const browserTranslator = { pending: null, ready: null };
  state.newsItems = [];
  state.newsNote = "";

  function mostlyKorean(text) {
    const hangul = (String(text).match(/[가-힣]/g) || []).length;
    const latin = (String(text).match(/[A-Za-z]/g) || []).length;
    return hangul > 0 && hangul >= latin;
  }

  const LANGUAGE_NAMES = {
    en: "영어", ja: "일본어", zh: "중국어", es: "스페인어", fr: "프랑스어",
    de: "독일어", pt: "포르투갈어", ru: "러시아어", ar: "아랍어", hi: "힌디어",
    th: "태국어", vi: "베트남어", id: "인도네시아어", tr: "터키어", it: "이탈리아어",
  };
  const LANG_ALIAS = { in: "id", iw: "he", jw: "jv" };
  const koreanTranslators = {};
  let languageDetectorPromise = null;

  function languageName(code) {
    return LANGUAGE_NAMES[code] || code;
  }

  function sourceLanguage(code) {
    let value = String(code || "").toLowerCase();
    if (!value || value === "und" || value === "zxx" || value.charAt(0) === "q") return "";
    value = value.split("-")[0].split("_")[0];
    value = LANG_ALIAS[value] || value;
    return /^[a-z]{2,3}$/.test(value) ? value : "";
  }

  function knownSource(node) {
    const text = node.textContent || "";
    if (mostlyKorean(text)) return "ko";
    const tagged = sourceLanguage(node.getAttribute("data-lang"));
    const kana = (text.match(/[ぁ-んァ-ン]/g) || []).length;
    const han = (text.match(/[一-龯]/g) || []).length;
    if (kana >= 2 && (!tagged || tagged === "en" || tagged === "zh")) return "ja";
    if (han >= 2 && kana === 0 && (!tagged || tagged === "en")) return "zh";
    if (tagged) return tagged;
    return "";
  }

  function needsClick(error) {
    if (!error) return false;
    return error.name === "NotAllowedError" || /user gesture|user activation|not allowed/i.test(String(error.message || ""));
  }

  function downloadMonitor(label) {
    return function (monitor) {
      monitor.addEventListener("downloadprogress", function (event) {
        if (state.mode !== "x" && state.mode !== "news") return;
        const ratio = event.total ? event.loaded / event.total : event.loaded;
        if (!(ratio >= 0) || ratio > 1) return;
        setNewsNote(label + " 모델을 받는 중입니다. " + Math.round(ratio * 100) + "%");
      });
    };
  }

  function startLanguageDetector() {
    if (languageDetectorPromise) return languageDetectorPromise;
    if (!("LanguageDetector" in window)) return Promise.resolve(null);
    let created;
    try {
      created = LanguageDetector.create({ monitor: downloadMonitor("언어 감지") });
    } catch (error) {
      return Promise.resolve(null);
    }
    languageDetectorPromise = Promise.resolve(created).catch(function () {
      languageDetectorPromise = null;
      return null;
    });
    return languageDetectorPromise;
  }

  function openKoreanTranslator(source) {
    if (!source || source === "ko") return Promise.resolve(null);
    if (source === "en") return startBrowserTranslator();
    if (koreanTranslators[source]) return koreanTranslators[source];
    if (!("Translator" in window)) return Promise.resolve(null);
    let created;
    try {
      created = Translator.create({
        sourceLanguage: source,
        targetLanguage: "ko",
        monitor: downloadMonitor(languageName(source) + " 번역"),
      });
    } catch (error) {
      return Promise.reject(error);
    }
    koreanTranslators[source] = Promise.resolve(created).then(function (translator) {
      return translator;
    }).catch(function (error) {
      delete koreanTranslators[source];
      throw error;
    });
    return koreanTranslators[source];
  }

  function detectSource(node) {
    const known = knownSource(node);
    if (known) return Promise.resolve(known);
    return startLanguageDetector().then(function (detector) {
      if (!detector || !node.textContent) return "";
      return detector.detect(node.textContent).then(function (results) {
        const top = Array.isArray(results) ? results[0] : results;
        if (!top || !(Number(top.confidence) >= 0.45)) return "";
        return sourceLanguage(top.detectedLanguage);
      }).catch(function () { return ""; });
    });
  }

  function applyTranslation(node, translator, request) {
    if (!translator || request !== xToken || state.mode !== "x" || mostlyKorean(node.textContent)) return Promise.resolve(false);
    return translator.translate(node.textContent).then(function (text) {
      if (request !== xToken || state.mode !== "x" || !text) return false;
      node.textContent = text;
      return true;
    });
  }

  function translatePrepared(items, request) {
    const prompt = document.getElementById("x-translate");
    const jobs = [];
    const blocked = [];
    items.forEach(function (item) {
      if (!item.source || item.source === "ko") return;
      let promise;
      try {
        promise = openKoreanTranslator(item.source);
      } catch (error) {
        if (needsClick(error)) blocked.push(item.source);
        return;
      }
      jobs.push({ node: item.node, source: item.source, promise: promise });
    });
    let changed = false;
    let chain = Promise.resolve();
    jobs.forEach(function (job) {
      chain = chain.then(function () {
        if (request !== xToken || state.mode !== "x") return;
        return job.promise.then(function (translator) {
          if (!translator) {
            if ("Translator" in window) blocked.push(job.source);
            return;
          }
          return applyTranslation(job.node, translator, request).then(function (did) {
            if (did) changed = true;
          });
        }).catch(function (error) {
          if (needsClick(error)) blocked.push(job.source);
        });
      });
    });
    return chain.then(function () {
      if (request !== xToken || state.mode !== "x") return;
      const unique = blocked.filter(function (code, index) { return blocked.indexOf(code) === index; });
      if (unique.length) {
        prompt.hidden = false;
        setNewsNote(unique.map(languageName).join(", ") + " 번역 모델을 받으려면 아래 버튼을 눌러 주세요.");
        return;
      }
      prompt.hidden = true;
      if (changed) setNewsNote("브라우저 번역으로 한글로 바꿨습니다.");
      else if (jobs.length) setNewsNote("이 브라우저에서 번역하지 못한 글은 원문 그대로 보여 줍니다.");
    });
  }

  function setNewsNote(extra) {
    document.getElementById("range-note").textContent = state.newsNote + (extra ? " " + extra : "");
  }

  function startBrowserTranslator(forceNew) {
    if (browserTranslator.ready) return Promise.resolve(browserTranslator.ready);
    if (!forceNew && browserTranslator.pending) return browserTranslator.pending;
    if (!("Translator" in window)) return Promise.resolve(null);
    let created;
    try {
      created = Translator.create({
        sourceLanguage: "en",
        targetLanguage: "ko",
        monitor: function (monitor) {
          monitor.addEventListener("downloadprogress", function (event) {
            if (state.mode !== "news" && state.mode !== "x") return;
            const ratio = event.total ? event.loaded / event.total : event.loaded;
            if (!(ratio >= 0) || ratio > 1) return;
            setNewsNote("브라우저 번역 모델을 받는 중입니다. " + Math.round(ratio * 100) + "%");
          });
        },
      });
    } catch (error) {
      return Promise.resolve(null);
    }
    const promise = Promise.resolve(created).then(function (translator) {
      browserTranslator.ready = translator;
      if (browserTranslator.pending === promise) browserTranslator.pending = null;
      return translator;
    }).catch(function () {
      if (browserTranslator.pending === promise) browserTranslator.pending = null;
      return null;
    });
    browserTranslator.pending = promise;
    return promise;
  }

  function textSource(text) {
    const node = {
      textContent: text,
      getAttribute: function () { return ""; },
    };
    return knownSource(node) || "en";
  }

  function needsKorean(items) {
    return items.some(function (item) {
      return (item.title && !mostlyKorean(item.title)) || (item.summary && !mostlyKorean(item.summary));
    });
  }

  function prepareNewsTranslator() {
    if (browserTranslator.ready) return Promise.resolve(browserTranslator.ready);
    if (browserTranslator.pending) return browserTranslator.pending;
    if (!("Translator" in window)) return Promise.resolve(null);
    return Promise.resolve(Translator.availability({
      sourceLanguage: "en",
      targetLanguage: "ko",
    })).then(function (availability) {
      if (availability === "available" || availability === "downloading") return startBrowserTranslator();
      return null;
    }).catch(function () { return null; });
  }

  function askForNewsTranslation(request) {
    if (request !== newsToken || state.mode !== "news") return;
    const prompt = document.getElementById("news-translate");
    prompt.hidden = false;
    setNewsNote("브라우저 번역을 시작하려면 아래 버튼을 눌러 주세요.");
  }

  function translateCurrentNews(translatorPromise, items, request, symbol) {
    const prompt = document.getElementById("news-translate");
    prompt.hidden = true;
    if (!needsKorean(items)) return;
    const jobs = [];
    items.forEach(function (item, index) {
      if (item.title && !mostlyKorean(item.title)) jobs.push({ index: index, field: "strong", source: textSource(item.title), text: item.title });
      if (item.summary && !mostlyKorean(item.summary)) jobs.push({ index: index, field: "p", source: textSource(item.summary), text: item.summary });
    });
    if (!jobs.length) return;
    const sources = { en: translatorPromise };
    jobs.forEach(function (job) {
      if (sources[job.source]) return;
      try {
        sources[job.source] = openKoreanTranslator(job.source);
      } catch (error) {
        sources[job.source] = Promise.resolve(null);
        if (needsClick(error)) askForNewsTranslation(request);
      }
    });
    setNewsNote("브라우저 번역으로 한글로 바꾸는 중입니다.");
    const slow = setTimeout(function () {
      if (!browserTranslator.ready) askForNewsTranslation(request);
    }, 2500);
    let changed = false;
    let chain = Promise.resolve();
    jobs.forEach(function (job) {
      chain = chain.then(function () {
        if (request !== newsToken || state.mode !== "news" || state.symbol !== symbol) return;
        return sources[job.source].then(function (translator) {
          if (!translator) return;
          return translator.translate(job.text).then(function (text) {
            if (request !== newsToken || state.symbol !== symbol || !text) return;
            const row = document.querySelectorAll("#news-list li")[job.index];
            const node = row && row.querySelector(job.field);
            if (!node) return;
            node.textContent = text;
            changed = true;
          });
        }).catch(function (error) {
          if (needsClick(error)) askForNewsTranslation(request);
        });
      });
    });
    return chain.then(function () {
      clearTimeout(slow);
      if (request !== newsToken || state.mode !== "news" || state.symbol !== symbol) return;
      if (changed) {
        prompt.hidden = true;
        setNewsNote("브라우저 번역으로 한글로 바꿨습니다.");
        return;
      }
      if (!browserTranslator.ready) askForNewsTranslation(request);
    }).catch(function () {
      clearTimeout(slow);
      askForNewsTranslation(request);
    });
  }

  function loadNews(symbol) {
    const request = ++newsToken;
    const translatorPromise = prepareNewsTranslator();
    const newsState = document.getElementById("news-state");
    const newsList = document.getElementById("news-list");
    const selected = symbolSelect.options[symbolSelect.selectedIndex];
    document.getElementById("page-title").textContent = "종목 뉴스";
    document.getElementById("news-translate").hidden = true;
    state.newsNote = (selected ? selected.textContent : symbol) + " 최신 뉴스를 불러오는 중입니다.";
    setNewsNote("");
    newsState.hidden = false;
    newsState.className = "status";
    newsState.textContent = "뉴스를 불러오는 중입니다.";
    newsList.hidden = false;
    newsList.innerHTML = "";
    document.getElementById("news-reader").hidden = true;
    articleToken += 1;
    state.newsItems = [];
    fetch("api/news?symbol=" + encodeURIComponent(symbol))
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (request !== newsToken || state.mode !== "news" || state.symbol !== symbol) return;
        if (data.error) throw new Error(data.error);
        const items = data.items || [];
        state.newsItems = items;
        state.newsNote = (data.source || "뉴스") + "에서 가져온 " + (data.name || symbol) + " 최신 기사 " +
          items.length + "건입니다.";
        state.listNote = state.newsNote;
        setNewsNote("");
        if (!items.length) {
          newsState.textContent = "최근 뉴스가 없습니다.";
          return;
        }
        newsState.hidden = true;
        newsList.innerHTML = items.map(function (item) {
          const meta = [item.publisher, item.published].filter(Boolean).join(" · ");
          const language = mostlyKorean(item.title) ? "ko" : "en";
          return "<li><a href=\"" + escapeHtml(item.link) + "\" lang=\"" + language + "\">" +
            "<strong>" + escapeHtml(item.title) + "</strong>" +
            (meta ? "<span class=\"news-meta\">" + escapeHtml(meta) + "</span>" : "") +
            (item.summary ? "<p>" + escapeHtml(item.summary) + "</p>" : "") +
            "</a></li>";
        }).join("");
        translateCurrentNews(translatorPromise, items, request, symbol);
      })
      .catch(function (error) {
        if (request !== newsToken || state.mode !== "news") return;
        newsState.hidden = false;
        newsState.className = "status error";
        newsState.textContent = "뉴스를 가져오지 못했습니다. " + error.message;
      });
  }

  function showDaily() {
    const saved = state.saved.daily;
    const selected = symbolSelect.value;
    if (state.loadedMode === "daily" && state.chartSymbol === selected && state.bars.length) {
      status.hidden = true;
      board.hidden = false;
      requestAnimationFrame(function () {
        setRange(state.startIndex, state.endIndex, "both", true);
      });
      return;
    }
    if (saved && saved.symbol === selected && saved.bars.length) {
      restore("daily");
      return;
    }
    loadSymbol(selected);
  }

  let xToken = 0;

  function formatKst(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function showXLogin(message, ready) {
    document.getElementById("x-login").hidden = false;
    document.getElementById("x-session").hidden = true;
    document.getElementById("x-list").innerHTML = "";
    document.getElementById("x-translate").hidden = true;
    document.getElementById("x-login-button").hidden = !ready;
    const setup = document.getElementById("x-setup");
    setup.hidden = !message;
    setup.textContent = message || "";
  }

  function translateXPosts(request) {
    const nodes = Array.prototype.slice.call(document.querySelectorAll("#x-list .x-text"));
    const pending = nodes.filter(function (node) {
      return node.textContent && knownSource(node) !== "ko" && !mostlyKorean(node.textContent);
    });
    document.getElementById("x-translate").hidden = true;
    if (!pending.length) return;
    setNewsNote("글의 언어를 확인한 뒤 한글로 바꾸는 중입니다.");
    Promise.all(pending.map(function (node) {
      return detectSource(node).then(function (source) {
        if (source) node.setAttribute("data-lang", source);
        return { node: node, source: source || "" };
      });
    })).then(function (items) {
      if (request !== xToken || state.mode !== "x") return;
      return translatePrepared(items, request);
    }).catch(function () {});
  }

  function loadX(symbol) {
    const request = ++xToken;
    startBrowserTranslator();
    startLanguageDetector();
    document.getElementById("x-translate").hidden = true;
    const xState = document.getElementById("x-state");
    const selected = symbolSelect.options[symbolSelect.selectedIndex];
    document.getElementById("page-title").textContent = "종목 X";
    state.newsNote = (selected ? selected.textContent : symbol) + " 최근 글을 확인하는 중입니다.";
    setNewsNote("");
    xState.hidden = false;
    xState.className = "status";
    xState.textContent = "X 연결을 확인하는 중입니다.";
    document.getElementById("x-list").innerHTML = "";
    const params = new URLSearchParams(location.search);
    const loginError = params.get("x_error");
    fetch("api/x/status")
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (request !== xToken || state.mode !== "x") return;
        if (!data.configured) {
          showXLogin("", false);
          xState.hidden = true;
          state.newsNote = "Client ID와 Client Secret을 저장하면 X 로그인이 시작됩니다.";
          setNewsNote("");
          return;
        }
        if (!data.loggedIn) {
          const known = { access_denied: "X 로그인을 취소했습니다.", login_failed: "X 로그인에 실패했습니다." };
          const message = known[loginError] || loginError || "";
          document.getElementById("x-config").hidden = true;
          document.getElementById("x-login-copy").textContent = (data.allowedUser || "gunnylove1") + " 계정으로 로그인해야 최근 글을 가져올 수 있습니다.";
          showXLogin(message, true);
          xState.hidden = true;
          state.newsNote = "X에 로그인하면 이 종목의 최근 글을 가져옵니다.";
          setNewsNote("");
          return;
        }
        document.getElementById("x-login").hidden = true;
        document.getElementById("x-session").hidden = false;
        document.getElementById("x-setup").hidden = true;
        const account = data.name ? data.name + " @" + data.username : "@" + data.username;
        document.getElementById("x-account").textContent = account;
        xState.textContent = "최근 글을 불러오는 중입니다.";
        return fetch("api/x/posts?symbol=" + encodeURIComponent(symbol))
          .then(function (response) { return response.json().then(function (posts) { return { ok: response.ok, posts: posts }; }); })
          .then(function (result) {
            if (request !== xToken || state.mode !== "x" || state.symbol !== symbol) return;
            if (!result.ok) {
              if (result.posts.login) {
                showXLogin(result.posts.error || "다시 로그인해 주세요.", true);
                xState.hidden = true;
                return;
              }
              throw new Error(result.posts.error || "글을 가져오지 못했습니다.");
            }
            const posts = result.posts.posts || [];
            state.newsNote = (result.posts.name || symbol) + " 최근 글 " + posts.length + "개입니다. 같은 종목은 10분 동안 다시 요청하지 않습니다.";
            setNewsNote("");
            if (!posts.length) {
              xState.textContent = "최근 글이 없습니다.";
              return;
            }
            xState.hidden = true;
            document.getElementById("x-list").innerHTML = posts.map(function (post) {
              const who = (post.name || post.username || "X") + (post.username ? " @" + post.username : "");
              const meta = [formatKst(post.createdAt), "좋아요 " + post.likes, "리포스트 " + post.reposts].filter(Boolean).join(" · ");
              const url = post.id
                ? "https://x.com/" + (post.username ? encodeURIComponent(post.username) + "/status/" : "i/web/status/") + encodeURIComponent(post.id)
                : "";
              const lang = sourceLanguage(post.lang);
              return "<li><article class=\"x-post\"><strong>" + escapeHtml(who) + "</strong>" +
                (meta ? "<span class=\"news-meta\">" + escapeHtml(meta) + "</span>" : "") +
                "<p class=\"x-text\"" + (lang ? " data-lang=\"" + lang + "\"" : "") + ">" + escapeHtml(post.text) + "</p>" +
                (url ? "<a class=\"x-link\" href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">X에서 원문 보기</a>" : "") +
                "</article></li>";
            }).join("");
            translateXPosts(request);
          });
      })
      .catch(function (error) {
        if (request !== xToken || state.mode !== "x") return;
        xState.hidden = false;
        xState.className = "status error";
        xState.textContent = "X 글을 가져오지 못했습니다. " + error.message;
      });
  }

  let stableToken = 0;

  function showStable() {
    document.getElementById("page-title").textContent = "스테이블 코인";
    const saved = state.saved.stable;
    if (state.loadedMode === "stable" && state.bars.length) {
      status.hidden = true;
      board.hidden = false;
      requestAnimationFrame(function () {
        setRange(state.startIndex, state.endIndex, "both", true);
      });
      return;
    }
    if (saved && saved.bars.length) {
      restore("stable");
      return;
    }
    loadStable();
  }

  function loadStable() {
    const request = ++stableToken;
    status.hidden = false;
    status.className = "status";
    status.textContent = "바이비트 USDC/USDT 일봉을 불러오는 중입니다.";
    board.hidden = true;
    document.getElementById("range-note").textContent = "바이비트 현물 USDC/USDT 일봉을 불러옵니다.";
    fetch("api/stable")
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        if (!data.bars || data.bars.length < 30) throw new Error("일봉이 너무 적습니다.");
        const snapshot = {
          bars: data.bars,
          symbol: data.symbol,
          symbolName: data.name,
          quote: data.quote || "USDT",
          venue: data.venue || "바이비트 현물",
          start: 0,
          end: data.bars.length - 1,
        };
        if (request !== stableToken || state.mode !== "stable") {
          state.saved.stable = snapshot;
          return;
        }
        state.loadedMode = "stable";
        state.chartSymbol = snapshot.symbol;
        state.symbol = snapshot.symbol;
        state.symbolName = snapshot.symbolName;
        state.quote = snapshot.quote;
        state.venue = snapshot.venue;
        state.bars = snapshot.bars;
        status.hidden = true;
        board.hidden = false;
        requestAnimationFrame(function () {
          setRange(0, state.bars.length - 1, "both");
        });
      })
      .catch(function (error) {
        if (request !== stableToken || state.mode !== "stable") return;
        status.hidden = false;
        status.className = "status error";
        status.textContent = "시세를 가져오지 못했습니다. " + error.message;
      });
  }

  function readStablePrices() {
    const buy = Number(document.getElementById("stable-buy").value);
    const sell = Number(document.getElementById("stable-sell").value);
    const feePercent = Number(document.getElementById("stable-fee").value);
    if (!(buy > 0) || !(sell > 0) || !(feePercent >= 0)) return;
    state.buyPrice = buy;
    state.sellPrice = sell;
    state.feePercent = feePercent;
    if (state.mode === "stable" && state.bars.length && state.loadedMode === "stable") render();
  }

  document.getElementById("stable-buy").addEventListener("change", readStablePrices);
  document.getElementById("stable-sell").addEventListener("change", readStablePrices);
  document.getElementById("stable-fee").addEventListener("change", readStablePrices);

  function showTab(mode) {
    if (mode === state.mode) return;
    if ((state.mode === "daily" || state.mode === "stable") && state.bars.length && state.loadedMode === state.mode) {
      remember(state.mode);
    }
    state.mode = mode;
    document.querySelectorAll("#tabs button").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.tab === mode ? "true" : "false");
    });
    applyPage(mode);
    if (mode === "news" || mode === "x") state.symbol = symbolSelect.value;
    if (mode === "news") loadNews(state.symbol);
    else if (mode === "x") loadX(state.symbol);
    else if (mode === "stable") showStable();
    else showDaily();
  }

  document.getElementById("tabs").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    showTab(button.dataset.tab);
  });

  function closeArticle() {
    articleToken += 1;
    document.getElementById("news-reader").hidden = true;
    document.getElementById("news-list").hidden = false;
    document.getElementById("news-translate").hidden = true;
    state.newsNote = state.listNote || "";
    setNewsNote("");
  }

  function translateNodes(translatorPromise, nodes, request, doneNote) {
    const prompt = document.getElementById("news-translate");
    const pending = nodes.filter(function (node) {
      return node && node.textContent && !mostlyKorean(node.textContent);
    });
    if (!pending.length) return;
    setNewsNote("브라우저 번역으로 한글로 바꾸는 중입니다.");
    const slow = setTimeout(function () {
      if (request !== articleToken || browserTranslator.ready) return;
      prompt.hidden = false;
      setNewsNote("브라우저 번역을 시작하려면 아래 버튼을 눌러 주세요.");
    }, 2500);
    translatorPromise.then(function (translator) {
      clearTimeout(slow);
      if (request !== articleToken || state.mode !== "news") return;
      if (!translator) {
        prompt.hidden = false;
        setNewsNote("브라우저 번역을 시작하려면 아래 버튼을 눌러 주세요.");
        return;
      }
      let chain = Promise.resolve();
      pending.forEach(function (node) {
        chain = chain.then(function () {
          if (request !== articleToken || mostlyKorean(node.textContent)) return;
          return translator.translate(node.textContent).then(function (text) {
            if (request !== articleToken || !text) return;
            node.textContent = text;
          });
        });
      });
      return chain.then(function () {
        clearTimeout(slow);
        if (request !== articleToken || state.mode !== "news") return;
        setNewsNote(doneNote);
      });
    }).catch(function () {
      clearTimeout(slow);
      if (request !== articleToken || state.mode !== "news") return;
      prompt.hidden = false;
      setNewsNote("브라우저 번역을 시작하려면 아래 버튼을 눌러 주세요.");
    });
  }

  function openArticle(url, fallbackTitle) {
    const request = ++articleToken;
    const translatorPromise = prepareNewsTranslator();
    const reader = document.getElementById("news-reader");
    const articleState = document.getElementById("article-state");
    const titleNode = document.getElementById("article-title");
    const sourceNode = document.getElementById("article-source");
    const textNode = document.getElementById("article-text");
    document.getElementById("news-list").hidden = true;
    document.getElementById("news-translate").hidden = true;
    reader.hidden = false;
    document.getElementById("news-back").scrollIntoView({ block: "nearest" });
    titleNode.textContent = fallbackTitle || "기사";
    sourceNode.textContent = "";
    textNode.innerHTML = "";
    articleState.hidden = false;
    articleState.className = "status";
    articleState.textContent = "기사 본문을 불러오는 중입니다.";
    state.newsNote = fallbackTitle || "기사";
    setNewsNote("본문을 불러오는 중입니다.");
    fetch("api/article?url=" + encodeURIComponent(url))
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (request !== articleToken || state.mode !== "news") return;
        if (data.error) throw new Error(data.error);
        const paragraphs = data.paragraphs || [];
        titleNode.textContent = data.title || fallbackTitle || "기사";
        sourceNode.textContent = data.source || "";
        textNode.innerHTML = paragraphs.map(function (paragraph) {
          return "<p>" + escapeHtml(paragraph) + "</p>";
        }).join("");
        articleState.hidden = true;
        state.newsNote = (data.source ? data.source + " · " : "") + (titleNode.textContent || "기사");
        setNewsNote("");
        translateNodes(
          translatorPromise,
          [titleNode].concat(Array.prototype.slice.call(textNode.querySelectorAll("p"))),
          request,
          "브라우저 번역으로 본문을 한글로 바꿨습니다."
        );
      })
      .catch(function (error) {
        if (request !== articleToken || state.mode !== "news") return;
        articleState.hidden = false;
        articleState.className = "status error";
        articleState.textContent = "기사 본문을 가져오지 못했습니다. " + error.message;
        setNewsNote("");
      });
  }

  document.getElementById("news-list").addEventListener("click", function (event) {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    const title = link.querySelector("strong");
    openArticle(link.href, title ? title.textContent : "");
  });

  document.getElementById("news-back").addEventListener("click", closeArticle);

  document.getElementById("news-translate-button").addEventListener("click", function () {
    const translatorPromise = startBrowserTranslator(true);
    const reader = document.getElementById("news-reader");
    if (!reader.hidden) {
      const titleNode = document.getElementById("article-title");
      const paragraphs = document.querySelectorAll("#article-text p");
      translateNodes(
        translatorPromise,
        [titleNode].concat(Array.prototype.slice.call(paragraphs)),
        articleToken,
        "브라우저 번역으로 본문을 한글로 바꿨습니다."
      );
      return;
    }
    if (!state.newsItems.length) return;
    translateCurrentNews(translatorPromise, state.newsItems, newsToken, state.symbol);
  });

  symbolSelect.addEventListener("change", function () {
    if (symbolSelect.value === state.symbol) return;
    if (state.mode === "news") {
      state.symbol = symbolSelect.value;
      loadNews(state.symbol);
      return;
    }
    if (state.mode === "x") {
      state.symbol = symbolSelect.value;
      loadX(state.symbol);
      return;
    }
    loadSymbol(symbolSelect.value);
  });

  document.getElementById("x-config").addEventListener("submit", function (event) {
    event.preventDefault();
    const setup = document.getElementById("x-setup");
    const clientId = document.getElementById("x-client-id").value.trim();
    const clientSecret = document.getElementById("x-client-secret").value.trim();
    setup.hidden = false;
    setup.textContent = "앱 정보를 저장하는 중입니다.";
    fetch("api/x/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId, clientSecret: clientSecret }),
    })
      .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data.error || "저장하지 못했습니다.");
        document.getElementById("x-client-secret").value = "";
        location.href = "api/x/login";
      })
      .catch(function (error) {
        setup.hidden = false;
        setup.textContent = error.message;
      });
  });

  document.getElementById("x-logout").addEventListener("click", function () {
    fetch("api/x/logout", { method: "POST" }).then(function () { loadX(state.symbol); });
  });

  document.getElementById("x-translate-button").addEventListener("click", function () {
    const request = xToken;
    startLanguageDetector();
    const nodes = Array.prototype.slice.call(document.querySelectorAll("#x-list .x-text"));
    const ready = [];
    const unknown = [];
    nodes.forEach(function (node) {
      if (!node.textContent || mostlyKorean(node.textContent)) return;
      const source = knownSource(node);
      if (source === "ko") return;
      if (source) ready.push({ node: node, source: source });
      else unknown.push(node);
    });
    ready.forEach(function (item) {
      try { openKoreanTranslator(item.source); } catch (error) {}
    });
    document.getElementById("x-translate").hidden = true;
    setNewsNote("브라우저 번역으로 한글로 바꾸는 중입니다.");
    const detected = unknown.length
      ? Promise.all(unknown.map(function (node) {
        return detectSource(node).then(function (source) {
          if (source) node.setAttribute("data-lang", source);
          if (source && source !== "ko") {
            try { openKoreanTranslator(source); } catch (error) {}
          }
          return { node: node, source: source || "" };
        });
      }))
      : Promise.resolve([]);
    detected.then(function (items) {
      if (request !== xToken || state.mode !== "x") return;
      return translatePrepared(ready.concat(items), request);
    }).catch(function () {});
  });

  if (location.hash === "#x") showTab("x");
  renderFavorites();
  loadSymbol("BTC-USD");
})();
