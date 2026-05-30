import { createUseRpcEpoch } from "@xian-tech/web-kit";

import { getRpcEpoch, subscribeRpcEpoch } from "../lib/xian";

export const useRpcEpoch = createUseRpcEpoch({
  getRpcEpoch,
  subscribeRpcEpoch
});
