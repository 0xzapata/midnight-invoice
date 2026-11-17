import { describe, expect, it } from 'vitest';
import { wrapMonospace } from './wrapMonospace';

// text-sm (14 pt) Noto Sans Mono advances 8.4 pt per character.
const charsWide = (n: number) => n * 8.4;

describe('wrapMonospace (matches the preview browser line breaks)', () => {
  it('breaks greedily at spaces, never squeezing an extra word onto a line', () => {
    // 256.5 pt fits 30 characters: "stakeholder interviews (2 days," is 31 and must wrap, as in the browser.
    expect(
      wrapMonospace('Discovery workshop & stakeholder interviews (2 days, on-site in Hamburg)', 256.5, 14),
    ).toEqual(['Discovery workshop &', 'stakeholder interviews (2', 'days, on-site in Hamburg)']);
  });

  it('allows a line of exactly the available width', () => {
    expect(wrapMonospace('aaaaa bbbbb', charsWide(11), 14)).toEqual(['aaaaa bbbbb']);
    expect(wrapMonospace('aaaaa bbbbb', charsWide(10), 14)).toEqual(['aaaaa', 'bbbbb']);
  });

  it('can break after a hyphen and splits words longer than a line', () => {
    expect(wrapMonospace('well-known', charsWide(6), 14)).toEqual(['well-', 'known']);
    expect(wrapMonospace('abcdefghij', charsWide(4), 14)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('keeps newlines only for whitespace-pre-line fields', () => {
    expect(wrapMonospace('Line 1\n\nLine 3', 500, 14, true)).toEqual(['Line 1', '', 'Line 3']);
    expect(wrapMonospace('Line 1\nLine 2', 500, 14)).toEqual(['Line 1 Line 2']);
  });
});
