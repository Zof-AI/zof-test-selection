#!/usr/bin/env node
import { selectTests, formatReport } from './index.js';
import type { SelectionOptions } from './index.js';
const args=process.argv.slice(2);
if(args.includes('--help')) console.log('Usage: zof-test-selection [--root PATH] [--base REF] [--head REF] [--changed FILE ...] [--exclude GLOB ...] [--coverage-map FILE] [--fallback full|error] [--full-suite] [--json|--list]\nDoes not execute tests. In full mode run the runner without selection filters. --list refuses full or blocked mode.');
else {
 try {
  const options:SelectionOptions={root:process.cwd()};let output:'text'|'json'|'list'='text';
  for(let i=0;i<args.length;i++) {
   const flag=args[i]!;
   if(flag==='--json' || flag==='--list'){if(output!=='text')throw new Error('Output flags conflict');output=flag==='--json'?'json':'list';continue;}
   if(flag==='--full-suite'){options.fullSuite=true;continue;}
   if(!['--root','--base','--head','--changed','--exclude','--coverage-map','--fallback'].includes(flag)||!args[i+1])throw new Error('Invalid arguments');
   const value=args[++i]!;
   if(flag==='--root')options.root=value;else if(flag==='--base')options.base=value;else if(flag==='--head')options.head=value;else if(flag==='--changed')(options.changedFiles??=[]).push(value);else if(flag==='--exclude')(options.exclude??=[]).push(value);else if(flag==='--coverage-map')options.coverageMapFile=value;else if(value==='full'||value==='error')options.fallback=value;else throw new Error('Invalid fallback');
  }
  const report=await selectTests(options);
  if(output==='list'&&report.mode!=='selected'){console.error('A selected test list is unavailable. Run the full suite or resolve analysis uncertainty.');process.exitCode=3;}
  else { console.log(output==='json'?JSON.stringify(report,null,2):output==='list'?report.selectedTests.join('\n'):formatReport(report));if(report.mode==='blocked')process.exitCode=3; }
 } catch { console.error('Test selection failed. Check input paths, formats, limits, and repository access. Input content is omitted.');process.exitCode=2; }
}
