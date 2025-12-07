import fs from "fs/promises";
import path from "node:path";
import { classify } from "./modules/classifier/run.js";
import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import { createPrForWorkflow } from "./modules/renderer/pr.js";
import { render } from "./modules/renderer/render.js";

export default (app) => {
  console.log("🚀 CICD Pipeline Generator Probot app loaded");

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
    }
  }

  app.on(["installation", "installation_repositories", "push", "repository"], async (context) => {
    const event = context.name;
    console.log(`📧 Received event: ${event}`);

    // When Probot runs, context.octokit is authenticated for the installation if present.
    const octokit = context.octokit;

    try {
      if (event === "installation") {
        const repos = context.payload.repositories || [];
        for (const r of repos) {
          const full = r.full_name || r.html_url?.split("github.com/")[1];
          if (!full) continue;
          const [owner, repo] = full.split("/");
          await handleRepo(octokit, owner, repo);
        }
      } else if (event === "installation_repositories") {
        const repos = context.payload.repositories_added || [];
        for (const r of repos) {
          const [owner, repo] = r.full_name.split("/");
          await handleRepo(octokit, owner, repo);
        }
      } else if (event === "push" || event === "repository") {
        const repo = context.payload.repository;
        if (repo) {
          const [owner, rname] = (repo.full_name || repo.name).split("/");
          await handleRepo(octokit, owner, rname);
        }
      }
    } catch (err) {
      console.error(`❌ Error processing event: ${err.message || err}`);
    }
  });
};
