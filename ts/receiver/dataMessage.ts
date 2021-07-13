import { SignalService } from './../protobuf';
import { removeFromCache } from './cache';
import { EnvelopePlus } from './types';
import { getEnvelopeId } from './common';

import { PubKey } from '../session/types';
import { handleMessageJob } from './queuedJob';
import { downloadAttachment } from './attachments';
import _ from 'lodash';
import { StringUtils, UserUtils } from '../session/utils';
import { getMessageQueue } from '../session';
import { getConversationController } from '../session/conversations';
import { handleClosedGroupControlMessage } from './closedGroups';
import { MessageModel } from '../models/message';
import { MessageModelType } from '../models/messageType';
import {
  getMessageBySender,
  getMessageBySenderAndServerId,
  getMessageBySenderAndServerTimestamp,
} from '../../ts/data/data';
import { ConversationModel, ConversationTypeEnum } from '../models/conversation';
import { allowOnlyOneAtATime } from '../session/utils/Promise';

export async function updateProfileOneAtATime(
  conversation: ConversationModel,
  profile: SignalService.DataMessage.ILokiProfile,
  profileKey: any
) {
  if (!conversation?.id) {
    window?.log?.warn('Cannot update profile with empty convoid');
    return;
  }
  const oneAtaTimeStr = `updateProfileOneAtATime:${conversation.id}`;
  return allowOnlyOneAtATime(oneAtaTimeStr, async () => {
    return updateProfile(conversation, profile, profileKey);
  });
}

async function updateProfile(
  conversation: ConversationModel,
  profile: SignalService.DataMessage.ILokiProfile,
  profileKey: any
) {
  const { dcodeIO, textsecure, Signal } = window;

  // Retain old values unless changed:
  const newProfile = conversation.get('profile') || {};

  newProfile.displayName = profile.displayName;

  if (profile.profilePicture) {
    const prevPointer = conversation.get('avatarPointer');
    const needsUpdate = !prevPointer || !_.isEqual(prevPointer, profile.profilePicture);

    if (needsUpdate) {
      try {
        const downloaded = await downloadAttachment({
          url: profile.profilePicture,
          isRaw: true,
        });

        // null => use placeholder with color and first letter
        let path = null;
        if (profileKey) {
          // Convert profileKey to ArrayBuffer, if needed
          const encoding = typeof profileKey === 'string' ? 'base64' : null;
          try {
            const profileKeyArrayBuffer = dcodeIO.ByteBuffer.wrap(
              profileKey,
              encoding
            ).toArrayBuffer();
            const decryptedData = await textsecure.crypto.decryptProfile(
              downloaded.data,
              profileKeyArrayBuffer
            );
            const upgraded = await Signal.Migrations.processNewAttachment({
              ...downloaded,
              data: decryptedData,
            });
            // Only update the convo if the download and decrypt is a success
            conversation.set('avatarPointer', profile.profilePicture);
            conversation.set('profileKey', profileKey);
            ({ path } = upgraded);
          } catch (e) {
            window?.log?.error(`Could not decrypt profile image: ${e}`);
          }
        }
        newProfile.avatar = path;
      } catch (e) {
        window.log.warn('Failed to download attachment at', profile.profilePicture);
        return;
      }
    }
  } else {
    newProfile.avatar = null;
  }

  const conv = await getConversationController().getOrCreateAndWait(
    conversation.id,
    ConversationTypeEnum.PRIVATE
  );
  await conv.setLokiProfile(newProfile);
}

function cleanAttachment(attachment: any) {
  return {
    ..._.omit(attachment, 'thumbnail'),
    id: attachment.id.toString(),
    key: attachment.key ? StringUtils.decode(attachment.key, 'base64') : null,
    digest:
      attachment.digest && attachment.digest.length > 0
        ? StringUtils.decode(attachment.digest, 'base64')
        : null,
  };
}

function cleanAttachments(decrypted: any) {
  const { quote, group } = decrypted;

  // Here we go from binary to string/base64 in all AttachmentPointer digest/key fields

  if (group && group.type === SignalService.GroupContext.Type.UPDATE) {
    if (group.avatar !== null) {
      group.avatar = cleanAttachment(group.avatar);
    }
  }

  decrypted.attachments = (decrypted.attachments || []).map(cleanAttachment);
  decrypted.preview = (decrypted.preview || []).map((item: any) => {
    const { image } = item;

    if (!image) {
      return item;
    }

    return {
      ...item,
      image: cleanAttachment(image),
    };
  });

  if (quote) {
    if (quote.id) {
      quote.id = _.toNumber(quote.id);
    }

    quote.attachments = (quote.attachments || []).map((item: any) => {
      const { thumbnail } = item;

      if (!thumbnail || thumbnail.length === 0) {
        return item;
      }

      return {
        ...item,
        thumbnail: cleanAttachment(item.thumbnail),
      };
    });
  }
}

export async function processDecrypted(
  envelope: EnvelopePlus,
  decrypted: SignalService.IDataMessage
) {
  /* tslint:disable:no-bitwise */
  const FLAGS = SignalService.DataMessage.Flags;

  // Now that its decrypted, validate the message and clean it up for consumer
  //   processing
  // Note that messages may (generally) only perform one action and we ignore remaining
  //   fields after the first action.

  if (decrypted.flags == null) {
    decrypted.flags = 0;
  }
  if (decrypted.expireTimer == null) {
    decrypted.expireTimer = 0;
  }
  if (decrypted.flags & FLAGS.EXPIRATION_TIMER_UPDATE) {
    decrypted.body = '';
    decrypted.attachments = [];
  } else if (decrypted.flags !== 0) {
    throw new Error('Unknown flags in message');
  }

  if (decrypted.group) {
    // decrypted.group.id = new TextDecoder('utf-8').decode(decrypted.group.id);

    switch (decrypted.group.type) {
      case SignalService.GroupContext.Type.UPDATE:
        decrypted.body = '';
        decrypted.attachments = [];
        break;
      case SignalService.GroupContext.Type.QUIT:
        decrypted.body = '';
        decrypted.attachments = [];
        break;
      case SignalService.GroupContext.Type.DELIVER:
        decrypted.group.name = null;
        decrypted.group.members = [];
        decrypted.group.avatar = null;
        break;
      case SignalService.GroupContext.Type.REQUEST_INFO:
        decrypted.body = '';
        decrypted.attachments = [];
        break;
      default:
        await removeFromCache(envelope);
        throw new Error('Unknown group message type');
    }
  }

  const attachmentCount = decrypted?.attachments?.length || 0;
  const ATTACHMENT_MAX = 32;
  if (attachmentCount > ATTACHMENT_MAX) {
    await removeFromCache(envelope);
    throw new Error(
      `Too many attachments: ${attachmentCount} included in one message, max is ${ATTACHMENT_MAX}`
    );
  }

  cleanAttachments(decrypted);

  // if the decrypted dataMessage timestamp is not set, copy the one from the envelope
  if (!_.toNumber(decrypted?.timestamp)) {
    decrypted.timestamp = envelope.timestamp;
  }

  return decrypted as SignalService.DataMessage;
  /* tslint:disable:no-bitwise */
}

export function isMessageEmpty(message: SignalService.DataMessage) {
  const { flags, body, attachments, group, quote, preview, openGroupInvitation } = message;

  return (
    !flags &&
    // FIXME remove this hack to drop auto friend requests messages in a few weeks 15/07/2020
    isBodyEmpty(body) &&
    _.isEmpty(attachments) &&
    _.isEmpty(group) &&
    _.isEmpty(quote) &&
    _.isEmpty(preview) &&
    _.isEmpty(openGroupInvitation)
  );
}

function isBodyEmpty(body: string) {
  return _.isEmpty(body);
}

/**
 * We have a few origins possible
 *    - if the message is from a private conversation with a friend and he wrote to us,
 *        the conversation to add the message to is our friend pubkey, so envelope.source
 *    - if the message is from a medium group conversation
 *        * envelope.source is the medium group pubkey
 *        * envelope.senderIdentity is the author pubkey (the one who sent the message)
 *    - at last, if the message is a syncMessage,
 *        * envelope.source is our pubkey (our other device has the same pubkey as us)
 *        * dataMessage.syncTarget is either the group public key OR the private conversation this message is about.
 */
export async function handleDataMessage(
  envelope: EnvelopePlus,
  dataMessage: SignalService.IDataMessage
): Promise<void> {
  // we handle group updates from our other devices in handleClosedGroupControlMessage()
  if (dataMessage.closedGroupControlMessage) {
    await handleClosedGroupControlMessage(
      envelope,
      dataMessage.closedGroupControlMessage as SignalService.DataMessage.ClosedGroupControlMessage
    );
    return;
  }

  const message = await processDecrypted(envelope, dataMessage);
  const source = dataMessage.syncTarget || envelope.source;
  const senderPubKey = envelope.senderIdentity || envelope.source;
  const isMe = UserUtils.isUsFromCache(senderPubKey);
  const isSyncMessage = Boolean(dataMessage.syncTarget?.length);

  window?.log?.info(`Handle dataMessage from ${source} `);

  if (isSyncMessage && !isMe) {
    window?.log?.warn('Got a sync message from someone else than me. Dropping it.');
    return removeFromCache(envelope);
  } else if (isSyncMessage && dataMessage.syncTarget) {
    // override the envelope source
    envelope.source = dataMessage.syncTarget;
  }

  const senderConversation = await getConversationController().getOrCreateAndWait(
    senderPubKey,
    ConversationTypeEnum.PRIVATE
  );

  // Check if we need to update any profile names
  if (!isMe && senderConversation && message.profile) {
    // do not await this
    void updateProfileOneAtATime(senderConversation, message.profile, message.profileKey);
  }
  if (isMessageEmpty(message)) {
    window?.log?.warn(`Message ${getEnvelopeId(envelope)} ignored; it was empty`);
    return removeFromCache(envelope);
  }

  const ev: any = {};
  if (isMe) {
    // Data messages for medium groups don't arrive as sync messages. Instead,
    // linked devices poll for group messages independently, thus they need
    // to recognise some of those messages at their own.
    ev.type = 'sent';
  } else {
    ev.type = 'message';
  }

  if (envelope.senderIdentity) {
    message.group = {
      id: envelope.source as any, // FIXME Uint8Array vs string
    };
  }

  ev.confirm = () => removeFromCache(envelope);

  ev.data = {
    source: senderPubKey,
    destination: isMe ? message.syncTarget : undefined,
    sourceDevice: 1,
    timestamp: _.toNumber(envelope.timestamp),
    receivedAt: envelope.receivedAt,
    message,
  };

  await handleMessageEvent(ev); // dataMessage
}

type MessageDuplicateSearchType = {
  body: string;
  id: string;
  timestamp: number;
  serverId?: number;
};

export type MessageId = {
  source: string;
  serverId: number;
  serverTimestamp: number;
  sourceDevice: number;
  timestamp: number;
  message: MessageDuplicateSearchType;
};
const PUBLICCHAT_MIN_TIME_BETWEEN_DUPLICATE_MESSAGES = 10 * 1000; // 10s

export async function isMessageDuplicate({
  source,
  sourceDevice,
  timestamp,
  message,
  serverId,
  serverTimestamp,
}: MessageId) {
  const { Errors } = window.Signal.Types;
  // serverId is only used for opengroupv2
  try {
    let result;
    if (serverId || serverTimestamp) {
      // first try to find a duplicate serverId from this sender
      if (serverId) {
        result = await getMessageBySenderAndServerId({
          source,
          serverId,
        });
      }
      // if no result, try to find a duplicate with the same serverTimestamp from this sender
      if (!result && serverTimestamp) {
        result = await getMessageBySenderAndServerTimestamp({
          source,
          serverTimestamp,
        });
      }
      // if we have a result, it means a specific user sent two messages either with the same
      // serverId or the same serverTimestamp.
      // no need to do anything else, those messages must be the same
      // Note: this test is not based on which conversation the user sent the message
      // but we consider that a user sending two messages with the same serverTimestamp is unlikely
      return Boolean(result);
    } else {
      result = await getMessageBySender({
        source,
        sourceDevice,
        sentAt: timestamp,
      });
    }
    if (!result) {
      return false;
    }
    const filteredResult = [result].filter((m: any) => m.attributes.body === message.body);
    return filteredResult.some(m => isDuplicate(m, message, source));
  } catch (error) {
    window?.log?.error('isMessageDuplicate error:', Errors.toLogFormat(error));
    return false;
  }
}

export const isDuplicate = (
  m: MessageModel,
  testedMessage: MessageDuplicateSearchType,
  source: string
) => {
  // The username in this case is the users pubKey
  const sameUsername = m.attributes.source === source;
  const sameText = m.attributes.body === testedMessage.body;
  // Don't filter out messages that are too far apart from each other
  const timestampsSimilar =
    Math.abs(m.attributes.sent_at - testedMessage.timestamp) <=
    PUBLICCHAT_MIN_TIME_BETWEEN_DUPLICATE_MESSAGES;

  return sameUsername && sameText && timestampsSimilar;
};

async function handleProfileUpdate(
  profileKeyBuffer: Uint8Array,
  convoId: string,
  convoType: ConversationTypeEnum,
  isIncoming: boolean
) {
  const profileKey = StringUtils.decode(profileKeyBuffer, 'base64');

  if (!isIncoming) {
    // We update our own profileKey if it's different from what we have
    const ourNumber = UserUtils.getOurPubKeyStrFromCache();
    const me = getConversationController().getOrCreate(ourNumber, ConversationTypeEnum.PRIVATE);

    // Will do the save for us if needed
    await me.setProfileKey(profileKey);
  } else {
    const sender = await getConversationController().getOrCreateAndWait(
      convoId,
      ConversationTypeEnum.PRIVATE
    );

    // Will do the save for us
    await sender.setProfileKey(profileKey);
  }
}

export interface MessageCreationData {
  timestamp: number;
  isPublic: boolean;
  receivedAt: number;
  sourceDevice: number; // always 1 isn't it?
  source: string;
  serverId: number;
  message: any;
  serverTimestamp: any;

  // Needed for synced outgoing messages
  unidentifiedStatus: any; // ???
  expirationStartTimestamp: any; // ???
  destination: string;
}

export function initIncomingMessage(data: MessageCreationData): MessageModel {
  const {
    timestamp,
    isPublic,
    receivedAt,
    sourceDevice,
    source,
    serverId,
    message,
    serverTimestamp,
  } = data;

  const messageGroupId = message?.group?.id;
  let groupId = messageGroupId && messageGroupId.length > 0 ? messageGroupId : null;

  if (groupId) {
    groupId = PubKey.removeTextSecurePrefixIfNeeded(groupId);
  }

  const messageData: any = {
    source,
    sourceDevice,
    serverId, // + (not present below in `createSentMessage`)
    sent_at: timestamp,
    serverTimestamp,
    received_at: receivedAt || Date.now(),
    conversationId: groupId ?? source,
    type: 'incoming',
    direction: 'incoming', // +
    unread: 1, // +
    isPublic, // +
  };

  return new MessageModel(messageData);
}

function createSentMessage(data: MessageCreationData): MessageModel {
  const now = Date.now();

  const {
    timestamp,
    serverTimestamp,
    serverId,
    isPublic,
    receivedAt,
    sourceDevice,
    expirationStartTimestamp,
    destination,
    message,
  } = data;

  const sentSpecificFields = {
    sent_to: [],
    sent: true,
    expirationStartTimestamp: Math.min(expirationStartTimestamp || data.timestamp || now, now),
  };

  const messageGroupId = message?.group?.id;
  let groupId = messageGroupId && messageGroupId.length > 0 ? messageGroupId : null;

  if (groupId) {
    groupId = PubKey.removeTextSecurePrefixIfNeeded(groupId);
  }

  const messageData = {
    source: UserUtils.getOurPubKeyStrFromCache(),
    sourceDevice,
    serverTimestamp,
    serverId,
    sent_at: timestamp,
    received_at: isPublic ? receivedAt : now,
    isPublic,
    conversationId: groupId ?? destination,
    type: 'outgoing' as MessageModelType,
    ...sentSpecificFields,
  };

  return new MessageModel(messageData);
}

export function createMessage(data: MessageCreationData, isIncoming: boolean): MessageModel {
  if (isIncoming) {
    return initIncomingMessage(data);
  } else {
    return createSentMessage(data);
  }
}

export interface MessageEvent {
  data: any;
  type: string;
  confirm: () => void;
}

// tslint:disable:cyclomatic-complexity max-func-body-length */
export async function handleMessageEvent(event: MessageEvent): Promise<void> {
  const { data, confirm } = event;

  const isIncoming = event.type === 'message';

  if (!data || !data.message) {
    window?.log?.warn('Invalid data passed to handleMessageEvent.', event);
    confirm();
    return;
  }

  const { message, destination } = data;

  let { source } = data;

  const isGroupMessage = Boolean(message.group);

  const type = isGroupMessage ? ConversationTypeEnum.GROUP : ConversationTypeEnum.PRIVATE;

  let conversationId = isIncoming ? source : destination || source; // for synced message
  if (!conversationId) {
    window?.log?.error('We cannot handle a message without a conversationId');
    confirm();
    return;
  }
  if (message.profileKey?.length) {
    await handleProfileUpdate(message.profileKey, conversationId, type, isIncoming);
  }

  const msg = createMessage(data, isIncoming);

  // if the message is `sent` (from secondary device) we have to set the sender manually... (at least for now)
  source = source || msg.get('source');

  // Conversation Id is:
  //  - primarySource if it is an incoming DM message,
  //  - destination if it is an outgoing message,
  //  - group.id if it is a group message
  if (isGroupMessage) {
    // remove the prefix from the source object so this is correct for all other
    message.group.id = PubKey.removeTextSecurePrefixIfNeeded(message.group.id);

    conversationId = message.group.id;
  }

  if (!conversationId) {
    window?.log?.warn('Invalid conversation id for incoming message', conversationId);
  }
  const ourNumber = UserUtils.getOurPubKeyStrFromCache();

  // =========================================

  if (!isGroupMessage && source !== ourNumber) {
    // Ignore auth from our devices
    conversationId = source;
  }

  const conversation = await getConversationController().getOrCreateAndWait(conversationId, type);

  if (!conversation) {
    window?.log?.warn('Skipping handleJob for unknown convo: ', conversationId);
    confirm();
    return;
  }

  conversation.queueJob(async () => {
    if (await isMessageDuplicate(data)) {
      window?.log?.info('Received duplicate message. Dropping it.');
      confirm();
      return;
    }
    await handleMessageJob(msg, conversation, message, ourNumber, confirm, source);
  });
}
