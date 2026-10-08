// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type {
  ProxySettingsType,
  StoredProxySettingsType,
} from '../../../wren/proxy/proxyConfig.std.ts';
import {
  BLOCKED_CHROMIUM_RULES,
  BLOCKED_PROXY_URL,
  DEFAULT_PROXY_SETTINGS,
  MAX_CREDENTIAL_BYTES,
  TOR_DEFAULT_PORT,
  buildChromiumRules,
  buildProxyUrl,
  describeProxyForLog,
  describeProxyUrlForLog,
  getProxyEndpoint,
  isDirectFeatureAllowed,
  isValidHost,
  isValidPort,
  makeTorIsolation,
  parseStoredProxySettings,
  resolveEffectiveProxy,
  serializeProxySettings,
  upgradeLocalDnsScheme,
  validateProxySettings,
} from '../../../wren/proxy/proxyConfig.std.ts';

const ISOLATION = makeTorIsolation('0123456789abcdef0123456789abcdef');

function settings(patch: Partial<ProxySettingsType>): ProxySettingsType {
  return { ...DEFAULT_PROXY_SETTINGS, ...patch };
}

function stored(patch: Partial<ProxySettingsType>): StoredProxySettingsType {
  return { kind: 'ok', settings: settings(patch) };
}

const MISSING: StoredProxySettingsType = { kind: 'missing' };

describe('wren/proxy/proxyConfig', () => {
  describe('ports', () => {
    it('takes 1 through 65535 and nothing else', () => {
      assert.isTrue(isValidPort(1));
      assert.isTrue(isValidPort(9050));
      assert.isTrue(isValidPort(65535));
      for (const bad of [0, -1, 65536, 1.5, Number.NaN, '9050', undefined]) {
        assert.isFalse(isValidPort(bad), String(bad));
      }
    });

    it('rejects a SOCKS port out of range', () => {
      const result = validateProxySettings(
        settings({ mode: 'socks5', host: 'proxy.example', port: 70000 })
      );
      assert.deepEqual(result, { ok: false, error: 'invalid-port' });
    });

    it('rejects a Tor port out of range even when Tor is not picked', () => {
      const result = validateProxySettings(settings({ torPort: 0 }));
      assert.deepEqual(result, { ok: false, error: 'invalid-port' });
    });
  });

  describe('hosts', () => {
    it('takes host names, IPv4 and IPv6', () => {
      for (const good of [
        'localhost',
        'proxy.example',
        'a-b.c-d.example',
        'expyuzz4wqqyqhjn.onion',
        '127.0.0.1',
        '10.0.0.254',
        '::1',
        'fd00::1',
      ]) {
        assert.isTrue(isValidHost(good), good);
      }
    });

    it('refuses anything that could smuggle a scheme, path or credentials', () => {
      for (const bad of [
        '',
        ' ',
        'http://proxy.example',
        'proxy.example/path',
        'user@proxy.example',
        'proxy.example:1080',
        'proxy..example',
        '-proxy.example',
        '999.1.1.1',
        '1.2.3',
        'proxy example',
        'a'.repeat(254),
        '[::1]',
      ]) {
        assert.isFalse(isValidHost(bad), bad);
      }
    });

    it('needs a valid host only in SOCKS5 mode, and trims it', () => {
      assert.deepEqual(
        validateProxySettings(settings({ mode: 'socks5', host: 'bad host' })),
        { ok: false, error: 'invalid-host' }
      );
      const result = validateProxySettings(
        settings({ mode: 'socks5', host: '  proxy.example ' })
      );
      assert.isTrue(result.ok);
      assert.strictEqual(result.ok && result.settings.host, 'proxy.example');
      assert.isTrue(validateProxySettings(settings({ mode: 'tor' })).ok);
    });
  });

  describe('credentials', () => {
    it('caps username and password at 255 bytes, counting UTF-8', () => {
      const max = 'a'.repeat(MAX_CREDENTIAL_BYTES);
      assert.isTrue(
        validateProxySettings(
          settings({
            mode: 'socks5',
            host: 'proxy.example',
            username: max,
            password: max,
          })
        ).ok
      );
      // 128 two-byte characters is 256 bytes.
      assert.deepEqual(
        validateProxySettings(
          settings({
            mode: 'socks5',
            host: 'proxy.example',
            username: 'u',
            password: '\u00e9'.repeat(128),
          })
        ),
        { ok: false, error: 'invalid-credentials' }
      );
    });

    it('refuses control characters and a password without a username', () => {
      assert.deepEqual(
        validateProxySettings(
          settings({ mode: 'socks5', host: 'p.example', username: 'a\nb' })
        ),
        { ok: false, error: 'invalid-credentials' }
      );
      assert.deepEqual(
        validateProxySettings(
          settings({ mode: 'socks5', host: 'p.example', password: 'secret' })
        ),
        { ok: false, error: 'invalid-credentials' }
      );
    });
  });

  describe('HTTP proxy URLs', () => {
    it('takes http and https with a host and port', () => {
      for (const good of [
        'http://proxy.example:3128',
        'https://proxy.example',
        'http://user:pass@10.0.0.1:8080',
        'http://[fd00::1]:3128/',
      ]) {
        assert.isTrue(
          validateProxySettings(settings({ mode: 'http', httpUrl: good })).ok,
          good
        );
      }
    });

    it('refuses other schemes, paths, queries and fragments', () => {
      for (const bad of [
        '',
        'proxy.example:3128',
        'socks5://proxy.example:1080',
        'http://proxy.example:3128/path',
        'http://proxy.example:3128/?q=1',
        'http://proxy.example:3128/#x',
        'http://proxy example:3128',
        'ftp://proxy.example',
      ]) {
        assert.deepEqual(
          validateProxySettings(settings({ mode: 'http', httpUrl: bad })),
          { ok: false, error: 'invalid-url' },
          bad
        );
      }
    });
  });

  describe('config.json', () => {
    it('round-trips through JSON the way config.json stores it', () => {
      const value = settings({
        mode: 'socks5',
        host: 'proxy.example',
        port: 1081,
        username: 'me',
        password: 'pw',
        onlyThroughProxy: false,
      });
      const json = JSON.parse(JSON.stringify(serializeProxySettings(value)));
      assert.deepEqual(parseStoredProxySettings(json), {
        kind: 'ok',
        settings: value,
      });
    });

    it('never serializes anything but the listed fields', () => {
      const serialized = serializeProxySettings({
        ...settings({ mode: 'tor' }),
        extra: 'nope',
      } as ProxySettingsType);
      assert.notProperty(serialized, 'extra');
    });

    it('treats a missing value as no proxy and a broken one as unreadable', () => {
      assert.deepEqual(parseStoredProxySettings(undefined), MISSING);
      assert.deepEqual(parseStoredProxySettings(null), MISSING);
      for (const bad of [
        'socks5://x',
        [],
        { mode: 'tor' },
        { version: 2, mode: 'tor' },
        { version: 1, mode: 'vpn' },
        { version: 1, mode: 'socks5', host: '' },
        { version: 1, mode: 'tor', torPort: 99999 },
        { version: 1, mode: 'tor', onlyThroughProxy: 'yes' },
      ]) {
        assert.deepEqual(
          parseStoredProxySettings(bad),
          { kind: 'unreadable' },
          JSON.stringify(bad)
        );
      }
    });
  });

  describe('Tor preset', () => {
    it('defaults to 127.0.0.1:9050 over socks5h with per-launch isolation', () => {
      assert.strictEqual(DEFAULT_PROXY_SETTINGS.torPort, TOR_DEFAULT_PORT);
      assert.strictEqual(
        buildProxyUrl(settings({ mode: 'tor' }), ISOLATION),
        'socks5h://wren:0123456789abcdef0123456789abcdef@127.0.0.1:9050'
      );
    });

    it('follows the port for Tor Browser and ignores the SOCKS host field', () => {
      assert.strictEqual(
        buildProxyUrl(
          settings({ mode: 'tor', torPort: 9150, host: 'elsewhere.example' }),
          ISOLATION
        ),
        'socks5h://wren:0123456789abcdef0123456789abcdef@127.0.0.1:9150'
      );
      assert.strictEqual(
        buildChromiumRules(settings({ mode: 'tor', torPort: 9150 })),
        'socks5://127.0.0.1:9150'
      );
    });
  });

  describe('proxy URLs', () => {
    it('always uses socks5h so names resolve at the proxy', () => {
      assert.strictEqual(
        buildProxyUrl(
          settings({ mode: 'socks5', host: 'proxy.example', port: 1080 }),
          ISOLATION
        ),
        'socks5h://proxy.example:1080'
      );
    });

    it('brackets IPv6 and percent-encodes credentials', () => {
      assert.strictEqual(
        buildProxyUrl(
          settings({
            mode: 'socks5',
            host: 'fd00::1',
            port: 1080,
            username: 'me@home',
            password: 'p:w/d',
          }),
          ISOLATION
        ),
        'socks5h://me%40home:p%3Aw%2Fd@[fd00::1]:1080'
      );
    });

    it('keeps credentials out of the Chromium rules', () => {
      assert.strictEqual(
        buildChromiumRules(
          settings({
            mode: 'socks5',
            host: 'proxy.example',
            port: 1080,
            username: 'me',
            password: 'secret',
          })
        ),
        'socks5://proxy.example:1080'
      );
      assert.strictEqual(
        buildChromiumRules(
          settings({ mode: 'http', httpUrl: 'http://me:secret@proxy.example' })
        ),
        'http://proxy.example:80'
      );
    });

    it('upgrades schemes that resolve names locally', () => {
      assert.strictEqual(
        upgradeLocalDnsScheme('socks5://127.0.0.1:9050'),
        'socks5h://127.0.0.1:9050'
      );
      assert.strictEqual(
        upgradeLocalDnsScheme('SOCKS4://10.0.0.1:1080'),
        'socks4a://10.0.0.1:1080'
      );
      assert.strictEqual(
        upgradeLocalDnsScheme('socks://10.0.0.1'),
        'socks5h://10.0.0.1'
      );
      for (const same of [
        'socks5h://127.0.0.1:9050',
        'socks4a://h:1',
        'http://h:3128',
      ]) {
        assert.strictEqual(upgradeLocalDnsScheme(same), same);
      }
    });

    it('finds the proxy endpoint with default ports', () => {
      assert.deepEqual(getProxyEndpoint('socks5h://u:p@127.0.0.1:9050'), {
        host: '127.0.0.1',
        port: 9050,
      });
      assert.deepEqual(getProxyEndpoint('socks5h://[::1]'), {
        host: '::1',
        port: 1080,
      });
      assert.deepEqual(getProxyEndpoint('https://proxy.example'), {
        host: 'proxy.example',
        port: 443,
      });
      assert.isUndefined(getProxyEndpoint('ftp://proxy.example'));
      assert.isUndefined(getProxyEndpoint('not a url'));
    });
  });

  describe('resolveEffectiveProxy', () => {
    const base = {
      envProxyUrl: undefined,
      hasProxyServerFlag: false,
      torIsolation: ISOLATION,
    };

    it('does nothing when nothing is set', () => {
      assert.deepEqual(resolveEffectiveProxy({ ...base, stored: MISSING }), {
        source: 'none',
        proxyUrl: undefined,
        chromiumRules: undefined,
        onlyThroughProxy: false,
      });
    });

    it('applies saved settings everywhere, only through the proxy by default', () => {
      const effective = resolveEffectiveProxy({
        ...base,
        stored: stored({ mode: 'tor' }),
      });
      assert.strictEqual(effective.source, 'settings');
      assert.match(effective.proxyUrl ?? '', /^socks5h:\/\/wren:/);
      assert.strictEqual(effective.chromiumRules, 'socks5://127.0.0.1:9050');
      assert.isTrue(effective.onlyThroughProxy);
    });

    it('lets HTTPS_PROXY override the saved proxy but keep the switch', () => {
      const effective = resolveEffectiveProxy({
        ...base,
        envProxyUrl: 'socks5://10.0.0.2:1080',
        stored: stored({ mode: 'tor' }),
      });
      assert.strictEqual(effective.source, 'env');
      assert.strictEqual(effective.proxyUrl, 'socks5h://10.0.0.2:1080');
      assert.isTrue(effective.onlyThroughProxy);
    });

    it('keeps stock behavior for HTTPS_PROXY alone', () => {
      const effective = resolveEffectiveProxy({
        ...base,
        envProxyUrl: 'http://10.0.0.2:3128',
        stored: MISSING,
      });
      assert.strictEqual(effective.proxyUrl, 'http://10.0.0.2:3128');
      assert.isUndefined(effective.chromiumRules);
      assert.isFalse(effective.onlyThroughProxy);
    });

    it('leaves Chromium alone when --proxy-server was passed', () => {
      const effective = resolveEffectiveProxy({
        ...base,
        hasProxyServerFlag: true,
        stored: stored({ mode: 'tor' }),
      });
      assert.isUndefined(effective.chromiumRules);
      assert.isDefined(effective.proxyUrl);
    });

    it('fails closed when the saved settings cannot be read', () => {
      assert.deepEqual(
        resolveEffectiveProxy({ ...base, stored: { kind: 'unreadable' } }),
        {
          source: 'blocked',
          proxyUrl: BLOCKED_PROXY_URL,
          chromiumRules: BLOCKED_CHROMIUM_RULES,
          onlyThroughProxy: true,
        }
      );
    });

    it('never falls back to direct when a saved proxy is switched on', () => {
      for (const mode of ['tor', 'socks5', 'http'] as const) {
        const effective = resolveEffectiveProxy({
          ...base,
          stored: stored({
            mode,
            host: 'proxy.example',
            httpUrl: 'http://proxy.example:3128',
            onlyThroughProxy: false,
          }),
        });
        assert.isDefined(effective.proxyUrl, mode);
        assert.isDefined(effective.chromiumRules, mode);
      }
    });
  });

  describe('fail-closed decision', () => {
    it('allows everything without a proxy', () => {
      const none = { proxyUrl: undefined, onlyThroughProxy: false };
      assert.isTrue(isDirectFeatureAllowed(none, 'calls'));
      assert.isTrue(isDirectFeatureAllowed(none, 'gif-search'));
      assert.isTrue(isDirectFeatureAllowed(none, 'outage-dns-check'));
    });

    it('blocks calls and GIF search only through the proxy', () => {
      const strict = { proxyUrl: 'socks5h://h:1', onlyThroughProxy: true };
      const loose = { proxyUrl: 'socks5h://h:1', onlyThroughProxy: false };
      assert.isFalse(isDirectFeatureAllowed(strict, 'calls'));
      assert.isFalse(isDirectFeatureAllowed(strict, 'gif-search'));
      assert.isTrue(isDirectFeatureAllowed(loose, 'calls'));
      assert.isTrue(isDirectFeatureAllowed(loose, 'gif-search'));
    });

    it('never does the plain DNS outage check behind any proxy', () => {
      const loose = { proxyUrl: 'socks5h://h:1', onlyThroughProxy: false };
      assert.isFalse(isDirectFeatureAllowed(loose, 'outage-dns-check'));
    });
  });

  describe('logs', () => {
    it('never carry credentials or a remote host', () => {
      const secrets = ['hunter2', 'alice', 'proxy.private.example'];
      const lines = [
        describeProxyUrlForLog(
          'socks5h://alice:hunter2@proxy.private.example:1080'
        ),
        describeProxyUrlForLog('http://alice:hunter2@proxy.private.example'),
        describeProxyForLog(
          resolveEffectiveProxy({
            envProxyUrl: undefined,
            hasProxyServerFlag: false,
            torIsolation: makeTorIsolation('hunter2'),
            stored: stored({
              mode: 'socks5',
              host: 'proxy.private.example',
              username: 'alice',
              password: 'hunter2',
            }),
          })
        ),
        describeProxyForLog(
          resolveEffectiveProxy({
            envProxyUrl: undefined,
            hasProxyServerFlag: false,
            torIsolation: makeTorIsolation('hunter2'),
            stored: stored({ mode: 'tor' }),
          })
        ),
      ];
      for (const line of lines) {
        for (const secret of secrets) {
          assert.notInclude(line, secret, line);
        }
      }
      assert.include(lines[0], 'with credentials');
      assert.include(lines[3], 'loopback:9050');
    });
  });
});
