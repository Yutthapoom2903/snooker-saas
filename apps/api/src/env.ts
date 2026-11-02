import { existsSync } from 'fs';
import { join } from 'path';

// Must be the first import in main.ts: decorators read process.env at import time.
const file = join(process.cwd(), '.env');
if (existsSync(file)) process.loadEnvFile(file);
