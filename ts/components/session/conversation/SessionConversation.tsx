// tslint:disable: no-backbone-get-set-outside-model

import React from 'react';

import classNames from 'classnames';

import {
  SessionCompositionBox,
  StagedAttachmentType,
} from './SessionCompositionBox';

import { Constants } from '../../../session';
import { SessionKeyVerification } from '../SessionKeyVerification';
import _ from 'lodash';
import { AttachmentUtil, GoogleChrome, UserUtil } from '../../../util';
import { MultiDeviceProtocol } from '../../../session/protocols';
import { ConversationHeaderWithDetails } from '../../conversation/ConversationHeader';
import { SessionRightPanelWithDetails } from './SessionRightPanel';
import { SessionTheme } from '../../../state/ducks/SessionTheme';
import { DefaultTheme } from 'styled-components';
import { SessionConversationMessagesList } from './SessionConversationMessagesList';
import { LightboxGallery, MediaItemType } from '../../LightboxGallery';
import { Message } from '../../conversation/media-gallery/types/Message';

import { AttachmentType, save } from '../../../types/Attachment';
import { ToastUtils } from '../../../session/utils';
import * as MIME from '../../../types/MIME';
import { SessionFileDropzone } from './SessionFileDropzone';

interface State {
  conversationKey: string;

  // Message sending progress
  messageProgressVisible: boolean;
  sendingProgress: number;
  prevSendingProgress: number;
  // Sending failed:  -1
  // Not send yet:     0
  // Sending message:  1
  // Sending success:  2
  sendingProgressStatus: -1 | 0 | 1 | 2;

  unreadCount: number;
  initialFetchComplete: boolean;
  messages: Array<any>;
  selectedMessages: Array<string>;
  isScrolledToBottom: boolean;
  doneInitialScroll: boolean;
  displayScrollToBottomButton: boolean;
  messageFetchTimestamp: number;

  showOverlay: boolean;
  showRecordingView: boolean;
  showOptionsPane: boolean;

  // For displaying `More Info` on messages, and `Safety Number`, etc.
  infoViewState?: 'safetyNumber' | 'messageDetails';

  stagedAttachments: Array<StagedAttachmentType>;
  isDraggingFile: boolean;

  // quoted message
  quotedMessageTimestamp?: number;
  quotedMessageProps?: any;

  // lightbox options
  lightBoxOptions?: any;
}

interface Props {
  conversations: any;
  theme: DefaultTheme;
}

export class SessionConversation extends React.Component<Props, State> {
  private readonly compositionBoxRef: React.RefObject<HTMLDivElement>;
  private readonly messageContainerRef: React.RefObject<HTMLDivElement>;
  private dragCounter: number;

  constructor(props: any) {
    super(props);

    const conversationKey = this.props.conversations.selectedConversation;
    const conversation = this.props.conversations.conversationLookup[
      conversationKey
    ];

    const unreadCount = conversation.unreadCount;

    this.state = {
      messageProgressVisible: false,
      sendingProgress: 0,
      prevSendingProgress: 0,
      sendingProgressStatus: 0,
      conversationKey,
      unreadCount,
      initialFetchComplete: false,
      messages: [],
      selectedMessages: [],
      isScrolledToBottom: !unreadCount,
      doneInitialScroll: false,
      displayScrollToBottomButton: false,
      messageFetchTimestamp: 0,
      showOverlay: false,
      showRecordingView: false,
      showOptionsPane: false,
      infoViewState: undefined,
      stagedAttachments: [],
      isDraggingFile: false,
    };
    this.compositionBoxRef = React.createRef();
    this.messageContainerRef = React.createRef();
    this.dragCounter = 0;

    // Group settings panel
    this.toggleGroupSettingsPane = this.toggleGroupSettingsPane.bind(this);
    this.getGroupSettingsProps = this.getGroupSettingsProps.bind(this);

    // Recording view
    this.onLoadVoiceNoteView = this.onLoadVoiceNoteView.bind(this);
    this.onExitVoiceNoteView = this.onExitVoiceNoteView.bind(this);

    // Messages
    this.loadInitialMessages = this.loadInitialMessages.bind(this);
    this.selectMessage = this.selectMessage.bind(this);
    this.resetSelection = this.resetSelection.bind(this);
    this.updateSendingProgress = this.updateSendingProgress.bind(this);
    this.resetSendingProgress = this.resetSendingProgress.bind(this);
    this.onMessageSending = this.onMessageSending.bind(this);
    this.onMessageSuccess = this.onMessageSuccess.bind(this);
    this.onMessageFailure = this.onMessageFailure.bind(this);
    this.deleteSelectedMessages = this.deleteSelectedMessages.bind(this);

    this.replyToMessage = this.replyToMessage.bind(this);
    this.onClickAttachment = this.onClickAttachment.bind(this);
    this.downloadAttachment = this.downloadAttachment.bind(this);
    this.getMessages = this.getMessages.bind(this);

    // Keyboard navigation
    this.onKeyDown = this.onKeyDown.bind(this);

    this.renderLightBox = this.renderLightBox.bind(this);

    // attachments
    this.clearAttachments = this.clearAttachments.bind(this);
    this.addAttachments = this.addAttachments.bind(this);
    this.removeAttachment = this.removeAttachment.bind(this);
    this.onChoseAttachments = this.onChoseAttachments.bind(this);
    this.handleDragIn = this.handleDragIn.bind(this);
    this.handleDragOut = this.handleDragOut.bind(this);
    this.handleDrag = this.handleDrag.bind(this);
    this.handleDrop = this.handleDrop.bind(this);

    const conversationModel = window.ConversationController.getOrThrow(
      this.state.conversationKey
    );
    conversationModel.on('change', () => {
      // reload as much messages as we had before the change.
      void this.getMessages(
        this.state.messages.length ||
          Constants.CONVERSATION.DEFAULT_MESSAGE_FETCH_COUNT,
        2
      );
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~ LIFECYCLES ~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  public async componentWillMount() {
    await this.loadInitialMessages();
    this.setState({ initialFetchComplete: true });
  }

  public componentWillUnmount() {
    const div = this.messageContainerRef.current;
    div?.removeEventListener('dragenter', this.handleDragIn);
    div?.removeEventListener('dragleave', this.handleDragOut);
    div?.removeEventListener('dragover', this.handleDrag);
    div?.removeEventListener('drop', this.handleDrop);
  }

  public componentDidMount() {
    // Pause thread to wait for rendering to complete
    setTimeout(() => {
      this.setState(
        {
          doneInitialScroll: true,
        },
        () => {
          const div = this.messageContainerRef.current;
          div?.addEventListener('dragenter', this.handleDragIn);
          div?.addEventListener('dragleave', this.handleDragOut);
          div?.addEventListener('dragover', this.handleDrag);
          div?.addEventListener('drop', this.handleDrop);
        }
      );
    }, 100);
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~ RENDER METHODS ~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  public render() {
    const {
      conversationKey,
      showRecordingView,
      showOptionsPane,
      quotedMessageProps,
      lightBoxOptions,
      selectedMessages,
    } = this.state;
    const selectionMode = !!selectedMessages.length;

    const conversation = this.props.conversations.conversationLookup[
      conversationKey
    ];
    const conversationModel = window.ConversationController.getOrThrow(
      conversationKey
    );
    const isRss = conversation.isRss;

    // TODO VINCE: OPTIMISE FOR NEW SENDING???
    const sendMessageFn = conversationModel.sendMessage.bind(conversationModel);

    const shouldRenderGroupSettings =
      !conversationModel.isPrivate() && !conversationModel.isRss();
    const groupSettingsProps = this.getGroupSettingsProps();

    const showSafetyNumber = this.state.infoViewState === 'safetyNumber';
    const showMessageDetails = this.state.infoViewState === 'messageDetails';

    return (
      <SessionTheme theme={this.props.theme}>
        <div className="conversation-header">{this.renderHeader()}</div>

        {/* <SessionProgress
            visible={this.state.messageProgressVisible}
            value={this.state.sendingProgress}
            prevValue={this.state.prevSendingProgress}
            sendStatus={this.state.sendingProgressStatus}
            resetProgress={this.resetSendingProgress}
          /> */}

        <div
          className={classNames(
            'conversation-content',
            selectionMode && 'selection-mode'
          )}
          tabIndex={0}
          onKeyDown={this.onKeyDown}
          role="navigation"
        >
          <div
            className={classNames(
              'conversation-info-panel',
              this.state.infoViewState && 'show'
            )}
          >
            {showSafetyNumber && (
              <SessionKeyVerification conversation={conversationModel} />
            )}
            {showMessageDetails && <>&nbsp</>}
          </div>

          {lightBoxOptions?.media && this.renderLightBox(lightBoxOptions)}

          <div className="conversation-messages">
            <SessionConversationMessagesList {...this.getMessagesListProps()} />

            {showRecordingView && (
              <div className="conversation-messages__blocking-overlay" />
            )}
            {this.state.isDraggingFile && <SessionFileDropzone />}
          </div>

          {!isRss && (
            <SessionCompositionBox
              sendMessage={sendMessageFn}
              stagedAttachments={this.state.stagedAttachments}
              onMessageSending={this.onMessageSending}
              onMessageSuccess={this.onMessageSuccess}
              onMessageFailure={this.onMessageFailure}
              onLoadVoiceNoteView={this.onLoadVoiceNoteView}
              onExitVoiceNoteView={this.onExitVoiceNoteView}
              quotedMessageProps={quotedMessageProps}
              removeQuotedMessage={() => {
                void this.replyToMessage(undefined);
              }}
              textarea={this.compositionBoxRef}
              clearAttachments={this.clearAttachments}
              removeAttachment={this.removeAttachment}
              onChoseAttachments={this.onChoseAttachments}
            />
          )}
        </div>

        {shouldRenderGroupSettings && (
          <div
            className={classNames(
              'conversation-item__options-pane',
              showOptionsPane && 'show'
            )}
          >
            <SessionRightPanelWithDetails {...groupSettingsProps} />
          </div>
        )}
      </SessionTheme>
    );
  }

  public renderHeader() {
    const headerProps = this.getHeaderProps();
    return <ConversationHeaderWithDetails {...headerProps} />;
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~ GETTER METHODS ~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  public async loadInitialMessages() {
    // Grabs the initial set of messages and adds them to our conversation model.
    // After the inital fetch, all new messages are automatically added from onNewMessage
    // in the conversation model.
    // The only time we need to call getMessages() is to grab more messages on scroll.
    const { conversationKey, initialFetchComplete } = this.state;
    const conversationModel = window.ConversationController.getOrThrow(
      conversationKey
    );

    if (initialFetchComplete) {
      return;
    }

    const messageSet = await window.Signal.Data.getMessagesByConversation(
      conversationKey,
      {
        limit: Constants.CONVERSATION.DEFAULT_MESSAGE_FETCH_COUNT,
        MessageCollection: window.Whisper.MessageCollection,
      }
    );

    const messages = messageSet.models.reverse();
    const messageFetchTimestamp = Date.now();

    this.setState({ messages, messageFetchTimestamp }, () => {
      // Add new messages to conversation collection
      conversationModel.messageCollection = messageSet;
    });
  }

  public async getMessages(
    numMessages?: number,
    fetchInterval = Constants.CONVERSATION.MESSAGE_FETCH_INTERVAL
  ) {
    const { conversationKey, messageFetchTimestamp } = this.state;

    const timestamp = Date.now();

    // If we have pulled messages in the last interval, don't bother rescanning
    // This avoids getting messages on every re-render.
    const timeBuffer = timestamp - messageFetchTimestamp;
    if (timeBuffer / 1000 < fetchInterval) {
      return { newTopMessage: undefined, previousTopMessage: undefined };
    }

    let msgCount =
      numMessages ||
      Number(Constants.CONVERSATION.DEFAULT_MESSAGE_FETCH_COUNT) +
        this.state.unreadCount;
    msgCount =
      msgCount > Constants.CONVERSATION.MAX_MESSAGE_FETCH_COUNT
        ? Constants.CONVERSATION.MAX_MESSAGE_FETCH_COUNT
        : msgCount;

    const messageSet = await window.Signal.Data.getMessagesByConversation(
      conversationKey,
      { limit: msgCount, MessageCollection: window.Whisper.MessageCollection }
    );

    // Set first member of series here.
    const messageModels = messageSet.models.reverse();

    const messages = [];
    let previousSender;
    for (let i = 0; i < messageModels.length; i++) {
      // Handle firstMessageOfSeries for conditional avatar rendering
      let firstMessageOfSeries = true;
      if (i > 0 && previousSender === messageModels[i].authorPhoneNumber) {
        firstMessageOfSeries = false;
      }

      messages.push({ ...messageModels[i], firstMessageOfSeries });
      previousSender = messageModels[i].authorPhoneNumber;
    }

    const previousTopMessage = this.state.messages[0]?.id;
    const newTopMessage = messages[0]?.id;

    this.setState({ messages, messageFetchTimestamp: timestamp });

    return { newTopMessage, previousTopMessage };
  }

  public getHeaderProps() {
    const { conversationKey, selectedMessages } = this.state;
    const conversation = window.ConversationController.getOrThrow(
      conversationKey
    );
    const expireTimer = conversation.get('expireTimer');
    const expirationSettingName = expireTimer
      ? window.Whisper.ExpirationTimerOptions.getName(expireTimer || 0)
      : null;

    const members = conversation.get('members') || [];

    const headerProps = {
      i18n: window.i18n,
      id: conversation.id,
      name: conversation.getName(),
      phoneNumber: conversation.getNumber(),
      profileName: conversation.getProfileName(),
      avatarPath: conversation.getAvatarPath(),
      isVerified: conversation.isVerified(),
      isMe: conversation.isMe(),
      isClosable: conversation.isClosable(),
      isBlocked: conversation.isBlocked(),
      isGroup: !conversation.isPrivate(),
      isPrivate: conversation.isPrivate(),
      isOnline: conversation.isOnline(),
      isPublic: conversation.isPublic(),
      isRss: conversation.isRss(),
      amMod: conversation.isModerator(
        window.storage.get('primaryDevicePubKey')
      ),
      members,
      subscriberCount: conversation.get('subscriberCount'),
      isKickedFromGroup: conversation.get('isKickedFromGroup'),
      expirationSettingName,
      showBackButton: Boolean(this.state.infoViewState),
      timerOptions: window.Whisper.ExpirationTimerOptions.map((item: any) => ({
        name: item.getName(),
        value: item.get('seconds'),
      })),
      hasNickname: !!conversation.getNickname(),
      selectionMode: !!selectedMessages.length,

      onSetDisappearingMessages: (seconds: any) =>
        conversation.updateExpirationTimer(seconds),
      onDeleteMessages: () => null,
      onDeleteSelectedMessages: async () => {
        await this.deleteSelectedMessages();
      },
      onCloseOverlay: () => {
        this.setState({ selectedMessages: [] });
        conversation.resetMessageSelection();
      },
      onDeleteContact: () => conversation.deleteContact(),
      onResetSession: () => {
        conversation.endSession();
      },

      onShowSafetyNumber: () => {
        this.setState({ infoViewState: 'safetyNumber' });
      },

      onGoBack: () => {
        this.setState({ infoViewState: undefined });
      },

      onUpdateGroupName: () => {
        conversation.onUpdateGroupName();
      },

      onBlockUser: () => {
        conversation.block();
      },
      onUnblockUser: () => {
        conversation.unblock();
      },
      onCopyPublicKey: () => {
        conversation.copyPublicKey();
      },
      onLeaveGroup: () => {
        window.Whisper.events.trigger('leaveGroup', conversation);
      },
      onInviteContacts: () => {
        window.Whisper.events.trigger('inviteContacts', conversation);
      },

      onAddModerators: () => {
        window.Whisper.events.trigger('addModerators', conversation);
      },

      onRemoveModerators: () => {
        window.Whisper.events.trigger('removeModerators', conversation);
      },

      onAvatarClick: (pubkey: any) => {
        if (conversation.isPrivate()) {
          window.Whisper.events.trigger('onShowUserDetails', {
            userPubKey: pubkey,
          });
        } else if (!conversation.isRss()) {
          this.toggleGroupSettingsPane();
        }
      },
    };

    return headerProps;
  }

  public getMessagesListProps() {
    const { conversationKey } = this.state;
    const conversation = window.ConversationController.getOrThrow(
      conversationKey
    );
    const conversationModel = window.ConversationController.getOrThrow(
      conversationKey
    );

    return {
      selectedMessages: this.state.selectedMessages,
      conversationKey: this.state.conversationKey,
      messages: this.state.messages,
      resetSelection: this.resetSelection,
      initialFetchComplete: this.state.initialFetchComplete,
      quotedMessageTimestamp: this.state.quotedMessageTimestamp,
      conversationModel: conversationModel,
      conversation: conversation,
      selectMessage: this.selectMessage,
      getMessages: this.getMessages,
      replyToMessage: this.replyToMessage,
      doneInitialScroll: this.state.doneInitialScroll,
      onClickAttachment: this.onClickAttachment,
      onDownloadAttachment: this.downloadAttachment,
      messageContainerRef: this.messageContainerRef,
    };
  }

  public getGroupSettingsProps() {
    const { conversationKey } = this.state;
    const conversation = window.ConversationController.getOrThrow(
      conversationKey
    );

    const ourPK = window.textsecure.storage.user.getNumber();
    const members = conversation.get('members') || [];
    const isAdmin = conversation.isMediumGroup()
      ? true
      : conversation.get('groupAdmins')?.includes(ourPK);

    return {
      id: conversation.id,
      name: conversation.getName(),
      memberCount: members.length,
      phoneNumber: conversation.getNumber(),
      profileName: conversation.getProfileName(),
      description: '', // TODO VINCE: ENSURE DESCRIPTION IS SET
      avatarPath: conversation.getAvatarPath(),
      amMod: conversation.isModerator(),
      isKickedFromGroup: conversation.attributes.isKickedFromGroup,
      isGroup: !conversation.isPrivate(),
      isPublic: conversation.isPublic(),
      isAdmin,
      isRss: conversation.isRss(),
      isBlocked: conversation.isBlocked(),

      timerOptions: window.Whisper.ExpirationTimerOptions.map((item: any) => ({
        name: item.getName(),
        value: item.get('seconds'),
      })),

      onSetDisappearingMessages: (seconds: any) => {
        if (seconds > 0) {
          void conversation.updateExpirationTimer(seconds);
        } else {
          void conversation.updateExpirationTimer(null);
        }
      },

      onGoBack: () => {
        this.toggleGroupSettingsPane();
      },

      onUpdateGroupName: () => {
        window.Whisper.events.trigger('updateGroupName', conversation);
      },
      onUpdateGroupMembers: () => {
        window.Whisper.events.trigger('updateGroupMembers', conversation);
      },
      onInviteContacts: () => {
        window.Whisper.events.trigger('inviteContacts', conversation);
      },
      onLeaveGroup: () => {
        window.Whisper.events.trigger('leaveGroup', conversation);
      },

      onShowLightBox: (lightBoxOptions = {}) => {
        this.setState({ lightBoxOptions });
      },
    };
  }

  public toggleGroupSettingsPane() {
    const { showOptionsPane } = this.state;
    this.setState({ showOptionsPane: !showOptionsPane });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~ MESSAGE HANDLING ~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  public updateSendingProgress(value: number, status: -1 | 0 | 1 | 2) {
    // If you're sending a new message, reset previous value to zero
    const prevSendingProgress = status === 1 ? 0 : this.state.sendingProgress;

    this.setState({
      sendingProgress: value,
      prevSendingProgress,
      sendingProgressStatus: status,
    });
  }

  public resetSendingProgress() {
    this.setState({
      sendingProgress: 0,
      prevSendingProgress: 0,
      sendingProgressStatus: 0,
    });
  }

  public onMessageSending() {
    // Set sending state 5% to show message sending
    const initialValue = 5;
    this.updateSendingProgress(initialValue, 1);
    if (this.state.quotedMessageTimestamp) {
      this.setState({
        quotedMessageTimestamp: undefined,
        quotedMessageProps: undefined,
      });
    }
  }

  public onMessageSuccess() {
    this.updateSendingProgress(100, 2);
  }

  public onMessageFailure() {
    this.updateSendingProgress(100, -1);
  }

  public async deleteSelectedMessages() {
    // Get message objects
    const selectedMessages = this.state.messages.filter(message =>
      this.state.selectedMessages.find(
        selectedMessage => selectedMessage === message.id
      )
    );

    const { conversationKey } = this.state;
    const conversationModel = window.ConversationController.getOrThrow(
      conversationKey
    );

    const multiple = selectedMessages.length > 1;

    const isPublic = conversationModel.isPublic();

    // In future, we may be able to unsend private messages also
    // isServerDeletable also defined in ConversationHeader.tsx for
    // future reference
    const isServerDeletable = isPublic;

    const warningMessage = (() => {
      if (isPublic) {
        return multiple
          ? window.i18n('deleteMultiplePublicWarning')
          : window.i18n('deletePublicWarning');
      }
      return multiple
        ? window.i18n('deleteMultipleWarning')
        : window.i18n('deleteWarning');
    })();

    const doDelete = async () => {
      let toDeleteLocally;

      // VINCE TOOD: MARK TO-DELETE MESSAGES AS READ

      if (isPublic) {
        // Get our Moderator status
        const ourDevicePubkey = await UserUtil.getCurrentDevicePubKey();
        if (!ourDevicePubkey) {
          return;
        }
        const ourPrimaryPubkey = (
          await MultiDeviceProtocol.getPrimaryDevice(ourDevicePubkey)
        ).key;
        const isModerator = conversationModel.isModerator(ourPrimaryPubkey);
        const isAllOurs = selectedMessages.every(
          message =>
            message.propsForMessage.authorPhoneNumber === message.OUR_NUMBER
        );

        if (!isAllOurs && !isModerator) {
          window.pushToast({
            title: window.i18n('messageDeletionForbidden'),
            type: 'error',
            id: 'messageDeletionForbidden',
          });

          this.setState({ selectedMessages: [] });
          return;
        }

        toDeleteLocally = await conversationModel.deletePublicMessages(
          selectedMessages
        );
        if (toDeleteLocally.length === 0) {
          // Message failed to delete from server, show error?
          return;
        }
      } else {
        selectedMessages.forEach(m =>
          conversationModel.messageCollection.remove(m.id)
        );
        toDeleteLocally = selectedMessages;
      }

      await Promise.all(
        toDeleteLocally.map(async (message: any) => {
          await window.Signal.Data.removeMessage(message.id, {
            Message: window.Whisper.Message,
          });
          message.trigger('unload');
        })
      );

      // Update view and trigger update
      this.setState({ selectedMessages: [] }, () => {
        conversationModel.trigger('change', conversationModel);
      });
    };

    // Only show a warning when at least one messages was successfully
    // saved in on the server
    if (!selectedMessages.some(m => !m.hasErrors())) {
      await doDelete();
      return;
    }

    // If removable from server, we "Unsend" - otherwise "Delete"
    const pluralSuffix = multiple ? 's' : '';
    const title = window.i18n(
      isServerDeletable
        ? `deleteMessage${pluralSuffix}ForEveryone`
        : `deleteMessage${pluralSuffix}`
    );

    const okText = window.i18n(
      isServerDeletable ? 'deleteForEveryone' : 'delete'
    );

    window.confirmationDialog({
      title,
      message: warningMessage,
      okText,
      okTheme: 'danger',
      resolve: doDelete,
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~ MESSAGE SELECTION ~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  public selectMessage(messageId: string) {
    const selectedMessages = this.state.selectedMessages.includes(messageId)
      ? // Add to array if not selected. Else remove.
        this.state.selectedMessages.filter(id => id !== messageId)
      : [...this.state.selectedMessages, messageId];

    this.setState({ selectedMessages });
  }

  public resetSelection() {
    this.setState({ selectedMessages: [] });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~ MICROPHONE METHODS ~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  private onLoadVoiceNoteView() {
    this.setState({
      showRecordingView: true,
      selectedMessages: [],
    });
  }

  private onExitVoiceNoteView() {
    this.setState({
      showRecordingView: false,
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~ MESSAGE QUOTE ~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  private async replyToMessage(quotedMessageTimestamp?: number) {
    if (!_.isEqual(this.state.quotedMessageTimestamp, quotedMessageTimestamp)) {
      const { conversationKey } = this.state;
      const conversationModel = window.ConversationController.getOrThrow(
        conversationKey
      );

      const conversation = this.props.conversations.conversationLookup[
        conversationKey
      ];
      let quotedMessageProps = null;
      if (quotedMessageTimestamp) {
        const quotedMessageModel = conversationModel.getMessagesWithTimestamp(
          conversation.id,
          quotedMessageTimestamp
        );
        if (quotedMessageModel && quotedMessageModel.length === 1) {
          quotedMessageProps = await conversationModel.makeQuote(
            quotedMessageModel[0]
          );
        }
      }
      this.setState({ quotedMessageTimestamp, quotedMessageProps }, () => {
        this.compositionBoxRef.current?.focus();
      });
    }
  }

  private onClickAttachment(attachment: any, message: any) {
    const lightBoxOptions = {
      media: [
        {
          objectURL: attachment.url,
          contentType: attachment.contentType,
          attachment,
        },
      ],
      attachment,
    };
    this.setState({ lightBoxOptions });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~ KEYBOARD NAVIGATION ~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  private onKeyDown(event: any) {
    // const messageContainer = this.messageContainerRef.current;
    // if (!messageContainer) {
    //   return;
    // }
    // const selectionMode = !!this.state.selectedMessages.length;
    // const recordingMode = this.state.showRecordingView;
    // const pageHeight = messageContainer.clientHeight;
    // const arrowScrollPx = 50;
    // const pageScrollPx = pageHeight * 0.8;
    // if (event.key === 'Escape') {
    //   // EXIT MEDIA VIEW
    //   if (recordingMode) {
    //     // EXIT RECORDING VIEW
    //   }
    //   // EXIT WHAT ELSE?
    // }
    // switch (event.key) {
    //   case 'Escape':
    //     if (selectionMode) {
    //       this.resetSelection();
    //     }
    //     break;
    //   // Scrolling
    //   case 'ArrowUp':
    //     messageContainer.scrollBy(0, -arrowScrollPx);
    //     break;
    //   case 'ArrowDown':
    //     messageContainer.scrollBy(0, arrowScrollPx);
    //     break;
    //   case 'PageUp':
    //     messageContainer.scrollBy(0, -pageScrollPx);
    //     break;
    //   case 'PageDown':
    //     messageContainer.scrollBy(0, pageScrollPx);
    //     break;
    //   default:
    // }
  }

  private clearAttachments() {
    this.state.stagedAttachments.forEach(attachment => {
      if (attachment.url) {
        URL.revokeObjectURL(attachment.url);
      }
      if (attachment.videoUrl) {
        URL.revokeObjectURL(attachment.videoUrl);
      }
    });
    this.setState({ stagedAttachments: [] });
  }

  private removeAttachment(attachment: AttachmentType) {
    const { stagedAttachments } = this.state;
    const updatedStagedAttachments = (stagedAttachments || []).filter(
      m => m.fileName !== attachment.fileName
    );

    this.setState({ stagedAttachments: updatedStagedAttachments });
  }

  private addAttachments(newAttachments: Array<StagedAttachmentType>) {
    const { stagedAttachments } = this.state;
    let newAttachmentsFiltered: Array<StagedAttachmentType> = [];
    if (newAttachments?.length > 0) {
      if (
        newAttachments.some(a => a.isVoiceMessage) &&
        stagedAttachments.length > 0
      ) {
        throw new Error('A voice note cannot be sent with other attachments');
      }
      // do not add already added attachments
      newAttachmentsFiltered = newAttachments.filter(
        a => !stagedAttachments.some(b => b.file.path === a.file.path)
      );
    }

    this.setState({
      stagedAttachments: [...stagedAttachments, ...newAttachmentsFiltered],
    });
  }

  private renderLightBox({
    media,
    attachment,
  }: {
    media: Array<MediaItemType>;
    attachment: any;
  }) {
    const selectedIndex =
      media.length > 1
        ? media.findIndex(
            (mediaMessage: any) =>
              mediaMessage.attachment.path === attachment.path
          )
        : 0;
    return (
      <LightboxGallery
        media={media}
        close={() => {
          this.setState({ lightBoxOptions: undefined });
        }}
        selectedIndex={selectedIndex}
        onSave={this.downloadAttachment}
      />
    );
  }

  // THIS DOES NOT DOWNLOAD ANYTHING! it just saves it where the user wants
  private downloadAttachment({
    attachment,
    message,
    index,
  }: {
    attachment: AttachmentType;
    message?: Message;
    index?: number;
  }) {
    const { getAbsoluteAttachmentPath } = window.Signal.Migrations;

    save({
      attachment,
      document,
      getAbsolutePath: getAbsoluteAttachmentPath,
      timestamp: message?.received_at || Date.now(),
    });
  }

  private async onChoseAttachments(attachmentsFileList: FileList) {
    if (!attachmentsFileList || attachmentsFileList.length === 0) {
      return;
    }

    // tslint:disable-next-line: prefer-for-of
    for (let i = 0; i < attachmentsFileList.length; i++) {
      await this.maybeAddAttachment(attachmentsFileList[i]);
    }
  }

  // tslint:disable: max-func-body-length cyclomatic-complexity
  private async maybeAddAttachment(file: any) {
    if (!file) {
      return;
    }

    const fileName = file.name;
    const contentType = file.type;

    const { stagedAttachments } = this.state;

    if (window.Signal.Util.isFileDangerous(fileName)) {
      ToastUtils.pushDangerousFileError();
      return;
    }

    if (stagedAttachments.length >= 32) {
      ToastUtils.pushMaximumAttachmentsError();
      return;
    }

    const haveNonImage = _.some(
      stagedAttachments,
      attachment => !MIME.isImage(attachment.contentType)
    );
    // You can't add another attachment if you already have a non-image staged
    if (haveNonImage) {
      ToastUtils.pushMultipleNonImageError();
      return;
    }

    // You can't add a non-image attachment if you already have attachments staged
    if (!MIME.isImage(contentType) && stagedAttachments.length > 0) {
      ToastUtils.pushCannotMixError();
      return;
    }
    const { VisualAttachment } = window.Signal.Types;

    const renderVideoPreview = async () => {
      const objectUrl = URL.createObjectURL(file);
      try {
        const type = 'image/png';

        const thumbnail = await VisualAttachment.makeVideoScreenshot({
          objectUrl,
          contentType: type,
          logger: window.log,
        });
        const data = await VisualAttachment.blobToArrayBuffer(thumbnail);
        const url = window.Signal.Util.arrayBufferToObjectURL({
          data,
          type,
        });
        this.addAttachments([
          {
            file,
            size: file.size,
            fileName,
            contentType,
            videoUrl: objectUrl,
            url,
            isVoiceMessage: false,
          },
        ]);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
      }
    };

    const renderImagePreview = async () => {
      if (!MIME.isJPEG(contentType)) {
        const urlImage = URL.createObjectURL(file);
        if (!urlImage) {
          throw new Error('Failed to create object url for image!');
        }
        this.addAttachments([
          {
            file,
            size: file.size,
            fileName,
            contentType,
            url: urlImage,
            isVoiceMessage: false,
          },
        ]);
        return;
      }

      const url = await window.autoOrientImage(file);
      this.addAttachments([
        {
          file,
          size: file.size,
          fileName,
          contentType,
          url,
          isVoiceMessage: false,
        },
      ]);
    };

    try {
      const blob = await AttachmentUtil.autoScale({
        contentType,
        file,
      });
      let limitKb = 10000;
      const blobType =
        file.type === 'image/gif' ? 'gif' : contentType.split('/')[0];

      switch (blobType) {
        case 'image':
          limitKb = 6000;
          break;
        case 'gif':
          limitKb = 10000;
          break;
        case 'audio':
          limitKb = 10000;
          break;
        case 'video':
          limitKb = 10000;
          break;
        default:
          limitKb = 10000;
      }
      // if ((blob.file.size / 1024).toFixed(4) >= limitKb) {
      //   const units = ['kB', 'MB', 'GB'];
      //   let u = -1;
      //   let limit = limitKb * 1000;
      //   do {
      //     limit /= 1000;
      //     u += 1;
      //   } while (limit >= 1000 && u < units.length - 1);
      //   // this.showFileSizeError(limit, units[u]);
      //   return;
      // }
    } catch (error) {
      window.log.error(
        'Error ensuring that image is properly sized:',
        error && error.stack ? error.stack : error
      );

      ToastUtils.pushLoadAttachmentFailure();
      return;
    }

    try {
      if (GoogleChrome.isImageTypeSupported(contentType)) {
        await renderImagePreview();
      } else if (GoogleChrome.isVideoTypeSupported(contentType)) {
        await renderVideoPreview();
      } else {
        this.addAttachments([
          {
            file,
            size: file.size,
            contentType,
            fileName,
            url: '',
            isVoiceMessage: false,
          },
        ]);
      }
    } catch (e) {
      window.log.error(
        `Was unable to generate thumbnail for file type ${contentType}`,
        e && e.stack ? e.stack : e
      );
      this.addAttachments([
        {
          file,
          size: file.size,
          contentType,
          fileName,
          isVoiceMessage: false,
          url: '',
        },
      ]);
    }
  }

  private handleDrag(e: any) {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragIn(e: any) {
    e.preventDefault();
    e.stopPropagation();
    this.dragCounter++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      this.setState({ isDraggingFile: true });
    }
  }

  private handleDragOut(e: any) {
    e.preventDefault();
    e.stopPropagation();
    this.dragCounter--;

    if (this.dragCounter === 0) {
      this.setState({ isDraggingFile: false });
    }
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e?.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      void this.onChoseAttachments(e.dataTransfer.files);
      e.dataTransfer.clearData();
      this.dragCounter = 0;
      this.setState({ isDraggingFile: false });
    }
  }
}