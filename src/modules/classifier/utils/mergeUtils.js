// utils/mergeUtils.js
export function mergeRuleAndHF(ruleCandidates = [], hfResult = {}) {
  const hfMap = {};
  (hfResult.labels || []).forEach((l, i) => (hfMap[l] = (hfResult.scores && hfResult.scores[i]) || 0));

  const labels = Array.from(new Set([...ruleCandidates.map((c) => c.label), ...Object.keys(hfMap)]));

  const merged = labels
    .map((label) => {
      const rule = ruleCandidates.find((r) => r.label === label)?.confidence || 0;
      const hf = hfMap[label] || 0;
      const ruleWeight = rule >= 0.9 ? 0.75 : 0.45;
      const combined = rule * ruleWeight + hf * (1 - ruleWeight);
      return { label, rule, hf, combined, reasons: [] };
    })
    .sort((a, b) => b.combined - a.combined);

  return { merged };
}

export function chooseTemplates(merged, threshold = 0.5) {
  if (!merged || !merged.length) return ["generic"];
  const accepted = merged.filter((m) => m.combined >= threshold).map((m) => m.label);
  return accepted.length ? accepted : [merged[0].label];
}
