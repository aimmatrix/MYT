/* Build a portable, isolated browser demo. No SDK calls or shared MYT writes.
 * Usage: node MYT/tools/build-demo.cjs
 * Optional: MYT_NODE_MODULES=/path/to/node_modules for TypeScript + React 19.
 */
const fs=require('fs'), path=require('path'), {createRequire}=require('module');
const root=path.resolve(__dirname,'..');
const modules=process.env.MYT_NODE_MODULES||'/Users/ammad/Documents/Scrapper/node_modules';
const resolve=createRequire(path.join(modules,'package.json'));
const ts=resolve('typescript');
const seeds={};
for(const name of ['activities.json','sample-profiles.json'])seeds['data/'+name]=fs.readFileSync(path.join(root,'data',name),'utf8');
seeds['data/session.json']=JSON.stringify({schemaVersion:1,organiserUserId:'demo-ammad'});
const key=id=>'id-'+Buffer.from(id).toString('hex');
const catalog=JSON.parse(seeds['data/activities.json']).items;
const activity=catalog.find(a=>a.interestId==='football'&&a.timeOptions.some(o=>Date.parse(o.startAt)>Date.now()))||catalog.find(a=>a.timeOptions.some(o=>Date.parse(o.startAt)>Date.now()))||catalog[0];
const stamp='2026-10-24T10:00:00Z';
for(const [id,name,uni,interest] of [['demo-maya','Maya Rahman · Demo',"King's College London",'football'],['demo-leo','Leo Mensah · Demo','UCL','karting'],['demo-priya','Priya Shah · Demo','Queen Mary','cinema']]) {
 seeds[`data/profiles/${key(id)}.json`]=JSON.stringify({schemaVersion:1,userId:id,displayName:name,university:uni,interestIds:[interest,'social'],availability:['weekday-evening','weekend-day'],budgetPence:3000,isDemo:false,freeSlots:['tue-eve','sat-day'],universityId:'ucl',yearOfStudy:'2',budgetBand:'u30'});
 seeds[`data/interests/${key(activity.id)}/${key(id)}.json`]=JSON.stringify({schemaVersion:1,activityId:activity.id,userId:id,status:'interested',updatedAt:stamp});
}
seeds[`data/friends/requests/${key('demo-maya')}/${key('demo-ammad')}.json`]=JSON.stringify({schemaVersion:1,fromId:'demo-maya',toId:'demo-ammad',status:'pending',createdAt:stamp});
const group='group:'+activity.id;
seeds[`data/chats/${key(group)}/messages/${key('demo-maya')}/${key('hello')}.json`]=JSON.stringify({schemaVersion:1,id:'hello',chatId:group,authorId:'demo-maya',kind:'text',text:"Hey! Who's up for this? 👋",createdAt:stamp});
const host=`const React=require('react');
const user={id:'demo-ammad',name:'Ammad'};
const initial=${JSON.stringify(seeds)};
let stored={};try{stored=JSON.parse(localStorage.getItem('myt-redesign-demo-v1')||'{}');}catch{}
const records=new Map(Object.entries({...initial,...stored}));const listeners=new Set();
exports.filePort={async readText(p){if(!records.has(p))throw Error('Missing');return records.get(p);},async writeText(p,t,o){if(!o.overwrite&&records.has(p))throw Error('Exists');records.set(p,t);try{localStorage.setItem('myt-redesign-demo-v1',JSON.stringify(Object.fromEntries(records)));}catch{throw Error('Browser storage unavailable');}listeners.forEach(fn=>fn({type:'changed',path:p}));},async list(p){const prefix=p?p+'/':'';const out=new Map();for(const k of records.keys())if(k.startsWith(prefix)){const rest=k.slice(prefix.length);const name=rest.split('/')[0];out.set(name,{path:prefix+name,name,kind:rest.includes('/')?'folder':'file'});}if(!out.size&&p&&p!=='data')throw Error('Missing');return [...out.values()];},watch(p,fn){listeners.add(fn);return()=>listeners.delete(fn);}};
exports.aiRequest=async function(kind,payload,signal){
 let response;try{response=await fetch('/api/ai/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:signal||AbortSignal.timeout(35000)});}catch{throw Error('AI connection unavailable. Open the demo through the local MYT AI server.');}
 const result=await response.json();if(!response.ok)throw Error(result.error||'AI request failed.');return result;
};
exports.ctx={currentUser:user,files:{}};exports.toCurrentUser=u=>u;exports.utf8ByteLength=s=>new TextEncoder().encode(s).length;
exports.useCurrentUser=()=>user;exports.useConnected=()=>false;const peers=[];exports.usePeers=()=>peers;const setPresence=()=>{};exports.useSetPresence=()=>setPresence;
`;
const sources=[],ids=new Map();
function add(file){
 if(ids.has(file))return ids.get(file);
 const id=sources.length;ids.set(file,id);sources.push('');
 let source=file===path.join(root,'code/src/host.ts')?host:fs.readFileSync(file,'utf8');
 if(/\.tsx?$/.test(file)&&file!==path.join(root,'code/src/host.ts'))source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 source=source.replace(/require\(["']([^"']+)["']\)/g,(all,name)=>{
  let dep;
  if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name);dep=['','.ts','.tsx','.js','/index.js'].map(e=>base+e).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());}
  else dep=resolve.resolve(name);
  if(!dep)throw Error('Cannot resolve '+name+' from '+file);
  return '__require('+add(dep)+')';
 });
 sources[id]=`function(module,exports,__require){\n${source}\n}`;return id;
}
const entry=add(path.join(root,'code/src/home.tsx'));
const bundle=`(()=>{const process={env:{NODE_ENV:'production'}};const modules=[${sources.join(',\n')}],cache={};function __require(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};modules[id](module,module.exports,__require);return module.exports;}__require(${entry});})();`;
const license=fs.readFileSync(path.join(root,"code/FONT-LICENSES.txt"),"utf8");
// The app loads code/fonts/*.woff2 relatively; the single-file demo needs them inline.
const css=fs.readFileSync(path.join(root,'code/styles.css'),'utf8').replace(/url\("(fonts\/[\w.-]+\.woff2)"\)/g,(_,file)=>`url("data:font/woff2;base64,${fs.readFileSync(path.join(root,'code',file)).toString('base64')}")`);
const html=`<!doctype html><html lang="en"><head><script type="text/plain" id="font-licenses">${license}</script><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MYT · Student demo</title><style>${css}\n.demo-notice{background:var(--myt-raised);color:var(--myt-text);text-align:center;padding:10px 16px;font:12px var(--myt-body)}.demo-notice button{background:none;border:0;color:var(--myt-accent);font:inherit;text-decoration:underline;cursor:pointer;min-height:44px}</style></head><body><div class="demo-notice">Interactive demo · fictional students · saved only in this browser · email check simulated <button onclick="localStorage.removeItem('myt-redesign-demo-v1');location.reload()">Reset demo</button></div><div id="root"></div><script>${bundle.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
fs.mkdirSync(path.join(root,'demo'),{recursive:true});fs.writeFileSync(path.join(root,'demo/index.html'),html);
console.log('Built '+path.join(root,'demo/index.html')+' ('+Math.round(html.length/1024)+' KiB).');
