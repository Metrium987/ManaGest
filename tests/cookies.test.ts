import { describe, expect, it } from 'vitest';
import { cookieValues } from '../server/lib/cookies';

describe('cookieValues', () => {
  it('reads a single value', () => {
    expect(cookieValues('mg_session=abc', 'mg_session')).toEqual(['abc']);
  });

  it('returns every duplicate so a live session can be found', () => {
    // Regression: the browser kept the partitioned cookie of an earlier
    // deployment next to the new one. Reading only the first match answered 401
    // on /api/auth/me right after a successful login, bouncing the user back to
    // the sign-in page.
    expect(cookieValues('mg_session=perime; mg_session=valide', 'mg_session')).toEqual([
      'perime',
      'valide',
    ]);
  });

  it('ignores other cookies and malformed pairs', () => {
    expect(cookieValues('mg_csrf=jeton; drapeau; mg_session=valeur', 'mg_session')).toEqual([
      'valeur',
    ]);
    expect(cookieValues('', 'mg_session')).toEqual([]);
  });

  it('decodes percent-encoded values and keeps empty ones out', () => {
    expect(cookieValues('mg_session=a%20b', 'mg_session')).toEqual(['a b']);
    expect(cookieValues('mg_session=', 'mg_session')).toEqual([]);
  });

  it('keeps the padding of a value that contains equals signs', () => {
    expect(cookieValues('mg_session=abc=def', 'mg_session')).toEqual(['abc=def']);
  });
});
