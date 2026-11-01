import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import { DomainError } from '../domain-error.js';
import type { PlayerService } from './player-service.js';
import type { PresenceService } from './presence-service.js';
import type { MovementState } from '../../shared/protocol.js';
import type { Wallet } from '../../shared/types.js';
import {
  CIVIC_FINE_LRD, CIVIC_REPORT_RADIUS, CIVIC_REPORT_SITES, getCivicReportSite, safetyZoneAt, validateCivicCatalog,
  type CivicIncident, type CivicMutationResult, type CivicState, type PlayerSafetyState, type SafetyViolation,
} from '../../shared/civic.js';

interface CivicIncidentRow {
  id: string;
  site_id: string;
  template_id: string;
  kind: CivicIncident['kind'];
  title: string;
  detail: string;
  location_id: string;
  x: number;
  z: number;
  status: CivicIncident['status'];
  reporter_id: string | null;
  assigned_task_id: string | null;
  created_at: string;
  resolved_at: string | null;
  reported_by?: string | null;
}

interface SafetyRow {
  id: string;
  zone_id: string;
  zone_name: string;
  speed_kmh: number;
  limit_kmh: number;
  amount_lrd: number;
  outcome: 'warning' | 'fine';
  created_at: string;
}

interface MovementSample { x: number; z: number; at: number }

export class CivicService {
  private readonly incidentListeners = new Set<() => void>();
  private readonly movement = new Map<string, MovementSample[]>();

  constructor(
    private readonly database: Database,
    private readonly players: PlayerService,
    private readonly presence: Pick<PresenceService, 'recent'>,
    private readonly now: () => number = Date.now,
  ) {}

  bootstrap() {
    const issues = validateCivicCatalog();
    if (issues.length) throw new Error(`Invalid civic catalog: ${issues.join('; ')}`);
    const now = new Date(this.now()).toISOString();
    this.database.transaction(() => {
      for (const site of CIVIC_REPORT_SITES) {
        if (!site.initialIncidentId) continue;
        this.database.connection.prepare(`INSERT OR IGNORE INTO civic_incidents
          (id, site_id, template_id, kind, title, detail, location_id, x, z, status, reporter_id, assigned_task_id, created_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, NULL)`)
          .run(site.initialIncidentId, site.id, site.templateId, site.kind, site.title, site.detail, site.locationId, site.x, site.z, now);
      }
    });
  }

  onIncidents(listener: () => void) {
    this.incidentListeners.add(listener);
    return () => this.incidentListeners.delete(listener);
  }

  publish() {
    for (const listener of this.incidentListeners) listener();
  }

  incidents(): CivicIncident[] {
    const rows = this.database.connection.prepare(`SELECT i.*, p.display_name AS reported_by FROM civic_incidents i
      LEFT JOIN player_profiles p ON p.user_id = i.reporter_id
      ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, i.created_at DESC LIMIT 60`).all() as unknown as CivicIncidentRow[];
    return rows.map((row) => this.mapIncident(row));
  }

  state(userId: string): CivicState {
    return { incidents: this.incidents(), safety: this.safety(userId) };
  }

  report(userId: string, siteId: string, requestId: string): CivicMutationResult {
    const site = getCivicReportSite(siteId);
    if (!site) throw new DomainError(404, 'Civic report site not found.', 'civic_site_not_found');
    let duplicate = false;
    this.database.transaction(() => {
      if (this.replay(requestId, userId, 'civic.report', siteId)) { duplicate = true; return; }
      this.validateReportPresence(userId, site);
      const existing = this.database.connection.prepare("SELECT id FROM civic_incidents WHERE site_id = ? AND status IN ('open', 'assigned')").get(siteId);
      if (existing) throw new DomainError(409, 'This issue already has an open civic response.', 'civic_incident_open');
      const latest = this.database.connection.prepare('SELECT created_at FROM civic_incidents WHERE site_id = ? ORDER BY created_at DESC LIMIT 1').get(siteId) as { created_at: string } | undefined;
      if (latest && this.now() - Date.parse(latest.created_at) < 30_000) {
        throw new DomainError(409, 'This site was reported recently. Allow the municipal log to update first.', 'civic_report_cooldown');
      }
      const now = new Date(this.now()).toISOString();
      const incidentId = randomUUID();
      this.database.connection.prepare(`INSERT INTO civic_incidents
        (id, site_id, template_id, kind, title, detail, location_id, x, z, status, reporter_id, assigned_task_id, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, NULL)`)
        .run(incidentId, site.id, site.templateId, site.kind, site.title, site.detail, site.locationId, site.x, site.z, userId, now);
      this.database.connection.prepare('INSERT INTO civic_requests (request_id, user_id, kind, target, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(requestId, userId, 'civic.report', siteId, now);
      this.database.audit(userId, 'civic_incident.reported', { incidentId, siteId, requestId });
    });
    if (!duplicate) this.publish();
    return { ...this.state(userId), duplicate };
  }

  safety(userId: string): PlayerSafetyState {
    const rows = this.database.connection.prepare('SELECT * FROM safety_violations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId) as unknown as SafetyRow[];
    const totals = this.database.connection.prepare(`SELECT
      COALESCE(SUM(CASE WHEN outcome = 'warning' THEN 1 ELSE 0 END), 0) AS warnings,
      COALESCE(SUM(CASE WHEN outcome = 'fine' THEN amount_lrd ELSE 0 END), 0) AS fines_lrd
      FROM safety_violations WHERE user_id = ?`).get(userId) as { warnings: number; fines_lrd: number };
    return {
      warnings: Number(totals.warnings), finesLrd: Number(totals.fines_lrd),
      violations: rows.map((row) => this.mapViolation(row)),
    };
  }

  observeMovement(userId: string, state: MovementState): { safety: PlayerSafetyState; wallet: Wallet; notice: string } | null {
    if (state.mode !== 'driving' || state.interiorPropertyId) {
      this.movement.delete(userId);
      return null;
    }
    const sample = { x: state.position[0], z: state.position[2], at: state.sentAt };
    const samples = [...(this.movement.get(userId) ?? []), sample].filter((entry) => sample.at - entry.at <= 4000);
    this.movement.set(userId, samples);
    const first = samples[0];
    if (!first || samples.length < 3) return null;
    const elapsed = (sample.at - first.at) / 1000;
    if (elapsed < 1.2) return null;
    const zone = safetyZoneAt(sample);
    const originZone = safetyZoneAt(first);
    if (!zone || originZone?.id !== zone.id) return null;
    const distance = Math.hypot(sample.x - first.x, sample.z - first.z);
    const speedKmh = distance / elapsed * 3.6;
    if (distance < 4 || speedKmh <= zone.speedLimitKmh + 2) return null;
    this.movement.set(userId, []);
    return this.recordViolation(userId, zone.id, zone.name, speedKmh, zone.speedLimitKmh);
  }

  leave(userId: string) {
    this.movement.delete(userId);
  }

  private recordViolation(userId: string, zoneId: string, zoneName: string, speedKmh: number, limitKmh: number) {
    const now = this.now();
    let recorded: { outcome: 'warning' | 'fine'; amount: number } | null = null;
    this.database.transaction(() => {
      const previous = this.database.connection.prepare('SELECT outcome, created_at FROM safety_violations WHERE user_id = ? AND zone_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(userId, zoneId) as { outcome: 'warning' | 'fine'; created_at: string } | undefined;
      if (previous && now - Date.parse(previous.created_at) < 45_000) return;
      const balance = this.players.wallet(userId).balanceLrd;
      const fine = Boolean(previous) && balance >= CIVIC_FINE_LRD;
      recorded = { outcome: fine ? 'fine' : 'warning', amount: fine ? CIVIC_FINE_LRD : 0 };
      const id = randomUUID();
      const createdAt = new Date(now).toISOString();
      this.database.connection.prepare(`INSERT INTO safety_violations
        (id, user_id, zone_id, zone_name, speed_kmh, limit_kmh, amount_lrd, outcome, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, zoneId, zoneName, Math.round(speedKmh), limitKmh, recorded.amount, recorded.outcome, createdAt);
      if (fine) {
        const changed = this.database.connection.prepare('UPDATE player_wallets SET balance_lrd = balance_lrd - ?, updated_at = ? WHERE user_id = ? AND balance_lrd >= ?')
          .run(CIVIC_FINE_LRD, createdAt, userId, CIVIC_FINE_LRD);
        if (changed.changes !== 1) throw new DomainError(409, 'Safety fine could not be recorded without an invalid balance.', 'safety_fine_balance');
        const updated = this.players.wallet(userId).balanceLrd;
        this.database.connection.prepare(`INSERT INTO ledger_transactions
          (id, user_id, amount_lrd, balance_after_lrd, kind, reference, description, created_at)
          VALUES (?, ?, ?, ?, 'civic_fine', ?, ?, ?)`)
          .run(randomUUID(), userId, -CIVIC_FINE_LRD, updated, `civic-fine:${id}`, `${zoneName} · Road-safety fine`, createdAt);
      }
      this.database.audit(userId, `safety.${recorded.outcome}`, { id, zoneId, speedKmh: Math.round(speedKmh), limitKmh, amountLrd: recorded.amount });
    });
    if (!recorded) return null;
    const outcome = recorded as { outcome: 'warning' | 'fine'; amount: number };
    const roundedSpeed = Math.round(speedKmh);
    const notice = outcome.outcome === 'fine'
      ? `${zoneName}: ${roundedSpeed} km/h in a ${limitKmh} km/h safety zone. L$${CIVIC_FINE_LRD} fine recorded.`
      : `${zoneName}: ${roundedSpeed} km/h in a ${limitKmh} km/h safety zone. Slow down; repeated violations may be fined.`;
    return { safety: this.safety(userId), wallet: this.players.wallet(userId), notice };
  }

  private validateReportPresence(userId: string, site: { x: number; z: number }) {
    const state = this.presence.recent(userId);
    if (!state) throw new DomainError(409, 'Enter the district and walk to the issue before reporting it.', 'position_stale');
    if (state.mode !== 'walking' || state.interiorPropertyId) throw new DomainError(409, 'Civic reports must be made outside and on foot.', 'on_foot_required');
    if (Math.abs(state.speed) > 3.5) throw new DomainError(409, 'Stop moving before filing a civic report.', 'report_moving');
    if (Math.hypot(state.position[0] - site.x, state.position[2] - site.z) > CIVIC_REPORT_RADIUS) {
      throw new DomainError(409, 'Walk to the civic issue before reporting it.', 'wrong_location');
    }
  }

  private replay(requestId: string, userId: string, kind: string, target: string) {
    const previous = this.database.connection.prepare('SELECT user_id, kind, target FROM civic_requests WHERE request_id = ?').get(requestId) as { user_id: string; kind: string; target: string } | undefined;
    if (!previous) return false;
    if (previous.user_id !== userId || previous.kind !== kind || previous.target !== target) {
      throw new DomainError(409, 'That request identifier was already used for another civic operation.', 'request_reused');
    }
    return true;
  }

  private mapIncident(row: CivicIncidentRow): CivicIncident {
    return {
      id: row.id, siteId: row.site_id, templateId: row.template_id, kind: row.kind,
      departmentId: CIVIC_REPORT_SITES.find((site) => site.id === row.site_id)?.departmentId ?? 'public-works',
      title: row.title, detail: row.detail, locationId: row.location_id, x: Number(row.x), z: Number(row.z),
      status: row.status, reportedBy: row.reported_by ?? 'Municipal patrol', createdAt: row.created_at, resolvedAt: row.resolved_at,
    };
  }

  private mapViolation(row: SafetyRow): SafetyViolation {
    return {
      id: row.id, zoneId: row.zone_id, zoneName: row.zone_name, speedKmh: Number(row.speed_kmh), limitKmh: Number(row.limit_kmh),
      amountLrd: Number(row.amount_lrd), outcome: row.outcome, createdAt: row.created_at,
    };
  }
}
