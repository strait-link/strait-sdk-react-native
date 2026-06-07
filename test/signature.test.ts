import { describe, expect, it } from 'vitest';
import { computeSignature, h32 } from '../src/signature.js';
import vectors from './signature-vectors.json' with { type: 'json' };

// Cross-repo parity: identical golden vectors to the server and sdk-web.
describe('h32 — golden vectors', () => {
  for (const v of vectors.h32) {
    it(`h32(${JSON.stringify(v.input)})`, () => {
      expect(h32(v.input)).toBe(v.expected);
    });
  }
});

describe('computeSignature — golden vectors', () => {
  for (const v of vectors.signatures) {
    it(v.name, () => {
      expect(computeSignature(v.input)).toEqual(v.expected);
    });
  }
});
