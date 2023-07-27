import BigNumber from "bignumber.js";
import { CHAIN } from "../helpers/chains";
import { getBlock } from "../helpers/getBlock";
import { getBalance } from "@defillama/sdk/build/eth";
import { Adapter, ChainBlocks, FetchResultFees, ProtocolType } from "../adapters/types";
import postgres from "postgres";
import { getPrices } from "../utils/prices";

async function getFees(toTimestamp:number, fromTimestamp:number, chainBlocks: ChainBlocks){
  const todaysBlock = (await getBlock(toTimestamp, CHAIN.BASE, chainBlocks));
  const yesterdaysBlock = (await getBlock(fromTimestamp, CHAIN.BASE, {}));


  const feeWallet = '0x4200000000000000000000000000000000000011';
  const l1FeeVault = '0x420000000000000000000000000000000000001a';
  const baseFeeVault = '0x4200000000000000000000000000000000000019';

  const [
      feeWalletStart,
      feeWalletEnd,
      l1FeeVaultStart,
      l1FeeVaultEnd,
      baseFeeVaultStart,
      baseFeeVaultEend
  ] = await Promise.all([
      getBalance({
          target: feeWallet,
          block: yesterdaysBlock,
          chain: CHAIN.BASE
      }),
      getBalance({
          target: feeWallet,
          block: todaysBlock,
          chain: CHAIN.BASE
      }),
      getBalance({
          target: l1FeeVault,
          block: yesterdaysBlock,
          chain: CHAIN.BASE
      }),
      getBalance({
          target: l1FeeVault,
          block: todaysBlock,
          chain: CHAIN.BASE
      }),
      getBalance({
          target: baseFeeVault,
          block: yesterdaysBlock,
          chain: CHAIN.BASE
      }),
      getBalance({
          target: baseFeeVault,
          block: todaysBlock,
          chain: CHAIN.BASE
      })
  ])
  const ethBalance = (new BigNumber(feeWalletEnd.output).minus(feeWalletStart.output))
      .plus((new BigNumber(l1FeeVaultEnd.output).minus(l1FeeVaultStart.output)))
      .plus((new BigNumber(baseFeeVaultEend.output).minus(baseFeeVaultStart.output)))

  return (ethBalance.plus(0)).div(1e18)
}

const fetch = async (timestamp: number, chainBlocks: ChainBlocks): Promise<FetchResultFees> => {
  const fromTimestamp = timestamp - 60 * 60 * 24
  const toTimestamp = timestamp
  const sql = postgres(process.env.INDEXA_DB!);
  const now = new Date(timestamp * 1e3)
  const dayAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24)
  try {
        const sequencerGas = sql`
            SELECT
                sum(ethereum.transactions.gas_used * ethereum.transactions.gas_price) / 10 ^ 18 AS sum
            FROM
                ethereum.transactions
                INNER JOIN ethereum.blocks ON ethereum.transactions.block_number = ethereum.blocks.number
            WHERE (to_address = '\\x5050F69a9786F081509234F1a7F4684b5E5b76C9'::bytea
                OR to_address = '\\xff00000000000000000000000000000000008453'::bytea
                OR to_address = '\\x642229f238fb9dE03374Be34B0eD8D9De80752c5'::bytea
                OR to_address = '\\x56315b90c40730925ec5485cf004d835058518A0'::bytea) AND (block_time BETWEEN ${dayAgo.toISOString()} AND ${now.toISOString()});
        `
        const [totalFees, totalSpentBySequencer] = await Promise.all([
            getFees(toTimestamp, fromTimestamp, chainBlocks),
            sequencerGas
        ]);

        const ethAddress = "ethereum:0x0000000000000000000000000000000000000000";
        const pricesObj: any = await getPrices([ethAddress], toTimestamp);
        const latestPrice = pricesObj[ethAddress]["price"]
        const finalDailyFee = totalFees.times(latestPrice)
        const revenue = (totalFees.minus(totalSpentBySequencer[0].sum)).times(latestPrice)
        await sql.end({ timeout: 3 })
        return {
            timestamp,
            dailyFees: `${finalDailyFee}`,
            dailyRevenue: revenue.toString(),
        }
    } catch(error) {
        await sql.end({ timeout: 3 })
        console.error(error);
        throw error;
    }
}

const adapter: Adapter = {
  adapter: {
      [CHAIN.BASE]: {
          fetch: fetch,
          start: async () => 1687474800,
      },
  },
  protocolType: ProtocolType.CHAIN
}

export default adapter;