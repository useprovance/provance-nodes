import { parseAbi, type Chain, type Hex } from "viem";

export const IS_TESTNET = (process.env.GOAT_NETWORK ?? "testnet") === "testnet";

export const goatChain: Chain = IS_TESTNET
  ? {
      id: 48816,
      name: "GOAT Network Testnet",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet3.goat.network"] } },
      blockExplorers: { default: { name: "GoatScan", url: "https://explorer.testnet3.goat.network" } },
    }
  : {
      id: 2345,
      name: "GOAT Network",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: [process.env.GOAT_RPC_URL ?? "https://rpc.goat.network"] } },
      blockExplorers: { default: { name: "GoatScan", url: "https://explorer.goat.network" } },
    };

export const OKU_SWAP_ROUTER = "0xaa52bB8110fE38D0d2d2AF0B85C3A3eE622CA455" as Hex;
export const OKU_QUOTER     = "0x5911cB3633e764939edc2d92b7e1ad375Bb57649" as Hex;

export const KNOWN_TOKENS: Record<string, Hex> = {
  WGBTC:  "0xbC10000000000000000000000000000000000000",
  GOATED: "0xbC10000000000000000000000000000000000001",
  USDCe:  "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
  BTCB:   "0xfe41e7e5cB3460c483AB2A38eb605Cda9e2d248E",
  USDT:   "0xE1AD845D93853fff44990aE0DcecD8575293681e",
  uBTC:   "0x78E26E8b953C7c78A58d69d8B9A91745C2BbB258",
  DOGEB:  "0x1E0d0303a8c4aD428953f5ACB1477dB42bb838cf",
  BILLY:  "0x620b00D5fdaD7dF34779077A736c359F25f1c917",
  NANNY:  "0x0a479Ca22d094B44C5E16738C54870614D4d65b9",
};

export const KNOWN_TOKENS_UPPER: Record<string, Hex> = Object.fromEntries(
  Object.entries(KNOWN_TOKENS).map(([k, v]) => [k.toUpperCase(), v])
);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const SWAP_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);
