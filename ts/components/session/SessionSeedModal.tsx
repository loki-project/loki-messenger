import React from 'react';

import { SessionModal } from './SessionModal';
import { SessionButton } from './SessionButton';
import { ToastUtils, UserUtils } from '../../session/utils';
import { DefaultTheme, withTheme } from 'styled-components';
import { PasswordUtil } from '../../util';
import { getPasswordHash } from '../../data/data';
import { QRCode } from 'react-qr-svg';
import { mn_decode } from '../../session/crypto/mnemonic';
import { SessionWrapperModal } from './SessionWrapperModal';
import { SpacerLG, SpacerSM, SpacerXS } from '../basic/Text';
import autoBind from 'auto-bind';
import { recoveryPhraseModal } from '../../state/ducks/modalDialog';

interface State {
  error: string;
  loadingPassword: boolean;
  loadingSeed: boolean;
  recoveryPhrase: string;
  hasPassword: boolean | null;
  passwordHash: string;
  passwordValid: boolean;
}

class SessionSeedModalInner extends React.Component<{}, State> {
  constructor(props: any) {
    super(props);

    this.state = {
      error: '',
      loadingPassword: true,
      loadingSeed: true,
      recoveryPhrase: '',
      hasPassword: null,
      passwordHash: '',
      passwordValid: false,
    };

    autoBind(this);
  }

  public componentDidMount() {
    setTimeout(() => ($('#seed-input-password') as any).focus(), 100);
  }

  public render() {
    const i18n = window.i18n;

    void this.checkHasPassword();
    void this.getRecoveryPhrase();

    const { hasPassword, passwordValid } = this.state;
    const loading = this.state.loadingPassword || this.state.loadingSeed;
    const onClose = () => window.inboxStore?.dispatch(recoveryPhraseModal(null));

    return (
      <>
        {!loading && (
          <SessionWrapperModal
            title={i18n('showRecoveryPhrase')}
            onClose={onClose}
            showExitIcon={true}
          >
            <SpacerSM />

            {hasPassword && !passwordValid ? (
              <>{this.renderPasswordView()}</>
            ) : (
              <>{this.renderSeedView()}</>
            )}
          </SessionWrapperModal>
        )}
      </>
    );
  }

  private renderPasswordView() {
    const error = this.state.error;
    const i18n = window.i18n;

    const onClose = () => window.inboxStore?.dispatch(recoveryPhraseModal(null));

    return (
      <>
        <p>{i18n('showRecoveryPhrasePasswordRequest')}</p>
        <input
          type="password"
          id="seed-input-password"
          placeholder={i18n('password')}
          onKeyUp={this.onEnter}
        />

        {error && (
          <>
            <SpacerXS />
            <div className="session-label danger">{error}</div>
          </>
        )}

        <SpacerLG />

        <div className="session-modal__button-group">
          <SessionButton text={i18n('ok')} onClick={this.confirmPassword} />

          <SessionButton text={i18n('cancel')} onClick={onClose} />
        </div>
      </>
    );
  }

  private renderSeedView() {
    const i18n = window.i18n;
    const bgColor = '#FFFFFF';
    const fgColor = '#1B1B1B';

    const hexEncodedSeed = mn_decode(this.state.recoveryPhrase, 'english');

    return (
      <>
        <div className="session-modal__centered text-center">
          <p className="session-modal__description">{i18n('recoveryPhraseSavePromptMain')}</p>
          <SpacerXS />

          <i className="session-modal__text-highlight">{this.state.recoveryPhrase}</i>
        </div>
        <SpacerLG />
        <div className="qr-image">
          <QRCode value={hexEncodedSeed} bgColor={bgColor} fgColor={fgColor} level="L" />
        </div>
        <SpacerLG />
        <div className="session-modal__button-group">
          <SessionButton
            text={i18n('copy')}
            onClick={() => {
              this.copyRecoveryPhrase(this.state.recoveryPhrase);
            }}
          />
        </div>
      </>
    );
  }

  private confirmPassword() {
    const passwordHash = this.state.passwordHash;
    const passwordValue = jQuery('#seed-input-password').val();
    const isPasswordValid = PasswordUtil.matchesHash(passwordValue as string, passwordHash);

    if (!passwordValue) {
      this.setState({
        error: window.i18n('noGivenPassword'),
      });

      return false;
    }

    if (passwordHash && !isPasswordValid) {
      this.setState({
        error: window.i18n('invalidPassword'),
      });

      return false;
    }

    this.setState({
      passwordValid: true,
      error: '',
    });

    window.removeEventListener('keyup', this.onEnter);

    return true;
  }

  private async checkHasPassword() {
    if (!this.state.loadingPassword) {
      return;
    }

    const hash = await getPasswordHash();
    this.setState({
      hasPassword: !!hash,
      passwordHash: hash || '',
      loadingPassword: false,
    });
  }

  private async getRecoveryPhrase() {
    if (this.state.recoveryPhrase) {
      return false;
    }

    const recoveryPhrase = UserUtils.getCurrentRecoveryPhrase();

    this.setState({
      recoveryPhrase,
      loadingSeed: false,
    });

    return true;
  }

  private copyRecoveryPhrase(recoveryPhrase: string) {
    window.clipboard.writeText(recoveryPhrase);

    ToastUtils.pushCopiedToClipBoard();
    window.inboxStore?.dispatch(recoveryPhraseModal(null));
  }

  private onEnter(event: any) {
    if (event.key === 'Enter') {
      this.confirmPassword();
    }
  }
}

export const SessionSeedModal = withTheme(SessionSeedModalInner);
