import type { TokenInfo } from "../lib/tokens";

interface Props {
  token: Pick<TokenInfo, "symbol" | "logoUrl" | "logoSvg" | "contract"> | null;
  size?: number;
}

function colorFor(contract: string): string {
  let h = 0;
  for (let i = 0; i < contract.length; i++) h = (h * 31 + contract.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 45%)`;
}

export function TokenIcon({ token, size = 28 }: Props) {
  if (!token) {
    return (
      <span
        className="token-icon token-icon-empty"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        ?
      </span>
    );
  }
  if (token.logoUrl) {
    return (
      <img
        src={token.logoUrl}
        alt={token.symbol}
        className="token-icon"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }
  if (token.logoSvg) {
    return (
      <span
        className="token-icon"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: token.logoSvg }}
      />
    );
  }
  const sym = token.symbol.slice(0, 3).toUpperCase();
  return (
    <span
      className="token-icon token-icon-fallback"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: colorFor(token.contract)
      }}
    >
      {sym.charAt(0)}
    </span>
  );
}
