import dotenv from "dotenv";
import fs from "fs";
import { Octokit } from "octokit";

dotenv.config();
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// ---------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------

function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("❌ Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function countFileTypes(files) {
  const counts = {};
  for (const f of files) {
    const parts = f.split(".");
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : "(none)";
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

function detectLanguages(langBytes) {
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const percent = {};
  for (const [lang, bytes] of Object.entries(langBytes)) {
    percent[lang] = ((bytes / total) * 100).toFixed(2);
  }
  const dominant = Object.entries(percent).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
  return { percent, dominant };
}

async function getFileContent(owner, repo, path) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------
// Feature Extraction
// ---------------------------------------------------------

export async function analyzeRepo(repoUrl, outPath) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  console.log(`🔍 Analyzing ${owner}/${repo} ...`);

  // ----------------------------- Fetch Base Info
  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const { data: langBytes } = await octokit.rest.repos.listLanguages({ owner, repo });
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "true",
  });

  const files = tree.tree.map((t) => t.path);
  const fileTypes = countFileTypes(files);
  const totalFiles = files.length;

  // ----------------------------- Language Composition
  const { percent: languagePercents, dominant: dominantLang } = detectLanguages(langBytes);

  // ----------------------------- Detect Binary Files
  const binaryPattern = /\.(png|jpg|jpeg|gif|exe|bin|zip|pdf|class|o|wasm)$/i;
  const binaryCount = files.filter((f) => binaryPattern.test(f)).length;
  const binaryRatio = ((binaryCount / totalFiles) * 100).toFixed(2);

  // ----------------------------- Documentation & Tests
  const hasDocs = files.some((f) => /(^docs\/|readme|contributing)/i.test(f));
  const hasTests = files.some((f) => /(test|spec|__tests__)/i.test(f));

  // ----------------------------- Build & Dependency
  const packageFiles = files.filter((f) =>
    /(package\.json|requirements\.txt|pipfile|pyproject\.toml|pom\.xml|build\.gradle|build\.gradle\.kts)/i.test(f)
  );

  const frameworks = [];
  const runtimes = [];

  // Node.js
  if (files.includes("package.json")) {
    const pkg = await getFileContent(owner, repo, "package.json");
    if (pkg) {
      const parsed = JSON.parse(pkg);
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };

      if (deps.express) frameworks.push("Express");
      if (deps.next) frameworks.push("Next.js");
      if (deps.nest) frameworks.push("NestJS");
      if (deps.react || deps["react-dom"]) frameworks.push("React");

      if (Object.keys(deps).length) runtimes.push("Node.js");
    }
  }

  // Python
  if (files.includes("requirements.txt")) {
    const req = await getFileContent(owner, repo, "requirements.txt");
    if (req) {
      if (/flask/i.test(req)) frameworks.push("Flask");
      if (/django/i.test(req)) frameworks.push("Django");
      if (/fastapi/i.test(req)) frameworks.push("FastAPI");
      if (/pyramid/i.test(req)) frameworks.push("Pyramid");

      runtimes.push("Python");
    }
  }

  // Java
  if (files.includes("pom.xml")) {
    const pom = await getFileContent(owner, repo, "pom.xml");
    if (pom) {
      if (/spring-boot/i.test(pom)) frameworks.push("Spring Boot");
      if (/quarkus/i.test(pom)) frameworks.push("Quarkus");
      if (/micronaut/i.test(pom)) frameworks.push("Micronaut");
      runtimes.push("Java");
    }
  }

  // ----------------------------- Test + Lint Tools
  const testFrameworks = files.filter((f) =>
    /(jest|pytest|mocha|unittest|vitest)/i.test(f)
  );

  const lintTools = files.filter((f) =>
    /(eslint|flake8|black|pylint|ruff)/i.test(f)
  );

  const coverageTools = files.filter((f) => /(nyc|coverage\.py|istanbul)/i.test(f));

  // ----------------------------- Containerization
  const hasDockerfile = files.includes("Dockerfile") || files.some((f) => /dockerfile$/i.test(f));
  const hasDockerCompose = files.some((f) => /docker-compose\.yml/i.test(f));
  const hasRegistryRef = files.some((f) => /(ghcr\.io|docker\.io)/i.test(f));

  const deployConfigs = files.filter((f) =>
    /(vercel\.json|render\.yaml|heroku\.yml|netlify\.toml|cloudbuild\.yaml|skaffold\.yaml)/i.test(f)
  );

  // ----------------------------- CI/CD Detection
  const ciWorkflows = files.filter((f) => f.startsWith(".github/workflows/"));
  const ciTools = files.filter((f) => /(gitlab-ci\.yml|circleci\/config\.yml|jenkinsfile)/i.test(f));

  const workflowTriggers = [];
  for (const wf of ciWorkflows) {
    const content = await getFileContent(owner, repo, wf);
    if (content) {
      if (/push:/i.test(content)) workflowTriggers.push("push");
      if (/pull_request:/i.test(content)) workflowTriggers.push("pull_request");
      if (/release:/i.test(content)) workflowTriggers.push("release");
    }
  }

  // ----------------------------- Security
  const hasEnvFile = files.some((f) => /\.env(\.example)?$/i.test(f));
  const secretsMentioned = files.filter((f) => /(secret|token|key)/i.test(f));
  const vulnerabilityConfigs = files.some((f) => /(dependabot|snyk|trivy)/i.test(f));

  // ----------------------------- Derived metrics
  const monorepo = packageFiles.length > 1;
  const ciRequired = ciWorkflows.length === 0;

  const recommendedTemplates = [];
  if (hasDockerfile) recommendedTemplates.push("docker-build");
  if (runtimes.includes("Node.js")) recommendedTemplates.push("node-ci");
  if (runtimes.includes("Python")) recommendedTemplates.push("python-ci");
  if (runtimes.includes("Java")) recommendedTemplates.push("java-ci");
  if (ciRequired) recommendedTemplates.push("add-ci-workflow");

  // ---------------------------------------------------------
  // FINAL FEATURE JSON
  // ---------------------------------------------------------
const result = {
  repo: `${owner}/${repo}`,

  // ⭐ FIX — normalize files for classifier
  detectedFiles: files.map((f) => f.toLowerCase()),

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
    languages: languagePercents,
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
    // ⭐ FIX — correct variable name
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

  // ----------------------------- Save
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`✅ Analysis complete → ${outPath}`);
}
