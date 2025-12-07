import fs from "fs/promises";
import path from "node:path";
import { classify } from "./modules/classifier/run.js";
import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import { createPrForWorkflow } from "./modules/renderer/pr.js";
import { render } from "./modules/renderer/render.js";

export default (app) => {
  console.log("🚀 CICD Pipeline Generator Probot app loaded");

  // Track processed commits to prevent duplicate processing
  const processedCommits = new Set();
  const COMMIT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Debug: Log all incoming webhook events (use webhooks.onAny)
  app.webhooks.onAny(async ({ name, id, payload }) => {
    console.log(`🔍 DEBUG: Received webhook event: ${name} (delivery id: ${id})`);
  });

  // Add webhook route handler for root path (Smee compatibility)
  app.webhooks.on("push", handlePushEvent);
  app.webhooks.on("installation", handleInstallationEvent);
  app.webhooks.on("installation_repositories", handleInstallationReposEvent);

  async function handlePushEvent(context) {
    console.log(`📧 Received push event for ${context.payload.repository.full_name}`);
    try {
      const installationId = context.payload.installation?.id;
      console.log("🔑 Installation ID:", installationId);
      const [owner, repo] = context.payload.repository.full_name.split("/");

      // Explicitly get an installation-scoped octokit with type: "installation" to ensure write permissions
      const installationOctokit = installationId ? await app.auth(installationId, { type: "installation" }) : context.octokit;

      // Fetch installation info via app auth to show granted permissions
      try {
        const appOctokit = await app.auth();
        const instInfo = installationId ? await appOctokit.rest.apps.getInstallation({ installation_id: installationId }) : null;
        if (instInfo && instInfo.data && instInfo.data.permissions) {
          console.log("🔐 Installation permissions:", JSON.stringify(instInfo.data.permissions));
        }
      } catch (e) {
        console.error("⚠️ Could not fetch installation info:", e?.message ?? e);
        if (e?.response?.data) console.error(e.response.data);
      }

      await handleRepo(installationOctokit, owner, repo);
    } catch (err) {
      console.error(`❌ Error in handlePushEvent: ${err.message}`);
      console.error(err?.status ? `Status: ${err.status}` : "");
      console.error(err?.response?.data ?? err);
    }
  }

  async function handleInstallationEvent(context) {
    console.log("📧 Received installation event");
    try {
      const installationId = context.payload.installation?.id;
      console.log("🔑 Installation ID:", installationId);
      const repos = context.payload.repositories || [];
      const installationOctokit = installationId ? await app.auth(installationId, { type: "installation" }) : context.octokit;
      // Fetch and log installation permissions
      try {
        const appOctokit = await app.auth();
        const instInfo = installationId ? await appOctokit.rest.apps.getInstallation({ installation_id: installationId }) : null;
        if (instInfo && instInfo.data && instInfo.data.permissions) {
          console.log("🔐 Installation permissions:", JSON.stringify(instInfo.data.permissions));
        }
      } catch (e) {
        console.error("⚠️ Could not fetch installation info:", e?.message ?? e);
        if (e?.response?.data) console.error(e.response.data);
      }

      for (const r of repos) {
        const full = r.full_name || r.html_url?.split("github.com/")[1];
        if (!full) continue;
        const [owner, repo] = full.split("/");
        await handleRepo(installationOctokit, owner, repo);
      }
    } catch (err) {
      console.error(`❌ Error in handleInstallationEvent: ${err.message}`);
      console.error(err);
    }
  }

  async function handleInstallationReposEvent(context) {
    console.log("📧 Received installation_repositories event");
    try {
      const installationId = context.payload.installation?.id;
      console.log("🔑 Installation ID:", installationId);
      const installationOctokit = installationId ? await app.auth(installationId, { type: "installation" }) : context.octokit;
      // Fetch and log installation permissions
      try {
        const appOctokit = await app.auth();
        const instInfo = installationId ? await appOctokit.rest.apps.getInstallation({ installation_id: installationId }) : null;
        if (instInfo && instInfo.data && instInfo.data.permissions) {
          console.log("🔐 Installation permissions:", JSON.stringify(instInfo.data.permissions));
        }
      } catch (e) {
        console.error("⚠️ Could not fetch installation info:", e?.message ?? e);
        if (e?.response?.data) console.error(e.response.data);
      }

      const repos = context.payload.repositories_added || [];
      for (const r of repos) {
        const [owner, repo] = r.full_name.split("/");
        await handleRepo(installationOctokit, owner, repo);
      }
    } catch (err) {
      console.error(`❌ Error in handleInstallationReposEvent: ${err.message}`);
      console.error(err);
    }
  }

  async function handleRepo(octokit, owner, repo) {
    const repoUrl = `https://github.com/${owner}/${repo}`;
    const tmp = path.resolve("outputs");
    await fs.mkdir(tmp, { recursive: true });
    const featuresPath = path.join(tmp, "feature.json");
    const valuesPath = path.join(tmp, "values.json");
    const ciOut = path.join(tmp, "ci.yml");

    await analyzeRepo(repoUrl, featuresPath, { octokit });
    await classify(featuresPath, valuesPath);
    const template = process.env.DEFAULT_TEMPLATE || "intermediate.hbs";
    const rendered = await render(valuesPath, ciOut, template);

    // Commit workflow and open PR
    try {
      const pr = await createPrForWorkflow(octokit, owner, repo, ".github/workflows/pipeline-gen.yml", rendered);
      console.log(`✅ Created PR: ${pr.html_url}`);
    } catch (err) {
      console.error(`❌ Failed to create PR for ${owner}/${repo}: ${err.message || err}`);
      if (err?.status) console.error(`Status: ${err.status}`);
      if (err?.response?.data) console.error("Response data:", JSON.stringify(err.response.data, null, 2));
    }
  }
};
