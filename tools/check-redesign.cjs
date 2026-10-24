/* Reproducible strict check and isolated domain/repository checks.
 * MYT_NODE_MODULES may point to any installation with TypeScript 5 and React 19 types.
 * Host typings are local test stubs, not an SDK build or sync proof.
 */
const fs=require('fs'),os=require('os'),path=require('path'),{createRequire}=require('module'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),source=path.join(root,'code/src');
const modules=process.env.MYT_NODE_MODULES||'/Users/ammad/Documents/Scrapper/node_modules';
const local=createRequire(path.join(modules,'package.json'));
const compiler=local.resolve('typescript/bin/tsc');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'myt-redesign-check-'));
const reactTypes=path.dirname(local.resolve('@types/react/package.json'));
const strict={compilerOptions:{target:'es2022',module:'esnext',moduleResolution:'bundler',lib:['es2022','dom','dom.iterable'],jsx:'react-jsx',strict:true,noEmit:true,skipLibCheck:true,types:[],baseUrl:work,paths:{react:[reactTypes],'react/jsx-runtime':[path.join(reactTypes,'jsx-runtime')]}},files:[path.join(root,'tools/host-check.d.ts')],include:[source+'/**/*']};
const domain={compilerOptions:{target:'es2022',module:'commonjs',moduleResolution:'node',lib:['es2022','dom'],strict:true,skipLibCheck:true,types:[],outDir:path.join(work,'out'),rootDir:source},files:['qa/domain-checks.ts','qa/social-checks.ts','wiring/appRepository.ts','data/socialRepository.ts'].map(p=>path.join(source,p))};
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
for(const [name,config] of [['strict',strict],['domain',domain]]){const file=path.join(work,name+'.json');fs.writeFileSync(file,JSON.stringify(config));run([compiler,'-p',file]);console.log(name+' TypeScript: PASS');}
(async()=>{
 for(const name of ['domain','social']){
  const suite=require(path.join(work,`out/qa/${name}-checks.js`));const checks=await (suite.runChecks||suite.runSocialChecks)();
  for(const check of checks)if(!check.passed)console.error('FAIL '+check.name,check.detail||'');
  const passing=checks.filter(c=>c.passed).length;console.log(`${name}: ${passing}/${checks.length} passed`);if(passing!==checks.length)process.exit(1);
 }
 const flow=fs.readFileSync(path.join(root,'Planning/Checks/e2e-flow.cjs.txt'),'utf8').replace('/path/to/Lightfern/MYT/data/',root+'/data/');
 const file=path.join(work,'flow.cjs');fs.writeFileSync(file,flow);run([file]);
})().catch(e=>{console.error(e);process.exit(1)});
