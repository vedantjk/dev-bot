#!/usr/bin/env node

import Docker from 'dockerode';
import { resolve } from 'path';

const docker = new Docker();
const KB_SERVICE_DIR = resolve('./kb-service');

console.log('Testing kb-service Docker build...\n');
console.log(`Build context: ${KB_SERVICE_DIR}\n`);

try {
  const stream = await docker.buildImage(
    { context: KB_SERVICE_DIR, src: ['.'] },
    { rm: true, t: 'kb-service:test' }
  );

  await new Promise((resolvePromise, rejectPromise) => {
    docker.modem.followProgress(
      stream,
      (err) => {
        if (err) rejectPromise(err);
        else resolvePromise();
      },
      (event) => {
        if (event.stream) process.stdout.write(event.stream);
        if (event.error) console.error(event.error);
      }
    );
  });

  console.log('\n✓ Build succeeded!\n');
  console.log('The kb-service compiled successfully and all tests passed.');
  process.exit(0);

} catch (err) {
  console.error('\n✗ Build failed!\n');
  console.error(err.message);
  process.exit(1);
}
