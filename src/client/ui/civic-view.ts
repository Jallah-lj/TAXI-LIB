import {
  CIVIC_DEPARTMENTS, CIVIC_FINE_LRD, CIVIC_NOTICES, CIVIC_REPORT_RADIUS, CIVIC_REPORT_SITES, CIVIC_SERVICE_POINTS, CIVIC_WORKERS, SAFETY_ZONES,
  type CivicDepartmentId, type CivicIncident, type CivicSection,
} from '../../shared/civic';
import { CITIZEN_TASKS, getCitizenTaskDefinition } from '../../shared/tasks';
import { distance2D, getLocation, type Point2 } from '../../shared/world';
import { formatLrd } from '../../shared/simulation';
import type { TaxiTrip, WorldBootstrap } from '../../shared/types';
import { escapeHtml } from './html';

export interface CivicViewModel {
  world: WorldBootstrap;
  activeTrip: TaxiTrip | null;
  section: CivicSection;
  selectedDepartmentId?: CivicDepartmentId;
  selectedIncidentId?: string;
  selectedSiteId?: string;
  busy: boolean;
  error: string;
  position: Point2 | null;
  onFoot: boolean;
}

export function renderCivicView(model: CivicViewModel) {
  const open = model.world.civic.incidents.filter((incident) => incident.status === 'open').length;
  return `<div class="phone-section-heading"><div><p class="panel-kicker">FICTIONAL MUNICIPAL GOVERNMENT</p><h3>Sinkor Civic Services</h3></div><span class="secure-badge">CITIZEN OS</span></div>
    <p class="section-description">Public works, sanitation, market standards and community safety connected to real district activity.</p>
    <div class="phone-account-strip"><span>OPEN ISSUES <strong>${open}</strong></span><span>SAFETY FINES <strong>${formatLrd(model.world.civic.safety.finesLrd)}</strong></span></div>
    <div class="civic-section-tabs" role="tablist" aria-label="Civic sections">${(['services', 'incidents', 'safety'] as const).map((section) => `<button role="tab" aria-selected="${model.section === section}" class="${model.section === section ? 'active' : ''}" data-civic-section="${section}">${section === 'services' ? 'Services' : section === 'incidents' ? 'Incidents' : 'Safety'}</button>`).join('')}</div>
    ${model.error ? `<div class="phone-inline-error" role="alert">${escapeHtml(model.error)}</div>` : ''}
    <section class="civic-view" aria-busy="${model.busy}">${model.section === 'services' ? renderServices(model) : model.section === 'incidents' ? renderIncidents(model) : renderSafety(model)}</section>
    <p class="fine-print">Fictional institutions and game rules only. Ambient workers use deterministic routines; reports, assignments, rewards and fines are server-authoritative.</p>`;
}

function renderServices(model: CivicViewModel) {
  const departments = model.selectedDepartmentId
    ? [...CIVIC_DEPARTMENTS].sort((a, b) => Number(b.id === model.selectedDepartmentId) - Number(a.id === model.selectedDepartmentId))
    : CIVIC_DEPARTMENTS;
  const contracts = CITIZEN_TASKS.filter((task) => task.departmentId && !task.incidentKind);
  return `<div class="civic-notice-list">${CIVIC_NOTICES.map((notice) => `<article class="civic-notice"><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.body)}</p></article>`).join('')}</div>
    <div class="phone-home-section-title"><span>DEPARTMENTS</span><small>Service counters & working GPS</small></div>
    <div class="civic-department-list">${departments.map((department) => {
      const workers = CIVIC_WORKERS.filter((worker) => worker.departmentId === department.id);
      const location = getLocation(department.locationId);
      return `<article class="civic-department"><div class="civic-card-heading"><div><small>${escapeHtml(department.serviceHours)}</small><h4>${escapeHtml(department.name)}</h4></div><span>${escapeHtml(location.shortName)}</span></div><p>${escapeHtml(department.description)}</p><div class="civic-worker-list">${workers.map((worker) => `<span><strong>${escapeHtml(worker.role)}</strong><small>${escapeHtml(worker.name)} · ${formatShift(worker.shiftStart, worker.shiftEnd)}</small></span>`).join('')}</div><button class="secondary-button" data-civic-waypoint="${department.id}" data-location="${location.id}" data-x="${location.x}" data-z="${location.z}" data-label="${escapeHtml(location.name)}">Directions to ${escapeHtml(location.shortName)}</button></article>`;
    }).join('')}</div>
    <div class="phone-home-section-title"><span>MUNICIPAL CONTRACTS</span><small>Existing authoritative citizen work</small></div>
    ${model.activeTrip ? '<div class="notice">Finish or cancel your active passenger trip before accepting municipal work.</div>' : ''}
    ${model.world.activeTask ? '<div class="notice">Finish or cancel your active citizen task before accepting another contract.</div>' : ''}
    <div class="phone-task-catalog">${contracts.map((task) => `<article class="phone-task-card"><div class="phone-task-heading"><div><small>${escapeHtml(task.category)}</small><h4>${escapeHtml(task.title)}</h4></div><strong>${formatLrd(task.rewardLrd)}</strong></div><p>${escapeHtml(task.description)}</p><div class="phone-task-meta"><span>${task.steps.length} on-foot objectives</span><span>${escapeHtml(CIVIC_DEPARTMENTS.find((department) => department.id === task.departmentId)?.shortName ?? 'Municipal work')}</span></div><button class="primary-button" data-accept-task="${task.id}" ${model.busy || model.activeTrip || model.world.activeTask ? 'disabled' : ''}>Accept municipal contract</button></article>`).join('')}</div>`;
}

function renderIncidents(model: CivicViewModel) {
  const incidents = [...model.world.civic.incidents].sort((a, b) => {
    if (a.id === model.selectedIncidentId) return -1;
    if (b.id === model.selectedIncidentId) return 1;
    return a.status === b.status ? 0 : a.status === 'resolved' ? 1 : -1;
  });
  const activeSites = new Set(incidents.filter((incident) => incident.status !== 'resolved').map((incident) => incident.siteId));
  const reportSites = model.selectedSiteId
    ? [...CIVIC_REPORT_SITES].sort((a, b) => Number(b.id === model.selectedSiteId) - Number(a.id === model.selectedSiteId))
    : CIVIC_REPORT_SITES;
  return `<div class="phone-home-section-title"><span>SHARED DISTRICT LOG</span><small>${incidents.filter((incident) => incident.status !== 'resolved').length} active responses</small></div>
    <div class="civic-incident-list">${incidents.map((incident) => renderIncident(model, incident)).join('') || '<p class="empty-state">No civic incidents are recorded.</p>'}</div>
    <div class="phone-home-section-title"><span>REPORT AN ISSUE</span><small>Walk to a marked site · on foot</small></div>
    <div class="civic-report-list">${reportSites.map((site) => {
      const active = activeSites.has(site.id);
      const distance = model.position ? distance2D(model.position, site) : null;
      const nearby = model.onFoot && distance !== null && distance <= CIVIC_REPORT_RADIUS;
      const definition = getCitizenTaskDefinition(site.templateId);
      return `<article class="civic-report-site ${active ? 'logged' : ''}"><div class="civic-card-heading"><div><small>${escapeHtml(site.kind.replace('-', ' ').toUpperCase())}</small><h4>${escapeHtml(site.title)}</h4></div><span>${distance === null ? escapeHtml(getLocation(site.locationId).shortName) : `${Math.round(distance)} m`}</span></div><p>${escapeHtml(site.detail)}</p><div class="phone-task-meta"><span>Response · ${formatLrd(definition.rewardLrd)}</span><span>${active ? 'Already logged' : `Within ${CIVIC_REPORT_RADIUS} m to report`}</span></div><div class="civic-card-actions"><button class="secondary-button" data-civic-waypoint="${site.id}" data-location="${site.locationId}" data-x="${site.x}" data-z="${site.z}" data-label="${escapeHtml(site.title)}">Exact directions</button><button class="primary-button" data-report-site="${site.id}" ${active || model.busy || !nearby ? 'disabled' : ''}>${active ? 'Response already open' : nearby ? 'Report this issue' : model.onFoot ? 'Walk to site to report' : 'Exit vehicle to report'}</button></div></article>`;
    }).join('')}</div>`;
}

function renderIncident(model: CivicViewModel, incident: CivicIncident) {
  const definition = getCitizenTaskDefinition(incident.templateId);
  const mine = model.world.activeTask?.incidentId === incident.id;
  const blocked = model.busy || Boolean(model.activeTrip) || Boolean(model.world.activeTask);
  const status = incident.status === 'open' ? 'OPEN' : incident.status === 'assigned' ? 'CREW ASSIGNED' : 'RESOLVED';
  return `<article class="civic-incident ${incident.status}"><div class="civic-card-heading"><div><small>${status} · ${escapeHtml(incident.kind.replace('-', ' ').toUpperCase())}</small><h4>${escapeHtml(incident.title)}</h4></div><strong>${incident.status === 'resolved' ? '✓' : formatLrd(definition.rewardLrd)}</strong></div><p>${escapeHtml(incident.detail)}</p><div class="phone-task-meta"><span>${escapeHtml(getLocation(incident.locationId).name)}</span><span>Reported by ${escapeHtml(incident.reportedBy)}</span></div><div class="civic-card-actions">${incident.status !== 'resolved' ? `<button class="secondary-button" data-civic-waypoint="${incident.id}" data-location="${incident.locationId}" data-x="${incident.x}" data-z="${incident.z}" data-label="${escapeHtml(incident.title)}">Exact directions</button>` : ''}${incident.status === 'open' ? `<button class="primary-button" data-accept-civic-task="${incident.id}" data-template="${incident.templateId}" ${blocked ? 'disabled' : ''}>Accept work · ${formatLrd(definition.rewardLrd)}</button>` : incident.status === 'assigned' ? `<button class="primary-button" ${mine ? 'data-close-panels' : 'disabled'}>${mine ? 'Return to your work order' : 'Response crew assigned'}</button>` : '<span class="civic-resolved-label">Condition resolved</span>'}</div></article>`;
}

function renderSafety(model: CivicViewModel) {
  const safety = model.world.civic.safety;
  const office = CIVIC_SERVICE_POINTS.find((point) => point.departmentId === 'community-safety')!;
  return `<article class="civic-safety-summary"><small>DISTRICT SAFETY OFFICE</small><h4>Visible patrols. Clear rules. Nonviolent enforcement.</h4><p>Community police and traffic wardens patrol the district. They do not charge players through animations or client requests.</p><button class="secondary-button" data-civic-waypoint="safety-office" data-location="${office.locationId}" data-x="${office.x}" data-z="${office.z}" data-label="District Safety Office">Directions to Safety Office</button></article>
    <div class="phone-home-section-title"><span>MARKED SAFETY ZONES</span><small>Warning before a fine</small></div>
    <div class="civic-zone-list">${SAFETY_ZONES.map((zone) => `<article class="civic-zone"><strong>${escapeHtml(zone.name)}</strong><b>${zone.speedLimitKmh} km/h</b><p>Server-accepted movement is measured over time above the posted limit. A first violation produces a warning; a repeated violation after the cooldown may produce an ${formatLrd(CIVIC_FINE_LRD)} fine.</p></article>`).join('')}</div>
    <div class="phone-account-strip"><span>WARNINGS <strong>${safety.warnings}</strong></span><span>TOTAL FINES <strong>${formatLrd(safety.finesLrd)}</strong></span></div>
    <div class="phone-home-section-title"><span>YOUR SAFETY RECORD</span><small>Authoritative account history</small></div>
    <div class="civic-violation-list">${safety.violations.map((violation) => `<article class="civic-violation ${violation.outcome}"><div><strong>${escapeHtml(violation.zoneName)}</strong><small>${violation.speedKmh} km/h in a ${violation.limitKmh} km/h zone · ${formatDate(violation.createdAt)}</small></div><span>${violation.outcome === 'fine' ? `−${formatLrd(violation.amountLrd)}` : 'WARNING'}</span></article>`).join('') || '<p class="empty-state">No safety warnings or fines are recorded for this citizen.</p>'}</div>`;
}

function formatShift(start: number, end: number) {
  const hour = (value: number) => `${String(Math.floor(value)).padStart(2, '0')}:${value % 1 ? '30' : '00'}`;
  return `${hour(start)}–${hour(end)}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
