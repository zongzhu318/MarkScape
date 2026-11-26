import { writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

if (process.platform === 'darwin' || process.platform === 'win32') {
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD']) {
    if (!process.env[key]) throw new Error(`Missing release environment secret: ${key}`);
  }
}
if (process.platform === 'darwin') {
  for (const key of ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
    if (!process.env[key]) throw new Error(`Missing macOS notarization secret: ${key}`);
  }
  const keyPath = path.join(process.env.RUNNER_TEMP, 'markscape-notary.p8');
  await writeFile(keyPath, Buffer.from(process.env.APPLE_API_KEY_BASE64, 'base64'), {
    mode: 0o600,
  });
  await appendFile(process.env.GITHUB_ENV, `APPLE_API_KEY=${keyPath}\n`);
}
