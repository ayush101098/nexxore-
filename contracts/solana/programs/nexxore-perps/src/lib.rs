use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("A2EqQtujTmAzEPLtwBDJahz4TmxTNPLsdHXP1rxJwyg6");

#[program]
pub mod nexxore_perps {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.collateral_mint = ctx.accounts.collateral_mint.key();
        state.vault = ctx.accounts.vault.key();
        Ok(())
    }

    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpsError::ZeroAmount);
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let margin = &mut ctx.accounts.margin;
        margin.owner = ctx.accounts.user.key();
        margin.balance = margin.balance.checked_add(amount).ok_or(PerpsError::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpsError::ZeroAmount);
        let margin = &mut ctx.accounts.margin;
        require!(margin.balance >= amount, PerpsError::InsufficientBalance);

        margin.balance = margin.balance.checked_sub(amount).ok_or(PerpsError::MathOverflow)?;

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.state.to_account_info(),
        };
        let seeds = &[b"state", &[ctx.accounts.state.bump]];
        let signer = &[&seeds[..]];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        market_id: u64,
        size: i64,
        entry_price: u64,
        margin_amount: u64,
        leverage: u16,
        is_long: bool,
    ) -> Result<()> {
        require!(margin_amount > 0, PerpsError::ZeroAmount);
        let margin = &mut ctx.accounts.margin;
        require!(margin.balance >= margin_amount, PerpsError::InsufficientBalance);

        margin.balance = margin.balance.checked_sub(margin_amount).ok_or(PerpsError::MathOverflow)?;

        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.user.key();
        position.market_id = market_id;
        position.size = size;
        position.entry_price = entry_price;
        position.margin = margin_amount;
        position.leverage = leverage;
        position.is_long = is_long;
        position.open = true;
        position.bump = ctx.bumps.position;

        Ok(())
    }

    pub fn close_position(ctx: Context<ClosePosition>, exit_price: u64) -> Result<()> {
        let margin = &mut ctx.accounts.margin;
        let position = &mut ctx.accounts.position;
        require!(position.open, PerpsError::PositionClosed);

        position.open = false;
        position.exit_price = exit_price;
        margin.balance = margin.balance.checked_add(position.margin).ok_or(PerpsError::MathOverflow)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + State::INIT_SPACE,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        constraint = vault.mint == collateral_mint.key(),
        constraint = vault.owner == state.key(),
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositMargin<'info> {
    #[account(mut, seeds = [b"state"], bump = state.bump)]
    pub state: Account<'info, State>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + MarginAccount::INIT_SPACE,
        seeds = [b"margin", user.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawMargin<'info> {
    #[account(mut, seeds = [b"state"], bump = state.bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        seeds = [b"margin", user.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct OpenPosition<'info> {
    #[account(mut, seeds = [b"state"], bump = state.bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        seeds = [b"margin", user.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", user.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut, seeds = [b"state"], bump = state.bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        seeds = [b"margin", user.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginAccount>,

    #[account(
        mut,
        seeds = [b"position", user.key().as_ref(), &position.market_id.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub user: Signer<'info>,
}

#[account]
#[derive(Default)]
pub struct State {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
}

impl State {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 1;
}

#[account]
#[derive(Default)]
pub struct MarginAccount {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
}

impl MarginAccount {
    pub const INIT_SPACE: usize = 32 + 8 + 1;
}

#[account]
#[derive(Default)]
pub struct Position {
    pub owner: Pubkey,
    pub market_id: u64,
    pub size: i64,
    pub entry_price: u64,
    pub exit_price: u64,
    pub margin: u64,
    pub leverage: u16,
    pub is_long: bool,
    pub open: bool,
    pub bump: u8,
}

impl Position {
    pub const INIT_SPACE: usize = 32 + 8 + 8 + 8 + 8 + 8 + 2 + 1 + 1 + 1;
}

#[error_code]
pub enum PerpsError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient margin balance")]
    InsufficientBalance,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Position already closed")]
    PositionClosed,
}

/*







































































































































































}    MathOverflow,    #[msg("Math overflow")]    InsufficientBalance,    #[msg("Insufficient margin balance")]    ZeroAmount,    #[msg("Amount must be greater than zero")]pub enum PerpsError {#[error_code]}    pub const INIT_SPACE: usize = 32 + 8 + 1;impl MarginAccount {}    pub bump: u8,    pub balance: u64,    pub owner: Pubkey,pub struct MarginAccount {#[derive(Default)]#[account]}    pub const INIT_SPACE: usize = 32 + 32 + 32 + 1;impl State {}    pub bump: u8,    pub vault: Pubkey,    pub collateral_mint: Pubkey,    pub authority: Pubkey,pub struct State {#[derive(Default)]#[account]}    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        mut,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct WithdrawMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        space = 8 + MarginAccount::INIT_SPACE,        payer = user,        init_if_needed,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct DepositMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub authority: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    )]        constraint = vault.owner == state.key(),        constraint = vault.mint == collateral_mint.key(),    #[account(    pub collateral_mint: Account<'info, Mint>,    pub state: Account<'info, State>,    )]        bump        seeds = [b"state"],        space = 8 + State::INIT_SPACE,        payer = authority,        init,    #[account(pub struct Initialize<'info> {#[derive(Accounts)]}    }        Ok(())        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);        let cpi_program = ctx.accounts.token_program.to_account_info();        let signer = &[&seeds[..]];        let seeds = &[b"state", &[ctx.accounts.state.bump]];        };            authority: ctx.accounts.state.to_account_info(),            to: ctx.accounts.user_token_account.to_account_info(),            from: ctx.accounts.vault.to_account_info(),        let cpi_accounts = Transfer {        margin.balance = margin.balance.checked_sub(amount).ok_or(PerpsError::MathOverflow)?;        require!(margin.balance >= amount, PerpsError::InsufficientBalance);        let margin = &mut ctx.accounts.margin;        require!(amount > 0, PerpsError::ZeroAmount);    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {    }        Ok(())        margin.balance = margin.balance.checked_add(amount).ok_or(PerpsError::MathOverflow)?;        margin.owner = ctx.accounts.user.key();        let margin = &mut ctx.accounts.margin;        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);        let cpi_program = ctx.accounts.token_program.to_account_info();        };            authority: ctx.accounts.user.to_account_info(),            to: ctx.accounts.vault.to_account_info(),            from: ctx.accounts.user_token_account.to_account_info(),        let cpi_accounts = Transfer {        require!(amount > 0, PerpsError::ZeroAmount);    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {    }        Ok(())        state.vault = ctx.accounts.vault.key();        state.collateral_mint = ctx.accounts.collateral_mint.key();        state.authority = ctx.accounts.authority.key();        let state = &mut ctx.accounts.state;    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {    use super::*;pub mod nexxore_perps {#[program]declare_id!("NexxPerp111111111111111111111111111111111");use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};






































































































































































}    MathOverflow,    #[msg("Math overflow")]    InsufficientBalance,    #[msg("Insufficient margin balance")]    ZeroAmount,    #[msg("Amount must be greater than zero")]pub enum PerpsError {#[error_code]}    pub const INIT_SPACE: usize = 32 + 8 + 1;impl MarginAccount {}    pub bump: u8,    pub balance: u64,    pub owner: Pubkey,pub struct MarginAccount {#[derive(Default)]#[account]}    pub const INIT_SPACE: usize = 32 + 32 + 32 + 1;impl State {}    pub bump: u8,    pub vault: Pubkey,    pub collateral_mint: Pubkey,    pub authority: Pubkey,pub struct State {#[derive(Default)]#[account]}    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        mut,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct WithdrawMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        space = 8 + MarginAccount::INIT_SPACE,        payer = user,        init_if_needed,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct DepositMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub authority: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    )]        constraint = vault.owner == state.key(),        constraint = vault.mint == collateral_mint.key(),    #[account(    pub collateral_mint: Account<'info, Mint>,    pub state: Account<'info, State>,    )]        bump        seeds = [b"state"],        space = 8 + State::INIT_SPACE,        payer = authority,        init,    #[account(pub struct Initialize<'info> {#[derive(Accounts)]}    }        Ok(())        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);        let cpi_program = ctx.accounts.token_program.to_account_info();        let signer = &[&seeds[..]];        let seeds = &[b"state", &[ctx.accounts.state.bump]];        };            authority: ctx.accounts.state.to_account_info(),            to: ctx.accounts.user_token_account.to_account_info(),            from: ctx.accounts.vault.to_account_info(),        let cpi_accounts = Transfer {        margin.balance = margin.balance.checked_sub(amount).ok_or(PerpsError::MathOverflow)?;        require!(margin.balance >= amount, PerpsError::InsufficientBalance);        let margin = &mut ctx.accounts.margin;        require!(amount > 0, PerpsError::ZeroAmount);    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {    }        Ok(())        margin.balance = margin.balance.checked_add(amount).ok_or(PerpsError::MathOverflow)?;        margin.owner = ctx.accounts.user.key();        let margin = &mut ctx.accounts.margin;        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);        let cpi_program = ctx.accounts.token_program.to_account_info();        };            authority: ctx.accounts.user.to_account_info(),            to: ctx.accounts.vault.to_account_info(),            from: ctx.accounts.user_token_account.to_account_info(),        let cpi_accounts = Transfer {        require!(amount > 0, PerpsError::ZeroAmount);    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {    }        Ok(())        state.vault = ctx.accounts.vault.key();        state.collateral_mint = ctx.accounts.collateral_mint.key();        state.authority = ctx.accounts.authority.key();        let state = &mut ctx.accounts.state;    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {    use super::*;pub mod nexxore_perps {#[program]declare_id!("NexxPerp111111111111111111111111111111111");use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};






































































































































































}    MathOverflow,    #[msg("Math overflow")]    InsufficientBalance,    #[msg("Insufficient margin balance")]    ZeroAmount,    #[msg("Amount must be greater than zero")]pub enum PerpsError {#[error_code]}    pub const INIT_SPACE: usize = 32 + 8 + 1;impl MarginAccount {}    pub bump: u8,    pub balance: u64,    pub owner: Pubkey,pub struct MarginAccount {#[derive(Default)]#[account]}    pub const INIT_SPACE: usize = 32 + 32 + 32 + 1;impl State {}    pub bump: u8,    pub vault: Pubkey,    pub collateral_mint: Pubkey,    pub authority: Pubkey,pub struct State {#[derive(Default)]#[account]}    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        mut,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct WithdrawMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        space = 8 + MarginAccount::INIT_SPACE,        payer = user,        init_if_needed,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct DepositMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub authority: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    )]        constraint = vault.owner == state.key(),        constraint = vault.mint == collateral_mint.key(),    #[account(    pub collateral_mint: Account<'info, Mint>,    pub state: Account<'info, State>,    )]        bump        seeds = [b"state"],        space = 8 + State::INIT_SPACE,        payer = authority,        init,    #[account(pub struct Initialize<'info> {#[derive(Accounts)]}    }        Ok(())        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);        let cpi_program = ctx.accounts.token_program.to_account_info();        let signer = &[&seeds[..]];        let seeds = &[b"state", &[ctx.accounts.state.bump]];        };            authority: ctx.accounts.state.to_account_info(),            to: ctx.accounts.user_token_account.to_account_info(),            from: ctx.accounts.vault.to_account_info(),        let cpi_accounts = Transfer {        margin.balance = margin.balance.checked_sub(amount).ok_or(PerpsError::MathOverflow)?;        require!(margin.balance >= amount, PerpsError::InsufficientBalance);        let margin = &mut ctx.accounts.margin;        require!(amount > 0, PerpsError::ZeroAmount);    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {    }        Ok(())        margin.balance = margin.balance.checked_add(amount).ok_or(PerpsError::MathOverflow)?;        margin.owner = ctx.accounts.user.key();        let margin = &mut ctx.accounts.margin;        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);        let cpi_program = ctx.accounts.token_program.to_account_info();        };            authority: ctx.accounts.user.to_account_info(),            to: ctx.accounts.vault.to_account_info(),            from: ctx.accounts.user_token_account.to_account_info(),        let cpi_accounts = Transfer {        require!(amount > 0, PerpsError::ZeroAmount);    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {    }        Ok(())        state.vault = ctx.accounts.vault.key();        state.collateral_mint = ctx.accounts.collateral_mint.key();        state.authority = ctx.accounts.authority.key();        let state = &mut ctx.accounts.state;    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {    use super::*;pub mod nexxore_perps {#[program]declare_id!("NexxPerp111111111111111111111111111111111");use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};






































































































































































}    MathOverflow,    #[msg("Math overflow")]    InsufficientBalance,    #[msg("Insufficient margin balance")]    ZeroAmount,    #[msg("Amount must be greater than zero")]pub enum PerpsError {#[error_code]}    pub const INIT_SPACE: usize = 32 + 8 + 1;impl MarginAccount {}    pub bump: u8,    pub balance: u64,    pub owner: Pubkey,pub struct MarginAccount {#[derive(Default)]#[account]}    pub const INIT_SPACE: usize = 32 + 32 + 32 + 1;impl State {}    pub bump: u8,    pub vault: Pubkey,    pub collateral_mint: Pubkey,    pub authority: Pubkey,pub struct State {#[derive(Default)]#[account]}    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        mut,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct WithdrawMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub token_program: Program<'info, Token>,    pub user_token_account: Account<'info, TokenAccount>,    #[account(mut)]    pub user: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    #[account(mut)]    pub margin: Account<'info, MarginAccount>,    )]        bump        seeds = [b"margin", user.key().as_ref()],        space = 8 + MarginAccount::INIT_SPACE,        payer = user,        init_if_needed,    #[account(    pub state: Account<'info, State>,    #[account(mut, seeds = [b"state"], bump = state.bump)]pub struct DepositMargin<'info> {#[derive(Accounts)]}    pub system_program: Program<'info, System>,    pub authority: Signer<'info>,    #[account(mut)]    pub vault: Account<'info, TokenAccount>,    )]        constraint = vault.owner == state.key(),        constraint = vault.mint == collateral_mint.key(),    #[account(    pub collateral_mint: Account<'info, Mint>,    pub state: Account<'info, State>,    )]        bump        seeds = [b"state"],        space = 8 + State::INIT_SPACE,        payer = authority,        init,    #[account(pub struct Initialize<'info> {#[derive(Accounts)]}    }        Ok(())        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);        let cpi_program = ctx.accounts.token_program.to_account_info();        let signer = &[&seeds[..]];        let seeds = &[b"state", &[ctx.accounts.state.bump]];        };            authority: ctx.accounts.state.to_account_info(),            to: ctx.accounts.user_token_account.to_account_info(),            from: ctx.accounts.vault.to_account_info(),        let cpi_accounts = Transfer {        margin.balance = margin.balance.checked_sub(amount).ok_or(PerpsError::MathOverflow)?;        require!(margin.balance >= amount, PerpsError::InsufficientBalance);        let margin = &mut ctx.accounts.margin;        require!(amount > 0, PerpsError::ZeroAmount);    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {    }        Ok(())        margin.balance = margin.balance.checked_add(amount).ok_or(PerpsError::MathOverflow)?;        margin.owner = ctx.accounts.user.key();        let margin = &mut ctx.accounts.margin;        token::transfer(cpi_ctx, amount)?;        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);        let cpi_program = ctx.accounts.token_program.to_account_info();        };            authority: ctx.accounts.user.to_account_info(),            to: ctx.accounts.vault.to_account_info(),            from: ctx.accounts.user_token_account.to_account_info(),        let cpi_accounts = Transfer {        require!(amount > 0, PerpsError::ZeroAmount);    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {    }        Ok(())        state.vault = ctx.accounts.vault.key();        state.collateral_mint = ctx.accounts.collateral_mint.key();        state.authority = ctx.accounts.authority.key();        let state = &mut ctx.accounts.state;    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {    use super::*;pub mod nexxore_perps {#[program]declare_id!("NexxPerp111111111111111111111111111111111");use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("NexxPerp111111111111111111111111111111111");

#[program]
pub mod nexxore_perps {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.collateral_mint = ctx.accounts.collateral_mint.key();
        state.vault = ctx.accounts.vault.key();
        Ok(())
    }

    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpsError::ZeroAmount);
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let margin = &mut ctx.accounts.margin;
        margin.owner = ctx.accounts.user.key();
        margin.balance = margin.balance.checked_add(amount).ok_or(PerpsError::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpsError::ZeroAmount);
        let margin = &mut ctx.accounts.margin;
        require!(margin.balance >= amount, PerpsError::InsufficientBalance);

        margin.balance = margin.balance.checked_sub(amount).ok_or(PerpsError::MathOverflow)?;

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.state.to_account_info(),
        };
        let seeds = &[b"state", &[ctx.accounts.state.bump]];
        let signer = &[&seeds[..]];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + State::INIT_SPACE,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        constraint = vault.mint == collateral_mint.key(),
        constraint = vault.owner == state.key(),
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositMargin<'info> {
    #[account(mut, seeds = [b"state"], bump = state.bump)]
    pub state: Account<'info, State>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + MarginAccount::INIT_SPACE,
        seeds = [b"margin", user.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawMargin<'info> {
    #[account(mut, seeds = [b"state"], bump = state.bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        seeds = [b"margin", user.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(Default)]
pub struct State {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
}

impl State {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 1;
}

#[account]
#[derive(Default)]
pub struct MarginAccount {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
}

impl MarginAccount {
    pub const INIT_SPACE: usize = 32 + 8 + 1;
}

#[error_code]
pub enum PerpsError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient margin balance")]
    InsufficientBalance,
    #[msg("Math overflow")]
    MathOverflow,
}

*/
