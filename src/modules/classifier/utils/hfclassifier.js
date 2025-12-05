// utils/hfclassifier.js
import { InferenceClient } from "@huggingface/inference";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

dotenv.config({ path: "./hf-token.env" });
dotenv.config({ path: "src/modules/classifier/.env" });

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.warn("⚠️ HF_TOKEN missing. Hugging Face zero-shot will be skipped.");
}

const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;
const CACHE_DIR = path.resolve(".cache");

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
 * classifyZeroShot — Hugging Face zero-shot classification with caching.
 */
export async function classifyZeroShot(summaryText, candidateLabels = [], opts = {}) {
  const model = opts.model || "facebook/bart-large-mnli";
  const multi_label = opts.multi_label ?? true;

  if (!summaryText || summaryText.trim().length < 10)
    summaryText = "Repository description for zero-shot classification.";

  const key = _hash({ summaryText, candidateLabels, model });
  const cached = await _readCache(key);
  if (cached) return cached;

  if (!HF_TOKEN || !hf) {
    return { model, labels: [], scores: [], raw: { error: "no-token" } };
  }

  try {
    const data = await hf.zeroShotClassification({
      model,
      inputs: summaryText,
      provider: "hf-inference",   // ⭐ FORCE CORRECT PROVIDER
      parameters: { candidate_labels: candidateLabels, multi_label }
    });

    let labels = [];
    let scores = [];
    if (Array.isArray(data) && data[0]?.label) {
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
    console.error("❌ HF zero-shot failed:", err.response?.data || err.message);
    return {
      model,
      labels: [],
      scores: [],
      raw: { error: String(err?.response?.data || err?.message) },
    };
  }
}
