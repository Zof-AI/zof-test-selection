import { analyzeImpact, isTestFile } from '@zofai/change-impact';
import type { AnalyzeOptions, ImpactReport } from '@zofai/change-impact';
import { assertSafeRelativePath, redact, safeReadJson } from '@zofai/evidence-spec';
export interface CoverageMap { schemaVersion: 'coverage-map/v1'; tests: Record<string, string[]> }
export interface SelectionOptions extends AnalyzeOptions { fullSuite?: boolean; fallback?: 'full' | 'error'; coverageMap?: CoverageMap; coverageMapFile?: string }
export interface SelectionReport {
  schemaVersion: 'test-selection/v1'; mode: 'selected' | 'full' | 'blocked';
  runFullSuite: boolean; discoveryComplete: boolean; selectedTests: string[]; omittedTests: string[];
  reasons: { test: string; reasons: string[] }[]; fallbackReasons: string[];
  changedFiles: string[]; confidence: 'high' | 'medium' | 'low';
  limitations: string[]; verificationResult: 'not-run';
}
function validateCoverage(value: unknown, files: Set<string>): CoverageMap {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!['schemaVersion','tests'].includes(k))) throw new Error('Invalid coverage map');
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 'coverage-map/v1' || !data.tests || typeof data.tests !== 'object' || Array.isArray(data.tests) || Object.keys(data.tests).length > 5000) throw new Error('Invalid coverage map');
  let entries=0;
  for (const [test,sources] of Object.entries(data.tests)) {
    assertSafeRelativePath(test);
    if (!files.has(test) || !Array.isArray(sources) || sources.length > 5000) throw new Error('Coverage map references an unavailable test or invalid source list');
    for(const source of sources) { if(typeof source!=='string') throw new Error('Invalid coverage map source'); assertSafeRelativePath(source); if(++entries>50000) throw new Error('Coverage map exceeds relationship limit'); }
  }
  return data as unknown as CoverageMap;
}
function reachableTests(start: string, reverse: Map<string,Set<string>>, tests: Set<string>): Set<string> {
  const seen=new Set([start]); const queue=[start]; const found=new Set<string>();
  for(let i=0;i<queue.length;i++) { const file=queue[i]!; if(tests.has(file)) found.add(file); for(const consumer of reverse.get(file)??[]) if(!seen.has(consumer)) { seen.add(consumer);queue.push(consumer); } }
  return found;
}
export async function selectTests(options: SelectionOptions): Promise<SelectionReport> {
  if(!options || (options.fallback !== undefined && !['full','error'].includes(options.fallback)) || (options.fullSuite !== undefined && typeof options.fullSuite !== 'boolean')) throw new Error('Invalid selection options');
  if(options.coverageMap && options.coverageMapFile) throw new Error('Choose an inline coverage map or a coverage map file');
  const impact: ImpactReport = await analyzeImpact(options);
  const files=new Set(impact.files);
  const coverage=options.coverageMapFile ? validateCoverage(await safeReadJson(options.root,options.coverageMapFile,1024*1024),files) : options.coverageMap ? validateCoverage(options.coverageMap,files) : undefined;
  const tests=new Set([...impact.files.filter(isTestFile),...Object.keys(coverage?.tests??{})]);
  const reverse=new Map<string,Set<string>>();
  for(const {file,imports} of impact.dependencies) for(const source of imports) { if(!reverse.has(source)) reverse.set(source,new Set()); reverse.get(source)!.add(file); }
  // Coverage only adds edges. It never overrides uncertain static analysis.
  for(const [test,sources] of Object.entries(coverage?.tests??{})) for(const source of sources) { if(!reverse.has(source)) reverse.set(source,new Set()); reverse.get(source)!.add(test); }
  const selected=new Set<string>(); const why=new Map<string,Set<string>>();
  const add=(test:string,reason:string)=>{selected.add(test);if(!why.has(test))why.set(test,new Set());why.get(test)!.add(reason);};
  const fallbackReasons:string[]=[];
  if(!impact.complete) fallbackReasons.push('Static dependency analysis is incomplete.');
  if(impact.changes.length && !tests.size) fallbackReasons.push('No tests were discovered; the runner must determine its full suite.');
  const staticSelected=new Set(impact.affectedTests);
  for(const change of impact.changes) {
    const related=reachableTests(change.path,reverse,tests);
    if(!related.size) fallbackReasons.push('At least one changed file has no known test relationship.');
    for(const test of related) add(test,test===change.path?'changed-test':staticSelected.has(test)?'static-dependency':'coverage-map');
  }
  let mode: SelectionReport['mode']='selected';
  if(options.fullSuite) { mode='full';for(const test of tests)add(test,'full-suite-override'); }
  else if(fallbackReasons.length) { mode=options.fallback==='error'?'blocked':'full';if(mode==='full')for(const test of tests)add(test,'conservative-fallback'); }
  const limitations=[...impact.limitations.map(l=>l.message),'Selection is advisory and does not guarantee complete regression coverage.','Conventional test names and explicit coverage maps may not describe framework-generated tests.'];
  if(coverage)limitations.push('Coverage metadata is user supplied and may be stale; it only expands the static dependency map.');
  if(mode==='full')limitations.push('Run the test runner without selection filters. The discovered list is informational and may not enumerate the full suite.');
  if(mode==='blocked') { selected.clear();why.clear();limitations.push('Selection is blocked. Resolve uncertainty or use an explicit full-suite override.'); }
  const discoveryComplete=!impact.limitations.some(l=>['FILE_LIMIT','DEPTH_LIMIT','UNREADABLE_DIRECTORY','SYMLINK','SPECIAL_FILE','UNSAFE_PATH','REDACTED_OUTPUT'].includes(l.code));
  const report:SelectionReport={schemaVersion:'test-selection/v1',mode,runFullSuite:mode==='full',discoveryComplete,selectedTests:[...selected].sort(),omittedTests:mode==='selected'?[...tests].filter(t=>!selected.has(t)).sort():[],reasons:[...why].sort(([a],[b])=>a.localeCompare(b,'en')).map(([test,reasons])=>({test,reasons:[...reasons].sort()})),fallbackReasons:[...new Set(fallbackReasons)],changedFiles:impact.changes.map(c=>c.path),confidence:mode==='selected'?impact.confidence:'low',limitations:[...new Set(limitations)],verificationResult:'not-run'};
  return redact(report);
}
export function formatReport(report: SelectionReport): string {
  return redact([`Test selection: ${report.mode}`,`Verification: ${report.verificationResult}`,...report.selectedTests.map(t=>`  ${t}`),...report.fallbackReasons.map(r=>`Fallback: ${r}`),...report.limitations.map(l=>`Limitation: ${l}`)].join('\n'));
}
