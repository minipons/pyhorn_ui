// @ts-check
/** Unit tests for YAML parse/stringify helpers */

import { test } from 'node:test';
import assert from 'node:assert';

// ── Copy of parseYamlFloat from EditableHornSummary ─────────────────────────
function parseYamlFloat(text, key) {
  const lines = text.split('\n');
  let inBlock = null;

  for (const line of lines) {
    const idx = line.indexOf('#');
    const clean = idx >= 0 ? line.slice(0, idx) : line;

    if (clean.match(/^\s*rear_chamber\s*:/)) inBlock = 'rear_chamber';
    else if (clean.match(/^\s*throat_chamber\s*:/)) inBlock = 'throat_chamber';
    else if (clean.match(/^\s*throat_adapter\s*:/)) inBlock = 'throat_adapter';
    else if (clean.match(/^\s*[^ ]/)) inBlock = null;

    const flatMatch = clean.match(new RegExp(`^\\s*${key}:\\s*([0-9eE.+\\-]+)`));
    if (flatMatch) return parseFloat(flatMatch[1]);

    if (inBlock !== null) {
      const nestedMatch = clean.match(new RegExp(`^\\s+${key}:\\s*([0-9eE.+\\-]+)`));
      if (nestedMatch) return parseFloat(nestedMatch[1]);
    }
  }
  return null;
}

// ── Copy of setYamlFloat from EditableHornSummary ───────────────────────────
function setYamlFloat(text, key, value) {
  const lines = text.split('\n');
  const result = [];
  let inBlock = null;
  let flatFound = false;

  for (const line of lines) {
    const idx = line.indexOf('#');
    const clean = idx >= 0 ? line.slice(0, idx) : line;

    if (clean.match(/^\s*rear_chamber\s*:/)) inBlock = 'rear_chamber';
    else if (clean.match(/^\s*throat_chamber\s*:/)) inBlock = 'throat_chamber';
    else if (clean.match(/^\s*throat_adapter\s*:/)) inBlock = 'throat_adapter';
    else if (clean.match(/^\s*[^ ]/)) inBlock = null;

    if (inBlock !== null && !flatFound && clean.match(new RegExp(`^\\s+${key}:\\s*[0-9eE.+\\-]+`))) {
      continue;
    }

    const flatRe = new RegExp(`^(\\s*${key}:\\s*)([0-9eE.+\\-]+)`);
    const flatMatch = clean.match(flatRe);
    if (flatMatch) {
      result.push(line.replace(flatRe, `${flatMatch[1]}${value}`));
      flatFound = true;
      continue;
    }

    result.push(line);
  }

  if (!flatFound) return text.trimEnd() + `\n${key}: ${value}`;
  return result.join('\n');
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('parseYamlFloat: flat keys', () => {
  const yaml = `throat_area: 0.008\nmouth_area: 0.06\npath_length: 1.5\nvrc: 0.0045`;
  assert.strictEqual(parseYamlFloat(yaml, 'throat_area'), 0.008);
  assert.strictEqual(parseYamlFloat(yaml, 'mouth_area'), 0.06);
  assert.strictEqual(parseYamlFloat(yaml, 'path_length'), 1.5);
  assert.strictEqual(parseYamlFloat(yaml, 'vrc'), 0.0045);
});

test('parseYamlFloat: ignores comments', () => {
  const yaml = `throat_area: 0.008 # this is the throat`;
  assert.strictEqual(parseYamlFloat(yaml, 'throat_area'), 0.008);
});

test('parseYamlFloat: returns null for missing key', () => {
  const yaml = `throat_area: 0.008`;
  assert.strictEqual(parseYamlFloat(yaml, 'nonexistent'), null);
});

test('parseYamlFloat: nested keys (old format)', () => {
  const yaml = `rear_chamber:\n  vrc: 0.0045\n  lrc: 0.1\nthroat_chamber:\n  vtc: 0.00016\nthroat_adapter:\n  ap1: 12.5`;
  assert.strictEqual(parseYamlFloat(yaml, 'vrc'), 0.0045);
  assert.strictEqual(parseYamlFloat(yaml, 'lrc'), 0.1);
  assert.strictEqual(parseYamlFloat(yaml, 'vtc'), 0.00016);
  assert.strictEqual(parseYamlFloat(yaml, 'ap1'), 12.5);
});

test('parseYamlFloat: flat key takes priority over nested', () => {
  const yaml = `throat_area: 0.008\nvrc: 0.1\nrear_chamber:\n  vrc: 0.0045`;
  assert.strictEqual(parseYamlFloat(yaml, 'vrc'), 0.1); // flat wins
});

test('setYamlFloat: updates existing flat key', () => {
  const yaml = `throat_area: 0.008\nvrc: 0.0045`;
  const result = setYamlFloat(yaml, 'vrc', 0.005);
  assert.ok(result.includes('vrc: 0.005'));
  assert.ok(!result.includes('vrc: 0.0045'));
});

test('setYamlFloat: adds key when not present', () => {
  const yaml = `throat_area: 0.008`;
  const result = setYamlFloat(yaml, 'vrc', 0.005);
  assert.ok(result.includes('vrc: 0.005'));
});

test('setYamlFloat: strips nested occurrence when writing flat', () => {
  const yaml = `rear_chamber:\n  vrc: 0.0045`;
  const result = setYamlFloat(yaml, 'vrc', 0.005);
  assert.ok(result.includes('vrc: 0.005'));
  assert.ok(!result.includes('0.0045'));
});

test('setYamlFloat: roundtrip parse→set→parse', () => {
  const original = `throat_area: 0.008\nvrc: 0.0045`;
  const parsed = parseYamlFloat(original, 'vrc');
  const output = setYamlFloat(original, 'vrc', parsed);
  assert.strictEqual(parseYamlFloat(output, 'vrc'), 0.0045);
});
