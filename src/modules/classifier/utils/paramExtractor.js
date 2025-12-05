// utils/paramExtractor.js
import { InferenceClient } from "@huggingface/inference";
import dotenv from "dotenv";

dotenv.config({ path: "src/modules/classifier/.env" });

const HF_TOKEN = process.env.HF_TOKEN;
const PARAM_MODEL =
  process.env.HF_PARAM_MODEL || "mistralai/Mistral-7B-Instruct-v0.2";

const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

if (!HF_TOKEN) {
  console.warn(
    "⚠️ HF_TOKEN not found; param extraction will use deterministic fallback only."
  );
}

/**
 * deterministicFallback — safe defaults
 */
function deterministicFallback(features, primaryTemplate) {
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
    ...(features.build_and_dependency?.package_managers || []),
  ];
  const detectedFiles = detectedFilesRaw.map((f) => String(f).toLowerCase());

  const hasDocker =
    features?.containerization_and_deployment?.has_dockerfile ||
    detectedFiles.includes("dockerfile") ||
    Object.keys(langs).some((l) => l.toLowerCase() === "dockerfile");

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

  const primary = (primaryTemplate || "").toLowerCase();

  if (primary === "docker" || (hasDocker && !["node", "python", "java"].includes(primary))) {
    return {
      ...base,
      project_type: "docker",
      language: "docker",
      build_command: "docker build -t app .",
      container: {
        ...base.container,
        enabled: true,
        image: "ghcr.io/OWNER/REPO",
        registry: "ghcr.io",
        platforms: ["linux/amd64"],
        cache: true,
        tags: ["latest"],
      },
    };
  }

  if (primary === "node") {
    const out = {
      ...base,
      project_type: "node",
      language: "js",
      package_manager: "npm",
      node_version: "18.x",
      lint_command: "npm run lint || echo 'No lint script'",
      test_command: "npm test || echo 'No tests found'",
      build_command: "npm run build || echo 'No build script'",
      artifact_path: "dist/",
      matrix: { node_versions: ["16.x", "18.x", "20.x"] },
    };

    if (hasDocker) {
      out.container = {
        ...out.container,
        enabled: true,
        image: "ghcr.io/OWNER/REPO",
        registry: "ghcr.io",
        cache: true,
      };
      out.secrets_required = ["DOCKER_REGISTRY_TOKEN"];
    }
    return out;
  }

  if (primary === "python") {
    return {
      ...base,
      project_type: "python",
      language: "py",
      package_manager: "pip",
      lint_command: "flake8 . || echo 'No flake8 config'",
      test_command: "pytest || python -m unittest",
      build_command: "python -m build || python setup.py sdist",
      artifact_path: "dist/",
      matrix: { python_versions: ["3.9", "3.10", "3.11"] },
    };
  }

  if (primary === "java") {
    const hasPom = detectedFiles.includes("pom.xml");
    const hasGradle =
      detectedFiles.includes("build.gradle") ||
      detectedFiles.includes("build.gradle.kts");

    return {
      ...base,
      project_type: "java",
      language: "java",
      package_manager: hasPom ? "maven" : hasGradle ? "gradle" : null,
      build_command: hasPom
        ? "mvn -B -DskipTests package"
        : hasGradle
        ? "./gradlew build --no-daemon -x test"
        : "javac -d out $(find src -name '*.java' 2>/dev/null)",
      test_command: hasPom
        ? "mvn test"
        : hasGradle
        ? "./gradlew test"
        : "",
      artifact_path: hasPom ? "target/" : hasGradle ? "build/" : "",
    };
  }

  return base;
}

/**
 * adaptiveExtract — LLM refinement
 */
export async function adaptiveExtract(features, mergedSuggestion = {}) {
  const primary =
    mergedSuggestion.primary ||
    (mergedSuggestion.chosen && mergedSuggestion.chosen[0]) ||
    "generic";

  const base = deterministicFallback(features, primary);

  if (!HF_TOKEN || !hf) return base;

  const featuresSummary = {
    repo: features.repo,
    dominant_language: features.composition?.dominant_language,
    languages: features.composition?.languages,
    frameworks: features.build_and_dependency?.frameworks,
    runtimes: features.build_and_dependency?.runtimes,
    has_dockerfile: features.containerization_and_deployment?.has_dockerfile,
    detectedFiles: (features.detectedFiles || []).slice(0, 25),
  };

  const prompt = `
You are a CI/CD assistant. Only output a JSON object of overrides.

Repository:
${JSON.stringify(featuresSummary, null, 2)}

Classifier:
${JSON.stringify(
    {
      primary,
      top_labels: (mergedSuggestion.merged || [])
        .slice(0, 5)
        .map((m) => ({
          label: m.label,
          rule: m.rule,
          hf: m.hf,
          combined: m.combined,
        })),
    },
    null,
    2
  )}
`;

  try {
    const response = await hf.textGeneration({
      model: PARAM_MODEL,
      inputs: prompt,
      provider: "hf-inference",   // ⭐ CORRECT PROVIDER
      parameters: {
        max_new_tokens: 500,
        temperature: 0.2,
      },
    });

    const text =
      response?.generated_text ||
      response?.[0]?.generated_text ||
      JSON.stringify(response);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Model returned no JSON");

    const parsed = JSON.parse(jsonMatch[0]);

    return {
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
  } catch (err) {
    console.warn("Adaptive extraction failed:", err.message);
    return base;
  }
}
