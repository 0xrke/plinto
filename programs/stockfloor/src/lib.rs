use anchor_lang::prelude::*;

declare_id!("98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA");

#[program]
pub mod stockfloor {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
