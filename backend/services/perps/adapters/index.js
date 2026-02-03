const { EvmSettlementAdapter } = require('./evm');
const { SolanaSettlementAdapter } = require('./solana');

const buildAdapters = (config) => {
  return {
    evm: new EvmSettlementAdapter({
      rpcUrl: config.evmRpc,
      contractAddress: config.evmPerpsContract,
      abi: config.evmPerpsAbi
    }),
    solana: new SolanaSettlementAdapter({
      rpcUrl: config.solanaRpc,
      programId: config.solanaPerpsProgram,
      feePayerSecret: config.solanaFeePayerSecret,
      collateralMint: config.solanaCollateralMint,
      vaultAccount: config.solanaVaultAccount
    })
  };
};

module.exports = { buildAdapters };
