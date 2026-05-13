// @ts-check
/** Unit tests for the simulation request body construction */

import { test } from 'node:test';
import assert from 'node:assert';
import yaml from 'js-yaml';

const DEFAULT_DRIVER = `fs: 49.6
qts: 0.27
qes: 0.28
qms: 7.88
vas: 0.0369
re: 7.8
bl: 7.79
mms: 0.00699
cms: 0.001472
rms: 0.277
sd: 0.01327
le: 0.0008
xmax: 0.001
voltage: 2.83
`;

const DEFAULT_HORN = `ang: 1.5707963267948966
vrc: 0.0045
lrc: 0.1
vtc: 0.00016
atc: 0.008

profile_type: "hyperbolic"
n_segments: 50
throat_area: 0.008
mouth_area: 0.06
path_length: 1.5
hyperbolic_t: 0.3
`;

const fmin = 10;
const fmax = 20000;
const nPoints = 500;

// Simulate what runSimulation does to build the request body
function buildSimulateBody(driverYaml, hornYaml, fmin, fmax, nPoints) {
  const driver = yaml.load(driverYaml);
  const horn = yaml.load(hornYaml);

  if (!driver || !horn) {
    throw new Error("Driver or horn parameters are empty");
  }

  return {
    driver,
    horn,
    fmin,
    fmax,
    n_points: nPoints,
    off_axis_angles: [0, 15, 30, 45, 60, 75, 90],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('buildSimulateBody: sends "driver" (not "driver_config")', () => {
  const body = buildSimulateBody(DEFAULT_DRIVER, DEFAULT_HORN, fmin, fmax, nPoints);
  assert.ok('driver' in body, 'body must have "driver" key (parsed object)');
  assert.ok(!('driver_config' in body), 'body must NOT have "driver_config" (raw YAML string)');
});

test('buildSimulateBody: sends "horn" (not "horn_config")', () => {
  const body = buildSimulateBody(DEFAULT_DRIVER, DEFAULT_HORN, fmin, fmax, nPoints);
  assert.ok('horn' in body, 'body must have "horn" key (parsed object)');
  assert.ok(!('horn_config' in body), 'body must NOT have "horn_config" (raw YAML string)');
});

test('buildSimulateBody: driver is a parsed object (not a string)', () => {
  const body = buildSimulateBody(DEFAULT_DRIVER, DEFAULT_HORN, fmin, fmax, nPoints);
  assert.strictEqual(typeof body.driver, 'object', 'driver must be a parsed object');
  assert.strictEqual(typeof body.horn, 'object', 'horn must be a parsed object');
});

test('buildSimulateBody: driver has correct numeric fields', () => {
  const body = buildSimulateBody(DEFAULT_DRIVER, DEFAULT_HORN, fmin, fmax, nPoints);
  assert.strictEqual(body.driver.fs, 49.6);
  assert.strictEqual(body.driver.qts, 0.27);
  assert.strictEqual(body.driver.vas, 0.0369);
  assert.strictEqual(body.driver.re, 7.8);
});

test('buildSimulateBody: horn has correct numeric fields', () => {
  const body = buildSimulateBody(DEFAULT_DRIVER, DEFAULT_HORN, fmin, fmax, nPoints);
  assert.strictEqual(body.horn.throat_area, 0.008);
  assert.strictEqual(body.horn.mouth_area, 0.06);
  assert.strictEqual(body.horn.path_length, 1.5);
  assert.strictEqual(body.horn.profile_type, 'hyperbolic');
});

test('buildSimulateBody: includes simulation range parameters', () => {
  const body = buildSimulateBody(DEFAULT_DRIVER, DEFAULT_HORN, 20, 10000, 200);
  assert.strictEqual(body.fmin, 20);
  assert.strictEqual(body.fmax, 10000);
  assert.strictEqual(body.n_points, 200);
  assert.deepStrictEqual(body.off_axis_angles, [0, 15, 30, 45, 60, 75, 90]);
});

test('buildSimulateBody: throws on empty driver YAML', () => {
  assert.throws(
    () => buildSimulateBody('', DEFAULT_HORN, fmin, fmax, nPoints),
    /empty|Driver or horn/i
  );
});

test('buildSimulateBody: throws on empty horn YAML', () => {
  assert.throws(
    () => buildSimulateBody(DEFAULT_DRIVER, '', fmin, fmax, nPoints),
    /empty|Driver or horn/i
  );
});

test('yaml.load correctly parses FE166NV2 params', () => {
  const driver = yaml.load(DEFAULT_DRIVER);
  // These must be numbers, not strings
  assert.strictEqual(typeof driver.fs, 'number');
  assert.strictEqual(typeof driver.vas, 'number');
  assert.strictEqual(typeof driver.qts, 'number');
  // Re must be a number
  assert.strictEqual(typeof driver.re, 'number');
  assert.strictEqual(driver.re, 7.8);
});
