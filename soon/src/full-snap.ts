import {
  getMarketAddress,
  IWallet,
  Market,
  Network,
} from "@invariant-labs/sdk-soon";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getCoingeckoPricesData2,
  getSoonTokensData,
  getJupPricesData2,
  getPoolsFromAdresses,
  getTokensPrices,
  PoolsApyStatsData,
  PoolStatsData,
  PoolStatsDataWithString,
  PoolWithAddress,
  printBN,
  supportedTokens,
  TimeData,
  TokenStatsDataWithString,
} from "./utils";
import fs from "fs";
import { DECIMAL } from "@invariant-labs/sdk-soon/lib/utils";

export const createSnapshotForNetwork = async (network: Network) => {
  let provider: AnchorProvider;
  let fileName: string;
  let dataFileName: string;
  let poolsApyFileName: string;

  switch (network) {
    case Network.TEST:
      provider = AnchorProvider.local("https://rpc.testnet.soo.network/rpc");
      fileName = "../data/soon/full_testnet.json";
      dataFileName = "../data/soon/testnet.json";
      poolsApyFileName = "../data/soon/pool_apy_testnet.json";
      break;
    case Network.MAIN:
      provider = AnchorProvider.local("https://rpc.mainnet.soo.network/rpc");
      fileName = "../data/soon/full_mainnet.json";
      dataFileName = "../data/soon/mainnet.json";
      poolsApyFileName = "../data/soon/pool_apy_mainnet.json";
      break;
    default:
      throw new Error("Unknown network");
  }

  const data: Record<string, PoolStatsData> = JSON.parse(
    fs.readFileSync(dataFileName, "utf-8")
  );
  const poolsApy: Record<string, PoolsApyStatsData> = JSON.parse(
    fs.readFileSync(poolsApyFileName, "utf-8")
  );

  const connection = provider.connection;

  const market = await Market.build(
    network,
    provider.wallet as IWallet,
    connection,
    new PublicKey(getMarketAddress(network))
  );

  const allPoolsData = await getPoolsFromAdresses(
    Object.keys(data).map((addr) => new PublicKey(addr)),
    market
  );
  const poolsDataObject: Record<string, PoolWithAddress> = {};
  allPoolsData.forEach((pool) => {
    poolsDataObject[pool.address.toString()] = pool;
  });

  const volume24 = {
    value: 0,
    change: 0,
  };
  const tvl24 = {
    value: 0,
    change: 0,
  };
  const fees24 = {
    value: 0,
    change: 0,
  };

  const tokensDataObject: Record<string, TokenStatsDataWithString> = {};
  let poolsData: PoolStatsDataWithString[] = [];

  const volumeForTimestamps: Record<string, number> = {};
  const liquidityForTimestamps: Record<string, number> = {};
  const feesForTimestamps: Record<string, number> = {};

  const lastTimestamp = Math.max(
    ...Object.values(data)
      .filter(({ snapshots }) => snapshots.length > 0)
      .map(({ snapshots }) => +snapshots[snapshots.length - 1].timestamp)
  );

  Object.entries(data).forEach(([address, poolStatsData]) => {
    const snapshots = poolStatsData.snapshots;

    if (!poolsDataObject[address]) {
      return;
    }

    if (!tokensDataObject[poolsDataObject[address].tokenX.toString()]) {
      tokensDataObject[poolsDataObject[address].tokenX.toString()] = {
        address: poolsDataObject[address].tokenX.toString(),
        price: 0,
        volume24: 0,
        tvl: 0,
      };
    }

    if (!tokensDataObject[poolsDataObject[address].tokenY.toString()]) {
      tokensDataObject[poolsDataObject[address].tokenY.toString()] = {
        address: poolsDataObject[address].tokenY.toString(),
        price: 0,
        volume24: 0,
        tvl: 0,
      };
    }

    if (!snapshots.length) {
      poolsData.push({
        volume24: 0,
        tvl: 0,
        tokenX: poolsDataObject[address].tokenX.toString(),
        tokenY: poolsDataObject[address].tokenY.toString(),
        fee: +printBN(poolsDataObject[address].fee.v, DECIMAL - 2),
        apy: poolsApy[address].apy ?? 0,
        poolAddress: new PublicKey(address).toString(),
        liquidityX: 0,
        liquidityY: 0,
        lockedX: 0,
        lockedY: 0,
      });
      return;
    }

    const tokenX = poolsDataObject[address].tokenX.toString();
    const tokenY = poolsDataObject[address].tokenY.toString();

    const lastSnapshot = snapshots[snapshots.length - 1];

    tokensDataObject[tokenX].volume24 +=
      lastSnapshot.timestamp === lastTimestamp
        ? lastSnapshot.volumeX.usdValue24
        : 0;
    tokensDataObject[tokenY].volume24 +=
      lastSnapshot.timestamp === lastTimestamp
        ? lastSnapshot.volumeY.usdValue24
        : 0;
    tokensDataObject[tokenX].tvl += lastSnapshot.liquidityX.usdValue24;
    tokensDataObject[tokenY].tvl += lastSnapshot.liquidityY.usdValue24;

    poolsData.push({
      volume24:
        lastSnapshot.timestamp === lastTimestamp
          ? lastSnapshot.volumeX.usdValue24 + lastSnapshot.volumeY.usdValue24
          : 0,
      tvl:
        lastSnapshot.timestamp === lastTimestamp
          ? lastSnapshot.liquidityX.usdValue24 +
            lastSnapshot.liquidityY.usdValue24
          : 0,
      tokenX: poolsDataObject[address].tokenX.toString(),
      tokenY: poolsDataObject[address].tokenY.toString(),
      fee: +printBN(poolsDataObject[address].fee.v, DECIMAL - 2),
      apy: poolsApy[address]?.apy ?? 0,
      poolAddress: new PublicKey(address).toString(),
      liquidityX: lastSnapshot.liquidityX.usdValue24,
      liquidityY: lastSnapshot.liquidityY.usdValue24,
      lockedX: lastSnapshot.lockedX?.usdValue24 ?? 0,
      lockedY: lastSnapshot.lockedY?.usdValue24 ?? 0,
    });

    snapshots.slice(-30).forEach((snapshot) => {
      const timestamp = snapshot.timestamp.toString();

      if (!volumeForTimestamps[timestamp]) {
        volumeForTimestamps[timestamp] = 0;
      }

      if (!liquidityForTimestamps[timestamp]) {
        liquidityForTimestamps[timestamp] = 0;
      }

      if (!feesForTimestamps[timestamp]) {
        feesForTimestamps[timestamp] = 0;
      }

      volumeForTimestamps[timestamp] +=
        snapshot.volumeX.usdValue24 + snapshot.volumeY.usdValue24;
      liquidityForTimestamps[timestamp] +=
        snapshot.liquidityX.usdValue24 + snapshot.liquidityY.usdValue24;
      feesForTimestamps[timestamp] +=
        snapshot.feeX.usdValue24 + snapshot.feeY.usdValue24;
    });
  });

  const allTokens = getSoonTokensData(network);
  const tokensPricesData = await getJupPricesData2(
    Object.values(allTokens).map((tokenData) => tokenData.solAddress ?? "")
  );

  Object.entries(tokensPricesData).forEach(([solAddress, priceData]) => {
    Object.entries(allTokens).forEach(([address, tokenData]) => {
      if (solAddress === tokenData.solAddress && tokensDataObject[address]) {
        tokensDataObject[address].price = priceData.price;
      }
    });
  });

  const idsList: string[] = [];

  Object.values(allTokens).forEach((token) => {
    if (typeof token?.coingeckoId !== "undefined") {
      idsList.push(token.coingeckoId);
    }
  });

  const coingeckoPrices = await getTokensPrices(idsList);

  Object.entries(coingeckoPrices).forEach(([coingeckoId, price]) => {
    Object.entries(allTokens).forEach(([address, tokenData]) => {
      if (coingeckoId === tokenData.coingeckoId && tokensDataObject[address]) {
        tokensDataObject[address].price = price;
      }
    });
  });

  const volumePlot: TimeData[] = Object.entries(volumeForTimestamps)
    .map(([timestamp, value]) => ({
      timestamp: +timestamp,
      value,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const liquidityPlot: TimeData[] = Object.entries(liquidityForTimestamps)
    .map(([timestamp, value]) => ({
      timestamp: +timestamp,
      value,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const feePlot: TimeData[] = Object.entries(feesForTimestamps)
    .map(([timestamp, value]) => ({
      timestamp: +timestamp,
      value,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const tiersToOmit = [0.001, 0.003];

  poolsData = poolsData.filter((pool) => !tiersToOmit.includes(pool.fee));

  volume24.value = volumePlot.length
    ? volumePlot[volumePlot.length - 1].value
    : 0;
  tvl24.value = liquidityPlot.length
    ? liquidityPlot[liquidityPlot.length - 1].value
    : 0;
  fees24.value = feePlot.length ? feePlot[feePlot.length - 1].value : 0;

  const prevVolume24 =
    volumePlot.length > 1 ? volumePlot[volumePlot.length - 2].value : 0;
  const prevTvl24 =
    liquidityPlot.length > 1
      ? liquidityPlot[liquidityPlot.length - 2].value
      : 0;
  const prevFees24 = feePlot.length > 1 ? feePlot[feePlot.length - 2].value : 0;

  volume24.change = ((volume24.value - prevVolume24) / prevVolume24) * 100;
  tvl24.change = ((tvl24.value - prevTvl24) / prevTvl24) * 100;
  fees24.change = ((fees24.value - prevFees24) / prevFees24) * 100;

  if (network === Network.MAIN) {
    for (const supportedToken of Object.keys(supportedTokens)) {
      const result = await market.getCurrentTokenStats(
        supportedToken,
        "So11111111111111111111111111111111111111112",
        tokensPricesData["7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"].price
      );

      if (!("error" in result) && tokensDataObject[supportedToken]) {
        tokensDataObject[supportedToken].price = +result.priceUsd;
      }
    }
  }

  fs.writeFileSync(
    fileName,
    JSON.stringify({
      volume24,
      tvl24,
      fees24,
      tokensData: Object.values(tokensDataObject),
      poolsData,
      volumePlot,
      liquidityPlot,
    })
  );
};

createSnapshotForNetwork(Network.TEST).then(
  () => {
    console.log("Soon: Full testnet snapshot done!");
  },
  (err) => {
    console.log(err);
  }
);

// createSnapshotForNetwork(Network.MAIN).then(
//   () => {
//     console.log("Soon: Full mainnet snapshot done!");
//   },
//   (err) => {
//     console.log(err);
//   }
// );
