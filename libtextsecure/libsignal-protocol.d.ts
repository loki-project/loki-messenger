import { SignalService } from '../../protobuf';

export type BinaryString = string;

export type CipherTextObject = {
  type: SignalService.Envelope.Type;
  body: BinaryString;
};

export type KeyPair = {
  pubKey: ArrayBuffer;
  privKey: ArrayBuffer;
};

interface CurveSync {
  generateKeyPair(): KeyPair;
  createKeyPair(privKey: ArrayBuffer): KeyPair;
  verifySignature(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): void;
  calculateSignature(privKey: ArrayBuffer, message: ArrayBuffer): ArrayBuffer;
  validatePubKeyFormat(pubKey: ArrayBuffer): ArrayBuffer;
}

interface CurveAsync {
  generateKeyPair(): Promise<KeyPair>;
  createKeyPair(privKey: ArrayBuffer): Promise<KeyPair>;
  verifySignature(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): Promise<void>;
  calculateSignature(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer>;
  validatePubKeyFormat(pubKey: ArrayBuffer): Promise<ArrayBuffer>;
}

export interface CurveInterface extends CurveSync {
  async: CurveAsync;
}

export interface CryptoInterface {
  encrypt(key: ArrayBuffer, data: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer>;
  decrypt(key: ArrayBuffer, data: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer>;
  calculateMAC(key: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer>;
  verifyMAC(data: ArrayBuffer, key: ArrayBuffer, mac: ArrayBuffer, length: number): Promise<void>;
  getRandomBytes(size: number): ArrayBuffer;
}

export interface KeyHelperInterface {
  generateIdentityKeyPair(): Promise<KeyPair>;
}

export interface LibsignalProtocol {
  Curve: CurveInterface;
  crypto: CryptoInterface;
  KeyHelper: KeyHelperInterface;
}
