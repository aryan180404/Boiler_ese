(function () {
  const D = window.BOILER_DATA;
  const el = (id) => document.getElementById(id);
  const plant = el("plant");
  const results = el("results");
  const inputs = el("inputs");
  const powerBtn = el("power");
  const powerLabel = el("power-label");
  const liveVal = el("live-val");
  const SVG = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const fmt = (n, d = 2) =>
    Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", "−");
  const nSensor = D.n_sensor_inputs;
  const H = D.horizons;
  const WORDS = { 1: "one minute", 5: "five minutes", 10: "ten minutes" };
  const words = (m) => WORDS[m] || `${m} minutes`;
  let hz = 0;
  const minutesText = (m) => (m === 1 ? "1 minute" : `${m} minutes`);
  const targetIdx = D.features.indexOf(D.target);
  const lagSeconds = (name) => Number(name.match(/lag(\d+)/)[1]) * D.seconds_per_step;
  // unit shown beside an input: data.js may supply D.units = { "sensor name": "unit" };
  // otherwise only temperatures are labelled, because the data set records them in °C
  const unitOf = (name) =>
    (D.units && D.units[name]) || (/temperature/i.test(name) && !/valve/i.test(name) ? "°C" : "");

  // outlet temperature history from the model inputs, oldest first: [feature index, seconds before now]
  const history = D.features
    .map((name, i) => (i >= nSensor ? [i, lagSeconds(name)] : null))
    .filter(Boolean)
    .concat([[targetIdx, 0]])
    .sort((a, b) => b[1] - a[1]);

  // each sensor input lands in the first group whose test matches its name
  const GROUPS = [
    { title: "Pressure", test: (n) => /pressure/i.test(n) && !/differential/i.test(n) },
    { title: "Differential pressure", test: (n) => /differential/i.test(n) },
    { title: "Steam and desuperheating", test: (n) => /desuperheat|steam flow/i.test(n) },
    { title: "Flue gas and air temperature", test: (n) => /temperature/i.test(n) },
    { title: "Air, fans and oxygen", test: () => true },
  ];

  // a wide underlay behind every animated stream so it reads as a pipe
  const figuresBox = results.querySelector(".figures");
  const pipes = plant.querySelector(".pipes");
  plant.querySelectorAll(".flow path").forEach((p) => pipes.appendChild(p.cloneNode()));

  // a band of colour per stream that runs down its pipe from the source when the boiler starts
  const fills = plant.querySelector(".fills");
  plant.querySelectorAll(".flow").forEach((g) => {
    const layer = node("g", { class: "fill " + g.classList[1] }, fills);
    layer.style.setProperty("--d", g.style.getPropertyValue("--d"));
    g.querySelectorAll("path").forEach((p) => {
      const c = p.cloneNode();
      c.setAttribute("pathLength", 1);
      c.style.setProperty("--len", Math.round(p.getTotalLength()));
      layer.appendChild(c);
    });
  });

  // --- moving particles: gas, air, water, steam and the circulating bed solids ---
  // Each stream is a path; particles ride along it. Flue gas cools from orange to grey as it
  // gives up heat to the banks, and bed solids rise in the furnace, spin down a cyclone and return.
  const HOT = [236, 112, 22], COOL = [134, 150, 166];
  const STREAMS = [
    { d: "M230 70 V40 H710 V388 H903", n: 16, dur: 6.4, delay: 0.55, r: 2.2, kind: "flue" },
    { d: "M230 405 V40 H390 V236 V380 H300 L246 408", n: 9, dur: 7.5, delay: 0.9, r: 1.7, kind: "solid", fill: "#A9773F" },
    { d: "M230 405 V40 H480 V236 V380 H300 L246 408", n: 8, dur: 8.6, delay: 0.9, r: 1.7, kind: "solid", fill: "#A9773F" },
    { d: "M644 371 H596 V456 H230 V440", n: 8, dur: 4.6, delay: 0, r: 2, fill: "var(--air)" },
    { d: "M680 439 V382", n: 2, dur: 1.5, delay: 0, r: 2, fill: "var(--air)" },
    { d: "M740 439 V382", n: 2, dur: 1.5, delay: 0, r: 2, fill: "var(--air)" },
    { d: "M990 241 H776", n: 4, dur: 3.6, delay: 0.8, r: 2.2, fill: "var(--water)" },
    { d: "M776 135 H858", n: 3, dur: 1.3, delay: 1.9, r: 2.2, fill: "var(--steam)" },
  ];
  const moteLayer = plant.querySelector(".motes");
  const motes = [];
  STREAMS.forEach((st) => {
    st.path = node("path", { d: st.d, fill: "none", stroke: "none" }, moteLayer);
    st.len = st.path.getTotalLength();
    st.gain = 0;
    for (let k = 0; k < st.n; k++) {
      const halo = node("circle", { r: st.r * 2.6 }, moteLayer);
      const core = node("circle", { r: st.r }, moteLayer);
      core.style.fill = "#fff";
      if (st.fill) { halo.style.fill = st.fill; core.style.stroke = st.fill; }
      motes.push({ st, halo, core, off: (k + Math.random() * 0.7) / st.n, jit: Math.random() * 2 - 1, ph: Math.random() * 6.28 });
    }
  });

  let startedAt = 0, lastT = 0, moteFrame = null, plantVisible = true;
  new IntersectionObserver((entries) => { plantVisible = entries[0].isIntersecting; }).observe(plant);

  function moveMotes(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, t - lastT || 0.016);
    lastT = t;
    let alive = false;
    STREAMS.forEach((st) => {
      const target = running && t - startedAt > st.delay ? 1 : 0;
      st.gain += (target - st.gain) * Math.min(1, dt * (target ? 1.6 : 4));
      if (st.gain > 0.01 || target) alive = true;
    });
    if (plantVisible) {
      motes.forEach((m) => {
        const st = m.st;
        const p = (t / st.dur + m.off) % 1;
        const pt = st.path.getPointAtLength(p * st.len);
        let x = pt.x, y = pt.y;
        if (st.kind === "solid") {
          if (x < 231 && y > 60) x += m.jit * 42 + Math.sin(t * 4 + m.ph) * 8;          // fluidised bed in the furnace
          else if (y > 100 && y < 236 && x > 380) {                                        // spinning down a cyclone
            x += Math.sin(t * 13 + m.ph) * (y < 160 ? 24 : (24 * (236 - y)) / 76);
          }
        } else if (st.kind === "flue") {
          x += m.jit * 2.5; y += Math.cos(m.ph) * 2.5;
          const k = Math.min(1, p * 1.25);
          const c = HOT.map((h, i) => Math.round(h + (COOL[i] - h) * k));
          m.core.style.stroke = m.halo.style.fill = `rgb(${c[0]},${c[1]},${c[2]})`;
        }
        const edge = Math.min(1, p / 0.05, (1 - p) / 0.05);
        const a = st.gain * edge;
        m.core.setAttribute("cx", x); m.core.setAttribute("cy", y);
        m.halo.setAttribute("cx", x); m.halo.setAttribute("cy", y);
        m.core.style.opacity = a;
        m.halo.style.opacity = a * 0.22;
      });
    }
    moteFrame = alive ? requestAnimationFrame(moveMotes) : null;
  }

  // on a narrow screen the drawing is wider than the panel: follow the process from the coal feed to the steam readout
  const drawing = plant.querySelector(".drawing");
  let panFrame = null;
  const stopPan = () => { if (panFrame) cancelAnimationFrame(panFrame); panFrame = null; };
  ["pointerdown", "wheel", "touchstart", "keydown"].forEach((ev) => drawing.addEventListener(ev, stopPan, { passive: true }));
  function panDrawing(to, delay, dur) {
    stopPan();
    const from = drawing.scrollLeft;
    if (Math.abs(to - from) < 4) return;
    const t0 = performance.now() + delay;
    const step = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / dur));
      drawing.scrollLeft = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      panFrame = k < 1 ? requestAnimationFrame(step) : null;
    };
    panFrame = requestAnimationFrame(step);
  }
  const drawingOverflow = () => drawing.scrollWidth - drawing.clientWidth;

  const onScreen = new Map(), waiting = new Map();
  const watcher = new IntersectionObserver((entries) => entries.forEach((e) => {
    onScreen.set(e.target, e.isIntersecting);
    if (e.isIntersecting && waiting.has(e.target)) {
      const fn = waiting.get(e.target);
      waiting.delete(e.target);
      fn();
    }
  }), { threshold: 0.4 });
  function whenVisible(target, fn) {
    watcher.observe(target);
    if (onScreen.get(target)) fn(); else waiting.set(target, fn);
  }

  let current = -1;
  let shown = null;
  let chartWaiting = false;
  let drawnWidth = 0;
  let figuresWaiting = false;
  let tempAnim = null;
  let pending = null;
  let running = false;

  function pickRow() {
    let i;
    do { i = Math.floor(Math.random() * D.rows.length); } while (i === current && D.rows.length > 1);
    current = i;
    return D.rows[i];
  }

  const readout = plant.querySelector(".readout");
  function countTo(target) {
    if (tempAnim) cancelAnimationFrame(tempAnim);
    readout.classList.remove("tick");
    void readout.getBoundingClientRect(); // restart the flash
    readout.classList.add("tick");
    if (reduceMotion.matches) { liveVal.textContent = fmt(target, 1); return; }
    const from = parseFloat(liveVal.textContent.replace("−", "-").replace(/,/g, "")) || target - 6;
    const t0 = performance.now(), dur = 1100;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      liveVal.textContent = fmt(from + (target - from) * e, 1);
      if (k < 1) tempAnim = requestAnimationFrame(step);
    };
    tempAnim = requestAnimationFrame(step);
  }

  function modelName(name) {
    const m = name.match(/^Linear Regression \+ tuned (.+) correction$/);
    if (m) return `Linear regression with a tuned ${m[1]} correction (hybrid)`;
    const a = name.match(/^Average of Linear Regression and tuned (.+)$/);
    if (a) return `Equal-weight average of linear regression and a tuned ${a[1]} model (hybrid)`;
    return name === "Linear Regression" ? "Linear regression" : name;
  }

  function shortName(name) {
    const m = name.match(/^Linear Regression \+ tuned (.+) correction$/);
    if (m) return `Linear regression + tuned ${m[1]} correction`;
    const a = name.match(/^Average of Linear Regression and tuned (.+)$/);
    if (a) return `Average of linear regression and tuned ${a[1]}`;
    return name === "Linear Regression" ? "Linear regression" : name;
  }

  const FIGURES = {
    predicted: (v) => fmt(v),
    actual: (v) => fmt(v),
    error: (v) => (v >= 0 ? "+" : "−") + fmt(Math.abs(v), 3),
    accuracy: (v) => fmt(v, 3),
  };
  const figureNow = {};
  let figureAnim = null;
  function setFigures(values, roll) {
    if (figureAnim) cancelAnimationFrame(figureAnim);
    const put = (vals) => Object.keys(FIGURES).forEach((k) => { el(k).textContent = FIGURES[k](vals[k]); figureNow[k] = vals[k]; });
    if (!roll || reduceMotion.matches) { figuresWaiting = false; waiting.delete(figuresBox); put(values); return; }
    // hold the previous numbers (zero the first time) until the figures are on screen, then count to the new ones
    const from = {};
    Object.keys(FIGURES).forEach((k) => { from[k] = figureNow[k] || 0; });
    put(from);
    figuresWaiting = true;
    whenVisible(figuresBox, () => {
      figuresWaiting = false;
      results.setAttribute("aria-busy", "true"); // screen readers announce the final values only
      const t0 = performance.now(), dur = 750;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const vals = {};
        Object.keys(FIGURES).forEach((key) => { vals[key] = from[key] + (values[key] - from[key]) * e; });
        put(k < 1 ? vals : values);
        if (k < 1) figureAnim = requestAnimationFrame(step);
        else { figureAnim = null; results.setAttribute("aria-busy", "false"); }
      };
      figureAnim = requestAnimationFrame(step);
    });
  }

  function renderFigures(row, fresh) {
    const h = H[hz];
    const f = row.forecasts[hz];
    const mae = h.metrics.mae;
    const err = f.predicted - f.actual;
    const within = Math.abs(err) <= mae;
    el("row-id").textContent = row.row.toLocaleString("en-US");
    el("row-note").textContent = `One of ${h.test_rows.toLocaleString("en-US")} held-out rows the model never trained on, picked at random.`;
    el("hero-name").textContent = `Predicted outlet temperature, ${words(h.minutes)} ahead`;
    el("actual-name").textContent = `Actual, ${words(h.minutes)} later`;
    // accuracy of this one forecast: 100% minus its percentage error
    setFigures({ predicted: f.predicted, actual: f.actual, error: err,
      accuracy: 100 - (Math.abs(err) / Math.abs(f.actual)) * 100 }, fresh || figuresWaiting);
    const status = el("status");
    status.className = "status " + (within ? "is-good" : "is-warn");
    el("status-text").textContent = within
      ? `Within the model's mean error of ${fmt(mae, 3)} °C.`
      : `Larger than the model's mean error of ${fmt(mae, 3)} °C.`;
    el("model-used").textContent = `Model: ${modelName(h.model)}`;
    el("band-label").textContent = "Mean error of each forecast";
    el("chart-cap").textContent =
      "Outlet steam temperature over the 10 minutes before this moment (lighter after Now: what was measured next), " +
      "and the forecasts made at this moment for 1, 5 and 10 minutes ahead. The selected horizon is darker.";
  }

  function renderMoment(row) {
    const body = el("moment-body");
    body.innerHTML = "";
    H.forEach((h, k) => {
      const f = row.forecasts[k];
      const tr = document.createElement("tr");
      if (k === hz) tr.className = "on";
      const shortModel = shortName(h.model);
      const gain = h.improvement_percent > 0
        ? [`${fmt(h.improvement_percent, 1)}% lower error`, "n gain"]
        : ["Is linear regression", "n same"];
      const labels = ["", "", "Actual", "Predicted", "Mean absolute error", "Accuracy", "Better than linear regression alone"];
      [[h.minutes === 1 ? "1 minute" : `${h.minutes} minutes`, ""], [shortModel, ""],
       [`${fmt(f.actual)} °C`, "n"], [`${fmt(f.predicted)} °C`, "n"],
       [`${fmt(h.metrics.mae, 3)} °C`, "n"], [`${fmt(h.metrics.accuracy, 3)}%`, "n"], gain].forEach(([text, cls], c) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        if (labels[c]) td.dataset.label = labels[c];
        tr.appendChild(td);
      });
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => segButtons[k].click());
      body.appendChild(tr);
    });
  }

  function renderInputs(row) {
    const wrap = el("input-groups");
    wrap.innerHTML = "";
    const sections = [{
      title: "Outlet steam temperature",
      rows: history.slice().reverse().map(([i, s]) => [s === 0 ? "Now" : `${s} s earlier`, row.inputs[i], "°C"]),
    }];
    const buckets = GROUPS.map((g) => ({ title: g.title, rows: [] }));
    const used = new Set(H[hz].inputs_used);
    D.features.slice(0, nSensor).forEach((name, i) => {
      if (i === targetIdx || !used.has(i)) return;
      buckets[GROUPS.findIndex((g) => g.test(name))].rows.push([name, row.inputs[i], unitOf(name)]);
    });
    // most relevant to the steam first
    [2, 3, 4, 0, 1].forEach((k) => sections.push(buckets[k]));

    sections.forEach((sec) => {
      const div = document.createElement("div");
      div.className = "group";
      const h = document.createElement("h3");
      h.textContent = sec.title;
      const table = document.createElement("table");
      const body = document.createElement("tbody");
      sec.rows.forEach(([label, v, unit]) => {
        const tr = document.createElement("tr");
        const a = document.createElement("td");
        const b = document.createElement("td");
        a.textContent = label;
        b.className = "v";
        b.textContent = fmt(v, 2);
        if (unit) {
          const u = document.createElement("span");
          u.className = "u";
          u.textContent = " " + unit;
          b.appendChild(u);
        }
        tr.append(a, b);
        body.appendChild(tr);
      });
      table.appendChild(body);
      div.append(h, table);
      wrap.appendChild(div);
    });

    const h = H[hz];
    const lin = h.linear_metrics;
    el("inputs-sub").textContent =
      `All ${h.inputs_used.length} inputs the ${words(h.minutes)} forecast uses at this moment, as recorded by the plant sensors (temperatures in °C), grouped by part of the boiler.`;
    el("footnote").textContent =
      `Over all ${h.test_rows.toLocaleString("en-US")} test rows the model's mean absolute error ${words(h.minutes)} ahead is ` +
      `${fmt(h.metrics.mae, 3)} °C, root mean squared error ${fmt(h.metrics.rmse, 3)} °C and R² ${fmt(h.metrics.r2, 4)}` +
      (h.kind === "hybrid" ? `, against ${fmt(lin.mae, 3)} °C mean absolute error for linear regression alone. ` : ". ") +
      `Trained on the first ${D.train_rows.toLocaleString("en-US")} rows; forecast horizon ${h.steps} rows × ${D.seconds_per_step} s = ${words(h.minutes)}. ` +
      (h.all_sensors
        ? `This horizon uses all ${D.n_sensors_before} sensors: dropping correlated sensors kept the 1-minute accuracy but lowered it at 5 and 10 minutes.`
        : `${D.n_sensors_dropped} of the ${D.n_sensors_before} sensors were dropped for being more than ${D.correlation_limit} correlated with a sensor that was kept.`);
  }

  // --- chart: last minute of outlet temperature, then the forecast ---------
  function node(tag, attrs, parent) {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceStep(span) {
    const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
    return steps.find((s) => span / s <= 6) || 10;
  }

  function drawChart(row, animate) {
    const box = el("chart");
    box.innerHTML = "";
    const W = Math.max(300, box.clientWidth);
    drawnWidth = W;
    const narrow = W < 520;
    const Hh = narrow ? 250 : 300;
    const m = { t: 30, r: 14, b: 32, l: 46 };
    const pw = W - m.l - m.r, ph = Hh - m.t - m.b;

    const past = row.history.map((v, k) => [-600 + k * 30, v]);
    const ahead = row.future.map((v, k) => [k * 30, v]);
    const now = past[past.length - 1];
    const fc = H.map((h, k) => ({ t: h.minutes * 60, h, f: row.forecasts[k], on: k === hz }));

    const ys = row.history.concat(row.future);
    fc.forEach(({ f, h }) => ys.push(f.actual, f.predicted - h.metrics.mae, f.predicted + h.metrics.mae));
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const span = Math.max(hi - lo, 0.6);
    lo -= span * 0.08; hi += span * 0.08;
    const step = niceStep(hi - lo);
    const dec = step >= 1 ? 0 : step === 0.25 ? 2 : 1;

    const sx = (t) => m.l + ((t + 600) / 1200) * pw;
    const sy = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ph;

    const sel = fc[hz];
    const svg = node("svg", { width: W, height: Hh, viewBox: `0 0 ${W} ${Hh}`, role: "img",
      "aria-label": `Outlet temperature went from ${fmt(past[0][1])} to ${fmt(now[1])} °C over the last 10 minutes. ` +
        fc.map(({ h, f }) => `${minutesText(h.minutes)} ahead: forecast ${fmt(f.predicted)}, actual ${fmt(f.actual)} °C.`).join(" ") });

    node("rect", { x: sx(0), y: m.t, width: sx(600) - sx(0), height: ph, fill: "var(--zone)" }, svg);

    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = sy(v);
      node("line", { x1: m.l, x2: m.l + pw, y1: y, y2: y, stroke: "var(--grid)" }, svg);
      node("text", { x: m.l - 8, y: y + 4, "text-anchor": "end", class: "tick" }, svg).textContent = fmt(v, dec);
    }
    node("line", { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, stroke: "var(--line)" }, svg);
    node("line", { x1: sx(0), x2: sx(0), y1: m.t, y2: m.t + ph, stroke: "var(--steel)", "stroke-width": 1 }, svg);
    const ticks = narrow
      ? [[-600, "−10 min"], [0, "Now"], [600, "+10 min"]]
      : [[-600, "−10 min"], [-300, "−5 min"], [0, "Now"], [300, "+5 min"], [600, "+10 min"]];
    ticks.forEach(([t, s], k) => {
      const anchor = k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle";
      node("text", { x: sx(t), y: Hh - 10, "text-anchor": anchor, class: "tick" }, svg).textContent = s;
    });
    node("text", { x: sx(-600) + 2, y: m.t - 12, class: "zone-lbl" }, svg).textContent = "Last 10 minutes";

    // a guide for each horizon, labelled at the top
    fc.forEach(({ t, h, on }) => {
      node("line", { x1: sx(t), x2: sx(t), y1: m.t, y2: m.t + ph, stroke: on ? "var(--steel)" : "var(--grid)",
        "stroke-dasharray": on ? "none" : "2 3" }, svg);
      const anchor = t === 600 ? "end" : "middle";
      node("text", { x: sx(t), y: m.t - 12, "text-anchor": anchor,
        class: "hz-lbl" + (on ? " on" : "") }, svg).textContent = narrow && t < 600 ? `+${h.minutes}` : `+${h.minutes} min`;
    });

    // A new test row plays once: the measured line draws itself up to Now, then the forecast and what was
    // measured next extend together, each point popping in as the front reaches it. Then the chart stays still.
    const marks = node("g", {}, svg);
    const anims = [];
    const moving = animate && !reduceMotion.matches && typeof svg.animate === "function";
    const T1 = 500, T2 = 750;
    const reach = (t) => T1 + (t / 600) * T2;
    const tween = (n, frames, opts) => {
      if (!moving) return;
      const a = n.animate(frames, Object.assign({ fill: "both" }, opts));
      a.pause();
      anims.push(a);
    };
    const pop = (n, delay) => {
      n.style.transformBox = "fill-box";
      n.style.transformOrigin = "center";
      tween(n, [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1.4)", opacity: 1, offset: 0.65 },
        { transform: "scale(1)", opacity: 1 }], { duration: 260, delay });
    };

    // ± mean error band around each forecast
    fc.forEach(({ t, h, f, on }) => {
      const band = node("rect", { x: sx(t) - 7, width: 14, y: sy(f.predicted + h.metrics.mae),
        height: sy(f.predicted - h.metrics.mae) - sy(f.predicted + h.metrics.mae),
        rx: 4, fill: "var(--ink)", "fill-opacity": on ? 0.13 : 0.06 }, marks);
      tween(band, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: reach(t) });
    });

    // everything after Now sits in one group, uncovered from Now to the right
    const ahead_g = node("g", {}, marks);
    if (moving) {
      const clipId = "front" + Math.random().toString(36).slice(2, 8);
      const cover = node("rect", { x: sx(0), y: 0, width: sx(600) - sx(0) + 12, height: Hh }, node("clipPath", { id: clipId }, svg));
      cover.style.transformBox = "fill-box";
      cover.style.transformOrigin = "0 0";
      ahead_g.setAttribute("clip-path", `url(#${clipId})`);
      tween(cover, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: T2, delay: T1, easing: "linear" });
    }
    // what actually happened next
    node("path", { d: ahead.map((p, k) => (k ? "L" : "M") + sx(p[0]) + " " + sy(p[1])).join(" "), fill: "none",
      stroke: "var(--steam)", "stroke-opacity": 0.45, "stroke-width": 1.5, "stroke-linejoin": "round" }, ahead_g);
    // forecast path through the three forecasts
    node("path", { d: `M${sx(0)} ${sy(now[1])} ` + fc.map(({ t, f }) => `L${sx(t)} ${sy(f.predicted)}`).join(" "),
      fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.5, "stroke-dasharray": "4 4" }, ahead_g);

    // the measured past
    const pastLine = node("path", { d: past.map((p, k) => (k ? "L" : "M") + sx(p[0]) + " " + sy(p[1])).join(" "), fill: "none",
      stroke: "var(--steam)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, marks);
    if (moving) {
      pastLine.setAttribute("pathLength", 1);
      pastLine.setAttribute("stroke-dasharray", "1 1");
      tween(pastLine, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: T1, easing: "cubic-bezier(.35, 0, .3, 1)" });
    }
    pop(node("circle", { cx: sx(0), cy: sy(now[1]), r: 4.5, fill: "var(--steam)", stroke: "#fff", "stroke-width": 2 }, marks), T1 - 140);

    fc.forEach(({ t, f, on }) => {
      const r = on ? 5.5 : 4;
      pop(node("circle", { cx: sx(t), cy: sy(f.actual), r, fill: "var(--steam)", "fill-opacity": on ? 1 : 0.55,
        stroke: "#fff", "stroke-width": 2 }, marks), reach(t));
      pop(node("circle", { cx: sx(t), cy: sy(f.predicted), r, fill: "#fff", stroke: on ? "var(--ink)" : "var(--ink-2)",
        "stroke-opacity": on ? 1 : 0.6, "stroke-width": 2 }, marks), reach(t));
    });

    // hover and keyboard targets bigger than the marks
    const tip = document.createElement("div");
    tip.className = "tip";
    const targets = [[0, now[1], "Now"]];
    fc.forEach(({ t, h, f }) => {
      targets.push([t, f.actual, `Actual, ${minutesText(h.minutes)} later`]);
      targets.push([t, f.predicted, `Forecast, ${minutesText(h.minutes)} ahead`]);
    });
    targets.forEach(([t, v, label]) => {
      const hit = node("circle", { cx: sx(t), cy: sy(v), r: 11, class: "hit", tabindex: 0, "aria-label": `${label}: ${fmt(v)} °C` }, svg);
      const on = () => {
        tip.innerHTML = `${label}<br><b>${fmt(v)} °C</b>`;
        tip.style.left = Math.min(Math.max(sx(t), 70), W - 70) + "px";
        tip.style.top = sy(v) + "px";
        tip.classList.add("on");
      };
      const off = () => tip.classList.remove("on");
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("pointerleave", off);
      hit.addEventListener("focus", on);
      hit.addEventListener("blur", off);
    });

    box.append(svg, tip);
    return moving ? () => anims.forEach((a) => a.play()) : null;
  }

  // draws the chart; a new row waits until the chart is on screen, then plays once
  function renderChart(row, animate) {
    const play = drawChart(row, animate);
    chartWaiting = Boolean(play);
    if (play) whenVisible(el("chart"), () => { chartWaiting = false; play(); });
    else waiting.delete(el("chart"));
  }

  function show(row) {
    const fresh = row !== shown;
    shown = row;
    const first = results.hidden;
    results.hidden = false;
    inputs.hidden = false;
    if (first) {
      results.classList.add("enter");
    } else {
      const body = el("results-body");
      body.classList.remove("swap");
      void body.offsetWidth; // restart the crossfade
      body.classList.add("swap");
    }
    renderFigures(row, fresh);
    renderChart(row, fresh || chartWaiting);
    renderMoment(row);
    renderInputs(row);
    countTo(row.forecasts[hz].predicted);
  }

  function setRunning(on) {
    running = on;
    plant.classList.toggle("running", on);
    if (reduceMotion.matches) {
      if (on && drawingOverflow() > 4) drawing.scrollLeft = drawingOverflow();
    } else {
      if (on) startedAt = performance.now() / 1000;
      if (!moteFrame) { lastT = 0; moteFrame = requestAnimationFrame(moveMotes); }
      if (drawingOverflow() > 4) on ? panDrawing(drawingOverflow(), 500, 2300) : panDrawing(0, 0, 900);
    }
    powerBtn.setAttribute("aria-pressed", String(on));
    powerLabel.textContent = on ? "Stop the boiler" : "Start the boiler";
  }

  powerBtn.addEventListener("click", () => {
    clearTimeout(pending);
    setRunning(!running);
    if (!running) return;
    const first = results.hidden;
    const quick = reduceMotion.matches;
    // let the fire catch and every stream reach the end of its pipe before the numbers arrive
    pending = setTimeout(() => {
      show(pickRow());
      if (!first) return;
      // give the readout a moment on screen, then bring the results into view
      pending = setTimeout(() => results.scrollIntoView({ behavior: quick ? "auto" : "smooth", block: "start" }), quick ? 0 : 1500);
    }, quick ? 300 : first ? (drawingOverflow() > 4 ? 2900 : 2500) : 600);
  });

  el("another").addEventListener("click", () => show(pickRow()));

  // 1 / 5 / 10 minute toggle
  const segButtons = H.map((h, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = h.minutes === 1 ? "1 min" : `${h.minutes} min`;
    b.setAttribute("aria-label", `Forecast ${words(h.minutes)} ahead`);
    b.setAttribute("aria-pressed", String(k === hz));
    b.addEventListener("click", () => {
      if (k === hz) return;
      hz = k;
      segButtons.forEach((x, i) => x.setAttribute("aria-pressed", String(i === hz)));
      if (shown) show(shown);
    });
    el("horizon").appendChild(b);
    return b;
  });

  let resizeTimer = null;
  new ResizeObserver(() => {
    if (!shown || Math.max(300, el("chart").clientWidth) === drawnWidth) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderChart(shown, chartWaiting), 80);
  }).observe(el("chart"));
})();
