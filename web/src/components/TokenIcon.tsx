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

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
      <img
        src={svgDataUrl(token.logoSvg)}
        alt={token.symbol}
        className="token-icon"
        style={{ width: size, height: size }}
        loading="lazy"
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
