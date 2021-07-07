// this is not a very good name, but a configuration message is a message sent to our other devices so sync our current public and closed groups

import { SignalService } from '../../../../protobuf';
import { MessageParams } from '../Message';
import { ECKeyPair } from '../../../../receiver/keypairs';
import { fromHexToArray } from '../../../utils/String';
import { PubKey } from '../../../types';
import { ContentMessage } from '..';

interface ConfigurationMessageParams extends MessageParams {
  activeClosedGroups: Array<ConfigurationMessageClosedGroup>;
  activeOpenGroups: Array<string>;
  displayName: string;
  profilePicture?: string;
  profileKey?: Uint8Array;
  contacts: Array<ConfigurationMessageContact>;
}

export class ConfigurationMessage extends ContentMessage {
  public readonly activeClosedGroups: Array<ConfigurationMessageClosedGroup>;
  public readonly activeOpenGroups: Array<string>;
  public readonly displayName: string;
  public readonly profilePicture?: string;
  public readonly profileKey?: Uint8Array;
  public readonly contacts: Array<ConfigurationMessageContact>;

  constructor(params: ConfigurationMessageParams) {
    super({ timestamp: params.timestamp, identifier: params.identifier });
    this.activeClosedGroups = params.activeClosedGroups;
    this.activeOpenGroups = params.activeOpenGroups;
    this.displayName = params.displayName;
    this.profilePicture = params.profilePicture;
    this.profileKey = params.profileKey;
    this.contacts = params.contacts;

    if (!this.activeClosedGroups) {
      throw new Error('closed group must be set');
    }

    if (!this.activeOpenGroups) {
      throw new Error('open group must be set');
    }

    if (!this.displayName || !this.displayName?.length) {
      throw new Error('displayName must be set');
    }

    if (this.profilePicture && typeof this.profilePicture !== 'string') {
      throw new Error('profilePicture set but not an Uin8Array');
    }

    if (this.profileKey && !(this.profileKey instanceof Uint8Array)) {
      throw new Error('profileKey set but not an Uin8Array');
    }

    if (!this.contacts) {
      throw new Error('contacts must be set');
    }
  }

  public contentProto(): SignalService.Content {
    return new SignalService.Content({
      configurationMessage: this.configurationProto(),
    });
  }

  protected configurationProto(): SignalService.ConfigurationMessage {
    return new SignalService.ConfigurationMessage({
      closedGroups: this.mapClosedGroupsObjectToProto(this.activeClosedGroups),
      openGroups: this.activeOpenGroups,
      displayName: this.displayName,
      profilePicture: this.profilePicture,
      profileKey: this.profileKey,
      contacts: this.mapContactsObjectToProto(this.contacts),
    });
  }

  private mapClosedGroupsObjectToProto(
    closedGroups: Array<ConfigurationMessageClosedGroup>
  ): Array<SignalService.ConfigurationMessage.ClosedGroup> {
    return (closedGroups || []).map(m => m.toProto());
  }

  private mapContactsObjectToProto(
    contacts: Array<ConfigurationMessageContact>
  ): Array<SignalService.ConfigurationMessage.Contact> {
    return (contacts || []).map(m => m.toProto());
  }
}

export class ConfigurationMessageContact {
  public publicKey: string;
  public displayName: string;
  public profilePictureURL?: string;
  public profileKey?: Uint8Array;

  public constructor({
    publicKey,
    displayName,
    profilePictureURL,
    profileKey,
  }: {
    publicKey: string;
    displayName: string;
    profilePictureURL?: string;
    profileKey?: Uint8Array;
  }) {
    this.publicKey = publicKey;
    this.displayName = displayName;
    this.profilePictureURL = profilePictureURL;
    this.profileKey = profileKey;

    // will throw if public key is invalid
    PubKey.cast(publicKey);

    if (this.displayName?.length === 0) {
      throw new Error('displayName must be set or undefined');
    }

    if (this.profilePictureURL !== undefined && this.profilePictureURL?.length === 0) {
      throw new Error('profilePictureURL must either undefined or not empty');
    }
    if (this.profileKey !== undefined && this.profileKey?.length === 0) {
      throw new Error('profileKey must either undefined or not empty');
    }
  }

  public toProto(): SignalService.ConfigurationMessage.Contact {
    return new SignalService.ConfigurationMessage.Contact({
      publicKey: fromHexToArray(this.publicKey),
      name: this.displayName,
      profilePicture: this.profilePictureURL,
      profileKey: this.profileKey,
    });
  }
}

export class ConfigurationMessageClosedGroup {
  public publicKey: string;
  public name: string;
  public encryptionKeyPair: ECKeyPair;
  public members: Array<string>;
  public admins: Array<string>;
  public expireTimer: number;

  public constructor({
    publicKey,
    name,
    encryptionKeyPair,
    members,
    admins,
    expireTimer,
  }: {
    publicKey: string;
    name: string;
    encryptionKeyPair: ECKeyPair;
    members: Array<string>;
    admins: Array<string>;
    expireTimer: number;
  }) {
    this.publicKey = publicKey;
    this.name = name;
    this.encryptionKeyPair = encryptionKeyPair;
    this.members = members;
    this.admins = admins;
    this.expireTimer = expireTimer;

    // will throw if publik key is invalid
    PubKey.cast(publicKey);

    if (
      !encryptionKeyPair?.privateKeyData?.byteLength ||
      !encryptionKeyPair?.publicKeyData?.byteLength
    ) {
      throw new Error('Encryption key pair looks invalid');
    }

    if (!this.name?.length) {
      throw new Error('name must be set');
    }
    if (this.expireTimer === null || this.expireTimer === undefined) {
      throw new Error('expireTimer must be set');
    }
    if (!this.members?.length) {
      throw new Error('members must be set');
    }
    if (!this.admins?.length) {
      throw new Error('admins must be set');
    }

    if (this.admins.some(a => !this.members.includes(a))) {
      throw new Error('some admins are not members');
    }
  }

  public toProto(): SignalService.ConfigurationMessage.ClosedGroup {
    return new SignalService.ConfigurationMessage.ClosedGroup({
      publicKey: fromHexToArray(this.publicKey),
      name: this.name,
      encryptionKeyPair: {
        publicKey: this.encryptionKeyPair.publicKeyData,
        privateKey: this.encryptionKeyPair.privateKeyData,
      },
      members: this.members.map(fromHexToArray),
      admins: this.admins.map(fromHexToArray),
      expirationTimer: this.expireTimer,
    });
  }
}
