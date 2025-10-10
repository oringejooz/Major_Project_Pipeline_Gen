// run.js
import fs from "fs/promises";
import { runRuleDetector } from "./utils/ruleDetector.js";
import { classifyZeroShot } from "./utils/hfclassifier.js";
import { mergeRuleAndHF, chooseTemplates } from "./utils/mergeUtils.js";
import { adaptiveExtract } from "./utils/paramExtractor.js";

/**
 * Main classifier function
 * @param {string} inputPath - path to features.json
 * @param {string} outputPath - path to write values.json
 */
export async function classify(inputPath = "./features.json", outputPath = "./values.json") {
  try {
    const raw = await fs.readFile(inputPath, "utf8");
    const features = JSON.parse(raw);

    console.log("1) Rule detection...");
    const { candidates, summary } = runRuleDetector(features);
    console.log("  rule candidates:", candidates.slice(0, 5));

    console.log("2) HF zero-shot (disambiguation) ...");
    const candidateLabels = Array.from(
      new Set([
        ...candidates.map((c) => c.label),
        "node",
        "python",
        "java",
        "docker",
        "terraform",
        "monorepo",
        "generic",
      ])
    );
    const hfResult = await classifyZeroShot(summary, candidateLabels, { multi_label: true });
    console.log("  hf labels:", hfResult.labels?.slice(0, 10) || []);

    console.log("3) Merge signals...");
    const mergedObj = mergeRuleAndHF(candidates, hfResult);
    const chosen = chooseTemplates(mergedObj.merged, 0.5);
    console.log("  chosen templates:", chosen);

    console.log("4) Adaptive extraction (LLM with fallback) ...");
    const values = await adaptiveExtract(features, { merged: mergedObj.merged, chosen });

    values._classifier = { rules: candidates, hf: hfResult, merged: mergedObj.merged, chosen };

    await fs.writeFile(outputPath, JSON.stringify(values, null, 2), "utf8");
    console.log("✅ values.json generated at", outputPath);
    console.log("Preview:", {
      project_type: values.project_type,
      language: values.language,
      package_manager: values.package_manager,
    });
  } catch (err) {
    console.error("Run error:", err);
  }
}

// If run.js is executed directly, use default paths
if (process.argv[1].endsWith("run.js")) {
  classify().catch((err) => console.error(err));
}
