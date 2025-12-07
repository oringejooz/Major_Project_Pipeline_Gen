// src/modules/classifier/utils/paramExtractor.js
import { InferenceClient } from "@huggingface/inference";
import dotenv from "dotenv";

dotenv.config({ path: "src/modules/classifier/.env" });

const HF_TOKEN = process.env.HF_TOKEN || null;
const HF_PARAM_MODEL = process.env.HF_PARAM_MODEL || null; // <= ONLY if you explicitly set one

const hf = HF_TOKEN && HF_PARAM_MODEL ? new InferenceClient(HF_TOKEN) : null;

/**
 * deterministicFallback — safe, language-aware defaults
 */
function deterministicFallback(features, chosenTemplates = []) {
  if (typeof chosenTemplates === "string") chosenTemplates = [chosenTemplates];

  const comp = features?.composition || {};
  const langs = comp.languages || features?.languages || {};
  const dominant =
    comp.dominant_language?.toLowerCase() ||
    features?.dominant_language?.toLowerCase() ||
    Object.keys(langs)[0]?.toLowerCase() ||
    "";

  const detectedFilesRaw = [
    ...(features.detectedFiles || []),
    ...Object.keys(comp.file_types_count || {}),
    ...((features.build_and_dependency?.package_managers) || []),
  ];
  const detectedFiles = detectedFilesRaw.map((f) => f.toLowerCase());

  const hasDocker =
    features?.containerization_and_deployment?.has_dockerfile ||
    detectedFiles.includes("dockerfile") ||
    Object.keys(langs).some((l) => l.toLowerCase() === "dockerfile") ||
    false;

  const nodeMeta = features.build_and_dependency?.node_metadata || {};
  const pythonMeta = features.build_and_dependency?.python_metadata || {};

  const base = {
    project_type: "generic",
    language: dominant || "unknown",
    package_manager: null,
    lint_command: "",
    test_command: "",
    build_command: "",
    artifact_path: "",
    matrix: {},
    caching: {},
    secrets_required: [],
    deployment: { enabled: false, provider: "", config_file: "", mode: "" },
    container: {
      enabled: false,
      image: "",
      registry: "",
      platforms: ["linux/amd64"],
      cache: false,
      tags: [],
      provenance: false,
      sbom: false,
      sign: false,
    },
    triggers: {
      branches: [features?.metadata?.default_branch || "main"],
      push: true,
      pull_request: true,
      release_on_tag: true,
    },
    paths_filters: {},
  };

  const isNodeHint =
    dominant.includes("javascript") || detectedFiles.includes("package.json");
  const isPythonHint =
    dominant.includes("python") || detectedFiles.includes("requirements.txt");
  const isJavaPom =
    detectedFiles.includes("pom.xml") ||
    detectedFiles.includes("build.gradle") ||
    detectedFiles.includes("build.gradle.kts");

  const isNode =
    chosenTemplates.includes("node") || isNodeHint;
  const isPython =
    chosenTemplates.includes("python") || isPythonHint;
  const isJava =
    chosenTemplates.includes("java") || isJavaPom;
  const isDockerChosen = chosenTemplates.includes("docker");

  // --- Docker-only repositories ---
  if (isDockerChosen && !isNode && !isPython && !isJava) {
    const out = { ...base };
    out.project_type = "docker";
    out.language = "docker";
    out.build_command = "docker build -t app .";
    out.test_command = "";
    out.container = {
      ...out.container,
      enabled: true,
      image: "ghcr.io/OWNER/REPO",
      registry: "ghcr.io",
      platforms: ["linux/amd64"],
      cache: true,
      tags: ["latest"],
    };
    return out;
  }

  // --- Node.js ---
  if (isNode) {
    const out = { ...base };
    out.project_type = "node";
    out.language = "js";
    out.package_manager = "npm";
    out.node_version = nodeMeta.nodeVersion || "18.x";

    // Prefer real scripts if present
    const scripts = nodeMeta.scripts || {};
    out.lint_command =
      scripts.lint ? "npm run lint" : "npm run lint || echo 'No lint script'";
    out.test_command =
      scripts.test ? "npm test" : "npm test || echo 'No tests found'";
    out.build_command = scripts.build ? "npm run build" : "npm run build || echo 'No build script'";
    // If there is no build script, do not upload artifacts (empty string disables the step)
    out.artifact_path = scripts.build ? "dist/" : "";
    out.matrix = { node_versions: ["16.x", "18.x", "20.x"] };

    out.caching = {
      paths: ["~/.npm"],
      key: "npm-cache-${{ hashFiles('**/package-lock.json') }}",
    };

    if (hasDocker) {
      // Prefer Docker Hub by default unless analyzer indicates GHCR or other registry references
      const detectedRegistry = (features.containerization_and_deployment?.registry_reference) ?
        (features.containerization_and_deployment?.registry_reference === true ? "docker.io" : "docker.io") : "docker.io";

      const repoId = (features.repo || "OWNER/REPO");

      out.container = {
        ...out.container,
        enabled: true,
        image: `${detectedRegistry}/${repoId}`,
        registry: detectedRegistry,
        platforms: ["linux/amd64"],
        cache: true,
      };

      // Secrets: Docker Hub uses username/password; GHCR typically uses GITHUB_TOKEN
      if (detectedRegistry.includes("ghcr.io")) {
        out.secrets_required = [...out.secrets_required, "GITHUB_TOKEN"];
      } else {
        out.secrets_required = [...out.secrets_required, "DOCKER_USERNAME", "DOCKER_PASSWORD"];
      }
    }
    return out;
  }

  // --- Python ---
  if (isPython) {
    const out = { ...base };
    out.project_type = "python";
    out.language = "py";
    out.package_manager = "pip";
    out.lint_command = "flake8 . || echo 'No flake8 config'";
    out.test_command = pythonMeta.has_pytest
      ? "pytest"
      : "pytest || python -m unittest";
    out.build_command = "python -m build || python setup.py sdist";
    out.artifact_path = "dist/";
    out.matrix = { python_versions: ["3.9", "3.10", "3.11"] };
    out.caching = {
      paths: ["~/.cache/pip"],
      key: "pip-cache-${{ hashFiles('**/requirements.txt') }}",
    };
    return out;
  }

  // --- Java ---
  if (isJava) {
    const out = { ...base };
    out.project_type = "java";
    out.language = "java";
    const hasPom = detectedFiles.includes("pom.xml");
    const hasGradle =
      detectedFiles.includes("build.gradle") ||
      detectedFiles.includes("build.gradle.kts");
    out.package_manager = hasPom ? "maven" : hasGradle ? "gradle" : null;
    out.build_command = hasPom
      ? "mvn -B -DskipTests package"
      : hasGradle
      ? "./gradlew build --no-daemon -x test"
      : "javac -d out $(find src -name '*.java' 2>/dev/null)";
    out.test_command = hasPom
      ? "mvn test"
      : hasGradle
      ? "./gradlew test"
      : "";
    out.artifact_path = hasPom ? "target/" : hasGradle ? "build/" : "";
    return out;
  }

  // Generic fallback
  return base;
}

/**
 * adaptiveExtract — uses LLM *only if* HF_PARAM_MODEL is set; otherwise deterministic only.
 */
export async function adaptiveExtract(features, mergedSuggestion = {}) {
  const chosenTemplates = mergedSuggestion.chosen || [];
  const base = deterministicFallback(features, chosenTemplates);

  if (!HF_TOKEN || !HF_PARAM_MODEL || !hf) {
    // No text-generation model configured → no LLM, no error.
    return base;
  }

  const prompt = `
You are a CI/CD configuration assistant.
Given repository metadata and classifier hints, output a valid JSON object
with overrides for CI parameters.

Repository features:
${JSON.stringify(features, null, 2)}

Classifier hints:
${JSON.stringify(mergedSuggestion, null, 2)}

Rules:
- Respond with ONLY a single JSON object, no commentary.
- Include fields ONLY if you want to override the defaults.
- Prefer simple, safe commands (npm, pytest, mvn, etc.).
`;

  try {
    const response = await hf.textGeneration({
      model: HF_PARAM_MODEL,
      inputs: prompt,
      provider: "hf-inference",
      parameters: {
        max_new_tokens: 600,
        temperature: 0.2,
      },
    });

    const outputText =
      response.generated_text || JSON.stringify(response);
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in model output");

    const parsed = JSON.parse(jsonMatch[0]);

    // Merge: base is authoritative; parsed only overrides specific keys
    const merged = {
      ...base,
      ...parsed,
      container: {
        ...base.container,
        ...(parsed.container || {}),
      },
      triggers: {
        ...base.triggers,
        ...(parsed.triggers || {}),
      },
    };

    return merged;
  } catch (err) {
    console.warn("Adaptive extraction failed, using fallback:", err.message);
    return base;
  }
}
