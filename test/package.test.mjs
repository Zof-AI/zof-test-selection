import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm,access}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{execFileSync}from'node:child_process';
const run=(args,options={})=>execFileSync(process.execPath,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,...options});
test('clean install of packed candidate and candidate dependencies executes selection',async()=>{
 const npm=process.env.npm_execpath;assert.ok(npm);const root=await mkdtemp(join(tmpdir(),'zof-select-pack-'));try{
 const pack=JSON.parse(run([npm,'pack','--ignore-scripts','--json','--pack-destination',root]))[0];assert.ok(pack.files.some(f=>f.path==='dist/index.d.ts'));assert.ok(pack.files.every(f=>!/^src\/|^test\/|\.map$|\.env/.test(f.path)));
 const project=join(root,'clean');await mkdir(project);await writeFile(join(project,'package.json'),'{"private":true,"type":"module"}');
 const artifacts=resolve('../../orchestration/artifacts');const candidates=[];const versions={'change-impact':'0.1.1','evidence-spec':'0.1.0'};for(const name of['change-impact','evidence-spec']){const f=join(artifacts,`zof-ai-${name}-${versions[name]}.tgz`);try{await access(f);candidates.push(f);}catch{}}
 run([npm,'install','--ignore-scripts','--no-audit','--no-fund',...candidates,join(root,pack.filename)],{cwd:project});
 const output=run(['--input-type=module','-e',"import{selectTests}from'@zof-ai/test-selection';console.log(JSON.stringify(await selectTests({root:'node_modules/@zof-ai/test-selection/examples/local',changedFiles:['src/math.ts']})));"],{cwd:project});assert.deepEqual(JSON.parse(output).selectedTests,['tests/math.test.ts']);
 const pkg=JSON.parse(await readFile(join(project,'node_modules/@zof-ai/test-selection/package.json'),'utf8'));assert.equal(pkg.dependencies['@zof-ai/change-impact'],'0.1.1');assert.equal(pkg.bin['zof-test-selection'],'./dist/cli.js');
 assert.match(run([npm,'exec','--offline','--','zof-test-selection','--help'],{cwd:project}),/Usage:/);
 }finally{await rm(root,{recursive:true,force:true});}
});
