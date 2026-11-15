import { render, Fragment } from "preact";
import { useState, useEffect, useMemo, useId, useRef } from "preact/hooks";
import {
  MARKET_RATE, RATE_AS_OF, SDLT_EFFECTIVE, STRESS_DELTA, LTI_CAP, FTB_MAX_PRICE,
  calcMortgage, computePosition, breakEvenOffer, fmt, fmtSigned, fmtPct, JOURNEYS,
} from "./calc.js";

// ─── Persistence (this device only) ───────────────────────────────────────────
const STORE_KEY = "chainready:v1";

const DEFAULT_INPUTS = {
  offerPrice: 450000, depositPct: 15, buyerType: "standard", nonResident: false,
  mortgageRate: MARKET_RATE, mortgageTerm: 25,
  salePrice: 320000, existingMortgage: 0, agentFeePct: 1.5, agentFeeVAT: true, sellerSolicitorFee: 1500,
  buyerSolicitorFee: 2000, surveyFee: 800, removals: 1200, mortgageArrangement: 999, otherCosts: 500,
  savings: 50000,
};
const DEFAULT_STATE = {
  stage: "journey", journey: null, tab: "overview",
  ob: { offerPrice: "", depositPct: "", salePrice: "", existingMortgage: "", savings: "" },
  inputs: DEFAULT_INPUTS, income: "", scen: {}, saved: [],
};

function loadState() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!d || d.v !== 1 || (d.journey && !JOURNEYS[d.journey])) return DEFAULT_STATE;
    const s = { ...DEFAULT_STATE, ...d, inputs: { ...DEFAULT_INPUTS, ...d.inputs }, ob: { ...DEFAULT_STATE.ob, ...d.ob } };
    if (!s.journey) s.stage = "journey";
    if (!Array.isArray(s.saved)) s.saved = [];
    return s;
  } catch {
    return DEFAULT_STATE;
  }
}
function saveState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, ...s })); } catch { /* private mode: run unsaved */ }
}

// ─── UI components ────────────────────────────────────────────────────────────
function Fan({ style }) {
  return (
    <svg class="cr-fan" width="42" height="20" viewBox="0 0 42 20" style={style} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line key={i} x1="21" y1="20" x2={3 + i * 5.7} y2="2" stroke="var(--gold)" stroke-width="1" opacity={0.35 + Math.abs(3 - i) * 0.12} />
      ))}
    </svg>
  );
}

function MoneyInput({ id, value, onChange, placeholder, error, suffix, decimal, describedBy }) {
  const [draft, setDraft] = useState(null);
  const display = draft ?? (value === "" || value === null ? "" : Number(value).toLocaleString("en-GB"));
  const parse = (text) => {
    const raw = decimal ? text.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1") : text.replace(/[^0-9]/g, "");
    return { raw, num: raw === "" || raw === "." ? "" : Number(raw) };
  };
  return (
    <div class="cr-money">
      {!suffix && <span class="cr-money-sym" aria-hidden="true">£</span>}
      <input
        id={id} type="text" inputMode={decimal ? "decimal" : "numeric"} autocomplete="off"
        placeholder={placeholder} value={display} aria-invalid={error ? "true" : undefined} aria-describedby={describedBy}
        class={"cr-input" + (error ? " cr-input-err" : "") + (suffix ? " cr-input-suffix" : " cr-input-money")}
        onInput={(e) => {
          const { raw, num } = parse(e.target.value);
          // Keep a draft only while the text can't round-trip (e.g. "12."), so typing decimals isn't interrupted.
          setDraft(decimal && /\.\d*0*$/.test(raw) ? raw : null);
          onChange(num);
        }}
        onBlur={() => setDraft(null)}
      />
      {suffix && <span class="cr-money-suffix" aria-hidden="true">{suffix}</span>}
    </div>
  );
}

function MoneyField({ label, value, onChange }) {
  const id = useId();
  return (
    <div class="cr-field">
      <label class="cr-field-label" for={id}>{label}</label>
      <MoneyInput id={id} value={value || ""} onChange={(v) => onChange(v === "" ? 0 : v)} placeholder="0" />
    </div>
  );
}

function SliderInput({ label, value, onChange, min, max, step = 1000, prefix = "£", suffix = "", hint, editMax }) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  // A value typed elsewhere may sit outside the nominal range; widen the track rather than misplace the thumb.
  const lo = Math.min(min, value), hi = Math.max(max, value);
  const pct = hi > lo ? ((value - lo) / (hi - lo)) * 100 : 0;
  const text = draft ?? value.toLocaleString("en-GB");
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft.replace(/[^0-9.]/g, ""));
    if (!isNaN(n)) onChange(Math.min(editMax ?? max, Math.max(min, Math.round(n * 100) / 100)));
    setDraft(null);
  };
  return (
    <div class="cr-slider">
      <div class="cr-slider-head">
        <label class="cr-field-label" for={id}>{label}</label>
        <span class="cr-slider-val">
          {prefix}
          <input
            class="cr-slider-edit" type="text" inputMode="decimal" autocomplete="off" aria-label={label + " — type an exact value"}
            value={text} size={Math.max(2, text.length)}
            onFocus={(e) => { setDraft(text); e.target.select(); }}
            onInput={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setDraft(null); e.target.blur(); } }}
          />
          {suffix}
        </span>
      </div>
      {hint && <div class="cr-hint cr-hint-tight">{hint}</div>}
      <div class="cr-track">
        <div class="cr-track-fill" style={{ width: pct + "%" }} />
        <input id={id} type="range" min={lo} max={hi} step={step} value={value} class="cr-range"
          onInput={(e) => onChange(Number(e.target.value))} />
      </div>
      <div class="cr-track-ends" aria-hidden="true">
        <span>{prefix}{lo.toLocaleString("en-GB")}{suffix}</span>
        <span>{prefix}{hi.toLocaleString("en-GB")}{suffix}</span>
      </div>
    </div>
  );
}

function PillToggle({ options, value, onChange, label }) {
  return (
    <div class="cr-pills" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          class={"cr-pill" + (value === o.value ? " cr-pill-on" : "")}>{o.label}</button>
      ))}
    </div>
  );
}

function Switch({ label, checked, onChange }) {
  const id = useId();
  return (
    <div class="cr-toggle-row">
      <span class="cr-hint cr-hint-flat" id={id}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id}
        onClick={() => onChange(!checked)} class={"cr-switch" + (checked ? " cr-switch-on" : "")}><span /></button>
    </div>
  );
}

function Card({ title, subtitle, children, accent }) {
  return (
    <section class={"cr-card" + (accent ? " cr-card-accent" : "")} style={accent ? { "--card-accent": accent } : undefined}>
      {title && (
        <div class="cr-card-head">
          <div>
            <h2 class="cr-card-title">{title}</h2>
            {subtitle && <div class="cr-card-sub">{subtitle}</div>}
          </div>
          <Fan />
        </div>
      )}
      <div class="cr-card-body">{children}</div>
    </section>
  );
}

function CostRow({ label, value, sub, highlight }) {
  return (
    <div class={"cr-row" + (highlight ? " cr-row-hl" : "")}>
      <span class="cr-row-label">{label}</span>
      <div class="cr-row-right">
        {sub && <span class="cr-row-sub">{sub}</span>}
        <span class="cr-row-val">{fmt(value)}</span>
      </div>
    </div>
  );
}

function Donut({ segments, centerLabel, centerValue, size = 200 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 16, c = size / 2, circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div class="cr-donut-wrap" role="img"
      aria-label={`${centerLabel}: ${centerValue}. ` + segments.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" stroke-width="16" />
        {segments.map((seg) => {
          const len = (seg.value / total) * circ;
          const el = (
            <circle key={seg.label} class="cr-donut-arc" cx={c} cy={c} r={r} fill="none" stroke={seg.color} stroke-width="16"
              stroke-dasharray={`${len} ${circ - len}`} stroke-dashoffset={-offset} transform={`rotate(-90 ${c} ${c})`} />
          );
          offset += len;
          return el;
        })}
        <circle cx={c} cy={c} r={r - 22} fill="none" stroke="var(--gold)" stroke-width="0.75" opacity="0.4" />
      </svg>
      <div class="cr-donut-center">
        <div class="cr-donut-c-label">{centerLabel}</div>
        <div class="cr-donut-c-val">{centerValue}</div>
      </div>
    </div>
  );
}

function Legend({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div class="cr-legend">
      {segments.map((s) => (
        <div key={s.label} class="cr-legend-row">
          <span class="cr-legend-dot" style={{ background: s.color }} />
          <span class="cr-legend-label">{s.label}</span>
          <span class="cr-legend-pct">{Math.round((s.value / total) * 100)}%</span>
          <span class="cr-legend-val">{fmt(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

function StatTile({ label, value, sub, tone }) {
  return (
    <div class={"cr-tile" + (tone ? " cr-tile-" + tone : "")}>
      <div class="cr-tile-label">{label}</div>
      <div class="cr-tile-val">{value}</div>
      {sub && <div class="cr-tile-sub">{sub}</div>}
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
function JourneyPicker({ onPick }) {
  return (
    <main class="cr-stage cr-journey">
      <span class="cr-step-tag">Step 1 of 2</span>
      <Fan style={{ margin: "0 auto 18px", display: "block" }} />
      <h1 class="cr-display-h1">What does your move<br /><em>look like?</em></h1>
      <p class="cr-lede">ChainReady adapts everything — questions, stamp duty, and the cash maths — to your situation.</p>
      <div class="cr-journey-list">
        {Object.entries(JOURNEYS).map(([key, j]) => (
          <button key={key} type="button" onClick={() => onPick(key)} class="cr-journey-card">
            <span>
              <span class="cr-journey-title">{j.label}</span>
              <span class="cr-journey-desc">{j.desc}</span>
            </span>
            <span class="cr-journey-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </main>
  );
}

function DetailsForm({ journey, values, setValues, onBack, onComplete }) {
  const j = JOURNEYS[journey];
  const [errors, setErrors] = useState({});
  const uid = useId();
  const fieldDefs = {
    offerPrice: { label: "Offer price on the new property", hint: "The price you plan to offer or have offered.", required: true, placeholder: "e.g. 450,000" },
    depositPct: { label: "Deposit", hint: "Percentage of the purchase price you'll put down.", required: true, suffix: "%", placeholder: "e.g. 15", min: 5, max: 100 },
    salePrice: { label: "Expected sale price of your current property", hint: "Estimates are fine — you can refine later.", required: true, placeholder: "e.g. 320,000" },
    existingMortgage: { label: "Mortgage outstanding on your current property", hint: "Balance left to repay. Leave blank if none.", required: false, placeholder: "e.g. 50,000" },
    savings: j.hasSale
      ? { label: "Additional savings you're bringing in", hint: "Cash on top of your sale proceeds. Leave blank if none.", required: false, placeholder: "e.g. 50,000" }
      : { label: "Savings available for this purchase", hint: "Your total cash available for deposit and costs.", required: true, placeholder: "e.g. 50,000" },
  };
  const order = j.hasSale
    ? ["offerPrice", "depositPct", "salePrice", "existingMortgage", "savings"]
    : ["offerPrice", "depositPct", "savings"];
  const steps = j.hasSale ? [
    { n: "I", t: "Enter your basics", b: "Quick estimates are fine — everything stays editable." },
    { n: "II", t: "See your position", b: "Your cash surplus or shortfall after every cost, instantly." },
    { n: "III", t: "Refine and stress-test", b: "Adjust fees, rates and prices. Run scenarios before you commit." },
  ] : [
    { n: "I", t: "Enter your basics", b: "Three numbers. Quick estimates are fine." },
    { n: "II", t: "See your position", b: "Whether your savings cover the deposit and every buying cost." },
    { n: "III", t: "Refine and stress-test", b: "Adjust costs and rates. Run scenarios before you offer." },
  ];
  const validate = (k) => {
    const f = fieldDefs[k], v = Number(values[k]) || 0;
    if (f.required && v <= 0) return "Required";
    if (f.min !== undefined && values[k] !== "" && (v < f.min || v > f.max)) return `Enter ${f.min}–${f.max}`;
    return null;
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = {};
    order.forEach((k) => { const m = validate(k); if (m) errs[k] = m; });
    setErrors(errs);
    const first = order.find((k) => errs[k]);
    if (first) document.getElementById(`${uid}-${first}`)?.focus();
    else onComplete();
  };
  return (
    <main class="cr-stage cr-details">
      <div class="cr-guide">
        <span class="cr-step-tag">Step 2 of 2 · {j.badge}</span>
        <h1 class="cr-guide-h">Plan your move<br /><em>with clarity.</em></h1>
        <p class="cr-guide-p">
          {j.hasSale
            ? "ChainReady calculates your full position across both the purchase and the sale — so you know exactly where you stand before you negotiate."
            : "ChainReady calculates your full position — deposit, stamp duty, fees and mortgage — so you know exactly where you stand before you offer."}
        </p>
        <ol class="cr-steps">
          {steps.map((s) => (
            <li key={s.n} class="cr-step">
              <div class="cr-step-num" aria-hidden="true">{s.n}</div>
              <div>
                <div class="cr-step-t">{s.t}</div>
                <div class="cr-step-b">{s.b}</div>
              </div>
            </li>
          ))}
        </ol>
        <div class="cr-note cr-note-gap"><strong>No sign-up needed.</strong> Your numbers are kept in this browser only so you can pick up where you left off — nothing is uploaded or shared.</div>
      </div>
      <form class="cr-form" onSubmit={handleSubmit} noValidate>
        <div class="cr-form-head">
          <h2 class="cr-form-title">Your numbers</h2>
          <button type="button" onClick={onBack} class="cr-link">← Back</button>
        </div>
        <div class="cr-form-sub">Estimates are fine — everything stays editable inside the tool.</div>
        {order.map((k) => {
          const f = fieldDefs[k], id = `${uid}-${k}`;
          return (
            <div key={k} class="cr-field cr-field-lg">
              <label for={id} class={"cr-field-label" + (errors[k] ? " cr-err" : "")}>
                <span>{f.label}{!f.required && <span class="cr-opt">(optional)</span>}</span>
                {errors[k] && <span class="cr-err-tag" role="alert">{errors[k]}</span>}
              </label>
              <MoneyInput id={id} value={values[k]} decimal={f.suffix === "%"} describedBy={id + "-hint"}
                onChange={(v) => { setValues({ ...values, [k]: v }); if (errors[k]) setErrors({ ...errors, [k]: null }); }}
                placeholder={f.placeholder} error={!!errors[k]} suffix={f.suffix} />
              <div class="cr-hint" id={id + "-hint"}>{f.hint}</div>
            </div>
          );
        })}
        <button type="submit" class="cr-btn-gold cr-btn-block">Show my position →</button>
      </form>
    </main>
  );
}

// ─── Print report (hidden on screen, shown by the print stylesheet) ───────────
function PrintReport({ journey, i, p, hasSale, savedRows }) {
  const Row = ({ l, v }) => <div class="pr-row"><span>{l}</span><span>{v}</span></div>;
  return (
    <div class="cr-print" aria-hidden="true">
      <h1>CHAINREADY · {JOURNEYS[journey].badge} Analysis</h1>
      <div class="pr-sub">Generated {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · fasanya.co.uk</div>
      <div class={"pr-verdict " + (p.surplus >= 0 ? "pr-ok" : "pr-warn")}>
        {p.surplus >= 0 ? `Cash surplus of ${fmt(p.surplus)} after all costs` : `Cash shortfall of ${fmt(-p.surplus)} — additional funds needed`}
      </div>
      <div class="pr-tiles">
        {[
          ["Offer Price", fmt(i.offerPrice)],
          [`Deposit (${i.depositPct}%)`, fmt(p.depositAmount)],
          ["Stamp Duty", fmt(p.sdlt.total)],
          ["Mortgage", fmt(p.mortgageLoan)],
          [`Monthly (${fmtPct(i.mortgageRate)}, ${i.mortgageTerm}yr)`, fmt(p.mortgage.monthly)],
          ["Surplus / Deficit", fmtSigned(p.surplus)],
        ].map(([l, v]) => <div key={l} class="pr-tile"><div class="pr-tile-l">{l}</div><div class="pr-tile-v">{v}</div></div>)}
      </div>
      <div class="pr-cols">
        <div class="pr-sec">
          <div class="pr-sec-h">Cash Needed</div>
          <div class="pr-sec-b">
            <Row l={`Deposit (${i.depositPct}%)`} v={fmt(p.depositAmount)} />
            <Row l="Stamp Duty" v={fmt(p.sdlt.total)} />
            <Row l="Solicitor" v={fmt(i.buyerSolicitorFee)} />
            <Row l="Survey" v={fmt(i.surveyFee)} />
            <Row l="Mortgage Arrangement" v={fmt(i.mortgageArrangement)} />
            <Row l="Removals" v={fmt(i.removals)} />
            <Row l="Other" v={fmt(i.otherCosts)} />
            <div class="pr-total"><span>TOTAL NEEDED</span><span>{fmt(p.totalCashNeeded)}</span></div>
          </div>
        </div>
        <div class="pr-sec">
          <div class="pr-sec-h">Cash Available</div>
          <div class="pr-sec-b">
            {hasSale && (<Fragment>
              <Row l="Sale Price" v={fmt(i.salePrice)} />
              <Row l={"Agent Fee" + (i.agentFeeVAT ? " (incl. VAT)" : "")} v={fmt(-p.agentFeeTotal)} />
              <Row l="Solicitor (sale)" v={fmt(-i.sellerSolicitorFee)} />
              <Row l="Mortgage Repaid" v={fmt(-i.existingMortgage)} />
              <Row l="Net from Sale" v={fmt(p.netSaleProceeds)} />
            </Fragment>)}
            <Row l="Savings" v={fmt(i.savings)} />
            <div class="pr-total"><span>TOTAL AVAILABLE</span><span>{fmt(p.cashAvailable)}</span></div>
          </div>
        </div>
      </div>
      {savedRows.length > 0 && (
        <div class="pr-sec pr-saved">
          <div class="pr-sec-h">Saved Scenarios</div>
          <div class="pr-sec-b">
            {savedRows.map((r) => <Row key={r.id} l={`${r.name} — ${r.summary}`} v={`${fmtSigned(r.pos.surplus)} · ${fmt(r.pos.mortgage.monthly)}/mo`} />)}
          </div>
        </div>
      )}
      <div class="pr-footer">
        Illustrative only — not financial, legal or tax advice. SDLT uses HMRC residential rates for England and Northern Ireland effective {SDLT_EFFECTIVE}.
        The default mortgage rate of {MARKET_RATE}% was a best-buy 5-year fixed as of {RATE_AS_OF}; use your own quote. Consult a qualified adviser before making decisions.
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [s, setS] = useState(loadState);
  const patch = (p) => setS((prev) => ({ ...prev, ...p }));
  const setInput = (k) => (v) => setS((prev) => ({ ...prev, inputs: { ...prev.inputs, [k]: v } }));
  const setScen = (k) => (v) => setS((prev) => ({ ...prev, scen: { ...prev.scen, [k]: v } }));
  useEffect(() => saveState(s), [s]);

  const { stage, journey, tab, inputs, income, scen, saved } = s;
  const hasSale = journey ? JOURNEYS[journey].hasSale : false;
  const i = { ...inputs, hasSale };
  const p = useMemo(() => computePosition(i), [inputs, hasSale]);

  // Scenario levers are stored as overrides, so untouched levers keep tracking the base case.
  const withOverrides = (over) => ({
    ...i,
    offerPrice: over.offerPrice ?? i.offerPrice,
    salePrice: over.salePrice ?? i.salePrice,
    depositPct: over.depositPct ?? i.depositPct,
    mortgageRate: over.rate ?? i.mortgageRate,
  });
  const si = withOverrides(scen);
  const sp = computePosition(si);
  const scenDirty = Object.values(scen).some((v) => v !== undefined);
  const breakEven = breakEvenOffer(si);
  const savedRows = saved.map((row) => {
    const ri = withOverrides(row.over);
    return {
      ...row, pos: computePosition(ri),
      summary: [fmt(ri.offerPrice), hasSale && `sale ${fmt(ri.salePrice)}`, `${ri.depositPct}% deposit`, fmtPct(ri.mortgageRate)].filter(Boolean).join(" · "),
    };
  });

  const [scenName, setScenName] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const tabsRef = useRef(null);

  const pickJourney = (key) => patch({ journey: key, stage: "details", inputs: { ...inputs, buyerType: JOURNEYS[key].buyerType } });
  const completeOnboarding = () => {
    const n = (v) => Number(v) || 0;
    const next = { ...inputs, offerPrice: n(s.ob.offerPrice), depositPct: n(s.ob.depositPct), savings: n(s.ob.savings) };
    if (hasSale) { next.salePrice = n(s.ob.salePrice); next.existingMortgage = n(s.ob.existingMortgage); }
    patch({ inputs: next, scen: {}, tab: "overview", stage: "dashboard" });
    window.scrollTo(0, 0);
  };
  const editNumbers = () => patch({
    stage: "details",
    ob: { offerPrice: inputs.offerPrice, depositPct: inputs.depositPct, salePrice: inputs.salePrice, existingMortgage: inputs.existingMortgage || "", savings: inputs.savings || "" },
  });
  const saveScenario = (e) => {
    e.preventDefault();
    const over = { offerPrice: si.offerPrice, salePrice: si.salePrice, depositPct: si.depositPct, rate: si.mortgageRate };
    patch({ saved: [...saved, { id: Date.now().toString(36), name: scenName.trim() || `Scenario ${saved.length + 1}`, over }] });
    setScenName("");
  };
  const startOver = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    setS(DEFAULT_STATE);
    window.scrollTo(0, 0);
  };

  const lti = income > 0 ? p.mortgageLoan / income : null;
  const ftbCliff = i.buyerType === "firstTime" && !p.sdlt.ftbRelief;
  const sdltNote = [
    i.buyerType === "firstTime" ? (ftbCliff ? "Over £500k — no FTB relief" : "FTB relief applied") : i.buyerType === "additional" ? "+5% surcharge" : "Standard rates",
    i.nonResident && "+2% non-resident",
  ].filter(Boolean).join(" · ");

  const costSegments = [
    { label: "Deposit", value: p.depositAmount, color: "var(--gold)" },
    { label: "Stamp Duty", value: p.sdlt.total, color: "var(--gold-light)" },
    { label: "Solicitor", value: i.buyerSolicitorFee, color: "var(--sage)" },
    { label: "Survey", value: i.surveyFee, color: "var(--gold-deep)" },
    { label: "Mortgage fee", value: i.mortgageArrangement, color: "var(--clay)" },
    { label: "Removals", value: i.removals, color: "var(--sage-deep)" },
    { label: "Other", value: i.otherCosts, color: "var(--cream)" },
  ].filter((seg) => seg.value > 0);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "purchase", label: "Purchase" },
    ...(hasSale ? [{ id: "sale", label: "Sale" }] : []),
    { id: "mortgage", label: "Mortgage" },
    { id: "stampduty", label: "Stamp Duty" },
    { id: "scenario", label: "Scenarios" },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "overview";
  const onTabKey = (e) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = tabs[(tabs.findIndex((t) => t.id === activeTab) + dir + tabs.length) % tabs.length];
    patch({ tab: next.id });
    tabsRef.current?.querySelector(`#cr-tab-${next.id}`)?.focus();
  };

  return (
    <div class="cr-app">
      <div class="cr-screen">
        <header class="cr-header">
          <div class="cr-brand-wrap">
            <span class="cr-brand">ChainReady</span>
            <a class="cr-by" href="/">by Fasanya</a>
            {stage !== "journey" && journey && (
              <button type="button" onClick={() => patch({ stage: "journey" })} class="cr-badge">{JOURNEYS[journey].badge} · change</button>
            )}
          </div>
          {stage === "dashboard" && (
            <button type="button" onClick={() => window.print()} class="cr-link cr-export">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Print / save PDF
            </button>
          )}
        </header>

        {stage === "journey" && <JourneyPicker onPick={pickJourney} />}
        {stage === "details" && (
          <DetailsForm journey={journey} values={s.ob} setValues={(ob) => patch({ ob })}
            onBack={() => patch({ stage: "journey" })} onComplete={completeOnboarding} />
        )}

        {stage === "dashboard" && (
          <main class="cr-dashboard">
            <h1 class="cr-sr">Your {JOURNEYS[journey].badge} dashboard</h1>
            <div class="cr-tabs" role="tablist" aria-label="Dashboard sections" ref={tabsRef} onKeyDown={onTabKey}>
              {tabs.map((tb) => (
                <button key={tb.id} id={`cr-tab-${tb.id}`} type="button" role="tab" aria-selected={activeTab === tb.id} aria-controls="cr-panel"
                  tabIndex={activeTab === tb.id ? 0 : -1} onClick={() => patch({ tab: tb.id })}
                  class={"cr-tab" + (activeTab === tb.id ? " cr-tab-on" : "")}>{tb.label}</button>
              ))}
            </div>

            <div class="cr-content" id="cr-panel" role="tabpanel" aria-labelledby={`cr-tab-${activeTab}`}>
              {activeTab === "overview" && (<Fragment>
                <div class={"cr-verdict " + (p.surplus >= 0 ? "cr-verdict-ok" : "cr-verdict-warn")} role="status">
                  <div class="cr-verdict-main">
                    {p.surplus >= 0 ? `You're ${fmt(p.surplus)} ahead after every cost` : `Shortfall of ${fmt(-p.surplus)} — adjust your numbers or plan extra funds`}
                  </div>
                  <div class="cr-verdict-sub">
                    {hasSale ? "Based on your purchase and sale together" : "Based on your savings against deposit and all buying costs"} · Stress-test on the Scenarios tab
                  </div>
                </div>

                <div class="cr-tiles">
                  <StatTile label="Offer Price" value={fmt(i.offerPrice)} sub={JOURNEYS[journey].badge} tone="accent" />
                  <StatTile label="Deposit" value={fmt(p.depositAmount)} sub={`${i.depositPct}% · LTV ${fmtPct(p.ltv)}`} />
                  <StatTile label="Stamp Duty" value={fmt(p.sdlt.total)} sub={sdltNote} />
                  <StatTile label="Monthly Payment" value={fmt(p.mortgage.monthly)} sub={p.mortgageLoan > 0 ? `${fmtPct(i.mortgageRate)} · ${i.mortgageTerm}yr` : "No mortgage needed"} />
                  {hasSale
                    ? <StatTile label="Net Sale Proceeds" value={fmt(p.netSaleProceeds)} sub={`Equity ${fmt(p.saleEquity)}`} />
                    : <StatTile label="Total Cash Needed" value={fmt(p.totalCashNeeded)} sub="Deposit + all costs" />}
                  <StatTile label="Surplus / Deficit" value={fmtSigned(p.surplus)} sub="After all costs" tone={p.surplus >= 0 ? "pos" : "neg"} />
                </div>

                <div class="cr-grid-2">
                  <Card title="Where your cash goes" subtitle="Total cash needed to buy" accent="var(--clay)">
                    <div class="cr-donut-layout">
                      <Donut segments={costSegments} centerLabel="Total needed" centerValue={fmt(p.totalCashNeeded)} />
                      <Legend segments={costSegments} />
                    </div>
                  </Card>
                  <Card title="Cash Available" accent="var(--sage)">
                    {hasSale && (<Fragment>
                      <CostRow label="Sale Price" value={i.salePrice} />
                      <CostRow label="Agent Fee" value={-p.agentFeeTotal} sub={`${i.agentFeePct}%${i.agentFeeVAT ? " +VAT" : ""}`} />
                      <CostRow label="Solicitor (sale)" value={-i.sellerSolicitorFee} />
                      <CostRow label="Mortgage Repaid" value={-i.existingMortgage} />
                      <CostRow label="Net from Sale" value={p.netSaleProceeds} highlight />
                      <div class="cr-gap" />
                    </Fragment>)}
                    <CostRow label="Savings" value={i.savings} />
                    <CostRow label="Total available" value={p.cashAvailable} highlight />
                  </Card>
                </div>

                {lti !== null && lti > LTI_CAP && (
                  <div class="cr-alert" role="status">Heads-up: your loan is {lti.toFixed(1)}× your income — most lenders cap at ~{LTI_CAP}×. See the Mortgage tab.</div>
                )}
                {ftbCliff && (
                  <div class="cr-alert" role="status">First-time buyer relief stops at {fmt(FTB_MAX_PRICE)}. At this price standard rates apply — an offer of {fmt(FTB_MAX_PRICE)} or less would save {fmt(p.sdlt.total - 10000)} or more in stamp duty.</div>
                )}

                <div class="cr-note">
                  <strong>SDLT (England &amp; NI, from {SDLT_EFFECTIVE}):</strong> 0% to £125k · 2% to £250k · 5% to £925k · 10% to £1.5m · 12% above. First-time buyers: 0% to £300k, 5% to £500k (no relief above £500k). Additional property: +5% on every band. Scotland (LBTT) and Wales (LTT) use different taxes and aren't modelled.
                </div>
                <button type="button" onClick={editNumbers} class="cr-link cr-edit-link">← Edit my numbers</button>
              </Fragment>)}

              {activeTab === "purchase" && (<Fragment>
                <Card title="Purchase Details">
                  <SliderInput label="Offer / Purchase Price" value={i.offerPrice} onChange={setInput("offerPrice")} min={100000} max={3000000} step={5000} editMax={50000000} />
                  <SliderInput label="Deposit" value={i.depositPct} onChange={setInput("depositPct")} min={5} max={100} step={1} prefix="" suffix="%" />
                </Card>
                <div class="cr-grid-2">
                  <Card title="Deposit & Loan">
                    <CostRow label="Offer Price" value={i.offerPrice} />
                    <CostRow label="Deposit" value={p.depositAmount} sub={`${i.depositPct}%`} />
                    <CostRow label="Mortgage Required" value={p.mortgageLoan} highlight />
                    <div class="cr-ltv">
                      <div class="cr-hint">Loan-to-value: {fmtPct(p.ltv)}</div>
                      <div class="cr-bar"><div class="cr-bar-fill" style={{ width: `${Math.min(100, p.ltv)}%` }} /></div>
                      <div class="cr-hint">
                        {p.ltv === 0 ? "Cash purchase — no mortgage" : p.ltv > 90 ? "Above 90% LTV — fewer products, higher rates" : p.ltv > 75 ? "75–90% LTV — mainstream territory" : "Up to 75% LTV — access to the best rates"}
                      </div>
                    </div>
                  </Card>
                  <Card title="Buying Costs" subtitle="Adjust to match your quotes">
                    <MoneyField label="Solicitor / conveyancing" value={i.buyerSolicitorFee} onChange={setInput("buyerSolicitorFee")} />
                    <MoneyField label="Survey" value={i.surveyFee} onChange={setInput("surveyFee")} />
                    <MoneyField label="Mortgage arrangement" value={i.mortgageArrangement} onChange={setInput("mortgageArrangement")} />
                    <MoneyField label="Removals" value={i.removals} onChange={setInput("removals")} />
                    <MoneyField label="Other" value={i.otherCosts} onChange={setInput("otherCosts")} />
                  </Card>
                </div>
                {!hasSale && <Card title="Savings"><MoneyField label="Savings available" value={i.savings} onChange={setInput("savings")} /></Card>}
              </Fragment>)}

              {activeTab === "sale" && hasSale && (<Fragment>
                <Card title="Your Current Property Sale">
                  <SliderInput label="Expected Sale Price" value={i.salePrice} onChange={setInput("salePrice")} min={100000} max={2000000} step={5000} editMax={50000000} />
                  <SliderInput label="Existing Mortgage" value={i.existingMortgage} onChange={setInput("existingMortgage")} min={0} max={Math.max(100000, i.salePrice)} step={5000} editMax={50000000}
                    hint={p.saleEquity >= 0 ? `Equity: ${fmt(p.saleEquity)}` : `Negative equity: ${fmt(p.saleEquity)}`} />
                  <SliderInput label="Agent Fee" value={i.agentFeePct} onChange={setInput("agentFeePct")} min={0} max={3.5} step={0.05} prefix="" suffix="%" hint="Typical UK: 1.0–2.0% + VAT" />
                  <Switch label="Add VAT (20%) to the agent fee" checked={i.agentFeeVAT} onChange={setInput("agentFeeVAT")} />
                  <div class="cr-gap" />
                  <MoneyField label="Solicitor — sale side" value={i.sellerSolicitorFee} onChange={setInput("sellerSolicitorFee")} />
                  <MoneyField label="Additional savings" value={i.savings} onChange={setInput("savings")} />
                </Card>
                <Card title="Sale Proceeds Breakdown">
                  <CostRow label="Gross Sale Price" value={i.salePrice} />
                  <CostRow label="Agent Fee (excl VAT)" value={-p.agentFeeBase} sub={`${i.agentFeePct}%`} />
                  {i.agentFeeVAT && <CostRow label="VAT on Agent Fee" value={-(p.agentFeeTotal - p.agentFeeBase)} />}
                  <CostRow label="Solicitor (sale)" value={-i.sellerSolicitorFee} />
                  <CostRow label="Mortgage Repaid" value={-i.existingMortgage} />
                  <CostRow label="Net Cash from Sale" value={p.netSaleProceeds} highlight />
                </Card>
              </Fragment>)}

              {activeTab === "mortgage" && (<Fragment>
                <Card title="Mortgage Calculator" subtitle={`Rate pre-filled at ${MARKET_RATE}% — a best-buy 5-year fixed as of ${RATE_AS_OF}. Rates move; replace it with your own quote.`}>
                  <SliderInput label="Interest Rate" value={i.mortgageRate} onChange={setInput("mortgageRate")} min={1} max={10} step={0.05} prefix="" suffix="%" />
                  <SliderInput label="Term" value={i.mortgageTerm} onChange={setInput("mortgageTerm")} min={5} max={40} step={1} prefix="" suffix=" years" />
                </Card>
                <div class="cr-grid-2">
                  <Card title="Monthly Repayment">
                    <div class="cr-bignum">
                      <div class="cr-bignum-label">Monthly Payment</div>
                      <div class="cr-bignum-val">{fmt(p.mortgage.monthly)}</div>
                      <div class="cr-hint cr-center">{fmtPct(i.mortgageRate)} · {i.mortgageTerm} years · capital repayment</div>
                    </div>
                    <CostRow label="Loan Amount" value={p.mortgageLoan} />
                    <CostRow label="Total Repaid" value={p.mortgage.total} />
                    <CostRow label="Total Interest" value={p.mortgage.interest} />
                  </Card>
                  <Card title="Rate Sensitivity" subtitle="What your payment becomes if rates move">
                    {[-1, -0.5, 0, 0.5, 1].filter((d) => i.mortgageRate + d >= 0).map((delta) => {
                      const m = calcMortgage(p.mortgageLoan, i.mortgageRate + delta, i.mortgageTerm);
                      const diff = m.monthly - p.mortgage.monthly;
                      return (
                        <div key={delta} class="cr-row">
                          <span class="cr-row-label">{delta === 0 ? "Your rate" : (delta > 0 ? "+" : "−") + Math.abs(delta) + "%"} ({fmtPct(i.mortgageRate + delta)})</span>
                          <span class={"cr-row-val " + (delta === 0 ? "cr-accent" : diff > 0 ? "cr-neg" : "cr-pos")}>{delta === 0 ? fmt(p.mortgage.monthly) : fmtSigned(diff) + "/mo"}</span>
                        </div>
                      );
                    })}
                    <div class="cr-note cr-note-gap"><strong>Lender stress test:</strong> at {fmtPct(i.mortgageRate + STRESS_DELTA)} your payment would be {fmt(p.stressMortgage.monthly)}/mo. Lenders check you could still afford this.</div>
                  </Card>
                </div>
                <Card title="Affordability Check" subtitle="Optional — enter your household income to sanity-check the loan size">
                  <div class="cr-afford">
                    <div class="cr-afford-in">
                      <label class="cr-field-label" for="cr-income">Gross annual household income</label>
                      <MoneyInput id="cr-income" value={income} onChange={(v) => patch({ income: v })} placeholder="e.g. 85,000" />
                    </div>
                    {lti !== null && (
                      <div class={"cr-lti " + (lti <= LTI_CAP ? "cr-lti-ok" : "cr-lti-warn")} role="status">
                        <div class="cr-hint cr-hint-flat">Loan-to-income</div>
                        <div class="cr-lti-val">{lti.toFixed(1)}×</div>
                        <div class="cr-hint cr-hint-flat">{lti <= LTI_CAP ? `Within the typical ~${LTI_CAP}× lender ceiling` : `Above the typical ~${LTI_CAP}× ceiling — most lenders would cap your loan at ${fmt(income * LTI_CAP)}`}</div>
                      </div>
                    )}
                  </div>
                </Card>
              </Fragment>)}

              {activeTab === "stampduty" && (<Fragment>
                <Card title="Stamp Duty Land Tax" subtitle={`England & NI · HMRC residential rates from ${SDLT_EFFECTIVE}`}>
                  <div class="cr-field cr-field-lg">
                    <div class="cr-hint">Buyer type — set from your journey, adjustable here</div>
                    <PillToggle label="Buyer type" options={[{ value: "standard", label: "Standard" }, { value: "firstTime", label: "First-Time Buyer" }, { value: "additional", label: "Additional (+5%)" }]} value={i.buyerType} onChange={setInput("buyerType")} />
                  </div>
                  <Switch label="Non-UK resident buyer (+2% surcharge)" checked={i.nonResident} onChange={setInput("nonResident")} />
                  <div class="cr-gap" />
                  <SliderInput label="Property Price" value={i.offerPrice} onChange={setInput("offerPrice")} min={100000} max={3000000} step={5000} editMax={50000000} />
                </Card>
                <div class="cr-grid-2">
                  <Card title="Your Band Breakdown" accent="var(--sage)">
                    {ftbCliff && <div class="cr-alert cr-alert-in">Above {fmt(FTB_MAX_PRICE)} first-time buyer relief doesn't apply, so standard rates are used.</div>}
                    {p.sdlt.total === 0 && <div class="cr-hint">No stamp duty due at this price.</div>}
                    {p.sdlt.bands.map((b) => (
                      <div key={b.label} class="cr-band">
                        <span class="cr-band-label">{b.label}</span>
                        <div class="cr-band-bar"><div class="cr-band-fill" style={{ width: `${p.sdlt.total > 0 ? (b.tax / p.sdlt.total) * 100 : 0}%` }} /></div>
                        <span class="cr-band-rate">{b.rate}%</span>
                        <span class="cr-band-tax">{fmt(b.tax)}</span>
                      </div>
                    ))}
                    <div class="cr-row cr-row-hl">
                      <span class="cr-row-label">Total SDLT</span>
                      <span class="cr-row-val cr-row-val-lg">{fmt(p.sdlt.total)}</span>
                    </div>
                    <div class="cr-hint">Effective rate: {i.offerPrice > 0 ? fmtPct((p.sdlt.total / i.offerPrice) * 100) : "0%"} of purchase price · Due within 14 days of completion</div>
                  </Card>
                  <Card title="Rate Tables">
                    <div class="cr-hint">Standard residential</div>
                    {[["£0 – £125,000", "0%"], ["£125,001 – £250,000", "2%"], ["£250,001 – £925,000", "5%"], ["£925,001 – £1,500,000", "10%"], ["Above £1,500,000", "12%"]].map(([b, r]) => (
                      <div key={b} class="cr-row"><span class="cr-row-label">{b}</span><span class="cr-row-val cr-sage">{r}</span></div>
                    ))}
                    <div class="cr-note cr-note-gap">
                      <strong>First-time buyers:</strong> 0% to £300k, 5% on £300k–£500k. No relief above £500k.<br />
                      <strong>Additional property:</strong> +5% surcharge on every band.<br />
                      <strong>Non-UK residents:</strong> +2% on every band, on top of any other surcharge.
                    </div>
                  </Card>
                </div>
              </Fragment>)}

              {activeTab === "scenario" && (<Fragment>
                <div class="cr-scen-head">
                  <div>
                    <h2 class="cr-card-title">Stress-test your position</h2>
                    <div class="cr-hint">Move the levers — your base case stays untouched</div>
                  </div>
                  <button type="button" disabled={!scenDirty} onClick={() => patch({ scen: {} })} class="cr-link cr-reset">Reset to base</button>
                </div>
                <div class="cr-scen-grid">
                  <div class="cr-scen-lever">
                    <SliderInput label="Offer Price" value={si.offerPrice} onChange={setScen("offerPrice")} min={Math.max(50000, i.offerPrice - 250000)} max={i.offerPrice + 300000} step={5000} />
                    <div class="cr-hint cr-hint-flat">Deposit {fmt(sp.depositAmount)} · SDLT {fmt(sp.sdlt.total)}</div>
                  </div>
                  {hasSale && (
                    <div class="cr-scen-lever">
                      <SliderInput label="Sale Price" value={si.salePrice} onChange={setScen("salePrice")} min={Math.max(50000, i.salePrice - 200000)} max={i.salePrice + 200000} step={5000} />
                      <div class="cr-hint cr-hint-flat">Net proceeds {fmt(sp.netSaleProceeds)}</div>
                    </div>
                  )}
                  <div class="cr-scen-lever">
                    <SliderInput label="Deposit" value={si.depositPct} onChange={setScen("depositPct")} min={5} max={100} step={1} prefix="" suffix="%" />
                    <div class="cr-hint cr-hint-flat">{fmt(sp.depositAmount)} · LTV {fmtPct(sp.ltv)}</div>
                  </div>
                  <div class="cr-scen-lever">
                    <SliderInput label="Mortgage Rate" value={si.mortgageRate} onChange={setScen("rate")} min={1} max={10} step={0.05} prefix="" suffix="%" />
                    <div class="cr-hint cr-hint-flat">{fmt(sp.mortgage.monthly)}/mo</div>
                  </div>
                </div>

                <section class="cr-card">
                  <h2 class="cr-scen-summary-head">What this means for you</h2>
                  <div class="cr-scen-3col">
                    {[
                      { label: "Base Case", val: p.surplus, sub: fmt(p.mortgage.monthly) + "/mo" },
                      { label: "Your Scenario", val: sp.surplus, sub: fmt(sp.mortgage.monthly) + "/mo", hl: true },
                      { label: "Change", val: sp.surplus - p.surplus, sub: fmtSigned(sp.mortgage.monthly - p.mortgage.monthly) + "/mo" },
                    ].map(({ label, val, sub, hl }) => (
                      <div key={label} class={"cr-scen-col" + (hl ? " cr-scen-col-hl" : "")}>
                        <div class="cr-scen-col-label">{label}</div>
                        <div class={"cr-scen-col-val " + (Math.round(val) >= 0 ? "cr-pos" : "cr-neg")}>{fmtSigned(val)}</div>
                        <div class="cr-hint cr-hint-flat">{sub}</div>
                      </div>
                    ))}
                  </div>
                  <div class="cr-card-body">
                    {[
                      { label: "Total Cash Needed", base: p.totalCashNeeded, v: sp.totalCashNeeded, lowerIsBetter: true },
                      { label: "Total Cash Available", base: p.cashAvailable, v: sp.cashAvailable, lowerIsBetter: false },
                      { label: "Deposit", base: p.depositAmount, v: sp.depositAmount, lowerIsBetter: true },
                      { label: "Stamp Duty", base: p.sdlt.total, v: sp.sdlt.total, lowerIsBetter: true },
                      { label: "Monthly Mortgage", base: p.mortgage.monthly, v: sp.mortgage.monthly, lowerIsBetter: true },
                    ].map(({ label, base, v, lowerIsBetter }) => {
                      const diff = Math.round(v) - Math.round(base);
                      const cls = diff === 0 ? "cr-muted" : (lowerIsBetter ? diff < 0 : diff > 0) ? "cr-pos" : "cr-neg";
                      return (
                        <div key={label} class="cr-row cr-row-wrap">
                          <span class="cr-row-label">{label}</span>
                          <div class="cr-scen-delta">
                            <span class="cr-row-sub">{fmt(base)}</span>
                            <span class="cr-row-sub" aria-hidden="true">→</span>
                            <span class="cr-row-val">{fmt(v)}</span>
                            <span class={"cr-chip " + cls}>{diff === 0 ? "No change" : fmtSigned(diff)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div class="cr-note">
                  <strong>Break-even offer:</strong>{" "}
                  {breakEven === null
                    ? "with the cash in this scenario there's a shortfall at any price — add savings or reduce costs."
                    : `with the cash in this scenario and a ${si.depositPct}% deposit, you stay out of shortfall up to an offer of ${fmt(breakEven)}.`}
                </div>

                <Card title="Saved scenarios" subtitle="Kept in this browser. Each one is re-calculated against your current base costs.">
                  <form class="cr-save" onSubmit={saveScenario}>
                    <input class="cr-input" type="text" maxLength={40} value={scenName} aria-label="Scenario name"
                      placeholder={`Name this scenario (e.g. “Offer ${fmt(si.offerPrice)}”)`} onInput={(e) => setScenName(e.target.value)} />
                    <button type="submit" class="cr-btn-gold">Save scenario</button>
                  </form>
                  {savedRows.length === 0 && <div class="cr-hint">Nothing saved yet. Set the levers above, then save to compare options side by side.</div>}
                  {savedRows.map((r) => (
                    <div key={r.id} class="cr-saved-row">
                      <div class="cr-saved-main">
                        <div class="cr-saved-name">{r.name}</div>
                        <div class="cr-row-sub">{r.summary}</div>
                      </div>
                      <div class="cr-saved-nums">
                        <span class={"cr-row-val " + (r.pos.surplus >= 0 ? "cr-pos" : "cr-neg")}>{fmtSigned(r.pos.surplus)}</span>
                        <span class="cr-row-sub">{fmt(r.pos.mortgage.monthly)}/mo</span>
                      </div>
                      <div class="cr-saved-actions">
                        <button type="button" class="cr-link cr-reset" onClick={() => patch({ scen: r.over })} aria-label={`Load ${r.name} into the levers`}>Load</button>
                        <button type="button" class="cr-link cr-reset" onClick={() => patch({ saved: saved.filter((x) => x.id !== r.id) })} aria-label={`Delete ${r.name}`}>Delete</button>
                      </div>
                    </div>
                  ))}
                </Card>
              </Fragment>)}
            </div>
          </main>
        )}

        <footer class="cr-footer">
          <p>Illustrative only — not financial, legal or tax advice. Stamp duty covers England &amp; Northern Ireland. Check figures with your solicitor and mortgage adviser before you commit.</p>
          <p>
            <a href="/">fasanya.co.uk</a>
            {stage !== "journey" && (<Fragment>
              {" · "}
              <button type="button" class="cr-link cr-inline" onClick={startOver} onBlur={() => setConfirmReset(false)}>
                {confirmReset ? "Click again to clear all numbers and saved scenarios" : "Start over"}
              </button>
            </Fragment>)}
          </p>
        </footer>
      </div>

      {stage === "dashboard" && <PrintReport journey={journey} i={i} p={p} hasSale={hasSale} savedRows={savedRows} />}
    </div>
  );
}

render(<App />, document.getElementById("root"));
