import {
  Networks,
  Asset,
} from "@stellar/stellar-sdk";
import {
  SupportedNetworks,
  SupportedProtocols,
} from "@soroswap/sdk";

export const IS_TESTNET = (process.env.STELLAR_NETWORK ?? "testnet") === "testnet";
export const HORIZON_URL = IS_TESTNET
  ? "https://horizon-testnet.stellar.org"
  : "https://horizon.stellar.org";
export const NETWORK_PASSPHRASE = IS_TESTNET ? Networks.TESTNET : Networks.PUBLIC;
export const SOROSWAP_NETWORK = IS_TESTNET ? SupportedNetworks.TESTNET : SupportedNetworks.MAINNET;
export const TX_FEE = "10000"; // 0.001 XLM

// Testnet USDC issuer (Circle)
export const USDC_ISSUER = IS_TESTNET
  ? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  : "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Soroswap contract IDs (Soroban wrapped assets)
export const SOROSWAP_TOKENS: Record<string, string> = IS_TESTNET
  ? {
      XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      USDC: "CDWEFYYHMGEZEFC5TBUDXM3IJJ7K7W5BDGE765UIYQEV4JFWDOLSTOEK",
    }
  : {
      XLM: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
      USDC: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUD",
    };

export { SupportedProtocols };
