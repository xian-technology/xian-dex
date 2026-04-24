import { useEffect, useState } from "react";
import { listTxs, subscribe, type TxRecord } from "../lib/txHistory";

export function useTxHistory(): TxRecord[] {
  const [records, setRecords] = useState<TxRecord[]>(() => listTxs());
  useEffect(() => {
    setRecords(listTxs());
    return subscribe(() => setRecords(listTxs()));
  }, []);
  return records;
}
