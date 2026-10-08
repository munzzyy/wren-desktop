// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';

import { AxoDialog } from '../../axo/AxoDialog.dom.tsx';
import { AxoAlertDialog } from '../../axo/AxoAlertDialog.dom.tsx';
import { AxoCheckbox } from '../../axo/AxoCheckbox.dom.tsx';
import { AxoPasswordField } from '../../axo/fields/AxoPasswordField.dom.tsx';
import { AxoRadioGroup } from '../../axo/controls/AxoRadioGroup.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';
import type { LocalizerType } from '../../types/I18N.std.ts';
import {
  isExportFormat,
  type ExportFormat,
} from '../../wren/export/model.std.ts';
import { ProgressBar } from '../ProgressBar.dom.tsx';
import { drop } from '../../util/drop.std.ts';

export type ExportChatProgress = Readonly<{
  processed: number;
  total: number;
}>;

export type ExportChatRunner = (
  options: Readonly<{
    format: ExportFormat;
    includeMedia: boolean;
    passphrase?: string;
  }>,
  onProgress: (progress: ExportChatProgress) => void,
  signal: AbortSignal
) => Promise<'wrong-passphrase' | void>;

export type ExportChatDialogProps = Readonly<{
  i18n: LocalizerType;
  isPassphraseRequired: () => Promise<boolean>;
  onClose: () => void;
  onExport: ExportChatRunner;
}>;

type Step = 'options' | 'running' | 'error';

export const ExportChatDialog = memo(function ExportChatDialog({
  i18n,
  isPassphraseRequired,
  onClose,
  onExport,
}: ExportChatDialogProps) {
  const [step, setStep] = useState<Step>('options');
  const [format, setFormat] = useState<ExportFormat>('html');
  const [includeMedia, setIncludeMedia] = useState(true);
  const [needsPassphrase, setNeedsPassphrase] = useState<boolean>();
  const [passphrase, setPassphrase] = useState('');
  const [passphraseError, setPassphraseError] = useState(false);
  const [progress, setProgress] = useState<ExportChatProgress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const formatLabelId = useId();

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    drop(
      (async () => {
        let required: boolean;
        try {
          required = await isPassphraseRequired();
        } catch {
          required = true;
        }
        if (active) {
          setNeedsPassphrase(required);
        }
      })()
    );
    return () => {
      active = false;
    };
  }, [isPassphraseRequired]);

  const handleFormatChange = useCallback((value: string) => {
    if (isExportFormat(value)) {
      setFormat(value);
    }
  }, []);

  const handleCancel = useCallback(() => {
    controllerRef.current?.abort();
    onClose();
  }, [onClose]);

  const handleExport = useCallback(async () => {
    if (needsPassphrase == null || (needsPassphrase && !passphrase)) {
      setPassphraseError(needsPassphrase === true);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress(null);
    setPassphraseError(false);
    setStep('running');

    let failed = false;
    let outcome: 'wrong-passphrase' | void = undefined;
    try {
      outcome = await onExport(
        {
          format,
          includeMedia,
          passphrase: needsPassphrase ? passphrase : undefined,
        },
        setProgress,
        controller.signal
      );
    } catch {
      failed = true;
    }

    if (controllerRef.current === controller) {
      controllerRef.current = null;
    }
    if (controller.signal.aborted) {
      return;
    }
    if (outcome === 'wrong-passphrase') {
      setPassphrase('');
      setPassphraseError(true);
      setStep('options');
    } else if (failed) {
      setStep('error');
    } else {
      onClose();
    }
  }, [format, includeMedia, needsPassphrase, onClose, onExport, passphrase]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  if (step === 'error') {
    return (
      <AxoAlertDialog.Root open onOpenChange={handleOpenChange}>
        <AxoAlertDialog.Content escape="cancel-is-noop">
          <AxoAlertDialog.Body>
            <AxoAlertDialog.Title>
              {i18n('icu:ExportChatDialog__error-title')}
            </AxoAlertDialog.Title>
            <AxoAlertDialog.Description>
              {i18n('icu:ExportChatDialog__error')}
            </AxoAlertDialog.Description>
          </AxoAlertDialog.Body>
          <AxoAlertDialog.Footer>
            <AxoAlertDialog.Action variant="strong-primary" onClick={onClose}>
              {i18n('icu:ok')}
            </AxoAlertDialog.Action>
          </AxoAlertDialog.Footer>
        </AxoAlertDialog.Content>
      </AxoAlertDialog.Root>
    );
  }

  if (step === 'running') {
    const fraction =
      progress != null && progress.total > 0
        ? Math.min(1, progress.processed / progress.total)
        : null;
    return (
      <AxoDialog.Root open onOpenChange={handleOpenChange}>
        <AxoDialog.Content size="sm" escape="cancel-is-destructive">
          <AxoDialog.Header>
            <AxoDialog.Title>
              {i18n('icu:ExportChatDialog__progress-title')}
            </AxoDialog.Title>
          </AxoDialog.Header>
          <AxoDialog.Body>
            <div className={tw('flex flex-col gap-3 py-4')}>
              <ProgressBar
                fractionComplete={fraction}
                isRTL={i18n.getLocaleDirection() === 'rtl'}
              />
              <AxoDialog.Description>
                {progress != null
                  ? i18n('icu:ExportChatDialog__progress', {
                      processed: progress.processed,
                      total: progress.total,
                    })
                  : i18n('icu:ExportChatDialog__warning')}
              </AxoDialog.Description>
            </div>
          </AxoDialog.Body>
          <AxoDialog.Footer>
            <AxoDialog.Actions>
              <AxoDialog.Action
                variant="strong-secondary"
                onClick={handleCancel}
              >
                {i18n('icu:cancel')}
              </AxoDialog.Action>
            </AxoDialog.Actions>
          </AxoDialog.Footer>
        </AxoDialog.Content>
      </AxoDialog.Root>
    );
  }

  return (
    <AxoDialog.Root open onOpenChange={handleOpenChange}>
      <AxoDialog.Content size="sm" escape="cancel-is-noop">
        <AxoDialog.Header>
          <AxoDialog.Title>
            {i18n('icu:ExportChatDialog__title')}
          </AxoDialog.Title>
          <AxoDialog.Close />
        </AxoDialog.Header>
        <AxoDialog.Body>
          <div className={tw('flex flex-col gap-3 pb-2')}>
            <div
              id={formatLabelId}
              className={tw('type-body-medium font-semibold text-secondary')}
            >
              {i18n('icu:ExportChatDialog__format')}
            </div>
            <div role="group" aria-labelledby={formatLabelId}>
              <AxoRadioGroup.Root
                value={format}
                onValueChange={handleFormatChange}
              >
                <AxoRadioGroup.Item value="html">
                  <AxoRadioGroup.Label>
                    {i18n('icu:ExportChatDialog__format--html')}
                  </AxoRadioGroup.Label>
                </AxoRadioGroup.Item>
                <AxoRadioGroup.Item value="text">
                  <AxoRadioGroup.Label>
                    {i18n('icu:ExportChatDialog__format--text')}
                  </AxoRadioGroup.Label>
                </AxoRadioGroup.Item>
                <AxoRadioGroup.Item value="json">
                  <AxoRadioGroup.Label>
                    {i18n('icu:ExportChatDialog__format--json')}
                  </AxoRadioGroup.Label>
                </AxoRadioGroup.Item>
              </AxoRadioGroup.Root>
            </div>
            <label
              className={tw(
                'flex items-center gap-3 py-1 type-body-large text-primary'
              )}
            >
              <AxoCheckbox.Root
                variant="square"
                checked={includeMedia}
                onCheckedChange={setIncludeMedia}
              />
              {i18n('icu:ExportChatDialog__include-media')}
            </label>
            <AxoDialog.Description>
              {i18n('icu:ExportChatDialog__warning')}
            </AxoDialog.Description>
            {needsPassphrase && (
              <>
                <AxoPasswordField.Root
                  value={passphrase}
                  onValueChange={setPassphrase}
                  maxGraphemes={1024}
                  maxBytes={4096}
                >
                  <AxoPasswordField.Input
                    placeholder={i18n('icu:ExportChatDialog__passphrase')}
                    autoComplete="current-password"
                  />
                  <AxoPasswordField.Reveal />
                </AxoPasswordField.Root>
                {passphraseError && (
                  <p
                    role="alert"
                    className={tw('type-body-small text-destructive')}
                  >
                    {i18n('icu:ExportChatDialog__passphrase-wrong')}
                  </p>
                )}
              </>
            )}
          </div>
        </AxoDialog.Body>
        <AxoDialog.Footer>
          <AxoDialog.Actions>
            <AxoDialog.Action variant="strong-secondary" onClick={onClose}>
              {i18n('icu:cancel')}
            </AxoDialog.Action>
            <AxoDialog.Action
              variant="strong-primary"
              disabled={needsPassphrase == null}
              onClick={() => drop(handleExport())}
            >
              {i18n('icu:ExportChatDialog__export')}
            </AxoDialog.Action>
          </AxoDialog.Actions>
        </AxoDialog.Footer>
      </AxoDialog.Content>
    </AxoDialog.Root>
  );
});
