import type { Session } from '../types';

// One sidebar/chart entry: either a lone stall or a whole event-day group.
export interface SessionCluster {
  key: string;
  // Group metadata when 2+ stalls share a group; null renders as a plain stall.
  group: { id: string; name: string; date: string } | null;
  sessions: Session[];
}

export const revenueOf = (s: Session): number => {
  const raw = s.stats?.total_revenue ?? s.total_revenue ?? 0;
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? n : 0;
};

// Collapse a session list into clusters, preserving the input order (first
// member seen anchors the group's position). Groups left with a single
// member degrade gracefully to a plain stall entry.
export function clusterSessions(sessions: Session[]): SessionCluster[] {
  const clusters: SessionCluster[] = [];
  const byGroup = new Map<string, SessionCluster>();

  for (const s of sessions) {
    if (!s.group_id) {
      clusters.push({ key: s.id, group: null, sessions: [s] });
      continue;
    }
    const existing = byGroup.get(s.group_id);
    if (existing) {
      existing.sessions.push(s);
      continue;
    }
    const cluster: SessionCluster = {
      key: `group:${s.group_id}`,
      group: {
        id: s.group_id,
        name: s.group_name || s.name,
        date: s.group_date || s.date,
      },
      sessions: [s],
    };
    byGroup.set(s.group_id, cluster);
    clusters.push(cluster);
  }

  // A "group" of one is just a stall — drop the group chrome.
  for (const c of clusters) {
    if (c.group && c.sessions.length < 2) c.group = null;
  }
  return clusters;
}

// Per the grouping rules: a grouped day is compared by the AVERAGE of its
// stalls' totals so a two-stall day doesn't dwarf single-stall days.
export const clusterRevenue = (c: SessionCluster): number =>
  c.sessions.reduce((acc, s) => acc + revenueOf(s), 0) /
  (c.sessions.length || 1);

export const clusterTotalRevenue = (c: SessionCluster): number =>
  c.sessions.reduce((acc, s) => acc + revenueOf(s), 0);
