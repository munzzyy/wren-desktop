// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import type { LocalizerType } from '../../types/I18N.std.ts';
import { AxoDialog } from '../../axo/AxoDialog.dom.tsx';
import { AxoPasswordField } from '../../axo/fields/AxoPasswordField.dom.tsx';
import { AxoItem } from '../../axo/items/AxoItem.dom.tsx';
import { AxoList } from '../../axo/items/AxoList.dom.tsx';
import { AxoSelectItem } from '../../axo/items/AxoSelectItem.dom.tsx';
import { AxoSwitchItem } from '../../axo/items/AxoSwitchItem.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';
import { drop } from '../../util/drop.std.ts';
import { count as countGraphemes } from '../../util/grapheme.std.ts';
import { WIPE_AFTER_OPTIONS, isWipeAfter } from './failedAttemptPolicy.std.ts';
import { AUTO_LOCK_OPTIONS, isAutoLockMinutes } from './lockState.std.ts';
import type { PassphraseStrengthType } from './passphraseStrength.std.ts';
import { getPassphraseStrength } from './passphraseStrength.std.ts';
import { missingCaseError } from '../../util/missingCaseError.std.ts';
import type {
  LockErrorType,
  LockResultType,
  LockSettingsApiType,
  LockStatusType,
} from './types.std.ts';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from './types.std.ts';

export type WrenLockSettingsProps = Readonly<{
  i18n: LocalizerType;
  api: LockSettingsApiType;
}>;

type DialogModeType = 'set' | 'change' | 'off' | 'duress';

export function WrenLockSettings({
  i18n,
  api,
}: WrenLockSettingsProps): JSX.Element | null {
  const [status, setStatus] = useState<LockStatusType>();
  const [dialogMode, setDialogMode] = useState<DialogModeType>();

  useEffect(() => {
    let active = true;
    drop(
      (async () => {
        const next = await api.getStatus();
        if (active) {
          setStatus(next);
        }
      })()
    );
    return () => {
      active = false;
    };
  }, [api]);

  const apply = useCallback(async (request: Promise<LockResultType>) => {
    const result = await request;
    if (result.ok) {
      setStatus(result.status);
    }
  }, []);

  if (!status) {
    return null;
  }

  return (
    <>
      <AxoList.Root>
        <AxoList.Header>
          <AxoList.Label>{i18n('icu:WrenLock__section')}</AxoList.Label>
        </AxoList.Header>
        <AxoList.Body>
          <AxoItem.Group>
            <ActionRow
              label={i18n('icu:WrenLock__passphrase-label')}
              description={
                status.enabled
                  ? i18n('icu:WrenLock__passphrase-description--on')
                  : i18n('icu:WrenLock__passphrase-description--off')
              }
            >
              {status.enabled ? (
                <>
                  <AxoItem.Action
                    variant="subtle-secondary"
                    onClick={() => api.lockNow()}
                  >
                    {i18n('icu:WrenLock__lock-now')}
                  </AxoItem.Action>
                  <AxoItem.Action
                    variant="subtle-secondary"
                    onClick={() => setDialogMode('change')}
                  >
                    {i18n('icu:WrenLock__change')}
                  </AxoItem.Action>
                  <AxoItem.Action
                    variant="subtle-destructive"
                    onClick={() => setDialogMode('off')}
                  >
                    {i18n('icu:WrenLock__turn-off')}
                  </AxoItem.Action>
                </>
              ) : (
                <AxoItem.Action
                  variant="subtle-secondary"
                  onClick={() => setDialogMode('set')}
                >
                  {i18n('icu:WrenLock__set')}
                </AxoItem.Action>
              )}
            </ActionRow>
            {status.enabled && (
              <>
                <ActionRow
                  label={i18n('icu:WrenLock__duress-label')}
                  description={
                    status.hasDuress
                      ? i18n('icu:WrenLock__duress-description--on')
                      : i18n('icu:WrenLock__duress-description--off')
                  }
                >
                  {status.hasDuress ? (
                    <AxoItem.Action
                      variant="subtle-destructive"
                      onClick={() => drop(apply(api.clearDuress()))}
                    >
                      {i18n('icu:WrenLock__duress-remove')}
                    </AxoItem.Action>
                  ) : (
                    <AxoItem.Action
                      variant="subtle-secondary"
                      onClick={() => setDialogMode('duress')}
                    >
                      {i18n('icu:WrenLock__duress-set')}
                    </AxoItem.Action>
                  )}
                </ActionRow>
                <AxoSelectItem.Root
                  label={i18n('icu:WrenLock__wipe-after-label')}
                  description={i18n('icu:WrenLock__wipe-after-description')}
                  placeholder=""
                  value={String(status.wipeAfter)}
                  onValueChange={value => {
                    const parsed = Number(value);
                    if (isWipeAfter(parsed)) {
                      drop(apply(api.setWipeAfter(parsed)));
                    }
                  }}
                  options={WIPE_AFTER_OPTIONS.map(count => ({
                    value: String(count),
                    label:
                      count === 0
                        ? i18n('icu:WrenLock__wipe-after-off')
                        : i18n('icu:WrenLock__wipe-after-count', { count }),
                  }))}
                />
                <AxoSelectItem.Root
                  label={i18n('icu:WrenLock__auto-lock-label')}
                  description={i18n('icu:WrenLock__auto-lock-description')}
                  placeholder=""
                  value={String(status.autoLockMinutes)}
                  onValueChange={value => {
                    const parsed = Number(value);
                    if (isAutoLockMinutes(parsed)) {
                      drop(apply(api.setAutoLockMinutes(parsed)));
                    }
                  }}
                  options={AUTO_LOCK_OPTIONS.map(minutes => ({
                    value: String(minutes),
                    label:
                      minutes === 0
                        ? i18n('icu:WrenLock__auto-lock-never')
                        : i18n('icu:WrenLock__auto-lock-minutes', { minutes }),
                  }))}
                />
                <AxoSwitchItem.Root
                  label={i18n('icu:WrenLock__system-lock-label')}
                  description={i18n('icu:WrenLock__system-lock-description')}
                  checked={status.lockOnSystemLock}
                  onCheckedChange={checked =>
                    drop(apply(api.setLockOnSystemLock(checked)))
                  }
                />
              </>
            )}
          </AxoItem.Group>
        </AxoList.Body>
        <AxoList.Footer>
          <AxoList.FooterDescription>
            {i18n('icu:WrenLock__section-footer')}
          </AxoList.FooterDescription>
        </AxoList.Footer>
      </AxoList.Root>
      {dialogMode && (
        <PassphraseDialog
          i18n={i18n}
          api={api}
          mode={dialogMode}
          onClose={() => setDialogMode(undefined)}
          onDone={next => {
            setStatus(next);
            setDialogMode(undefined);
          }}
        />
      )}
    </>
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

function errorMessage(i18n: LocalizerType, error: LockErrorType): string {
  switch (error) {
    case 'wrong-passphrase':
      return i18n('icu:WrenLock__error-wrong');
    case 'too-short':
      return i18n('icu:WrenLock__error-too-short', {
        min: MIN_PASSPHRASE_LENGTH,
      });
    case 'same-as-passphrase':
      return i18n('icu:WrenLock__error-same-as-passphrase');
    case 'same-as-duress':
      return i18n('icu:WrenLock__error-same-as-duress');
    case 'not-enabled':
    case 'already-enabled':
    case 'failed':
      return i18n('icu:WrenLock__error-failed');
    default:
      throw missingCaseError(error);
  }
}

function strengthText(
  i18n: LocalizerType,
  strength: PassphraseStrengthType
): string {
  switch (strength) {
    case 'strong':
      return i18n('icu:WrenLock__strength-strong');
    case 'fair':
      return i18n('icu:WrenLock__strength-fair');
    case 'weak':
      return i18n('icu:WrenLock__strength-weak');
    default:
      throw missingCaseError(strength);
  }
}

function PassphraseField(
  props: Readonly<{
    value: string;
    onValueChange: (value: string) => void;
    placeholder: string;
    autoComplete: AxoPasswordField.AutoComplete;
    autoFocus?: boolean;
    disabled: boolean;
  }>
): JSX.Element {
  return (
    <AxoPasswordField.Root
      value={props.value}
      onValueChange={props.onValueChange}
      maxGraphemes={MAX_PASSPHRASE_LENGTH}
      maxBytes={MAX_PASSPHRASE_LENGTH * 4}
      disabled={props.disabled}
    >
      <AxoPasswordField.Input
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
      />
      <AxoPasswordField.Reveal />
    </AxoPasswordField.Root>
  );
}

function PassphraseDialog({
  i18n,
  api,
  mode,
  onClose,
  onDone,
}: Readonly<{
  i18n: LocalizerType;
  api: LockSettingsApiType;
  mode: DialogModeType;
  onClose: () => void;
  onDone: (status: LockStatusType) => void;
}>): JSX.Element {
  const formId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const needsCurrent = mode === 'change' || mode === 'off';
  const needsNext = mode !== 'off';

  let title: string;
  let body: string | undefined;
  switch (mode) {
    case 'set':
      title = i18n('icu:WrenLock__dialog-set-title');
      body = i18n('icu:WrenLock__dialog-set-body');
      break;
    case 'change':
      title = i18n('icu:WrenLock__dialog-change-title');
      break;
    case 'off':
      title = i18n('icu:WrenLock__dialog-off-title');
      body = i18n('icu:WrenLock__dialog-off-body');
      break;
    case 'duress':
      title = i18n('icu:WrenLock__dialog-duress-title');
      body = i18n('icu:WrenLock__dialog-duress-body');
      break;
    default:
      title = '';
  }

  const strengthNote =
    mode === 'duress' || !next
      ? undefined
      : strengthText(i18n, getPassphraseStrength(next));

  const submit = async () => {
    if (pending) {
      return;
    }
    if (needsNext) {
      if (countGraphemes(next) < MIN_PASSPHRASE_LENGTH) {
        setError(errorMessage(i18n, 'too-short'));
        return;
      }
      if (next !== repeat) {
        setError(i18n('icu:WrenLock__error-mismatch'));
        return;
      }
    }
    if (needsCurrent && !current) {
      setError(errorMessage(i18n, 'wrong-passphrase'));
      return;
    }

    setError(undefined);
    setPending(true);
    let result: LockResultType;
    try {
      if (mode === 'set') {
        result = await api.enable(next);
      } else if (mode === 'change') {
        result = await api.change(current, next);
      } else if (mode === 'off') {
        result = await api.disable(current);
      } else {
        result = await api.setDuress(next);
      }
    } catch {
      result = { ok: false, error: 'failed' };
    }
    setPending(false);

    if (result.ok) {
      onDone(result.status);
      return;
    }
    setError(errorMessage(i18n, result.error));
  };

  return (
    <AxoDialog.Root
      open
      onOpenChange={open => {
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <AxoDialog.Content size="md" escape="cancel-is-noop">
        <AxoDialog.Header>
          <AxoDialog.Title>{title}</AxoDialog.Title>
          <AxoDialog.Close />
        </AxoDialog.Header>
        <AxoDialog.Body>
          <form
            id={formId}
            className={tw('flex flex-col gap-3 pb-2')}
            onSubmit={event => {
              event.preventDefault();
              drop(submit());
            }}
          >
            {body != null && (
              <AxoDialog.Description>
                <p className={tw('type-body-medium text-secondary')}>{body}</p>
              </AxoDialog.Description>
            )}
            {needsCurrent && (
              <PassphraseField
                value={current}
                onValueChange={setCurrent}
                placeholder={i18n('icu:WrenLock__field-current')}
                autoComplete="current-password"
                autoFocus
                disabled={pending}
              />
            )}
            {needsNext && (
              <>
                <PassphraseField
                  value={next}
                  onValueChange={setNext}
                  placeholder={
                    mode === 'duress'
                      ? i18n('icu:WrenLock__field-duress')
                      : i18n('icu:WrenLock__field-new')
                  }
                  autoComplete="new-password"
                  autoFocus={!needsCurrent}
                  disabled={pending}
                />
                <PassphraseField
                  value={repeat}
                  onValueChange={setRepeat}
                  placeholder={i18n('icu:WrenLock__field-repeat')}
                  autoComplete="new-password"
                  disabled={pending}
                />
              </>
            )}
            {strengthNote != null && (
              <p className={tw('type-body-small text-secondary')}>
                {strengthNote}
              </p>
            )}
            {pending && (
              <p className={tw('type-body-small text-secondary')}>
                {i18n('icu:WrenLock__working')}
              </p>
            )}
            {error != null && (
              <p
                role="alert"
                className={tw('type-body-small text-destructive')}
              >
                {error}
              </p>
            )}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </AxoDialog.Body>
        <AxoDialog.Footer>
          <AxoDialog.Actions>
            <AxoDialog.Action
              variant="strong-secondary"
              disabled={pending}
              onClick={onClose}
            >
              {i18n('icu:cancel')}
            </AxoDialog.Action>
            <AxoDialog.Action
              variant={mode === 'off' ? 'strong-destructive' : 'strong-primary'}
              pending={pending}
              onClick={() => drop(submit())}
            >
              {mode === 'off'
                ? i18n('icu:WrenLock__turn-off')
                : i18n('icu:WrenLock__save')}
            </AxoDialog.Action>
          </AxoDialog.Actions>
        </AxoDialog.Footer>
      </AxoDialog.Content>
    </AxoDialog.Root>
  );
}
