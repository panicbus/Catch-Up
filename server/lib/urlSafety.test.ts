import { describe, it, expect } from 'vitest';
import { checkUrl, isBlockedHost } from './urlSafety';

describe('isBlockedHost', () => {
  it('blocks localhost', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('LOCALHOST')).toBe(true);
  });

  it('blocks .local/.internal/.localhost suffixed hostnames', () => {
    expect(isBlockedHost('printer.local')).toBe(true);
    expect(isBlockedHost('service.internal')).toBe(true);
    expect(isBlockedHost('foo.localhost')).toBe(true);
  });

  it('blocks private IPv4 ranges, including cloud metadata', () => {
    expect(isBlockedHost('10.0.0.1')).toBe(true);
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true); // cloud metadata endpoint
    expect(isBlockedHost('172.16.0.1')).toBe(true);
    expect(isBlockedHost('172.31.255.255')).toBe(true);
    expect(isBlockedHost('192.168.1.1')).toBe(true);
    expect(isBlockedHost('0.0.0.0')).toBe(true);
  });

  it('does not block adjacent-but-public IPv4 addresses', () => {
    expect(isBlockedHost('172.32.0.1')).toBe(false); // just outside 172.16.0.0/12
    expect(isBlockedHost('172.15.255.255')).toBe(false);
    expect(isBlockedHost('8.8.8.8')).toBe(false);
  });

  it('blocks IPv6 loopback and unique-local ranges', () => {
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('fc00::1')).toBe(true);
    expect(isBlockedHost('fd12:3456::1')).toBe(true);
    expect(isBlockedHost('fe80::1')).toBe(true);
  });

  it('allows ordinary public hostnames', () => {
    expect(isBlockedHost('missionlocal.org')).toBe(false);
    expect(isBlockedHost('www.jambase.com')).toBe(false);
  });
});

describe('checkUrl', () => {
  it('accepts ordinary http(s) URLs', () => {
    expect(checkUrl('https://missionlocal.org/feed/')?.href).toBe('https://missionlocal.org/feed/');
    expect(checkUrl('http://example.com/')).not.toBeNull();
  });

  it('rejects non-http(s) protocols', () => {
    expect(checkUrl('file:///etc/passwd')).toBeNull();
    expect(checkUrl('ftp://example.com/')).toBeNull();
    expect(checkUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects blocked hosts', () => {
    expect(checkUrl('http://localhost/')).toBeNull();
    expect(checkUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(checkUrl('http://10.0.0.5:8080/admin')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(checkUrl('not a url')).toBeNull();
    expect(checkUrl('')).toBeNull();
  });
});
