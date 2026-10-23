// What Studio learns by running the project's own commands: Doctor
// (php flo doctor, php flo admin:doctor) and the database (migrate:status,
// db:show, admin:list). Loaded when a project opens and after changes.

import { api, toError, type CommandOutput, type ProjectInfo } from './api.ts';
import {
  adminUrls,
  errorMessage,
  parseAdminDoctor,
  parseDbShow,
  parseDoctor,
  parseMigrateStatus,
  type AdminReport,
  type DbShow,
  type DoctorReport,
  type Migration,
} from './flo-output.ts';
import { changed } from './state.ts';

export interface Checks {
  doctorLoading: boolean;
  doctor: DoctorReport | null;
  doctorOutput: CommandOutput | null;
  admin: AdminReport | null;
  adminOutput: CommandOutput | null;
  doctorAt: number | null;

  databaseLoading: boolean;
  migrations: Migration[] | null;
  migrationsOutput: CommandOutput | null;
  db: DbShow | null;
  /** The command's message when the database could not be read */
  databaseError: string | null;
  /** Admin URL per table (admin:list) */
  adminUrls: Record<string, string>;
  databaseAt: number | null;
}

const all: Record<string, Checks> = {};

export function checksFor(path: string): Checks {
  return (all[path] ??= {
    doctorLoading: false,
    doctor: null,
    doctorOutput: null,
    admin: null,
    adminOutput: null,
    doctorAt: null,
    databaseLoading: false,
    migrations: null,
    migrationsOutput: null,
    db: null,
    databaseError: null,
    adminUrls: {},
    databaseAt: null,
  });
}

/** A version number that changes whenever the checks of a project change. */
let version = 0;
export function checksVersion(): number {
  return version;
}
function touch(): void {
  version++;
  changed();
}

async function capture(path: string, args: string[]): Promise<CommandOutput> {
  try {
    return await api.floCapture(path, args);
  } catch (error) {
    const e = toError(error);
    return { code: null, stdout: '', stderr: e.detail || e.code, command: 'php flo ' + args.join(' ') };
  }
}

export async function runDoctor(info: ProjectInfo): Promise<void> {
  const c = checksFor(info.path);
  if (c.doctorLoading) return;
  if (!info.hasVendor) {
    c.doctorAt = Date.now();
    return;
  }
  c.doctorLoading = true;
  touch();
  const [doctor, admin] = await Promise.all([
    capture(info.path, ['doctor', '--format=json']),
    info.hasAdmin ? capture(info.path, ['admin:doctor']) : Promise.resolve(null),
  ]);
  c.doctorOutput = doctor;
  c.doctor = parseDoctor(doctor.stdout);
  c.adminOutput = admin;
  c.admin = admin ? parseAdminDoctor(admin.stdout, admin.stderr) : null;
  c.doctorAt = Date.now();
  c.doctorLoading = false;
  touch();
}

export async function loadDatabase(info: ProjectInfo): Promise<void> {
  const c = checksFor(info.path);
  if (c.databaseLoading) return;
  if (!info.hasVendor) {
    c.databaseAt = Date.now();
    return;
  }
  if (!info.database.configured) {
    c.migrations = null;
    c.db = null;
    c.databaseError = null;
    c.databaseAt = Date.now();
    touch();
    return;
  }
  c.databaseLoading = true;
  touch();
  const [status, show, list] = await Promise.all([
    capture(info.path, ['migrate:status']),
    capture(info.path, ['db:show', '--format=json']),
    info.hasAdmin ? capture(info.path, ['admin:list']) : Promise.resolve(null),
  ]);
  c.migrationsOutput = status;
  c.migrations = status.code === 0 ? parseMigrateStatus(status.stdout) : null;
  c.db = show.code === 0 ? parseDbShow(show.stdout) : null;
  c.databaseError = status.code === 0 ? null : errorMessage(status.stderr) ?? (status.stderr.trim() || status.stdout.trim() || null);
  c.adminUrls = list && list.code === 0 ? adminUrls(list.stdout) : {};
  c.databaseLoading = false;
  c.databaseAt = Date.now();
  touch();
}

/** Both, when a project opens (only once until something changes). */
export function loadChecks(info: ProjectInfo, force = false): void {
  const c = checksFor(info.path);
  if (force || (!c.doctorAt && !c.doctorLoading)) void runDoctor(info);
  if (force || (!c.databaseAt && !c.databaseLoading)) void loadDatabase(info);
}

export function pendingCount(c: Checks): number {
  return c.migrations?.filter((m) => m.state === 'pending').length ?? 0;
}
