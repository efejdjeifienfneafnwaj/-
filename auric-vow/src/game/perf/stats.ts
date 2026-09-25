/**
 * AURIC VOW — perf/stats.ts
 * Counters published by PerfDirector, split out so the component module only
 * exports a component (fast refresh).
 */
// ---------------------------------------------------------------------------
// stats (read by the QA bridge and qa/profile.cjs)
// ---------------------------------------------------------------------------

export const PerfStats = {
  chunkedSources: 0,
  chunksCreated: 0,
  chunkReverts: 0,
  batchedSources: 0,
  batchesCreated: 0,
  batchReverts: 0,
  batchMs: -1,
  batchRejects: {} as Record<string, number>,
  lightsAdmitted: 0,
  lightsCandidates: 0,
  warmupMs: -1,
  farShadowRedraws: 0,
  spotShadowRedraws: 0,
}

