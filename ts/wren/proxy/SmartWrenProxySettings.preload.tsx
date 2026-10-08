// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { useSelector } from 'react-redux';
import type { JSX } from 'react';

import { getIntl } from '../../state/selectors/user.std.ts';
import { WrenProxySettings } from './WrenProxySettings.dom.tsx';
import { proxySettingsApi } from './settingsIpc.preload.ts';

export function SmartWrenProxySettings(): JSX.Element | null {
  const i18n = useSelector(getIntl);
  return <WrenProxySettings i18n={i18n} api={proxySettingsApi} />;
}
