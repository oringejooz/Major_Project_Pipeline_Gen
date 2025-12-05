// utils/mergeUtils.js

/**
 * Merge rule-based candidates with Hugging Face zero-shot scores.
 * Design:
 * - If top rule candidate is very strong (>= 0.97), IGNORE HF and trust rules.
 * - Otherwise: rules dominate (80%), HF is just a tie-breaker (20%).
 */

export function mergeRuleAndHF(ruleCandidates = [], hfResult = {}) {
  if (!ruleCandidates.length) return { merged: [] };

  // If best rule is extremely confident, trust it entirely and ignore HF.
  const sortedByRule = [...ruleCandidates].sort(
    (a, b) => b.confidence - a.confidence
  );
  const top = sortedByRule[0];

  if (top.confidence >= 0.97) {
    const merged = sortedByRule.map((c) => ({
      label: c.label,
      rule: c.confidence,
      hf: 0,
      combined: c.confidence,
      reasons: ["rule-dominant"],
    }));
    return { merged };
  }

  // Otherwise, combine rule + HF with rule dominance.
  const hfMap = {};
  (hfResult.labels || []).forEach((label, i) => {
    const score = (hfResult.scores && hfResult.scores[i]) || 0;
    hfMap[label] = score;
  });

  const labels = Array.from(
    new Set([
      ...ruleCandidates.map((c) => c.label),
      ...Object.keys(hfMap),
    ])
  );

  const merged = labels
    .map((label) => {
      const rule = ruleCandidates.find((c) => c.label === label)?.confidence || 0;
      const hf = hfMap[label] || 0;
      const combined = rule * 0.8 + hf * 0.2;
      return {
        label,
        rule,
        hf,
        combined,
        reasons: [`rule=${rule.toFixed(2)}`, `hf=${hf.toFixed(2)}`],
      };
    })
    .sort((a, b) => b.combined - a.combined);

  return { merged };
}

/**
 * Choose templates:
 * - Always return exactly ONE primary template label.
 */
export function chooseTemplates(merged, _threshold = 0.5) {
  if (!merged || !merged.length) return ["generic"];
  return [merged[0].label];
}
