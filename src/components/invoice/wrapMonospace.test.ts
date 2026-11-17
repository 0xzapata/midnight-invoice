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

  it('measures CJK characters as 1 em and breaks between them like the browser', () => {
    // 14 pt: 5 CJK characters (70 pt) fit in 75 pt, 6 do not.
    expect(wrapMonospace('网站设计与开发服务', 75, 14)).toEqual(['网站设计与', '开发服务']);
    // A Latin word next to CJK text moves as a whole; CJK may break right after it.
    expect(wrapMonospace('Logo设计', 42, 14)).toEqual(['Logo', '设计']);
    expect(wrapMonospace('Logo设计', 48, 14)).toEqual(['Logo设', '计']);
    // Hangul syllables are 0.92 em, emoji 1.27 em.
    expect(wrapMonospace('웹사이트디자인', 14 * 0.92 * 4, 14)).toEqual(['웹사이트', '디자인']);
    expect(wrapMonospace('🚀🚀🚀', 14 * 1.27 * 2, 14)).toEqual(['🚀🚀', '🚀']);
  });

  it('keeps combining marks and variation selectors with their base character', () => {
    expect(wrapMonospace('❤️❤️', 14 * 1.27, 14)).toEqual(['❤️', '❤️']);
    expect(wrapMonospace('e\u0301e\u0301', charsWide(2), 14)).toEqual(['e\u0301e\u0301']);
  });
});
