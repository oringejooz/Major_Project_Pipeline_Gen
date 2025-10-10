// utils/hfclassifier.js
import { InferenceClient } from "@huggingface/inference";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

dotenv.config({ path: "./hf-token.env" });
dotenv.config();

const HF_TOKEN = process.env.HF_TOKEN;
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

const hf = new InferenceClient(HF_TOKEN);

export async function classifyZeroShot(summaryText, candidateLabels = [], opts = {}) {
  const model = opts.model || "facebook/bart-large-mnli";
  const multi_label = opts.multi_label ?? true;
  const key = _hash({ summaryText, candidateLabels, model });
  const cached = await _readCache(key);
  if (cached) return cached;

  if (!HF_TOKEN) {
    console.warn("⚠️ HF_TOKEN missing; returning empty result");
    return { model, labels: [], scores: [], raw: { error: "no-token" } };
  }

  try {
    const result = await hf.zeroShotClassification({
      model,
      inputs: summaryText,
      parameters: { candidate_labels: candidateLabels, multi_label },
    });

    const out = {
      model,
      labels: result.labels || [],
      scores: result.scores || [],
      raw: result,
    };
    await _writeCache(key, out);
    return out;
  } catch (err) {
    console.warn("HF zero-shot call failed:", err.message || err);
    return { model, labels: [], scores: [], raw: { error: String(err?.message || err) } };
  }
}
