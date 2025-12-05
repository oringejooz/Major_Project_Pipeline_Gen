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
export async function classify(
  inputPath = "./features.json",
  outputPath = "./values.json"
) {
  try {
    const raw = await fs.readFile(inputPath, "utf8");
    const features = JSON.parse(raw);

    console.log("1) Rule detection...");
    const { candidates, summary } = runRuleDetector(features);
    console.log("   rule candidates:", candidates.slice(0, 5));

    // If we have a super-strong rule signal (>= 0.97), skip HF entirely
    const top = candidates[0];
    let hfResult = { model: "facebook/bart-large-mnli", labels: [], scores: [], raw: {} };
    if (!top || top.confidence < 0.97) {
      console.log("2) HF zero-shot (disambiguation)...");
      const candidateLabels = Array.from(
        new Set([
          ...candidates.map((c) => c.label),
          "node",
          "python",
          "java",
          "go",
          "docker",
          "terraform",
          "generic",
        ])
      );

      hfResult = await classifyZeroShot(summary, candidateLabels, {
        multi_label: true,
      });
      console.log("   hf labels:", hfResult.labels?.slice(0, 10) || []);
    } else {
      console.log(
        `2) Skipping HF zero-shot: strong rule signal for '${top.label}' (${top.confidence})`
      );
    }

    console.log("3) Merge rule + HF signals...");
    const mergedObj = mergeRuleAndHF(candidates, hfResult);
    const chosen = chooseTemplates(mergedObj.merged, 0.5);
    const primary = chosen[0];
    console.log("   primary template:", primary);

    console.log("4) Adaptive parameter extraction...");
    const values = await adaptiveExtract(features, {
      merged: mergedObj.merged,
      chosen,
      primary,
    });

    values._classifier = {
      rules: candidates,
      hf: hfResult,
      merged: mergedObj.merged,
      chosen,
      primary,
    };

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
if (process.argv[1] && process.argv[1].endsWith("run.js")) {
  classify().catch((err) => console.error(err));
}
