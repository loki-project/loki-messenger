import React from 'react';

import { Message } from '../../conversation/Message';
import { TimerNotification } from '../../conversation/TimerNotification';

import { SessionScrollButton } from '../SessionScrollButton';
import { Constants } from '../../../session';
import _ from 'lodash';
import { contextMenu } from 'react-contexify';
import { AttachmentType } from '../../../types/Attachment';
import { GroupNotification } from '../../conversation/GroupNotification';
import { GroupInvitation } from '../../conversation/GroupInvitation';
import {
  fetchMessagesForConversation,
  ReduxConversationType,
  SortedMessageModelProps,
} from '../../../state/ducks/conversations';
import { SessionLastSeenIndicator } from './SessionLastSeenIndicator';
import { ToastUtils } from '../../../session/utils';
import { TypingBubble } from '../../conversation/TypingBubble';
import { getConversationController } from '../../../session/conversations';
import { MessageModel } from '../../../models/message';
import { MessageRegularProps, QuoteClickOptions } from '../../../models/messageType';
import { getMessageById, getMessagesBySentAt } from '../../../data/data';
import autoBind from 'auto-bind';
import { ConversationTypeEnum } from '../../../models/conversation';
import { DataExtractionNotification } from '../../conversation/DataExtractionNotification';

interface State {
  showScrollButton: boolean;
  animateQuotedMessageId?: string;
  nextMessageToPlay: number | undefined;
}

interface Props {
  selectedMessages: Array<string>;
  conversationKey: string;
  messagesProps: Array<SortedMessageModelProps>;
  conversation: ReduxConversationType;
  ourPrimary: string;
  messageContainerRef: React.RefObject<any>;
  selectMessage: (messageId: string) => void;
  deleteMessage: (messageId: string) => void;
  replyToMessage: (messageId: number) => Promise<void>;
  showMessageDetails: (messageProps: any) => void;
  onClickAttachment: (attachment: any, message: any) => void;
  onDownloadAttachment: ({
    attachment,
    messageTimestamp,
  }: {
    attachment: any;
    messageTimestamp: number;
    messageSender: string;
  }) => void;
  onDeleteSelectedMessages: () => Promise<void>;
}

export class SessionMessagesList extends React.Component<Props, State> {
  private readonly messageContainerRef: React.RefObject<any>;
  private scrollOffsetBottomPx: number = Number.MAX_VALUE;
  private ignoreScrollEvents: boolean;
  private timeoutResetQuotedScroll: NodeJS.Timeout | null = null;

  public constructor(props: Props) {
    super(props);

    this.state = {
      showScrollButton: false,
      nextMessageToPlay: undefined,
    };
    autoBind(this);

    this.messageContainerRef = this.props.messageContainerRef;
    this.ignoreScrollEvents = true;
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~ LIFECYCLES ~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  public componentDidMount() {
    // Pause thread to wait for rendering to complete
    setTimeout(this.scrollToUnread, 0);
  }

  public componentWillUnmount() {
    if (this.timeoutResetQuotedScroll) {
      clearTimeout(this.timeoutResetQuotedScroll);
    }
  }

  public componentDidUpdate(prevProps: Props, _prevState: State) {
    const isSameConvo = prevProps.conversationKey === this.props.conversationKey;
    const messageLengthChanged = prevProps.messagesProps.length !== this.props.messagesProps.length;
    if (
      !isSameConvo ||
      (prevProps.messagesProps.length === 0 && this.props.messagesProps.length !== 0)
    ) {
      // displayed conversation changed. We have a bit of cleaning to do here
      this.scrollOffsetBottomPx = Number.MAX_VALUE;
      this.ignoreScrollEvents = true;
      this.setupTimeoutResetQuotedHighlightedMessage(true);
      this.setState(
        {
          showScrollButton: false,
          animateQuotedMessageId: undefined,
        },
        this.scrollToUnread
      );
    } else {
      // if we got new message for this convo, and we are scrolled to bottom
      if (isSameConvo && messageLengthChanged) {
        // Keep scrolled to bottom unless user scrolls up
        if (this.getScrollOffsetBottomPx() === 0) {
          this.scrollToBottom();
        } else {
          const messageContainer = this.messageContainerRef?.current;

          if (messageContainer) {
            const scrollHeight = messageContainer.scrollHeight;
            const clientHeight = messageContainer.clientHeight;
            this.ignoreScrollEvents = true;
            messageContainer.scrollTop = scrollHeight - clientHeight - this.scrollOffsetBottomPx;
            this.ignoreScrollEvents = false;
          }
        }
      }
    }
  }

  public render() {
    const { conversationKey, conversation } = this.props;
    const { showScrollButton } = this.state;

    let displayedName = null;
    if (conversation.type === ConversationTypeEnum.PRIVATE) {
      displayedName = getConversationController().getContactProfileNameOrShortenedPubKey(
        conversationKey
      );
    }

    return (
      <div
        className="messages-container"
        onScroll={this.handleScroll}
        ref={this.messageContainerRef}
      >
        <TypingBubble
          phoneNumber={conversationKey}
          conversationType={conversation.type}
          displayedName={displayedName}
          isTyping={conversation.isTyping}
          key="typing-bubble"
        />

        {this.renderMessages()}

        <SessionScrollButton
          show={showScrollButton}
          onClick={this.scrollToBottom}
          key="scroll-down-button"
        />
      </div>
    );
  }

  private displayUnreadBannerIndex(messages: Array<SortedMessageModelProps>) {
    const { conversation } = this.props;
    if (conversation.unreadCount === 0) {
      return -1;
    }
    // conversation.unreadCount is the number of messages we incoming we did not read yet.
    // also, unreacCount is updated only when the conversation is marked as read.
    // So we can have an unreadCount for the conversation not correct based on the real number of unread messages.
    // some of the messages we have in "messages" are ones we sent ourself (or from another device).
    // those messages should not be counted to display the unread banner.

    let findFirstUnreadIndex = -1;
    let incomingMessagesSoFar = 0;
    const { unreadCount } = conversation;

    // Basically, count the number of incoming messages from the most recent one.
    for (let index = 0; index <= messages.length - 1; index++) {
      const message = messages[index];
      if (message.propsForMessage.direction === 'incoming') {
        incomingMessagesSoFar++;
        // message.attributes.unread is !== undefined if the message is unread.
        if (
          message.propsForMessage.isUnread !== undefined &&
          incomingMessagesSoFar >= unreadCount
        ) {
          findFirstUnreadIndex = index;
          break;
        }
      }
    }

    //
    if (findFirstUnreadIndex === -1 && conversation.unreadCount >= 0) {
      return conversation.unreadCount - 1;
    }
    return findFirstUnreadIndex;
  }

  private renderMessages() {
    const { selectedMessages, messagesProps } = this.props;
    const multiSelectMode = Boolean(selectedMessages.length);
    let currentMessageIndex = 0;
    let playableMessageIndex = 0;
    const displayUnreadBannerIndex = this.displayUnreadBannerIndex(messagesProps);

    return (
      <>
        {messagesProps.map((messageProps: SortedMessageModelProps) => {
          const timerProps = messageProps.propsForTimerNotification;
          const propsForGroupInvitation = messageProps.propsForGroupInvitation;
          const propsForDataExtractionNotification =
            messageProps.propsForDataExtractionNotification;

          const groupNotificationProps = messageProps.propsForGroupNotification;

          // IF there are some unread messages
          // AND we found the last read message
          // AND we are not scrolled all the way to the bottom
          // THEN, show the unread banner for the current message
          const showUnreadIndicator =
            displayUnreadBannerIndex >= 0 &&
            currentMessageIndex === displayUnreadBannerIndex &&
            this.getScrollOffsetBottomPx() !== 0;
          const unreadIndicator = (
            <SessionLastSeenIndicator
              count={displayUnreadBannerIndex + 1} // count is used for the 118n of the string
              show={showUnreadIndicator}
              key={`unread-indicator-${messageProps.propsForMessage.id}`}
            />
          );
          currentMessageIndex = currentMessageIndex + 1;

          if (groupNotificationProps) {
            return (
              <React.Fragment key={messageProps.propsForMessage.id}>
                <GroupNotification {...groupNotificationProps} />
                {unreadIndicator}
              </React.Fragment>
            );
          }

          if (propsForGroupInvitation) {
            return (
              <React.Fragment key={messageProps.propsForMessage.id}>
                <GroupInvitation
                  {...propsForGroupInvitation}
                  key={messageProps.propsForMessage.id}
                />
                {unreadIndicator}
              </React.Fragment>
            );
          }

          if (propsForDataExtractionNotification) {
            return (
              <React.Fragment key={messageProps.propsForMessage.id}>
                <DataExtractionNotification
                  {...propsForDataExtractionNotification}
                  key={messageProps.propsForMessage.id}
                />
                {unreadIndicator}
              </React.Fragment>
            );
          }

          if (timerProps) {
            return (
              <React.Fragment key={messageProps.propsForMessage.id}>
                <TimerNotification {...timerProps} key={messageProps.propsForMessage.id} />
                {unreadIndicator}
              </React.Fragment>
            );
          }
          if (!messageProps) {
            return;
          }

          playableMessageIndex++;

          // firstMessageOfSeries tells us to render the avatar only for the first message
          // in a series of messages from the same user
          return (
            <React.Fragment key={messageProps.propsForMessage.id}>
              {this.renderMessage(
                messageProps,
                messageProps.firstMessageOfSeries,
                multiSelectMode,
                playableMessageIndex
              )}
              {unreadIndicator}
            </React.Fragment>
          );
        })}
      </>
    );
  }

  private renderMessage(
    messageProps: SortedMessageModelProps,
    firstMessageOfSeries: boolean,
    multiSelectMode: boolean,
    playableMessageIndex: number
  ) {
    const messageId = messageProps.propsForMessage.id;

    const selected =
      !!messageProps?.propsForMessage.id && this.props.selectedMessages.includes(messageId);

    const onShowDetail = async () => {
      const found = await getMessageById(messageId);
      if (found) {
        const messageDetailsProps = await found.getPropsForMessageDetail();

        this.props.showMessageDetails(messageDetailsProps);
      } else {
        window.log.warn(`Message ${messageId} not found in db`);
      }
    };

    const onClickAttachment = (attachment: AttachmentType) => {
      this.props.onClickAttachment(attachment, messageProps.propsForMessage);
    };

    // tslint:disable-next-line: no-async-without-await
    const onQuoteClick = messageProps.propsForMessage.quote
      ? this.scrollToQuoteMessage
      : async () => {};

    const onDownload = (attachment: AttachmentType) => {
      const messageTimestamp =
        messageProps.propsForMessage.timestamp ||
        messageProps.propsForMessage.serverTimestamp ||
        messageProps.propsForMessage.receivedAt ||
        0;
      this.props.onDownloadAttachment({
        attachment,
        messageTimestamp,
        messageSender: messageProps.propsForMessage.authorPhoneNumber,
      });
    };

    const regularProps: MessageRegularProps = {
      ...messageProps.propsForMessage,
      selected,
      firstMessageOfSeries,
      multiSelectMode,
      isQuotedMessageToAnimate: messageId === this.state.animateQuotedMessageId,
      nextMessageToPlay: this.state.nextMessageToPlay,
      playableMessageIndex,
      onSelectMessage: this.props.selectMessage,
      onDeleteMessage: this.props.deleteMessage,
      onReply: this.props.replyToMessage,
      onShowDetail,
      onClickAttachment,
      onDownload,
      playNextMessage: this.playNextMessage,
      onQuoteClick,
    };

    return <Message {...regularProps} onQuoteClick={onQuoteClick} key={messageId} />;
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~ MESSAGE HANDLING ~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  private updateReadMessages() {
    const { messagesProps, conversationKey } = this.props;

    if (!messagesProps || messagesProps.length === 0) {
      return;
    }

    const conversation = getConversationController().getOrThrow(conversationKey);

    if (conversation.isBlocked()) {
      return;
    }

    if (this.ignoreScrollEvents) {
      return;
    }

    if (this.getScrollOffsetBottomPx() === 0) {
      void conversation.markRead(messagesProps[0].propsForMessage.receivedAt);
    }
  }

  /**
   * Sets the targeted index for the next
   * @param index index of message that just completed
   */
  private readonly playNextMessage = (index: any) => {
    const { messagesProps } = this.props;
    let nextIndex: number | undefined = index - 1;

    // to prevent autoplaying as soon as a message is received.
    const latestMessagePlayed = index <= 0 || messagesProps.length < index - 1;
    if (latestMessagePlayed) {
      nextIndex = undefined;
      this.setState({
        nextMessageToPlay: nextIndex,
      });
      return;
    }

    // stop auto-playing when the audio messages change author.
    const prevAuthorNumber = messagesProps[index].propsForMessage.authorPhoneNumber;
    const nextAuthorNumber = messagesProps[index - 1].propsForMessage.authorPhoneNumber;
    const differentAuthor = prevAuthorNumber !== nextAuthorNumber;
    if (differentAuthor) {
      nextIndex = undefined;
    }

    this.setState({
      nextMessageToPlay: nextIndex,
    });
  };

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ~~~~~~~~~~~~ SCROLLING METHODS ~~~~~~~~~~~~~
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  private async handleScroll() {
    const messageContainer = this.messageContainerRef?.current;

    const { conversationKey } = this.props;
    if (!messageContainer) {
      return;
    }
    contextMenu.hideAll();

    if (this.ignoreScrollEvents) {
      return;
    }

    const scrollTop = messageContainer.scrollTop;
    const clientHeight = messageContainer.clientHeight;

    const scrollButtonViewShowLimit = 0.75;
    const scrollButtonViewHideLimit = 0.4;
    this.scrollOffsetBottomPx = this.getScrollOffsetBottomPx();

    const scrollOffsetPc = this.scrollOffsetBottomPx / clientHeight;

    // Scroll button appears if you're more than 75% scrolled up
    if (scrollOffsetPc > scrollButtonViewShowLimit && !this.state.showScrollButton) {
      this.setState({ showScrollButton: true });
    }
    // Scroll button disappears if you're more less than 40% scrolled up
    if (scrollOffsetPc < scrollButtonViewHideLimit && this.state.showScrollButton) {
      this.setState({ showScrollButton: false });
    }

    // Scrolled to bottom
    const isScrolledToBottom = this.getScrollOffsetBottomPx() === 0;
    if (isScrolledToBottom) {
      // Mark messages read
      this.updateReadMessages();
    }

    // Fetch more messages when nearing the top of the message list
    const shouldFetchMoreMessages = scrollTop <= Constants.UI.MESSAGE_CONTAINER_BUFFER_OFFSET_PX;

    if (shouldFetchMoreMessages) {
      const { messagesProps } = this.props;
      const numMessages = messagesProps.length + Constants.CONVERSATION.DEFAULT_MESSAGE_FETCH_COUNT;
      const oldLen = messagesProps.length;
      const previousTopMessage = messagesProps[oldLen - 1]?.propsForMessage.id;

      (window.inboxStore?.dispatch as any)(
        fetchMessagesForConversation({ conversationKey, count: numMessages })
      );
      if (previousTopMessage && oldLen !== messagesProps.length) {
        this.scrollToMessage(previousTopMessage);
      }
    }
  }

  private scrollToUnread() {
    const { messagesProps, conversation } = this.props;
    if (conversation.unreadCount > 0) {
      let message;
      if (messagesProps.length > conversation.unreadCount) {
        // if we have enough message to show one more message, show one more to include the unread banner
        message = messagesProps[conversation.unreadCount - 1];
      } else {
        message = messagesProps[conversation.unreadCount - 1];
      }

      if (message) {
        this.scrollToMessage(message.propsForMessage.id);
      }
    }

    if (this.ignoreScrollEvents && messagesProps.length > 0) {
      this.ignoreScrollEvents = false;
      this.updateReadMessages();
    }
  }

  /**
   * Could not find a better name, but when we click on a quoted message,
   * the UI takes us there and highlights it.
   * If the user clicks again on this message, we want this highlight to be
   * shown once again.
   *
   * So we need to reset the state of of the highlighted message so when the users clicks again,
   * the highlight is shown once again
   */
  private setupTimeoutResetQuotedHighlightedMessage(clearOnly = false) {
    if (this.timeoutResetQuotedScroll) {
      clearTimeout(this.timeoutResetQuotedScroll);
    }
    // only clear the timeout, do not schedule once again
    if (clearOnly) {
      return;
    }
    if (this.state.animateQuotedMessageId !== undefined) {
      this.timeoutResetQuotedScroll = global.setTimeout(() => {
        this.setState({ animateQuotedMessageId: undefined });
      }, 3000);
    }
  }

  private scrollToMessage(messageId: string, smooth: boolean = false) {
    const topUnreadMessage = document.getElementById(messageId);
    topUnreadMessage?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'center',
    });

    // we consider that a `smooth` set to true, means it's a quoted message, so highlight this message on the UI
    if (smooth) {
      this.setState(
        { animateQuotedMessageId: messageId },
        this.setupTimeoutResetQuotedHighlightedMessage
      );
    }

    const messageContainer = this.messageContainerRef.current;
    if (!messageContainer) {
      return;
    }

    const scrollHeight = messageContainer.scrollHeight;
    const clientHeight = messageContainer.clientHeight;

    if (scrollHeight !== 0 && scrollHeight === clientHeight) {
      this.updateReadMessages();
    }
  }

  private scrollToBottom() {
    const messageContainer = this.messageContainerRef.current;
    if (!messageContainer) {
      return;
    }
    messageContainer.scrollTop = messageContainer.scrollHeight - messageContainer.clientHeight;
    const { messagesProps, conversationKey } = this.props;

    if (!messagesProps || messagesProps.length === 0) {
      return;
    }

    const conversation = getConversationController().getOrThrow(conversationKey);
    void conversation.markRead(messagesProps[0].propsForMessage.receivedAt);
  }

  private async scrollToQuoteMessage(options: QuoteClickOptions) {
    const { quoteAuthor, quoteId, referencedMessageNotFound } = options;

    const { messagesProps } = this.props;

    // For simplicity's sake, we show the 'not found' toast no matter what if we were
    //   not able to find the referenced message when the quote was received.
    if (referencedMessageNotFound) {
      ToastUtils.pushOriginalNotFound();
      return;
    }
    // Look for message in memory first, which would tell us if we could scroll to it
    const targetMessage = messagesProps.find(item => {
      const messageAuthor = item.propsForMessage?.authorPhoneNumber;

      if (!messageAuthor || quoteAuthor !== messageAuthor) {
        return false;
      }
      if (quoteId !== item.propsForMessage?.timestamp) {
        return false;
      }

      return true;
    });

    // If there's no message already in memory, we won't be scrolling. So we'll gather
    //   some more information then show an informative toast to the user.
    if (!targetMessage) {
      const collection = await getMessagesBySentAt(quoteId);
      const found = Boolean(
        collection.find((item: MessageModel) => {
          const messageAuthor = item.getSource();

          return Boolean(messageAuthor && quoteAuthor === messageAuthor);
        })
      );

      if (found) {
        ToastUtils.pushFoundButNotLoaded();
      } else {
        ToastUtils.pushOriginalNoLongerAvailable();
      }
      return;
    }

    const databaseId = targetMessage.propsForMessage.id;
    this.scrollToMessage(databaseId, true);
  }

  // basically the offset in px from the bottom of the view (most recent message)
  private getScrollOffsetBottomPx() {
    const messageContainer = this.messageContainerRef?.current;

    if (!messageContainer) {
      return Number.MAX_VALUE;
    }

    const scrollTop = messageContainer.scrollTop;
    const scrollHeight = messageContainer.scrollHeight;
    const clientHeight = messageContainer.clientHeight;
    return scrollHeight - scrollTop - clientHeight;
  }
}
