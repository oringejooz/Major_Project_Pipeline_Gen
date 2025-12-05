// src/modules/classifier/utils/mergeUtils.js

/**
 * Merge rule-based candidates with Hugging Face zero-shot scores.
 */
export function mergeRuleAndHF(ruleCandidates = [], hfResult = {}) {
  const ruleMap = {};
  for (const c of ruleCandidates) {
    ruleMap[c.label] = Math.max(ruleMap[c.label] || 0, c.confidence || 0);
  }

  const hfMap = {};
  (hfResult.labels || []).forEach((label, i) => {
    const score = (hfResult.scores && hfResult.scores[i]) || 0;
    hfMap[label] = score;
  });

  const labels = Array.from(new Set([...Object.keys(ruleMap), ...Object.keys(hfMap)]));

  const merged = labels
    .map((label) => {
      const rule = ruleMap[label] || 0;
      const hf = hfMap[label] || 0;
      let ruleWeight = 0.5;
      const reasons = [];

      if (rule >= 0.9 && hf < rule) {
        ruleWeight = 0.7;
        reasons.push("strong rule-based evidence");
      } else if (hf >= 0.8 && hf > rule) {
        ruleWeight = 0.3;
        reasons.push("strong model confidence");
      } else if (rule > 0 && hf === 0) {
        ruleWeight = 0.8;
        reasons.push("no model evidence; rules only");
      } else if (rule === 0 && hf > 0) {
        ruleWeight = 0.2;
        reasons.push("no rule evidence; model only");
      }

      const combined = rule * ruleWeight + hf * (1 - ruleWeight);
      return { label, rule, hf, combined, reasons };
    })
    .sort((a, b) => b.combined - a.combined);

  return { merged };
}

/**
 * Choose one primary template (keeps downstream logic simple).
 */
export function chooseTemplates(merged, _threshold = 0.5) {
  if (!merged || !merged.length) return ["generic"];
  return [merged[0].label];
}
