import dotenv from "dotenv";
import fs from "fs";
import { Octokit } from "octokit";

dotenv.config();
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Parse GitHub URL to owner/repo
function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("❌ Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

// Count file extensions
function countFileTypes(files) {
  const counts = {};
  for (const file of files) {
    const ext = file.split(".").pop();
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

export async function analyzeRepo(repoUrl,outPath) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  console.log(`🔍 Analyzing ${owner}/${repo} ...`);

  // --- Fetch repo info ---
  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const { data: languages } = await octokit.rest.repos.listLanguages({
    owner,
    repo,
  });
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "true",
  });

  const files = treeData.tree.map((f) => f.path);
  const totalFiles = files.length;

  // --- File Types & Binary Ratio ---
  const fileTypes = countFileTypes(files);
  const binaryFiles = files.filter((f) =>
    f.match(/\.(png|jpg|jpeg|gif|exe|bin|zip|pdf)$/i)
  );
  const binaryRatio = ((binaryFiles.length / totalFiles) * 100).toFixed(2);

  // --- Language Composition ---
  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  const langPercent = {};
  for (const [lang, bytes] of Object.entries(languages))
    langPercent[lang] = ((bytes / totalBytes) * 100).toFixed(2);

  // --- Documentation & Tests ---
  const hasDocs = files.some((f) => f.match(/^docs\/|README|CONTRIBUTING/i));
  const hasTests = files.some((f) => f.match(/test|spec|__tests__/i));

  // --- Build & Dependency Indicators ---
  const packageManagers = files.filter((f) =>
    f.match(/package\.json|requirements\.txt|pom\.xml/)
  );
  const buildSystems = files.filter((f) => f.match(/Makefile|build\.gradle/i));
  const frameworks = [];
  const runtimes = [];

  // --- Node.js Framework Detection ---
  if (files.includes("package.json")) {
    try {
      const pkgFile = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "package.json",
      });
      const content = Buffer.from(pkgFile.data.content, "base64").toString(
        "utf-8"
      );
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const detected = [];
      if (deps.express) detected.push("Express");
      if (deps.next) detected.push("Next.js");
      if (deps.koa) detected.push("Koa");
      if (deps.nest) detected.push("NestJS");
      if (deps.hapi) detected.push("Hapi");
      if (detected.length > 0) {
        frameworks.push(...detected);
        runtimes.push("Node.js");
      }
    } catch {}
  }

  // --- Python Framework Detection ---
  if (files.includes("requirements.txt")) {
    try {
      const reqFile = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "requirements.txt",
      });
      const content = Buffer.from(reqFile.data.content, "base64").toString(
        "utf-8"
      );
      const detected = [];
      if (/flask/i.test(content)) detected.push("Flask");
      if (/django/i.test(content)) detected.push("Django");
      if (/fastapi/i.test(content)) detected.push("FastAPI");
      if (/pyramid/i.test(content)) detected.push("Pyramid");
      if (detected.length > 0) {
        frameworks.push(...detected);
        runtimes.push("Python");
      }
    } catch {}
  }

  // --- Java Framework Detection ---
  if (files.includes("pom.xml")) {
    try {
      const pomFile = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "pom.xml",
      });
      const content = Buffer.from(pomFile.data.content, "base64").toString(
        "utf-8"
      );
      const detected = [];
      if (/spring-boot/i.test(content)) detected.push("Spring Boot");
      if (/quarkus/i.test(content)) detected.push("Quarkus");
      if (/micronaut/i.test(content)) detected.push("Micronaut");
      if (detected.length > 0) {
        frameworks.push(...detected);
        runtimes.push("Java");
      }
    } catch {}
  }

  // --- Testing & Linting ---
  const testFrameworks = files.filter((f) =>
    f.match(/jest|pytest|mocha|unittest/i)
  );
  const lintTools = files.filter((f) => f.match(/eslint|flake8|black/i));
  const coverageTools = files.filter((f) => f.match(/nyc|coverage\.py/i));

  // --- Containerization & Deployment ---
  const hasDockerfile = files.includes("Dockerfile");
  const hasCompose = files.some((f) => f.match(/docker-compose\.yml/i));
  const hasRegistryRef = files.some((f) => f.match(/ghcr\.io|docker\.io/i));
  const deployConfigs = files.filter((f) =>
    f.match(/vercel\.json|render\.yaml|heroku\.yml|netlify\.toml/i)
  );

  // --- CI/CD ---
  const ciWorkflows = files.filter((f) => f.startsWith(".github/workflows/"));
  const ciTools = files.filter((f) =>
    f.match(/\.gitlab-ci\.yml|circleci\/config\.yml|Jenkinsfile/i)
  );
  const workflowTriggers = [];
  for (const wf of ciWorkflows) {
    try {
      const { data: content } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: wf,
      });
      const decoded = Buffer.from(content.content, "base64").toString("utf-8");
      if (decoded.includes("push")) workflowTriggers.push("push");
      if (decoded.includes("pull_request"))
        workflowTriggers.push("pull_request");
      if (decoded.includes("release")) workflowTriggers.push("release");
    } catch {}
  }

  // --- Security ---
  const hasEnv = files.some((f) => f.match(/\.env($|\.example)/i));
  const hasVulnConfig = files.some((f) => f.match(/dependabot\.yml|snyk/i));
  const secretsMentioned = files.filter((f) => f.match(/secret|token/i));

  // --- Derived Metrics ---
  const dominantLang = Object.keys(langPercent)[0] || "Unknown";
  const projectType = runtimes[0] || dominantLang;
  const monorepo = packageManagers.length > 1;
  const ciRequired = ciWorkflows.length === 0;
  const recommendedTemplates = [];
  if (runtimes.includes("Node.js")) recommendedTemplates.push("node-ci");
  if (runtimes.includes("Python")) recommendedTemplates.push("python-ci");
  if (hasDockerfile) recommendedTemplates.push("docker-build");
  if (ciRequired) recommendedTemplates.push("add-ci-workflow");

  // --- Combine all data ---
  const result = {
    repo: `${owner}/${repo}`,
    metadata: {
      description: repoInfo.description,
      topics: repoInfo.topics,
      stars: repoInfo.stargazers_count,
      forks: repoInfo.forks_count,
      watchers: repoInfo.subscribers_count,
      license: repoInfo.license ? repoInfo.license.spdx_id : "None",
      default_branch: repoInfo.default_branch,
      last_commit: repoInfo.pushed_at,
    },
    composition: {
      languages: langPercent,
      dominant_language: dominantLang,
      total_files: totalFiles,
      file_types_count: fileTypes,
      binary_file_ratio: `${binaryRatio}%`,
      has_docs: hasDocs,
      has_tests: hasTests,
    },
    build_and_dependency: {
      package_managers: packageManagers,
      package_manager_count: packageManagers.length,
      build_systems: buildSystems,
      frameworks,
      runtimes,
    },
    testing_and_linting: {
      test_frameworks: testFrameworks,
      lint_tools: lintTools,
      coverage_tools: coverageTools,
    },
    containerization_and_deployment: {
      has_dockerfile: hasDockerfile,
      has_docker_compose: hasCompose,
      registry_reference: hasRegistryRef,
      deployment_configs: deployConfigs,
    },
    ci_cd: {
      has_workflows: ciWorkflows.length > 0,
      existing_ci_tools: ciTools,
      workflow_count: ciWorkflows.length,
      workflow_triggers: [...new Set(workflowTriggers)],
    },
    security: {
      has_env_file: hasEnv,
      secrets_mentions: secretsMentioned,
      vulnerability_configs: hasVulnConfig,
    },
    derived: {
      project_type: projectType,
      monorepo,
      ci_required: ciRequired,
      recommended_templates: recommendedTemplates,
    },
  };

  // --- Save Output ---
  // if (!fs.existsSync("./output")) fs.mkdirSync("./output");
  // const path = "./output/feature.json";
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`✅ Analysis complete → ${outPath}`);
}

// --- Run Script ---
// const repoUrl = process.argv[2];
// if (!repoUrl) {
//   console.error("Usage: node repo-analyzer.js <github-repo-url>");
//   process.exit(1);
// }
// analyzeRepo(repoUrl).catch((err) => console.error("❌ Error:", err.message));
