import React, { useEffect } from 'react';
import classNames from 'classnames';

import { SessionIconButton, SessionIconSize, SessionIconType } from './icon/';
import { SessionButton, SessionButtonColor, SessionButtonType } from './SessionButton';
import { DefaultTheme, useTheme } from 'styled-components';

// tslint:disable-next-line: no-submodule-imports
import useKey from 'react-use/lib/useKey';

type Props = {
  title: string;
  onClose: any;
  showExitIcon?: boolean;
  showHeader?: boolean;
  headerReverse?: boolean;
  //Maximum of two icons or buttons in header
  headerIconButtons?: Array<{
    iconType: SessionIconType;
    iconRotation: number;
    onClick?: any;
  }>;
  headerButtons?: Array<{
    buttonType: SessionButtonType;
    buttonColor: SessionButtonColor;
    text: string;
    onClick?: any;
  }>;
  theme: DefaultTheme;
};

export type SessionWrapperModalType = {
  title?: string;
  showHeader?: boolean;
  onConfirm?: () => void;
  onClose?: () => void;
  showClose?: boolean;
  confirmText?: string;
  cancelText?: string;
  showExitIcon?: boolean;
  headerIconButtons?: Array<any>;
  children: any;
  headerReverse?: boolean;
  additionalClassName?: string;
};

export const SessionWrapperModal = (props: SessionWrapperModalType) => {
  const {
    title,
    onConfirm,
    onClose,
    showHeader = true,
    showClose = false,
    confirmText,
    cancelText,
    showExitIcon,
    headerIconButtons,
    headerReverse,
    additionalClassName,
  } = props;

  const theme = useTheme();

  useKey(
    'Esc',
    () => {
      props.onClose?.();
    },
    undefined,
    [props.onClose]
  );

  useKey(
    'Escape',
    () => {
      props.onClose?.();
    },
    undefined,
    [props.onClose]
  );

  return (
    <div className={`loki-dialog modal ${additionalClassName}`}>
      <div className="session-confirm-wrapper">
        <div className="session-modal">
          {showHeader ? (
            <div className={classNames('session-modal__header', headerReverse && 'reverse')}>
              <div className="session-modal__header__close">
                {showExitIcon ? (
                  <SessionIconButton
                    iconType={SessionIconType.Exit}
                    iconSize={SessionIconSize.Small}
                    onClick={props.onClose}
                    theme={theme}
                  />
                ) : null}
              </div>
              <div className="session-modal__header__title">{title}</div>
              <div className="session-modal__header__icons">
                {headerIconButtons
                  ? headerIconButtons.map((iconItem: any) => {
                      return (
                        <SessionIconButton
                          key={iconItem.iconType}
                          iconType={iconItem.iconType}
                          iconSize={SessionIconSize.Large}
                          iconRotation={iconItem.iconRotation}
                          onClick={iconItem.onClick}
                          theme={theme}
                        />
                      );
                    })
                  : null}
              </div>
            </div>
          ) : null}

          <div className="session-modal__body">
            <div className="session-modal__centered">
              {props.children}
              <div className="session-modal__button-group">
                {onConfirm ? (
                  <SessionButton onClick={props.onConfirm}>
                    {confirmText || window.i18n('ok')}
                  </SessionButton>
                ) : null}

                {onClose && showClose ? (
                  <SessionButton onClick={props.onClose}>
                    {cancelText || window.i18n('close')}
                  </SessionButton>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
