import { queueAttachmentDownloads } from './attachments';

import { Quote } from './types';
import { PubKey } from '../session/types';
import _ from 'lodash';
import { SignalService } from '../protobuf';
import { StringUtils, UserUtils } from '../session/utils';
import { getConversationController } from '../session/conversations';
import { ConversationModel, ConversationTypeEnum } from '../models/conversation';
import { MessageModel } from '../models/message';
import { getMessageController } from '../session/messages';
import { getMessageById, getMessagesBySentAt } from '../../ts/data/data';
import { actions as conversationActions } from '../state/ducks/conversations';
import { updateProfileOneAtATime } from './dataMessage';
import Long from 'long';

async function handleGroups(
  conversation: ConversationModel,
  group: any,
  source: any
): Promise<any> {
  const GROUP_TYPES = SignalService.GroupContext.Type;

  let groupUpdate = null;

  // conversation attributes
  const attributes: any = {
    type: 'group',
    groupId: group.id,
    ...conversation.attributes,
  };

  const oldMembers = conversation.get('members');

  if (group.type === GROUP_TYPES.UPDATE) {
    attributes.name = group.name;
    attributes.members = group.members;

    groupUpdate = conversation.changedAttributes(_.pick(group, 'name', 'avatar')) || {};

    const addedMembers = _.difference(attributes.members, oldMembers);
    if (addedMembers.length > 0) {
      groupUpdate.joined = addedMembers;
    }
    if (conversation.get('left')) {
      // TODO: Maybe we shouldn't assume this message adds us:
      // we could maybe still get this message by mistake
      window?.log?.warn('re-added to a left group');
      attributes.left = false;
    }

    if (attributes.isKickedFromGroup) {
      // Assume somebody re-invited us since we received this update
      attributes.isKickedFromGroup = false;
    }

    // Check if anyone got kicked:
    const removedMembers = _.difference(oldMembers, attributes.members);
    const ourDeviceWasRemoved = removedMembers.some(member => UserUtils.isUsFromCache(member));

    if (ourDeviceWasRemoved) {
      groupUpdate.kicked = 'You';
      attributes.isKickedFromGroup = true;
    } else if (removedMembers.length) {
      groupUpdate.kicked = removedMembers;
    }
  } else if (group.type === GROUP_TYPES.QUIT) {
    if (UserUtils.isUsFromCache(source)) {
      attributes.left = true;
      groupUpdate = { left: 'You' };
    } else {
      groupUpdate = { left: source };
    }
    attributes.members = _.without(oldMembers, source);
  }

  conversation.set(attributes);

  return groupUpdate;
}

function contentTypeSupported(type: string): boolean {
  const Chrome = window.Signal.Util.GoogleChrome;
  return Chrome.isImageTypeSupported(type) || Chrome.isVideoTypeSupported(type);
}

async function copyFromQuotedMessage(
  msg: MessageModel,
  quote?: Quote,
  attemptCount: number = 1
): Promise<void> {
  const { upgradeMessageSchema } = window.Signal.Migrations;
  const { Message: TypedMessage, Errors } = window.Signal.Types;

  if (!quote) {
    return;
  }

  const { attachments, id: longId, author } = quote;
  const firstAttachment = attachments[0];

  const id: number = Long.isLong(longId) ? longId.toNumber() : longId;

  // We always look for the quote by sentAt timestamp, for opengroups, closed groups and session chats
  // this will return an array of sent message by id we have locally.

  const collection = await getMessagesBySentAt(id);
  // we now must make sure this is the sender we expect
  const found = collection.find(message => {
    return Boolean(author === message.getSource());
  });

  if (!found) {
    // Exponential backoff, giving up after 5 attempts:
    if (attemptCount < 5) {
      setTimeout(() => {
        window?.log?.info(`Looking for the message id : ${id}, attempt: ${attemptCount + 1}`);
        void copyFromQuotedMessage(msg, quote, attemptCount + 1);
      }, attemptCount * attemptCount * 500);
    } else {
      window?.log?.warn(`We did not found quoted message ${id} after ${attemptCount} attempts.`);
    }

    quote.referencedMessageNotFound = true;
    return;
  }

  window?.log?.info(`Found quoted message id: ${id}`);
  quote.referencedMessageNotFound = false;

  const queryMessage = getMessageController().register(found.id, found);
  quote.text = queryMessage.get('body') || '';

  if (attemptCount > 1) {
    // Normally the caller would save the message, but in case we are
    // called by a timer, we need to update the message manually
    msg.set({ quote });
    await msg.commit();
    return;
  }

  if (!firstAttachment || !contentTypeSupported(firstAttachment.contentType)) {
    return;
  }

  firstAttachment.thumbnail = null;

  try {
    if ((queryMessage.get('schemaVersion') || 0) < TypedMessage.VERSION_NEEDED_FOR_DISPLAY) {
      const upgradedMessage = await upgradeMessageSchema(queryMessage.attributes);
      queryMessage.set(upgradedMessage);
      await upgradedMessage.commit();
    }
  } catch (error) {
    window?.log?.error(
      'Problem upgrading message quoted message from database',
      Errors.toLogFormat(error)
    );
    return;
  }

  const queryAttachments = queryMessage.get('attachments') || [];

  if (queryAttachments.length > 0) {
    const queryFirst = queryAttachments[0];
    const { thumbnail } = queryFirst;

    if (thumbnail && thumbnail.path) {
      firstAttachment.thumbnail = {
        ...thumbnail,
        copied: true,
      };
    }
  }

  const queryPreview = queryMessage.get('preview') || [];
  if (queryPreview.length > 0) {
    const queryFirst = queryPreview[0];
    const { image } = queryFirst;

    if (image && image.path) {
      firstAttachment.thumbnail = {
        ...image,
        copied: true,
      };
    }
  }
}

function handleLinkPreviews(messageBody: string, messagePreview: any, message: MessageModel) {
  const urls = window.Signal.LinkPreviews.findLinks(messageBody);
  const incomingPreview = messagePreview || [];
  const preview = incomingPreview.filter(
    (item: any) => (item.image || item.title) && urls.includes(item.url)
  );
  if (preview.length < incomingPreview.length) {
    window?.log?.info(
      `${message.idForLogging()}: Eliminated ${preview.length -
        incomingPreview.length} previews with invalid urls'`
    );
  }

  message.set({ preview });
}

async function processProfileKey(
  source: string,
  conversation: ConversationModel,
  sendingDeviceConversation: ConversationModel,
  profileKeyBuffer: Uint8Array
) {
  const profileKey = StringUtils.decode(profileKeyBuffer, 'base64');
  if (conversation.isPrivate()) {
    await conversation.setProfileKey(profileKey);
  } else {
    await sendingDeviceConversation.setProfileKey(profileKey);
  }
}

function handleMentions(
  message: MessageModel,
  conversation: ConversationModel,
  ourPrimaryNumber: PubKey
) {
  const body = message.get('body');
  if (body && body.indexOf(`@${ourPrimaryNumber.key}`) !== -1) {
    conversation.set({ mentionedUs: true });
  }
}

function updateReadStatus(message: MessageModel, conversation: ConversationModel) {
  const readSync = window.Whisper.ReadSyncs.forMessage(message);
  if (readSync) {
    const shouldExpire = message.get('expireTimer');
    const alreadyStarted = message.get('expirationStartTimestamp');
    if (shouldExpire && !alreadyStarted) {
      // Start message expiration timer
      const start = Math.min(readSync.get('read_at'), Date.now());
      message.set('expirationStartTimestamp', start);
    }
  }
  if (readSync || message.isExpirationTimerUpdate()) {
    message.set({ unread: 0 });

    // This is primarily to allow the conversation to mark all older
    // messages as read, as is done when we receive a read sync for
    // a message we already know about.
    void conversation.onReadMessage(message, Date.now());
  }
}

function handleSyncedReceipts(message: MessageModel, conversation: ConversationModel) {
  const readReceipts = window.Whisper.ReadReceipts.forMessage(conversation, message);
  if (readReceipts.length) {
    const readBy = readReceipts.map((receipt: any) => receipt.get('reader'));
    message.set({
      read_by: _.union(message.get('read_by'), readBy),
    });
  }

  // A sync'd message to ourself is automatically considered read
  const recipients = conversation.getRecipients();
  if (conversation.isMe()) {
    message.set({
      read_by: recipients,
    });
  }

  message.set({ recipients });
}

async function handleRegularMessage(
  conversation: ConversationModel,
  message: MessageModel,
  initialMessage: any,
  source: string,
  ourNumber: string
) {
  const { upgradeMessageSchema } = window.Signal.Migrations;

  const type = message.get('type');
  await copyFromQuotedMessage(message, initialMessage.quote);

  // `upgradeMessageSchema` only seems to add `schemaVersion: 10` to the message
  const dataMessage = await upgradeMessageSchema(initialMessage);

  const now = Date.now();

  // Medium groups might have `group` set even if with group chat messages...
  if (dataMessage.group && !conversation.isMediumGroup()) {
    // This is not necessarily a group update message, it could also be a regular group message
    const groupUpdate = await handleGroups(conversation, dataMessage.group, source);
    if (groupUpdate !== null) {
      message.set({ group_update: groupUpdate });
    }
  }

  if (dataMessage.openGroupInvitation) {
    message.set({ groupInvitation: dataMessage.openGroupInvitation });
  }

  handleLinkPreviews(dataMessage.body, dataMessage.preview, message);
  const existingExpireTimer = conversation.get('expireTimer');

  message.set({
    flags: dataMessage.flags,
    hasAttachments: dataMessage.hasAttachments,
    hasFileAttachments: dataMessage.hasFileAttachments,
    hasVisualMediaAttachments: dataMessage.hasVisualMediaAttachments,
    quote: dataMessage.quote,
    schemaVersion: dataMessage.schemaVersion,
    attachments: dataMessage.attachments,
    body: dataMessage.body,
    conversationId: conversation.id,
    decrypted_at: now,
    errors: [],
  });

  if (existingExpireTimer) {
    message.set({ expireTimer: existingExpireTimer });
  }

  // Expire timer updates are now explicit.
  // We don't handle an expire timer from a incoming message except if it is an ExpireTimerUpdate message.

  const ourPubKey = PubKey.cast(ourNumber);

  handleMentions(message, conversation, ourPubKey);

  if (type === 'incoming') {
    updateReadStatus(message, conversation);
  }

  if (type === 'outgoing') {
    handleSyncedReceipts(message, conversation);
  }

  const conversationActiveAt = conversation.get('active_at');
  if (!conversationActiveAt || (message.get('sent_at') || 0) > conversationActiveAt) {
    conversation.set({
      active_at: message.get('sent_at'),
      lastMessage: message.getNotificationText(),
    });
  }

  const sendingDeviceConversation = await getConversationController().getOrCreateAndWait(
    source,
    ConversationTypeEnum.PRIVATE
  );

  // Check if we need to update any profile names
  // the only profile we don't update with what is coming here is ours,
  // as our profile is shared accross our devices with a ConfigurationMessage
  if (type === 'incoming' && dataMessage.profile) {
    void updateProfileOneAtATime(
      sendingDeviceConversation,
      dataMessage.profile,
      dataMessage.profileKey
    );
  }

  if (dataMessage.profileKey) {
    await processProfileKey(
      source,
      conversation,
      sendingDeviceConversation,
      dataMessage.profileKey
    );
  }

  // we just received a message from that user so we reset the typing indicator for this convo
  await conversation.notifyTyping({
    isTyping: false,
    sender: source,
  });
}

async function handleExpirationTimerUpdate(
  conversation: ConversationModel,
  message: MessageModel,
  source: string,
  expireTimer: number
) {
  // TODO: if the message is an expiration timer update, it
  // shouldn't be responsible for anything else!!!
  message.set({
    expirationTimerUpdate: {
      source,
      expireTimer,
    },
  });
  conversation.set({ expireTimer });

  window?.log?.info("Update conversation 'expireTimer'", {
    id: conversation.idForLogging(),
    expireTimer,
    source: 'handleDataMessage',
  });

  await conversation.updateExpirationTimer(expireTimer, source, message.get('received_at'));
}

export async function handleMessageJob(
  message: MessageModel,
  conversation: ConversationModel,
  initialMessage: any,
  ourNumber: string,
  confirm: () => void,
  source: string
) {
  window?.log?.info(
    `Starting handleDataMessage for message ${message.idForLogging()} in conversation ${conversation.idForLogging()}`
  );

  try {
    message.set({ flags: initialMessage.flags });
    if (message.isExpirationTimerUpdate()) {
      const { expireTimer } = initialMessage;
      const oldValue = conversation.get('expireTimer');
      if (expireTimer === oldValue) {
        if (confirm) {
          confirm();
        }
        window?.log?.info(
          'Dropping ExpireTimerUpdate message as we already have the same one set.'
        );
        return;
      }
      await handleExpirationTimerUpdate(conversation, message, source, expireTimer);
    } else {
      await handleRegularMessage(conversation, message, initialMessage, source, ourNumber);
    }

    const id = await message.commit();

    message.set({ id });
    // this updates the redux store.
    // if the convo on which this message should become visible,
    // it will be shown to the user, and might as well be read right away
    window.inboxStore?.dispatch(
      conversationActions.messageAdded({
        conversationKey: conversation.id,
        messageModelProps: message.getProps(),
      })
    );
    getMessageController().register(message.id, message);

    // Note that this can save the message again, if jobs were queued. We need to
    //   call it after we have an id for this message, because the jobs refer back
    //   to their source message.

    void queueAttachmentDownloads(message, conversation);

    const unreadCount = await conversation.getUnreadCount();
    conversation.set({ unreadCount });
    // this is a throttled call and will only run once every 1 sec
    conversation.updateLastMessage();
    await conversation.commit();

    try {
      // We go to the database here because, between the message save above and
      // the previous line's trigger() call, we might have marked all messages
      // unread in the database. This message might already be read!
      const fetched = await getMessageById(message.get('id'));

      const previousUnread = message.get('unread');

      // Important to update message with latest read state from database
      message.merge(fetched);

      if (previousUnread !== message.get('unread')) {
        window?.log?.warn(
          'Caught race condition on new message read state! ' + 'Manually starting timers.'
        );
        // We call markRead() even though the message is already
        // marked read because we need to start expiration
        // timers, etc.
        await message.markRead(Date.now());
      }
    } catch (error) {
      window?.log?.warn('handleDataMessage: Message', message.idForLogging(), 'was deleted');
    }

    if (message.get('unread')) {
      await conversation.throttledNotify(message);
    }

    if (confirm) {
      confirm();
    }
  } catch (error) {
    const errorForLog = error && error.stack ? error.stack : error;
    window?.log?.error('handleDataMessage', message.idForLogging(), 'error:', errorForLog);

    throw error;
  }
}
