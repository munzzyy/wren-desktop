// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import type { LocalizerType } from '../../types/I18N.std.ts';
import { AxoPasswordField } from '../../axo/fields/AxoPasswordField.dom.tsx';
import { AxoTextField } from '../../axo/fields/AxoTextField.dom.tsx';
import { AxoFieldList } from '../../axo/items/AxoFieldList.dom.tsx';
import { AxoItem } from '../../axo/items/AxoItem.dom.tsx';
import { AxoList } from '../../axo/items/AxoList.dom.tsx';
import { AxoSelectItem } from '../../axo/items/AxoSelectItem.dom.tsx';
import { AxoSwitchItem } from '../../axo/items/AxoSwitchItem.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';
import { drop } from '../../util/drop.std.ts';
import { missingCaseError } from '../../util/missingCaseError.std.ts';
import type {
  ProxyErrorType,
  ProxyModeType,
  ProxySettingsType,
} from './proxyConfig.std.ts';
import {
  MAX_CREDENTIAL_BYTES,
  PROXY_MODES,
  TOR_BROWSER_PORT,
  TOR_DEFAULT_PORT,
  TOR_HOST,
  isProxyMode,
  validateProxySettings,
} from './proxyConfig.std.ts';
import type {
  ProxySaveResultType,
  ProxySettingsApiType,
  ProxyStatusType,
  ProxyTestResultType,
} from './types.std.ts';

export type WrenProxySettingsProps = Readonly<{
  i18n: LocalizerType;
  api: ProxySettingsApiType;
}>;

type DraftType = Readonly<{
  mode: ProxyModeType;
  host: string;
  port: string;
  torPort: string;
  username: string;
  password: string;
  httpUrl: string;
  onlyThroughProxy: boolean;
}>;

type NoticeType = Readonly<{ kind: 'status' | 'alert'; text: string }>;

function toDraft(settings: ProxySettingsType): DraftType {
  return {
    mode: settings.mode,
    host: settings.host,
    port: String(settings.port),
    torPort: String(settings.torPort),
    username: settings.username,
    password: settings.password,
    httpUrl: settings.httpUrl,
    onlyThroughProxy: settings.onlyThroughProxy,
  };
}

function parsePort(value: string): number {
  return /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

function draftToSettings(draft: DraftType): ProxySettingsType {
  return {
    version: 1,
    mode: draft.mode,
    host: draft.host,
    port: parsePort(draft.port),
    torPort: parsePort(draft.torPort),
    username: draft.username,
    password: draft.password,
    httpUrl: draft.httpUrl,
    onlyThroughProxy: draft.onlyThroughProxy,
  };
}

function modeLabel(i18n: LocalizerType, mode: ProxyModeType): string {
  switch (mode) {
    case 'off':
      return i18n('icu:WrenProxy__mode-off');
    case 'tor':
      return i18n('icu:WrenProxy__mode-tor');
    case 'socks5':
      return i18n('icu:WrenProxy__mode-socks5');
    case 'http':
      return i18n('icu:WrenProxy__mode-http');
    default:
      throw missingCaseError(mode);
  }
}

function errorText(i18n: LocalizerType, error: ProxyErrorType): string {
  switch (error) {
    case 'invalid-host':
      return i18n('icu:WrenProxy__error-host');
    case 'invalid-port':
      return i18n('icu:WrenProxy__error-port');
    case 'invalid-credentials':
      return i18n('icu:WrenProxy__error-credentials', {
        max: MAX_CREDENTIAL_BYTES,
      });
    case 'invalid-url':
      return i18n('icu:WrenProxy__error-url');
    case 'invalid':
      return i18n('icu:WrenProxy__error-failed');
    default:
      throw missingCaseError(error);
  }
}

function testText(i18n: LocalizerType, outcome: ProxyTestResultType): string {
  switch (outcome.result) {
    case 'reachable':
      return i18n('icu:WrenProxy__test-reachable', { ms: outcome.ms });
    case 'proxy-unreachable':
      return i18n('icu:WrenProxy__test-proxy-unreachable');
    case 'server-unreachable':
      return i18n('icu:WrenProxy__test-server-unreachable');
    case 'timeout':
      return i18n('icu:WrenProxy__test-timeout');
    case 'invalid':
      return errorText(i18n, outcome.error);
    case 'off':
      return i18n('icu:WrenProxy__test-off');
    default:
      throw missingCaseError(outcome);
  }
}

export function WrenProxySettings({
  i18n,
  api,
}: WrenProxySettingsProps): JSX.Element | null {
  const [status, setStatus] = useState<ProxyStatusType>();
  const [draft, setDraft] = useState<DraftType>();
  const [notice, setNotice] = useState<NoticeType>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    drop(
      (async () => {
        const next = await api.getStatus();
        if (active) {
          setStatus(next);
          setDraft(toDraft(next.saved));
        }
      })()
    );
    return () => {
      active = false;
    };
  }, [api]);

  if (!status || !draft) {
    return null;
  }

  const update = (patch: Partial<DraftType>) => {
    setDraft({ ...draft, ...patch });
    setNotice(undefined);
  };

  const checkDraft = (): ProxySettingsType | undefined => {
    const settings = draftToSettings(draft);
    const result = validateProxySettings(settings);
    if (!result.ok) {
      setNotice({ kind: 'alert', text: errorText(i18n, result.error) });
      return undefined;
    }
    return result.settings;
  };

  const runTest = async () => {
    const settings = checkDraft();
    if (!settings || testing) {
      return;
    }
    setTesting(true);
    setNotice({ kind: 'status', text: i18n('icu:WrenProxy__testing') });
    let outcome: ProxyTestResultType;
    try {
      outcome = await api.test(settings);
    } catch {
      outcome = { result: 'server-unreachable' };
    }
    setTesting(false);
    setNotice({
      kind: outcome.result === 'reachable' ? 'status' : 'alert',
      text: testText(i18n, outcome),
    });
  };

  const save = async () => {
    const settings = checkDraft();
    if (!settings || saving) {
      return;
    }
    setSaving(true);
    let result: ProxySaveResultType;
    try {
      result = await api.save(settings);
    } catch {
      result = { ok: false, error: 'invalid' };
    }
    setSaving(false);
    if (!result.ok) {
      setNotice({ kind: 'alert', text: errorText(i18n, result.error) });
      return;
    }
    setStatus(result.status);
    setDraft(toDraft(result.status.saved));
    setNotice({
      kind: 'status',
      text: result.status.needsRelaunch
        ? i18n('icu:WrenProxy__saved-relaunch')
        : i18n('icu:WrenProxy__saved'),
    });
  };

  const footerNotes: Array<string> = [i18n('icu:WrenProxy__section-footer')];
  if (status.savedUnreadable) {
    footerNotes.push(i18n('icu:WrenProxy__unreadable'));
  }
  if (status.envOverride) {
    footerNotes.push(i18n('icu:WrenProxy__env-override'));
  }
  if (status.flagOverride) {
    footerNotes.push(i18n('icu:WrenProxy__flag-override'));
  }

  return (
    <>
      <AxoList.Root>
        <AxoList.Header>
          <AxoList.Label>{i18n('icu:WrenProxy__section')}</AxoList.Label>
        </AxoList.Header>
        <AxoList.Body>
          <AxoItem.Group>
            <AxoSelectItem.Root
              label={i18n('icu:WrenProxy__mode-label')}
              description={
                draft.mode === 'tor'
                  ? i18n('icu:WrenProxy__tor-description', {
                      host: TOR_HOST,
                      port: String(TOR_DEFAULT_PORT),
                      browserPort: String(TOR_BROWSER_PORT),
                    })
                  : i18n('icu:WrenProxy__mode-description')
              }
              placeholder=""
              value={draft.mode}
              onValueChange={value => {
                if (isProxyMode(value)) {
                  update({ mode: value });
                }
              }}
              options={PROXY_MODES.map(mode => ({
                value: mode,
                label: modeLabel(i18n, mode),
              }))}
            />
          </AxoItem.Group>
        </AxoList.Body>
      </AxoList.Root>
      {draft.mode !== 'off' && (
        <AxoFieldList.Root>
          {draft.mode === 'tor' && (
            <TextField
              value={draft.torPort}
              onValueChange={torPort => update({ torPort })}
              placeholder={i18n('icu:WrenProxy__port-label')}
              maxLength={5}
            />
          )}
          {draft.mode === 'socks5' && (
            <>
              <TextField
                value={draft.host}
                onValueChange={host => update({ host })}
                placeholder={i18n('icu:WrenProxy__host-label')}
                maxLength={253}
              />
              <TextField
                value={draft.port}
                onValueChange={port => update({ port })}
                placeholder={i18n('icu:WrenProxy__port-label')}
                maxLength={5}
              />
              <TextField
                value={draft.username}
                onValueChange={username => update({ username })}
                placeholder={i18n('icu:WrenProxy__username-label')}
                maxLength={MAX_CREDENTIAL_BYTES}
              />
              <AxoFieldList.Item>
                <AxoPasswordField.Root
                  value={draft.password}
                  onValueChange={password => update({ password })}
                  maxGraphemes={MAX_CREDENTIAL_BYTES}
                  maxBytes={MAX_CREDENTIAL_BYTES}
                >
                  <AxoPasswordField.Input
                    placeholder={i18n('icu:WrenProxy__password-label')}
                    autoComplete="new-password"
                  />
                  <AxoPasswordField.Reveal />
                </AxoPasswordField.Root>
              </AxoFieldList.Item>
            </>
          )}
          {draft.mode === 'http' && (
            <TextField
              value={draft.httpUrl}
              onValueChange={httpUrl => update({ httpUrl })}
              placeholder={i18n('icu:WrenProxy__url-label')}
              maxLength={2048}
            />
          )}
        </AxoFieldList.Root>
      )}
      <AxoList.Root>
        <AxoList.Body>
          <AxoItem.Group>
            {draft.mode !== 'off' && (
              <AxoSwitchItem.Root
                label={i18n('icu:WrenProxy__only-label')}
                description={i18n('icu:WrenProxy__only-description')}
                checked={draft.onlyThroughProxy}
                onCheckedChange={onlyThroughProxy =>
                  update({ onlyThroughProxy })
                }
              />
            )}
            <ActionRow
              label={i18n('icu:WrenProxy__apply-label')}
              description={i18n('icu:WrenProxy__apply-description')}
            >
              {draft.mode !== 'off' && (
                <AxoItem.Action
                  variant="subtle-secondary"
                  pending={testing}
                  onClick={() => drop(runTest())}
                >
                  {i18n('icu:WrenProxy__test')}
                </AxoItem.Action>
              )}
              <AxoItem.Action
                variant="subtle-secondary"
                pending={saving}
                onClick={() => drop(save())}
              >
                {i18n('icu:WrenProxy__save')}
              </AxoItem.Action>
              {status.needsRelaunch && (
                <AxoItem.Action
                  variant="strong-affirmative"
                  onClick={() => api.relaunch()}
                >
                  {i18n('icu:WrenProxy__relaunch')}
                </AxoItem.Action>
              )}
            </ActionRow>
          </AxoItem.Group>
          {notice != null && (
            <p
              role={notice.kind}
              className={tw(
                'px-4 py-2 type-body-small',
                notice.kind === 'alert' ? 'text-destructive' : 'text-secondary'
              )}
            >
              {notice.text}
            </p>
          )}
        </AxoList.Body>
        <AxoList.Footer>
          {footerNotes.map(note => (
            <AxoList.FooterDescription key={note}>
              {note}
            </AxoList.FooterDescription>
          ))}
        </AxoList.Footer>
      </AxoList.Root>
    </>
  );
}

function TextField(
  props: Readonly<{
    value: string;
    onValueChange: (value: string) => void;
    placeholder: string;
    maxLength: number;
  }>
): JSX.Element {
  return (
    <AxoFieldList.Item>
      <AxoTextField.Root
        value={props.value}
        onValueChange={props.onValueChange}
        maxGraphemes={props.maxLength}
        maxBytes={props.maxLength * 4}
      >
        <AxoTextField.Input placeholder={props.placeholder} />
      </AxoTextField.Root>
    </AxoFieldList.Item>
  );
}

function ActionRow(
  props: Readonly<{
    label: string;
    description: string;
    children: ReactNode;
  }>
): JSX.Element {
  return (
    <AxoItem.Root>
      <AxoItem.Content>
        <AxoItem.Label>{props.label}</AxoItem.Label>
        <AxoItem.Description>{props.description}</AxoItem.Description>
        <AxoItem.Accessory>
          <div className={tw('flex gap-2')}>{props.children}</div>
        </AxoItem.Accessory>
      </AxoItem.Content>
    </AxoItem.Root>
  );
}
