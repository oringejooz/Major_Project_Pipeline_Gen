// scripts/render.js
import { promises as fs } from 'node:fs';
import { fileURLToPath } from "url";
import path from 'node:path';
import Handlebars from 'handlebars';

async function registerHelpers() {
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('and', (a, b) => a && b);
  Handlebars.registerHelper('or', (a, b) => a || b);
  Handlebars.registerHelper('not', (a) => !a);
  Handlebars.registerHelper('contains', (arr, v) => Array.isArray(arr) && arr.includes(v));
  Handlebars.registerHelper('json', (ctx) => JSON.stringify(ctx));
  Handlebars.registerHelper('expr', v => `\${{ ${v} }}`);
  Handlebars.registerHelper('indent', (text, spaces) => {
    const pad = ' '.repeat(spaces);
    return new Handlebars.SafeString(String(text).split('\n').map(l => (l ? pad + l : l)).join('\n'));
  });
}

async function registerPartials(partialsDir) {
  const files = await fs.readdir(partialsDir, { withFileTypes: true });
  for (const f of files) {
    if (f.isFile() && f.name.endsWith('.hbs')) {
      const name = f.name.replace(/\.hbs$/, ''); 
      const content = await fs.readFile(path.join(partialsDir, f.name), 'utf8');
      const ns = path.basename(path.dirname(partialsDir)); 
      Handlebars.registerPartial(`${ns}/${name}`, content);
    }
  }
}

export async function render(valuesPath, outPath,template_type) {
  await registerHelpers();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const partialsDir = path.resolve(__dirname, "templates/gha/partials");


  //here you can change values.json file : (py_values.json) is for python projects
  // const valuesPath = path.resolve('outputs/values.json');
  const valuesSrc = await fs.readFile(valuesPath, 'utf8');
  const context = JSON.parse(valuesSrc);

  var lang;
  if(context.project_type=='js'|| context.project_type=='node' || context.project_type=='nodejs' ){ lang='node'}
  else if(context.project_type=='py' || context.project_type=='python'){ lang='python'}
    

  //change template type  as needed (basic-layout.hbs, intermediate.hbs)
  // const template_type='intermediate.hbs'
  const layoutPath = path.resolve(__dirname,`templates/${lang}/${template_type}`);
  // const outPath = path.resolve('outputs/ci.yml');

  await registerPartials(partialsDir);

  const layoutSrc = await fs.readFile(layoutPath, 'utf8');
  const template = Handlebars.compile(layoutSrc, { noEscape: true });

  const output = template(context);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, output, 'utf8');

  console.log(`Output file generated at: ${outPath}`);
}

// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
