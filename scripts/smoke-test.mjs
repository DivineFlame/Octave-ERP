const baseUrl = process.env.SMOKE_BASE_URL || 'http://38.247.188.228:3002';

const checks = [
  ['web health', '/health'],
  ['api health', '/api/system/status']
];

for (const [name, path] of checks) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok && response.status !== 401) {
    throw new Error(`${name} failed with HTTP ${response.status}`);
  }
  console.log(`${name}: ${response.status}`);
}

console.log('Octave CRM smoke checks completed.');
