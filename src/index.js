import "dotenv/config";
import path from "node:path";
import { classify } from "./modules/classifier/run.js";
import { analyzeRepo } from "./modules/detector/repo-analyzer.js";
import { render } from "./modules/renderer/render.js";

//const repoUrl = "https://github.com/oringejooz/classifier-module.git";
//const repoUrl = "https://github.com/KhushiJain2004/sample-node-repo.git";
const repoUrl="https://github.com/KhushiJain2004/Devops_Lab.git";
//const repoUrl="https://github.com/dockersamples/helloworld-demo-node.git"
//const repoUrl="https://github.com/oringejooz/demo-python-test.git"

const output = path.resolve('outputs/');
const analyzerOutput=path.join(output,'feature.json');
const classifierOutput=path.join(output,'values.json');
const renderOutput=path.join(output,'ci.yml');
const template_type='intermediate.hbs';

await analyzeRepo(repoUrl,analyzerOutput).catch((err) => console.error("Error:", err.message));
await classify(analyzerOutput,classifierOutput).catch((err) => console.error("Error:", err.message));
await render(classifierOutput,renderOutput,template_type).catch((err) => console.error("Error:", err.message));