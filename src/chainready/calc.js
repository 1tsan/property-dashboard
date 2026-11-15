// Pure calculation engine — no DOM, covered by test/calc.test.mjs.

export const MARKET_RATE = 4.35;
export const RATE_AS_OF = "May 2026";
export const STRESS_DELTA = 3;
export const LTI_CAP = 4.5;

// Residential property tax tables per nation. `additional` is either a per-band uplift (points added to
// every band), a separate higher-rates table, or a flat percentage of the whole price.
export const NATIONS = {
  england: {
    label: "England & NI", tax: "SDLT", taxName: "Stamp Duty Land Tax", asOf: "1 April 2025",
    bands: [[125000, 0], [250000, 2], [925000, 5], [1500000, 10], [Infinity, 12]],
    ftb: { maxPrice: 500000, bands: [[300000, 0], [500000, 5]] },
    additional: { uplift: 5 }, nonResidentUplift: 2,
  },
  scotland: {
    label: "Scotland", tax: "LBTT", taxName: "Land and Buildings Transaction Tax", asOf: "5 December 2024",
    bands: [[145000, 0], [250000, 2], [325000, 5], [750000, 10], [Infinity, 12]],
    ftb: { maxPrice: Infinity, bands: [[175000, 0], [250000, 2], [325000, 5], [750000, 10], [Infinity, 12]] },
    additional: { flatPct: 8 }, nonResidentUplift: 0,
  },
  wales: {
    label: "Wales", tax: "LTT", taxName: "Land Transaction Tax", asOf: "11 December 2024",
    bands: [[225000, 0], [400000, 6], [750000, 7.5], [1500000, 10], [Infinity, 12]],
    ftb: null,
    additional: { bands: [[180000, 5], [250000, 8.5], [400000, 10], [750000, 12.5], [1500000, 15], [Infinity, 17]] },
    nonResidentUplift: 0,
  },
};
export const FTB_MAX_PRICE = NATIONS.england.ftb.maxPrice;
const ADDITIONAL_EXEMPT_BELOW = 40000;

const gbp = (n) => "£" + n.toLocaleString("en-GB");

export function bandLabel(prev, limit) {
  if (limit === Infinity) return "Above " + gbp(prev);
  return (prev === 0 ? "£0" : gbp(prev + 1)) + " – " + gbp(limit);
}

export function calcSDLT(price, buyerType, { nonResident = false, nation = "england" } = {}) {
  price = Number(price) || 0;
  const n = NATIONS[nation] || NATIONS.england;
  if (price <= 0) return { total: 0, bands: [], ftbRelief: false, surcharge: 0, flatSurcharge: 0 };

  const ftbRelief = buyerType === "firstTime" && !!n.ftb && price <= n.ftb.maxPrice;
  const isAdditional = buyerType === "additional" && price >= ADDITIONAL_EXEMPT_BELOW;
  const table = isAdditional && n.additional.bands ? n.additional.bands : ftbRelief ? n.ftb.bands : n.bands;
  const surcharge = (isAdditional ? n.additional.uplift || 0 : 0) + (nonResident ? n.nonResidentUplift : 0);

  const bands = [];
  let prev = 0;
  for (const [limit, rate] of table) {
    if (price <= prev) break;
    const slice = Math.min(price, limit) - prev;
    const r = rate + surcharge;
    bands.push({ label: bandLabel(prev, limit), rate: r, tax: (slice * r) / 100 });
    prev = limit;
  }
  const flatSurcharge = isAdditional && n.additional.flatPct ? (price * n.additional.flatPct) / 100 : 0;
  return { total: bands.reduce((s, b) => s + b.tax, 0) + flatSurcharge, bands, ftbRelief, surcharge, flatSurcharge };
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
  const sdlt = calcSDLT(i.offerPrice, i.buyerType, { nonResident: i.nonResident, nation: i.nation });
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

// Largest whole-percent deposit the available cash can fund once every buying cost is paid.
export function maxDepositPct(i) {
  if (!(i.offerPrice > 0)) return 0;
  const p = computePosition({ ...i, depositPct: 0 });
  const spare = p.cashAvailable - p.totalBuyingCosts;
  return Math.max(0, Math.min(100, Math.floor((spare / i.offerPrice) * 100)));
}

// Effect of a fixed monthly overpayment on a repayment mortgage.
export function calcOverpayment(principal, annualRate, years, extra) {
  const base = calcMortgage(principal, annualRate, years);
  const none = { months: years * 12, interest: base.interest, monthsSaved: 0, interestSaved: 0 };
  if (!(principal > 0) || !(extra > 0)) return none;
  const r = Math.max(0, annualRate) / 100 / 12;
  let balance = principal, months = 0, interest = 0;
  while (balance > 0.005 && months < years * 12) {
    const charge = balance * r;
    interest += charge;
    balance = balance + charge - Math.min(balance + charge, base.monthly + extra);
    months++;
  }
  return { months, interest, monthsSaved: years * 12 - months, interestSaved: base.interest - interest };
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
  additional: { label: "An additional property", desc: "Buying while keeping my current property — second home or buy-to-let. Higher property tax applies.", badge: "Additional Property", buyerType: "additional", hasSale: false },
};
