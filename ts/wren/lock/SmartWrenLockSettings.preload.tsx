// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { useSelector } from 'react-redux';
import type { JSX } from 'react';

import { getIntl } from '../../state/selectors/user.std.ts';
import { WrenLockSettings } from './WrenLockSettings.dom.tsx';
import { lockSettingsApi } from './settingsIpc.preload.ts';

export function SmartWrenLockSettings(): JSX.Element | null {
  const i18n = useSelector(getIntl);
  return <WrenLockSettings i18n={i18n} api={lockSettingsApi} />;
}
