import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { recordPull, loadJobs, loadJobsByIds } from '../src/store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upwork-cache-benchmark-'));
const previous = process.env.UPWORK_JOBS_HOME;
process.env.UPWORK_JOBS_HOME = root;
try {
  const jobs = Array.from({length:10000}, (_, index) => ({
    uid:String(index + 1), title:`Synthetic AI workshop ${index}`,
    description:'Synthetic history used only for a repeatable local benchmark. '.repeat(10),
    score:50, query:'ai workshop',
  }));
  await recordPull(jobs);
  const ids = jobs.slice(0,50).map(job => job.uid);
  const measure = async action => {
    await action();
    const samples = [];
    for (let index=0; index<5; index++) {
      const start = performance.now();
      await action();
      samples.push(performance.now()-start);
    }
    return samples.sort((a,b)=>a-b)[2];
  };
  const all = await measure(()=>loadJobs());
  const indexed = await measure(()=>loadJobsByIds(ids));
  console.log(JSON.stringify({node:process.version,platform:process.platform,storedJobs:10000,requestedJobs:50,samples:5,fullCacheMedianMs:Number(all.toFixed(2)),indexedMedianMs:Number(indexed.toFixed(2)),ratio:Number((all/indexed).toFixed(1))},null,2));
} finally {
  if (previous === undefined) delete process.env.UPWORK_JOBS_HOME;
  else process.env.UPWORK_JOBS_HOME = previous;
  await fs.rm(root, {recursive:true,force:true});
}
