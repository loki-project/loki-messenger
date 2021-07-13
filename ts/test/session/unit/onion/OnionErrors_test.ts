// tslint:disable: no-implicit-dependencies max-func-body-length no-unused-expression

import chai from 'chai';
import * as sinon from 'sinon';
import _ from 'lodash';
import { describe } from 'mocha';

import { TestUtils } from '../../../test-utils';
import * as SNodeAPI from '../../../../../ts/session/snode_api/';

import chaiAsPromised from 'chai-as-promised';
import { OnionPaths } from '../../../../session/onions/';
import {
  NEXT_NODE_NOT_FOUND_PREFIX,
  OXEN_SERVER_ERROR,
  processOnionResponse,
} from '../../../../session/snode_api/onions';
import AbortController from 'abort-controller';
import * as Data from '../../../../../ts/data/data';
import { pathFailureCount } from '../../../../session/onions/onionPath';

chai.use(chaiAsPromised as any);
chai.should();

const { expect } = chai;

const getFakeResponseOnPath = (statusCode?: number, body?: string) => {
  return {
    status: statusCode || 0,
    text: async () => body || '',
  };
};

const getFakeResponseOnDestination = (statusCode?: number, body?: string) => {
  return {
    status: 200 || 0,
    text: async () => {
      return JSON.stringify({ status: statusCode, body: body || '' });
    },
  };
};

// tslint:disable-next-line: max-func-body-length
describe('OnionPathsErrors', () => {
  // Initialize new stubbed cache
  const sandbox = sinon.createSandbox();
  let updateSwarmSpy: sinon.SinonStub;
  let dropSnodeFromSwarmIfNeededSpy: sinon.SinonSpy;
  let dropSnodeFromSnodePool: sinon.SinonSpy;
  let dropSnodeFromPathSpy: sinon.SinonSpy;
  let incrementBadPathCountOrDropSpy: sinon.SinonSpy;
  let incrementBadSnodeCountOrDropSpy: sinon.SinonSpy;

  let updateGuardNodesStub: sinon.SinonStub;
  // tslint:disable-next-line: one-variable-per-declaration
  let guardPubkeys: Array<string>,
    otherNodesPubkeys: Array<string>,
    guardNodesArray: Array<Data.Snode>,
    guardSnode1: Data.Snode,
    otherNodesArray: Array<Data.Snode>,
    fakeSnodePool: Array<Data.Snode>,
    associatedWith: string,
    fakeSwarmForAssociatedWith: Array<string>;

  let oldOnionPaths: Array<Array<Data.Snode>>;
  const fakeIP = '8.8.8.8';
  let fakePortCurrent = 20000;

  beforeEach(async () => {
    guardPubkeys = TestUtils.generateFakePubKeys(3).map(n => n.key);
    otherNodesPubkeys = TestUtils.generateFakePubKeys(9).map(n => n.key);

    SNodeAPI.Onions.TEST_resetSnodeFailureCount();

    guardNodesArray = guardPubkeys.map(ed25519 => {
      fakePortCurrent++;
      return {
        ip: fakeIP,
        port: fakePortCurrent,
        pubkey_ed25519: ed25519,
        pubkey_x25519: ed25519,
        version: '',
      };
    });
    guardSnode1 = guardNodesArray[0];

    otherNodesArray = otherNodesPubkeys.map(ed25519 => {
      fakePortCurrent++;
      return {
        ip: fakeIP,
        port: fakePortCurrent,
        pubkey_ed25519: ed25519,
        pubkey_x25519: ed25519,
        version: '',
      };
    });

    fakeSnodePool = [...guardNodesArray, ...otherNodesArray];

    associatedWith = TestUtils.generateFakePubKey().key;
    fakeSwarmForAssociatedWith = otherNodesPubkeys.slice(0, 6);
    // Stubs
    sandbox.stub(OnionPaths, 'selectGuardNodes').resolves(guardNodesArray);
    sandbox.stub(SNodeAPI.SNodeAPI, 'getSnodePoolFromSnode').resolves(guardNodesArray);
    TestUtils.stubData('getGuardNodes').resolves([
      guardPubkeys[0],
      guardPubkeys[1],
      guardPubkeys[2],
    ]);
    TestUtils.stubWindow('getSeedNodeList', () => ['seednode1']);
    sandbox.stub(SNodeAPI.SnodePool, 'refreshRandomPoolDetail').resolves(fakeSnodePool);
    sandbox.stub(Data, 'getSwarmNodesForPubkey').resolves(fakeSwarmForAssociatedWith);
    updateGuardNodesStub = sandbox.stub(Data, 'updateGuardNodes').resolves();

    // those are still doing what they do, but we spy on their executation
    updateSwarmSpy = sandbox.stub(Data, 'updateSwarmNodesForPubkey').resolves();
    sandbox
      .stub(Data, 'getItemById')
      .withArgs(Data.SNODE_POOL_ITEM_ID)
      .resolves({ id: Data.SNODE_POOL_ITEM_ID, value: '' });
    sandbox.stub(Data, 'createOrUpdateItem').resolves();
    dropSnodeFromSnodePool = sandbox.spy(SNodeAPI.SnodePool, 'dropSnodeFromSnodePool');
    dropSnodeFromSwarmIfNeededSpy = sandbox.spy(SNodeAPI.SnodePool, 'dropSnodeFromSwarmIfNeeded');
    dropSnodeFromPathSpy = sandbox.spy(OnionPaths, 'dropSnodeFromPath');
    incrementBadPathCountOrDropSpy = sandbox.spy(OnionPaths, 'incrementBadPathCountOrDrop');
    incrementBadSnodeCountOrDropSpy = sandbox.spy(SNodeAPI.Onions, 'incrementBadSnodeCountOrDrop');

    OnionPaths.clearTestOnionPath();

    OnionPaths.TEST_resetPathFailureCount();

    await OnionPaths.getOnionPath();

    oldOnionPaths = OnionPaths.TEST_getTestOnionPath();
    sandbox
      .stub(SNodeAPI.Onions, 'decodeOnionResult')
      .callsFake((_symkey: ArrayBuffer, plaintext: string) =>
        Promise.resolve({ plaintext, ciphertextBuffer: new Uint8Array() })
      );
  });

  afterEach(() => {
    TestUtils.restoreStubs();
    sandbox.restore();
  });

  describe('processOnionResponse', () => {
    it('throws a non-retryable error when the request is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();
      try {
        await processOnionResponse({
          response: getFakeResponseOnPath(),
          symmetricKey: new Uint8Array(),
          guardNode: guardSnode1,
          abortSignal: abortController.signal,
        });
        throw new Error('Error expected');
      } catch (e) {
        expect(e.message).to.equal('Request got aborted');
        // this makes sure that this call would not be retried
        expect(e.name).to.equal('AbortError');
      }
    });

    it('does not throw if we get 200 on path and destination', async () => {
      try {
        await processOnionResponse({
          response: getFakeResponseOnDestination(200),
          symmetricKey: new Uint8Array(),
          guardNode: guardSnode1,
        });
        throw new Error('Did not throw');
      } catch (e) {
        expect(e.message).to.equal('Did not throw');
      }
      expect(dropSnodeFromSnodePool.callCount).to.eq(0);
      expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);
      expect(dropSnodeFromPathSpy.callCount).to.eq(0);
      expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
      expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(0);
    });

    it('does not throw if we get 200 on path but no status code on destination', async () => {
      try {
        await processOnionResponse({
          response: getFakeResponseOnDestination(),
          symmetricKey: new Uint8Array(),
          guardNode: guardSnode1,
        });
        throw new Error('Did not throw');
      } catch (e) {
        expect(e.message).to.equal('Did not throw');
      }
      expect(dropSnodeFromSnodePool.callCount).to.eq(0);
      expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);
      expect(dropSnodeFromPathSpy.callCount).to.eq(0);
      expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
      expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(0);
    });

    describe('processOnionResponse - 406', () => {
      it('throws an non retryable error we get a 406 on path', async () => {
        try {
          await processOnionResponse({
            response: getFakeResponseOnPath(406),
            symmetricKey: new Uint8Array(),
            guardNode: guardSnode1,
          });
          throw new Error('Error expected');
        } catch (e) {
          expect(e.message).to.equal(
            'Your clock is out of sync with the network. Check your clock.'
          );
          // this makes sure that this call would not be retried
          expect(e.name).to.equal('AbortError');
        }
        expect(dropSnodeFromSnodePool.callCount).to.eq(0);
        expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);
        expect(dropSnodeFromPathSpy.callCount).to.eq(0);
        expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
        expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(0);
      });
      it('throws an non retryable error we get a 406 on destination', async () => {
        try {
          await processOnionResponse({
            response: getFakeResponseOnDestination(406),
            symmetricKey: new Uint8Array(),
            guardNode: guardSnode1,
          });
          throw new Error('Error expected');
        } catch (e) {
          expect(e.message).to.equal(
            'Your clock is out of sync with the network. Check your clock.'
          );
          // this makes sure that this call would not be retried
          expect(e.name).to.equal('AbortError');
        }
        expect(dropSnodeFromSnodePool.callCount).to.eq(0);
        expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);
        expect(dropSnodeFromPathSpy.callCount).to.eq(0);
        expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
        expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(0);
      });
    });

    describe('processOnionResponse - 421', () => {
      describe('processOnionResponse - 421 - on path', () => {
        it('throws a non-retryable error if we get a 421 status code without new swarm', async () => {
          const targetNode = otherNodesPubkeys[0];

          try {
            await processOnionResponse({
              response: getFakeResponseOnPath(421),
              symmetricKey: new Uint8Array(),
              guardNode: guardSnode1,
              lsrpcEd25519Key: targetNode,

              associatedWith,
            });
            throw new Error('Error expected');
          } catch (e) {
            expect(e.message).to.equal('421 handled. Retry this request with a new targetNode');
            expect(e.name).to.equal('AbortError');
          }
          expect(updateSwarmSpy.callCount).to.eq(1);
          // if we don't get a new swarm in the returned json, we drop the target node considering it is a bad snode
          expect(updateSwarmSpy.args[0][1]).to.deep.eq(
            fakeSwarmForAssociatedWith.filter(m => m !== targetNode)
          );

          // now we make sure that this bad snode was dropped from this pubkey's swarm
          expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(1);
          expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[0]).to.eq(associatedWith);
          expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[1]).to.eq(targetNode);

          // this node failed only once. it should not be dropped yet from the snodepool
          expect(dropSnodeFromSnodePool.callCount).to.eq(0);
          expect(dropSnodeFromPathSpy.callCount).to.eq(0);
          expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
          expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(1);
          expect(incrementBadSnodeCountOrDropSpy.firstCall.args[0]).to.deep.eq({
            snodeEd25519: targetNode,
            guardNodeEd25519: guardSnode1.pubkey_ed25519,
            associatedWith,
          });
        });
      });

      describe('processOnionResponse - 421 - on destination', () => {
        it('throws a non-retryable error we get a 421 status code with a new swarm', async () => {
          const targetNode = otherNodesPubkeys[0];

          const resultExpected: Array<Data.Snode> = [
            otherNodesArray[4],
            otherNodesArray[5],
            otherNodesArray[6],
          ];
          try {
            await processOnionResponse({
              response: getFakeResponseOnDestination(
                421,
                JSON.stringify({ snodes: resultExpected })
              ),
              symmetricKey: new Uint8Array(),
              guardNode: guardSnode1,
              lsrpcEd25519Key: targetNode,
              associatedWith,
            });
            throw new Error('Error expected');
          } catch (e) {
            expect(e.message).to.equal('421 handled. Retry this request with a new targetNode');
            expect(e.name).to.equal('AbortError');
          }
          expect(updateSwarmSpy.callCount).to.eq(1);
          // we got 3 snode in the results, this is our new swarm for this associated with pubkey
          expect(updateSwarmSpy.args[0][1]).to.deep.eq(resultExpected.map(m => m.pubkey_ed25519));

          // we got a new swarm for this pubkey. so it's OK that dropSnodeFromSwarm was not called for this pubkey

          // this node failed only once. it should not be dropped yet from the snodepool
          // this node failed only once. it should not be dropped yet from the snodepool
          expect(dropSnodeFromSnodePool.callCount).to.eq(0);
          expect(dropSnodeFromPathSpy.callCount).to.eq(0);
          expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
          expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(1);
          expect(incrementBadSnodeCountOrDropSpy.firstCall.args[0]).to.deep.eq({
            snodeEd25519: targetNode,
            guardNodeEd25519: guardSnode1.pubkey_ed25519,
            associatedWith,
          });
        });

        it('throws a non-retryable error we get a 421 status code with invalid json body', async () => {
          const targetNode = otherNodesPubkeys[0];

          try {
            await processOnionResponse({
              response: getFakeResponseOnDestination(421, 'THIS IS SOME INVALID JSON'),
              symmetricKey: new Uint8Array(),
              guardNode: guardSnode1,
              lsrpcEd25519Key: targetNode,

              associatedWith,
            });
            throw new Error('Error expected');
          } catch (e) {
            expect(e.message).to.equal('421 handled. Retry this request with a new targetNode');
            expect(e.name).to.equal('AbortError');
          }
          expect(updateSwarmSpy.callCount).to.eq(1);
          // we have an invalid json content. just remove the targetNode from the list
          expect(updateSwarmSpy.args[0][1]).to.deep.eq(
            fakeSwarmForAssociatedWith.filter(m => m !== targetNode)
          );
          // now we make sure that this bad snode was dropped from this pubkey's swarm
          expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(1);
          expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[0]).to.eq(associatedWith);
          expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[1]).to.eq(targetNode);
          // this node failed only once. it should not be dropped yet from the snodepool
          expect(dropSnodeFromSnodePool.callCount).to.eq(0);
          expect(dropSnodeFromPathSpy.callCount).to.eq(0);
          expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
          expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(1);
          expect(incrementBadSnodeCountOrDropSpy.firstCall.args[0]).to.deep.eq({
            snodeEd25519: targetNode,
            guardNodeEd25519: guardSnode1.pubkey_ed25519,
            associatedWith,
          });
        });

        it('throws a non-retryable on destination 421 without new swarm ', async () => {
          const targetNode = otherNodesPubkeys[0];
          const json = JSON.stringify({ status: 421 });

          try {
            await processOnionResponse({
              response: getFakeResponseOnDestination(421, json),
              symmetricKey: new Uint8Array(),
              guardNode: guardSnode1,
              lsrpcEd25519Key: targetNode,
              associatedWith,
            });
            throw new Error('Error expected');
          } catch (e) {
            expect(e.message).to.equal('421 handled. Retry this request with a new targetNode');
            expect(e.name).to.equal('AbortError');
          }
          expect(updateSwarmSpy.callCount).to.eq(1);
          // 421 without swarm included means drop the target node only
          expect(updateSwarmSpy.args[0][1]).to.deep.eq(
            fakeSwarmForAssociatedWith.filter(m => m !== targetNode)
          );

          // now we make sure that this bad snode was dropped from this pubkey's swarm
          expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(1);
          expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[0]).to.eq(associatedWith);
          expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[1]).to.eq(targetNode);

          // this node failed only once. it should not be dropped yet from the snodepool
          expect(dropSnodeFromSnodePool.callCount).to.eq(0);
          expect(dropSnodeFromPathSpy.callCount).to.eq(0);
          expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
          expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(1);
          expect(incrementBadSnodeCountOrDropSpy.firstCall.args[0]).to.deep.eq({
            snodeEd25519: targetNode,
            guardNodeEd25519: guardSnode1.pubkey_ed25519,
            associatedWith,
          });
        });
      });
    });
  });

  /**
   * processOnionResponse OXEN SERVER ERROR
   */
  describe('processOnionResponse - OXEN_SERVER_ERROR', () => {
    // open group server v2 only talkes onion routing request. So errors can only happen at destination
    it('throws a non-retryable error on oxen server errors on destination', async () => {
      const targetNode = otherNodesPubkeys[0];

      try {
        await processOnionResponse({
          response: getFakeResponseOnDestination(400, OXEN_SERVER_ERROR),
          symmetricKey: new Uint8Array(),
          guardNode: guardSnode1,
          lsrpcEd25519Key: targetNode,

          associatedWith,
        });
        throw new Error('Error expected');
      } catch (e) {
        expect(e.message).to.equal(OXEN_SERVER_ERROR);
        expect(e.name).to.equal('AbortError');
      }
      expect(updateSwarmSpy.callCount).to.eq(0);
      // now we make sure that this bad snode was dropped from this pubkey's swarm
      expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);

      // this node did not really failed
      expect(dropSnodeFromSnodePool.callCount).to.eq(0);
      expect(dropSnodeFromPathSpy.callCount).to.eq(0);
      expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
      expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(0);
    });
  });

  /**
   * processOnionResponse OXEN SERVER ERROR
   */
  describe('processOnionResponse - 502 - node not found', () => {
    // open group server v2 only talkes onion routing request. So errors can only happen at destination
    it('throws a retryable error on 502 on intermediate snode', async () => {
      const targetNode = otherNodesPubkeys[0];
      const failingSnode = oldOnionPaths[0][1];
      try {
        await processOnionResponse({
          response: getFakeResponseOnPath(
            502,
            `${NEXT_NODE_NOT_FOUND_PREFIX}${failingSnode.pubkey_ed25519}`
          ),
          symmetricKey: new Uint8Array(),
          guardNode: guardSnode1,
          lsrpcEd25519Key: targetNode,
          associatedWith,
        });
        throw new Error('Error expected');
      } catch (e) {
        expect(e.message).to.equal('Bad Path handled. Retry this request. Status: 502');
        expect(e.name).to.not.equal('AbortError');
      }
      expect(updateSwarmSpy.callCount).to.eq(0);
      // now we make sure that this bad snode was dropped from this pubkey's swarm
      expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);

      // this specific node failed just once
      expect(dropSnodeFromSnodePool.callCount).to.eq(0);
      expect(dropSnodeFromPathSpy.callCount).to.eq(0);
      expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
      expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(1);
      expect(incrementBadSnodeCountOrDropSpy.firstCall.args[0]).to.deep.eq({
        snodeEd25519: failingSnode.pubkey_ed25519,
        guardNodeEd25519: guardSnode1.pubkey_ed25519,
        associatedWith,
      });
    });

    it('throws a retryable error on 502 on last snode', async () => {
      const targetNode = otherNodesPubkeys[0];
      const failingSnode = oldOnionPaths[0][2];
      try {
        await processOnionResponse({
          response: getFakeResponseOnPath(
            502,
            `${NEXT_NODE_NOT_FOUND_PREFIX}${failingSnode.pubkey_ed25519}`
          ),
          symmetricKey: new Uint8Array(),
          guardNode: guardSnode1,
          lsrpcEd25519Key: targetNode,
          associatedWith,
        });
        throw new Error('Error expected');
      } catch (e) {
        expect(e.message).to.equal('Bad Path handled. Retry this request. Status: 502');
        expect(e.name).to.not.equal('AbortError');
      }
      expect(updateSwarmSpy.callCount).to.eq(0);
      // now we make sure that this bad snode was dropped from this pubkey's swarm
      expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);

      // this specific node failed just once
      expect(dropSnodeFromSnodePool.callCount).to.eq(0);
      expect(dropSnodeFromPathSpy.callCount).to.eq(0);
      // we have a specific failing node so don't increment path errors
      expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
      expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(1);
      expect(incrementBadSnodeCountOrDropSpy.firstCall.args[0]).to.deep.eq({
        snodeEd25519: failingSnode.pubkey_ed25519,
        guardNodeEd25519: guardSnode1.pubkey_ed25519,
        associatedWith,
      });
    });

    it('drop a snode from pool, swarm and path if it keep failing', async () => {
      const targetNode = otherNodesPubkeys[0];
      const failingSnode = oldOnionPaths[0][1];
      for (let index = 0; index < 3; index++) {
        try {
          await processOnionResponse({
            response: getFakeResponseOnPath(
              502,
              `${NEXT_NODE_NOT_FOUND_PREFIX}${failingSnode.pubkey_ed25519}`
            ),
            symmetricKey: new Uint8Array(),
            guardNode: guardSnode1,
            lsrpcEd25519Key: targetNode,
            associatedWith,
          });
          throw new Error('Error expected');
        } catch (e) {
          expect(e.message).to.equal('Bad Path handled. Retry this request. Status: 502');
          expect(e.name).to.not.equal('AbortError');
        }
      }

      expect(updateSwarmSpy.callCount).to.eq(0);
      // now we make sure that this bad snode was dropped from this pubkey's swarm
      expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(1);
      expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[0]).to.eq(associatedWith);
      expect(dropSnodeFromSwarmIfNeededSpy.firstCall.args[1]).to.eq(failingSnode.pubkey_ed25519);

      // this specific node failed just once
      expect(dropSnodeFromSnodePool.callCount).to.eq(1);
      expect(dropSnodeFromSnodePool.firstCall.args[0]).to.eq(failingSnode.pubkey_ed25519);
      expect(dropSnodeFromPathSpy.callCount).to.eq(1);
      expect(dropSnodeFromPathSpy.firstCall.args[0]).to.eq(failingSnode.pubkey_ed25519);

      // we expect incrementBadSnodeCountOrDropSpy to be called three times with the same failing snode as we know who it is
      expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(3);
      expect(incrementBadSnodeCountOrDropSpy.args[0][0]).to.deep.eq({
        snodeEd25519: failingSnode.pubkey_ed25519,
        guardNodeEd25519: guardSnode1.pubkey_ed25519,
        associatedWith,
      });
      expect(incrementBadSnodeCountOrDropSpy.args[1][0]).to.deep.eq({
        snodeEd25519: failingSnode.pubkey_ed25519,
        guardNodeEd25519: guardSnode1.pubkey_ed25519,
        associatedWith,
      });
      expect(incrementBadSnodeCountOrDropSpy.args[2][0]).to.deep.eq({
        snodeEd25519: failingSnode.pubkey_ed25519,
        guardNodeEd25519: guardSnode1.pubkey_ed25519,
        associatedWith,
      });
      expect(incrementBadPathCountOrDropSpy.callCount).to.eq(0);
    });
  });
  it('drop a path if it keep failing without a specific node in fault', async () => {
    const targetNode = otherNodesPubkeys[0];
    const guardNode = oldOnionPaths[0][0];

    // doing this,
    for (let index = 0; index < 3; index++) {
      try {
        await processOnionResponse({
          response: getFakeResponseOnPath(500),
          symmetricKey: new Uint8Array(),
          guardNode,
          lsrpcEd25519Key: targetNode,
          associatedWith,
        });
        throw new Error('Error expected');
      } catch (e) {
        expect(e.message).to.equal('Bad Path handled. Retry this request. Status: 500');
        expect(e.name).to.not.equal('AbortError');
        if (index < 2) {
          expect(pathFailureCount[guardNode.pubkey_ed25519]).to.eq(index + 1);
        } else {
          // pathFailureCount is reset once we hit 3 for this guardnode
          expect(pathFailureCount[guardNode.pubkey_ed25519]).to.eq(0);
        }
      }
    }

    // expect(updateSwarmSpy.callCount).to.eq(0);
    // each snode on the path should have its count set to three.
    // expect(dropSnodeFromSwarmSpy.callCount).to.eq(1);

    // this specific path failed three times
    expect(incrementBadPathCountOrDropSpy.callCount).to.eq(3);
    expect(incrementBadSnodeCountOrDropSpy.callCount).to.eq(2 * 3); // three times for each nodes excluding the guard node
    for (let index = 0; index < 6; index++) {
      expect(incrementBadSnodeCountOrDropSpy.args[index][0]).to.deep.eq({
        snodeEd25519: oldOnionPaths[0][(index % 2) + 1].pubkey_ed25519,
        guardNodeEd25519: guardNode.pubkey_ed25519,
      });
    }

    expect(updateGuardNodesStub.callCount).to.eq(1);
    // we dont know which snode failed so don't exclude any of those from swarms
    expect(dropSnodeFromSwarmIfNeededSpy.callCount).to.eq(0);

    expect(guardNode.pubkey_ed25519).to.eq(incrementBadPathCountOrDropSpy.args[0][0]);
    expect(guardNode.pubkey_ed25519).to.eq(incrementBadPathCountOrDropSpy.args[1][0]);
    expect(guardNode.pubkey_ed25519).to.eq(incrementBadPathCountOrDropSpy.args[2][0]);

    expect(dropSnodeFromPathSpy.callCount).to.eq(2);
    expect(dropSnodeFromSnodePool.callCount).to.eq(3);
    expect(dropSnodeFromSnodePool.args[0][0]).to.eq(oldOnionPaths[0][1].pubkey_ed25519);
    expect(dropSnodeFromSnodePool.args[1][0]).to.eq(oldOnionPaths[0][2].pubkey_ed25519);
    expect(dropSnodeFromSnodePool.args[2][0]).to.eq(oldOnionPaths[0][0].pubkey_ed25519); // guard node is dropped last
  });
});
