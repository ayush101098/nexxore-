const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const idl = require('../idl/nexxore-perps.json');

const MARKET_IDS = {
  btcusdt: 1,
  ethusdt: 2,
  solusdt: 3
};

const SCALE = 1_000_000;

const parseSecretKey = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return null;
};

class SolanaSettlementAdapter {
  constructor({ rpcUrl, programId, feePayerSecret, collateralMint, vaultAccount }) {
    this.rpcUrl = rpcUrl;
    this.programId = programId ? new PublicKey(programId) : null;
    this.collateralMint = collateralMint ? new PublicKey(collateralMint) : null;
    this.vaultAccount = vaultAccount ? new PublicKey(vaultAccount) : null;
    this.feePayer = parseSecretKey(feePayerSecret);
    this.connection = rpcUrl ? new Connection(rpcUrl, 'confirmed') : null;
    this.enabled = Boolean(this.connection && this.programId && this.feePayer);
    if (this.enabled) {
      const wallet = new anchor.Wallet(this.feePayer);
      this.provider = new anchor.AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
      this.program = new anchor.Program(idl, this.programId, this.provider);
    }
  }

  marketIdFor(symbol) {
    return MARKET_IDS[String(symbol || '').toLowerCase()] || 0;
  }

  async getStatePda() {
    return PublicKey.findProgramAddressSync([Buffer.from('state')], this.programId)[0];
  }

  async getMarginPda(user) {
    return PublicKey.findProgramAddressSync([Buffer.from('margin'), user.toBuffer()], this.programId)[0];
  }

  async getPositionPda(user, marketId) {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(marketId));
    return PublicKey.findProgramAddressSync([Buffer.from('position'), user.toBuffer(), idBuf], this.programId)[0];
  }

  async settleTrade({ wallet, market, size, price, side, leverage, margin }) {
    if (!this.enabled) {
      return { status: 'disabled', chain: 'solana', wallet, market, size, price, side };
    }

    const user = this.feePayer.publicKey;
    const marketId = this.marketIdFor(market);
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const positionPda = await this.getPositionPda(user, marketId);

    const sizeScaled = Math.round(Number(size) * SCALE);
    const priceScaled = Math.round(Number(price) * SCALE);
    const marginAmount = Math.round(Number(margin || 0) * SCALE);
    const lev = Math.max(1, Number(leverage || 1));
    const isLong = side === 'long';

    const tx = await this.program.methods
      .openPosition(new anchor.BN(marketId), new anchor.BN(sizeScaled), new anchor.BN(priceScaled), new anchor.BN(marginAmount), lev, isLong)
      .accounts({
        state: statePda,
        margin: marginPda,
        position: positionPda,
        user,
        systemProgram: SystemProgram.programId
      })
      .signers([this.feePayer])
      .rpc();

    return { status: 'submitted', chain: 'solana', tx };
  }

  async settleClose({ wallet, market, size, price }) {
    if (!this.enabled) {
      return { status: 'disabled', chain: 'solana', wallet, market, size, price };
    }

    const user = this.feePayer.publicKey;
    const marketId = this.marketIdFor(market);
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const positionPda = await this.getPositionPda(user, marketId);
    const priceScaled = Math.round(Number(price) * SCALE);

    const tx = await this.program.methods
      .closePosition(new anchor.BN(priceScaled))
      .accounts({
        state: statePda,
        margin: marginPda,
        position: positionPda,
        user
      })
      .signers([this.feePayer])
      .rpc();

    return { status: 'submitted', chain: 'solana', tx };
  }

  async depositMargin({ wallet, amount, userTokenAccount }) {
    if (!this.enabled || !this.collateralMint || !this.vaultAccount) {
      return { status: 'disabled', chain: 'solana', wallet, amount };
    }

    const user = this.feePayer.publicKey;
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const amountScaled = Math.round(Number(amount) * SCALE);

    const tx = await this.program.methods
      .depositMargin(new anchor.BN(amountScaled))
      .accounts({
        state: statePda,
        margin: marginPda,
        vault: this.vaultAccount,
        user,
        userTokenAccount: new PublicKey(userTokenAccount),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([this.feePayer])
      .rpc();

    return { status: 'submitted', chain: 'solana', tx };
  }

  async withdrawMargin({ wallet, amount, userTokenAccount }) {
    if (!this.enabled || !this.collateralMint || !this.vaultAccount) {
      return { status: 'disabled', chain: 'solana', wallet, amount };
    }

    const user = this.feePayer.publicKey;
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const amountScaled = Math.round(Number(amount) * SCALE);

    const tx = await this.program.methods
      .withdrawMargin(new anchor.BN(amountScaled))
      .accounts({
        state: statePda,
        margin: marginPda,
        vault: this.vaultAccount,
        user,
        userTokenAccount: new PublicKey(userTokenAccount),
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([this.feePayer])
      .rpc();

    return { status: 'submitted', chain: 'solana', tx };
  }

  async buildOpenPositionTx({ walletAddress, market, size, price, margin, leverage, side }) {
    if (!this.program || !this.connection) {
      return { status: 'disabled', transaction: null };
    }
    const user = new PublicKey(walletAddress);
    const marketId = this.marketIdFor(market);
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const positionPda = await this.getPositionPda(user, marketId);
    const sizeScaled = Math.round(Number(size) * SCALE);
    const priceScaled = Math.round(Number(price) * SCALE);
    const marginAmount = Math.round(Number(margin) * SCALE);
    const lev = Math.max(1, Number(leverage || 1));
    const isLong = side === 'long';

    const tx = await this.program.methods
      .openPosition(new anchor.BN(marketId), new anchor.BN(sizeScaled), new anchor.BN(priceScaled), new anchor.BN(marginAmount), lev, isLong)
      .accounts({
        state: statePda,
        margin: marginPda,
        position: positionPda,
        user,
        systemProgram: SystemProgram.programId
      })
      .transaction();

    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    return { status: 'prepared', transaction: tx.serialize({ requireAllSignatures: false }).toString('base64') };
  }

  async buildClosePositionTx({ walletAddress, market, price }) {
    if (!this.program || !this.connection) {
      return { status: 'disabled', transaction: null };
    }
    const user = new PublicKey(walletAddress);
    const marketId = this.marketIdFor(market);
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const positionPda = await this.getPositionPda(user, marketId);
    const priceScaled = Math.round(Number(price) * SCALE);

    const tx = await this.program.methods
      .closePosition(new anchor.BN(priceScaled))
      .accounts({
        state: statePda,
        margin: marginPda,
        position: positionPda,
        user
      })
      .transaction();

    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    return { status: 'prepared', transaction: tx.serialize({ requireAllSignatures: false }).toString('base64') };
  }

  async buildDepositTx({ walletAddress, amount, userTokenAccount }) {
    if (!this.program || !this.connection || !this.vaultAccount) {
      return { status: 'disabled', transaction: null };
    }
    const user = new PublicKey(walletAddress);
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const amountScaled = Math.round(Number(amount) * SCALE);

    const tx = await this.program.methods
      .depositMargin(new anchor.BN(amountScaled))
      .accounts({
        state: statePda,
        margin: marginPda,
        vault: this.vaultAccount,
        user,
        userTokenAccount: new PublicKey(userTokenAccount),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .transaction();

    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    return { status: 'prepared', transaction: tx.serialize({ requireAllSignatures: false }).toString('base64') };
  }

  async buildWithdrawTx({ walletAddress, amount, userTokenAccount }) {
    if (!this.program || !this.connection || !this.vaultAccount) {
      return { status: 'disabled', transaction: null };
    }
    const user = new PublicKey(walletAddress);
    const statePda = await this.getStatePda();
    const marginPda = await this.getMarginPda(user);
    const amountScaled = Math.round(Number(amount) * SCALE);

    const tx = await this.program.methods
      .withdrawMargin(new anchor.BN(amountScaled))
      .accounts({
        state: statePda,
        margin: marginPda,
        vault: this.vaultAccount,
        user,
        userTokenAccount: new PublicKey(userTokenAccount),
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .transaction();

    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;

    return { status: 'prepared', transaction: tx.serialize({ requireAllSignatures: false }).toString('base64') };
  }
}

module.exports = { SolanaSettlementAdapter };
