const { ethers } = require('ethers');

class EvmSettlementAdapter {
  constructor({ rpcUrl, contractAddress, abi }) {
    this.rpcUrl = rpcUrl;
    this.contractAddress = contractAddress;
    this.abi = abi || [];
    this.provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : null;
    this.contract = (this.provider && contractAddress) ? new ethers.Contract(contractAddress, this.abi, this.provider) : null;
  }

  async settleTrade({ wallet, market, size, price, side, leverage, margin }) {
    return { status: 'queued', chain: 'evm', wallet, market, size, price, side };
  }

  async settleClose({ wallet, market, size, price, leverage, margin }) {
    return { status: 'queued', chain: 'evm', wallet, market, size, price };
  }

  async depositMargin({ wallet, amount }) {
    return { status: 'queued', chain: 'evm', wallet, amount };
  }

  async withdrawMargin({ wallet, amount }) {
    return { status: 'queued', chain: 'evm', wallet, amount };
  }
}

module.exports = { EvmSettlementAdapter };
