// Deterministic proposal-writing checks adapted from Peter Yang's No AI Slop
// skill (MIT): https://github.com/petergyang/no-ai-slop

const BLOCKING_RULES = [
  ['banned AI vocabulary', /\b(?:delve|foster|leverage|utilize|facilitate|empower|streamline|robust|cutting[- ]edge|paradigm shift|game changer|this is huge|this changes everything|tapestry|realm|beacon|multifaceted|meticulous|intricate|paramount|transformative|elevate|embark|supercharge|harness|ever[- ]evolving)\b/i],
  ['binary contrast', /\b(?:this|it|that|the (?:question|goal|point))\s+(?:is not|isn['’]t)\b[\s\S]{0,180}?\b(?:it is|it['’]s|the answer is)\b/i],
  ['binary contrast', /\bnot just\b[\s\S]{0,140}\bbut\b/i],
  ['formulaic contrast opener', /\byou(?:'|’)re not looking for\b[\s\S]{0,180}\byou want\b/i],
  ['throat-clearing opener', /(?:^|[.!?]\s+)(?:here['’]s the thing|here['’]s what i mean|let me be clear|i['’]ll be honest|i will be honest|the uncomfortable truth is|listen,\s*i['’]ll be straight with you)\b/i],
  ['faux-insight setup', /\b(?:this is the part most people skip|what most people get wrong|here['’]s what nobody tells you|the part everyone misses)\b/i],
  ['superficial analysis', /,\s*(?:highlighting|underscoring|reflecting|showcasing)\b/i],
  ['importance puffery', /\b(?:stands as a testament|marks a pivotal moment|plays a vital role|solidifies (?:its|the) position|underscores its significance)\b/i],
  ['interpretive metadiscourse', /\b(?:that last part matters more than it sounds|the key point is|as you can see|this distinction matters|in other words)\b/i],
  ['weasel attribution', /\b(?:experts agree|industry reports suggest|many argue|widely regarded as|studies show)\b/i],
  ['negative listing', /(?:^|\n)\s*Not\b[^\n.]{0,120}\.\s+Not\b[^\n.]{0,120}\./i],
  ['dramatic fragmentation', /\b(?:That['’]s it|That['’]s the whole thing)\b/i],
  ['rhetorical setup', /\b(?:what if i told you|think about it|plot twist)\s*[:?]/i],
  ['fake-profound kicker', /\b(?:the future isn['’]t coming[.;,]? it['’]s already here|the rest is history|let that sink in)\b/i],
  ['summary-recap ending', /(?:^|\n)\s*(?:In conclusion|Ultimately|Overall),/i],
  ['generic enthusiasm', /\b(?:I am|I'm) (?:thrilled|excited|delighted|eager) to (?:apply|submit|help)\b/i],
  ['unsupported fit claim', /\b(?:perfect|ideal) fit\b/i],
  ['generic closing', /\bI look forward to (?:hearing from you|discussing)\b/i],
];

const WARNING_RULES = [
  ['possibly empty adverb', /\b(?:just|literally|honestly|simply|actually|truly|fundamentally|importantly|crucially|inherently|inevitably)\b/i],
  ['possibly empty phrase', /\b(?:it['’]s worth noting|it['’]s important to note|at the end of the day|when it comes to|at its core|in today['’]s world|in the age of|in the world of|the reality is|the truth is|in terms of|with regard to|in order to|going forward|in this article|let['’]s dive in)\b/i],
  ['possible colon reveal', /(?:^|\n)[^:\n]{3,80}:\s+[a-z][^\n]{3,120}/m],
  ['possible fake-strong verb', /\b(?:serves as|acts as|functions as)\b/i],
  ['abstract work-lives metaphor', /\b(?:work|knowledge|context)\s+(?:still\s+)?lives?\s+in\b/i],
  ['possible invented archetypes', /\b(?:one|some)\s+(?:person|people)\s+wants?\b[\s\S]{0,220}\b(?:someone|others?)\s+(?:else\s+)?wants?\b/i],
  ['possible empty empathy claim', /\bI know (?:exactly )?what it (?:looks|feels) like when\b/i],
  ['possible empty bridge', /\b(?:I deal with the same (?:question|problem|challenge)|that is more or less the progression|so that['’]s how I['’]d handle this)\b/i],
];

function excerpt(source, match) {
  const start = Math.max(0, match.index - 45);
  const end = Math.min(source.length, match.index + match[0].length + 45);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

function find(source, rules, severity) {
  return rules.flatMap(([rule, pattern]) => {
    const match = pattern.exec(source);
    return match ? [{ severity, rule, excerpt: excerpt(source, match) }] : [];
  });
}

function sentenceParts(paragraph) {
  return paragraph
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) || [];
}

function rhythmFindings(source) {
  const prose = source.replace(/https?:\/\/\S+/g, '');
  for (const paragraph of prose.split(/\n{2,}/)) {
    const sentences = sentenceParts(paragraph);
    for (let index = 0; index <= sentences.length - 3; index += 1) {
      const group = sentences.slice(index, index + 3);
      const counts = group.map((sentence) => sentence.split(/\s+/).filter(Boolean).length);
      if (counts.every((count) => count <= 10)) {
        return [{
          severity: 'warning',
          rule: 'possible stacked short sentences',
          excerpt: group.join(' '),
        }];
      }
      const openers = group.map((sentence) => sentence.match(/^["'“‘]?([A-Za-z]+)/)?.[1]?.toLowerCase());
      if (openers[0] && openers.every((opener) => opener === openers[0])) {
        return [{
          severity: 'warning',
          rule: 'possible repeated sentence opener',
          excerpt: group.join(' '),
        }];
      }
    }
  }
  return [];
}

export function noAISlopFindings(text) {
  const source = String(text || '');
  const findings = [
    ...(source.includes('—') ? [{ severity: 'error', rule: 'em dash', excerpt: '—' }] : []),
    ...find(source, BLOCKING_RULES, 'error'),
    ...find(source, WARNING_RULES, 'warning'),
    ...rhythmFindings(source),
  ];
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.severity}:${finding.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function noAISlopViolations(text) {
  return noAISlopFindings(text)
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.rule);
}
