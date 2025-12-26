use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("NexxVau1t111111111111111111111111111111111");

#[program]
pub mod nexxore_vault {
    use super::*;

    /// Initialize the vault
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.total_assets = 0;
        vault.total_shares = 0;
        vault.paused = false;
        vault.bump = ctx.bumps.vault;

        msg!("Vault initialized!");
        msg!("Authority: {}", vault.authority);
        msg!("Token Mint: {}", vault.token_mint);

        Ok(())
    }

    /// Deposit tokens and receive shares
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault.paused, VaultError::VaultPaused);

        let vault = &mut ctx.accounts.vault;

        // Calculate shares to mint
        let shares = if vault.total_shares == 0 {
            amount
        } else {
            amount
                .checked_mul(vault.total_shares)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(vault.total_assets)
                .ok_or(VaultError::MathOverflow)?
        };

        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update vault state
        vault.total_assets = vault
            .total_assets
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_add(shares)
            .ok_or(VaultError::MathOverflow)?;

        // Update user shares
        let user_shares = &mut ctx.accounts.user_shares;
        user_shares.shares = user_shares
            .shares
            .checked_add(shares)
            .ok_or(VaultError::MathOverflow)?;

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            shares,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Deposited {} tokens, minted {} shares", amount, shares);

        Ok(())
    }

    /// Withdraw assets by burning shares
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);

        let vault = &mut ctx.accounts.vault;
        let user_shares = &mut ctx.accounts.user_shares;

        require!(user_shares.shares >= shares, VaultError::InsufficientShares);

        // Calculate assets to return
        let assets = shares
            .checked_mul(vault.total_assets)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vault.total_shares)
            .ok_or(VaultError::MathOverflow)?;

        require!(assets <= vault.total_assets, VaultError::InsufficientAssets);

        // Update state before transfer
        vault.total_assets = vault
            .total_assets
            .checked_sub(assets)
            .ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_sub(shares)
            .ok_or(VaultError::MathOverflow)?;
        user_shares.shares = user_shares
            .shares
            .checked_sub(shares)
            .ok_or(VaultError::MathOverflow)?;

        // Transfer tokens from vault to user using PDA signer
        let seeds = &[
            b"vault",
            vault.token_mint.as_ref(),
            &[vault.bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, assets)?;

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            assets,
            shares,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Withdrew {} assets, burned {} shares", assets, shares);

        Ok(())
    }

    /// Pause deposits (admin only)
    pub fn pause(ctx: Context<AdminAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, VaultError::AlreadyPaused);
        vault.paused = true;
        msg!("Vault paused");
        Ok(())
    }

    /// Unpause deposits (admin only)
    pub fn unpause(ctx: Context<AdminAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(vault.paused, VaultError::NotPaused);
        vault.paused = false;
        msg!("Vault unpaused");
        Ok(())
    }
}

// ============ Accounts ============

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        constraint = vault_token_account.mint == token_mint.key(),
        constraint = vault_token_account.owner == vault.key(),
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault", vault.token_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserShares::INIT_SPACE,
        seeds = [b"user_shares", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_shares: Account<'info, UserShares>,

    #[account(
        mut,
        constraint = user_token_account.mint == vault.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.key() == vault.vault_token_account,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault", vault.token_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"user_shares", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_shares: Account<'info, UserShares>,

    #[account(
        mut,
        constraint = user_token_account.mint == vault.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.key() == vault.vault_token_account,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.token_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.authority == authority.key() @ VaultError::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    pub authority: Signer<'info>,
}

// ============ State ============

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub total_assets: u64,
    pub total_shares: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserShares {
    pub shares: u64,
}

// ============ Events ============

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub assets: u64,
    pub shares: u64,
    pub timestamp: i64,
}

// ============ Errors ============

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    NotPaused,
    #[msg("Vault is already paused")]
    AlreadyPaused,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient assets in vault")]
    InsufficientAssets,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
}
