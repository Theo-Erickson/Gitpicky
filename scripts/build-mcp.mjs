// Bundles the MCP server and its dependencies into one file, so installed
// copies of Gitpicky can run it with plain `node` (outside the app's archive).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/mcp/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/mcp/gitpicky-mcp.js',
  logLevel: 'info',
});
