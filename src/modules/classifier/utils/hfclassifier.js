// src/modules/classifier/utils/hfclassifier.js
import { InferenceClient } from "@huggingface/inference";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

// Root-level dotenv should be loaded by the application entrypoint.
// Do not load module-local .env files here; rely on `process.env` instead.

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) console.warn("⚠️ HF_TOKEN missing. Hugging Face calls will be skipped.");

const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;
const CACHE_DIR = path.resolve(".cache");

// --- cache helpers ---
async function _readCache(k) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, k + ".json"), "utf8"));
  } catch {
    return null;
  }
}
async function _writeCache(k, o) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, k + ".json"), JSON.stringify(o, null, 2), "utf8");
}
function _hash(x) {
  return crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
}

/**
 * classifyZeroShot — Hugging Face zero-shot classification with caching
 */
export async function classifyZeroShot(summaryText, candidateLabels = [], opts = {}) {
  const model = opts.model || "facebook/bart-large-mnli";
  const multi_label = opts.multi_label ?? true;

  if (!summaryText || summaryText.trim().length < 10) {
    summaryText = "Repository description for zero-shot classification.";
  }

  const key = _hash({ summaryText, candidateLabels, model });
  const cached = await _readCache(key);
  if (cached) return cached;

  // If no token or client available, fall back to deterministic heuristic
  if (!HF_TOKEN || !hf) {
    const heuristic = heuristicLabels(summaryText, candidateLabels);
    await _writeCache(key, heuristic);
    return heuristic;
  }

  try {
    const data = await hf.zeroShotClassification({
      model,
      inputs: summaryText,
      parameters: { candidate_labels: candidateLabels, multi_label },
    });

    // Normalize possible formats:
    let labels = [];
    let scores = [];

    if (Array.isArray(data) && data.length && data[0].label !== undefined) {
      labels = data.map((d) => d.label);
      scores = data.map((d) => d.score);
    } else if (data.labels && data.scores) {
      labels = data.labels;
      scores = data.scores;
    }

    const out = { model, labels, scores, raw: data };
    console.log("✅ HF classification success:", labels.slice(0, 5));
    await _writeCache(key, out);
    return out;
  } catch (err) {
    console.error("❌ HF zero-shot failed:", err?.response?.data || err?.message || err);
    // Fallback to heuristic labeling — better than returning nothing
    const fallback = heuristicLabels(summaryText, candidateLabels, err);
    await _writeCache(key, fallback);
    return fallback;
  }
}

/**
 * heuristicLabels — simple fallback when HF inference is unavailable or fails.
 * It scores candidate labels based on keyword matches in the summary.
 */
function heuristicLabels(summaryText, candidateLabels = [], err = null) {
  const text = (summaryText || "").toLowerCase();
  const labelScores = [];

  for (const label of candidateLabels) {
    const l = String(label).toLowerCase();
    let score = 0;
    // direct keyword match
    if (text.includes(l)) score += 0.7;
    // heuristic synonyms
    if (l === "node" && /npm|node|package.json|express|react/.test(text)) score += 0.9;
    if (l === "python" && /python|requirements.txt|pip|flask|django|fastapi/.test(text)) score += 0.9;
    if (l === "java" && /maven|gradle|pom.xml|spring-boot/.test(text)) score += 0.9;
    if (l === "docker" && /dockerfile|container|docker/.test(text)) score += 0.95;
    if (l === "monorepo" && /packages\//.test(text)) score += 0.8;
    // small boost for presence in label name
    if (text.match(new RegExp(`\\b${escapeRegex(l)}\\b`))) score += 0.05;

    labelScores.push({ label, score: Math.min(1, score) });
  }

  // sort desc
  labelScores.sort((a, b) => b.score - a.score);
  return {
    model: "heuristic-fallback",
    labels: labelScores.map((s) => s.label),
    scores: labelScores.map((s) => s.score),
    raw: { error: err ? String(err) : "hf-missing" },
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
