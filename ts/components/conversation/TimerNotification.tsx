import React, { useContext } from 'react';

import { Intl } from '../Intl';

import { missingCaseError } from '../../util/missingCaseError';
import { SessionIcon, SessionIconSize, SessionIconType } from '../session/icon';
import { ThemeContext } from 'styled-components';
import { PropsForExpirationTimer } from '../../state/ducks/conversations';

export const TimerNotification = (props: PropsForExpirationTimer) => {
  function renderContents() {
    const { phoneNumber, profileName, timespan, type, disabled } = props;
    const changeKey = disabled ? 'disabledDisappearingMessages' : 'theyChangedTheTimer';

    const contact = (
      <span key={`external-${phoneNumber}`} className="module-timer-notification__contact">
        {profileName || phoneNumber}
      </span>
    );

    switch (type) {
      case 'fromOther':
        return <Intl id={changeKey} components={[contact, timespan]} />;
      case 'fromMe':
        return disabled
          ? window.i18n('youDisabledDisappearingMessages')
          : window.i18n('youChangedTheTimer', [timespan]);
      case 'fromSync':
        return disabled
          ? window.i18n('disappearingMessagesDisabled')
          : window.i18n('timerSetOnSync', [timespan]);
      default:
        throw missingCaseError(type);
    }
  }
  const themeContext = useContext(ThemeContext);
  return (
    <div className="module-timer-notification">
      <div className="module-timer-notification__message">
        <div>
          <SessionIcon
            iconType={SessionIconType.Stopwatch}
            iconSize={SessionIconSize.Small}
            iconColor={'#ABABAB'}
            theme={themeContext}
          />
        </div>

        <div>{renderContents()}</div>
      </div>
    </div>
  );
};
