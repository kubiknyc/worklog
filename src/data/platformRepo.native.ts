/**
 * Native repository factory — opens the device database and returns the
 * SQLite-backed repository (M1, read-only). Native-only; the explicit
 * `openDb` import here is safe because this file is never in the web
 * bundle's graph. No sync engine yet — that lands once the repository grows
 * write methods in a later milestone.
 */
import { openDb } from '../db/open.native';
import { createSqliteRepo } from './sqliteRepo.native';
import type { Repository } from './types';

export async function createPlatformRepository(): Promise<Repository> {
  const db = await openDb();
  return createSqliteRepo(db);
}
