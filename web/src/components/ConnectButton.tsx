import { Lock, Wallet as WalletIcon } from "lucide-react";
import { useWallet } from "../hooks/useWallet";
import type { WalletContextValue } from "../hooks/useWallet";

export function connectLabel(
  wallet: Pick<WalletContextValue, "available" | "connecting" | "info">
): string {
  if (!wallet.available) return "Wallet missing";
  if (wallet.connecting) return "Connecting…";
  if (wallet.info?.locked) return "Unlock Wallet";
  return "Connect Wallet";
}

interface Props {
  block?: boolean;
  showIcon?: boolean;
}

export function ConnectButton({ block = false, showIcon = false }: Props) {
  const wallet = useWallet();
  return (
    <button
      className={"btn btn-primary" + (block ? " btn-block" : "")}
      onClick={() => wallet.connect()}
      disabled={!wallet.available || wallet.connecting}
      title={
        wallet.info?.locked
          ? "Your wallet is locked. Click to open the unlock prompt."
          : undefined
      }
    >
      {showIcon && (wallet.info?.locked ? <Lock size={14} /> : <WalletIcon size={14} />)}
      {connectLabel(wallet)}
    </button>
  );
}
