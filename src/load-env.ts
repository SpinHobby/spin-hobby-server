import { existsSync } from 'node:fs';

// Local runs read ./.env. Variables already set (Render, Docker, CI) always win, and a missing file is fine.
// Kept in its own module and imported first in main.ts so it runs before anything reads the environment.
if (existsSync('.env')) process.loadEnvFile('.env');
