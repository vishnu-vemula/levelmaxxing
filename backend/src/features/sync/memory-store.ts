import type {DeviceRegistration, PushRequest, PushResult, SyncGroup} from '@levelmaxing/contracts';
import {contextChanged, cursorExpired} from '../../platform/http.ts';
import {projectWeightChange} from '../progress/index.ts';
import type {SyncStore} from './store.ts';

type Device = {generation: number; lastSeq: number; receipts: Map<number, {body: string; result: PushResult}>};
type Account = {epoch: string; devices: Map<string, Device>; measurements: Set<string>; groups: SyncGroup[]};

/** In-process adapter for the local harness. Production uses the transactional database port. */
export function createMemorySyncStore(newEpoch: () => string = () => crypto.randomUUID()): SyncStore {
  const accounts = new Map<string, Account>();
  function getAccount(accountId: string): Account {
    let account = accounts.get(accountId);
    if (!account) {
      account = {epoch: newEpoch(), devices: new Map(), measurements: new Set(), groups: []};
      accounts.set(accountId, account);
    }
    return account;
  }
  return {
    async registerDevice(actor, deviceId): Promise<DeviceRegistration> {
      const account = getAccount(actor.accountId);
      let device = account.devices.get(deviceId);
      if (!device) {
        device = {generation: 1, lastSeq: 0, receipts: new Map()};
        account.devices.set(deviceId, device);
      }
      return {deviceId, generation: device.generation, epoch: account.epoch};
    },
    async push(actor, request: PushRequest) {
      const account = getAccount(actor.accountId);
      const device = account.devices.get(request.deviceId);
      if (request.epoch !== account.epoch || !device || device.generation !== request.generation) throw contextChanged();
      const results: PushResult[] = [];
      // A result, fence, row and revision become visible together, without a suspension point.
      for (const op of request.ops) {
        const {seq, opId} = op;
        const body = JSON.stringify(op);
        const receipt = device.receipts.get(seq);
        if (receipt) {
          results.push(receipt.body === body ? receipt.result : {seq, opId, status: 'conflict', code: 'operation_body_changed'});
          continue;
        }
        if (seq <= device.lastSeq) {
          results.push({seq, opId, status: 'processed_receipt_expired', code: 'receipt_expired'});
          continue;
        }
        if (seq !== device.lastSeq + 1) {
          results.push({seq, opId, status: 'sequence_gap', code: 'sequence_gap', expectedSeq: device.lastSeq + 1});
          continue;
        }
        let result: PushResult;
        if (account.measurements.has(op.entityId)) {
          result = {seq, opId, status: 'conflict', code: 'entity_already_exists'};
        } else {
          const revision = String(account.groups.length + 1);
          const item = projectWeightChange(op);
          account.measurements.add(item.id);
          account.groups.push({revision, items: [item]});
          result = {seq, opId, status: 'applied', revision, entityVersion: 1};
        }
        device.lastSeq = seq;
        device.receipts.set(seq, {body, result});
        results.push(result);
      }
      return {results};
    },
    async pull(actor, window) {
      const account = getAccount(actor.accountId);
      const after = BigInt(window.after);
      const highWater = BigInt(window.highWater ?? account.groups.length);
      if ((window.epoch && window.epoch !== account.epoch) || after > highWater || highWater > BigInt(account.groups.length)) throw cursorExpired();
      return {
        epoch: account.epoch,
        highWater: highWater.toString(),
        groups: account.groups.slice(Number(after), Math.min(Number(after) + window.limit, Number(highWater))),
      };
    },
  };
}
