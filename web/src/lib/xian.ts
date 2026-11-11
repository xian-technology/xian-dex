import { XianClient } from "@xian-tech/client";
import { createXianRpcStore } from "@xian-tech/web-kit";

import { DEFAULT_RPC, STORAGE_KEYS } from "./constants";

const rpc = createXianRpcStore({
  defaultRpcUrl: DEFAULT_RPC,
  storageKey: STORAGE_KEYS.rpc,
  createClient: (url) => new XianClient({ rpcUrl: url })
});

export const getRpcUrl = rpc.getRpcUrl;
export const setRpcUrl = rpc.setRpcUrl;
export const getRpcEpoch = rpc.getRpcEpoch;
export const subscribeRpcEpoch = rpc.subscribeRpcEpoch;
export const getClient = rpc.getClient;
export const pingRpc = rpc.pingRpc;
