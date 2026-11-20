import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_CATEGORIES,
  SPECIALIST_AGENTS,
  LEGACY_TO_SPECIALIST_MAP,
  resolveSpecialist,
  generateAgentAdapters,
  validateAgentDefinitions
} from '../src/agent-registry.mjs';
import { AGENT_ROLES } from '../src/agents.mjs';
import { selectSpecialists, classifyComplexity, explainSelection } from '../src/router.mjs';

test('specialist registry loads all 60 agents across 9 categories with 13 required attributes', () => {
  assert.equal(AGENT_CATEGORIES.length, 9);
  assert.equal(SPECIALIST_AGENTS.length, 60);
  const categoriesPresent = new Set(SPECIALIST_AGENTS.map(a => a.category));
  assert.equal(categoriesPresent.size, 9);

  const requiredKeys = [
    'id', 'name', 'category', 'legacyRole', 'responsibility',
    'activationConditions', 'supportedStacks', 'requiredInputs',
    'toolsAndSkills', 'operatingProcedure', 'qualityRequirements',
    'securityBoundaries', 'handoffFormat', 'expectedArtifacts',
    'verificationCriteria', 'humanApprovalConditions'
  ];
  for (const agent of SPECIALIST_AGENTS) {
    for (const key of requiredKeys) {
      assert.ok(agent[key] !== undefined && agent[key] !== null, `${agent.id} missing ${key}`);
    }
    assert.ok(AGENT_ROLES[agent.legacyRole], `${agent.id} maps to unknown legacyRole ${agent.legacyRole}`);
  }
});

test('legacy 14 agent roles map bidirectionally without breaking compatibility', () => {
  for (const roleId of Object.keys(AGENT_ROLES)) {
    const mappedId = LEGACY_TO_SPECIALIST_MAP[roleId];
    assert.ok(mappedId, `Legacy role ${roleId} missing specialist mapping`);
    const resolved = resolveSpecialist(roleId);
    assert.equal(resolved.id, mappedId);
    assert.equal(resolveSpecialist(mappedId).id, mappedId);
  }
});

test('native Antigravity and Cursor agent adapters generate valid YAML frontmatter and preserve user edits', t => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-agents-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const first = generateAgentAdapters(dir, { preserveCustom: true });
  assert.equal(first.total_agents, 60);
  assert.equal(first.written, 180);

  const validation = validateAgentDefinitions(dir);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(validation.checked, 180);

  // Customize a Cursor agent file and ensure re-generation preserves it
  const customPath = join(dir, '.cursor', 'agents', 'backend-architect.md');
  const customContent = '---\nname: backend-architect\ndescription: "Custom"\nmodel: inherit\nreadonly: false\n---\n\n## Operating Procedure\nCustom\n## Quality & Verification\nCustom\n## Security & Approval Boundaries\nCustom\n';
  writeFileSync(customPath, customContent, 'utf8');

  const second = generateAgentAdapters(dir, { preserveCustom: true });
  assert.equal(second.preserved_custom, 1);
  assert.equal(readFileSync(customPath, 'utf8'), customContent);
});

test('smart router selects NestJS backend + debugger and excludes unrelated domains', () => {
  const res = selectSpecialists({
    request: 'Fix NestJS authentication token guard bug',
    profileId: 'web',
    stack: { adapters: ['nestjs', 'node', 'postgres'] }
  });
  assert.equal(res.primary_agent, 'backend-architect');
  assert.ok(res.supporting_agents.includes('regression-debugger'));
  assert.ok(!res.supporting_agents.some(id => id.includes('unity') || id.includes('godot') || id.includes('game')));
  assert.ok(!res.supporting_agents.some(id => id.includes('mobile') || id.includes('iis')));
  assert.ok(explainSelection(res).includes('Primary Specialist: backend-architect'));
});

test('smart router selects multi-domain specialists for React Native biometric + GPS attendance feature', () => {
  const res = selectSpecialists({
    request: 'Build biometric face liveness attendance check-in with GPS geofencing in React Native mobile app and backend API',
    profileId: 'mobile',
    stack: { adapters: ['expo', 'nestjs', 'biometrics'] }
  });
  assert.equal(res.complexity, 'DEEP');
  const chosen = new Set([res.primary_agent, ...res.supporting_agents]);
  assert.ok(chosen.has('biometric-ai-engineer'), `chosen=${[...chosen]}`);
  assert.ok(chosen.has('geospatial-engineer'), `chosen=${[...chosen]}`);
  assert.ok(chosen.has('mobile-app-builder') || chosen.has('react-native-engineer'), `chosen=${[...chosen]}`);
  assert.ok(chosen.has('backend-architect'), `chosen=${[...chosen]}`);
  assert.ok(res.parallelizable_groups.length >= 2);
});

test('smart router routes game tasks to game specialists and keeps FAST edits to 1 agent', () => {
  const fast = selectSpecialists({
    request: 'Fix typo in button label',
    profileId: 'web',
    stack: { adapters: ['nextjs'] }
  });
  assert.equal(classifyComplexity('Fix typo in button label').id, 'FAST');
  assert.equal(fast.complexity, 'FAST');
  assert.equal(fast.supporting_agents.length, 0);
  assert.equal(fast.pstack_mode, 'lite');
  assert.equal(fast.ponytail_mode, 'lite');

  const game = selectSpecialists({
    request: 'Implement deterministic player controller and frame budget profiler in Unity C#',
    profileId: 'game',
    stack: { adapters: ['unity'] }
  });
  assert.ok([game.primary_agent, ...game.supporting_agents].includes('unity-developer'));
  assert.ok(![game.primary_agent, ...game.supporting_agents].includes('nextjs'));
});
