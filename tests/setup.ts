import * as os from 'node:os';
import * as path from 'node:path';

if (!process.env.CRATEMIND_DB_PATH) {
  process.env.CRATEMIND_DB_PATH = path.join(
    os.tmpdir(),
    `cratemind-vitest-default-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}
