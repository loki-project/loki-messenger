import React from 'react';
import classNames from 'classnames';

import { Avatar, AvatarSize } from '../Avatar';
import { Spinner } from '../basic/Spinner';
import { MessageBody } from './MessageBody';
import { ImageGrid } from './ImageGrid';
import { Image } from './Image';
import { ContactName } from './ContactName';
import { Quote } from './Quote';

import {
  canDisplayImage,
  getExtensionForDisplay,
  getGridDimensions,
  getImageDimensions,
  hasImage,
  hasVideoScreenshot,
  isAudio,
  isImage,
  isImageAttachment,
  isVideo,
} from '../../../ts/types/Attachment';
import { AttachmentType } from '../../types/Attachment';

import { getIncrement } from '../../util/timer';
import { isFileDangerous } from '../../util/isFileDangerous';
import _ from 'lodash';
import { animation, contextMenu, Item, Menu } from 'react-contexify';
import uuid from 'uuid';
import { InView } from 'react-intersection-observer';
import { withTheme } from 'styled-components';
import { MessageMetadata } from './message/MessageMetadata';
import { PubKey } from '../../session/types';
import { MessageRegularProps } from '../../models/messageType';
import {
  addSenderAsModerator,
  removeSenderFromModerator,
} from '../../interactions/messageInteractions';
import { updateUserDetailsModal } from '../../state/ducks/modalDialog';
import { MessageInteraction } from '../../interactions';
import autoBind from 'auto-bind';
import { AudioPlayerWithEncryptedFile } from './H5AudioPlayer';
import { ClickToTrustSender } from './message/ClickToTrustSender';
import { ReadableMessage } from './ReadableMessage';

// Same as MIN_WIDTH in ImageGrid.tsx
const MINIMUM_LINK_PREVIEW_IMAGE_WIDTH = 200;

interface State {
  expiring: boolean;
  expired: boolean;
  imageBroken: boolean;
}

const EXPIRATION_CHECK_MINIMUM = 2000;
const EXPIRED_DELAY = 600;

class MessageInner extends React.PureComponent<MessageRegularProps, State> {
  public expirationCheckInterval: any;
  public expiredTimeout: any;
  public ctxMenuID: string;

  public constructor(props: MessageRegularProps) {
    super(props);
    autoBind(this);

    this.state = {
      expiring: false,
      expired: false,
      imageBroken: false,
    };
    this.ctxMenuID = `ctx-menu-message-${uuid()}`;
  }

  public componentDidMount() {
    const { expirationLength } = this.props;
    if (!expirationLength) {
      return;
    }

    const increment = getIncrement(expirationLength);
    const checkFrequency = Math.max(EXPIRATION_CHECK_MINIMUM, increment);

    this.checkExpired();

    this.expirationCheckInterval = setInterval(() => {
      this.checkExpired();
    }, checkFrequency);
  }

  public componentWillUnmount() {
    if (this.expirationCheckInterval) {
      clearInterval(this.expirationCheckInterval);
    }
    if (this.expiredTimeout) {
      clearTimeout(this.expiredTimeout);
    }
  }

  public componentDidUpdate() {
    this.checkExpired();
  }

  public checkExpired() {
    const now = Date.now();
    const { isExpired, expirationTimestamp, expirationLength } = this.props;

    if (!expirationTimestamp || !expirationLength) {
      return;
    }
    if (this.expiredTimeout) {
      return;
    }

    if (isExpired || now >= expirationTimestamp) {
      this.setState({
        expiring: true,
      });

      const setExpired = () => {
        this.setState({
          expired: true,
        });
      };
      this.expiredTimeout = setTimeout(setExpired, EXPIRED_DELAY);
    }
  }

  public handleImageError() {
    this.setState({
      imageBroken: true,
    });
  }

  // tslint:disable-next-line max-func-body-length cyclomatic-complexity
  public renderAttachment() {
    const {
      id,
      attachments,
      text,
      collapseMetadata,
      conversationType,
      direction,
      quote,
      onClickAttachment,
      multiSelectMode,
      onSelectMessage,
      isTrustedForAttachmentDownload,
    } = this.props;
    const { imageBroken } = this.state;

    if (!attachments || !attachments[0]) {
      return null;
    }
    const firstAttachment = attachments[0];

    // For attachments which aren't full-frame
    const withContentBelow = Boolean(text);
    const withContentAbove =
      Boolean(quote) || (conversationType === 'group' && direction === 'incoming');
    const displayImage = canDisplayImage(attachments);

    if (!isTrustedForAttachmentDownload) {
      return <ClickToTrustSender messageId={id} />;
    }

    if (
      displayImage &&
      !imageBroken &&
      ((isImage(attachments) && hasImage(attachments)) ||
        (isVideo(attachments) && hasVideoScreenshot(attachments)))
    ) {
      return (
        <div
          className={classNames(
            'module-message__attachment-container',
            withContentAbove ? 'module-message__attachment-container--with-content-above' : null,
            withContentBelow ? 'module-message__attachment-container--with-content-below' : null
          )}
        >
          <ImageGrid
            attachments={attachments}
            withContentAbove={withContentAbove}
            withContentBelow={withContentBelow}
            bottomOverlay={!collapseMetadata}
            onError={this.handleImageError}
            onClickAttachment={(attachment: AttachmentType) => {
              if (multiSelectMode) {
                onSelectMessage(id);
              } else if (onClickAttachment) {
                onClickAttachment(attachment);
              }
            }}
          />
        </div>
      );
    } else if (!firstAttachment.pending && isAudio(attachments)) {
      return (
        <div
          role="main"
          onClick={(e: any) => {
            e.stopPropagation();
          }}
        >
          <AudioPlayerWithEncryptedFile
            src={firstAttachment.url}
            contentType={firstAttachment.contentType}
            playNextMessage={this.props.playNextMessage}
            playableMessageIndex={this.props.playableMessageIndex}
            nextMessageToPlay={this.props.nextMessageToPlay}
          />
        </div>
      );
    } else {
      const { pending, fileName, fileSize, contentType } = firstAttachment;
      const extension = getExtensionForDisplay({ contentType, fileName });
      const isDangerous = isFileDangerous(fileName || '');

      return (
        <div
          className={classNames(
            'module-message__generic-attachment',
            withContentBelow ? 'module-message__generic-attachment--with-content-below' : null,
            withContentAbove ? 'module-message__generic-attachment--with-content-above' : null
          )}
        >
          {pending ? (
            <div className="module-message__generic-attachment__spinner-container">
              <Spinner size="small" direction={direction} />
            </div>
          ) : (
            <div className="module-message__generic-attachment__icon-container">
              <div
                role="button"
                className="module-message__generic-attachment__icon"
                onClick={(e: any) => {
                  if (this.props?.onDownload) {
                    e.stopPropagation();
                    this.props.onDownload(firstAttachment);
                  }
                }}
              >
                {extension ? (
                  <div className="module-message__generic-attachment__icon__extension">
                    {extension}
                  </div>
                ) : null}
              </div>
              {isDangerous ? (
                <div className="module-message__generic-attachment__icon-dangerous-container">
                  <div className="module-message__generic-attachment__icon-dangerous" />
                </div>
              ) : null}
            </div>
          )}
          <div className="module-message__generic-attachment__text">
            <div
              className={classNames(
                'module-message__generic-attachment__file-name',
                `module-message__generic-attachment__file-name--${direction}`
              )}
            >
              {fileName}
            </div>
            <div
              className={classNames(
                'module-message__generic-attachment__file-size',
                `module-message__generic-attachment__file-size--${direction}`
              )}
            >
              {fileSize}
            </div>
          </div>
        </div>
      );
    }
  }

  // tslint:disable-next-line cyclomatic-complexity
  public renderPreview() {
    const {
      attachments,
      conversationType,
      direction,
      onClickLinkPreview,
      previews,
      quote,
    } = this.props;

    // Attachments take precedence over Link Previews
    if (attachments && attachments.length) {
      return null;
    }

    if (!previews || previews.length < 1) {
      return null;
    }

    const first = previews[0];
    if (!first) {
      return null;
    }

    const withContentAbove =
      Boolean(quote) || (conversationType === 'group' && direction === 'incoming');

    const previewHasImage = first.image && isImageAttachment(first.image);
    const width = first.image && first.image.width;
    const isFullSizeImage = width && width >= MINIMUM_LINK_PREVIEW_IMAGE_WIDTH;

    return (
      <div
        role="button"
        className={classNames(
          'module-message__link-preview',
          withContentAbove ? 'module-message__link-preview--with-content-above' : null
        )}
        onClick={() => {
          if (onClickLinkPreview) {
            onClickLinkPreview(first.url);
          }
        }}
      >
        {first.image && previewHasImage && isFullSizeImage ? (
          <ImageGrid
            attachments={[first.image]}
            withContentAbove={withContentAbove}
            withContentBelow={true}
            onError={this.handleImageError}
          />
        ) : null}
        <div
          className={classNames(
            'module-message__link-preview__content',
            withContentAbove || isFullSizeImage
              ? 'module-message__link-preview__content--with-content-above'
              : null
          )}
        >
          {first.image && previewHasImage && !isFullSizeImage ? (
            <div className="module-message__link-preview__icon_container">
              <Image
                smallCurveTopLeft={!withContentAbove}
                softCorners={true}
                alt={window.i18n('previewThumbnail', [first.domain])}
                height={72}
                width={72}
                url={first.image.url}
                attachment={first.image}
                onError={this.handleImageError}
              />
            </div>
          ) : null}
          <div
            className={classNames(
              'module-message__link-preview__text',
              previewHasImage && !isFullSizeImage
                ? 'module-message__link-preview__text--with-icon'
                : null
            )}
          >
            <div className="module-message__link-preview__title">{first.title}</div>
            <div className="module-message__link-preview__location">{first.domain}</div>
          </div>
        </div>
      </div>
    );
  }

  public renderQuote() {
    const {
      conversationType,
      direction,
      quote,
      isPublic,
      convoId,
      id,
      multiSelectMode,
    } = this.props;

    if (!quote || !quote.authorPhoneNumber) {
      return null;
    }

    const withContentAbove = conversationType === 'group' && direction === 'incoming';

    const shortenedPubkey = PubKey.shorten(quote.authorPhoneNumber);

    const displayedPubkey = quote.authorProfileName ? shortenedPubkey : quote.authorPhoneNumber;

    return (
      <Quote
        onClick={(e: any) => {
          e.preventDefault();
          e.stopPropagation();
          if (multiSelectMode && id) {
            this.props.onSelectMessage(id);
            return;
          }
          const { authorPhoneNumber, messageId: quoteId, referencedMessageNotFound } = quote;
          quote?.onClick({
            quoteAuthor: authorPhoneNumber,
            quoteId,
            referencedMessageNotFound,
          });
        }}
        text={quote.text}
        attachment={quote.attachment}
        isIncoming={direction === 'incoming'}
        conversationType={conversationType}
        convoId={convoId}
        isPublic={isPublic}
        authorPhoneNumber={displayedPubkey}
        authorProfileName={quote.authorProfileName}
        authorName={quote.authorName}
        referencedMessageNotFound={quote.referencedMessageNotFound}
        isFromMe={quote.isFromMe}
        withContentAbove={withContentAbove}
      />
    );
  }

  public renderAvatar() {
    const {
      authorAvatarPath,
      authorName,
      authorPhoneNumber,
      authorProfileName,
      collapseMetadata,
      isAdmin,
      conversationType,
      direction,
      isPublic,
      firstMessageOfSeries,
    } = this.props;

    if (collapseMetadata || conversationType !== 'group' || direction === 'outgoing') {
      return;
    }
    const userName = authorName || authorProfileName || authorPhoneNumber;

    if (!firstMessageOfSeries) {
      return <div style={{ marginInlineEnd: '60px' }} />;
    }

    return (
      <div className="module-message__author-avatar">
        <Avatar
          avatarPath={authorAvatarPath}
          name={userName}
          size={AvatarSize.S}
          onAvatarClick={() => {
            window.inboxStore?.dispatch(
              updateUserDetailsModal({
                conversationId: authorPhoneNumber,
                userName,
                authorAvatarPath,
              })
            );
          }}
          pubkey={authorPhoneNumber}
        />
        {isPublic && isAdmin && (
          <div className="module-avatar__icon--crown-wrapper">
            <div className="module-avatar__icon--crown" />
          </div>
        )}
      </div>
    );
  }

  public renderText() {
    const { text, direction, status, conversationType, convoId, multiSelectMode } = this.props;

    const contents =
      direction === 'incoming' && status === 'error' ? window.i18n('incomingError') : text;

    if (!contents) {
      return null;
    }

    return (
      <div
        dir="auto"
        className={classNames(
          'module-message__text',
          `module-message__text--${direction}`,
          status === 'error' && direction === 'incoming' ? 'module-message__text--error' : null
        )}
      >
        <MessageBody
          text={contents || ''}
          isGroup={conversationType === 'group'}
          convoId={convoId}
          disableLinks={multiSelectMode}
        />
      </div>
    );
  }

  public renderError(isCorrectSide: boolean) {
    const { status, direction } = this.props;

    if (!isCorrectSide || status !== 'error') {
      return null;
    }

    return (
      <div className="module-message__error-container">
        <div
          className={classNames('module-message__error', `module-message__error--${direction}`)}
        />
      </div>
    );
  }

  public renderContextMenu() {
    const {
      attachments,
      authorPhoneNumber,
      convoId,
      direction,
      status,
      isDeletable,
      id,
      onSelectMessage,
      onDeleteMessage,
      onDownload,
      onRetrySend,
      onShowDetail,
      isPublic,
      isOpenGroupV2,
      weAreAdmin,
      isAdmin,
      text,
    } = this.props;

    const showRetry = status === 'error' && direction === 'outgoing';
    const multipleAttachments = attachments && attachments.length > 1;

    const onContextMenuShown = () => {
      window.contextMenuShown = true;
    };

    const onContextMenuHidden = () => {
      // This function will called before the click event
      // on the message would trigger (and I was unable to
      // prevent propagation in this case), so use a short timeout
      setTimeout(() => {
        window.contextMenuShown = false;
      }, 100);
    };

    const selectMessageText = window.i18n('selectMessage');
    const deleteMessageText = window.i18n('deleteMessage');

    return (
      <Menu
        id={this.ctxMenuID}
        onShown={onContextMenuShown}
        onHidden={onContextMenuHidden}
        animation={animation.fade}
      >
        {!multipleAttachments && attachments && attachments[0] ? (
          <Item
            onClick={(e: any) => {
              if (onDownload) {
                onDownload(attachments[0]);
              }
            }}
          >
            {window.i18n('downloadAttachment')}
          </Item>
        ) : null}

        <Item
          onClick={() => {
            MessageInteraction.copyBodyToClipboard(text);
          }}
        >
          {window.i18n('copyMessage')}
        </Item>
        <Item onClick={this.onReplyPrivate}>{window.i18n('replyToMessage')}</Item>
        <Item onClick={onShowDetail}>{window.i18n('moreInformation')}</Item>
        {showRetry ? <Item onClick={onRetrySend}>{window.i18n('resend')}</Item> : null}
        {isDeletable ? (
          <>
            <Item
              onClick={() => {
                onSelectMessage(id);
              }}
            >
              {selectMessageText}
            </Item>
            <Item
              onClick={() => {
                onDeleteMessage(id);
              }}
            >
              {deleteMessageText}
            </Item>
          </>
        ) : null}
        {weAreAdmin && isPublic ? (
          <Item
            onClick={() => {
              MessageInteraction.banUser(authorPhoneNumber, convoId);
            }}
          >
            {window.i18n('banUser')}
          </Item>
        ) : null}
        {weAreAdmin && isOpenGroupV2 ? (
          <Item
            onClick={() => {
              MessageInteraction.unbanUser(authorPhoneNumber, convoId);
            }}
          >
            {window.i18n('unbanUser')}
          </Item>
        ) : null}
        {weAreAdmin && isPublic && !isAdmin ? (
          <Item onClick={this.onAddModerator}>{window.i18n('addAsModerator')}</Item>
        ) : null}
        {weAreAdmin && isPublic && isAdmin ? (
          <Item onClick={this.onRemoveFromModerator}>{window.i18n('removeFromModerators')}</Item>
        ) : null}
      </Menu>
    );
  }

  public getWidth(): number | undefined {
    const { attachments, previews } = this.props;

    if (attachments && attachments.length) {
      const dimensions = getGridDimensions(attachments);
      if (dimensions) {
        return dimensions.width;
      }
    }

    if (previews && previews.length) {
      const first = previews[0];

      if (!first || !first.image) {
        return;
      }
      const { width } = first.image;

      if (isImageAttachment(first.image) && width && width >= MINIMUM_LINK_PREVIEW_IMAGE_WIDTH) {
        const dimensions = getImageDimensions(first.image);
        if (dimensions) {
          return dimensions.width;
        }
      }
    }

    return;
  }

  public isShowingImage(): boolean {
    const { attachments, previews } = this.props;
    const { imageBroken } = this.state;

    if (imageBroken) {
      return false;
    }

    if (attachments && attachments.length) {
      const displayImage = canDisplayImage(attachments);

      return Boolean(
        displayImage &&
          ((isImage(attachments) && hasImage(attachments)) ||
            (isVideo(attachments) && hasVideoScreenshot(attachments)))
      );
    }

    if (previews && previews.length) {
      const first = previews[0];
      const { image } = first;

      if (!image) {
        return false;
      }

      return isImageAttachment(image);
    }

    return false;
  }

  // tslint:disable-next-line: cyclomatic-complexity
  public render() {
    const {
      direction,
      id,
      selected,
      multiSelectMode,
      conversationType,
      isPublic,
      text,
      isUnread,
      markRead,
    } = this.props;
    const { expired, expiring } = this.state;

    if (expired) {
      return null;
    }

    const width = this.getWidth();
    const isShowingImage = this.isShowingImage();

    const isIncoming = direction === 'incoming';
    const shouldMarkReadWhenVisible = isIncoming && isUnread;
    const divClasses = ['session-message-wrapper'];

    if (selected) {
      divClasses.push('message-selected');
    }

    if (conversationType === 'group') {
      divClasses.push('public-chat-message-wrapper');
    }

    if (this.props.isQuotedMessageToAnimate) {
      divClasses.push('flash-green-once');
    }

    const onVisible = (inView: boolean | Object) => {
      if (inView === true && shouldMarkReadWhenVisible && window.isFocused()) {
        // mark the message as read.
        // this will trigger the expire timer.
        void markRead(Date.now());
      }
    };

    return (
      <ReadableMessage
        id={id}
        className={classNames(divClasses)}
        onChange={onVisible}
        onContextMenu={this.handleContextMenu}
      >
        {this.renderAvatar()}
        <div
          className={classNames(
            'module-message',
            `module-message--${direction}`,
            expiring ? 'module-message--expired' : null
          )}
          role="button"
          onClick={event => {
            const selection = window.getSelection();
            // Text is being selected
            if (selection && selection.type === 'Range') {
              return;
            }

            // User clicked on message body
            const target = event.target as HTMLDivElement;
            if (
              (!multiSelectMode && target.className === 'text-selectable') ||
              window.contextMenuShown
            ) {
              return;
            }

            if (id) {
              this.props.onSelectMessage(id);
            }
          }}
        >
          {this.renderError(isIncoming)}

          <div
            className={classNames(
              'module-message__container',
              `module-message__container--${direction}`
            )}
            style={{
              width: isShowingImage ? width : undefined,
            }}
            role="button"
            onClick={event => {
              const selection = window.getSelection();
              // Text is being selected
              if (selection && selection.type === 'Range') {
                return;
              }

              // User clicked on message body
              const target = event.target as HTMLDivElement;
              if (target.className === 'text-selectable' || window.contextMenuShown) {
                return;
              }

              if (id) {
                this.props.onSelectMessage(id);
              }
            }}
          >
            {this.renderAuthor()}
            {this.renderQuote()}
            {this.renderAttachment()}
            {this.renderPreview()}
            {this.renderText()}
            <MessageMetadata {...this.props} isShowingImage={this.isShowingImage()} />
          </div>
          {this.renderError(!isIncoming)}
          {this.renderContextMenu()}
        </div>
      </ReadableMessage>
    );
  }

  private handleContextMenu(e: any) {
    e.preventDefault();
    e.stopPropagation();
    const { multiSelectMode, isKickedFromGroup } = this.props;
    const enableContextMenu = !multiSelectMode && !isKickedFromGroup;

    if (enableContextMenu) {
      // Don't forget to pass the id and the event and voila!
      contextMenu.hideAll();
      contextMenu.show({
        id: this.ctxMenuID,
        event: e,
      });
    }
  }

  private renderAuthor() {
    const {
      authorName,
      authorPhoneNumber,
      authorProfileName,
      conversationType,
      direction,
      isPublic,
    } = this.props;

    const title = authorName ? authorName : authorPhoneNumber;

    if (direction !== 'incoming' || conversationType !== 'group' || !title) {
      return null;
    }

    const shortenedPubkey = PubKey.shorten(authorPhoneNumber);

    const displayedPubkey = authorProfileName ? shortenedPubkey : authorPhoneNumber;

    return (
      <div className="module-message__author">
        <ContactName
          phoneNumber={displayedPubkey}
          name={authorName}
          profileName={authorProfileName}
          module="module-message__author"
          boldProfileName={true}
          shouldShowPubkey={Boolean(isPublic)}
        />
      </div>
    );
  }

  private onReplyPrivate(e: any) {
    if (this.props && this.props.onReply) {
      this.props.onReply(this.props.timestamp);
    }
  }

  private async onAddModerator() {
    await addSenderAsModerator(this.props.authorPhoneNumber, this.props.convoId);
  }

  private async onRemoveFromModerator() {
    await removeSenderFromModerator(this.props.authorPhoneNumber, this.props.convoId);
  }
}

export const Message = withTheme(MessageInner);
