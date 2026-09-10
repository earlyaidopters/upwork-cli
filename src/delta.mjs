export function selectPullOutput(jobs, seenBefore, options = {}) {
  const includeSeen = Boolean(options.all) && !options.newOnly;
  if (includeSeen) return jobs;
  return jobs.filter((job) => !seenBefore.has(String(job.uid)));
}
