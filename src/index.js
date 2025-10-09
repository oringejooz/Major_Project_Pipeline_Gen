import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import path from "node:path";
import { render } from "./modules/renderer/render.js";

const repoUrl = "https://github.com/KhushiJain2004/sample-node-repo.git";

const output = path.resolve('../../../outputs/');
const analyzeOutput=path.join(output,'feature.json');
const renderOutput=path.join(output,'ci.yml');
const template_type='intermediate.hbs';

await analyzeRepo(repoUrl,analyzeOutput).catch((err) => console.error("Error:", err.message));

const valuesPath = path.join(output,'values.json');
await render(valuesPath,renderOutput,template_type).catch((err) => console.error("Error:", err.message));