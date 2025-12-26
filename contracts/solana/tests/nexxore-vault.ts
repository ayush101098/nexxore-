import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NexxoreVault } from "../target/types/nexxore_vault";
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  createAccount, 
  mintTo,
  getAccount 
} from "@solana/spl-token";
import { assert } from "chai";

describe("nexxore-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NexxoreVault as Program<NexxoreVault>;
  
  let tokenMint: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;
  let vault: anchor.web3.PublicKey;
  let userShares: anchor.web3.PublicKey;
  let vaultBump: number;

  const authority = provider.wallet.publicKey;
  const user = anchor.web3.Keypair.generate();

  before(async () => {
    // Airdrop SOL to user
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      provider.wallet.payer,
      authority,
      null,
      6 // 6 decimals
    );

    // Derive vault PDA
    [vault, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );

    // Create vault token account
    vaultTokenAccount = await createAccount(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      vault
    );

    // Create user token account
    userTokenAccount = await createAccount(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      user.publicKey
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      userTokenAccount,
      authority,
      1_000_000_000 // 1000 tokens with 6 decimals
    );
  });

  it("Initializes the vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        vault,
        tokenMint,
        vaultTokenAccount,
        authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultAccount = await program.account.vault.fetch(vault);
    
    assert.equal(vaultAccount.authority.toString(), authority.toString());
    assert.equal(vaultAccount.tokenMint.toString(), tokenMint.toString());
    assert.equal(vaultAccount.totalAssets.toNumber(), 0);
    assert.equal(vaultAccount.totalShares.toNumber(), 0);
    assert.equal(vaultAccount.paused, false);
  });

  it("Deposits tokens and mints shares", async () => {
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    [userShares] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_shares"), vault.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .deposit(depositAmount)
      .accounts({
        vault,
        userShares,
        userTokenAccount,
        vaultTokenAccount,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const vaultAccount = await program.account.vault.fetch(vault);
    const userSharesAccount = await program.account.userShares.fetch(userShares);

    assert.equal(vaultAccount.totalAssets.toNumber(), depositAmount.toNumber());
    assert.equal(vaultAccount.totalShares.toNumber(), depositAmount.toNumber());
    assert.equal(userSharesAccount.shares.toNumber(), depositAmount.toNumber());
  });

  it("Calculates shares correctly for second deposit", async () => {
    const depositAmount = new anchor.BN(50_000_000); // 50 tokens

    const vaultBefore = await program.account.vault.fetch(vault);
    const sharesBefore = await program.account.userShares.fetch(userShares);

    await program.methods
      .deposit(depositAmount)
      .accounts({
        vault,
        userShares,
        userTokenAccount,
        vaultTokenAccount,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const vaultAfter = await program.account.vault.fetch(vault);
    const sharesAfter = await program.account.userShares.fetch(userShares);

    const expectedShares = depositAmount
      .mul(vaultBefore.totalShares)
      .div(vaultBefore.totalAssets);

    assert.equal(
      sharesAfter.shares.toNumber(),
      sharesBefore.shares.add(expectedShares).toNumber()
    );
  });

  it("Withdraws assets and burns shares", async () => {
    const userSharesAccount = await program.account.userShares.fetch(userShares);
    const sharesToBurn = new anchor.BN(50_000_000);

    const userTokenBefore = await getAccount(provider.connection, userTokenAccount);

    await program.methods
      .withdraw(sharesToBurn)
      .accounts({
        vault,
        userShares,
        userTokenAccount,
        vaultTokenAccount,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const userTokenAfter = await getAccount(provider.connection, userTokenAccount);
    const sharesAfter = await program.account.userShares.fetch(userShares);

    assert.equal(
      sharesAfter.shares.toNumber(),
      userSharesAccount.shares.sub(sharesToBurn).toNumber()
    );
    
    assert(userTokenAfter.amount > userTokenBefore.amount);
  });

  it("Pauses and unpauses the vault", async () => {
    await program.methods
      .pause()
      .accounts({
        vault,
        authority,
      })
      .rpc();

    let vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.paused, true);

    // Try to deposit while paused (should fail)
    try {
      await program.methods
        .deposit(new anchor.BN(10_000_000))
        .accounts({
          vault,
          userShares,
          userTokenAccount,
          vaultTokenAccount,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "VaultPaused");
    }

    // Unpause
    await program.methods
      .unpause()
      .accounts({
        vault,
        authority,
      })
      .rpc();

    vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.paused, false);
  });

  it("Rejects deposit with zero amount", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(0))
        .accounts({
          vault,
          userShares,
          userTokenAccount,
          vaultTokenAccount,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "ZeroAmount");
    }
  });

  it("Rejects withdrawal with insufficient shares", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(999_999_999_999))
        .accounts({
          vault,
          userShares,
          userTokenAccount,
          vaultTokenAccount,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "InsufficientShares");
    }
  });
});
