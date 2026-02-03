'use strict';

const { PerformanceAgent } = require('./performanceAgent');

const agent = new PerformanceAgent({ sharpeThreshold: 1.0 });

const benchmarkReturns = [0.01, -0.005, 0.012, 0.004, 0.008];

const strategies = [
  {
    name: 'Momentum on SOL',
    returns: [0.02, -0.01, 0.03, 0.005, 0.01],
    signals: [{ timestamp: '2026-01-26T10:00:00Z' }, { timestamp: '2026-01-27T10:00:00Z' }],
  },
  {
    name: 'Mean-rev on memes',
    returns: [0.005, -0.02, 0.004, -0.01, 0.002],
    signals: [{ timestamp: '2026-01-20T10:00:00Z' }],
  },
];

const performance = agent.evaluateStrategies(strategies, benchmarkReturns);
const feedback = agent.generateFeedback(performance);

console.log('// Strategy Performance');
performance.forEach((p) => {
  const verdict = p.sharpe >= 1.0 ? '✓ Increase allocation' : '✗ Reduce allocation';
  console.log(`${p.name} → Sharpe ${p.sharpe} ${verdict}`);
});

console.log('\n// Next Cycle Adjustments');
console.log(JSON.stringify(feedback, null, 2));
