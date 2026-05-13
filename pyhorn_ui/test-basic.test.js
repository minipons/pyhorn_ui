const { test, expect, describe } = require('vitest');

describe('basic', () => {
  test('1+1=2', () => {
    expect(1+1).toBe(2);
  });
});
