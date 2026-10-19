import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectTests, formatReport } from '../dist/index.js';
const roots=[];
async function fixture(files){const root=await mkdtemp(join(tmpdir(),'zof-select-'));roots.push(root);for(const [file,body]of Object.entries(files)){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),body);}return root;}
test.after(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
const known={'src/math.ts':'export const add=(a:number,b:number)=>a+b;','src/other.ts':'export const other=1;','tests/math.test.ts':"import '../src/math.js';",'tests/other.test.ts':"import '../src/other.js';"};
test('relevant tests selected, unrelated tests omitted and all reasons explained',async()=>{
 const root=await fixture(known);const r=await selectTests({root,changedFiles:['src/math.ts']});assert.equal(r.mode,'selected');assert.deepEqual(r.selectedTests,['tests/math.test.ts']);assert.deepEqual(r.omittedTests,['tests/other.test.ts']);assert.deepEqual(r.reasons[0].reasons,['static-dependency']);assert.equal(r.verificationResult,'not-run');assert.match(formatReport(r),/does not guarantee/);
});
test('unknown dynamic dependency triggers full-suite and strict error modes',async()=>{
 const root=await fixture({...known,'loader.ts':'export const load=(p:string)=>import(p);'});
 const full=await selectTests({root,changedFiles:['src/math.ts']});assert.equal(full.mode,'full');assert.equal(full.runFullSuite,true);assert.equal(full.selectedTests.length,2);
 const blocked=await selectTests({root,changedFiles:['src/math.ts'],fallback:'error'});assert.equal(blocked.mode,'blocked');assert.deepEqual(blocked.selectedTests,[]);
 const override=await selectTests({root,changedFiles:['src/math.ts'],fallback:'error',fullSuite:true});assert.equal(override.mode,'full');assert.ok(override.reasons.every(r=>r.reasons.includes('full-suite-override')));
});
test('full-suite override includes all known tests on complete graph',async()=>{
 const root=await fixture(known);const r=await selectTests({root,changedFiles:['src/math.ts'],fullSuite:true});assert.equal(r.mode,'full');assert.equal(r.selectedTests.length,2);assert.deepEqual(r.omittedTests,[]);
});
test('each changed source requires a known relationship, empty changes select none',async()=>{
 const root=await fixture({...known,'uncovered.ts':'export const n=1;'});assert.equal((await selectTests({root,changedFiles:['src/math.ts','uncovered.ts']})).mode,'full');
 const noChanges=await selectTests({root,changedFiles:[]});assert.equal(noChanges.mode,'selected');assert.deepEqual(noChanges.selectedTests,[]);
 const missing=await fixture({'a.ts':'export const n=1;'});const r=await selectTests({root:missing,changedFiles:['a.ts']});assert.equal(r.mode,'full');assert.ok(r.fallbackReasons.some(s=>s.includes('No tests')));
});
test('coverage map adds explicit test-to-source relationships and supports nonconventional test names',async()=>{
 const root=await fixture({...known,'runner.ts':'export const test=true;','uncovered.ts':'export const x=1;'});
 const coverageMap={schemaVersion:'coverage-map/v1',tests:{'runner.ts':['uncovered.ts']}};
 const r=await selectTests({root,changedFiles:['uncovered.ts'],coverageMap});assert.equal(r.mode,'selected');assert.deepEqual(r.selectedTests,['runner.ts']);assert.deepEqual(r.reasons[0].reasons,['coverage-map']);assert.ok(r.limitations.some(s=>s.includes('stale')));
 await writeFile(join(root,'map.json'),JSON.stringify(coverageMap));assert.deepEqual((await selectTests({root,changedFiles:['uncovered.ts'],coverageMapFile:'map.json'})).selectedTests,['runner.ts']);
});
test('coverage never overrides uncertainty and rejects malicious/invalid relationship maps',async()=>{
 const root=await fixture({...known,'unknown.ts':'const x=import(name);'});
 const coverageMap={schemaVersion:'coverage-map/v1',tests:{'tests/math.test.ts':['unknown.ts']}};assert.equal((await selectTests({root,changedFiles:['unknown.ts'],coverageMap})).mode,'full');
 for(const map of [{schemaVersion:'no',tests:{}},{schemaVersion:'coverage-map/v1',tests:{'../secret':[]}},{schemaVersion:'coverage-map/v1',tests:{'tests/math.test.ts':['../secret']}},{schemaVersion:'coverage-map/v1',tests:{'missing.ts':[]}},{schemaVersion:'coverage-map/v1',tests:{'tests/math.test.ts':null}}])await assert.rejects(selectTests({root,changedFiles:['src/math.ts'],coverageMap:map}));
 await writeFile(join(root,'bad.json'),'{} nope');await assert.rejects(selectTests({root,changedFiles:['src/math.ts'],coverageMapFile:'bad.json'}));
 await writeFile(join(root,'huge.json'),'x'.repeat(1024*1024+1));await assert.rejects(selectTests({root,changedFiles:['src/math.ts'],coverageMapFile:'huge.json'}));
 if(process.platform!=='win32'){await symlink(join(root,'bad.json'),join(root,'link.json'));await assert.rejects(selectTests({root,changedFiles:['src/math.ts'],coverageMapFile:'link.json'}));}
});
test('real Git diff integrates with impact analyzer',async()=>{
 const root=await fixture(known);const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git('init','-b','main');git('config','user.name','Synthetic');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','fixture');await writeFile(join(root,'src/math.ts'),'export const add=(a:number,b:number)=>a-b;');
 assert.deepEqual((await selectTests({root})).selectedTests,['tests/math.test.ts']);
});
test('discovery limits and redacted metadata never become passing verification',async()=>{
 const root=await fixture(known);const limited=await selectTests({root,changedFiles:['src/math.ts'],limits:{maxFiles:1}});assert.equal(limited.discoveryComplete,false);assert.equal(limited.mode,'full');
 const secret='ghp_'+'Q'.repeat(36);const special=await fixture({[`${secret}.ts`]:'export const n=1;'});const r=await selectTests({root:special,changedFiles:[`${secret}.ts`]});assert.ok(!JSON.stringify(r).includes(secret));assert.equal(r.verificationResult,'not-run');
});
test('CLI list mode refuses fallback; JSON supports machine decisions without shell execution',()=>{
 const node=(args)=>execFileSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.equal(node(['--root','examples/local','--changed','src/math.ts','--list']).trim(),'tests/math.test.ts');
 const full=JSON.parse(node(['--root','examples/local','--changed','src/math.ts','--full-suite','--json']));assert.equal(full.runFullSuite,true);
 assert.throws(()=>node(['--root','examples/uncertain','--changed','loader.ts','--list']),e=>e.status===3&&e.stdout==='');
 assert.throws(()=>node(['--root','examples/uncertain','--changed','loader.ts','--fallback','error','--json']),e=>e.status===3&&JSON.parse(e.stdout).mode==='blocked');
 assert.throws(()=>node(['--changed','../synthetic-secret']),e=>e.status===2&&!e.stderr.includes('synthetic-secret'));
});
