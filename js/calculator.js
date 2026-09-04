"use strict";

const NEW_REGIME_SLABS = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 0.05 },
  { upTo: 1200000, rate: 0.10 },
  { upTo: 1600000, rate: 0.15 },
  { upTo: 2000000, rate: 0.20 },
  { upTo: 2400000, rate: 0.25 },
  { upTo: Infinity, rate: 0.30 },
];

const OLD_REGIME_SLABS = {
  below60: [
    { upTo: 250000, rate: 0 },
    { upTo: 500000, rate: 0.05 },
    { upTo: 1000000, rate: 0.20 },
    { upTo: Infinity, rate: 0.30 },
  ],
  senior: [
    { upTo: 300000, rate: 0 },
    { upTo: 500000, rate: 0.05 },
    { upTo: 1000000, rate: 0.20 },
    { upTo: Infinity, rate: 0.30 },
  ],
  superSenior: [
    { upTo: 500000, rate: 0 },
    { upTo: 1000000, rate: 0.20 },
    { upTo: Infinity, rate: 0.30 },
  ],
};

const NEW_REGIME_STANDARD_DEDUCTION = 75000;
const OLD_REGIME_STANDARD_DEDUCTION = 50000;
const NEW_REGIME_REBATE_LIMIT = 1200000;
const NEW_REGIME_REBATE_MAX = 60000;
const OLD_REGIME_REBATE_LIMIT = 500000;
const OLD_REGIME_REBATE_MAX = 12500;
const CESS_RATE = 0.04;

const SURCHARGE_BRACKETS_OLD = [
  { threshold: 5000000, rate: 0.10 },
  { threshold: 10000000, rate: 0.15 },
  { threshold: 20000000, rate: 0.25 },
  { threshold: 50000000, rate: 0.37 },
];

const SURCHARGE_BRACKETS_NEW = [
  { threshold: 5000000, rate: 0.10 },
  { threshold: 10000000, rate: 0.15 },
  { threshold: 20000000, rate: 0.25 },
];

function slabTax(income, slabs) {
  let tax = 0;
  let prevLimit = 0;
  const lines = [];
  for (const slab of slabs) {
    if (income <= prevLimit) break;
    const taxableInSlab = Math.min(income, slab.upTo) - prevLimit;
    const slabTaxAmount = taxableInSlab * slab.rate;
    tax += slabTaxAmount;
    if (taxableInSlab > 0) {
      const upperLabel = slab.upTo === Infinity ? "and above" : `up to ${formatCurrency(slab.upTo)}`;
      lines.push({
        label: `${formatCurrency(prevLimit)} - ${upperLabel} @ ${(slab.rate * 100).toFixed(0)}%`,
        amount: slabTaxAmount,
      });
    }
    prevLimit = slab.upTo;
  }
  return { tax, lines };
}

function applyRebate(tax, taxableIncome, limit, maxRebate) {
  if (taxableIncome <= limit) {
    return 0;
  }
  const incomeAboveLimit = taxableIncome - limit;
  if (tax > incomeAboveLimit && tax - incomeAboveLimit <= maxRebate) {
    return incomeAboveLimit;
  }
  return tax;
}

function surchargeWithMarginalRelief(baseTax, taxableIncome, brackets, computeBaseTax) {
  let applicable = null;
  for (const bracket of brackets) {
    if (taxableIncome > bracket.threshold) {
      applicable = bracket;
    }
  }
  if (!applicable) {
    return { surcharge: 0, totalBeforeCess: baseTax };
  }

  let prevRate = 0;
  for (const bracket of brackets) {
    if (applicable.threshold > bracket.threshold) {
      prevRate = bracket.rate;
    }
  }

  const rawTotal = baseTax * (1 + applicable.rate);
  const taxAtThreshold = computeBaseTax(applicable.threshold);
  const totalAtThreshold = taxAtThreshold * (1 + prevRate);
  const maxAllowedTotal = totalAtThreshold + (taxableIncome - applicable.threshold);

  const totalBeforeCess = Math.min(rawTotal, maxAllowedTotal);
  const surcharge = totalBeforeCess - baseTax;
  return { surcharge, totalBeforeCess };
}

function calculateNewRegime(grossIncome, isSalaried, employerNps) {
  const standardDeduction = isSalaried ? NEW_REGIME_STANDARD_DEDUCTION : 0;
  const taxableIncome = Math.max(0, grossIncome - standardDeduction - employerNps);

  const { tax: baseTax, lines } = slabTax(taxableIncome, NEW_REGIME_SLABS);
  const taxAfterRebate = applyRebate(baseTax, taxableIncome, NEW_REGIME_REBATE_LIMIT, NEW_REGIME_REBATE_MAX);

  const computeBase = (income) => slabTax(income, NEW_REGIME_SLABS).tax;
  const { surcharge, totalBeforeCess } = surchargeWithMarginalRelief(
    taxAfterRebate,
    taxableIncome,
    SURCHARGE_BRACKETS_NEW,
    computeBase
  );

  const cess = totalBeforeCess * CESS_RATE;
  const totalTax = totalBeforeCess + cess;

  return {
    taxableIncome,
    baseTax: taxAfterRebate,
    surcharge,
    cess,
    totalTax,
    lines,
  };
}

function calculateOldRegime(grossIncome, isSalaried, ageCategory, deductions, employerNps) {
  const standardDeduction = isSalaried ? OLD_REGIME_STANDARD_DEDUCTION : 0;
  const totalDeductions =
    Math.min(deductions.sec80C, 150000) +
    deductions.sec80D +
    Math.min(deductions.sec80CCD1B, 50000) +
    deductions.hra +
    Math.min(deductions.homeLoanInterest, 200000) +
    deductions.otherDeductions +
    employerNps;

  const taxableIncome = Math.max(0, grossIncome - standardDeduction - totalDeductions);
  const slabs = OLD_REGIME_SLABS[ageCategory];

  const { tax: baseTax, lines } = slabTax(taxableIncome, slabs);
  const taxAfterRebate = applyRebate(baseTax, taxableIncome, OLD_REGIME_REBATE_LIMIT, OLD_REGIME_REBATE_MAX);

  const computeBase = (income) => slabTax(income, slabs).tax;
  const { surcharge, totalBeforeCess } = surchargeWithMarginalRelief(
    taxAfterRebate,
    taxableIncome,
    SURCHARGE_BRACKETS_OLD,
    computeBase
  );

  const cess = totalBeforeCess * CESS_RATE;
  const totalTax = totalBeforeCess + cess;

  return {
    taxableIncome,
    baseTax: taxAfterRebate,
    surcharge,
    cess,
    totalTax,
    lines,
  };
}

function formatCurrency(amount) {
  const rounded = Math.round(amount);
  return "₹" + rounded.toLocaleString("en-IN");
}

function renderBreakdown(containerId, lines) {
  const container = document.getElementById(containerId);
  if (!lines.length) {
    container.innerHTML = "";
    return;
  }
  const rows = lines
    .map(
      (line) =>
        `<div class="slab-line"><span>${line.label}</span><span>${formatCurrency(line.amount)}</span></div>`
    )
    .join("");
  container.innerHTML = `<div class="slab-heading">Slab-wise breakdown</div>${rows}`;
}

function populatePanel(prefix, result, grossIncome) {
  document.getElementById(`${prefix}-taxable`).textContent = formatCurrency(result.taxableIncome);
  document.getElementById(`${prefix}-tax-before-cess`).textContent = formatCurrency(result.baseTax);
  document.getElementById(`${prefix}-surcharge`).textContent = formatCurrency(result.surcharge);
  document.getElementById(`${prefix}-cess`).textContent = formatCurrency(result.cess);
  document.getElementById(`${prefix}-total`).textContent = formatCurrency(result.totalTax);

  const effectiveRate = grossIncome > 0 ? (result.totalTax / grossIncome) * 100 : 0;
  document.getElementById(`${prefix}-rate`).textContent = effectiveRate.toFixed(2) + "%";

  const monthlyTakeHome = (grossIncome - result.totalTax) / 12;
  document.getElementById(`${prefix}-takehome`).textContent = formatCurrency(monthlyTakeHome);

  renderBreakdown(`${prefix}-breakdown`, result.lines);
}

function handleSubmit(event) {
  event.preventDefault();

  const grossIncome = Math.max(0, Number(document.getElementById("grossIncome").value) || 0);
  const ageCategory = document.getElementById("ageCategory").value;
  const isSalaried = document.getElementById("isSalaried").checked;
  const employerNps = Math.max(0, Number(document.getElementById("sec80CCD2").value) || 0);

  const deductions = {
    sec80C: Math.max(0, Number(document.getElementById("sec80C").value) || 0),
    sec80D: Math.max(0, Number(document.getElementById("sec80D").value) || 0),
    sec80CCD1B: Math.max(0, Number(document.getElementById("sec80CCD1B").value) || 0),
    hra: Math.max(0, Number(document.getElementById("hra").value) || 0),
    homeLoanInterest: Math.max(0, Number(document.getElementById("homeLoanInterest").value) || 0),
    otherDeductions: Math.max(0, Number(document.getElementById("otherDeductions").value) || 0),
  };

  const newResult = calculateNewRegime(grossIncome, isSalaried, employerNps);
  const oldResult = calculateOldRegime(grossIncome, isSalaried, ageCategory, deductions, employerNps);

  populatePanel("new", newResult, grossIncome);
  populatePanel("old", oldResult, grossIncome);

  const savings = Math.abs(newResult.totalTax - oldResult.totalTax);
  const recommendationEl = document.getElementById("recommendation");
  const savingsBanner = document.getElementById("savings-banner");

  if (newResult.totalTax === oldResult.totalTax) {
    recommendationEl.textContent = "Both regimes result in the same tax liability for the details entered.";
    savingsBanner.textContent = "";
  } else if (newResult.totalTax < oldResult.totalTax) {
    recommendationEl.textContent = `The New Regime is better for you — it saves ${formatCurrency(savings)} compared to the Old Regime.`;
    savingsBanner.textContent = `You save ${formatCurrency(savings)} per year by choosing the New Regime.`;
  } else {
    recommendationEl.textContent = `The Old Regime is better for you — it saves ${formatCurrency(savings)} compared to the New Regime.`;
    savingsBanner.textContent = `You save ${formatCurrency(savings)} per year by choosing the Old Regime.`;
  }

  document.getElementById("results-section").hidden = false;
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("tax-form").addEventListener("submit", handleSubmit);
