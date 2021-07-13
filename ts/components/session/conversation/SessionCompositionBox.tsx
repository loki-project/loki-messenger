import React from 'react';
import _, { debounce, update } from 'lodash';

import { Attachment, AttachmentType } from '../../../types/Attachment';
import * as MIME from '../../../types/MIME';

import { SessionIconButton, SessionIconSize, SessionIconType } from '../icon';
import { SessionEmojiPanel } from './SessionEmojiPanel';
import { SessionRecording } from './SessionRecording';

import { SignalService } from '../../../protobuf';

import { Constants } from '../../../session';

import { toArray } from 'react-emoji-render';
import { Flex } from '../../basic/Flex';
import { AttachmentList } from '../../conversation/AttachmentList';
import { ToastUtils } from '../../../session/utils';
import { AttachmentUtil } from '../../../util';
import {
  getPreview,
  LINK_PREVIEW_TIMEOUT,
  SessionStagedLinkPreview,
} from './SessionStagedLinkPreview';
import { AbortController } from 'abort-controller';
import { SessionQuotedMessageComposition } from './SessionQuotedMessageComposition';
import { Mention, MentionsInput } from 'react-mentions';
import { CaptionEditor } from '../../CaptionEditor';
import { DefaultTheme } from 'styled-components';
import { getConversationController } from '../../../session/conversations';
import { ReduxConversationType } from '../../../state/ducks/conversations';
import { SessionMemberListItem } from '../SessionMemberListItem';
import autoBind from 'auto-bind';
import { SessionSettingCategory } from '../settings/SessionSettings';
import { getMentionsInput } from '../../../state/selectors/mentionsInput';
import { updateConfirmModal } from '../../../state/ducks/modalDialog';
import {
  SectionType,
  showLeftPaneSection,
  showSettingsSection,
} from '../../../state/ducks/section';
import { SessionButtonColor } from '../SessionButton';
import {
  createOrUpdateItem,
  getItemById,
  hasLinkPreviewPopupBeenDisplayed,
} from '../../../data/data';

export interface ReplyingToMessageProps {
  convoId: string;
  id: string;
  author: string;
  timestamp: number;
  text?: string;
  attachments?: Array<any>;
}

export interface StagedLinkPreviewData {
  isLoaded: boolean;
  title: string | null;
  url: string | null;
  domain: string | null;
  description: string | null;
  image?: AttachmentType;
}

export interface StagedAttachmentType extends AttachmentType {
  file: File;
}

interface Props {
  sendMessage: any;

  onLoadVoiceNoteView: any;
  onExitVoiceNoteView: any;
  isBlocked: boolean;
  isPrivate: boolean;
  isKickedFromGroup: boolean;
  left: boolean;
  selectedConversationKey: string;
  selectedConversation: ReduxConversationType | undefined;
  isPublic: boolean;

  quotedMessageProps?: ReplyingToMessageProps;
  removeQuotedMessage: () => void;

  textarea: React.RefObject<HTMLDivElement>;
  stagedAttachments: Array<StagedAttachmentType>;
  clearAttachments: () => any;
  removeAttachment: (toRemove: AttachmentType) => void;
  onChoseAttachments: (newAttachments: Array<File>) => void;
  theme: DefaultTheme;
}

interface State {
  message: string;
  showRecordingView: boolean;

  showEmojiPanel: boolean;
  voiceRecording?: Blob;
  ignoredLink?: string; // set the the ignored url when users closed the link preview
  stagedLinkPreview?: StagedLinkPreviewData;
  showCaptionEditor?: AttachmentType;
}

const sendMessageStyle = {
  control: {
    wordBreak: 'break-all',
  },
  input: {
    overflow: 'auto',
    maxHeight: 70,
    wordBreak: 'break-word',
    padding: '0px',
    margin: '0px',
  },
  highlighter: {
    boxSizing: 'border-box',
    overflow: 'hidden',
    maxHeight: 70,
  },
  flexGrow: 1,
  minHeight: '24px',
  width: '100%',
};

const getDefaultState = () => {
  return {
    message: '',
    voiceRecording: undefined,
    showRecordingView: false,
    showEmojiPanel: false,
    ignoredLink: undefined,
    stagedLinkPreview: undefined,
    showCaptionEditor: undefined,
  };
};

export class SessionCompositionBox extends React.Component<Props, State> {
  private readonly textarea: React.RefObject<any>;
  private readonly fileInput: React.RefObject<HTMLInputElement>;
  private emojiPanel: any;
  private linkPreviewAbortController?: AbortController;
  private container: any;
  private readonly mentionsRegex = /@\uFFD205[0-9a-f]{64}\uFFD7[^\uFFD2]+\uFFD2/gu;
  private lastBumpTypingMessageLength: number = 0;

  constructor(props: any) {
    super(props);
    this.state = getDefaultState();

    this.textarea = props.textarea;
    this.fileInput = React.createRef();

    // Emojis
    this.emojiPanel = null;
    autoBind(this);
    this.toggleEmojiPanel = debounce(this.toggleEmojiPanel.bind(this), 100);
  }

  public componentDidMount() {
    setTimeout(this.focusCompositionBox, 100);

    const div = this.container;
    div?.addEventListener('paste', this.handlePaste);
  }

  public componentWillUnmount() {
    this.abortLinkPreviewFetch();
    this.linkPreviewAbortController = undefined;

    const div = this.container;
    div?.removeEventListener('paste', this.handlePaste);
  }

  public componentDidUpdate(prevProps: Props, _prevState: State) {
    // reset the state on new conversation key
    if (prevProps.selectedConversationKey !== this.props.selectedConversationKey) {
      this.setState(getDefaultState(), this.focusCompositionBox);
      this.lastBumpTypingMessageLength = 0;
    } else if (this.props.stagedAttachments?.length !== prevProps.stagedAttachments?.length) {
      // if number of staged attachment changed, focus the composition box for a more natural UI
      this.focusCompositionBox();
    }
  }

  public render() {
    const { showRecordingView } = this.state;

    return (
      <Flex flexDirection="column">
        {this.renderQuotedMessage()}
        {this.renderStagedLinkPreview()}
        {this.renderAttachmentsStaged()}
        <div className="composition-container">
          {showRecordingView ? this.renderRecordingView() : this.renderCompositionView()}
        </div>
      </Flex>
    );
  }

  private handleClick(e: any) {
    if (this.emojiPanel && this.emojiPanel.contains(e.target)) {
      return;
    }

    this.hideEmojiPanel();
  }

  private handlePaste(e: any) {
    const { items } = e.clipboardData;
    let imgBlob = null;
    for (const item of items) {
      const pasteType = item.type.split('/')[0];
      if (pasteType === 'image') {
        imgBlob = item.getAsFile();
      }

      switch (pasteType) {
        case 'image':
          imgBlob = item.getAsFile();
          break;
        case 'text':
          void this.showLinkSharingConfirmationModalDialog(e);
          break;
        default:
      }
    }
    if (imgBlob !== null) {
      const file = imgBlob;
      window?.log?.info('Adding attachment from clipboard', file);
      this.props.onChoseAttachments([file]);

      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Check if what is pasted is a URL and prompt confirmation for a setting change
   * @param e paste event
   */
  private async showLinkSharingConfirmationModalDialog(e: any) {
    const pastedText = e.clipboardData.getData('text');
    if (this.isURL(pastedText)) {
      const alreadyDisplayedPopup =
        (await getItemById(hasLinkPreviewPopupBeenDisplayed))?.value || false;
      window.inboxStore?.dispatch(
        updateConfirmModal({
          shouldShowConfirm:
            !window.getSettingValue('link-preview-setting') && !alreadyDisplayedPopup,
          title: window.i18n('linkPreviewsTitle'),
          message: window.i18n('linkPreviewsConfirmMessage'),
          okTheme: SessionButtonColor.Danger,
          onClickOk: () => {
            window.setSettingValue('link-preview-setting', true);
          },
          onClickClose: async () => {
            await createOrUpdateItem({ id: hasLinkPreviewPopupBeenDisplayed, value: true });
          },
        })
      );
    }
  }

  /**
   *
   * @param str String to evaluate
   * @returns boolean if the string is true or false
   */
  private isURL(str: string) {
    const urlRegex =
      '^(?!mailto:)(?:(?:http|https|ftp)://)(?:\\S+(?::\\S*)?@)?(?:(?:(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}(?:\\.(?:[0-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))|(?:(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,})))|localhost)(?::\\d{2,5})?(?:(/|\\?|#)[^\\s]*)?$';
    const url = new RegExp(urlRegex, 'i');
    return str.length < 2083 && url.test(str);
  }

  private showEmojiPanel() {
    document.addEventListener('mousedown', this.handleClick, false);

    this.setState({
      showEmojiPanel: true,
    });
  }

  private hideEmojiPanel() {
    document.removeEventListener('mousedown', this.handleClick, false);

    this.setState({
      showEmojiPanel: false,
    });
  }

  private toggleEmojiPanel() {
    if (this.state.showEmojiPanel) {
      this.hideEmojiPanel();
    } else {
      this.showEmojiPanel();
    }
  }

  private renderRecordingView() {
    return (
      <SessionRecording
        sendVoiceMessage={this.sendVoiceMessage}
        onLoadVoiceNoteView={this.onLoadVoiceNoteView}
        onExitVoiceNoteView={this.onExitVoiceNoteView}
        theme={this.props.theme}
      />
    );
  }

  private isTypingEnabled(): boolean {
    const { isBlocked, isKickedFromGroup, left, isPrivate } = this.props;

    return !(isBlocked || isKickedFromGroup || left);
  }

  private renderCompositionView() {
    const { showEmojiPanel } = this.state;
    const typingEnabled = this.isTypingEnabled();

    return (
      <>
        {typingEnabled && (
          <SessionIconButton
            iconType={SessionIconType.CirclePlus}
            iconSize={SessionIconSize.Large}
            onClick={this.onChooseAttachment}
            theme={this.props.theme}
          />
        )}

        <input
          className="hidden"
          placeholder="Attachment"
          multiple={true}
          ref={this.fileInput}
          type="file"
          onChange={this.onChoseAttachment}
        />

        {typingEnabled && (
          <SessionIconButton
            iconType={SessionIconType.Microphone}
            iconSize={SessionIconSize.Huge}
            onClick={this.onLoadVoiceNoteView}
            theme={this.props.theme}
          />
        )}

        <div
          className="send-message-input"
          role="main"
          onClick={this.focusCompositionBox} // used to focus on the textarea when clicking in its container
          ref={el => {
            this.container = el;
          }}
        >
          {this.renderTextArea()}
        </div>

        {typingEnabled && (
          <SessionIconButton
            iconType={SessionIconType.Emoji}
            iconSize={SessionIconSize.Large}
            onClick={this.toggleEmojiPanel}
            theme={this.props.theme}
          />
        )}
        <div className="send-message-button">
          <SessionIconButton
            iconType={SessionIconType.Send}
            iconSize={SessionIconSize.Large}
            iconRotation={90}
            onClick={this.onSendMessage}
            theme={this.props.theme}
          />
        </div>

        {typingEnabled && (
          <div ref={ref => (this.emojiPanel = ref)} onKeyDown={this.onKeyDown} role="button">
            {showEmojiPanel && (
              <SessionEmojiPanel onEmojiClicked={this.onEmojiClick} show={showEmojiPanel} />
            )}
          </div>
        )}
      </>
    );
  }

  private renderTextArea() {
    const { i18n } = window;
    const { message } = this.state;
    const { isKickedFromGroup, left, isPrivate, isBlocked, theme } = this.props;
    const messagePlaceHolder = isKickedFromGroup
      ? i18n('youGotKickedFromGroup')
      : left
      ? i18n('youLeftTheGroup')
      : isBlocked && isPrivate
      ? i18n('unblockToSend')
      : isBlocked && !isPrivate
      ? i18n('unblockGroupToSend')
      : i18n('sendMessage');
    const typingEnabled = this.isTypingEnabled();
    let index = 0;

    return (
      <MentionsInput
        value={message}
        onChange={this.onChange}
        onKeyDown={this.onKeyDown}
        onKeyUp={this.onKeyUp}
        placeholder={messagePlaceHolder}
        spellCheck={true}
        inputRef={this.textarea}
        disabled={!typingEnabled}
        rows={1}
        style={sendMessageStyle}
        suggestionsPortalHost={this.container}
        forceSuggestionsAboveCursor={true} // force mentions to be rendered on top of the cursor, this is working with a fork of react-mentions for now
      >
        <Mention
          appendSpaceOnAdd={true}
          // this will be cleaned on cleanMentions()
          markup="@ￒ__id__ￗ__display__ￒ" // ￒ = \uFFD2 is one of the forbidden char for a display name (check displayNameRegex)
          trigger="@"
          // this is only for the composition box visible content. The real stuff on the backend box is the @markup
          displayTransform={(_id, display) => `@${display}`}
          data={this.fetchUsersForGroup}
          renderSuggestion={(suggestion, _search, _highlightedDisplay, _index, focused) => (
            <SessionMemberListItem
              isSelected={focused}
              index={index++}
              key={suggestion.id}
              member={{
                id: `${suggestion.id}`,
                authorPhoneNumber: `${suggestion.id}`,
                selected: focused,
                authorProfileName: `${suggestion.display}`,
                authorName: `${suggestion.display}`,
                existingMember: false,
                checkmarked: false,
                authorAvatarPath: '',
              }}
            />
          )}
        />
      </MentionsInput>
    );
  }

  private fetchUsersForOpenGroup(query: any, callback: any) {
    const mentionsInput = getMentionsInput(window?.inboxStore?.getState() || []);
    const filtered =
      mentionsInput
        .filter(d => !!d)
        .filter(d => d.authorProfileName !== 'Anonymous')
        .filter(d => d.authorProfileName?.toLowerCase()?.includes(query.toLowerCase()))
        // Transform the users to what react-mentions expects
        .map(user => {
          return {
            display: user.authorProfileName,
            id: user.authorPhoneNumber,
          };
        }) || [];
    callback(filtered);
  }

  private fetchUsersForGroup(query: any, callback: any) {
    let overridenQuery = query;
    if (!query) {
      overridenQuery = '';
    }
    if (this.props.isPublic) {
      this.fetchUsersForOpenGroup(overridenQuery, callback);
      return;
    }
    if (!this.props.isPrivate) {
      this.fetchUsersForClosedGroup(overridenQuery, callback);
      return;
    }
  }

  private fetchUsersForClosedGroup(query: any, callback: any) {
    const { selectedConversation } = this.props;
    if (!selectedConversation) {
      return;
    }
    const allPubKeys = selectedConversation.members;
    if (!allPubKeys || allPubKeys.length === 0) {
      return;
    }

    const allMembers = allPubKeys.map(pubKey => {
      const conv = getConversationController().get(pubKey);
      let profileName = 'Anonymous';
      if (conv) {
        profileName = conv.getProfileName() || 'Anonymous';
      }
      return {
        id: pubKey,
        authorPhoneNumber: pubKey,
        authorProfileName: profileName,
      };
    });
    // keep anonymous members so we can still quote them with their id
    const members = allMembers
      .filter(d => !!d)
      .filter(
        d =>
          d.authorProfileName?.toLowerCase()?.includes(query.toLowerCase()) || !d.authorProfileName
      );

    // Transform the users to what react-mentions expects
    const mentionsData = members.map(user => ({
      display: user.authorProfileName || window.i18n('anonymous'),
      id: user.authorPhoneNumber,
    }));
    callback(mentionsData);
  }

  private renderStagedLinkPreview(): JSX.Element {
    // Don't generate link previews if user has turned them off
    if (!(window.getSettingValue('link-preview-setting') || false)) {
      return <></>;
    }

    const { stagedAttachments, quotedMessageProps } = this.props;
    const { ignoredLink } = this.state;

    // Don't render link previews if quoted message or attachments are already added
    if (stagedAttachments.length !== 0 || quotedMessageProps?.id) {
      return <></>;
    }
    // we try to match the first link found in the current message
    const links = window.Signal.LinkPreviews.findLinks(this.state.message, undefined);
    if (!links || links.length === 0 || ignoredLink === links[0]) {
      return <></>;
    }
    const firstLink = links[0];
    // if the first link changed, reset the ignored link so that the preview is generated
    if (ignoredLink && ignoredLink !== firstLink) {
      this.setState({ ignoredLink: undefined });
    }
    if (firstLink !== this.state.stagedLinkPreview?.url) {
      // trigger fetching of link preview data and image
      this.fetchLinkPreview(firstLink);
    }

    // if the fetch did not start yet, just don't show anything
    if (!this.state.stagedLinkPreview) {
      return <></>;
    }

    const { isLoaded, title, description, domain, image } = this.state.stagedLinkPreview;

    return (
      <SessionStagedLinkPreview
        isLoaded={isLoaded}
        title={title}
        description={description}
        domain={domain}
        image={image}
        url={firstLink}
        onClose={url => {
          this.setState({ ignoredLink: url });
        }}
      />
    );
  }

  private fetchLinkPreview(firstLink: string) {
    // mark the link preview as loading, no data are set yet
    this.setState({
      stagedLinkPreview: {
        isLoaded: false,
        url: firstLink,
        domain: null,
        description: null,
        image: undefined,
        title: null,
      },
    });
    const abortController = new AbortController();
    this.abortLinkPreviewFetch();
    this.linkPreviewAbortController = abortController;
    setTimeout(() => {
      abortController.abort();
    }, LINK_PREVIEW_TIMEOUT);

    getPreview(firstLink, abortController.signal)
      .then(ret => {
        let image: AttachmentType | undefined;
        if (ret) {
          if (ret.image?.width) {
            if (ret.image) {
              const blob = new Blob([ret.image.data], {
                type: ret.image.contentType,
              });
              const imageAttachment = {
                ...ret.image,
                url: URL.createObjectURL(blob),
                fileName: 'preview',
                fileSize: null,
                screenshot: null,
                thumbnail: null,
              };
              image = imageAttachment;
            }
          }
        }
        // we finished loading the preview, and checking the abortConrtoller, we are still not aborted.
        // => update the staged preview
        if (this.linkPreviewAbortController && !this.linkPreviewAbortController.signal.aborted) {
          this.setState({
            stagedLinkPreview: {
              isLoaded: true,
              title: ret?.title || null,
              description: ret?.description || '',
              url: ret?.url || null,
              domain: (ret?.url && window.Signal.LinkPreviews.getDomain(ret.url)) || '',
              image,
            },
          });
        } else if (this.linkPreviewAbortController) {
          this.setState({
            stagedLinkPreview: {
              isLoaded: false,
              title: null,
              description: null,
              url: null,
              domain: null,
              image: undefined,
            },
          });
          this.linkPreviewAbortController = undefined;
        }
      })
      .catch(err => {
        window?.log?.warn('fetch link preview: ', err);
        const aborted = this.linkPreviewAbortController?.signal.aborted;
        this.linkPreviewAbortController = undefined;
        // if we were aborted, it either means the UI was unmount, or more probably,
        // than the message was sent without the link preview.
        // So be sure to reset the staged link preview so it is not sent with the next message.

        // if we were not aborted, it's probably just an error on the fetch. Nothing to do excpet mark the fetch as done (with errors)

        if (aborted) {
          this.setState({
            stagedLinkPreview: undefined,
          });
        } else {
          this.setState({
            stagedLinkPreview: {
              isLoaded: true,
              title: null,
              description: null,
              url: firstLink,
              domain: null,
              image: undefined,
            },
          });
        }
      });
  }

  private renderQuotedMessage() {
    const { quotedMessageProps, removeQuotedMessage } = this.props;
    if (quotedMessageProps?.id) {
      return (
        <SessionQuotedMessageComposition
          quotedMessageProps={quotedMessageProps}
          removeQuotedMessage={removeQuotedMessage}
        />
      );
    }
    return <></>;
  }

  private onClickAttachment(attachment: AttachmentType) {
    this.setState({ showCaptionEditor: attachment });
  }

  private renderCaptionEditor(attachment?: AttachmentType) {
    if (attachment) {
      const onSave = (caption: string) => {
        // eslint-disable-next-line no-param-reassign
        attachment.caption = caption;
        ToastUtils.pushToastInfo('saved', window.i18n('saved'));
        // close the lightbox on save
        this.setState({
          showCaptionEditor: undefined,
        });
      };

      const url = attachment.videoUrl || attachment.url;
      return (
        <CaptionEditor
          attachment={attachment}
          url={url}
          onSave={onSave}
          caption={attachment.caption}
          onClose={() => {
            this.setState({
              showCaptionEditor: undefined,
            });
          }}
        />
      );
    }
    return <></>;
  }

  private renderAttachmentsStaged() {
    const { stagedAttachments } = this.props;
    const { showCaptionEditor } = this.state;
    if (stagedAttachments && stagedAttachments.length) {
      return (
        <>
          <AttachmentList
            attachments={stagedAttachments}
            onClickAttachment={this.onClickAttachment}
            onAddAttachment={this.onChooseAttachment}
            onCloseAttachment={this.props.removeAttachment}
            onClose={this.props.clearAttachments}
          />
          {this.renderCaptionEditor(showCaptionEditor)}
        </>
      );
    }
    return <></>;
  }

  private onChooseAttachment() {
    this.fileInput.current?.click();
  }

  private async onChoseAttachment() {
    // Build attachments list
    let attachmentsFileList = null;

    // this is terrible, but we have to reset the input value manually.
    // otherwise, the user won't be able to select two times the same file for example.
    if (this.fileInput.current?.files) {
      attachmentsFileList = Array.from(this.fileInput.current.files);
      this.fileInput.current.files = null;
      this.fileInput.current.value = '';
    }
    if (!attachmentsFileList || attachmentsFileList.length === 0) {
      return;
    }
    this.props.onChoseAttachments(attachmentsFileList);
  }

  private async onKeyDown(event: any) {
    if (event.key === 'Enter' && !event.shiftKey) {
      // If shift, newline. Else send message.
      event.preventDefault();
      await this.onSendMessage();
    } else if (event.key === 'Escape' && this.state.showEmojiPanel) {
      this.hideEmojiPanel();
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      // swallow pageUp events if they occurs on the composition box (it breaks the app layout)
      event.preventDefault();
    }
  }

  private async onKeyUp(event: any) {
    const { message } = this.state;
    // Called whenever the user changes the message composition field. But only
    //   fires if there's content in the message field after the change.
    // Also, check for a message length change before firing it up, to avoid
    // catching ESC, tab, or whatever which is not typing
    if (message.length && message.length !== this.lastBumpTypingMessageLength) {
      const conversationModel = getConversationController().get(this.props.selectedConversationKey);
      if (!conversationModel) {
        return;
      }
      conversationModel.throttledBumpTyping();
      this.lastBumpTypingMessageLength = message.length;
    }
  }

  private parseEmojis(value: string) {
    const emojisArray = toArray(value);

    // toArray outputs React elements for emojis and strings for other
    return emojisArray.reduce((previous: string, current: any) => {
      if (typeof current === 'string') {
        return previous + current;
      }
      return previous + (current.props.children as string);
    }, '');
  }

  // tslint:disable-next-line: cyclomatic-complexity
  private async onSendMessage() {
    this.abortLinkPreviewFetch();

    // this is dirty but we have to replace all @(xxx) by @xxx manually here
    const cleanMentions = (text: string): string => {
      const matches = text.match(this.mentionsRegex);
      let replacedMentions = text;
      (matches || []).forEach(match => {
        const replacedMention = match.substring(2, match.indexOf('\uFFD7'));
        replacedMentions = replacedMentions.replace(match, `@${replacedMention}`);
      });

      return replacedMentions;
    };

    const messagePlaintext = cleanMentions(this.parseEmojis(this.state.message));

    const { isBlocked, isPrivate, left, isKickedFromGroup } = this.props;

    if (isBlocked && isPrivate) {
      ToastUtils.pushUnblockToSend();
      return;
    }
    if (isBlocked && !isPrivate) {
      ToastUtils.pushUnblockToSendGroup();
      return;
    }
    // Verify message length
    const msgLen = messagePlaintext?.length || 0;
    if (msgLen === 0 && this.props.stagedAttachments?.length === 0) {
      ToastUtils.pushMessageBodyMissing();
      return;
    }

    if (!isPrivate && left) {
      ToastUtils.pushYouLeftTheGroup();
      return;
    }
    if (!isPrivate && isKickedFromGroup) {
      ToastUtils.pushYouLeftTheGroup();
      return;
    }

    const { quotedMessageProps } = this.props;
    const { stagedLinkPreview } = this.state;

    // Send message
    const extractedQuotedMessageProps = _.pick(
      quotedMessageProps,
      'id',
      'author',
      'text',
      'attachments'
    );

    // we consider that a link previews without a title at least is not a preview
    const linkPreviews =
      (stagedLinkPreview &&
        stagedLinkPreview.isLoaded &&
        stagedLinkPreview.title?.length && [_.pick(stagedLinkPreview, 'url', 'image', 'title')]) ||
      [];

    try {
      const attachments = await this.getFiles();
      await this.props.sendMessage(
        messagePlaintext,
        attachments,
        extractedQuotedMessageProps,
        linkPreviews,
        null,
        {}
      );

      this.props.clearAttachments();

      // Empty composition box and stagedAttachments
      this.setState({
        message: '',
        showEmojiPanel: false,
        stagedLinkPreview: undefined,
        ignoredLink: undefined,
      });
    } catch (e) {
      // Message sending failed
      window?.log?.error(e);
    }
  }

  // this function is called right before sending a message, to gather really the files behind attachments.
  private async getFiles() {
    const { stagedAttachments } = this.props;
    // scale them down
    const files = await Promise.all(
      stagedAttachments.map(attachment =>
        AttachmentUtil.getFile(attachment, {
          maxSize: Constants.CONVERSATION.MAX_ATTACHMENT_FILESIZE_BYTES,
        })
      )
    );
    this.props.clearAttachments();
    return files;
  }

  private async sendVoiceMessage(audioBlob: Blob) {
    if (!this.state.showRecordingView) {
      return;
    }

    const fileBuffer = await new Response(audioBlob).arrayBuffer();

    const audioAttachment: Attachment = {
      data: fileBuffer,
      flags: SignalService.AttachmentPointer.Flags.VOICE_MESSAGE,
      contentType: MIME.AUDIO_MP3,
      size: audioBlob.size,
    };

    const messageSuccess = this.props.sendMessage(
      '',
      [audioAttachment],
      undefined,
      undefined,
      null,
      {}
    );

    if (messageSuccess) {
      // success!
    }

    this.onExitVoiceNoteView();
  }

  private async onLoadVoiceNoteView() {
    // Do stuff for component, then run callback to SessionConversation
    const mediaSetting = await window.getSettingValue('media-permissions');

    if (mediaSetting) {
      this.setState({
        showRecordingView: true,
        showEmojiPanel: false,
      });
      this.props.onLoadVoiceNoteView();

      return;
    }

    ToastUtils.pushAudioPermissionNeeded(() => {
      window.inboxStore?.dispatch(showLeftPaneSection(SectionType.Settings));
      window.inboxStore?.dispatch(showSettingsSection(SessionSettingCategory.Privacy));
    });
  }

  private onExitVoiceNoteView() {
    // Do stuff for component, then run callback to SessionConversation
    this.setState({ showRecordingView: false });
    this.props.onExitVoiceNoteView();
  }

  private onChange(event: any) {
    const message = event.target.value ?? '';

    this.setState({ message });
  }

  private onEmojiClick({ colons }: { colons: string }) {
    const messageBox = this.textarea.current;
    if (!messageBox) {
      return;
    }

    const { message } = this.state;

    const currentSelectionStart = Number(messageBox.selectionStart);
    const currentSelectionEnd = Number(messageBox.selectionEnd);

    const before = message.slice(0, currentSelectionStart);
    const end = message.slice(currentSelectionEnd);
    const newMessage = `${before}${colons}${end}`;

    this.setState({ message: newMessage }, () => {
      // update our selection because updating text programmatically
      // will put the selection at the end of the textarea
      const selectionStart = currentSelectionStart + Number(colons.length);
      messageBox.selectionStart = selectionStart;
      messageBox.selectionEnd = selectionStart;

      // Sometimes, we have to repeat the set of the selection position with a timeout to be effective
      setTimeout(() => {
        messageBox.selectionStart = selectionStart;
        messageBox.selectionEnd = selectionStart;
      }, 20);
    });
  }

  private focusCompositionBox() {
    // Focus the textarea when user clicks anywhere in the composition box
    this.textarea.current?.focus();
  }

  private abortLinkPreviewFetch() {
    this.linkPreviewAbortController?.abort();
  }
}
