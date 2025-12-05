import dotenv from "dotenv";
import fs from "fs";
import { Octokit } from "octokit";

dotenv.config();
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/* ---------------------------------------------------------
    Utility helpers
--------------------------------------------------------- */

function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("❌ Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function countFileTypes(files) {
  const counts = {};
  for (const f of files) {
    const ext = f.includes(".") ? f.split(".").pop().toLowerCase() : "(none)";
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

/* ---------------------------------------------------------
    Repo Analyzer
--------------------------------------------------------- */

export async function analyzeRepo(repoUrl, outPath) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  console.log(`🔍 Analyzing ${owner}/${repo} ...`);

  /* ---------------------- Base Repo Info */
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

  /* ---------------------- Language Composition */
  const { percent: languagePercents, dominant: dominantLang } = detectLanguages(langBytes);

  /* ---------------------- Binary File Detection */
  const binaryPattern = /\.(png|jpg|jpeg|gif|exe|bin|zip|pdf|class|o|wasm)$/i;
  const binaryCount = files.filter((f) => binaryPattern.test(f)).length;
  const binaryRatio = ((binaryCount / totalFiles) * 100).toFixed(2);

  /* ---------------------- Docs & Tests */
  const hasDocs = files.some((f) => /(^docs\/|readme|contributing)/i.test(f));
  const hasTests = files.some((f) => /(test|spec|__tests__)/i.test(f));

  /* ---------------------- Build / Dependency Detection */
  const packageManagers = files.filter((f) =>
    /(package\.json|requirements\.txt|pipfile|pyproject\.toml|pom\.xml|build\.gradle|build\.gradle\.kts)/i.test(f)
  );

  const buildSystems = files.filter((f) =>
    /(Makefile|CMakeLists\.txt|build\.gradle|build\.gradle\.kts)/i.test(f)
  );

  const frameworks = [];
  const runtimes = [];

  /* ---------------------- Node Metadata */
  let node_metadata = {};
  if (files.includes("package.json")) {
    const pkgText = await getFileContent(owner, repo, "package.json");
    if (pkgText) {
      const pkg = JSON.parse(pkgText);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.express) frameworks.push("Express");
      if (deps.next) frameworks.push("Next.js");
      if (deps.nest) frameworks.push("NestJS");
      if (deps.react || deps["react-dom"]) frameworks.push("React");

      if (Object.keys(deps).length) runtimes.push("Node.js");

      node_metadata = {
        scripts: pkg.scripts || {},
        dependencies: deps,
        engines: pkg.engines || {},
        nodeVersion: pkg.engines?.node || null,
      };
    }
  }

  /* ---------------------- Python Metadata */
  let python_metadata = {};
  if (files.includes("requirements.txt")) {
    const reqText = await getFileContent(owner, repo, "requirements.txt");
    if (reqText) {
      if (/flask/i.test(reqText)) frameworks.push("Flask");
      if (/django/i.test(reqText)) frameworks.push("Django");
      if (/fastapi/i.test(reqText)) frameworks.push("FastAPI");

      runtimes.push("Python");

      python_metadata = {
        requirements_raw: reqText,
        packages: reqText.split("\n").filter((x) => x.trim().length),
        has_pytest: /pytest/i.test(reqText),
      };
    }
  }

  /* ---------------------- Java Metadata */
  let java_metadata = {};
  if (files.includes("pom.xml")) {
    const pom = await getFileContent(owner, repo, "pom.xml");
    if (pom) {
      if (/spring-boot/i.test(pom)) frameworks.push("Spring Boot");
      if (/quarkus/i.test(pom)) frameworks.push("Quarkus");
      if (/micronaut/i.test(pom)) frameworks.push("Micronaut");

      runtimes.push("Java");

      java_metadata = {
        build: "maven",
        spring_boot: /spring-boot/i.test(pom),
      };
    }
  }

  if (files.includes("build.gradle") || files.includes("build.gradle.kts")) {
    java_metadata = { build: "gradle" };
    runtimes.push("Java");
  }

  /* ---------------------- Testing / Linting Tools */
  const test_frameworks = files.filter((f) =>
    /(jest|pytest|mocha|unittest|vitest)/i.test(f)
  );

  const lint_tools = files.filter((f) =>
    /(eslint|flake8|black|pylint|ruff)/i.test(f)
  );

  const coverage_tools = files.filter((f) =>
    /(nyc|coverage\.py|istanbul)/i.test(f)
  );

  /* ---------------------- Container Detection */
  const hasDockerfile =
    files.includes("Dockerfile") || files.some((f) => /dockerfile$/i.test(f));

  const hasCompose = files.some((f) => /docker-compose\.ya?ml/i.test(f));
  const hasRegistryRef = files.some((f) => /(ghcr\.io|docker\.io)/i.test(f));

  const deploymentConfigs = files.filter((f) =>
    /(vercel\.json|render\.yaml|heroku\.yml|netlify\.toml|cloudbuild\.yaml)/i.test(f)
  );

  /* ---------------------- CI/CD Detection */
  const ciWorkflows = files.filter((f) => f.startsWith(".github/workflows/"));
  const ciTools = files.filter((f) =>
    /(gitlab-ci\.yml|circleci\/config\.yml|jenkinsfile)/i.test(f)
  );

  const workflowTriggers = [];
  for (const wf of ciWorkflows) {
    const cfg = await getFileContent(owner, repo, wf);
    if (!cfg) continue;
    if (/push:/i.test(cfg)) workflowTriggers.push("push");
    if (/pull_request:/i.test(cfg)) workflowTriggers.push("pull_request");
    if (/release:/i.test(cfg)) workflowTriggers.push("release");
  }

  /* ---------------------- Security */
  const hasEnv = files.some((f) => /\.env(\.example)?$/i.test(f));
  const secretsMentioned = files.filter((f) => /(secret|token|key)/i.test(f));
  const hasVulnConfig = files.some((f) => /(dependabot|snyk|trivy)/i.test(f));

  /* ---------------------- Derived Metrics */
  const monorepo = packageManagers.length > 1;
  const ciRequired = ciWorkflows.length === 0;

  const recommendedTemplates = [];
  if (hasDockerfile) recommendedTemplates.push("docker-build");
  if (runtimes.includes("Node.js")) recommendedTemplates.push("node-ci");
  if (runtimes.includes("Python")) recommendedTemplates.push("python-ci");
  if (runtimes.includes("Java")) recommendedTemplates.push("java-ci");
  if (ciRequired) recommendedTemplates.push("add-ci-workflow");

  /* ---------------------------------------------------------
    FINAL JSON
  --------------------------------------------------------- */

  const result = {
    repo: `${owner}/${repo}`,

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
      node_metadata,
      python_metadata,
      java_metadata,
    },

    testing_and_linting: {
      test_frameworks,
      lint_tools,
      coverage_tools,
    },

    containerization_and_deployment: {
      has_dockerfile: hasDockerfile,
      has_docker_compose: hasCompose,
      registry_reference: hasRegistryRef,
      deployment_configs: deploymentConfigs,
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
      monorepo,
      ci_required: ciRequired,
      recommended_templates: recommendedTemplates,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`✅ Analysis complete → ${outPath}`);
}
