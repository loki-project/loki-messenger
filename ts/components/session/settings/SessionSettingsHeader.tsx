import React from 'react';
import { SettingsViewProps } from './SessionSettings';
import { DefaultTheme, withTheme } from 'styled-components';

interface Props extends SettingsViewProps {
  // tslint:disable-next-line: react-unused-props-and-state
  categoryTitle: string;
  // tslint:disable-next-line: react-unused-props-and-state
}

export const SettingsHeader = (props: Props) => {
  const { categoryTitle } = props;
  return (
    <div className="session-settings-header">
      <div className="session-settings-header-title">{categoryTitle}</div>
    </div>
  );
};
