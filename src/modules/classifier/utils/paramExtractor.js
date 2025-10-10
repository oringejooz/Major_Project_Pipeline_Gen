// utils/paramExtractor.js
import { InferenceClient } from "@huggingface/inference";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
dotenv.config();

const HF_TOKEN = process.env.HF_TOKEN;
const hf = new InferenceClient(HF_TOKEN);

// stable model that works on free endpoints
const MODEL = "mistralai/Mistral-7B-Instruct-v0.2";

/**
 * deterministicFallback — safe defaults
 */
function deterministicFallback(features, chosenTemplates = []) {
  if (typeof chosenTemplates === "string") chosenTemplates = [chosenTemplates];
  const langs = features?.composition?.languages || features?.languages || {};
  const dominant =
    features?.composition?.dominant_language?.toLowerCase() ||
    Object.keys(langs)[0]?.toLowerCase() ||
    "";
  const detectedFiles = (features.detectedFiles || []).map((f) => f.toLowerCase());
  const hasDocker =
    features?.containerization_and_deployment?.has_dockerfile ||
    detectedFiles.includes("dockerfile") ||
    false;

  const out = {
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
    triggers: { branches: ["main"], push: true, pull_request: true, release_on_tag: true },
    paths_filters: {},
  };

  // --- Node.js ---
  const isNode =
    chosenTemplates.includes("node") ||
    dominant.includes("javascript") ||
    detectedFiles.includes("package.json");

  if (isNode) {
    Object.assign(out, {
      project_type: "node",
      language: "js",
      package_manager: "npm",
      node_version: "18.x",
      lint_command: "npm run lint || echo 'No lint script'",
      test_command: "npm test || echo 'No tests found'",
      build_command: "npm run build || echo 'No build script'",
      artifact_path: "dist/",
      matrix: { node_versions: ["16.x", "18.x", "20.x"] },
    });
    // stop here for Node, don't fall into Java
    if (hasDocker) {
      Object.assign(out.container, {
        enabled: true,
        image: "ghcr.io/OWNER/REPO",
        registry: "ghcr.io",
        cache: true,
      });
      out.secrets_required.push("DOCKER_REGISTRY_TOKEN");
    }
    return out;
  }

  // --- Python ---
  const isPython =
    chosenTemplates.includes("python") ||
    dominant.includes("python") ||
    detectedFiles.includes("requirements.txt");

  if (isPython) {
    Object.assign(out, {
      project_type: "python",
      language: "py",
      package_manager: "pip",
      lint_command: "flake8 .",
      test_command: "pytest || python -m unittest",
      build_command: "python -m build || python setup.py sdist",
      artifact_path: "dist/",
      matrix: { python_versions: ["3.9", "3.10", "3.11"] },
    });
    return out;
  }

  // --- Java ---
  const hasPom = detectedFiles.includes("pom.xml");
  const hasGradle =
    detectedFiles.includes("build.gradle") || detectedFiles.includes("build.gradle.kts");

  const isJava =
    chosenTemplates.includes("java") ||
    dominant.includes("java") ||
    hasPom ||
    hasGradle;

  if (isJava) {
    Object.assign(out, {
      project_type: "java",
      language: "java",
      package_manager: hasPom ? "maven" : hasGradle ? "gradle" : null,
      build_command: hasPom
        ? "mvn -B -DskipTests package"
        : hasGradle
        ? "./gradlew build --no-daemon -x test"
        : "javac -d out $(find src -name '*.java' 2>/dev/null)",
      test_command: hasPom ? "mvn test" : hasGradle ? "./gradlew test" : "",
      artifact_path: hasPom ? "target/" : hasGradle ? "build/" : "",
    });
    return out;
  }

  return out;
}

/**
 * adaptiveExtract — call LLM with fallback
 */
export async function adaptiveExtract(features, mergedSuggestion = {}) {
  if (!HF_TOKEN) {
    console.warn("⚠️ HF_TOKEN missing; using fallback.");
    return deterministicFallback(features, mergedSuggestion.chosen || []);
  }

  const prompt = `
You are a CI/CD configuration assistant.
Given repository metadata and classifier hints, output a valid JSON config.
Repository features:
${JSON.stringify(features, null, 2)}
Classifier hints:
${JSON.stringify(mergedSuggestion, null, 2)}
Rules:
- Return strictly valid JSON.
- Use safe defaults.
`;

  try {
    const response = await hf.textGeneration({
      model: MODEL,
      inputs: prompt,
      parameters: { max_new_tokens: 600, temperature: 0.2 },
    });

    const outputText = response.generated_text || JSON.stringify(response);
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in model output");
    const parsed = JSON.parse(jsonMatch[0]);

    const fallback = deterministicFallback(features, mergedSuggestion.chosen || []);
    return { ...fallback, ...parsed };
  } catch (err) {
    console.warn("Adaptive extraction failed:", err.message);
    return deterministicFallback(features, mergedSuggestion.chosen || []);
  }
}
