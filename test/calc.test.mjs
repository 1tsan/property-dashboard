import test from "node:test";
import assert from "node:assert/strict";
import { calcSDLT, calcMortgage, computePosition, breakEvenOffer, maxDepositPct, calcOverpayment, fmt } from "../src/chainready/calc.js";

const sdlt = (p, t, o) => calcSDLT(p, t, o).total;

test("standard SDLT bands", () => {
  assert.equal(sdlt(0, "standard"), 0);
  assert.equal(sdlt(125000, "standard"), 0);
  assert.equal(sdlt(250000, "standard"), 2500);
  assert.equal(sdlt(450000, "standard"), 12500);
  assert.equal(sdlt(925000, "standard"), 36250);
  assert.equal(sdlt(1250000, "standard"), 68750);
  assert.equal(sdlt(2000000, "standard"), 153750);
});

test("first-time buyer relief and its £500k cliff", () => {
  assert.equal(sdlt(300000, "firstTime"), 0);
  assert.equal(sdlt(425000, "firstTime"), 6250);
  assert.equal(sdlt(500000, "firstTime"), 10000);
  assert.equal(calcSDLT(500000, "firstTime").ftbRelief, true);
  assert.equal(sdlt(500001, "firstTime"), sdlt(500001, "standard"));
  assert.equal(calcSDLT(500001, "firstTime").ftbRelief, false);
});

test("additional property and non-resident surcharges", () => {
  assert.equal(sdlt(300000, "additional"), 5000 + 15000);
  assert.equal(sdlt(39000, "additional"), 0);
  assert.equal(sdlt(300000, "standard", { nonResident: true }), 5000 + 6000);
  assert.equal(sdlt(300000, "additional", { nonResident: true }), 5000 + 21000);
});

test("band breakdown sums to total and is labelled", () => {
  const r = calcSDLT(1600000, "standard");
  assert.equal(r.bands.length, 5);
  assert.equal(r.bands.at(-1).label, "Above £1,500,000");
  assert.equal(r.bands[1].label, "£125,001 – £250,000");
  assert.equal(r.bands.reduce((s, b) => s + b.tax, 0), r.total);
});

test("mortgage repayment", () => {
  const m = calcMortgage(382500, 4.35, 25);
  assert.ok(Math.abs(m.monthly - 2093.6) < 1, String(m.monthly));
  assert.equal(calcMortgage(120000, 0, 10).monthly, 1000);
  assert.equal(calcMortgage(0, 4, 25).monthly, 0);
  assert.equal(calcMortgage(100000, -1, 10).monthly, calcMortgage(100000, 0, 10).monthly);
});

const base = {
  offerPrice: 450000, depositPct: 15, buyerType: "standard", nonResident: false, nation: "england",
  mortgageRate: 4.35, mortgageTerm: 25, hasSale: true, salePrice: 320000, existingMortgage: 100000,
  agentFeePct: 1.5, agentFeeVAT: true, sellerSolicitorFee: 1500, buyerSolicitorFee: 2000,
  surveyFee: 800, removals: 1200, mortgageArrangement: 999, otherCosts: 500, savings: 50000,
};

test("cash position", () => {
  const p = computePosition(base);
  assert.equal(p.depositAmount, 67500);
  assert.equal(p.netSaleProceeds, 320000 - 5760 - 1500 - 100000);
  assert.equal(p.totalCashNeeded, 67500 + 12500 + 2000 + 800 + 1200 + 999 + 500);
  assert.equal(p.surplus, p.cashAvailable - p.totalCashNeeded);
  assert.equal(computePosition({ ...base, hasSale: false }).cashAvailable, 50000);
  assert.equal(computePosition({ ...base, depositPct: 100 }).mortgage.monthly, 0);
});

test("break-even offer sits on the surplus boundary", () => {
  const be = breakEvenOffer(base);
  assert.ok(computePosition({ ...base, offerPrice: be }).surplus >= 0);
  assert.ok(computePosition({ ...base, offerPrice: be + 1000 }).surplus < 0);
  assert.equal(breakEvenOffer({ ...base, hasSale: false, savings: 0 }), null);
});

test("Scotland LBTT", () => {
  const s = (p, t) => calcSDLT(p, t, { nation: "scotland" }).total;
  assert.equal(s(145000, "standard"), 0);
  assert.equal(s(300000, "standard"), 2100 + 2500);
  assert.equal(s(800000, "standard"), 2100 + 3750 + 42500 + 6000);
  assert.equal(s(300000, "firstTime"), 1500 + 2500);
  assert.equal(s(300000, "additional"), 4600 + 24000);
  assert.equal(calcSDLT(300000, "standard", { nation: "scotland", nonResident: true }).total, 4600);
});

test("Wales LTT", () => {
  const w = (p, t) => calcSDLT(p, t, { nation: "wales" }).total;
  assert.equal(w(225000, "standard"), 0);
  assert.equal(w(300000, "standard"), 4500);
  assert.equal(w(500000, "standard"), 10500 + 7500);
  assert.equal(w(300000, "firstTime"), 4500);
  assert.equal(calcSDLT(300000, "firstTime", { nation: "wales" }).ftbRelief, false);
  assert.equal(w(300000, "additional"), 9000 + 5950 + 5000);
});

test("max deposit leaves no shortfall", () => {
  const pct = maxDepositPct(base);
  assert.ok(computePosition({ ...base, depositPct: pct }).surplus >= 0);
  assert.ok(pct === 100 || computePosition({ ...base, depositPct: pct + 1 }).surplus < 0);
  assert.equal(maxDepositPct({ ...base, hasSale: false, savings: 0 }), 0);
});

test("overpayments shorten the term and cut interest", () => {
  const none = calcOverpayment(300000, 4.35, 25, 0);
  assert.equal(none.months, 300);
  assert.equal(none.interestSaved, 0);
  const o = calcOverpayment(300000, 4.35, 25, 300);
  assert.ok(o.months < 300 && o.monthsSaved === 300 - o.months);
  assert.ok(o.interestSaved > 30000 && o.interestSaved < 80000, String(o.interestSaved));
  assert.equal(calcOverpayment(120000, 0, 10, 1000).months, 60);
});

test("formatting", () => {
  assert.equal(fmt(-1234.4), "−£1,234");
  assert.equal(fmt(-0.2), "£0");
  assert.equal(fmt(NaN), "£0");
});
