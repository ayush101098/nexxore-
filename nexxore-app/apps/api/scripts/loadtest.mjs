#!/usr/bin/env node
/**
 * Rate-limit load test (Prompt 03 acceptance): hammer /v1/stats and prove the
 * limiter returns 429 with a Retry-After header.
 *
 * Usage: API_URL=http://localhost:4000 node scripts/loadtest.mjs
 * (Start the API with a low limit to see it trip fast: RATE_LIMIT_MAX=60)
 */
import autocannon from 'autocannon';
import http from 'node:http';

const base = process.env.API_URL ?? 'http://localhost:4000';

const result = await autocannon({
  url: `${base}/v1/stats`,
  connections: 20,
  duration: 10,
});

const s429 = result.non2xx;
console.log(`requests: ${result.requests.total}, 2xx: ${result['2xx']}, non-2xx (429s): ${s429}`);

if (s429 === 0) {
  console.error('FAIL: limiter never tripped — raise duration or lower RATE_LIMIT_MAX.');
  process.exit(1);
}

// Confirm a tripped response carries Retry-After.
await new Promise((resolve, reject) => {
  const reqs = Array.from({ length: 100 }, () => null);
  let done = false;
  for (const _ of reqs) {
    http.get(`${base}/v1/stats`, (res) => {
      if (done) return res.resume();
      if (res.statusCode === 429) {
        done = true;
        const ra = res.headers['retry-after'];
        if (ra) {
          console.log(`PASS: 429 with Retry-After: ${ra}`);
          resolve();
        } else {
          reject(new Error('429 without Retry-After header'));
        }
      }
      res.resume();
    });
  }
  setTimeout(() => !done && reject(new Error('no 429 observed in follow-up burst')), 5000);
});
