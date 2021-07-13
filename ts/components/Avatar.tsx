import React, { useState } from 'react';
import classNames from 'classnames';

import { AvatarPlaceHolder, ClosedGroupAvatar } from './AvatarPlaceHolder';
import { ConversationAvatar } from './session/usingClosedConversationDetails';
import { useEncryptedFileFetch } from '../hooks/useEncryptedFileFetch';
import _ from 'underscore';

export enum AvatarSize {
  XS = 28,
  S = 36,
  M = 48,
  L = 64,
  XL = 80,
  HUGE = 300,
}

type Props = {
  avatarPath?: string;
  name?: string; // display name, profileName or phoneNumber, whatever is set first
  pubkey?: string;
  size: AvatarSize;
  base64Data?: string; // if this is not empty, it will be used to render the avatar with base64 encoded data
  memberAvatars?: Array<ConversationAvatar>; // this is added by usingClosedConversationDetails
  onAvatarClick?: () => void;
};

const Identicon = (props: Props) => {
  const { size, name, pubkey } = props;
  const userName = name || '0';

  return (
    <AvatarPlaceHolder
      diameter={size}
      name={userName}
      pubkey={pubkey}
      colors={['#5ff8b0', '#26cdb9', '#f3c615', '#fcac5a']}
      borderColor={'#00000059'}
    />
  );
};

const NoImage = (props: {
  memberAvatars?: Array<ConversationAvatar>;
  name?: string;
  pubkey?: string;
  size: AvatarSize;
  onAvatarClick?: () => void;
}) => {
  const { name, memberAvatars, size, pubkey } = props;
  // if no image but we have conversations set for the group, renders group members avatars
  if (memberAvatars) {
    return (
      <ClosedGroupAvatar
        size={size}
        memberAvatars={memberAvatars}
        onAvatarClick={props.onAvatarClick}
      />
    );
  }

  return <Identicon size={size} name={name} pubkey={pubkey} />;
};

const AvatarImage = (props: {
  avatarPath?: string;
  base64Data?: string;
  name?: string; // display name, profileName or phoneNumber, whatever is set first
  imageBroken: boolean;
  handleImageError: () => any;
}) => {
  const { avatarPath, base64Data, name, imageBroken, handleImageError } = props;

  if ((!avatarPath && !base64Data) || imageBroken) {
    return null;
  }
  const dataToDisplay = base64Data ? `data:image/jpeg;base64,${base64Data}` : avatarPath;

  return (
    <img
      onError={handleImageError}
      alt={window.i18n('contactAvatarAlt', [name])}
      src={dataToDisplay}
    />
  );
};

const AvatarInner = (props: Props) => {
  const { avatarPath, base64Data, size, memberAvatars, name } = props;
  const [imageBroken, setImageBroken] = useState(false);
  // contentType is not important
  const { urlToLoad } = useEncryptedFileFetch(avatarPath || '', '');
  const handleImageError = () => {
    window.log.warn(
      'Avatar: Image failed to load; failing over to placeholder',
      urlToLoad,
      avatarPath
    );
    setImageBroken(true);
  };

  const isClosedGroupAvatar = Boolean(memberAvatars?.length);
  const hasImage = (base64Data || urlToLoad) && !imageBroken && !isClosedGroupAvatar;

  const isClickable = !!props.onAvatarClick;
  return (
    <div
      className={classNames(
        'module-avatar',
        `module-avatar--${size}`,
        hasImage ? 'module-avatar--with-image' : 'module-avatar--no-image',
        isClickable && 'module-avatar-clickable'
      )}
      onClick={e => {
        e.stopPropagation();
        props.onAvatarClick?.();
      }}
      role="button"
    >
      {hasImage ? (
        <AvatarImage
          avatarPath={urlToLoad}
          base64Data={base64Data}
          imageBroken={imageBroken}
          name={name}
          handleImageError={handleImageError}
        />
      ) : (
        <NoImage {...props} />
      )}
    </div>
  );
};

export const Avatar = React.memo(AvatarInner, _.isEqual);
