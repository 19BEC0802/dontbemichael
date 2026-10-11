'use strict';

/**
 * classifyInboundKind — the conservative heuristic that decides whether an
 * inbound webhook message is a directive (needs approval in communication-only
 * mode) or communication (flows through).
 *
 * The function deliberately leans toward 'directive': anything it isn't
 * confident is chatter is treated as a directive. These tests verify that
 * common imperative verbs are NOT mis-classified as communication, even when
 * phrased as polite questions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { classifyInboundKind } = loadTs('src/shared/triggers.ts');

/* ── pure questions with no imperative → communication ─────────────── */

test('a plain status question is communication', () => {
  assert.equal(classifyInboundKind('What is the current status?'), 'communication');
});

test('a who question is communication', () => {
  assert.equal(classifyInboundKind('Who is on call today?'), 'communication');
});

test('empty text is communication', () => {
  assert.equal(classifyInboundKind(''), 'communication');
});

/* ── original verb list — still caught ─────────────────────────────── */

test('a question containing "deploy" is a directive', () => {
  assert.equal(classifyInboundKind('Can you deploy the new build?'), 'directive');
});

test('a question containing "delete" is a directive', () => {
  assert.equal(classifyInboundKind('Could you delete the old logs?'), 'directive');
});

/* ── newly added verbs — previously mis-classified ─────────────────── */

test('a question containing "start" is a directive', () => {
  assert.equal(classifyInboundKind('Can you start the server?'), 'directive');
});

test('a question containing "stop" is a directive', () => {
  assert.equal(classifyInboundKind('Could you stop the process?'), 'directive');
});

test('a question containing "send" is a directive', () => {
  assert.equal(classifyInboundKind('Could you send the report?'), 'directive');
});

test('a question containing "execute" is a directive', () => {
  assert.equal(classifyInboundKind('Can you execute the migration?'), 'directive');
});

test('a question containing "install" is a directive', () => {
  assert.equal(classifyInboundKind('Can you install the new package?'), 'directive');
});

test('a question containing "launch" is a directive', () => {
  assert.equal(classifyInboundKind('Could you launch the staging environment?'), 'directive');
});

test('a question containing "terminate" is a directive', () => {
  assert.equal(classifyInboundKind('Can you terminate the idle instances?'), 'directive');
});

test('a question containing "restart" is a directive', () => {
  assert.equal(classifyInboundKind('Could you restart the worker?'), 'directive');
});

test('a question containing "push" is a directive', () => {
  assert.equal(classifyInboundKind('Can you push the hotfix?'), 'directive');
});

test('a question containing "publish" is a directive', () => {
  assert.equal(classifyInboundKind('Could you publish the release?'), 'directive');
});

test('a question containing "schedule" is a directive', () => {
  assert.equal(classifyInboundKind('Can you schedule the backup?'), 'directive');
});

test('a question containing "enable" is a directive', () => {
  assert.equal(classifyInboundKind('Could you enable the feature flag?'), 'directive');
});

test('a question containing "disable" is a directive', () => {
  assert.equal(classifyInboundKind('Can you disable the old endpoint?'), 'directive');
});

test('a question containing "configure" is a directive', () => {
  assert.equal(classifyInboundKind('Could you configure the firewall?'), 'directive');
});

test('a question containing "reset" is a directive', () => {
  assert.equal(classifyInboundKind('Can you reset the password?'), 'directive');
});

test('a question containing "migrate" is a directive', () => {
  assert.equal(classifyInboundKind('Could you migrate the database?'), 'directive');
});

/* ── non-question imperatives are always directives ────────────────── */

test('a bare imperative is a directive', () => {
  assert.equal(classifyInboundKind('Start the server'), 'directive');
});

test('a sentence that does not end with ? is a directive', () => {
  assert.equal(classifyInboundKind('Please stop the deploy pipeline.'), 'directive');
});
