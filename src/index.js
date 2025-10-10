import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import {classify} from "./modules/classifier/run.js"
import path from "node:path";
import { render } from "./modules/renderer/render.js";

const repoUrl = "https://github.com/oringejooz/classifier-module.git";

const output = path.resolve('outputs/');
const analyzerOutput=path.join(output,'feature.json');
const classifierOutput=path.join(output,'values.json');
const renderOutput=path.join(output,'ci.yml');
const template_type='intermediate.hbs';

await analyzeRepo(repoUrl,analyzerOutput).catch((err) => console.error("Error:", err.message));
await classify(analyzerOutput,classifierOutput).catch((err) => console.error("Error:", err.message));
await render(classifierOutput,renderOutput,template_type).catch((err) => console.error("Error:", err.message));