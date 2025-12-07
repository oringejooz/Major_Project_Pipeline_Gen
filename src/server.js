import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import path from "node:path";
import { classify } from "./modules/classifier/run.js";
import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import { render } from "./modules/renderer/render.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// For webhook signature verification we need the raw body; use express.raw on this route
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    try {
      const sig = req.headers["x-hub-signature-256"];
      const raw = req.body;

      if (process.env.GITHUB_WEBHOOK_SECRET) {
        if (!sig) return res.status(401).send("Missing signature");
        const hmac = "sha256=" + crypto.createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(raw).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig))) {
          console.warn("Webhook signature mismatch");
          return res.status(401).send("Invalid signature");
        }
      }

      const payload = JSON.parse(raw.toString("utf8"));
      const event = req.headers["x-github-event"] || "unknown";
      console.log("Received webhook event:", event);

      // Extract installation id if present
      const installationId = payload.installation?.id || null;

      if (event === "installation") {
        const repos = payload.repositories || [];
        for (const r of repos) {
          const repoUrl = r.html_url || r.url;
          console.log("Analyzing installed repo:", repoUrl);
          await handleRepo(repoUrl, installationId, payload);
        }
      } else if (event === "push" || event === "repository") {
        const repo = payload.repository;
        if (repo) {
          const repoUrl = repo.html_url || repo.url;
          await handleRepo(repoUrl, installationId, payload);
        }
      } else {
        console.log("Event not handled (for now)");
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
);

async function handleRepo(repoUrl, installationId = null, payload = null) {
  if (!repoUrl) return;
  const tmp = path.resolve("outputs");
  await fs.mkdir(tmp, { recursive: true });
  const featuresPath = path.join(tmp, "feature.json");
  const valuesPath = path.join(tmp, "values.json");
  const ciOut = path.join(tmp, "ci.yml");

  // Determine owner/repo from URL
  const parts = (repoUrl || "").match(/github\.com\/([^/]+)\/([^/]+)(?:\.git)?/i);
  const owner = parts ? parts[1] : null;
  const repo = parts ? parts[2].replace(/\.git$/, "") : null;

  // Acquire Octokit: prefer installation auth if installationId provided
  let octokit = null;
  try {
    if (arguments[1] && arguments[1] !== null) {
      // called with installationId as second arg
    }
  } catch (e) {}

  try {
    if (installationId) {
      octokit = await getOctokitForInstallation(installationId);
    } else if (process.env.GITHUB_TOKEN) {
      octokit = getOctokitForPAT();
    }
  } catch (err) {
    console.warn("Could not create installation Octokit — falling back to PAT if available:", err.message);
    if (process.env.GITHUB_TOKEN) octokit = getOctokitForPAT();
  }

  // Run analysis using the selected octokit
  await analyzeRepo(repoUrl, featuresPath, { octokit });
  await classify(featuresPath, valuesPath);

  // pick a template automatically — simple default
  const template = process.env.DEFAULT_TEMPLATE || "intermediate.hbs";
  const rendered = await render(valuesPath, ciOut, template);

  // If we have octokit and owner/repo, create PR with generated workflow
  if (octokit && owner && repo) {
    try {
      const workflowPath = ".github/workflows/pipeline-gen.yml";
      const pr = await createPrForWorkflow(octokit, owner, repo, workflowPath, rendered);
      console.log("PR created:", pr.html_url);
    } catch (err) {
      console.error("Failed to create PR:", err.message || err);
    }
  } else {
    console.log("No authenticated Octokit available — wrote output to disk only.");
  }

  console.log("Pipeline generation complete for", repoUrl);
}

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log("POST /webhook to trigger analysis (GitHub App webhook)");
});

export default app;
