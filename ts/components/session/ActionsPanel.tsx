import React, { Dispatch, useEffect, useState } from 'react';
import { SessionIconButton, SessionIconSize, SessionIconType } from './icon';
import { Avatar, AvatarSize } from '../Avatar';
import { darkTheme, lightTheme } from '../../state/ducks/SessionTheme';
import { SessionToastContainer } from './SessionToastContainer';
import { getConversationController } from '../../session/conversations';
import { UserUtils } from '../../session/utils';
import { syncConfigurationIfNeeded } from '../../session/utils/syncUtils';

import {
  generateAttachmentKeyIfEmpty,
  getAllOpenGroupV1Conversations,
  getItemById,
  hasSyncedInitialConfigurationItem,
  lastAvatarUploadTimestamp,
  removeConversation,
  removeOneOpenGroupV1Message,
} from '../../data/data';
import { OnionPaths } from '../../session/onions';
import { getMessageQueue } from '../../session/sending';
import { useDispatch, useSelector } from 'react-redux';
import { getOurNumber } from '../../state/selectors/user';
import {
  getOurPrimaryConversation,
  getUnreadMessageCount,
} from '../../state/selectors/conversations';
import { getTheme } from '../../state/selectors/theme';
import { applyTheme } from '../../state/ducks/theme';
import { getFocusedSection } from '../../state/selectors/section';
import { useInterval } from '../../hooks/useInterval';
import { clearSearch } from '../../state/ducks/search';
import { SectionType, showLeftPaneSection } from '../../state/ducks/section';

import { cleanUpOldDecryptedMedias } from '../../session/crypto/DecryptedAttachmentsManager';
import { getOpenGroupManager } from '../../opengroup/opengroupV2/OpenGroupManagerV2';
import { forceRefreshRandomSnodePool } from '../../session/snode_api/snodePool';
import { getSwarmPollingInstance } from '../../session/snode_api';
import { DURATION } from '../../session/constants';
import { actions as conversationActions } from '../../state/ducks/conversations';
import { editProfileModal, onionPathModal } from '../../state/ducks/modalDialog';
import { uploadOurAvatar } from '../../interactions/conversationInteractions';
import { ModalContainer } from './ModalContainer';
import { debounce } from 'underscore';
import { loadDefaultRooms } from '../../opengroup/opengroupV2/ApiUtil';
import { ActionPanelOnionStatusLight } from '../OnionStatusPathDialog';

// tslint:disable-next-line: no-import-side-effect no-submodule-imports

const Section = (props: { type: SectionType; avatarPath?: string }) => {
  const ourNumber = useSelector(getOurNumber);
  const unreadMessageCount = useSelector(getUnreadMessageCount);
  const theme = useSelector(getTheme);
  const dispatch = useDispatch();
  const { type, avatarPath } = props;

  const focusedSection = useSelector(getFocusedSection);
  const isSelected = focusedSection === props.type;

  const handleClick = () => {
    /* tslint:disable:no-void-expression */
    if (type === SectionType.Profile) {
      dispatch(editProfileModal({}));
    } else if (type === SectionType.Moon) {
      const themeFromSettings = window.Events.getThemeSetting();
      const updatedTheme = themeFromSettings === 'dark' ? 'light' : 'dark';
      window.setTheme(updatedTheme);

      const newThemeObject = updatedTheme === 'dark' ? darkTheme : lightTheme;
      dispatch(applyTheme(newThemeObject));
    } else if (type === SectionType.PathIndicator) {
      // Show Path Indicator Modal
      dispatch(onionPathModal({}));
    } else {
      dispatch(clearSearch());
      dispatch(showLeftPaneSection(type));
    }
  };

  if (type === SectionType.Profile) {
    const conversation = getConversationController().get(ourNumber);

    const profile = conversation?.getLokiProfile();
    const userName = (profile && profile.displayName) || ourNumber;
    return (
      <Avatar
        avatarPath={avatarPath}
        size={AvatarSize.XS}
        onAvatarClick={handleClick}
        name={userName}
        pubkey={ourNumber}
      />
    );
  }

  const unreadToShow = type === SectionType.Message ? unreadMessageCount : undefined;

  let iconType: SessionIconType;
  switch (type) {
    case SectionType.Message:
      iconType = SessionIconType.ChatBubble;
      break;
    case SectionType.Contact:
      iconType = SessionIconType.Users;
      break;
    case SectionType.Settings:
      iconType = SessionIconType.Gear;
      break;
    case SectionType.Moon:
      iconType = SessionIconType.Moon;
      break;
    default:
      iconType = SessionIconType.Moon;
  }
  const iconColor = undefined;

  return (
    <>
      {type === SectionType.PathIndicator ? (
        <ActionPanelOnionStatusLight handleClick={handleClick} isSelected={isSelected} />
      ) : (
        <SessionIconButton
          iconSize={SessionIconSize.Medium}
          iconType={iconType}
          iconColor={iconColor}
          notificationCount={unreadToShow}
          onClick={handleClick}
          isSelected={isSelected}
          theme={theme}
        />
      )}
    </>
  );
};

const cleanUpMediasInterval = DURATION.MINUTES * 30;

const setupTheme = () => {
  const theme = window.Events.getThemeSetting();
  window.setTheme(theme);

  const newThemeObject = theme === 'dark' ? darkTheme : lightTheme;
  window?.inboxStore?.dispatch(applyTheme(newThemeObject));
};

// Do this only if we created a new Session ID, or if we already received the initial configuration message
const triggerSyncIfNeeded = async () => {
  const didWeHandleAConfigurationMessageAlready =
    (await getItemById(hasSyncedInitialConfigurationItem))?.value || false;
  if (didWeHandleAConfigurationMessageAlready) {
    await syncConfigurationIfNeeded();
  }
};

const scheduleDeleteOpenGroupV1Messages = async () => {
  const leftToRemove = await removeOneOpenGroupV1Message();
  if (leftToRemove > 0) {
    window?.log?.info(`We still have ${leftToRemove} opengroupv1 messages to remove...`);
    setTimeout(scheduleDeleteOpenGroupV1Messages, 10000);
  } else {
    window?.log?.info('No more opengroupv1 messages to remove...');
  }
};

const removeAllV1OpenGroups = async () => {
  const allV1Convos = (await getAllOpenGroupV1Conversations()).models || [];
  // do not remove messages of opengroupv1 for now. We have to find a way of doing it without making the whole app extremely slow
  // tslint:disable-next-line: prefer-for-of
  for (let index = 0; index < allV1Convos.length; index++) {
    const v1Convo = allV1Convos[index];
    try {
      await removeConversation(v1Convo.id);
      window.log.info(`deleting v1convo : ${v1Convo.id}`);
      getConversationController().unsafeDelete(v1Convo);
      if (window.inboxStore) {
        window.inboxStore?.dispatch(conversationActions.conversationRemoved(v1Convo.id));
        window.inboxStore?.dispatch(
          conversationActions.conversationChanged(v1Convo.id, v1Convo.getProps())
        );
      }
    } catch (e) {
      window.log.warn(`failed to delete opengroupv1 ${v1Convo.id}`, e);
    }
  }

  setTimeout(scheduleDeleteOpenGroupV1Messages, 10000);
};

const triggerAvatarReUploadIfNeeded = async () => {
  const lastTimeStampAvatarUpload = (await getItemById(lastAvatarUploadTimestamp))?.value || 0;

  if (Date.now() - lastTimeStampAvatarUpload > DURATION.DAYS * 14) {
    window.log.info('Reuploading avatar...');
    // reupload the avatar
    await uploadOurAvatar();
  }
};

/**
 * This function is called only once: on app startup with a logged in user
 */
const doAppStartUp = () => {
  if (window.lokiFeatureFlags.useOnionRequests || window.lokiFeatureFlags.useFileOnionRequests) {
    // Initialize paths for onion requests
    void OnionPaths.buildNewOnionPathsOneAtATime();
  }

  // init the messageQueue. In the constructor, we add all not send messages
  // this call does nothing except calling the constructor, which will continue sending message in the pipeline
  void getMessageQueue().processAllPending();
  void setupTheme();

  // keep that one to make sure our users upgrade to new sessionIDS
  void removeAllV1OpenGroups();

  // this generates the key to encrypt attachments locally
  void generateAttachmentKeyIfEmpty();
  void getOpenGroupManager().startPolling();
  // trigger a sync message if needed for our other devices

  void triggerSyncIfNeeded();

  void loadDefaultRooms();

  debounce(triggerAvatarReUploadIfNeeded, 200);

  // TODO: Investigate the case where we reconnect
  void getSwarmPollingInstance().start();
};

/**
 * ActionsPanel is the far left banner (not the left pane).
 * The panel with buttons to switch between the message/contact/settings/theme views
 */
export const ActionsPanel = () => {
  const [startCleanUpMedia, setStartCleanUpMedia] = useState(false);
  const ourPrimaryConversation = useSelector(getOurPrimaryConversation);

  // this maxi useEffect is called only once: when the component is mounted.
  // For the action panel, it means this is called only one per app start/with a user loggedin
  useEffect(() => {
    void doAppStartUp();
  }, []);

  // wait for cleanUpMediasInterval and then start cleaning up medias
  // this would be way easier to just be able to not trigger a call with the setInterval
  useEffect(() => {
    const timeout = global.setTimeout(() => setStartCleanUpMedia(true), cleanUpMediasInterval);

    return () => global.clearTimeout(timeout);
  }, []);

  useInterval(
    () => {
      cleanUpOldDecryptedMedias();
    },
    startCleanUpMedia ? cleanUpMediasInterval : null
  );

  if (!ourPrimaryConversation) {
    window?.log?.warn('ActionsPanel: ourPrimaryConversation is not set');
    return <></>;
  }

  useInterval(() => {
    void syncConfigurationIfNeeded();
  }, DURATION.DAYS * 2);

  useInterval(() => {
    void forceRefreshRandomSnodePool();
  }, DURATION.DAYS * 1);

  useInterval(() => {
    // this won't be run every days, but if the app stays open for more than 10 days
    void triggerAvatarReUploadIfNeeded();
  }, DURATION.DAYS * 1);

  return (
    <>
      <ModalContainer />
      <div className="module-left-pane__sections-container">
        <Section type={SectionType.Profile} avatarPath={ourPrimaryConversation.avatarPath} />
        <Section type={SectionType.Message} />
        <Section type={SectionType.Contact} />
        <Section type={SectionType.Settings} />

        <SessionToastContainer />

        <Section type={SectionType.PathIndicator} />
        <Section type={SectionType.Moon} />
      </div>
    </>
  );
};
