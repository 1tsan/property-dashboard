// Pure calculation engine — no DOM, covered by test/calc.test.mjs.

export const MARKET_RATE = 4.35;
export const RATE_AS_OF = "May 2026";
export const SDLT_EFFECTIVE = "1 April 2025";
export const STRESS_DELTA = 3;
export const LTI_CAP = 4.5;

const STANDARD_BANDS = [
  { limit: 125000, rate: 0 },
  { limit: 250000, rate: 2 },
  { limit: 925000, rate: 5 },
  { limit: 1500000, rate: 10 },
  { limit: Infinity, rate: 12 },
];
const FTB_BANDS = [
  { limit: 300000, rate: 0 },
  { limit: 500000, rate: 5 },
];
export const FTB_MAX_PRICE = 500000;
export const ADDITIONAL_SURCHARGE = 5;
export const NON_RESIDENT_SURCHARGE = 2;
const ADDITIONAL_EXEMPT_BELOW = 40000;

const gbp = (n) => "£" + n.toLocaleString("en-GB");

function bandLabel(prev, limit) {
  if (limit === Infinity) return "Above " + gbp(prev);
  return (prev === 0 ? "£0" : gbp(prev + 1)) + " – " + gbp(limit);
}

export function calcSDLT(price, buyerType, { nonResident = false } = {}) {
  price = Number(price) || 0;
  if (price <= 0) return { total: 0, bands: [], ftbRelief: false, surcharge: 0 };

  const ftbRelief = buyerType === "firstTime" && price <= FTB_MAX_PRICE;
  const table = ftbRelief ? FTB_BANDS : STANDARD_BANDS;
  const surcharge =
    (buyerType === "additional" && price >= ADDITIONAL_EXEMPT_BELOW ? ADDITIONAL_SURCHARGE : 0) +
    (nonResident ? NON_RESIDENT_SURCHARGE : 0);

  const bands = [];
  let prev = 0;
  for (const { limit, rate } of table) {
    if (price <= prev) break;
    const slice = Math.min(price, limit) - prev;
    const r = rate + surcharge;
    bands.push({ label: bandLabel(prev, limit), rate: r, tax: (slice * r) / 100 });
    prev = limit;
  }
  return { total: bands.reduce((s, b) => s + b.tax, 0), bands, ftbRelief, surcharge };
}

export function calcMortgage(principal, annualRate, years) {
  if (!(principal > 0) || !(years > 0)) return { monthly: 0, total: 0, interest: 0 };
  const r = Math.max(0, annualRate) / 100 / 12;
  const n = years * 12;
  if (r === 0) return { monthly: principal / n, total: principal, interest: 0 };
  const growth = Math.pow(1 + r, n);
  const monthly = (principal * r * growth) / (growth - 1);
  return { monthly, total: monthly * n, interest: monthly * n - principal };
}

// One place for the whole cash position, so base case, live scenario and saved scenarios can't drift apart.
export function computePosition(i) {
  const depositAmount = (i.offerPrice * i.depositPct) / 100;
  const mortgageLoan = Math.max(0, i.offerPrice - depositAmount);
  const ltv = i.offerPrice > 0 ? (mortgageLoan / i.offerPrice) * 100 : 0;
  const sdlt = calcSDLT(i.offerPrice, i.buyerType, { nonResident: i.nonResident });
  const mortgage = calcMortgage(mortgageLoan, i.mortgageRate, i.mortgageTerm);
  const stressMortgage = calcMortgage(mortgageLoan, i.mortgageRate + STRESS_DELTA, i.mortgageTerm);

  const agentFeeBase = (i.salePrice * i.agentFeePct) / 100;
  const agentFeeTotal = agentFeeBase * (i.agentFeeVAT ? 1.2 : 1);
  const saleEquity = i.salePrice - i.existingMortgage;
  const netSaleProceeds = i.hasSale
    ? i.salePrice - agentFeeTotal - i.sellerSolicitorFee - i.existingMortgage
    : 0;

  const totalBuyingCosts =
    sdlt.total + i.buyerSolicitorFee + i.surveyFee + i.removals + i.mortgageArrangement + i.otherCosts;
  const totalCashNeeded = depositAmount + totalBuyingCosts;
  const cashAvailable = i.savings + netSaleProceeds;

  return {
    depositAmount, mortgageLoan, ltv, sdlt, mortgage, stressMortgage,
    agentFeeBase, agentFeeTotal, saleEquity, netSaleProceeds,
    totalBuyingCosts, totalCashNeeded, cashAvailable,
    surplus: cashAvailable - totalCashNeeded,
  };
}

// Highest offer price (to the nearest £1,000) that still leaves no cash shortfall, or null if none does.
export function breakEvenOffer(i) {
  const surplusAt = (price) => computePosition({ ...i, offerPrice: price }).surplus;
  if (surplusAt(0) < 0) return null;
  let lo = 0, hi = 50000; // units of £1,000
  if (surplusAt(hi * 1000) >= 0) return hi * 1000;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (surplusAt(mid * 1000) >= 0) lo = mid; else hi = mid;
  }
  return lo * 1000;
}

export function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return "£0";
  const rounded = Math.round(n);
  return (rounded < 0 ? "−£" : "£") + Math.abs(rounded).toLocaleString("en-GB");
}
export const fmtSigned = (n) => (Math.round(n) > 0 ? "+" : "") + fmt(n);
export const fmtPct = (n) => Math.round(n * 100) / 100 + "%";

export const JOURNEYS = {
  ftb: { label: "My first home", desc: "Buying for the first time — no property to sell, first-time buyer stamp duty relief.", badge: "First-Time Buyer", buyerType: "firstTime", hasSale: false },
  mover: { label: "Moving home", desc: "Selling my current property and buying the next one — the classic chain.", badge: "Home Mover", buyerType: "standard", hasSale: true },
  additional: { label: "An additional property", desc: "Buying while keeping my current property — second home or buy-to-let. +5% stamp duty applies.", badge: "Additional Property", buyerType: "additional", hasSale: false },
};
