#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const port = process.env.PORT || 3000;
  const withSeed = process.env.ONECLICK_SEED === 'true' || process.argv.includes('--seed');
  console.log('=== QuantGem Backend One-Click Starter ===');
  console.log('PORT =', port);
  console.log('Seed sample data =', withSeed);

  // Step 1: patch schema
  console.log('\n[1/3] Patching database schema ...');
  try {
    const { run: patchRun } = require('./patchSchema');
    await patchRun();
  } catch (e) {
    console.error('Schema patch failed (will continue):', e.message || e);
  }

  // Step 2: optional seed
  if (withSeed) {
    console.log('\n[2/3] Seeding sample data ...');
    try {
      const { initDatabase } = require('./initDatabase');
      await initDatabase();
    } catch (e) {
      console.error('Seeding failed (will continue):', e.message || e);
    }
  } else {
    console.log('\n[2/3] Skipping seed (pass --seed or set ONECLICK_SEED=true to enable)');
  }

  // Step 3: start dev server with nodemon
  console.log('\n[3/3] Starting dev server (nodemon) ...');
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });

  // Optionally open the browser after server is up
  let opened = false;
  const tryOpen = async () => {
    if (!opened) {
      opened = true;
      const url = `http://localhost:${port}/`;
      // macOS 'open' command; on other OS, print the URL
      if (process.platform === 'darwin') {
        const opener = spawn('open', [url], { stdio: 'ignore', detached: true });
        opener.unref();
        console.log('Opened:', url);
      } else {
        console.log('Please open:', url);
      }
    }
  };

  // naive delay to give server time to boot
  setTimeout(tryOpen, 2000);

  child.on('exit', (code) => {
    console.log(`Dev server exited with code ${code}`);
    process.exit(code || 0);
  });
}

main().catch((e) => {
  console.error('One-click starter failed:', e);
  process.exit(1);
});
