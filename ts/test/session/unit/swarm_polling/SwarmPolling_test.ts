// tslint:disable: no-implicit-dependencies max-func-body-length no-unused-expression

import chai from 'chai';
import Sinon, * as sinon from 'sinon';
import _, { noop } from 'lodash';
import { describe } from 'mocha';

import chaiAsPromised from 'chai-as-promised';
import { TestUtils } from '../../../test-utils';
import { UserUtils } from '../../../../session/utils';
import { getConversationController } from '../../../../session/conversations';
import * as Data from '../../../../../ts/data/data';
import { getSwarmPollingInstance, SnodePool } from '../../../../session/snode_api';
import { SwarmPolling } from '../../../../session/snode_api/swarmPolling';
import { SWARM_POLLING_TIMEOUT } from '../../../../session/constants';
import {
  ConversationCollection,
  ConversationModel,
  ConversationTypeEnum,
} from '../../../../models/conversation';
import { PubKey } from '../../../../session/types';
// tslint:disable: chai-vague-errors

chai.use(chaiAsPromised as any);
chai.should();

const { expect } = chai;

// tslint:disable-next-line: max-func-body-length
describe('SwarmPolling', () => {
  // Initialize new stubbed cache
  const sandbox = sinon.createSandbox();
  const ourPubkey = TestUtils.generateFakePubKey();
  const ourNumber = ourPubkey.key;

  let pollOnceForKeySpy: Sinon.SinonSpy<any>;

  let swarmPolling: SwarmPolling;

  let clock: Sinon.SinonFakeTimers;
  beforeEach(async () => {
    // Utils Stubs
    sandbox.stub(UserUtils, 'getOurPubKeyStrFromCache').returns(ourNumber);

    sandbox.stub(Data, 'getAllConversations').resolves(new ConversationCollection());
    sandbox.stub(Data, 'getItemById').resolves();
    sandbox.stub(Data, 'saveConversation').resolves();
    sandbox.stub(Data, 'getSwarmNodesForPubkey').resolves();
    sandbox.stub(SnodePool, 'getSwarmFor').resolves([]);
    TestUtils.stubWindow('profileImages', { removeImagesNotInArray: noop, hasImage: noop });
    TestUtils.stubWindow('inboxStore', undefined);
    const convoController = getConversationController();
    await convoController.load();
    getConversationController().getOrCreate(ourPubkey.key, ConversationTypeEnum.PRIVATE);

    swarmPolling = getSwarmPollingInstance();
    swarmPolling.TEST_reset();
    pollOnceForKeySpy = sandbox.spy(swarmPolling, 'TEST_pollOnceForKey');

    clock = sinon.useFakeTimers(Date.now());
  });

  afterEach(() => {
    TestUtils.restoreStubs();
    sandbox.restore();
    getConversationController().reset();
    clock.restore();
  });

  describe('getPollingTimeout', () => {
    it('returns INACTIVE for non existing convo', () => {
      const fakeConvo = TestUtils.generateFakePubKey();

      expect(swarmPolling.TEST_getPollingTimeout(fakeConvo)).to.eq(SWARM_POLLING_TIMEOUT.INACTIVE);
    });

    it('returns MOST_ACTIVE for convo with less than 30 seconds old activeAt', () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );
      convo.set('active_at', Date.now() - 1000 * 29);
      expect(swarmPolling.TEST_getPollingTimeout(PubKey.cast(convo.id))).to.eq(
        SWARM_POLLING_TIMEOUT.MOST_ACTIVE
      );
    });

    it('returns ACTIVE for convo with less than an hour old activeAt', () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );
      convo.set('active_at', Date.now() - 1000 * 3555);
      expect(swarmPolling.TEST_getPollingTimeout(PubKey.cast(convo.id))).to.eq(
        SWARM_POLLING_TIMEOUT.ACTIVE
      );
    });

    it('returns INACTIVE for convo with undefined activeAt', () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );
      convo.set('active_at', undefined);
      expect(swarmPolling.TEST_getPollingTimeout(PubKey.cast(convo.id))).to.eq(
        SWARM_POLLING_TIMEOUT.INACTIVE
      );
    });

    it('returns MEDIUM_ACTIVE for convo with  activeAt of less than a day', () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );
      convo.set('active_at', Date.now() - 1000 * 3600 * 23);
      expect(swarmPolling.TEST_getPollingTimeout(PubKey.cast(convo.id))).to.eq(
        SWARM_POLLING_TIMEOUT.MEDIUM_ACTIVE
      );
    });

    it('returns INACTIVE for convo with  activeAt of more than a day', () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );
      convo.set('active_at', Date.now() - 1000 * 3600 * 25);
      expect(swarmPolling.TEST_getPollingTimeout(PubKey.cast(convo.id))).to.eq(
        SWARM_POLLING_TIMEOUT.INACTIVE
      );
    });
  });

  describe('pollForAllKeys', () => {
    it('does run for our pubkey even if activeAt is really old ', async () => {
      const convo = getConversationController().getOrCreate(
        ourNumber,
        ConversationTypeEnum.PRIVATE
      );
      convo.set('active_at', Date.now() - 1000 * 3600 * 25);
      await swarmPolling.start(true);

      expect(pollOnceForKeySpy.callCount).to.eq(1);
      expect(pollOnceForKeySpy.firstCall.args).to.deep.eq([ourPubkey, false]);
    });

    it('does run for our pubkey even if activeAt is recent ', async () => {
      const convo = getConversationController().getOrCreate(
        ourNumber,
        ConversationTypeEnum.PRIVATE
      );
      convo.set('active_at', Date.now());
      await swarmPolling.start(true);

      expect(pollOnceForKeySpy.callCount).to.eq(1);
      expect(pollOnceForKeySpy.firstCall.args).to.deep.eq([ourPubkey, false]);
    });

    it('does run for group pubkey on start no matter the recent timestamp  ', async () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );
      convo.set('active_at', Date.now());
      const groupConvoPubkey = PubKey.cast(convo.id);
      swarmPolling.addGroupId(groupConvoPubkey);
      await swarmPolling.start(true);

      // our pubkey will be polled for, hence the 2
      expect(pollOnceForKeySpy.callCount).to.eq(2);
      expect(pollOnceForKeySpy.firstCall.args).to.deep.eq([ourPubkey, false]);
      expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([groupConvoPubkey, true]);
    });

    it('does run for group pubkey on start no matter the old timestamp ', async () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );

      convo.set('active_at', 1);
      const groupConvoPubkey = PubKey.cast(convo.id);
      swarmPolling.addGroupId(groupConvoPubkey);
      await swarmPolling.start(true);

      // our pubkey will be polled for, hence the 2
      expect(pollOnceForKeySpy.callCount).to.eq(2);
      expect(pollOnceForKeySpy.firstCall.args).to.deep.eq([ourPubkey, false]);
      expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([groupConvoPubkey, true]);
    });

    it('does run for group pubkey on start but not another time if activeAt is old ', async () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );

      convo.set('active_at', 1);
      const groupConvoPubkey = PubKey.cast(convo.id);
      swarmPolling.addGroupId(groupConvoPubkey);
      await swarmPolling.start(true);

      await swarmPolling.TEST_pollForAllKeys();

      expect(pollOnceForKeySpy.callCount).to.eq(3);
      expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([groupConvoPubkey, true]);
      expect(pollOnceForKeySpy.thirdCall.args).to.deep.eq([ourPubkey, false]);
    });

    it('does run twice if activeAt less than one hour ', async () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );

      convo.set('active_at', Date.now());
      const groupConvoPubkey = PubKey.cast(convo.id);
      swarmPolling.addGroupId(groupConvoPubkey);
      await swarmPolling.start(true);
      clock.tick(6000);
      // no need to do that as the tick will trigger a call in all cases after 5 secs
      // await swarmPolling.TEST_pollForAllKeys();

      expect(pollOnceForKeySpy.callCount).to.eq(4);
      expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([groupConvoPubkey, true]);
      expect(pollOnceForKeySpy.thirdCall.args).to.deep.eq([ourPubkey, false]);
      expect(pollOnceForKeySpy.lastCall.args).to.deep.eq([groupConvoPubkey, true]);
    });

    it('does run once only if activeAt is more than one hour', async () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );

      convo.set('active_at', Date.now());
      const groupConvoPubkey = PubKey.cast(convo.id);
      swarmPolling.addGroupId(groupConvoPubkey);
      await swarmPolling.start(true);

      // more than hour old, we should not tick after just 5 seconds
      convo.set('active_at', Date.now() - 3605 * 1000);

      clock.tick(6000);

      expect(pollOnceForKeySpy.callCount).to.eq(3);
      expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([groupConvoPubkey, true]);
      expect(pollOnceForKeySpy.thirdCall.args).to.deep.eq([ourPubkey, false]);
    });

    it('does run once if activeAt is more than 1 days old ', async () => {
      const convo = getConversationController().getOrCreate(
        TestUtils.generateFakePubKeyStr(),
        ConversationTypeEnum.GROUP
      );

      convo.set('active_at', Date.now());
      const groupConvoPubkey = PubKey.cast(convo.id);
      swarmPolling.addGroupId(groupConvoPubkey);
      await swarmPolling.start(true);

      // more than hour old, we should not tick after just 5 seconds
      convo.set('active_at', Date.now() - 25 * 3600 * 1000);

      clock.tick(6 * 1000); // active

      expect(pollOnceForKeySpy.callCount).to.eq(3);
      expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([groupConvoPubkey, true]);
      expect(pollOnceForKeySpy.thirdCall.args).to.deep.eq([ourPubkey, false]);
    });

    describe('multiple runs', () => {
      let convo: ConversationModel;
      let groupConvoPubkey: PubKey;

      beforeEach(async () => {
        convo = getConversationController().getOrCreate(
          TestUtils.generateFakePubKeyStr(),
          ConversationTypeEnum.GROUP
        );

        convo.set('active_at', Date.now());
        groupConvoPubkey = PubKey.cast(convo.id);
        swarmPolling.addGroupId(groupConvoPubkey);
        await swarmPolling.start(true);
      });

      it('does run twice if activeAt is more than 1 hour old and we tick more than one minute ', async () => {
        pollOnceForKeySpy.resetHistory();
        // more than hour old but less than a day, we should tick after just 60 seconds
        convo.set('active_at', Date.now() - 3605 * 1000);

        clock.tick(61 * 1000); // medium_active

        await swarmPolling.TEST_pollForAllKeys();
        expect(pollOnceForKeySpy.callCount).to.eq(3);
        // first two calls are our pubkey
        expect(pollOnceForKeySpy.firstCall.args).to.deep.eq([ourPubkey, false]);
        expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([ourPubkey, false]);

        expect(pollOnceForKeySpy.thirdCall.args).to.deep.eq([groupConvoPubkey, true]);
      });

      it('does run twice if activeAt is more than 1 day old and we tick more than one hour ', async () => {
        pollOnceForKeySpy.resetHistory();
        convo.set('active_at', Date.now() - 25 * 3600 * 1000);

        clock.tick(3700 * 1000); // inactive

        await swarmPolling.TEST_pollForAllKeys();
        expect(pollOnceForKeySpy.callCount).to.eq(3);
        // first two calls are our pubkey
        expect(pollOnceForKeySpy.firstCall.args).to.deep.eq([ourPubkey, false]);
        expect(pollOnceForKeySpy.secondCall.args).to.deep.eq([ourPubkey, false]);
        expect(pollOnceForKeySpy.thirdCall.args).to.deep.eq([groupConvoPubkey, true]);
      });
    });
  });
});
