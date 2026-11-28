import { createHash, timingSafeEqual } from 'node:crypto';
import { analyzeScreenshot } from '../server/draw-review.js';

const digest = value => createHash('sha256').update(value).digest();
let active = 0, starts = [];
const reply = (res,status,value) => res.status(status).json(value);
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method !== 'POST') return reply(res,405,{error:'Method not allowed'});
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  const access = process.env.FLOW_DRAW_ACCESS_KEY?.trim();
  if (!apiKey || !access || access.length < 24) return reply(res,503,{error:'Configure TYPESAFE_API_KEY and FLOW_DRAW_ACCESS_KEY (24+ characters) on the server.'});
  const supplied = req.headers['x-flow-draw-key'];
  if (typeof supplied !== 'string' || supplied.length > 512 || !timingSafeEqual(digest(supplied),digest(access))) return reply(res,401,{error:'Invalid private Draw access key.'});
  let admitted = false;
  try {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) return reply(res,403,{error:'Invalid origin'});
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.image !== 'string' || body.image.length > 2_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image) || typeof body.intent !== 'string' || body.intent.length > 1500)
      return reply(res,400,{error:'Invalid screenshot review request'});
    const bytes = Buffer.from(body.image,'base64');
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return reply(res,400,{error:'Expected a JPEG screenshot'});
    const now=Date.now(); starts=starts.filter(time=>now-time<60000);
    if(active>=4 || starts.length>=30) { res.setHeader('Retry-After','60'); return reply(res,429,{error:'Review busy; retry shortly.'}); }
    active++; starts.push(now); admitted=true;
    const controller = new AbortController();
    const abort=()=>controller.abort();
    const timer=setTimeout(abort,35000);
    res.on('close',abort);
    try {
      const findings=await analyzeScreenshot(body.image,body.intent,apiKey,controller.signal);
      return reply(res,200,{findings});
    } finally { clearTimeout(timer); res.off('close',abort); }
  } catch (cause) {
    const status=cause?.providerStatus;
    return reply(res,status===429?429:502,{error:status===401||status===403?'TypeSafe rejected the server API key.':status===429?'Jev rate limit reached.':'Jev review failed; existing annotations were preserved.'});
  } finally { if(admitted)active--; }
}
