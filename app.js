(function () {
  const INITIAL = 10000;
  const state = {
    bars: [],
    mode: "daily",
    symbol: "BTCUSDT",
    symbolName: "비트코인",
    quote: "USDT",
    venue: "바이비트 현물",
    saved: { daily: null, scalp: null },
    kind: "sma",
    period: 20,
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
    const digits = state.quote === "KRW" ? 0 : value >= 1000 ? 1 : value >= 1 ? 2 : 4;
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
      : Strategy.runBacktest(state.bars, {
        period: state.period,
        kind: state.kind,
        startIndex: state.startIndex,
        endIndex: state.endIndex,
        initial: INITIAL,
      });
    const last = state.bars[result.end];
    const first = state.bars[result.start];
    const pair = state.symbolName + " " + state.symbol;
    const clock = function (value) { return value.replace("T", " "); };
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
    document.getElementById("rules").innerHTML = state.mode === "scalp"
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
    document.getElementById("equity-title").textContent = state.mode === "scalp"
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
        "</td><td>" + price(trade.price) + "</td><td>" + money(trade.equity) + "</td></tr>";
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
    const pad = (max - min) * 0.06 || max * 0.01;
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
        (item.trend == null ? (item.ma == null ? "" : "  이평 " + price(item.ma))
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
  }

  function selectPeriod(period) {
    const next = Math.min(200, Math.max(2, period));
    state.period = next;
    document.getElementById("custom-period").value = String(next);
    document.querySelectorAll("#periods button").forEach(function (button) {
      button.setAttribute("aria-pressed", Number(button.dataset.period) === next ? "true" : "false");
    });
    render();
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
      if (button.hidden) {
        button.setAttribute("aria-pressed", "false");
        return;
      }
      const amount = button.dataset.seconds || button.dataset.days;
      const span = amount === "all" ? state.bars.length : Number(amount);
      const presetStart = amount === "all" ? 0 : Math.max(0, end - (span - 1));
      const matches = start === presetStart && (amount === "all" ? end === last : end - start + 1 === Math.min(span, last + 1));
      button.setAttribute("aria-pressed", matches ? "true" : "false");
    });
    render();
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
    if (!button) return;
    const last = state.bars.length - 1;
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

  function loadSymbol(symbol) {
    symbolSelect.value = symbol;
    symbolSelect.disabled = true;
    fetch("api/klines?symbol=" + encodeURIComponent(symbol))
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        if (!data.bars || data.bars.length < 30) throw new Error("일봉이 너무 적습니다.");
        const previous = state.bars.length
          ? { start: state.bars[state.startIndex].time, end: state.bars[state.endIndex].time }
          : null;
        const snapshot = {
          bars: data.bars,
          symbol: data.symbol,
          symbolName: data.name,
          quote: data.quote || "USDT",
          venue: data.venue || "",
          start: 0,
          end: data.bars.length - 1,
        };
        if (state.mode !== "daily") {
          state.saved.daily = snapshot;
          return;
        }
        state.loadedMode = "daily";
        state.symbol = snapshot.symbol;
        state.symbolName = snapshot.symbolName;
        state.quote = snapshot.quote;
        state.venue = snapshot.venue;
        state.bars = snapshot.bars;
        status.hidden = true;
        board.hidden = false;
        requestAnimationFrame(function () {
          const first = state.bars[0].time;
          const last = state.bars[state.bars.length - 1].time;
          const startInside = previous && previous.start >= first && previous.start <= last;
          if (!startInside) {
            setRange(0, state.bars.length - 1, "both");
            return;
          }
          const endTime = previous.end > last ? last : previous.end;
          const start = indexOnOrAfter(previous.start);
          const end = indexOnOrBefore(endTime);
          if (end > start) setRange(start, end, "both", true);
          else setRange(0, state.bars.length - 1, "both");
        });
      })
      .catch(function (error) {
        symbolSelect.value = state.symbol;
        status.hidden = false;
        status.className = "status error";
        status.textContent = "시세를 가져오지 못했습니다. " + error.message;
      })
      .finally(function () {
        symbolSelect.disabled = false;
      });
  }

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
      element.hidden = element.dataset.page !== mode;
    });
    document.querySelectorAll("#windows button").forEach(function (button) {
      button.hidden = button.dataset.mode !== mode;
    });
    document.getElementById("trade-when").textContent = mode === "scalp" ? "체결 시각" : "체결일";
    ["start-date", "end-date"].forEach(function (id) {
      const input = document.getElementById(id);
      input.type = mode === "scalp" ? "datetime-local" : "date";
      if (mode === "scalp") input.step = "1";
    });
  }

  function restore(mode) {
    const saved = state.saved[mode];
    state.loadedMode = mode;
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

  function loadScalp() {
    document.querySelectorAll("#tabs button").forEach(function (button) { button.disabled = true; });
    status.hidden = false;
    status.className = "status";
    status.textContent = "비트코인 1초봉을 불러오는 중입니다.";
    board.hidden = true;
    fetch("api/scalp")
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        if (!data.bars || data.bars.length < 60) throw new Error("초봉이 너무 적습니다.");
        const snapshot = {
          bars: data.bars,
          symbol: data.symbol,
          symbolName: data.name,
          quote: data.quote || "USDT",
          venue: data.venue || "",
          start: 0,
          end: data.bars.length - 1,
        };
        state.saved.scalp = snapshot;
        if (state.mode !== "scalp") return;
        state.loadedMode = "scalp";
        state.symbol = snapshot.symbol;
        state.symbolName = snapshot.symbolName;
        state.quote = snapshot.quote;
        state.venue = snapshot.venue;
        state.bars = snapshot.bars;
        status.hidden = true;
        board.hidden = false;
        requestAnimationFrame(function () { setRange(0, snapshot.end, "both"); });
      })
      .catch(function (error) {
        if (state.mode !== "scalp") return;
        status.hidden = false;
        status.className = "status error";
        status.textContent = "초봉을 가져오지 못했습니다. " + error.message;
      })
      .finally(function () {
        document.querySelectorAll("#tabs button").forEach(function (button) { button.disabled = false; });
      });
  }

  function showTab(mode) {
    if (mode === state.mode) return;
    if (state.bars.length && state.loadedMode === state.mode) remember(state.mode);
    state.mode = mode;
    document.querySelectorAll("#tabs button").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.tab === mode ? "true" : "false");
    });
    applyPage(mode);
    const saved = state.saved[mode];
    if (saved && saved.bars.length) restore(mode);
    else if (mode === "scalp") loadScalp();
  }

  document.getElementById("tabs").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    showTab(button.dataset.tab);
  });

  symbolSelect.addEventListener("change", function () {
    if (symbolSelect.value === state.symbol) return;
    loadSymbol(symbolSelect.value);
  });

  loadSymbol("BTCUSDT");
})();
