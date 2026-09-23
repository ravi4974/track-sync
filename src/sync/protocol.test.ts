import { describe, expect, it } from 'vitest';
import { nextSeq } from './protocol.ts';

describe('nextSeq', () => {
  it('produces strictly increasing sequence numbers', () => {
    const a = nextSeq();
    const b = nextSeq();
    const c = nextSeq();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
