// utils/adaptiveExtractor.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
dotenv.config();

const HF_TOKEN = process.env.HF_TOKEN;
const MISTRAL = "google/flan-t5-small";

/**
 * deterministicFallback(features, chosenTemplates)
 * Returns a conservative values.json following the required schema
 */
function deterministicFallback(features, chosenTemplates = []) {
  if (typeof chosenTemplates === "string") chosenTemplates = [chosenTemplates];

  const langs =
    features?.composition?.languages ||
    features?.languages ||
    {};
  const dominant =
    features?.composition?.dominant_language ||
    Object.keys(langs)[0] ||
    "";
  const detectedFiles = (features.detectedFiles || []).map(f =>
    f.toLowerCase()
  );
  const hasDocker =
    features?.containerization_and_deployment?.has_dockerfile ||
    detectedFiles.includes("dockerfile") ||
    false;

  const out = {
    project_type: "generic",
    language: dominant ? dominant.toLowerCase().split(" ")[0] : "unknown",
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
      sign: false
    },
    triggers: {
      branches: ["main"],
      push: true,
      pull_request: true,
      release_on_tag: true
    },
    paths_filters: {}
  };

  // --- Node.js ---
  if (
    chosenTemplates.includes("node") ||
    dominant.toLowerCase().includes("javascript") ||
    detectedFiles.includes("package.json")
  ) {
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
      caching: {
        paths: ["~/.npm"],
        key: "npm-cache-${{ hashFiles('**/package-lock.json') }}"
      },
      secrets_required: ["NPM_TOKEN"],
      paths_filters: {
        frontend: ["src/**", "package.json", "package-lock.json"],
        docker: ["Dockerfile", ".dockerignore"]
      }
    });
  }

  // --- Python ---
  if (
    chosenTemplates.includes("python") ||
    dominant.toLowerCase().includes("python") ||
    detectedFiles.includes("requirements.txt")
  ) {
    Object.assign(out, {
      project_type: "python",
      language: "py",
      package_manager: "pip",
      lint_command: "flake8 .",
      test_command: detectedFiles.includes("pytest.ini")
        ? "pytest --maxfail=1 --disable-warnings -q"
        : "python -m unittest",
      build_command: "python -m build || python setup.py sdist",
      artifact_path: "dist/",
      matrix: { python_versions: ["3.8", "3.9", "3.10", "3.11"] },
      caching: {
        paths: ["~/.cache/pip"],
        key: "pip-cache-${{ hashFiles('**/requirements.txt') }}"
      },
      secrets_required: ["PYPI_TOKEN"],
      paths_filters: {
        backend: ["**/*.py", "requirements.txt"],
        docker: ["Dockerfile", ".dockerignore"]
      }
    });
  }

// --- Java ---
const hasPom = detectedFiles.includes("pom.xml");
const hasMvnw = detectedFiles.includes("mvnw") || detectedFiles.includes("mvnw.cmd");
const hasGradle =
  detectedFiles.includes("build.gradle") ||
  detectedFiles.includes("build.gradle.kts") ||
  detectedFiles.includes("gradlew") ||
  detectedFiles.includes("gradlew.bat");

if (
  chosenTemplates.includes("java") ||
  dominant.toLowerCase().includes("java") ||
  hasPom ||
  hasGradle ||
  hasMvnw
) {
  out.project_type = "java";
  out.language = "java";

  if (hasPom || hasMvnw) {
    // Maven-based project
    out.package_manager = "maven";
    out.build_command = "mvn -B -DskipTests package";
    out.test_command = "mvn test";
    out.artifact_path = "target/";
    out.caching = {
      paths: ["~/.m2"],
      key: "maven-${{ hashFiles('**/pom.xml') }}"
    };
  } else if (hasGradle) {
    // Gradle-based project
    out.package_manager = "gradle";
    out.build_command = " ./gradlew build --no-daemon -x test || gradle build";
    out.test_command = "./gradlew test || gradle test";
    out.artifact_path = "build/";
    out.caching = {
      paths: ["~/.gradle"],
      key: "gradle-${{ hashFiles('**/build.gradle*') }}"
    };
  } else {
    // No detected build system — conservative defaults
    out.package_manager = null;
    out.build_command =
      "javac -d out $(find src -name '*.java' 2>/dev/null) || echo 'No build tool detected. Recommend adding Maven or Gradle.'";
    // keep test_command empty because we don't know the test harness
    out.test_command = "";
    out.artifact_path = "";
    out.caching = {};
    // helpful note for maintainers
    out._notes = out._notes || [];
    out._notes.push(
      "No Maven/Gradle detected. Add pom.xml or build.gradle (or add a buildpack) for richer CI (packaging, testing)."
    );
  }

  // Add default path filters for Java sources if they exist
  // (we won't assume 'src/main/java' exists but it's common)
  out.paths_filters = out.paths_filters || {};
  out.paths_filters.java = out.paths_filters.java || [];
  out.paths_filters.java.push("src/**/java/**", "**/*.java", "pom.xml", "build.gradle");
}


  // --- Docker ---
  if (hasDocker) {
    Object.assign(out.container, {
      enabled: true,
      image: "ghcr.io/OWNER/REPO",
      registry: "ghcr.io",
      cache: true,
      tags: ["latest", "sha"],
      provenance: true,
      sbom: true
    });
    out.secrets_required.push("DOCKER_REGISTRY_TOKEN");
  }

  // --- Deployment (Vercel / static sites) ---
  const hasFrontend =
    features?.composition?.languages?.HTML ||
    detectedFiles.includes("vercel.json") ||
    detectedFiles.includes("next.config.js");

  if (hasFrontend) {
    Object.assign(out.deployment, {
      enabled: true,
      provider: "vercel",
      config_file: "vercel.json",
      mode: "cli"
    });
    out.secrets_required.push("VERCEL_TOKEN");
  }

  return out;
}

/**
 * adaptiveExtract(features, mergedSuggestion)
 * Uses Mistral API to generate values.json or fallbacks safely
 */
export async function adaptiveExtract(features, mergedSuggestion = {}) {
  if (!HF_TOKEN) {
    console.warn("HF token missing; using deterministic fallback.");
    return deterministicFallback(features, mergedSuggestion.chosen || []);
  }

  const prompt = `
You are a CI/CD configuration assistant.
Given repository metadata and classifier hints, generate a valid JSON with:
project_type, language, package_manager, node_version (if applicable), lint_command, test_command, build_command, artifact_path,
matrix, caching, secrets_required, deployment, container, triggers, paths_filters.

Repository features:
${JSON.stringify(features, null, 2)}

Classifier hints:
${JSON.stringify(mergedSuggestion, null, 2)}

Rules:
- Use minimal safe defaults.
- For multi-language repositories, set project_type:"multi-stack" and include distinct build/test entries per stack.
- Return strictly valid JSON only (no markdown or explanations).
`;

  try {
    const resp = await axios.post(
      `https://api-inference.huggingface.co/models/${MISTRAL}`,
      { inputs: prompt, parameters: { max_new_tokens: 600, temperature: 0.2 } },
      { headers: { Authorization: `Bearer ${HF_TOKEN}` }, timeout: 120000 }
    );

    let outputText = "";
    if (resp.data?.generated_text) outputText = resp.data.generated_text;
    else if (Array.isArray(resp.data) && resp.data[0]?.generated_text)
      outputText = resp.data[0].generated_text;
    else if (typeof resp.data === "string") outputText = resp.data;
    else outputText = JSON.stringify(resp.data);

    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in model output");
    const parsed = JSON.parse(jsonMatch[0]);

    // Merge safely: fallback keys + LLM enhancements
    const fallback = deterministicFallback(features, mergedSuggestion.chosen || []);
    const merged = structuredClone(fallback);
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === "object" && !Array.isArray(parsed[key]))
        merged[key] = { ...merged[key], ...parsed[key] };
      else merged[key] = parsed[key];
    }

    return merged;
  } catch (err) {
    console.warn("Adaptive extraction failed:", err.response?.data || err.message);
    return deterministicFallback(features, mergedSuggestion.chosen || []);
  }
}
