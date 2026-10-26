import { homedir } from 'node:os';
import { join } from 'node:path';

/** Folder holding bridge.json. Override with GITPICKY_HOME (handy for tests). */
export const BRIDGE_DIR = process.env.GITPICKY_HOME ?? join(homedir(), '.gitpicky');
export const BRIDGE_FILE = join(BRIDGE_DIR, 'bridge.json');
