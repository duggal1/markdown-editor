import { randomUUID } from 'node:crypto';

const issues = {
  clipping: 'Unintentional clipped, truncated, cut-off or overflowing content',
  overlap: 'Unintentional overlapping UI elements or obscured content',
  alignment: 'Clearly inconsistent alignment or spacing within otherwise repeated UI elements',
  contrast: 'Visibly unreadable foreground/background contrast, not an intentional muted label',
  error: 'Visible error message, broken image, failed request or visibly broken application state',
  intent: 'A specific visible defect explicitly described in the user review intent',
};
export function reviewRequest(data, intent) {
  const ref = randomUUID();
  const questions = {};
  for (const [id, issue] of Object.entries(issues)) {
    const target = id === 'intent' ? issue + '. If the intent has no specific defect, answer no.' : issue;
    questions[id + '_present'] = { type: 'noul', instructions: 'In the screenshot, is there an unmistakable instance of: ' + target + '? Respect the review intent; if it names specific defects, only consider those defects. Do not infer hidden backend failures or subjective taste.' };
    questions[id + '_box'] = { type: 'box', instructions: 'Locate the smallest screenshot region containing the most obvious instance of: ' + target + '. Respect the review intent; if it names specific defects, only consider those defects.' };
  }
  return { model: 'jev-1.14.0', state: { screenshot: ref, review_intent: intent },
    assets: { [ref]: { type: 'image', format: 'jpg', data_base64: data } }, questions };
}
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function overlap(a,b) {
  const area = x => (x.right-x.left)*(x.bottom-x.top);
  const intersection = Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  return intersection / Math.min(area(a),area(b));
}
export function extractFindings(answers) {
  if (!answers || typeof answers !== 'object') throw Error('Invalid Jev response');
  const candidates = [];
  for (const [id, issue] of Object.entries(issues)) {
    const present = answers[id + '_present'], located = answers[id + '_box'];
    if (!present || present.type !== 'noul' || !unit(present.noul) || !located || located.type !== 'box')
      throw Error('Incomplete Jev response');
    const { box, confidence } = located;
    if (present.noul < .82 || !unit(confidence) || confidence < .55 || !box ||
      ![box.left,box.right,box.top,box.bottom].every(unit) || box.left >= box.right || box.top >= box.bottom ||
      (box.right-box.left)*(box.bottom-box.top) > .75) continue;
    candidates.push({ issue, probability: present.noul, confidence, box });
  }
  candidates.sort((a,b) => b.probability*b.confidence-a.probability*a.confidence);
  const kept = [];
  for (const finding of candidates) {
    if (kept.some(existing => overlap(existing.box,finding.box) > .55)) continue;
    kept.push(finding);
    if (kept.length === 5) break;
  }
  return kept;
}
export async function analyzeScreenshot(data,intent,apiKey,signal,fetcher=fetch) {
  const response = await fetcher('https://api.typesafe.ai/v1/systemone', {
    method:'POST', headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','TypeSafe-Danger-Zone-Images':'true'},
    body:JSON.stringify(reviewRequest(data,intent)),signal,
  });
  if (!response.ok) throw Object.assign(Error('Jev request failed'),{providerStatus:response.status});
  return extractFindings((await response.json()).answers);
}
