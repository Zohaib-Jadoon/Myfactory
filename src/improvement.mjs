import { createHash } from 'node:crypto';

/** Compute measured execution effectiveness statistics from real SQLite records. */
export function analyzeFactoryEffectiveness({ projectDb, projectId = null }) {
  const tasks = projectDb.listTasks(projectId);
  const gates = projectId ? projectDb.listGateRuns(projectId, 100) : [];
  const routing = projectDb.listRoutingDecisions(projectId, 100);
  const metrics = projectDb.listContextMetrics(projectId, 100);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => ['completed', 'verified', 'approved'].includes(t.status)).length;
  const failedOrBlocked = tasks.filter(t => ['failed', 'blocked'].includes(t.status)).length;
  const highRetryTasks = tasks.filter(t => (t.attempts || 0) > 1);

  const singleAgentSuccess = [];
  const multiAgentFailures = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  for (const r of routing) {
    const t = r.task_id ? taskMap.get(r.task_id) : null;
    if (!t) continue;
    const fanout = 1 + (r.supporting_agents?.length || 0);
    if (fanout === 1 && ['completed', 'verified', 'approved'].includes(t.status)) singleAgentSuccess.push(r);
    if (fanout > 2 && ['failed', 'blocked'].includes(t.status)) multiAgentFailures.push(r);
  }

  const failedCheckCounts = new Map();
  for (const g of gates) {
    for (const c of g.results || []) {
      if (!c.ok) failedCheckCounts.set(c.name, (failedCheckCounts.get(c.name) || 0) + 1);
    }
  }

  const avgContextBytes = metrics.length
    ? Math.round(metrics.reduce((s, m) => s + (m.estimated_context_bytes || 0), 0) / metrics.length)
    : null;
  const avgBaselineBytes = metrics.filter(m => m.baseline_context_bytes != null).length
    ? Math.round(metrics.filter(m => m.baseline_context_bytes != null).reduce((s, m) => s + m.baseline_context_bytes, 0) / metrics.filter(m => m.baseline_context_bytes != null).length)
    : null;

  return {
    total_tasks: totalTasks,
    completed_tasks: completedTasks,
    failed_or_blocked_tasks: failedOrBlocked,
    high_retry_tasks: highRetryTasks.length,
    gate_runs_analyzed: gates.length,
    recurring_failed_checks: [...failedCheckCounts.entries()].map(([name, count]) => ({ name, count })),
    single_agent_successes: singleAgentSuccess.length,
    multi_agent_failures: multiAgentFailures.length,
    avg_context_bytes: avgContextBytes,
    avg_baseline_bytes: avgBaselineBytes
  };
}

/** Generate evidence-based factory improvement proposals without mutating core code. */
export function proposeImprovements({ projectDb, projectId = null }) {
  const stats = analyzeFactoryEffectiveness({ projectDb, projectId });
  const proposals = [];

  if (stats.multi_agent_failures >= 2 && stats.single_agent_successes >= stats.multi_agent_failures) {
    const id = `imp-${createHash('sha256').update('reduce-fanout').digest('hex').slice(0, 8)}`;
    const rec = {
      id,
      category: 'routing',
      title: 'Reduce default multi-agent fan-out on comparable tasks',
      hypothesis: 'Tasks routed to >2 agents failed more often than single-agent executions; tighten complexity threshold for STANDARD tasks.',
      evidence: { single_agent_successes: stats.single_agent_successes, multi_agent_failures: stats.multi_agent_failures },
      status: 'proposed',
      metrics_before: stats
    };
    projectDb.upsertImprovementProposal(rec);
    proposals.push(rec);
  }

  for (const chk of stats.recurring_failed_checks.filter(c => c.count >= 2)) {
    const id = `imp-${createHash('sha256').update(`gate-${chk.name}`).digest('hex').slice(0, 8)}`;
    const rec = {
      id,
      category: 'verification',
      title: `Pre-flight check guidance for recurring "${chk.name}" gate failures`,
      hypothesis: `Quality gate "${chk.name}" failed ${chk.count} times; surface pre-commit check reminder before full gate run.`,
      evidence: { check: chk.name, failure_count: chk.count },
      status: 'proposed',
      metrics_before: stats
    };
    projectDb.upsertImprovementProposal(rec);
    proposals.push(rec);
  }

  if (stats.high_retry_tasks >= 2) {
    const id = `imp-${createHash('sha256').update('high-retry').digest('hex').slice(0, 8)}`;
    const rec = {
      id,
      category: 'workflow',
      title: 'Require earlier reproducer test before retries on blocked tasks',
      hypothesis: `${stats.high_retry_tasks} task(s) required multiple attempts; enforce regression-debugger intake before second attempt.`,
      evidence: { high_retry_tasks: stats.high_retry_tasks },
      status: 'proposed',
      metrics_before: stats
    };
    projectDb.upsertImprovementProposal(rec);
    proposals.push(rec);
  }

  return { stats, proposals };
}
